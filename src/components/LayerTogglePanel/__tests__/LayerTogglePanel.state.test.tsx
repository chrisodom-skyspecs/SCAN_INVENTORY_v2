/**
 * LayerTogglePanel local-state tests — Sub-AC 2.
 *
 * Validates that individual toggle controls manage their own on/off state
 * via React.useState — no parent state management required.
 *
 * Key behaviors under test:
 *   - Toggling a layer flips its checked state without any prop update
 *   - Each of the 7 layers can be toggled independently
 *   - `onToggleLayer` callback fires with the correct layerId on each flip
 *   - Footer count reflects current local state
 *   - `aria-label` on each input updates dynamically ("Hide X" ↔ "Show X")
 *   - `data-active` on each row updates dynamically
 *   - `data-checked` on the pill track updates dynamically
 *   - Initialising with a partial `activeLayers` set works correctly
 *   - Toggling on → off → on round-trip returns to original state
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInput(layerId: LayerSlotId): HTMLInputElement {
  return screen.getByTestId(`layer-toggle-input-${layerId}`) as HTMLInputElement;
}

function getRow(layerId: LayerSlotId): HTMLElement {
  return screen.getByTestId(`layer-toggle-row-${layerId}`) as HTMLElement;
}

// ─── Local state: toggle flips without parent involvement ─────────────────────

describe("LayerTogglePanel — local state: toggle works without parent", () => {
  it("toggles deployed OFF when clicked (no onToggleLayer provided)", async () => {
    render(<LayerTogglePanel />);

    const input = getInput("deployed");
    expect(input.checked).toBe(true); // starts ON (all layers default active)

    await userEvent.click(input);

    expect(input.checked).toBe(false); // flipped to OFF via local state
  });

  it("toggles heat ON when clicked (starts OFF — defaultActive: false)", async () => {
    // heat and history are NOT in the default activeLayers (override to test OFF→ON)
    render(<LayerTogglePanel activeLayers={["deployed", "transit", "flagged", "hangar", "turbines"]} />);

    const input = getInput("heat");
    expect(input.checked).toBe(false); // starts OFF

    await userEvent.click(input);

    expect(input.checked).toBe(true); // flipped to ON
  });

  it("toggles back to ON after OFF (round-trip)", async () => {
    render(<LayerTogglePanel />);

    const input = getInput("transit");
    expect(input.checked).toBe(true);

    await userEvent.click(input); // OFF
    expect(input.checked).toBe(false);

    await userEvent.click(input); // ON again
    expect(input.checked).toBe(true);
  });

  it("does not affect other layers when one is toggled", async () => {
    render(<LayerTogglePanel />);

    // Toggle only "flagged" OFF
    await userEvent.click(getInput("flagged"));

    // All other layers should still be ON
    for (const id of LAYER_SLOT_IDS) {
      if (id !== "flagged") {
        expect(getInput(id).checked).toBe(true);
      }
    }
    expect(getInput("flagged").checked).toBe(false);
  });
});

// ─── Each of the 7 layers toggles independently ───────────────────────────────

describe("LayerTogglePanel — each layer toggles independently", () => {
  it.each(LAYER_SLOT_IDS)(
    "layer '%s' can be toggled OFF independently from all-active state",
    async (layerId) => {
      render(<LayerTogglePanel />); // all 7 active

      const input = getInput(layerId);
      expect(input.checked).toBe(true);

      await userEvent.click(input);

      expect(input.checked).toBe(false);

      // Verify the other 6 layers are still ON
      for (const otherId of LAYER_SLOT_IDS) {
        if (otherId !== layerId) {
          expect(getInput(otherId).checked).toBe(true);
        }
      }

      cleanup(); // reset DOM between parameterised runs
    }
  );

  it.each(LAYER_SLOT_IDS)(
    "layer '%s' can be toggled ON independently from all-off state",
    async (layerId) => {
      render(<LayerTogglePanel activeLayers={[]} />); // none active

      const input = getInput(layerId);
      expect(input.checked).toBe(false);

      await userEvent.click(input);

      expect(input.checked).toBe(true);

      // Verify the other 6 layers are still OFF
      for (const otherId of LAYER_SLOT_IDS) {
        if (otherId !== layerId) {
          expect(getInput(otherId).checked).toBe(false);
        }
      }

      cleanup();
    }
  );
});

// ─── onToggleLayer callback ────────────────────────────────────────────────────

describe("LayerTogglePanel — onToggleLayer fires with correct layerId", () => {
  it.each(LAYER_SLOT_IDS)(
    "fires onToggleLayer('%s') when that layer's toggle is clicked",
    async (layerId) => {
      const onToggleLayer = vi.fn();
      render(<LayerTogglePanel onToggleLayer={onToggleLayer} />);

      await userEvent.click(getInput(layerId));

      expect(onToggleLayer).toHaveBeenCalledTimes(1);
      expect(onToggleLayer).toHaveBeenCalledWith(layerId);

      cleanup();
    }
  );

  it("fires onToggleLayer each time the same layer is toggled", async () => {
    const onToggleLayer = vi.fn();
    render(<LayerTogglePanel onToggleLayer={onToggleLayer} />);

    const input = getInput("hangar");
    await userEvent.click(input); // OFF
    await userEvent.click(input); // ON
    await userEvent.click(input); // OFF

    expect(onToggleLayer).toHaveBeenCalledTimes(3);
    expect(onToggleLayer).toHaveBeenNthCalledWith(1, "hangar");
    expect(onToggleLayer).toHaveBeenNthCalledWith(2, "hangar");
    expect(onToggleLayer).toHaveBeenNthCalledWith(3, "hangar");
  });

  it("fires separate callbacks for separate layers toggled in sequence", async () => {
    const onToggleLayer = vi.fn();
    render(<LayerTogglePanel onToggleLayer={onToggleLayer} />);

    await userEvent.click(getInput("deployed"));
    await userEvent.click(getInput("heat"));
    await userEvent.click(getInput("turbines"));

    expect(onToggleLayer).toHaveBeenCalledTimes(3);
    expect(onToggleLayer).toHaveBeenNthCalledWith(1, "deployed");
    expect(onToggleLayer).toHaveBeenNthCalledWith(2, "heat");
    expect(onToggleLayer).toHaveBeenNthCalledWith(3, "turbines");
  });
});

// ─── data-active attribute updates ────────────────────────────────────────────

describe("LayerTogglePanel — data-active attribute updates with local state", () => {
  it('sets data-active="false" on row after toggling layer OFF', async () => {
    render(<LayerTogglePanel />);

    const row = getRow("transit");
    expect(row.getAttribute("data-active")).toBe("true");

    await userEvent.click(getInput("transit"));

    expect(row.getAttribute("data-active")).toBe("false");
  });

  it('sets data-active="true" on row after toggling layer ON', async () => {
    render(<LayerTogglePanel activeLayers={[]} />);

    const row = getRow("flagged");
    expect(row.getAttribute("data-active")).toBe("false");

    await userEvent.click(getInput("flagged"));

    expect(row.getAttribute("data-active")).toBe("true");
  });
});

// ─── Toggle pill track data-checked updates ────────────────────────────────────

describe("LayerTogglePanel — toggle pill track data-checked updates with local state", () => {
  it('toggleTrack data-checked flips to "false" after toggling layer OFF', async () => {
    render(<LayerTogglePanel />);

    const row = getRow("history");
    // Toggle row must start active in the default state
    // (history is in LAYER_SLOT_IDS default)
    const track = row.querySelector("[data-checked]");
    expect(track?.getAttribute("data-checked")).toBe("true");

    await userEvent.click(getInput("history"));

    expect(track?.getAttribute("data-checked")).toBe("false");
  });

  it('toggleTrack data-checked flips to "true" after toggling layer ON', async () => {
    render(<LayerTogglePanel activeLayers={[]} />);

    const row = getRow("turbines");
    const track = row.querySelector("[data-checked]");
    expect(track?.getAttribute("data-checked")).toBe("false");

    await userEvent.click(getInput("turbines"));

    expect(track?.getAttribute("data-checked")).toBe("true");
  });
});

// ─── aria-label updates ────────────────────────────────────────────────────────

describe("LayerTogglePanel — aria-label on input updates with local state", () => {
  it('changes aria-label from "Hide X layer" to "Show X layer" when toggled OFF', async () => {
    render(<LayerTogglePanel />);

    const input = getInput("deployed");
    expect(input.getAttribute("aria-label")).toBe("Hide Deployed Cases layer");

    await userEvent.click(input);

    expect(input.getAttribute("aria-label")).toBe("Show Deployed Cases layer");
  });

  it('changes aria-label from "Show X layer" to "Hide X layer" when toggled ON', async () => {
    render(<LayerTogglePanel activeLayers={[]} />);

    const input = getInput("heat");
    expect(input.getAttribute("aria-label")).toBe("Show Activity Heat layer");

    await userEvent.click(input);

    expect(input.getAttribute("aria-label")).toBe("Hide Activity Heat layer");
  });
});

// ─── Footer count updates ──────────────────────────────────────────────────────

describe("LayerTogglePanel — footer count updates with local state", () => {
  it("decrements footer count when a layer is toggled OFF", async () => {
    render(<LayerTogglePanel />);
    // All 7 active
    expect(screen.getByText("7 of 7 layers visible")).toBeTruthy();

    await userEvent.click(getInput("heat"));
    expect(screen.getByText("6 of 7 layers visible")).toBeTruthy();

    await userEvent.click(getInput("history"));
    expect(screen.getByText("5 of 7 layers visible")).toBeTruthy();
  });

  it("increments footer count when a layer is toggled ON", async () => {
    render(<LayerTogglePanel activeLayers={[]} />);
    expect(screen.getByText("0 of 7 layers visible")).toBeTruthy();

    await userEvent.click(getInput("deployed"));
    expect(screen.getByText("1 of 7 layers visible")).toBeTruthy();

    await userEvent.click(getInput("transit"));
    expect(screen.getByText("2 of 7 layers visible")).toBeTruthy();
  });

  it("returns to 7 after toggling all OFF then all ON", async () => {
    render(<LayerTogglePanel />);

    // Toggle all OFF
    for (const id of LAYER_SLOT_IDS) {
      await userEvent.click(getInput(id));
    }
    expect(screen.getByText("0 of 7 layers visible")).toBeTruthy();

    // Toggle all ON
    for (const id of LAYER_SLOT_IDS) {
      await userEvent.click(getInput(id));
    }
    expect(screen.getByText("7 of 7 layers visible")).toBeTruthy();
  });
});

// ─── Initial state from activeLayers prop ─────────────────────────────────────

describe("LayerTogglePanel — initial state from activeLayers prop", () => {
  it("honours activeLayers=[deployed, transit] as initial state", () => {
    render(<LayerTogglePanel activeLayers={["deployed", "transit"]} />);

    expect(getInput("deployed").checked).toBe(true);
    expect(getInput("transit").checked).toBe(true);
    // All others should start OFF
    for (const id of ["flagged", "hangar", "heat", "history", "turbines"] as LayerSlotId[]) {
      expect(getInput(id).checked).toBe(false);
    }
  });

  it("works correctly when activeLayers is empty (all OFF initially)", () => {
    render(<LayerTogglePanel activeLayers={[]} />);
    for (const id of LAYER_SLOT_IDS) {
      expect(getInput(id).checked).toBe(false);
    }
  });

  it("works correctly when all layers are in activeLayers (all ON initially)", () => {
    render(<LayerTogglePanel activeLayers={[...LAYER_SLOT_IDS]} />);
    for (const id of LAYER_SLOT_IDS) {
      expect(getInput(id).checked).toBe(true);
    }
  });

  it("subsequent prop changes do NOT re-sync local state (local state is authoritative after mount)", async () => {
    // This test verifies the component is semi-uncontrolled: the prop is only
    // used for initialization, not for ongoing synchronization.
    const { rerender } = render(<LayerTogglePanel activeLayers={[...LAYER_SLOT_IDS]} />);

    // Toggle "deployed" OFF via user interaction
    await userEvent.click(getInput("deployed"));
    expect(getInput("deployed").checked).toBe(false);

    // Parent re-renders with the same activeLayers (all ON)
    // Local state should NOT revert to the prop value
    rerender(<LayerTogglePanel activeLayers={[...LAYER_SLOT_IDS]} />);

    // "deployed" should still be OFF (local state persists)
    expect(getInput("deployed").checked).toBe(false);
  });
});

// ─── Accessibility — keyboard navigation ──────────────────────────────────────

describe("LayerTogglePanel — keyboard accessibility", () => {
  it("each toggle input is keyboard-accessible (responds to Space key)", async () => {
    render(<LayerTogglePanel />);

    const input = getInput("hangar");
    input.focus();
    expect(input.checked).toBe(true);

    // Space key toggles a checkbox
    await userEvent.keyboard(" ");

    expect(input.checked).toBe(false);
  });

  it("each input has an associated label via htmlFor", () => {
    render(<LayerTogglePanel />);
    for (const id of LAYER_SLOT_IDS) {
      const input = getInput(id);
      const labelEl = document.querySelector(`label[for="${input.id}"]`);
      expect(labelEl).toBeTruthy();
    }
  });

  it("all inputs have an aria-label", () => {
    render(<LayerTogglePanel />);
    for (const id of LAYER_SLOT_IDS) {
      const input = getInput(id);
      expect(input.getAttribute("aria-label")).toBeTruthy();
    }
  });
});

// ─── Multiple layers toggled simultaneously ───────────────────────────────────

describe("LayerTogglePanel — multiple independent toggles", () => {
  it("can have some layers ON and some OFF independently", async () => {
    render(<LayerTogglePanel activeLayers={["deployed", "transit", "flagged"]} />);

    // Toggle "deployed" OFF
    await userEvent.click(getInput("deployed"));
    // Toggle "heat" ON (was OFF)
    await userEvent.click(getInput("heat"));

    expect(getInput("deployed").checked).toBe(false);
    expect(getInput("transit").checked).toBe(true);   // unchanged
    expect(getInput("flagged").checked).toBe(true);   // unchanged
    expect(getInput("heat").checked).toBe(true);      // turned ON
    expect(getInput("hangar").checked).toBe(false);   // unchanged
    expect(getInput("history").checked).toBe(false);  // unchanged
    expect(getInput("turbines").checked).toBe(false); // unchanged
  });
});
