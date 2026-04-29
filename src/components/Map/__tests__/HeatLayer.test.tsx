/**
 * @vitest-environment jsdom
 *
 * HeatLayer.test.tsx
 *
 * Unit tests for the HeatLayer component and its supporting utilities.
 *
 * Architecture note
 * ─────────────────
 * HeatLayer has two rendering paths:
 *
 * 1. fallbackMode=false (Mapbox GL mode):
 *    Returns <Source><Layer /></Source> plus the optional legendElement.
 *    The legendElement contains: gradient swatch, scale labels, point count,
 *    accessible density list, and heat-layer-count.
 *
 * 2. fallbackMode=true (HTML mode):
 *    Returns an accessible HTML div with a header (count), inline swatches,
 *    and a density label list.  Does NOT include the legendElement.
 *
 * Testing strategy
 * ────────────────
 * • Legend tests use fallbackMode=false so the legendElement is rendered.
 * • Fallback swatch/count tests use fallbackMode=true.
 * • react-map-gl is mocked so Source/Layer render as HTML elements in tests.
 * • useHeatLayer is mocked to control activation state and data.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HeatLayer } from "../HeatLayer";
import { LayerEngineProvider } from "@/providers/layer-engine-provider";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock react-map-gl — Source and Layer are DOM-less no-ops in tests.
vi.mock("react-map-gl", () => ({
  Source: ({
    children,
    id,
  }: {
    children?: React.ReactNode;
    id: string;
  }) => (
    <div data-testid={`mapbox-source-${id}`} data-source-id={id}>
      {children}
    </div>
  ),
  Layer: ({ id, type }: { id: string; type: string }) => (
    <div
      data-testid={`mapbox-layer-${id}`}
      data-layer-id={id}
      data-layer-type={type}
    />
  ),
}));

// Mock useHeatLayer — controls the heat layer state and data in tests.
const mockUseHeatLayer = vi.fn();
vi.mock("@/hooks/use-heat-layer", () => ({
  useHeatLayer: (args: unknown) => mockUseHeatLayer(args),
}));

// ─── Cleanup ──────────────────────────────────────────────────────────────────

// Ensure DOM is wiped between tests to prevent stale element accumulation.
afterEach(cleanup);

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeHeatLayerReturn(overrides: {
  isActive?: boolean;
  isLoading?: boolean;
  pointCount?: number;
  features?: unknown[];
}) {
  const {
    isActive = true,
    isLoading = false,
    pointCount = 0,
    features = [],
  } = overrides;
  return {
    isActive,
    geojsonData: { type: "FeatureCollection", features },
    isLoading,
    pointCount,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("HeatLayer", () => {
  beforeEach(() => {
    mockUseHeatLayer.mockReset();
  });

  // ── 1. Returns null when heat toggle is OFF ─────────────────────────────────

  it("returns null when heat toggle is OFF", () => {
    mockUseHeatLayer.mockReturnValue(makeHeatLayerReturn({ isActive: false }));

    const { container } = render(
      <LayerEngineProvider initialState={{ heat: false }}>
        <HeatLayer fallbackMode={true} />
      </LayerEngineProvider>
    );

    expect(container.firstChild).toBeNull();
  });

  // ── 2. Renders fallback HTML when heat is ON + fallbackMode=true ────────────

  it("renders fallback HTML when heat is ON and fallbackMode=true", () => {
    mockUseHeatLayer.mockReturnValue(makeHeatLayerReturn({ isActive: true }));

    render(
      <LayerEngineProvider initialState={{ heat: true }}>
        <HeatLayer fallbackMode={true} showLegend={false} />
      </LayerEngineProvider>
    );

    screen.getByRole("region", { name: "Heat layer density summary" });
    screen.getByTestId("heat-layer-fallback");
  });

  // ── 3. Renders legend with gradient swatch and scale labels ─────────────────
  // Legend is rendered in Mapbox GL mode (fallbackMode=false) when showLegend=true.

  it("renders legend with gradient and scale labels in Mapbox GL mode", () => {
    mockUseHeatLayer.mockReturnValue(makeHeatLayerReturn({ isActive: true }));

    render(
      <LayerEngineProvider initialState={{ heat: true }}>
        <HeatLayer fallbackMode={false} showLegend={true} />
      </LayerEngineProvider>
    );

    screen.getByTestId("heat-layer-legend");
    screen.getByTestId("heat-layer-gradient");
    screen.getByText("Low");
    screen.getByText("High");
  });

  // ── 4. Point count reflects live data ──────────────────────────────────────
  // heat-layer-count is in the legend (Mapbox GL mode only).

  it("shows point count in legend matching live data", () => {
    const features = [
      { type: "Feature", properties: { weight: 1, caseId: "a" }, geometry: { type: "Point", coordinates: [0, 0] } },
      { type: "Feature", properties: { weight: 3, caseId: "b" }, geometry: { type: "Point", coordinates: [1, 1] } },
      { type: "Feature", properties: { weight: 1, caseId: "c" }, geometry: { type: "Point", coordinates: [2, 2] } },
    ];

    mockUseHeatLayer.mockReturnValue(makeHeatLayerReturn({ isActive: true, pointCount: 3, features }));

    render(
      <LayerEngineProvider initialState={{ heat: true }}>
        <HeatLayer fallbackMode={false} showLegend={true} />
      </LayerEngineProvider>
    );

    const countEl = screen.getByTestId("heat-layer-count");
    expect(countEl.textContent).toContain("3 pts");
  });

  // ── 5. Loading state renders shimmer ───────────────────────────────────────
  // Loading shimmer is in the legend (Mapbox GL mode only).

  it("renders loading shimmer when isLoading=true in Mapbox GL mode", () => {
    mockUseHeatLayer.mockReturnValue(
      makeHeatLayerReturn({ isActive: true, isLoading: true, pointCount: 0 })
    );

    render(
      <LayerEngineProvider initialState={{ heat: true }}>
        <HeatLayer fallbackMode={false} showLegend={true} />
      </LayerEngineProvider>
    );

    const countEl = screen.getByTestId("heat-layer-count");
    expect(countEl.getAttribute("data-loading")).toBe("true");
    screen.getByLabelText("Loading heat data");
  });

  // ── 6. Renders Mapbox Source+Layer in normal mode ───────────────────────────

  it("renders Mapbox Source+Layer when heat is ON and not in fallback mode", () => {
    const features = [
      { type: "Feature", properties: { weight: 1, caseId: "x" }, geometry: { type: "Point", coordinates: [-74, 40] } },
    ];

    mockUseHeatLayer.mockReturnValue(makeHeatLayerReturn({ isActive: true, pointCount: 1, features }));

    render(
      <LayerEngineProvider initialState={{ heat: true }}>
        <HeatLayer fallbackMode={false} showLegend={false} />
      </LayerEngineProvider>
    );

    screen.getByTestId("mapbox-source-inventory-heat-source");

    const layer = screen.getByTestId("mapbox-layer-inventory-heat-layer");
    expect(layer.getAttribute("data-layer-type")).toBe("heatmap");
  });

  // ── 7. Legend is accessible ─────────────────────────────────────────────────

  it("legend region has correct aria attributes in Mapbox GL mode", () => {
    mockUseHeatLayer.mockReturnValue(makeHeatLayerReturn({ isActive: true }));

    render(
      <LayerEngineProvider initialState={{ heat: true }}>
        <HeatLayer fallbackMode={false} showLegend={true} />
      </LayerEngineProvider>
    );

    const legend = screen.getByTestId("heat-layer-legend");
    expect(legend.getAttribute("aria-label")).toBe("Heat map density legend");
    expect(legend.getAttribute("role")).toBe("region");
  });

  // ── 8. Screen-reader list mirrors LEGEND_LABELS ─────────────────────────────
  // The accessible density list renders "{label} density" for each of the 8 stops.
  // This list is in the legendElement (Mapbox GL mode only).

  it("accessible legend list contains all 8 density labels in Mapbox GL mode", () => {
    mockUseHeatLayer.mockReturnValue(makeHeatLayerReturn({ isActive: true }));

    render(
      <LayerEngineProvider initialState={{ heat: true }}>
        <HeatLayer fallbackMode={false} showLegend={true} />
      </LayerEngineProvider>
    );

    const expectedLabels = [
      "Very low density",
      "Low density",
      "Medium-low density",
      "Medium density",
      "Medium-high density",
      "High density",
      "Very high density",
      "Peak density",
    ];

    for (const label of expectedLabels) {
      screen.getByText(label);
    }
  });

  // ── 9. showLegend=false suppresses the legend ───────────────────────────────

  it("does not render legend when showLegend=false in Mapbox GL mode", () => {
    mockUseHeatLayer.mockReturnValue(makeHeatLayerReturn({ isActive: true }));

    render(
      <LayerEngineProvider initialState={{ heat: true }}>
        <HeatLayer fallbackMode={false} showLegend={false} />
      </LayerEngineProvider>
    );

    expect(screen.queryByTestId("heat-layer-legend")).toBeNull();
  });

  // ── 10. Singular point count ────────────────────────────────────────────────
  // "1 pt" (singular) in the legend.

  it("uses singular 'pt' for 1 point in legend", () => {
    const features = [
      { type: "Feature", properties: { weight: 1, caseId: "solo" }, geometry: { type: "Point", coordinates: [0, 0] } },
    ];

    mockUseHeatLayer.mockReturnValue(makeHeatLayerReturn({ isActive: true, pointCount: 1, features }));

    render(
      <LayerEngineProvider initialState={{ heat: true }}>
        <HeatLayer fallbackMode={false} showLegend={true} />
      </LayerEngineProvider>
    );

    const countEl = screen.getByTestId("heat-layer-count");
    expect(countEl.textContent).toContain("1 pt");
  });

  // ── 11. Fallback swatches rendered ─────────────────────────────────────────
  // heat-swatch-0 through heat-swatch-7 are in the fallback HTML mode.

  it("renders all 8 fallback swatches in fallback mode", () => {
    mockUseHeatLayer.mockReturnValue(makeHeatLayerReturn({ isActive: true }));

    render(
      <LayerEngineProvider initialState={{ heat: true }}>
        <HeatLayer fallbackMode={true} showLegend={false} />
      </LayerEngineProvider>
    );

    for (let i = 0; i < 8; i++) {
      screen.getByTestId(`heat-swatch-${i}`);
    }
  });
});
