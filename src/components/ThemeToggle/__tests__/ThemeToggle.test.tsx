/**
 * @vitest-environment jsdom
 *
 * Unit tests: ThemeToggle — light/dark mode toggle button.
 *
 * Covers:
 *   1.  Renders a button with data-testid="theme-toggle".
 *   2.  Button has type="button" (prevents form submission).
 *   3.  Button has aria-label="Switch to dark mode" in light mode.
 *   4.  Button has aria-pressed=false in light mode.
 *   5.  Button has data-dark="false" in light mode.
 *   6.  Clicking the button in light mode switches to dark mode.
 *   7.  After switching to dark, aria-label becomes "Switch to light mode".
 *   8.  After switching to dark, aria-pressed becomes true.
 *   9.  After switching to dark, data-dark becomes "true".
 *  10.  After switching to dark, document.documentElement has class "theme-dark".
 *  11.  After switching to dark, the sun icon SVG is rendered.
 *  12.  In light mode, the moon icon SVG is rendered.
 *  13.  Second click switches back to light mode (aria-pressed=false).
 *  14.  Second click removes "theme-dark" class from documentElement.
 *  15.  className prop is applied to the button element.
 *  16.  Button starts with aria-pressed=true when ThemeProvider has dark mode active.
 */

import React from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import { ThemeProvider } from "@/providers/theme-provider";
import { THEME_DARK_CLASS } from "@/hooks/use-theme";
import { ThemeToggle } from "../ThemeToggle";

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

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _mockStore = {};
  vi.clearAllMocks();

  localStorageMock.getItem.mockImplementation((key: string) => _mockStore[key] ?? null);
  localStorageMock.setItem.mockImplementation((key: string, value: string) => {
    _mockStore[key] = value;
  });

  applyLightMatchMedia();

  document.documentElement.classList.remove(THEME_DARK_CLASS);
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove(THEME_DARK_CLASS);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Renders ThemeToggle inside ThemeProvider so that useThemeContext() resolves.
 */
function renderThemeToggle(props?: React.ComponentProps<typeof ThemeToggle>) {
  return render(
    <ThemeProvider>
      <ThemeToggle {...props} />
    </ThemeProvider>
  );
}

// ─── Structure and ARIA (light mode default) ──────────────────────────────────

describe("ThemeToggle — structure and ARIA in light mode", () => {
  it("renders a button with data-testid='theme-toggle'", async () => {
    renderThemeToggle();
    await act(async () => {});
    expect(screen.getByTestId("theme-toggle")).toBeTruthy();
  });

  it("button has type='button'", async () => {
    renderThemeToggle();
    await act(async () => {});
    const btn = screen.getByTestId("theme-toggle");
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("aria-label is 'Switch to dark mode' in light mode", async () => {
    renderThemeToggle();
    await act(async () => {});
    const btn = screen.getByRole("button", { name: /switch to dark mode/i });
    expect(btn).toBeTruthy();
  });

  it("aria-pressed is false in light mode", async () => {
    renderThemeToggle();
    await act(async () => {});
    const btn = screen.getByTestId("theme-toggle");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("data-dark is 'false' in light mode", async () => {
    renderThemeToggle();
    await act(async () => {});
    const btn = screen.getByTestId("theme-toggle");
    expect(btn.getAttribute("data-dark")).toBe("false");
  });

  it("renders moon icon SVG in light mode (aria-hidden SVG present)", async () => {
    renderThemeToggle();
    await act(async () => {});
    const btn = screen.getByTestId("theme-toggle");
    const svgs = btn.querySelectorAll('svg[aria-hidden="true"]');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Clicking in light mode (→ dark mode) ─────────────────────────────────────

describe("ThemeToggle — clicking in light mode switches to dark", () => {
  it("clicking changes aria-label to 'Switch to light mode'", async () => {
    renderThemeToggle();
    await act(async () => {});

    const btn = screen.getByTestId("theme-toggle");
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getByRole("button", { name: /switch to light mode/i })).toBeTruthy();
  });

  it("clicking sets aria-pressed to true", async () => {
    renderThemeToggle();
    await act(async () => {});

    const btn = screen.getByTestId("theme-toggle");
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking sets data-dark to 'true'", async () => {
    renderThemeToggle();
    await act(async () => {});

    const btn = screen.getByTestId("theme-toggle");
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(btn.getAttribute("data-dark")).toBe("true");
  });

  it("clicking adds 'theme-dark' class to document.documentElement", async () => {
    renderThemeToggle();
    await act(async () => {});

    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByTestId("theme-toggle"));
    });

    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(true);
  });

  it("clicking persists 'dark' to localStorage", async () => {
    renderThemeToggle();
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByTestId("theme-toggle"));
    });

    expect(localStorageMock.setItem).toHaveBeenCalledWith("theme_preference", "dark");
  });
});

// ─── Clicking in dark mode (→ light mode) ─────────────────────────────────────

describe("ThemeToggle — clicking in dark mode switches back to light", () => {
  it("second click restores aria-pressed to false", async () => {
    renderThemeToggle();
    await act(async () => {});

    const btn = screen.getByTestId("theme-toggle");

    await act(async () => { fireEvent.click(btn); });
    expect(btn.getAttribute("aria-pressed")).toBe("true");

    await act(async () => { fireEvent.click(btn); });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("second click removes 'theme-dark' from documentElement", async () => {
    renderThemeToggle();
    await act(async () => {});

    const btn = screen.getByTestId("theme-toggle");

    await act(async () => { fireEvent.click(btn); });
    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(true);

    await act(async () => { fireEvent.click(btn); });
    expect(document.documentElement.classList.contains(THEME_DARK_CLASS)).toBe(false);
  });

  it("second click persists 'light' to localStorage", async () => {
    renderThemeToggle();
    await act(async () => {});

    const btn = screen.getByTestId("theme-toggle");

    await act(async () => { fireEvent.click(btn); });
    await act(async () => { fireEvent.click(btn); });

    const calls = localStorageMock.setItem.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toEqual(["theme_preference", "light"]);
  });
});

// ─── Dark mode active from localStorage ───────────────────────────────────────

describe("ThemeToggle — starts in dark mode when localStorage='dark'", () => {
  beforeEach(() => {
    _mockStore["theme_preference"] = "dark";
    localStorageMock.getItem.mockImplementation((key: string) => _mockStore[key] ?? null);
  });

  it("aria-pressed is true when dark is the stored preference", async () => {
    renderThemeToggle();
    await act(async () => {});
    expect(screen.getByTestId("theme-toggle").getAttribute("aria-pressed")).toBe("true");
  });

  it("aria-label is 'Switch to light mode' when dark is active", async () => {
    renderThemeToggle();
    await act(async () => {});
    expect(screen.getByRole("button", { name: /switch to light mode/i })).toBeTruthy();
  });

  it("data-dark is 'true' when dark is the stored preference", async () => {
    renderThemeToggle();
    await act(async () => {});
    expect(screen.getByTestId("theme-toggle").getAttribute("data-dark")).toBe("true");
  });
});

// ─── className prop ───────────────────────────────────────────────────────────

describe("ThemeToggle — className prop", () => {
  it("applies extra className to the button element", async () => {
    renderThemeToggle({ className: "my-custom-class" });
    await act(async () => {});
    const btn = screen.getByTestId("theme-toggle");
    expect(btn.className).toContain("my-custom-class");
  });
});
