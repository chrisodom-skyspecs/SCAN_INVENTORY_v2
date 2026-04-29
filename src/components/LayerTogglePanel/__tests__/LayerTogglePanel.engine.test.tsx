/**
 * LayerTogglePanel engine-wiring tests — Sub-AC 3.
 *
 * Validates that the toggle panel controls are correctly wired to the
 * LayerEngine state:
 *
 *   Read path  — panel renders current engine state (initial + external changes)
 *   Write path — clicking a toggle dispatches engine.toggle(layerId)
 *
 * Covers both the base `LayerTogglePanel` in controlled mode (`layerState` prop)
 * and the higher-level `LayerTogglePanelConnected` that connects to the context.
 *
 * Test groups
 * ───────────
 *   1. LayerTogglePanel controlled mode — layerState prop drives rendering
 *   2. LayerTogglePanel controlled mode — clicking calls onToggleLayer (no local flip)
 *   3. LayerTogglePanelConnected — reads from engine context
 *   4. LayerTogglePanelConnected — dispatches to engine on click
 *   5. LayerTogglePanelConnected — reflects external engine state changes
 *   6. LayerTogglePanelConnected — activateAll / deactivateAll / reset propagate
 *   7. LayerTogglePanelConnected — footer count tracks engine state
 *   8. LayerTogglePanelConnected — requires LayerEngineProvider (error case)
 *
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  LayerTogglePanel,
  LAYER_SLOT_IDS,
  type LayerSlotId,
} from "../LayerTogglePanel";
import { LayerTogglePanelConnected } from "../LayerTogglePanelConnected";
import {
  LayerEngineProvider,
  useLayerEngineContext,
} from "@/providers/layer-engine-provider";
import { LayerEngine } from "@/lib/layer-engine";
import { DEFAULT_LAYER_ENGINE_STATE } from "@/types/layer-engine";
import type { LayerEngineState } from "@/types/layer-engine";

afterEach(() => cleanup());

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a fully-specified layerState from an array of active layer IDs. */
function makeLayerState(activeLayers: LayerSlotId[]): Record<LayerSlotId, boolean> {
  return Object.fromEntries(
    LAYER_SLOT_IDS.map((id) => [id, activeLayers.includes(id)])
  ) as Record<LayerSlotId, boolean>;
}

/** All 7 layers active. */
const ALL_ON = makeLayerState([...LAYER_SLOT_IDS]);

/** Only heat and history off (the defaults). */
const DEFAULT_STATE = makeLayerState(
  LAYER_SLOT_IDS.filter((id) => DEFAULT_LAYER_ENGINE_STATE[id as keyof LayerEngineState])
);

function getInput(layerId: LayerSlotId): HTMLInputElement {
  return screen.getByTestId(`layer-toggle-input-${layerId}`) as HTMLInputElement;
}

function getRow(layerId: LayerSlotId): HTMLElement {
  return screen.getByTestId(`layer-toggle-row-${layerId}`) as HTMLElement;
}

/**
 * Wrapper that provides a LayerEngineProvider with a custom engine instance.
 * Allows tests to call engine methods and assert panel updates.
 */
function withEngine(engine: LayerEngine) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <LayerEngineProvider initialState={engine.getState()}>
        {children}
      </LayerEngineProvider>
    );
  };
}

// ─── 1. Controlled mode: layerState prop drives rendering ─────────────────────

describe("LayerTogglePanel — controlled mode (layerState prop)", () => {
  it("renders toggles as ON for layers with layerState[id] = true", () => {
    const layerState = makeLayerState(["deployed", "transit"]);
    render(<LayerTogglePanel layerState={layerState} />);

    expect(getInput("deployed").checked).toBe(true);
    expect(getInput("transit").checked).toBe(true);
    expect(getInput("flagged").checked).toBe(false);
    expect(getInput("hangar").checked).toBe(false);
    expect(getInput("heat").checked).toBe(false);
    expect(getInput("history").checked).toBe(false);
    expect(getInput("turbines").checked).toBe(false);
  });

  it("renders all OFF when layerState has all false values", () => {
    const layerState = makeLayerState([]);
    render(<LayerTogglePanel layerState={layerState} />);
    for (const id of LAYER_SLOT_IDS) {
      expect(getInput(id).checked).toBe(false);
    }
  });

  it("renders all ON when layerState has all true values", () => {
    render(<LayerTogglePanel layerState={ALL_ON} />);
    for (const id of LAYER_SLOT_IDS) {
      expect(getInput(id).checked).toBe(true);
    }
  });

  it("reflects updated layerState when the prop changes (controlled re-render)", () => {
    const layerState1 = makeLayerState(["deployed"]);
    const { rerender } = render(<LayerTogglePanel layerState={layerState1} />);

    expect(getInput("deployed").checked).toBe(true);
    expect(getInput("transit").checked).toBe(false);

    // Simulate parent re-rendering with new engine state
    const layerState2 = makeLayerState(["transit", "heat"]);
    rerender(<LayerTogglePanel layerState={layerState2} />);

    expect(getInput("deployed").checked).toBe(false);  // turned OFF
    expect(getInput("transit").checked).toBe(true);    // turned ON
    expect(getInput("heat").checked).toBe(true);       // turned ON
  });

  it("sets data-active on rows based on layerState (not local state)", () => {
    const layerState = makeLayerState(["flagged", "turbines"]);
    render(<LayerTogglePanel layerState={layerState} />);

    expect(getRow("flagged").getAttribute("data-active")).toBe("true");
    expect(getRow("turbines").getAttribute("data-active")).toBe("true");
    expect(getRow("deployed").getAttribute("data-active")).toBe("false");
    expect(getRow("heat").getAttribute("data-active")).toBe("false");
  });

  it("sets data-checked on toggle track based on layerState", () => {
    const layerState = makeLayerState(["heat"]);
    render(<LayerTogglePanel layerState={layerState} />);

    const heatRow = getRow("heat");
    const heatTrack = heatRow.querySelector("[data-checked]");
    expect(heatTrack?.getAttribute("data-checked")).toBe("true");

    const deployedRow = getRow("deployed");
    const deployedTrack = deployedRow.querySelector("[data-checked]");
    expect(deployedTrack?.getAttribute("data-checked")).toBe("false");
  });

  it("aria-label on inputs reflects layerState", () => {
    const layerState = makeLayerState(["deployed"]);
    render(<LayerTogglePanel layerState={layerState} />);

    // deployed is ON → "Hide Deployed Cases layer"
    expect(getInput("deployed").getAttribute("aria-label")).toBe("Hide Deployed Cases layer");
    // transit is OFF → "Show Transit Routes layer"
    expect(getInput("transit").getAttribute("aria-label")).toBe("Show Transit Routes layer");
  });

  it("footer count reflects layerState (not local state)", () => {
    const layerState = makeLayerState(["deployed", "transit", "flagged"]);
    render(<LayerTogglePanel layerState={layerState} />);
    expect(screen.getByText("3 of 7 layers visible")).toBeTruthy();
  });

  it("footer count is 0 when all layers are off in layerState", () => {
    render(<LayerTogglePanel layerState={makeLayerState([])} />);
    expect(screen.getByText("0 of 7 layers visible")).toBeTruthy();
  });

  it("footer count is 7 when all layers are on in layerState", () => {
    render(<LayerTogglePanel layerState={ALL_ON} />);
    expect(screen.getByText("7 of 7 layers visible")).toBeTruthy();
  });
});

// ─── 2. Controlled mode: clicking calls onToggleLayer (no local flip) ─────────

describe("LayerTogglePanel — controlled mode: click calls onToggleLayer, no local state change", () => {
  it("calls onToggleLayer with the correct layerId when a toggle is clicked", async () => {
    const onToggleLayer = vi.fn();
    const layerState = makeLayerState([...LAYER_SLOT_IDS]);
    render(<LayerTogglePanel layerState={layerState} onToggleLayer={onToggleLayer} />);

    await userEvent.click(getInput("deployed"));

    expect(onToggleLayer).toHaveBeenCalledOnce();
    expect(onToggleLayer).toHaveBeenCalledWith("deployed");
  });

  it("does NOT flip the toggle UI without a layerState prop change", async () => {
    // In controlled mode, the UI is driven by layerState.
    // Clicking the toggle calls onToggleLayer but doesn't change the UI
    // unless the parent updates layerState.
    const onToggleLayer = vi.fn();
    const layerState = ALL_ON; // all on — doesn't change after click
    render(<LayerTogglePanel layerState={layerState} onToggleLayer={onToggleLayer} />);

    expect(getInput("deployed").checked).toBe(true);

    await userEvent.click(getInput("deployed"));

    // layerState prop was not changed → UI stays as-is
    expect(getInput("deployed").checked).toBe(true);
    // callback was invoked
    expect(onToggleLayer).toHaveBeenCalledWith("deployed");
  });

  it("fires onToggleLayer for each of the 7 layers", async () => {
    const onToggleLayer = vi.fn();
    const layerState = ALL_ON;
    render(<LayerTogglePanel layerState={layerState} onToggleLayer={onToggleLayer} />);

    for (const id of LAYER_SLOT_IDS) {
      await userEvent.click(getInput(id));
      cleanup(); // re-render in next iteration
      render(<LayerTogglePanel layerState={layerState} onToggleLayer={onToggleLayer} />);
    }

    expect(onToggleLayer).toHaveBeenCalledTimes(LAYER_SLOT_IDS.length);
  });

  it("UI updates when layerState prop is updated after callback", async () => {
    const onToggleLayer = vi.fn();
    let currentState = ALL_ON;

    const { rerender } = render(
      <LayerTogglePanel layerState={currentState} onToggleLayer={onToggleLayer} />
    );

    expect(getInput("deployed").checked).toBe(true);

    // Simulate: user clicks deployed, parent updates layerState (turns deployed off)
    await userEvent.click(getInput("deployed"));
    currentState = makeLayerState(LAYER_SLOT_IDS.filter((id) => id !== "deployed"));
    rerender(
      <LayerTogglePanel layerState={currentState} onToggleLayer={onToggleLayer} />
    );

    expect(getInput("deployed").checked).toBe(false);  // now reflects updated state
  });
});

// ─── 3. LayerTogglePanelConnected — reads from engine context ─────────────────

describe("LayerTogglePanelConnected — reads initial engine state", () => {
  it("renders toggles matching DEFAULT_LAYER_ENGINE_STATE on first render", () => {
    render(
      <LayerEngineProvider>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // Default state: deployed, transit, flagged, hangar, turbines = ON
    expect(getInput("deployed").checked).toBe(true);
    expect(getInput("transit").checked).toBe(true);
    expect(getInput("flagged").checked).toBe(true);
    expect(getInput("hangar").checked).toBe(true);
    expect(getInput("turbines").checked).toBe(true);
    // heat, history = OFF by default
    expect(getInput("heat").checked).toBe(false);
    expect(getInput("history").checked).toBe(false);
  });

  it("renders toggles matching a custom initial engine state", () => {
    render(
      <LayerEngineProvider initialState={{ heat: true, history: true, deployed: false }}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    expect(getInput("heat").checked).toBe(true);
    expect(getInput("history").checked).toBe(true);
    expect(getInput("deployed").checked).toBe(false);
    // Other layers follow defaults
    expect(getInput("transit").checked).toBe(true);
    expect(getInput("turbines").checked).toBe(true);
  });

  it("renders all toggles OFF when engine starts with all deactivated", () => {
    const allOff = Object.fromEntries(
      LAYER_SLOT_IDS.map((id) => [id, false])
    );
    render(
      <LayerEngineProvider initialState={allOff}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );
    for (const id of LAYER_SLOT_IDS) {
      expect(getInput(id).checked).toBe(false);
    }
  });

  it("renders all toggles ON when engine starts with all activated", () => {
    const allOn = Object.fromEntries(
      LAYER_SLOT_IDS.map((id) => [id, true])
    );
    render(
      <LayerEngineProvider initialState={allOn}>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );
    for (const id of LAYER_SLOT_IDS) {
      expect(getInput(id).checked).toBe(true);
    }
  });
});

// ─── 4. LayerTogglePanelConnected — dispatches to engine on click ─────────────

describe("LayerTogglePanelConnected — dispatches engine.toggle on click", () => {
  it("clicking a toggle updates the engine state", async () => {
    // We need to access the engine — use a custom provider where we control the engine.
    // Since LayerEngineProvider uses useRef internally, we can't extract the engine
    // easily. Instead, we create the engine externally and pass it via initialState.
    //
    // Strategy: render the connected panel, click a toggle, then verify the panel's
    // own visual state has flipped (proving the engine received and emitted the change).

    render(
      <LayerEngineProvider>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // deployed starts ON (default)
    expect(getInput("deployed").checked).toBe(true);

    // Click to toggle deployed OFF
    await userEvent.click(getInput("deployed"));

    // Panel should now show deployed as OFF (engine toggle → state change → re-render)
    expect(getInput("deployed").checked).toBe(false);
  });

  it("clicking heat (starts OFF) toggles it ON", async () => {
    render(
      <LayerEngineProvider>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    expect(getInput("heat").checked).toBe(false); // starts OFF

    await userEvent.click(getInput("heat"));

    expect(getInput("heat").checked).toBe(true);  // now ON
  });

  it("does not affect other layers when one is clicked", async () => {
    render(
      <LayerEngineProvider>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // Toggle only flagged OFF
    await userEvent.click(getInput("flagged"));

    // Others are unaffected
    expect(getInput("deployed").checked).toBe(true);
    expect(getInput("transit").checked).toBe(true);
    expect(getInput("flagged").checked).toBe(false);  // changed
    expect(getInput("hangar").checked).toBe(true);
    expect(getInput("heat").checked).toBe(false);
    expect(getInput("history").checked).toBe(false);
    expect(getInput("turbines").checked).toBe(true);
  });

  it("round-trip toggle ON → OFF → ON restores original state", async () => {
    render(
      <LayerEngineProvider>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // transit starts ON
    expect(getInput("transit").checked).toBe(true);

    await userEvent.click(getInput("transit")); // OFF
    expect(getInput("transit").checked).toBe(false);

    await userEvent.click(getInput("transit")); // ON again
    expect(getInput("transit").checked).toBe(true);
  });

  it.each(LAYER_SLOT_IDS)(
    "clicking layer '%s' flips it in the engine (panel reflects the change)",
    async (layerId) => {
      render(
        <LayerEngineProvider>
          <LayerTogglePanelConnected />
        </LayerEngineProvider>
      );

      const initialChecked = getInput(layerId).checked;

      await userEvent.click(getInput(layerId));

      expect(getInput(layerId).checked).toBe(!initialChecked);

      cleanup();
    }
  );
});

// ─── 5. LayerTogglePanelConnected — reflects external engine state changes ─────

describe("LayerTogglePanelConnected — reflects external engine state changes", () => {
  /**
   * Creates a provider that exposes the engine via a ref for test control.
   * The engine is created externally and passed as the initial state so we
   * can call engine methods and assert that the panel reacts.
   *
   * Note: LayerEngineProvider creates its own engine from `initialState` —
   * it doesn't accept an engine instance directly.  So instead we render
   * the panel and use a separate shared engine to emit changes.
   *
   * A cleaner approach: create a custom provider that accepts an engine prop.
   * For tests, we use a thin wrapper that creates the engine externally and
   * subscribes directly to prove the useSyncExternalStore path works.
   */

  it("panel updates when an external engine.toggle() call changes state", async () => {
    // Create engine externally
    const engine = new LayerEngine();

    // Create a test-only provider that exposes our engine
    function TestProvider({ children }: { children: React.ReactNode }) {
      // Expose the externally-created engine through context by using a
      // custom wrapper.  Since LayerEngineProvider doesn't accept an engine
      // prop, we re-use the internal LayerEngineProvider pattern:
      // import useRef + LayerEngineContext directly would require exposing
      // internals — instead, we use LayerTogglePanelConnected with layerState
      // managed by the external engine via useSyncExternalStore in the
      // connected component test helper below.
      //
      // For this test group, we test `LayerTogglePanel` in controlled mode
      // directly, driving it with engine state changes via React state.
      return <>{children}</>;
    }

    // Controlled panel test: simulate what LayerTogglePanelConnected does
    let currentLayerState = makeLayerState(
      LAYER_SLOT_IDS.filter((id) => engine.isVisible(id))
    );

    function ControlledPanel() {
      const [state, setState] = React.useState(currentLayerState);

      // Subscribe to engine changes
      React.useEffect(() => {
        return engine.subscribe((newEngineState) => {
          setState(makeLayerState(
            LAYER_SLOT_IDS.filter((id) => newEngineState[id as keyof typeof newEngineState])
          ));
        });
      }, []);

      return (
        <LayerTogglePanel
          layerState={state}
          onToggleLayer={(id) => engine.toggle(id)}
        />
      );
    }

    render(<ControlledPanel />);

    // Initial: deployed is ON
    expect(getInput("deployed").checked).toBe(true);

    // External engine toggle — simulates keyboard shortcut or URL restore
    act(() => {
      engine.toggle("deployed");
    });

    // Panel should reflect the external change
    expect(getInput("deployed").checked).toBe(false);

    // External toggle back
    act(() => {
      engine.toggle("deployed");
    });
    expect(getInput("deployed").checked).toBe(true);
  });

  it("LayerTogglePanelConnected reacts to external toggle on sibling engine call", async () => {
    // Use a shared ref to get access to the engine after it's created
    // by LayerEngineProvider.  We do this by rendering a sibling component
    // that calls useLayerEngineContext() (imported at top level).
    let engineRef: LayerEngine | null = null;

    function EngineExtractor() {
      engineRef = useLayerEngineContext();
      return null;
    }

    render(
      <LayerEngineProvider>
        <EngineExtractor />
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // Verify we got the engine
    expect(engineRef).not.toBeNull();
    const engine = engineRef!;

    // Initial state: deployed is ON
    expect(getInput("deployed").checked).toBe(true);

    // External engine mutation (e.g., keyboard shortcut, URL hydration)
    act(() => {
      engine.toggle("deployed");
    });

    // Panel should reflect the change through useSyncExternalStore
    expect(getInput("deployed").checked).toBe(false);
  });
});

// ─── 6. activateAll / deactivateAll / reset propagate to panel ────────────────

describe("LayerTogglePanelConnected — bulk engine operations propagate to panel", () => {
  /**
   * EngineExtractor captures the LayerEngine instance from context into a ref
   * that the outer test scope can access.  This avoids dynamic require() which
   * doesn't support path aliases in vitest.
   */
  function makeEngineRef() {
    const ref = { current: null as LayerEngine | null };

    function EngineExtractor() {
      ref.current = useLayerEngineContext();
      return null;
    }

    function renderWithEngine() {
      render(
        <LayerEngineProvider>
          <EngineExtractor />
          <LayerTogglePanelConnected />
        </LayerEngineProvider>
      );
    }

    return { ref, renderWithEngine };
  }

  it("engine.activateAll() turns all toggles ON", () => {
    const { ref, renderWithEngine } = makeEngineRef();
    renderWithEngine();
    const engine = ref.current!;

    // heat and history start OFF
    expect(getInput("heat").checked).toBe(false);
    expect(getInput("history").checked).toBe(false);

    act(() => {
      engine.activateAll();
    });

    for (const id of LAYER_SLOT_IDS) {
      expect(getInput(id).checked).toBe(true);
    }
  });

  it("engine.deactivateAll() turns all toggles OFF", () => {
    const { ref, renderWithEngine } = makeEngineRef();
    renderWithEngine();
    const engine = ref.current!;

    act(() => {
      engine.deactivateAll();
    });

    for (const id of LAYER_SLOT_IDS) {
      expect(getInput(id).checked).toBe(false);
    }
  });

  it("engine.reset() restores default state in the panel", () => {
    const { ref, renderWithEngine } = makeEngineRef();
    renderWithEngine();
    const engine = ref.current!;

    // First activate all
    act(() => { engine.activateAll(); });
    expect(getInput("heat").checked).toBe(true);

    // Reset
    act(() => { engine.reset(); });

    // heat and history should be OFF again (defaults)
    expect(getInput("heat").checked).toBe(false);
    expect(getInput("history").checked).toBe(false);
    // Others should be ON
    expect(getInput("deployed").checked).toBe(true);
    expect(getInput("transit").checked).toBe(true);
    expect(getInput("turbines").checked).toBe(true);
  });

  it("engine.setPartial() updates only the specified layers", () => {
    const { ref, renderWithEngine } = makeEngineRef();
    renderWithEngine();
    const engine = ref.current!;

    act(() => {
      engine.setPartial({ heat: true, history: true });
    });

    expect(getInput("heat").checked).toBe(true);
    expect(getInput("history").checked).toBe(true);
    // Others unchanged
    expect(getInput("deployed").checked).toBe(true);
    expect(getInput("turbines").checked).toBe(true);
  });
});

// ─── 7. Footer count tracks engine state ─────────────────────────────────────

describe("LayerTogglePanelConnected — footer count tracks engine state", () => {
  function makeEngineRef() {
    const ref = { current: null as LayerEngine | null };

    function EngineExtractor() {
      ref.current = useLayerEngineContext();
      return null;
    }

    return { ref, EngineExtractor };
  }

  it("footer shows 5 of 7 by default (heat and history off)", () => {
    render(
      <LayerEngineProvider>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    expect(screen.getByText("5 of 7 layers visible")).toBeTruthy();
  });

  it("footer updates when layers are toggled via click", async () => {
    render(
      <LayerEngineProvider>
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );

    // Enable heat (was OFF)
    await userEvent.click(getInput("heat"));
    expect(screen.getByText("6 of 7 layers visible")).toBeTruthy();

    // Enable history (was OFF)
    await userEvent.click(getInput("history"));
    expect(screen.getByText("7 of 7 layers visible")).toBeTruthy();
  });

  it("footer updates after engine.deactivateAll()", () => {
    const { ref, EngineExtractor } = makeEngineRef();
    render(
      <LayerEngineProvider>
        <EngineExtractor />
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );
    const engine = ref.current!;

    act(() => { engine.deactivateAll(); });

    expect(screen.getByText("0 of 7 layers visible")).toBeTruthy();
  });

  it("footer updates after engine.activateAll()", () => {
    const { ref, EngineExtractor } = makeEngineRef();
    render(
      <LayerEngineProvider>
        <EngineExtractor />
        <LayerTogglePanelConnected />
      </LayerEngineProvider>
    );
    const engine = ref.current!;

    act(() => { engine.activateAll(); });

    expect(screen.getByText("7 of 7 layers visible")).toBeTruthy();
  });
});

// ─── 8. LayerTogglePanelConnected — requires LayerEngineProvider ──────────────

describe("LayerTogglePanelConnected — requires LayerEngineProvider", () => {
  it("throws a descriptive error when rendered outside of LayerEngineProvider", () => {
    // Suppress React error logging during this deliberate error test
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      render(<LayerTogglePanelConnected />);
    }).toThrow(/LayerEngineContext/);

    errorSpy.mockRestore();
  });
});
