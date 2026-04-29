/**
 * LayerTogglePanel styling tests — Sub-AC 4.
 *
 * Verifies the CSS styling hooks (data attributes, class application,
 * and structure) that the INVENTORY dashboard visual styling relies on.
 *
 * These tests verify that:
 *   1. The panel root applies position-variant CSS classes correctly
 *   2. Each toggle row has a `data-layer` attribute matching the layer ID
 *      (enables per-layer active toggle track color CSS selectors)
 *   3. The `.toggleTrack` element has `data-checked` reflecting active state
 *      (used for per-layer background-color in active state)
 *   4. The `.swatch` element has `data-layer` for per-layer swatch color
 *   5. Inactive rows have `data-active="false"` for CSS opacity dimming
 *   6. Active rows have `data-active="true"` for CSS contrast restoration
 *   7. The panel renders at the correct responsive breakpoint breakpoints
 *      (structure is correct; CSS-computed styles are not testable in JSDOM)
 *
 * Note: CSS computed property values (colors, sizes, box-shadows) are not
 * verifiable in JSDOM since it doesn't implement CSS cascading. Visual
 * regression testing for those properties belongs in Playwright/Storybook.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LayerTogglePanel,
  LAYER_SLOT_IDS,
  type LayerSlotId,
} from "../LayerTogglePanel";

afterEach(() => cleanup());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRow(layerId: LayerSlotId): HTMLElement {
  return screen.getByTestId(`layer-toggle-row-${layerId}`) as HTMLElement;
}

function getInput(layerId: LayerSlotId): HTMLInputElement {
  return screen.getByTestId(`layer-toggle-input-${layerId}`) as HTMLInputElement;
}

function getTrack(layerId: LayerSlotId): Element {
  const row = getRow(layerId);
  const track = row.querySelector("[data-checked]");
  if (!track) throw new Error(`No track found for layer ${layerId}`);
  return track;
}

// ─── Per-layer data-layer on toggle rows ──────────────────────────────────────
// Sub-AC 4: enables .toggleRow[data-layer="X"] .toggleTrack CSS selectors

describe("LayerTogglePanel — Sub-AC 4: data-layer on toggle rows", () => {
  it("each toggle row has data-layer matching its layer ID", () => {
    render(<LayerTogglePanel />);
    for (const layerId of LAYER_SLOT_IDS) {
      const row = getRow(layerId);
      expect(row.getAttribute("data-layer")).toBe(layerId);
    }
  });

  it("data-layer is present on all 7 toggle rows", () => {
    render(<LayerTogglePanel />);
    for (const layerId of LAYER_SLOT_IDS) {
      const row = screen.getByTestId(`layer-toggle-row-${layerId}`);
      expect(row.hasAttribute("data-layer")).toBe(true);
    }
  });

  it("data-layer on row matches the swatch data-layer in the same row", () => {
    render(<LayerTogglePanel />);
    for (const layerId of LAYER_SLOT_IDS) {
      const row = getRow(layerId);
      const swatch = row.querySelector("[data-layer]");
      expect(swatch?.getAttribute("data-layer")).toBe(
        row.getAttribute("data-layer")
      );
    }
  });
});

// ─── data-checked on toggle tracks ───────────────────────────────────────────
// Sub-AC 4: enables per-layer active background-color CSS rules

describe("LayerTogglePanel — Sub-AC 4: data-checked on toggle tracks", () => {
  it("all tracks have data-checked='true' when all layers active (default)", () => {
    render(<LayerTogglePanel />);
    for (const layerId of LAYER_SLOT_IDS) {
      const track = getTrack(layerId);
      expect(track.getAttribute("data-checked")).toBe("true");
    }
  });

  it("tracks have data-checked='false' when layer is inactive", () => {
    render(<LayerTogglePanel activeLayers={["deployed"]} />);
    for (const layerId of LAYER_SLOT_IDS) {
      const track = getTrack(layerId);
      if (layerId === "deployed") {
        expect(track.getAttribute("data-checked")).toBe("true");
      } else {
        expect(track.getAttribute("data-checked")).toBe("false");
      }
    }
  });

  it("data-checked on track updates when toggle is clicked", async () => {
    render(<LayerTogglePanel />);
    // All active by default
    expect(getTrack("transit").getAttribute("data-checked")).toBe("true");

    await userEvent.click(getInput("transit"));

    // Track should reflect the new OFF state
    expect(getTrack("transit").getAttribute("data-checked")).toBe("false");
  });

  it("data-checked on track flips to 'true' when toggled ON", async () => {
    render(<LayerTogglePanel activeLayers={[]} />);
    expect(getTrack("flagged").getAttribute("data-checked")).toBe("false");

    await userEvent.click(getInput("flagged"));

    expect(getTrack("flagged").getAttribute("data-checked")).toBe("true");
  });
});

// ─── data-active on toggle rows ───────────────────────────────────────────────
// Sub-AC 4: drives dimming CSS rules on inactive rows

describe("LayerTogglePanel — Sub-AC 4: data-active on toggle rows", () => {
  it("all rows have data-active='true' when all layers active", () => {
    render(<LayerTogglePanel />);
    for (const layerId of LAYER_SLOT_IDS) {
      const row = getRow(layerId);
      expect(row.getAttribute("data-active")).toBe("true");
    }
  });

  it("inactive rows have data-active='false'", () => {
    render(<LayerTogglePanel activeLayers={["deployed", "hangar"]} />);
    for (const layerId of LAYER_SLOT_IDS) {
      const row = getRow(layerId);
      const expectedActive =
        layerId === "deployed" || layerId === "hangar" ? "true" : "false";
      expect(row.getAttribute("data-active")).toBe(expectedActive);
    }
  });
});

// ─── Panel root CSS structure ─────────────────────────────────────────────────
// Sub-AC 4: panel position variants and accessibility structure

describe("LayerTogglePanel — Sub-AC 4: panel root structure", () => {
  it("renders as an <aside> element (map overlay landmark)", () => {
    render(<LayerTogglePanel />);
    const panel = screen.getByTestId("layer-toggle-panel");
    expect(panel.tagName.toLowerCase()).toBe("aside");
  });

  it("has data-position attribute matching the position prop", () => {
    const positions: Array<"top-right" | "top-left" | "bottom-right"> = [
      "top-right",
      "top-left",
      "bottom-right",
    ];
    for (const position of positions) {
      const { unmount } = render(<LayerTogglePanel position={position} />);
      const panel = screen.getByTestId("layer-toggle-panel");
      expect(panel.getAttribute("data-position")).toBe(position);
      unmount();
    }
  });

  it("header renders with correct test ID", () => {
    render(<LayerTogglePanel />);
    expect(screen.getByTestId("layer-toggle-panel-header")).toBeTruthy();
  });

  it("body renders with correct test ID", () => {
    render(<LayerTogglePanel />);
    expect(screen.getByTestId("layer-toggle-panel-body")).toBeTruthy();
  });

  it("footer renders with correct test ID", () => {
    render(<LayerTogglePanel />);
    expect(screen.getByTestId("layer-toggle-panel-footer")).toBeTruthy();
  });
});

// ─── Swatch data-layer for per-layer color CSS ────────────────────────────────
// Sub-AC 4: .swatch[data-layer="X"] rules resolve the correct layer token

describe("LayerTogglePanel — Sub-AC 4: swatch data-layer attributes", () => {
  it("each swatch has data-layer matching its parent row", () => {
    render(<LayerTogglePanel />);
    for (const layerId of LAYER_SLOT_IDS) {
      const row = getRow(layerId);
      // The swatch is the first element with data-layer inside the row
      // (the row itself also has data-layer, so query for a specific selector)
      const swatch = row.querySelector(`[data-layer="${layerId}"]`);
      expect(swatch).toBeTruthy();
    }
  });

  it("all 7 layer IDs have corresponding swatch elements", () => {
    render(<LayerTogglePanel />);
    const expectedLayers = [
      "deployed",
      "transit",
      "flagged",
      "hangar",
      "heat",
      "history",
      "turbines",
    ];
    for (const layerId of expectedLayers) {
      // Each layer should have at least one element with its data-layer value
      const elements = document.querySelectorAll(`[data-layer="${layerId}"]`);
      // Should have at least 2: the row div and the swatch span
      expect(elements.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ─── Controlled mode styling hooks ───────────────────────────────────────────
// Sub-AC 4: per-layer CSS in controlled mode (engine-wired)

describe("LayerTogglePanel — Sub-AC 4: controlled mode styling hooks", () => {
  it("data-checked reflects layerState in controlled mode", () => {
    const layerState: Record<LayerSlotId, boolean> = {
      deployed: true,
      transit: false,
      flagged: true,
      hangar: false,
      heat: true,
      history: false,
      turbines: true,
    };
    render(<LayerTogglePanel layerState={layerState} />);

    for (const layerId of LAYER_SLOT_IDS) {
      const expected = layerState[layerId] ? "true" : "false";
      expect(getTrack(layerId).getAttribute("data-checked")).toBe(expected);
    }
  });

  it("data-active reflects layerState in controlled mode", () => {
    const layerState: Record<LayerSlotId, boolean> = {
      deployed: true,
      transit: false,
      flagged: false,
      hangar: true,
      heat: false,
      history: false,
      turbines: true,
    };
    render(<LayerTogglePanel layerState={layerState} />);

    for (const layerId of LAYER_SLOT_IDS) {
      const expected = layerState[layerId] ? "true" : "false";
      expect(getRow(layerId).getAttribute("data-active")).toBe(expected);
    }
  });
});

// ─── WCAG accessibility hooks ─────────────────────────────────────────────────
// Sub-AC 4: accessibility structure required for WCAG AA compliance

describe("LayerTogglePanel — Sub-AC 4: WCAG AA accessibility structure", () => {
  it("panel root has role-appropriate element type (aside)", () => {
    render(<LayerTogglePanel />);
    const panel = screen.getByTestId("layer-toggle-panel");
    // <aside> element provides an implicit complementary landmark role
    expect(panel.tagName.toLowerCase()).toBe("aside");
  });

  it("toggle body has role='group' for grouped controls", () => {
    render(<LayerTogglePanel />);
    const body = screen.getByTestId("layer-toggle-panel-body");
    expect(body.getAttribute("role")).toBe("group");
  });

  it("footer hint has aria-live='polite' for dynamic count updates", () => {
    render(<LayerTogglePanel />);
    const footer = screen.getByTestId("layer-toggle-panel-footer");
    const hint = footer.querySelector("[aria-live]");
    expect(hint?.getAttribute("aria-live")).toBe("polite");
    expect(hint?.getAttribute("aria-atomic")).toBe("true");
  });

  it("close button has aria-label", () => {
    render(<LayerTogglePanel />);
    const btn = screen.getByTestId("layer-toggle-panel-close");
    expect(btn.getAttribute("aria-label")).toBeTruthy();
  });

  it("each toggle input has aria-label matching active state", () => {
    render(<LayerTogglePanel />);
    // All layers active by default — aria-label should start with "Hide"
    for (const layerId of LAYER_SLOT_IDS) {
      const input = getInput(layerId);
      const ariaLabel = input.getAttribute("aria-label") ?? "";
      expect(ariaLabel).toContain("Hide");
    }
  });

  it("aria-label on toggle input contains layer name", () => {
    render(<LayerTogglePanel />);
    const inputDeployed = getInput("deployed");
    expect(inputDeployed.getAttribute("aria-label")).toContain("Deployed Cases");
  });
});
