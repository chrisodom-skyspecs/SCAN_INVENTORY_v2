/**
 * @vitest-environment jsdom
 *
 * Tests for src/hooks/use-journey-stop-layer.ts
 *
 * Sub-AC 6.2: M2 data layer — useJourneyStopLayer hook.
 *
 * These tests verify the hook wiring, GeoJSON memoisation, and return-value
 * semantics.  They do NOT require a live Convex backend — useM2JourneyStops
 * is mocked.
 *
 * Coverage matrix
 * ───────────────
 *
 * useJourneyStopLayer:
 *   ✓ calls useM2JourneyStops with the provided caseId
 *   ✓ calls useM2JourneyStops with null when caseId is null
 *   ✓ isLoading=true while journey is undefined
 *   ✓ isLoading=false when journey is null (case not found)
 *   ✓ isLoading=false when journey data is available
 *   ✓ returns empty GeoJSONs while loading
 *   ✓ returns empty GeoJSONs when journey is null
 *   ✓ returns populated GeoJSONs when journey has stops
 *   ✓ stopCount=0 while loading
 *   ✓ stopCount=0 when journey is null
 *   ✓ stopCount matches journey.stopCount when data available
 *   ✓ hasPath=false when no geo-referenced stops
 *   ✓ hasPath=true when stops have coordinates
 *   ✓ GeoJSON is memoised — same reference when journey reference unchanged
 *   ✓ GeoJSON recomputed when journey reference changes (new Convex push)
 *   ✓ re-subscribes when caseId changes
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  EMPTY_PATH_GEOJSON,
  EMPTY_STOPS_GEOJSON,
} from "../use-journey-stop-layer";
import type { M2CaseJourney, JourneyStop } from "../use-m2-journey-stops";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock useM2JourneyStops — fully controlled in each test
const mockUseM2JourneyStops = vi.fn();
vi.mock("../use-m2-journey-stops", () => ({
  useM2JourneyStops: (caseId: string | null) => mockUseM2JourneyStops(caseId),
}));

// Import hook AFTER mocks are set up
import { useJourneyStopLayer } from "../use-journey-stop-layer";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID  = "case-abc-123";
const CASE_ID2 = "case-xyz-456";

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

function makeJourney(overrides: Partial<M2CaseJourney> = {}): M2CaseJourney {
  const stop = makeStop();
  return {
    caseId:              CASE_ID,
    caseLabel:           "CASE-001",
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

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockUseM2JourneyStops.mockReturnValue(undefined); // default: loading
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useJourneyStopLayer", () => {
  it("calls useM2JourneyStops with the provided caseId", () => {
    renderHook(() => useJourneyStopLayer(CASE_ID));
    expect(mockUseM2JourneyStops).toHaveBeenCalledWith(CASE_ID);
  });

  it("calls useM2JourneyStops with null when caseId is null", () => {
    renderHook(() => useJourneyStopLayer(null));
    expect(mockUseM2JourneyStops).toHaveBeenCalledWith(null);
  });

  it("isLoading=true while journey is undefined (initial fetch)", () => {
    mockUseM2JourneyStops.mockReturnValue(undefined);
    const { result } = renderHook(() => useJourneyStopLayer(CASE_ID));
    expect(result.current.isLoading).toBe(true);
  });

  it("isLoading=false when journey is null (case not found)", () => {
    mockUseM2JourneyStops.mockReturnValue(null);
    const { result } = renderHook(() => useJourneyStopLayer(CASE_ID));
    expect(result.current.isLoading).toBe(false);
  });

  it("isLoading=false when journey data is available", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney());
    const { result } = renderHook(() => useJourneyStopLayer(CASE_ID));
    expect(result.current.isLoading).toBe(false);
  });

  it("returns empty GeoJSONs while loading (journey undefined)", () => {
    mockUseM2JourneyStops.mockReturnValue(undefined);
    const { result } = renderHook(() => useJourneyStopLayer(CASE_ID));
    expect(result.current.pathGeoJSON).toBe(EMPTY_PATH_GEOJSON);
    expect(result.current.stopsGeoJSON).toBe(EMPTY_STOPS_GEOJSON);
  });

  it("returns empty GeoJSONs when journey is null (case not found)", () => {
    mockUseM2JourneyStops.mockReturnValue(null);
    const { result } = renderHook(() => useJourneyStopLayer(CASE_ID));
    expect(result.current.pathGeoJSON).toBe(EMPTY_PATH_GEOJSON);
    expect(result.current.stopsGeoJSON).toBe(EMPTY_STOPS_GEOJSON);
  });

  it("returns populated GeoJSONs when journey has stops", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney());
    const { result } = renderHook(() => useJourneyStopLayer(CASE_ID));
    expect(result.current.stopsGeoJSON.features).toHaveLength(1);
  });

  it("stopCount=0 while loading", () => {
    mockUseM2JourneyStops.mockReturnValue(undefined);
    const { result } = renderHook(() => useJourneyStopLayer(CASE_ID));
    expect(result.current.stopCount).toBe(0);
  });

  it("stopCount=0 when journey is null", () => {
    mockUseM2JourneyStops.mockReturnValue(null);
    const { result } = renderHook(() => useJourneyStopLayer(CASE_ID));
    expect(result.current.stopCount).toBe(0);
  });

  it("stopCount matches journey.stopCount when data available", () => {
    const stops = [
      makeStop({ stopIndex: 1 }),
      makeStop({ stopIndex: 2, eventId: "e2" }),
      makeStop({ stopIndex: 3, eventId: "e3" }),
    ];
    mockUseM2JourneyStops.mockReturnValue(makeJourney({ stops, stopCount: 3 }));
    const { result } = renderHook(() => useJourneyStopLayer(CASE_ID));
    expect(result.current.stopCount).toBe(3);
  });

  it("hasPath=false when no geo-referenced stops", () => {
    const stop = makeStop({ location: {}, hasCoordinates: false });
    mockUseM2JourneyStops.mockReturnValue(
      makeJourney({ stops: [stop], stopCount: 1, hasLocation: false })
    );
    const { result } = renderHook(() => useJourneyStopLayer(CASE_ID));
    expect(result.current.hasPath).toBe(false);
  });

  it("hasPath=true when stops have coordinates", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney());
    const { result } = renderHook(() => useJourneyStopLayer(CASE_ID));
    expect(result.current.hasPath).toBe(true);
  });

  it("journey field exposes the raw M2CaseJourney", () => {
    const journey = makeJourney();
    mockUseM2JourneyStops.mockReturnValue(journey);
    const { result } = renderHook(() => useJourneyStopLayer(CASE_ID));
    expect(result.current.journey).toBe(journey);
  });

  it("GeoJSON is memoised — same reference when journey reference unchanged", () => {
    const journey = makeJourney();
    mockUseM2JourneyStops.mockReturnValue(journey);

    const { result, rerender } = renderHook(() => useJourneyStopLayer(CASE_ID));
    const firstPath  = result.current.pathGeoJSON;
    const firstStops = result.current.stopsGeoJSON;

    // Re-render with the same journey reference
    rerender();

    expect(result.current.pathGeoJSON).toBe(firstPath);
    expect(result.current.stopsGeoJSON).toBe(firstStops);
  });

  it("GeoJSON recomputed when journey reference changes (Convex push)", () => {
    const journey1 = makeJourney({ stops: [makeStop()], stopCount: 1 });
    mockUseM2JourneyStops.mockReturnValue(journey1);

    const { result, rerender } = renderHook(() => useJourneyStopLayer(CASE_ID));
    const firstStops = result.current.stopsGeoJSON;

    // Simulate Convex pushing a new journey object with 2 stops
    const stop2 = makeStop({ stopIndex: 2, eventId: "e2" });
    const journey2 = makeJourney({ stops: [makeStop(), stop2], stopCount: 2 });
    mockUseM2JourneyStops.mockReturnValue(journey2);
    rerender();

    // GeoJSON should be a new reference (recomputed)
    expect(result.current.stopsGeoJSON).not.toBe(firstStops);
    expect(result.current.stopsGeoJSON.features).toHaveLength(2);
  });

  it("re-subscribes when caseId changes", () => {
    mockUseM2JourneyStops.mockReturnValue(makeJourney());

    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useJourneyStopLayer(id),
      { initialProps: { id: CASE_ID } }
    );

    expect(mockUseM2JourneyStops).toHaveBeenLastCalledWith(CASE_ID);

    rerender({ id: CASE_ID2 });
    expect(mockUseM2JourneyStops).toHaveBeenLastCalledWith(CASE_ID2);
  });

  it("empty GeoJSONs use stable singleton references (no re-allocation)", () => {
    mockUseM2JourneyStops.mockReturnValue(undefined);
    const { result, rerender } = renderHook(() => useJourneyStopLayer(CASE_ID));

    const ref1 = result.current.pathGeoJSON;
    rerender();
    const ref2 = result.current.pathGeoJSON;

    expect(ref1).toBe(ref2);
    expect(ref1).toBe(EMPTY_PATH_GEOJSON);
  });
});
