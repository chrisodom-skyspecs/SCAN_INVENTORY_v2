/**
 * @vitest-environment jsdom
 *
 * Tests for useMapCasePins and the normaliseM1Pins helper.
 *
 * AC 350202 Sub-AC 2 — Verify that:
 *   1. normaliseM1Pins correctly maps M1CasePin._id → MapCasePin.caseId.
 *   2. normaliseM1Pins preserves lat, lng, status, and all optional fields.
 *   3. useMapCasePins returns { pins: [], isLoading: true, summary: undefined }
 *      while Convex is fetching (useQuery returns undefined).
 *   4. useMapCasePins returns normalised pins and summary once data arrives.
 *   5. skip=true suspends the subscription and returns empty state immediately.
 *   6. Filter args (bounds, status, assigneeId, missionId) are passed through
 *      to the underlying useQuery call.
 *   7. Pins with undefined lat/lng are preserved (no silent drop).
 *   8. Status is typed correctly for all five CaseStatus values.
 *
 * Mocking strategy
 * ────────────────
 * We mock `convex/react` so `useQuery` is a vi.fn() we can control.
 * We mock the generated `api` so the query reference is a stable symbol.
 * The tests never hit a real Convex backend.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { normaliseM1Pins, useMapCasePins } from "../use-map-case-pins";
import type {
  MapCasePin,
  UseMapCasePinsArgs,
} from "../use-map-case-pins";
import type { M1Response } from "../../../convex/maps";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// MOCK_QUERY_REF must be created via vi.hoisted so it is available when
// vi.mock factories are executed (which are hoisted above all imports).
const { MOCK_QUERY_REF } = vi.hoisted(() => ({
  MOCK_QUERY_REF: Symbol("getM1MapData"),
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    mapData: {
      getM1MapData: MOCK_QUERY_REF,
    },
  },
}));

const mockUseQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Build a minimal M1Response fixture for testing. */
function makeM1Response(
  cases: M1Response["cases"],
  overrides: Partial<M1Response["summary"]> = {}
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
      total: cases.length,
      withLocation: cases.filter((c) => c.lat !== undefined).length,
      byStatus,
      ...overrides,
    },
  };
}

/** Build a raw M1CasePin fixture. */
function makeCasePin(
  id: string,
  overrides: Partial<M1Response["cases"][number]> = {}
): M1Response["cases"][number] {
  return {
    _id: id,
    label: `CASE-${id}`,
    status: "assembled",
    lat: 42.36,
    lng: -71.06,
    locationName: "Boston Warehouse",
    assigneeName: "Alice",
    missionId: undefined,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ─── normaliseM1Pins unit tests ───────────────────────────────────────────────

describe("normaliseM1Pins", () => {
  it("maps _id to caseId", () => {
    const raw = [makeCasePin("abc123")];
    const pins = normaliseM1Pins(raw);
    expect(pins[0].caseId).toBe("abc123");
    // _id must not appear on the normalised shape (double-cast through unknown
    // to safely inspect a property that TypeScript knows doesn't exist)
    expect((pins[0] as unknown as Record<string, unknown>)["_id"]).toBeUndefined();
  });

  it("preserves lat and lng", () => {
    const raw = [makeCasePin("p1", { lat: 51.5074, lng: -0.1278 })];
    const [pin] = normaliseM1Pins(raw);
    expect(pin.lat).toBe(51.5074);
    expect(pin.lng).toBe(-0.1278);
  });

  it("preserves status for all CaseStatus values", () => {
    const statuses = [
      "hangar",
      "assembled",
      "transit_out",
      "deployed",
      "flagged",
      "transit_in",
      "received",
      "archived",
    ] as const;

    for (const status of statuses) {
      const raw = [makeCasePin("x", { status })];
      const [pin] = normaliseM1Pins(raw);
      expect(pin.status).toBe(status);
    }
  });

  it("preserves label", () => {
    const raw = [makeCasePin("p2", { label: "CASE-0042" })];
    expect(normaliseM1Pins(raw)[0].label).toBe("CASE-0042");
  });

  it("preserves optional fields: locationName, assigneeName, missionId", () => {
    const raw = [
      makeCasePin("p3", {
        locationName: "Denver Site",
        assigneeName: "Bob",
        missionId: "mission_99",
      }),
    ];
    const [pin] = normaliseM1Pins(raw);
    expect(pin.locationName).toBe("Denver Site");
    expect(pin.assigneeName).toBe("Bob");
    expect(pin.missionId).toBe("mission_99");
  });

  it("preserves undefined lat/lng (no silent drop for unlocated cases)", () => {
    const raw = [makeCasePin("p4", { lat: undefined, lng: undefined })];
    const [pin] = normaliseM1Pins(raw);
    expect(pin.lat).toBeUndefined();
    expect(pin.lng).toBeUndefined();
  });

  it("preserves updatedAt", () => {
    const ts = 1_710_000_000_000;
    const raw = [makeCasePin("p5", { updatedAt: ts })];
    expect(normaliseM1Pins(raw)[0].updatedAt).toBe(ts);
  });

  it("returns empty array for empty input", () => {
    expect(normaliseM1Pins([])).toEqual([]);
  });

  it("normalises multiple pins in order", () => {
    const raw = [makeCasePin("a"), makeCasePin("b"), makeCasePin("c")];
    const pins = normaliseM1Pins(raw);
    expect(pins.map((p: MapCasePin) => p.caseId)).toEqual(["a", "b", "c"]);
  });
});

// ─── useMapCasePins hook tests ────────────────────────────────────────────────

describe("useMapCasePins", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
  });

  // ── Loading state ────────────────────────────────────────────────────────

  it("returns isLoading=true and empty pins while Convex fetches (undefined)", () => {
    mockUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useMapCasePins());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.pins).toEqual([]);
    expect(result.current.summary).toBeUndefined();
  });

  // ── Data returned ────────────────────────────────────────────────────────

  it("returns normalised pins and summary when data is available", () => {
    const casePins = [
      makeCasePin("id1", { status: "deployed", lat: 40.0, lng: -75.0 }),
      makeCasePin("id2", { status: "flagged",  lat: 41.0, lng: -76.0 }),
    ];
    mockUseQuery.mockReturnValue(makeM1Response(casePins));

    const { result } = renderHook(() => useMapCasePins());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.pins).toHaveLength(2);
    expect(result.current.pins[0].caseId).toBe("id1");
    expect(result.current.pins[0].status).toBe("deployed");
    expect(result.current.pins[1].caseId).toBe("id2");
    expect(result.current.summary?.total).toBe(2);
    expect(result.current.summary?.byStatus["deployed"]).toBe(1);
    expect(result.current.summary?.byStatus["flagged"]).toBe(1);
  });

  it("returns isLoading=false and empty pins when data is an empty fleet", () => {
    mockUseQuery.mockReturnValue(makeM1Response([]));

    const { result } = renderHook(() => useMapCasePins());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.pins).toEqual([]);
    expect(result.current.summary?.total).toBe(0);
  });

  // ── Skip semantics ───────────────────────────────────────────────────────

  it("returns empty state immediately when skip=true without calling useQuery with real args", () => {
    // useQuery will be called with "skip" sentinel, not real args
    mockUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useMapCasePins({ skip: true }));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.pins).toEqual([]);
    expect(result.current.summary).toBeUndefined();

    // Verify the "skip" sentinel was passed
    expect(mockUseQuery).toHaveBeenCalledWith(MOCK_QUERY_REF, "skip");
  });

  it("activates subscription when skip changes from true to false", () => {
    let skipFlag = true;
    mockUseQuery.mockReturnValue(undefined);

    const { result, rerender } = renderHook(
      (args: UseMapCasePinsArgs) => useMapCasePins(args),
      { initialProps: { skip: true } }
    );
    expect(result.current.isLoading).toBe(false);

    // Flip skip → false; useQuery now gets real args and returns undefined (loading)
    skipFlag = false;
    rerender({ skip: skipFlag });
    expect(result.current.isLoading).toBe(true);
  });

  // ── Query args forwarding ────────────────────────────────────────────────

  it("forwards bounds to useQuery as flat swLat/swLng/neLat/neLng fields", () => {
    mockUseQuery.mockReturnValue(undefined);
    const bounds = { swLat: 40.0, swLng: -74.0, neLat: 41.0, neLng: -73.0 };

    renderHook(() => useMapCasePins({ bounds }));

    expect(mockUseQuery).toHaveBeenCalledWith(
      MOCK_QUERY_REF,
      expect.objectContaining({
        swLat: 40.0,
        swLng: -74.0,
        neLat: 41.0,
        neLng: -73.0,
      })
    );
  });

  it("forwards status filter to useQuery", () => {
    mockUseQuery.mockReturnValue(undefined);

    renderHook(() => useMapCasePins({ status: ["deployed", "flagged"] }));

    expect(mockUseQuery).toHaveBeenCalledWith(
      MOCK_QUERY_REF,
      expect.objectContaining({ status: ["deployed", "flagged"] })
    );
  });

  it("forwards assigneeId to useQuery", () => {
    mockUseQuery.mockReturnValue(undefined);

    renderHook(() => useMapCasePins({ assigneeId: "user_abc" }));

    expect(mockUseQuery).toHaveBeenCalledWith(
      MOCK_QUERY_REF,
      expect.objectContaining({ assigneeId: "user_abc" })
    );
  });

  it("forwards missionId to useQuery", () => {
    mockUseQuery.mockReturnValue(undefined);

    renderHook(() => useMapCasePins({ missionId: "mission_xyz" }));

    expect(mockUseQuery).toHaveBeenCalledWith(
      MOCK_QUERY_REF,
      expect.objectContaining({ missionId: "mission_xyz" })
    );
  });

  it("omits null assigneeId from query args (no undefined/null keys sent to Convex)", () => {
    mockUseQuery.mockReturnValue(undefined);

    renderHook(() => useMapCasePins({ assigneeId: null }));

    const [, calledArgs] = mockUseQuery.mock.calls[0];
    expect(calledArgs).not.toHaveProperty("assigneeId");
  });

  it("omits null missionId from query args", () => {
    mockUseQuery.mockReturnValue(undefined);

    renderHook(() => useMapCasePins({ missionId: null }));

    const [, calledArgs] = mockUseQuery.mock.calls[0];
    expect(calledArgs).not.toHaveProperty("missionId");
  });

  it("omits null bounds from query args", () => {
    mockUseQuery.mockReturnValue(undefined);

    renderHook(() => useMapCasePins({ bounds: null }));

    const [, calledArgs] = mockUseQuery.mock.calls[0];
    expect(calledArgs).not.toHaveProperty("swLat");
    expect(calledArgs).not.toHaveProperty("swLng");
    expect(calledArgs).not.toHaveProperty("neLat");
    expect(calledArgs).not.toHaveProperty("neLng");
  });

  it("omits empty status array from query args", () => {
    mockUseQuery.mockReturnValue(undefined);

    renderHook(() => useMapCasePins({ status: [] }));

    const [, calledArgs] = mockUseQuery.mock.calls[0];
    expect(calledArgs).not.toHaveProperty("status");
  });

  it("passes empty object when no args provided (global fleet view)", () => {
    mockUseQuery.mockReturnValue(undefined);

    renderHook(() => useMapCasePins());

    expect(mockUseQuery).toHaveBeenCalledWith(MOCK_QUERY_REF, {});
  });

  // ── Summary correctness ──────────────────────────────────────────────────

  it("exposes summary.withLocation count correctly", () => {
    const casePins = [
      makeCasePin("c1", { lat: 1.0, lng: 1.0 }),
      makeCasePin("c2", { lat: undefined, lng: undefined }),
    ];
    mockUseQuery.mockReturnValue(makeM1Response(casePins));

    const { result } = renderHook(() => useMapCasePins());

    expect(result.current.summary?.withLocation).toBe(1);
  });

  it("exposes summary.byStatus breakdown", () => {
    const casePins = [
      makeCasePin("s1", { status: "assembled" }),
      makeCasePin("s2", { status: "assembled" }),
      makeCasePin("s3", { status: "transit_out" }),
    ];
    mockUseQuery.mockReturnValue(makeM1Response(casePins));

    const { result } = renderHook(() => useMapCasePins());

    expect(result.current.summary?.byStatus["assembled"]).toBe(2);
    expect(result.current.summary?.byStatus["transit_out"]).toBe(1);
  });

  // ── All combined args ────────────────────────────────────────────────────

  it("passes all filter args together to useQuery", () => {
    mockUseQuery.mockReturnValue(undefined);

    renderHook(() =>
      useMapCasePins({
        bounds: { swLat: 30, swLng: -100, neLat: 50, neLng: -80 },
        status: ["deployed"],
        assigneeId: "tech_01",
        missionId: "mission_01",
      })
    );

    expect(mockUseQuery).toHaveBeenCalledWith(
      MOCK_QUERY_REF,
      expect.objectContaining({
        swLat: 30,
        swLng: -100,
        neLat: 50,
        neLng: -80,
        status: ["deployed"],
        assigneeId: "tech_01",
        missionId: "mission_01",
      })
    );
  });
});
