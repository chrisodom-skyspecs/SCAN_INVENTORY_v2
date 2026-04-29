/**
 * @vitest-environment jsdom
 *
 * Unit tests: DensityToggle — density mode control UI.
 *
 * Tests:
 *   1.  Renders the wrapper with role="group" and aria-label="Display density".
 *   2.  Renders both "Comfy" and "Compact" buttons.
 *   3.  "Comfy" button starts as active (aria-pressed=true) by default.
 *   4.  "Compact" button starts as inactive (aria-pressed=false) by default.
 *   5.  Clicking "Compact" sets aria-pressed=true on compact + false on comfy.
 *   6.  Clicking "Compact" sets data-density="compact" on document.documentElement.
 *   7.  Clicking "Compact" writes "compact" to localStorage["inv_density"].
 *   8.  Clicking "Comfy" after compact restores data-density="comfy".
 *   9.  Clicking "Comfy" after compact writes "comfy" to localStorage["inv_density"].
 *  10.  On mount, reads "compact" from localStorage and sets aria-pressed accordingly.
 *  11.  On mount with no localStorage value, defaults to "comfy".
 *  12.  On mount with invalid localStorage value, defaults to "comfy".
 *  13.  Each button has type="button" (prevents form submission).
 *  14.  data-testid attributes are present for test selection.
 */

import React from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import { DensityToggle } from "../DensityToggle";
import { DENSITY_STORAGE_KEY } from "@/hooks/use-density";

// ─── localStorage mock ────────────────────────────────────────────────────────

/**
 * Simple in-memory localStorage mock.
 * jsdom provides a real localStorage implementation, but we mock it here so
 * that tests are fully isolated and we can spy on setItem / getItem calls.
 */
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

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset in-memory store
  _mockStore = {};

  // Reset ALL mock state (calls + return-value overrides + implementations)
  // so that mockReturnValue("compact") in one test does not leak into the next.
  vi.resetAllMocks();

  // Re-apply the default getItem implementation after reset so tests that do
  // not call mockReturnValue() still read from _mockStore correctly.
  localStorageMock.getItem.mockImplementation((key: string) => _mockStore[key] ?? null);

  // Reset document root data-density attribute
  document.documentElement.removeAttribute("data-density");
});

afterEach(() => {
  cleanup();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderDensityToggle(className?: string) {
  return render(<DensityToggle className={className} />);
}

// ─── Structure and ARIA ───────────────────────────────────────────────────────

describe("DensityToggle — structure and ARIA", () => {
  it("renders with role='group' and aria-label='Display density'", () => {
    renderDensityToggle();
    const group = screen.getByRole("group", { name: /display density/i });
    expect(group).toBeTruthy();
  });

  it("renders a 'Comfy' button", () => {
    renderDensityToggle();
    const comfy = screen.getByRole("button", { name: /comfy/i });
    expect(comfy).toBeTruthy();
  });

  it("renders a 'Compact' button", () => {
    renderDensityToggle();
    const compact = screen.getByRole("button", { name: /compact/i });
    expect(compact).toBeTruthy();
  });

  it("both buttons have type='button'", () => {
    renderDensityToggle();
    const buttons = screen.getAllByRole("button");
    for (const btn of buttons) {
      expect(btn.getAttribute("type")).toBe("button");
    }
  });

  it("renders with data-testid='density-toggle' on the wrapper", () => {
    renderDensityToggle();
    expect(screen.getByTestId("density-toggle")).toBeTruthy();
  });

  it("renders with data-testid='density-toggle-comfy' on the comfy button", () => {
    renderDensityToggle();
    expect(screen.getByTestId("density-toggle-comfy")).toBeTruthy();
  });

  it("renders with data-testid='density-toggle-compact' on the compact button", () => {
    renderDensityToggle();
    expect(screen.getByTestId("density-toggle-compact")).toBeTruthy();
  });
});

// ─── Default state (no localStorage value) ─────────────────────────────────────

describe("DensityToggle — default state (comfy)", () => {
  it("comfy button has aria-pressed=true by default", async () => {
    renderDensityToggle();
    // After the mount effect hydrates from localStorage (empty → default = comfy):
    const comfy = screen.getByTestId("density-toggle-comfy");
    // Wait for the useEffect to fire (act flushes microtasks)
    await act(async () => {});
    expect(comfy.getAttribute("aria-pressed")).toBe("true");
  });

  it("compact button has aria-pressed=false by default", async () => {
    renderDensityToggle();
    const compact = screen.getByTestId("density-toggle-compact");
    await act(async () => {});
    expect(compact.getAttribute("aria-pressed")).toBe("false");
  });

  it("comfy button has data-active='true' by default", async () => {
    renderDensityToggle();
    const comfy = screen.getByTestId("density-toggle-comfy");
    await act(async () => {});
    expect(comfy.getAttribute("data-active")).toBe("true");
  });

  it("compact button has data-active='false' by default", async () => {
    renderDensityToggle();
    const compact = screen.getByTestId("density-toggle-compact");
    await act(async () => {});
    expect(compact.getAttribute("data-active")).toBe("false");
  });
});

// ─── Clicking compact ─────────────────────────────────────────────────────────

describe("DensityToggle — clicking compact", () => {
  it("sets compact button aria-pressed to true", async () => {
    renderDensityToggle();
    await act(async () => {});

    fireEvent.click(screen.getByTestId("density-toggle-compact"));

    expect(screen.getByTestId("density-toggle-compact").getAttribute("aria-pressed")).toBe("true");
  });

  it("sets comfy button aria-pressed to false after compact is selected", async () => {
    renderDensityToggle();
    await act(async () => {});

    fireEvent.click(screen.getByTestId("density-toggle-compact"));

    expect(screen.getByTestId("density-toggle-comfy").getAttribute("aria-pressed")).toBe("false");
  });

  it("sets data-density='compact' on document.documentElement", async () => {
    renderDensityToggle();
    await act(async () => {});

    fireEvent.click(screen.getByTestId("density-toggle-compact"));

    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
  });

  it("writes 'compact' to localStorage", async () => {
    renderDensityToggle();
    await act(async () => {});

    fireEvent.click(screen.getByTestId("density-toggle-compact"));

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      DENSITY_STORAGE_KEY,
      "compact",
    );
  });
});

// ─── Clicking comfy after compact ────────────────────────────────────────────

describe("DensityToggle — clicking comfy after compact", () => {
  it("restores data-density='comfy' on document.documentElement", async () => {
    renderDensityToggle();
    await act(async () => {});

    fireEvent.click(screen.getByTestId("density-toggle-compact"));
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");

    fireEvent.click(screen.getByTestId("density-toggle-comfy"));
    expect(document.documentElement.getAttribute("data-density")).toBe("comfy");
  });

  it("writes 'comfy' to localStorage", async () => {
    renderDensityToggle();
    await act(async () => {});

    fireEvent.click(screen.getByTestId("density-toggle-compact"));
    fireEvent.click(screen.getByTestId("density-toggle-comfy"));

    // Last call should be 'comfy'
    const calls = localStorageMock.setItem.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toEqual([DENSITY_STORAGE_KEY, "comfy"]);
  });
});

// ─── localStorage hydration ───────────────────────────────────────────────────

describe("DensityToggle — localStorage hydration", () => {
  it("reads 'compact' from localStorage on mount and activates compact", async () => {
    // Pre-seed localStorage before rendering
    localStorageMock.getItem.mockReturnValue("compact");

    renderDensityToggle();
    await act(async () => {});

    expect(screen.getByTestId("density-toggle-compact").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("density-toggle-comfy").getAttribute("aria-pressed")).toBe("false");
  });

  it("reads 'compact' from localStorage and sets data-density on documentElement", async () => {
    localStorageMock.getItem.mockReturnValue("compact");

    renderDensityToggle();
    await act(async () => {});

    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
  });

  it("defaults to comfy when localStorage has no value", async () => {
    // getItem returns null by default (no mock override)

    renderDensityToggle();
    await act(async () => {});

    expect(screen.getByTestId("density-toggle-comfy").getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.getAttribute("data-density")).toBe("comfy");
  });

  it("defaults to comfy when localStorage has an invalid value", async () => {
    localStorageMock.getItem.mockReturnValue("ultra"); // not a valid density

    renderDensityToggle();
    await act(async () => {});

    expect(screen.getByTestId("density-toggle-comfy").getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.getAttribute("data-density")).toBe("comfy");
  });
});

// ─── className prop ───────────────────────────────────────────────────────────

describe("DensityToggle — className prop", () => {
  it("applies extra className to the wrapper", () => {
    renderDensityToggle("my-custom-class");
    const wrapper = screen.getByTestId("density-toggle");
    expect(wrapper.className).toContain("my-custom-class");
  });
});
