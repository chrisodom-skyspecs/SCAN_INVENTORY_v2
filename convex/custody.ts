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
 *   getCustodyRecordsByCase   — all handoffs for one case, most recent first
 *   getLatestCustodyRecord    — single most recent handoff for a case
 *   getCustodyChain           — full chronological chain for audit trail
 *
 * Custodian identity-scoped (by userId):
 *   getCustodyRecordsByCustodian    — all records where toUserId = userId
 *   getCustodyRecordsByTransferrer  — all records where fromUserId = userId
 *   getCustodyRecordsByParticipant  — all records where userId is from OR to
 *   getCustodianIdentitySummary     — current caseIds held + stats for a user
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

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  projectCustodyRecord,
  sortRecordsDescending,
  sortRecordsAscending,
  pickLatestRecord,
  applyDateRangeFilter,
  computeTransferSummary,
  computeCustodianIdentitySummary,
} from "./custodyHelpers";

// ─── Types ────────────────────────────────────────────────────────────────────

// Re-export types from the helpers module so callers only need one import path.
export type {
  CustodyRecord,
  CustodyTransferSummary,
  CustodianIdentitySummary,
} from "./custodyHelpers";

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
    const rows = await ctx.db
      .query("custodyRecords")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    return pickLatestRecord(rows.map(projectCustodyRecord));
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
    const rows = await ctx.db
      .query("custodyRecords")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    return sortRecordsAscending(rows.map(projectCustodyRecord));
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

// ─── handoffCustody — mutation ────────────────────────────────────────────────

/**
 * Return value of the handoffCustody mutation.
 * Exported so client-side hooks can expose a typed result to SCAN app components.
 */
export interface HandoffCustodyResult {
  /** Convex document ID of the newly created custodyRecords row. */
  custodyRecordId: string;
  /** The case that was handed off. */
  caseId: string;
  /** Kinde user ID of the outgoing holder. */
  fromUserId: string;
  /** Kinde user ID of the incoming holder. */
  toUserId: string;
  /** Epoch ms when the handoff was recorded. */
  handoffAt: number;
  /** Convex document ID of the custody_handoff audit event. */
  eventId: string;
}

/**
 * Record a custody handoff between two Kinde users for a specific case.
 *
 * This is the primary mutation triggered by the SCAN mobile app custody
 * transfer workflow.  After both parties confirm the handoff on the SCAN app,
 * this mutation is called to make the transfer permanent.
 *
 * What this mutation writes (and why it matters for the dashboard):
 * ┌──────────────────────────────┬─────────────────────────────────────────────┐
 * │ Table / field written        │ Dashboard effect                            │
 * ├──────────────────────────────┼─────────────────────────────────────────────┤
 * │ custodyRecords (new row)     │ useCustodyRecordsByCase / useLatestCustody  │
 * │                              │ hooks re-evaluate → T2 panel updates live  │
 * │ cases.assigneeId             │ M2 (assigneeId filter) re-evaluates;        │
 * │                              │ M1/M3 assigneeId filter updates             │
 * │ cases.assigneeName           │ M2 case pin tooltip shows new custodian     │
 * │ cases.lat / .lng             │ All modes withinBounds() — only when        │
 * │                              │ location is provided                        │
 * │ cases.locationName           │ Map pin location label (when provided)      │
 * │ cases.updatedAt              │ M1 by_updated sort index; "N min ago" UI    │
 * │ events "custody_handoff"     │ T5 immutable audit timeline milestone        │
 * │                              │ getCaseAssignmentLayout (T2) re-evaluates  │
 * └──────────────────────────────┴─────────────────────────────────────────────┘
 *
 * Real-time fidelity:
 *   Convex re-evaluates all subscribed queries that read the touched rows
 *   within ~100–300 ms — including:
 *     • getCustodyRecordsByCase / getLatestCustodyRecord  (T2 sidebar)
 *     • getCaseAssignmentLayout                           (T2 layout)
 *     • listCases / getCaseStatus                        (M1–M5 map pins)
 *     • getM2MissionMode                                 (M2 assignment map)
 *   This satisfies the ≤ 2-second real-time fidelity requirement between the
 *   SCAN app handoff action and the INVENTORY dashboard visibility.
 *
 * M2 triggering mechanism:
 *   The M2 assembler (assembleM2) builds its case pin list from cases table rows
 *   and uses cases.assigneeName for pin tooltips.  Patching cases.assigneeId,
 *   cases.assigneeName, and cases.updatedAt causes Convex to invalidate all
 *   subscriptions reading from cases — including getM2MissionMode — and push
 *   the updated response to connected dashboard clients.
 *
 * T2 triggering mechanism:
 *   getCaseAssignmentLayout reads both cases and custodyRecords.  Inserting a
 *   new custodyRecords row AND patching cases triggers both dependencies, so
 *   the T2 panel receives a live update within the Convex reactive window.
 *
 * @param caseId           Convex document ID of the case being transferred.
 * @param fromUserId       Kinde user ID of the outgoing custody holder.
 * @param fromUserName     Display name of the outgoing holder (for UI display).
 * @param toUserId         Kinde user ID of the incoming custody holder.
 * @param toUserName       Display name of the incoming holder.
 * @param handoffAt        Epoch ms when the handoff occurred (provided by the
 *                         SCAN app at confirmation time).  Written as
 *                         custodyRecords.transferredAt and events.timestamp.
 * @param lat              Optional GPS latitude of the handoff location.
 *                         Written to cases.lat for map mode withinBounds() checks.
 * @param lng              Optional GPS longitude of the handoff location.
 * @param locationName     Human-readable location label (e.g. "Site Alpha Gate").
 *                         Written to cases.locationName for map pin tooltips.
 * @param notes            Optional free-text notes entered by the technician at
 *                         handoff time.  Written to custodyRecords.notes.
 * @param signatureStorageId  Optional Convex file storage ID for a captured
 *                         signature image from the SCAN app signing pad.
 *
 * @throws When the case is not found.
 *
 * Client usage (SCAN app custody transfer confirmation screen):
 *   const handoff = useHandoffCustody();
 *
 *   try {
 *     const result = await handoff({
 *       caseId:        resolvedCase._id,
 *       fromUserId:    currentUser.id,
 *       fromUserName:  currentUser.fullName,
 *       toUserId:      recipientUser.id,
 *       toUserName:    recipientUser.fullName,
 *       handoffAt:     Date.now(),
 *       lat:           position.coords.latitude,
 *       lng:           position.coords.longitude,
 *       locationName:  "Site Alpha — Turbine Row 3",
 *       notes:         "All items verified, case intact",
 *     });
 *     // result.custodyRecordId → new custodyRecords row
 *     // result.eventId         → new events row (custody_handoff)
 *   } catch (err) {
 *     // "Case X not found."
 *   }
 */
export const handoffCustody = mutation({
  args: {
    /**
     * Convex ID of the case being transferred between users.
     * The case's assigneeId and assigneeName are updated to the new custodian
     * so M2 (Assignment Map Mode) map pins reflect the change immediately.
     */
    caseId: v.id("cases"),

    /**
     * Kinde user ID of the person relinquishing custody.
     * Written to custodyRecords.fromUserId and the audit event payload.
     */
    fromUserId: v.string(),

    /**
     * Display name of the outgoing custody holder.
     * Written to custodyRecords.fromUserName for dashboard display.
     */
    fromUserName: v.string(),

    /**
     * Kinde user ID of the person receiving custody.
     * Written to custodyRecords.toUserId AND cases.assigneeId so the M2
     * assignment map and T2 layout query reflect the new custodian live.
     */
    toUserId: v.string(),

    /**
     * Display name of the incoming custody holder.
     * Written to custodyRecords.toUserName AND cases.assigneeName so M2
     * case pin tooltips and the T2 panel "Currently held by" field update.
     */
    toUserName: v.string(),

    /**
     * Epoch ms timestamp of the handoff.
     * Written to:
     *   • custodyRecords.transferredAt  — indexed for audit chain ordering
     *   • events.timestamp              — immutable audit trail timestamp
     *   • cases.updatedAt               — M1 by_updated sort index
     */
    handoffAt: v.number(),

    /**
     * Optional GPS latitude of the handoff location.
     * Written to cases.lat — used by all map modes' withinBounds() check.
     * Only written when provided; preserves last known position otherwise.
     */
    lat: v.optional(v.number()),

    /**
     * Optional GPS longitude of the handoff location.
     * Written to cases.lng — used by all map modes' withinBounds() check.
     */
    lng: v.optional(v.number()),

    /**
     * Human-readable location label (e.g. "Site Alpha Gate 3").
     * Written to cases.locationName for map pin tooltips and T2 display.
     */
    locationName: v.optional(v.string()),

    /**
     * Optional free-text notes entered by the field technician at handoff.
     * Written to custodyRecords.notes for display in the T2/T5 panels.
     */
    notes: v.optional(v.string()),

    /**
     * Optional Convex file storage ID for a signature captured in the SCAN
     * app signing pad.  Written to custodyRecords.signatureStorageId.
     * Resolve to a download URL client-side via the useStorageURL hook.
     */
    signatureStorageId: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<HandoffCustodyResult> => {
    const now = args.handoffAt;

    // ── Verify the case exists ────────────────────────────────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(`Case ${args.caseId} not found.`);
    }

    // ── Insert custody record ─────────────────────────────────────────────────
    // This is the primary write that satisfies the AC data contract:
    //   caseId, fromUserId, toUserId, handoffAt (→ transferredAt), location
    //
    // Inserting a new row invalidates all subscribed queries that read from
    // custodyRecords (getCustodyRecordsByCase, getLatestCustodyRecord,
    // getCustodyChain, listAllCustodyTransfers) — pushing live updates to the
    // T2 dashboard panel and SCAN app confirmation screen.
    const custodyRecordId = await ctx.db.insert("custodyRecords", {
      caseId:             args.caseId,
      fromUserId:         args.fromUserId,
      fromUserName:       args.fromUserName,
      toUserId:           args.toUserId,
      toUserName:         args.toUserName,
      transferredAt:      now,                    // handoffAt maps to transferredAt
      notes:              args.notes,
      signatureStorageId: args.signatureStorageId,
    });

    // ── Patch the case with the new custodian ─────────────────────────────────
    // Writing assigneeId / assigneeName is what triggers M2 (Assignment Map Mode)
    // and M1/M3 assigneeId filter re-evaluation:
    //
    //   cases.assigneeId   → M2 assembleM2 reads assigneeName on case pins;
    //                        M1/M3 assigneeId filter ("show my cases" view)
    //   cases.assigneeName → M2 mission group case list; M1/M3 pin tooltips
    //   cases.updatedAt    → M1 by_updated sort index; "N min ago" freshness
    //
    // Location fields are patched conditionally — only overwrite when the SCAN
    // app provided a GPS fix, preserving the last known position otherwise.
    const casePatch: Record<string, unknown> = {
      assigneeId:   args.toUserId,
      assigneeName: args.toUserName,
      updatedAt:    now,
    };

    if (args.lat          !== undefined) casePatch.lat          = args.lat;
    if (args.lng          !== undefined) casePatch.lng          = args.lng;
    if (args.locationName !== undefined) casePatch.locationName = args.locationName;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(args.caseId, casePatch as any);

    // ── Append immutable audit event ──────────────────────────────────────────
    // The events table is append-only.  custody_handoff events are read by:
    //   • T5 hash-chain audit panel — getCaseAuditEvents / getCustodyChain
    //   • getCaseAssignmentLayout   — T2 layout "recent events" section
    //
    // The data payload mirrors the custodyRecords fields so the T5 panel can
    // reconstruct the handoff without joining custodyRecords.
    const eventId = await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "custody_handoff",
      userId:    args.fromUserId,
      userName:  args.fromUserName,
      timestamp: now,
      data: {
        custodyRecordId: custodyRecordId.toString(),
        fromUserId:      args.fromUserId,
        fromUserName:    args.fromUserName,
        toUserId:        args.toUserId,
        toUserName:      args.toUserName,
        handoffAt:       now,
        lat:             args.lat,
        lng:             args.lng,
        locationName:    args.locationName,
        notes:           args.notes,
        signatureStorageId: args.signatureStorageId,
      },
    });

    // ── In-app notification for the incoming custodian ────────────────────────
    // Per constraints: in-app notifications only (no push, no email).
    // The recipient (toUserId) sees a notification in their dashboard inbox
    // alerting them that they now have custody of the case.
    await ctx.db.insert("notifications", {
      userId:    args.toUserId,
      type:      "custody_handoff",
      title:     `Custody transferred: ${caseDoc.label}`,
      message:   `${args.fromUserName} transferred custody of case "${caseDoc.label}" to you` +
                 (args.locationName ? ` at ${args.locationName}` : "") +
                 (args.notes ? `. Note: ${args.notes}` : "."),
      caseId:    args.caseId,
      read:      false,
      createdAt: now,
    });

    return {
      custodyRecordId: custodyRecordId.toString(),
      caseId:          args.caseId,
      fromUserId:      args.fromUserId,
      toUserId:        args.toUserId,
      handoffAt:       now,
      eventId:         eventId.toString(),
    };
  },
});
