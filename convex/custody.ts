/**
 * convex/custody.ts
 *
 * Public query functions for custody handoff record subscriptions.
 *
 * These are callable from the client via `useQuery` (convex/react) and deliver
 * real-time reactive updates to the INVENTORY dashboard and the SCAN mobile app
 * custody transfer workflow.  Convex re-runs any subscribed query whenever the
 * underlying `custodyRecords` rows change — no polling required.
 *
 * Data model
 * ──────────
 * Custody records live in the `custodyRecords` table (see convex/schema.ts).
 * Each row captures a single handoff between two Kinde users:
 *
 *   custodyRecords {
 *     caseId           — the case being transferred
 *     fromUserId       — Kinde user ID of the outgoing holder
 *     fromUserName     — display name of the outgoing holder
 *     toUserId         — Kinde user ID of the incoming holder
 *     toUserName       — display name of the incoming holder
 *     transferredAt    — epoch ms when the transfer occurred
 *     notes            — optional free-text notes from SCAN app
 *     signatureStorageId — optional Convex storage ID for a captured signature
 *   }
 *
 * Indexes
 * ───────
 *   by_case      — per-case lookups for the T5 audit panel and SCAN handoff history
 *   by_to_user   — custodian identity queries: cases currently held by a user
 *   by_from_user — transferrer identity queries: cases handed off by a user
 *
 * Query functions
 * ───────────────
 * Case-scoped (by caseId):
 *   getCustodyRecordsByCase          — all handoffs for one case, most recent first
 *   getCustodyRecordsByCaseInRange   — case-scoped handoffs within a date window
 *   getLatestCustodyRecord           — single most recent handoff for a case
 *   getCustodyChain                  — full chronological chain for audit trail
 *
 * Custodian identity-scoped (by userId):
 *   getCustodyRecordsByCustodian        — all records where toUserId = userId
 *   getCustodyRecordsByCustodianInRange — same, within a transferredAt window
 *   getCustodyRecordsByTransferrer      — all records where fromUserId = userId
 *   getCustodyRecordsByTransferrerInRange — same, within a transferredAt window
 *   getCustodyRecordsByReporter         — alias of by-transferrer (Sub-AC 4 contract)
 *   getCustodyRecordsByReporterInRange  — by-reporter, within a transferredAt window
 *   getCustodyRecordsByParticipant      — records where userId is from OR to
 *   getCustodianIdentitySummary         — current caseIds held + stats for a user
 *
 * Fleet-wide:
 *   listAllCustodyTransfers   — all handoffs, optional date-range filter
 *   getCustodyTransferSummary — aggregate fleet stats, optional date-range
 *
 * Index usage
 * ───────────
 *   getCustodyRecordsByCase         → by_case       O(log n + |records|)
 *   getLatestCustodyRecord          → by_case       O(log n + |records|)
 *   getCustodyChain                 → by_case       O(log n + |records|)
 *   getCustodyRecordsByCustodian    → by_to_user    O(log n + |records|)
 *   getCustodyRecordsByTransferrer  → by_from_user  O(log n + |records|)
 *   getCustodyRecordsByParticipant  → by_to_user + by_from_user (two scans,
 *                                     in-memory dedup)  O(log n + |records|)
 *   getCustodianIdentitySummary     → by_to_user + by_from_user (two scans)
 *   listAllCustodyTransfers         → full scan, in-memory date filter
 *   getCustodyTransferSummary       → full scan, in-memory date filter
 *
 * Client usage examples:
 *   // All handoffs for a case (T5 audit panel)
 *   const records = useQuery(api.custody.getCustodyRecordsByCase, { caseId });
 *
 *   // Cases currently held by a technician (SCAN app "my cases")
 *   const myCases = useQuery(api.custody.getCustodyRecordsByCustodian, { userId });
 *
 *   // Full activity history for a user (admin identity view)
 *   const history = useQuery(api.custody.getCustodyRecordsByParticipant, { userId });
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Auth, UserIdentity } from "convex/server";
import {
  projectCustodyRecord,
  sortRecordsDescending,
  sortRecordsAscending,
  pickLatestRecord,
  applyDateRangeFilter,
  computeTransferSummary,
  computeCustodianIdentitySummary,
} from "./custodyHelpers";

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Asserts that the calling client has a verified Kinde JWT.
 * Throws [AUTH_REQUIRED] for unauthenticated requests.
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

// ─── Types ────────────────────────────────────────────────────────────────────

// Re-export types from the helpers module so callers only need one import path.
export type {
  CustodyRecord,
  CustodyTransferSummary,
  CustodianIdentitySummary,
} from "./custodyHelpers";

// Re-export HandoffCustodyResult from custodyHandoffs so existing imports from
// "custody" continue to work without modification.
export type { HandoffCustodyResult } from "./custodyHandoffs";

// ─── getCustodyRecordsByCase ──────────────────────────────────────────────────

/**
 * Subscribe to all custody handoff records for a specific case.
 *
 * Returns every handoff recorded for the given case, sorted by `transferredAt`
 * descending (most recent transfer at index 0).  This is the primary query for:
 *   • INVENTORY dashboard T5 panel — custody chain audit tab
 *   • SCAN app post-handoff confirmation screen
 *   • INVENTORY dashboard case detail sidebar — "Custody" section
 *
 * Convex pushes an update to all subscribers within ~100–300 ms whenever the
 * SCAN app completes a custody transfer mutation, satisfying the ≤ 2-second
 * real-time fidelity requirement.
 *
 * Returns an empty array when no handoffs have been recorded for the case.
 * Returns an empty array when the `caseId` is invalid.
 *
 * Uses the `by_case` index — O(log n + |records for case|).
 *
 * Client usage:
 *   const records = useQuery(api.custody.getCustodyRecordsByCase, { caseId });
 */
export const getCustodyRecordsByCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodyRecord[]> => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("custodyRecords")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    return sortRecordsDescending(rows.map(projectCustodyRecord));
  },
});

// ─── getLatestCustodyRecord ───────────────────────────────────────────────────

/**
 * Subscribe to the most recent custody handoff record for a case.
 *
 * Returns a single `CustodyRecord` representing the last completed custody
 * transfer, or `null` if no handoffs have ever been recorded.  Use cases:
 *   • INVENTORY dashboard case sidebar — "Currently held by" display
 *   • SCAN app case overview — showing the current custodian before handoff
 *   • Dashboard map pin tooltip — current holder name
 *
 * This query loads all records via the `by_case` index and picks the maximum
 * `transferredAt` in memory.  For cases with up to a few hundred handoffs this
 * is efficient; for cases that change hands thousands of times a dedicated
 * `by_case_transferred` compound index would be preferable, but is not required
 * at current fleet scale.
 *
 * Returns `null` when the case has no custody records.
 *
 * Client usage:
 *   const latest = useQuery(api.custody.getLatestCustodyRecord, { caseId });
 */
export const getLatestCustodyRecord = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodyRecord | null> => {
    await requireAuth(ctx);
    // Use the by_case_transferred_at compound index with desc ordering to fetch
    // only the single most-recent row — O(log n + 1) instead of O(log n + |records|)
    // + in-memory sort. Significant improvement for cases with many historical handoffs.
    const row = await ctx.db
      .query("custodyRecords")
      .withIndex("by_case_transferred_at", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .first();

    return row ? projectCustodyRecord(row) : null;
  },
});

// ─── getCustodyChain ──────────────────────────────────────────────────────────

/**
 * Subscribe to the full chronological custody chain for a case.
 *
 * Returns all handoff records ordered by `transferredAt` ascending (oldest
 * transfer first), providing a chronological audit trail of every person who
 * has held custody of the case.  This is the data source for:
 *   • T5 hash-chain audit panel — custody chain section
 *   • Compliance / chain-of-custody reports and exports
 *   • Debugging unexpected state by reviewing transfer history in order
 *
 * Unlike `getCustodyRecordsByCase` (which sorts descending for UX), this query
 * sorts ascending so callers can iterate from the first holder to the most
 * recent without reversing the array.
 *
 * Returns an empty array when no transfers have been recorded.
 *
 * Client usage:
 *   const chain = useQuery(api.custody.getCustodyChain, { caseId });
 */
export const getCustodyChain = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodyRecord[]> => {
    await requireAuth(ctx);
    // Use the by_case_transferred_at index with asc order to retrieve the chain
    // already sorted chronologically — no in-memory sort needed.
    const rows = await ctx.db
      .query("custodyRecords")
      .withIndex("by_case_transferred_at", (q) => q.eq("caseId", args.caseId))
      .order("asc")
      .collect();

    return rows.map(projectCustodyRecord);
  },
});

// ─── listAllCustodyTransfers ──────────────────────────────────────────────────

/**
 * Subscribe to all custody transfers across the entire fleet.
 *
 * Returns every handoff across all cases, sorted by `transferredAt` descending
 * (most recent activity first).  Supports optional date-range filtering via
 * `since` (epoch ms lower bound) and `until` (epoch ms upper bound).
 *
 * Use cases:
 *   • INVENTORY dashboard global custody overview (operations supervisor)
 *   • Compliance reporting — all transfers within a reporting period
 *   • Detecting stale custody — cases not handed off in N days
 *
 * Performance note: performs a full scan of `custodyRecords` and applies the
 * date range filter in memory.  Acceptable for single-tenant fleets up to
 * ~100k custody records.  If the fleet grows beyond that, a compound index on
 * `transferredAt` would be needed for efficient range queries.
 *
 * Pass `since` only to get transfers after a specific epoch ms timestamp.
 * Pass `until` only to get transfers before a specific epoch ms timestamp.
 * Pass both to get a closed time window.
 * Pass neither to get all transfers (no date filter).
 *
 * Client usage:
 *   // All fleet transfers
 *   const transfers = useQuery(api.custody.listAllCustodyTransfers, {});
 *
 *   // Transfers in the last 7 days
 *   const recent = useQuery(api.custody.listAllCustodyTransfers, {
 *     since: Date.now() - 7 * 24 * 60 * 60 * 1000,
 *   });
 */
export const listAllCustodyTransfers = query({
  args: {
    /** Include only transfers that occurred at or after this epoch ms. */
    since: v.optional(v.number()),
    /** Include only transfers that occurred at or before this epoch ms. */
    until: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodyRecord[]> => {
    await requireAuth(ctx);
    const allRows = await ctx.db.query("custodyRecords").collect();
    const projected = allRows.map(projectCustodyRecord);
    const filtered  = applyDateRangeFilter(projected, args.since, args.until);
    return sortRecordsDescending(filtered);
  },
});

// ─── getCustodyTransferSummary ────────────────────────────────────────────────

/**
 * Subscribe to aggregate custody transfer statistics across the fleet.
 *
 * Returns high-level counts and activity metadata for the fleet-wide custody
 * overview panel on the INVENTORY dashboard.  Useful for:
 *   • Dashboard header metrics: "N handoffs today"
 *   • Identifying the most active recipient (e.g., who received the most cases)
 *   • Quick health check — if no transfers occurred in an expected window, alert
 *
 * Accepts the same `since` / `until` date-range filter as
 * `listAllCustodyTransfers` to scope the summary to a reporting period.
 *
 * Returns a summary with `totalTransfers: 0` and null fields when no records
 * match the filter.
 *
 * Client usage:
 *   // Today's transfer summary
 *   const summary = useQuery(api.custody.getCustodyTransferSummary, {
 *     since: startOfDay,
 *   });
 *   // → { totalTransfers: 8, mostActiveTo: { userName: "Alice", count: 3 }, ... }
 */
export const getCustodyTransferSummary = query({
  args: {
    since: v.optional(v.number()),
    until: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodyTransferSummary> => {
    await requireAuth(ctx);
    const allRows  = await ctx.db.query("custodyRecords").collect();
    const projected = allRows.map(projectCustodyRecord);
    const filtered  = applyDateRangeFilter(projected, args.since, args.until);
    return computeTransferSummary(filtered);
  },
});

// ─── getCustodyRecordsByCustodian ─────────────────────────────────────────────

/**
 * Subscribe to all custody records where a specific user is the incoming
 * custody holder (`toUserId`).
 *
 * Returns every handoff record where `toUserId = userId`, sorted by
 * `transferredAt` descending (most recent receipt first).  This is the
 * primary query for:
 *   • SCAN app "My Cases" view — showing all cases ever assigned to the
 *     signed-in technician
 *   • INVENTORY admin — auditing all cases a specific user has received
 *   • SCAN app pre-handoff confirmation — "You are receiving this case"
 *
 * Uses the `by_to_user` index — O(log n + |records for user|).
 * Convex pushes an update within ~100–300 ms of any `handoffCustody`
 * mutation where `toUserId = userId`.
 *
 * Note: this query returns ALL records where the user received custody,
 * including cases they may have subsequently transferred to someone else.
 * Use `getCustodianIdentitySummary` to determine which cases the user
 * currently holds.
 *
 * Returns an empty array when the user has never received any case.
 *
 * Client usage:
 *   // All cases ever assigned to Alice
 *   const records = useQuery(api.custody.getCustodyRecordsByCustodian, {
 *     userId: "kinde_alice_123",
 *   });
 */
export const getCustodyRecordsByCustodian = query({
  args: {
    /**
     * Kinde user ID of the custody recipient to query.
     * Matched against custodyRecords.toUserId.
     */
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodyRecord[]> => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("custodyRecords")
      .withIndex("by_to_user", (q) => q.eq("toUserId", args.userId))
      .collect();

    return sortRecordsDescending(rows.map(projectCustodyRecord));
  },
});

// ─── getCustodyRecordsByTransferrer ───────────────────────────────────────────

/**
 * Subscribe to all custody records where a specific user is the outgoing
 * custody holder (`fromUserId`).
 *
 * Returns every handoff record where `fromUserId = userId`, sorted by
 * `transferredAt` descending (most recent transfer-out first).  Use cases:
 *   • INVENTORY admin — auditing all handoffs initiated by a specific user
 *   • SCAN app "Transfer History" tab — "You handed off these cases"
 *   • Compliance — confirming a field technician relinquished custody properly
 *
 * Uses the `by_from_user` index — O(log n + |records for user|).
 * Convex pushes an update within ~100–300 ms of any `handoffCustody`
 * mutation where `fromUserId = userId`.
 *
 * Returns an empty array when the user has never transferred a case.
 *
 * Client usage:
 *   const outgoing = useQuery(api.custody.getCustodyRecordsByTransferrer, {
 *     userId: "kinde_alice_123",
 *   });
 */
export const getCustodyRecordsByTransferrer = query({
  args: {
    /**
     * Kinde user ID of the custody sender to query.
     * Matched against custodyRecords.fromUserId.
     */
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodyRecord[]> => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("custodyRecords")
      .withIndex("by_from_user", (q) => q.eq("fromUserId", args.userId))
      .collect();

    return sortRecordsDescending(rows.map(projectCustodyRecord));
  },
});

// ─── getCustodyRecordsByParticipant ───────────────────────────────────────────

/**
 * Subscribe to all custody records where a specific user participated as
 * either the outgoing holder (`fromUserId`) or the incoming holder (`toUserId`).
 *
 * Returns the union of the `by_from_user` and `by_to_user` index scans for the
 * given userId, deduplicated (a record cannot appear in both scans unless the
 * same user transferred to themselves, which is valid but uncommon), sorted by
 * `transferredAt` descending.
 *
 * This is the most comprehensive custodian identity query — it shows a user's
 * complete custody activity history regardless of role.  Use cases:
 *   • INVENTORY admin — full audit view for a specific user's custody trail
 *   • Compliance investigation — "show every transfer involving user X"
 *   • SCAN app "My Activity" — all handoffs the signed-in user was part of
 *
 * Implementation: performs two index scans (by_to_user + by_from_user) and
 * deduplicates in memory using the record's `_id`.  Both scans are O(log n +
 * |results|); dedup is O(|total results|).  Suitable for single-tenant fleets.
 *
 * Returns an empty array when the user has never been involved in a handoff.
 *
 * Client usage:
 *   const activity = useQuery(api.custody.getCustodyRecordsByParticipant, {
 *     userId: "kinde_alice_123",
 *   });
 */
export const getCustodyRecordsByParticipant = query({
  args: {
    /**
     * Kinde user ID to look up.
     * Matched against BOTH custodyRecords.toUserId AND custodyRecords.fromUserId.
     */
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodyRecord[]> => {
    await requireAuth(ctx);
    // Two separate index scans — Convex does not support OR on indexes.
    const [toRows, fromRows] = await Promise.all([
      ctx.db
        .query("custodyRecords")
        .withIndex("by_to_user", (q) => q.eq("toUserId", args.userId))
        .collect(),
      ctx.db
        .query("custodyRecords")
        .withIndex("by_from_user", (q) => q.eq("fromUserId", args.userId))
        .collect(),
    ]);

    // Deduplicate by _id (self-transfers would appear in both scans).
    const seen = new Set<string>();
    const merged: import("./custodyHelpers").CustodyRecord[] = [];

    for (const row of [...toRows, ...fromRows]) {
      const id = row._id.toString();
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(projectCustodyRecord(row));
      }
    }

    return sortRecordsDescending(merged);
  },
});

// ─── getCustodianIdentitySummary ──────────────────────────────────────────────

/**
 * Subscribe to a custodian identity summary for a specific user.
 *
 * Returns which cases the user currently holds (i.e., they are the most recent
 * `toUserId` for those cases) along with lifetime transfer activity counts.
 *
 * This is the primary query for:
 *   • SCAN app "My Cases" badge count — number of cases the technician holds
 *   • INVENTORY dashboard user profile chip — "Currently holds N cases"
 *   • Admin user activity panel — received/transferred counts
 *
 * The "currently holding" determination is made in memory by grouping all
 * records involving the user by `caseId` and checking if the user is the
 * `toUserId` on the record with the highest `transferredAt` for each case.
 *
 * Implementation:
 *   1. Two index scans: by_to_user (received) + by_from_user (transferred out)
 *   2. Dedup in memory → union of all records involving the user
 *   3. Group by caseId, pick latest per group
 *   4. Count cases where user is the current toUserId
 *
 * Returns currentCaseCount: 0 and empty currentCaseIds when the user holds
 * no cases.  Returns totalReceived: 0 and totalTransferred: 0 when the user
 * has never participated in a handoff.
 *
 * Client usage:
 *   const identity = useQuery(api.custody.getCustodianIdentitySummary, {
 *     userId: "kinde_alice_123",
 *   });
 *   // → { currentCaseCount: 3, currentCaseIds: [...], totalReceived: 7, ... }
 */
export const getCustodianIdentitySummary = query({
  args: {
    /**
     * Kinde user ID of the custodian to summarize.
     */
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodianIdentitySummary> => {
    await requireAuth(ctx);
    // Collect all records where the user appears as sender or receiver.
    const [toRows, fromRows] = await Promise.all([
      ctx.db
        .query("custodyRecords")
        .withIndex("by_to_user", (q) => q.eq("toUserId", args.userId))
        .collect(),
      ctx.db
        .query("custodyRecords")
        .withIndex("by_from_user", (q) => q.eq("fromUserId", args.userId))
        .collect(),
    ]);

    // Deduplicate and project.
    const seen = new Set<string>();
    const allUserRecords: import("./custodyHelpers").CustodyRecord[] = [];

    for (const row of [...toRows, ...fromRows]) {
      const id = row._id.toString();
      if (!seen.has(id)) {
        seen.add(id);
        allUserRecords.push(projectCustodyRecord(row));
      }
    }

    return computeCustodianIdentitySummary(args.userId, allUserRecords);
  },
});

// ─── getCustodyRecordsByCaseInRange ──────────────────────────────────────────

/**
 * Subscribe to all custody records for a case within a `transferredAt` window.
 *
 * Returns the handoff records for the supplied case whose `transferredAt`
 * timestamp falls inside the inclusive `[fromTimestamp, toTimestamp]` window
 * (epoch ms), sorted by `transferredAt` descending (most recent within the
 * window first).
 *
 * Use cases:
 *   • T5 audit panel — narrowing the custody chain to a time slice
 *   • Compliance exports — "all handoffs for CASE-007 during the deployment"
 *   • Operations review — "who held this case during last week?"
 *
 * Index path: `custodyRecords.by_case_transferred_at` — Convex evaluates both
 * the equality predicate (`caseId`) and the range bounds (`transferredAt`) in
 * the index for an O(log n + |range|) seek.
 *
 * Both `fromTimestamp` and `toTimestamp` are inclusive.  Pass `0` for
 * `fromTimestamp` and a far-future epoch for `toTimestamp` to retrieve all
 * handoffs for the case without date filtering — though
 * `getCustodyRecordsByCase` is more idiomatic for that use case.
 *
 * Returns an empty array when:
 *   • No handoffs exist within the window for the case.
 *   • The caseId is invalid.
 *   • fromTimestamp > toTimestamp (empty range guard).
 *
 * Convex re-runs this query and pushes the diff to all subscribers within
 * ~100–300 ms whenever a new handoff falls into the subscribed window,
 * satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Client usage:
 *   const records = useQuery(api.custody.getCustodyRecordsByCaseInRange, {
 *     caseId,
 *     fromTimestamp: shiftStart,
 *     toTimestamp:   shiftEnd,
 *   });
 */
export const getCustodyRecordsByCaseInRange = query({
  args: {
    caseId:        v.id("cases"),
    /** Inclusive lower bound on `transferredAt` (epoch ms). */
    fromTimestamp: v.number(),
    /** Inclusive upper bound on `transferredAt` (epoch ms). */
    toTimestamp:   v.number(),
  },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodyRecord[]> => {
    await requireAuth(ctx);

    // Guard: empty range — return immediately without a DB read.
    if (args.fromTimestamp > args.toTimestamp) return [];

    const rows = await ctx.db
      .query("custodyRecords")
      .withIndex("by_case_transferred_at", (q) => q.eq("caseId", args.caseId))
      .filter((q) =>
        q.and(
          q.gte(q.field("transferredAt"), args.fromTimestamp),
          q.lte(q.field("transferredAt"), args.toTimestamp),
        )
      )
      .order("desc")
      .collect();

    return rows.map(projectCustodyRecord);
  },
});

// ─── getCustodyRecordsByCustodianInRange ──────────────────────────────────────

/**
 * Subscribe to custody records where a user is the recipient (`toUserId`)
 * within a `transferredAt` window.
 *
 * Returns the union of `by_to_user` index hits for the supplied Kinde user ID
 * whose `transferredAt` falls inside the inclusive `[fromTimestamp,
 * toTimestamp]` window, sorted by `transferredAt` descending.
 *
 * Use cases:
 *   • SCAN app "My Cases received this week"
 *   • Admin productivity dashboards — per-recipient throughput
 *   • Compliance — "all handoffs Alice received during the deployment"
 *
 * Index path: `custodyRecords.by_to_user` — equality on `toUserId`.  The range
 * predicate is applied via `.filter()` after the index seek; for typical fleet
 * volumes (hundreds of records per user) this remains O(log n + |results|)
 * with negligible filter overhead.
 *
 * Returns an empty array when:
 *   • The user has not received any handoffs within the window.
 *   • fromTimestamp > toTimestamp.
 *
 * Client usage:
 *   const recent = useQuery(api.custody.getCustodyRecordsByCustodianInRange, {
 *     userId: kindeUser.id,
 *     fromTimestamp: weekStart,
 *     toTimestamp:   weekEnd,
 *   });
 */
export const getCustodyRecordsByCustodianInRange = query({
  args: {
    /** Kinde user ID matched against `custodyRecords.toUserId`. */
    userId:        v.string(),
    /** Inclusive lower bound on `transferredAt` (epoch ms). */
    fromTimestamp: v.number(),
    /** Inclusive upper bound on `transferredAt` (epoch ms). */
    toTimestamp:   v.number(),
  },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodyRecord[]> => {
    await requireAuth(ctx);

    if (args.fromTimestamp > args.toTimestamp) return [];

    const rows = await ctx.db
      .query("custodyRecords")
      .withIndex("by_to_user", (q) => q.eq("toUserId", args.userId))
      .filter((q) =>
        q.and(
          q.gte(q.field("transferredAt"), args.fromTimestamp),
          q.lte(q.field("transferredAt"), args.toTimestamp),
        )
      )
      .collect();

    return sortRecordsDescending(rows.map(projectCustodyRecord));
  },
});

// ─── getCustodyRecordsByTransferrerInRange ────────────────────────────────────

/**
 * Subscribe to custody records where a user is the transferrer (`fromUserId`)
 * within a `transferredAt` window.
 *
 * Returns rows from the `by_from_user` index for the supplied Kinde user ID
 * whose `transferredAt` is inside the inclusive `[fromTimestamp, toTimestamp]`
 * window, sorted by `transferredAt` descending.
 *
 * In the SCAN→INVENTORY data model, the "reporter" of a custody handoff is
 * the technician who initiates the transfer (i.e., the outgoing holder).
 * `getCustodyRecordsByTransferrerInRange` is the date-scoped "by reporter"
 * query for custody events.
 *
 * Use cases:
 *   • SCAN app — "Cases I handed off this week"
 *   • Admin dashboards — per-transferrer throughput
 *   • Compliance — "all handoffs initiated by Alice during the deployment"
 *
 * Index path: `custodyRecords.by_from_user`.
 *
 * Returns an empty array when:
 *   • The user has not initiated any handoffs within the window.
 *   • fromTimestamp > toTimestamp.
 *
 * Client usage:
 *   const recent = useQuery(api.custody.getCustodyRecordsByTransferrerInRange, {
 *     userId: kindeUser.id,
 *     fromTimestamp: dayStart,
 *     toTimestamp:   dayEnd,
 *   });
 */
export const getCustodyRecordsByTransferrerInRange = query({
  args: {
    /** Kinde user ID matched against `custodyRecords.fromUserId`. */
    userId:        v.string(),
    /** Inclusive lower bound on `transferredAt` (epoch ms). */
    fromTimestamp: v.number(),
    /** Inclusive upper bound on `transferredAt` (epoch ms). */
    toTimestamp:   v.number(),
  },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodyRecord[]> => {
    await requireAuth(ctx);

    if (args.fromTimestamp > args.toTimestamp) return [];

    const rows = await ctx.db
      .query("custodyRecords")
      .withIndex("by_from_user", (q) => q.eq("fromUserId", args.userId))
      .filter((q) =>
        q.and(
          q.gte(q.field("transferredAt"), args.fromTimestamp),
          q.lte(q.field("transferredAt"), args.toTimestamp),
        )
      )
      .collect();

    return sortRecordsDescending(rows.map(projectCustodyRecord));
  },
});

// ─── getCustodyRecordsByReporter ──────────────────────────────────────────────

/**
 * Subscribe to all custody records "reported" by a specific user.
 *
 * In the SCAN→INVENTORY data contract a custody handoff is "reported" by the
 * technician who initiates the transfer — i.e., the outgoing holder
 * (`fromUserId`).  This query is a clearer-named alias for
 * `getCustodyRecordsByTransferrer` so dashboard / SCAN code reading the
 * Sub-AC 4 contract can reference it directly:
 *
 *   "query functions for custody events ... by reporter"
 *                                              ↑
 *                          getCustodyRecordsByReporter
 *
 * Returns every record where `fromUserId = reporterId`, sorted by
 * `transferredAt` descending.  Uses the `by_from_user` index — O(log n +
 * |results|).
 *
 * Returns an empty array when the user has never initiated a handoff.
 *
 * Client usage:
 *   const reports = useQuery(api.custody.getCustodyRecordsByReporter, {
 *     reporterId: kindeUser.id,
 *   });
 */
export const getCustodyRecordsByReporter = query({
  args: {
    /**
     * Kinde user ID of the technician who reported (initiated) the handoff.
     * Matched against `custodyRecords.fromUserId`.
     */
    reporterId: v.string(),
  },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodyRecord[]> => {
    await requireAuth(ctx);

    const rows = await ctx.db
      .query("custodyRecords")
      .withIndex("by_from_user", (q) => q.eq("fromUserId", args.reporterId))
      .collect();

    return sortRecordsDescending(rows.map(projectCustodyRecord));
  },
});

// ─── getCustodyRecordsByReporterInRange ───────────────────────────────────────

/**
 * Subscribe to custody handoffs "reported" by a specific user within a window.
 *
 * Date-scoped variant of `getCustodyRecordsByReporter`.  Returns records where
 * `fromUserId = reporterId` and `transferredAt` falls inside the inclusive
 * `[fromTimestamp, toTimestamp]` window, sorted by `transferredAt` descending.
 *
 * This is the reporter-specific equivalent of `listAllCustodyTransfers` and
 * the SCAN-app-friendly form of "show me my handoffs in this period".
 *
 * Returns an empty array when:
 *   • The reporter has no handoffs in the window.
 *   • fromTimestamp > toTimestamp.
 *
 * Client usage:
 *   const today = useQuery(api.custody.getCustodyRecordsByReporterInRange, {
 *     reporterId:    kindeUser.id,
 *     fromTimestamp: startOfDay,
 *     toTimestamp:   endOfDay,
 *   });
 */
export const getCustodyRecordsByReporterInRange = query({
  args: {
    reporterId:    v.string(),
    /** Inclusive lower bound on `transferredAt` (epoch ms). */
    fromTimestamp: v.number(),
    /** Inclusive upper bound on `transferredAt` (epoch ms). */
    toTimestamp:   v.number(),
  },
  handler: async (ctx, args): Promise<import("./custodyHelpers").CustodyRecord[]> => {
    await requireAuth(ctx);

    if (args.fromTimestamp > args.toTimestamp) return [];

    const rows = await ctx.db
      .query("custodyRecords")
      .withIndex("by_from_user", (q) => q.eq("fromUserId", args.reporterId))
      .filter((q) =>
        q.and(
          q.gte(q.field("transferredAt"), args.fromTimestamp),
          q.lte(q.field("transferredAt"), args.toTimestamp),
        )
      )
      .collect();

    return sortRecordsDescending(rows.map(projectCustodyRecord));
  },
});

// ─── handoffCustody — mutation (canonical: convex/custodyHandoffs.ts) ─────────
//
// The handoffCustody mutation has been moved to convex/custodyHandoffs.ts, which
// is the canonical home for all custody handoff write operations.  The mutation
// is exposed in the Convex API at api.custodyHandoffs.handoffCustody.
//
// For backward compatibility:
//   • HandoffCustodyResult is re-exported above from "./custodyHandoffs"
//   • Client hooks in use-scan-mutations.ts reference api.custodyHandoffs.handoffCustody
//
// See convex/custodyHandoffs.ts for the full implementation and documentation.
