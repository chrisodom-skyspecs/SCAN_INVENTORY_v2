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
import {
  detectQrCodeConflict,
  formatQrCodeConflictMessage,
  type QrCodeCaseRow,
  type QrCodeConflictDeps,
} from "./qrCodeHelpers";
import {
  REASSIGNMENT_REASON_CODES,
  REASSIGNMENT_REASON_LABELS,
  buildSourceUnassignmentEventData,
  buildTargetReassignmentEventData,
  evaluateReassignment,
  type ReassignmentCorrelation,
  type ReassignmentDeps,
  type ReassignmentReasonCode,
} from "./qrReassignmentHelpers";
import {
  buildCreateAuditRecord,
  buildReassignSourceAuditRecord,
  buildReassignTargetAuditRecord,
} from "./qrAssociationAuditHelpers";
import { toQrAssociationEventInsert } from "./qrAssociationEventInsert";
import {
  OPERATIONS,
  assertKindeIdProvided,
  assertPermission,
} from "./rbac";

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

    // Delegate the conflict check to the centralized pure helper so every
    // QR-code write path applies the same uniqueness rule.  The helper uses
    // the `by_qr_code` index for an O(log n) point read.
    const deps: QrCodeConflictDeps = {
      findCaseByQrCode: async (qr) => {
        const row = await ctx.db
          .query("cases")
          .withIndex("by_qr_code", (q) => q.eq("qrCode", qr))
          .first();
        return row === null
          ? null
          : ({ _id: row._id, label: row.label, qrCode: row.qrCode } as QrCodeCaseRow);
      },
    };

    const outcome = await detectQrCodeConflict(args.qrCode, args.caseId, deps);

    switch (outcome.kind) {
      case "invalid":
        return { status: "invalid", reason: outcome.reason };
      case "available":
        return { status: "available" };
      case "mapped_to_this_case":
        return { status: "mapped_to_this_case" };
      case "conflict":
        return {
          status:               "mapped_to_other_case",
          conflictingCaseLabel: outcome.conflictingCaseLabel,
          conflictingCaseId:    outcome.conflictingCaseId,
        };
    }
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

    // ── 4. Defensive uniqueness check via centralized helper — O(log n) ──────
    // A UUID collision is cryptographically implausible (~1 in 2^64), but we
    // guard server-side for defence-in-depth.  Routing through the shared
    // `detectQrCodeConflict` helper keeps every QR write path on the same
    // uniqueness rule.
    const deps: QrCodeConflictDeps = {
      findCaseByQrCode: async (qr) => {
        const row = await ctx.db
          .query("cases")
          .withIndex("by_qr_code", (q) => q.eq("qrCode", qr))
          .first();
        return row === null
          ? null
          : ({ _id: row._id, label: row.label, qrCode: row.qrCode } as QrCodeCaseRow);
      },
    };

    const collisionOutcome = await detectQrCodeConflict(qrCode, args.caseId, deps);

    if (collisionOutcome.kind === "conflict") {
      throw new Error(
        `generateQRCodeForCase: Generated QR payload collided with case ` +
        `"${collisionOutcome.conflictingCaseLabel}" (ID: ${collisionOutcome.conflictingCaseId}). ` +
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
    //
    // We also append a parallel row to the dedicated `qr_association_events`
    // table (introduced by AC 240303 sub-AC 3) so compliance queries can
    // filter QR actions without parsing polymorphic event blobs.
    const auditRecord = buildCreateAuditRecord({
      caseId:               String(args.caseId),
      qrCode,
      qrCodeSource:         "generated",
      reasonCode:           previousQrCode !== undefined ? "label_replacement" : "initial_association",
      previousQrCode:       previousQrCode ?? null,
      previousQrCodeSource: caseDoc.qrCodeSource ?? null,
      actorId:              args.userId,
      actorName:            args.userName,
      timestamp:            now,
    });

    // The pure-helper record carries `caseId` and `counterpartCaseId` as
    // plain strings (the helper is Convex-runtime-free).  Convert to the
    // schema-typed shape via `toQrAssociationEventInsert` so the
    // `Id<"cases">` cast happens in one place.  The generate-create flow
    // has no counterpart case.
    const qrAssociationEventId = await ctx.db.insert(
      "qr_association_events",
      toQrAssociationEventInsert(auditRecord, args.caseId),
    );

    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "note_added",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        action:                "qr_code_generated",
        qrCode,
        caseLabel:             caseDoc.label,
        wasRegenerated:        previousQrCode !== undefined,
        previousQrCode,
        qrAssociationEventId:  String(qrAssociationEventId),
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

    // ── 3. Centralized duplicate-QR detection ─────────────────────────────────
    // Delegates to the pure helper so the uniqueness invariant is enforced
    // consistently across every mutation that writes `cases.qrCode`.  The
    // helper's `by_qr_code` lookup is O(log n).
    const deps: QrCodeConflictDeps = {
      findCaseByQrCode: async (qr) => {
        const row = await ctx.db
          .query("cases")
          .withIndex("by_qr_code", (q) => q.eq("qrCode", qr))
          .first();
        return row === null
          ? null
          : ({ _id: row._id, label: row.label, qrCode: row.qrCode } as QrCodeCaseRow);
      },
    };

    const outcome = await detectQrCodeConflict(qrCode, args.caseId, deps);

    if (outcome.kind === "invalid") {
      // Defence-in-depth — the empty check above should already have caught this.
      throw new Error(
        "associateQRCodeToCase: qrCode must be a non-empty string."
      );
    }

    if (outcome.kind === "conflict") {
      throw new Error(formatQrCodeConflictMessage("associateQRCodeToCase", outcome));
    }

    if (outcome.kind === "mapped_to_this_case") {
      // Idempotent no-op — return early without a DB write so callers can
      // safely retry after a transient error.
      return {
        caseId:           args.caseId,
        qrCode,
        wasAlreadyMapped: true,
      };
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
    //
    // We also append a parallel row to the dedicated `qr_association_events`
    // table (introduced by AC 240303 sub-AC 3) so compliance queries can
    // filter QR actions without parsing polymorphic event blobs.
    const previousAssocQrCode = caseDoc.qrCode?.trim();
    const auditRecord = buildCreateAuditRecord({
      caseId:               String(args.caseId),
      qrCode,
      qrCodeSource:         "external",
      reasonCode:           previousAssocQrCode && previousAssocQrCode.length > 0
                              ? "label_replacement"
                              : "initial_association",
      previousQrCode:       previousAssocQrCode && previousAssocQrCode.length > 0
                              ? previousAssocQrCode
                              : null,
      previousQrCodeSource: caseDoc.qrCodeSource ?? null,
      actorId:              args.userId,
      actorName:            args.userName,
      timestamp:            now,
    });

    const qrAssociationEventId = await ctx.db.insert(
      "qr_association_events",
      toQrAssociationEventInsert(auditRecord, args.caseId),
    );

    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "note_added",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        action:                "qr_code_associated",
        qrCode,
        caseLabel:             caseDoc.label,
        qrAssociationEventId:  String(qrAssociationEventId),
      },
    });

    return {
      caseId:          args.caseId,
      qrCode,
      wasAlreadyMapped: false,
    };
  },
});

// ─── reassignQrCodeToCase ─────────────────────────────────────────────────────

/**
 * Argument validator for the reassignment reason code.
 *
 * Mirrors `REASSIGNMENT_REASON_CODES` from `qrReassignmentHelpers.ts` so the
 * Convex value validator and the TypeScript type stay in lockstep.  Adding a
 * new reason code requires editing BOTH locations (the helpers list and this
 * `v.union` literal set).  Tests assert the parity.
 */
const reassignmentReasonCodeValidator = v.union(
  v.literal("label_replacement"),
  v.literal("data_entry_error"),
  v.literal("case_swap"),
  v.literal("case_retired"),
  v.literal("label_misprint"),
  v.literal("other"),
);

/**
 * Result returned by `reassignQrCodeToCase`.
 *
 * Surfaces the full before/after view so the T5 audit panel can render a
 * "QR moved from CASE-A to CASE-B" diff without an additional query, and so
 * the SCAN app can show a confirmation toast naming both cases.
 */
export interface ReassignQrCodeResult {
  /** Convex document ID (as string) of the SOURCE case (lost the QR). */
  sourceCaseId:   string;
  /** Display label of the source case at the time of reassignment. */
  sourceCaseLabel:string;
  /** Convex document ID (as string) of the TARGET case (gained the QR). */
  targetCaseId:   string;
  /** Display label of the target case at the time of reassignment. */
  targetCaseLabel:string;
  /** The QR payload that was moved — same value on both sides. */
  qrCode:         string;
  /**
   * Source classification of the QR payload at move time.  Preserved on the
   * target case so the visible label kind ("generated" vs "external") is not
   * silently changed by the move.
   */
  qrCodeSource:   "generated" | "external";
  /**
   * The QR payload that was previously on the target case (if any).  Cleared
   * to `null` when the target case did not have a QR before the move.  The
   * target case's prior QR — if non-empty — becomes orphaned by this
   * mutation; the caller should reassign it elsewhere or generate a new code.
   */
  previousTargetQrCode:       string | null;
  /** Source classification of the target's previous QR code, when present. */
  previousTargetQrCodeSource: "generated" | "external" | null;
  /** Reason code recorded in the audit events on both cases. */
  reasonCode:     ReassignmentReasonCode;
  /** Free-text reason notes (always present for `reasonCode === "other"`). */
  reasonNotes:    string | null;
  /**
   * Correlation ID written to BOTH audit events linking the source-side
   * `qr_code_unassigned` event to the target-side `qr_code_reassigned` event.
   * Audit consumers can rejoin the two halves of the move with this ID.
   */
  correlationId:  string;
  /** Epoch ms timestamp shared by both audit events. */
  timestamp:      number;
}

/**
 * Move a QR payload from one case to another — a higher-trust operation than
 * the initial `associateQRCodeToCase` flow.
 *
 * Why a dedicated mutation?
 * ─────────────────────────
 * The initial-association path (`associateQRCodeToCase`) rejects any payload
 * already mapped to a different case in order to protect the by_qr_code
 * uniqueness invariant.  Reassignment INTENTIONALLY violates that invariant
 * for one mutation — moving the QR off case A and onto case B in a single
 * atomic patch — so it requires:
 *
 *   1. A higher permission check (admin / technician only).
 *   2. A required reason code (one of `REASSIGNMENT_REASON_CODES`).
 *   3. Mandatory `reasonNotes` when `reasonCode === "other"`.
 *   4. A two-case patch that clears the source case's QR and writes the new
 *      QR onto the target case in a single Convex mutation transaction.
 *   5. TWO immutable audit events linked by a shared `correlationId`:
 *        • `qr_code_unassigned` on the source case.
 *        • `qr_code_reassigned` on the target case.
 *
 * Behaviour
 * ─────────
 *   • The QR payload MUST currently be associated with some case.  When the
 *     payload is unmapped, the mutation throws a `[QR_NOT_ASSIGNED]` error
 *     prompting the caller to use `associateQRCodeToCase` instead.
 *
 *   • The caller MAY reassign onto a target case that already has its OWN
 *     different QR code; the target's prior QR payload is overwritten and
 *     surfaced in the result for follow-up handling (the operations team
 *     typically prints a fresh label for the displaced case).  The target's
 *     prior QR is recorded in the target-side audit event for traceability.
 *
 *   • Reassigning a QR onto the case that already holds it is a logical
 *     error and rejected with `[SAME_CASE]` — the caller should choose a
 *     different target.
 *
 *   • The source case's `qrCode` is cleared to the empty string (the schema
 *     sentinel for "no QR code", consistent with how `generateQrCode`
 *     detects a missing label).  `qrCodeSource` is removed.  Both cases
 *     have `updatedAt` refreshed so the M1 by_updated index reflects the
 *     activity on each row.
 *
 *   • The QR's `qrCodeSource` is preserved across the move — a label
 *     originally classified as "external" stays "external" on the target
 *     case unless the operator reissues a new code afterward.
 *
 * Permissions
 * ───────────
 * Requires the caller to hold `OPERATIONS.QR_CODE_REASSIGN`.  Today this is
 * granted to `admin` and `technician`; `pilot` does NOT have this permission
 * even though they may scan and read QR labels in the SCAN app.
 *
 * Audit chain
 * ───────────
 * Both events use `eventType: "note_added"` (administrative metadata) with
 * a typed `data.action` discriminator (`"qr_code_unassigned"` /
 * `"qr_code_reassigned"`).  The shared `correlationId` lets T5 audit
 * panels join the two halves and render them as one move.
 *
 * @param qrCode        The QR payload being moved.  Must be currently
 *                      associated with some case.
 * @param targetCaseId  Destination case ID.  Must exist and must NOT be the
 *                      same as the source case.
 * @param reasonCode    One of `REASSIGNMENT_REASON_CODES`.  Drives the
 *                      audit-trail filter and dashboard reporting.
 * @param reasonNotes   Optional free-text justification.  REQUIRED when
 *                      `reasonCode === "other"`.
 * @param userId        Kinde user ID of the operator performing the move
 *                      (used for permission check and audit attribution).
 * @param userName      Display name of the operator (audit attribution).
 *
 * @returns `ReassignQrCodeResult` — full before/after view of the move
 *          including the shared correlation ID for downstream queries.
 *
 * @throws Error("[AUTH_REQUIRED]…")          when the caller is not
 *         authenticated.
 * @throws Error("[ACCESS_DENIED]…")          when the user lacks the
 *         `QR_CODE_REASSIGN` operation.
 * @throws Error("[INVALID_REASON]…")         when `reasonCode` is missing
 *         or unrecognised.
 * @throws Error("[REASON_NOTES_REQUIRED]…")  when `reasonCode === "other"`
 *         but `reasonNotes` is empty.
 * @throws Error("[INVALID_QR]…")             when `qrCode` is empty.
 * @throws Error("[INVALID_TARGET]…")         when `targetCaseId` is empty
 *         or refers to a non-existent case.
 * @throws Error("[QR_NOT_ASSIGNED]…")        when the QR is not currently
 *         on any case (use `associateQRCodeToCase` instead).
 * @throws Error("[SAME_CASE]…")              when source and target are the
 *         same case.
 */
export const reassignQrCodeToCase = mutation({
  args: {
    /** The QR payload to move.  Trimmed; rejected when empty. */
    qrCode:       v.string(),
    /** Destination case ID.  Must exist and must differ from the source. */
    targetCaseId: v.id("cases"),
    /** Reason code.  Must be one of `REASSIGNMENT_REASON_CODES`. */
    reasonCode:   reassignmentReasonCodeValidator,
    /** Free-text justification.  Required when `reasonCode === "other"`. */
    reasonNotes:  v.optional(v.string()),
    /** Kinde user ID — used for permission and audit attribution. */
    userId:       v.string(),
    /** Display name of the operator (audit attribution). */
    userName:     v.string(),
  },

  handler: async (ctx, args): Promise<ReassignQrCodeResult> => {
    // ── 1. Authentication + authorization ───────────────────────────────────
    await requireAuth(ctx);
    assertKindeIdProvided(args.userId);
    await assertPermission(ctx.db, args.userId, OPERATIONS.QR_CODE_REASSIGN);

    // ── 2. Pure rule evaluation (reason code, payload, target existence) ────
    // Wrap the Convex DB calls in the helper deps so the same evaluator code
    // is exercised by unit tests (in-memory map) and by production (indexed
    // DB reads).
    // Type the dependency callbacks so Convex's strict `Id<"cases">`
    // requirement is satisfied without spreading `as` casts through the
    // pure helper API.  The helper accepts opaque string identifiers; the
    // wrapper here narrows them to the proper Convex Id type at the
    // boundary.
    type CaseId = typeof args.targetCaseId;

    const deps: ReassignmentDeps = {
      findCaseById: async (id) => {
        const row = await ctx.db.get(id as unknown as CaseId);
        if (!row) return null;
        return {
          _id:    String(row._id),
          label:  row.label,
          qrCode: row.qrCode,
        } as QrCodeCaseRow;
      },
      findCaseByQrCode: async (qr) => {
        const row = await ctx.db
          .query("cases")
          .withIndex("by_qr_code", (q) => q.eq("qrCode", qr))
          .first();
        return row === null
          ? null
          : ({
              _id:    String(row._id),
              label:  row.label,
              qrCode: row.qrCode,
            } as QrCodeCaseRow);
      },
    };

    const evaluation = await evaluateReassignment(
      {
        qrCode:       args.qrCode,
        targetCaseId: args.targetCaseId as unknown as string,
        reasonCode:   args.reasonCode,
        reasonNotes:  args.reasonNotes,
      },
      deps,
    );

    switch (evaluation.kind) {
      case "invalid_reason":
        throw new Error(`[INVALID_REASON] ${evaluation.reason}`);
      case "reason_notes_required":
        throw new Error(`[REASON_NOTES_REQUIRED] ${evaluation.reason}`);
      case "invalid_qr":
        throw new Error(`[INVALID_QR] ${evaluation.reason}`);
      case "invalid_target":
        throw new Error(`[INVALID_TARGET] ${evaluation.reason}`);
      case "not_currently_assigned":
        throw new Error(`[QR_NOT_ASSIGNED] ${evaluation.reason}`);
      case "same_case":
        throw new Error(`[SAME_CASE] ${evaluation.reason}`);
      case "ok":
        // fall through
        break;
    }

    // ── 3. Re-fetch the source and target case docs in full ─────────────────
    // The pure helper returns a minimal projection (id, label, qrCode); we
    // need the full docs to read qrCodeSource and to capture the target's
    // pre-existing QR for the audit event.  Re-querying the source case via
    // the by_qr_code index returns a properly typed Doc<"cases"> without any
    // string-to-Id coercion gymnastics.
    const sourceDoc = await ctx.db
      .query("cases")
      .withIndex("by_qr_code", (q) => q.eq("qrCode", evaluation.normalizedQrCode))
      .first();

    if (!sourceDoc) {
      throw new Error(
        `[QR_NOT_ASSIGNED] Source case for QR "${evaluation.normalizedQrCode}" ` +
        `disappeared between evaluation and patch.`,
      );
    }

    const targetDoc = await ctx.db.get(args.targetCaseId);
    if (!targetDoc) {
      throw new Error(
        `[INVALID_TARGET] Target case "${args.targetCaseId}" ` +
        `disappeared between evaluation and patch.`,
      );
    }

    // Defence-in-depth: race-condition guard.  Between the helper evaluation
    // and this re-query, another concurrent reassignment could have moved
    // the QR.  Reject if the source case identity changed.  Convex Ids
    // serialise to strings, so a string-equality comparison is safe.
    if (String(sourceDoc._id) !== evaluation.sourceCaseId) {
      throw new Error(
        `[QR_NOT_ASSIGNED] QR code was moved by a concurrent operation ` +
        `between evaluation and patch.  Please retry.`,
      );
    }

    // Source/target identity check repeated against the re-queried docs to
    // catch the same race-condition window.
    if (sourceDoc._id === args.targetCaseId) {
      throw new Error(
        `[SAME_CASE] QR code is already mapped to case "${sourceDoc.label}". ` +
        `Choose a different target case.`,
      );
    }

    // The QR being moved is the source's qrCode (they must match the
    // normalised payload — defensive check).
    const movedQrCode      = evaluation.normalizedQrCode;
    const movedQrCodeSource: "generated" | "external" =
      sourceDoc.qrCodeSource ?? "external";

    // Capture the target's prior QR for the audit event and result payload.
    const previousTargetQrCode: string | null =
      targetDoc.qrCode && targetDoc.qrCode.trim().length > 0
        ? targetDoc.qrCode
        : null;
    const previousTargetQrCodeSource: "generated" | "external" | null =
      targetDoc.qrCodeSource ?? null;

    // ── 4. Atomic two-case patch + matched audit events ─────────────────────
    const correlation: ReassignmentCorrelation = {
      correlationId: crypto.randomUUID(),
      timestamp:     Date.now(),
    };

    // Clear the source case's QR (empty string is the schema sentinel for
    // "no QR code" — consistent with the existing `caseDoc.qrCode &&
    // caseDoc.qrCode.trim().length > 0` checks elsewhere in this module
    // and in convex/cases.ts).
    await ctx.db.patch(sourceDoc._id, {
      qrCode:       "",
      qrCodeSource: undefined,
      updatedAt:    correlation.timestamp,
    });

    // Write the moved QR onto the target case, preserving its source
    // classification.
    await ctx.db.patch(args.targetCaseId, {
      qrCode:       movedQrCode,
      qrCodeSource: movedQrCodeSource,
      updatedAt:    correlation.timestamp,
    });

    // ── Dedicated `qr_association_events` audit rows (sub-AC 3) ──────────────
    // Append BOTH halves of the move to the dedicated audit table linked by
    // a shared correlationId so compliance queries can filter QR actions
    // without parsing polymorphic event blobs.  These rows live alongside
    // the parallel `events` rows below so the T5 timeline continues to
    // render the move on each case's timeline.
    const sourceAuditRecord = buildReassignSourceAuditRecord({
      sourceCaseId:    String(sourceDoc._id),
      qrCode:          movedQrCode,
      qrCodeSource:    movedQrCodeSource,
      reasonCode:      args.reasonCode,
      reasonNotes:     args.reasonNotes,
      targetCaseId:    String(args.targetCaseId),
      targetCaseLabel: targetDoc.label,
      correlationId:   correlation.correlationId,
      actorId:         args.userId,
      actorName:       args.userName,
      timestamp:       correlation.timestamp,
    });
    const sourceAuditEventId = await ctx.db.insert(
      "qr_association_events",
      toQrAssociationEventInsert(
        sourceAuditRecord,
        sourceDoc._id,
        args.targetCaseId,
      ),
    );

    const targetAuditRecord = buildReassignTargetAuditRecord({
      targetCaseId:         String(args.targetCaseId),
      qrCode:               movedQrCode,
      qrCodeSource:         movedQrCodeSource,
      reasonCode:           args.reasonCode,
      reasonNotes:          args.reasonNotes,
      sourceCaseId:         String(sourceDoc._id),
      sourceCaseLabel:      sourceDoc.label,
      previousQrCode:       previousTargetQrCode,
      previousQrCodeSource: previousTargetQrCodeSource,
      correlationId:        correlation.correlationId,
      actorId:              args.userId,
      actorName:            args.userName,
      timestamp:            correlation.timestamp,
    });
    const targetAuditEventId = await ctx.db.insert(
      "qr_association_events",
      toQrAssociationEventInsert(
        targetAuditRecord,
        args.targetCaseId,
        sourceDoc._id,
      ),
    );

    // Source-side audit event — "qr_code_unassigned"
    await ctx.db.insert("events", {
      caseId:    sourceDoc._id,
      eventType: "note_added",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: correlation.timestamp,
      data: {
        ...buildSourceUnassignmentEventData({
          qrCode:           movedQrCode,
          qrCodeSource:     movedQrCodeSource,
          reasonCode:       args.reasonCode,
          reasonNotes:      args.reasonNotes,
          targetCaseId:     String(args.targetCaseId),
          targetCaseLabel:  targetDoc.label,
          correlation,
        }),
        qrAssociationEventId: String(sourceAuditEventId),
      },
    });

    // Target-side audit event — "qr_code_reassigned"
    await ctx.db.insert("events", {
      caseId:    args.targetCaseId,
      eventType: "note_added",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: correlation.timestamp,
      data: {
        ...buildTargetReassignmentEventData({
          qrCode:               movedQrCode,
          qrCodeSource:         movedQrCodeSource,
          reasonCode:           args.reasonCode,
          reasonNotes:          args.reasonNotes,
          sourceCaseId:         String(sourceDoc._id),
          sourceCaseLabel:      sourceDoc.label,
          previousQrCode:       previousTargetQrCode,
          previousQrCodeSource: previousTargetQrCodeSource,
          correlation,
        }),
        qrAssociationEventId: String(targetAuditEventId),
      },
    });

    // ── 5. Return the full before/after summary ─────────────────────────────
    return {
      sourceCaseId:               String(sourceDoc._id),
      sourceCaseLabel:            sourceDoc.label,
      targetCaseId:               String(args.targetCaseId),
      targetCaseLabel:            targetDoc.label,
      qrCode:                     movedQrCode,
      qrCodeSource:               movedQrCodeSource,
      previousTargetQrCode,
      previousTargetQrCodeSource,
      reasonCode:                 args.reasonCode,
      reasonNotes:                args.reasonNotes?.trim() || null,
      correlationId:              correlation.correlationId,
      timestamp:                  correlation.timestamp,
    };
  },
});

// ─── Re-exports for client integrations ──────────────────────────────────────

/**
 * Re-export the reason code constants and helper types so client-side
 * components (SCAN app dropdowns, INVENTORY admin UIs) can import them
 * directly from the same module that hosts the mutation:
 *
 *   import {
 *     REASSIGNMENT_REASON_CODES,
 *     REASSIGNMENT_REASON_LABELS,
 *     type ReassignmentReasonCode,
 *   } from "convex/qrCodes";
 *
 * This keeps the public surface coherent — every QR-related mutation, type,
 * and reason metadata is reachable from `convex/qrCodes`.
 */
export {
  REASSIGNMENT_REASON_CODES,
  REASSIGNMENT_REASON_LABELS,
  type ReassignmentReasonCode,
};
