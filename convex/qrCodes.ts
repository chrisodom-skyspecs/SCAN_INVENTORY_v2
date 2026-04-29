/**
 * convex/qrCodes.ts
 *
 * Query and mutation logic for QR label management on equipment cases.
 *
 * The QR code is stored as `cases.qrCode` and uniquely identifies a case
 * via the `by_qr_code` index defined in convex/schema.ts.  A QR code may
 * only be mapped to one case at a time — this module enforces that invariant
 * server-side so no two cases ever share the same QR payload.
 *
 * Exports
 * ───────
 *   validateQrCode         — query:    check whether a QR payload is available,
 *                                      already mapped to this case, or conflicting
 *   generateQRCodeForCase  — mutation: generate a new unique QR payload for a case;
 *                                      stores it with qrCodeSource="generated" and
 *                                      appends an audit event
 *   associateQRCodeToCase  — mutation: write an externally-scanned QR code to a
 *                                      case; validates uniqueness first, sets
 *                                      qrCodeSource="external", and appends audit event
 *
 * Database contract
 * ─────────────────
 * Both mutations write to two tables:
 *
 *   cases.qrCode        — the QR payload string (looked up by the SCAN app)
 *   cases.qrCodeSource  — "generated" (system-generated) | "external" (physical label)
 *   cases.updatedAt     — refreshed so M1 by_updated sort index stays current
 *   events              — immutable audit record of the QR code action
 *
 * The `by_qr_code` index on the `cases` table makes the uniqueness check
 * an O(log n) operation rather than a full table scan.
 *
 * Real-time fidelity
 * ──────────────────
 * Patching `cases.qrCode` triggers a reactive re-evaluation of every Convex
 * query subscribed to the affected case row (getCaseByQrCode, getCaseById,
 * listCases, etc.), pushing the updated document to connected dashboard and
 * SCAN app clients within ~100–300 ms.
 *
 * validateQrCode is a real-time subscription — the SCAN app confirm step
 * subscribes to it after the user captures a QR code, and automatically
 * re-evaluates if another client maps the same code before confirmation.
 *
 * Client usage
 * ────────────
 *   // 0. Generate a QR code for a new case (system-generated label)
 *   const generate = useMutation(api.qrCodes.generateQRCodeForCase);
 *   const { qrCode } = await generate({
 *     caseId:   caseDoc._id,
 *     userId:   kindeUser.id,
 *     userName: "Jane Pilot",
 *     baseUrl:  process.env.NEXT_PUBLIC_SCAN_APP_URL,
 *   });
 *
 *   // 1. Validate before confirming (confirm-step subscription)
 *   const validation = useQuery(api.qrCodes.validateQrCode, {
 *     qrCode: scannedPayload,
 *     caseId: targetCaseId,
 *   });
 *   // → { status: "available" | "mapped_to_this_case" | "mapped_to_other_case"
 *   //     conflictingCaseLabel?: string, conflictingCaseId?: string }
 *
 *   // 2. Associate an existing physical QR label on user confirmation
 *   const associate = useMutation(api.qrCodes.associateQRCodeToCase);
 *   await associate({
 *     qrCode:   "https://scan.example.com/case/abc123?uid=4f3d1a9b2c7e5f0a",
 *     caseId:   caseDoc._id,
 *     userId:   kindeUser.id,
 *     userName: "Jane Pilot",
 *   });
 */

import { mutation, query } from "./_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token."
    );
  }
  return identity;
}

// ─── QR code validation result ────────────────────────────────────────────────

/**
 * Structured validation result returned by `validateQrCode`.
 *
 * The SCAN app confirm step subscribes to this query after the user captures
 * a QR code.  The client uses the `status` field to decide whether to:
 *   • Show a "QR code is available" confirmation card    (status: "available")
 *   • Show an "already linked to this case" info banner  (status: "mapped_to_this_case")
 *   • Show a "QR code in use on another case" warning    (status: "mapped_to_other_case")
 *   • Show an input validation error                     (status: "invalid")
 *
 * Exported so client-side hooks and components can import the type without
 * importing the full Convex server module.
 */
export interface QrCodeValidationResult {
  /**
   * Validation status of the scanned QR payload:
   *
   *   "available"            — No case currently carries this QR code.
   *                            Safe to associate with the target case.
   *
   *   "mapped_to_this_case"  — The QR code is already stored on the target case.
   *                            Calling associateQRCodeToCase is a no-op (idempotent).
   *                            Client can skip confirmation and show "already linked".
   *
   *   "mapped_to_other_case" — The QR code is stored on a different case.
   *                            Client SHOULD warn the user and offer "reassign" or "cancel".
   *                            associateQRCodeToCase will throw if called in this state.
   *
   *   "invalid"              — The QR code string is empty or whitespace-only.
   *                            Client should show an input validation error.
   */
  status:
    | "available"
    | "mapped_to_this_case"
    | "mapped_to_other_case"
    | "invalid";

  /**
   * Human-readable reason string for "invalid" status.
   * Always undefined for other statuses.
   */
  reason?: string;

  /**
   * Display label of the case that already carries this QR code.
   * Defined only when status === "mapped_to_other_case".
   * Used in the ConflictBanner: "This QR code is mapped to <conflictingCaseLabel>".
   */
  conflictingCaseLabel?: string;

  /**
   * Convex document ID (as string) of the case that already carries this QR code.
   * Defined only when status === "mapped_to_other_case".
   * Used for deep-link navigation to the conflicting case.
   */
  conflictingCaseId?: string;
}

// ─── validateQrCode ───────────────────────────────────────────────────────────

/**
 * Validate whether a scanned QR payload can be associated with a target case.
 *
 * This is a real-time subscription — the SCAN app confirm step calls
 * `useQuery(api.qrCodes.validateQrCode, { qrCode, caseId })` and reacts
 * automatically if another client maps the same code between scan and confirm.
 *
 * Validation rules (in order):
 *   1. Reject blank `qrCode` strings → status: "invalid"
 *   2. Use the `by_qr_code` index to find any case carrying this QR code.
 *   3. If no case carries it → status: "available"
 *   4. If the carrying case is the target case → status: "mapped_to_this_case"
 *   5. Otherwise → status: "mapped_to_other_case" (with label + ID for UI)
 *
 * Performance:
 *   The `by_qr_code` index makes step 2 an O(log n) lookup rather than a
 *   full-table scan.  The query dependency is on the `cases` table row that
 *   matches the index, so Convex invalidates only when that row changes —
 *   not on every cases mutation.
 *
 * Requires authentication — unauthenticated requests throw [AUTH_REQUIRED].
 *
 * @param qrCode  The QR payload string to validate (from camera or manual entry).
 * @param caseId  The Convex ID of the target case the user intends to associate.
 *
 * @returns `QrCodeValidationResult` with a status discriminant and optional
 *          conflict metadata.
 */
export const validateQrCode = query({
  args: {
    /**
     * The QR payload string decoded by the SCAN app camera or entered manually.
     * Empty strings return status: "invalid" rather than throwing.
     */
    qrCode: v.string(),

    /**
     * Convex document ID of the target case for the intended association.
     * Used to distinguish "already on this case" from "on a different case".
     */
    caseId: v.id("cases"),
  },

  handler: async (ctx, args): Promise<QrCodeValidationResult> => {
    await requireAuth(ctx);

    // ── 1. Reject blank QR payloads ───────────────────────────────────────────
    const qrCode = args.qrCode.trim();
    if (qrCode.length === 0) {
      return {
        status: "invalid",
        reason: "QR code must not be empty.",
      };
    }

    // ── 2. Check by_qr_code index — O(log n) ─────────────────────────────────
    // Returns the first (and only, by invariant) case carrying this QR payload,
    // or null when the QR code is not yet associated with any case.
    const existingCase = await ctx.db
      .query("cases")
      .withIndex("by_qr_code", (q) => q.eq("qrCode", qrCode))
      .first();

    // ── 3. QR code is not yet mapped ──────────────────────────────────────────
    if (existingCase === null) {
      return { status: "available" };
    }

    // ── 4. QR code is already on the target case (idempotent) ─────────────────
    if (existingCase._id === args.caseId) {
      return { status: "mapped_to_this_case" };
    }

    // ── 5. QR code belongs to a different case (conflict) ─────────────────────
    return {
      status:               "mapped_to_other_case",
      conflictingCaseLabel: existingCase.label,
      conflictingCaseId:    existingCase._id.toString(),
    };
  },
});

// ─── Return types ─────────────────────────────────────────────────────────────

/**
 * Result returned by `generateQRCodeForCase`.
 * Exported so client-side hooks can expose a typed result.
 */
export interface GenerateQRCodeResult {
  /** Convex document ID of the case that was updated. */
  caseId: string;
  /** The generated QR code string now stored on this case. */
  qrCode: string;
  /**
   * `true` if the case previously had a QR code that was replaced by this call.
   * `false` if this is the first QR code generated for the case, or if the
   *  case already had a generated code and `forceRegenerate` was false (idempotent return).
   */
  wasRegenerated: boolean;
  /**
   * The previous QR code string (only defined when `wasRegenerated` is `true`).
   * Allows callers to invalidate or archive the old label if needed.
   */
  previousQrCode?: string;
}

/**
 * Result returned by `associateQRCodeToCase`.
 * Exported so client-side hooks can expose a typed result.
 */
export interface AssociateQRCodeResult {
  /** Convex document ID of the case that was updated. */
  caseId: string;
  /** The QR code string that is now associated with this case. */
  qrCode: string;
  /**
   * `true` when the QR code was already mapped to this exact case — the
   * mutation succeeded but made no DB write (idempotent no-op).
   * `false` when the QR code was newly mapped.
   */
  wasAlreadyMapped: boolean;
}

// ─── generateQRCodeForCase ────────────────────────────────────────────────────

/**
 * Generate a new unique QR code string for an equipment case and persist it.
 *
 * This mutation produces a system-generated QR payload in the same URL format
 * used by the client-side `generateQrCode` utility (src/lib/qr-code.ts):
 *
 *   {baseUrl}/case/{caseId}?uid={uid16}&source=generated
 *
 * Where `uid16` is the first 16 hex characters of a cryptographically random
 * UUID (64 bits of entropy — sufficient for collision avoidance at any
 * realistic fleet scale).
 *
 * The stored `qrCodeSource` field is set to `"generated"` so the dashboard
 * can distinguish system-generated labels from externally pre-printed ones.
 *
 * Idempotency:
 *   If the case already has a `qrCodeSource === "generated"` QR code AND
 *   `forceRegenerate` is `false` (the default), the mutation returns early
 *   with the existing code and no DB write — safe for accidental double-calls.
 *   Pass `forceRegenerate: true` to replace an existing generated code (e.g.,
 *   when re-printing a lost label with a new unique payload).
 *
 * Uniqueness guarantee:
 *   After generating the payload string, the mutation queries the `by_qr_code`
 *   index to confirm no other case carries the same payload (a defensive check
 *   — UUID collisions are cryptographically implausible but we guard anyway).
 *
 * Audit trail:
 *   Appends a `note_added` event with `action: "qr_code_generated"` so the
 *   T5 audit panel can show who generated the label and when.
 *
 * Real-time fidelity:
 *   Patching `cases.qrCode` triggers Convex to re-evaluate all subscribed
 *   queries for the affected case row within ~100–300 ms, satisfying the
 *   ≤ 2-second real-time requirement.
 *
 * @param caseId          Convex document ID of the target case.
 * @param userId          Kinde user ID of the operator generating the QR code.
 * @param userName        Display name of the operator (written to audit event).
 * @param baseUrl         Base URL for the QR payload (e.g. "https://scan.example.com").
 *                        Defaults to "/scan" when omitted.
 * @param forceRegenerate When `true`, replaces an existing generated QR code.
 *                        Defaults to `false` (idempotent — returns existing code).
 *
 * @returns `GenerateQRCodeResult` with the case ID, the stored QR payload string,
 *          a flag indicating whether a previous code was replaced, and the
 *          previous QR code string when `wasRegenerated` is true.
 *
 * @throws {Error} When the case is not found.
 * @throws {Error} When the generated payload collides with a different case
 *                 (astronomically unlikely; caller should retry on this error).
 *
 * Requires authentication — unauthenticated requests throw [AUTH_REQUIRED].
 *
 * Client usage:
 *   const generate = useMutation(api.qrCodes.generateQRCodeForCase);
 *   const { qrCode, wasRegenerated } = await generate({
 *     caseId:   caseDoc._id,
 *     userId:   kindeUser.id,
 *     userName: "Jane Pilot",
 *     baseUrl:  process.env.NEXT_PUBLIC_SCAN_APP_URL,
 *   });
 */
export const generateQRCodeForCase = mutation({
  args: {
    /**
     * Convex document ID of the case to generate a QR code for.
     * The case must already exist in the database.
     */
    caseId: v.id("cases"),

    /**
     * Kinde user ID of the operator triggering the generation.
     * Written to the audit event for attribution.
     */
    userId: v.string(),

    /**
     * Display name of the operator.
     * Written to the audit event so the T5 panel can show who created the label.
     */
    userName: v.string(),

    /**
     * Base URL for the QR payload — the SCAN app URL root.
     * E.g. "https://scan.skyspecs.com" or "https://scan.example.com".
     * When omitted, defaults to "/scan" (relative URL for local dev).
     *
     * The generated payload will be:
     *   {baseUrl}/case/{caseId}?uid={uid16}&source=generated
     */
    baseUrl: v.optional(v.string()),

    /**
     * When `true`, regenerates even if a system-generated QR code already
     * exists on the case.  The previous QR payload is replaced and recorded
     * in the audit event as `previousQrCode`.
     *
     * Defaults to `false` — existing generated codes are returned idempotently
     * without a DB write.
     */
    forceRegenerate: v.optional(v.boolean()),
  },

  handler: async (ctx, args): Promise<GenerateQRCodeResult> => {
    await requireAuth(ctx);

    // ── 1. Verify the target case exists (O(1) primary-key lookup) ────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `generateQRCodeForCase: Case "${args.caseId}" not found.`
      );
    }

    // ── 2. Idempotency check — return existing generated code if present ───────
    // If the case already has a system-generated QR code and the caller has
    // not requested a forced regeneration, return the existing value without
    // a DB write.  This is safe for double-calls and retries.
    if (
      caseDoc.qrCode &&
      caseDoc.qrCodeSource === "generated" &&
      !args.forceRegenerate
    ) {
      return {
        caseId:         args.caseId,
        qrCode:         caseDoc.qrCode,
        wasRegenerated: false,
      };
    }

    // ── 3. Generate a unique QR payload ───────────────────────────────────────
    // Format mirrors the client-side buildQrPayload utility (src/lib/qr-code.ts):
    //   {baseUrl}/case/{encodedCaseId}?uid={uid16}&source=generated
    //
    // `uid16` is derived from a cryptographically random UUID (Web Crypto API,
    // available in Convex mutations).  Taking the first 16 hex chars of the
    // UUID (after stripping dashes) gives 64 bits of collision resistance —
    // more than sufficient for equipment tracking at any realistic fleet size.
    //
    // The `source=generated` query param allows the SCAN app to distinguish
    // system-generated labels from external ones when parsing the payload.
    const baseUrl       = args.baseUrl ?? "/scan";
    const rawUuid       = crypto.randomUUID().replace(/-/g, ""); // 32 hex chars
    const uid           = rawUuid.slice(0, 16);                   // 16 hex chars
    const encodedCaseId = encodeURIComponent(args.caseId);
    const qrCode        = `${baseUrl}/case/${encodedCaseId}?uid=${uid}&source=generated`;

    const previousQrCode = caseDoc.qrCode || undefined;

    // ── 4. Defensive uniqueness check via by_qr_code index — O(log n) ─────────
    // A UUID collision is cryptographically implausible (~1 in 2^64), but we
    // guard server-side for defence-in-depth.  If a collision does occur, the
    // caller is instructed to retry — the next call will generate a fresh UUID.
    const conflictingCase = await ctx.db
      .query("cases")
      .withIndex("by_qr_code", (q) => q.eq("qrCode", qrCode))
      .first();

    if (conflictingCase !== null && conflictingCase._id !== args.caseId) {
      throw new Error(
        `generateQRCodeForCase: Generated QR payload collided with case ` +
        `"${conflictingCase.label}" (ID: ${conflictingCase._id}). ` +
        `This is astronomically unlikely — please retry and a new unique ` +
        `code will be generated.`
      );
    }

    // ── 5. Persist the QR code and source ────────────────────────────────────
    // Write qrCode, qrCodeSource, and refresh updatedAt so the M1 by_updated
    // index reflects this change as recent activity on the case.
    const now = Date.now();
    await ctx.db.patch(args.caseId, {
      qrCode,
      qrCodeSource: "generated",
      updatedAt:    now,
    });

    // ── 6. Immutable audit event ──────────────────────────────────────────────
    // Use "note_added" as the event type (administrative metadata change).
    // The payload records `action: "qr_code_generated"` so the T5 audit panel
    // can render it distinctly from free-text notes.
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "note_added",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        action:          "qr_code_generated",
        qrCode,
        caseLabel:       caseDoc.label,
        wasRegenerated:  previousQrCode !== undefined,
        previousQrCode,
      },
    });

    return {
      caseId:          args.caseId,
      qrCode,
      wasRegenerated:  previousQrCode !== undefined,
      previousQrCode,
    };
  },
});

// ─── associateQRCodeToCase ────────────────────────────────────────────────────

/**
 * Associate a QR code string with an equipment case.
 *
 * Workflow:
 *   1. Reject blank `qrCode` strings immediately (client-side validation
 *      should catch this, but we guard server-side for defence-in-depth).
 *   2. Verify the target case exists (O(1) primary-key lookup).
 *   3. Return early with `wasAlreadyMapped: true` if the QR code is already
 *      written on this exact case — idempotent caller safety.
 *   4. Use the `by_qr_code` index to check whether any *other* case already
 *      carries this QR payload.  Throw a descriptive error if so.
 *   5. Patch `cases.qrCode` and `cases.updatedAt` atomically.
 *   6. Append an immutable audit event to the `events` table.
 *
 * Error conditions
 * ────────────────
 *   • `qrCode` is empty or whitespace-only.
 *   • The case identified by `caseId` does not exist.
 *   • The QR code is already mapped to a *different* case.
 *
 * @param qrCode   QR payload string to associate (non-empty).
 * @param caseId   Convex document ID of the target case.
 * @param userId   Kinde user ID of the operator performing the association.
 * @param userName Display name of the operator (written to the audit event).
 *
 * @returns `AssociateQRCodeResult` — includes the case ID, the stored QR
 *          code string, and a flag indicating whether it was already mapped.
 *
 * @throws {Error} When `qrCode` is blank.
 * @throws {Error} When the case is not found.
 * @throws {Error} When the QR code is already mapped to a different case.
 */
export const associateQRCodeToCase = mutation({
  args: {
    /**
     * The QR payload string to associate with the case.
     * Must be a non-empty string.  In practice this is the URL that the SCAN
     * app camera decodes from the printed case label.
     */
    qrCode: v.string(),

    /**
     * Convex document ID of the case to associate the QR code with.
     * The case must already exist in the database.
     */
    caseId: v.id("cases"),

    /**
     * Kinde user ID of the operator making the association.
     * Written to the audit event for attribution.
     */
    userId: v.string(),

    /**
     * Display name of the operator.
     * Written to the audit event so the T5 audit panel can show who created
     * the QR association without a separate user lookup.
     */
    userName: v.string(),
  },

  handler: async (ctx, args): Promise<AssociateQRCodeResult> => {
    await requireAuth(ctx);
    // ── 1. Validate qrCode is non-empty ───────────────────────────────────────
    const qrCode = args.qrCode.trim();
    if (qrCode.length === 0) {
      throw new Error(
        "associateQRCodeToCase: qrCode must be a non-empty string."
      );
    }

    // ── 2. Verify the target case exists (O(1) primary-key lookup) ────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `associateQRCodeToCase: Case "${args.caseId}" not found.`
      );
    }

    // ── 3. Idempotent check — QR already on this exact case ───────────────────
    // Return early without a DB write so callers can safely retry after a
    // transient error without risk of a spurious "already mapped" rejection.
    if (caseDoc.qrCode === qrCode) {
      return {
        caseId:          args.caseId,
        qrCode,
        wasAlreadyMapped: true,
      };
    }

    // ── 4. Uniqueness check via by_qr_code index — O(log n) ──────────────────
    // A QR code may only be associated with one case at a time.  The by_qr_code
    // index lets us verify uniqueness without a full table scan.
    const conflictingCase = await ctx.db
      .query("cases")
      .withIndex("by_qr_code", (q) => q.eq("qrCode", qrCode))
      .first();

    if (conflictingCase !== null) {
      throw new Error(
        `associateQRCodeToCase: QR code is already mapped to case ` +
        `"${conflictingCase.label}" (ID: ${conflictingCase._id}). ` +
        `Each QR code may only be associated with one case.`
      );
    }

    // ── 5. Persist the QR code mapping ────────────────────────────────────────
    // Write qrCode, qrCodeSource ("external" for physical labels), and refresh
    // updatedAt so the M1 by_updated index reflects this change as recent
    // activity on the case.
    const now = Date.now();
    await ctx.db.patch(args.caseId, {
      qrCode,
      qrCodeSource: "external",
      updatedAt:    now,
    });

    // ── 6. Immutable audit event ──────────────────────────────────────────────
    // Use "note_added" as the event type (the closest semantic fit for an
    // administrative label/metadata change).  The payload records the action
    // name so the T5 audit panel can render it distinctly.
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "note_added",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        action:    "qr_code_associated",
        qrCode,
        caseLabel: caseDoc.label,
      },
    });

    return {
      caseId:          args.caseId,
      qrCode,
      wasAlreadyMapped: false,
    };
  },
});
