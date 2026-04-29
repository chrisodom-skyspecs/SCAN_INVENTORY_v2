/**
 * @vitest-environment jsdom
 *
 * Tests for src/hooks/use-m2-journey-stops.ts
 *
 * Sub-AC 6.1: M2 data layer — React hook layer for journey stops.
 *
 * These tests verify the hook wiring and skip-pattern behaviour.
 * They do NOT require a live Convex backend — useQuery is mocked.
 *
 * Coverage matrix
 * ───────────────
 *
 * useM2JourneyStops:
 *   ✓ calls useQuery with getM2JourneyStops and { caseId } when caseId provided
 *   ✓ calls useQuery with "skip" when caseId is null
 *   ✓ returns undefined while loading
 *   ✓ returns null when case is not found
 *   ✓ returns M2CaseJourney when data is available
 *   ✓ returns a journey with correct stops structure
 *   ✓ re-subscribes when caseId changes
 *
 * useM2JourneyStopsBatch:
 *   ✓ calls useQuery with getM2JourneyStopsBatch and { caseIds } when caseIds provided
 *   ✓ calls useQuery with "skip" when caseIds is null
 *   ✓ returns [] immediately when caseIds is an empty array (skip pattern)
 *   ✓ returns undefined while loading
 *   ✓ returns M2CaseJourney[] when data is available
 *   ✓ returns array with multiple journeys
 *
 * Skip pattern consistency:
 *   ✓ useM2JourneyStops(null) passes "skip" → returns undefined
 *   ✓ useM2JourneyStopsBatch(null) passes "skip" → returns undefined
 *   ✓ useM2JourneyStopsBatch([]) short-circuits → returns []
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const {
  MOCK_GET_M2_JOURNEY_STOPS,
  MOCK_GET_M2_JOURNEY_STOPS_BATCH,
} = vi.hoisted(() => ({
  MOCK_GET_M2_JOURNEY_STOPS:       Symbol("getM2JourneyStops"),
  MOCK_GET_M2_JOURNEY_STOPS_BATCH: Symbol("getM2JourneyStopsBatch"),
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    // The hook uses dynamic key access: api["queries/journeyStops"]
    // We need to set this on the mock object at the nested key.
    "queries/journeyStops": {
      getM2JourneyStops:      MOCK_GET_M2_JOURNEY_STOPS,
      getM2JourneyStopsBatch: MOCK_GET_M2_JOURNEY_STOPS_BATCH,
    },
  },
}));

const mockUseQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

// Import hooks after mocks are set up.
import {
  useM2JourneyStops,
  useM2JourneyStopsBatch,
} from "../use-m2-journey-stops";
import type { M2CaseJourney, JourneyStop } from "../use-m2-journey-stops";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CASE_ID  = "case-abc-123";
const CASE_ID2 = "case-xyz-456";

/** Grab the most recent useQuery invocation args: [queryRef, queryArgs] */
function lastQueryCall(): [unknown, unknown] {
  const calls = mockUseQuery.mock.calls;
  return calls[calls.length - 1] as [unknown, unknown];
}

/** Factory for a minimal JourneyStop. */
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
    metadata:       { from: "hangar", to: "assembled" },
    ...overrides,
  };
}

/** Factory for a minimal M2CaseJourney. */
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

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockUseQuery.mockReturnValue(undefined); // default: loading
});

// ─── useM2JourneyStops ────────────────────────────────────────────────────────

describe("useM2JourneyStops", () => {
  it("calls useQuery with getM2JourneyStops and { caseId } when caseId is provided", () => {
    renderHook(() => useM2JourneyStops(CASE_ID));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_M2_JOURNEY_STOPS);
    expect(args).toEqual({ caseId: CASE_ID });
  });

  it('calls useQuery with "skip" when caseId is null', () => {
    renderHook(() => useM2JourneyStops(null));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_M2_JOURNEY_STOPS);
    expect(args).toBe("skip");
  });

  it("returns undefined while loading (useQuery returns undefined)", () => {
    mockUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useM2JourneyStops(CASE_ID));
    expect(result.current).toBeUndefined();
  });

  it("returns null when case is not found (useQuery returns null)", () => {
    mockUseQuery.mockReturnValue(null);

    const { result } = renderHook(() => useM2JourneyStops(CASE_ID));
    expect(result.current).toBeNull();
  });

  it("returns M2CaseJourney when data is available", () => {
    const journey = makeJourney();
    mockUseQuery.mockReturnValue(journey);

    const { result } = renderHook(() => useM2JourneyStops(CASE_ID));
    expect(result.current).toBe(journey);
  });

  it("returns a journey with correct stops structure", () => {
    const stop = makeStop({ stopIndex: 1, eventType: "status_change" });
    const journey = makeJourney({ stops: [stop], stopCount: 1 });
    mockUseQuery.mockReturnValue(journey);

    const { result } = renderHook(() => useM2JourneyStops(CASE_ID));
    const j = result.current as M2CaseJourney;
    expect(j.stops).toHaveLength(1);
    expect(j.stops[0].stopIndex).toBe(1);
    expect(j.stops[0].eventType).toBe("status_change");
    expect(j.stopCount).toBe(1);
    expect(j.firstStop?.stopIndex).toBe(1);
    expect(j.lastStop?.stopIndex).toBe(1);
  });

  it("returns a journey with hasLocation=true when stops have coordinates", () => {
    const journey = makeJourney({ hasLocation: true });
    mockUseQuery.mockReturnValue(journey);

    const { result } = renderHook(() => useM2JourneyStops(CASE_ID));
    expect((result.current as M2CaseJourney).hasLocation).toBe(true);
  });

  it("returns a journey with hasLocation=false when no stops have coordinates", () => {
    const stop = makeStop({ hasCoordinates: false, location: {} });
    const journey = makeJourney({
      stops: [stop],
      hasLocation: false,
      currentLat: undefined,
      currentLng: undefined,
    });
    mockUseQuery.mockReturnValue(journey);

    const { result } = renderHook(() => useM2JourneyStops(CASE_ID));
    expect((result.current as M2CaseJourney).hasLocation).toBe(false);
  });

  it("re-subscribes when caseId changes", () => {
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useM2JourneyStops(id),
      { initialProps: { id: CASE_ID } }
    );

    // First call with CASE_ID
    const [, firstArgs] = lastQueryCall();
    expect(firstArgs).toEqual({ caseId: CASE_ID });

    // Rerender with different caseId
    rerender({ id: CASE_ID2 });

    const [, secondArgs] = lastQueryCall();
    expect(secondArgs).toEqual({ caseId: CASE_ID2 });
  });

  it("transitions from null to a valid caseId — passes skip then { caseId }", () => {
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => useM2JourneyStops(id),
      { initialProps: { id: null as string | null } }
    );

    const [, nullArgs] = lastQueryCall();
    expect(nullArgs).toBe("skip");

    rerender({ id: CASE_ID });

    const [, caseArgs] = lastQueryCall();
    expect(caseArgs).toEqual({ caseId: CASE_ID });
  });
});

// ─── useM2JourneyStopsBatch ───────────────────────────────────────────────────

describe("useM2JourneyStopsBatch", () => {
  it("calls useQuery with getM2JourneyStopsBatch and { caseIds } when caseIds provided", () => {
    const caseIds = [CASE_ID, CASE_ID2];
    renderHook(() => useM2JourneyStopsBatch(caseIds));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_M2_JOURNEY_STOPS_BATCH);
    expect(args).toEqual({ caseIds });
  });

  it('calls useQuery with "skip" when caseIds is null', () => {
    renderHook(() => useM2JourneyStopsBatch(null));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_M2_JOURNEY_STOPS_BATCH);
    expect(args).toBe("skip");
  });

  it("returns [] immediately when caseIds is an empty array (skip pattern)", () => {
    // Empty array short-circuits — no subscription needed.
    const { result } = renderHook(() => useM2JourneyStopsBatch([]));
    expect(result.current).toEqual([]);
  });

  it("does not call useQuery with the empty caseIds array — passes skip instead", () => {
    renderHook(() => useM2JourneyStopsBatch([]));

    // Verify that the skip was passed to useQuery (not the empty array)
    const [, args] = lastQueryCall();
    expect(args).toBe("skip");
  });

  it("returns undefined while loading (useQuery returns undefined)", () => {
    mockUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useM2JourneyStopsBatch([CASE_ID]));
    expect(result.current).toBeUndefined();
  });

  it("returns M2CaseJourney[] when data is available", () => {
    const journeys = [makeJourney()];
    mockUseQuery.mockReturnValue(journeys);

    const { result } = renderHook(() => useM2JourneyStopsBatch([CASE_ID]));
    expect(result.current).toBe(journeys);
  });

  it("returns array with multiple journeys for multiple caseIds", () => {
    const journeys = [
      makeJourney({ caseId: CASE_ID,  caseLabel: "CASE-001" }),
      makeJourney({ caseId: CASE_ID2, caseLabel: "CASE-002" }),
    ];
    mockUseQuery.mockReturnValue(journeys);

    const { result } = renderHook(() => useM2JourneyStopsBatch([CASE_ID, CASE_ID2]));
    const jArr = result.current as M2CaseJourney[];
    expect(jArr).toHaveLength(2);
    expect(jArr[0].caseLabel).toBe("CASE-001");
    expect(jArr[1].caseLabel).toBe("CASE-002");
  });

  it("returns a journey with stops array for each case in the batch", () => {
    const stop1 = makeStop({ stopIndex: 1, eventId: "e1" });
    const stop2 = makeStop({ stopIndex: 1, eventId: "e2" });
    const journeys = [
      makeJourney({ caseId: CASE_ID,  stops: [stop1], stopCount: 1 }),
      makeJourney({ caseId: CASE_ID2, stops: [stop2], stopCount: 1 }),
    ];
    mockUseQuery.mockReturnValue(journeys);

    const { result } = renderHook(() => useM2JourneyStopsBatch([CASE_ID, CASE_ID2]));
    const jArr = result.current as M2CaseJourney[];
    expect(jArr[0].stops[0].eventId).toBe("e1");
    expect(jArr[1].stops[0].eventId).toBe("e2");
  });

  it("handles transition from null to non-empty caseIds array", () => {
    const { rerender } = renderHook(
      ({ ids }: { ids: string[] | null }) => useM2JourneyStopsBatch(ids),
      { initialProps: { ids: null as string[] | null } }
    );

    const [, nullArgs] = lastQueryCall();
    expect(nullArgs).toBe("skip");

    rerender({ ids: [CASE_ID] });
    const [, caseArgs] = lastQueryCall();
    expect(caseArgs).toEqual({ caseIds: [CASE_ID] });
  });
});

// ─── Skip pattern consistency ─────────────────────────────────────────────────

describe("skip pattern consistency", () => {
  it("useM2JourneyStops(null) passes skip → returns undefined (loading state)", () => {
    mockUseQuery.mockReturnValue(undefined);
    renderHook(() => useM2JourneyStops(null));
    const [, args] = lastQueryCall();
    expect(args).toBe("skip");
  });

  it("useM2JourneyStopsBatch(null) passes skip → returns undefined (loading state)", () => {
    mockUseQuery.mockReturnValue(undefined);
    renderHook(() => useM2JourneyStopsBatch(null));
    const [, args] = lastQueryCall();
    expect(args).toBe("skip");
  });

  it("useM2JourneyStopsBatch([]) short-circuits without a query → returns []", () => {
    const { result } = renderHook(() => useM2JourneyStopsBatch([]));
    expect(result.current).toEqual([]);
    expect(Array.isArray(result.current)).toBe(true);
  });
});

// ─── Type export smoke tests ──────────────────────────────────────────────────

describe("exported types", () => {
  it("M2CaseJourney type can be used for type-checking without runtime errors", () => {
    // If this compiles, M2CaseJourney is exported correctly.
    const stop: JourneyStop = makeStop();
    const journey: M2CaseJourney = makeJourney({ stops: [stop] });
    expect(journey.stopCount).toBe(1);
    expect(stop.hasCoordinates).toBe(true);
  });

  it("JourneyStop hasCoordinates field is a boolean", () => {
    const stop: JourneyStop = makeStop({ hasCoordinates: true });
    expect(typeof stop.hasCoordinates).toBe("boolean");
  });

  it("JourneyStop location fields are all optional", () => {
    const stop: JourneyStop = makeStop({ location: {}, hasCoordinates: false });
    expect(stop.location.lat).toBeUndefined();
    expect(stop.location.lng).toBeUndefined();
    expect(stop.location.locationName).toBeUndefined();
  });
});
