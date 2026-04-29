// @vitest-environment jsdom

/**
 * Location-change reactivity tests — Sub-AC 2
 *
 * Validates that Convex useQuery subscriptions wired to map mode components
 * (M1–M5) cause reactive re-renders when case location (lat/lng) data changes.
 *
 * Architecture under test
 * ────────────────────────
 * Case location data lives in the `cases` table as three optional fields:
 *   cases.lat          — WGS-84 latitude
 *   cases.lng          — WGS-84 longitude
 *   cases.locationName — human-readable location string
 *
 * There is NO separate "caseLocations" table. Convex's reactive dependency
 * tracking automatically invalidates and re-evaluates any active query
 * subscription whenever a `cases` row is written — including lat/lng writes.
 *
 * Flow:
 *   SCAN mutation writes cases.lat/lng
 *   → Convex marks all subscriptions that read `cases` as stale
 *   → Convex re-evaluates those queries server-side (~100–300ms)
 *   → Convex pushes the diff to all connected clients
 *   → useQuery's result changes → React re-renders the component
 *
 * Test strategy
 * ─────────────
 * These tests mock `convex/react` `useQuery` to simulate the subscription
 * push by changing what the mock returns between renders — exactly as the
 * Convex runtime would deliver a new result when a mutation fires.
 *
 * Each test:
 *   1. Renders a hook with initial data (cases without lat/lng, or with
 *      an initial position).
 *   2. Simulates a Convex push by changing the mock return value.
 *   3. Asserts that the hook's output reflects the updated coordinates
 *      without any explicit page refresh or manual data reload.
 *
 * Covered scenarios
 * ─────────────────
 *   1. useCasesMapPayload: case gains lat/lng → coordinates appear in payload
 *   2. useCasesMapPayload: case lat/lng moves → updated coordinates in payload
 *   3. useCasesMapPayload: case loses lat/lng → coordinates become undefined
 *   4. useCasesMapPayload: summary.withLocation increments when case gains coords
 *   5. useCasesMapPayload: modeFlags.hasCoordinates flips true→true when coords set
 *   6. useCasesMapPayload: modeFlags.hasCoordinates flips false→true on first coords
 *   7. useCasesMapPayload: modeFlags.hasCoordinates flips true→false when coords removed
 *   8. useCaseMapData (M1): case lat/lng update → record.lat/lng update
 *   9. useCaseMapData (M1): case gains coords from undefined → record has coords
 *  10. useCaseMapData (M2): case in mission group lat/lng update → record updated
 *  11. useCaseMapData (M3): field case lat/lng update → record updated alongside
 *      inspection progress (both location and inspection data stay consistent)
 *  12. useCaseMapData (M4): shipment currentLat/Lng update → record.lat/lng update
 *  13. normaliseM1Records: lat/lng pass-through from M1CasePin (pure function)
 *  14. normaliseM2Records: lat/lng pass-through for mission-group cases (pure)
 *  15. normaliseM2Records: lat/lng pass-through for unassigned cases (pure)
 *  16. normaliseM3Records: lat/lng pass-through from M3CasePin (pure function)
 *  17. normaliseM4Records: currentLat/Lng as primary position (pure function)
 *  18. normaliseM4Records: fallback to destination.lat/lng when no currentLat
 *  19. Multiple cases: only the mutated case's coordinates update; others unchanged
 *  20. Subscription stays active across location updates (no re-subscribe)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type {
  CasesMapPayloadResponse,
  CaseMapPayload,
  CaseModeFlags,
  M1Response,
  M2Response,
  M3Response,
  M4Response,
} from "../../../convex/maps";
import {
  normaliseM1Records,
  normaliseM2Records,
  normaliseM3Records,
  normaliseM4Records,
} from "../use-case-map-data";

// ─── Mock convex/react ────────────────────────────────────────────────────────

const mockUseQueryFn = vi.fn();

vi.mock("convex/react", () => ({
  useQuery:    (...args: unknown[]) => mockUseQueryFn(...args),
  useMutation: vi.fn(),
  useConvexAuth: vi.fn().mockReturnValue({ isAuthenticated: false, isLoading: true }),
  ConvexProvider:    ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ConvexReactClient: vi.fn(),
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    mapData: {
      getM1MapData:         "mapData:getM1MapData",
      getM2MapData:         "mapData:getM2MapData",
      getM3MapData:         "mapData:getM3MapData",
      getM4MapData:         "mapData:getM4MapData",
      getM5MapData:         "mapData:getM5MapData",
      getCasesMapPayload:   "mapData:getCasesMapPayload",
    },
  },
}));

// ─── Import hooks after mocks ─────────────────────────────────────────────────

import React from "react";
import { useCaseMapData } from "../use-case-map-data";
import { useCasesMapPayload } from "../use-cases-map-payload";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFlags(overrides: Partial<CaseModeFlags> = {}): CaseModeFlags {
  return {
    isFleetVisible:    true,
    isMissionAssigned: false,
    isFieldActive:     false,
    isInTransit:       false,
    hasCoordinates:    false,
    ...overrides,
  };
}

function makeCase(overrides: Partial<CaseMapPayload> = {}): CaseMapPayload {
  return {
    id:        "case_001",
    label:     "CASE-001",
    qrCode:    "QR-001",
    status:    "deployed",
    modeFlags: makeFlags(),
    updatedAt: 1_700_000_000_000,
    createdAt: 1_699_000_000_000,
    ...overrides,
  };
}

function makePayload(
  cases: CaseMapPayload[],
  summaryOverrides: Partial<CasesMapPayloadResponse["summary"]> = {}
): CasesMapPayloadResponse {
  const withLocation = cases.filter(
    (c) => c.lat !== undefined && c.lng !== undefined
  ).length;
  return {
    ts:   Date.now(),
    cases,
    summary: {
      total:           cases.length,
      withLocation,
      byStatus:        {},
      fieldActive:     cases.filter((c) => c.modeFlags.isFieldActive).length,
      inTransit:       cases.filter((c) => c.modeFlags.isInTransit).length,
      missionAssigned: cases.filter((c) => c.modeFlags.isMissionAssigned).length,
      ...summaryOverrides,
    },
  };
}

/** Build a minimal M1Response containing one case pin. */
function makeM1Response(cases: M1Response["cases"]): M1Response {
  const withLocation = cases.filter((c) => c.lat !== undefined).length;
  return {
    mode:  "M1",
    ts:    Date.now(),
    cases,
    summary: {
      total:        cases.length,
      withLocation,
      byStatus:     {},
    },
  };
}

/** Build a minimal M2Response with one mission group. */
function makeM2Response(
  missionCases: M2Response["missions"][number]["cases"],
  unassigned: M2Response["unassigned"] = []
): M2Response {
  return {
    mode:     "M2",
    ts:       Date.now(),
    missions: [
      {
        _id:         "mission_001",
        name:        "Test Mission",
        status:      "active",
        lat:         40.0,
        lng:         -74.0,
        caseCount:   missionCases.length,
        byStatus:    {},
        cases:       missionCases,
      },
    ],
    unassigned,
    summary: {
      total:           missionCases.length + unassigned.length,
      totalMissions:   1,
      byMissionStatus: {},
    },
  };
}

/** Build a minimal M3Response containing one field case pin. */
function makeM3Response(cases: M3Response["cases"]): M3Response {
  return {
    mode:  "M3",
    ts:    Date.now(),
    cases,
    summary: {
      total:              cases.length,
      byInspectionStatus: {},
      totalDamaged:       0,
      totalMissing:       0,
    },
  };
}

/** Build a minimal M4Response containing one shipment pin. */
function makeM4Response(shipments: M4Response["shipments"]): M4Response {
  return {
    mode:     "M4",
    ts:       Date.now(),
    shipments,
    summary: {
      total:    shipments.length,
      byStatus: {},
      inTransit: 0,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Location-change reactivity (Sub-AC 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── useCasesMapPayload location reactivity ─────────────────────────────────

  describe("useCasesMapPayload — location-change reactivity", () => {
    it("Scenario 1: case gains lat/lng → coordinates appear in payload", () => {
      // Initial state: case has no coordinates
      const initialCase = makeCase({ id: "c1", lat: undefined, lng: undefined });
      mockUseQueryFn.mockReturnValue(makePayload([initialCase]));

      const { result, rerender } = renderHook(() => useCasesMapPayload({}));

      expect(result.current.cases[0].lat).toBeUndefined();
      expect(result.current.cases[0].lng).toBeUndefined();

      // Simulate Convex push: case now has lat/lng
      const updatedCase = makeCase({
        id:  "c1",
        lat: 47.6062,
        lng: -122.3321,
        modeFlags: makeFlags({ hasCoordinates: true }),
      });
      act(() => {
        mockUseQueryFn.mockReturnValue(makePayload([updatedCase]));
        rerender();
      });

      expect(result.current.cases[0].lat).toBe(47.6062);
      expect(result.current.cases[0].lng).toBe(-122.3321);
    });

    it("Scenario 2: case lat/lng moves → updated coordinates in payload", () => {
      const caseAtSeattle = makeCase({
        id:  "c1",
        lat: 47.6062,
        lng: -122.3321,
        modeFlags: makeFlags({ hasCoordinates: true }),
      });
      mockUseQueryFn.mockReturnValue(makePayload([caseAtSeattle]));

      const { result, rerender } = renderHook(() => useCasesMapPayload({}));

      expect(result.current.cases[0].lat).toBe(47.6062);
      expect(result.current.cases[0].lng).toBe(-122.3321);

      // Case moved to Denver
      const caseAtDenver = makeCase({
        id:  "c1",
        lat: 39.7392,
        lng: -104.9903,
        modeFlags: makeFlags({ hasCoordinates: true }),
      });
      act(() => {
        mockUseQueryFn.mockReturnValue(makePayload([caseAtDenver]));
        rerender();
      });

      expect(result.current.cases[0].lat).toBe(39.7392);
      expect(result.current.cases[0].lng).toBe(-104.9903);
    });

    it("Scenario 3: case loses lat/lng → coordinates become undefined", () => {
      const caseWithCoords = makeCase({
        id:  "c1",
        lat: 47.6062,
        lng: -122.3321,
        modeFlags: makeFlags({ hasCoordinates: true }),
      });
      mockUseQueryFn.mockReturnValue(makePayload([caseWithCoords]));

      const { result, rerender } = renderHook(() => useCasesMapPayload({}));

      expect(result.current.cases[0].lat).toBe(47.6062);

      // Coordinates cleared (case removed from field site)
      const caseNoCoords = makeCase({
        id:  "c1",
        lat: undefined,
        lng: undefined,
        modeFlags: makeFlags({ hasCoordinates: false }),
      });
      act(() => {
        mockUseQueryFn.mockReturnValue(makePayload([caseNoCoords]));
        rerender();
      });

      expect(result.current.cases[0].lat).toBeUndefined();
      expect(result.current.cases[0].lng).toBeUndefined();
    });

    it("Scenario 4: summary.withLocation increments when case gains coords", () => {
      const noCoordCase = makeCase({ id: "c1", lat: undefined, lng: undefined });
      mockUseQueryFn.mockReturnValue(
        makePayload([noCoordCase], { withLocation: 0 })
      );

      const { result, rerender } = renderHook(() => useCasesMapPayload({}));

      expect(result.current.data?.summary.withLocation).toBe(0);

      const withCoordCase = makeCase({
        id:  "c1",
        lat: 40.7128,
        lng: -74.006,
        modeFlags: makeFlags({ hasCoordinates: true }),
      });
      act(() => {
        mockUseQueryFn.mockReturnValue(
          makePayload([withCoordCase], { withLocation: 1 })
        );
        rerender();
      });

      expect(result.current.data?.summary.withLocation).toBe(1);
    });

    it("Scenario 5: modeFlags.hasCoordinates remains true when coords already set", () => {
      const c = makeCase({
        id: "c1", lat: 40.7, lng: -74.0,
        modeFlags: makeFlags({ hasCoordinates: true }),
      });
      mockUseQueryFn.mockReturnValue(makePayload([c]));

      const { result, rerender } = renderHook(() => useCasesMapPayload({}));
      expect(result.current.cases[0].modeFlags.hasCoordinates).toBe(true);

      // Position updates; hasCoordinates stays true
      const moved = makeCase({
        id: "c1", lat: 41.0, lng: -75.0,
        modeFlags: makeFlags({ hasCoordinates: true }),
      });
      act(() => {
        mockUseQueryFn.mockReturnValue(makePayload([moved]));
        rerender();
      });
      expect(result.current.cases[0].modeFlags.hasCoordinates).toBe(true);
    });

    it("Scenario 6: modeFlags.hasCoordinates flips false→true when coords first set", () => {
      const noCoords = makeCase({
        id: "c1",
        lat: undefined, lng: undefined,
        modeFlags: makeFlags({ hasCoordinates: false }),
      });
      mockUseQueryFn.mockReturnValue(makePayload([noCoords]));

      const { result, rerender } = renderHook(() => useCasesMapPayload({}));
      expect(result.current.cases[0].modeFlags.hasCoordinates).toBe(false);

      const withCoords = makeCase({
        id: "c1",
        lat: 47.6, lng: -122.3,
        modeFlags: makeFlags({ hasCoordinates: true }),
      });
      act(() => {
        mockUseQueryFn.mockReturnValue(makePayload([withCoords]));
        rerender();
      });
      expect(result.current.cases[0].modeFlags.hasCoordinates).toBe(true);
    });

    it("Scenario 7: modeFlags.hasCoordinates flips true→false when coords removed", () => {
      const withCoords = makeCase({
        id: "c1", lat: 47.6, lng: -122.3,
        modeFlags: makeFlags({ hasCoordinates: true }),
      });
      mockUseQueryFn.mockReturnValue(makePayload([withCoords]));

      const { result, rerender } = renderHook(() => useCasesMapPayload({}));
      expect(result.current.cases[0].modeFlags.hasCoordinates).toBe(true);

      const noCoords = makeCase({
        id: "c1",
        lat: undefined, lng: undefined,
        modeFlags: makeFlags({ hasCoordinates: false }),
      });
      act(() => {
        mockUseQueryFn.mockReturnValue(makePayload([noCoords]));
        rerender();
      });
      expect(result.current.cases[0].modeFlags.hasCoordinates).toBe(false);
    });
  });

  // ── useCaseMapData (M1) location reactivity ────────────────────────────────

  describe("useCaseMapData (M1) — location-change reactivity", () => {
    it("Scenario 8: M1 case lat/lng update → record.lat/lng update", () => {
      const initialM1 = makeM1Response([
        { _id: "c1", label: "CASE-001", status: "deployed", lat: 47.6, lng: -122.3, updatedAt: 1000 },
      ]);
      mockUseQueryFn.mockReturnValue(initialM1);

      const { result, rerender } = renderHook(() =>
        useCaseMapData({ mode: "M1" })
      );

      expect(result.current.records[0].lat).toBe(47.6);
      expect(result.current.records[0].lng).toBe(-122.3);

      // Simulate location update
      const updatedM1 = makeM1Response([
        { _id: "c1", label: "CASE-001", status: "deployed", lat: 39.74, lng: -104.99, updatedAt: 2000 },
      ]);
      act(() => {
        mockUseQueryFn.mockReturnValue(updatedM1);
        rerender();
      });

      expect(result.current.records[0].lat).toBe(39.74);
      expect(result.current.records[0].lng).toBe(-104.99);
    });

    it("Scenario 9: M1 case gains coords from undefined → record has coords", () => {
      const noCoordM1 = makeM1Response([
        { _id: "c1", label: "CASE-001", status: "assembled", lat: undefined, lng: undefined, updatedAt: 1000 },
      ]);
      mockUseQueryFn.mockReturnValue(noCoordM1);

      const { result, rerender } = renderHook(() =>
        useCaseMapData({ mode: "M1" })
      );

      expect(result.current.records[0].lat).toBeUndefined();
      expect(result.current.records[0].lng).toBeUndefined();

      const withCoordM1 = makeM1Response([
        { _id: "c1", label: "CASE-001", status: "deployed", lat: 40.71, lng: -74.01, updatedAt: 3000 },
      ]);
      act(() => {
        mockUseQueryFn.mockReturnValue(withCoordM1);
        rerender();
      });

      expect(result.current.records[0].lat).toBe(40.71);
      expect(result.current.records[0].lng).toBe(-74.01);
    });
  });

  // ── useCaseMapData (M2) location reactivity ────────────────────────────────

  describe("useCaseMapData (M2) — location-change reactivity", () => {
    it("Scenario 10: M2 mission-group case lat/lng update → record updated", () => {
      const initialM2 = makeM2Response([
        { _id: "c1", label: "CASE-001", status: "deployed", lat: 34.05, lng: -118.24, updatedAt: 1000 },
      ]);
      mockUseQueryFn.mockReturnValue(initialM2);

      const { result, rerender } = renderHook(() =>
        useCaseMapData({ mode: "M2" })
      );

      expect(result.current.records[0].lat).toBe(34.05);
      expect(result.current.records[0].lng).toBe(-118.24);

      const updatedM2 = makeM2Response([
        { _id: "c1", label: "CASE-001", status: "deployed", lat: 33.99, lng: -118.47, updatedAt: 2000 },
      ]);
      act(() => {
        mockUseQueryFn.mockReturnValue(updatedM2);
        rerender();
      });

      expect(result.current.records[0].lat).toBe(33.99);
      expect(result.current.records[0].lng).toBe(-118.47);
    });
  });

  // ── useCaseMapData (M3) location reactivity ────────────────────────────────

  describe("useCaseMapData (M3) — location-change reactivity", () => {
    it("Scenario 11: M3 field case lat/lng and inspection data both update", () => {
      const initialM3 = makeM3Response([
        {
          _id: "c1", label: "CASE-001", status: "deployed",
          lat: 51.5, lng: -0.09, updatedAt: 1000,
          checkedItems: 3, totalItems: 10, damagedItems: 0, missingItems: 0,
          inspectionProgress: 30,
        },
      ]);
      mockUseQueryFn.mockReturnValue(initialM3);

      const { result, rerender } = renderHook(() =>
        useCaseMapData({ mode: "M3" })
      );

      expect(result.current.records[0].lat).toBe(51.5);
      expect(result.current.records[0].lng).toBe(-0.09);
      expect(result.current.records[0].inspectionProgress).toBe(30);

      // Location changed + inspection progressed
      const updatedM3 = makeM3Response([
        {
          _id: "c1", label: "CASE-001", status: "deployed",
          lat: 51.52, lng: -0.11, updatedAt: 2000,
          checkedItems: 7, totalItems: 10, damagedItems: 1, missingItems: 0,
          inspectionProgress: 70,
        },
      ]);
      act(() => {
        mockUseQueryFn.mockReturnValue(updatedM3);
        rerender();
      });

      // Both location AND inspection progress should have updated
      expect(result.current.records[0].lat).toBe(51.52);
      expect(result.current.records[0].lng).toBe(-0.11);
      expect(result.current.records[0].inspectionProgress).toBe(70);
      expect(result.current.records[0].damagedItems).toBe(1);
    });
  });

  // ── useCaseMapData (M4) location reactivity ────────────────────────────────

  describe("useCaseMapData (M4) — location-change reactivity", () => {
    it("Scenario 12: M4 shipment currentLat/Lng update → record.lat/lng update", () => {
      const initialM4 = makeM4Response([
        {
          _id: "s1", caseId: "c1", caseLabel: "CASE-001",
          trackingNumber: "TRK001", carrier: "FedEx", status: "in_transit",
          origin: { lat: 39.74, lng: -104.99 },
          destination: { lat: 47.6, lng: -122.3 },
          currentLat: 42.0, currentLng: -110.0,
          updatedAt: 1000,
        },
      ]);
      mockUseQueryFn.mockReturnValue(initialM4);

      const { result, rerender } = renderHook(() =>
        useCaseMapData({ mode: "M4" })
      );

      // M4 uses currentLat as primary position
      expect(result.current.records[0].lat).toBe(42.0);
      expect(result.current.records[0].lng).toBe(-110.0);

      // FedEx tracking update: shipment moved closer to destination
      const updatedM4 = makeM4Response([
        {
          _id: "s1", caseId: "c1", caseLabel: "CASE-001",
          trackingNumber: "TRK001", carrier: "FedEx", status: "in_transit",
          origin: { lat: 39.74, lng: -104.99 },
          destination: { lat: 47.6, lng: -122.3 },
          currentLat: 45.5, currentLng: -115.0,
          updatedAt: 2000,
        },
      ]);
      act(() => {
        mockUseQueryFn.mockReturnValue(updatedM4);
        rerender();
      });

      expect(result.current.records[0].lat).toBe(45.5);
      expect(result.current.records[0].lng).toBe(-115.0);
    });
  });

  // ── normaliseM1Records pure-function tests ─────────────────────────────────

  describe("normaliseM1Records — location pass-through (pure function)", () => {
    it("Scenario 13: lat/lng pass-through from M1CasePin", () => {
      const cases: M1Response["cases"] = [
        {
          _id: "c1", label: "CASE-001", status: "deployed",
          lat: 47.6062, lng: -122.3321, locationName: "Seattle, WA",
          updatedAt: 1000,
        },
      ];
      const records = normaliseM1Records(cases);

      expect(records[0].lat).toBe(47.6062);
      expect(records[0].lng).toBe(-122.3321);
      expect(records[0].locationName).toBe("Seattle, WA");
    });

    it("passes through undefined lat/lng without transformation", () => {
      const cases: M1Response["cases"] = [
        {
          _id: "c1", label: "CASE-001", status: "hangar",
          lat: undefined, lng: undefined,
          updatedAt: 1000,
        },
      ];
      const records = normaliseM1Records(cases);

      expect(records[0].lat).toBeUndefined();
      expect(records[0].lng).toBeUndefined();
    });
  });

  // ── normaliseM2Records pure-function tests ─────────────────────────────────

  describe("normaliseM2Records — location pass-through (pure function)", () => {
    it("Scenario 14: lat/lng pass-through for mission-group cases", () => {
      const data = makeM2Response([
        { _id: "c1", label: "CASE-001", status: "deployed", lat: 34.05, lng: -118.24, updatedAt: 1000 },
      ]);
      const records = normaliseM2Records(data);

      expect(records[0].lat).toBe(34.05);
      expect(records[0].lng).toBe(-118.24);
    });

    it("Scenario 15: lat/lng pass-through for unassigned cases", () => {
      const unassigned: M2Response["unassigned"] = [
        { _id: "c2", label: "CASE-002", status: "assembled", lat: 40.71, lng: -74.01, updatedAt: 2000 },
      ];
      const data = makeM2Response([], unassigned);
      const records = normaliseM2Records(data);

      // unassigned cases are appended after mission-group cases
      expect(records[0].lat).toBe(40.71);
      expect(records[0].lng).toBe(-74.01);
    });
  });

  // ── normaliseM3Records pure-function tests ─────────────────────────────────

  describe("normaliseM3Records — location pass-through (pure function)", () => {
    it("Scenario 16: lat/lng pass-through from M3CasePin", () => {
      const cases: M3Response["cases"] = [
        {
          _id: "c1", label: "CASE-001", status: "deployed",
          lat: 51.5074, lng: -0.1278, locationName: "London, UK",
          updatedAt: 1000,
          checkedItems: 5, totalItems: 10, damagedItems: 0, missingItems: 0,
          inspectionProgress: 50,
        },
      ];
      const records = normaliseM3Records(cases);

      expect(records[0].lat).toBe(51.5074);
      expect(records[0].lng).toBe(-0.1278);
      expect(records[0].locationName).toBe("London, UK");
    });
  });

  // ── normaliseM4Records pure-function tests ─────────────────────────────────

  describe("normaliseM4Records — location pass-through (pure function)", () => {
    it("Scenario 17: currentLat/Lng used as primary position", () => {
      const shipments: M4Response["shipments"] = [
        {
          _id: "s1", caseId: "c1", caseLabel: "CASE-001",
          trackingNumber: "TRK001", carrier: "FedEx", status: "in_transit",
          origin: { lat: 39.74, lng: -104.99 },
          destination: { lat: 47.6, lng: -122.3 },
          currentLat: 43.0, currentLng: -108.0,
          updatedAt: 1000,
        },
      ];
      const records = normaliseM4Records(shipments);

      expect(records[0].lat).toBe(43.0);
      expect(records[0].lng).toBe(-108.0);
    });

    it("Scenario 18: fallback to destination.lat/lng when no currentLat", () => {
      const shipments: M4Response["shipments"] = [
        {
          _id: "s1", caseId: "c1", caseLabel: "CASE-001",
          trackingNumber: "TRK001", carrier: "FedEx", status: "label_created",
          origin: { lat: 39.74, lng: -104.99 },
          destination: { lat: 47.6, lng: -122.3 },
          currentLat: undefined, currentLng: undefined,
          updatedAt: 1000,
        },
      ];
      const records = normaliseM4Records(shipments);

      // Falls back to destination coordinates
      expect(records[0].lat).toBe(47.6);
      expect(records[0].lng).toBe(-122.3);
    });
  });

  // ── Multi-case: only mutated case updates ─────────────────────────────────

  describe("Multiple cases — only mutated case's coordinates update", () => {
    it("Scenario 19: one case moves; other case coordinates unchanged", () => {
      const caseA = makeCase({ id: "cA", lat: 40.0, lng: -80.0, label: "CASE-A" });
      const caseB = makeCase({ id: "cB", lat: 35.0, lng: -90.0, label: "CASE-B" });
      mockUseQueryFn.mockReturnValue(makePayload([caseA, caseB]));

      const { result, rerender } = renderHook(() => useCasesMapPayload({}));

      expect(result.current.cases[0].lat).toBe(40.0);
      expect(result.current.cases[1].lat).toBe(35.0);

      // Only caseA moves
      const movedCaseA = makeCase({ id: "cA", lat: 41.0, lng: -81.0, label: "CASE-A" });
      act(() => {
        mockUseQueryFn.mockReturnValue(makePayload([movedCaseA, caseB]));
        rerender();
      });

      expect(result.current.cases[0].lat).toBe(41.0);
      expect(result.current.cases[0].lng).toBe(-81.0);
      // caseB is unchanged
      expect(result.current.cases[1].lat).toBe(35.0);
      expect(result.current.cases[1].lng).toBe(-90.0);
    });
  });

  // ── Subscription continuity ────────────────────────────────────────────────

  describe("Subscription continuity", () => {
    it("Scenario 20: useQuery called with same args across location updates (no re-subscribe)", () => {
      const initial = makePayload([makeCase({ id: "c1", lat: 40.0, lng: -80.0 })]);
      mockUseQueryFn.mockReturnValue(initial);

      const { rerender } = renderHook(() => useCasesMapPayload({}));

      // Capture the initial call args
      const firstCallKey = mockUseQueryFn.mock.calls[0][0];

      const updated = makePayload([makeCase({ id: "c1", lat: 41.0, lng: -81.0 })]);
      act(() => {
        mockUseQueryFn.mockReturnValue(updated);
        rerender();
      });

      // The query key (first arg to useQuery) must remain the same across renders.
      // Convex uses referential stability on the query key to avoid re-subscribing.
      const secondCallKey = mockUseQueryFn.mock.calls[
        mockUseQueryFn.mock.calls.length - 1
      ][0];

      expect(secondCallKey).toBe(firstCallKey);
    });
  });

  // ── Loading → loaded → updated cycle ─────────────────────────────────────

  describe("Complete loading → loaded → location-update cycle", () => {
    it("transitions through all three states without re-subscribing", () => {
      // 1. Loading
      mockUseQueryFn.mockReturnValue(undefined);
      const { result, rerender } = renderHook(() => useCasesMapPayload({}));
      expect(result.current.isLoading).toBe(true);
      expect(result.current.cases).toEqual([]);

      // 2. First data arrives (no location)
      const initialCase = makeCase({ id: "c1", lat: undefined, lng: undefined });
      act(() => {
        mockUseQueryFn.mockReturnValue(makePayload([initialCase]));
        rerender();
      });
      expect(result.current.isLoading).toBe(false);
      expect(result.current.cases[0].lat).toBeUndefined();

      // 3. Location update pushed via Convex subscription
      const withLocation = makeCase({
        id: "c1", lat: 47.6, lng: -122.3,
        modeFlags: makeFlags({ hasCoordinates: true }),
      });
      act(() => {
        mockUseQueryFn.mockReturnValue(makePayload([withLocation]));
        rerender();
      });
      expect(result.current.isLoading).toBe(false);
      expect(result.current.cases[0].lat).toBe(47.6);
      expect(result.current.cases[0].lng).toBe(-122.3);
      expect(result.current.cases[0].modeFlags.hasCoordinates).toBe(true);
    });
  });
});
