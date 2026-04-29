/**
 * @vitest-environment jsdom
 *
 * src/providers/__tests__/theme-provider.test.tsx
 *
 * Unit tests for ThemeProvider, useThemeContext(), and useIsDark().
 *
 * Covers:
 *   - ThemeProvider provides default "light" / isDark=false state
 *   - useThemeContext() reads isDark correctly from provider
 *   - useThemeContext() toggleTheme switches isDark
 *   - useThemeContext() setTheme("dark") sets isDark=true
 *   - useThemeContext() setTheme("light") sets isDark=false
 *   - useIsDark() returns false by default
 *   - useIsDark() returns true after toggle
 *   - ThemeContext default value provides no-op setters (no throw outside provider)
 *   - Theme state is shared across multiple consumers in the same provider
 *
 * Run with: npx vitest run src/providers/__tests__/theme-provider.test.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { act } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  ThemeProvider,
  useThemeContext,
  useIsDark,
} from "../theme-provider";
import { THEME_DARK_CLASS } from "@/hooks/use-theme";

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

// ─── matchMedia mock ──────────────────────────────────────────────────────────

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false, // default: light OS preference
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ─── matchMedia factory (re-used after every vi.resetAllMocks()) ──────────────

function applyLightMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, // default: light OS preference
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _mockStore = {};

  // vi.clearAllMocks() clears call counts and instances but preserves
  // mock implementations — unlike vi.resetAllMocks() which would clear
  // the window.matchMedia implementation and cause matchMedia().matches to throw.
  vi.clearAllMocks();

  // Re-apply localStorage implementations (they may have been overridden by
  // individual tests using .mockReturnValue / .mockImplementation).
  localStorageMock.getItem.mockImplementation((key: string) => _mockStore[key] ?? null);
  localStorageMock.setItem.mockImplementation((key: string, value: string) => {
    _mockStore[key] = value;
  });

  // Re-apply the matchMedia implementation so each test starts with a
  // known, fresh mock (light OS preference by default).
  applyLightMatchMedia();

  document.documentElement.classList.remove(THEME_DARK_CLASS);
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove(THEME_DARK_CLASS);
});

// ─── Test components ──────────────────────────────────────────────────────────

/**
 * Renders the current theme state as data-* attributes for assertion.
 */
function ThemeDisplay() {
  const { theme, isDark } = useThemeContext();
  return (
    <div
      data-testid="theme-display"
      data-theme={theme}
      data-is-dark={String(isDark)}
    />
  );
}

/**
 * Renders a toggle button + state display.
 */
function ToggleButton() {
  const { isDark, toggleTheme } = useThemeContext();
  return (
    <button
      data-testid="toggle-btn"
      data-is-dark={String(isDark)}
      onClick={toggleTheme}
    >
      {isDark ? "Switch to light" : "Switch to dark"}
    </button>
  );
}

/**
 * Renders a button that calls setTheme("dark").
 */
function SetDarkButton() {
  const { setTheme } = useThemeContext();
  return (
    <button data-testid="set-dark-btn" onClick={() => setTheme("dark")}>
      Go dark
    </button>
  );
}

/**
 * Renders a button that calls setTheme("light").
 */
function SetLightButton() {
  const { setTheme } = useThemeContext();
  return (
    <button data-testid="set-light-btn" onClick={() => setTheme("light")}>
      Go light
    </button>
  );
}

/**
 * Uses the lightweight useIsDark() hook.
 */
function IsDarkDisplay() {
  const isDark = useIsDark();
  return (
    <span data-testid="is-dark-display" data-is-dark={String(isDark)} />
  );
}

function renderWithProvider(ui: ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

// ─── Default state ────────────────────────────────────────────────────────────

describe("ThemeProvider — default state (no localStorage, light OS)", () => {
  it("exposes theme='light' by default", async () => {
    renderWithProvider(<ThemeDisplay />);
    await act(async () => {});
    expect(screen.getByTestId("theme-display").getAttribute("data-theme")).toBe("light");
  });

  it("exposes isDark=false by default", async () => {
    renderWithProvider(<ThemeDisplay />);
    await act(async () => {});
    expect(screen.getByTestId("theme-display").getAttribute("data-is-dark")).toBe("false");
  });

  it("does not add theme-dark class to <html> by default", async () => {
    renderWithProvider(<ThemeDisplay />);
    await act(async () => {});
    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(false);
  });
});

// ─── toggleTheme ──────────────────────────────────────────────────────────────

describe("ThemeProvider — toggleTheme", () => {
  it("switches isDark from false to true when toggled", async () => {
    renderWithProvider(<ToggleButton />);
    await act(async () => {});

    expect(screen.getByTestId("toggle-btn").getAttribute("data-is-dark")).toBe("false");

    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle-btn"));
    });

    expect(screen.getByTestId("toggle-btn").getAttribute("data-is-dark")).toBe("true");
  });

  it("adds theme-dark class to <html> when toggled to dark", async () => {
    renderWithProvider(<ToggleButton />);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle-btn"));
    });

    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(true);
  });

  it("switches isDark back to false when toggled a second time", async () => {
    renderWithProvider(<ToggleButton />);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle-btn"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle-btn"));
    });

    expect(screen.getByTestId("toggle-btn").getAttribute("data-is-dark")).toBe("false");
  });

  it("removes theme-dark class when toggled back to light", async () => {
    renderWithProvider(<ToggleButton />);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle-btn"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle-btn"));
    });

    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(false);
  });
});

// ─── setTheme ─────────────────────────────────────────────────────────────────

describe("ThemeProvider — setTheme('dark')", () => {
  it("sets isDark=true via setTheme('dark')", async () => {
    renderWithProvider(
      <>
        <ThemeDisplay />
        <SetDarkButton />
      </>
    );
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByTestId("set-dark-btn"));
    });

    expect(screen.getByTestId("theme-display").getAttribute("data-is-dark")).toBe("true");
    expect(screen.getByTestId("theme-display").getAttribute("data-theme")).toBe("dark");
  });

  it("adds theme-dark class after setTheme('dark')", async () => {
    renderWithProvider(<SetDarkButton />);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByTestId("set-dark-btn"));
    });

    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(true);
  });
});

describe("ThemeProvider — setTheme('light')", () => {
  beforeEach(() => {
    _mockStore["theme_preference"] = "dark";
    localStorageMock.getItem.mockImplementation((key: string) => _mockStore[key] ?? null);
  });

  it("sets isDark=false via setTheme('light') when dark was active", async () => {
    renderWithProvider(
      <>
        <ThemeDisplay />
        <SetLightButton />
      </>
    );
    await act(async () => {});

    // Should start dark (from localStorage)
    expect(screen.getByTestId("theme-display").getAttribute("data-is-dark")).toBe("true");

    await act(async () => {
      fireEvent.click(screen.getByTestId("set-light-btn"));
    });

    expect(screen.getByTestId("theme-display").getAttribute("data-is-dark")).toBe("false");
  });

  it("removes theme-dark class after setTheme('light')", async () => {
    renderWithProvider(<SetLightButton />);
    await act(async () => {});

    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByTestId("set-light-btn"));
    });

    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(false);
  });
});

// ─── useIsDark ────────────────────────────────────────────────────────────────

describe("useIsDark", () => {
  it("returns false when in light mode", async () => {
    renderWithProvider(<IsDarkDisplay />);
    await act(async () => {});
    expect(screen.getByTestId("is-dark-display").getAttribute("data-is-dark")).toBe("false");
  });

  it("returns true after toggling to dark", async () => {
    renderWithProvider(
      <>
        <IsDarkDisplay />
        <ToggleButton />
      </>
    );
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle-btn"));
    });

    expect(screen.getByTestId("is-dark-display").getAttribute("data-is-dark")).toBe("true");
  });
});

// ─── Multiple consumers share state ───────────────────────────────────────────

describe("ThemeProvider — shared state across consumers", () => {
  it("all consumers see isDark=true after a single toggle", async () => {
    renderWithProvider(
      <>
        <ThemeDisplay />
        <IsDarkDisplay />
        <ToggleButton />
      </>
    );
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle-btn"));
    });

    expect(screen.getByTestId("theme-display").getAttribute("data-is-dark")).toBe("true");
    expect(screen.getByTestId("is-dark-display").getAttribute("data-is-dark")).toBe("true");
  });
});

// ─── ThemeContext default (outside provider) ──────────────────────────────────
//
// Components rendered outside ThemeProvider receive the context default:
//   { theme: "light", isDark: false, toggleTheme: () => {}, setTheme: () => {} }
// This test renders a consumer WITHOUT wrapping it in ThemeProvider.

function DefaultConsumer() {
  const ctx = useThemeContext();
  return (
    <div
      data-testid="default-consumer"
      data-is-dark={String(ctx.isDark)}
      data-theme={ctx.theme}
    >
      <button
        data-testid="default-toggle"
        onClick={() => {
          // Should not throw — is a no-op outside the provider
          ctx.toggleTheme();
        }}
      >
        toggle
      </button>
      <button
        data-testid="default-set-dark"
        onClick={() => {
          ctx.setTheme("dark");
        }}
      >
        set dark
      </button>
    </div>
  );
}

describe("ThemeContext default value (rendered outside ThemeProvider)", () => {
  it("provides isDark=false as the default context value", async () => {
    render(<DefaultConsumer />);
    await act(async () => {});
    expect(screen.getByTestId("default-consumer").getAttribute("data-is-dark")).toBe("false");
  });

  it("provides theme='light' as the default context value", async () => {
    render(<DefaultConsumer />);
    await act(async () => {});
    expect(screen.getByTestId("default-consumer").getAttribute("data-theme")).toBe("light");
  });

  it("no-op toggleTheme does not throw when called outside provider", async () => {
    render(<DefaultConsumer />);
    await act(async () => {});
    await expect(
      act(async () => {
        fireEvent.click(screen.getByTestId("default-toggle"));
      })
    ).resolves.not.toThrow();
  });

  it("no-op setTheme does not throw when called outside provider", async () => {
    render(<DefaultConsumer />);
    await act(async () => {});
    await expect(
      act(async () => {
        fireEvent.click(screen.getByTestId("default-set-dark"));
      })
    ).resolves.not.toThrow();
  });
});

// ─── localStorage hydration from stored dark preference ───────────────────────

describe("ThemeProvider — starts dark when localStorage='dark'", () => {
  beforeEach(() => {
    _mockStore["theme_preference"] = "dark";
    localStorageMock.getItem.mockImplementation((key: string) => _mockStore[key] ?? null);
  });

  it("exposes isDark=true when localStorage has 'dark'", async () => {
    renderWithProvider(<ThemeDisplay />);
    await act(async () => {});
    expect(screen.getByTestId("theme-display").getAttribute("data-is-dark")).toBe("true");
  });

  it("adds theme-dark class to <html> when localStorage has 'dark'", async () => {
    renderWithProvider(<ThemeDisplay />);
    await act(async () => {});
    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(true);
  });
});
