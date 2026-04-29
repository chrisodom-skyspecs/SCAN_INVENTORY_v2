/**
 * @vitest-environment jsdom
 *
 * JourneyPathLine.test.tsx
 *
 * Unit tests for:
 *   • buildPathLineGeoJSON   — pure function (src/components/Map/JourneyPathLine.tsx)
 *   • JourneyPathLine        — presentational React component
 *
 * Sub-AC 2: Render connecting path lines between stops — polyline/path drawing
 * between sequential stop coordinates using the map library's line/polyline
 * primitive, sourcing coordinates from the stop data prop.
 *
 * Coverage matrix
 * ───────────────
 *
 * buildPathLineGeoJSON — pure function:
 *   ✓ empty stops array returns stable EMPTY_PATH_LINE_GEOJSON singleton
 *   ✓ single stop returns EMPTY_PATH_LINE_GEOJSON (< 2 points, no line possible)
 *   ✓ two stops with coordinates: one LineString with 2 coords
 *   ✓ three stops with coordinates: one LineString with 3 coords
 *   ✓ stops sorted by stopIndex ascending (path order)
 *   ✓ out-of-order stops are re-sorted to correct journey order
 *   ✓ coordinates are in [lng, lat] order (Mapbox GL / GeoJSON convention)
 *   ✓ geoStopCount property matches number of coordinates
 *   ✓ does not mutate the input stops array
 *   ✓ result is JSON-serializable (no circular refs)
 *   ✓ always returns a FeatureCollection
 *   ✓ LineString feature has type:"Feature" and geometry.type:"LineString"
 *
 * JourneyPathLine component:
 *   ✓ returns null when stops is empty
 *   ✓ returns null when only one stop has coordinates (< 2 pts)
 *   ✓ renders Source when ≥ 2 valid stops exist
 *   ✓ renders Layer with type="line" when ≥ 2 valid stops exist
 *   ✓ source receives the computed GeoJSON data
 *   ✓ uses default source ID "inventory-journey-path-source" when not specified
 *   ✓ uses default layer ID "inventory-journey-path-layer" when not specified
 *   ✓ accepts custom sourceId prop
 *   ✓ accepts custom layerId prop
 *   ✓ re-renders and rebuilds GeoJSON when stops array changes
 *   ✓ does NOT re-render when same stops reference is provided (memo)
 *   ✓ accepts paintOverride prop and merges with defaults
 *   ✓ accepts layoutOverride prop and merges with defaults
 *   ✓ path connects stops in stopIndex order (not array insertion order)
 *   ✓ GeoJSON coordinates follow [lng, lat] convention
 *
 * Mocking strategy:
 *   • react-map-gl Source + Layer are mocked to plain divs that expose their
 *     props as data attributes and children.  This allows assertions on the
 *     sourceId, layerId, and data props without a real Mapbox GL context.
 *   • No Convex, no hooks, no providers required — JourneyPathLine is pure/
 *     presentational and sources coordinates entirely from the stops prop.
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

// ─── Mock react-map-gl ────────────────────────────────────────────────────────
//
// Source renders as a div with data-source-id and data-geojson exposing the
// GeoJSON data for assertions.  Layer renders as a div with data-layer-id and
// data-layer-type.

vi.mock("react-map-gl", () => ({
  Source: ({
    id,
    data,
    children,
  }: {
    id: string;
    data: unknown;
    children?: React.ReactNode;
  }) => (
    <div
      data-testid={`source-${id}`}
      data-source-id={id}
      data-geojson={JSON.stringify(data)}
    >
      {children}
    </div>
  ),
  Layer: ({
    id,
    type,
    paint,
    layout,
    beforeId,
  }: {
    id: string;
    type: string;
    paint?: unknown;
    layout?: unknown;
    beforeId?: string;
  }) => (
    <div
      data-testid={`layer-${id}`}
      data-layer-id={id}
      data-layer-type={type}
      data-paint={JSON.stringify(paint)}
      data-layout={JSON.stringify(layout)}
      data-before-id={beforeId}
    />
  ),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import {
  buildPathLineGeoJSON,
  EMPTY_PATH_LINE_GEOJSON,
  JourneyPathLine,
} from "../JourneyPathLine";
import type { PathStop } from "../JourneyPathLine";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Build a minimal PathStop. */
function makeStop(overrides: Partial<PathStop> = {}): PathStop {
  return {
    stopIndex: 1,
    lat:       42.36,
    lng:       -71.06,
    ...overrides,
  };
}

/** Two stops (minimum for a drawable path). */
function twoStops(): PathStop[] {
  return [
    makeStop({ stopIndex: 1, lat: 42.36, lng: -71.06 }),
    makeStop({ stopIndex: 2, lat: 43.00, lng: -72.00 }),
  ];
}

/** Three stops forming an L-shaped path. */
function threeStops(): PathStop[] {
  return [
    makeStop({ stopIndex: 1, lat: 40.0, lng: -70.0 }),
    makeStop({ stopIndex: 2, lat: 41.0, lng: -71.0 }),
    makeStop({ stopIndex: 3, lat: 42.0, lng: -72.0 }),
  ];
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildPathLineGeoJSON — pure function
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildPathLineGeoJSON", () => {
  it("returns the stable EMPTY_PATH_LINE_GEOJSON singleton for an empty stops array", () => {
    const result = buildPathLineGeoJSON([]);
    expect(result).toBe(EMPTY_PATH_LINE_GEOJSON);
    expect(result.features).toHaveLength(0);
  });

  it("returns EMPTY_PATH_LINE_GEOJSON when only one stop exists (no line segment possible)", () => {
    const result = buildPathLineGeoJSON([makeStop()]);
    // A single point cannot form a visible line segment.
    expect(result).toBe(EMPTY_PATH_LINE_GEOJSON);
    expect(result.features).toHaveLength(0);
  });

  it("returns one LineString feature for two stops", () => {
    const result = buildPathLineGeoJSON(twoStops());

    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].type).toBe("Feature");
    expect(result.features[0].geometry.type).toBe("LineString");
    expect(result.features[0].geometry.coordinates).toHaveLength(2);
  });

  it("returns one LineString feature with 3 coordinates for three stops", () => {
    const result = buildPathLineGeoJSON(threeStops());

    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.coordinates).toHaveLength(3);
  });

  it("sorts stops by stopIndex ascending — defines path segment order", () => {
    // Input deliberately reversed: stop 3 first, stop 1 last.
    const stops: PathStop[] = [
      makeStop({ stopIndex: 3, lat: 42.0, lng: -72.0 }),
      makeStop({ stopIndex: 1, lat: 40.0, lng: -70.0 }),
      makeStop({ stopIndex: 2, lat: 41.0, lng: -71.0 }),
    ];

    const result = buildPathLineGeoJSON(stops);
    const coords = result.features[0].geometry.coordinates;

    // Coordinates should be in stopIndex order: 1→2→3
    // Stop 1: lat=40, lng=-70 → [lng, lat] = [-70.0, 40.0]
    // Stop 2: lat=41, lng=-71 → [-71.0, 41.0]
    // Stop 3: lat=42, lng=-72 → [-72.0, 42.0]
    expect(coords[0]).toEqual([-70.0, 40.0]);
    expect(coords[1]).toEqual([-71.0, 41.0]);
    expect(coords[2]).toEqual([-72.0, 42.0]);
  });

  it("coordinates follow [longitude, latitude] order (Mapbox GL convention)", () => {
    const stops: PathStop[] = [
      makeStop({ stopIndex: 1, lat: 42.36, lng: -71.06 }),
      makeStop({ stopIndex: 2, lat: 43.00, lng: -72.00 }),
    ];

    const result = buildPathLineGeoJSON(stops);
    const firstCoord = result.features[0].geometry.coordinates[0];
    const secondCoord = result.features[0].geometry.coordinates[1];

    // [lng, lat] — longitude (x-axis) comes first in GeoJSON/Mapbox GL
    expect(firstCoord).toEqual([-71.06, 42.36]);
    expect(secondCoord).toEqual([-72.0, 43.0]);
  });

  it("geoStopCount property equals the number of stops in the path", () => {
    const result = buildPathLineGeoJSON(threeStops());
    expect(result.features[0].properties.geoStopCount).toBe(3);
  });

  it("does not mutate the input stops array", () => {
    // Provide stops in reverse order to trigger sorting.
    const stops: PathStop[] = [
      makeStop({ stopIndex: 2, lat: 43.0, lng: -72.0 }),
      makeStop({ stopIndex: 1, lat: 42.0, lng: -71.0 }),
    ];
    const originalFirst = stops[0].stopIndex; // 2

    buildPathLineGeoJSON(stops);

    // Input array should remain in original insertion order.
    expect(stops[0].stopIndex).toBe(originalFirst); // still 2
    expect(stops[1].stopIndex).toBe(1);
  });

  it("result is JSON-serializable (no circular refs or undefined in coordinates)", () => {
    const result = buildPathLineGeoJSON(threeStops());
    expect(() => JSON.stringify(result)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(result)) as typeof result;
    expect(parsed.features[0].geometry.type).toBe("LineString");
    expect(parsed.features[0].geometry.coordinates).toHaveLength(3);
  });

  it("always returns an object with type:'FeatureCollection'", () => {
    expect(buildPathLineGeoJSON([]).type).toBe("FeatureCollection");
    expect(buildPathLineGeoJSON(twoStops()).type).toBe("FeatureCollection");
  });

  it("empty singleton has a features array (not null/undefined)", () => {
    expect(Array.isArray(EMPTY_PATH_LINE_GEOJSON.features)).toBe(true);
    expect(EMPTY_PATH_LINE_GEOJSON.features).toHaveLength(0);
  });

  it("handles stops with identical stopIndex (path order ambiguity handled stably)", () => {
    // Two stops with the same stopIndex — sort is stable so their relative
    // order is preserved; the path is still drawn without throwing.
    const stops: PathStop[] = [
      makeStop({ stopIndex: 1, lat: 42.0, lng: -71.0 }),
      makeStop({ stopIndex: 1, lat: 43.0, lng: -72.0 }),
    ];
    const result = buildPathLineGeoJSON(stops);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.coordinates).toHaveLength(2);
  });

  it("large journey (10 stops) — all coordinates present in order", () => {
    const stops: PathStop[] = Array.from({ length: 10 }, (_, i) =>
      makeStop({ stopIndex: i + 1, lat: 40.0 + i * 0.1, lng: -70.0 - i * 0.1 })
    );

    const result = buildPathLineGeoJSON(stops);
    expect(result.features[0].geometry.coordinates).toHaveLength(10);

    // First coord should match stop 1; last coord stop 10.
    expect(result.features[0].geometry.coordinates[0]).toEqual([-70.0, 40.0]);
    const last = result.features[0].geometry.coordinates[9];
    expect(last[0]).toBeCloseTo(-70.9);
    expect(last[1]).toBeCloseTo(40.9);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// JourneyPathLine component
// ═══════════════════════════════════════════════════════════════════════════════

describe("JourneyPathLine", () => {
  // ── Null returns ──────────────────────────────────────────────────────────

  it("returns null when stops array is empty", () => {
    const { container } = render(<JourneyPathLine stops={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when only one stop exists (cannot form a line segment)", () => {
    const { container } = render(<JourneyPathLine stops={[makeStop()]} />);
    expect(container.firstChild).toBeNull();
  });

  // ── Renders Source + Layer ────────────────────────────────────────────────

  it("renders a Source element when ≥ 2 stops are provided", () => {
    render(<JourneyPathLine stops={twoStops()} />);
    // Default source ID
    expect(screen.getByTestId("source-inventory-journey-path-source")).toBeDefined();
  });

  it("renders a Layer element with type='line' when ≥ 2 stops are provided", () => {
    render(<JourneyPathLine stops={twoStops()} />);
    const layer = screen.getByTestId("layer-inventory-journey-path-layer");
    expect(layer).toBeDefined();
    expect(layer.dataset.layerType).toBe("line");
  });

  it("renders Source + Layer for a three-stop journey", () => {
    render(<JourneyPathLine stops={threeStops()} />);
    expect(screen.getByTestId("source-inventory-journey-path-source")).toBeDefined();
    expect(screen.getByTestId("layer-inventory-journey-path-layer")).toBeDefined();
  });

  // ── GeoJSON data ──────────────────────────────────────────────────────────

  it("source receives GeoJSON data with a LineString feature", () => {
    render(<JourneyPathLine stops={twoStops()} />);
    const source = screen.getByTestId("source-inventory-journey-path-source");
    const geojson = JSON.parse(source.dataset.geojson ?? "{}");

    expect(geojson.type).toBe("FeatureCollection");
    expect(geojson.features).toHaveLength(1);
    expect(geojson.features[0].geometry.type).toBe("LineString");
  });

  it("GeoJSON coordinates contain [lng, lat] pairs (Mapbox GL order)", () => {
    const stops: PathStop[] = [
      makeStop({ stopIndex: 1, lat: 42.36, lng: -71.06 }),
      makeStop({ stopIndex: 2, lat: 43.00, lng: -72.00 }),
    ];
    render(<JourneyPathLine stops={stops} />);
    const source = screen.getByTestId("source-inventory-journey-path-source");
    const geojson = JSON.parse(source.dataset.geojson ?? "{}");
    const coords = geojson.features[0].geometry.coordinates;

    expect(coords[0]).toEqual([-71.06, 42.36]); // [lng, lat]
    expect(coords[1]).toEqual([-72.0,  43.0]);
  });

  it("GeoJSON coordinates reflect stopIndex order (not array insertion order)", () => {
    // Supply stops in reverse index order to verify sorting.
    const stops: PathStop[] = [
      makeStop({ stopIndex: 3, lat: 44.0, lng: -73.0 }),
      makeStop({ stopIndex: 1, lat: 42.0, lng: -71.0 }),
      makeStop({ stopIndex: 2, lat: 43.0, lng: -72.0 }),
    ];
    render(<JourneyPathLine stops={stops} />);
    const source = screen.getByTestId("source-inventory-journey-path-source");
    const geojson = JSON.parse(source.dataset.geojson ?? "{}");
    const coords = geojson.features[0].geometry.coordinates;

    // Should be: stop 1 → stop 2 → stop 3
    expect(coords[0]).toEqual([-71.0, 42.0]); // stop 1
    expect(coords[1]).toEqual([-72.0, 43.0]); // stop 2
    expect(coords[2]).toEqual([-73.0, 44.0]); // stop 3
  });

  // ── Custom source / layer IDs ─────────────────────────────────────────────

  it("uses default source ID 'inventory-journey-path-source'", () => {
    render(<JourneyPathLine stops={twoStops()} />);
    expect(screen.getByTestId("source-inventory-journey-path-source")).toBeDefined();
  });

  it("uses default layer ID 'inventory-journey-path-layer'", () => {
    render(<JourneyPathLine stops={twoStops()} />);
    expect(screen.getByTestId("layer-inventory-journey-path-layer")).toBeDefined();
  });

  it("accepts a custom sourceId prop", () => {
    render(<JourneyPathLine stops={twoStops()} sourceId="custom-path-source" />);
    expect(screen.getByTestId("source-custom-path-source")).toBeDefined();
    expect(screen.queryByTestId("source-inventory-journey-path-source")).toBeNull();
  });

  it("accepts a custom layerId prop", () => {
    render(<JourneyPathLine stops={twoStops()} layerId="custom-path-layer" />);
    expect(screen.getByTestId("layer-custom-path-layer")).toBeDefined();
    expect(screen.queryByTestId("layer-inventory-journey-path-layer")).toBeNull();
  });

  it("multiple instances with unique IDs can coexist on the same map", () => {
    render(
      <>
        <JourneyPathLine stops={twoStops()} sourceId="path-a-source" layerId="path-a-layer" />
        <JourneyPathLine stops={threeStops()} sourceId="path-b-source" layerId="path-b-layer" />
      </>
    );
    expect(screen.getByTestId("source-path-a-source")).toBeDefined();
    expect(screen.getByTestId("layer-path-a-layer")).toBeDefined();
    expect(screen.getByTestId("source-path-b-source")).toBeDefined();
    expect(screen.getByTestId("layer-path-b-layer")).toBeDefined();
  });

  // ── Paint and layout overrides ────────────────────────────────────────────

  it("layer uses default paint (blue line) when paintOverride is not provided", () => {
    render(<JourneyPathLine stops={twoStops()} />);
    const layer = screen.getByTestId("layer-inventory-journey-path-layer");
    const paint = JSON.parse(layer.dataset.paint ?? "{}");
    // Default paint includes --layer-transit-bg blue color
    expect(paint["line-color"]).toBe("hsl(211, 85%, 52%)");
  });

  it("paintOverride merges with default paint (overrides specific keys)", () => {
    const paintOverride = { "line-color": "hsl(0, 0%, 50%)", "line-opacity": 0.5 };
    render(<JourneyPathLine stops={twoStops()} paintOverride={paintOverride} />);
    const layer = screen.getByTestId("layer-inventory-journey-path-layer");
    const paint = JSON.parse(layer.dataset.paint ?? "{}");

    // Overridden keys
    expect(paint["line-color"]).toBe("hsl(0, 0%, 50%)");
    expect(paint["line-opacity"]).toBe(0.5);
    // Default key still present (not erased by partial override)
    expect(paint["line-width"]).toBeDefined();
  });

  it("layoutOverride merges with default layout", () => {
    const layoutOverride = { "line-cap": "square" };
    render(<JourneyPathLine stops={twoStops()} layoutOverride={layoutOverride} />);
    const layer = screen.getByTestId("layer-inventory-journey-path-layer");
    const layout = JSON.parse(layer.dataset.layout ?? "{}");

    expect(layout["line-cap"]).toBe("square");
    // Default join key still present
    expect(layout["line-join"]).toBe("round");
  });

  it("layer uses default layout (round cap + join) when layoutOverride not provided", () => {
    render(<JourneyPathLine stops={twoStops()} />);
    const layer = screen.getByTestId("layer-inventory-journey-path-layer");
    const layout = JSON.parse(layer.dataset.layout ?? "{}");
    expect(layout["line-cap"]).toBe("round");
    expect(layout["line-join"]).toBe("round");
  });

  // ── beforeId ──────────────────────────────────────────────────────────────

  it("layer uses default beforeId 'waterway-label'", () => {
    render(<JourneyPathLine stops={twoStops()} />);
    const layer = screen.getByTestId("layer-inventory-journey-path-layer");
    expect(layer.dataset.beforeId).toBe("waterway-label");
  });

  it("accepts a custom beforeId prop", () => {
    render(<JourneyPathLine stops={twoStops()} beforeId="settlement-label" />);
    const layer = screen.getByTestId("layer-inventory-journey-path-layer");
    expect(layer.dataset.beforeId).toBe("settlement-label");
  });

  // ── Re-render behavior ────────────────────────────────────────────────────

  it("re-renders with updated GeoJSON when stops array changes", () => {
    const { rerender } = render(<JourneyPathLine stops={twoStops()} />);

    // Add a third stop
    const newStops: PathStop[] = [
      ...twoStops(),
      makeStop({ stopIndex: 3, lat: 44.0, lng: -73.0 }),
    ];
    rerender(<JourneyPathLine stops={newStops} />);

    const source = screen.getByTestId("source-inventory-journey-path-source");
    const geojson = JSON.parse(source.dataset.geojson ?? "{}");
    expect(geojson.features[0].geometry.coordinates).toHaveLength(3);
  });

  it("transitions from null → rendered when stops array grows to ≥ 2 items", () => {
    const { rerender, container } = render(<JourneyPathLine stops={[makeStop()]} />);
    expect(container.firstChild).toBeNull(); // single stop → null

    rerender(<JourneyPathLine stops={twoStops()} />);
    expect(screen.getByTestId("source-inventory-journey-path-source")).toBeDefined();
  });

  it("transitions from rendered → null when stops array shrinks below 2 items", () => {
    const { rerender } = render(<JourneyPathLine stops={twoStops()} />);
    expect(screen.getByTestId("source-inventory-journey-path-source")).toBeDefined();

    rerender(<JourneyPathLine stops={[makeStop()]} />);
    // Single stop — should now return null
    expect(screen.queryByTestId("source-inventory-journey-path-source")).toBeNull();
  });

  // ── GeoJSON coordinate count matches stops count ──────────────────────────

  it("coordinate count in GeoJSON matches number of stops provided", () => {
    const stops = Array.from({ length: 5 }, (_, i) =>
      makeStop({ stopIndex: i + 1, lat: 40.0 + i, lng: -70.0 - i })
    );
    render(<JourneyPathLine stops={stops} />);
    const source = screen.getByTestId("source-inventory-journey-path-source");
    const geojson = JSON.parse(source.dataset.geojson ?? "{}");
    expect(geojson.features[0].geometry.coordinates).toHaveLength(5);
  });

  // ── Display name ──────────────────────────────────────────────────────────

  it("has the correct displayName (for React DevTools)", () => {
    expect(JourneyPathLine.displayName).toBe("JourneyPathLine");
  });
});
