/**
 * convex/swimLaneHelpers.ts
 *
 * Pure helper functions for mapping case phase events to swim-lane column buckets.
 *
 * These functions are extracted from the Convex query handler so they can be
 * unit-tested without a live Convex backend.  The query handler in
 * convex/queries/swimLanes.ts loads the raw DB rows and delegates to
 * mapEventsToPhases() for the transformation.
 *
 * Swim-Lane Model
 * ────────────────
 * The INVENTORY dashboard swim-lane board groups equipment cases by their
 * lifecycle phase (= current status) into vertical column "buckets".  Each
 * bucket shows which cases are currently in that phase plus the most recent
 * meaningful events that occurred while the case was in that phase.
 *
 * Column order mirrors the natural case lifecycle:
 *   hangar → assembled → transit_out → deployed → (flagged) → transit_in → received → archived
 *
 * Event-to-Phase Mapping Strategy
 * ─────────────────────────────────
 * Each event is assigned to the swim-lane phase it was "in" at the time it
 * occurred.  The mapping algorithm walks events chronologically and tracks a
 * running "current phase" state:
 *
 *   1. status_change events:
 *      The event's destination phase is read from `data.to`.  The event is
 *      assigned to that phase bucket (it's the event that PUT the case there).
 *      The running "current phase" is updated to `data.to`.
 *
 *   2. All other event types:
 *      Assigned to the current running phase (the phase the case was in when
 *      the event occurred).
 *
 * Fine-grained events (item_checked, photo_added, note_added) are excluded
 * from the swim-lane — they fire too frequently and don't represent meaningful
 * phase activity for the board view.
 *
 * Phase Fallback
 * ───────────────
 * When no `status_change` event has been seen yet (e.g., a case in "hangar"
 * with only a `template_applied` event), the initial running phase is derived
 * from `caseCurrentStatus`.  This ensures the event is bucketed correctly even
 * if no explicit status_change event exists in the event history.
 */

// ─── Phase type ───────────────────────────────────────────────────────────────

/**
 * A swim-lane column identifier.
 * One value per case lifecycle status.
 * Matches the `caseStatus` union in convex/schema.ts.
 */
export type SwimLanePhase =
  | "hangar"
  | "assembled"
  | "transit_out"
  | "deployed"
  | "flagged"
  | "recalled"
  | "transit_in"
  | "received"
  | "archived";

/**
 * Ordered sequence of swim-lane phases (left-to-right lifecycle order).
 *
 * Used to:
 *   • Render column headers in lifecycle order.
 *   • Initialise empty buckets for phases with no cases.
 *   • Sort swim-lane bucket arrays returned to the client.
 */
export const SWIM_LANE_PHASES: readonly SwimLanePhase[] = [
  "hangar",
  "assembled",
  "transit_out",
  "deployed",
  "flagged",
  "recalled",
  "transit_in",
  "received",
  "archived",
] as const;

/**
 * Human-readable column header labels for each swim-lane phase.
 * Used by the INVENTORY dashboard swim-lane board component.
 */
export const SWIM_LANE_LABELS: Record<SwimLanePhase, string> = {
  hangar:      "Hangar",
  assembled:   "Assembled",
  transit_out: "Transit Out",
  deployed:    "Deployed",
  flagged:     "Flagged",
  recalled:    "Recalled",
  transit_in:  "Transit In",
  received:    "Received",
  archived:    "Archived",
};

/**
 * Test whether a string is a valid SwimLanePhase.
 * Used when reading `data.to` from status_change event payloads (untyped).
 */
export function isSwimLanePhase(value: unknown): value is SwimLanePhase {
  return typeof value === "string" &&
    (SWIM_LANE_PHASES as readonly string[]).includes(value);
}

// ─── Event type filter set ────────────────────────────────────────────────────

/**
 * Event types that are meaningful for swim-lane bucketing.
 *
 * Excluded event types (too granular / no phase signal):
 *   • item_checked  — fires on every checklist tap; no phase information
 *   • photo_added   — fires when a photo is attached; no phase information
 *   • note_added    — free-text note; no phase information
 *
 * These are the same exclusions applied by the M2 journey stop filter
 * (see convex/journeyStopHelpers.ts → JOURNEY_STOP_EVENT_TYPES) but the
 * swim-lane set additionally includes `inspection_started` and
 * `inspection_completed` because they carry meaningful phase context (deployed).
 */
export const SWIM_LANE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "status_change",
  "inspection_started",
  "inspection_completed",
  "damage_reported",
  "shipped",
  "delivered",
  "custody_handoff",
  "mission_assigned",
  "template_applied",
]);

// ─── Raw event row shape ──────────────────────────────────────────────────────

/**
 * Minimum shape of a raw events row required by mapEventsToPhases.
 *
 * Using a minimal structural type (not the full Convex Doc<"events">) so
 * unit tests can pass plain objects without importing Convex server types.
 */
export interface RawSwimLaneEvent {
  /** Convex document ID — accepts an object with a toString() method or a plain string. */
  _id: { toString(): string } | string;
  /** Event type discriminant. */
  eventType: string;
  /** Kinde user ID of the actor. */
  userId: string;
  /** Display name of the actor. */
  userName: string;
  /** Epoch ms when the event occurred. */
  timestamp: number;
  /**
   * Event-specific payload.
   * For status_change events: { from: string, to: string, lat?, lng?, location? }
   * For other event types the shape varies.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any> | null | undefined;
}

// ─── Output types ─────────────────────────────────────────────────────────────

/**
 * A single case event enriched with its swim-lane phase bucket assignment.
 *
 * Returned by `mapEventsToPhases()` and exposed by the `getCasePhaseEvents`
 * Convex query.  Client components render these as activity items within each
 * swim-lane column card.
 */
export interface CasePhaseEvent {
  /**
   * Convex document ID of the events row (plain string).
   * Stable React key for list rendering.
   */
  eventId: string;

  /**
   * Event type discriminant.
   * One of the SWIM_LANE_EVENT_TYPES values.
   */
  eventType: string;

  /**
   * Epoch ms when the event occurred.
   * Used for sorting within a swim-lane column.
   */
  timestamp: number;

  /** Kinde user ID of the actor who triggered this event. */
  userId: string;

  /** Display name of the actor (for attribution labels). */
  userName: string;

  /**
   * The swim-lane phase (column) this event belongs to.
   *
   * For status_change events: the destination phase (data.to).
   * For all other events: the phase the case was in when the event occurred,
   *   determined by the most recent preceding status_change event's data.to.
   */
  phase: SwimLanePhase;

  /**
   * Whether this event is the one that caused the case to ENTER this phase.
   * True only for status_change events (where the event IS the phase transition).
   * False for all other event types (they occurred WITHIN the phase, not at entry).
   */
  isPhaseEntry: boolean;

  /**
   * Event-type-specific metadata subset for UI rendering.
   * Contains only the fields needed for swim-lane card activity display.
   * All values are safe, serialisable primitives.
   */
  metadata: SwimLaneEventMetadata;
}

/**
 * Typed metadata variants for swim-lane event display.
 *
 * Discriminated union based on eventType.  Client components can narrow
 * by checking `event.eventType` to access event-specific fields.
 */
export type SwimLaneEventMetadata =
  | StatusChangeMetadata
  | InspectionMetadata
  | DamageMetadata
  | ShippingMetadata
  | CustodyMetadata
  | MissionMetadata
  | TemplateMetadata
  | GenericMetadata;

export interface StatusChangeMetadata {
  kind: "status_change";
  /** Previous lifecycle status (from data.from). */
  from: string | undefined;
  /** Destination lifecycle status (from data.to). */
  to: string | undefined;
  /** Human-readable location at transition time (from data.location or data.locationName). */
  locationName?: string;
}

export interface InspectionMetadata {
  kind: "inspection";
  /** Sub-type: started or completed. */
  subKind: "started" | "completed";
  inspectionId?: string;
  totalItems?: number;
  checkedItems?: number;
  damagedItems?: number;
  missingItems?: number;
  /** Final inspection outcome (only for completed). */
  finalStatus?: string;
}

export interface DamageMetadata {
  kind: "damage_reported";
  templateItemId?: string;
  itemName?: string;
  severity?: string;
  description?: string;
}

export interface ShippingMetadata {
  kind: "shipping";
  /** Sub-type: shipped or delivered. */
  subKind: "shipped" | "delivered";
  trackingNumber?: string;
  carrier?: string;
  originName?: string;
  destinationName?: string;
}

export interface CustodyMetadata {
  kind: "custody_handoff";
  fromUserId?: string;
  fromUserName?: string;
  toUserId?: string;
  toUserName?: string;
}

export interface MissionMetadata {
  kind: "mission_assigned";
  missionId?: string;
  missionName?: string;
}

export interface TemplateMetadata {
  kind: "template_applied";
  templateId?: string;
  templateName?: string;
  itemCount?: number;
}

export interface GenericMetadata {
  kind: "generic";
}

// ─── Per-case swim-lane result ─────────────────────────────────────────────────

/**
 * Case data used within a swim-lane column card.
 *
 * Contains the minimal case fields needed to render a card in the swim-lane
 * board, plus the phase events that occurred while the case was in the
 * associated phase bucket.
 */
export interface SwimLaneCaseCard {
  /** Convex document ID of the case (plain string). */
  caseId: string;

  /** Display label, e.g. "CASE-001". */
  label: string;

  /**
   * Current lifecycle status of the case.
   * Equals the phase of the swim-lane column this card appears in.
   */
  currentPhase: SwimLanePhase;

  /** Last-known latitude. Undefined when no position is recorded. */
  lat?: number;

  /** Last-known longitude. Undefined when no position is recorded. */
  lng?: number;

  /** Human-readable current location name. */
  locationName?: string;

  /** Kinde user ID of the currently assigned technician. */
  assigneeId?: string;

  /** Display name of the currently assigned technician. */
  assigneeName?: string;

  /** Convex ID of the associated mission (for M2 grouping). */
  missionId?: string;

  /** FedEx tracking number (when the case is in transit). */
  trackingNumber?: string;

  /** Epoch ms when the case was last updated. */
  updatedAt: number;

  /**
   * Events that occurred while the case was in this phase bucket.
   * Ordered chronologically (earliest first).
   * Includes the phase-entry event (status_change to this phase) when present.
   */
  phaseEvents: CasePhaseEvent[];

  /**
   * The most recent event timestamp for this case in this phase.
   * Used for intra-column sorting (most recently active cases first).
   * undefined when no phase events exist.
   */
  mostRecentEventAt?: number;
}

// ─── Board-level result ───────────────────────────────────────────────────────

/**
 * A single swim-lane column bucket (one phase, all cases in that phase).
 */
export interface SwimLaneBucket {
  /** Lifecycle phase identifier for this column. */
  phase: SwimLanePhase;

  /** Human-readable column header label. */
  label: string;

  /**
   * Cases currently in this phase, ordered by most-recently-active first.
   * Active = has the most recent phase event in this column.
   */
  cases: SwimLaneCaseCard[];

  /** Total number of cases in this phase. */
  caseCount: number;

  /**
   * Total number of swim-lane events across all cases in this phase.
   * Used for the column event-count badge.
   */
  eventCount: number;
}

/**
 * Complete swim-lane board result returned by `getSwimLaneBoard`.
 *
 * Contains all phase buckets (including empty ones) in lifecycle order.
 * Client components use this to render the full swim-lane board.
 */
export interface SwimLaneBoardResult {
  /**
   * All swim-lane columns in lifecycle order.
   * Always contains exactly 8 buckets (one per SwimLanePhase).
   * Empty phases have caseCount = 0 and cases = [].
   */
  lanes: SwimLaneBucket[];

  /** Total number of cases across all phases. */
  totalCases: number;

  /** Total number of swim-lane events across all phases and cases. */
  totalEvents: number;

  /**
   * Epoch ms when the board result was assembled (server clock).
   * Used by client-side components to detect stale renders.
   */
  assembledAt: number;
}

// ─── Metadata extraction helpers ──────────────────────────────────────────────

/**
 * Extract typed swim-lane metadata from a raw event data payload.
 *
 * Returns a discriminated SwimLaneEventMetadata object containing only the
 * fields needed for swim-lane card activity display.  All values are safe,
 * serialisable primitives — no functions, no references, no Convex IDs.
 *
 * @param eventType  The event type discriminant.
 * @param data       The raw event.data payload (v.any() in schema).
 * @returns          Typed metadata object appropriate for the event type.
 */
export function extractSwimLaneMetadata(
  eventType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any> | null | undefined
): SwimLaneEventMetadata {
  const d = (data && typeof data === "object") ? data : {};

  switch (eventType) {
    case "status_change":
      return {
        kind:         "status_change",
        from:         typeof d.from         === "string" ? d.from         : undefined,
        to:           typeof d.to           === "string" ? d.to           : undefined,
        locationName:
          typeof d.location     === "string" ? d.location     :
          typeof d.locationName === "string" ? d.locationName :
          undefined,
      };

    case "inspection_started":
      return {
        kind:         "inspection",
        subKind:      "started",
        inspectionId: typeof d.inspectionId === "string" ? d.inspectionId : undefined,
        totalItems:   typeof d.totalItems   === "number" ? d.totalItems   : undefined,
        checkedItems: typeof d.checkedItems === "number" ? d.checkedItems : undefined,
        damagedItems: typeof d.damagedItems === "number" ? d.damagedItems : undefined,
        missingItems: typeof d.missingItems === "number" ? d.missingItems : undefined,
      };

    case "inspection_completed":
      return {
        kind:         "inspection",
        subKind:      "completed",
        inspectionId: typeof d.inspectionId === "string" ? d.inspectionId : undefined,
        totalItems:   typeof d.totalItems   === "number" ? d.totalItems   : undefined,
        checkedItems: typeof d.checkedItems === "number" ? d.checkedItems : undefined,
        damagedItems: typeof d.damagedItems === "number" ? d.damagedItems : undefined,
        missingItems: typeof d.missingItems === "number" ? d.missingItems : undefined,
        finalStatus:  typeof d.finalStatus  === "string" ? d.finalStatus  : undefined,
      };

    case "damage_reported":
      return {
        kind:           "damage_reported",
        templateItemId: typeof d.templateItemId === "string" ? d.templateItemId : undefined,
        itemName:       typeof d.itemName       === "string" ? d.itemName       : undefined,
        severity:       typeof d.severity       === "string" ? d.severity       : undefined,
        description:    typeof d.description    === "string" ? d.description    : undefined,
      };

    case "shipped":
      return {
        kind:            "shipping",
        subKind:         "shipped",
        trackingNumber:  typeof d.trackingNumber  === "string" ? d.trackingNumber  : undefined,
        carrier:         typeof d.carrier         === "string" ? d.carrier         : undefined,
        originName:      typeof d.originName      === "string" ? d.originName      : undefined,
        destinationName: typeof d.destinationName === "string" ? d.destinationName : undefined,
      };

    case "delivered":
      return {
        kind:            "shipping",
        subKind:         "delivered",
        trackingNumber:  typeof d.trackingNumber  === "string" ? d.trackingNumber  : undefined,
        carrier:         typeof d.carrier         === "string" ? d.carrier         : undefined,
        originName:      typeof d.originName      === "string" ? d.originName      : undefined,
        destinationName: typeof d.destinationName === "string" ? d.destinationName : undefined,
      };

    case "custody_handoff":
      return {
        kind:         "custody_handoff",
        fromUserId:   typeof d.fromUserId   === "string" ? d.fromUserId   : undefined,
        fromUserName: typeof d.fromUserName === "string" ? d.fromUserName : undefined,
        toUserId:     typeof d.toUserId     === "string" ? d.toUserId     : undefined,
        toUserName:   typeof d.toUserName   === "string" ? d.toUserName   : undefined,
      };

    case "mission_assigned":
      return {
        kind:        "mission_assigned",
        missionId:   typeof d.missionId   === "string" ? d.missionId   : undefined,
        missionName: typeof d.missionName === "string" ? d.missionName : undefined,
      };

    case "template_applied":
      return {
        kind:         "template_applied",
        templateId:   typeof d.templateId   === "string" ? d.templateId   : undefined,
        templateName: typeof d.templateName === "string" ? d.templateName : undefined,
        itemCount:    typeof d.itemCount    === "number" ? d.itemCount    : undefined,
      };

    default:
      return { kind: "generic" };
  }
}

// ─── Core phase-mapping function ──────────────────────────────────────────────

/**
 * Map a case's raw events to swim-lane phase bucket assignments.
 *
 * Algorithm:
 * ─────────
 * 1. Filter `events` to only SWIM_LANE_EVENT_TYPES.
 * 2. Sort the filtered events chronologically by `timestamp` ascending.
 *    (Tie-break by eventType for deterministic ordering of simultaneous events.)
 * 3. Walk events in order, maintaining a `currentPhase` cursor:
 *    a. For status_change events:
 *       - Read `data.to` as the destination phase.
 *       - If `data.to` is a valid SwimLanePhase, update `currentPhase` to it.
 *       - Assign the event to the destination phase bucket.
 *       - Set `isPhaseEntry = true`.
 *    b. For all other events:
 *       - Assign to `currentPhase` (the phase the case is currently in).
 *       - Set `isPhaseEntry = false`.
 * 4. Initial `currentPhase` is set to `caseCurrentStatus` before processing
 *    any events (fallback for cases with no status_change events yet).
 * 5. Return the mapped CasePhaseEvent array (chronological order preserved).
 *
 * Phase assignment is semantically correct: each event is associated with
 * the lifecycle phase the case was occupying when the event occurred, rather
 * than a static heuristic based on event type alone.
 *
 * @param events           Raw event rows for a single case (any order; will be sorted).
 * @param caseCurrentStatus  The case's current status from cases.status (fallback initial phase).
 * @returns                CasePhaseEvent[] in chronological order, with phase assignments.
 */
export function mapEventsToPhases(
  events: RawSwimLaneEvent[],
  caseCurrentStatus: string,
): CasePhaseEvent[] {
  // ── 1. Filter to swim-lane-significant event types ─────────────────────────
  const filtered = events.filter((e) => SWIM_LANE_EVENT_TYPES.has(e.eventType));

  if (filtered.length === 0) return [];

  // ── 2. Sort chronologically; deterministic tie-break by eventType ──────────
  const sorted = [...filtered].sort((a, b) => {
    const tDiff = a.timestamp - b.timestamp;
    if (tDiff !== 0) return tDiff;
    return a.eventType.localeCompare(b.eventType);
  });

  // ── 3. Walk events maintaining running phase state ─────────────────────────
  // Initial phase = current case status (safe fallback when no status_change seen yet)
  let currentPhase: SwimLanePhase = isSwimLanePhase(caseCurrentStatus)
    ? caseCurrentStatus
    : "hangar";

  const result: CasePhaseEvent[] = [];

  for (const event of sorted) {
    let phase = currentPhase;
    let isPhaseEntry = false;

    if (event.eventType === "status_change") {
      // Derive destination phase from data.to
      const data = (event.data && typeof event.data === "object") ? event.data : {};
      const toStatus = data.to;

      if (isSwimLanePhase(toStatus)) {
        // Update the running phase cursor to the new status
        currentPhase = toStatus;
        phase = toStatus;
      }
      // If data.to is absent or invalid (edge case), assign to currentPhase
      // so the event still appears in a valid column.
      isPhaseEntry = true;
    }
    // Non-status_change events: use the current running phase, isPhaseEntry = false

    result.push({
      eventId:      typeof event._id === "string" ? event._id : event._id.toString(),
      eventType:    event.eventType,
      timestamp:    event.timestamp,
      userId:       event.userId,
      userName:     event.userName,
      phase,
      isPhaseEntry,
      metadata:     extractSwimLaneMetadata(event.eventType, event.data),
    });
  }

  return result;
}

// ─── Board assembly function ──────────────────────────────────────────────────

/**
 * Context for a single case needed to build its swim-lane card.
 */
export interface CaseForSwimLane {
  /** Convex document ID (plain string). */
  caseId: string;
  label: string;
  currentStatus: string;
  lat?: number;
  lng?: number;
  locationName?: string;
  assigneeId?: string;
  assigneeName?: string;
  missionId?: string;
  trackingNumber?: string;
  updatedAt: number;
  /** All raw events for this case (any order; mapEventsToPhases will sort). */
  events: RawSwimLaneEvent[];
}

/**
 * Assemble the full swim-lane board from a list of cases with their events.
 *
 * This is a pure, synchronous function with no database calls.  It is
 * delegated to from the `getSwimLaneBoard` Convex query handler after all
 * DB reads are complete, enabling unit testing without a Convex runtime.
 *
 * Algorithm:
 * ─────────
 * 1. Initialise 8 empty buckets (one per SwimLanePhase).
 * 2. For each case:
 *    a. Determine the case's current phase from `currentStatus`.
 *       Fall back to "hangar" for unknown statuses.
 *    b. Map all case events to phase assignments via mapEventsToPhases().
 *    c. Extract the phase events for the case's current phase bucket only
 *       (events that occurred WHILE the case was in this phase).
 *       Note: events from OTHER phases (historical events in previous phases)
 *       are NOT included in the card — the card shows the current phase only.
 *    d. Build a SwimLaneCaseCard and push to the appropriate bucket.
 * 3. Sort each bucket's cases by mostRecentEventAt desc (most active first),
 *    with updatedAt as the fallback sort key.
 * 4. Compute bucket-level aggregates (caseCount, eventCount).
 * 5. Return the complete SwimLaneBoardResult.
 *
 * @param cases      Array of cases with their events pre-loaded from the DB.
 * @param assembledAt  Epoch ms timestamp for the result metadata field.
 * @returns          The complete swim-lane board result.
 */
export function assembleSwimLaneBoard(
  cases: CaseForSwimLane[],
  assembledAt: number,
): SwimLaneBoardResult {
  // ── 1. Initialise empty bucket map ────────────────────────────────────────
  const bucketMap = new Map<SwimLanePhase, SwimLaneCaseCard[]>();
  for (const phase of SWIM_LANE_PHASES) {
    bucketMap.set(phase, []);
  }

  let totalEvents = 0;

  // ── 2. Process each case ─────────────────────────────────────────────────
  for (const c of cases) {
    const casePhase: SwimLanePhase = isSwimLanePhase(c.currentStatus)
      ? c.currentStatus
      : "hangar";

    // Map ALL events for this case to their phase buckets
    const allPhaseEvents = mapEventsToPhases(c.events, c.currentStatus);

    // Extract only the events that belong to this case's CURRENT phase.
    // These are the events shown in the card within the current column.
    // Historical events (from previous phases) are not shown in the card
    // to avoid overwhelming the board view with past lifecycle history.
    const currentPhaseEvents = allPhaseEvents.filter((e) => e.phase === casePhase);

    const mostRecentEventAt =
      currentPhaseEvents.length > 0
        ? currentPhaseEvents[currentPhaseEvents.length - 1].timestamp
        : undefined;

    const card: SwimLaneCaseCard = {
      caseId:          c.caseId,
      label:           c.label,
      currentPhase:    casePhase,
      lat:             c.lat,
      lng:             c.lng,
      locationName:    c.locationName,
      assigneeId:      c.assigneeId,
      assigneeName:    c.assigneeName,
      missionId:       c.missionId,
      trackingNumber:  c.trackingNumber,
      updatedAt:       c.updatedAt,
      phaseEvents:     currentPhaseEvents,
      mostRecentEventAt,
    };

    // Push card into its phase bucket
    const bucket = bucketMap.get(casePhase);
    if (bucket) {
      bucket.push(card);
      totalEvents += currentPhaseEvents.length;
    }
  }

  // ── 3. Sort each bucket: most recently active cases first ─────────────────
  for (const [, cards] of bucketMap) {
    cards.sort((a, b) => {
      const aTime = a.mostRecentEventAt ?? a.updatedAt;
      const bTime = b.mostRecentEventAt ?? b.updatedAt;
      return bTime - aTime;  // descending: most recent first
    });
  }

  // ── 4. Build ordered lanes array ─────────────────────────────────────────
  const lanes: SwimLaneBucket[] = SWIM_LANE_PHASES.map((phase) => {
    const casesInPhase = bucketMap.get(phase) ?? [];
    const eventCount = casesInPhase.reduce(
      (sum, card) => sum + card.phaseEvents.length,
      0
    );
    return {
      phase,
      label:      SWIM_LANE_LABELS[phase],
      cases:      casesInPhase,
      caseCount:  casesInPhase.length,
      eventCount,
    };
  });

  return {
    lanes,
    totalCases:  cases.length,
    totalEvents,
    assembledAt,
  };
}
