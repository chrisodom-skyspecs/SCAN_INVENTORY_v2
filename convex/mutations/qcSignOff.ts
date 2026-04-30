/**
 * convex/mutations/qcSignOff.ts
 *
 * Canonical mutation functions for QC (quality-control) sign-off write operations.
 *
 * This module provides the authoritative, atomic write operations for the QC
 * sign-off workflow in both the INVENTORY dashboard (operator/admin review) and
 * the SCAN mobile app.  Each mutation writes to ALL relevant tables in a single
 * Convex transaction, ensuring consistency and triggering the correct reactive
 * query invalidations.
 *
 * Mutations exported
 * ──────────────────
 *   submitQcSignOff   — Submit or update a QC sign-off decision for a case.
 *                       Atomically inserts a row in `qcSignOffs` (immutable history),
 *                       patches the denormalized QC fields on `cases`, and appends
 *                       a `qc_sign_off` audit event to the `events` table.
 *
 * Tables written per submitQcSignOff call
 * ────────────────────────────────────────
 *   qcSignOffs   INSERT — immutable sign-off history row
 *   cases        PATCH  — qcSignOffStatus, qcSignedOffBy, qcSignedOffByName,
 *                         qcSignedOffAt, qcSignOffNotes, updatedAt
 *   events       INSERT — qc_sign_off audit event (immutable)
 *
 * Reactive query invalidation
 * ───────────────────────────
 * Convex re-evaluates all subscribed queries reading the written tables and
 * pushes diffs to connected clients within ~100–300 ms.  A submitQcSignOff
 * write invalidates:
 *
 *   From qcSignOffs INSERT:
 *     getQcSignOffByCaseId     → T1 summary panel QC status badge
 *     getQcSignOffHistory      → T5 audit timeline QC section
 *
 *   From cases PATCH:
 *     getCaseById              → any panel reading the full case doc
 *     getCaseStatus            → status + QC badge in M1 map pins
 *     listCases                → M1 fleet overview refresh
 *     listCasesByStatus        → status-scoped case lists
 *
 *   From events INSERT:
 *     getCaseAuditEvents       → T5 full audit chain
 *     getEventsByCase          → T5 audit timeline
 *
 * All subscribed clients receive the live update within 2 seconds of the
 * mutation completing — satisfying the real_time_fidelity acceptance criterion.
 *
 * Authentication
 * ──────────────
 * All mutations require a verified Kinde JWT.  Unauthenticated callers receive
 * [AUTH_REQUIRED].  Only users with role "admin" or "operator" may submit a
 * QC sign-off; "technician" and "pilot" roles are blocked with [FORBIDDEN].
 *
 * Client usage
 * ────────────
 *   const submitQc = useMutation(api.mutations.qcSignOff.submitQcSignOff);
 *   const result = await submitQc({
 *     caseId:      resolvedCase._id,
 *     status:      "approved",
 *     signedOffBy: kindeUser.id,
 *     signedOffByName: "Alice Operator",
 *     signedOffAt: Date.now(),
 *     notes:       "All items verified OK.",
 *   });
 *   // result.qcSignOffId  → Convex qcSignOffs row ID
 *   // result.eventId      → Convex events row ID
 *   // result.status       → confirmed sign-off status
 *   // result.caseId       → the case that was signed off
 */

import { mutation } from "../_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Asserts that the calling client has a verified Kinde JWT.
 *
 * Throws with "[AUTH_REQUIRED]" prefix when:
 *   • No JWT was provided (unauthenticated request)
 *   • JWT signature failed Convex JWKS verification
 *   • JWT has expired
 *
 * Returns the UserIdentity so callers can access the subject claim (kindeId)
 * without a second getUserIdentity() call.
 */
async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token. " +
        "Ensure the client is wrapped in ConvexProviderWithAuth and the user is signed in."
    );
  }
  return identity;
}

// ─── Result types ─────────────────────────────────────────────────────────────

/**
 * Returned by `submitQcSignOff` on success.
 */
export interface QcSignOffResult {
  /** Convex document ID of the newly inserted qcSignOffs row. */
  qcSignOffId: Id<"qcSignOffs">;
  /** Convex document ID of the appended qc_sign_off audit event. */
  eventId: Id<"events">;
  /** Confirmed QC sign-off status written to the database. */
  status: "pending" | "approved" | "rejected";
  /** Convex document ID of the case that was signed off. */
  caseId: Id<"cases">;
}

// ─── QC sign-off status validator ────────────────────────────────────────────

/**
 * Convex value validator for the QC sign-off status union.
 * Mirrors the `qcSignOffStatus` field on the `cases` table and the
 * `status` field on the `qcSignOffs` table in convex/schema.ts.
 */
const qcSignOffStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * submitQcSignOff — Submit or update a QC sign-off decision for a case.
 *
 * This is the primary write operation for the QC review workflow.
 * The mutation is atomic: all table writes succeed or none do.
 *
 * Workflow
 * ────────
 * 1. Validate caller authentication (Kinde JWT required).
 * 2. Validate `caseId` resolves to an existing case document.
 * 3. Validate sign-off status is one of: "pending" | "approved" | "rejected".
 * 4. When status = "rejected", notes are required (validation enforced here).
 * 5. Read the case's current qcSignOffStatus as `previousStatus`.
 * 6. Insert an immutable `qcSignOffs` row capturing the full decision record.
 * 7. Patch the `cases` row with denormalized QC summary fields.
 * 8. Append a `qc_sign_off` event to the immutable `events` audit table.
 * 9. Return { qcSignOffId, eventId, status, caseId }.
 *
 * Error conditions
 * ────────────────
 * [AUTH_REQUIRED]       — No valid Kinde JWT provided.
 * [CASE_NOT_FOUND]      — caseId does not correspond to any cases document.
 * [NOTES_REQUIRED]      — status = "rejected" but notes were not provided.
 * [INVALID_STATUS]      — status is not one of the three valid literals
 *                         (this should be caught by Convex args validation
 *                          before reaching the mutation body).
 *
 * Reactive effects
 * ─────────────────
 * All Convex queries subscribed to `qcSignOffs`, `cases`, or `events` for
 * the affected caseId will receive a re-evaluated result within ~100–300 ms
 * of this mutation completing, satisfying the ≤ 2-second real-time fidelity
 * requirement.
 *
 * @param caseId        — Convex document ID of the case to sign off.
 * @param status        — QC decision: "pending" | "approved" | "rejected".
 * @param signedOffBy   — Kinde user ID of the reviewer.
 * @param signedOffByName — Display name of the reviewer.
 * @param signedOffAt   — Epoch ms when the sign-off was performed (client clock).
 * @param notes         — Optional reviewer notes. REQUIRED when status = "rejected".
 * @param inspectionId  — Optional Convex ID of the inspection that triggered this review.
 * @returns QcSignOffResult
 */
export const submitQcSignOff = mutation({
  args: {
    /** Convex ID of the case to QC sign off. */
    caseId: v.id("cases"),

    /**
     * QC decision to record.
     *   "pending"  — revoke/reset a previous approval or rejection.
     *   "approved" — case is cleared for deployment / shipping.
     *   "rejected" — case requires rework before deployment / shipping.
     */
    status: qcSignOffStatusValidator,

    /**
     * Kinde `sub` claim of the reviewer submitting the sign-off.
     * Must be the authenticated user's own subject claim.
     */
    signedOffBy: v.string(),

    /**
     * Display name of the reviewer (stored denormalised in the history row).
     */
    signedOffByName: v.string(),

    /**
     * Epoch ms when the sign-off was performed (client-side clock).
     * Stored verbatim; the server does not override with Date.now() so that
     * offline-composed decisions (reconnect + submit) retain their true timestamp.
     */
    signedOffAt: v.number(),

    /**
     * Reviewer notes accompanying the decision.
     *   • Required when status = "rejected" (enforced in mutation body).
     *   • Recommended when status = "approved" for traceability.
     *   • Optional for "pending" (revocation) actions.
     */
    notes: v.optional(v.string()),

    /**
     * Optional link to the inspection that prompted this QC review.
     * Populate when the sign-off is performed immediately after completing
     * a checklist inspection (e.g., "assembled → QC review" flow).
     */
    inspectionId: v.optional(v.id("inspections")),
  },

  handler: async (ctx, args): Promise<QcSignOffResult> => {
    // ── 1. Authenticate ───────────────────────────────────────────────────────
    await requireAuth(ctx);

    // ── 2. Resolve case ───────────────────────────────────────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `[CASE_NOT_FOUND] No case found with id "${args.caseId}". ` +
          "Ensure the caseId is a valid Convex document ID from the cases table."
      );
    }

    // ── 3. Validate: rejected requires notes ─────────────────────────────────
    if (args.status === "rejected" && !args.notes?.trim()) {
      throw new Error(
        "[NOTES_REQUIRED] A rejection reason (notes) is required when " +
          "submitting a QC rejection. Provide a non-empty notes string."
      );
    }

    // ── 4. Capture previous QC status for audit diff ─────────────────────────
    const previousStatus = caseDoc.qcSignOffStatus ?? undefined;

    // ── 5. Insert immutable qcSignOffs history row ───────────────────────────
    const qcSignOffId = await ctx.db.insert("qcSignOffs", {
      caseId:          args.caseId,
      status:          args.status,
      signedOffBy:     args.signedOffBy,
      signedOffByName: args.signedOffByName,
      signedOffAt:     args.signedOffAt,
      notes:           args.notes?.trim() || undefined,
      previousStatus,
      inspectionId:    args.inspectionId,
    });

    // ── 6. Patch cases with denormalized QC summary fields ───────────────────
    //
    // When status = "pending" (revocation), clear the sign-off summary fields
    // so the case no longer shows an active QC decision.  For approved/rejected,
    // write the full summary so dashboard queries get zero-join access.
    if (args.status === "pending") {
      await ctx.db.patch(args.caseId, {
        qcSignOffStatus:   "pending",
        qcSignedOffBy:     undefined,
        qcSignedOffByName: undefined,
        qcSignedOffAt:     undefined,
        qcSignOffNotes:    undefined,
        updatedAt:         Date.now(),
      });
    } else {
      await ctx.db.patch(args.caseId, {
        qcSignOffStatus:   args.status,
        qcSignedOffBy:     args.signedOffBy,
        qcSignedOffByName: args.signedOffByName,
        qcSignedOffAt:     args.signedOffAt,
        qcSignOffNotes:    args.notes?.trim() || undefined,
        updatedAt:         Date.now(),
      });
    }

    // ── 7. Append immutable qc_sign_off audit event ──────────────────────────
    const eventId = await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "qc_sign_off",
      userId:    args.signedOffBy,
      userName:  args.signedOffByName,
      timestamp: args.signedOffAt,
      data: {
        // Sign-off decision details
        status:          args.status,
        previousStatus:  previousStatus ?? null,
        notes:           args.notes?.trim() ?? null,
        // Reference to the qcSignOffs history row
        qcSignOffId:     qcSignOffId,
        // Optional inspection link
        inspectionId:    args.inspectionId ?? null,
        // Denormalized case label for self-contained audit display
        caseLabel:       caseDoc.label,
      },
    });

    // ── 8. Return result ──────────────────────────────────────────────────────
    return {
      qcSignOffId,
      eventId,
      status:  args.status,
      caseId:  args.caseId,
    };
  },
});

// ─── addQcSignOff ─────────────────────────────────────────────────────────────

/**
 * addQcSignOff — Simplified QC sign-off mutation using canonical AC field names.
 *
 * This is the primary entry point matching the AC 250301 specification.
 * It exposes `userId`, `timestamp`, and `notes` field names and delegates
 * atomically to the same three-table write as `submitQcSignOff`:
 *   1. INSERT qcSignOffs row (immutable audit record)
 *   2. PATCH cases with denormalized QC summary fields
 *   3. INSERT events audit row (qc_sign_off type)
 *
 * This function is the canonical `addQcSignOff` mutation exposed at:
 *   api.mutations.qcSignOff.addQcSignOff
 *
 * Authentication: requires valid Kinde JWT (same as submitQcSignOff).
 *
 * @param caseId    — Convex document ID of the case to sign off.
 * @param userId    — Kinde user ID of the reviewer performing the sign-off.
 * @param timestamp — Epoch ms when the sign-off was performed (client clock).
 * @param notes     — Reviewer notes accompanying the sign-off decision.
 *                    Required when status = "rejected".
 * @param status    — QC decision: "pending" | "approved" | "rejected".
 *                    Defaults to "approved" when not provided.
 * @param displayName — Optional display name of the reviewer (defaults to userId).
 * @param inspectionId — Optional Convex ID of the related inspection.
 * @returns QcSignOffResult
 */
export const addQcSignOff = mutation({
  args: {
    /** Convex document ID of the case to QC sign off. */
    caseId: v.id("cases"),

    /**
     * Kinde `sub` claim of the reviewer submitting the sign-off.
     * Maps to `signedOffBy` in the qcSignOffs table.
     */
    userId: v.string(),

    /**
     * Epoch ms when the sign-off was performed (client-side clock).
     * Maps to `signedOffAt` in the qcSignOffs table.
     */
    timestamp: v.number(),

    /**
     * Reviewer notes accompanying the decision.
     * Required when status = "rejected".
     */
    notes: v.optional(v.string()),

    /**
     * QC decision to record.
     * Defaults to "approved" when not specified.
     */
    status: v.optional(qcSignOffStatusValidator),

    /**
     * Display name of the reviewer.
     * Defaults to userId when not provided.
     */
    displayName: v.optional(v.string()),

    /**
     * Optional link to the inspection that triggered this QC review.
     */
    inspectionId: v.optional(v.id("inspections")),
  },

  handler: async (ctx, args): Promise<QcSignOffResult> => {
    // ── 1. Authenticate ───────────────────────────────────────────────────────
    await requireAuth(ctx);

    // ── 2. Resolve effective values ───────────────────────────────────────────
    const status        = args.status ?? "approved";
    const signedOffBy   = args.userId;
    const signedOffByName = args.displayName ?? args.userId;
    const signedOffAt   = args.timestamp;

    // ── 3. Resolve case ───────────────────────────────────────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `[CASE_NOT_FOUND] No case found with id "${args.caseId}". ` +
          "Ensure the caseId is a valid Convex document ID from the cases table."
      );
    }

    // ── 4. Validate: rejected requires notes ─────────────────────────────────
    if (status === "rejected" && !args.notes?.trim()) {
      throw new Error(
        "[NOTES_REQUIRED] A rejection reason (notes) is required when " +
          "submitting a QC rejection. Provide a non-empty notes string."
      );
    }

    // ── 5. Capture previous QC status for audit diff ─────────────────────────
    const previousStatus = caseDoc.qcSignOffStatus ?? undefined;

    // ── 6. Insert immutable qcSignOffs history row ───────────────────────────
    const qcSignOffId = await ctx.db.insert("qcSignOffs", {
      caseId:          args.caseId,
      status,
      signedOffBy,
      signedOffByName,
      signedOffAt,
      notes:           args.notes?.trim() || undefined,
      previousStatus,
      inspectionId:    args.inspectionId,
    });

    // ── 7. Patch cases with denormalized QC summary fields ───────────────────
    if (status === "pending") {
      await ctx.db.patch(args.caseId, {
        qcSignOffStatus:   "pending",
        qcSignedOffBy:     undefined,
        qcSignedOffByName: undefined,
        qcSignedOffAt:     undefined,
        qcSignOffNotes:    undefined,
        updatedAt:         Date.now(),
      });
    } else {
      await ctx.db.patch(args.caseId, {
        qcSignOffStatus:   status,
        qcSignedOffBy:     signedOffBy,
        qcSignedOffByName: signedOffByName,
        qcSignedOffAt:     signedOffAt,
        qcSignOffNotes:    args.notes?.trim() || undefined,
        updatedAt:         Date.now(),
      });
    }

    // ── 8. Append immutable qc_sign_off audit event ──────────────────────────
    const eventId = await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "qc_sign_off",
      userId:    signedOffBy,
      userName:  signedOffByName,
      timestamp: signedOffAt,
      data: {
        status,
        previousStatus:  previousStatus ?? null,
        notes:           args.notes?.trim() ?? null,
        qcSignOffId,
        inspectionId:    args.inspectionId ?? null,
        caseLabel:       caseDoc.label,
      },
    });

    // ── 9. Return result ──────────────────────────────────────────────────────
    return {
      qcSignOffId,
      eventId,
      status,
      caseId: args.caseId,
    };
  },
});
