/**
 * Unit tests for convex/journeyStopHelpers.ts
 *
 * Sub-AC 6.1: M2 data layer — derive numbered journey stops from case events,
 * ordered chronologically with stop index, location, timestamp, and event-type
 * metadata.
 *
 * These tests cover the pure, database-free helper functions exported from
 * convex/journeyStopHelpers.ts:
 *
 *   JOURNEY_STOP_EVENT_TYPES       — set of event types that produce stops
 *   extractLocationFromEventData   — location extraction from event payloads
 *   extractStopMetadata            — event-type-specific metadata extraction
 *   deriveJourneyStops             — core derivation function
 *
 * Coverage matrix
 * ───────────────
 *
 * JOURNEY_STOP_EVENT_TYPES:
 *   ✓ contains all 9 expected event types
 *   ✓ excludes item_checked, photo_added, note_added
 *   ✓ all values are strings
 *
 * extractLocationFromEventData:
 *   ✓ returns empty object for null/undefined data
 *   ✓ returns empty object for non-object data
 *   ✓ extracts lat + lng from data.lat / data.lng (scanCheckIn path)
 *   ✓ extracts locationName from data.location
 *   ✓ extracts locationName from data.locationName (alternate field name)
 *   ✓ falls back to originLat/originLng when lat/lng absent
 *   ✓ extracts partial location (lat only, lng only)
 *   ✓ ignores non-numeric lat/lng values
 *   ✓ returns all three fields when all are present
 *
 * extractStopMetadata:
 *   ✓ returns empty object for null data
 *   ✓ status_change: extracts from, to
 *   ✓ inspection_started: extracts inspectionId, totalItems, checkedItems, etc.
 *   ✓ inspection_completed: extracts finalStatus
 *   ✓ damage_reported: extracts templateItemId, severity, description
 *   ✓ shipped: extracts trackingNumber, carrier, destinationName
 *   ✓ delivered: extracts trackingNumber, carrier
 *   ✓ custody_handoff: extracts from/to userId and userName
 *   ✓ mission_assigned: extracts missionId, missionName
 *   ✓ template_applied: extracts templateId, templateName, itemCount
 *   ✓ unknown event type: returns empty object
 *   ✓ metadata excludes undefined fields (not omitted, value is undefined)
 *   ✓ non-string/number values for extracted fields fall back to undefined
 *
 * deriveJourneyStops:
 *   ✓ empty events array → stops=[], stopCount=0, firstStop=null, lastStop=null
 *   ✓ all non-stop events → stops=[], stopCount=0
 *   ✓ filters out item_checked events
 *   ✓ filters out photo_added events
 *   ✓ filters out note_added events
 *   ✓ single status_change event → one stop with stopIndex=1
 *   ✓ two events → two stops with correct stopIndices
 *   ✓ events sorted chronologically by timestamp ascending
 *   ✓ out-of-order events are re-sorted correctly
 *   ✓ tie-break by eventType alphabetical order
 *   ✓ stopIndex is always 1-based and consecutive
 *   ✓ stopCount === stops.length
 *   ✓ firstStop === stops[0]
 *   ✓ lastStop === stops[stops.length - 1]
 *   ✓ eventId coerced from { toString() } to string
 *   ✓ location extracted from event data.lat/lng for status_change
 *   ✓ location falls back to case currentLat/Lng when event has none
 *   ✓ location falls back to case currentLocationName when event has none
 *   ✓ event location takes priority over case location
 *   ✓ hasCoordinates=true when lat+lng both defined
 *   ✓ hasCoordinates=false when lat or lng missing
 *   ✓ hasLocation=true when at least one stop has coordinates
 *   ✓ hasLocation=false when no stop has coordinates
 *   ✓ caseId/caseLabel/currentStatus from caseCtx
 *   ✓ currentLat/Lng/LocationName from caseCtx
 *   ✓ actorId + actorName from event.userId / event.userName
 *   ✓ metadata extracted per eventType
 *   ✓ handles case with only one of lat/lng (partial coordinates)
 *   ✓ multiple event types in one journey — all correctly mapped
 *   ✓ large journey (20 stops) — correct indices and order
 */

import { describe, it, expect } from "vitest";
import {
  JOURNEY_STOP_EVENT_TYPES,
  extractLocationFromEventData,
  extractStopMetadata,
  deriveJourneyStops,
} from "../../../convex/journeyStopHelpers";
import type {
  RawEventRow,
  CaseContext,
  JourneyStop,
  M2CaseJourney,
} from "../../../convex/journeyStopHelpers";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

/** Factory for a minimal valid RawEventRow. */
function makeEvent(overrides: Partial<{
  _id:       string | { toString(): string };
  eventType: string;
  userId:    string;
  userName:  string;
  timestamp: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data:      Record<string, any> | null;
}> = {}): RawEventRow {
  return {
    _id:       "evt-001",
    eventType: "status_change",
    userId:    "user-alice",
    userName:  "Alice Tech",
    timestamp: 1_700_000_000_000,
    data:      null,
    ...overrides,
  };
}

/** Factory for a minimal valid CaseContext. */
function makeCaseCtx(overrides: Partial<CaseContext> = {}): CaseContext {
  return {
    caseId:              "case-abc",
    caseLabel:           "CASE-001",
    currentStatus:       "deployed",
    currentLat:          undefined,
    currentLng:          undefined,
    currentLocationName: undefined,
    ...overrides,
  };
}

const T1 = 1_700_000_000_000;
const T2 = 1_700_001_000_000;
const T3 = 1_700_002_000_000;

// ─── JOURNEY_STOP_EVENT_TYPES ──────────────────────────────────────────────────

describe("JOURNEY_STOP_EVENT_TYPES", () => {
  const EXPECTED_TYPES = [
    "status_change",
    "inspection_started",
    "inspection_completed",
    "damage_reported",
    "shipped",
    "delivered",
    "custody_handoff",
    "mission_assigned",
    "template_applied",
  ] as const;

  it("contains all 9 expected journey-stop event types", () => {
    expect(JOURNEY_STOP_EVENT_TYPES.size).toBe(9);
    for (const t of EXPECTED_TYPES) {
      expect(JOURNEY_STOP_EVENT_TYPES.has(t)).toBe(true);
    }
  });

  it("excludes item_checked — too granular for journey stops", () => {
    expect(JOURNEY_STOP_EVENT_TYPES.has("item_checked")).toBe(false);
  });

  it("excludes photo_added — carries no location or status info", () => {
    expect(JOURNEY_STOP_EVENT_TYPES.has("photo_added")).toBe(false);
  });

  it("excludes note_added — free-text annotation, not a physical stop", () => {
    expect(JOURNEY_STOP_EVENT_TYPES.has("note_added")).toBe(false);
  });

  it("all values are strings", () => {
    for (const t of JOURNEY_STOP_EVENT_TYPES) {
      expect(typeof t).toBe("string");
    }
  });
});

// ─── extractLocationFromEventData ─────────────────────────────────────────────

describe("extractLocationFromEventData", () => {
  it("returns an empty object for null data", () => {
    expect(extractLocationFromEventData(null)).toEqual({});
  });

  it("returns an empty object for undefined data", () => {
    expect(extractLocationFromEventData(undefined)).toEqual({});
  });

  it("returns an empty object for non-object data (string)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(extractLocationFromEventData("bad" as any)).toEqual({});
  });

  it("extracts lat and lng from data.lat / data.lng", () => {
    const result = extractLocationFromEventData({ lat: 42.36, lng: -71.06 });
    expect(result.lat).toBeCloseTo(42.36);
    expect(result.lng).toBeCloseTo(-71.06);
  });

  it("extracts locationName from data.location", () => {
    const result = extractLocationFromEventData({ location: "Site Alpha" });
    expect(result.locationName).toBe("Site Alpha");
  });

  it("extracts locationName from data.locationName (alternate field name)", () => {
    const result = extractLocationFromEventData({ locationName: "Bay 4" });
    expect(result.locationName).toBe("Bay 4");
  });

  it("prefers data.location over data.locationName when both present", () => {
    const result = extractLocationFromEventData({
      location: "Primary Location",
      locationName: "Secondary Location",
    });
    expect(result.locationName).toBe("Primary Location");
  });

  it("falls back to originLat/originLng when lat/lng not present", () => {
    const result = extractLocationFromEventData({
      originLat: 37.77,
      originLng: -122.42,
    });
    expect(result.lat).toBeCloseTo(37.77);
    expect(result.lng).toBeCloseTo(-122.42);
  });

  it("prefers data.lat over data.originLat", () => {
    const result = extractLocationFromEventData({
      lat: 10.0,
      originLat: 20.0,
    });
    expect(result.lat).toBeCloseTo(10.0);
  });

  it("returns partial location when only lat is present", () => {
    const result = extractLocationFromEventData({ lat: 42.36 });
    expect(result.lat).toBeCloseTo(42.36);
    expect(result.lng).toBeUndefined();
  });

  it("returns partial location when only lng is present", () => {
    const result = extractLocationFromEventData({ lng: -71.06 });
    expect(result.lat).toBeUndefined();
    expect(result.lng).toBeCloseTo(-71.06);
  });

  it("ignores non-numeric lat value", () => {
    const result = extractLocationFromEventData({ lat: "not a number", lng: -71.06 });
    expect(result.lat).toBeUndefined();
    expect(result.lng).toBeCloseTo(-71.06);
  });

  it("ignores non-numeric lng value", () => {
    const result = extractLocationFromEventData({ lat: 42.36, lng: null });
    expect(result.lat).toBeCloseTo(42.36);
    expect(result.lng).toBeUndefined();
  });

  it("returns all three fields when all are present", () => {
    const result = extractLocationFromEventData({
      lat: 42.36,
      lng: -71.06,
      location: "Site Beta",
    });
    expect(result.lat).toBeCloseTo(42.36);
    expect(result.lng).toBeCloseTo(-71.06);
    expect(result.locationName).toBe("Site Beta");
  });

  it("returns empty object when data has none of the location fields", () => {
    const result = extractLocationFromEventData({ status: "ok", notes: "test" });
    expect(result).toEqual({});
  });
});

// ─── extractStopMetadata ──────────────────────────────────────────────────────

describe("extractStopMetadata", () => {
  it("returns empty object for null data", () => {
    expect(extractStopMetadata("status_change", null)).toEqual({});
  });

  it("returns empty object for undefined data", () => {
    expect(extractStopMetadata("status_change", undefined)).toEqual({});
  });

  it("returns empty object for unknown event type", () => {
    const result = extractStopMetadata("unknown_type", { foo: "bar" });
    expect(result).toEqual({});
  });

  describe("status_change", () => {
    it("extracts from and to status strings", () => {
      const result = extractStopMetadata("status_change", {
        from: "hangar",
        to: "assembled",
      });
      expect(result).toEqual({ from: "hangar", to: "assembled" });
    });

    it("returns undefined for non-string from/to values", () => {
      const result = extractStopMetadata("status_change", { from: 42, to: null });
      expect(result.from).toBeUndefined();
      expect(result.to).toBeUndefined();
    });
  });

  describe("inspection_started", () => {
    it("extracts all inspection fields", () => {
      const result = extractStopMetadata("inspection_started", {
        inspectionId: "insp-001",
        totalItems:   10,
        checkedItems: 3,
        damagedItems: 1,
        missingItems: 0,
      });
      expect(result.inspectionId).toBe("insp-001");
      expect(result.totalItems).toBe(10);
      expect(result.checkedItems).toBe(3);
      expect(result.damagedItems).toBe(1);
      expect(result.missingItems).toBe(0);
      expect(result.finalStatus).toBeUndefined();
    });
  });

  describe("inspection_completed", () => {
    it("extracts finalStatus", () => {
      const result = extractStopMetadata("inspection_completed", {
        inspectionId: "insp-002",
        finalStatus:  "flagged",
        totalItems:   5,
        checkedItems: 5,
        damagedItems: 1,
        missingItems: 0,
      });
      expect(result.finalStatus).toBe("flagged");
      expect(result.inspectionId).toBe("insp-002");
    });
  });

  describe("damage_reported", () => {
    it("extracts templateItemId, severity, and description", () => {
      const result = extractStopMetadata("damage_reported", {
        templateItemId: "item-battery",
        itemName:       "Battery Pack",
        severity:       "moderate",
        description:    "Housing crack",
        newStatus:      "damaged",
      });
      expect(result.templateItemId).toBe("item-battery");
      expect(result.itemName).toBe("Battery Pack");
      expect(result.severity).toBe("moderate");
      expect(result.description).toBe("Housing crack");
      expect(result.newStatus).toBe("damaged");
    });
  });

  describe("shipped", () => {
    it("extracts trackingNumber, carrier, destinationName, originName", () => {
      const result = extractStopMetadata("shipped", {
        trackingNumber:  "794644823741",
        carrier:         "FedEx",
        destinationName: "SkySpecs HQ",
        originName:      "Site Alpha",
      });
      expect(result.trackingNumber).toBe("794644823741");
      expect(result.carrier).toBe("FedEx");
      expect(result.destinationName).toBe("SkySpecs HQ");
      expect(result.originName).toBe("Site Alpha");
    });
  });

  describe("delivered", () => {
    it("extracts the same fields as shipped", () => {
      const result = extractStopMetadata("delivered", {
        trackingNumber: "TN123",
        carrier:        "FedEx",
      });
      expect(result.trackingNumber).toBe("TN123");
      expect(result.carrier).toBe("FedEx");
    });
  });

  describe("custody_handoff", () => {
    it("extracts fromUserId, fromUserName, toUserId, toUserName", () => {
      const result = extractStopMetadata("custody_handoff", {
        fromUserId:   "user-alice",
        fromUserName: "Alice Tech",
        toUserId:     "user-bob",
        toUserName:   "Bob Pilot",
      });
      expect(result.fromUserId).toBe("user-alice");
      expect(result.fromUserName).toBe("Alice Tech");
      expect(result.toUserId).toBe("user-bob");
      expect(result.toUserName).toBe("Bob Pilot");
    });
  });

  describe("mission_assigned", () => {
    it("extracts missionId and missionName", () => {
      const result = extractStopMetadata("mission_assigned", {
        missionId:   "mission-001",
        missionName: "Winter Wind Farm Inspection",
      });
      expect(result.missionId).toBe("mission-001");
      expect(result.missionName).toBe("Winter Wind Farm Inspection");
    });
  });

  describe("template_applied", () => {
    it("extracts templateId, templateName, and itemCount", () => {
      const result = extractStopMetadata("template_applied", {
        templateId:   "tpl-drone-v3",
        templateName: "Drone Inspection Kit v3",
        itemCount:    24,
      });
      expect(result.templateId).toBe("tpl-drone-v3");
      expect(result.templateName).toBe("Drone Inspection Kit v3");
      expect(result.itemCount).toBe(24);
    });

    it("returns undefined for non-number itemCount", () => {
      const result = extractStopMetadata("template_applied", { itemCount: "bad" });
      expect(result.itemCount).toBeUndefined();
    });
  });
});

// ─── deriveJourneyStops ────────────────────────────────────────────────────────

describe("deriveJourneyStops", () => {
  // ── Empty / all-filtered ───────────────────────────────────────────────────

  it("returns empty stops for an empty events array", () => {
    const result = deriveJourneyStops([], makeCaseCtx());
    expect(result.stops).toHaveLength(0);
    expect(result.stopCount).toBe(0);
    expect(result.firstStop).toBeNull();
    expect(result.lastStop).toBeNull();
    expect(result.hasLocation).toBe(false);
  });

  it("returns empty stops when all events are non-stop types", () => {
    const events: RawEventRow[] = [
      makeEvent({ eventType: "item_checked",  timestamp: T1 }),
      makeEvent({ eventType: "photo_added",   timestamp: T2 }),
      makeEvent({ eventType: "note_added",    timestamp: T3 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops).toHaveLength(0);
    expect(result.stopCount).toBe(0);
  });

  it("filters out item_checked events", () => {
    const events: RawEventRow[] = [
      makeEvent({ eventType: "item_checked", timestamp: T1 }),
      makeEvent({ eventType: "status_change", timestamp: T2 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops).toHaveLength(1);
    expect(result.stops[0].eventType).toBe("status_change");
  });

  it("filters out photo_added events", () => {
    const events: RawEventRow[] = [
      makeEvent({ eventType: "photo_added", timestamp: T1 }),
      makeEvent({ eventType: "inspection_started", timestamp: T2 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops).toHaveLength(1);
    expect(result.stops[0].eventType).toBe("inspection_started");
  });

  it("filters out note_added events", () => {
    const events: RawEventRow[] = [
      makeEvent({ eventType: "note_added", timestamp: T1 }),
      makeEvent({ eventType: "custody_handoff", timestamp: T2 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops).toHaveLength(1);
    expect(result.stops[0].eventType).toBe("custody_handoff");
  });

  // ── Single event ──────────────────────────────────────────────────────────

  it("produces a single stop with stopIndex=1 for one status_change event", () => {
    const events: RawEventRow[] = [
      makeEvent({ eventType: "status_change", timestamp: T1 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());

    expect(result.stops).toHaveLength(1);
    expect(result.stops[0].stopIndex).toBe(1);
    expect(result.stops[0].eventType).toBe("status_change");
    expect(result.stops[0].timestamp).toBe(T1);
    expect(result.stopCount).toBe(1);
    expect(result.firstStop).toBe(result.stops[0]);
    expect(result.lastStop).toBe(result.stops[0]);
  });

  // ── Multiple events ───────────────────────────────────────────────────────

  it("produces correctly indexed stops for two events", () => {
    const events: RawEventRow[] = [
      makeEvent({ _id: "evt-1", eventType: "status_change",    timestamp: T1 }),
      makeEvent({ _id: "evt-2", eventType: "inspection_started", timestamp: T2 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());

    expect(result.stops).toHaveLength(2);
    expect(result.stops[0].stopIndex).toBe(1);
    expect(result.stops[1].stopIndex).toBe(2);
    expect(result.firstStop?.stopIndex).toBe(1);
    expect(result.lastStop?.stopIndex).toBe(2);
  });

  // ── Chronological sorting ──────────────────────────────────────────────────

  it("sorts events chronologically by timestamp ascending", () => {
    // Input in reverse order to test sorting.
    const events: RawEventRow[] = [
      makeEvent({ _id: "evt-3", eventType: "custody_handoff",   timestamp: T3 }),
      makeEvent({ _id: "evt-1", eventType: "status_change",     timestamp: T1 }),
      makeEvent({ _id: "evt-2", eventType: "inspection_started", timestamp: T2 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());

    expect(result.stops[0].eventId).toBe("evt-1");
    expect(result.stops[0].timestamp).toBe(T1);
    expect(result.stops[1].eventId).toBe("evt-2");
    expect(result.stops[1].timestamp).toBe(T2);
    expect(result.stops[2].eventId).toBe("evt-3");
    expect(result.stops[2].timestamp).toBe(T3);
  });

  it("out-of-order events are re-sorted to correct chronological order", () => {
    const events: RawEventRow[] = [
      makeEvent({ _id: "b", eventType: "status_change", timestamp: T2 }),
      makeEvent({ _id: "a", eventType: "status_change", timestamp: T1 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops[0].eventId).toBe("a");
    expect(result.stops[1].eventId).toBe("b");
  });

  it("does not mutate the input events array", () => {
    const events: RawEventRow[] = [
      makeEvent({ _id: "b", eventType: "status_change", timestamp: T2 }),
      makeEvent({ _id: "a", eventType: "status_change", timestamp: T1 }),
    ];
    const originalOrder = events.map((e) => e._id);
    deriveJourneyStops(events, makeCaseCtx());
    expect(events.map((e) => e._id)).toEqual(originalOrder);
  });

  // ── Tie-break behaviour ────────────────────────────────────────────────────

  it("tie-breaks events with the same timestamp by eventType alphabetical order", () => {
    // "status_change" < "inspection_started" alphabetically? No:
    // "i" < "s" so "inspection_started" comes first.
    const events: RawEventRow[] = [
      makeEvent({ _id: "s", eventType: "status_change",     timestamp: T1 }),
      makeEvent({ _id: "i", eventType: "inspection_started", timestamp: T1 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    // "inspection_started" < "status_change" alphabetically
    expect(result.stops[0].eventId).toBe("i");
    expect(result.stops[0].eventType).toBe("inspection_started");
    expect(result.stops[1].eventId).toBe("s");
  });

  // ── stopIndex consecutiveness ─────────────────────────────────────────────

  it("stopIndex is 1-based and consecutive for 5 stops", () => {
    const types = [
      "status_change",
      "inspection_started",
      "inspection_completed",
      "damage_reported",
      "custody_handoff",
    ];
    const events: RawEventRow[] = types.map((t, i) =>
      makeEvent({ _id: `evt-${i}`, eventType: t, timestamp: T1 + i * 1000 })
    );
    const result = deriveJourneyStops(events, makeCaseCtx());
    result.stops.forEach((stop, i) => {
      expect(stop.stopIndex).toBe(i + 1);
    });
  });

  // ── stopCount + summary fields ────────────────────────────────────────────

  it("stopCount === stops.length", () => {
    const events: RawEventRow[] = [
      makeEvent({ eventType: "status_change",     timestamp: T1 }),
      makeEvent({ eventType: "inspection_started", timestamp: T2 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stopCount).toBe(result.stops.length);
  });

  it("firstStop is stops[0]", () => {
    const events: RawEventRow[] = [
      makeEvent({ _id: "first", eventType: "status_change",     timestamp: T1 }),
      makeEvent({ _id: "last",  eventType: "inspection_started", timestamp: T2 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.firstStop).toBe(result.stops[0]);
    expect(result.firstStop?.eventId).toBe("first");
  });

  it("lastStop is stops[stops.length - 1]", () => {
    const events: RawEventRow[] = [
      makeEvent({ _id: "first", eventType: "status_change",     timestamp: T1 }),
      makeEvent({ _id: "last",  eventType: "inspection_started", timestamp: T2 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.lastStop).toBe(result.stops[result.stops.length - 1]);
    expect(result.lastStop?.eventId).toBe("last");
  });

  // ── eventId coercion ──────────────────────────────────────────────────────

  it("coerces _id with toString() to a string in the stop", () => {
    let calledToString = false;
    const events: RawEventRow[] = [
      makeEvent({
        _id: { toString: () => { calledToString = true; return "coerced-id"; } },
        eventType: "status_change",
        timestamp: T1,
      }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(calledToString).toBe(true);
    expect(result.stops[0].eventId).toBe("coerced-id");
  });

  it("passes through a plain string _id without modification", () => {
    const events: RawEventRow[] = [
      makeEvent({ _id: "plain-string-id", eventType: "status_change", timestamp: T1 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops[0].eventId).toBe("plain-string-id");
  });

  // ── Location extraction ───────────────────────────────────────────────────

  it("extracts location from event data.lat/lng for status_change", () => {
    const events: RawEventRow[] = [
      makeEvent({
        eventType: "status_change",
        timestamp: T1,
        data: { lat: 42.36, lng: -71.06, location: "Site Alpha" },
      }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    const stop = result.stops[0];
    expect(stop.location.lat).toBeCloseTo(42.36);
    expect(stop.location.lng).toBeCloseTo(-71.06);
    expect(stop.location.locationName).toBe("Site Alpha");
  });

  it("falls back to case currentLat/Lng when event has no location data", () => {
    const events: RawEventRow[] = [
      makeEvent({ eventType: "custody_handoff", timestamp: T1, data: null }),
    ];
    const ctx = makeCaseCtx({
      currentLat:          37.77,
      currentLng:          -122.42,
      currentLocationName: "San Francisco HQ",
    });
    const result = deriveJourneyStops(events, ctx);
    const stop = result.stops[0];
    expect(stop.location.lat).toBeCloseTo(37.77);
    expect(stop.location.lng).toBeCloseTo(-122.42);
    expect(stop.location.locationName).toBe("San Francisco HQ");
  });

  it("event data location takes priority over case fallback", () => {
    const events: RawEventRow[] = [
      makeEvent({
        eventType: "status_change",
        timestamp: T1,
        data: { lat: 10.0, lng: 20.0, location: "Event Location" },
      }),
    ];
    const ctx = makeCaseCtx({
      currentLat:          90.0,
      currentLng:          180.0,
      currentLocationName: "Case Location",
    });
    const result = deriveJourneyStops(events, ctx);
    const stop = result.stops[0];
    expect(stop.location.lat).toBeCloseTo(10.0);
    expect(stop.location.lng).toBeCloseTo(20.0);
    expect(stop.location.locationName).toBe("Event Location");
  });

  it("partially falls back: uses event lat but case locationName when event has no locationName", () => {
    const events: RawEventRow[] = [
      makeEvent({
        eventType: "status_change",
        timestamp: T1,
        data: { lat: 42.36, lng: -71.06 }, // no location name in event
      }),
    ];
    const ctx = makeCaseCtx({ currentLocationName: "Base Camp" });
    const result = deriveJourneyStops(events, ctx);
    const stop = result.stops[0];
    expect(stop.location.lat).toBeCloseTo(42.36);
    expect(stop.location.locationName).toBe("Base Camp");
  });

  // ── hasCoordinates ────────────────────────────────────────────────────────

  it("hasCoordinates=true when both lat and lng are defined", () => {
    const events: RawEventRow[] = [
      makeEvent({
        eventType: "status_change",
        timestamp: T1,
        data: { lat: 42.36, lng: -71.06 },
      }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops[0].hasCoordinates).toBe(true);
  });

  it("hasCoordinates=false when lat is missing", () => {
    const events: RawEventRow[] = [
      makeEvent({
        eventType: "status_change",
        timestamp: T1,
        data: { lng: -71.06 },
      }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops[0].hasCoordinates).toBe(false);
  });

  it("hasCoordinates=false when lng is missing", () => {
    const events: RawEventRow[] = [
      makeEvent({
        eventType: "status_change",
        timestamp: T1,
        data: { lat: 42.36 },
      }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops[0].hasCoordinates).toBe(false);
  });

  it("hasCoordinates=false when neither lat nor lng is present", () => {
    const events: RawEventRow[] = [
      makeEvent({ eventType: "custody_handoff", timestamp: T1, data: null }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops[0].hasCoordinates).toBe(false);
  });

  // ── hasLocation (journey-level flag) ──────────────────────────────────────

  it("hasLocation=true when at least one stop has coordinates", () => {
    const events: RawEventRow[] = [
      makeEvent({ eventType: "custody_handoff", timestamp: T1, data: null }),
      makeEvent({
        eventType: "status_change",
        timestamp: T2,
        data: { lat: 42.36, lng: -71.06 },
      }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.hasLocation).toBe(true);
  });

  it("hasLocation=false when no stop has coordinates", () => {
    const events: RawEventRow[] = [
      makeEvent({ eventType: "custody_handoff",    timestamp: T1, data: null }),
      makeEvent({ eventType: "inspection_started", timestamp: T2, data: null }),
    ];
    // No case context location either
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.hasLocation).toBe(false);
  });

  it("hasLocation=true when case fallback location provides coordinates", () => {
    const events: RawEventRow[] = [
      makeEvent({ eventType: "custody_handoff", timestamp: T1, data: null }),
    ];
    const ctx = makeCaseCtx({ currentLat: 42.0, currentLng: -71.0 });
    const result = deriveJourneyStops(events, ctx);
    expect(result.hasLocation).toBe(true);
  });

  // ── Case context fields ───────────────────────────────────────────────────

  it("passes caseId, caseLabel, currentStatus from caseCtx", () => {
    const ctx = makeCaseCtx({
      caseId:        "case-xyz-123",
      caseLabel:     "CASE-042",
      currentStatus: "transit_in",
    });
    const result = deriveJourneyStops([], ctx);
    expect(result.caseId).toBe("case-xyz-123");
    expect(result.caseLabel).toBe("CASE-042");
    expect(result.currentStatus).toBe("transit_in");
  });

  it("passes currentLat, currentLng, currentLocationName from caseCtx", () => {
    const ctx = makeCaseCtx({
      currentLat:          48.86,
      currentLng:           2.35,
      currentLocationName: "Paris Hub",
    });
    const result = deriveJourneyStops([], ctx);
    expect(result.currentLat).toBeCloseTo(48.86);
    expect(result.currentLng).toBeCloseTo(2.35);
    expect(result.currentLocationName).toBe("Paris Hub");
  });

  it("passes undefined for currentLat/Lng when not set in caseCtx", () => {
    const ctx = makeCaseCtx();
    const result = deriveJourneyStops([], ctx);
    expect(result.currentLat).toBeUndefined();
    expect(result.currentLng).toBeUndefined();
    expect(result.currentLocationName).toBeUndefined();
  });

  // ── Actor fields ──────────────────────────────────────────────────────────

  it("copies actorId and actorName from event.userId / event.userName", () => {
    const events: RawEventRow[] = [
      makeEvent({
        eventType: "status_change",
        timestamp: T1,
        userId:    "user-carol",
        userName:  "Carol Logistics",
      }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops[0].actorId).toBe("user-carol");
    expect(result.stops[0].actorName).toBe("Carol Logistics");
  });

  // ── Metadata extraction ───────────────────────────────────────────────────

  it("extracts status_change metadata (from/to) into stop.metadata", () => {
    const events: RawEventRow[] = [
      makeEvent({
        eventType: "status_change",
        timestamp: T1,
        data: { from: "hangar", to: "assembled" },
      }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops[0].metadata).toEqual({ from: "hangar", to: "assembled" });
  });

  it("extracts custody_handoff metadata into stop.metadata", () => {
    const events: RawEventRow[] = [
      makeEvent({
        eventType: "custody_handoff",
        timestamp: T1,
        data: {
          fromUserId:   "user-a",
          fromUserName: "Alice",
          toUserId:     "user-b",
          toUserName:   "Bob",
        },
      }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops[0].metadata).toMatchObject({
      fromUserId:   "user-a",
      fromUserName: "Alice",
      toUserId:     "user-b",
      toUserName:   "Bob",
    });
  });

  // ── Mixed event types ─────────────────────────────────────────────────────

  it("handles a realistic full journey with multiple event types", () => {
    const events: RawEventRow[] = [
      makeEvent({ _id: "e1", eventType: "template_applied",    timestamp: T1, data: { templateId: "tpl-1", templateName: "Kit A", itemCount: 15 } }),
      makeEvent({ _id: "e2", eventType: "status_change",       timestamp: T1 + 1000, data: { from: "hangar", to: "assembled" } }),
      makeEvent({ _id: "e3", eventType: "item_checked",        timestamp: T1 + 2000, data: null }), // excluded
      makeEvent({ _id: "e4", eventType: "status_change",       timestamp: T2, data: { from: "assembled", to: "transit_out" } }),
      makeEvent({ _id: "e5", eventType: "shipped",             timestamp: T2 + 500, data: { trackingNumber: "794644823741", carrier: "FedEx" } }),
      makeEvent({ _id: "e6", eventType: "status_change",       timestamp: T3, data: { from: "transit_out", to: "deployed", lat: 42.36, lng: -71.06 } }),
      makeEvent({ _id: "e7", eventType: "inspection_started",  timestamp: T3 + 1000, data: { inspectionId: "insp-1", totalItems: 15, checkedItems: 0 } }),
      makeEvent({ _id: "e8", eventType: "photo_added",         timestamp: T3 + 2000, data: null }), // excluded
      makeEvent({ _id: "e9", eventType: "inspection_completed", timestamp: T3 + 5000, data: { inspectionId: "insp-1", finalStatus: "completed", totalItems: 15, checkedItems: 15 } }),
    ];

    const result = deriveJourneyStops(events, makeCaseCtx({ currentLat: 42.36, currentLng: -71.06 }));

    // 7 stop events (item_checked and photo_added are excluded)
    expect(result.stops).toHaveLength(7);
    expect(result.stopCount).toBe(7);

    // Verify order and indices
    expect(result.stops[0].eventId).toBe("e1"); // template_applied
    expect(result.stops[0].stopIndex).toBe(1);
    expect(result.stops[1].eventId).toBe("e2"); // status_change (assembled)
    expect(result.stops[1].stopIndex).toBe(2);
    expect(result.stops[2].eventId).toBe("e4"); // status_change (transit_out)
    expect(result.stops[2].stopIndex).toBe(3);
    expect(result.stops[3].eventId).toBe("e5"); // shipped
    expect(result.stops[3].stopIndex).toBe(4);
    expect(result.stops[4].eventId).toBe("e6"); // status_change (deployed)
    expect(result.stops[4].stopIndex).toBe(5);
    expect(result.stops[5].eventId).toBe("e7"); // inspection_started
    expect(result.stops[5].stopIndex).toBe(6);
    expect(result.stops[6].eventId).toBe("e9"); // inspection_completed
    expect(result.stops[6].stopIndex).toBe(7);

    // e6 (status_change to deployed) should have coordinates from event data
    expect(result.stops[4].location.lat).toBeCloseTo(42.36);
    expect(result.stops[4].hasCoordinates).toBe(true);
    expect(result.hasLocation).toBe(true);

    // Metadata spot checks
    expect(result.stops[0].metadata.templateName).toBe("Kit A");
    expect(result.stops[0].metadata.itemCount).toBe(15);
    expect(result.stops[3].metadata.trackingNumber).toBe("794644823741");
    expect(result.stops[6].metadata.finalStatus).toBe("completed");
  });

  // ── Large journey ─────────────────────────────────────────────────────────

  it("correctly indexes a 20-stop journey", () => {
    const events: RawEventRow[] = Array.from({ length: 20 }, (_, i) =>
      makeEvent({
        _id:       `evt-${i}`,
        eventType: "status_change",
        timestamp: T1 + i * 60_000, // 1 minute apart
        data: { from: "hangar", to: "assembled" },
      })
    );

    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops).toHaveLength(20);
    expect(result.stopCount).toBe(20);
    result.stops.forEach((stop, i) => {
      expect(stop.stopIndex).toBe(i + 1);
    });
    expect(result.firstStop?.stopIndex).toBe(1);
    expect(result.lastStop?.stopIndex).toBe(20);
  });

  // ── Partial coordinates ───────────────────────────────────────────────────

  it("handles a case where only lat is available (partial coordinates)", () => {
    const events: RawEventRow[] = [
      makeEvent({
        eventType: "status_change",
        timestamp: T1,
        data: { lat: 42.36 }, // no lng
      }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(result.stops[0].location.lat).toBeCloseTo(42.36);
    expect(result.stops[0].location.lng).toBeUndefined();
    expect(result.stops[0].hasCoordinates).toBe(false);
    expect(result.hasLocation).toBe(false);
  });
});

// ─── M2CaseJourney shape validation ──────────────────────────────────────────

describe("M2CaseJourney shape", () => {
  it("is a JSON-serializable plain object", () => {
    const events: RawEventRow[] = [
      makeEvent({ eventType: "status_change", timestamp: T1 }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    expect(() => JSON.stringify(result)).not.toThrow();

    const parsed = JSON.parse(JSON.stringify(result)) as M2CaseJourney;
    expect(parsed.caseId).toBe("case-abc");
    expect(parsed.stopCount).toBe(1);
    expect(parsed.stops[0].stopIndex).toBe(1);
  });

  it("JourneyStop objects within stops array are JSON-serializable", () => {
    const events: RawEventRow[] = [
      makeEvent({
        eventType: "status_change",
        timestamp: T1,
        data: { from: "hangar", to: "assembled", lat: 1.0, lng: 2.0 },
      }),
    ];
    const result = deriveJourneyStops(events, makeCaseCtx());
    const stop = result.stops[0];

    expect(() => JSON.stringify(stop)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(stop)) as JourneyStop;
    expect(parsed.stopIndex).toBe(1);
    expect(parsed.hasCoordinates).toBe(true);
    expect(parsed.metadata.from).toBe("hangar");
    expect(parsed.metadata.to).toBe("assembled");
  });
});
