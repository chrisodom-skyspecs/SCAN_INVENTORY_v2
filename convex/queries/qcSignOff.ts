/**
 * convex/queries/qcSignOff.ts
 *
 * Public query functions for QC (quality-control) sign-off subscriptions.
 *
 * These are callable from the client via `useQuery` (convex/react) and
 * provide real-time reactive updates to the INVENTORY dashboard and the
 * SCAN mobile app.  Convex re-runs any subscribed query automatically
 * whenever the underlying rows change — no polling required.
 *
 * Registered in the Convex API as: api["queries/qcSignOff"].*
 *
 * Query functions exported
 * ────────────────────────
 *   getQcSignOffByCaseId   — latest QC sign-off state for a single case.
 *                            O(log n + 1) via by_case_signed_at index.
 *                            Used by: T1 Summary panel QC status badge,
 *                            SCAN app case detail QC status display.
 *
 *   getQcSignOffHistory    — full chronological QC sign-off history for a case.
 *                            O(log n + |sign-offs|) via by_case_signed_at index.
 *                            Used by: T5 Audit panel QC history section.
 *
 *   getQcSignOffsByStatus  — all sign-offs fleet-wide with a given status.
 *                            O(log n + |matching|) via by_status index.
 *                            Used by: QC queue dashboard ("cases pending review").
 *
 *   getQcSignOffsByCaseIds — batch lookup of latest QC state for multiple cases.
 *                            Used by: M1 fleet overview map to show QC badges
 *                            on many pins without N separate queries.
 *
 * Index strategy
 * ──────────────
 * The `qcSignOffs` table has the following indexes:
 *   by_case:           ["caseId"]
 *   by_case_signed_at: ["caseId", "signedOffAt"]
 *   by_signer:         ["signedOffBy"]
 *   by_status:         ["status"]
 *   by_signed_at:      ["signedOffAt"]
 *
 * getQcSignOffByCaseId uses by_case_signed_at + .order("desc").first()
 * to fetch the most recent sign-off in O(log n + 1).
 *
 * getQcSignOffHistory uses by_case_signed_at + .order("desc") to return
 * the full chronological (newest-first) history in O(log n + |sign-offs|).
 *
 * Real-time fidelity
 * ──────────────────
 * All queries here read the `qcSignOffs` table.  Convex tracks this as a
 * reactive dependency.  Any call to `submitQcSignOff` (convex/mutations/
 * qcSignOff.ts) that inserts a new sign-off row triggers re-evaluation of
 * every active subscriber within ~100–300 ms, satisfying the ≤ 2-second
 * real-time fidelity requirement between SCAN app action and dashboard
 * visibility.
 *
 * Client usage (after `npx convex dev` regenerates API types):
 *
 *   // T1 summary panel: latest QC status for one case
 *   const signOff = useQuery(
 *     api["queries/qcSignOff"].getQcSignOffByCaseId,
 *     { caseId },
 *   );
 *   if (signOff === undefined) return <QcStatusSkeleton />;
 *   // signOff?.status → "pending" | "approved" | "rejected" | undefined
 *
 *   // T5 audit panel: full QC history for one case
 *   const history = useQuery(
 *     api["queries/qcSignOff"].getQcSignOffHistory,
 *     { caseId },
 *   );
 *   if (history === undefined) return <QcHistorySkeleton />;
 *   // history[0] → most recent sign-off, history[N-1] → earliest
 */

import { query } from "../_generated/server";
import { v } from "convex/values";

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * getQcSignOffByCaseId — get the most recent QC sign-off record for a case.
 *
 * Returns `null` when no QC sign-off has ever been submitted for the case.
 * Returns the LATEST sign-off row (highest signedOffAt) when one or more
 * sign-offs exist.
 *
 * Performance: O(log n + 1) via by_case_signed_at index + .order("desc").first().
 *
 * @param caseId — Convex document ID of the case to look up.
 * @returns The most recent qcSignOffs document, or null.
 */
export const getQcSignOffByCaseId = query({
  args: {
    /** Convex document ID of the case. */
    caseId: v.id("cases"),
  },

  handler: async (ctx, { caseId }) => {
    const latest = await ctx.db
      .query("qcSignOffs")
      .withIndex("by_case_signed_at", (q) => q.eq("caseId", caseId))
      .order("desc")
      .first();

    return latest ?? null;
  },
});

/**
 * getQcSignOffHistory — get the full chronological QC sign-off history for a case.
 *
 * Returns an array of qcSignOffs documents for the given case, ordered by
 * `signedOffAt` descending (most recent first).  Returns an empty array when
 * no sign-offs exist for the case.
 *
 * The T5 Audit panel renders this history as a timeline so operators can see
 * the full sequence of QC decisions for a case (e.g., rejected → resubmitted
 * → approved).
 *
 * Performance: O(log n + |sign-offs for case|) via by_case_signed_at index.
 *
 * @param caseId — Convex document ID of the case.
 * @param limit  — Optional maximum number of records to return (default: all).
 * @returns Array of qcSignOffs documents, newest first.
 */
export const getQcSignOffHistory = query({
  args: {
    /** Convex document ID of the case. */
    caseId: v.id("cases"),

    /**
     * Optional maximum number of sign-off records to return.
     * When omitted, all historical records are returned.
     * Useful for the T5 panel's "show last N" pagination.
     */
    limit: v.optional(v.number()),
  },

  handler: async (ctx, { caseId, limit }) => {
    let q = ctx.db
      .query("qcSignOffs")
      .withIndex("by_case_signed_at", (q) => q.eq("caseId", caseId))
      .order("desc");

    if (limit !== undefined && limit > 0) {
      return q.take(limit);
    }

    return q.collect();
  },
});

/**
 * getQcSignOffsByStatus — list all QC sign-off records fleet-wide with a given status.
 *
 * Useful for building the QC review queue on the INVENTORY dashboard:
 *   - "pending"  → cases awaiting QC review
 *   - "rejected" → cases that need rework and re-submission
 *   - "approved" → cases cleared for deployment (recently approved)
 *
 * Returns sign-off records for the latest sign-off state of each case.
 * Note: this returns ALL `qcSignOffs` rows with the given status, not just
 * the latest row per case.  Callers that need "current status = X" should
 * query the `cases` table's `by_qc_sign_off_status` index instead, which
 * holds the denormalized latest state.
 *
 * Performance: O(log n + |matching|) via by_status index.
 *
 * @param status — The QC sign-off status to filter by.
 * @param limit  — Optional maximum records to return (default: 100).
 * @returns Array of qcSignOffs documents with the given status, newest first.
 */
export const getQcSignOffsByStatus = query({
  args: {
    /**
     * QC status to filter by.
     *   "pending"  — sign-offs that reset/revoke a previous decision
     *   "approved" — sign-offs that cleared a case for deployment
     *   "rejected" — sign-offs that blocked a case for rework
     */
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),

    /**
     * Maximum number of records to return.
     * Defaults to 100 when not specified.
     * Use for paginated QC queue views on the dashboard.
     */
    limit: v.optional(v.number()),
  },

  handler: async (ctx, { status, limit }) => {
    const maxRows = limit ?? 100;

    return ctx.db
      .query("qcSignOffs")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order("desc")
      .take(maxRows);
  },
});

/**
 * getQcSignOffsByCaseIds — batch lookup of latest QC sign-off for multiple cases.
 *
 * Returns a map of caseId → latest qcSignOffs document (or null) for each
 * requested caseId.  Used by the M1 fleet overview map to display QC status
 * badges on many case pins without issuing N separate subscriptions.
 *
 * Performance: O(|caseIds| * log n) — one indexed query per caseId.
 * For large fleets (>200 cases) callers should prefer reading the denormalized
 * `qcSignOffStatus` field directly from the `cases` table via `listCases`.
 *
 * @param caseIds — Array of Convex document IDs to look up (max 50).
 * @returns Array of { caseId, signOff } objects. signOff is null when no
 *          QC sign-off exists for the case.
 */
export const getQcSignOffsByCaseIds = query({
  args: {
    /**
     * Array of case IDs to fetch latest QC sign-off for.
     * Capped at 50 entries to prevent runaway fan-out queries.
     */
    caseIds: v.array(v.id("cases")),
  },

  handler: async (ctx, { caseIds }) => {
    // Enforce a reasonable upper bound on fan-out
    const ids = caseIds.slice(0, 50);

    const results = await Promise.all(
      ids.map(async (caseId) => {
        const latest = await ctx.db
          .query("qcSignOffs")
          .withIndex("by_case_signed_at", (q) => q.eq("caseId", caseId))
          .order("desc")
          .first();

        return {
          caseId,
          signOff: latest ?? null,
        };
      })
    );

    return results;
  },
});
