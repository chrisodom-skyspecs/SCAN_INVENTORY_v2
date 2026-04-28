/**
 * @vitest-environment jsdom
 *
 * Integration tests for MapStateProvider — URL sync behaviours.
 *
 * Strategy
 * ────────
 * Next.js App Router hooks (useSearchParams, useRouter, usePathname) are
 * mocked at the module level so tests run in jsdom without a real Next.js
 * server.  This lets us verify:
 *
 *   1. Hydration — initial state decoded from URL params.
 *   2. setUrlState — router.replace/push called with correct URL.
 *   3. setEphemeral — state updates without touching the URL.
 *   4. resetUrlState — navigates to bare pathname.
 *   5. Selector hooks — each hook returns the correct field.
 *   6. Error boundary — useMapState throws when used outside provider.
 */

import React from "react";
import {
  renderHook,
  act,
  type RenderHookOptions,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock next/navigation ─────────────────────────────────────────────────────

const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockPathname = vi.fn(() => "/inventory");

// searchParams are backed by a URLSearchParams instance we can swap out
let _searchParamsString = "";
const mockSearchParams = {
  get(key: string): string | null {
    return new URLSearchParams(_searchParamsString).get(key);
  },
  toString() {
    return _searchParamsString;
  },
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  usePathname: () => mockPathname(),
  useSearchParams: () => mockSearchParams,
}));

// ─── Imports (after mock) ─────────────────────────────────────────────────────

import {
  MapStateProvider,
  useMapState,
  useMapView,
  useSelectedCase,
  useCaseWindow,
  useMapLayers,
  useOrgFilter,
  useKitFilter,
  useReplayAt,
  useMapEphemeral,
  useSetMapUrlState,
  useSetMapEphemeral,
  useResetMapUrlState,
} from "../map-state-provider";
import { MAP_URL_STATE_DEFAULTS } from "@/types/map";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  return <MapStateProvider>{children}</MapStateProvider>;
}

function renderWithProvider<T>(
  hook: () => T,
  options?: Omit<RenderHookOptions<unknown>, "wrapper">
) {
  return renderHook(hook, { wrapper, ...options });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _searchParamsString = "";
  mockReplace.mockClear();
  mockPush.mockClear();
});

// ─── 1. Hydration from URL ────────────────────────────────────────────────────

describe("MapStateProvider — hydration from URL", () => {
  it("hydrates with defaults when URL has no params", () => {
    _searchParamsString = "";
    const { result } = renderWithProvider(() => useMapState());
    const { state } = result.current;

    expect(state.view).toBe("M1");
    expect(state.case).toBeNull();
    expect(state.window).toBe("T1");
    expect(state.layers).toEqual(MAP_URL_STATE_DEFAULTS.layers);
    expect(state.org).toBeNull();
    expect(state.kit).toBeNull();
    expect(state.at).toBeNull();
  });

  it("hydrates view from URL", () => {
    _searchParamsString = "view=M3";
    const { result } = renderWithProvider(() => useMapState());
    expect(result.current.state.view).toBe("M3");
  });

  it("hydrates case ID from URL", () => {
    _searchParamsString = "case=abc123";
    const { result } = renderWithProvider(() => useMapState());
    expect(result.current.state.case).toBe("abc123");
  });

  it("hydrates window from URL", () => {
    _searchParamsString = "window=T4";
    const { result } = renderWithProvider(() => useMapState());
    expect(result.current.state.window).toBe("T4");
  });

  it("hydrates layers from URL", () => {
    _searchParamsString = "layers=satellite%2Cterrain";
    const { result } = renderWithProvider(() => useMapState());
    expect(result.current.state.layers).toEqual(["satellite", "terrain"]);
  });

  it("hydrates org filter from URL", () => {
    _searchParamsString = "org=org-99";
    const { result } = renderWithProvider(() => useMapState());
    expect(result.current.state.org).toBe("org-99");
  });

  it("hydrates kit filter from URL", () => {
    _searchParamsString = "kit=kit-42";
    const { result } = renderWithProvider(() => useMapState());
    expect(result.current.state.kit).toBe("kit-42");
  });

  it("hydrates at timestamp from URL", () => {
    _searchParamsString = "at=2025-06-01T14%3A30%3A00.000Z";
    const { result } = renderWithProvider(() => useMapState());
    expect(result.current.state.at?.toISOString()).toBe(
      "2025-06-01T14:30:00.000Z"
    );
  });

  it("falls back to default for invalid URL values", () => {
    _searchParamsString = "view=BOGUS&window=Z9";
    const { result } = renderWithProvider(() => useMapState());
    expect(result.current.state.view).toBe("M1");
    expect(result.current.state.window).toBe("T1");
  });
});

// ─── 2. setUrlState — pushes to URL ──────────────────────────────────────────

describe("MapStateProvider — setUrlState pushes to URL", () => {
  it("calls router.replace with encoded URL (default behaviour)", () => {
    const { result } = renderWithProvider(() => useMapState());

    act(() => {
      result.current.setUrlState({ view: "M2" });
    });

    expect(mockReplace).toHaveBeenCalledOnce();
    const [url] = mockReplace.mock.calls[0] as [string];
    expect(url).toContain("view=M2");
    expect(url).toContain("/inventory");
  });

  it("calls router.push when replace=false", () => {
    const { result } = renderWithProvider(() => useMapState());

    act(() => {
      result.current.setUrlState({ view: "M3" }, { replace: false });
    });

    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("uses a custom pathname when provided in options", () => {
    const { result } = renderWithProvider(() => useMapState());

    act(() => {
      result.current.setUrlState({ view: "M4" }, { pathname: "/custom" });
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    expect(url).toContain("/custom");
  });

  it("encodes multiple params in the URL", () => {
    const { result } = renderWithProvider(() => useMapState());

    act(() => {
      result.current.setUrlState({
        view: "M3",
        case: "case-x",
        window: "T2",
      });
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    expect(url).toContain("view=M3");
    expect(url).toContain("case=case-x");
    expect(url).toContain("window=T2");
  });

  it("omits default params from the URL (minimal encoding)", () => {
    const { result } = renderWithProvider(() => useMapState());

    act(() => {
      // Only non-default view; window should be omitted (it's already T1)
      result.current.setUrlState({ view: "M2" });
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    expect(url).not.toContain("window=");
    expect(url).not.toContain("case=");
  });

  it("produces a bare pathname (no ?) when all params are defaults", () => {
    // Set URL to a non-default state first
    _searchParamsString = "view=M3";

    const { result } = renderWithProvider(() => useMapState());

    act(() => {
      // Resetting back to M1 (default) should produce clean URL
      result.current.setUrlState({ view: "M1" });
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    // Should be just the pathname with no query string
    expect(url).toBe("/inventory");
  });

  it("merges patch with existing URL state", () => {
    _searchParamsString = "view=M3&case=existing";

    const { result } = renderWithProvider(() => useMapState());

    act(() => {
      // Only changing window; view and case should be preserved
      result.current.setUrlState({ window: "T3" });
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    expect(url).toContain("view=M3");
    expect(url).toContain("case=existing");
    expect(url).toContain("window=T3");
  });
});

// ─── 3. setEphemeral — no URL side-effects ───────────────────────────────────

describe("MapStateProvider — setEphemeral", () => {
  it("updates ephemeral state without touching the URL", () => {
    const { result } = renderWithProvider(() => useMapState());

    act(() => {
      result.current.setEphemeral({ isMapLoading: true });
    });

    expect(result.current.state.ephemeral.isMapLoading).toBe(true);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not overwrite URL state", () => {
    _searchParamsString = "view=M4";

    const { result } = renderWithProvider(() => useMapState());

    act(() => {
      result.current.setEphemeral({ hoveredCaseId: "hover-xyz" });
    });

    expect(result.current.state.view).toBe("M4");
  });

  it("supports partial patch of ephemeral fields", () => {
    const { result } = renderWithProvider(() => useMapState());

    act(() => {
      result.current.setEphemeral({ isMapLoading: true });
    });
    act(() => {
      result.current.setEphemeral({ hoveredCaseId: "case-1" });
    });

    expect(result.current.state.ephemeral.isMapLoading).toBe(true);
    expect(result.current.state.ephemeral.hoveredCaseId).toBe("case-1");
  });
});

// ─── 4. resetUrlState ────────────────────────────────────────────────────────

describe("MapStateProvider — resetUrlState", () => {
  it("navigates to bare pathname", () => {
    const { result } = renderWithProvider(() => useMapState());

    act(() => {
      result.current.resetUrlState();
    });

    expect(mockReplace).toHaveBeenCalledOnce();
    expect(mockReplace.mock.calls[0][0]).toBe("/inventory");
  });

  it("calls router.push when replace=false", () => {
    const { result } = renderWithProvider(() => useMapState());

    act(() => {
      result.current.resetUrlState({ replace: false });
    });

    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush.mock.calls[0][0]).toBe("/inventory");
  });
});

// ─── 5. Selector hooks ────────────────────────────────────────────────────────

describe("Selector hooks", () => {
  beforeEach(() => {
    _searchParamsString =
      "view=M3&case=case-sel&window=T2&layers=heat%2Clabels&org=org-1&kit=kit-2&at=2025-07-01T09%3A00%3A00.000Z";
  });

  it("useMapView returns view", () => {
    const { result } = renderWithProvider(() => useMapView());
    expect(result.current).toBe("M3");
  });

  it("useSelectedCase returns case ID", () => {
    const { result } = renderWithProvider(() => useSelectedCase());
    expect(result.current).toBe("case-sel");
  });

  it("useCaseWindow returns window", () => {
    const { result } = renderWithProvider(() => useCaseWindow());
    expect(result.current).toBe("T2");
  });

  it("useMapLayers returns layer array", () => {
    const { result } = renderWithProvider(() => useMapLayers());
    expect(result.current).toEqual(["heat", "labels"]);
  });

  it("useOrgFilter returns org ID", () => {
    const { result } = renderWithProvider(() => useOrgFilter());
    expect(result.current).toBe("org-1");
  });

  it("useKitFilter returns kit ID", () => {
    const { result } = renderWithProvider(() => useKitFilter());
    expect(result.current).toBe("kit-2");
  });

  it("useReplayAt returns Date", () => {
    const { result } = renderWithProvider(() => useReplayAt());
    expect(result.current?.toISOString()).toBe("2025-07-01T09:00:00.000Z");
  });

  it("useMapEphemeral returns ephemeral object", () => {
    const { result } = renderWithProvider(() => useMapEphemeral());
    expect(result.current.isMapLoading).toBe(false);
  });

  it("useSetMapUrlState returns a stable function reference", () => {
    const { result, rerender } = renderWithProvider(() => useSetMapUrlState());
    const ref1 = result.current;
    rerender();
    // The function reference should be stable across re-renders with no state change
    expect(result.current).toBe(ref1);
  });

  it("useSetMapEphemeral returns a stable function reference", () => {
    const { result, rerender } = renderWithProvider(() => useSetMapEphemeral());
    const ref1 = result.current;
    rerender();
    expect(result.current).toBe(ref1);
  });

  it("useResetMapUrlState returns a stable function reference", () => {
    const { result, rerender } = renderWithProvider(
      () => useResetMapUrlState()
    );
    const ref1 = result.current;
    rerender();
    expect(result.current).toBe(ref1);
  });
});

// ─── 6. Error boundary ────────────────────────────────────────────────────────

describe("useMapState — outside provider", () => {
  it("throws a descriptive error", () => {
    // Suppress React's error logging during this test
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => renderHook(() => useMapState())).toThrow(
      /MapStateProvider/
    );

    consoleSpy.mockRestore();
  });
});
