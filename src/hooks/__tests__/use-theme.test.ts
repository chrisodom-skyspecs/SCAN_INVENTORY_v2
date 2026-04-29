/**
 * @vitest-environment jsdom
 *
 * Unit tests: useTheme hook
 *
 * Tests:
 *   1.  Returns "light" as the initial theme (default before hydration).
 *   2.  isDark is false when theme is "light".
 *   3.  Applies "light" on mount when no localStorage value and no OS preference.
 *   4.  Does NOT add theme-dark class to <html> on mount when light.
 *   5.  Reads "dark" from localStorage on mount and returns isDark=true.
 *   6.  Adds theme-dark class to <html> when localStorage has "dark".
 *   7.  Ignores invalid localStorage values and falls back to OS preference.
 *   8.  Falls back to "light" when no localStorage and no OS dark preference.
 *   9.  Falls back to "dark" when no localStorage but OS prefers dark.
 *  10.  toggleTheme switches from light to dark.
 *  11.  toggleTheme adds theme-dark class to <html>.
 *  12.  toggleTheme calls localStorage.setItem with "dark".
 *  13.  toggleTheme switches from dark to light.
 *  14.  toggleTheme removes theme-dark class from <html>.
 *  15.  toggleTheme calls localStorage.setItem with "light".
 *  16.  setTheme("dark") sets isDark=true.
 *  17.  setTheme("dark") adds theme-dark class.
 *  18.  setTheme("dark") persists to localStorage.
 *  19.  setTheme("light") sets isDark=false.
 *  20.  setTheme("light") removes theme-dark class.
 *  21.  setTheme with invalid value is a no-op.
 *  22.  THEME_STORAGE_KEY is exported and equals "theme_preference".
 *  23.  THEME_DARK_CLASS is exported and equals "theme-dark".
 *  24.  toggleTheme is referentially stable across re-renders.
 *  25.  setTheme is referentially stable across re-renders.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useTheme, THEME_STORAGE_KEY, THEME_DARK_CLASS } from "../use-theme";

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

// ─── matchMedia mock ──────────────────────────────────────────────────────────

let _systemPrefersDark = false;

function createMatchMediaMock(prefersDark: boolean) {
  return vi.fn().mockImplementation((query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" ? prefersDark : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: createMatchMediaMock(false),
});

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _mockStore = {};
  _systemPrefersDark = false;

  vi.resetAllMocks();

  // Re-apply default implementations after reset
  localStorageMock.getItem.mockImplementation((key: string) => _mockStore[key] ?? null);
  localStorageMock.setItem.mockImplementation((key: string, value: string) => {
    _mockStore[key] = value;
  });

  // Apply light system preference by default
  window.matchMedia = createMatchMediaMock(false);

  // Reset <html> class to a clean slate
  document.documentElement.classList.remove(THEME_DARK_CLASS);
});

afterEach(() => {
  document.documentElement.classList.remove(THEME_DARK_CLASS);
});

// ─── Exported constants ───────────────────────────────────────────────────────

describe("THEME_STORAGE_KEY", () => {
  it("is exported and equals 'theme_preference'", () => {
    expect(THEME_STORAGE_KEY).toBe("theme_preference");
  });
});

describe("THEME_DARK_CLASS", () => {
  it("is exported and equals 'theme-dark'", () => {
    expect(THEME_DARK_CLASS).toBe("theme-dark");
  });
});

// ─── Initial state ────────────────────────────────────────────────────────────

describe("useTheme — initial state (no localStorage, light OS preference)", () => {
  it("returns 'light' as the initial theme before hydration", () => {
    const { result } = renderHook(() => useTheme());
    // Before the useEffect fires, the hook should return the compile-time default
    expect(result.current.theme).toBe("light");
  });

  it("isDark is false initially", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(false);
  });

  it("resolves to 'light' after hydration when no stored preference and OS is light", async () => {
    window.matchMedia = createMatchMediaMock(false);
    const { result } = renderHook(() => useTheme());
    await act(async () => {});
    expect(result.current.theme).toBe("light");
    expect(result.current.isDark).toBe(false);
  });

  it("does NOT add theme-dark class to <html> when resolved theme is 'light'", async () => {
    window.matchMedia = createMatchMediaMock(false);
    renderHook(() => useTheme());
    await act(async () => {});
    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(false);
  });
});

// ─── OS dark preference ───────────────────────────────────────────────────────

describe("useTheme — OS dark preference fallback", () => {
  it("resolves to 'dark' when OS prefers dark and no stored preference", async () => {
    window.matchMedia = createMatchMediaMock(true);
    const { result } = renderHook(() => useTheme());
    await act(async () => {});
    expect(result.current.theme).toBe("dark");
    expect(result.current.isDark).toBe(true);
  });

  it("adds theme-dark class to <html> when OS prefers dark", async () => {
    window.matchMedia = createMatchMediaMock(true);
    renderHook(() => useTheme());
    await act(async () => {});
    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(true);
  });
});

// ─── localStorage hydration ───────────────────────────────────────────────────

describe("useTheme — localStorage hydration", () => {
  it("returns isDark=true when localStorage has 'dark'", async () => {
    localStorageMock.getItem.mockReturnValue("dark");
    const { result } = renderHook(() => useTheme());
    await act(async () => {});
    expect(result.current.isDark).toBe(true);
    expect(result.current.theme).toBe("dark");
  });

  it("adds theme-dark class to <html> when localStorage has 'dark'", async () => {
    localStorageMock.getItem.mockReturnValue("dark");
    renderHook(() => useTheme());
    await act(async () => {});
    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(true);
  });

  it("returns isDark=false when localStorage has 'light'", async () => {
    localStorageMock.getItem.mockReturnValue("light");
    const { result } = renderHook(() => useTheme());
    await act(async () => {});
    expect(result.current.isDark).toBe(false);
  });

  it("falls back to OS preference when localStorage has an invalid value", async () => {
    localStorageMock.getItem.mockReturnValue("sepia"); // invalid
    window.matchMedia = createMatchMediaMock(false);   // OS = light
    const { result } = renderHook(() => useTheme());
    await act(async () => {});
    expect(result.current.theme).toBe("light");
  });

  it("falls back to OS dark when localStorage has null", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (localStorageMock.getItem as any).mockReturnValue(null);
    window.matchMedia = createMatchMediaMock(true); // OS = dark
    const { result } = renderHook(() => useTheme());
    await act(async () => {});
    expect(result.current.theme).toBe("dark");
  });

  it("stored 'light' overrides OS dark preference", async () => {
    localStorageMock.getItem.mockReturnValue("light");
    window.matchMedia = createMatchMediaMock(true); // OS = dark, but stored is light
    const { result } = renderHook(() => useTheme());
    await act(async () => {});
    expect(result.current.theme).toBe("light");
    expect(result.current.isDark).toBe(false);
  });
});

// ─── toggleTheme ──────────────────────────────────────────────────────────────

describe("useTheme — toggleTheme (light → dark)", () => {
  it("switches theme from 'light' to 'dark'", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe("dark");
    expect(result.current.isDark).toBe(true);
  });

  it("adds theme-dark class to <html> after toggling to dark", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(true);
  });

  it("calls localStorage.setItem with 'dark' after toggling to dark", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    act(() => {
      result.current.toggleTheme();
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "dark");
  });
});

describe("useTheme — toggleTheme (dark → light)", () => {
  beforeEach(() => {
    localStorageMock.getItem.mockReturnValue("dark");
  });

  it("switches theme from 'dark' to 'light'", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe("light");
    expect(result.current.isDark).toBe(false);
  });

  it("removes theme-dark class from <html> after toggling back to light", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(true);

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(false);
  });

  it("calls localStorage.setItem with 'light' after toggling back to light", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    act(() => {
      result.current.toggleTheme();
    });

    const calls = localStorageMock.setItem.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toEqual([THEME_STORAGE_KEY, "light"]);
  });
});

// ─── setTheme ─────────────────────────────────────────────────────────────────

describe("useTheme — setTheme", () => {
  it("setTheme('dark') sets isDark=true", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    act(() => {
      result.current.setTheme("dark");
    });

    expect(result.current.isDark).toBe(true);
    expect(result.current.theme).toBe("dark");
  });

  it("setTheme('dark') adds theme-dark class to <html>", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    act(() => {
      result.current.setTheme("dark");
    });

    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(true);
  });

  it("setTheme('dark') persists to localStorage", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    act(() => {
      result.current.setTheme("dark");
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "dark");
  });

  it("setTheme('light') sets isDark=false", async () => {
    localStorageMock.getItem.mockReturnValue("dark");
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    act(() => {
      result.current.setTheme("light");
    });

    expect(result.current.isDark).toBe(false);
    expect(result.current.theme).toBe("light");
  });

  it("setTheme('light') removes theme-dark class from <html>", async () => {
    localStorageMock.getItem.mockReturnValue("dark");
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(true);

    act(() => {
      result.current.setTheme("light");
    });

    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(false);
  });

  it("setTheme with an invalid value is a no-op", async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => {});

    const themeBefore = result.current.theme;
    const hasDarkBefore = document.documentElement.classList.contains(THEME_DARK_CLASS);

    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result.current.setTheme as any)("sepia");
    });

    expect(result.current.theme).toBe(themeBefore);
    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(hasDarkBefore);

    // setItem should NOT have been called with the invalid value
    const invalidCalls = localStorageMock.setItem.mock.calls.filter(
      ([, val]) => val === "sepia",
    );
    expect(invalidCalls).toHaveLength(0);
  });
});

// ─── Referential stability ────────────────────────────────────────────────────

describe("useTheme — referential stability", () => {
  it("toggleTheme is the same reference across re-renders", async () => {
    const { result, rerender } = renderHook(() => useTheme());
    await act(async () => {});

    const first = result.current.toggleTheme;
    rerender();
    const second = result.current.toggleTheme;

    expect(first).toBe(second);
  });

  it("setTheme is the same reference across re-renders", async () => {
    const { result, rerender } = renderHook(() => useTheme());
    await act(async () => {});

    const first = result.current.setTheme;
    rerender();
    const second = result.current.setTheme;

    expect(first).toBe(second);
  });
});
