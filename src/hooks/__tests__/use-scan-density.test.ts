/**
 * @vitest-environment jsdom
 *
 * use-scan-density.test.ts — unit tests for the SCAN app density hook
 *
 * Tests the useScanDensity hook in isolation:
 *   - Default density value
 *   - localStorage hydration on mount
 *   - setDensity updates state and persists
 *   - Invalid values are rejected (no-op)
 *   - Storage key is "scan_density" (not "inv_density")
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useScanDensity, SCAN_DENSITY_STORAGE_KEY } from "../use-scan-density";

// ─── localStorage mock ────────────────────────────────────────────────────────

let _mockStore: Record<string, string> = {};

const localStorageMock = {
  getItem: vi.fn((key: string) => _mockStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    _mockStore[key] = value;
  }),
  removeItem: vi.fn((key: string) => { delete _mockStore[key]; }),
  clear: vi.fn(() => { _mockStore = {}; }),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _mockStore = {};
  vi.resetAllMocks();
  localStorageMock.getItem.mockImplementation(
    (((key: string) => _mockStore[key] ?? null) as unknown) as Storage["getItem"] as never
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useScanDensity — storage key", () => {
  it("SCAN_DENSITY_STORAGE_KEY is 'scan_density'", () => {
    expect(SCAN_DENSITY_STORAGE_KEY).toBe("scan_density");
  });
});

describe("useScanDensity — default density", () => {
  it("returns 'comfy' as the initial density before localStorage hydrates", () => {
    const { result } = renderHook(() => useScanDensity());
    // Before useEffect runs, initial state is comfy
    expect(result.current.density).toBe("comfy");
  });

  it("returns 'comfy' after hydration when no value is stored", async () => {
    const { result } = renderHook(() => useScanDensity());
    await act(async () => {});
    expect(result.current.density).toBe("comfy");
  });

  it("returns 'comfy' when localStorage has an invalid value", async () => {
    localStorageMock.getItem.mockReturnValue("unknown-density");
    const { result } = renderHook(() => useScanDensity());
    await act(async () => {});
    expect(result.current.density).toBe("comfy");
  });
});

describe("useScanDensity — localStorage hydration", () => {
  it("reads 'compact' from localStorage on mount", async () => {
    localStorageMock.getItem.mockImplementation((((key: string) => {
      if (key === SCAN_DENSITY_STORAGE_KEY) return "compact";
      return null;
    }) as unknown) as Storage["getItem"] as never);

    const { result } = renderHook(() => useScanDensity());
    await act(async () => {});

    expect(result.current.density).toBe("compact");
  });

  it("reads 'comfy' from localStorage on mount", async () => {
    localStorageMock.getItem.mockImplementation((((key: string) => {
      if (key === SCAN_DENSITY_STORAGE_KEY) return "comfy";
      return null;
    }) as unknown) as Storage["getItem"] as never);

    const { result } = renderHook(() => useScanDensity());
    await act(async () => {});

    expect(result.current.density).toBe("comfy");
  });

  it("reads from 'scan_density' key — not 'inv_density'", async () => {
    // INVENTORY key has compact, SCAN key is absent → should default to comfy
    localStorageMock.getItem.mockImplementation((((key: string) => {
      if (key === "inv_density") return "compact";
      return null;
    }) as unknown) as Storage["getItem"] as never);

    const { result } = renderHook(() => useScanDensity());
    await act(async () => {});

    expect(result.current.density).toBe("comfy");
  });
});

describe("useScanDensity — setDensity", () => {
  it("updates density to 'compact'", async () => {
    const { result } = renderHook(() => useScanDensity());
    await act(async () => {});

    act(() => {
      result.current.setDensity("compact");
    });

    expect(result.current.density).toBe("compact");
  });

  it("updates density back to 'comfy' from 'compact'", async () => {
    const { result } = renderHook(() => useScanDensity());
    await act(async () => {});

    act(() => { result.current.setDensity("compact"); });
    act(() => { result.current.setDensity("comfy"); });

    expect(result.current.density).toBe("comfy");
  });

  it("persists 'compact' to localStorage", async () => {
    const { result } = renderHook(() => useScanDensity());
    await act(async () => {});

    act(() => { result.current.setDensity("compact"); });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      SCAN_DENSITY_STORAGE_KEY,
      "compact"
    );
  });

  it("persists 'comfy' to localStorage", async () => {
    const { result } = renderHook(() => useScanDensity());
    await act(async () => {});

    act(() => { result.current.setDensity("compact"); });
    act(() => { result.current.setDensity("comfy"); });

    const calls = localStorageMock.setItem.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toEqual([SCAN_DENSITY_STORAGE_KEY, "comfy"]);
  });

  it("ignores invalid density values (no-op)", async () => {
    const { result } = renderHook(() => useScanDensity());
    await act(async () => {});

    const densityBefore = result.current.density;

    act(() => {
      // Cast to satisfy TypeScript — we're testing the runtime guard
      result.current.setDensity("ultra-wide" as Parameters<typeof result.current.setDensity>[0]);
    });

    // Density must remain unchanged
    expect(result.current.density).toBe(densityBefore);
    // localStorage must not have been called with the invalid value
    const invalidCalls = localStorageMock.setItem.mock.calls.filter(
      ([, value]) => value === "ultra-wide"
    );
    expect(invalidCalls).toHaveLength(0);
  });

  it("does NOT write to 'inv_density' when setting density", async () => {
    const { result } = renderHook(() => useScanDensity());
    await act(async () => {});

    act(() => { result.current.setDensity("compact"); });

    const invDensityCalls = localStorageMock.setItem.mock.calls.filter(
      ([key]) => key === "inv_density"
    );
    expect(invDensityCalls).toHaveLength(0);
  });

  it("setDensity function reference is stable across re-renders", async () => {
    const { result, rerender } = renderHook(() => useScanDensity());
    await act(async () => {});

    const setDensityRef1 = result.current.setDensity;
    rerender();
    const setDensityRef2 = result.current.setDensity;

    expect(setDensityRef1).toBe(setDensityRef2);
  });
});

describe("useScanDensity — localStorage error handling", () => {
  it("defaults to 'comfy' when localStorage.getItem throws", async () => {
    localStorageMock.getItem.mockImplementation(() => {
      throw new Error("Storage unavailable");
    });

    const { result } = renderHook(() => useScanDensity());
    await act(async () => {});

    // Should not throw — falls back to default
    expect(result.current.density).toBe("comfy");
  });

  it("updates state even if localStorage.setItem throws", async () => {
    const { result } = renderHook(() => useScanDensity());
    await act(async () => {});

    localStorageMock.setItem.mockImplementation(() => {
      throw new Error("Storage quota exceeded");
    });

    // Should not throw — persistence failure is non-fatal
    act(() => { result.current.setDensity("compact"); });

    expect(result.current.density).toBe("compact");
  });
});
