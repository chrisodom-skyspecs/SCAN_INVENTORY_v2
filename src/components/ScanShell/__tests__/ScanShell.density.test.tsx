/**
 * @vitest-environment jsdom
 *
 * ScanShell.density.test.tsx — data-density attribute and propagation tests
 *
 * Sub-AC 44c-1: Apply data-density attribute (compact/comfortable) to the
 * SCAN mobile app root element and confirm it propagates correctly via CSS
 * attribute selectors or context to child components.
 *
 * Test areas:
 *   A. Root element attribute — ScanShell renders data-density on its div
 *   B. Default density — comfy is the default before localStorage hydrates
 *   C. localStorage hydration — persisted preference is read and applied
 *   D. Setter — calling setDensity updates data-density on the root
 *   E. React context propagation — child components receive density via context
 *   F. CSS cascade propagation — CSS custom properties resolve correctly
 *      under both comfy and compact data-density values
 *   G. Persistence — changes are written to localStorage["scan_density"]
 *   H. Guard — invalid density values are rejected (no-op)
 *
 * Architecture note:
 *   ScanShell applies data-density to a div (not document.documentElement).
 *   This is deliberate — the SCAN app maintains its own density preference
 *   independent of the INVENTORY dashboard (which uses "inv_density" and
 *   applies to the html element).
 */

import React, { useContext } from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import { ScanShell } from "../ScanShell";
import { ScanDensityContext } from "@/providers/scan-density-provider";
import { SCAN_DENSITY_STORAGE_KEY } from "@/hooks/use-scan-density";
import type { Density } from "@/hooks/use-density";

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

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _mockStore = {};
  vi.resetAllMocks();
  localStorageMock.getItem.mockImplementation(
    ((key: string) => _mockStore[key] ?? null) as never
  );
});

afterEach(() => {
  cleanup();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Render ScanShell with optional children.
 * Returns the shell root element (the div with data-density).
 */
function renderScanShell(children?: React.ReactNode) {
  const { container } = render(
    <ScanShell>{children ?? <div data-testid="child">content</div>}</ScanShell>
  );
  return { container };
}

/**
 * A consumer component that reads density from ScanDensityContext.
 * Used to verify React context propagation.
 */
function DensityConsumer() {
  const { density, setDensity } = useContext(ScanDensityContext);
  return (
    <div>
      <span data-testid="context-density">{density}</span>
      <button
        type="button"
        data-testid="set-compact"
        onClick={() => setDensity("compact")}
      >
        Set Compact
      </button>
      <button
        type="button"
        data-testid="set-comfy"
        onClick={() => setDensity("comfy")}
      >
        Set Comfy
      </button>
    </div>
  );
}

/** Invokes setDensity with a value rejected by the hook guard (runtime no-op). */
function InvalidDensityInvoker() {
  const { setDensity } = useContext(ScanDensityContext);
  return (
    <button
      type="button"
      data-testid="set-invalid-density"
      onClick={() => setDensity("ultra-wide" as Density)}
    >
      Invalid
    </button>
  );
}

// ─── A: Root element attribute ────────────────────────────────────────────────

describe("ScanShell — A: Root element attribute", () => {
  it("renders a div with data-testid='scan-shell'", async () => {
    renderScanShell();
    await act(async () => {});
    expect(screen.getByTestId("scan-shell")).toBeTruthy();
  });

  it("root div has data-app='scan'", async () => {
    renderScanShell();
    await act(async () => {});
    const shell = screen.getByTestId("scan-shell");
    expect(shell.getAttribute("data-app")).toBe("scan");
  });

  it("root div has data-density attribute", async () => {
    renderScanShell();
    await act(async () => {});
    const shell = screen.getByTestId("scan-shell");
    const density = shell.getAttribute("data-density");
    expect(density).toBeTruthy();
    expect(["comfy", "compact"]).toContain(density);
  });

  it("data-density is on the ScanShell root div, NOT on document.documentElement", async () => {
    renderScanShell();
    await act(async () => {});

    // ScanShell should set data-density on its own root div
    const shell = screen.getByTestId("scan-shell");
    expect(shell.getAttribute("data-density")).toBeTruthy();

    // document.documentElement must NOT have been modified by ScanShell
    // (that would conflict with INVENTORY's useDensity hook)
    expect(document.documentElement.getAttribute("data-density")).toBeNull();
  });
});

// ─── B: Default density ───────────────────────────────────────────────────────

describe("ScanShell — B: Default density (comfy)", () => {
  it("renders data-density='comfy' by default (no localStorage value)", async () => {
    // localStorage is empty (default mock returns null)
    renderScanShell();
    await act(async () => {});

    const shell = screen.getByTestId("scan-shell");
    expect(shell.getAttribute("data-density")).toBe("comfy");
  });

  it("defaults to 'comfy' when localStorage contains an invalid value", async () => {
    localStorageMock.getItem.mockReturnValue("ultra-wide"); // not valid

    renderScanShell();
    await act(async () => {});

    const shell = screen.getByTestId("scan-shell");
    expect(shell.getAttribute("data-density")).toBe("comfy");
  });
});

// ─── C: localStorage hydration ────────────────────────────────────────────────

describe("ScanShell — C: localStorage hydration", () => {
  it("reads 'compact' from localStorage and sets data-density='compact'", async () => {
    localStorageMock.getItem.mockImplementation(((key: string) => {
      if (key === SCAN_DENSITY_STORAGE_KEY) return "compact";
      return null;
    }) as never);

    renderScanShell();
    await act(async () => {});

    const shell = screen.getByTestId("scan-shell");
    expect(shell.getAttribute("data-density")).toBe("compact");
  });

  it("reads 'comfy' from localStorage and sets data-density='comfy'", async () => {
    localStorageMock.getItem.mockImplementation(((key: string) => {
      if (key === SCAN_DENSITY_STORAGE_KEY) return "comfy";
      return null;
    }) as never);

    renderScanShell();
    await act(async () => {});

    const shell = screen.getByTestId("scan-shell");
    expect(shell.getAttribute("data-density")).toBe("comfy");
  });

  it("uses the SCAN_DENSITY_STORAGE_KEY='scan_density' key", async () => {
    // Verify the key constant is correct
    expect(SCAN_DENSITY_STORAGE_KEY).toBe("scan_density");

    renderScanShell();
    await act(async () => {});

    // getItem should have been called with the SCAN-specific key
    expect(localStorageMock.getItem).toHaveBeenCalledWith(SCAN_DENSITY_STORAGE_KEY);
  });

  it("does NOT read from 'inv_density' (INVENTORY key is separate)", async () => {
    // Pre-seed the INVENTORY key — should NOT affect SCAN
    _mockStore["inv_density"] = "compact";

    renderScanShell();
    await act(async () => {});

    // scan_density is absent → SCAN should still default to comfy
    const shell = screen.getByTestId("scan-shell");
    expect(shell.getAttribute("data-density")).toBe("comfy");
  });
});

// ─── D: Setter updates the data-density attribute ─────────────────────────────

describe("ScanShell — D: Setter updates data-density", () => {
  it("updates data-density to 'compact' when setDensity('compact') is called", async () => {
    render(
      <ScanShell>
        <DensityConsumer />
      </ScanShell>
    );
    await act(async () => {});

    // Initial: comfy
    expect(screen.getByTestId("scan-shell").getAttribute("data-density")).toBe("comfy");

    // Switch to compact via context setter
    fireEvent.click(screen.getByTestId("set-compact"));

    expect(screen.getByTestId("scan-shell").getAttribute("data-density")).toBe("compact");
  });

  it("updates data-density back to 'comfy' from 'compact'", async () => {
    render(
      <ScanShell>
        <DensityConsumer />
      </ScanShell>
    );
    await act(async () => {});

    // Set to compact first
    fireEvent.click(screen.getByTestId("set-compact"));
    expect(screen.getByTestId("scan-shell").getAttribute("data-density")).toBe("compact");

    // Restore to comfy
    fireEvent.click(screen.getByTestId("set-comfy"));
    expect(screen.getByTestId("scan-shell").getAttribute("data-density")).toBe("comfy");
  });
});

// ─── E: React context propagation ────────────────────────────────────────────

describe("ScanShell — E: React context propagation", () => {
  it("provides density='comfy' via context to child components by default", async () => {
    render(
      <ScanShell>
        <DensityConsumer />
      </ScanShell>
    );
    await act(async () => {});

    expect(screen.getByTestId("context-density").textContent).toBe("comfy");
  });

  it("provides density='compact' via context after localStorage hydrates", async () => {
    localStorageMock.getItem.mockImplementation(((key: string) => {
      if (key === SCAN_DENSITY_STORAGE_KEY) return "compact";
      return null;
    }) as never);

    render(
      <ScanShell>
        <DensityConsumer />
      </ScanShell>
    );
    await act(async () => {});

    expect(screen.getByTestId("context-density").textContent).toBe("compact");
  });

  it("updates context density when setDensity is called", async () => {
    render(
      <ScanShell>
        <DensityConsumer />
      </ScanShell>
    );
    await act(async () => {});

    // Initially comfy
    expect(screen.getByTestId("context-density").textContent).toBe("comfy");

    // Switch to compact via context
    fireEvent.click(screen.getByTestId("set-compact"));

    expect(screen.getByTestId("context-density").textContent).toBe("compact");
  });

  it("context and data-density attribute stay in sync", async () => {
    render(
      <ScanShell>
        <DensityConsumer />
      </ScanShell>
    );
    await act(async () => {});

    // Both should show comfy
    expect(screen.getByTestId("context-density").textContent).toBe("comfy");
    expect(screen.getByTestId("scan-shell").getAttribute("data-density")).toBe("comfy");

    // Switch to compact
    fireEvent.click(screen.getByTestId("set-compact"));

    // Both should show compact
    expect(screen.getByTestId("context-density").textContent).toBe("compact");
    expect(screen.getByTestId("scan-shell").getAttribute("data-density")).toBe("compact");

    // Switch back to comfy
    fireEvent.click(screen.getByTestId("set-comfy"));

    // Both should show comfy again
    expect(screen.getByTestId("context-density").textContent).toBe("comfy");
    expect(screen.getByTestId("scan-shell").getAttribute("data-density")).toBe("comfy");
  });

  it("deeply nested child components receive density via context", async () => {
    /**
     * Verifies that the React context propagates through an arbitrary
     * component tree depth (not just direct children).
     */
    function DeepChild() {
      const { density } = useContext(ScanDensityContext);
      return <span data-testid="deep-density">{density}</span>;
    }

    function MiddleLayer({ children }: { children: React.ReactNode }) {
      return <div className="middle">{children}</div>;
    }

    render(
      <ScanShell>
        <MiddleLayer>
          <MiddleLayer>
            <DeepChild />
          </MiddleLayer>
        </MiddleLayer>
      </ScanShell>
    );
    await act(async () => {});

    expect(screen.getByTestId("deep-density").textContent).toBe("comfy");
  });
});

// ─── F: CSS attribute selector cascade ────────────────────────────────────────

describe("ScanShell — F: CSS attribute selector cascade", () => {
  /**
   * These tests verify that a child element *inside* the ScanShell root div
   * (which has data-density="comfy"|"compact") is findable via ancestor
   * attribute selectors, confirming the CSS cascade mechanism works.
   *
   * Note: jsdom does not execute CSS — we cannot test getComputedStyle() for
   * custom property resolution here.  Instead we verify that:
   *   a) The data-density attribute is present on an ancestor of child content.
   *   b) querySelector("[data-density='compact'] .child") finds the child
   *      when the attribute is set — confirming the DOM structure supports
   *      the CSS selector pattern.
   */

  it("child element is inside an ancestor with data-density attribute", async () => {
    render(
      <ScanShell>
        <div className="scan-item" data-testid="scan-item">Item</div>
      </ScanShell>
    );
    await act(async () => {});

    const child = screen.getByTestId("scan-item");
    const shellAncestor = child.closest("[data-density]");
    expect(shellAncestor).toBeTruthy();
    expect(shellAncestor?.getAttribute("data-density")).toBe("comfy");
  });

  it("[data-density='comfy'] selector matches an ancestor of child content by default", async () => {
    const { container } = render(
      <ScanShell>
        <div className="scan-item" data-testid="scan-item">Item</div>
      </ScanShell>
    );
    await act(async () => {});

    // This is the selector pattern used in component CSS modules:
    // [data-density="comfy"] .scan-item { ... }
    const matchedChild = container.querySelector(
      "[data-density='comfy'] [data-testid='scan-item']"
    );
    expect(matchedChild).toBeTruthy();
  });

  it("[data-density='compact'] selector matches after setDensity('compact')", async () => {
    const { container } = render(
      <ScanShell>
        <DensityConsumer />
        <div className="scan-item" data-testid="scan-item">Item</div>
      </ScanShell>
    );
    await act(async () => {});

    // Switch to compact
    fireEvent.click(screen.getByTestId("set-compact"));

    // CSS selector [data-density="compact"] .scan-item should now match
    const matchedChild = container.querySelector(
      "[data-density='compact'] [data-testid='scan-item']"
    );
    expect(matchedChild).toBeTruthy();
  });

  it("[data-density='comfy'] selector does NOT match when density is 'compact'", async () => {
    const { container } = render(
      <ScanShell>
        <DensityConsumer />
        <div data-testid="scan-item">Item</div>
      </ScanShell>
    );
    await act(async () => {});

    // Switch to compact
    fireEvent.click(screen.getByTestId("set-compact"));

    // [data-density='comfy'] should NOT match now
    const matchedChild = container.querySelector(
      "[data-density='comfy'] [data-testid='scan-item']"
    );
    expect(matchedChild).toBeNull();
  });

  it("[data-density='compact'] selector does NOT match when density is 'comfy'", async () => {
    const { container } = render(
      <ScanShell>
        <div data-testid="scan-item">Item</div>
      </ScanShell>
    );
    await act(async () => {});

    // Default is comfy — compact selector should not match
    const matchedChild = container.querySelector(
      "[data-density='compact'] [data-testid='scan-item']"
    );
    expect(matchedChild).toBeNull();
  });
});

// ─── G: Persistence ───────────────────────────────────────────────────────────

describe("ScanShell — G: localStorage persistence", () => {
  it("writes to localStorage['scan_density'] when setDensity is called", async () => {
    render(
      <ScanShell>
        <DensityConsumer />
      </ScanShell>
    );
    await act(async () => {});

    fireEvent.click(screen.getByTestId("set-compact"));

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      SCAN_DENSITY_STORAGE_KEY,
      "compact"
    );
  });

  it("writes 'comfy' to localStorage when switching back from compact", async () => {
    render(
      <ScanShell>
        <DensityConsumer />
      </ScanShell>
    );
    await act(async () => {});

    fireEvent.click(screen.getByTestId("set-compact"));
    fireEvent.click(screen.getByTestId("set-comfy"));

    const calls = localStorageMock.setItem.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall).toEqual([SCAN_DENSITY_STORAGE_KEY, "comfy"]);
  });

  it("does NOT write to 'inv_density' (INVENTORY key is separate)", async () => {
    render(
      <ScanShell>
        <DensityConsumer />
      </ScanShell>
    );
    await act(async () => {});

    fireEvent.click(screen.getByTestId("set-compact"));

    // setItem should only have been called with scan_density, never inv_density
    const allSetItemCalls = localStorageMock.setItem.mock.calls;
    const invDensityCalls = allSetItemCalls.filter(
      ([key]) => key === "inv_density"
    );
    expect(invDensityCalls).toHaveLength(0);
  });
});

// ─── H: Guard against invalid density values ─────────────────────────────────

describe("ScanShell — H: Guard against invalid density values", () => {
  it("setDensity with invalid value does not change data-density", async () => {
    render(
      <ScanShell>
        <DensityConsumer />
        <InvalidDensityInvoker />
      </ScanShell>
    );
    await act(async () => {});

    const shell = screen.getByTestId("scan-shell");
    expect(shell.getAttribute("data-density")).toBe("comfy");

    fireEvent.click(screen.getByTestId("set-invalid-density"));

    const currentDensity = shell.getAttribute("data-density");
    expect(["comfy", "compact"]).toContain(currentDensity);
  });
});
