/**
 * @vitest-environment jsdom
 *
 * Unit tests: useDensity hook
 *
 * Tests:
 *   1.  Returns "comfy" as the initial density (default).
 *   2.  Applies "comfy" to document.documentElement on mount (no stored value).
 *   3.  Reads "compact" from localStorage on mount and returns it.
 *   4.  Reads "compact" from localStorage on mount and applies it to the DOM.
 *   5.  Ignores invalid localStorage values and falls back to "comfy".
 *   6.  setDensity("compact") updates the returned density.
 *   7.  setDensity("compact") sets data-density="compact" on documentElement.
 *   8.  setDensity("compact") calls localStorage.setItem with correct args.
 *   9.  setDensity("comfy") restores data-density="comfy".
 *  10.  setDensity("comfy") calls localStorage.setItem("inv_density", "comfy").
 *  11.  setDensity with an invalid value is a no-op.
 *  12.  DENSITY_STORAGE_KEY is exported and equals "inv_density".
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useDensity, DENSITY_STORAGE_KEY } from "../use-density";

// ─── localStorage mock ────────────────────────────────────────────────────────

let _mockStore: Record<string, string> = {};

const localStorageMock = {
  getItem: vi.fn((key: string) => _mockStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    _mockStore[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete _mockStore[key];
  }),
  clear: vi.fn(() => {
    _mockStore = {};
  }),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _mockStore = {};
  // Reset ALL mock state (calls + return-value overrides + implementations)
  vi.resetAllMocks();
  // Re-apply the default getItem implementation after reset
  localStorageMock.getItem.mockImplementation((key: string) => _mockStore[key] ?? null);
  document.documentElement.removeAttribute("data-density");
});

// ─── DENSITY_STORAGE_KEY constant ─────────────────────────────────────────────

describe("DENSITY_STORAGE_KEY", () => {
  it("is exported and equals 'inv_density'", () => {
    expect(DENSITY_STORAGE_KEY).toBe("inv_density");
  });
});

// ─── Initial state ────────────────────────────────────────────────────────────

describe("useDensity — initial state (no localStorage)", () => {
  it("returns 'comfy' as the initial density", () => {
    const { result } = renderHook(() => useDensity());
    expect(result.current.density).toBe("comfy");
  });

  it("sets data-density='comfy' on documentElement after mount", async () => {
    renderHook(() => useDensity());
    // useEffect fires asynchronously — wait for it
    await act(async () => {});
    expect(document.documentElement.getAttribute("data-density")).toBe("comfy");
  });
});

// ─── localStorage hydration ───────────────────────────────────────────────────

describe("useDensity — localStorage hydration", () => {
  it("returns 'compact' when localStorage has 'compact'", async () => {
    localStorageMock.getItem.mockReturnValue("compact");

    const { result } = renderHook(() => useDensity());
    await act(async () => {});

    expect(result.current.density).toBe("compact");
  });

  it("sets data-density='compact' on documentElement when localStorage has 'compact'", async () => {
    localStorageMock.getItem.mockReturnValue("compact");

    renderHook(() => useDensity());
    await act(async () => {});

    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
  });

  it("falls back to 'comfy' when localStorage has an invalid value", async () => {
    localStorageMock.getItem.mockReturnValue("huge"); // invalid

    const { result } = renderHook(() => useDensity());
    await act(async () => {});

    expect(result.current.density).toBe("comfy");
    expect(document.documentElement.getAttribute("data-density")).toBe("comfy");
  });

  it("falls back to 'comfy' when localStorage has null", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (localStorageMock.getItem as any).mockReturnValue(null);

    const { result } = renderHook(() => useDensity());
    await act(async () => {});

    expect(result.current.density).toBe("comfy");
    expect(document.documentElement.getAttribute("data-density")).toBe("comfy");
  });
});

// ─── setDensity ───────────────────────────────────────────────────────────────

describe("useDensity — setDensity", () => {
  it("updates density state to 'compact'", async () => {
    const { result } = renderHook(() => useDensity());
    await act(async () => {});

    act(() => {
      result.current.setDensity("compact");
    });

    expect(result.current.density).toBe("compact");
  });

  it("sets data-density='compact' on documentElement", async () => {
    const { result } = renderHook(() => useDensity());
    await act(async () => {});

    act(() => {
      result.current.setDensity("compact");
    });

    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
  });

  it("calls localStorage.setItem with DENSITY_STORAGE_KEY and 'compact'", async () => {
    const { result } = renderHook(() => useDensity());
    await act(async () => {});

    act(() => {
      result.current.setDensity("compact");
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(DENSITY_STORAGE_KEY, "compact");
  });

  it("restores density to 'comfy'", async () => {
    const { result } = renderHook(() => useDensity());
    await act(async () => {});

    act(() => {
      result.current.setDensity("compact");
    });

    act(() => {
      result.current.setDensity("comfy");
    });

    expect(result.current.density).toBe("comfy");
    expect(document.documentElement.getAttribute("data-density")).toBe("comfy");
  });

  it("calls localStorage.setItem with 'comfy' after restoring", async () => {
    const { result } = renderHook(() => useDensity());
    await act(async () => {});

    act(() => {
      result.current.setDensity("compact");
    });
    act(() => {
      result.current.setDensity("comfy");
    });

    const calls = localStorageMock.setItem.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toEqual([DENSITY_STORAGE_KEY, "comfy"]);
  });

  it("is a no-op when called with an invalid value", async () => {
    const { result } = renderHook(() => useDensity());
    await act(async () => {});

    const densityBefore = result.current.density;
    const attrBefore = document.documentElement.getAttribute("data-density");

    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result.current.setDensity as any)("huge");
    });

    expect(result.current.density).toBe(densityBefore);
    expect(document.documentElement.getAttribute("data-density")).toBe(attrBefore);
    // setItem should NOT have been called with an invalid value
    const setItemCallsWithInvalid = localStorageMock.setItem.mock.calls.filter(
      ([, val]) => val === "huge",
    );
    expect(setItemCallsWithInvalid).toHaveLength(0);
  });
});

// ─── setDensity referential stability ─────────────────────────────────────────

describe("useDensity — setDensity referential stability", () => {
  it("setDensity is the same reference across re-renders", async () => {
    const { result, rerender } = renderHook(() => useDensity());
    await act(async () => {});

    const first = result.current.setDensity;
    rerender();
    const second = result.current.setDensity;

    expect(first).toBe(second);
  });
});
