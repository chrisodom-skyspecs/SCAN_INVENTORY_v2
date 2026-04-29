/**
 * src/hooks/use-custody.ts
 *
 * Convex `useQuery` hooks for real-time custody handoff record subscriptions.
 *
 * Architecture
 * ────────────
 * Each hook is a thin wrapper around `useQuery` (from convex/react) that
 * subscribes to the corresponding public query function in convex/custody.ts.
 * Convex's reactive transport layer pushes updates from the server to all
 * active subscriptions within ~100–300 ms of a mutation, satisfying the
 * ≤ 2-second real-time fidelity requirement.
 *
 * When a SCAN app field technician or pilot completes a custody handoff via the
 * SCAN app transfer workflow, the mutation appends a new `custodyRecords` row
 * and emits a `custody_handoff` event to the audit trail.  Convex automatically
 * re-evaluates all subscribed custody queries and pushes the diff to connected
 * dashboard sessions — no polling, no manual refetching.
 *
 * Loading / error states
 * ──────────────────────
 * `useQuery` returns:
 *   • `undefined`  — query is loading (initial fetch or reconnect)
 *   • `null`       — query returned null (only for nullable return types)
 *   • `T`          — successful result
 *
 * All hooks propagate this convention unchanged.  Components should guard
 * against `undefined` (show skeleton) and null/empty (show empty state).
 *
 * Skip pattern
 * ────────────
 * Passing `"skip"` as the second argument to `useQuery` suppresses the
 * subscription entirely.  All hooks that accept a nullable ID use `"skip"`
 * when the value is `null`, avoiding unnecessary Convex traffic while no case
 * or user is selected.
 *
 * Available hooks (case-scoped):
 *   useCustodyRecordsByCase(caseId)
 *     All custody handoffs for a specific case, sorted by transferredAt desc
 *     (most recent handoff first).  Primary hook for the dashboard T5 panel
 *     custody tab and the SCAN app post-handoff confirmation screen.
 *
 *   useLatestCustodyRecord(caseId)
 *     Single most recent custody record for a case, or null if none exists.
 *     Used for "currently held by" display in case sidebar and map pin
 *     tooltips.
 *
 *   useCustodyChain(caseId)
 *     Full chronological custody chain for a case (ascending order).
 *     Used for the T5 hash-chain audit panel and compliance reports.
 *
 * Available hooks (custodian identity-scoped):
 *   useCustodyRecordsByCustodian(userId)
 *     All records where this user is the incoming holder (toUserId).
 *     Used for SCAN app "My Cases" received history list.
 *
 *   useCustodyRecordsByTransferrer(userId)
 *     All records where this user is the outgoing holder (fromUserId).
 *     Used for SCAN app "My Activity" tab and admin audit views.
 *
 *   useCustodyRecordsByParticipant(userId)
 *     All records where the user appears as either sender or receiver.
 *     Full custody activity history for a user — admin investigation view.
 *
 *   useCustodianIdentitySummary(userId)
 *     Summary of which cases a user currently holds and their transfer stats.
 *     Used for "My Cases" badge count and admin user profile chip.
 *
 * Available hooks (fleet-wide):
 *   useAllCustodyTransfers(options?)
 *     Fleet-wide custody transfers across all cases, with optional date-range
 *     filter.  Used by the dashboard global custody overview panel and
 *     compliance reporting views.
 *
 *   useCustodyTransferSummary(options?)
 *     Aggregate fleet-wide transfer counts and activity metadata.  Used by
 *     the dashboard header metrics and operations overview.
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Re-export types so consumers can import them from the hook module.
export type {
  CustodyRecord,
  CustodyTransferSummary,
  CustodianIdentitySummary,
} from "../../convex/custodyHelpers";

// ─── useCustodyRecordsByCase ──────────────────────────────────────────────────

/**
 * Subscribe to all custody handoff records for a specific case.
 *
 * Returns every handoff recorded for the case, sorted by `transferredAt`
 * descending (most recent handoff at index 0).  Convex pushes an update to all
 * subscribers within ~100–300 ms whenever the SCAN app completes a new custody
 * transfer, satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Use cases:
 *   • INVENTORY dashboard T5 panel — custody chain tab
 *   • SCAN app post-handoff confirmation — "Handoff recorded" screen
 *   • Case detail sidebar — custody history list
 *
 * Pass `null` as `caseId` to skip the subscription (no case selected).
 *
 * Return values:
 *   `undefined`          — loading (show skeleton)
 *   `CustodyRecord[]`    — live custody record list (may be empty array)
 *
 * @example
 * function CustodyHistoryPanel({ caseId }: { caseId: string | null }) {
 *   const records = useCustodyRecordsByCase(caseId);
 *
 *   if (records === undefined) return <CustodySkeleton />;
 *   if (records.length === 0) return <NoCustodyMessage />;
 *
 *   return (
 *     <ul>
 *       {records.map((record) => (
 *         <CustodyHandoffRow key={record._id} record={record} />
 *       ))}
 *     </ul>
 *   );
 * }
 */
export function useCustodyRecordsByCase(caseId: string | null) {
  return useQuery(
    api.custody.getCustodyRecordsByCase,
    caseId !== null ? { caseId: caseId as Id<"cases"> } : "skip",
  );
}

// ─── useLatestCustodyRecord ───────────────────────────────────────────────────

/**
 * Subscribe to the most recent custody handoff record for a case.
 *
 * Returns a single `CustodyRecord` for the last recorded handoff, or `null`
 * if the case has never had a custody transfer.  This is the lightest-weight
 * custody subscription — it transfers only one record rather than the full
 * history, making it ideal for:
 *   • Dashboard case sidebar — "Currently held by: [name]" chip
 *   • Map pin tooltip — current custodian badge
 *   • SCAN app case overview — confirming the current holder before initiating
 *     a new transfer
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`         — loading (show skeleton)
 *   `null`              — no custody records exist (case never transferred)
 *   `CustodyRecord`     — the most recent completed handoff
 *
 * @example
 * function CurrentCustodianChip({ caseId }: { caseId: string | null }) {
 *   const latest = useLatestCustodyRecord(caseId);
 *
 *   if (latest === undefined) return <Spinner />;
 *   if (latest === null) return <span>No custody recorded</span>;
 *
 *   return (
 *     <StatusPill kind="custody">
 *       {latest.toUserName}
 *     </StatusPill>
 *   );
 * }
 */
export function useLatestCustodyRecord(caseId: string | null) {
  return useQuery(
    api.custody.getLatestCustodyRecord,
    caseId !== null ? { caseId: caseId as Id<"cases"> } : "skip",
  );
}

// ─── useCustodyChain ──────────────────────────────────────────────────────────

/**
 * Subscribe to the full chronological custody chain for a case.
 *
 * Returns all handoff records in ascending `transferredAt` order — oldest
 * transfer at index 0, most recent at the last index.  This provides the
 * complete chain-of-custody audit trail in the order events occurred.
 *
 * Unlike `useCustodyRecordsByCase` (descending for dashboard UX), this hook
 * returns ascending order so components can iterate from first to last holder
 * without reversing the array.  Intended for:
 *   • T5 hash-chain audit panel — custody chain section (FF_AUDIT_HASH_CHAIN)
 *   • Compliance chain-of-custody report generation
 *   • Admin investigation view — tracing case ownership over time
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`          — loading (show skeleton)
 *   `CustodyRecord[]`    — chronologically ordered chain (may be empty array)
 *
 * @example
 * function CustodyAuditTimeline({ caseId }: { caseId: string | null }) {
 *   const chain = useCustodyChain(caseId);
 *
 *   if (chain === undefined) return <TimelineSkeleton />;
 *   if (chain.length === 0) return <NoCustodyMessage />;
 *
 *   return (
 *     <ol>
 *       {chain.map((record, index) => (
 *         <CustodyChainStep
 *           key={record._id}
 *           record={record}
 *           step={index + 1}
 *           isFirst={index === 0}
 *           isLast={index === chain.length - 1}
 *         />
 *       ))}
 *     </ol>
 *   );
 * }
 */
export function useCustodyChain(caseId: string | null) {
  return useQuery(
    api.custody.getCustodyChain,
    caseId !== null ? { caseId: caseId as Id<"cases"> } : "skip",
  );
}

// ─── useAllCustodyTransfers ───────────────────────────────────────────────────

/**
 * Subscribe to all custody transfers across the entire fleet.
 *
 * Returns every handoff across all cases, sorted by `transferredAt` descending
 * (most recent activity first).  Supports optional date-range filtering so the
 * operations team can scope the view to a specific reporting period.
 *
 * Use cases:
 *   • INVENTORY dashboard global custody overview (no case selected)
 *   • Compliance reporting — all transfers within a date window
 *   • Operations supervisor reviewing daily handoff activity
 *
 * This hook is typically always active when the dashboard is open with no case
 * selected (fleet-overview mode).  The skip pattern is not applied here because
 * there is no nullable filter argument — fleet-wide queries are always valid.
 *
 * Options:
 *   `since`  — only include transfers at or after this epoch ms timestamp
 *   `until`  — only include transfers at or before this epoch ms timestamp
 *
 * Return values:
 *   `undefined`          — loading (show skeleton)
 *   `CustodyRecord[]`    — live fleet-wide transfer list (may be empty array)
 *
 * @example
 * // All fleet transfers (no filter)
 * function FleetCustodyPanel() {
 *   const transfers = useAllCustodyTransfers();
 *   if (transfers === undefined) return <CustodySkeleton />;
 *   return <CustodyTransferList records={transfers} />;
 * }
 *
 * @example
 * // Today's transfers only
 * function TodayTransfersPanel() {
 *   const startOfDay = new Date();
 *   startOfDay.setHours(0, 0, 0, 0);
 *   const transfers = useAllCustodyTransfers({ since: startOfDay.getTime() });
 *   if (transfers === undefined) return <CustodySkeleton />;
 *   return <CustodyTransferList records={transfers} />;
 * }
 */
export function useAllCustodyTransfers(
  options: { since?: number; until?: number } = {},
) {
  return useQuery(api.custody.listAllCustodyTransfers, {
    since: options.since,
    until: options.until,
  });
}

// ─── useCustodyTransferSummary ────────────────────────────────────────────────

/**
 * Subscribe to aggregate custody transfer statistics across the fleet.
 *
 * Returns high-level counts and activity metadata for the fleet-wide custody
 * overview.  Suitable for dashboard header metrics and quick health checks.
 * Significantly lighter than `useAllCustodyTransfers` when only aggregate
 * numbers are needed — one object instead of a full record array.
 *
 * Use cases:
 *   • Dashboard header chip: "N handoffs today"
 *   • Operations supervisor widget: most active recipient by name
 *   • Alerting heuristic: `totalTransfers === 0` on a day with expected activity
 *
 * Accepts the same `since` / `until` filter as `useAllCustodyTransfers` to
 * scope statistics to a reporting period (e.g., today, this week).
 *
 * Return values:
 *   `undefined`                  — loading (show skeleton)
 *   `CustodyTransferSummary`     — live aggregate transfer stats
 *
 * @example
 * function DailyHandoffMetric() {
 *   const startOfDay = new Date();
 *   startOfDay.setHours(0, 0, 0, 0);
 *   const summary = useCustodyTransferSummary({ since: startOfDay.getTime() });
 *
 *   if (!summary) return null;
 *
 *   return (
 *     <span>
 *       {summary.totalTransfers} handoffs today
 *       {summary.mostActiveTo && ` · most: ${summary.mostActiveTo.userName}`}
 *     </span>
 *   );
 * }
 */
export function useCustodyTransferSummary(
  options: { since?: number; until?: number } = {},
) {
  return useQuery(api.custody.getCustodyTransferSummary, {
    since: options.since,
    until: options.until,
  });
}

// ─── useCustodyRecordsByCustodian ─────────────────────────────────────────────

/**
 * Subscribe to all custody records where a specific user is the incoming
 * custody holder (`toUserId`).
 *
 * Returns every record where this user received a case, sorted by
 * `transferredAt` descending (most recent receipt first).  Backed by the
 * `by_to_user` index for O(log n) lookup.
 *
 * Use cases:
 *   • SCAN app "My Cases" received list — all cases ever assigned to the user
 *   • INVENTORY admin custody audit — inbound handoffs for a specific user
 *   • Pre-handoff confirmation — confirm user is the current assignee
 *
 * Note: includes cases the user may have subsequently transferred away.
 * Use `useCustodianIdentitySummary` to determine current holders only.
 *
 * Pass `null` as `userId` to skip the subscription.
 *
 * Return values:
 *   `undefined`          — loading (show skeleton)
 *   `CustodyRecord[]`    — live list (may be empty array)
 *
 * @example
 * function MyCasesReceivedList({ userId }: { userId: string | null }) {
 *   const records = useCustodyRecordsByCustodian(userId);
 *
 *   if (records === undefined) return <Skeleton />;
 *   if (records.length === 0) return <span>No cases received yet</span>;
 *
 *   return <CustodyRecordList records={records} />;
 * }
 */
export function useCustodyRecordsByCustodian(userId: string | null) {
  return useQuery(
    api.custody.getCustodyRecordsByCustodian,
    userId !== null ? { userId } : "skip",
  );
}

// ─── useCustodyRecordsByTransferrer ───────────────────────────────────────────

/**
 * Subscribe to all custody records where a specific user is the outgoing
 * custody holder (`fromUserId`).
 *
 * Returns every record where this user transferred a case to someone else,
 * sorted by `transferredAt` descending (most recent transfer-out first).
 * Backed by the `by_from_user` index for O(log n) lookup.
 *
 * Use cases:
 *   • SCAN app "Transfer History" — "Cases I've handed off"
 *   • INVENTORY admin — auditing all handoffs initiated by a user
 *   • Compliance verification — confirm user relinquished custody properly
 *
 * Pass `null` as `userId` to skip the subscription.
 *
 * Return values:
 *   `undefined`          — loading (show skeleton)
 *   `CustodyRecord[]`    — live list (may be empty array)
 *
 * @example
 * function MyTransferHistoryList({ userId }: { userId: string | null }) {
 *   const records = useCustodyRecordsByTransferrer(userId);
 *
 *   if (records === undefined) return <Skeleton />;
 *   if (records.length === 0) return <span>No transfers initiated</span>;
 *
 *   return <CustodyRecordList records={records} />;
 * }
 */
export function useCustodyRecordsByTransferrer(userId: string | null) {
  return useQuery(
    api.custody.getCustodyRecordsByTransferrer,
    userId !== null ? { userId } : "skip",
  );
}

// ─── useCustodyRecordsByParticipant ───────────────────────────────────────────

/**
 * Subscribe to all custody records where a specific user participated as
 * either the outgoing or incoming holder.
 *
 * Returns the union of records from the `by_to_user` and `by_from_user` index
 * scans, deduplicated and sorted by `transferredAt` descending.
 *
 * This is the most comprehensive custodian identity query — the full
 * transaction history for a user regardless of whether they sent or received.
 *
 * Use cases:
 *   • INVENTORY admin full audit view — "all custody activity for user X"
 *   • SCAN app "My Activity" — combined received + transferred history
 *   • Compliance investigation — "every handoff involving user X"
 *
 * Pass `null` as `userId` to skip the subscription.
 *
 * Return values:
 *   `undefined`          — loading (show skeleton)
 *   `CustodyRecord[]`    — live list (may be empty array)
 *
 * @example
 * function UserCustodyActivityFeed({ userId }: { userId: string | null }) {
 *   const records = useCustodyRecordsByParticipant(userId);
 *
 *   if (records === undefined) return <Skeleton />;
 *   if (records.length === 0) return <span>No custody activity</span>;
 *
 *   return <CustodyActivityFeed records={records} userId={userId!} />;
 * }
 */
export function useCustodyRecordsByParticipant(userId: string | null) {
  return useQuery(
    api.custody.getCustodyRecordsByParticipant,
    userId !== null ? { userId } : "skip",
  );
}

// ─── useCustodianIdentitySummary ──────────────────────────────────────────────

/**
 * Subscribe to a custodian identity summary for a specific user.
 *
 * Returns which cases the user currently holds, a count, and lifetime
 * received/transferred totals.  "Currently holds" means the user is the
 * `toUserId` on the most recent custody record for each case they appear in.
 *
 * This is the primary hook for:
 *   • SCAN app "My Cases" badge — `summary.currentCaseCount` badge on the tab
 *   • INVENTORY dashboard user chip — "Currently holds N cases"
 *   • Admin user profile — received total, transferred total
 *
 * Pass `null` as `userId` to skip the subscription.
 *
 * Return values:
 *   `undefined`                   — loading (show skeleton)
 *   `CustodianIdentitySummary`    — live summary
 *
 * @example
 * function MyCasesBadge({ userId }: { userId: string | null }) {
 *   const summary = useCustodianIdentitySummary(userId);
 *
 *   if (!summary) return null;
 *
 *   return (
 *     <span className="badge">
 *       {summary.currentCaseCount}
 *     </span>
 *   );
 * }
 */
export function useCustodianIdentitySummary(userId: string | null) {
  return useQuery(
    api.custody.getCustodianIdentitySummary,
    userId !== null ? { userId } : "skip",
  );
}
