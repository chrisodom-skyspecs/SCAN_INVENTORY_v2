/**
 * Unit tests for LayerEngine and LayerRegistry.
 *
 * Covers:
 *   • Registry — LAYER_REGISTRY contents, getLayerDef, findLayerDef, getLayerIds
 *   • LayerEngine constructor — defaults, custom initial state
 *   • getState / isVisible / getActiveLayers / getInactiveLayers
 *   • toggle — on→off, off→on, emits event
 *   • setVisible — no-op when already in target state
 *   • setPartial — multi-layer patch
 *   • setState — full replacement
 *   • activateAll / deactivateAll — bulk mutations
 *   • reset — restores DEFAULT_LAYER_ENGINE_STATE
 *   • subscribe / onchange — listener lifecycle, payload shape, unsub
 *   • State immutability — new object reference after mutation
 *   • No-op emission prevention — listeners NOT called when nothing changed
 */

import { describe, it, expect, vi } from "vitest";

import { LayerEngine } from "../layer-engine";
import {
  LAYER_REGISTRY,
  getLayerDef,
  findLayerDef,
  getLayerIds,
  getDefaultActiveLayers,
} from "../layer-registry";
import {
  DEFAULT_LAYER_ENGINE_STATE,
  SEMANTIC_LAYER_IDS,
  isSemanticLayerId,
} from "@/types/layer-engine";
import type { LayerEngineChangeListener, LayerEngineState, SemanticLayerId } from "@/types/layer-engine";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEngine(initial?: Partial<LayerEngineState>) {
  return new LayerEngine(initial);
}

// ─── SEMANTIC_LAYER_IDS / isSemanticLayerId ───────────────────────────────────

describe("SEMANTIC_LAYER_IDS", () => {
  it("contains exactly the 7 expected layer IDs", () => {
    expect(SEMANTIC_LAYER_IDS).toHaveLength(7);
    expect(SEMANTIC_LAYER_IDS).toContain("deployed");
    expect(SEMANTIC_LAYER_IDS).toContain("transit");
    expect(SEMANTIC_LAYER_IDS).toContain("flagged");
    expect(SEMANTIC_LAYER_IDS).toContain("hangar");
    expect(SEMANTIC_LAYER_IDS).toContain("heat");
    expect(SEMANTIC_LAYER_IDS).toContain("history");
    expect(SEMANTIC_LAYER_IDS).toContain("turbines");
  });
});

describe("isSemanticLayerId", () => {
  it("returns true for valid IDs", () => {
    expect(isSemanticLayerId("deployed")).toBe(true);
    expect(isSemanticLayerId("turbines")).toBe(true);
  });

  it("returns false for invalid values", () => {
    expect(isSemanticLayerId("cases")).toBe(false);
    expect(isSemanticLayerId("unknown")).toBe(false);
    expect(isSemanticLayerId(null)).toBe(false);
    expect(isSemanticLayerId(42)).toBe(false);
    expect(isSemanticLayerId("")).toBe(false);
  });
});

// ─── LAYER_REGISTRY ───────────────────────────────────────────────────────────

describe("LAYER_REGISTRY", () => {
  it("contains exactly 7 entries", () => {
    expect(LAYER_REGISTRY).toHaveLength(7);
  });

  it("every entry has the required fields", () => {
    for (const def of LAYER_REGISTRY) {
      expect(isSemanticLayerId(def.id)).toBe(true);
      expect(typeof def.label).toBe("string");
      expect(def.label.length).toBeGreaterThan(0);
      expect(typeof def.description).toBe("string");
      expect(def.description.length).toBeGreaterThan(0);
      expect(typeof def.defaultActive).toBe("boolean");
      expect(def.colorToken).toMatch(/^--layer-/);
      expect(def.bgToken).toMatch(/^--layer-/);
      expect(typeof def.order).toBe("number");
    }
  });

  it("entries are sorted by order (ascending)", () => {
    const orders = LAYER_REGISTRY.map((d) => d.order);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]);
    }
  });

  it("each ID appears exactly once", () => {
    const ids = LAYER_REGISTRY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers all 7 SEMANTIC_LAYER_IDS", () => {
    const registryIds = new Set(LAYER_REGISTRY.map((d) => d.id));
    for (const id of SEMANTIC_LAYER_IDS) {
      expect(registryIds.has(id)).toBe(true);
    }
  });

  it("deployed, transit, flagged, hangar, turbines default to active", () => {
    const activeDefaults = LAYER_REGISTRY.filter((d) => d.defaultActive).map((d) => d.id);
    expect(activeDefaults).toContain("deployed");
    expect(activeDefaults).toContain("transit");
    expect(activeDefaults).toContain("flagged");
    expect(activeDefaults).toContain("hangar");
    expect(activeDefaults).toContain("turbines");
  });

  it("heat and history default to inactive", () => {
    const inactiveDefaults = LAYER_REGISTRY.filter((d) => !d.defaultActive).map((d) => d.id);
    expect(inactiveDefaults).toContain("heat");
    expect(inactiveDefaults).toContain("history");
  });
});

// ─── getLayerDef ──────────────────────────────────────────────────────────────

describe("getLayerDef", () => {
  it("returns the correct definition for each ID", () => {
    for (const id of SEMANTIC_LAYER_IDS) {
      const def = getLayerDef(id);
      expect(def.id).toBe(id);
    }
  });

  it("throws for unknown IDs", () => {
    expect(() => getLayerDef("nonexistent" as SemanticLayerId)).toThrow(
      /Unknown layer ID/
    );
  });
});

// ─── findLayerDef ─────────────────────────────────────────────────────────────

describe("findLayerDef", () => {
  it("returns the definition for a valid ID", () => {
    expect(findLayerDef("deployed")).toBeDefined();
    expect(findLayerDef("deployed")?.id).toBe("deployed");
  });

  it("returns undefined for unknown strings", () => {
    expect(findLayerDef("unknown")).toBeUndefined();
    expect(findLayerDef("")).toBeUndefined();
  });
});

// ─── getLayerIds ──────────────────────────────────────────────────────────────

describe("getLayerIds", () => {
  it("returns all 7 IDs in registry order", () => {
    const ids = getLayerIds();
    expect(ids).toHaveLength(7);
    expect(ids[0]).toBe("deployed");
    expect(ids[ids.length - 1]).toBe("turbines");
  });
});

// ─── getDefaultActiveLayers ───────────────────────────────────────────────────

describe("getDefaultActiveLayers", () => {
  it("returns only layers with defaultActive=true", () => {
    const defaultActive = getDefaultActiveLayers();
    expect(defaultActive).toContain("deployed");
    expect(defaultActive).toContain("transit");
    expect(defaultActive).toContain("flagged");
    expect(defaultActive).toContain("hangar");
    expect(defaultActive).toContain("turbines");
    expect(defaultActive).not.toContain("heat");
    expect(defaultActive).not.toContain("history");
  });
});

// ─── DEFAULT_LAYER_ENGINE_STATE ───────────────────────────────────────────────

describe("DEFAULT_LAYER_ENGINE_STATE", () => {
  it("matches LAYER_REGISTRY defaultActive values", () => {
    for (const def of LAYER_REGISTRY) {
      expect(DEFAULT_LAYER_ENGINE_STATE[def.id]).toBe(def.defaultActive);
    }
  });

  it("has all 7 keys", () => {
    const keys = Object.keys(DEFAULT_LAYER_ENGINE_STATE);
    expect(keys).toHaveLength(7);
  });
});

// ─── LayerEngine — constructor ────────────────────────────────────────────────

describe("LayerEngine — constructor", () => {
  it("initialises with DEFAULT_LAYER_ENGINE_STATE when no arg given", () => {
    const engine = makeEngine();
    expect(engine.getState()).toEqual(DEFAULT_LAYER_ENGINE_STATE);
  });

  it("accepts a partial initial state override", () => {
    const engine = makeEngine({ heat: true, history: true });
    const state = engine.getState();
    // Overrides applied
    expect(state.heat).toBe(true);
    expect(state.history).toBe(true);
    // Non-overridden fields use defaults
    expect(state.deployed).toBe(DEFAULT_LAYER_ENGINE_STATE.deployed);
  });

  it("applies full initial state override correctly", () => {
    const allOff = Object.fromEntries(
      SEMANTIC_LAYER_IDS.map((id) => [id, false])
    ) as Record<SemanticLayerId, boolean>;
    const engine = makeEngine(allOff);
    for (const id of SEMANTIC_LAYER_IDS) {
      expect(engine.isVisible(id)).toBe(false);
    }
  });
});

// ─── LayerEngine — read methods ───────────────────────────────────────────────

describe("LayerEngine — isVisible", () => {
  it("returns the correct value for each layer in default state", () => {
    const engine = makeEngine();
    for (const id of SEMANTIC_LAYER_IDS) {
      expect(engine.isVisible(id)).toBe(DEFAULT_LAYER_ENGINE_STATE[id]);
    }
  });

  it("reflects changes after toggle", () => {
    const engine = makeEngine();
    const before = engine.isVisible("heat");
    engine.toggle("heat");
    expect(engine.isVisible("heat")).toBe(!before);
  });
});

describe("LayerEngine — getActiveLayers", () => {
  it("returns only active layers in default state", () => {
    const engine = makeEngine();
    const active = engine.getActiveLayers();
    expect(active).toContain("deployed");
    expect(active).not.toContain("heat");
    expect(active).not.toContain("history");
  });

  it("updates after activating all", () => {
    const engine = makeEngine();
    engine.activateAll();
    expect(engine.getActiveLayers()).toHaveLength(7);
  });

  it("returns empty array when all deactivated", () => {
    const engine = makeEngine();
    engine.deactivateAll();
    expect(engine.getActiveLayers()).toHaveLength(0);
  });
});

describe("LayerEngine — getInactiveLayers", () => {
  it("returns heat and history by default", () => {
    const engine = makeEngine();
    const inactive = engine.getInactiveLayers();
    expect(inactive).toContain("heat");
    expect(inactive).toContain("history");
    expect(inactive).not.toContain("deployed");
  });

  it("returns all when deactivateAll is called", () => {
    const engine = makeEngine();
    engine.deactivateAll();
    expect(engine.getInactiveLayers()).toHaveLength(7);
  });
});

// ─── LayerEngine — toggle ─────────────────────────────────────────────────────

describe("LayerEngine — toggle", () => {
  it("flips a visible layer to invisible", () => {
    const engine = makeEngine();
    // deployed is true by default
    expect(engine.isVisible("deployed")).toBe(true);
    engine.toggle("deployed");
    expect(engine.isVisible("deployed")).toBe(false);
  });

  it("flips an invisible layer to visible", () => {
    const engine = makeEngine();
    // heat is false by default
    expect(engine.isVisible("heat")).toBe(false);
    engine.toggle("heat");
    expect(engine.isVisible("heat")).toBe(true);
  });

  it("emits to subscribers on each toggle", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.toggle("deployed");
    expect(listener).toHaveBeenCalledOnce();
    engine.toggle("deployed"); // toggle back
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does NOT affect other layers", () => {
    const engine = makeEngine();
    engine.toggle("heat");
    expect(engine.isVisible("deployed")).toBe(true);
    expect(engine.isVisible("transit")).toBe(true);
    expect(engine.isVisible("turbines")).toBe(true);
  });
});

// ─── LayerEngine — setVisible ─────────────────────────────────────────────────

describe("LayerEngine — setVisible", () => {
  it("sets a layer visible when it was hidden", () => {
    const engine = makeEngine();
    engine.setVisible("heat", true);
    expect(engine.isVisible("heat")).toBe(true);
  });

  it("sets a layer hidden when it was visible", () => {
    const engine = makeEngine();
    engine.setVisible("deployed", false);
    expect(engine.isVisible("deployed")).toBe(false);
  });

  it("is a no-op when the layer is already in the target state", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    // deployed is already true
    engine.setVisible("deployed", true);
    expect(listener).not.toHaveBeenCalled();

    // heat is already false
    engine.setVisible("heat", false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("emits when state actually changes", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setVisible("heat", true);
    expect(listener).toHaveBeenCalledOnce();
  });
});

// ─── LayerEngine — enable ─────────────────────────────────────────────────────

describe("LayerEngine — enable", () => {
  it("makes a hidden layer visible", () => {
    const engine = makeEngine();
    // heat is false by default
    expect(engine.isVisible("heat")).toBe(false);
    engine.enable("heat");
    expect(engine.isVisible("heat")).toBe(true);
  });

  it("is a no-op when the layer is already visible", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    // deployed is already true
    engine.enable("deployed");
    expect(listener).not.toHaveBeenCalled();
    expect(engine.isVisible("deployed")).toBe(true);
  });

  it("emits to subscribers when state changes", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.enable("history");
    expect(listener).toHaveBeenCalledOnce();
    const state = listener.mock.calls[0][0];
    expect(state.history).toBe(true);
  });

  it("does not affect other layers", () => {
    const engine = makeEngine();
    engine.enable("heat");
    expect(engine.isVisible("deployed")).toBe(DEFAULT_LAYER_ENGINE_STATE.deployed);
    expect(engine.isVisible("transit")).toBe(DEFAULT_LAYER_ENGINE_STATE.transit);
  });
});

// ─── LayerEngine — disable ────────────────────────────────────────────────────

describe("LayerEngine — disable", () => {
  it("hides a visible layer", () => {
    const engine = makeEngine();
    // deployed is true by default
    expect(engine.isVisible("deployed")).toBe(true);
    engine.disable("deployed");
    expect(engine.isVisible("deployed")).toBe(false);
  });

  it("is a no-op when the layer is already hidden", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    // heat is already false
    engine.disable("heat");
    expect(listener).not.toHaveBeenCalled();
    expect(engine.isVisible("heat")).toBe(false);
  });

  it("emits to subscribers when state changes", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.disable("turbines");
    expect(listener).toHaveBeenCalledOnce();
    const state = listener.mock.calls[0][0];
    expect(state.turbines).toBe(false);
  });

  it("does not affect other layers", () => {
    const engine = makeEngine();
    engine.disable("deployed");
    expect(engine.isVisible("transit")).toBe(DEFAULT_LAYER_ENGINE_STATE.transit);
    expect(engine.isVisible("heat")).toBe(DEFAULT_LAYER_ENGINE_STATE.heat);
  });

  it("enable then disable returns to hidden state", () => {
    const engine = makeEngine();
    engine.enable("heat");
    expect(engine.isVisible("heat")).toBe(true);
    engine.disable("heat");
    expect(engine.isVisible("heat")).toBe(false);
  });
});

// ─── LayerEngine — setPartial ─────────────────────────────────────────────────

describe("LayerEngine — setPartial", () => {
  it("applies a multi-key patch atomically", () => {
    const engine = makeEngine();
    engine.setPartial({ heat: true, history: true });
    expect(engine.isVisible("heat")).toBe(true);
    expect(engine.isVisible("history")).toBe(true);
    // Others unchanged
    expect(engine.isVisible("deployed")).toBe(DEFAULT_LAYER_ENGINE_STATE.deployed);
  });

  it("emits only once even when multiple layers change", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setPartial({ heat: true, history: true });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("is a no-op when patch produces no change", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    // deployed is already true
    engine.setPartial({ deployed: true });
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── LayerEngine — setState ───────────────────────────────────────────────────

describe("LayerEngine — setState", () => {
  it("replaces the full state", () => {
    const engine = makeEngine();
    const allOn = Object.fromEntries(
      SEMANTIC_LAYER_IDS.map((id) => [id, true])
    ) as Record<SemanticLayerId, boolean>;
    engine.setState(allOn);
    for (const id of SEMANTIC_LAYER_IDS) {
      expect(engine.isVisible(id)).toBe(true);
    }
  });

  it("emits when at least one field changed", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setState({ ...DEFAULT_LAYER_ENGINE_STATE, heat: true });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("is a no-op when state is identical", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.setState({ ...DEFAULT_LAYER_ENGINE_STATE });
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── LayerEngine — activateAll ────────────────────────────────────────────────

describe("LayerEngine — activateAll", () => {
  it("makes all 7 layers visible", () => {
    const engine = makeEngine();
    engine.activateAll();
    for (const id of SEMANTIC_LAYER_IDS) {
      expect(engine.isVisible(id)).toBe(true);
    }
  });

  it("emits to subscribers", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.activateAll();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("is a no-op when all are already active", () => {
    const engine = makeEngine();
    engine.activateAll(); // first call — changes heat and history
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.activateAll(); // second call — nothing changes
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── LayerEngine — deactivateAll ─────────────────────────────────────────────

describe("LayerEngine — deactivateAll", () => {
  it("hides all 7 layers", () => {
    const engine = makeEngine();
    engine.deactivateAll();
    for (const id of SEMANTIC_LAYER_IDS) {
      expect(engine.isVisible(id)).toBe(false);
    }
  });

  it("emits to subscribers", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.deactivateAll();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("is a no-op when all are already hidden", () => {
    const engine = makeEngine();
    engine.deactivateAll(); // first call
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.deactivateAll(); // second call — nothing changes
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── LayerEngine — reset ──────────────────────────────────────────────────────

describe("LayerEngine — reset", () => {
  it("restores DEFAULT_LAYER_ENGINE_STATE", () => {
    const engine = makeEngine({ heat: true, history: true, deployed: false });
    engine.reset();
    expect(engine.getState()).toEqual(DEFAULT_LAYER_ENGINE_STATE);
  });

  it("emits when state was non-default", () => {
    const engine = makeEngine({ heat: true });
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.reset();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("is a no-op when already at defaults", () => {
    const engine = makeEngine(); // starts at defaults
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.reset();
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── LayerEngine — subscribe ──────────────────────────────────────────────────

describe("LayerEngine — subscribe", () => {
  it("calls listener with the new state on change", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.subscribe(listener);

    engine.toggle("heat");
    expect(listener).toHaveBeenCalledOnce();
    const state = listener.mock.calls[0][0];
    expect(state.heat).toBe(true);
  });

  it("returns an unsubscribe function", () => {
    const engine = makeEngine();
    const listener = vi.fn();
    const unsub = engine.subscribe(listener);

    engine.toggle("heat");
    expect(listener).toHaveBeenCalledOnce();

    unsub();
    engine.toggle("heat"); // back to default
    expect(listener).toHaveBeenCalledOnce(); // not called again
  });

  it("supports multiple subscribers", () => {
    const engine = makeEngine();
    const l1 = vi.fn();
    const l2 = vi.fn();
    engine.subscribe(l1);
    engine.subscribe(l2);

    engine.toggle("heat");
    expect(l1).toHaveBeenCalledOnce();
    expect(l2).toHaveBeenCalledOnce();
  });

  it("unsubscribing one does not affect others", () => {
    const engine = makeEngine();
    const l1 = vi.fn();
    const l2 = vi.fn();
    engine.subscribe(l1);
    const unsub2 = engine.subscribe(l2);

    unsub2();
    engine.toggle("heat");
    expect(l1).toHaveBeenCalledOnce();
    expect(l2).not.toHaveBeenCalled();
  });
});

// ─── LayerEngine — onchange ───────────────────────────────────────────────────

describe("LayerEngine — onchange", () => {
  it("receives the change event with diff", () => {
    const engine = makeEngine();
    const listener: LayerEngineChangeListener = vi.fn();
    engine.onchange(listener);

    engine.toggle("heat"); // heat: false → true
    expect(listener).toHaveBeenCalledOnce();
    const event = (listener as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(event.state.heat).toBe(true);
    expect(event.diff).toEqual({ heat: true });
  });

  it("diff contains only changed layers", () => {
    const engine = makeEngine();
    const listener: LayerEngineChangeListener = vi.fn();
    engine.onchange(listener);

    engine.setPartial({ heat: true, history: true });
    const event = (listener as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Object.keys(event.diff)).toHaveLength(2);
    expect(event.diff).toEqual({ heat: true, history: true });
  });

  it("returns an unsubscribe function", () => {
    const engine = makeEngine();
    const listener: LayerEngineChangeListener = vi.fn();
    const unsub = engine.onchange(listener);

    engine.toggle("heat");
    expect(listener).toHaveBeenCalledOnce();

    unsub();
    engine.toggle("heat");
    expect(listener).toHaveBeenCalledOnce(); // not called again
  });
});

// ─── State immutability ───────────────────────────────────────────────────────

describe("LayerEngine — state immutability", () => {
  it("getState returns a new object reference after each mutation", () => {
    const engine = makeEngine();
    const ref1 = engine.getState();
    engine.toggle("heat");
    const ref2 = engine.getState();
    expect(ref1).not.toBe(ref2);
  });

  it("getState returns the same reference when nothing changed", () => {
    const engine = makeEngine();
    const ref1 = engine.getState();
    const ref2 = engine.getState();
    expect(ref1).toBe(ref2);
  });

  it("mutating the returned state object does not affect engine state", () => {
    const engine = makeEngine();
    const state = engine.getState() as Record<string, boolean>;
    // Attempt mutation on the snapshot
    // (in production this would throw if frozen, but here we just verify isolation)
    const originalValue = state["heat"];
    try {
      state["heat"] = !originalValue;
    } catch {
      // frozen — that's fine too
    }
    // Engine's own state is unaffected
    expect(engine.isVisible("heat")).toBe(DEFAULT_LAYER_ENGINE_STATE.heat);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("LayerEngine — edge cases", () => {
  it("handles rapid sequential toggles correctly", () => {
    const engine = makeEngine();
    const initial = engine.isVisible("deployed");

    engine.toggle("deployed");
    engine.toggle("deployed");
    engine.toggle("deployed");

    // Odd number of toggles = flipped once net
    expect(engine.isVisible("deployed")).toBe(!initial);
  });

  it("accumulates changes across multiple partial patches", () => {
    const engine = makeEngine();
    engine.setPartial({ heat: true });
    engine.setPartial({ history: true });
    expect(engine.isVisible("heat")).toBe(true);
    expect(engine.isVisible("history")).toBe(true);
  });

  it("reset after multiple mutations returns to defaults", () => {
    const engine = makeEngine();
    engine.activateAll();
    engine.toggle("deployed");
    engine.toggle("transit");
    engine.reset();
    expect(engine.getState()).toEqual(DEFAULT_LAYER_ENGINE_STATE);
  });
});
