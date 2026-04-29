/**
 * @vitest-environment jsdom
 *
 * TurbineLayer.test.tsx
 *
 * Unit tests for the TurbineLayer component and the buildTurbinesGeoJSON
 * utility function in use-turbine-layer.ts.
 *
 * Test coverage:
 *   1.  Component returns null when turbines layer is inactive and showToggle=false
 *   2.  Component renders toggle button when showToggle=true and isActive=false
 *   3.  Toggle button shows active state when isActive=true
 *   4.  Component renders fallback turbine list when fallbackMode=true and isActive=true
 *   5.  Fallback shows loading state when isLoading=true
 *   6.  Fallback shows empty state when no turbines
 *   7.  Fallback shows turbine items with name + status + coordinates
 *   8.  Fallback shows "+N more" when turbineCount > 10
 *   9.  Legend renders when showLegend=true (Mapbox mode)
 *   10. Legend hides when showLegend=false (Mapbox mode)
 *   11. Toggle button dispatches to LayerEngine on click
 *   12. Non-fallback mode renders Mapbox Source+Layer when active
 *   13. buildTurbinesGeoJSON — empty array returns stable empty GeoJSON
 *   14. buildTurbinesGeoJSON — turbines produce correct Point features
 *   15. buildTurbinesGeoJSON — status property is set correctly
 *   16. buildTurbinesGeoJSON — optional fields default to null/"" when absent
 *   17. buildTurbinesGeoJSON — coordinates are in [lng, lat] order
 *
 * Mocking strategy:
 *   • useTurbineLayer is mocked to control activation state and turbine data.
 *   • useSharedLayerEngine is mocked for the toggle button test.
 *   • react-map-gl Source + Layer are mocked to a <div> (no GL context needed).
 */

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TurbineLayer } from "../TurbineLayer";
import { buildTurbinesGeoJSON } from "@/hooks/use-turbine-layer";
import type {
  UseTurbineLayerResult,
  TurbinesGeoJSON,
} from "@/hooks/use-turbine-layer";

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

// Mock useTurbineLayer
const mockUseTurbineLayer = vi.fn();
vi.mock("@/hooks/use-turbine-layer", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/hooks/use-turbine-layer")>();
  return {
    ...original,
    useTurbineLayer: (args: unknown) => mockUseTurbineLayer(args),
  };
});

// Mock useSharedLayerEngine
const mockToggle = vi.fn();
vi.mock("@/providers/layer-engine-provider", () => ({
  useSharedLayerEngine: () => ({
    state: { turbines: false },
    toggle: mockToggle,
  }),
}));

// ─── Helper ───────────────────────────────────────────────────────────────────

const EMPTY_TURBINES: TurbinesGeoJSON = { type: "FeatureCollection", features: [] };

function makeResult(overrides: Partial<UseTurbineLayerResult> = {}): UseTurbineLayerResult {
  return {
    isActive:        false,
    turbinesGeoJSON: EMPTY_TURBINES,
    isLoading:       false,
    turbineCount:    0,
    activeCount:     0,
    ...overrides,
  };
}

/** Build a minimal TurbinesGeoJSON for test assertions. */
function makeTurbinesGeoJSON(turbines: Array<{
  turbineId: string;
  name: string;
  lat: number;
  lng: number;
  status: "active" | "inactive" | "decommissioned";
  siteCode?: string;
}>): TurbinesGeoJSON {
  return {
    type: "FeatureCollection",
    features: turbines.map((t) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [t.lng, t.lat] as [number, number],
      },
      properties: {
        turbineId:     t.turbineId,
        name:          t.name,
        status:        t.status,
        siteCode:      t.siteCode ?? "",
        missionId:     "",
        hubHeight:     null,
        rotorDiameter: null,
        notes:         "",
      },
    })),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TurbineLayer", () => {
  beforeEach(() => {
    mockUseTurbineLayer.mockReset();
    mockToggle.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // ── 1. Returns null when inactive and showToggle=false ─────────────────────

  it("returns null when turbines layer is inactive and showToggle=false", () => {
    mockUseTurbineLayer.mockReturnValue(makeResult({ isActive: false }));

    const { container } = render(
      <TurbineLayer fallbackMode={true} showToggle={false} />
    );

    expect(container.firstChild).toBeNull();
  });

  // ── 2. Toggle button visible when showToggle=true and isActive=false ───────

  it("renders toggle button when showToggle=true and inactive", () => {
    mockUseTurbineLayer.mockReturnValue(makeResult({ isActive: false }));

    render(<TurbineLayer fallbackMode={true} showToggle={true} />);

    const toggle = screen.getByTestId("turbine-layer-toggle");
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("data-active")).toBeNull();
  });

  // ── 3. Toggle button shows active state when isActive=true ────────────────

  it("renders toggle button with active state when turbines layer is on", () => {
    mockUseTurbineLayer.mockReturnValue(
      makeResult({ isActive: true, turbineCount: 5, activeCount: 3 })
    );

    render(<TurbineLayer fallbackMode={true} showToggle={true} />);

    const toggle = screen.getByTestId("turbine-layer-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("data-active")).toBe("true");
  });

  // ── 4. Fallback renders turbine list when active ───────────────────────────

  it("renders fallback turbine list when fallbackMode=true and isActive=true", () => {
    const turbinesGeoJSON = makeTurbinesGeoJSON([
      { turbineId: "t-001", name: "T-001", lat: 42.5, lng: -83.0, status: "active" },
      { turbineId: "t-002", name: "T-002", lat: 42.6, lng: -83.1, status: "inactive" },
    ]);

    mockUseTurbineLayer.mockReturnValue(
      makeResult({ isActive: true, turbinesGeoJSON, turbineCount: 2, activeCount: 1 })
    );

    render(<TurbineLayer fallbackMode={true} showLegend={false} />);

    const fallback = screen.getByTestId("turbine-layer-fallback");
    expect(fallback).toBeTruthy();

    // Turbine items visible
    expect(screen.getByText("T-001")).toBeTruthy();
    expect(screen.getByText("T-002")).toBeTruthy();
    // "2 turbines" count in header
    expect(screen.getByText("2 turbines")).toBeTruthy();
  });

  // ── 5. Loading state ──────────────────────────────────────────────────────

  it("shows loading text when isLoading=true", () => {
    mockUseTurbineLayer.mockReturnValue(
      makeResult({ isActive: true, isLoading: true })
    );

    render(<TurbineLayer fallbackMode={true} showLegend={false} />);

    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  // ── 6. Empty state ────────────────────────────────────────────────────────

  it("shows empty state message when no turbines", () => {
    mockUseTurbineLayer.mockReturnValue(
      makeResult({ isActive: true, turbineCount: 0 })
    );

    render(<TurbineLayer fallbackMode={true} showLegend={false} />);

    expect(screen.getByText("No turbine sites configured.")).toBeTruthy();
  });

  // ── 7. Turbine item shows name + status ───────────────────────────────────

  it("shows turbine name and status in fallback list items", () => {
    const turbinesGeoJSON = makeTurbinesGeoJSON([
      {
        turbineId: "t-001",
        name:      "T-001",
        lat:       42.5,
        lng:       -83.0,
        status:    "active",
        siteCode:  "SITE-A",
      },
    ]);

    mockUseTurbineLayer.mockReturnValue(
      makeResult({ isActive: true, turbinesGeoJSON, turbineCount: 1, activeCount: 1 })
    );

    render(<TurbineLayer fallbackMode={true} showLegend={false} />);

    expect(screen.getByText("T-001")).toBeTruthy();
    expect(screen.getByText(/active/i)).toBeTruthy();
    expect(screen.getByText(/SITE-A/)).toBeTruthy();
  });

  // ── 8. "+N more" turbine overflow ─────────────────────────────────────────

  it("shows '+N more' when turbineCount exceeds 10 visible items", () => {
    const turbinesGeoJSON = makeTurbinesGeoJSON(
      Array.from({ length: 10 }, (_, i) => ({
        turbineId: `t-${i}`,
        name:      `T-${String(i).padStart(3, "0")}`,
        lat:       42.0 + i * 0.01,
        lng:       -83.0 - i * 0.01,
        status:    "active" as const,
      }))
    );

    mockUseTurbineLayer.mockReturnValue(
      makeResult({ isActive: true, turbinesGeoJSON, turbineCount: 15, activeCount: 15 })
    );

    render(<TurbineLayer fallbackMode={true} showLegend={false} />);

    expect(screen.getByText("+5 more turbines")).toBeTruthy();
  });

  // ── 9. Legend renders when showLegend=true in Mapbox mode ────────────────

  it("renders legend when showLegend=true and isActive=true (Mapbox mode)", () => {
    mockUseTurbineLayer.mockReturnValue(
      makeResult({ isActive: true, turbineCount: 3, activeCount: 2 })
    );

    render(<TurbineLayer fallbackMode={false} showLegend={true} />);

    const legend = screen.getByTestId("turbine-layer-legend");
    expect(legend).toBeTruthy();
    expect(screen.getByTestId("turbine-layer-count")).toBeTruthy();
  });

  // ── 10. Legend hides when showLegend=false ────────────────────────────────

  it("does not render legend when showLegend=false (Mapbox mode)", () => {
    mockUseTurbineLayer.mockReturnValue(
      makeResult({ isActive: true })
    );

    render(<TurbineLayer fallbackMode={false} showLegend={false} />);

    expect(screen.queryByTestId("turbine-layer-legend")).toBeNull();
  });

  // ── 11. Toggle button click dispatches to LayerEngine ─────────────────────

  it("calls engine.toggle('turbines') when toggle button is clicked", () => {
    mockUseTurbineLayer.mockReturnValue(makeResult({ isActive: false }));

    render(<TurbineLayer fallbackMode={true} showToggle={true} />);

    const toggle = screen.getByTestId("turbine-layer-toggle");
    fireEvent.click(toggle);

    expect(mockToggle).toHaveBeenCalledWith("turbines");
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  // ── 12. Non-fallback mode renders Mapbox Source+Layer when active ─────────

  it("renders Mapbox source and layers when not in fallback mode and isActive=true", () => {
    mockUseTurbineLayer.mockReturnValue(
      makeResult({ isActive: true, turbineCount: 2, activeCount: 2 })
    );

    render(<TurbineLayer fallbackMode={false} showLegend={false} />);

    // Turbines source should be present
    expect(screen.getByTestId("source-inventory-turbines-source")).toBeTruthy();
    // Two layers: circles + labels
    expect(screen.getByTestId("layer-inventory-turbines-circles-layer")).toBeTruthy();
    expect(screen.getByTestId("layer-inventory-turbines-labels-layer")).toBeTruthy();
  });

  // ── Legend count shows "active / total" ──────────────────────────────────

  it("legend count displays active and total turbine counts", () => {
    mockUseTurbineLayer.mockReturnValue(
      makeResult({ isActive: true, turbineCount: 10, activeCount: 7 })
    );

    render(<TurbineLayer fallbackMode={false} showLegend={true} />);

    const count = screen.getByTestId("turbine-layer-count");
    expect(count.textContent).toMatch(/7 active \/ 10 total/);
  });
});

// ─── buildTurbinesGeoJSON unit tests ─────────────────────────────────────────

describe("buildTurbinesGeoJSON", () => {
  // ── 13. Empty input returns stable empty constant ──────────────────────────

  it("returns the stable empty FeatureCollection for empty input", () => {
    const result1 = buildTurbinesGeoJSON([]);
    const result2 = buildTurbinesGeoJSON([]);

    expect(result1.features).toHaveLength(0);
    // Stable reference — same object identity for the empty case
    expect(result1).toBe(result2);
  });

  // ── 14. Turbines produce correct Point features ───────────────────────────

  it("produces correct GeoJSON Point features for turbine records", () => {
    const turbines = [
      {
        turbineId:     "t-001",
        name:          "T-001",
        lat:           42.5,
        lng:           -83.0,
        status:        "active" as const,
      },
      {
        turbineId:     "t-002",
        name:          "T-002",
        lat:           43.0,
        lng:           -84.0,
        status:        "inactive" as const,
        siteCode:      "SITE-B",
      },
    ];

    const result = buildTurbinesGeoJSON(turbines);

    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(2);

    const f1 = result.features[0];
    expect(f1.type).toBe("Feature");
    expect(f1.geometry.type).toBe("Point");
    expect(f1.properties.turbineId).toBe("t-001");
    expect(f1.properties.name).toBe("T-001");
  });

  // ── 15. Status property is set correctly ──────────────────────────────────

  it("sets status property from turbine record", () => {
    const turbines = [
      { turbineId: "a", name: "A", lat: 1, lng: 1, status: "active" as const },
      { turbineId: "b", name: "B", lat: 2, lng: 2, status: "inactive" as const },
      { turbineId: "c", name: "C", lat: 3, lng: 3, status: "decommissioned" as const },
    ];

    const result = buildTurbinesGeoJSON(turbines);

    expect(result.features[0].properties.status).toBe("active");
    expect(result.features[1].properties.status).toBe("inactive");
    expect(result.features[2].properties.status).toBe("decommissioned");
  });

  // ── 16. Optional fields default correctly when absent ─────────────────────

  it("defaults optional fields to null or empty string when absent", () => {
    const turbines = [
      { turbineId: "t-001", name: "T-001", lat: 42.0, lng: -83.0, status: "active" as const },
    ];

    const result = buildTurbinesGeoJSON(turbines);
    const props = result.features[0].properties;

    expect(props.siteCode).toBe("");
    expect(props.missionId).toBe("");
    expect(props.hubHeight).toBeNull();
    expect(props.rotorDiameter).toBeNull();
    expect(props.notes).toBe("");
  });

  // ── 17. Coordinates are in [lng, lat] GeoJSON order ──────────────────────

  it("places coordinates in [lng, lat] order as required by GeoJSON spec", () => {
    const turbines = [
      { turbineId: "t-001", name: "T-001", lat: 42.5, lng: -83.25, status: "active" as const },
    ];

    const result = buildTurbinesGeoJSON(turbines);
    const coords = result.features[0].geometry.coordinates;

    // GeoJSON spec: [longitude, latitude]
    expect(coords[0]).toBe(-83.25);  // longitude
    expect(coords[1]).toBe(42.5);    // latitude
  });

  // ── 18. Hub height and rotor diameter are preserved when present ──────────

  it("preserves hubHeight and rotorDiameter when provided", () => {
    const turbines = [
      {
        turbineId:     "t-001",
        name:          "T-001",
        lat:           42.0,
        lng:           -83.0,
        status:        "active" as const,
        hubHeight:     90,
        rotorDiameter: 120,
        siteCode:      "SITE-A",
        notes:         "Primary inspection target",
      },
    ];

    const result = buildTurbinesGeoJSON(turbines);
    const props = result.features[0].properties;

    expect(props.hubHeight).toBe(90);
    expect(props.rotorDiameter).toBe(120);
    expect(props.siteCode).toBe("SITE-A");
    expect(props.notes).toBe("Primary inspection target");
  });
});
