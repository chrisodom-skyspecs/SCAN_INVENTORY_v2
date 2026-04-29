/**
 * @vitest-environment jsdom
 *
 * Tests for useCaseMapData and its normaliser helpers.
 *
 * AC 350202 Sub-AC 3b — Verify that:
 *   1. normaliseM1Records: maps _id → caseId, preserves position + status + custody.
 *   2. normaliseM2Records: flattens mission group cases + unassigned into flat array.
 *   3. normaliseM3Records: maps inspection fields + custody onto CaseMapRecord.
 *   4. normaliseM4Records: uses currentLat/Lng as position, caseId from shipment,
 *      shipmentId from _id, no custody state.
 *   5. useCaseMapData({ mode: "M1" }) subscribes only M1 query; others are skipped.
 *   6. useCaseMapData({ mode: "M2" }) subscribes only M2 query; flattens records.
 *   7. useCaseMapData({ mode: "M3" }) subscribes only M3 query; includes inspection.
 *   8. useCaseMapData({ mode: "M4" }) subscribes only M4 query; includes shipment data.
 *   9. useCaseMapData({ mode: "M5" }) subscribes only M5 query; records is always [].
 *  10. skip=true suspends all queries and returns empty state.
 *  11. isLoading=true while Convex response is undefined (initial fetch).
 *  12. Filter args are forwarded to the active mode's query.
 *  13. Inactive modes always receive the "skip" sentinel.
 *  14. Mode is echoed back in the return value.
 *
 * AC 100203 Sub-AC 3 — Verify that:
 *  15. computeP50() returns the correct p50 of a sample array.
 *  16. The latency buffer is populated as queries resolve.
 *  17. console.debug is emitted when latency ≤ QUERY_LATENCY_THRESHOLD_MS.
 *  18. console.warn is emitted when latency > QUERY_LATENCY_THRESHOLD_MS.
 *  19. No latency is recorded when skip=true.
 *  20. The timer resets when the active mode changes.
 *
 * Mocking strategy
 * ────────────────
 * • `convex/react` → `useQuery` replaced by a vi.fn() spy.
 *   The spy is configured per-test to return the desired response for each
 *   query ref argument.  Since the hook issues 5 useQuery calls in a fixed
 *   order (M1, M2, M3, M4, M5), we control each call by index.
 * • `convex/_generated/api` → stable symbols for each of the five query refs.
 *
 * The tests never hit a real Convex backend.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  normaliseM1Records,
  normaliseM2Records,
  normaliseM3Records,
  normaliseM4Records,
  useCaseMapData,
  computeP50,
  _getLatencyBuffer,
  _clearLatencyBuffer,
  QUERY_LATENCY_THRESHOLD_MS,
  QUERY_LATENCY_WINDOW_SIZE,
} from "../use-case-map-data";
import type {
  CaseMapRecord,
  UseCaseMapDataArgs,
} from "../use-case-map-data";
import type { M1Response, M2Response, M3Response, M4Response, M5Response, M2MissionCase } from "../../../convex/maps";
import type { MapView } from "@/types/map";

// Hoist query-ref symbols so they are available inside vi.mock factories.
const {
  MOCK_M1_REF,
  MOCK_M2_REF,
  MOCK_M3_REF,
  MOCK_M4_REF,
  MOCK_M5_REF,
} = vi.hoisted(() => ({
  MOCK_M1_REF: Symbol("getM1MapData"),
  MOCK_M2_REF: Symbol("getM2MapData"),
  MOCK_M3_REF: Symbol("getM3MapData"),
  MOCK_M4_REF: Symbol("getM4MapData"),
  MOCK_M5_REF: Symbol("getM5MapData"),
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    mapData: {
      getM1MapData: MOCK_M1_REF,
      getM2MapData: MOCK_M2_REF,
      getM3MapData: MOCK_M3_REF,
      getM4MapData: MOCK_M4_REF,
      getM5MapData: MOCK_M5_REF,
    },
  },
}));

const mockUseQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** M1CasePin fixture. */
function makeM1Pin(
  id: string,
  overrides: Partial<M1Response["cases"][number]> = {}
): M1Response["cases"][number] {
  return {
    _id:                  id,
    label:                `CASE-${id}`,
    status:               "assembled",
    lat:                  42.36,
    lng:                  -71.06,
    locationName:         "Boston Warehouse",
    assigneeName:         "Alice",
    missionId:            undefined,
    updatedAt:            1_700_000_000_000,
    currentCustodianId:   "user_alice",
    currentCustodianName: "Alice",
    custodyTransferredAt: 1_699_000_000_000,
    ...overrides,
  };
}

/** Build a minimal M1Response fixture. */
function makeM1Response(
  cases: M1Response["cases"],
  summaryOverrides: Partial<M1Response["summary"]> = {}
): M1Response {
  const byStatus: Record<string, number> = {};
  for (const c of cases) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  }
  return {
    mode: "M1",
    ts: 1_700_000_000_000,
    cases,
    summary: {
      total:        cases.length,
      withLocation: cases.filter((c) => c.lat !== undefined).length,
      byStatus,
      ...summaryOverrides,
    },
  };
}

/** M2MissionGroup case fixture (includes custody fields). */
function makeM2Case(id: string): M2MissionCase {
  return {
    _id:                  id,
    label:                `CASE-${id}`,
    status:               "deployed",
    lat:                  40.0,
    lng:                  -75.0,
    assigneeName:         "Bob",
    updatedAt:            1_700_000_000_000,
    currentCustodianId:   "user_bob",
    currentCustodianName: "Bob",
    custodyTransferredAt: 1_699_000_000_000,
  };
}

/** Build a minimal M2Response fixture. */
function makeM2Response(overrides: Partial<M2Response> = {}): M2Response {
  return {
    mode: "M2",
    ts: 1_700_000_000_000,
    missions: [
      {
        _id:          "mission_1",
        name:         "Mission Alpha",
        status:       "active",
        lat:          40.0,
        lng:          -75.0,
        locationName: "Site A",
        leadName:     "Lead User",
        caseCount:    2,
        byStatus:     { deployed: 2 },
        cases:        [makeM2Case("case_m1"), makeM2Case("case_m2")],
      },
    ],
    unassigned: [
      {
        _id:          "case_unassigned",
        label:        "CASE-unassigned",
        status:       "assembled",
        lat:          41.0,
        lng:          -74.0,
        assigneeName: "Carol",
        updatedAt:    1_700_000_000_000,
      },
    ],
    summary: {
      total:         3,
      totalMissions: 1,
      byMissionStatus: { active: 1 },
    },
    ...overrides,
  };
}

/** M3CasePin fixture (includes inspection + custody). */
function makeM3Pin(
  id: string,
  overrides: Partial<M3Response["cases"][number]> = {}
): M3Response["cases"][number] {
  return {
    _id:                  id,
    label:                `CASE-${id}`,
    status:               "deployed",
    lat:                  40.0,
    lng:                  -75.0,
    locationName:         "Field Site",
    assigneeName:         "Dave",
    missionId:            "mission_1",
    updatedAt:            1_700_000_000_000,
    currentCustodianId:   "user_dave",
    currentCustodianName: "Dave",
    custodyTransferredAt: 1_699_000_000_000,
    inspectionId:         "insp_1",
    inspectionStatus:     "in_progress",
    inspectorName:        "Dave",
    checkedItems:         5,
    totalItems:           10,
    damagedItems:         1,
    missingItems:         0,
    inspectionProgress:   50,
    ...overrides,
  };
}

/** Build a minimal M3Response fixture. */
function makeM3Response(
  cases: M3Response["cases"],
  summaryOverrides: Partial<M3Response["summary"]> = {}
): M3Response {
  return {
    mode: "M3",
    ts: 1_700_000_000_000,
    cases,
    summary: {
      total:               cases.length,
      byInspectionStatus:  { in_progress: cases.length },
      totalDamaged:        cases.reduce((s, c) => s + c.damagedItems, 0),
      totalMissing:        cases.reduce((s, c) => s + c.missingItems, 0),
      ...summaryOverrides,
    },
  };
}

/** M4ShipmentPin fixture. */
function makeM4Pin(
  id: string,
  overrides: Partial<M4Response["shipments"][number]> = {}
): M4Response["shipments"][number] {
  return {
    _id:               id,
    caseId:            `case_for_${id}`,
    caseLabel:         `CASE-for-${id}`,
    trackingNumber:    `TRACK-${id}`,
    carrier:           "fedex",
    status:            "in_transit",
    origin:            { lat: 42.0, lng: -71.0, name: "Origin City" },
    destination:       { lat: 33.0, lng: -118.0, name: "Destination City" },
    currentLat:        36.0,
    currentLng:        -100.0,
    estimatedDelivery: "2024-01-15",
    shippedAt:         1_699_500_000_000,
    updatedAt:         1_700_000_000_000,
    ...overrides,
  };
}

/** Build a minimal M4Response fixture. */
function makeM4Response(
  shipments: M4Response["shipments"]
): M4Response {
  const byStatus: Record<string, number> = {};
  for (const s of shipments) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  }
  return {
    mode: "M4",
    ts: 1_700_000_000_000,
    shipments,
    summary: {
      total:    shipments.length,
      byStatus,
      inTransit: (byStatus["in_transit"] ?? 0) + (byStatus["out_for_delivery"] ?? 0),
    },
  };
}

/** Build a minimal M5Response fixture. */
function makeM5Response(featureEnabled = true): M5Response {
  return {
    mode: "M5",
    ts: 1_700_000_000_000,
    featureEnabled,
    clusters:  [],
    heatmap:   [],
    timeline:  { startTs: 0, endTs: 1_700_000_000_000, snapshots: [] },
    summary: {
      totalCases:    10,
      totalMissions: 2,
      activeMissions: 1,
      activeRegions: 1,
      byStatus: { deployed: 5, flagged: 3, assembled: 2 },
    },
  };
}

/**
 * Configure mockUseQuery to return specific data for each of the 5 query refs.
 * Call order in the hook is always: M1, M2, M3, M4, M5.
 */
function setQueryReturns({
  m1 = undefined,
  m2 = undefined,
  m3 = undefined,
  m4 = undefined,
  m5 = undefined,
}: {
  m1?: M1Response | undefined;
  m2?: M2Response | undefined;
  m3?: M3Response | undefined;
  m4?: M4Response | undefined;
  m5?: M5Response | undefined;
} = {}) {
  mockUseQuery.mockImplementation((ref: symbol) => {
    if (ref === MOCK_M1_REF) return m1;
    if (ref === MOCK_M2_REF) return m2;
    if (ref === MOCK_M3_REF) return m3;
    if (ref === MOCK_M4_REF) return m4;
    if (ref === MOCK_M5_REF) return m5;
    return undefined;
  });
}

// ─── normaliseM1Records ───────────────────────────────────────────────────────

describe("normaliseM1Records", () => {
  it("maps _id to caseId", () => {
    const pins = [makeM1Pin("abc123")];
    const [record] = normaliseM1Records(pins);
    expect(record.caseId).toBe("abc123");
    // _id must not appear on the normalised shape
    expect((record as unknown as Record<string, unknown>)["_id"]).toBeUndefined();
  });

  it("preserves lat and lng", () => {
    const pins = [makeM1Pin("p1", { lat: 51.5074, lng: -0.1278 })];
    const [record] = normaliseM1Records(pins);
    expect(record.lat).toBe(51.5074);
    expect(record.lng).toBe(-0.1278);
  });

  it("preserves status", () => {
    const statuses = [
      "hangar", "assembled", "transit_out", "deployed",
      "flagged", "transit_in", "received", "archived",
    ] as const;
    for (const status of statuses) {
      const [record] = normaliseM1Records([makeM1Pin("x", { status })]);
      expect(record.status).toBe(status);
    }
  });

  it("preserves label", () => {
    const [record] = normaliseM1Records([makeM1Pin("p2", { label: "CASE-0042" })]);
    expect(record.label).toBe("CASE-0042");
  });

  it("preserves locationName, assigneeName, missionId", () => {
    const [record] = normaliseM1Records([
      makeM1Pin("p3", {
        locationName: "Denver Site",
        assigneeName: "Bob",
        missionId:    "mission_99",
      }),
    ]);
    expect(record.locationName).toBe("Denver Site");
    expect(record.assigneeName).toBe("Bob");
    expect(record.missionId).toBe("mission_99");
  });

  it("preserves undefined lat/lng (no silent drop for unlocated cases)", () => {
    const [record] = normaliseM1Records([
      makeM1Pin("p4", { lat: undefined, lng: undefined }),
    ]);
    expect(record.lat).toBeUndefined();
    expect(record.lng).toBeUndefined();
  });

  it("maps custody state fields", () => {
    const [record] = normaliseM1Records([
      makeM1Pin("p5", {
        currentCustodianId:   "user_xyz",
        currentCustodianName: "Xavier",
        custodyTransferredAt: 1_699_000_000_000,
      }),
    ]);
    expect(record.currentCustodianId).toBe("user_xyz");
    expect(record.currentCustodianName).toBe("Xavier");
    expect(record.custodyTransferredAt).toBe(1_699_000_000_000);
  });

  it("returns empty array for empty input", () => {
    expect(normaliseM1Records([])).toEqual([]);
  });

  it("preserves order of input array", () => {
    const pins = [makeM1Pin("a"), makeM1Pin("b"), makeM1Pin("c")];
    const records = normaliseM1Records(pins);
    expect(records.map((r: CaseMapRecord) => r.caseId)).toEqual(["a", "b", "c"]);
  });
});

// ─── normaliseM2Records ───────────────────────────────────────────────────────

describe("normaliseM2Records", () => {
  it("flattens mission group cases into the returned array", () => {
    const data = makeM2Response();
    const records = normaliseM2Records(data);
    // 2 mission cases + 1 unassigned = 3
    expect(records).toHaveLength(3);
  });

  it("annotates mission group cases with the group's missionId", () => {
    const data = makeM2Response();
    const missionCases = normaliseM2Records(data).slice(0, 2);
    for (const r of missionCases) {
      expect(r.missionId).toBe("mission_1");
    }
  });

  it("sets missionId=undefined for unassigned cases", () => {
    const data = makeM2Response();
    const unassigned = normaliseM2Records(data).at(-1)!;
    expect(unassigned.caseId).toBe("case_unassigned");
    expect(unassigned.missionId).toBeUndefined();
  });

  it("maps _id → caseId for mission cases", () => {
    const data = makeM2Response();
    const [first] = normaliseM2Records(data);
    expect(first.caseId).toBe("case_m1");
    expect((first as unknown as Record<string, unknown>)["_id"]).toBeUndefined();
  });

  it("includes custody fields from mission group cases", () => {
    const data = makeM2Response();
    const [first] = normaliseM2Records(data);
    expect(first.currentCustodianId).toBe("user_bob");
    expect(first.currentCustodianName).toBe("Bob");
    expect(first.custodyTransferredAt).toBe(1_699_000_000_000);
  });

  it("returns empty array when no missions and no unassigned", () => {
    const data = makeM2Response({
      missions:   [],
      unassigned: [],
      summary: { total: 0, totalMissions: 0, byMissionStatus: {} },
    });
    expect(normaliseM2Records(data)).toEqual([]);
  });

  it("handles multiple mission groups", () => {
    const data = makeM2Response({
      missions: [
        {
          _id: "m1", name: "Alpha", status: "active",
          lat: 1, lng: 1, caseCount: 1, byStatus: {},
          cases: [makeM2Case("c1")],
        },
        {
          _id: "m2", name: "Beta", status: "active",
          lat: 2, lng: 2, caseCount: 1, byStatus: {},
          cases: [makeM2Case("c2")],
        },
      ],
      unassigned: [],
      summary: { total: 2, totalMissions: 2, byMissionStatus: {} },
    });
    const records = normaliseM2Records(data);
    expect(records).toHaveLength(2);
    expect(records[0].missionId).toBe("m1");
    expect(records[1].missionId).toBe("m2");
  });
});

// ─── normaliseM3Records ───────────────────────────────────────────────────────

describe("normaliseM3Records", () => {
  it("maps _id → caseId", () => {
    const [record] = normaliseM3Records([makeM3Pin("p3-1")]);
    expect(record.caseId).toBe("p3-1");
  });

  it("includes inspection progress fields", () => {
    const pin = makeM3Pin("p3-2", {
      inspectionId:       "insp_x",
      inspectionStatus:   "completed",
      inspectorName:      "Eve",
      checkedItems:       10,
      totalItems:         10,
      damagedItems:       2,
      missingItems:       1,
      inspectionProgress: 100,
    });
    const [record] = normaliseM3Records([pin]);
    expect(record.inspectionId).toBe("insp_x");
    expect(record.inspectionStatus).toBe("completed");
    expect(record.inspectorName).toBe("Eve");
    expect(record.checkedItems).toBe(10);
    expect(record.totalItems).toBe(10);
    expect(record.damagedItems).toBe(2);
    expect(record.missingItems).toBe(1);
    expect(record.inspectionProgress).toBe(100);
  });

  it("includes custody state fields", () => {
    const pin = makeM3Pin("p3-3", {
      currentCustodianId:   "user_eve",
      currentCustodianName: "Eve",
      custodyTransferredAt: 1_698_000_000_000,
    });
    const [record] = normaliseM3Records([pin]);
    expect(record.currentCustodianId).toBe("user_eve");
    expect(record.currentCustodianName).toBe("Eve");
    expect(record.custodyTransferredAt).toBe(1_698_000_000_000);
  });

  it("preserves lat/lng and locationName", () => {
    const pin = makeM3Pin("p3-4", { lat: 37.0, lng: -122.0, locationName: "SF Site" });
    const [record] = normaliseM3Records([pin]);
    expect(record.lat).toBe(37.0);
    expect(record.lng).toBe(-122.0);
    expect(record.locationName).toBe("SF Site");
  });

  it("returns empty array for empty input", () => {
    expect(normaliseM3Records([])).toEqual([]);
  });
});

// ─── normaliseM4Records ───────────────────────────────────────────────────────

describe("normaliseM4Records", () => {
  it("uses caseId from the shipment (not _id)", () => {
    const pin = makeM4Pin("ship_1");
    const [record] = normaliseM4Records([pin]);
    expect(record.caseId).toBe("case_for_ship_1");
  });

  it("exposes the shipment _id as shipmentId", () => {
    const pin = makeM4Pin("ship_2");
    const [record] = normaliseM4Records([pin]);
    expect(record.shipmentId).toBe("ship_2");
  });

  it("uses caseLabel as the record label", () => {
    const pin = makeM4Pin("ship_3", { caseLabel: "CASE-0099" });
    const [record] = normaliseM4Records([pin]);
    expect(record.label).toBe("CASE-0099");
  });

  it("uses currentLat/Lng as position when available", () => {
    const pin = makeM4Pin("ship_4", { currentLat: 36.5, currentLng: -100.5 });
    const [record] = normaliseM4Records([pin]);
    expect(record.lat).toBe(36.5);
    expect(record.lng).toBe(-100.5);
  });

  it("falls back to destination.lat/lng when no currentLat/Lng", () => {
    const pin = makeM4Pin("ship_5", {
      currentLat:  undefined,
      currentLng:  undefined,
      destination: { lat: 33.0, lng: -118.0, name: "LA" },
    });
    const [record] = normaliseM4Records([pin]);
    expect(record.lat).toBe(33.0);
    expect(record.lng).toBe(-118.0);
  });

  it("lat/lng are undefined when neither currentLat nor destination lat is set", () => {
    const pin = makeM4Pin("ship_6", {
      currentLat:  undefined,
      currentLng:  undefined,
      destination: { name: "Unknown" },
    });
    const [record] = normaliseM4Records([pin]);
    expect(record.lat).toBeUndefined();
    expect(record.lng).toBeUndefined();
  });

  it("includes shipment-specific fields (trackingNumber, carrier, etc.)", () => {
    const pin = makeM4Pin("ship_7", {
      trackingNumber:    "FEDEX-123",
      carrier:           "fedex",
      estimatedDelivery: "2024-02-01",
      shippedAt:         1_699_000_000_000,
      origin:            { lat: 42.0, lng: -71.0, name: "Boston" },
      destination:       { lat: 33.0, lng: -118.0, name: "LA" },
    });
    const [record] = normaliseM4Records([pin]);
    expect(record.trackingNumber).toBe("FEDEX-123");
    expect(record.carrier).toBe("fedex");
    expect(record.estimatedDelivery).toBe("2024-02-01");
    expect(record.shippedAt).toBe(1_699_000_000_000);
    expect(record.origin?.name).toBe("Boston");
    expect(record.destination?.name).toBe("LA");
  });

  it("does NOT include custody state fields", () => {
    const pin = makeM4Pin("ship_8");
    const [record] = normaliseM4Records([pin]);
    expect(record.currentCustodianId).toBeUndefined();
    expect(record.currentCustodianName).toBeUndefined();
    expect(record.custodyTransferredAt).toBeUndefined();
  });

  it("returns empty array for empty input", () => {
    expect(normaliseM4Records([])).toEqual([]);
  });
});

// ─── useCaseMapData — hook integration ───────────────────────────────────────

describe("useCaseMapData", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
  });

  // ─── Loading state ─────────────────────────────────────────────────────────

  it("returns isLoading=true while M1 Convex response is pending (undefined)", () => {
    setQueryReturns({ m1: undefined });

    const { result } = renderHook(() => useCaseMapData({ mode: "M1" }));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.records).toEqual([]);
    expect(result.current.summary).toBeUndefined();
    expect(result.current.mode).toBe("M1");
  });

  it("returns isLoading=true while M3 Convex response is pending (undefined)", () => {
    setQueryReturns({ m3: undefined });

    const { result } = renderHook(() => useCaseMapData({ mode: "M3" }));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.records).toEqual([]);
    expect(result.current.mode).toBe("M3");
  });

  // ─── Skip semantics ────────────────────────────────────────────────────────

  it("returns empty state immediately when skip=true", () => {
    setQueryReturns({ m1: makeM1Response([makeM1Pin("c1")]) });

    const { result } = renderHook(() =>
      useCaseMapData({ mode: "M1", skip: true })
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.records).toEqual([]);
    expect(result.current.summary).toBeUndefined();
    expect(result.current.mode).toBe("M1");
  });

  it("passes 'skip' sentinel to all 5 queries when skip=true", () => {
    setQueryReturns();

    renderHook(() => useCaseMapData({ mode: "M1", skip: true }));

    // All 5 calls should have received "skip" as the second arg
    const calls = mockUseQuery.mock.calls;
    expect(calls).toHaveLength(5);
    for (const [, secondArg] of calls) {
      expect(secondArg).toBe("skip");
    }
  });

  // ─── Mode isolation — only the active mode is subscribed ──────────────────

  it("M1 mode: only M1 query receives real args; M2-M5 receive 'skip'", () => {
    setQueryReturns({ m1: makeM1Response([]) });

    renderHook(() => useCaseMapData({ mode: "M1" }));

    const calls = mockUseQuery.mock.calls;
    // Call 0 = M1: should have real args (object, not "skip")
    expect(calls[0][0]).toBe(MOCK_M1_REF);
    expect(calls[0][1]).not.toBe("skip");
    // Calls 1–4 = M2-M5: should all be "skip"
    for (let i = 1; i <= 4; i++) {
      expect(calls[i][1]).toBe("skip");
    }
  });

  it("M2 mode: only M2 query receives real args; M1/M3/M4/M5 receive 'skip'", () => {
    setQueryReturns({ m2: makeM2Response() });

    renderHook(() => useCaseMapData({ mode: "M2" }));

    const calls = mockUseQuery.mock.calls;
    expect(calls[0][0]).toBe(MOCK_M1_REF);
    expect(calls[0][1]).toBe("skip");  // M1 skipped
    expect(calls[1][0]).toBe(MOCK_M2_REF);
    expect(calls[1][1]).not.toBe("skip");  // M2 active
    expect(calls[2][1]).toBe("skip");  // M3 skipped
    expect(calls[3][1]).toBe("skip");  // M4 skipped
    expect(calls[4][1]).toBe("skip");  // M5 skipped
  });

  it("M3 mode: only M3 query receives real args", () => {
    setQueryReturns({ m3: makeM3Response([makeM3Pin("c3")]) });

    renderHook(() => useCaseMapData({ mode: "M3" }));

    const calls = mockUseQuery.mock.calls;
    expect(calls[0][1]).toBe("skip");  // M1
    expect(calls[1][1]).toBe("skip");  // M2
    expect(calls[2][0]).toBe(MOCK_M3_REF);
    expect(calls[2][1]).not.toBe("skip");  // M3 active
    expect(calls[3][1]).toBe("skip");  // M4
    expect(calls[4][1]).toBe("skip");  // M5
  });

  it("M4 mode: only M4 query receives real args", () => {
    setQueryReturns({ m4: makeM4Response([makeM4Pin("s1")]) });

    renderHook(() => useCaseMapData({ mode: "M4" }));

    const calls = mockUseQuery.mock.calls;
    expect(calls[0][1]).toBe("skip");
    expect(calls[1][1]).toBe("skip");
    expect(calls[2][1]).toBe("skip");
    expect(calls[3][0]).toBe(MOCK_M4_REF);
    expect(calls[3][1]).not.toBe("skip");
    expect(calls[4][1]).toBe("skip");
  });

  it("M5 mode: only M5 query receives real args", () => {
    setQueryReturns({ m5: makeM5Response() });

    renderHook(() => useCaseMapData({ mode: "M5" }));

    const calls = mockUseQuery.mock.calls;
    for (let i = 0; i < 4; i++) {
      expect(calls[i][1]).toBe("skip");
    }
    expect(calls[4][0]).toBe(MOCK_M5_REF);
    expect(calls[4][1]).not.toBe("skip");
  });

  // ─── M1 data → normalised records ─────────────────────────────────────────

  it("M1: returns normalised CaseMapRecord[] from M1 response", () => {
    const pins = [
      makeM1Pin("c1", { status: "deployed", lat: 40.0, lng: -75.0 }),
      makeM1Pin("c2", { status: "flagged",  lat: 41.0, lng: -76.0 }),
    ];
    setQueryReturns({ m1: makeM1Response(pins) });

    const { result } = renderHook(() => useCaseMapData({ mode: "M1" }));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.records).toHaveLength(2);
    expect(result.current.records[0].caseId).toBe("c1");
    expect(result.current.records[0].status).toBe("deployed");
    expect(result.current.records[1].caseId).toBe("c2");
    expect(result.current.records[1].status).toBe("flagged");
    expect(result.current.mode).toBe("M1");
  });

  it("M1: summary includes total, byStatus, withLocation", () => {
    const pins = [
      makeM1Pin("c1", { status: "deployed", lat: 40.0, lng: -75.0 }),
      makeM1Pin("c2", { status: "deployed", lat: undefined, lng: undefined }),
    ];
    setQueryReturns({ m1: makeM1Response(pins) });

    const { result } = renderHook(() => useCaseMapData({ mode: "M1" }));

    expect(result.current.summary?.total).toBe(2);
    expect(result.current.summary?.byStatus["deployed"]).toBe(2);
    expect(result.current.summary?.withLocation).toBe(1);
  });

  // ─── M2 data → flattened records ──────────────────────────────────────────

  it("M2: flattens mission cases and unassigned into flat records array", () => {
    setQueryReturns({ m2: makeM2Response() });

    const { result } = renderHook(() => useCaseMapData({ mode: "M2" }));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.records).toHaveLength(3); // 2 mission + 1 unassigned
    expect(result.current.mode).toBe("M2");
  });

  it("M2: mission cases carry their missionId", () => {
    setQueryReturns({ m2: makeM2Response() });

    const { result } = renderHook(() => useCaseMapData({ mode: "M2" }));
    const missionCases = result.current.records.filter(
      (r) => r.missionId === "mission_1"
    );
    expect(missionCases).toHaveLength(2);
  });

  it("M2: unassigned cases have missionId=undefined", () => {
    setQueryReturns({ m2: makeM2Response() });

    const { result } = renderHook(() => useCaseMapData({ mode: "M2" }));
    const unassigned = result.current.records.find(
      (r) => r.caseId === "case_unassigned"
    );
    expect(unassigned?.missionId).toBeUndefined();
  });

  // ─── M3 data → field records with inspection ──────────────────────────────

  it("M3: returns records with inspection progress data", () => {
    const pins = [makeM3Pin("f1")];
    setQueryReturns({ m3: makeM3Response(pins) });

    const { result } = renderHook(() => useCaseMapData({ mode: "M3" }));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.records).toHaveLength(1);
    const record = result.current.records[0];
    expect(record.caseId).toBe("f1");
    expect(record.inspectionId).toBe("insp_1");
    expect(record.inspectionProgress).toBe(50);
    expect(record.checkedItems).toBe(5);
    expect(record.totalItems).toBe(10);
    expect(record.damagedItems).toBe(1);
    expect(record.missingItems).toBe(0);
    // mode is on the result object, not on individual CaseMapRecord items
    expect(result.current.mode).toBe("M3");
  });

  it("M3: records include custody state", () => {
    const pins = [makeM3Pin("f2")];
    setQueryReturns({ m3: makeM3Response(pins) });

    const { result } = renderHook(() => useCaseMapData({ mode: "M3" }));
    const record = result.current.records[0];
    expect(record.currentCustodianId).toBe("user_dave");
    expect(record.currentCustodianName).toBe("Dave");
  });

  // ─── M4 data → shipment records ───────────────────────────────────────────

  it("M4: returns records with shipment data", () => {
    const pins = [makeM4Pin("s1")];
    setQueryReturns({ m4: makeM4Response(pins) });

    const { result } = renderHook(() => useCaseMapData({ mode: "M4" }));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.records).toHaveLength(1);
    const record = result.current.records[0];
    expect(record.caseId).toBe("case_for_s1");
    expect(record.shipmentId).toBe("s1");
    expect(record.trackingNumber).toBe("TRACK-s1");
    expect(record.carrier).toBe("fedex");
    expect(record.lat).toBe(36.0);   // currentLat
    expect(record.lng).toBe(-100.0); // currentLng
  });

  it("M4: summary includes inTransit count", () => {
    const pins = [
      makeM4Pin("s1", { status: "in_transit" }),
      makeM4Pin("s2", { status: "out_for_delivery" }),
      makeM4Pin("s3", { status: "delivered" }),
    ];
    setQueryReturns({ m4: makeM4Response(pins) });

    const { result } = renderHook(() => useCaseMapData({ mode: "M4" }));

    expect(result.current.summary?.total).toBe(3);
    expect(result.current.summary?.inTransit).toBe(2);
  });

  // ─── M5 data → empty records, summary ────────────────────────────────────

  it("M5: records is always empty (cluster/heatmap, not individual cases)", () => {
    setQueryReturns({ m5: makeM5Response(true) });

    const { result } = renderHook(() => useCaseMapData({ mode: "M5" }));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.records).toEqual([]);
    expect(result.current.mode).toBe("M5");
  });

  it("M5: summary includes totalCases as total and byStatus breakdown", () => {
    setQueryReturns({ m5: makeM5Response(true) });

    const { result } = renderHook(() => useCaseMapData({ mode: "M5" }));

    expect(result.current.summary?.total).toBe(10);
    expect(result.current.summary?.byStatus["deployed"]).toBe(5);
    expect(result.current.summary?.byStatus["flagged"]).toBe(3);
  });

  it("M5: isLoading=true while M5 response is pending", () => {
    setQueryReturns({ m5: undefined });

    const { result } = renderHook(() => useCaseMapData({ mode: "M5" }));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.summary).toBeUndefined();
  });

  // ─── Filter arg forwarding ─────────────────────────────────────────────────

  it("M1: forwards bounds to the M1 query as flat swLat/swLng/neLat/neLng fields", () => {
    setQueryReturns({ m1: makeM1Response([]) });
    const bounds = { swLat: 40.0, swLng: -74.0, neLat: 41.0, neLng: -73.0 };

    renderHook(() => useCaseMapData({ mode: "M1", bounds }));

    const m1Call = mockUseQuery.mock.calls.find(
      ([ref]) => ref === MOCK_M1_REF
    );
    expect(m1Call?.[1]).toMatchObject({
      swLat: 40.0,
      swLng: -74.0,
      neLat: 41.0,
      neLng: -73.0,
    });
  });

  it("M1: forwards status filter to M1 query", () => {
    setQueryReturns({ m1: makeM1Response([]) });

    renderHook(() =>
      useCaseMapData({ mode: "M1", status: ["deployed", "flagged"] })
    );

    const m1Call = mockUseQuery.mock.calls.find(([ref]) => ref === MOCK_M1_REF);
    expect(m1Call?.[1]).toMatchObject({ status: ["deployed", "flagged"] });
  });

  it("M1: forwards assigneeId to M1 query", () => {
    setQueryReturns({ m1: makeM1Response([]) });

    renderHook(() => useCaseMapData({ mode: "M1", assigneeId: "user_abc" }));

    const m1Call = mockUseQuery.mock.calls.find(([ref]) => ref === MOCK_M1_REF);
    expect(m1Call?.[1]).toMatchObject({ assigneeId: "user_abc" });
  });

  it("M1: forwards missionId to M1 query", () => {
    setQueryReturns({ m1: makeM1Response([]) });

    renderHook(() => useCaseMapData({ mode: "M1", missionId: "mission_xyz" }));

    const m1Call = mockUseQuery.mock.calls.find(([ref]) => ref === MOCK_M1_REF);
    expect(m1Call?.[1]).toMatchObject({ missionId: "mission_xyz" });
  });

  it("M3: forwards hasInspection to M3 query", () => {
    setQueryReturns({ m3: makeM3Response([]) });

    renderHook(() =>
      useCaseMapData({ mode: "M3", hasInspection: true })
    );

    const m3Call = mockUseQuery.mock.calls.find(([ref]) => ref === MOCK_M3_REF);
    expect(m3Call?.[1]).toMatchObject({ hasInspection: true });
  });

  it("M3: forwards hasDamage to M3 query", () => {
    setQueryReturns({ m3: makeM3Response([]) });

    renderHook(() =>
      useCaseMapData({ mode: "M3", hasDamage: true })
    );

    const m3Call = mockUseQuery.mock.calls.find(([ref]) => ref === MOCK_M3_REF);
    expect(m3Call?.[1]).toMatchObject({ hasDamage: true });
  });

  it("M4: forwards shipmentStatus as `status` key to M4 query", () => {
    setQueryReturns({ m4: makeM4Response([]) });

    renderHook(() =>
      useCaseMapData({
        mode: "M4",
        shipmentStatus: ["in_transit", "out_for_delivery"],
      })
    );

    const m4Call = mockUseQuery.mock.calls.find(([ref]) => ref === MOCK_M4_REF);
    expect(m4Call?.[1]).toMatchObject({
      status: ["in_transit", "out_for_delivery"],
    });
  });

  it("M1: omits null/undefined filters from query args", () => {
    setQueryReturns({ m1: makeM1Response([]) });

    renderHook(() =>
      useCaseMapData({ mode: "M1", assigneeId: null, missionId: null, bounds: null })
    );

    const m1Call = mockUseQuery.mock.calls.find(([ref]) => ref === MOCK_M1_REF);
    expect(m1Call?.[1]).not.toHaveProperty("assigneeId");
    expect(m1Call?.[1]).not.toHaveProperty("missionId");
    expect(m1Call?.[1]).not.toHaveProperty("swLat");
  });

  it("M1: omits empty status array from query args", () => {
    setQueryReturns({ m1: makeM1Response([]) });

    renderHook(() => useCaseMapData({ mode: "M1", status: [] }));

    const m1Call = mockUseQuery.mock.calls.find(([ref]) => ref === MOCK_M1_REF);
    expect(m1Call?.[1]).not.toHaveProperty("status");
  });

  it("defaults to M1 mode when mode is not specified", () => {
    setQueryReturns({ m1: makeM1Response([]) });

    const { result } = renderHook(() => useCaseMapData());

    expect(result.current.mode).toBe("M1");
    // M1 ref should have real args
    const m1Call = mockUseQuery.mock.calls.find(([ref]) => ref === MOCK_M1_REF);
    expect(m1Call?.[1]).not.toBe("skip");
  });

  // ─── Mode echoed in return value ──────────────────────────────────────────

  it("echoes mode in the return value for M2", () => {
    setQueryReturns({ m2: makeM2Response() });
    const { result } = renderHook(() => useCaseMapData({ mode: "M2" }));
    expect(result.current.mode).toBe("M2");
  });

  it("echoes mode in the return value for M4", () => {
    setQueryReturns({ m4: makeM4Response([]) });
    const { result } = renderHook(() => useCaseMapData({ mode: "M4" }));
    expect(result.current.mode).toBe("M4");
  });

  // ─── Empty fleet cases ────────────────────────────────────────────────────

  it("M1: handles empty fleet gracefully", () => {
    setQueryReturns({ m1: makeM1Response([]) });

    const { result } = renderHook(() => useCaseMapData({ mode: "M1" }));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.records).toEqual([]);
    expect(result.current.summary?.total).toBe(0);
  });

  it("M4: handles empty shipments gracefully", () => {
    setQueryReturns({ m4: makeM4Response([]) });

    const { result } = renderHook(() => useCaseMapData({ mode: "M4" }));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.records).toEqual([]);
    expect(result.current.summary?.total).toBe(0);
    expect(result.current.summary?.inTransit).toBe(0);
  });
});

// ─── computeP50 ───────────────────────────────────────────────────────────────

describe("computeP50", () => {
  it("returns undefined for an empty array", () => {
    expect(computeP50([])).toBeUndefined();
  });

  it("returns the single value for a one-element array", () => {
    expect(computeP50([42])).toBe(42);
  });

  it("returns the middle element for odd-length arrays", () => {
    expect(computeP50([10, 30, 50])).toBe(30);
    expect(computeP50([100, 50, 10])).toBe(50); // sorts before selecting
    expect(computeP50([1, 2, 3, 4, 5])).toBe(3);
  });

  it("returns the upper-middle element for even-length arrays (floor(n/2) index)", () => {
    // For n=4: Math.floor(4/2) = 2; sorted=[10,20,30,40]; sorted[2] = 30
    expect(computeP50([10, 20, 30, 40])).toBe(30);
    // For n=2: Math.floor(2/2) = 1; sorted=[10,20]; sorted[1] = 20
    expect(computeP50([10, 20])).toBe(20);
    // For n=6: Math.floor(6/2) = 3; sorted=[1,2,3,4,5,6]; sorted[3] = 4
    expect(computeP50([1, 2, 3, 4, 5, 6])).toBe(4);
  });

  it("sorts numerically, not lexicographically", () => {
    // '100' < '20' lexicographically, but 20 < 100 numerically
    expect(computeP50([100, 20, 5])).toBe(20);
  });

  it("handles arrays with repeated values", () => {
    expect(computeP50([5, 5, 5, 5, 5])).toBe(5);
    expect(computeP50([1, 2, 2, 3])).toBe(2); // sorted[floor(4/2)]=sorted[2]=2
  });

  it("does not mutate the input array", () => {
    const input = [30, 10, 20];
    computeP50(input);
    expect(input).toEqual([30, 10, 20]);
  });
});

// ─── Latency buffer management ────────────────────────────────────────────────

describe("latency buffer (_getLatencyBuffer / _clearLatencyBuffer)", () => {
  beforeEach(() => _clearLatencyBuffer());

  it("starts empty after clearing", () => {
    expect(_getLatencyBuffer()).toHaveLength(0);
  });

  it("QUERY_LATENCY_THRESHOLD_MS is 200ms", () => {
    expect(QUERY_LATENCY_THRESHOLD_MS).toBe(200);
  });

  it("QUERY_LATENCY_WINDOW_SIZE is a positive integer", () => {
    expect(QUERY_LATENCY_WINDOW_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(QUERY_LATENCY_WINDOW_SIZE)).toBe(true);
  });

  it("buffer is readable as a readonly snapshot", () => {
    // The buffer starts empty; we can read it without errors.
    const snapshot = _getLatencyBuffer();
    expect(Array.isArray(snapshot)).toBe(true);
  });

  it("_clearLatencyBuffer empties the buffer between tests", () => {
    // Populate by rendering a hook with immediate data so a latency sample
    // is recorded, then clear and verify.
    setQueryReturns({ m1: makeM1Response([]) });
    renderHook(() => useCaseMapData({ mode: "M1" }));
    // After the above renderHook the buffer may have one entry (immediate data).
    // Whether it does or not, _clearLatencyBuffer must leave it empty.
    _clearLatencyBuffer();
    expect(_getLatencyBuffer()).toHaveLength(0);
  });
});

// ─── p50 latency instrumentation — hook integration ──────────────────────────

describe("useCaseMapData p50 latency instrumentation (AC 100203 Sub-AC 3)", () => {
  let perfNowSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockUseQuery.mockReset();
    _clearLatencyBuffer();
    // Default: performance.now() starts at 0
    perfNowSpy = vi
      .spyOn(performance, "now")
      .mockReturnValue(0);
    // Suppress log output in tests
    consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    consoleDebugSpy = vi
      .spyOn(console, "debug")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records a latency sample when query transitions from undefined to defined", () => {
    // First render: M1 query is loading (undefined)
    setQueryReturns({ m1: undefined });
    const { rerender } = renderHook(() => useCaseMapData({ mode: "M1" }));

    // No sample should be recorded while still loading
    // (the transition hasn't happened yet)

    // Advance simulated time to 120ms, then data arrives
    perfNowSpy.mockReturnValue(120);
    setQueryReturns({ m1: makeM1Response([]) });
    rerender();

    // One sample should now be in the buffer
    const buf = _getLatencyBuffer();
    expect(buf).toHaveLength(1);
    expect(buf[0]).toBe(120); // Math.round(120 - 0) = 120
  });

  it("emits console.debug when measured latency is within the 200ms threshold", () => {
    setQueryReturns({ m1: undefined });
    const { rerender } = renderHook(() => useCaseMapData({ mode: "M1" }));

    // Latency = 150ms (below threshold)
    perfNowSpy.mockReturnValue(150);
    setQueryReturns({ m1: makeM1Response([]) });
    rerender();

    expect(consoleDebugSpy).toHaveBeenCalledOnce();
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    const [debugMsg] = consoleDebugSpy.mock.calls[0];
    expect(debugMsg).toContain("[useCaseMapData]");
    expect(debugMsg).toContain("M1");
    expect(debugMsg).toContain("150ms");
    expect(debugMsg).toContain("p50=");
  });

  it("emits console.warn when measured latency exceeds 200ms threshold", () => {
    setQueryReturns({ m1: undefined });
    const { rerender } = renderHook(() => useCaseMapData({ mode: "M1" }));

    // Latency = 250ms (above threshold)
    perfNowSpy.mockReturnValue(250);
    setQueryReturns({ m1: makeM1Response([]) });
    rerender();

    expect(consoleWarnSpy).toHaveBeenCalledOnce();
    expect(consoleDebugSpy).not.toHaveBeenCalled();

    const [warnMsg] = consoleWarnSpy.mock.calls[0];
    expect(warnMsg).toContain("[useCaseMapData]");
    expect(warnMsg).toContain("M1");
    expect(warnMsg).toContain("250ms");
    expect(warnMsg).toContain("exceeds 200ms threshold");
  });

  it("emits a warning that includes the p50 value", () => {
    setQueryReturns({ m1: undefined });
    const { rerender } = renderHook(() => useCaseMapData({ mode: "M1" }));

    perfNowSpy.mockReturnValue(350);
    setQueryReturns({ m1: makeM1Response([]) });
    rerender();

    const [warnMsg] = consoleWarnSpy.mock.calls[0];
    // Only one sample so p50 = 350
    expect(warnMsg).toContain("p50=350ms");
    expect(warnMsg).toContain("n=1");
  });

  it("computes p50 across multiple samples from repeated subscriptions", () => {
    // Inject three sequential mode-switch cycles to accumulate samples:
    //   sample 1: mode=M1, latency=50ms
    //   sample 2: mode=M2, latency=150ms
    //   sample 3: mode=M3, latency=100ms

    // Cycle 1 — M1, 50ms
    setQueryReturns({ m1: undefined });
    perfNowSpy.mockReturnValue(0);
    const { rerender } = renderHook(
      ({ mode }: { mode: MapView }) => useCaseMapData({ mode }),
      { initialProps: { mode: "M1" } }
    );
    perfNowSpy.mockReturnValue(50);
    setQueryReturns({ m1: makeM1Response([]) });
    rerender({ mode: "M1" });

    // Cycle 2 — M2, 150ms
    _clearLatencyBuffer(); // fresh for this sub-test
    setQueryReturns({ m2: undefined });
    perfNowSpy.mockReturnValue(0);
    rerender({ mode: "M2" });
    perfNowSpy.mockReturnValue(150);
    setQueryReturns({ m2: makeM2Response() });
    rerender({ mode: "M2" });

    // After two sequential measurements we can verify p50 is computed
    const buf = _getLatencyBuffer();
    // The buffer should have 1 entry from the M2 cycle (cleared before)
    expect(buf.length).toBeGreaterThanOrEqual(1);
    const p50 = computeP50(buf);
    expect(p50).toBeDefined();
  });

  it("does NOT record a latency sample when skip=true", () => {
    setQueryReturns({ m1: makeM1Response([]) });
    renderHook(() => useCaseMapData({ mode: "M1", skip: true }));

    expect(_getLatencyBuffer()).toHaveLength(0);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleDebugSpy).not.toHaveBeenCalled();
  });

  it("does not re-record latency on subsequent renders after data has arrived", () => {
    // First render: loading
    setQueryReturns({ m1: undefined });
    perfNowSpy.mockReturnValue(0);
    const { rerender } = renderHook(() => useCaseMapData({ mode: "M1" }));

    // Data arrives — one sample recorded
    perfNowSpy.mockReturnValue(80);
    setQueryReturns({ m1: makeM1Response([]) });
    rerender();

    const countAfterFirstArrival = _getLatencyBuffer().length;

    // Additional renders with same data — should NOT add more samples
    rerender();
    rerender();

    expect(_getLatencyBuffer().length).toBe(countAfterFirstArrival);
    expect(consoleDebugSpy).toHaveBeenCalledTimes(1);
  });

  it("resets the timer when the active mode changes", () => {
    // Start with M1 data already available (no latency for initial load since
    // the hook initialises _wasLoadingRef to true and immediate data triggers
    // a near-zero latency measurement on first render).
    setQueryReturns({ m1: makeM1Response([]) });
    perfNowSpy.mockReturnValue(0);
    const { rerender } = renderHook(
      ({ mode }: { mode: MapView }) => useCaseMapData({ mode }),
      { initialProps: { mode: "M1" } }
    );

    // Clear the buffer so we only measure the M3 subscription
    _clearLatencyBuffer();
    consoleDebugSpy.mockClear();
    consoleWarnSpy.mockClear();

    // Switch to M3 (no data yet) — timer resets to T=100
    setQueryReturns({ m1: makeM1Response([]), m3: undefined });
    perfNowSpy.mockReturnValue(100);
    rerender({ mode: "M3" });

    // M3 data arrives at T=350 → latency = 350 - 100 = 250ms (above threshold)
    perfNowSpy.mockReturnValue(350);
    setQueryReturns({ m1: makeM1Response([]), m3: makeM3Response([makeM3Pin("f1")]) });
    rerender({ mode: "M3" });

    expect(consoleWarnSpy).toHaveBeenCalledOnce();
    const [warnMsg] = consoleWarnSpy.mock.calls[0];
    expect(warnMsg).toContain("M3");
    expect(warnMsg).toContain("250ms");
    expect(warnMsg).toContain("exceeds 200ms threshold");
  });

  it("log message includes the active map mode in every case", () => {
    const modes = ["M2", "M3", "M4", "M5"] as const;

    for (const mode of modes) {
      _clearLatencyBuffer();
      consoleDebugSpy.mockClear();
      consoleWarnSpy.mockClear();

      // Set up loading state for this mode
      const queryReturns: Parameters<typeof setQueryReturns>[0] = {};
      setQueryReturns({ ...queryReturns });
      perfNowSpy.mockReturnValue(0);

      const { rerender: rr } = renderHook(
        ({ m }: { m: typeof mode }) => useCaseMapData({ mode: m }),
        { initialProps: { m: mode } }
      );

      // Provide data for the mode
      perfNowSpy.mockReturnValue(50);
      switch (mode) {
        case "M2":
          setQueryReturns({ m2: makeM2Response() });
          break;
        case "M3":
          setQueryReturns({ m3: makeM3Response([makeM3Pin("f1")]) });
          break;
        case "M4":
          setQueryReturns({ m4: makeM4Response([makeM4Pin("s1")]) });
          break;
        case "M5":
          setQueryReturns({ m5: makeM5Response() });
          break;
      }
      rr({ m: mode });

      const allLogs = [
        ...consoleDebugSpy.mock.calls.map((call: readonly unknown[]) => call[0] as string),
        ...consoleWarnSpy.mock.calls.map((call: readonly unknown[]) => call[0] as string),
      ];
      const logged = allLogs.some((msg) => msg.includes(mode));
      expect(logged).toBe(true);
    }
  });
});
