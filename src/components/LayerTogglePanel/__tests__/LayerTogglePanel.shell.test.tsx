/**
 * LayerTogglePanel shell tests — Sub-AC 1.
 *
 * Verifies the layout structure and 7 placeholder toggle slots
 * without any state wiring.
 *
 * Checks:
 *   - Panel renders when `open` is true (default)
 *   - Panel does NOT render when `open` is false
 *   - Header is present with correct accessible label
 *   - Close button is present and accessible
 *   - Exactly 7 toggle rows are rendered
 *   - All 7 layer slot IDs are represented
 *   - Each row has a swatch with the correct data-layer attribute
 *   - Each row has a labeled checkbox input
 *   - Footer renders the active count hint
 *   - Correct position data attribute applied
 *   - `activeLayers` prop drives initial checked states
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LayerTogglePanel,
  LAYER_SLOT_IDS,
  type LayerSlotId,
} from "../LayerTogglePanel";

afterEach(() => cleanup());

// ─── Panel visibility ─────────────────────────────────────────────────────────

describe("LayerTogglePanel — visibility", () => {
  it("renders the panel when open is true (default)", () => {
    render(<LayerTogglePanel />);
    expect(screen.getByTestId("layer-toggle-panel")).toBeTruthy();
  });

  it("does not render when open is false", () => {
    render(<LayerTogglePanel open={false} />);
    expect(screen.queryByTestId("layer-toggle-panel")).toBeNull();
  });
});

// ─── Layout structure ─────────────────────────────────────────────────────────

describe("LayerTogglePanel — layout structure", () => {
  it("renders a header", () => {
    render(<LayerTogglePanel />);
    expect(screen.getByTestId("layer-toggle-panel-header")).toBeTruthy();
  });

  it("renders the panel body", () => {
    render(<LayerTogglePanel />);
    expect(screen.getByTestId("layer-toggle-panel-body")).toBeTruthy();
  });

  it("renders the footer", () => {
    render(<LayerTogglePanel />);
    expect(screen.getByTestId("layer-toggle-panel-footer")).toBeTruthy();
  });

  it("applies the aria-label to the root aside element", () => {
    render(<LayerTogglePanel aria-label="Custom label" />);
    const panel = screen.getByTestId("layer-toggle-panel");
    expect(panel.getAttribute("aria-label")).toBe("Custom label");
  });

  it("uses the default aria-label when none provided", () => {
    render(<LayerTogglePanel />);
    const panel = screen.getByTestId("layer-toggle-panel");
    expect(panel.getAttribute("aria-label")).toBe("Map layer controls");
  });
});

// ─── Position variants ────────────────────────────────────────────────────────

describe("LayerTogglePanel — position variants", () => {
  it("defaults to top-right position", () => {
    render(<LayerTogglePanel />);
    const panel = screen.getByTestId("layer-toggle-panel");
    expect(panel.getAttribute("data-position")).toBe("top-right");
  });

  it("applies top-left position", () => {
    render(<LayerTogglePanel position="top-left" />);
    const panel = screen.getByTestId("layer-toggle-panel");
    expect(panel.getAttribute("data-position")).toBe("top-left");
  });

  it("applies bottom-right position", () => {
    render(<LayerTogglePanel position="bottom-right" />);
    const panel = screen.getByTestId("layer-toggle-panel");
    expect(panel.getAttribute("data-position")).toBe("bottom-right");
  });
});

// ─── 7 toggle slots ───────────────────────────────────────────────────────────

describe("LayerTogglePanel — 7 toggle slots", () => {
  it("renders exactly 7 toggle rows", () => {
    render(<LayerTogglePanel />);
    // Each toggle row has a data-testid of "layer-toggle-row-{id}"
    const rows = LAYER_SLOT_IDS.map((id) =>
      screen.queryByTestId(`layer-toggle-row-${id}`)
    );
    expect(rows.every(Boolean)).toBe(true);
    expect(rows.length).toBe(7);
  });

  it("renders all 7 layer IDs as toggle rows", () => {
    render(<LayerTogglePanel />);
    for (const id of LAYER_SLOT_IDS) {
      expect(screen.getByTestId(`layer-toggle-row-${id}`)).toBeTruthy();
    }
  });

  it("each row has a data-layer attribute matching its ID", () => {
    render(<LayerTogglePanel />);
    for (const id of LAYER_SLOT_IDS) {
      const row = screen.getByTestId(`layer-toggle-row-${id}`);
      expect(row.getAttribute("data-layer")).toBe(id);
    }
  });

  it("LAYER_SLOT_IDS array has exactly 7 entries", () => {
    expect(LAYER_SLOT_IDS).toHaveLength(7);
  });

  it("LAYER_SLOT_IDS contains the expected layer identifiers", () => {
    const expected: LayerSlotId[] = [
      "deployed",
      "transit",
      "flagged",
      "hangar",
      "heat",
      "history",
      "turbines",
    ];
    expect(LAYER_SLOT_IDS).toEqual(expected);
  });
});

// ─── Toggle inputs ────────────────────────────────────────────────────────────

describe("LayerTogglePanel — toggle inputs (placeholder)", () => {
  it("each row has a labeled checkbox input", () => {
    render(<LayerTogglePanel />);
    for (const id of LAYER_SLOT_IDS) {
      const input = screen.getByTestId(`layer-toggle-input-${id}`);
      expect(input).toBeTruthy();
      expect((input as HTMLInputElement).type).toBe("checkbox");
    }
  });

  it("all toggles are checked by default (all layers active)", () => {
    render(<LayerTogglePanel />);
    for (const id of LAYER_SLOT_IDS) {
      const input = screen.getByTestId(
        `layer-toggle-input-${id}`
      ) as HTMLInputElement;
      expect(input.checked).toBe(true);
    }
  });

  it("toggles are unchecked when layer is not in activeLayers", () => {
    render(<LayerTogglePanel activeLayers={["deployed", "transit"]} />);

    // Only deployed and transit should be checked
    for (const id of LAYER_SLOT_IDS) {
      const input = screen.getByTestId(
        `layer-toggle-input-${id}`
      ) as HTMLInputElement;
      if (id === "deployed" || id === "transit") {
        expect(input.checked).toBe(true);
      } else {
        expect(input.checked).toBe(false);
      }
    }
  });

  it("renders all toggles unchecked when activeLayers is empty", () => {
    render(<LayerTogglePanel activeLayers={[]} />);
    for (const id of LAYER_SLOT_IDS) {
      const input = screen.getByTestId(
        `layer-toggle-input-${id}`
      ) as HTMLInputElement;
      expect(input.checked).toBe(false);
    }
  });
});

// ─── data-active attributes on rows ──────────────────────────────────────────

describe("LayerTogglePanel — data-active on rows", () => {
  it('sets data-active="true" on active layer rows', () => {
    render(<LayerTogglePanel activeLayers={["deployed", "heat"]} />);
    expect(
      screen.getByTestId("layer-toggle-row-deployed").getAttribute("data-active")
    ).toBe("true");
    expect(
      screen.getByTestId("layer-toggle-row-heat").getAttribute("data-active")
    ).toBe("true");
  });

  it('sets data-active="false" on inactive layer rows', () => {
    render(<LayerTogglePanel activeLayers={["deployed"]} />);
    expect(
      screen.getByTestId("layer-toggle-row-transit").getAttribute("data-active")
    ).toBe("false");
    expect(
      screen.getByTestId("layer-toggle-row-turbines").getAttribute("data-active")
    ).toBe("false");
  });
});

// ─── Color swatches ───────────────────────────────────────────────────────────

describe("LayerTogglePanel — color swatches", () => {
  it("each row contains a swatch with matching data-layer", () => {
    render(<LayerTogglePanel />);
    for (const id of LAYER_SLOT_IDS) {
      const row = screen.getByTestId(`layer-toggle-row-${id}`);
      // The swatch is a span with data-layer inside the row
      const swatch = row.querySelector("[data-layer]");
      expect(swatch).toBeTruthy();
      expect(swatch?.getAttribute("data-layer")).toBe(id);
    }
  });
});

// ─── Close button ─────────────────────────────────────────────────────────────

describe("LayerTogglePanel — close button", () => {
  it("renders the close button", () => {
    render(<LayerTogglePanel />);
    expect(screen.getByTestId("layer-toggle-panel-close")).toBeTruthy();
  });

  it("close button has accessible aria-label", () => {
    render(<LayerTogglePanel />);
    const btn = screen.getByTestId("layer-toggle-panel-close");
    expect(btn.getAttribute("aria-label")).toBe(
      "Close layer controls panel"
    );
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(<LayerTogglePanel onClose={onClose} />);
    const btn = screen.getByTestId("layer-toggle-panel-close");
    await userEvent.click(btn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ─── onToggleLayer callback ───────────────────────────────────────────────────

describe("LayerTogglePanel — onToggleLayer callback (placeholder)", () => {
  it("calls onToggleLayer with the correct layerId when a toggle is clicked", async () => {
    const onToggleLayer = vi.fn();
    render(
      <LayerTogglePanel
        activeLayers={[...LAYER_SLOT_IDS]}
        onToggleLayer={onToggleLayer}
      />
    );

    // Click the "deployed" toggle input
    const input = screen.getByTestId("layer-toggle-input-deployed");
    await userEvent.click(input);
    expect(onToggleLayer).toHaveBeenCalledWith("deployed");
  });

  it("calls onToggleLayer with heat when heat toggle is clicked", async () => {
    const onToggleLayer = vi.fn();
    render(
      <LayerTogglePanel
        activeLayers={["deployed"]}
        onToggleLayer={onToggleLayer}
      />
    );
    const input = screen.getByTestId("layer-toggle-input-heat");
    await userEvent.click(input);
    expect(onToggleLayer).toHaveBeenCalledWith("heat");
  });

  it("does not throw when onToggleLayer is not provided", async () => {
    render(<LayerTogglePanel />);
    const input = screen.getByTestId("layer-toggle-input-transit");
    // Should not throw
    await userEvent.click(input);
  });
});

// ─── Footer hint ──────────────────────────────────────────────────────────────

describe("LayerTogglePanel — footer hint", () => {
  it("shows '7 of 7 layers visible' when all layers are active", () => {
    render(<LayerTogglePanel />);
    expect(screen.getByText("7 of 7 layers visible")).toBeTruthy();
  });

  it("shows '2 of 7 layers visible' when 2 layers are active", () => {
    render(<LayerTogglePanel activeLayers={["deployed", "heat"]} />);
    expect(screen.getByText("2 of 7 layers visible")).toBeTruthy();
  });

  it("shows '0 of 7 layers visible' when no layers are active", () => {
    render(<LayerTogglePanel activeLayers={[]} />);
    expect(screen.getByText("0 of 7 layers visible")).toBeTruthy();
  });
});
