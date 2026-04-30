/**
 * src/hooks/use-qc-sign-off.ts
 *
 * Convex `useQuery` hooks for real-time QC (quality-control) sign-off
 * subscriptions.
 *
 * Architecture
 * ────────────
 * Each hook is a thin wrapper around `useQuery` (from convex/react) that
 * subscribes to the corresponding public query function in
 * convex/queries/qcSignOff.ts.  Convex's reactive transport layer pushes
 * updates from the server to all active subscriptions within ~100–300 ms
 * of any `submitQcSignOff` / `addQcSignOff` mutation, satisfying the
 * ≤ 2-second real-time fidelity requirement between a SCAN app action and
 * INVENTORY dashboard visibility — without any polling or manual refresh.
 *
 * When an operator submits a QC sign-off in the INVENTORY dashboard or the
 * SCAN app, the mutation atomically writes to `qcSignOffs`, `cases`, and
 * `events`; Convex re-evaluates all subscribed queries touching those tables
 * and pushes the diff to every connected client within ~100–300 ms.
 *
 * Loading / error states
 * ──────────────────────
 * `useQuery` returns:
 *   • `undefined` — query is loading (initial fetch or reconnect)
 *   • `null`      — query returned null (no sign-off exists, or item not found)
 *   • `T`         — successful result
 *
 * All hooks propagate this convention unchanged.  Components should guard
 * against `undefined` (show skeleton) and `null` (show empty / no-decision
 * state).
 *
 * Skip pattern
 * ────────────
 * All hooks that accept a nullable `caseId` pass `"skip"` to `useQuery`
 * when the value is `null`, suppressing the Convex subscription entirely
 * when no case is selected (avoids unnecessary network traffic).
 *
 * Available hooks
 * ───────────────
 *   useQcSignOffByCaseId(caseId)
 *     Latest QC sign-off record for a single case.
 *     Returns `null` when no sign-off has been submitted.
 *     PRIMARY hook for the T3 QC Sign-off form `currentStatus` prop and
 *     the T1 Summary panel QC status badge.
 *
 *   useQcSignOffHistory(caseId, limit?)
 *     Full chronological QC sign-off history for a case, newest first.
 *     Used by the T5 Audit panel QC history section.
 *
 *   useQcSignOffsByStatus(status, limit?)
 *     All sign-off records fleet-wide with a given status.
 *     Used by the QC review queue dashboard ("cases pending review").
 *
 *   useQcSignOffsByCaseIds(caseIds)
 *     Batch lookup of latest QC state for multiple cases.
 *     Used by the M1 fleet overview map to show QC badges on many pins
 *     without issuing N separate subscriptions.
 *
 * Client usage (T3Inspection panel — QC sign-off status):
 *
 *   import { useQcSignOffByCaseId } from "@/hooks/use-qc-sign-off";
 *
 *   function T3Inspection({ caseId }: { caseId: string }) {
 *     // Real-time QC state — updates within ~100–300 ms of any sign-off
 *     const qcSignOff = useQcSignOffByCaseId(caseId);
 *
 *     if (qcSignOff === undefined) return <QcStatusSkeleton />;
 *     // qcSignOff === null   → no prior decision
 *     // qcSignOff.status     → "pending" | "approved" | "rejected"
 *
 *     return (
 *       <QcSignOffForm
 *         caseId={caseId}
 *         currentStatus={qcSignOff?.status ?? null}
 *       />
 *     );
 *   }
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// ─── Type aliases ─────────────────────────────────────────────────────────────
//
// These mirror the fields of the `qcSignOffs` table row as defined in
// convex/schema.ts.  Typed here to avoid importing from generated types
// that may not expose the row shape directly.

/** Union of all valid QC sign-off decision statuses. */
export type QcSignOffStatus = "pending" | "approved" | "rejected";

/**
 * A single QC sign-off row as returned by the Convex query functions.
 *
 * Convex document metadata fields (_id, _creationTime) are inherited from
 * the `Doc<"qcSignOffs">` type in the generated data model.  We declare the
 * application fields here as a minimal interface for component type-checking.
 */
export interface QcSignOffRecord {
  /** Convex document ID. */
  _id: string;
  /** Creation timestamp (Convex server). */
  _creationTime: number;
  /** Case this sign-off belongs to. */
  caseId: Id<"cases">;
  /** QC decision: "pending" | "approved" | "rejected". */
  status: QcSignOffStatus;
  /** Kinde user ID of the reviewer. */
  signedOffBy: string;
  /** Display name of the reviewer (denormalized). */
  signedOffByName: string;
  /** Epoch ms when the action was taken. */
  signedOffAt: number;
  /** Optional reviewer notes. Required when status = "rejected". */
  notes?: string;
  /** QC status before this sign-off (for audit diff views). */
  previousStatus?: QcSignOffStatus;
  /** Optional link to the inspection that triggered this QC review. */
  inspectionId?: Id<"inspections">;
}

/**
 * Shape returned by `useQcSignOffsByCaseIds`:
 *   An array of { caseId, signOff } pairs.
 */
export interface QcSignOffByCaseIdEntry {
  /** Convex document ID of the case. */
  caseId: Id<"cases">;
  /**
   * Most recent QC sign-off for the case.
   * `null` when no sign-off has ever been submitted.
   */
  signOff: QcSignOffRecord | null;
}

// ─── Slash-path API accessor ──────────────────────────────────────────────────
//
// The Convex-generated `api` object does not expose slash-path module keys
// (e.g. "queries/qcSignOff") via standard TypeScript bracket notation.
// We cast to `Record<string, any>` for the bracket access.  Runtime behavior
// is correct and fully typed through the explicit return-type annotations on
// each hook.  The same pattern is used in use-shipment-status.ts for
// `api["queries/shipment"].*`.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _apiAny = api as unknown as Record<string, any>;

// ─── useQcSignOffByCaseId ─────────────────────────────────────────────────────

/**
 * Subscribe to the most recent QC sign-off record for a case.
 *
 * This is the PRIMARY hook for wiring QC state into the T3 Inspection panel
 * and the T1 Summary panel.  It subscribes to
 * `api["queries/qcSignOff"].getQcSignOffByCaseId` which uses the
 * `by_case_signed_at` index + `.order("desc").first()` for an O(log n + 1)
 * point lookup.
 *
 * Convex re-evaluates and pushes within ~100–300 ms of any
 * `submitQcSignOff` / `addQcSignOff` call for this case, satisfying the
 * ≤ 2-second real-time fidelity requirement.
 *
 * Pass `null` as `caseId` to skip the subscription (no case selected).
 *
 * Return values:
 *   `undefined`         — loading (initial fetch or reconnect)
 *   `null`              — no QC sign-off has been submitted for this case
 *   `QcSignOffRecord`   — the most recent sign-off decision
 *
 * @param caseId  Convex document ID of the case to watch, or null to skip.
 *
 * @example
 * // T3 Inspection panel — live QC status badge + form
 * function QcStatusSection({ caseId }: { caseId: string | null }) {
 *   const signOff = useQcSignOffByCaseId(caseId);
 *   if (signOff === undefined) return <QcStatusSkeleton />;
 *   return (
 *     <QcSignOffForm
 *       caseId={caseId ?? ""}
 *       currentStatus={signOff?.status ?? null}
 *       hasUnresolvedIssues={false}
 *     />
 *   );
 * }
 *
 * @example
 * // T1 Summary panel — compact QC status chip
 * function QcStatusChip({ caseId }: { caseId: string }) {
 *   const signOff = useQcSignOffByCaseId(caseId);
 *   if (signOff === undefined) return <Skeleton />;
 *   if (!signOff) return <StatusPill kind="pending" />;
 *   return <StatusPill kind={signOff.status === "approved" ? "completed" : "flagged"} />;
 * }
 */
export function useQcSignOffByCaseId(
  caseId: string | null,
): QcSignOffRecord | null | undefined {
  return useQuery(
    _apiAny["queries/qcSignOff"]?.getQcSignOffByCaseId,
    caseId !== null
      ? { caseId: caseId as Id<"cases"> }
      : "skip",
  ) as QcSignOffRecord | null | undefined;
}

// ─── useQcSignOffHistory ──────────────────────────────────────────────────────

/**
 * Subscribe to the full chronological QC sign-off history for a case.
 *
 * Returns an array of `QcSignOffRecord` objects ordered by `signedOffAt`
 * descending (most recent first).  The array is empty when no sign-offs have
 * been submitted for the case.
 *
 * Backed by `api["queries/qcSignOff"].getQcSignOffHistory` which uses the
 * `by_case_signed_at` index for O(log n + |sign-offs|) performance.
 *
 * This is the PRIMARY hook for the T5 Audit panel QC history section.
 * Operators can review the full sequence of QC decisions for a case
 * (e.g., rejected → resubmitted → approved) in chronological order.
 *
 * Convex re-evaluates and pushes within ~100–300 ms of any new sign-off
 * submission, so the history section on the T5 panel updates automatically
 * as operators take QC actions — satisfying the ≤ 2-second real-time
 * fidelity requirement.
 *
 * Pass `null` as `caseId` to skip the subscription.
 * Pass `limit` to cap the number of history entries returned (useful for
 * paginated or truncated history views).
 *
 * Return values:
 *   `undefined`           — loading (initial fetch or reconnect)
 *   `QcSignOffRecord[]`   — full history, newest first (empty array when none)
 *
 * @param caseId  Convex document ID of the case, or null to skip.
 * @param limit   Optional maximum number of history rows to return.
 *
 * @example
 * // T5 Audit panel — QC decision timeline
 * function QcHistoryTimeline({ caseId }: { caseId: string }) {
 *   const history = useQcSignOffHistory(caseId);
 *   if (history === undefined) return <QcHistorySkeleton />;
 *   if (history.length === 0) return <p>No QC actions recorded.</p>;
 *   return (
 *     <ol>
 *       {history.map((record) => (
 *         <li key={record._id}>
 *           <StatusPill kind={record.status === "approved" ? "completed" : "flagged"} />
 *           {record.signedOffByName} · {new Date(record.signedOffAt).toLocaleString()}
 *         </li>
 *       ))}
 *     </ol>
 *   );
 * }
 */
export function useQcSignOffHistory(
  caseId: string | null,
  limit?: number,
): QcSignOffRecord[] | undefined {
  return useQuery(
    _apiAny["queries/qcSignOff"]?.getQcSignOffHistory,
    caseId !== null
      ? { caseId: caseId as Id<"cases">, limit }
      : "skip",
  ) as QcSignOffRecord[] | undefined;
}

// ─── useQcSignOffsByStatus ────────────────────────────────────────────────────

/**
 * Subscribe to all QC sign-off records fleet-wide with a given status.
 *
 * Useful for building the QC review queue on the INVENTORY dashboard:
 *   - `"pending"`  → cases awaiting QC review
 *   - `"rejected"` → cases that need rework and re-submission
 *   - `"approved"` → cases cleared for deployment (recently approved)
 *
 * Backed by `api["queries/qcSignOff"].getQcSignOffsByStatus` which uses the
 * `by_status` index for O(log n + |matching|) performance.
 *
 * Convex re-evaluates and pushes within ~100–300 ms of any sign-off
 * mutation that writes a row with the watched status.
 *
 * Pass `limit` to cap the number of records returned (default server-side: 100).
 *
 * Return values:
 *   `undefined`           — loading (initial fetch or reconnect)
 *   `QcSignOffRecord[]`   — matching sign-offs, newest first
 *
 * @param status  QC sign-off status to filter by.
 * @param limit   Optional maximum records to return.
 *
 * @example
 * // QC review queue — cases pending QC decision
 * function PendingQcQueue() {
 *   const pending = useQcSignOffsByStatus("pending", 50);
 *   if (pending === undefined) return <QueueSkeleton />;
 *   return <QcQueueList records={pending} />;
 * }
 */
export function useQcSignOffsByStatus(
  status: QcSignOffStatus,
  limit?: number,
): QcSignOffRecord[] | undefined {
  return useQuery(
    _apiAny["queries/qcSignOff"]?.getQcSignOffsByStatus,
    { status, limit },
  ) as QcSignOffRecord[] | undefined;
}

// ─── useQcSignOffsByCaseIds ───────────────────────────────────────────────────

/**
 * Batch-subscribe to the latest QC sign-off state for multiple cases.
 *
 * Returns an array of `{ caseId, signOff }` pairs — one entry per requested
 * caseId.  `signOff` is `null` when no sign-off has been submitted for that case.
 *
 * Backed by `api["queries/qcSignOff"].getQcSignOffsByCaseIds` which issues one
 * indexed query per caseId (O(|caseIds| × log n)).  Capped at 50 caseIds
 * server-side to prevent runaway fan-out.
 *
 * PRIMARY hook for the M1 fleet overview map: shows QC status badges on many
 * case pins in a single reactive subscription rather than N separate
 * `useQcSignOffByCaseId` calls.
 *
 * For large fleets (> 200 cases), prefer reading the denormalized
 * `qcSignOffStatus` field directly from `api.cases.listCases` instead —
 * that query already carries per-case QC state with zero extra joins.
 *
 * Convex re-evaluates and pushes within ~100–300 ms of any sign-off mutation
 * for any of the watched case IDs.
 *
 * Return values:
 *   `undefined`                   — loading (initial fetch or reconnect)
 *   `QcSignOffByCaseIdEntry[]`    — latest sign-off per case (signOff may be null)
 *
 * @param caseIds  Array of Convex document IDs to watch (max 50).
 *                 Pass an empty array to skip the subscription.
 *
 * @example
 * // M1 fleet overview map — QC badges on many pins
 * function FleetQcBadges({ caseIds }: { caseIds: string[] }) {
 *   const results = useQcSignOffsByCaseIds(caseIds);
 *   if (results === undefined) return null;
 *   return (
 *     <>
 *       {results.map(({ caseId, signOff }) => (
 *         <QcBadge key={caseId} status={signOff?.status ?? null} />
 *       ))}
 *     </>
 *   );
 * }
 */
export function useQcSignOffsByCaseIds(
  caseIds: string[],
): QcSignOffByCaseIdEntry[] | undefined {
  return useQuery(
    _apiAny["queries/qcSignOff"]?.getQcSignOffsByCaseIds,
    // Skip when the caseIds array is empty — no data to fetch.
    caseIds.length > 0
      ? { caseIds: caseIds as Id<"cases">[] }
      : "skip",
  ) as QcSignOffByCaseIdEntry[] | undefined;
}
