/**
 * convex/qrCodes.ts
 *
 * Mutation for associating a QR code string with an equipment case.
 *
 * The QR code is stored as `cases.qrCode` and uniquely identifies a case
 * via the `by_qr_code` index defined in convex/schema.ts.  A QR code may
 * only be mapped to one case at a time — this module enforces that invariant
 * server-side so no two cases ever share the same QR payload.
 *
 * Exports
 * ───────
 *   associateQRCodeToCase  — write qrCode to a case; validates uniqueness first
 *
 * Database contract
 * ─────────────────
 * This mutation writes to two tables:
 *
 *   cases.qrCode       — the QR payload string (looked up by the SCAN app)
 *   cases.updatedAt    — refreshed so M1 by_updated sort index stays current
 *   events             — immutable audit record of the association action
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
 * Client usage
 * ────────────
 *   import { useMutation } from "convex/react";
 *   import { api } from "@/convex/_generated/api";
 *
 *   const associate = useMutation(api.qrCodes.associateQRCodeToCase);
 *   await associate({
 *     qrCode:   "https://scan.example.com/case/abc123?uid=4f3d1a9b2c7e5f0a",
 *     caseId:   caseDoc._id,
 *     userId:   kindeUser.id,
 *     userName: "Jane Pilot",
 *   });
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";

// ─── Return type ──────────────────────────────────────────────────────────────

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
    // Write qrCode and refresh updatedAt so the M1 by_updated index reflects
    // this change as recent activity on the case.
    const now = Date.now();
    await ctx.db.patch(args.caseId, {
      qrCode,
      updatedAt: now,
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
