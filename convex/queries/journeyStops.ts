/**
 * convex/queries/journeyStops.ts
 *
 * M2 journey-stop query: derive numbered journey stops from case events.
 *
 * Public Convex query functions (callable via useQuery on the client):
 *
 *   getM2JourneyStops     — all journey stops for a single case, ordered
 *                           chronologically with stop index, location,
 *                           timestamp, and event-type metadata.
 *
 *   getM2JourneyStopsBatch — journey stops for multiple cases in a single
 *                           subscription (used by the M2 mission panel to
 *                           render journey timelines for all cases in a
 *                           mission group without N+1 subscriptions).
 *
 * Journey Stop Model
 * ──────────────────
 * A journey stop represents a meaningful event in a case's lifecycle — a
 * moment when the case was at a specific location or underwent a significant
 * action.  Stops are derived from the `events` table using a fixed set of
 * event types (see convex/journeyStopHelpers.ts → JOURNEY_STOP_EVENT_TYPES).
 *
 * Fine-grained checklist events (item_checked, photo_added, note_added) are
 * intentionally excluded — they are too granular and carry no location data.
 *
 * Real-time fidelity
 * ──────────────────
 * Both queries read the `events` and `cases` tables.  Convex tracks these
 * as reactive dependencies.  Any SCAN app mutation that appends an event
 * (scanCheckIn, handoffCustody, shipCase, completeInspection, etc.) or
 * updates a case's position will trigger re-evaluation of subscribed clients
 * within ~100–300 ms — satisfying the ≤ 2-second fidelity requirement.
 *
 * Mutation → Table written → Query invalidated
 * ──────────────────────────────────────────────
 * scan.scanCheckIn         events + cases → getM2JourneyStops re-evaluates
 * custody.handoffCustody   events + cases → re-evaluates
 * shipping.shipCase        events + cases → re-evaluates
 * scan.completeInspection  events + cases → re-evaluates
 *
 * Registered in the Convex API as: api["queries/journeyStops"].*
 *
 * Client usage (after npx convex dev regenerates API types):
 *
 *   // Single case journey (M2 case detail panel)
 *   const journey = useQuery(
 *     api["queries/journeyStops"].getM2JourneyStops,
 *     { caseId },
 *   );
 *   if (journey === undefined) return <Skeleton />;   // loading
 *   if (journey === null)      return <Empty />;       // case not found
 *   journey.stops.forEach((stop) => {
 *     console.log(`Stop ${stop.stopIndex}: ${stop.eventType} at ${stop.timestamp}`);
 *   });
 *
 *   // Batch journey for a mission's cases (M2 mission panel)
 *   const journeys = useQuery(
 *     api["queries/journeyStops"].getM2JourneyStopsBatch,
 *     { caseIds: missionCaseIds },
 *   );
 */

import { query } from "../_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";
import {
  deriveJourneyStops,
  JOURNEY_STOP_EVENT_TYPES,
} from "../journeyStopHelpers";
import type {
  JourneyStop,
  M2CaseJourney,
  CaseContext,
  RawEventRow,
} from "../journeyStopHelpers";

// Re-export types so client-side hooks and components can import them from
// this module without importing Convex server internals.
export type { JourneyStop, M2CaseJourney };

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Asserts a valid Kinde JWT is present.
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

// ─── Max batch size constant ──────────────────────────────────────────────────

/**
 * Maximum number of caseIds accepted by getM2JourneyStopsBatch in a single
 * call.  Prevents unbounded queries that could exceed Convex's response limits.
 * Mission groups rarely exceed 50 cases; 100 is a generous safety margin.
 */
const MAX_BATCH_CASE_IDS = 100;

// ─── getM2JourneyStops ────────────────────────────────────────────────────────

/**
 * Subscribe to the M2 journey stops for a single case.
 *
 * Returns all meaningful lifecycle events for the case as a numbered sequence
 * of journey stops, ordered chronologically (stop 1 = earliest, stop N = latest).
 *
 * Each stop includes:
 *   • stopIndex    — 1-based sequential position in the journey
 *   • eventId      — Convex event document ID (stable React key)
 *   • eventType    — event type discriminant (e.g. "status_change")
 *   • timestamp    — epoch ms (from events.timestamp)
 *   • location     — { lat?, lng?, locationName? } derived from event payload
 *                    or case's last-known position
 *   • hasCoordinates — convenience flag for map rendering
 *   • actorId      — Kinde user ID of the actor
 *   • actorName    — display name of the actor
 *   • metadata     — event-type-specific payload subset (see helpers file)
 *
 * Performance
 * ───────────
 * Two parallel DB calls (Promise.all):
 *   1. ctx.db.get(caseId)                        — O(1) case lookup
 *   2. events.by_case_timestamp ordered by asc   — O(log n + |stops|) via index
 * No per-event sub-queries; all data derived in-memory from pre-loaded rows.
 *
 * Return values:
 *   undefined        — query is loading (initial fetch)
 *   null             — case does not exist (deleted or invalid caseId)
 *   M2CaseJourney    — derived journey with stops array
 *
 * Client usage:
 *   const journey = useQuery(
 *     api["queries/journeyStops"].getM2JourneyStops,
 *     caseId ? { caseId } : "skip",
 *   );
 */
export const getM2JourneyStops = query({
  args: { caseId: v.id("cases") },

  handler: async (ctx, args): Promise<M2CaseJourney | null> => {
    await requireAuth(ctx);

    // ── Load case + events in parallel ────────────────────────────────────────
    // Two separate DB calls issued concurrently:
    //   1. ctx.db.get — O(1) primary-key lookup for the case document.
    //   2. events index scan — O(log n + |events for this case|) using the
    //      by_case_timestamp compound index with asc ordering (chronological).
    //
    // Convex tracks BOTH tables as reactive dependencies:
    //   • cases: any mutation that updates the case's position (lat/lng/locationName)
    //     invalidates this subscription so the location fallback stays current.
    //   • events: any mutation that inserts a new event row (scanCheckIn,
    //     handoffCustody, shipCase, etc.) invalidates and pushes a new stops array.
    const [caseDoc, allCaseEvents] = await Promise.all([
      ctx.db.get(args.caseId),

      // by_case_timestamp index: eq on caseId + ascending order gives all events
      // for this case in chronological order (timestamp ASC).
      // We collect ALL events and filter in deriveJourneyStops — Convex does not
      // support server-side filtering of non-indexed fields in the query DSL.
      ctx.db
        .query("events")
        .withIndex("by_case_timestamp", (q) => q.eq("caseId", args.caseId))
        .order("asc")
        .collect(),
    ]);

    // ── Not-found path ─────────────────────────────────────────────────────────
    if (!caseDoc) return null;

    // ── Build case context for fallback location ───────────────────────────────
    const caseCtx: CaseContext = {
      caseId:              caseDoc._id.toString(),
      caseLabel:           caseDoc.label,
      currentStatus:       caseDoc.status,
      currentLat:          caseDoc.lat,
      currentLng:          caseDoc.lng,
      currentLocationName: caseDoc.locationName,
    };

    // ── Delegate to pure helper (no further DB calls) ─────────────────────────
    // Cast allCaseEvents to RawEventRow[] — Convex Doc fields are compatible
    // with the minimal structural type.
    return deriveJourneyStops(allCaseEvents as unknown as RawEventRow[], caseCtx);
  },
});

// ─── getM2JourneyStopsBatch ────────────────────────────────────────────────────

/**
 * Subscribe to M2 journey stops for multiple cases in a single subscription.
 *
 * Designed for the M2 mission panel: when a user clicks on a mission group,
 * the panel renders a journey timeline for every case in that mission.  Making
 * N separate getM2JourneyStops calls would create N Convex subscriptions — each
 * tracked independently, each causing its own re-render when the data changes.
 *
 * This batch query consolidates all those reads into ONE subscription:
 *   • ONE database round-trip to load all cases in the batch (Promise.all of
 *     ctx.db.get() calls).
 *   • ONE pass over the events table using the by_case_timestamp index, one
 *     collect() per caseId — O(log n + |events for all batch cases|) total.
 *   • Convex re-evaluates this single subscription when ANY case or event in
 *     the batch changes, pushing one consistent update to the client.
 *
 * Constraints:
 *   • Maximum batch size: MAX_BATCH_CASE_IDS (100).  Exceeding this throws
 *     so the client cannot accidentally trigger an unbounded query.
 *   • Cases not found (invalid or deleted IDs) are silently excluded from the
 *     result array — no null entries are returned.
 *
 * Return value:
 *   M2CaseJourney[]  — one element per valid caseId, in the same order as the
 *                      input caseIds array (invalid IDs are skipped).
 *
 * Client usage:
 *   const journeys = useQuery(
 *     api["queries/journeyStops"].getM2JourneyStopsBatch,
 *     missionCaseIds.length > 0
 *       ? { caseIds: missionCaseIds }
 *       : "skip",
 *   );
 */
export const getM2JourneyStopsBatch = query({
  args: {
    /**
     * Array of case Convex IDs to derive journey stops for.
     * Maximum length: MAX_BATCH_CASE_IDS (100).
     */
    caseIds: v.array(v.id("cases")),
  },

  handler: async (ctx, args): Promise<M2CaseJourney[]> => {
    await requireAuth(ctx);

    // ── Guard: enforce batch size limit ───────────────────────────────────────
    if (args.caseIds.length > MAX_BATCH_CASE_IDS) {
      throw new Error(
        `getM2JourneyStopsBatch: caseIds array exceeds max batch size of ` +
        `${MAX_BATCH_CASE_IDS}. Got ${args.caseIds.length} IDs. ` +
        `Split the request into smaller batches.`
      );
    }

    // ── Short-circuit for empty input ─────────────────────────────────────────
    if (args.caseIds.length === 0) return [];

    // ── Load all cases in parallel — one ctx.db.get per ID ───────────────────
    // Promise.all issues all lookups concurrently.  For a typical mission group
    // of 10–30 cases, this is O(1) latency (bounded by the slowest single get).
    const caseDocs = await Promise.all(
      args.caseIds.map((id) => ctx.db.get(id))
    );

    // ── Filter out missing cases ───────────────────────────────────────────────
    // Pair each case with its original ID so we can issue per-case event queries.
    const validCases = caseDocs
      .map((doc, i) => ({ doc, id: args.caseIds[i] }))
      .filter((entry): entry is { doc: NonNullable<typeof entry.doc>; id: typeof entry.id } =>
        entry.doc !== null
      );

    if (validCases.length === 0) return [];

    // ── Load events for each valid case — parallel per-case index scans ───────
    // One index scan per case using by_case_timestamp with asc ordering.
    // All scans are issued concurrently via Promise.all — no sequential awaits.
    //
    // Convex tracks all these event-table reads as reactive dependencies.  Any
    // new event inserted for any of the batch cases re-evaluates this query.
    const allEventsPerCase = await Promise.all(
      validCases.map(({ id }) =>
        ctx.db
          .query("events")
          .withIndex("by_case_timestamp", (q) => q.eq("caseId", id))
          .order("asc")
          .collect()
      )
    );

    // ── Derive journey stops for each valid case ───────────────────────────────
    // Pure in-memory transformation — no further DB calls.
    const journeys: M2CaseJourney[] = validCases.map(({ doc }, i) => {
      const caseCtx: CaseContext = {
        caseId:              doc._id.toString(),
        caseLabel:           doc.label,
        currentStatus:       doc.status,
        currentLat:          doc.lat,
        currentLng:          doc.lng,
        currentLocationName: doc.locationName,
      };

      return deriveJourneyStops(
        allEventsPerCase[i] as unknown as RawEventRow[],
        caseCtx
      );
    });

    return journeys;
  },
});

// ─── Re-export event type filter set for client-side use ─────────────────────

/**
 * Re-export the journey stop event types so client components can:
 *   1. Filter or badge event type labels without re-importing convex server code.
 *   2. Test that known stop types are present.
 */
export { JOURNEY_STOP_EVENT_TYPES };
