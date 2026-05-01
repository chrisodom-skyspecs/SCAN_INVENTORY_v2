/**
 * convex/queries/swimLanes.ts
 *
 * INVENTORY swim-lane board queries: fetch case phase events and group them
 * into swim-lane column buckets based on lifecycle phase type.
 *
 * Public Convex query functions (callable via useQuery on the client):
 *
 *   getSwimLaneBoard     — full swim-lane board with cases grouped by their
 *                          current phase and per-case phase events in each
 *                          column.  Accepts optional filters for mission,
 *                          assignee, and phase subset.
 *
 *   getCasePhaseEvents   — all swim-lane events for a SINGLE case, mapped to
 *                          their phase buckets.  Used by the case detail panel
 *                          to show a phase-annotated event timeline.
 *
 *   getSwimLaneSummary   — lightweight phase count summary (cases only, no
 *                          event joins) for column header badges and charts.
 *
 * Swim-Lane Model
 * ────────────────
 * The INVENTORY dashboard swim-lane board groups equipment cases by their
 * lifecycle phase into 8 vertical column buckets:
 *   hangar → assembled → transit_out → deployed → flagged → transit_in → received → archived
 *
 * Each swim-lane column shows:
 *   • All cases currently in that lifecycle phase (case cards)
 *   • Per card: the events that occurred while the case was in that phase
 *   • Column header: phase label + case count + event count badge
 *
 * Event-to-Phase Mapping
 * ──────────────────────
 * Events are assigned to phase buckets using the algorithm in
 * convex/swimLaneHelpers.ts → mapEventsToPhases():
 *
 *   status_change events  → assigned to data.to (destination phase)
 *   all other event types → assigned to the running current phase at event time
 *
 * Fine-grained events (item_checked, photo_added, note_added) are excluded.
 *
 * Real-time Fidelity
 * ──────────────────
 * All queries read the `cases` and/or `events` tables.  Convex tracks these
 * as reactive dependencies.  Any SCAN app mutation that writes to either table
 * triggers re-evaluation and pushes the updated board to all connected
 * dashboard clients within ~100–300 ms — satisfying the ≤ 2-second real-time
 * fidelity requirement.
 *
 * Mutation → Table written → Query re-evaluated
 * ──────────────────────────────────────────────
 * scan.scanCheckIn         events + cases → getSwimLaneBoard, getCasePhaseEvents
 * custody.handoffCustody   events + cases → re-evaluates
 * shipping.shipCase        events + cases → re-evaluates
 * scan.completeInspection  events         → re-evaluates
 * damageReports.*          events         → re-evaluates
 *
 * Registered in the Convex API as: api["queries/swimLanes"].*
 *
 * Client usage (after `npx convex dev` regenerates API types):
 *
 *   // Full swim-lane board (INVENTORY swim-lane view)
 *   const board = useQuery(api["queries/swimLanes"].getSwimLaneBoard, {});
 *
 *   // Mission-scoped board (M2 Mission Mode)
 *   const board = useQuery(
 *     api["queries/swimLanes"].getSwimLaneBoard,
 *     { missionId: selectedMission._id },
 *   );
 *
 *   // Single-case phase events (case detail panel)
 *   const phaseEvents = useQuery(
 *     api["queries/swimLanes"].getCasePhaseEvents,
 *     { caseId },
 *   );
 *
 *   // Lightweight column count badges
 *   const summary = useQuery(api["queries/swimLanes"].getSwimLaneSummary, {});
 */

import { query } from "../_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";
import {
  mapEventsToPhases,
  assembleSwimLaneBoard,
  SWIM_LANE_PHASES,
  SWIM_LANE_LABELS,
  isSwimLanePhase,
} from "../swimLaneHelpers";
import type {
  SwimLanePhase,
  SwimLaneBoardResult,
  CasePhaseEvent,
  CaseForSwimLane,
  RawSwimLaneEvent,
} from "../swimLaneHelpers";

// Re-export types so client-side hooks and components can import them without
// importing Convex server internals.
export type {
  SwimLanePhase,
  SwimLaneBoardResult,
  CasePhaseEvent,
  SwimLaneBucket,
  SwimLaneCaseCard,
  SwimLaneEventMetadata,
  StatusChangeMetadata,
  InspectionMetadata,
  DamageMetadata,
  ShippingMetadata,
  CustodyMetadata,
  MissionMetadata,
  TemplateMetadata,
  GenericMetadata,
} from "../swimLaneHelpers";

export { SWIM_LANE_PHASES, SWIM_LANE_LABELS, isSwimLanePhase };

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

// ─── Swim-lane phase validator ────────────────────────────────────────────────

/**
 * Convex value validator for the swim-lane phase union.
 * Mirrors the SwimLanePhase type in swimLaneHelpers.ts.
 * Used for the `phases` filter arg in getSwimLaneBoard.
 */
const swimLanePhaseValidator = v.union(
  v.literal("hangar"),
  v.literal("assembled"),
  v.literal("transit_out"),
  v.literal("deployed"),
  v.literal("flagged"),
  v.literal("recalled"),
  v.literal("transit_in"),
  v.literal("received"),
  v.literal("archived"),
);

// ─── Max batch constants ──────────────────────────────────────────────────────

/**
 * Maximum number of cases fetched by getSwimLaneBoard in a single call.
 *
 * The swim-lane board fetches events for every case in the filtered result.
 * For very large fleets, the number of parallel event queries could exceed
 * Convex's per-query resource limits.  This cap ensures the board remains
 * responsive; fleets with more cases should use phase or mission filters.
 *
 * 500 is generous for a single-tenant SkySpecs fleet.  Fleet-wide boards
 * with more cases should use the `phases` or `missionId` filter to narrow.
 */
const MAX_BOARD_CASES = 500;

// ─── getSwimLaneBoard ─────────────────────────────────────────────────────────

/**
 * Subscribe to the full swim-lane board: cases grouped by lifecycle phase,
 * with per-case phase events mapped to swim-lane column buckets.
 *
 * Returns a SwimLaneBoardResult containing phase columns (up to 8, one per
 * lifecycle phase), each with:
 *   • All cases currently in that phase (as SwimLaneCaseCard objects)
 *   • Per card: the events that occurred while the case was in that phase
 *   • Column-level aggregates: caseCount, eventCount
 *
 * Filtering behaviour
 * ───────────────────
 * All filter args are optional.  Multiple filters apply cumulatively (AND):
 *   • `missionId`       — only cases on this mission (uses by_mission index)
 *   • `assigneeId`      — only cases where cases.assigneeId matches (in-memory)
 *   • `phases`          — only include the specified columns in the result
 *   • `excludeArchived` — omit the "archived" column (default: false)
 *
 * Performance
 * ───────────
 * The query performs:
 *   1. One cases table scan (or by_mission index scan when missionId is set)
 *   2. One events scan per case via by_case_timestamp — N concurrent queries
 *      via Promise.all, where N ≤ MAX_BOARD_CASES (500)
 *   3. All join and aggregation in-memory via assembleSwimLaneBoard()
 *
 * Reactive dependency coverage:
 *   • `cases` table: invalidated by any case mutation (scanCheckIn, etc.)
 *   • `events` table: invalidated by any event insertion (all SCAN app mutations)
 *   Either write causes re-evaluation within ~100–300 ms — ≤ 2 s fidelity.
 *
 * Client usage:
 *   // Full fleet board
 *   const board = useQuery(api["queries/swimLanes"].getSwimLaneBoard, {});
 *
 *   // Mission-scoped board (M2 Mission Mode)
 *   const board = useQuery(api["queries/swimLanes"].getSwimLaneBoard, {
 *     missionId: selectedMission._id,
 *   });
 *
 *   // Field-active phases only
 *   const board = useQuery(api["queries/swimLanes"].getSwimLaneBoard, {
 *     phases: ["transit_out", "deployed", "flagged", "recalled", "transit_in"],
 *   });
 *
 *   // My Cases swim-lane
 *   const board = useQuery(api["queries/swimLanes"].getSwimLaneBoard, {
 *     assigneeId: currentUser.id,
 *     excludeArchived: true,
 *   });
 */
export const getSwimLaneBoard = query({
  args: {
    /**
     * Optional Convex mission ID to scope the board to one deployment mission.
     * Uses the cases.by_mission index for O(log n + |mission cases|) efficiency.
     * When provided, only cases where cases.missionId equals this ID are included.
     */
    missionId: v.optional(v.id("missions")),

    /**
     * Optional Kinde user ID to filter cases by assignee.
     * Applied in-memory after the index/full scan (no compound index available).
     */
    assigneeId: v.optional(v.string()),

    /**
     * Optional array of phases to include in the result.
     * When provided, only the specified swim-lane columns are returned.
     * When omitted, all 8 phases are included.
     *
     * Example: ["deployed", "flagged"] returns a 2-column board with only
     * active field cases.
     */
    phases: v.optional(v.array(swimLanePhaseValidator)),

    /**
     * When true, the "archived" phase column is omitted from the result.
     * Convenience shorthand for excluding decommissioned cases.
     * Default: false (archived column is included).
     */
    excludeArchived: v.optional(v.boolean()),
  },

  handler: async (ctx, args): Promise<SwimLaneBoardResult> => {
    await requireAuth(ctx);

    // ── 1. Fetch cases with optional index-backed filtering ───────────────────
    //
    // missionId filter uses the by_mission index: O(log n + |mission cases|).
    // Without missionId, full scan ordered by updatedAt desc.
    // The by_updated index preserves most-recently-changed cases at the top,
    // which gives the swim-lane board the correct "most active" ordering.
    let caseDocs = args.missionId !== undefined
      ? await ctx.db
          .query("cases")
          .withIndex("by_mission", (q) => q.eq("missionId", args.missionId!))
          .collect()
      : await ctx.db
          .query("cases")
          .withIndex("by_updated")
          .order("desc")
          .collect();

    // ── 2. Apply in-memory field filters ──────────────────────────────────────

    // Assignee filter (no index available for this field)
    if (args.assigneeId !== undefined) {
      caseDocs = caseDocs.filter((c) => c.assigneeId === args.assigneeId);
    }

    // Phase filter — restrict to the requested phases only.
    // This both reduces the event-fetch load AND controls which lanes appear.
    const allowedPhases: Set<string> | null =
      args.phases && args.phases.length > 0
        ? new Set(args.phases)
        : null;

    if (allowedPhases !== null) {
      caseDocs = caseDocs.filter((c) => allowedPhases.has(c.status));
    }

    // excludeArchived filter
    if (args.excludeArchived === true) {
      caseDocs = caseDocs.filter((c) => c.status !== "archived");
    }

    // Enforce maximum case limit
    if (caseDocs.length > MAX_BOARD_CASES) {
      caseDocs = caseDocs.slice(0, MAX_BOARD_CASES);
    }

    // ── 3. Short-circuit for empty result ─────────────────────────────────────
    if (caseDocs.length === 0) {
      // Determine which lanes to return (respecting phase + archived filters)
      let visiblePhases: readonly SwimLanePhase[] = SWIM_LANE_PHASES;
      if (allowedPhases !== null) {
        visiblePhases = SWIM_LANE_PHASES.filter((p) => allowedPhases.has(p));
      } else if (args.excludeArchived === true) {
        visiblePhases = SWIM_LANE_PHASES.filter((p) => p !== "archived");
      }

      return {
        lanes: visiblePhases.map((phase) => ({
          phase,
          label:      SWIM_LANE_LABELS[phase],
          cases:      [],
          caseCount:  0,
          eventCount: 0,
        })),
        totalCases:  0,
        totalEvents: 0,
        assembledAt: Date.now(),
      };
    }

    // ── 4. Fetch events for all cases in parallel ──────────────────────────────
    //
    // One events index scan per case using the by_case_timestamp compound index
    // with ascending order (chronological, oldest→newest).  All N scans are
    // issued concurrently via Promise.all — latency is O(1), not O(N).
    //
    // Convex tracks the events table as a reactive dependency.  Any new event
    // inserted for any case in the result set re-evaluates this subscription.
    //
    // Note: The query DSL cannot filter on non-indexed fields (eventType) at the
    // DB layer.  We collect all events and let mapEventsToPhases() filter to
    // SWIM_LANE_EVENT_TYPES in memory — typically a tiny cost per case.
    const allEventsPerCase = await Promise.all(
      caseDocs.map((c) =>
        ctx.db
          .query("events")
          .withIndex("by_case_timestamp", (q) => q.eq("caseId", c._id))
          .order("asc")
          .collect()
      )
    );

    // ── 5. Build CaseForSwimLane objects ──────────────────────────────────────
    //
    // Zip cases with their event arrays into a single typed structure that
    // the pure assembleSwimLaneBoard() function can process without DB calls.
    const casesForBoard: CaseForSwimLane[] = caseDocs.map((c, i) => ({
      caseId:         c._id.toString(),
      label:          c.label,
      currentStatus:  c.status,
      lat:            c.lat,
      lng:            c.lng,
      locationName:   c.locationName,
      assigneeId:     c.assigneeId,
      assigneeName:   c.assigneeName,
      missionId:      c.missionId?.toString(),
      trackingNumber: c.trackingNumber,
      updatedAt:      c.updatedAt,
      events:         allEventsPerCase[i] as unknown as RawSwimLaneEvent[],
    }));

    // ── 6. Delegate board assembly to pure helper ──────────────────────────────
    //
    // assembleSwimLaneBoard() produces all 8 swim-lane columns regardless of
    // which phases have cases.  We strip unrequested columns in step 7.
    const fullBoard = assembleSwimLaneBoard(casesForBoard, Date.now());

    // ── 7. Apply lane-level filters to the assembled result ───────────────────
    //
    // assembleSwimLaneBoard() always returns all 8 lanes (including empty ones).
    // Strip lanes for phases that were not requested by the caller.
    let lanes = fullBoard.lanes;

    if (allowedPhases !== null) {
      lanes = lanes.filter((lane) => allowedPhases.has(lane.phase));
    } else if (args.excludeArchived === true) {
      lanes = lanes.filter((lane) => lane.phase !== "archived");
    }

    return {
      ...fullBoard,
      lanes,
    };
  },
});

// ─── getCasePhaseEvents ───────────────────────────────────────────────────────

/**
 * Result returned by getCasePhaseEvents.
 *
 * Includes the case's current phase (for header display) and the full
 * phase-annotated event list (for timeline rendering).
 */
export interface CasePhaseEventsResult {
  /** Convex document ID of the case (plain string). */
  caseId: string;

  /** Display label, e.g. "CASE-001". */
  caseLabel: string;

  /**
   * Current lifecycle phase of the case.
   * The swim-lane column where this case currently sits.
   */
  currentPhase: SwimLanePhase;

  /**
   * All swim-lane events for this case in chronological order (earliest first).
   * Each event has a `phase` field indicating which swim-lane column it belongs to.
   * ALL phases are included (not just the current phase) — enables the
   * phase-annotated timeline that shows the case's full lifecycle history.
   */
  events: CasePhaseEvent[];

  /**
   * Summary counts by phase: how many events occurred in each lifecycle stage.
   * Useful for rendering the phase tab bar in the case detail panel.
   * Phases with no events have count 0.
   */
  countsByPhase: Record<SwimLanePhase, number>;

  /**
   * The phases that have at least one event, in lifecycle order.
   * Useful for rendering only the non-empty phase tabs.
   */
  activePhases: SwimLanePhase[];

  /** Total number of swim-lane events across all phases. */
  totalEvents: number;
}

/**
 * Subscribe to all swim-lane phase events for a single case.
 *
 * Returns every meaningful event for the case with its phase bucket assignment,
 * in chronological order (oldest first).  This is the per-case companion to
 * getSwimLaneBoard: it exposes the same phase-mapping algorithm but for a single
 * case's complete event timeline, including events from historical phases.
 *
 * Use this in:
 *   • The case detail panel's "Phase Timeline" tab — shows events grouped by
 *     the lifecycle phase in which they occurred, with phase labels.
 *   • The T5 audit panel's phase-annotated event list.
 *   • Any component that needs phase context for each event in a case timeline.
 *
 * Event type coverage:
 *   Only SWIM_LANE_EVENT_TYPES are returned.  Fine-grained events
 *   (item_checked, photo_added, note_added) are excluded.
 *
 * Phase assignment correctness:
 *   Events are processed chronologically.  Each event is assigned to the
 *   lifecycle phase the case was in AT THE TIME OF THE EVENT.  Historical events
 *   from previous phases retain their correct phase assignment even after the
 *   case has moved on.  E.g., an inspection_completed event from when the case
 *   was "deployed" stays in the "deployed" column even after the case moves to
 *   "transit_in".
 *
 * Real-time behavior:
 *   Convex re-evaluates within ~100–300 ms whenever the `events` table changes
 *   for this case (any SCAN app mutation) or the `cases` row is updated.
 *   The detail panel reflects new events without user action, satisfying the
 *   ≤ 2-second real-time fidelity requirement.
 *
 * Return values:
 *   `undefined`              — query is loading (initial fetch)
 *   `null`                   — case does not exist (invalid or deleted caseId)
 *   `CasePhaseEventsResult`  — the case's events with phase bucket assignments
 *
 * Client usage:
 *   const result = useQuery(
 *     api["queries/swimLanes"].getCasePhaseEvents,
 *     caseId ? { caseId } : "skip",
 *   );
 *   if (result === undefined) return <Skeleton />;
 *   if (result === null) return <CaseNotFound />;
 *
 *   // Show events grouped by phase
 *   result.activePhases.forEach((phase) => {
 *     const events = result.events.filter((e) => e.phase === phase);
 *     renderPhaseSection(phase, events);
 *   });
 */
export const getCasePhaseEvents = query({
  args: { caseId: v.id("cases") },

  handler: async (ctx, args): Promise<CasePhaseEventsResult | null> => {
    await requireAuth(ctx);

    // ── Load case + events in parallel ────────────────────────────────────────
    // Two concurrent DB calls:
    //   1. ctx.db.get — O(1) primary-key lookup for the case document.
    //   2. events index scan — O(log n + |events|) via by_case_timestamp index,
    //      ascending order to give mapEventsToPhases the chronological sequence.
    //
    // Convex tracks BOTH tables as reactive dependencies:
    //   • cases: any case mutation re-evaluates (status changes affect the phase).
    //   • events: any new event for this case re-evaluates immediately.
    const [caseDoc, rawEvents] = await Promise.all([
      ctx.db.get(args.caseId),
      ctx.db
        .query("events")
        .withIndex("by_case_timestamp", (q) => q.eq("caseId", args.caseId))
        .order("asc")
        .collect(),
    ]);

    // ── Not-found guard ────────────────────────────────────────────────────────
    if (!caseDoc) return null;

    // ── Determine current phase ────────────────────────────────────────────────
    const currentPhase: SwimLanePhase = isSwimLanePhase(caseDoc.status)
      ? caseDoc.status
      : "hangar";

    // ── Map events to phase buckets via pure helper ────────────────────────────
    // mapEventsToPhases:
    //   1. Filters to SWIM_LANE_EVENT_TYPES (excludes item_checked, etc.)
    //   2. Sorts chronologically
    //   3. Walks events maintaining a running "current phase" cursor
    //   4. Assigns each event to its correct phase bucket
    const events = mapEventsToPhases(
      rawEvents as unknown as RawSwimLaneEvent[],
      caseDoc.status
    );

    // ── Compute countsByPhase ─────────────────────────────────────────────────
    // Initialise all 8 phases to 0, then count events per phase in one pass.
    const countsByPhase = Object.fromEntries(
      SWIM_LANE_PHASES.map((p) => [p, 0])
    ) as Record<SwimLanePhase, number>;

    for (const event of events) {
      countsByPhase[event.phase] = (countsByPhase[event.phase] ?? 0) + 1;
    }

    // ── Derive activePhases — phases with at least one event ──────────────────
    // Returned in lifecycle order (SWIM_LANE_PHASES ordering is preserved).
    const activePhases: SwimLanePhase[] = SWIM_LANE_PHASES.filter(
      (p) => countsByPhase[p] > 0
    );

    return {
      caseId:       args.caseId.toString(),
      caseLabel:    caseDoc.label,
      currentPhase,
      events,
      countsByPhase,
      activePhases,
      totalEvents:  events.length,
    };
  },
});

// ─── getSwimLaneSummary ───────────────────────────────────────────────────────

/**
 * A single phase bucket in the summary result.
 */
export interface SwimLaneSummaryBucket {
  /** Lifecycle phase identifier for this column. */
  phase: SwimLanePhase;
  /** Human-readable column header label. */
  label: string;
  /** Number of cases currently in this phase. */
  caseCount: number;
}

/**
 * Lightweight swim-lane summary: case counts per phase bucket.
 * No event data — just case aggregates.
 */
export interface SwimLaneSummary {
  /**
   * Phase bucket count array in lifecycle order.
   * Contains 7 or 8 buckets depending on the excludeArchived flag.
   */
  buckets: SwimLaneSummaryBucket[];
  /** Total number of cases across all included phases. */
  totalCases: number;
}

/**
 * Subscribe to a lightweight swim-lane summary: case counts per phase bucket.
 *
 * Returns aggregate case counts for each lifecycle phase WITHOUT fetching
 * events — significantly cheaper than getSwimLaneBoard for components that
 * only need column header badge counts or phase distribution charts.
 *
 * Because this query reads only the `cases` table, it re-evaluates narrowly:
 * only case mutations (not event insertions) trigger re-evaluation.  This makes
 * it ideal for persistent header badges that don't need to respond to individual
 * scan events.
 *
 * Performance:
 *   One full cases table scan (or by_mission index scan) + O(n) in-memory count.
 *   No per-case sub-queries; no events table reads.
 *   For a fleet of 1000 cases: ~1 DB query, O(1000) in-memory ops.
 *
 * Client usage:
 *   const summary = useQuery(api["queries/swimLanes"].getSwimLaneSummary, {});
 *   if (summary === undefined) return <CountSkeleton />;
 *   // Render column header badges:
 *   summary.buckets.forEach(({ phase, label, caseCount }) => (
 *     <ColumnHeader key={phase} label={label} count={caseCount} />
 *   ));
 *
 *   // Mission-scoped header
 *   const summary = useQuery(api["queries/swimLanes"].getSwimLaneSummary, {
 *     missionId: selectedMission._id,
 *   });
 */
export const getSwimLaneSummary = query({
  args: {
    /**
     * Optional Convex mission ID to scope the summary to one deployment mission.
     * Uses the cases.by_mission index for efficient scoped aggregation.
     * When provided, only cases where cases.missionId matches are counted.
     */
    missionId: v.optional(v.id("missions")),

    /**
     * When true, the "archived" phase bucket is excluded from the result.
     * Useful for header badges that should not count decommissioned cases.
     * Default: false.
     */
    excludeArchived: v.optional(v.boolean()),
  },

  handler: async (ctx, args): Promise<SwimLaneSummary> => {
    await requireAuth(ctx);

    // ── Fetch cases using the most selective available index ──────────────────
    // missionId → by_mission index (efficient scoped count)
    // No filter  → full table scan (reads cases.status only; no events join)
    let caseDocs = args.missionId !== undefined
      ? await ctx.db
          .query("cases")
          .withIndex("by_mission", (q) => q.eq("missionId", args.missionId!))
          .collect()
      : await ctx.db.query("cases").collect();

    // Apply excludeArchived filter in-memory
    if (args.excludeArchived === true) {
      caseDocs = caseDocs.filter((c) => c.status !== "archived");
    }

    // ── Count cases per phase in a single linear pass ─────────────────────────
    const counts = new Map<SwimLanePhase, number>();
    for (const phase of SWIM_LANE_PHASES) {
      counts.set(phase, 0);
    }

    for (const c of caseDocs) {
      if (isSwimLanePhase(c.status)) {
        counts.set(c.status, (counts.get(c.status) ?? 0) + 1);
      }
    }

    // ── Build result ──────────────────────────────────────────────────────────
    const visiblePhases: readonly SwimLanePhase[] =
      args.excludeArchived === true
        ? SWIM_LANE_PHASES.filter((p) => p !== "archived")
        : SWIM_LANE_PHASES;

    const buckets: SwimLaneSummaryBucket[] = visiblePhases.map((phase) => ({
      phase,
      label:     SWIM_LANE_LABELS[phase],
      caseCount: counts.get(phase) ?? 0,
    }));

    return {
      buckets,
      totalCases: caseDocs.length,
    };
  },
});
