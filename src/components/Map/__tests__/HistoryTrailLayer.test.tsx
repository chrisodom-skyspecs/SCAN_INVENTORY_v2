/**
 * @vitest-environment jsdom
 *
 * HistoryTrailLayer.test.tsx
 *
 * Unit tests for the HistoryTrailLayer component and the buildTrailGeoJSON
 * utility function in use-history-trail.ts.
 *
 * Test coverage:
 *   1. Component returns null when history layer is inactive
 *   2. Component renders toggle button when showToggle=true and isActive=false
 *   3. Component renders toggle button when showToggle=true and isActive=true
 *   4. Component renders fallback trail list when fallbackMode=true and isActive=true
 *   5. Fallback shows loading state when isLoading=true
 *   6. Fallback shows empty state when no trails
 *   7. Fallback shows trail items with label + waypoint count
 *   8. Fallback shows "+N more" when trailCount > 10
 *   9. Legend renders when showLegend=true
 *   10. Legend hides when showLegend=false
 *   11. Toggle button dispatches to LayerEngine on click
 *   12. buildTrailGeoJSON — empty array returns stable empty GeoJSONs
 *   13. buildTrailGeoJSON — single waypoint trail produces degenerate LineString
 *   14. buildTrailGeoJSON — multi-waypoint trail produces correct features
 *   15. buildTrailGeoJSON — isFirst/isLast tags on endpoint points
 *
 * Mocking strategy:
 *   • useHistoryTrail is mocked to control activation state and trail data.
 *   • useSharedLayerEngine is mocked for the toggle button test.
 *   • react-map-gl Source + Layer are mocked to a <div> (no GL context needed).
 */

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HistoryTrailLayer } from "../HistoryTrailLayer";
import { buildTrailGeoJSON } from "@/hooks/use-history-trail";
import type {
  UseHistoryTrailResult,
  TrailLinesGeoJSON,
  TrailPointsGeoJSON,
} from "@/hooks/use-history-trail";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock react-map-gl — Source and Layer render as plain divs in tests
vi.mock("react-map-gl", () => ({
  Source: ({ id, children }: { id: string; children?: React.ReactNode }) => (
    <div data-testid={`source-${id}`}>{children}</div>
  ),
  Layer: ({ id }: { id: string }) => (
    <div data-testid={`layer-${id}`} />
  ),
}));

// Mock useHistoryTrail
const mockUseHistoryTrail = vi.fn();
vi.mock("@/hooks/use-history-trail", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/hooks/use-history-trail")>();
  return {
    ...original,
    useHistoryTrail: (args: unknown) => mockUseHistoryTrail(args),
  };
});

// Mock useSharedLayerEngine
const mockToggle = vi.fn();
vi.mock("@/providers/layer-engine-provider", () => ({
  useSharedLayerEngine: () => ({
    state: { history: false },
    toggle: mockToggle,
  }),
}));

// ─── Helper ───────────────────────────────────────────────────────────────────

const EMPTY_LINES: TrailLinesGeoJSON = { type: "FeatureCollection", features: [] };
const EMPTY_POINTS: TrailPointsGeoJSON = { type: "FeatureCollection", features: [] };

function makeResult(overrides: Partial<UseHistoryTrailResult> = {}): UseHistoryTrailResult {
  return {
    isActive:      false,
    linesGeoJSON:  EMPTY_LINES,
    pointsGeoJSON: EMPTY_POINTS,
    isLoading:     false,
    trailCount:    0,
    totalWaypoints: 0,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HistoryTrailLayer", () => {
  beforeEach(() => {
    mockUseHistoryTrail.mockReset();
    mockToggle.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // ── 1. Returns null when inactive and showToggle=false ─────────────────────

  it("returns null when history layer is inactive and showToggle=false", () => {
    mockUseHistoryTrail.mockReturnValue(makeResult({ isActive: false }));

    const { container } = render(
      <HistoryTrailLayer fallbackMode={true} showToggle={false} />
    );

    expect(container.firstChild).toBeNull();
  });

  // ── 2. Toggle button visible when showToggle=true and isActive=false ───────

  it("renders toggle button when showToggle=true and inactive", () => {
    mockUseHistoryTrail.mockReturnValue(makeResult({ isActive: false }));

    render(<HistoryTrailLayer fallbackMode={true} showToggle={true} />);

    const toggle = screen.getByTestId("history-trail-toggle");
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("data-active")).toBeNull();
  });

  // ── 3. Toggle button shows active state when isActive=true ────────────────

  it("renders toggle button with active state when history is on", () => {
    mockUseHistoryTrail.mockReturnValue(
      makeResult({ isActive: true, trailCount: 3 })
    );

    render(<HistoryTrailLayer fallbackMode={true} showToggle={true} />);

    const toggle = screen.getByTestId("history-trail-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("data-active")).toBe("true");
  });

  // ── 4. Fallback renders trail list when active ─────────────────────────────

  it("renders fallback trail list when fallbackMode=true and isActive=true", () => {
    const linesGeoJSON: TrailLinesGeoJSON = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[-83, 42], [-84, 43]] },
          properties: {
            caseId:        "case-001",
            caseLabel:     "CASE-001",
            waypointCount: 2,
            latestScan:    1700000000000,
          },
        },
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[-85, 41]] },
          properties: {
            caseId:        "case-002",
            caseLabel:     "CASE-002",
            waypointCount: 1,
            latestScan:    1699000000000,
          },
        },
      ],
    };

    mockUseHistoryTrail.mockReturnValue(
      makeResult({ isActive: true, linesGeoJSON, trailCount: 2, totalWaypoints: 3 })
    );

    render(<HistoryTrailLayer fallbackMode={true} showLegend={false} />);

    const fallback = screen.getByTestId("history-trail-fallback");
    expect(fallback).toBeTruthy();

    // Trail items visible
    expect(screen.getByText("CASE-001")).toBeTruthy();
    expect(screen.getByText("CASE-002")).toBeTruthy();
    // "2 trails" count in header
    expect(screen.getByText("2 trails")).toBeTruthy();
  });

  // ── 5. Loading state ──────────────────────────────────────────────────────

  it("shows loading text when isLoading=true", () => {
    mockUseHistoryTrail.mockReturnValue(
      makeResult({ isActive: true, isLoading: true })
    );

    render(<HistoryTrailLayer fallbackMode={true} showLegend={false} />);

    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  // ── 6. Empty state ────────────────────────────────────────────────────────

  it("shows empty state message when no trails", () => {
    mockUseHistoryTrail.mockReturnValue(
      makeResult({ isActive: true, trailCount: 0 })
    );

    render(<HistoryTrailLayer fallbackMode={true} showLegend={false} />);

    expect(screen.getByText("No georeferenced scan history available.")).toBeTruthy();
  });

  // ── 7. Trail meta shows scan count ───────────────────────────────────────

  it("shows waypoint count in trail list items", () => {
    const linesGeoJSON: TrailLinesGeoJSON = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[-83, 42], [-84, 43], [-85, 44]] },
          properties: {
            caseId:        "case-001",
            caseLabel:     "CASE-001",
            waypointCount: 3,
            latestScan:    1700000000000,
          },
        },
      ],
    };

    mockUseHistoryTrail.mockReturnValue(
      makeResult({ isActive: true, linesGeoJSON, trailCount: 1, totalWaypoints: 3 })
    );

    render(<HistoryTrailLayer fallbackMode={true} showLegend={false} />);

    expect(screen.getByText(/3 scans/)).toBeTruthy();
  });

  // ── 8. "+N more" trail overflow ───────────────────────────────────────────

  it("shows '+N more' when trailCount exceeds visible items", () => {
    // 11 trails (> 10 visible limit), but only 1 feature in GeoJSON (rest truncated)
    const linesGeoJSON: TrailLinesGeoJSON = {
      type: "FeatureCollection",
      features: Array.from({ length: 10 }, (_, i) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: [[-83 - i, 42]] as [number, number][] },
        properties: {
          caseId:        `case-${i}`,
          caseLabel:     `CASE-${String(i).padStart(3, "0")}`,
          waypointCount: 1,
          latestScan:    1700000000000 - i * 1000,
        },
      })),
    };

    mockUseHistoryTrail.mockReturnValue(
      makeResult({ isActive: true, linesGeoJSON, trailCount: 15, totalWaypoints: 15 })
    );

    render(<HistoryTrailLayer fallbackMode={true} showLegend={false} />);

    expect(screen.getByText("+5 more trails")).toBeTruthy();
  });

  // ── 9. Legend renders when showLegend=true in Mapbox mode ────────────────

  it("renders legend when showLegend=true and isActive=true (Mapbox mode)", () => {
    mockUseHistoryTrail.mockReturnValue(
      makeResult({ isActive: true, trailCount: 1, totalWaypoints: 2 })
    );

    // Use fallbackMode=false to render the Mapbox path (Source+Layer+legend)
    render(<HistoryTrailLayer fallbackMode={false} showLegend={true} />);

    const legend = screen.getByTestId("history-trail-legend");
    expect(legend).toBeTruthy();
    expect(screen.getByTestId("history-trail-count")).toBeTruthy();
  });

  // ── 10. Legend hides when showLegend=false ────────────────────────────────

  it("does not render legend when showLegend=false (Mapbox mode)", () => {
    mockUseHistoryTrail.mockReturnValue(
      makeResult({ isActive: true })
    );

    render(<HistoryTrailLayer fallbackMode={false} showLegend={false} />);

    expect(screen.queryByTestId("history-trail-legend")).toBeNull();
  });

  // ── 11. Toggle button click dispatches to LayerEngine ─────────────────────

  it("calls engine.toggle('history') when toggle button is clicked", () => {
    mockUseHistoryTrail.mockReturnValue(makeResult({ isActive: false }));

    render(<HistoryTrailLayer fallbackMode={true} showToggle={true} />);

    const toggle = screen.getByTestId("history-trail-toggle");
    fireEvent.click(toggle);

    expect(mockToggle).toHaveBeenCalledWith("history");
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  // ── 12. Non-fallback mode renders Mapbox Source+Layer when active ─────────

  it("renders Mapbox sources and layers when not in fallback mode and isActive=true", () => {
    mockUseHistoryTrail.mockReturnValue(
      makeResult({ isActive: true, trailCount: 1 })
    );

    render(<HistoryTrailLayer fallbackMode={false} showLegend={false} />);

    // Trail lines source should be present
    expect(screen.getByTestId("source-inventory-trail-lines-source")).toBeTruthy();
    // Trail points source should be present
    expect(screen.getByTestId("source-inventory-trail-points-source")).toBeTruthy();
    // Three layers: lines, intermediate points, endpoint markers
    expect(screen.getByTestId("layer-inventory-trail-lines-layer")).toBeTruthy();
    expect(screen.getByTestId("layer-inventory-trail-points-layer")).toBeTruthy();
    expect(screen.getByTestId("layer-inventory-trail-endpoints-layer")).toBeTruthy();
  });
});

// ─── buildTrailGeoJSON unit tests ─────────────────────────────────────────────

describe("buildTrailGeoJSON", () => {
  // ── 12. Empty input returns stable empty constants ─────────────────────────

  it("returns stable empty GeoJSONs for empty input", () => {
    const result1 = buildTrailGeoJSON([]);
    const result2 = buildTrailGeoJSON([]);

    expect(result1.linesGeoJSON.features).toHaveLength(0);
    expect(result1.pointsGeoJSON.features).toHaveLength(0);
    // Stable reference — same object identity for empty case
    expect(result1.linesGeoJSON).toBe(result2.linesGeoJSON);
    expect(result1.pointsGeoJSON).toBe(result2.pointsGeoJSON);
  });

  // ── 13. Single waypoint trail produces degenerate LineString ───────────────

  it("produces a degenerate LineString (duplicate coord) for single-waypoint trails", () => {
    const trails = [
      {
        caseId:        "case-001",
        caseLabel:     "CASE-001",
        waypoints:     [{
          scanId:        "scan-1",
          lat:           42.5,
          lng:           -83.0,
          scannedAt:     1700000000000,
          scannedByName: "Alice",
        }],
        latestScan:    1700000000000,
        waypointCount: 1,
      },
    ];

    const { linesGeoJSON, pointsGeoJSON } = buildTrailGeoJSON(trails);

    // Line feature exists with 2 coordinates (duplicate for degenerate LineString)
    expect(linesGeoJSON.features).toHaveLength(1);
    const line = linesGeoJSON.features[0];
    expect(line.geometry.coordinates).toHaveLength(2);
    expect(line.geometry.coordinates[0]).toEqual([-83.0, 42.5]);
    expect(line.geometry.coordinates[1]).toEqual([-83.0, 42.5]); // duplicate

    // Point feature exists — both isFirst and isLast for a single waypoint
    expect(pointsGeoJSON.features).toHaveLength(1);
    const point = pointsGeoJSON.features[0];
    expect(point.properties.isFirst).toBe(true);
    expect(point.properties.isLast).toBe(true);
  });

  // ── 14. Multi-waypoint trail produces correct coordinate count ─────────────

  it("produces correct GeoJSON for a multi-waypoint trail", () => {
    const trails = [
      {
        caseId:        "case-001",
        caseLabel:     "CASE-001",
        waypoints:     [
          { scanId: "s1", lat: 42.0, lng: -83.0, scannedAt: 1700000000000, scannedByName: "Alice" },
          { scanId: "s2", lat: 42.5, lng: -83.5, scannedAt: 1700000060000, scannedByName: "Bob" },
          { scanId: "s3", lat: 43.0, lng: -84.0, scannedAt: 1700000120000, scannedByName: "Alice" },
        ],
        latestScan:    1700000120000,
        waypointCount: 3,
      },
    ];

    const { linesGeoJSON, pointsGeoJSON } = buildTrailGeoJSON(trails);

    // Line has 3 coordinates in [lng, lat] order
    expect(linesGeoJSON.features).toHaveLength(1);
    const line = linesGeoJSON.features[0];
    expect(line.geometry.coordinates).toHaveLength(3);
    expect(line.geometry.coordinates[0]).toEqual([-83.0, 42.0]);
    expect(line.geometry.coordinates[2]).toEqual([-84.0, 43.0]);

    // 3 point features
    expect(pointsGeoJSON.features).toHaveLength(3);
  });

  // ── 15. isFirst/isLast tags on endpoint points ─────────────────────────────

  it("correctly tags isFirst and isLast on endpoint points", () => {
    const trails = [
      {
        caseId:        "case-001",
        caseLabel:     "CASE-001",
        waypoints:     [
          { scanId: "s1", lat: 42.0, lng: -83.0, scannedAt: 1700000000000, scannedByName: "Alice" },
          { scanId: "s2", lat: 42.5, lng: -83.5, scannedAt: 1700000060000, scannedByName: "Bob" },
          { scanId: "s3", lat: 43.0, lng: -84.0, scannedAt: 1700000120000, scannedByName: "Alice" },
        ],
        latestScan:    1700000120000,
        waypointCount: 3,
      },
    ];

    const { pointsGeoJSON } = buildTrailGeoJSON(trails);

    const first   = pointsGeoJSON.features[0];
    const middle  = pointsGeoJSON.features[1];
    const last    = pointsGeoJSON.features[2];

    // First waypoint: isFirst=true, isLast=false
    expect(first.properties.isFirst).toBe(true);
    expect(first.properties.isLast).toBe(false);

    // Middle waypoint: neither
    expect(middle.properties.isFirst).toBe(false);
    expect(middle.properties.isLast).toBe(false);

    // Last waypoint: isFirst=false, isLast=true
    expect(last.properties.isFirst).toBe(false);
    expect(last.properties.isLast).toBe(true);
  });

  // ── 16. Line feature properties ───────────────────────────────────────────

  it("sets correct properties on line features", () => {
    const trails = [
      {
        caseId:        "case-abc",
        caseLabel:     "CASE-ABC",
        waypoints:     [
          { scanId: "s1", lat: 42.0, lng: -83.0, scannedAt: 1700000000000, scannedByName: "Alice" },
          { scanId: "s2", lat: 43.0, lng: -84.0, scannedAt: 1700000060000, scannedByName: "Bob" },
        ],
        latestScan:    1700000060000,
        waypointCount: 2,
      },
    ];

    const { linesGeoJSON } = buildTrailGeoJSON(trails);

    const lineProps = linesGeoJSON.features[0].properties;
    expect(lineProps.caseId).toBe("case-abc");
    expect(lineProps.caseLabel).toBe("CASE-ABC");
    expect(lineProps.waypointCount).toBe(2);
    expect(lineProps.latestScan).toBe(1700000060000);
  });

  // ── 17. Skips trails with no waypoints ────────────────────────────────────

  it("skips trails with empty waypoints array", () => {
    const trails = [
      {
        caseId:        "empty-case",
        caseLabel:     "EMPTY",
        waypoints:     [],
        latestScan:    0,
        waypointCount: 0,
      },
    ];

    const { linesGeoJSON, pointsGeoJSON } = buildTrailGeoJSON(trails);

    expect(linesGeoJSON.features).toHaveLength(0);
    expect(pointsGeoJSON.features).toHaveLength(0);
  });
});
