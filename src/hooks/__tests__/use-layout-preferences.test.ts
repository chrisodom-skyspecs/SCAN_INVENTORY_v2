/**
 * @vitest-environment jsdom
 *
 * Unit tests: useLayoutPreferences hook
 *
 * Tests:
 *   1.  Returns "M1" as the initial activeMapMode (default).
 *   2.  Returns "T1" as the initial activeCaseLayout (default).
 *   3.  isHydrated becomes true after mount.
 *   4.  Reads stored map mode from localStorage on mount.
 *   5.  Reads stored case layout from localStorage on mount.
 *   6.  Falls back to "M1" when localStorage returns null for map mode.
 *   7.  Falls back to "T1" when localStorage returns null for case layout.
 *   8.  Falls back to defaults when userId is empty string.
 *   9.  setMapMode updates activeMapMode state.
 *  10.  setMapMode writes to localStorage.
 *  11.  setMapMode calls notifyLayoutPrefsChanged with { activeMapMode }.
 *  12.  setMapMode is a no-op for invalid values.
 *  13.  setCaseLayout updates activeCaseLayout state.
 *  14.  setCaseLayout writes to localStorage.
 *  15.  setCaseLayout calls notifyLayoutPrefsChanged with { activeCaseLayout }.
 *  16.  setCaseLayout is a no-op for invalid values.
 *  17.  Convex broadcast via applyConvexLayoutPrefs updates activeMapMode.
 *  18.  Convex broadcast via applyConvexLayoutPrefs updates activeCaseLayout.
 *  19.  Convex broadcast via applyConvexLayoutPrefs updates localStorage.
 *  20.  Convex broadcast ignores absent fields (partial update).
 *  21.  Convex broadcast ignores invalid mapMode values.
 *  22.  Unsubscribes from Convex channel on unmount.
 *  23.  applyConvexLayoutPrefs broadcasts to multiple hook instances.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist mock fns before vi.mock hoisting ────────────────────────────────────
//
// vi.mock() is hoisted to the top of the file by Vitest's transformer.
// Any variables referenced inside the factory must be initialized first using
// vi.hoisted() — which is also hoisted by Vitest (before vi.mock).

const {
  mockNotify,
  mockReadMapMode,
  mockReadCaseLayout,
  mockWriteMapMode,
  mockWriteCaseLayout,
} = vi.hoisted(() => ({
  mockNotify: vi.fn(),
  mockReadMapMode: vi.fn(() => null as string | null),
  mockReadCaseLayout: vi.fn(() => null as string | null),
  mockWriteMapMode: vi.fn(),
  mockWriteCaseLayout: vi.fn(),
}));

// ─── Mutable handler list for layout-sync ────────────────────────────────────

// Mutable array so tests can inspect and trigger subscribers.
let _applyHandlers: Array<(prefs: unknown) => void> = [];

// ─── vi.mock declarations ─────────────────────────────────────────────────────

vi.mock("@/lib/layout-sync", () => ({
  subscribeToConvexLayoutPrefs: vi.fn((fn: (prefs: unknown) => void) => {
    _applyHandlers.push(fn);
    return () => {
      _applyHandlers = _applyHandlers.filter((h) => h !== fn);
    };
  }),
  notifyLayoutPrefsChanged: mockNotify,
}));

vi.mock("@/lib/layout-storage", () => ({
  readMapMode: mockReadMapMode,
  readCaseLayout: mockReadCaseLayout,
  writeMapMode: mockWriteMapMode,
  writeCaseLayout: mockWriteCaseLayout,
  isMapMode: (v: unknown) =>
    typeof v === "string" && ["M1", "M2", "M3", "M4", "M5"].includes(v),
  isCaseLayout: (v: unknown) =>
    typeof v === "string" && ["T1", "T2", "T3", "T4", "T5"].includes(v),
  MAP_MODE_VALUES: ["M1", "M2", "M3", "M4", "M5"],
  CASE_LAYOUT_VALUES: ["T1", "T2", "T3", "T4", "T5"],
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  useLayoutPreferences,
  DEFAULT_MAP_MODE,
  DEFAULT_CASE_LAYOUT,
} from "../use-layout-preferences";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate ConvexLayoutSync broadcasting Convex preferences to all subscribers. */
function triggerConvexApply(prefs: unknown): void {
  _applyHandlers.forEach((fn) => fn(prefs));
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  _applyHandlers = [];
  // Default: localStorage has no stored values
  mockReadMapMode.mockReturnValue(null);
  mockReadCaseLayout.mockReturnValue(null);
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe("useLayoutPreferences — constants", () => {
  it("DEFAULT_MAP_MODE is 'M1'", () => {
    expect(DEFAULT_MAP_MODE).toBe("M1");
  });

  it("DEFAULT_CASE_LAYOUT is 'T1'", () => {
    expect(DEFAULT_CASE_LAYOUT).toBe("T1");
  });
});

// ─── Initial state ────────────────────────────────────────────────────────────

describe("useLayoutPreferences — initial state", () => {
  it("returns 'M1' as the initial activeMapMode (default)", () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    expect(result.current.activeMapMode).toBe("M1");
  });

  it("returns 'T1' as the initial activeCaseLayout (default)", () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    expect(result.current.activeCaseLayout).toBe("T1");
  });

  it("isHydrated becomes true after mount effects run", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});
    expect(result.current.isHydrated).toBe(true);
  });
});

// ─── localStorage hydration ───────────────────────────────────────────────────

describe("useLayoutPreferences — localStorage hydration", () => {
  it("reads stored map mode from localStorage on mount", async () => {
    mockReadMapMode.mockReturnValue("M3");

    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    expect(result.current.activeMapMode).toBe("M3");
  });

  it("reads stored case layout from localStorage on mount", async () => {
    mockReadCaseLayout.mockReturnValue("T4");

    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    expect(result.current.activeCaseLayout).toBe("T4");
  });

  it("falls back to 'M1' when localStorage returns null for map mode", async () => {
    mockReadMapMode.mockReturnValue(null);

    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    expect(result.current.activeMapMode).toBe("M1");
  });

  it("falls back to 'T1' when localStorage returns null for case layout", async () => {
    mockReadCaseLayout.mockReturnValue(null);

    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    expect(result.current.activeCaseLayout).toBe("T1");
  });

  it("uses defaults when userId is empty string (not authenticated)", async () => {
    const { result } = renderHook(() => useLayoutPreferences(""));
    await act(async () => {});

    expect(result.current.activeMapMode).toBe("M1");
    expect(result.current.activeCaseLayout).toBe("T1");
  });
});

// ─── setMapMode ───────────────────────────────────────────────────────────────

describe("useLayoutPreferences — setMapMode", () => {
  it("updates activeMapMode state", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    act(() => {
      result.current.setMapMode("M2");
    });

    expect(result.current.activeMapMode).toBe("M2");
  });

  it("writes to localStorage via writeMapMode", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    act(() => {
      result.current.setMapMode("M4");
    });

    expect(mockWriteMapMode).toHaveBeenCalledWith("user_123", "M4");
  });

  it("calls notifyLayoutPrefsChanged with { activeMapMode }", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    act(() => {
      result.current.setMapMode("M3");
    });

    expect(mockNotify).toHaveBeenCalledWith({ activeMapMode: "M3" });
  });

  it("is a no-op for invalid map mode values", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    const initialMode = result.current.activeMapMode;

    act(() => {
      // @ts-expect-error intentionally invalid value
      result.current.setMapMode("M9");
    });

    expect(result.current.activeMapMode).toBe(initialMode);
    expect(mockWriteMapMode).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not write to localStorage when userId is empty", async () => {
    const { result } = renderHook(() => useLayoutPreferences(""));
    await act(async () => {});

    act(() => {
      result.current.setMapMode("M2");
    });

    expect(mockWriteMapMode).not.toHaveBeenCalled();
    // Notification is still sent — Convex sync works regardless of userId
    expect(mockNotify).toHaveBeenCalledWith({ activeMapMode: "M2" });
  });
});

// ─── setCaseLayout ────────────────────────────────────────────────────────────

describe("useLayoutPreferences — setCaseLayout", () => {
  it("updates activeCaseLayout state", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    act(() => {
      result.current.setCaseLayout("T3");
    });

    expect(result.current.activeCaseLayout).toBe("T3");
  });

  it("writes to localStorage via writeCaseLayout", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    act(() => {
      result.current.setCaseLayout("T2");
    });

    expect(mockWriteCaseLayout).toHaveBeenCalledWith("user_123", "T2");
  });

  it("calls notifyLayoutPrefsChanged with { activeCaseLayout }", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    act(() => {
      result.current.setCaseLayout("T4");
    });

    expect(mockNotify).toHaveBeenCalledWith({ activeCaseLayout: "T4" });
  });

  it("is a no-op for invalid case layout values", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    const initialLayout = result.current.activeCaseLayout;

    act(() => {
      // @ts-expect-error intentionally invalid value
      result.current.setCaseLayout("T9");
    });

    expect(result.current.activeCaseLayout).toBe(initialLayout);
    expect(mockWriteCaseLayout).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("does not write to localStorage when userId is empty", async () => {
    const { result } = renderHook(() => useLayoutPreferences(""));
    await act(async () => {});

    act(() => {
      result.current.setCaseLayout("T3");
    });

    expect(mockWriteCaseLayout).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith({ activeCaseLayout: "T3" });
  });
});

// ─── Convex broadcast (subscribeToConvexLayoutPrefs) ─────────────────────────

describe("useLayoutPreferences — Convex broadcast (applyConvexLayoutPrefs)", () => {
  it("updates activeMapMode when broadcast includes activeMapMode", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    act(() => {
      triggerConvexApply({ activeMapMode: "M4" });
    });

    expect(result.current.activeMapMode).toBe("M4");
  });

  it("updates activeCaseLayout when broadcast includes activeCaseLayout", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    act(() => {
      triggerConvexApply({ activeCaseLayout: "T3" });
    });

    expect(result.current.activeCaseLayout).toBe("T3");
  });

  it("writes Convex-sourced mapMode to localStorage", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    // Clear any writes from hydration
    mockWriteMapMode.mockClear();

    act(() => {
      triggerConvexApply({ activeMapMode: "M5" });
    });

    expect(mockWriteMapMode).toHaveBeenCalledWith("user_123", "M5");
  });

  it("writes Convex-sourced caseLayout to localStorage", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    mockWriteCaseLayout.mockClear();

    act(() => {
      triggerConvexApply({ activeCaseLayout: "T2" });
    });

    expect(mockWriteCaseLayout).toHaveBeenCalledWith("user_123", "T2");
  });

  it("does not update activeMapMode when activeCaseLayout is broadcast (partial update)", async () => {
    mockReadMapMode.mockReturnValue("M2");
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    mockWriteMapMode.mockClear();

    act(() => {
      triggerConvexApply({ activeCaseLayout: "T5" }); // no activeMapMode
    });

    expect(result.current.activeMapMode).toBe("M2"); // unchanged
    expect(result.current.activeCaseLayout).toBe("T5"); // updated
    expect(mockWriteMapMode).not.toHaveBeenCalled();
    expect(mockWriteCaseLayout).toHaveBeenCalledWith("user_123", "T5");
  });

  it("ignores invalid mapMode values in the broadcast", async () => {
    const { result } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    const initialMode = result.current.activeMapMode;
    mockWriteMapMode.mockClear();

    act(() => {
      triggerConvexApply({ activeMapMode: "M9" }); // invalid
    });

    expect(result.current.activeMapMode).toBe(initialMode);
    expect(mockWriteMapMode).not.toHaveBeenCalled();
  });

  it("unsubscribes from the Convex channel on unmount", async () => {
    const { unmount } = renderHook(() => useLayoutPreferences("user_123"));
    await act(async () => {});

    expect(_applyHandlers.length).toBeGreaterThan(0);

    unmount();

    expect(_applyHandlers.length).toBe(0);
  });
});

// ─── Multiple instances ───────────────────────────────────────────────────────

describe("useLayoutPreferences — multiple hook instances", () => {
  it("Convex broadcast reaches all active hook instances simultaneously", async () => {
    const { result: r1 } = renderHook(() => useLayoutPreferences("user_A"));
    const { result: r2 } = renderHook(() => useLayoutPreferences("user_B"));
    await act(async () => {});

    // triggerConvexApply simulates ConvexLayoutSync calling applyConvexLayoutPrefs,
    // which calls all subscribed handlers — one per hook instance.
    act(() => {
      triggerConvexApply({ activeMapMode: "M2" });
    });

    expect(r1.current.activeMapMode).toBe("M2");
    expect(r2.current.activeMapMode).toBe("M2");
  });
});
