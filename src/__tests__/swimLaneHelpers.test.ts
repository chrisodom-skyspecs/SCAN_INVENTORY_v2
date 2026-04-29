/**
 * src/__tests__/swimLaneHelpers.test.ts
 *
 * Unit tests for convex/swimLaneHelpers.ts
 *
 * Tests cover:
 *   • isSwimLanePhase type guard
 *   • extractSwimLaneMetadata for each event type
 *   • mapEventsToPhases — phase assignment algorithm
 *   • assembleSwimLaneBoard — board construction from cases + events
 *
 * These functions are pure and synchronous — no Convex runtime needed.
 * Import path uses relative navigation to reach the convex/ directory.
 */

import { describe, it, expect } from "vitest";
import {
  isSwimLanePhase,
  SWIM_LANE_PHASES,
  SWIM_LANE_LABELS,
  SWIM_LANE_EVENT_TYPES,
  extractSwimLaneMetadata,
  mapEventsToPhases,
  assembleSwimLaneBoard,
} from "../../convex/swimLaneHelpers";
import type {
  RawSwimLaneEvent,
  CaseForSwimLane,
  SwimLanePhase,
} from "../../convex/swimLaneHelpers";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Build a minimal RawSwimLaneEvent for testing.
 */
function makeEvent(
  overrides: Partial<RawSwimLaneEvent> & { eventType: string }
): RawSwimLaneEvent {
  return {
    _id:       overrides._id       ?? "evt-001",
    eventType: overrides.eventType,
    userId:    overrides.userId    ?? "user-1",
    userName:  overrides.userName  ?? "Test User",
    timestamp: overrides.timestamp ?? 1000,
    data:      overrides.data      ?? {},
  };
}

/**
 * Build a minimal CaseForSwimLane for testing.
 */
function makeCase(
  overrides: Partial<CaseForSwimLane> & { caseId: string; currentStatus: string }
): CaseForSwimLane {
  return {
    caseId:        overrides.caseId,
    label:         overrides.label        ?? `CASE-${overrides.caseId}`,
    currentStatus: overrides.currentStatus,
    updatedAt:     overrides.updatedAt    ?? 1000,
    lat:           overrides.lat,
    lng:           overrides.lng,
    locationName:  overrides.locationName,
    assigneeId:    overrides.assigneeId,
    assigneeName:  overrides.assigneeName,
    missionId:     overrides.missionId,
    trackingNumber: overrides.trackingNumber,
    events:        overrides.events       ?? [],
  };
}

// ─── isSwimLanePhase ─────────────────────────────────────────────────────────

describe("isSwimLanePhase", () => {
  it("returns true for all 8 valid phases", () => {
    for (const phase of SWIM_LANE_PHASES) {
      expect(isSwimLanePhase(phase)).toBe(true);
    }
  });

  it("returns false for unknown strings", () => {
    expect(isSwimLanePhase("unknown")).toBe(false);
    expect(isSwimLanePhase("in_transit")).toBe(false);
    expect(isSwimLanePhase("")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isSwimLanePhase(null)).toBe(false);
    expect(isSwimLanePhase(undefined)).toBe(false);
    expect(isSwimLanePhase(42)).toBe(false);
    expect(isSwimLanePhase({})).toBe(false);
  });
});

// ─── SWIM_LANE_LABELS ─────────────────────────────────────────────────────────

describe("SWIM_LANE_LABELS", () => {
  it("has a label for every phase in SWIM_LANE_PHASES", () => {
    for (const phase of SWIM_LANE_PHASES) {
      expect(SWIM_LANE_LABELS[phase]).toBeTruthy();
      expect(typeof SWIM_LANE_LABELS[phase]).toBe("string");
    }
  });

  it("has correct human-readable labels", () => {
    expect(SWIM_LANE_LABELS.hangar).toBe("Hangar");
    expect(SWIM_LANE_LABELS.assembled).toBe("Assembled");
    expect(SWIM_LANE_LABELS.transit_out).toBe("Transit Out");
    expect(SWIM_LANE_LABELS.deployed).toBe("Deployed");
    expect(SWIM_LANE_LABELS.flagged).toBe("Flagged");
    expect(SWIM_LANE_LABELS.transit_in).toBe("Transit In");
    expect(SWIM_LANE_LABELS.received).toBe("Received");
    expect(SWIM_LANE_LABELS.archived).toBe("Archived");
  });
});

// ─── SWIM_LANE_EVENT_TYPES ────────────────────────────────────────────────────

describe("SWIM_LANE_EVENT_TYPES", () => {
  it("includes the expected meaningful event types", () => {
    expect(SWIM_LANE_EVENT_TYPES.has("status_change")).toBe(true);
    expect(SWIM_LANE_EVENT_TYPES.has("inspection_started")).toBe(true);
    expect(SWIM_LANE_EVENT_TYPES.has("inspection_completed")).toBe(true);
    expect(SWIM_LANE_EVENT_TYPES.has("damage_reported")).toBe(true);
    expect(SWIM_LANE_EVENT_TYPES.has("shipped")).toBe(true);
    expect(SWIM_LANE_EVENT_TYPES.has("delivered")).toBe(true);
    expect(SWIM_LANE_EVENT_TYPES.has("custody_handoff")).toBe(true);
    expect(SWIM_LANE_EVENT_TYPES.has("mission_assigned")).toBe(true);
    expect(SWIM_LANE_EVENT_TYPES.has("template_applied")).toBe(true);
  });

  it("excludes fine-grained events", () => {
    expect(SWIM_LANE_EVENT_TYPES.has("item_checked")).toBe(false);
    expect(SWIM_LANE_EVENT_TYPES.has("photo_added")).toBe(false);
    expect(SWIM_LANE_EVENT_TYPES.has("note_added")).toBe(false);
  });
});

// ─── extractSwimLaneMetadata ──────────────────────────────────────────────────

describe("extractSwimLaneMetadata", () => {
  describe("status_change", () => {
    it("extracts from and to", () => {
      const meta = extractSwimLaneMetadata("status_change", {
        from: "hangar",
        to:   "assembled",
      });
      expect(meta.kind).toBe("status_change");
      if (meta.kind === "status_change") {
        expect(meta.from).toBe("hangar");
        expect(meta.to).toBe("assembled");
      }
    });

    it("extracts locationName from location field", () => {
      const meta = extractSwimLaneMetadata("status_change", {
        from:     "assembled",
        to:       "transit_out",
        location: "Site Alpha",
      });
      if (meta.kind === "status_change") {
        expect(meta.locationName).toBe("Site Alpha");
      }
    });

    it("extracts locationName from locationName field", () => {
      const meta = extractSwimLaneMetadata("status_change", {
        from:         "transit_out",
        to:           "deployed",
        locationName: "Field Site B",
      });
      if (meta.kind === "status_change") {
        expect(meta.locationName).toBe("Field Site B");
      }
    });

    it("handles missing from/to gracefully", () => {
      const meta = extractSwimLaneMetadata("status_change", {});
      expect(meta.kind).toBe("status_change");
      if (meta.kind === "status_change") {
        expect(meta.from).toBeUndefined();
        expect(meta.to).toBeUndefined();
      }
    });
  });

  describe("inspection_started", () => {
    it("extracts inspection fields", () => {
      const meta = extractSwimLaneMetadata("inspection_started", {
        inspectionId: "insp-1",
        totalItems:   10,
        checkedItems: 3,
        damagedItems: 1,
        missingItems: 0,
      });
      expect(meta.kind).toBe("inspection");
      if (meta.kind === "inspection") {
        expect(meta.subKind).toBe("started");
        expect(meta.inspectionId).toBe("insp-1");
        expect(meta.totalItems).toBe(10);
        expect(meta.checkedItems).toBe(3);
        expect(meta.damagedItems).toBe(1);
        expect(meta.missingItems).toBe(0);
      }
    });
  });

  describe("inspection_completed", () => {
    it("extracts subKind and finalStatus", () => {
      const meta = extractSwimLaneMetadata("inspection_completed", {
        finalStatus: "flagged",
        totalItems:  10,
        checkedItems: 10,
      });
      expect(meta.kind).toBe("inspection");
      if (meta.kind === "inspection") {
        expect(meta.subKind).toBe("completed");
        expect(meta.finalStatus).toBe("flagged");
      }
    });
  });

  describe("damage_reported", () => {
    it("extracts damage fields", () => {
      const meta = extractSwimLaneMetadata("damage_reported", {
        templateItemId: "item-42",
        itemName:       "Battery Pack",
        severity:       "moderate",
        description:    "Crack in casing",
      });
      expect(meta.kind).toBe("damage_reported");
      if (meta.kind === "damage_reported") {
        expect(meta.templateItemId).toBe("item-42");
        expect(meta.itemName).toBe("Battery Pack");
        expect(meta.severity).toBe("moderate");
        expect(meta.description).toBe("Crack in casing");
      }
    });
  });

  describe("shipped", () => {
    it("extracts shipping fields with subKind shipped", () => {
      const meta = extractSwimLaneMetadata("shipped", {
        trackingNumber:  "794644823741",
        carrier:         "FedEx",
        originName:      "SkySpecs HQ",
        destinationName: "Site Alpha",
      });
      expect(meta.kind).toBe("shipping");
      if (meta.kind === "shipping") {
        expect(meta.subKind).toBe("shipped");
        expect(meta.trackingNumber).toBe("794644823741");
        expect(meta.carrier).toBe("FedEx");
      }
    });
  });

  describe("delivered", () => {
    it("extracts shipping fields with subKind delivered", () => {
      const meta = extractSwimLaneMetadata("delivered", {
        trackingNumber: "794644823741",
      });
      expect(meta.kind).toBe("shipping");
      if (meta.kind === "shipping") {
        expect(meta.subKind).toBe("delivered");
        expect(meta.trackingNumber).toBe("794644823741");
      }
    });
  });

  describe("custody_handoff", () => {
    it("extracts from/to user fields", () => {
      const meta = extractSwimLaneMetadata("custody_handoff", {
        fromUserId:   "user-alice",
        fromUserName: "Alice",
        toUserId:     "user-bob",
        toUserName:   "Bob",
      });
      expect(meta.kind).toBe("custody_handoff");
      if (meta.kind === "custody_handoff") {
        expect(meta.fromUserId).toBe("user-alice");
        expect(meta.fromUserName).toBe("Alice");
        expect(meta.toUserId).toBe("user-bob");
        expect(meta.toUserName).toBe("Bob");
      }
    });
  });

  describe("mission_assigned", () => {
    it("extracts mission fields", () => {
      const meta = extractSwimLaneMetadata("mission_assigned", {
        missionId:   "mission-1",
        missionName: "Site Alpha Inspection",
      });
      expect(meta.kind).toBe("mission_assigned");
      if (meta.kind === "mission_assigned") {
        expect(meta.missionId).toBe("mission-1");
        expect(meta.missionName).toBe("Site Alpha Inspection");
      }
    });
  });

  describe("template_applied", () => {
    it("extracts template fields", () => {
      const meta = extractSwimLaneMetadata("template_applied", {
        templateId:   "tmpl-drone",
        templateName: "Drone Inspection Kit",
        itemCount:    24,
      });
      expect(meta.kind).toBe("template_applied");
      if (meta.kind === "template_applied") {
        expect(meta.templateId).toBe("tmpl-drone");
        expect(meta.templateName).toBe("Drone Inspection Kit");
        expect(meta.itemCount).toBe(24);
      }
    });
  });

  describe("unknown event type", () => {
    it("returns generic metadata", () => {
      const meta = extractSwimLaneMetadata("item_checked", {
        someField: "value",
      });
      expect(meta.kind).toBe("generic");
    });
  });

  describe("null/undefined data", () => {
    it("handles null data gracefully", () => {
      const meta = extractSwimLaneMetadata("status_change", null);
      expect(meta.kind).toBe("status_change");
      if (meta.kind === "status_change") {
        expect(meta.from).toBeUndefined();
        expect(meta.to).toBeUndefined();
      }
    });

    it("handles undefined data gracefully", () => {
      const meta = extractSwimLaneMetadata("damage_reported", undefined);
      expect(meta.kind).toBe("damage_reported");
      if (meta.kind === "damage_reported") {
        expect(meta.severity).toBeUndefined();
      }
    });
  });
});

// ─── mapEventsToPhases ────────────────────────────────────────────────────────

describe("mapEventsToPhases", () => {
  it("returns empty array when no events", () => {
    const result = mapEventsToPhases([], "hangar");
    expect(result).toHaveLength(0);
  });

  it("filters out non-swim-lane event types", () => {
    const events: RawSwimLaneEvent[] = [
      makeEvent({ eventType: "item_checked",  _id: "1", timestamp: 100 }),
      makeEvent({ eventType: "photo_added",   _id: "2", timestamp: 200 }),
      makeEvent({ eventType: "note_added",    _id: "3", timestamp: 300 }),
      makeEvent({ eventType: "status_change", _id: "4", timestamp: 400, data: { from: "hangar", to: "assembled" } }),
    ];
    const result = mapEventsToPhases(events, "assembled");
    // Only the status_change event should pass through
    expect(result).toHaveLength(1);
    expect(result[0].eventType).toBe("status_change");
  });

  it("sorts events chronologically", () => {
    const events: RawSwimLaneEvent[] = [
      makeEvent({ eventType: "inspection_started",   _id: "2", timestamp: 2000 }),
      makeEvent({ eventType: "status_change", _id: "1", timestamp: 1000, data: { from: "assembled", to: "deployed" } }),
    ];
    const result = mapEventsToPhases(events, "deployed");
    expect(result[0].timestamp).toBe(1000);
    expect(result[1].timestamp).toBe(2000);
  });

  it("assigns status_change events to destination phase (data.to)", () => {
    const events: RawSwimLaneEvent[] = [
      makeEvent({
        eventType: "status_change",
        _id: "1",
        timestamp: 1000,
        data: { from: "hangar", to: "assembled" },
      }),
    ];
    const result = mapEventsToPhases(events, "assembled");
    expect(result[0].phase).toBe("assembled");
    expect(result[0].isPhaseEntry).toBe(true);
  });

  it("marks status_change events as phase entries", () => {
    const events: RawSwimLaneEvent[] = [
      makeEvent({
        eventType: "status_change",
        _id: "1",
        timestamp: 1000,
        data: { from: "assembled", to: "transit_out" },
      }),
      makeEvent({
        eventType: "shipped",
        _id: "2",
        timestamp: 2000,
        data: { trackingNumber: "123" },
      }),
    ];
    const result = mapEventsToPhases(events, "transit_out");
    expect(result[0].isPhaseEntry).toBe(true);
    expect(result[1].isPhaseEntry).toBe(false);
  });

  it("assigns non-status-change events to the running current phase", () => {
    const events: RawSwimLaneEvent[] = [
      // status_change moves case to "deployed"
      makeEvent({
        eventType: "status_change",
        _id: "1",
        timestamp: 1000,
        data: { from: "transit_out", to: "deployed" },
      }),
      // inspection events should be in "deployed" phase
      makeEvent({ eventType: "inspection_started",   _id: "2", timestamp: 2000 }),
      makeEvent({ eventType: "inspection_completed",  _id: "3", timestamp: 3000 }),
      makeEvent({ eventType: "damage_reported",       _id: "4", timestamp: 4000 }),
    ];
    const result = mapEventsToPhases(events, "deployed");

    expect(result[0].phase).toBe("deployed");  // status_change → deployed
    expect(result[1].phase).toBe("deployed");  // inspection_started
    expect(result[2].phase).toBe("deployed");  // inspection_completed
    expect(result[3].phase).toBe("deployed");  // damage_reported
  });

  it("tracks phase transitions correctly across multiple status changes", () => {
    const events: RawSwimLaneEvent[] = [
      makeEvent({
        eventType: "status_change",
        _id: "1",
        timestamp: 1000,
        data: { from: "hangar", to: "assembled" },
      }),
      makeEvent({
        eventType: "mission_assigned",
        _id: "2",
        timestamp: 1500,
        data: { missionId: "m1" },
      }),
      makeEvent({
        eventType: "status_change",
        _id: "3",
        timestamp: 2000,
        data: { from: "assembled", to: "transit_out" },
      }),
      makeEvent({
        eventType: "shipped",
        _id: "4",
        timestamp: 2500,
        data: { trackingNumber: "fedex-123" },
      }),
      makeEvent({
        eventType: "status_change",
        _id: "5",
        timestamp: 3000,
        data: { from: "transit_out", to: "deployed" },
      }),
      makeEvent({
        eventType: "inspection_started",
        _id: "6",
        timestamp: 3500,
      }),
    ];
    const result = mapEventsToPhases(events, "deployed");

    expect(result[0].phase).toBe("assembled");    // status_change hangar→assembled
    expect(result[1].phase).toBe("assembled");    // mission_assigned (in assembled phase)
    expect(result[2].phase).toBe("transit_out");  // status_change assembled→transit_out
    expect(result[3].phase).toBe("transit_out");  // shipped (while in transit_out)
    expect(result[4].phase).toBe("deployed");     // status_change transit_out→deployed
    expect(result[5].phase).toBe("deployed");     // inspection_started (while deployed)
  });

  it("uses caseCurrentStatus as initial phase for events before any status_change", () => {
    const events: RawSwimLaneEvent[] = [
      // template_applied before any status_change
      makeEvent({
        eventType: "template_applied",
        _id: "1",
        timestamp: 1000,
        data: { templateId: "t1" },
      }),
    ];
    // caseCurrentStatus is "hangar" — template event should be in hangar phase
    const result = mapEventsToPhases(events, "hangar");
    expect(result[0].phase).toBe("hangar");
  });

  it("falls back to 'hangar' when caseCurrentStatus is unknown", () => {
    const events: RawSwimLaneEvent[] = [
      makeEvent({
        eventType: "template_applied",
        _id: "1",
        timestamp: 1000,
        data: {},
      }),
    ];
    // Pass an invalid status string — should fall back to "hangar"
    const result = mapEventsToPhases(events, "completely_unknown_status");
    expect(result[0].phase).toBe("hangar");
  });

  it("handles status_change events with invalid data.to gracefully", () => {
    const events: RawSwimLaneEvent[] = [
      // First: valid status_change to deployed
      makeEvent({
        eventType: "status_change",
        _id: "1",
        timestamp: 1000,
        data: { from: "assembled", to: "deployed" },
      }),
      // Invalid status_change (data.to is not a valid phase)
      makeEvent({
        eventType: "status_change",
        _id: "2",
        timestamp: 2000,
        data: { from: "deployed", to: "not_a_real_phase" },
      }),
      // Should remain in "deployed" since the previous transition was invalid
      makeEvent({
        eventType: "inspection_started",
        _id: "3",
        timestamp: 3000,
      }),
    ];
    const result = mapEventsToPhases(events, "deployed");
    expect(result[0].phase).toBe("deployed");
    // Invalid status_change still falls through; phase stays "deployed"
    expect(result[1].phase).toBe("deployed");
    expect(result[2].phase).toBe("deployed");
  });

  it("breaks timestamp ties by eventType alphabetical order", () => {
    // Two events at the same timestamp
    const events: RawSwimLaneEvent[] = [
      makeEvent({ eventType: "shipped",        _id: "b", timestamp: 1000 }),
      makeEvent({ eventType: "damage_reported", _id: "a", timestamp: 1000 }),
    ];
    const result = mapEventsToPhases(events, "deployed");
    expect(result).toHaveLength(2);
    // "damage_reported" < "shipped" alphabetically
    expect(result[0].eventType).toBe("damage_reported");
    expect(result[1].eventType).toBe("shipped");
  });

  it("preserves event IDs correctly", () => {
    const events: RawSwimLaneEvent[] = [
      makeEvent({
        eventType: "status_change",
        _id: { toString: () => "convex-id-001" },
        timestamp: 1000,
        data: { from: "hangar", to: "assembled" },
      }),
    ];
    const result = mapEventsToPhases(events, "assembled");
    expect(result[0].eventId).toBe("convex-id-001");
  });
});

// ─── assembleSwimLaneBoard ────────────────────────────────────────────────────

describe("assembleSwimLaneBoard", () => {
  const NOW = Date.now();

  it("returns 8 lanes (one per phase) for an empty case list", () => {
    const result = assembleSwimLaneBoard([], NOW);
    expect(result.lanes).toHaveLength(8);
    expect(result.totalCases).toBe(0);
    expect(result.totalEvents).toBe(0);
    expect(result.assembledAt).toBe(NOW);
  });

  it("returns lanes in SWIM_LANE_PHASES lifecycle order", () => {
    const result = assembleSwimLaneBoard([], NOW);
    const phaseOrder = result.lanes.map((l) => l.phase);
    expect(phaseOrder).toEqual(SWIM_LANE_PHASES);
  });

  it("places a case in the correct phase bucket", () => {
    const cases: CaseForSwimLane[] = [
      makeCase({ caseId: "case-1", currentStatus: "deployed", updatedAt: 1000 }),
    ];
    const result = assembleSwimLaneBoard(cases, NOW);
    const deployedLane = result.lanes.find((l) => l.phase === "deployed")!;
    expect(deployedLane.cases).toHaveLength(1);
    expect(deployedLane.cases[0].caseId).toBe("case-1");
    expect(deployedLane.caseCount).toBe(1);
  });

  it("places cases in different phase buckets correctly", () => {
    const cases: CaseForSwimLane[] = [
      makeCase({ caseId: "c1", currentStatus: "hangar",      updatedAt: 1000 }),
      makeCase({ caseId: "c2", currentStatus: "assembled",   updatedAt: 1000 }),
      makeCase({ caseId: "c3", currentStatus: "deployed",    updatedAt: 1000 }),
      makeCase({ caseId: "c4", currentStatus: "transit_out", updatedAt: 1000 }),
    ];
    const result = assembleSwimLaneBoard(cases, NOW);

    const hangarLane     = result.lanes.find((l) => l.phase === "hangar")!;
    const assembledLane  = result.lanes.find((l) => l.phase === "assembled")!;
    const deployedLane   = result.lanes.find((l) => l.phase === "deployed")!;
    const transitOutLane = result.lanes.find((l) => l.phase === "transit_out")!;

    expect(hangarLane.caseCount).toBe(1);
    expect(assembledLane.caseCount).toBe(1);
    expect(deployedLane.caseCount).toBe(1);
    expect(transitOutLane.caseCount).toBe(1);
  });

  it("includes only current-phase events in the case card's phaseEvents", () => {
    // Case is currently "deployed"; it has events from multiple phases
    const events: RawSwimLaneEvent[] = [
      makeEvent({
        eventType: "status_change",
        _id: "e1",
        timestamp: 1000,
        data: { from: "hangar", to: "assembled" },
      }),
      makeEvent({
        eventType: "status_change",
        _id: "e2",
        timestamp: 2000,
        data: { from: "assembled", to: "deployed" },
      }),
      makeEvent({
        eventType: "inspection_started",
        _id: "e3",
        timestamp: 3000,
      }),
    ];
    const cases: CaseForSwimLane[] = [
      makeCase({ caseId: "c1", currentStatus: "deployed", updatedAt: 3000, events }),
    ];
    const result = assembleSwimLaneBoard(cases, NOW);
    const deployedLane = result.lanes.find((l) => l.phase === "deployed")!;
    const card = deployedLane.cases[0];

    // Card should only have events from the "deployed" phase:
    // e2 (status_change → deployed) and e3 (inspection_started while deployed)
    expect(card.phaseEvents).toHaveLength(2);
    expect(card.phaseEvents[0].eventId).toBe("e2");
    expect(card.phaseEvents[1].eventId).toBe("e3");
  });

  it("counts total cases and events correctly", () => {
    const events: RawSwimLaneEvent[] = [
      makeEvent({
        eventType: "status_change",
        _id: "e1",
        timestamp: 1000,
        data: { from: "hangar", to: "deployed" },
      }),
      makeEvent({
        eventType: "inspection_started",
        _id: "e2",
        timestamp: 2000,
      }),
    ];
    const cases: CaseForSwimLane[] = [
      makeCase({ caseId: "c1", currentStatus: "deployed", updatedAt: 2000, events }),
      makeCase({ caseId: "c2", currentStatus: "hangar",   updatedAt: 1000, events: [] }),
    ];
    const result = assembleSwimLaneBoard(cases, NOW);
    expect(result.totalCases).toBe(2);
    // c1 has 2 events in "deployed" phase; c2 has 0 events
    expect(result.totalEvents).toBe(2);
  });

  it("sorts cases within a lane by mostRecentEventAt desc", () => {
    const events1: RawSwimLaneEvent[] = [
      makeEvent({
        eventType: "status_change",
        _id: "e1",
        timestamp: 5000,
        data: { from: "assembled", to: "deployed" },
      }),
    ];
    const events2: RawSwimLaneEvent[] = [
      makeEvent({
        eventType: "status_change",
        _id: "e2",
        timestamp: 9000,
        data: { from: "assembled", to: "deployed" },
      }),
    ];
    const cases: CaseForSwimLane[] = [
      makeCase({ caseId: "c1", currentStatus: "deployed", updatedAt: 5000, events: events1 }),
      makeCase({ caseId: "c2", currentStatus: "deployed", updatedAt: 9000, events: events2 }),
    ];
    const result = assembleSwimLaneBoard(cases, NOW);
    const deployedLane = result.lanes.find((l) => l.phase === "deployed")!;
    // c2 has the most recent event (9000) — should come first
    expect(deployedLane.cases[0].caseId).toBe("c2");
    expect(deployedLane.cases[1].caseId).toBe("c1");
  });

  it("falls back to updatedAt for sorting when no phase events exist", () => {
    const cases: CaseForSwimLane[] = [
      makeCase({ caseId: "c1", currentStatus: "hangar", updatedAt: 1000, events: [] }),
      makeCase({ caseId: "c2", currentStatus: "hangar", updatedAt: 9000, events: [] }),
    ];
    const result = assembleSwimLaneBoard(cases, NOW);
    const hangarLane = result.lanes.find((l) => l.phase === "hangar")!;
    // c2 has more recent updatedAt — should come first
    expect(hangarLane.cases[0].caseId).toBe("c2");
  });

  it("computes lane eventCount correctly", () => {
    const events: RawSwimLaneEvent[] = [
      makeEvent({
        eventType: "status_change",
        _id: "e1",
        timestamp: 1000,
        data: { from: "hangar", to: "deployed" },
      }),
      makeEvent({
        eventType: "inspection_started",
        _id: "e2",
        timestamp: 2000,
      }),
      makeEvent({
        eventType: "damage_reported",
        _id: "e3",
        timestamp: 3000,
      }),
    ];
    const cases: CaseForSwimLane[] = [
      makeCase({ caseId: "c1", currentStatus: "deployed", updatedAt: 3000, events }),
    ];
    const result = assembleSwimLaneBoard(cases, NOW);
    const deployedLane = result.lanes.find((l) => l.phase === "deployed")!;
    expect(deployedLane.eventCount).toBe(3);
  });

  it("includes correct lane labels", () => {
    const result = assembleSwimLaneBoard([], NOW);
    for (const lane of result.lanes) {
      expect(lane.label).toBe(SWIM_LANE_LABELS[lane.phase]);
    }
  });

  it("copies case position and custody fields to the card", () => {
    const cases: CaseForSwimLane[] = [
      makeCase({
        caseId:        "c1",
        label:         "CASE-001",
        currentStatus: "deployed",
        updatedAt:     1000,
        lat:           42.3601,
        lng:           -71.0589,
        locationName:  "Boston Site",
        assigneeId:    "user-alice",
        assigneeName:  "Alice",
        missionId:     "mission-1",
        trackingNumber: undefined,
        events:        [],
      }),
    ];
    const result = assembleSwimLaneBoard(cases, NOW);
    const card = result.lanes.find((l) => l.phase === "deployed")!.cases[0];
    expect(card.label).toBe("CASE-001");
    expect(card.lat).toBe(42.3601);
    expect(card.lng).toBe(-71.0589);
    expect(card.locationName).toBe("Boston Site");
    expect(card.assigneeId).toBe("user-alice");
    expect(card.assigneeName).toBe("Alice");
    expect(card.missionId).toBe("mission-1");
  });

  it("assembledAt is set to the provided timestamp", () => {
    const ts = 999_999_999;
    const result = assembleSwimLaneBoard([], ts);
    expect(result.assembledAt).toBe(ts);
  });

  it("handles unknown currentStatus by placing case in 'hangar'", () => {
    const cases: CaseForSwimLane[] = [
      makeCase({ caseId: "c1", currentStatus: "totally_unknown", updatedAt: 1000, events: [] }),
    ];
    const result = assembleSwimLaneBoard(cases, NOW);
    const hangarLane = result.lanes.find((l) => l.phase === "hangar")!;
    expect(hangarLane.caseCount).toBe(1);
  });
});
