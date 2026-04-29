/**
 * src/hooks/use-case-events.ts
 *
 * Client-side React hooks for the case event timeline queries.
 *
 * These hooks wrap the Convex `useQuery` subscriptions defined in
 * `convex/queries/events.ts` and expose them with SCAN/INVENTORY-friendly
 * semantics.
 *
 * Available hooks
 * ───────────────
 *   useCaseEvents(caseId)
 *     Subscribe to all events for a case in chronological order (ASC).
 *     Primary hook for the T5 audit panel full event timeline.
 *
 *   useCaseEventsByType(caseId, eventTypes)
 *     Subscribe to events filtered to specific types, chronological.
 *     Used for status history, custody chain, inspection log sub-sections.
 *
 *   useLatestCaseEvent(caseId)
 *     Subscribe to the single most recent event for a case.
 *     Used for "last activity" chips in case list rows and map tooltips.
 *
 *   useCaseEventRange(caseId, fromTimestamp, toTimestamp)
 *     Subscribe to events within a timestamp window, chronological.
 *     Used for shift reports and date-range filtered views in T5.
 *
 * Loading state contract (all hooks)
 * ───────────────────────────────────
 *   `undefined` — query is loading (initial fetch or reconnect)
 *   `null`      — only for useLatestCaseEvent when no events exist
 *   `T`         — successful result
 *
 * Skip pattern
 * ────────────
 * All hooks accept a nullable/undefined `caseId`.  When `caseId` is falsy the
 * subscription is suppressed via Convex's `"skip"` sentinel — no network traffic
 * is generated until a case is selected.
 *
 * Real-time fidelity
 * ──────────────────
 * Convex re-evaluates all subscribed queries within ~100–300 ms whenever a SCAN
 * app mutation appends a new event row.  The T5 audit panel and SCAN case history
 * view receive new events (status transitions, custody handoffs, damage reports)
 * without any user interaction — satisfying the ≤ 2-second fidelity requirement.
 *
 * Usage — T5 audit panel (all events):
 *   import { useCaseEvents } from "@/hooks/use-case-events";
 *
 *   function T5AuditTimeline({ caseId }: { caseId: string }) {
 *     const events = useCaseEvents(caseId);
 *     if (events === undefined) return <TimelineSkeleton />;
 *     if (events.length === 0)  return <EmptyTimeline />;
 *     return <EventTimeline events={events} />;
 *   }
 *
 * Usage — status history sub-section:
 *   import { useCaseEventsByType } from "@/hooks/use-case-events";
 *
 *   function StatusHistory({ caseId }: { caseId: string }) {
 *     const events = useCaseEventsByType(caseId, ["status_change"]);
 *     // ...
 *   }
 *
 * Usage — "last activity" chip:
 *   import { useLatestCaseEvent } from "@/hooks/use-case-events";
 *
 *   function LastActivity({ caseId }: { caseId: string }) {
 *     const latest = useLatestCaseEvent(caseId);
 *     if (latest === undefined) return <ActivitySkeleton />;
 *     if (latest === null)      return <span>No activity yet</span>;
 *     return <span>{latest.eventType} by {latest.userName}</span>;
 *   }
 */

"use client";

import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { CaseEvent, CaseEventType } from "../../convex/queries/events";

// Re-export the CaseEvent types so page components only need one import.
export type { CaseEvent, CaseEventType };

/**
 * Number of events loaded per page when using usePaginatedCaseEvents.
 * Matches the AuditLedgerTable's visible row count at typical panel heights.
 */
export const AUDIT_LEDGER_PAGE_SIZE = 20;

// ─── useCaseEvents ────────────────────────────────────────────────────────────

/**
 * Subscribe to all events for a case in chronological order (timestamp ASC).
 *
 * Wraps `api["queries/events"].getCaseEvents`.  Returns every event recorded
 * for the case from oldest (index 0) to newest (index N-1).
 *
 * Returns `undefined` while loading, and an empty array when no events exist.
 * Never returns `null` — the query always returns an array.
 *
 * @param caseId  Convex case ID string (or null/undefined to skip).
 */
export function useCaseEvents(
  caseId: string | null | undefined,
): CaseEvent[] | undefined {
  const result = useQuery(
    (api as unknown as Record<string, any>)["queries/events"]?.getCaseEvents,
    caseId ? { caseId: caseId as Id<"cases"> } : "skip",
  );
  return result;
}

// ─── useCaseEventsByType ──────────────────────────────────────────────────────

/**
 * Subscribe to case events filtered to specific event types, chronological.
 *
 * Wraps `api["queries/events"].getCaseEventsByType`.  Returns only events whose
 * `eventType` is included in the provided `eventTypes` array, ordered by
 * `timestamp` ascending.
 *
 * Common filter combinations:
 *   ["status_change"]                                 — status history tab
 *   ["custody_handoff"]                               — custody chain tab
 *   ["shipped", "delivered"]                          — shipping log tab
 *   ["damage_reported"]                               — damage log tab
 *   ["inspection_started", "inspection_completed"]    — inspection log tab
 *   ["item_checked", "damage_reported", "photo_added"] — checklist activity
 *
 * Returns `undefined` while loading, and an empty array when no matching events
 * exist.  Throws on the server when `eventTypes` is empty — pass at least one
 * type.
 *
 * @param caseId      Convex case ID string (or null/undefined to skip).
 * @param eventTypes  Non-empty array of event types to include.
 */
export function useCaseEventsByType(
  caseId: string | null | undefined,
  eventTypes: CaseEventType[],
): CaseEvent[] | undefined {
  const result = useQuery(
    (api as unknown as Record<string, any>)["queries/events"]
      ?.getCaseEventsByType,
    caseId && eventTypes.length > 0
      ? { caseId: caseId as Id<"cases">, eventTypes }
      : "skip",
  );
  return result;
}

// ─── useLatestCaseEvent ───────────────────────────────────────────────────────

/**
 * Subscribe to the most recent event recorded for a case.
 *
 * Wraps `api["queries/events"].getLatestCaseEvent`.  Returns the single event
 * with the highest `timestamp` value, or `null` when no events have been
 * recorded (brand-new case).
 *
 * Use for "last activity" chips in case list rows, map pin tooltips, and the
 * SCAN app case card subtitle.
 *
 * Returns `undefined` while loading, `null` when no events exist, or the
 * most recent `CaseEvent`.
 *
 * @param caseId  Convex case ID string (or null/undefined to skip).
 */
export function useLatestCaseEvent(
  caseId: string | null | undefined,
): CaseEvent | null | undefined {
  const result = useQuery(
    (api as unknown as Record<string, any>)["queries/events"]
      ?.getLatestCaseEvent,
    caseId ? { caseId: caseId as Id<"cases"> } : "skip",
  );
  return result;
}

// ─── useCaseEventRange ────────────────────────────────────────────────────────

/**
 * Subscribe to case events within an inclusive timestamp window, chronological.
 *
 * Wraps `api["queries/events"].getCaseEventRange`.  Returns events whose
 * `timestamp` falls within [fromTimestamp, toTimestamp], ordered ascending.
 *
 * Useful for:
 *   • T5 audit panel date-range filter
 *   • Shift activity reports (all events during an 8-hour shift)
 *   • Operations monitoring ("any events in the last 15 minutes?")
 *
 * Returns `undefined` while loading, and an empty array when no events fall
 * within the window.  Subscription is skipped when `caseId` is falsy OR when
 * `fromTimestamp > toTimestamp` (invalid window — the server guard also handles
 * this but we skip early to avoid unnecessary traffic).
 *
 * @param caseId         Convex case ID string (or null/undefined to skip).
 * @param fromTimestamp  Inclusive lower bound (epoch ms).  Pass 0 for open start.
 * @param toTimestamp    Inclusive upper bound (epoch ms).
 */
export function useCaseEventRange(
  caseId: string | null | undefined,
  fromTimestamp: number,
  toTimestamp: number,
): CaseEvent[] | undefined {
  const shouldSkip =
    !caseId ||
    fromTimestamp > toTimestamp;

  const result = useQuery(
    (api as unknown as Record<string, any>)["queries/events"]
      ?.getCaseEventRange,
    shouldSkip
      ? "skip"
      : {
          caseId: caseId as Id<"cases">,
          fromTimestamp,
          toTimestamp,
        },
  );
  return result;
}

// ─── usePaginatedCaseEvents ───────────────────────────────────────────────────

/**
 * Optional filter parameters for `usePaginatedCaseEvents`.
 *
 * All fields are optional — omitting a field means no filter is applied for
 * that dimension.  Empty string values are treated as "no filter".
 *
 * Sub-AC 4: these filters are passed directly to `getCaseEventsPaginated` on
 * the server.  Convex evaluates all filters server-side after the index scan.
 * When any filter value changes, Convex's usePaginatedQuery automatically
 * resets the cursor to page 1 — the table always shows the correct filtered
 * result from the beginning with no stale-cursor issues.
 */
export interface PaginatedCaseEventsFilters {
  /**
   * Inclusive lower bound for timestamp filtering (epoch ms).
   * Pass undefined to include all events from the beginning of the case's
   * history.  Convert a "YYYY-MM-DD" date string to epoch ms via
   * `new Date(dateFrom + "T00:00:00").getTime()` before passing.
   */
  fromTimestamp?: number;
  /**
   * Inclusive upper bound for timestamp filtering (epoch ms).
   * Pass undefined to include all events up to the current moment.  Convert
   * a "YYYY-MM-DD" date string to end-of-day epoch ms via
   * `new Date(dateTo + "T23:59:59.999").getTime()` before passing.
   */
  toTimestamp?: number;
  /**
   * Exact match on actor display name (userName field).
   * Empty string or undefined means "show all actors".
   */
  actorName?: string;
  /**
   * Exact match on event type discriminant key (e.g. "status_change", "shipped").
   * Empty string or undefined means "show all event types".
   */
  eventType?: string;
  /**
   * Substring search on the caseId string representation.
   * Since all events in the paginated view share the same caseId (they are
   * queried by caseId), this filter returns empty results when the search term
   * does not appear in the current case's ID string.
   * Empty string or undefined means no filtering.
   */
  caseIdSearch?: string;
}

/**
 * Paginated subscription to the immutable audit log for a case (newest first).
 *
 * Wraps `api["queries/events"].getCaseEventsPaginated` via Convex's
 * `usePaginatedQuery` hook.  Returns events from the `events` table in
 * descending timestamp order — most recent action at index 0.
 *
 * This is the primary data-fetching hook for the T5 Audit Ledger table.  Wire
 * the returned `results` into `<AuditLedgerTable rows={results.map(eventToRow)} />`
 * and use `status` + `loadMore` to drive pagination controls.
 *
 * Sub-AC 4: the optional `filters` parameter is passed to the Convex server
 * query.  When filter values change, Convex automatically resets pagination to
 * page 1 — the table reactively shows the correct filtered subset in real time
 * as any filter value changes.  The reactive loop:
 *   Filter change → args change → usePaginatedQuery resets cursor → Convex
 *   re-evaluates getCaseEventsPaginated with new filters → pushes updated page
 *   → React re-renders AuditLedgerTable within ~100–300 ms.
 *
 * Pagination state:
 *   status === "LoadingFirstPage" — first page is in-flight → render skeleton
 *   status === "CanLoadMore"      — additional pages exist  → show "Load more"
 *   status === "Exhausted"        — all events loaded       → hide "Load more"
 *   results.length === 0 && status !== "LoadingFirstPage"   → show empty state
 *
 * Real-time fidelity:
 *   Convex re-evaluates all active pages within ~100–300 ms whenever a SCAN
 *   app mutation appends a new event row for this case.  New events appear at
 *   the head of `results` without any user action — the T5 ledger receives live
 *   updates satisfying the ≤ 2-second fidelity requirement.
 *
 * Subscription is suppressed when `caseId` is falsy — no Convex network traffic
 * until a case is selected.
 *
 * @param caseId           Convex case ID string (or null/undefined to skip).
 * @param initialNumItems  Events to load on first fetch (default: AUDIT_LEDGER_PAGE_SIZE = 20).
 * @param filters          Optional server-side filter parameters (Sub-AC 4).
 *
 * Usage in T5Audit:
 *   const { results, status, loadMore } = usePaginatedCaseEvents(caseId, 20, {
 *     fromTimestamp: 1700000000000,
 *     actorName: "Jane Smith",
 *     eventType: "shipped",
 *   });
 *   if (status === "LoadingFirstPage") return <LedgerSkeleton />;
 *   return (
 *     <>
 *       <AuditLedgerTable rows={results.map(eventToRow)} ffEnabled={ffEnabled} />
 *       {status === "CanLoadMore" && (
 *         <button onClick={() => loadMore(AUDIT_LEDGER_PAGE_SIZE)}>Load 20 more</button>
 *       )}
 *     </>
 *   );
 */
export function usePaginatedCaseEvents(
  caseId: string | null | undefined,
  initialNumItems = AUDIT_LEDGER_PAGE_SIZE,
  filters: PaginatedCaseEventsFilters = {},
) {
  // Build the query args object — include only non-empty filter values so that
  // the Convex arg fingerprint is stable when no filters are applied (avoids
  // unnecessary cache misses from undefined vs. omitted fields).
  const queryArgs = caseId
    ? {
        caseId: caseId as Id<"cases">,
        // Include filter fields only when they have meaningful values.
        // Convex treats optional args as undefined when omitted, which is
        // equivalent to "no filter applied" in getCaseEventsPaginated.
        ...(filters.fromTimestamp !== undefined && { fromTimestamp: filters.fromTimestamp }),
        ...(filters.toTimestamp   !== undefined && { toTimestamp:   filters.toTimestamp   }),
        ...(filters.actorName                  && { actorName:      filters.actorName      }),
        ...(filters.eventType                  && { eventType:      filters.eventType      }),
        ...(filters.caseIdSearch               && { caseIdSearch:   filters.caseIdSearch   }),
      }
    : ("skip" as const);

  return usePaginatedQuery(
    // Use the same (api as unknown as Record<string, any>) pattern as other hooks
    // in this file — the generated api.d.ts doesn't include queries/events yet
    // but the path is valid at runtime once `npx convex dev` deploys the file.
    (api as unknown as Record<string, any>)["queries/events"]
      ?.getCaseEventsPaginated,
    queryArgs,
    { initialNumItems },
  );
}

// ─── useDistinctCaseActors ────────────────────────────────────────────────────

/**
 * Subscribe to the sorted list of distinct actor display-names for a case.
 *
 * Wraps `api["queries/events"].getDistinctActors`.  Returns a deduplicated,
 * alphabetically-sorted array of `userName` values from every event recorded
 * for the case.  This is the canonical data source for the Actor filter
 * dropdown in the T5 Audit Ledger filter panel.
 *
 * The list updates in real time: whenever a SCAN app mutation appends a new
 * event row, Convex re-evaluates the server-side query and pushes the updated
 * actor list to all subscribers within ~100–300 ms.  New field technicians or
 * pilots appear in the dropdown automatically the moment they perform an action.
 *
 * Loading state contract:
 *   `undefined`  — query is loading (initial fetch or reconnect).
 *                  AuditLedgerFilterPanel renders "Loading…" and disables the
 *                  Actor dropdown while in this state.
 *   `string[]`   — deduplicated, sorted actor names.
 *                  An empty array means no events have been recorded for the
 *                  case (brand-new case) — only "All actors" is shown.
 *
 * Subscription is suppressed when `caseId` is falsy — no Convex network
 * traffic is generated until a case is selected in the UI.
 *
 * Usage in T5Audit (replaces the useMemo derivation from synthetic events):
 *   const knownActors = useDistinctCaseActors(caseId);
 *   // Pass directly to AuditLedgerFilterPanel:
 *   <AuditLedgerFilterPanel knownActors={knownActors} ... />
 *
 * @param caseId  Convex case ID string (or null/undefined to skip the query).
 */
export function useDistinctCaseActors(
  caseId: string | null | undefined,
): string[] | undefined {
  const result = useQuery(
    (api as unknown as Record<string, any>)["queries/events"]
      ?.getDistinctActors,
    caseId ? { caseId: caseId as Id<"cases"> } : "skip",
  );
  return result;
}
