/**
 * convex/journeyStopHelpers.ts
 *
 * Pure helper functions for deriving M2 journey stops from case event rows.
 *
 * These functions are extracted from the Convex query handler so they can be
 * unit-tested without a live Convex backend.  The query handler in
 * convex/queries/journeyStops.ts loads the raw DB rows and delegates to
 * deriveJourneyStops() for the transformation.
 *
 * Journey Stop Model
 * ──────────────────
 * A "journey stop" represents a meaningful milestone in a case's physical
 * lifecycle — a point in time when the case was at a known location or
 * underwent a significant business-level action.
 *
 * Not every event type is a journey stop.  Fine-grained checklist updates
 * (item_checked, photo_added) happen too frequently to be useful as map pins
 * and carry no location information.  The following event types ARE stops:
 *
 *   status_change     — case moved to a new lifecycle stage (most carry GPS)
 *   inspection_started  — field technician opened the checklist at a site
 *   inspection_completed — field technician finished the inspection
 *   damage_reported   — damage found; may change case trajectory
 *   shipped           — case handed to carrier (origin/destination metadata)
 *   delivered         — carrier confirmed delivery at destination
 *   custody_handoff   — physical custody transferred between persons
 *   mission_assigned  — case linked to a mission (potential location change)
 *   template_applied  — packing template set (meaningful provenance step)
 *
 * Location Derivation Strategy
 * ─────────────────────────────
 * Events do not have their own lat/lng fields in the schema — location data
 * lives in the `data: any` payload (populated by mutations that receive GPS
 * coordinates).  The derivation priority is:
 *
 *   1. event.data.lat / event.data.lng — GPS captured at event time
 *      (written by scanCheckIn for status_change events)
 *   2. event.data.location / event.data.locationName — human-readable location
 *      string captured at event time
 *   3. caseLat / caseLng — the case's current position (last-known fallback;
 *      used when the event type doesn't carry its own position)
 *
 * Stop Index
 * ──────────
 * Stops are numbered 1..N in chronological order of event.timestamp (epoch ms).
 * stopIndex = 1 is the earliest event; stopIndex = N is the most recent.
 */

// ─── Event type filter set ────────────────────────────────────────────────────

/**
 * Event types that produce a journey stop.
 *
 * item_checked and photo_added are excluded — they fire too frequently and
 * carry no location data.  note_added is excluded for the same reason.
 */
export const JOURNEY_STOP_EVENT_TYPES: ReadonlySet<string> = new Set([
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

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimum shape of a raw events row required by deriveJourneyStops.
 *
 * Using a minimal structural type (not the full Convex Doc<"events">) so
 * unit tests can pass plain objects without importing Convex server types.
 */
export interface RawEventRow {
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
   * For status_change events written by scanCheckIn:
   *   { from: string, to: string, lat?: number, lng?: number, location?: string }
   * For other event types the shape varies but is not required for stop derivation.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any> | null | undefined;
}

/**
 * A single numbered journey stop derived from one case event.
 *
 * Exported from this module and re-exported by convex/queries/journeyStops.ts
 * so client-side hooks and components can import the type without touching
 * Convex server internals.
 */
export interface JourneyStop {
  /**
   * Sequential 1-based position in the journey (1 = earliest event).
   * Assigned after chronological sort by event.timestamp.
   */
  stopIndex: number;

  /**
   * Convex document ID of the source events row (as a plain string).
   * Stable reference for React keys and audit cross-linking.
   */
  eventId: string;

  /**
   * Event type discriminant.  One of the JOURNEY_STOP_EVENT_TYPES values:
   *   "status_change" | "inspection_started" | "inspection_completed" |
   *   "damage_reported" | "shipped" | "delivered" |
   *   "custody_handoff" | "mission_assigned" | "template_applied"
   */
  eventType: string;

  /** Epoch ms when the event occurred (from events.timestamp). */
  timestamp: number;

  /**
   * Geographic location of this stop.
   * Derived from the event payload (preferred) or the case's last-known
   * position (fallback).  All three sub-fields may be undefined when neither
   * source has location data.
   */
  location: {
    lat?: number;
    lng?: number;
    locationName?: string;
  };

  /**
   * Whether this stop has at least one coordinate (lat + lng both defined).
   * Convenience flag for map rendering — avoids null-checks in callers.
   */
  hasCoordinates: boolean;

  /** Kinde user ID of the person who triggered this event. */
  actorId: string;

  /** Display name of the actor (for tooltips and audit labels). */
  actorName: string;

  /**
   * Event-specific metadata subset for UI rendering.
   *
   * For status_change:  { from: string, to: string }
   * For inspection_*:   { inspectionId: string, totalItems?: number, ... }
   * For damage_reported: { templateItemId?: string, severity?: string, ... }
   * For shipped:        { trackingNumber?: string, carrier?: string }
   * For custody_handoff: { fromUserId?: string, fromUserName?: string, toUserId?: string, toUserName?: string }
   * For others:         the raw data payload (safe copy, no functions).
   */
  metadata: Record<string, unknown>;
}

/**
 * Computed journey summary for a single case.
 *
 * Returned by deriveJourneyStops and re-exported by the query handler.
 * The summary fields are computed once from the stops array so callers
 * don't need to scan the stops themselves.
 */
export interface M2CaseJourney {
  /** Convex document ID of the case (plain string). */
  caseId: string;

  /** Display label, e.g. "CASE-001". */
  caseLabel: string;

  /** Current lifecycle status of the case. */
  currentStatus: string;

  /** Last-known latitude of the case (from cases.lat). */
  currentLat?: number;

  /** Last-known longitude of the case (from cases.lng). */
  currentLng?: number;

  /** Human-readable current location name (from cases.locationName). */
  currentLocationName?: string;

  /** All journey stops in chronological order (stop 1 first). */
  stops: JourneyStop[];

  /**
   * Total number of journey stops.
   * Equals stops.length; provided for convenience so callers don't
   * need to destructure the full stops array for a count badge.
   */
  stopCount: number;

  /**
   * The first (earliest) journey stop, or null when no stops exist.
   * Equivalent to stops[0] but null-safe.
   */
  firstStop: JourneyStop | null;

  /**
   * The most recent journey stop, or null when no stops exist.
   * Equivalent to stops[stops.length - 1] but null-safe.
   */
  lastStop: JourneyStop | null;

  /**
   * Whether any stop has valid coordinates (lat + lng both defined).
   * When false, the M2 map cannot place this case's journey on the map.
   */
  hasLocation: boolean;
}

// ─── Location extraction helper ───────────────────────────────────────────────

/**
 * Extract a location object from an event data payload.
 *
 * Checks several common field names written by SCAN app mutations:
 *   • data.lat / data.lng (written by scanCheckIn for status_change events)
 *   • data.location (human-readable name from scanCheckIn)
 *   • data.locationName (alternative field name used by some mutations)
 *   • data.originLat / data.originLng (written by shipCase for shipped events)
 *   • data.destinationLat / data.destinationLng (shipped destination)
 *
 * Returns an object with at most lat, lng, and locationName — all optional.
 *
 * @param data  The raw event.data payload (any shape, may be null/undefined).
 * @returns     A location object, possibly with all fields undefined.
 */
export function extractLocationFromEventData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any> | null | undefined
): { lat?: number; lng?: number; locationName?: string } {
  if (!data || typeof data !== "object") {
    return {};
  }

  const lat =
    typeof data.lat === "number" ? data.lat :
    typeof data.originLat === "number" ? data.originLat :
    undefined;

  const lng =
    typeof data.lng === "number" ? data.lng :
    typeof data.originLng === "number" ? data.originLng :
    undefined;

  const locationName =
    typeof data.location === "string" ? data.location :
    typeof data.locationName === "string" ? data.locationName :
    undefined;

  return { lat, lng, locationName };
}

// ─── Metadata extraction helper ───────────────────────────────────────────────

/**
 * Extract event-type-specific metadata for the JourneyStop.metadata field.
 *
 * Returns a safe plain-object subset of the event data payload, using only
 * fields that are meaningful for M2 map tooltip display.  This prevents the
 * full (potentially large) event payload from being serialised into every
 * stop object returned to the client.
 *
 * @param eventType  The event type discriminant.
 * @param data       The raw event.data payload.
 * @returns          A safe, serialisable metadata object.
 */
export function extractStopMetadata(
  eventType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any> | null | undefined
): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    return {};
  }

  switch (eventType) {
    case "status_change":
      return {
        from: typeof data.from === "string" ? data.from : undefined,
        to:   typeof data.to   === "string" ? data.to   : undefined,
      };

    case "inspection_started":
    case "inspection_completed":
      return {
        inspectionId: typeof data.inspectionId === "string" ? data.inspectionId : undefined,
        totalItems:   typeof data.totalItems   === "number" ? data.totalItems   : undefined,
        checkedItems: typeof data.checkedItems === "number" ? data.checkedItems : undefined,
        damagedItems: typeof data.damagedItems === "number" ? data.damagedItems : undefined,
        missingItems: typeof data.missingItems === "number" ? data.missingItems : undefined,
        finalStatus:  typeof data.finalStatus  === "string" ? data.finalStatus  : undefined,
      };

    case "damage_reported":
      return {
        templateItemId: typeof data.templateItemId === "string" ? data.templateItemId : undefined,
        itemName:       typeof data.itemName       === "string" ? data.itemName       : undefined,
        severity:       typeof data.severity       === "string" ? data.severity       : undefined,
        description:    typeof data.description    === "string" ? data.description    : undefined,
        newStatus:      typeof data.newStatus      === "string" ? data.newStatus      : undefined,
      };

    case "shipped":
    case "delivered":
      return {
        trackingNumber:  typeof data.trackingNumber  === "string" ? data.trackingNumber  : undefined,
        carrier:         typeof data.carrier         === "string" ? data.carrier         : undefined,
        destinationName: typeof data.destinationName === "string" ? data.destinationName : undefined,
        originName:      typeof data.originName      === "string" ? data.originName      : undefined,
      };

    case "custody_handoff":
      return {
        fromUserId:   typeof data.fromUserId   === "string" ? data.fromUserId   : undefined,
        fromUserName: typeof data.fromUserName === "string" ? data.fromUserName : undefined,
        toUserId:     typeof data.toUserId     === "string" ? data.toUserId     : undefined,
        toUserName:   typeof data.toUserName   === "string" ? data.toUserName   : undefined,
      };

    case "mission_assigned":
      return {
        missionId:   typeof data.missionId   === "string" ? data.missionId   : undefined,
        missionName: typeof data.missionName === "string" ? data.missionName : undefined,
      };

    case "template_applied":
      return {
        templateId:   typeof data.templateId   === "string" ? data.templateId   : undefined,
        templateName: typeof data.templateName === "string" ? data.templateName : undefined,
        itemCount:    typeof data.itemCount    === "number" ? data.itemCount    : undefined,
      };

    default:
      return {};
  }
}

// ─── Core derivation function ─────────────────────────────────────────────────

/**
 * Context for the case whose journey is being derived.
 * Contains the case's current position as a location fallback when events
 * do not carry their own GPS coordinates.
 */
export interface CaseContext {
  /** Convex document ID of the case (plain string). */
  caseId: string;
  /** Case display label, e.g. "CASE-001". */
  caseLabel: string;
  /** Current lifecycle status. */
  currentStatus: string;
  /** Last-known latitude (from cases.lat). */
  currentLat?: number;
  /** Last-known longitude (from cases.lng). */
  currentLng?: number;
  /** Human-readable current location name (from cases.locationName). */
  currentLocationName?: string;
}

/**
 * Derive numbered journey stops from a case's event history.
 *
 * Algorithm
 * ─────────
 * 1. Filter `events` to only JOURNEY_STOP_EVENT_TYPES.
 * 2. Sort the filtered events chronologically by `timestamp` ascending.
 * 3. Map each event to a JourneyStop:
 *    a. Attempt to extract lat/lng/locationName from event.data.
 *    b. Fall back to case.currentLat/Lng/LocationName when event has no location.
 *    c. Compute hasCoordinates = lat !== undefined && lng !== undefined.
 *    d. Extract event-type-specific metadata.
 *    e. Assign sequential stopIndex (1-based).
 * 4. Return M2CaseJourney with stops array, summary fields, and case metadata.
 *
 * Sorting note:
 *   Events are sorted by `timestamp` (epoch ms) ascending.  If two events
 *   share the same timestamp (e.g., scanCheckIn creates a status_change event
 *   and an inspection_started event atomically), they are ordered by the event
 *   type's natural alphabetical order for deterministic stop indices.  This
 *   only affects the stop index of simultaneous events, not their timeline
 *   position (both show the same timestamp in the UI).
 *
 * Fallback location semantics:
 *   A stop's location falls back to the case's CURRENT position, not the
 *   position at the time of the event (which would require a time-travel query).
 *   This is an intentional simplification — the current position is the most
 *   reliably available data and is accurate enough for the M2 map panel.
 *
 * @param events      Raw event rows from the `events` table for this case.
 *                    May be in any order; this function sorts them.
 * @param caseCtx     The case's current state (for label, status, position fallback).
 * @returns           M2CaseJourney with all derived journey stops.
 */
export function deriveJourneyStops(
  events: RawEventRow[],
  caseCtx: CaseContext
): M2CaseJourney {
  // ── 1. Filter to stop-worthy event types ─────────────────────────────────
  const stopEvents = events.filter((e) =>
    JOURNEY_STOP_EVENT_TYPES.has(e.eventType)
  );

  // ── 2. Sort chronologically by timestamp; break ties alphabetically ───────
  const sorted = [...stopEvents].sort((a, b) => {
    const tDiff = a.timestamp - b.timestamp;
    if (tDiff !== 0) return tDiff;
    // Tie-break by event type for deterministic stop indices
    return a.eventType.localeCompare(b.eventType);
  });

  // ── 3. Build fallback location from case context ──────────────────────────
  const fallbackLocation = {
    lat:          caseCtx.currentLat,
    lng:          caseCtx.currentLng,
    locationName: caseCtx.currentLocationName,
  };

  // ── 4. Map to JourneyStop objects ─────────────────────────────────────────
  const stops: JourneyStop[] = sorted.map((event, index): JourneyStop => {
    // Extract location from event data first; fall back to case context.
    const eventLocation = extractLocationFromEventData(event.data);

    const lat          = eventLocation.lat          ?? fallbackLocation.lat;
    const lng          = eventLocation.lng          ?? fallbackLocation.lng;
    const locationName = eventLocation.locationName ?? fallbackLocation.locationName;

    return {
      stopIndex:      index + 1,    // 1-based
      eventId:        typeof event._id === "string" ? event._id : event._id.toString(),
      eventType:      event.eventType,
      timestamp:      event.timestamp,
      location:       { lat, lng, locationName },
      hasCoordinates: lat !== undefined && lng !== undefined,
      actorId:        event.userId,
      actorName:      event.userName,
      metadata:       extractStopMetadata(event.eventType, event.data),
    };
  });

  // ── 5. Assemble and return M2CaseJourney ──────────────────────────────────
  const hasLocation = stops.some((s) => s.hasCoordinates);

  return {
    caseId:              caseCtx.caseId,
    caseLabel:           caseCtx.caseLabel,
    currentStatus:       caseCtx.currentStatus,
    currentLat:          caseCtx.currentLat,
    currentLng:          caseCtx.currentLng,
    currentLocationName: caseCtx.currentLocationName,
    stops,
    stopCount:           stops.length,
    firstStop:           stops.length > 0 ? stops[0] : null,
    lastStop:            stops.length > 0 ? stops[stops.length - 1] : null,
    hasLocation,
  };
}
