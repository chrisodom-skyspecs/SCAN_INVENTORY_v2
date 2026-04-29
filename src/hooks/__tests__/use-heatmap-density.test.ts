/**
 * @vitest-environment jsdom
 *
 * use-heatmap-density.test.ts
 *
 * Unit tests for the useHeatmapDensity hook.
 *
 * Testing strategy
 * ────────────────
 * • Convex's useQuery is mocked so tests run without a Convex backend.
 * • Tests verify the GeoJSON conversion logic by simulating different
 *   response shapes from the mock (pins mode, grid mode, null/loading).
 * • The skip semantics are tested by verifying no subscription is attempted
 *   when skip=true.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHeatmapDensity } from "../use-heatmap-density";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Hoist the query symbol so it is available when vi.mock factories execute
// (vi.mock factories are hoisted above all imports).
const { MOCK_HEATMAP_QUERY_REF } = vi.hoisted(() => ({
  MOCK_HEATMAP_QUERY_REF: Symbol("getHeatmapPins"),
}));

const mockUseQuery = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    heatmapData: {
      getHeatmapPins: MOCK_HEATMAP_QUERY_REF,
    },
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePinsResponse(pins: Array<{ caseId: string; lat: number; lng: number; status: string; weight: number }>) {
  return {
    mode:         "pins" as const,
    pins:         pins.map((p) => ({ ...p, updatedAt: Date.now() })),
    totalWeight:  pins.reduce((s, p) => s + p.weight, 0),
    flaggedCount: pins.filter((p) => p.weight === 3).length,
    normalCount:  pins.filter((p) => p.weight === 1).length,
  };
}

function makeGridResponse(cells: Array<{ cellId: string; lat: number; lng: number; count: number; weight: number }>) {
  return {
    mode:        "grid" as const,
    cells,
    totalWeight: cells.reduce((s, c) => s + c.weight, 0),
    totalCases:  cells.reduce((s, c) => s + c.count, 0),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useHeatmapDensity", () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
  });

  // ── 1. Skip mode returns empty data without calling Convex ─────────────────

  it("returns empty GeoJSON when skip=true without a real Convex call", () => {
    // Even if useQuery somehow returns data, it should be ignored in skip mode
    mockUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useHeatmapDensity({ skip: true }));

    expect(result.current.geojsonData).toEqual({
      type: "FeatureCollection",
      features: [],
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.pointCount).toBe(0);
    expect(result.current.totalWeight).toBe(0);
    expect(result.current.flaggedCount).toBeUndefined();
  });

  // ── 2. Loading state when result is undefined ───────────────────────────────

  it("returns isLoading=true when Convex returns undefined", () => {
    mockUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useHeatmapDensity({ skip: false }));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.geojsonData).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });

  // ── 3. Pin mode — converts response to GeoJSON ─────────────────────────────

  it("converts a pins response to GeoJSON FeatureCollection", () => {
    const response = makePinsResponse([
      { caseId: "c1", lat: 40.7, lng: -74.0, status: "deployed", weight: 1 },
      { caseId: "c2", lat: 34.0, lng: -118.2, status: "flagged",  weight: 3 },
    ]);
    mockUseQuery.mockReturnValue(response);

    const { result } = renderHook(() => useHeatmapDensity({ skip: false }));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.pointCount).toBe(2);
    expect(result.current.totalWeight).toBe(4); // 1 + 3

    // GeoJSON structure
    const { geojsonData } = result.current;
    expect(geojsonData.type).toBe("FeatureCollection");
    expect(geojsonData.features).toHaveLength(2);

    // Feature c1 (deployed, weight 1)
    const f1 = geojsonData.features[0];
    expect(f1.properties.caseId).toBe("c1");
    expect(f1.properties.weight).toBe(1);
    expect(f1.geometry.coordinates).toEqual([-74.0, 40.7]); // [lng, lat]

    // Feature c2 (flagged, weight 3)
    const f2 = geojsonData.features[1];
    expect(f2.properties.caseId).toBe("c2");
    expect(f2.properties.weight).toBe(3);
    expect(f2.geometry.coordinates).toEqual([-118.2, 34.0]);

    // Flagged count
    expect(result.current.flaggedCount).toBe(1);
  });

  // ── 4. Grid mode — converts response to GeoJSON ────────────────────────────

  it("converts a grid response to GeoJSON FeatureCollection", () => {
    const response = makeGridResponse([
      { cellId: "40.0:-74.0", lat: 40.25, lng: -73.75, count: 5, weight: 7 },
      { cellId: "34.0:-118.0", lat: 34.25, lng: -117.75, count: 3, weight: 4 },
    ]);
    mockUseQuery.mockReturnValue(response);

    const { result } = renderHook(() => useHeatmapDensity({ aggregate: true }));

    expect(result.current.pointCount).toBe(2); // one feature per cell
    expect(result.current.totalWeight).toBe(11); // 7 + 4

    const { geojsonData } = result.current;
    expect(geojsonData.features).toHaveLength(2);

    // Cell centroid coordinates [lng, lat]
    const f1 = geojsonData.features[0];
    expect(f1.properties.caseId).toBe("40.0:-74.0");
    expect(f1.properties.weight).toBe(7);
    expect(f1.geometry.coordinates).toEqual([-73.75, 40.25]);

    // flaggedCount is undefined in grid mode
    expect(result.current.flaggedCount).toBeUndefined();
  });

  // ── 5. Empty pins response ─────────────────────────────────────────────────

  it("returns empty GeoJSON when pins response has no pins", () => {
    const response = makePinsResponse([]);
    mockUseQuery.mockReturnValue(response);

    const { result } = renderHook(() => useHeatmapDensity());

    expect(result.current.pointCount).toBe(0);
    expect(result.current.totalWeight).toBe(0);
    expect(result.current.geojsonData.features).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
  });

  // ── 6. GeoJSON reference stability when result doesn't change ──────────────

  it("returns same geojsonData reference when result is unchanged", () => {
    const response = makePinsResponse([
      { caseId: "c1", lat: 40.7, lng: -74.0, status: "deployed", weight: 1 },
    ]);
    mockUseQuery.mockReturnValue(response);

    const { result, rerender } = renderHook(() => useHeatmapDensity());
    const first = result.current.geojsonData;

    rerender();

    // Same Convex response → same memoised GeoJSON reference
    expect(result.current.geojsonData).toBe(first);
  });

  // ── 7. MissionId filter is passed to Convex ────────────────────────────────

  it("passes missionId filter to the Convex query args", () => {
    mockUseQuery.mockReturnValue(undefined);

    renderHook(() => useHeatmapDensity({ missionId: "mission-123", skip: false }));

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.anything(), // api reference
      expect.objectContaining({ missionId: "mission-123" })
    );
  });

  // ── 8. Skip sentinel is passed to Convex when skip=true ───────────────────

  it("passes 'skip' sentinel to Convex query when skip=true", () => {
    mockUseQuery.mockReturnValue(undefined);

    renderHook(() => useHeatmapDensity({ skip: true }));

    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.anything(),
      "skip"
    );
  });
});
