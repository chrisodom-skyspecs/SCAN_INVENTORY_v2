/**
 * @vitest-environment jsdom
 *
 * Tests for useLayerToggles — per-status-category map layer visibility hook.
 *
 * AC 90201 Sub-AC 1 — Verify that:
 *   1. Hook initialises with all layers visible (DEFAULT_LAYER_TOGGLES).
 *   2. Hook accepts partial initialToggles overrides.
 *   3. toggleLayer flips a single boolean; others remain unchanged.
 *   4. toggleLayer is idempotent when called twice (returns to original value).
 *   5. setLayerToggles applies a partial patch without touching other keys.
 *   6. setAllLayers(false) sets all four toggles to false.
 *   7. setAllLayers(true) restores all toggles to true.
 *   8. Standalone mode (no storeContext) uses independent local state.
 *   9. Store-bound mode reads from storeContext.layerToggles.
 *  10. Store-bound toggleLayer calls storeContext.setEphemeral with the correct patch.
 *  11. Store-bound setLayerToggles calls storeContext.setEphemeral correctly.
 *  12. Store-bound setAllLayers calls storeContext.setEphemeral with all-same value.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLayerToggles } from "../use-layer-toggles";
import { DEFAULT_LAYER_TOGGLES } from "@/types/map";
import type { LayerToggles } from "@/types/map";
import type { MapEphemeralState } from "@/stores/map-state-store";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStoreContext(overrides: Partial<LayerToggles> = {}) {
  const layerToggles: LayerToggles = { ...DEFAULT_LAYER_TOGGLES, ...overrides };
  const setEphemeral = vi.fn((_: Partial<MapEphemeralState>) => {});
  return { layerToggles, setEphemeral };
}

// ─── 1. Default initialisation ────────────────────────────────────────────────

describe("useLayerToggles — default initialisation", () => {
  it("initialises with all layers visible when no options are provided", () => {
    const { result } = renderHook(() => useLayerToggles());
    expect(result.current.layerToggles).toEqual(DEFAULT_LAYER_TOGGLES);
    expect(result.current.layerToggles.deployed).toBe(true);
    expect(result.current.layerToggles.transit).toBe(true);
    expect(result.current.layerToggles.flagged).toBe(true);
    expect(result.current.layerToggles.hangar).toBe(true);
  });
});

// ─── 2. initialToggles override ───────────────────────────────────────────────

describe("useLayerToggles — initialToggles", () => {
  it("applies partial initialToggles over defaults", () => {
    const { result } = renderHook(() =>
      useLayerToggles({ initialToggles: { transit: false } })
    );
    expect(result.current.layerToggles.transit).toBe(false);
    // Others remain at their default (true)
    expect(result.current.layerToggles.deployed).toBe(true);
    expect(result.current.layerToggles.flagged).toBe(true);
    expect(result.current.layerToggles.hangar).toBe(true);
  });

  it("can initialise all layers as hidden", () => {
    const { result } = renderHook(() =>
      useLayerToggles({
        initialToggles: {
          deployed: false,
          transit: false,
          flagged: false,
          hangar: false,
        },
      })
    );
    expect(result.current.layerToggles).toEqual({
      deployed: false,
      transit: false,
      flagged: false,
      hangar: false,
    });
  });
});

// ─── 3. toggleLayer — standalone mode ─────────────────────────────────────────

describe("useLayerToggles — toggleLayer (standalone)", () => {
  it("flips a single boolean and leaves others unchanged", () => {
    const { result } = renderHook(() => useLayerToggles());

    act(() => {
      result.current.toggleLayer("transit");
    });

    expect(result.current.layerToggles.transit).toBe(false);
    expect(result.current.layerToggles.deployed).toBe(true);
    expect(result.current.layerToggles.flagged).toBe(true);
    expect(result.current.layerToggles.hangar).toBe(true);
  });

  it("can toggle all four keys independently", () => {
    const { result } = renderHook(() => useLayerToggles());

    act(() => { result.current.toggleLayer("deployed"); });
    act(() => { result.current.toggleLayer("transit"); });
    act(() => { result.current.toggleLayer("flagged"); });
    act(() => { result.current.toggleLayer("hangar"); });

    expect(result.current.layerToggles).toEqual({
      deployed: false,
      transit: false,
      flagged: false,
      hangar: false,
    });
  });

  it("returns to original value when toggled twice (idempotent cycle)", () => {
    const { result } = renderHook(() => useLayerToggles());

    act(() => { result.current.toggleLayer("flagged"); });
    expect(result.current.layerToggles.flagged).toBe(false);

    act(() => { result.current.toggleLayer("flagged"); });
    expect(result.current.layerToggles.flagged).toBe(true);
  });
});

// ─── 4. setLayerToggles — standalone mode ────────────────────────────────────

describe("useLayerToggles — setLayerToggles (standalone)", () => {
  it("patches only the specified keys", () => {
    const { result } = renderHook(() => useLayerToggles());

    act(() => {
      result.current.setLayerToggles({ deployed: false, hangar: false });
    });

    expect(result.current.layerToggles.deployed).toBe(false);
    expect(result.current.layerToggles.hangar).toBe(false);
    // Unspecified keys remain unchanged
    expect(result.current.layerToggles.transit).toBe(true);
    expect(result.current.layerToggles.flagged).toBe(true);
  });

  it("setting a single key leaves the other three intact", () => {
    const { result } = renderHook(() => useLayerToggles());

    act(() => {
      result.current.setLayerToggles({ flagged: false });
    });

    expect(result.current.layerToggles.flagged).toBe(false);
    expect(result.current.layerToggles.deployed).toBe(true);
    expect(result.current.layerToggles.transit).toBe(true);
    expect(result.current.layerToggles.hangar).toBe(true);
  });
});

// ─── 5. setAllLayers — standalone mode ───────────────────────────────────────

describe("useLayerToggles — setAllLayers (standalone)", () => {
  it("setAllLayers(false) hides all four layers", () => {
    const { result } = renderHook(() => useLayerToggles());

    act(() => {
      result.current.setAllLayers(false);
    });

    expect(result.current.layerToggles).toEqual({
      deployed: false,
      transit: false,
      flagged: false,
      hangar: false,
    });
  });

  it("setAllLayers(true) shows all four layers", () => {
    const { result } = renderHook(() =>
      useLayerToggles({
        initialToggles: {
          deployed: false,
          transit: false,
          flagged: false,
          hangar: false,
        },
      })
    );

    act(() => {
      result.current.setAllLayers(true);
    });

    expect(result.current.layerToggles).toEqual({
      deployed: true,
      transit: true,
      flagged: true,
      hangar: true,
    });
  });

  it("calling setAllLayers(false) then setAllLayers(true) restores defaults", () => {
    const { result } = renderHook(() => useLayerToggles());

    act(() => { result.current.setAllLayers(false); });
    act(() => { result.current.setAllLayers(true); });

    expect(result.current.layerToggles).toEqual(DEFAULT_LAYER_TOGGLES);
  });
});

// ─── 6. Store-bound mode — reading ───────────────────────────────────────────

describe("useLayerToggles — store-bound mode (read)", () => {
  it("reads layerToggles from storeContext when provided", () => {
    const ctx = makeStoreContext({ transit: false });
    const { result } = renderHook(() =>
      useLayerToggles({ storeContext: ctx })
    );

    expect(result.current.layerToggles).toBe(ctx.layerToggles);
    expect(result.current.layerToggles.transit).toBe(false);
    expect(result.current.layerToggles.deployed).toBe(true);
  });
});

// ─── 7. Store-bound mode — toggleLayer ───────────────────────────────────────

describe("useLayerToggles — store-bound toggleLayer", () => {
  it("calls setEphemeral with the toggled layerToggles patch", () => {
    const ctx = makeStoreContext(); // all true
    const { result } = renderHook(() =>
      useLayerToggles({ storeContext: ctx })
    );

    act(() => {
      result.current.toggleLayer("deployed");
    });

    expect(ctx.setEphemeral).toHaveBeenCalledOnce();
    const call = ctx.setEphemeral.mock.calls[0][0];
    expect(call.layerToggles).toEqual({
      deployed: false, // flipped
      transit: true,
      flagged: true,
      hangar: true,
    });
  });

  it("toggles from false to true when current value is false", () => {
    const ctx = makeStoreContext({ flagged: false });
    const { result } = renderHook(() =>
      useLayerToggles({ storeContext: ctx })
    );

    act(() => {
      result.current.toggleLayer("flagged");
    });

    const call = ctx.setEphemeral.mock.calls[0][0];
    expect(call.layerToggles?.flagged).toBe(true);
  });

  it("does not mutate other toggle values when toggling one key", () => {
    const ctx = makeStoreContext({ transit: false, hangar: false });
    const { result } = renderHook(() =>
      useLayerToggles({ storeContext: ctx })
    );

    act(() => {
      result.current.toggleLayer("deployed");
    });

    const patch = ctx.setEphemeral.mock.calls[0][0].layerToggles!;
    // deployed toggled (was true → false)
    expect(patch.deployed).toBe(false);
    // Others preserved from the store context
    expect(patch.transit).toBe(false);
    expect(patch.hangar).toBe(false);
    expect(patch.flagged).toBe(true);
  });
});

// ─── 8. Store-bound mode — setLayerToggles ────────────────────────────────────

describe("useLayerToggles — store-bound setLayerToggles", () => {
  it("calls setEphemeral with merged layerToggles patch", () => {
    const ctx = makeStoreContext(); // all true
    const { result } = renderHook(() =>
      useLayerToggles({ storeContext: ctx })
    );

    act(() => {
      result.current.setLayerToggles({ hangar: false, transit: false });
    });

    expect(ctx.setEphemeral).toHaveBeenCalledOnce();
    const call = ctx.setEphemeral.mock.calls[0][0];
    expect(call.layerToggles).toEqual({
      deployed: true,  // unchanged from ctx
      transit: false,  // patched
      flagged: true,   // unchanged from ctx
      hangar: false,   // patched
    });
  });
});

// ─── 9. Store-bound mode — setAllLayers ──────────────────────────────────────

describe("useLayerToggles — store-bound setAllLayers", () => {
  it("setAllLayers(false) calls setEphemeral with all-false toggles", () => {
    const ctx = makeStoreContext();
    const { result } = renderHook(() =>
      useLayerToggles({ storeContext: ctx })
    );

    act(() => {
      result.current.setAllLayers(false);
    });

    expect(ctx.setEphemeral).toHaveBeenCalledOnce();
    const patch = ctx.setEphemeral.mock.calls[0][0];
    expect(patch.layerToggles).toEqual({
      deployed: false,
      transit: false,
      flagged: false,
      hangar: false,
    });
  });

  it("setAllLayers(true) calls setEphemeral with all-true toggles", () => {
    const ctx = makeStoreContext({
      deployed: false,
      transit: false,
      flagged: false,
      hangar: false,
    });
    const { result } = renderHook(() =>
      useLayerToggles({ storeContext: ctx })
    );

    act(() => {
      result.current.setAllLayers(true);
    });

    const patch = ctx.setEphemeral.mock.calls[0][0];
    expect(patch.layerToggles).toEqual({
      deployed: true,
      transit: true,
      flagged: true,
      hangar: true,
    });
  });
});

// ─── 10. Isolation — two standalone instances ─────────────────────────────────

describe("useLayerToggles — isolation between standalone instances", () => {
  it("two hook instances do not share state", () => {
    const { result: r1 } = renderHook(() => useLayerToggles());
    const { result: r2 } = renderHook(() => useLayerToggles());

    act(() => {
      r1.current.toggleLayer("hangar");
    });

    // r1 has hangar hidden; r2 is unaffected
    expect(r1.current.layerToggles.hangar).toBe(false);
    expect(r2.current.layerToggles.hangar).toBe(true);
  });
});
