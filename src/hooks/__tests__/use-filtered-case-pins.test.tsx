/**
 * @vitest-environment jsdom
 *
 * Unit tests for useFilteredCasePins (AC 90203 Sub-AC 3).
 *
 * Tests the bridge between the LayerEngine state and map pin rendering:
 *   1. deriveLayerToggles — correct LayerToggles extraction from engine booleans
 *   2. enrichPinsWithLayerKey — correct layerKey assignment for all statuses
 *   3. applyLayerFilter — filtering enriched pins by toggle state
 *   4. useFilteredCasePins hook — integration: all layers on, all off, mixed
 *
 * Mocking strategy
 * ────────────────
 * • `convex/react` → useQuery is a vi.fn() returning controlled data.
 * • `convex/_generated/api` → stable symbol for the query ref.
 * • `@/providers/layer-engine-provider` → useSharedLayerEngine returns
 *   a controlled LayerEngineState.
 *
 * The hook is tested via renderHook from @testing-library/react.  No real
 * Convex backend or LayerEngine context is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  deriveLayerToggles,
  enrichPinsWithLayerKey,
  applyLayerFilter,
  useFilteredCasePins,
  type FilteredCasePin,
} from "../use-filtered-case-pins";
import type { MapCasePin } from "../use-map-case-pins";
import type { CaseStatus } from "@/types/case-status";
import { CASE_STATUSES } from "@/types/case-status";
import type { LayerToggles } from "@/types/map";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Hoist mock symbols before factories run
const { MOCK_QUERY_REF, mockLayerState } = vi.hoisted(() => ({
  MOCK_QUERY_REF: Symbol("getM1MapData"),
  mockLayerState: {
    deployed: true,
    transit: true,
    flagged: true,
    hangar: true,
    heat: false,
    history: false,
    turbines: true,
  },
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: { mapData: { getM1MapData: MOCK_QUERY_REF } },
}));

const mockUseQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

// Control the layer engine state via this mutable object
let _mockEngineState = { ...mockLayerState };

vi.mock("@/providers/layer-engine-provider", () => ({
  useSharedLayerEngine: () => ({
    state: _mockEngineState,
    toggle: vi.fn(),
    setVisible: vi.fn(),
    setPartial: vi.fn(),
    activateAll: vi.fn(),
    deactivateAll: vi.fn(),
    reset: vi.fn(),
    isVisible: vi.fn(),
    registry: [],
    engine: {},
  }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePin(status: CaseStatus, id?: string): MapCasePin {
  const caseId = id ?? status;
  return {
    caseId,
    label: `CASE-${caseId}`,
    status,
    lat: 40.0,
    lng: -74.0,
    locationName: "Test Site",
    assigneeName: "Tech One",
    missionId: undefined,
    updatedAt: 1_700_000_000_000,
  };
}

/** Build a minimal M1Response fixture. */
function makeM1Response(cases: MapCasePin[]) {
  const byStatus: Record<string, number> = {};
  for (const c of cases) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  }
  return {
    mode: "M1",
    ts: 1_700_000_000_000,
    cases: cases.map((c) => ({
      _id: c.caseId,
      label: c.label,
      status: c.status,
      lat: c.lat,
      lng: c.lng,
      locationName: c.locationName,
      assigneeName: c.assigneeName,
      missionId: c.missionId,
      updatedAt: c.updatedAt,
    })),
    summary: {
      total: cases.length,
      withLocation: cases.filter((c) => c.lat !== undefined).length,
      byStatus,
    },
  };
}

const ALL_ON: LayerToggles = { deployed: true, transit: true, flagged: true, hangar: true };
const ALL_OFF: LayerToggles = { deployed: false, transit: false, flagged: false, hangar: false };

// ─── deriveLayerToggles ───────────────────────────────────────────────────────

describe("deriveLayerToggles", () => {
  it("derives all-on LayerToggles from all-true booleans", () => {
    expect(deriveLayerToggles(true, true, true, true)).toEqual(ALL_ON);
  });

  it("derives all-off LayerToggles from all-false booleans", () => {
    expect(deriveLayerToggles(false, false, false, false)).toEqual(ALL_OFF);
  });

  it("maps positional args correctly (deployed, transit, flagged, hangar)", () => {
    const result = deriveLayerToggles(true, false, true, false);
    expect(result.deployed).toBe(true);
    expect(result.transit).toBe(false);
    expect(result.flagged).toBe(true);
    expect(result.hangar).toBe(false);
  });

  it("does NOT include heat, history, or turbines keys", () => {
    const result = deriveLayerToggles(true, true, true, true);
    expect(Object.keys(result)).toHaveLength(4);
    expect(result).not.toHaveProperty("heat");
    expect(result).not.toHaveProperty("history");
    expect(result).not.toHaveProperty("turbines");
  });
});

// ─── enrichPinsWithLayerKey ───────────────────────────────────────────────────

describe("enrichPinsWithLayerKey", () => {
  it("sets layerKey='deployed' for status='deployed'", () => {
    const [pin] = enrichPinsWithLayerKey([makePin("deployed")]);
    expect(pin.layerKey).toBe("deployed");
  });

  it("sets layerKey='transit' for status='transit_out'", () => {
    const [pin] = enrichPinsWithLayerKey([makePin("transit_out")]);
    expect(pin.layerKey).toBe("transit");
  });

  it("sets layerKey='transit' for status='transit_in'", () => {
    const [pin] = enrichPinsWithLayerKey([makePin("transit_in")]);
    expect(pin.layerKey).toBe("transit");
  });

  it("sets layerKey='flagged' for status='flagged'", () => {
    const [pin] = enrichPinsWithLayerKey([makePin("flagged")]);
    expect(pin.layerKey).toBe("flagged");
  });

  it("sets layerKey='hangar' for status='hangar'", () => {
    const [pin] = enrichPinsWithLayerKey([makePin("hangar")]);
    expect(pin.layerKey).toBe("hangar");
  });

  it("sets layerKey='hangar' for status='assembled'", () => {
    const [pin] = enrichPinsWithLayerKey([makePin("assembled")]);
    expect(pin.layerKey).toBe("hangar");
  });

  it("sets layerKey='hangar' for status='received'", () => {
    const [pin] = enrichPinsWithLayerKey([makePin("received")]);
    expect(pin.layerKey).toBe("hangar");
  });

  it("sets layerKey='hangar' for status='archived'", () => {
    const [pin] = enrichPinsWithLayerKey([makePin("archived")]);
    expect(pin.layerKey).toBe("hangar");
  });

  it("covers all 8 CaseStatus values with a non-null layerKey", () => {
    const pins = CASE_STATUSES.map((s) => makePin(s as CaseStatus));
    const enriched = enrichPinsWithLayerKey(pins);
    for (const pin of enriched) {
      expect(pin.layerKey).not.toBeNull();
    }
  });

  it("preserves all original pin fields (caseId, label, lat, lng, etc.)", () => {
    const original = makePin("deployed", "case-123");
    const [enriched] = enrichPinsWithLayerKey([original]);
    expect(enriched.caseId).toBe("case-123");
    expect(enriched.label).toBe("CASE-case-123");
    expect(enriched.lat).toBe(40.0);
    expect(enriched.lng).toBe(-74.0);
    expect(enriched.locationName).toBe("Test Site");
    expect(enriched.assigneeName).toBe("Tech One");
    expect(enriched.updatedAt).toBe(1_700_000_000_000);
  });

  it("sets layerKey=null for unknown status", () => {
    const badPin = { ...makePin("deployed"), status: "ghost_status" as CaseStatus };
    const [enriched] = enrichPinsWithLayerKey([badPin]);
    expect(enriched.layerKey).toBeNull();
  });

  it("returns empty array for empty input", () => {
    expect(enrichPinsWithLayerKey([])).toEqual([]);
  });

  it("preserves the order of the input array", () => {
    const input = ["deployed", "flagged", "transit_out", "hangar"].map(
      (s) => makePin(s as CaseStatus)
    );
    const enriched = enrichPinsWithLayerKey(input);
    expect(enriched.map((p) => p.status)).toEqual([
      "deployed", "flagged", "transit_out", "hangar",
    ]);
  });
});

// ─── applyLayerFilter ─────────────────────────────────────────────────────────

describe("applyLayerFilter", () => {
  const FULL_FLEET: FilteredCasePin[] = enrichPinsWithLayerKey(
    CASE_STATUSES.map((s) => makePin(s as CaseStatus))
  );

  it("returns all pins when all toggles are on", () => {
    const result = applyLayerFilter(FULL_FLEET, ALL_ON);
    expect(result).toHaveLength(8);
  });

  it("returns empty array when all toggles are off", () => {
    const result = applyLayerFilter(FULL_FLEET, ALL_OFF);
    expect(result).toHaveLength(0);
  });

  it("returns only deployed pins when only deployed toggle is on", () => {
    const result = applyLayerFilter(FULL_FLEET, { ...ALL_OFF, deployed: true });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("deployed");
  });

  it("returns transit_out and transit_in when only transit toggle is on", () => {
    const result = applyLayerFilter(FULL_FLEET, { ...ALL_OFF, transit: true });
    expect(result).toHaveLength(2);
    const statuses = result.map((p) => p.status);
    expect(statuses).toContain("transit_out");
    expect(statuses).toContain("transit_in");
  });

  it("returns only flagged pin when only flagged toggle is on", () => {
    const result = applyLayerFilter(FULL_FLEET, { ...ALL_OFF, flagged: true });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("flagged");
  });

  it("returns hangar-bucket pins when only hangar toggle is on", () => {
    const result = applyLayerFilter(FULL_FLEET, { ...ALL_OFF, hangar: true });
    expect(result).toHaveLength(4);
    const statuses = result.map((p) => p.status);
    expect(statuses).toContain("hangar");
    expect(statuses).toContain("assembled");
    expect(statuses).toContain("received");
    expect(statuses).toContain("archived");
  });

  it("excludes pins with layerKey=null regardless of toggle state", () => {
    const badPin: FilteredCasePin = {
      ...makePin("deployed"),
      status: "ghost_status" as CaseStatus,
      layerKey: null,
    };
    const result = applyLayerFilter([badPin], ALL_ON);
    expect(result).toHaveLength(0);
  });

  it("does not mutate the input array", () => {
    const original = [...FULL_FLEET];
    applyLayerFilter(FULL_FLEET, { ...ALL_OFF, deployed: true });
    expect(FULL_FLEET).toEqual(original);
  });

  it("preserves the relative order of pins after filtering", () => {
    const pins = enrichPinsWithLayerKey([
      makePin("deployed", "first"),
      makePin("flagged",  "second"),
      makePin("deployed", "third"),
    ]);
    const result = applyLayerFilter(pins, { ...ALL_OFF, deployed: true });
    expect(result.map((p) => p.caseId)).toEqual(["first", "third"]);
  });
});

// ─── useFilteredCasePins — hook integration ────────────────────────────────────

describe("useFilteredCasePins — hook integration", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
    _mockEngineState = { ...mockLayerState }; // all-on defaults
  });

  // ── Loading state ────────────────────────────────────────────────────────

  it("returns isLoading=true and empty arrays while Convex fetches", () => {
    mockUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useFilteredCasePins());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.pins).toEqual([]);
    expect(result.current.allPins).toEqual([]);
    expect(result.current.summary).toBeUndefined();
    expect(result.current.hiddenCount).toBe(0);
  });

  // ── All layers on — passthrough ──────────────────────────────────────────

  it("returns all pins when all 4 case-layer toggles are on", () => {
    // Engine: all-on (default mockLayerState)
    const cases = CASE_STATUSES.map((s) => makePin(s as CaseStatus));
    mockUseQuery.mockReturnValue(makeM1Response(cases));

    const { result } = renderHook(() => useFilteredCasePins());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.pins).toHaveLength(8);
    expect(result.current.allPins).toHaveLength(8);
    expect(result.current.hiddenCount).toBe(0);
  });

  // ── All layers off — no pins ─────────────────────────────────────────────

  it("returns no pins when all 4 case-layer toggles are off", () => {
    _mockEngineState = {
      ...mockLayerState,
      deployed: false,
      transit: false,
      flagged: false,
      hangar: false,
    };
    const cases = CASE_STATUSES.map((s) => makePin(s as CaseStatus));
    mockUseQuery.mockReturnValue(makeM1Response(cases));

    const { result } = renderHook(() => useFilteredCasePins());
    expect(result.current.pins).toHaveLength(0);
    expect(result.current.allPins).toHaveLength(8);
    expect(result.current.hiddenCount).toBe(8);
  });

  // ── Only deployed layer on ──────────────────────────────────────────────

  it("returns only deployed pins when only deployed layer is on", () => {
    _mockEngineState = {
      ...mockLayerState,
      deployed: true,
      transit: false,
      flagged: false,
      hangar: false,
    };
    const cases = CASE_STATUSES.map((s) => makePin(s as CaseStatus));
    mockUseQuery.mockReturnValue(makeM1Response(cases));

    const { result } = renderHook(() => useFilteredCasePins());
    expect(result.current.pins).toHaveLength(1);
    expect(result.current.pins[0].status).toBe("deployed");
    expect(result.current.pins[0].layerKey).toBe("deployed");
    expect(result.current.hiddenCount).toBe(7);
  });

  // ── Only transit layer on ────────────────────────────────────────────────

  it("returns only transit_out and transit_in when only transit layer is on", () => {
    _mockEngineState = {
      ...mockLayerState,
      deployed: false,
      transit: true,
      flagged: false,
      hangar: false,
    };
    const cases = CASE_STATUSES.map((s) => makePin(s as CaseStatus));
    mockUseQuery.mockReturnValue(makeM1Response(cases));

    const { result } = renderHook(() => useFilteredCasePins());
    expect(result.current.pins).toHaveLength(2);
    const statuses = result.current.pins.map((p) => p.status);
    expect(statuses).toContain("transit_out");
    expect(statuses).toContain("transit_in");
    // Verify layerKey assignment
    for (const pin of result.current.pins) {
      expect(pin.layerKey).toBe("transit");
    }
    expect(result.current.hiddenCount).toBe(6);
  });

  // ── Only flagged layer on ────────────────────────────────────────────────

  it("returns only flagged pin when only flagged layer is on", () => {
    _mockEngineState = {
      ...mockLayerState,
      deployed: false,
      transit: false,
      flagged: true,
      hangar: false,
    };
    const cases = CASE_STATUSES.map((s) => makePin(s as CaseStatus));
    mockUseQuery.mockReturnValue(makeM1Response(cases));

    const { result } = renderHook(() => useFilteredCasePins());
    expect(result.current.pins).toHaveLength(1);
    expect(result.current.pins[0].status).toBe("flagged");
    expect(result.current.pins[0].layerKey).toBe("flagged");
  });

  // ── Only hangar layer on ─────────────────────────────────────────────────

  it("returns all hangar-bucket statuses when only hangar layer is on", () => {
    _mockEngineState = {
      ...mockLayerState,
      deployed: false,
      transit: false,
      flagged: false,
      hangar: true,
    };
    const cases = CASE_STATUSES.map((s) => makePin(s as CaseStatus));
    mockUseQuery.mockReturnValue(makeM1Response(cases));

    const { result } = renderHook(() => useFilteredCasePins());
    expect(result.current.pins).toHaveLength(4);
    const statuses = result.current.pins.map((p) => p.status);
    expect(statuses).toContain("hangar");
    expect(statuses).toContain("assembled");
    expect(statuses).toContain("received");
    expect(statuses).toContain("archived");
    for (const pin of result.current.pins) {
      expect(pin.layerKey).toBe("hangar");
    }
  });

  // ── heat/history/turbines do NOT affect case pin filtering ────────────────

  it("does not filter case pins when heat, history, or turbines are toggled", () => {
    // Turn off heat/history/turbines but keep all case layers on
    _mockEngineState = {
      deployed: true,
      transit: true,
      flagged: true,
      hangar: true,
      heat: false,      // off — should NOT affect case pins
      history: false,   // off — should NOT affect case pins
      turbines: false,  // off — should NOT affect case pins
    };
    const cases = CASE_STATUSES.map((s) => makePin(s as CaseStatus));
    mockUseQuery.mockReturnValue(makeM1Response(cases));

    const { result } = renderHook(() => useFilteredCasePins());
    // All 8 case pins should still be visible
    expect(result.current.pins).toHaveLength(8);
    expect(result.current.hiddenCount).toBe(0);
  });

  // ── layerToggles return value ────────────────────────────────────────────

  it("exposes layerToggles derived from the engine state", () => {
    _mockEngineState = {
      ...mockLayerState,
      deployed: true,
      transit: false,
      flagged: true,
      hangar: false,
    };
    mockUseQuery.mockReturnValue(makeM1Response([]));

    const { result } = renderHook(() => useFilteredCasePins());
    expect(result.current.layerToggles).toEqual({
      deployed: true,
      transit: false,
      flagged: true,
      hangar: false,
    });
  });

  // ── skip semantics ───────────────────────────────────────────────────────

  it("returns empty state when skip=true", () => {
    mockUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useFilteredCasePins({ skip: true }));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.pins).toEqual([]);
    expect(result.current.allPins).toEqual([]);
    expect(result.current.summary).toBeUndefined();
    expect(result.current.hiddenCount).toBe(0);
  });

  // ── hiddenCount is correct ───────────────────────────────────────────────

  it("computes hiddenCount as allPins.length − pins.length", () => {
    // 5 deployed, 3 transit cases; transit layer off → 3 hidden
    const cases = [
      makePin("deployed", "d1"),
      makePin("deployed", "d2"),
      makePin("deployed", "d3"),
      makePin("deployed", "d4"),
      makePin("deployed", "d5"),
      makePin("transit_out", "t1"),
      makePin("transit_in", "t2"),
      makePin("transit_in", "t3"),
    ];
    _mockEngineState = {
      ...mockLayerState,
      deployed: true,
      transit: false,
      flagged: false,
      hangar: false,
    };
    mockUseQuery.mockReturnValue(makeM1Response(cases));

    const { result } = renderHook(() => useFilteredCasePins());
    expect(result.current.allPins).toHaveLength(8);
    expect(result.current.pins).toHaveLength(5);
    expect(result.current.hiddenCount).toBe(3);
  });

  // ── summary is from the full fleet (not filtered) ────────────────────────

  it("exposes summary from the full Convex response regardless of layer filter", () => {
    _mockEngineState = {
      ...mockLayerState,
      deployed: true,
      transit: false,  // transit is off
      flagged: false,
      hangar: false,
    };
    const cases = CASE_STATUSES.map((s) => makePin(s as CaseStatus));
    mockUseQuery.mockReturnValue(makeM1Response(cases));

    const { result } = renderHook(() => useFilteredCasePins());
    // summary.total should be 8 (all cases), even though only 1 is visible
    expect(result.current.summary?.total).toBe(8);
    expect(result.current.pins).toHaveLength(1); // only deployed visible
  });

  // ── missionId filter forwarded to useMapCasePins ─────────────────────────

  it("forwards missionId to the underlying useMapCasePins call", () => {
    mockUseQuery.mockReturnValue(undefined);

    renderHook(() => useFilteredCasePins({ missionId: "mission_xyz" }));

    expect(mockUseQuery).toHaveBeenCalledWith(
      MOCK_QUERY_REF,
      expect.objectContaining({ missionId: "mission_xyz" })
    );
  });

  // ── allPins and pins are separate references ──────────────────────────────

  it("allPins and pins are different arrays (no shared reference)", () => {
    const cases = [makePin("deployed", "d1"), makePin("transit_out", "t1")];
    mockUseQuery.mockReturnValue(makeM1Response(cases));

    const { result } = renderHook(() => useFilteredCasePins());
    expect(result.current.pins).not.toBe(result.current.allPins);
  });

  // ── Empty fleet ──────────────────────────────────────────────────────────

  it("handles an empty fleet gracefully (no errors, empty arrays)", () => {
    mockUseQuery.mockReturnValue(makeM1Response([]));

    const { result } = renderHook(() => useFilteredCasePins());
    expect(result.current.pins).toEqual([]);
    expect(result.current.allPins).toEqual([]);
    expect(result.current.hiddenCount).toBe(0);
    expect(result.current.summary?.total).toBe(0);
  });
});
