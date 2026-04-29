/**
 * src/hooks/use-m2-journey-stops.ts
 *
 * React hooks for subscribing to M2 journey stops via Convex real-time
 * subscriptions.
 *
 * Exported hooks:
 *
 *   useM2JourneyStops(caseId)
 *     Subscribe to the complete journey timeline for a single case.
 *     Returns: undefined (loading) | null (not found) | M2CaseJourney
 *
 *   useM2JourneyStopsBatch(caseIds)
 *     Subscribe to journey timelines for multiple cases at once (for the
 *     M2 mission panel which renders all cases in a mission group).
 *     Returns: undefined (loading) | M2CaseJourney[]
 *
 * Real-time behavior
 * ──────────────────
 * Both hooks delegate to useQuery() which establishes a live Convex WebSocket
 * subscription.  When a SCAN app mutation appends a new event to the events
 * table (scanCheckIn, handoffCustody, shipCase, completeInspection) or updates
 * a case's position, Convex re-evaluates the query and pushes the updated
 * journey within ~100–300 ms — satisfying the ≤ 2-second real-time fidelity
 * requirement between SCAN app actions and INVENTORY dashboard visibility.
 *
 * Skip pattern
 * ────────────
 * Both hooks accept null as their first argument and pass "skip" to useQuery
 * in that case.  This follows the Convex skip pattern:
 *   • null caseId — no journey loaded; hook returns undefined (not null)
 *   • empty caseIds array — batch hook skips and returns [] immediately
 *
 * Usage examples:
 *
 *   // Single case (M2 case detail flyout)
 *   const journey = useM2JourneyStops(selectedCaseId);
 *   if (journey === undefined) return <JourneySkeleton />;
 *   if (journey === null)      return <CaseNotFound />;
 *   return <JourneyTimeline stops={journey.stops} />;
 *
 *   // Mission batch (M2 mission panel — all cases in one subscription)
 *   const journeys = useM2JourneyStopsBatch(missionCaseIds);
 *   if (journeys === undefined) return <BatchSkeleton />;
 *   return <MissionJourneyList journeys={journeys} />;
 */

import { useQuery } from "convex/react";
// Use dynamic key access to remain compatible with stale generated types.
// This mirrors the pattern used in use-scan-queries.ts, use-custody.ts, etc.
import { api } from "../../convex/_generated/api";
import type { M2CaseJourney } from "../../convex/journeyStopHelpers";

// Re-export M2CaseJourney + JourneyStop so consumers of this hook don't need
// to import from the Convex server module directly.
export type { M2CaseJourney } from "../../convex/journeyStopHelpers";
export type { JourneyStop } from "../../convex/journeyStopHelpers";

// ─── Type alias for the generated query key ───────────────────────────────────

// The generated API object uses a "queries/journeyStops" key path.
// We access it via the same dynamic-key pattern used by other hooks in
// this codebase that reference sub-module queries (use-custody.ts,
// use-damage-reports.ts, use-scan-queries.ts).
const journeyStopsApi = (api as unknown as Record<string, Record<string, unknown>>)[
  "queries/journeyStops"
];

// ─── useM2JourneyStops ────────────────────────────────────────────────────────

/**
 * Subscribe to the M2 journey stops for a single case.
 *
 * Sets up a live Convex subscription to
 * api["queries/journeyStops"].getM2JourneyStops.  The subscription is
 * automatically re-evaluated whenever the case document or any of its events
 * changes, satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Return states:
 *   undefined     — query is loading (initial fetch or reconnect)
 *   null          — case does not exist (invalid or deleted caseId)
 *   M2CaseJourney — successfully derived journey with stops array
 *
 * Skip semantics:
 *   When caseId is null, the hook passes "skip" to useQuery — no subscription
 *   is established and the hook returns undefined (not null).  This is
 *   appropriate for conditional rendering patterns where the caseId is resolved
 *   after a user interaction (e.g., clicking a mission case pin on the map).
 *
 * @param caseId  Convex document ID of the case to subscribe to.
 *                Pass null to skip the subscription (returns undefined).
 *
 * @returns  undefined | null | M2CaseJourney
 *
 * @example
 *   const journey = useM2JourneyStops(selectedCaseId);
 *   if (journey === undefined) return <Skeleton />;   // loading
 *   if (journey === null)      return <NotFound />;    // case deleted/invalid
 *   // journey.stops[0].stopIndex === 1
 *   // journey.stops[0].eventType === "status_change" (or first stop type)
 *   // journey.stopCount === journey.stops.length
 *   // journey.hasLocation === journey.stops.some(s => s.hasCoordinates)
 */
export function useM2JourneyStops(
  caseId: string | null
): M2CaseJourney | null | undefined {
  return useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    journeyStopsApi?.["getM2JourneyStops"] as any,
    caseId !== null ? { caseId } : "skip"
  ) as M2CaseJourney | null | undefined;
}

// ─── useM2JourneyStopsBatch ───────────────────────────────────────────────────

/**
 * Subscribe to M2 journey stops for multiple cases in a single subscription.
 *
 * Designed for the M2 mission panel: when a user selects a mission group, this
 * hook subscribes to all cases in that mission at once — one Convex WebSocket
 * subscription instead of N separate subscriptions.  Convex re-evaluates and
 * pushes a fresh result whenever any case or event in the batch changes.
 *
 * Return states:
 *   undefined       — query is loading (initial fetch or reconnect)
 *   M2CaseJourney[] — array of journeys (one per valid caseId; invalid IDs
 *                     are silently excluded by the server-side handler)
 *
 * Skip semantics:
 *   When caseIds is null, the hook passes "skip" and returns undefined.
 *   When caseIds is an empty array, the hook passes "skip" and returns an
 *   empty array immediately (avoids a pointless subscription for zero cases).
 *
 * Constraint: the server enforces a maximum of 100 caseIds per batch.  Mission
 * groups in practice contain fewer than 50 cases, so this limit is not a
 * practical constraint.
 *
 * @param caseIds  Array of Convex case IDs to subscribe to, or null to skip.
 *                 Pass null when the mission is not yet selected.
 *
 * @returns  undefined | M2CaseJourney[]
 *
 * @example
 *   const journeys = useM2JourneyStopsBatch(activeMission?.caseIds ?? null);
 *   if (journeys === undefined) return <MissionSkeleton />;
 *   // journeys.length matches the number of valid case IDs in the mission
 *   // journeys[0].stopCount tells you how many journey stops that case has
 */
export function useM2JourneyStopsBatch(
  caseIds: string[] | null
): M2CaseJourney[] | undefined {
  // Short-circuit empty array — no subscription needed; return [] immediately.
  const effectiveCaseIds = caseIds !== null && caseIds.length === 0 ? null : caseIds;

  const result = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    journeyStopsApi?.["getM2JourneyStopsBatch"] as any,
    effectiveCaseIds !== null ? { caseIds: effectiveCaseIds } : "skip"
  ) as M2CaseJourney[] | undefined;

  // Return an empty array when the input was empty and we skipped the query.
  if (effectiveCaseIds === null && caseIds !== null && caseIds.length === 0) {
    return [];
  }

  return result;
}
