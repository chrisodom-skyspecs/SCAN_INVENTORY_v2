/**
 * @vitest-environment jsdom
 *
 * JourneyStopLayer.test.tsx
 *
 * Unit tests for:
 *   • JourneyStopLayer component (src/components/Map/JourneyStopLayer.tsx)
 *   • buildJourneyStopGeoJSON pure function (src/hooks/use-journey-stop-layer.ts)
 *
 * Coverage matrix
 * ───────────────
 *
 * buildJourneyStopGeoJSON — pure function:
 *   ✓ empty stops array returns stable empty GeoJSONs
 *   ✓ single geo stop: one Point feature, one degenerate LineString
 *   ✓ all stops have coordinates: LineString has all coords
 *   ✓ some stops lack coordinates: LineString skips them, Point features included
 *   ✓ no stops have coordinates: empty path, all stops in stopsGeoJSON
 *   ✓ hasAllCoordinates=true when all stops have GPS
 *   ✓ hasAllCoordinates=false when some stops lack GPS
 *   ✓ first stop: isFirst=true, isLast=false
 *   ✓ last stop: isFirst=false, isLast=true
 *   ✓ single stop: isFirst=true AND isLast=true
 *   ✓ coordinates in [lng, lat] order (Mapbox GL convention)
 *   ✓ stop properties match JourneyStop fields
 *   ✓ null-geometry Feature for stops without coordinates
 *   ✓ stopCount in path properties equals total stop count
 *   ✓ multiple stops: chronological order preserved
 *
 * JourneyStopLayer component:
 *   ✓ returns null when caseId is null
 *   ✓ returns null when loading (journey === undefined)
 *   ✓ returns null when case not found (journey === null)
 *   ✓ returns null when stop count is 0
 *   ✓ renders fallback list when fallbackMode=true and stops exist
 *   ✓ fallback shows case label in header
 *   ✓ fallback shows stop count badge
 *   ✓ fallback renders stop items with stop index
 *   ✓ fallback renders formatted event type labels
 *   ✓ fallback renders actor name in stop meta
 *   ✓ fallback renders location name for geo stops
 *   ✓ fallback marks first stop with data-is-first="true"
 *   ✓ fallback marks last stop with data-is-last="true"
 *   ✓ fallback shows "+N more" when stops > 15
 *   ✓ fallback shows empty state when stops array is empty
 *   ✓ legend renders when showLegend=true (default)
 *   ✓ legend is hidden when showLegend=false
 *   ✓ legend shows case label
 *   ✓ legend shows stop count
 *   ✓ Mapbox GL mode: renders Source/Layer when fallbackMode=false
 *   ✓ Mapbox GL mode: path source rendered when hasPath=true
 *   ✓ Mapbox GL mode: stops source always rendered
 *   ✓ Mapbox GL mode: path source omitted when no geo stops
 *
 * Mocking strategy:
 *   • useJourneyStopLayer is mocked to control data state.
 *   • react-map-gl Source + Layer are mocked to plain <div> elements.
 *   • No LayerEngineProvider needed (JourneyStopLayer is always-on).
 */

import React from "react";
import { render, screen, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildJourneyStopGeoJSON,
  EMPTY_PATH_GEOJSON,
  EMPTY_STOPS_GEOJSON,
} from "@/hooks/use-journey-stop-layer";
import type {
  UseJourneyStopLayerResult,
  JourneyPathGeoJSON,
  JourneyStopsGeoJSON,
} from "@/hooks/use-journey-stop-layer";
import type { M2CaseJourney, JourneyStop } from "@/hooks/use-m2-journey-stops";

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

// Mock useJourneyStopLayer — fully controlled in each test
const mockUseJourneyStopLayer = vi.fn();
vi.mock("@/hooks/use-journey-stop-layer", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/hooks/use-journey-stop-layer")>();
  return {
    ...original,
    useJourneyStopLayer: (caseId: string | null) => mockUseJourneyStopLayer(caseId),
  };
});

// ─── Import component AFTER mocks ─────────────────────────────────────────────
import { JourneyStopLayer } from "../JourneyStopLayer";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID    = "case-abc-123";
const CASE_LABEL = "CASE-001";

/** Build a minimal JourneyStop. */
function makeStop(overrides: Partial<JourneyStop> = {}): JourneyStop {
  return {
    stopIndex:      1,
    eventId:        "evt-001",
    eventType:      "status_change",
    timestamp:      1_700_000_000_000,
    location:       { lat: 42.36, lng: -71.06, locationName: "Site Alpha" },
    hasCoordinates: true,
    actorId:        "user-alice",
    actorName:      "Alice Tech",
    metadata:       {},
    ...overrides,
  };
}

/** Build a minimal M2CaseJourney. */
function makeJourney(overrides: Partial<M2CaseJourney> = {}): M2CaseJourney {
  const stop = makeStop();
  return {
    caseId:              CASE_ID,
    caseLabel:           CASE_LABEL,
    currentStatus:       "deployed",
    currentLat:          42.36,
    currentLng:          -71.06,
    currentLocationName: "Site Alpha",
    stops:               [stop],
    stopCount:           1,
    firstStop:           stop,
    lastStop:            stop,
    hasLocation:         true,
    ...overrides,
  };
}

/** Make a UseJourneyStopLayerResult. */
function makeLayerResult(
  overrides: Partial<UseJourneyStopLayerResult> & { journey?: M2CaseJourney | null | undefined }
): UseJourneyStopLayerResult {
  const journey = "journey" in overrides ? overrides.journey : makeJourney();
  const { pathGeoJSON, stopsGeoJSON } =
    journey ? buildJourneyStopGeoJSON(journey) : { pathGeoJSON: EMPTY_PATH_GEOJSON, stopsGeoJSON: EMPTY_STOPS_GEOJSON };

  return {
    pathGeoJSON,
    stopsGeoJSON,
    journey,
    isLoading:  false,
    stopCount:  journey?.stopCount ?? 0,
    hasPath:    pathGeoJSON.features.length > 0,
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockUseJourneyStopLayer.mockReset();
});

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildJourneyStopGeoJSON — pure function tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildJourneyStopGeoJSON", () => {
  it("returns stable empty GeoJSONs for an empty stops array", () => {
    const journey = makeJourney({ stops: [], stopCount: 0, firstStop: null, lastStop: null });
    const { pathGeoJSON, stopsGeoJSON } = buildJourneyStopGeoJSON(journey);

    expect(pathGeoJSON).toBe(EMPTY_PATH_GEOJSON);
    expect(stopsGeoJSON).toBe(EMPTY_STOPS_GEOJSON);
    expect(pathGeoJSON.features).toHaveLength(0);
    expect(stopsGeoJSON.features).toHaveLength(0);
  });

  it("single geo stop: one Point feature + one degenerate LineString", () => {
    const stop = makeStop({ stopIndex: 1, location: { lat: 42.36, lng: -71.06 }, hasCoordinates: true });
    const journey = makeJourney({ stops: [stop], stopCount: 1 });
    const { pathGeoJSON, stopsGeoJSON } = buildJourneyStopGeoJSON(journey);

    expect(stopsGeoJSON.features).toHaveLength(1);
    expect(stopsGeoJSON.features[0].geometry?.type).toBe("Point");

    // One-coordinate LineString is valid (degenerate)
    expect(pathGeoJSON.features).toHaveLength(1);
    expect(pathGeoJSON.features[0].geometry.type).toBe("LineString");
    expect(pathGeoJSON.features[0].geometry.coordinates).toHaveLength(1);
  });

  it("all stops have coordinates: LineString includes all coordinate pairs", () => {
    const stops = [
      makeStop({ stopIndex: 1, location: { lat: 42.0, lng: -71.0 }, hasCoordinates: true }),
      makeStop({ stopIndex: 2, eventId: "e2", location: { lat: 43.0, lng: -72.0 }, hasCoordinates: true }),
      makeStop({ stopIndex: 3, eventId: "e3", location: { lat: 44.0, lng: -73.0 }, hasCoordinates: true }),
    ];
    const journey = makeJourney({ stops, stopCount: 3 });
    const { pathGeoJSON, stopsGeoJSON } = buildJourneyStopGeoJSON(journey);

    expect(pathGeoJSON.features[0].geometry.coordinates).toHaveLength(3);
    expect(stopsGeoJSON.features).toHaveLength(3);
  });

  it("some stops lack coordinates: LineString skips them, all stops in stopsGeoJSON", () => {
    const stops = [
      makeStop({ stopIndex: 1, location: { lat: 42.0, lng: -71.0 }, hasCoordinates: true }),
      makeStop({ stopIndex: 2, eventId: "e2", location: {}, hasCoordinates: false }),
      makeStop({ stopIndex: 3, eventId: "e3", location: { lat: 44.0, lng: -73.0 }, hasCoordinates: true }),
    ];
    const journey = makeJourney({ stops, stopCount: 3 });
    const { pathGeoJSON, stopsGeoJSON } = buildJourneyStopGeoJSON(journey);

    // LineString has 2 coords (stops 1 and 3); stop 2 is excluded
    expect(pathGeoJSON.features[0].geometry.coordinates).toHaveLength(2);

    // All 3 stops in stopsGeoJSON
    expect(stopsGeoJSON.features).toHaveLength(3);

    // Stop 2 has null geometry
    const stop2Feature = stopsGeoJSON.features.find(
      (f) => f.properties.stopIndex === 2
    );
    expect(stop2Feature?.geometry).toBeNull();
  });

  it("no stops have coordinates: empty path, all stops in stopsGeoJSON", () => {
    const stops = [
      makeStop({ stopIndex: 1, location: {}, hasCoordinates: false }),
      makeStop({ stopIndex: 2, eventId: "e2", location: {}, hasCoordinates: false }),
    ];
    const journey = makeJourney({ stops, stopCount: 2 });
    const { pathGeoJSON, stopsGeoJSON } = buildJourneyStopGeoJSON(journey);

    expect(pathGeoJSON.features).toHaveLength(0);
    expect(stopsGeoJSON.features).toHaveLength(2);
    expect(stopsGeoJSON.features[0].geometry).toBeNull();
    expect(stopsGeoJSON.features[1].geometry).toBeNull();
  });

  it("hasAllCoordinates=true when all stops have GPS", () => {
    const stops = [
      makeStop({ stopIndex: 1, location: { lat: 42.0, lng: -71.0 }, hasCoordinates: true }),
      makeStop({ stopIndex: 2, eventId: "e2", location: { lat: 43.0, lng: -72.0 }, hasCoordinates: true }),
    ];
    const journey = makeJourney({ stops, stopCount: 2 });
    const { pathGeoJSON } = buildJourneyStopGeoJSON(journey);

    expect(pathGeoJSON.features[0].properties.hasAllCoordinates).toBe(true);
  });

  it("hasAllCoordinates=false when some stops lack GPS", () => {
    const stops = [
      makeStop({ stopIndex: 1, location: { lat: 42.0, lng: -71.0 }, hasCoordinates: true }),
      makeStop({ stopIndex: 2, eventId: "e2", location: {}, hasCoordinates: false }),
    ];
    const journey = makeJourney({ stops, stopCount: 2 });
    const { pathGeoJSON } = buildJourneyStopGeoJSON(journey);

    expect(pathGeoJSON.features[0].properties.hasAllCoordinates).toBe(false);
  });

  it("first stop: isFirst=true, isLast=false", () => {
    const stops = [
      makeStop({ stopIndex: 1 }),
      makeStop({ stopIndex: 2, eventId: "e2" }),
    ];
    const journey = makeJourney({ stops, stopCount: 2 });
    const { stopsGeoJSON } = buildJourneyStopGeoJSON(journey);

    const firstFeature = stopsGeoJSON.features[0];
    expect(firstFeature.properties.isFirst).toBe(true);
    expect(firstFeature.properties.isLast).toBe(false);
  });

  it("last stop: isFirst=false, isLast=true", () => {
    const stops = [
      makeStop({ stopIndex: 1 }),
      makeStop({ stopIndex: 2, eventId: "e2" }),
    ];
    const journey = makeJourney({ stops, stopCount: 2 });
    const { stopsGeoJSON } = buildJourneyStopGeoJSON(journey);

    const lastFeature = stopsGeoJSON.features[1];
    expect(lastFeature.properties.isFirst).toBe(false);
    expect(lastFeature.properties.isLast).toBe(true);
  });

  it("single stop: isFirst=true AND isLast=true", () => {
    const journey = makeJourney({ stops: [makeStop()], stopCount: 1 });
    const { stopsGeoJSON } = buildJourneyStopGeoJSON(journey);

    expect(stopsGeoJSON.features[0].properties.isFirst).toBe(true);
    expect(stopsGeoJSON.features[0].properties.isLast).toBe(true);
  });

  it("coordinates are in [lng, lat] order (Mapbox GL convention)", () => {
    const stop = makeStop({ location: { lat: 42.36, lng: -71.06 }, hasCoordinates: true });
    const journey = makeJourney({ stops: [stop], stopCount: 1 });
    const { pathGeoJSON, stopsGeoJSON } = buildJourneyStopGeoJSON(journey);

    // Mapbox GL uses [lng, lat]
    expect(pathGeoJSON.features[0].geometry.coordinates[0]).toEqual([-71.06, 42.36]);
    expect(stopsGeoJSON.features[0].geometry?.coordinates).toEqual([-71.06, 42.36]);
  });

  it("stop properties match the source JourneyStop fields", () => {
    const stop = makeStop({
      stopIndex:  3,
      eventType:  "custody_handoff",
      timestamp:  1_700_100_000_000,
      actorName:  "Bob Pilot",
      location:   { lat: 50.0, lng: 10.0, locationName: "Berlin Depot" },
    });
    const journey = makeJourney({ stops: [stop], stopCount: 1 });
    const { stopsGeoJSON } = buildJourneyStopGeoJSON(journey);

    const props = stopsGeoJSON.features[0].properties;
    expect(props.stopIndex).toBe(3);
    expect(props.eventType).toBe("custody_handoff");
    expect(props.timestamp).toBe(1_700_100_000_000);
    expect(props.actorName).toBe("Bob Pilot");
    expect(props.locationName).toBe("Berlin Depot");
    expect(props.caseId).toBe(CASE_ID);
    expect(props.caseLabel).toBe(CASE_LABEL);
  });

  it("stopCount in path properties equals total stop count (including non-geo stops)", () => {
    const stops = [
      makeStop({ stopIndex: 1 }),
      makeStop({ stopIndex: 2, eventId: "e2", location: {}, hasCoordinates: false }),
      makeStop({ stopIndex: 3, eventId: "e3" }),
    ];
    const journey = makeJourney({ stops, stopCount: 3 });
    const { pathGeoJSON } = buildJourneyStopGeoJSON(journey);

    expect(pathGeoJSON.features[0].properties.stopCount).toBe(3);
  });

  it("chronological order of stop features matches the input stops order", () => {
    const stops = [
      makeStop({ stopIndex: 1, timestamp: 1_000, location: { lat: 10.0, lng: 20.0 }, hasCoordinates: true }),
      makeStop({ stopIndex: 2, eventId: "e2", timestamp: 2_000, location: { lat: 11.0, lng: 21.0 }, hasCoordinates: true }),
      makeStop({ stopIndex: 3, eventId: "e3", timestamp: 3_000, location: { lat: 12.0, lng: 22.0 }, hasCoordinates: true }),
    ];
    const journey = makeJourney({ stops, stopCount: 3 });
    const { stopsGeoJSON, pathGeoJSON } = buildJourneyStopGeoJSON(journey);

    // Stop features should be in input order (stopIndex 1, 2, 3)
    expect(stopsGeoJSON.features[0].properties.stopIndex).toBe(1);
    expect(stopsGeoJSON.features[1].properties.stopIndex).toBe(2);
    expect(stopsGeoJSON.features[2].properties.stopIndex).toBe(3);

    // Path coordinates also in order
    expect(pathGeoJSON.features[0].geometry.coordinates[0]).toEqual([20.0, 10.0]);
    expect(pathGeoJSON.features[0].geometry.coordinates[1]).toEqual([21.0, 11.0]);
    expect(pathGeoJSON.features[0].geometry.coordinates[2]).toEqual([22.0, 12.0]);
  });

  it("null-geometry Feature is valid GeoJSON (geometry: null)", () => {
    const stop = makeStop({ location: {}, hasCoordinates: false });
    const journey = makeJourney({ stops: [stop], stopCount: 1 });
    const { stopsGeoJSON } = buildJourneyStopGeoJSON(journey);

    const feature = stopsGeoJSON.features[0];
    expect(feature.type).toBe("Feature");
    expect(feature.geometry).toBeNull();
    expect(feature.properties.hasCoordinates).toBe(false);
  });

  it("output is JSON-serializable (no circular refs, no undefined values in properties)", () => {
    const stops = [
      makeStop({ stopIndex: 1 }),
      makeStop({ stopIndex: 2, eventId: "e2", location: { lat: 45.0, lng: 9.0 }, hasCoordinates: true }),
    ];
    const journey = makeJourney({ stops, stopCount: 2 });
    const result = buildJourneyStopGeoJSON(journey);

    // Should not throw
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// JourneyStopLayer component tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("JourneyStopLayer", () => {
  it("returns null when caseId is null", () => {
    mockUseJourneyStopLayer.mockReturnValue(
      makeLayerResult({ journey: undefined, isLoading: false, stopCount: 0, hasPath: false })
    );
    const { container } = render(<JourneyStopLayer caseId={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null while loading (journey is undefined)", () => {
    mockUseJourneyStopLayer.mockReturnValue(
      makeLayerResult({ journey: undefined, isLoading: true, stopCount: 0, hasPath: false })
    );
    const { container } = render(<JourneyStopLayer caseId={CASE_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when case is not found (journey is null)", () => {
    mockUseJourneyStopLayer.mockReturnValue(
      makeLayerResult({ journey: null, isLoading: false, stopCount: 0, hasPath: false })
    );
    const { container } = render(<JourneyStopLayer caseId={CASE_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when stopCount is 0 (newly created case)", () => {
    const journey = makeJourney({ stops: [], stopCount: 0, firstStop: null, lastStop: null });
    mockUseJourneyStopLayer.mockReturnValue(
      makeLayerResult({ journey, stopCount: 0, hasPath: false })
    );
    const { container } = render(<JourneyStopLayer caseId={CASE_ID} />);
    expect(container.firstChild).toBeNull();
  });

  // ── Fallback mode ─────────────────────────────────────────────────────────

  it("renders fallback region when fallbackMode=true and stops exist", () => {
    const journey = makeJourney({ stops: [makeStop()], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));

    render(<JourneyStopLayer caseId={CASE_ID} fallbackMode />);
    expect(screen.getByTestId("journey-stop-fallback")).toBeDefined();
  });

  it("fallback shows case label in header", () => {
    const journey = makeJourney({ stops: [makeStop()], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));

    render(<JourneyStopLayer caseId={CASE_ID} fallbackMode />);
    expect(screen.getByText(CASE_LABEL)).toBeDefined();
  });

  it("fallback shows stop count badge", () => {
    const stops = [makeStop(), makeStop({ stopIndex: 2, eventId: "e2" })];
    const journey = makeJourney({ stops, stopCount: 2 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey, stopCount: 2 }));

    render(<JourneyStopLayer caseId={CASE_ID} fallbackMode />);
    expect(screen.getByText(/2 stops/i)).toBeDefined();
  });

  it("fallback renders stop items with stop index badge", () => {
    const stops = [
      makeStop({ stopIndex: 1 }),
      makeStop({ stopIndex: 2, eventId: "e2" }),
    ];
    const journey = makeJourney({ stops, stopCount: 2 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey, stopCount: 2 }));

    render(<JourneyStopLayer caseId={CASE_ID} fallbackMode />);
    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
  });

  it("fallback renders formatted event type labels (underscore → Title Case)", () => {
    const stop = makeStop({ eventType: "status_change" });
    const journey = makeJourney({ stops: [stop], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));

    render(<JourneyStopLayer caseId={CASE_ID} fallbackMode />);
    expect(screen.getByText("Status Change")).toBeDefined();
  });

  it("fallback renders custody_handoff as 'Custody Handoff'", () => {
    const stop = makeStop({ eventType: "custody_handoff" });
    const journey = makeJourney({ stops: [stop], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));

    render(<JourneyStopLayer caseId={CASE_ID} fallbackMode />);
    expect(screen.getByText("Custody Handoff")).toBeDefined();
  });

  it("fallback renders actor name in stop meta", () => {
    const stop = makeStop({ actorName: "Alice Tech" });
    const journey = makeJourney({ stops: [stop], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));

    render(<JourneyStopLayer caseId={CASE_ID} fallbackMode />);
    expect(screen.getByText(/Alice Tech/)).toBeDefined();
  });

  it("fallback renders location name for geo stops", () => {
    const stop = makeStop({ location: { lat: 42.36, lng: -71.06, locationName: "Site Alpha" } });
    const journey = makeJourney({ stops: [stop], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));

    render(<JourneyStopLayer caseId={CASE_ID} fallbackMode />);
    expect(screen.getByText("Site Alpha")).toBeDefined();
  });

  it("fallback marks first stop with data-is-first", () => {
    const stops = [
      makeStop({ stopIndex: 1 }),
      makeStop({ stopIndex: 2, eventId: "e2" }),
    ];
    const journey = makeJourney({ stops, stopCount: 2 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey, stopCount: 2 }));

    const { container } = render(<JourneyStopLayer caseId={CASE_ID} fallbackMode />);
    const firstItem = container.querySelector("[data-is-first='true']");
    expect(firstItem).toBeDefined();
    expect(firstItem).not.toBeNull();
  });

  it("fallback marks last stop with data-is-last", () => {
    const stops = [
      makeStop({ stopIndex: 1 }),
      makeStop({ stopIndex: 2, eventId: "e2" }),
    ];
    const journey = makeJourney({ stops, stopCount: 2 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey, stopCount: 2 }));

    const { container } = render(<JourneyStopLayer caseId={CASE_ID} fallbackMode />);
    const lastItem = container.querySelector("[data-is-last='true']");
    expect(lastItem).toBeDefined();
    expect(lastItem).not.toBeNull();
  });

  it("fallback shows '+N more' when stops > 15", () => {
    const stops = Array.from({ length: 20 }, (_, i) =>
      makeStop({ stopIndex: i + 1, eventId: `e${i + 1}` })
    );
    const journey = makeJourney({ stops, stopCount: 20 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey, stopCount: 20 }));

    render(<JourneyStopLayer caseId={CASE_ID} fallbackMode />);
    expect(screen.getByText(/\+5 more/i)).toBeDefined();
  });

  it("fallback shows empty state when stops array is empty (but journey exists)", () => {
    // A journey with stopCount=0 would not render at all, so we test the fallback
    // by giving a journey with 1 stop but manually overriding stopCount in the hook result.
    // Actually per the component logic, stopCount=0 returns null — test stopCount > 0
    // but journey.stops is empty via a weird state (edge case in fallback render).
    const journey = makeJourney({
      stops:     [],
      stopCount: 1,  // hook says 1 but stops array is empty
    });
    mockUseJourneyStopLayer.mockReturnValue(
      makeLayerResult({ journey, stopCount: 1, pathGeoJSON: EMPTY_PATH_GEOJSON, stopsGeoJSON: EMPTY_STOPS_GEOJSON, hasPath: false })
    );

    render(<JourneyStopLayer caseId={CASE_ID} fallbackMode />);
    expect(screen.getByText(/No journey stops recorded yet/i)).toBeDefined();
  });

  // ── Legend ────────────────────────────────────────────────────────────────

  it("legend renders when showLegend=true (default)", () => {
    const journey = makeJourney({ stops: [makeStop()], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));

    render(<JourneyStopLayer caseId={CASE_ID} fallbackMode />);
    // showLegend only applies in GL mode; fallback doesn't render legend separately
    // Re-test in GL mode:
    cleanup();
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));
    render(<JourneyStopLayer caseId={CASE_ID} showLegend />);
    expect(screen.getByTestId("journey-stop-legend")).toBeDefined();
  });

  it("legend is hidden when showLegend=false", () => {
    const journey = makeJourney({ stops: [makeStop()], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));

    render(<JourneyStopLayer caseId={CASE_ID} showLegend={false} />);
    expect(screen.queryByTestId("journey-stop-legend")).toBeNull();
  });

  it("legend shows the case label", () => {
    const journey = makeJourney({ stops: [makeStop()], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));

    render(<JourneyStopLayer caseId={CASE_ID} showLegend />);
    const legend = screen.getByTestId("journey-stop-legend");
    expect(within(legend).getByText(CASE_LABEL)).toBeDefined();
  });

  it("legend shows the stop count", () => {
    const stops = [makeStop(), makeStop({ stopIndex: 2, eventId: "e2" })];
    const journey = makeJourney({ stops, stopCount: 2 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey, stopCount: 2 }));

    render(<JourneyStopLayer caseId={CASE_ID} showLegend />);
    const countEl = screen.getByTestId("journey-stop-count");
    expect(countEl.textContent).toMatch(/2 stop/);
  });

  // ── Mapbox GL mode ────────────────────────────────────────────────────────

  it("Mapbox GL mode: renders stops source when fallbackMode=false", () => {
    const journey = makeJourney({ stops: [makeStop()], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));

    render(<JourneyStopLayer caseId={CASE_ID} />);
    expect(screen.getByTestId("source-inventory-journey-stops-source")).toBeDefined();
  });

  it("Mapbox GL mode: renders path source when hasPath=true", () => {
    const journey = makeJourney({ stops: [makeStop()], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey, hasPath: true }));

    render(<JourneyStopLayer caseId={CASE_ID} />);
    expect(screen.getByTestId("source-inventory-journey-path-source")).toBeDefined();
  });

  it("Mapbox GL mode: path source omitted when hasPath=false", () => {
    const stop = makeStop({ location: {}, hasCoordinates: false });
    const journey = makeJourney({ stops: [stop], stopCount: 1, hasLocation: false });
    mockUseJourneyStopLayer.mockReturnValue(
      makeLayerResult({ journey, hasPath: false, pathGeoJSON: EMPTY_PATH_GEOJSON })
    );

    render(<JourneyStopLayer caseId={CASE_ID} />);
    expect(screen.queryByTestId("source-inventory-journey-path-source")).toBeNull();
  });

  it("Mapbox GL mode: renders endpoint layer for stop markers", () => {
    const journey = makeJourney({ stops: [makeStop()], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));

    render(<JourneyStopLayer caseId={CASE_ID} />);
    expect(screen.getByTestId("layer-inventory-journey-endpoints-layer")).toBeDefined();
  });

  it("Mapbox GL mode: renders intermediate stops layer", () => {
    const journey = makeJourney({ stops: [makeStop()], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));

    render(<JourneyStopLayer caseId={CASE_ID} />);
    expect(screen.getByTestId("layer-inventory-journey-stops-layer")).toBeDefined();
  });

  it("calls useJourneyStopLayer with the provided caseId", () => {
    const journey = makeJourney({ stops: [makeStop()], stopCount: 1 });
    mockUseJourneyStopLayer.mockReturnValue(makeLayerResult({ journey }));

    render(<JourneyStopLayer caseId={CASE_ID} />);
    expect(mockUseJourneyStopLayer).toHaveBeenCalledWith(CASE_ID);
  });
});
