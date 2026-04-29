// @vitest-environment jsdom

/**
 * Unit tests for useCasesMapPayload hook (Sub-AC 2).
 *
 * Tests the hook's behaviour across:
 *   1. Skip mode — suspended subscription returns empty state
 *   2. Loading state — undefined from useQuery → isLoading: true, cases: []
 *   3. Loaded state — data passed through correctly
 *   4. Argument construction — bounds, status, assigneeId, missionId
 *
 * The hook wraps `useQuery(api.mapData.getCasesMapPayload, ...)` which is mocked
 * below.  We verify that:
 *   • The correct `useQuery` args are constructed from the hook's input
 *   • The return shape (`data`, `isLoading`, `cases`) is correct in all states
 *
 * These are pure unit tests — no Convex runtime, no network, no DOM.
 * Uses vitest + @testing-library/react-hooks (or renderHook from @testing-library/react).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type {
  CasesMapPayloadResponse,
  CaseMapPayload,
  CaseModeFlags,
} from "../../../convex/maps";

// ─── Mock convex/react ────────────────────────────────────────────────────────
// We stub useQuery so the hook can run without a Convex provider.

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    mapData: {
      getCasesMapPayload: "getCasesMapPayload" as unknown,
    },
  },
}));

// Import after mocks are set up
import { useQuery } from "convex/react";
import {
  useCasesMapPayload,
  type UseCasesMapPayloadArgs,
} from "../use-cases-map-payload";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockUseQuery = useQuery as ReturnType<typeof vi.fn>;

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
    id:          "case_001",
    label:       "CASE-001",
    qrCode:      "QR-001",
    status:      "hangar",
    lat:         undefined,
    lng:         undefined,
    modeFlags:   makeFlags(),
    updatedAt:   1_700_000_000_000,
    createdAt:   1_699_000_000_000,
    ...overrides,
  };
}

function makePayload(
  cases: CaseMapPayload[] = [],
  overrides: Partial<CasesMapPayloadResponse["summary"]> = {}
): CasesMapPayloadResponse {
  return {
    ts: Date.now(),
    cases,
    summary: {
      total:           cases.length,
      withLocation:    0,
      byStatus:        {},
      fieldActive:     0,
      inTransit:       0,
      missionAssigned: 0,
      ...overrides,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useCasesMapPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── skip mode ───────────────────────────────────────────────────────────────

  describe("skip mode", () => {
    it("returns { data: undefined, isLoading: false, cases: [] } when skip is true", () => {
      mockUseQuery.mockReturnValue(undefined);

      const { result } = renderHook(() =>
        useCasesMapPayload({ skip: true })
      );

      expect(result.current.data).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.cases).toEqual([]);
    });

    it("passes 'skip' sentinel to useQuery when skip is true", () => {
      mockUseQuery.mockReturnValue(undefined);

      renderHook(() => useCasesMapPayload({ skip: true }));

      const callArgs = mockUseQuery.mock.calls[0];
      expect(callArgs[1]).toBe("skip");
    });

    it("does not matter if other args are passed when skip is true", () => {
      mockUseQuery.mockReturnValue(undefined);

      renderHook(() =>
        useCasesMapPayload({
          skip: true,
          status: ["deployed"],
          assigneeId: "user_123",
          bounds: { swLat: 40, swLng: -80, neLat: 50, neLng: -70 },
        })
      );

      const callArgs = mockUseQuery.mock.calls[0];
      expect(callArgs[1]).toBe("skip");
    });
  });

  // ── loading state ────────────────────────────────────────────────────────────

  describe("loading state (undefined from useQuery)", () => {
    it("returns isLoading: true when useQuery returns undefined", () => {
      mockUseQuery.mockReturnValue(undefined);

      const { result } = renderHook(() => useCasesMapPayload({}));

      expect(result.current.isLoading).toBe(true);
    });

    it("returns data: undefined while loading", () => {
      mockUseQuery.mockReturnValue(undefined);

      const { result } = renderHook(() => useCasesMapPayload({}));

      expect(result.current.data).toBeUndefined();
    });

    it("returns cases: [] while loading", () => {
      mockUseQuery.mockReturnValue(undefined);

      const { result } = renderHook(() => useCasesMapPayload({}));

      expect(result.current.cases).toEqual([]);
    });
  });

  // ── loaded state ─────────────────────────────────────────────────────────────

  describe("loaded state (data returned from useQuery)", () => {
    it("returns isLoading: false when data is available", () => {
      const payload = makePayload();
      mockUseQuery.mockReturnValue(payload);

      const { result } = renderHook(() => useCasesMapPayload({}));

      expect(result.current.isLoading).toBe(false);
    });

    it("returns the full payload in data", () => {
      const payload = makePayload([makeCase()]);
      mockUseQuery.mockReturnValue(payload);

      const { result } = renderHook(() => useCasesMapPayload({}));

      expect(result.current.data).toBe(payload);
    });

    it("returns cases from data.cases in the cases array", () => {
      const cases = [
        makeCase({ id: "c1", label: "CASE-001" }),
        makeCase({ id: "c2", label: "CASE-002" }),
      ];
      const payload = makePayload(cases);
      mockUseQuery.mockReturnValue(payload);

      const { result } = renderHook(() => useCasesMapPayload({}));

      expect(result.current.cases).toHaveLength(2);
      expect(result.current.cases[0].id).toBe("c1");
      expect(result.current.cases[1].id).toBe("c2");
    });

    it("returns cases: [] when data.cases is empty", () => {
      const payload = makePayload([]);
      mockUseQuery.mockReturnValue(payload);

      const { result } = renderHook(() => useCasesMapPayload({}));

      expect(result.current.cases).toEqual([]);
    });

    it("returns summary with correct fleet counts", () => {
      const payload = makePayload(
        [makeCase({ status: "deployed", modeFlags: makeFlags({ isFieldActive: true }) })],
        { total: 5, fieldActive: 1, inTransit: 2, missionAssigned: 3 }
      );
      mockUseQuery.mockReturnValue(payload);

      const { result } = renderHook(() => useCasesMapPayload({}));

      expect(result.current.data?.summary.total).toBe(5);
      expect(result.current.data?.summary.fieldActive).toBe(1);
      expect(result.current.data?.summary.inTransit).toBe(2);
    });
  });

  // ── argument construction ────────────────────────────────────────────────────

  describe("argument construction", () => {
    it("passes empty args object when no filters provided", () => {
      mockUseQuery.mockReturnValue(makePayload());

      renderHook(() => useCasesMapPayload({}));

      const callArgs = mockUseQuery.mock.calls[0];
      expect(callArgs[1]).toEqual({});
    });

    it("includes status array when provided", () => {
      mockUseQuery.mockReturnValue(makePayload());

      renderHook(() =>
        useCasesMapPayload({ status: ["deployed", "flagged"] })
      );

      const callArgs = mockUseQuery.mock.calls[0];
      expect(callArgs[1]).toMatchObject({
        status: ["deployed", "flagged"],
      });
    });

    it("omits status when the array is empty", () => {
      mockUseQuery.mockReturnValue(makePayload());

      renderHook(() => useCasesMapPayload({ status: [] }));

      const callArgs = mockUseQuery.mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty("status");
    });

    it("includes assigneeId when provided", () => {
      mockUseQuery.mockReturnValue(makePayload());

      renderHook(() => useCasesMapPayload({ assigneeId: "user_abc123" }));

      const callArgs = mockUseQuery.mock.calls[0];
      expect(callArgs[1]).toMatchObject({ assigneeId: "user_abc123" });
    });

    it("omits assigneeId when null", () => {
      mockUseQuery.mockReturnValue(makePayload());

      renderHook(() => useCasesMapPayload({ assigneeId: null }));

      const callArgs = mockUseQuery.mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty("assigneeId");
    });

    it("omits assigneeId when undefined", () => {
      mockUseQuery.mockReturnValue(makePayload());

      renderHook(() => useCasesMapPayload({ assigneeId: undefined }));

      const callArgs = mockUseQuery.mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty("assigneeId");
    });

    it("includes missionId when provided", () => {
      mockUseQuery.mockReturnValue(makePayload());

      renderHook(() => useCasesMapPayload({ missionId: "mission_xyz" }));

      const callArgs = mockUseQuery.mock.calls[0];
      expect(callArgs[1]).toMatchObject({ missionId: "mission_xyz" });
    });

    it("omits missionId when null", () => {
      mockUseQuery.mockReturnValue(makePayload());

      renderHook(() => useCasesMapPayload({ missionId: null }));

      const callArgs = mockUseQuery.mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty("missionId");
    });

    it("includes all four bounds params when bounds are provided", () => {
      mockUseQuery.mockReturnValue(makePayload());

      renderHook(() =>
        useCasesMapPayload({
          bounds: { swLat: 40, swLng: -80, neLat: 50, neLng: -70 },
        })
      );

      const callArgs = mockUseQuery.mock.calls[0];
      expect(callArgs[1]).toMatchObject({
        swLat: 40,
        swLng: -80,
        neLat: 50,
        neLng: -70,
      });
    });

    it("omits bounds params when bounds is null", () => {
      mockUseQuery.mockReturnValue(makePayload());

      renderHook(() => useCasesMapPayload({ bounds: null }));

      const callArgs = mockUseQuery.mock.calls[0];
      expect(callArgs[1]).not.toHaveProperty("swLat");
      expect(callArgs[1]).not.toHaveProperty("swLng");
      expect(callArgs[1]).not.toHaveProperty("neLat");
      expect(callArgs[1]).not.toHaveProperty("neLng");
    });

    it("includes all filters together when all provided", () => {
      mockUseQuery.mockReturnValue(makePayload());

      renderHook(() =>
        useCasesMapPayload({
          status:     ["deployed"],
          assigneeId: "user_123",
          missionId:  "mission_abc",
          bounds:     { swLat: 10, swLng: 20, neLat: 30, neLng: 40 },
        })
      );

      const callArgs = mockUseQuery.mock.calls[0];
      expect(callArgs[1]).toMatchObject({
        status:     ["deployed"],
        assigneeId: "user_123",
        missionId:  "mission_abc",
        swLat:      10,
        swLng:      20,
        neLat:      30,
        neLng:      40,
      });
    });
  });

  // ── modeFlags client-side filtering ──────────────────────────────────────────

  describe("modeFlags client-side filtering patterns", () => {
    it("callers can filter by isFieldActive to get M3 cases", () => {
      const cases = [
        makeCase({ id: "c1", status: "deployed", modeFlags: makeFlags({ isFieldActive: true }) }),
        makeCase({ id: "c2", status: "hangar",   modeFlags: makeFlags({ isFieldActive: false }) }),
        makeCase({ id: "c3", status: "flagged",  modeFlags: makeFlags({ isFieldActive: true }) }),
      ];
      mockUseQuery.mockReturnValue(makePayload(cases));

      const { result } = renderHook(() => useCasesMapPayload({}));

      const fieldCases = result.current.cases.filter(
        (c) => c.modeFlags.isFieldActive
      );
      expect(fieldCases).toHaveLength(2);
      expect(fieldCases.map((c) => c.id)).toEqual(["c1", "c3"]);
    });

    it("callers can filter by isInTransit to get M4 cases", () => {
      const cases = [
        makeCase({ id: "c1", status: "transit_out", modeFlags: makeFlags({ isInTransit: true }) }),
        makeCase({ id: "c2", status: "hangar",      modeFlags: makeFlags({ isInTransit: false }) }),
      ];
      mockUseQuery.mockReturnValue(makePayload(cases));

      const { result } = renderHook(() => useCasesMapPayload({}));

      const transitCases = result.current.cases.filter(
        (c) => c.modeFlags.isInTransit
      );
      expect(transitCases).toHaveLength(1);
      expect(transitCases[0].id).toBe("c1");
    });

    it("callers can filter by hasCoordinates to get M5 heatmap candidates", () => {
      const cases = [
        makeCase({ id: "c1", lat: 40.7, lng: -74.0, modeFlags: makeFlags({ hasCoordinates: true }) }),
        makeCase({ id: "c2", lat: undefined, lng: undefined, modeFlags: makeFlags({ hasCoordinates: false }) }),
      ];
      mockUseQuery.mockReturnValue(makePayload(cases));

      const { result } = renderHook(() => useCasesMapPayload({}));

      const heatmapCandidates = result.current.cases.filter(
        (c) => c.modeFlags.hasCoordinates
      );
      expect(heatmapCandidates).toHaveLength(1);
      expect(heatmapCandidates[0].id).toBe("c1");
    });
  });

  // ── default args ─────────────────────────────────────────────────────────────

  describe("default args", () => {
    it("works when called with no arguments at all", () => {
      mockUseQuery.mockReturnValue(makePayload());

      const { result } = renderHook(() => useCasesMapPayload());

      expect(result.current.isLoading).toBe(false);
      expect(result.current.cases).toEqual([]);
    });
  });
});
