/**
 * src/hooks/use-dashboard-subscriptions.ts
 *
 * INVENTORY dashboard data layer — Convex `useQuery` subscription hooks that
 * reactively re-fetch case and event data whenever SCAN-triggered mutations land.
 *
 * Sub-AC 36b: Implement Convex useQuery subscription hooks in the dashboard data
 * layer that reactively re-fetch case and event data whenever SCAN-triggered
 * mutations land.
 *
 * Architecture
 * ────────────
 * This module is the canonical data-fetching surface for the INVENTORY dashboard.
 * It mirrors the pattern established by `use-scan-queries.ts` for the SCAN mobile
 * app — providing a single, semantically-named import point for all dashboard
 * components instead of requiring each component to import from multiple lower-level
 * hook modules.
 *
 * Each exported hook is a thin delegation wrapper that:
 *   1. Accepts dashboard-appropriate arguments (caseId, bounds, filters, etc.)
 *   2. Delegates to the corresponding lower-level hook in use-case-status.ts,
 *      use-case-events.ts, use-checklist.ts, or use-map-data.ts
 *   3. Returns the result unchanged — no transformation, no caching layer
 *
 * Using a dedicated dashboard data layer provides:
 *   1. A single import point for T1–T5 and M1–M5 components — one import,
 *      not five separate imports from different hook modules
 *   2. Semantic names aligned with dashboard UI workflows — `useDashboardCase`
 *      reads clearer in a T1Overview component than `useCaseById`
 *   3. A stable refactoring boundary — if underlying Convex query names change,
 *      only this file needs updating (not every dashboard component)
 *   4. Consistent documentation of the real-time fidelity contract for each
 *      subscription, explaining which SCAN app mutations trigger re-evaluation
 *
 * Real-time fidelity guarantee
 * ────────────────────────────
 * All hooks in this module delegate to Convex `useQuery` (via the lower-level
 * hook modules), which subscribes to the server-side query function over the
 * Convex WebSocket transport.  Convex re-evaluates any subscribed query within
 * ~100–300 ms whenever a SCAN app mutation writes to the underlying database
 * tables — satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * SCAN-triggered mutations and their dashboard impacts:
 *
 *   scanCheckIn (convex/scan.ts)
 *     Writes to: cases (status, lat, lng, updatedAt), events
 *     Re-evaluates: useDashboardCase*, useDashboardCaseStatus*, useDashboardAllCases,
 *                   useDashboardCasesInBounds, useDashboardCaseStatusCounts,
 *                   useDashboardCaseEvents, useDashboardLatestCaseEvent,
 *                   useM1MapData, useCasesMapPayload
 *     Dashboard effect: M1 pin moves, status pill updates, T1 case header refreshes
 *
 *   updateChecklistItem (convex/mutations/checklist.ts)
 *     Writes to: manifestItems (status, notes, checkedByName, checkedAt), inspections
 *     Re-evaluates: useDashboardChecklist, useDashboardChecklistSummary,
 *                   useDashboardChecklistWithInspection, useDashboardChecklistItemsByStatus,
 *                   useDashboardCaseEvents (item_checked event appended)
 *     Dashboard effect: T2 item row updates, T3 progress bar advances, M3 pin updates

 *   handoffCustody (convex/mutations/custody.ts)
 *     Writes to: custodyRecords (new row), events (custody_handoff appended)
 *     Re-evaluates: useDashboardCaseEvents, useDashboardLatestCaseEvent,
 *                   useDashboardDistinctActors
 *     Dashboard effect: T5 custody chain row appears, actor dropdown adds new name
 *
 *   submitDamagePhoto (convex/damageReports.ts)
 *     Writes to: damageReports (new row), manifestItems (status = damaged), events
 *     Re-evaluates: useDashboardChecklist, useDashboardChecklistItemsByStatus("damaged"),
 *                   useDashboardCaseEvents (damage_reported event appended)
 *     Dashboard effect: T4 damage list gains new entry, T3 damaged count increases
 *
 *   shipCase (convex/mutations/scan.ts or convex/shipping.ts)
 *     Writes to: shipments (new row), cases (status = transit_out), events
 *     Re-evaluates: useDashboardCase*, useDashboardCaseStatus*,
 *                   useDashboardCaseEvents (shipped event appended),
 *                   useM4MapData, useCasesMapPayload
 *     Dashboard effect: T4 tracking badge appears, M4 pin enters transit map
 *
 * Loading / error state contract (all hooks)
 * ─────────────────────────────────────────
 * All hooks propagate the `useQuery` convention unchanged:
 *   `undefined` — query is loading (initial fetch or WebSocket reconnect)
 *   `null`      — query returned null (document not found; only for nullable queries)
 *   `T`         — successful live result
 *
 * Dashboard components should guard against `undefined` (render skeleton) and
 * `null` (render not-found or empty state).
 *
 * Skip pattern
 * ────────────
 * Passing `"skip"` as the second argument to the underlying `useQuery` suppresses
 * the subscription entirely.  All hooks accept nullable IDs and use `"skip"` when
 * the value is null/undefined, avoiding unnecessary Convex traffic when no case is
 * selected (e.g., when the detail panel is closed).
 *
 * Import and usage examples
 * ─────────────────────────
 * // T1 Summary panel — single case subscription
 * import { useDashboardCase, useDashboardChecklistSummary } from "@/hooks/use-dashboard-subscriptions";
 *
 * function T1Overview({ caseId }: { caseId: string }) {
 *   const caseDoc = useDashboardCase(caseId);
 *   const summary = useDashboardChecklistSummary(caseId);
 *
 *   if (caseDoc === undefined) return <PanelSkeleton />;
 *   if (caseDoc === null)      return <CaseNotFound />;
 *   return <T1Layout case={caseDoc} summary={summary} />;
 * }
 *
 * // T5 Audit panel — paginated events with filter
 * import { useDashboardPaginatedEvents, useDashboardDistinctActors } from "@/hooks/use-dashboard-subscriptions";
 *
 * function T5AuditLedger({ caseId, filters }: Props) {
 *   const { results, status, loadMore } = useDashboardPaginatedEvents(caseId, 20, filters);
 *   const knownActors = useDashboardDistinctActors(caseId);
 *
 *   if (status === "LoadingFirstPage") return <LedgerSkeleton />;
 *   return <AuditLedgerTable rows={results} actors={knownActors} />;
 * }
 *
 * // M1 Fleet Overview — all cases with status counts
 * import { useDashboardAllCases, useDashboardCaseStatusCounts } from "@/hooks/use-dashboard-subscriptions";
 *
 * function M1FleetHeader() {
 *   const cases  = useDashboardAllCases();
 *   const counts = useDashboardCaseStatusCounts();
 *   // Both update within ≤ 2 s of any SCAN app check-in
 *   return <FleetStatusBar counts={counts} total={cases?.length ?? 0} />;
 * }
 */

"use client";

// ─── Case status hook delegation ──────────────────────────────────────────────
// Delegates to use-case-status.ts, which wraps api.cases.* queries.

import {
  useCaseById,
  useCaseStatus,
  useAllCases,
  useCasesByStatus,
  useCasesByMission,
  useCasesInBounds,
  useCaseStatusCounts,
} from "./use-case-status";

// ─── Event hook delegation ────────────────────────────────────────────────────
// Delegates to use-case-events.ts, which wraps api["queries/events"].* queries.

import {
  useCaseEvents,
  useCaseEventsByType,
  useLatestCaseEvent,
  useCaseEventRange,
  usePaginatedCaseEvents,
  useDistinctCaseActors,
} from "./use-case-events";

// ─── Checklist hook delegation ────────────────────────────────────────────────
// Delegates to use-checklist.ts, which wraps api.checklists.* queries.

import {
  useChecklistByCase,
  useChecklistItem,
  useChecklistSummary,
  useChecklistWithInspection,
  useChecklistItemsByStatus,
} from "./use-checklist";

// ─── Map data hook delegation ─────────────────────────────────────────────────
// Delegates to use-map-data.ts, which wraps api.mapData.* queries.

import {
  useM1MapData,
  useM2MapData,
  useM3MapData,
  useM4MapData,
  useM5MapData,
  useCasesMapPayload as useCasesMapPayloadBase,
} from "./use-map-data";

// ─── Re-export all types ──────────────────────────────────────────────────────
// Dashboard components can import both hooks and types from this single module.

// Case status types
export type { CaseStatus, BoundsFilter } from "./use-case-status";

// Event types
export type {
  CaseEvent,
  CaseEventType,
  PaginatedCaseEventsFilters,
} from "./use-case-events";
export { AUDIT_LEDGER_PAGE_SIZE } from "./use-case-events";

// Checklist types
export type {
  ManifestItemStatus,
  ChecklistItem,
  ChecklistSummary,
  ChecklistWithInspection,
  MANIFEST_ITEM_STATUSES,
} from "./use-checklist";

// Map data types
export type {
  M1Response,
  M2Response,
  M3Response,
  M4Response,
  M5Response,
  MapBounds,
  M1CasePin,
  M2MissionGroup,
  M3CasePin,
  M4ShipmentPin,
  M5Cluster,
  M5HeatmapPoint,
  M5TimelineSnapshot,
  CasesMapPayloadResponse,
  CaseMapPayload,
  CaseModeFlags,
  CaseInspectionSummary,
  MapViewportBounds,
  UseM1MapDataArgs,
  UseM2MapDataArgs,
  UseM3MapDataArgs,
  UseM4MapDataArgs,
  UseM5MapDataArgs,
  UseCasesMapPayloadArgs,
} from "./use-map-data";

// ═══════════════════════════════════════════════════════════════════════════════
// ── SECTION 1: CASE DATA SUBSCRIPTIONS ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// All hooks in this section subscribe to the `cases` table via api.cases.* queries.
// Any SCAN app mutation that writes to `cases` (scanCheckIn, shipCase, handoffCustody)
// triggers Convex to re-evaluate these subscriptions and push the diff to all
// connected dashboard clients within ~100–300 ms.

/**
 * Subscribe to the full case document for T1–T5 case detail panels.
 *
 * Returns the complete `Doc<"cases">` row including all optional fields
 * (qrCode, notes, templateId, shipping fields, lat/lng, assignee, etc.).
 * This is the primary data source for the CaseDetailPanel and all T-layouts.
 *
 * SCAN-triggered re-evaluation:
 *   • `scanCheckIn` — updates status, lat, lng, updatedAt → T1 header refreshes
 *   • `shipCase`    — updates status to transit_out → T4 tracking appears
 *   • `handoffCustody` — updates custodian fields → T5 custody chain refreshes
 *   • Any case mutation via `updateCase` — all fields may change
 *
 * Pass `null` as `caseId` to skip (detail panel closed / no case selected).
 *
 * Return values:
 *   `undefined`       — loading (initial fetch or WebSocket reconnect)
 *   `null`            — case not found (deleted or invalid ID)
 *   `Doc<"cases">`    — live full case document
 *
 * @param caseId  Convex case document ID string, or `null` to skip.
 *
 * @example
 * function T1Overview({ caseId }: { caseId: string }) {
 *   const caseDoc = useDashboardCase(caseId);
 *   if (caseDoc === undefined) return <PanelSkeleton />;
 *   if (caseDoc === null)      return <CaseNotFound />;
 *   return <T1Layout case={caseDoc} />;
 * }
 */
export function useDashboardCase(caseId: string | null) {
  return useCaseById(caseId);
}

/**
 * Subscribe to the lightweight status projection for a case.
 *
 * Returns only the fields needed for map pins, status badges, and the case
 * detail panel header — avoids transferring the full document when only status
 * info is needed.
 *
 * SCAN-triggered re-evaluation:
 *   • `scanCheckIn` — updates status → map pin color changes, status pill updates
 *   • Any case status mutation → status projection changes
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`         — loading
 *   `null`              — case not found
 *   `CaseStatusResult`  — live status + key display fields
 *
 * @param caseId  Convex case document ID string, or `null` to skip.
 *
 * @example
 * function CasePinLabel({ caseId }: { caseId: string | null }) {
 *   const status = useDashboardCaseStatus(caseId);
 *   if (!status) return null;
 *   return <StatusPill kind={status.status} />;
 * }
 */
export function useDashboardCaseStatus(caseId: string | null) {
  return useCaseStatus(caseId);
}

/**
 * Subscribe to all cases in the fleet, ordered by most recently updated.
 *
 * Returns every case document in the system without filtering.  This is the
 * primary data source for the M1 Fleet Overview map — all case pins with their
 * current lat/lng and status.
 *
 * SCAN-triggered re-evaluation:
 *   • Any SCAN app mutation touching the `cases` table pushes an updated list
 *     within ~100–300 ms.  New check-ins, status changes, and shipments all
 *     appear on the M1 map immediately.
 *
 * Return values:
 *   `undefined`           — loading
 *   `Doc<"cases">[]`      — live, unfiltered case list (may be empty)
 *
 * @example
 * function M1FleetMap() {
 *   const cases = useDashboardAllCases();
 *   if (cases === undefined) return <MapSkeleton />;
 *   return <CasePins cases={cases} />;
 * }
 */
export function useDashboardAllCases() {
  return useAllCases();
}

/**
 * Subscribe to cases filtered by a specific lifecycle status.
 *
 * Uses the Convex `by_status` index for efficient server-side filtering.
 * Useful for status-specific views like "all cases currently deployed" or
 * "all cases in transit" for the M3/M4 map modes.
 *
 * SCAN-triggered re-evaluation:
 *   • `scanCheckIn` with a new status → the case moves between status buckets
 *     in real time; the subscription for the old status loses the case and the
 *     subscription for the new status gains it within ~100–300 ms.
 *
 * Pass `null` as `status` to skip the subscription.
 *
 * Return values:
 *   `undefined`           — loading
 *   `Doc<"cases">[]`      — live status-filtered case list
 *
 * @param status  Case lifecycle status to filter by, or `null` to skip.
 *
 * @example
 * function DeployedCaseCounter() {
 *   const deployed = useDashboardCasesByStatus("deployed");
 *   return <span>{deployed?.length ?? "—"} deployed</span>;
 * }
 */
export function useDashboardCasesByStatus(
  status: "hangar" | "assembled" | "transit_out" | "deployed" |
          "flagged" | "transit_in" | "received" | "archived" | null
) {
  return useCasesByStatus(status);
}

/**
 * Subscribe to all cases assigned to a specific mission.
 *
 * Uses the Convex `by_mission` index for efficient server-side filtering.
 * Primary hook for the M2 Mission Mode when the user drills into a specific
 * mission group on the map.
 *
 * SCAN-triggered re-evaluation:
 *   • `assignMission` mutation or `scanCheckIn` with missionId change → the
 *     case joins or leaves the mission group in real time.
 *
 * Pass `null` as `missionId` to skip the subscription.
 *
 * Return values:
 *   `undefined`           — loading
 *   `Doc<"cases">[]`      — live cases assigned to the mission
 *
 * @param missionId  Convex mission document ID string, or `null` to skip.
 *
 * @example
 * function MissionCaseList({ missionId }: { missionId: string | null }) {
 *   const cases = useDashboardCasesByMission(missionId);
 *   if (cases === undefined) return <Skeleton />;
 *   return <CaseList cases={cases} />;
 * }
 */
export function useDashboardCasesByMission(missionId: string | null) {
  return useCasesByMission(missionId);
}

/**
 * Subscribe to all cases whose last-known location falls within a geographic
 * bounding box.  An optional `status` further narrows results.
 *
 * This is the primary real-time table watcher for viewport-constrained map views.
 * As the user pans/zooms the map, the viewport bounds args change and Convex
 * re-subscribes automatically with the new spatial filter.
 *
 * SCAN-triggered re-evaluation:
 *   • `scanCheckIn` with updated lat/lng → the case appears/disappears from the
 *     viewport subscription in real time as its location changes.
 *
 * Pass `null` as `bounds` to skip the subscription (e.g., before map initialised).
 *
 * Return values:
 *   `undefined`           — loading
 *   `Doc<"cases">[]`      — live cases within the viewport
 *
 * @param bounds  Geographic bounding box, or `null` to skip.
 * @param status  Optional lifecycle status filter.
 *
 * @example
 * function ViewportCasePins({ bounds }: { bounds: BoundsFilter | null }) {
 *   const cases = useDashboardCasesInBounds(bounds);
 *   if (cases === undefined) return <MapSkeleton />;
 *   return <CasePins cases={cases} />;
 * }
 */
export function useDashboardCasesInBounds(
  bounds: { swLat: number; swLng: number; neLat: number; neLng: number } | null,
  status?: "hangar" | "assembled" | "transit_out" | "deployed" |
           "flagged" | "transit_in" | "received" | "archived"
) {
  return useCasesInBounds(bounds, status);
}

/**
 * Subscribe to aggregate case status counts for the dashboard summary bar.
 *
 * Returns `total` and a `byStatus` breakdown used to render the global status
 * filter pills at the top of the INVENTORY dashboard header.
 *
 * This hook always subscribes (no skip pattern) because the summary bar is
 * always visible when the dashboard is mounted.
 *
 * SCAN-triggered re-evaluation:
 *   • Any SCAN status change → the count for the previous status decrements and
 *     the count for the new status increments within ~100–300 ms.
 *
 * Return values:
 *   `undefined`           — loading
 *   `CaseStatusCounts`    — live aggregate counts
 *
 * @example
 * function DashboardStatusBar() {
 *   const counts = useDashboardCaseStatusCounts();
 *   if (!counts) return <StatusBarSkeleton />;
 *   return (
 *     <div>
 *       <span>Deployed: {counts.byStatus.deployed ?? 0}</span>
 *       <span>In Transit: {counts.byStatus.transit_out ?? 0}</span>
 *       <span>Total: {counts.total}</span>
 *     </div>
 *   );
 * }
 */
export function useDashboardCaseStatusCounts() {
  return useCaseStatusCounts();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── SECTION 2: EVENT DATA SUBSCRIPTIONS ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// All hooks in this section subscribe to the immutable `events` table via
// api["queries/events"].* queries.  The events table is append-only — SCAN app
// mutations never update or delete rows; they only INSERT new event rows.
//
// When a SCAN app mutation appends a new event, Convex re-evaluates every active
// event subscription for that caseId within ~100–300 ms, satisfying the ≤ 2-second
// real-time fidelity requirement.
//
// Events that trigger re-evaluation:
//   • scanCheckIn                → status_change event
//   • updateChecklistItem        → item_checked event
//   • submitDamagePhoto          → damage_reported event
//   • shipCase                   → shipped event
//   • handoffCustody             → custody_handoff event
//   • startInspection            → inspection_started event
//   • completeInspection         → inspection_completed event

/**
 * Subscribe to all events for a case in chronological order (oldest first).
 *
 * Primary hook for the T5 Audit panel full event timeline and the
 * HashChainVerificationFooter (which needs chronological order for SHA-256
 * chain verification).
 *
 * Returns every event recorded for the case, from oldest (index 0) to newest
 * (index N-1).  Never returns `null` — the query always returns an array.
 *
 * SCAN-triggered re-evaluation:
 *   Any mutation that appends a new row to the `events` table causes Convex to
 *   re-evaluate this subscription and push the new event to all connected
 *   dashboard clients.  The T5 timeline gains the new event without a page reload.
 *
 * Return values:
 *   `undefined`      — loading
 *   `CaseEvent[]`    — live chronological event list (empty array when no events)
 *
 * @param caseId  Convex case ID string, or `null`/`undefined` to skip.
 *
 * @example
 * function T5Timeline({ caseId }: { caseId: string }) {
 *   const events = useDashboardCaseEvents(caseId);
 *   if (events === undefined) return <TimelineSkeleton />;
 *   if (events.length === 0)  return <EmptyTimeline />;
 *   return <EventTimeline events={events} />;
 * }
 */
export function useDashboardCaseEvents(caseId: string | null | undefined) {
  return useCaseEvents(caseId);
}

/**
 * Subscribe to case events filtered to specific event types, chronological.
 *
 * Returns only events whose `eventType` is included in the provided `eventTypes`
 * array, ordered by `timestamp` ascending.
 *
 * Common filter combinations for T5 sub-sections:
 *   ["status_change"]                                — status history tab
 *   ["custody_handoff"]                              — custody chain tab
 *   ["shipped", "delivered"]                         — shipping log tab
 *   ["damage_reported"]                              — damage log tab
 *   ["inspection_started", "inspection_completed"]   — inspection log tab
 *   ["item_checked", "damage_reported"]              — checklist activity tab
 *
 * SCAN-triggered re-evaluation:
 *   Convex re-evaluates this subscription whenever any event for the case is
 *   appended.  If the new event's type is not in the subscribed `eventTypes`,
 *   the in-memory filter excludes it and the dashboard component receives an
 *   unchanged result (no visible re-render).
 *
 * Return values:
 *   `undefined`      — loading
 *   `CaseEvent[]`    — live filtered event list (empty array when no matching events)
 *
 * @param caseId      Convex case ID string, or `null`/`undefined` to skip.
 * @param eventTypes  Non-empty array of event type strings to include.
 *
 * @example
 * // Status history sub-section in T5
 * function StatusHistory({ caseId }: { caseId: string }) {
 *   const events = useDashboardCaseEventsByType(caseId, ["status_change"]);
 *   if (events === undefined) return <Skeleton />;
 *   return <StatusHistoryList events={events} />;
 * }
 */
export function useDashboardCaseEventsByType(
  caseId: string | null | undefined,
  eventTypes: CaseEventTypeArray
) {
  return useCaseEventsByType(caseId, eventTypes);
}

/**
 * Subscribe to the most recent event recorded for a case.
 *
 * Returns the single event with the highest `timestamp` value, or `null` when
 * no events have been recorded (brand-new case).
 *
 * Use for:
 *   • Case list row "Last activity" column chip — shows when the case was last touched
 *   • M1 map pin tooltip — brief "last action" summary line
 *   • Dashboard case sidebar — "Last updated N minutes ago by Jane"
 *   • Staleness alerts — detect cases with no activity in N hours
 *
 * SCAN-triggered re-evaluation:
 *   Any SCAN app action on the case appends a new event and causes this
 *   subscription to return the new most-recent event within ~100–300 ms.
 *
 * Return values:
 *   `undefined`   — loading
 *   `null`        — no events recorded (brand-new case)
 *   `CaseEvent`   — most recent event
 *
 * @param caseId  Convex case ID string, or `null`/`undefined` to skip.
 *
 * @example
 * function CaseListRowActivity({ caseId }: { caseId: string }) {
 *   const latest = useDashboardLatestCaseEvent(caseId);
 *   if (latest === undefined) return <ActivitySkeleton />;
 *   if (latest === null)      return <span>No activity</span>;
 *   return <span>{latest.eventType} by {latest.userName}</span>;
 * }
 */
export function useDashboardLatestCaseEvent(caseId: string | null | undefined) {
  return useLatestCaseEvent(caseId);
}

/**
 * Subscribe to case events within an inclusive timestamp window, chronological.
 *
 * Returns events whose `timestamp` falls within [fromTimestamp, toTimestamp],
 * ordered ascending.  Useful for:
 *   • T5 Audit panel date-range filter
 *   • Shift activity reports (all events during an 8-hour window)
 *   • Operations monitoring ("any events in the last 15 minutes?")
 *
 * SCAN-triggered re-evaluation:
 *   When a SCAN app mutation appends a new event within the window, Convex
 *   pushes the updated list.  Events outside the window are excluded server-side.
 *
 * Subscription is skipped when `caseId` is falsy OR when `fromTimestamp >
 * toTimestamp` (invalid window — the server also guards this but we skip early
 * to avoid unnecessary Convex traffic).
 *
 * Return values:
 *   `undefined`      — loading
 *   `CaseEvent[]`    — events in window (empty array when no events match)
 *
 * @param caseId         Convex case ID string, or `null`/`undefined` to skip.
 * @param fromTimestamp  Inclusive lower bound (epoch ms).  Pass 0 for open start.
 * @param toTimestamp    Inclusive upper bound (epoch ms).
 *
 * @example
 * // Last 24 hours of activity for a case
 * const yesterday = Date.now() - 86_400_000;
 * const recentEvents = useDashboardCaseEventRange(caseId, yesterday, Date.now());
 */
export function useDashboardCaseEventRange(
  caseId: string | null | undefined,
  fromTimestamp: number,
  toTimestamp: number
) {
  return useCaseEventRange(caseId, fromTimestamp, toTimestamp);
}

/**
 * Paginated subscription to the immutable audit log for a case (newest first).
 *
 * This is the primary data-fetching hook for the T5 Audit Ledger table component.
 * Returns events in descending timestamp order — most recent action at index 0.
 * Additional pages are loaded on demand via the `loadMore()` function.
 *
 * Optional filter parameters (all server-side, Convex-evaluated):
 *   fromTimestamp  — inclusive lower epoch-ms bound (date range start)
 *   toTimestamp    — inclusive upper epoch-ms bound (date range end)
 *   actorName      — exact match on actor display name
 *   eventType      — exact match on event type key
 *   caseIdSearch   — substring match on caseId string representation
 *
 * When any filter value changes, Convex automatically resets pagination to
 * page 1 — no stale-cursor issues.  This is the reactive loop for filter changes:
 *   Filter change → args change → usePaginatedQuery resets cursor → Convex
 *   re-evaluates getCaseEventsPaginated → pushes filtered page → React re-renders.
 *
 * SCAN-triggered re-evaluation:
 *   Convex re-evaluates all active pages within ~100–300 ms whenever any SCAN
 *   app mutation appends a new event row for this case.  New events appear at the
 *   head of `results` without user interaction — the T5 ledger stays live.
 *
 * Pagination state contract:
 *   status === "LoadingFirstPage" → render skeleton
 *   status === "CanLoadMore"      → show "Load more" button
 *   status === "Exhausted"        → all events loaded, hide "Load more"
 *   results.length === 0 && status !== "LoadingFirstPage" → empty state
 *
 * @param caseId           Convex case ID string, or `null`/`undefined` to skip.
 * @param initialNumItems  Events to load on first fetch (default: 20).
 * @param filters          Optional server-side filter parameters.
 *
 * @example
 * const { results, status, loadMore } = useDashboardPaginatedEvents(caseId, 20, {
 *   actorName: "Alice",
 *   eventType: "shipped",
 * });
 * if (status === "LoadingFirstPage") return <LedgerSkeleton />;
 * return (
 *   <>
 *     <AuditLedgerTable rows={results} />
 *     {status === "CanLoadMore" && (
 *       <button onClick={() => loadMore(20)}>Load 20 more</button>
 *     )}
 *   </>
 * );
 */
export function useDashboardPaginatedEvents(
  caseId: string | null | undefined,
  initialNumItems?: number,
  filters?: import("./use-case-events").PaginatedCaseEventsFilters
) {
  return usePaginatedCaseEvents(caseId, initialNumItems, filters);
}

/**
 * Subscribe to the sorted list of distinct actor display-names for a case.
 *
 * Returns a deduplicated, alphabetically-sorted array of `userName` values from
 * every event recorded for the case.  This is the canonical data source for the
 * Actor filter dropdown in the T5 Audit Ledger filter panel.
 *
 * The list updates in real time: whenever any SCAN app mutation appends a new
 * event row, the actor list gains new names (if the actor is new to this case)
 * within ~100–300 ms.
 *
 * Loading state contract:
 *   `undefined`  — loading → Actor dropdown shows "Loading…" and is disabled
 *   `string[]`   — sorted, deduplicated actor names (empty array for new cases)
 *
 * @param caseId  Convex case ID string, or `null`/`undefined` to skip.
 *
 * @example
 * function AuditActorDropdown({ caseId }: { caseId: string }) {
 *   const actors = useDashboardDistinctActors(caseId);
 *   if (actors === undefined) return <DisabledDropdown label="Loading…" />;
 *   return <ActorDropdown options={["All", ...actors]} />;
 * }
 */
export function useDashboardDistinctActors(
  caseId: string | null | undefined
): string[] | undefined {
  return useDistinctCaseActors(caseId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── SECTION 3: CHECKLIST DATA SUBSCRIPTIONS ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// All hooks in this section subscribe to the `manifestItems` and `inspections`
// tables via api.checklists.* queries.
//
// When a SCAN app technician marks a manifest item as ok/damaged/missing via
// `updateChecklistItem`, Convex re-evaluates every checklist subscription for
// that case within ~100–300 ms.  The T2, T3, and T4 panels all receive the
// updated inspection state without a page reload.

/**
 * Subscribe to all manifest items (checklist) for a case, sorted by name.
 *
 * Returns the full list of manifest items with each item's inspection status,
 * notes, photo storage IDs, and attribution (who checked it, when).
 *
 * Used by:
 *   • T2 Manifest panel — full packing list with quantity/status columns
 *   • T5 Audit Manifest Snapshot — live inspection state snapshot in audit view
 *   • T4 Damage report list — items with status === "damaged"
 *
 * SCAN-triggered re-evaluation:
 *   • `updateChecklistItem` — writes to `manifestItems` → item status/notes update
 *   • `submitDamagePhoto`   — writes to `manifestItems` (status = damaged) + `damageReports`
 *   • `applyTemplate`       — creates new `manifestItems` rows → list populated
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`          — loading
 *   `ChecklistItem[]`    — live item list (empty array when no template applied)
 *
 * @param caseId  Convex case document ID string, or `null` to skip.
 *
 * @example
 * function T2ManifestPanel({ caseId }: { caseId: string | null }) {
 *   const items = useDashboardChecklist(caseId);
 *   if (items === undefined) return <ChecklistSkeleton />;
 *   if (items.length === 0)  return <NoItemsMessage />;
 *   return <ManifestItemList items={items} />;
 * }
 */
export function useDashboardChecklist(caseId: string | null) {
  return useChecklistByCase(caseId);
}

/**
 * Subscribe to a single manifest item identified by (caseId, templateItemId).
 *
 * Uses the `by_case_item` compound index for an O(log n) point lookup.  This
 * is the most granular subscription — use it when only one specific item needs
 * to be watched, such as monitoring photo upload completion for a damaged item.
 *
 * SCAN-triggered re-evaluation:
 *   • `updateChecklistItem` with this item's templateItemId → item refreshes
 *   • `submitDamagePhoto` for this item → status becomes "damaged", photo attached
 *
 * Pass `null` for either argument to skip.
 *
 * Return values:
 *   `undefined`        — loading
 *   `null`             — item not found (template item not applied to this case)
 *   `ChecklistItem`    — live item state
 *
 * @param caseId          Convex case document ID string, or `null` to skip.
 * @param templateItemId  Template item ID string, or `null` to skip.
 *
 * @example
 * function ItemStatusBadge({ caseId, templateItemId }: Props) {
 *   const item = useDashboardChecklistItem(caseId, templateItemId);
 *   if (item === undefined) return <Spinner />;
 *   if (item === null)      return null;
 *   return <StatusPill kind={item.status} />;
 * }
 */
export function useDashboardChecklistItem(
  caseId: string | null,
  templateItemId: string | null
) {
  return useChecklistItem(caseId, templateItemId);
}

/**
 * Subscribe to aggregate checklist progress counts for a case.
 *
 * Returns total item count, a breakdown by status (ok / damaged / missing /
 * unchecked), a `progressPct` (0–100), and an `isComplete` flag.
 *
 * This is a lighter-weight subscription than `useDashboardChecklist` — it
 * transfers a single summary object rather than the full item array.  Use it
 * when only the aggregate progress numbers are needed:
 *   • T1 Summary panel — mini progress bar in the case card
 *   • T4 Shipping panel — pre-shipment inspection status banner
 *   • M3 Field Mode map pin — inspection progress overlay on case pin
 *
 * SCAN-triggered re-evaluation:
 *   • `updateChecklistItem` — recalculates ok/damaged/missing/unchecked counts
 *   • `applyTemplate`       — total count changes when template items are created
 *
 * Pass `null` as `caseId` to skip.
 *
 * Return values:
 *   `undefined`          — loading
 *   `ChecklistSummary`   — live aggregate progress counts
 *
 * @param caseId  Convex case document ID string, or `null` to skip.
 *
 * @example
 * function InspectionProgressBar({ caseId }: { caseId: string | null }) {
 *   const summary = useDashboardChecklistSummary(caseId);
 *   if (!summary) return <ProgressBarSkeleton />;
 *   return (
 *     <div>
 *       <progress value={summary.progressPct} max={100} />
 *       <span>{summary.damaged} damaged · {summary.missing} missing</span>
 *     </div>
 *   );
 * }
 */
export function useDashboardChecklistSummary(caseId: string | null) {
  return useChecklistSummary(caseId);
}

/**
 * Subscribe to the combined checklist items + inspection state for a case.
 *
 * This is the primary hook for the T3 Inspection panel.  It bundles:
 *   • `items`      — all manifest items, sorted by name
 *   • `inspection` — the most recent inspection record (status, inspector,
 *                    aggregate counters) or `null` if none started yet
 *   • `summary`    — aggregate progress counts (progressPct, isComplete, etc.)
 *
 * Using a single subscription avoids the "two-query flicker" that would occur
 * if items and the inspection record were subscribed separately.  Convex
 * evaluates both table reads at the same logical timestamp, ensuring the client
 * always receives a consistent snapshot of the inspection state.
 *
 * SCAN-triggered re-evaluation:
 *   • `updateChecklistItem` — writes to `manifestItems` AND `inspections` in
 *     the same transaction → both tables re-evaluated atomically, consistent
 *     snapshot pushed to dashboard within ~100–300 ms
 *   • `startInspection`   — creates the inspection row → `inspection` changes
 *                           from null to the new record
 *   • `completeInspection` — sets inspection.status = "completed"
 *
 * Pass `null` as `caseId` to skip.
 *
 * Return values:
 *   `undefined`                  — loading
 *   `ChecklistWithInspection`    — live combined checklist + inspection state
 *
 * @param caseId  Convex case document ID string, or `null` to skip.
 *
 * @example
 * function T3InspectionPanel({ caseId }: { caseId: string | null }) {
 *   const state = useDashboardChecklistWithInspection(caseId);
 *
 *   if (state === undefined) return <InspectionSkeleton />;
 *
 *   const { items, inspection, summary } = state;
 *   return (
 *     <div>
 *       <InspectionHeader inspection={inspection} summary={summary} />
 *       <ManifestItemList items={items} />
 *     </div>
 *   );
 * }
 */
export function useDashboardChecklistWithInspection(caseId: string | null) {
  return useChecklistWithInspection(caseId);
}

/**
 * Subscribe to manifest items for a case filtered to a specific completion state.
 *
 * Backed by the `by_case_status` compound index for O(log n) server-side filtering.
 * Only matching items are transferred from server to client — efficient for
 * completion-state-scoped views that only need a subset of items.
 *
 * Status values:
 *   "unchecked" — not yet reviewed (default after template apply)
 *   "ok"        — confirmed present and undamaged
 *   "damaged"   — present but with documented damage
 *   "missing"   — not found during inspection
 *
 * SCAN-triggered re-evaluation:
 *   • `updateChecklistItem` changes an item's status → the item moves between
 *     status buckets in real time.  The "damaged" subscription gains the item;
 *     the "unchecked" subscription loses it.
 *   • `submitDamagePhoto` changes status to "damaged" → same as above.
 *
 * Common dashboard use cases:
 *   • T4 Shipping panel damage summary — `status: "damaged"` — see all flagged items
 *   • T3 Inspection issues list — `status: "missing"` — items not found
 *   • T5 Audit snapshot — filtered views by item condition
 *
 * Pass `null` for either argument to skip.
 *
 * Return values:
 *   `undefined`          — loading
 *   `ChecklistItem[]`    — live filtered item list (may be empty array)
 *
 * @param caseId  Convex case document ID string, or `null` to skip.
 * @param status  Item completion status to filter by, or `null` to skip.
 *
 * @example
 * // T4 Shipping panel — pre-shipment damaged items list
 * function DamagedItemsList({ caseId }: { caseId: string | null }) {
 *   const damaged = useDashboardChecklistItemsByStatus(caseId, "damaged");
 *   if (damaged === undefined) return <Skeleton />;
 *   if (damaged.length === 0)  return <p>No damaged items — cleared for shipment.</p>;
 *   return (
 *     <ul>
 *       {damaged.map((item) => <DamageReportRow key={item._id} item={item} />)}
 *     </ul>
 *   );
 * }
 */
export function useDashboardChecklistItemsByStatus(
  caseId: string | null,
  status: "unchecked" | "ok" | "damaged" | "missing" | null
) {
  return useChecklistItemsByStatus(caseId, status);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── SECTION 4: MAP DATA SUBSCRIPTIONS ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// All hooks in this section subscribe to the `mapData.*` queries via
// api.mapData.* — these are the denormalized, pre-joined endpoints designed
// specifically for high-performance map rendering across all five map modes.
//
// The map data queries read from multiple tables (cases, inspections,
// custodyRecords, missions, shipments) and return pre-joined, pre-computed
// results.  Any SCAN app mutation that writes to any of those tables triggers
// re-evaluation within ~100–300 ms.
//
// For the "all-in-one" unified payload approach (clients that switch between
// M1–M5 without re-subscribing), use useDashboardMapPayload() below.
// For per-mode subscriptions (clients that only ever need one map mode),
// use the individual useDashboardM* hooks — they transfer less data per call.

/**
 * Subscribe to M1 (Fleet Overview) map data.
 *
 * Returns all case pins with status, lat/lng, assignee, and mission info.
 * Summary stats cover the full fleet regardless of viewport bounds.
 *
 * SCAN-triggered re-evaluation:
 *   Any SCAN app mutation that touches `cases` (status change, check-in, shipment)
 *   triggers an M1 update within ~100–300 ms.
 *
 * @param args  Optional bounds/status/assignee/mission filter args.
 *
 * @example
 * const fleetData = useDashboardM1MapData();
 * if (!fleetData) return <MapSkeleton />;
 * return <M1Pins cases={fleetData.cases} />;
 */
export function useDashboardM1MapData(args: Parameters<typeof useM1MapData>[0] = {}) {
  return useM1MapData(args);
}

/**
 * Subscribe to M2 (Mission Mode) map data.
 *
 * Returns missions grouped with their cases, plus unassigned cases.
 * Each mission group has a per-status breakdown for rendering coloured status
 * rings on mission cluster pins.
 *
 * SCAN-triggered re-evaluation:
 *   Case mutations (status change, mission assignment) and mission updates
 *   trigger M2 re-evaluation within ~100–300 ms.
 *
 * @param args  Optional bounds/missionId/status filter args.
 */
export function useDashboardM2MapData(args: Parameters<typeof useM2MapData>[0] = {}) {
  return useM2MapData(args);
}

/**
 * Subscribe to M3 (Field Mode) map data.
 *
 * Returns deployed/in_field cases enriched with real-time inspection progress:
 * checkedItems/totalItems ratio, damage/missing counts, and inspection status.
 *
 * SCAN-triggered re-evaluation:
 *   `updateChecklistItem` triggers M3 re-evaluation within ~100–300 ms — inspection
 *   progress bars on map pins update as field technicians work through packing lists.
 *
 * @param args  Optional bounds/assignee/mission/hasInspection/hasDamage filter args.
 */
export function useDashboardM3MapData(args: Parameters<typeof useM3MapData>[0] = {}) {
  return useM3MapData(args);
}

/**
 * Subscribe to M4 (Logistics Mode) map data.
 *
 * Returns active shipments with route geometry (origin → current → destination),
 * case labels, ETAs, and tracking numbers.
 *
 * SCAN-triggered re-evaluation:
 *   `shipCase` creates a new shipment and changes case status → M4 pins update.
 *   `updateShipmentStatus` (FedEx tracking refresh) updates position/ETA.
 *
 * @param args  Optional bounds/status filter args.
 */
export function useDashboardM4MapData(args: Parameters<typeof useM4MapData>[0] = {}) {
  return useM4MapData(args);
}

/**
 * Subscribe to M5 (Mission Control) map data.
 *
 * Returns geographic density clusters, a weighted heatmap of case activity,
 * and a timeline snapshot of current status distribution.
 *
 * Feature flag: when FF_MAP_MISSION is disabled, returns
 *   `{ featureEnabled: false, clusters: [], heatmap: [], ... }`.
 * Check `data.featureEnabled` before rendering M5 components.
 *
 * SCAN-triggered re-evaluation:
 *   Any case status change or mission update triggers M5 re-evaluation, updating
 *   cluster sizes and heatmap weights in real time.
 *
 * @param args  Optional bounds filter args.
 */
export function useDashboardM5MapData(args: Parameters<typeof useM5MapData>[0] = {}) {
  return useM5MapData(args);
}

/**
 * Subscribe to the unified, denormalized INVENTORY map payload.
 *
 * Returns ALL cases pre-joined with inspection progress and custody state,
 * covering all five map modes (M1–M5) in a single Convex subscription.
 *
 * Use this hook when the dashboard needs to switch between M1–M5 without
 * stale data gaps.  Filter by `modeFlags` client-side for O(1) mode switching:
 *   const fleetCases   = payload?.cases.filter(c => c.modeFlags.isFleetVisible);
 *   const fieldCases   = payload?.cases.filter(c => c.modeFlags.isFieldActive);
 *   const transitCases = payload?.cases.filter(c => c.modeFlags.isInTransit);
 *   const heatPoints   = payload?.cases.filter(c => c.modeFlags.hasCoordinates);
 *
 * SCAN-triggered re-evaluation:
 *   Any SCAN app mutation that writes to `cases`, `inspections`, or `custodyRecords`
 *   triggers re-evaluation within ~100–300 ms.  A single subscription keeps all
 *   five map modes' data current simultaneously.
 *
 * Return values:
 *   `undefined`               — loading (initial fetch or reconnect)
 *   `CasesMapPayloadResponse` — live denormalized fleet payload
 *
 * @param args  Optional bounds/status/assignee/mission/skip args.
 *
 * @example
 * const payload = useDashboardMapPayload();
 * if (!payload) return <MapSkeleton />;
 * const fieldPins = payload.cases.filter(c => c.modeFlags.isFieldActive);
 * return <M3Pins pins={fieldPins} />;
 */
export function useDashboardMapPayload(
  args: Parameters<typeof useCasesMapPayloadBase>[0] = {}
) {
  return useCasesMapPayloadBase(args);
}

// ─── Internal type helpers ────────────────────────────────────────────────────

/**
 * Type alias for the eventTypes array parameter used in useDashboardCaseEventsByType.
 * Exported from use-case-events and re-used here so call sites get autocomplete.
 */
type CaseEventTypeArray = import("./use-case-events").CaseEventType[];
