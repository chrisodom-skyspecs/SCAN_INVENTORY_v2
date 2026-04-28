/**
 * Unit tests for MapStateStore.
 *
 * Covers:
 *   • Initial state construction
 *   • setUrlState — partial patches, change detection, no-op on same values
 *   • hydrate — full URL state replacement
 *   • setEphemeral — partial patches, no-op on same values
 *   • reset — returns to defaults
 *   • subscribe / onchange — listener lifecycle and payload shape
 *   • getUrlState / getEphemeral — field isolation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { MapStateStore, DEFAULT_EPHEMERAL_STATE } from "../map-state-store";
import type { MapStateListener, MapStateChangeListener } from "../map-state-store";
import { MAP_URL_STATE_DEFAULTS } from "@/types/map";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStore() {
  return new MapStateStore();
}

// ─── Constructor ──────────────────────────────────────────────────────────────

describe("MapStateStore — constructor", () => {
  it("initialises with defaults when no argument is provided", () => {
    const store = makeStore();
    const state = store.getState();

    expect(state.view).toBe(MAP_URL_STATE_DEFAULTS.view);
    expect(state.case).toBe(MAP_URL_STATE_DEFAULTS.case);
    expect(state.window).toBe(MAP_URL_STATE_DEFAULTS.window);
    expect(state.layers).toEqual(MAP_URL_STATE_DEFAULTS.layers);
    expect(state.org).toBe(MAP_URL_STATE_DEFAULTS.org);
    expect(state.kit).toBe(MAP_URL_STATE_DEFAULTS.kit);
    expect(state.at).toBe(MAP_URL_STATE_DEFAULTS.at);
    expect(state.ephemeral).toEqual(DEFAULT_EPHEMERAL_STATE);
  });

  it("accepts a custom initial URL state", () => {
    const store = new MapStateStore({ ...MAP_URL_STATE_DEFAULTS, view: "M3" });
    expect(store.getState().view).toBe("M3");
  });

  it("ephemeral state is always initialised to defaults regardless of initial URL state", () => {
    const store = new MapStateStore({ ...MAP_URL_STATE_DEFAULTS, view: "M2" });
    expect(store.getState().ephemeral).toEqual(DEFAULT_EPHEMERAL_STATE);
  });
});

// ─── getUrlState ─────────────────────────────────────────────────────────────

describe("MapStateStore — getUrlState", () => {
  it("returns state without the ephemeral field", () => {
    const store = makeStore();
    const urlState = store.getUrlState();
    expect("ephemeral" in urlState).toBe(false);
    expect(urlState.view).toBe("M1");
  });

  it("reflects URL state changes", () => {
    const store = makeStore();
    store.setUrlState({ view: "M4" });
    expect(store.getUrlState().view).toBe("M4");
  });
});

// ─── getEphemeral ─────────────────────────────────────────────────────────────

describe("MapStateStore — getEphemeral", () => {
  it("returns only the ephemeral state", () => {
    const store = makeStore();
    const eph = store.getEphemeral();
    expect(eph.isMapLoading).toBe(false);
    expect(eph.hoveredCaseId).toBeNull();
  });

  it("reflects ephemeral changes", () => {
    const store = makeStore();
    store.setEphemeral({ hoveredCaseId: "case-xyz" });
    expect(store.getEphemeral().hoveredCaseId).toBe("case-xyz");
  });
});

// ─── setUrlState ─────────────────────────────────────────────────────────────

describe("MapStateStore — setUrlState", () => {
  it("applies a partial patch to URL state", () => {
    const store = makeStore();
    store.setUrlState({ view: "M2" });
    expect(store.getState().view).toBe("M2");
    // Other URL fields unchanged
    expect(store.getState().case).toBeNull();
  });

  it("patches multiple fields at once", () => {
    const store = makeStore();
    store.setUrlState({ view: "M3", case: "case-abc", window: "T2" });
    const state = store.getState();
    expect(state.view).toBe("M3");
    expect(state.case).toBe("case-abc");
    expect(state.window).toBe("T2");
  });

  it("does NOT mutate ephemeral state", () => {
    const store = makeStore();
    store.setEphemeral({ isMapLoading: true });
    store.setUrlState({ view: "M2" });
    expect(store.getState().ephemeral.isMapLoading).toBe(true);
  });

  it("emits to subscribers when state changes", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setUrlState({ view: "M2" });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].view).toBe("M2");
  });

  it("does NOT emit when the patch produces no change (same values)", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    // Patching with the existing default view should not emit
    store.setUrlState({ view: MAP_URL_STATE_DEFAULTS.view });
    expect(listener).not.toHaveBeenCalled();
  });

  it("setting case to null preserves null correctly", () => {
    const store = new MapStateStore({
      ...MAP_URL_STATE_DEFAULTS,
      case: "old-case",
    });
    store.setUrlState({ case: null });
    expect(store.getState().case).toBeNull();
  });
});

// ─── hydrate ─────────────────────────────────────────────────────────────────

describe("MapStateStore — hydrate", () => {
  it("replaces the entire URL state", () => {
    const store = new MapStateStore({
      ...MAP_URL_STATE_DEFAULTS,
      view: "M2",
      case: "old",
    });

    store.hydrate({ ...MAP_URL_STATE_DEFAULTS, view: "M4", case: "new" });

    const state = store.getState();
    expect(state.view).toBe("M4");
    expect(state.case).toBe("new");
  });

  it("preserves ephemeral state during hydration", () => {
    const store = makeStore();
    store.setEphemeral({ isMapLoading: true });
    store.hydrate({ ...MAP_URL_STATE_DEFAULTS, view: "M3" });
    expect(store.getState().ephemeral.isMapLoading).toBe(true);
  });

  it("emits when URL state changes", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.hydrate({ ...MAP_URL_STATE_DEFAULTS, view: "M5" });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does NOT emit when hydrated with identical state", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    // Hydrating with the exact same values → no emit
    store.hydrate({ ...MAP_URL_STATE_DEFAULTS });
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── setEphemeral ─────────────────────────────────────────────────────────────

describe("MapStateStore — setEphemeral", () => {
  it("applies a partial patch", () => {
    const store = makeStore();
    store.setEphemeral({ hoveredCaseId: "abc" });
    expect(store.getState().ephemeral.hoveredCaseId).toBe("abc");
    expect(store.getState().ephemeral.isMapLoading).toBe(false); // unchanged
  });

  it("does NOT mutate URL state", () => {
    const store = makeStore();
    store.setUrlState({ view: "M3" });
    store.setEphemeral({ isMapLoading: true });
    expect(store.getState().view).toBe("M3"); // still M3
  });

  it("emits to subscribers", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setEphemeral({ isMapLoading: true });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does NOT emit when patching with the same values", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    // hoveredCaseId is already null — patching to null is a no-op
    store.setEphemeral({ hoveredCaseId: null });
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── reset ────────────────────────────────────────────────────────────────────

describe("MapStateStore — reset", () => {
  it("resets URL state to defaults", () => {
    const store = new MapStateStore({
      ...MAP_URL_STATE_DEFAULTS,
      view: "M4",
      case: "some-case",
    });
    store.reset();
    const urlState = store.getUrlState();
    expect(urlState).toEqual(MAP_URL_STATE_DEFAULTS);
  });

  it("resets ephemeral state to defaults", () => {
    const store = makeStore();
    store.setEphemeral({ isMapLoading: true, hoveredCaseId: "x" });
    store.reset();
    expect(store.getState().ephemeral).toEqual(DEFAULT_EPHEMERAL_STATE);
  });

  it("emits when state was non-default before reset", () => {
    const store = new MapStateStore({ ...MAP_URL_STATE_DEFAULTS, view: "M3" });
    const listener = vi.fn();
    store.subscribe(listener);

    store.reset();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does NOT emit when state is already at defaults", () => {
    const store = makeStore(); // starts at defaults
    const listener = vi.fn();
    store.subscribe(listener);

    store.reset();
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── subscribe ────────────────────────────────────────────────────────────────

describe("MapStateStore — subscribe", () => {
  it("returns an unsubscribe function", () => {
    const store = makeStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);

    store.setUrlState({ view: "M2" });
    expect(listener).toHaveBeenCalledOnce();

    unsub();

    store.setUrlState({ view: "M3" });
    expect(listener).toHaveBeenCalledOnce(); // not called again
  });

  it("supports multiple subscribers", () => {
    const store = makeStore();
    const l1 = vi.fn();
    const l2 = vi.fn();

    store.subscribe(l1);
    store.subscribe(l2);
    store.setUrlState({ view: "M4" });

    expect(l1).toHaveBeenCalledOnce();
    expect(l2).toHaveBeenCalledOnce();
  });

  it("unsubscribing one listener does not affect others", () => {
    const store = makeStore();
    const l1 = vi.fn();
    const l2 = vi.fn();

    store.subscribe(l1);
    const unsub2 = store.subscribe(l2);

    unsub2();
    store.setUrlState({ view: "M5" });

    expect(l1).toHaveBeenCalledOnce();
    expect(l2).not.toHaveBeenCalled();
  });
});

// ─── onchange ─────────────────────────────────────────────────────────────────

describe("MapStateStore — onchange", () => {
  it("receives the change event with urlDiff and ephemeralChanged", () => {
    const store = makeStore();
    const listener: MapStateChangeListener = vi.fn();
    store.onchange(listener);

    store.setUrlState({ view: "M2" });

    expect(listener).toHaveBeenCalledOnce();
    const event = (listener as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(event.state.view).toBe("M2");
    expect(event.urlDiff).toEqual({ view: "M2" });
    expect(event.ephemeralChanged).toBe(false);
  });

  it("reports ephemeralChanged=true for ephemeral-only changes", () => {
    const store = makeStore();
    const listener: MapStateChangeListener = vi.fn();
    store.onchange(listener);

    store.setEphemeral({ isMapLoading: true });

    const event = (listener as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(event.urlDiff).toEqual({});
    expect(event.ephemeralChanged).toBe(true);
  });

  it("reports both urlDiff and ephemeralChanged after separate updates", () => {
    const store = makeStore();
    const events: import("../map-state-store").MapStateChangeEvent[] = [];
    const listener: MapStateChangeListener = (e) => { events.push(e); };
    store.onchange(listener);

    store.setUrlState({ view: "M3" });
    store.setEphemeral({ hoveredCaseId: "abc" });

    expect(events).toHaveLength(2);
    expect(events[0].urlDiff).toEqual({ view: "M3" });
    expect(events[0].ephemeralChanged).toBe(false);
    expect(events[1].urlDiff).toEqual({});
    expect(events[1].ephemeralChanged).toBe(true);
  });

  it("unsubscribes correctly", () => {
    const store = makeStore();
    const listener: MapStateChangeListener = vi.fn();
    const unsub = store.onchange(listener);

    store.setUrlState({ view: "M2" });
    expect(listener).toHaveBeenCalledOnce();

    unsub();
    store.setUrlState({ view: "M3" });
    expect(listener).toHaveBeenCalledOnce(); // not called again
  });
});

// ─── State immutability ───────────────────────────────────────────────────────

describe("MapStateStore — state immutability", () => {
  it("getState returns a new object reference after each mutation", () => {
    const store = makeStore();
    const ref1 = store.getState();
    store.setUrlState({ view: "M2" });
    const ref2 = store.getState();
    expect(ref1).not.toBe(ref2);
  });

  it("getState returns the same reference when nothing changed", () => {
    // Two calls without mutation in between → same object
    const store = makeStore();
    const ref1 = store.getState();
    const ref2 = store.getState();
    expect(ref1).toBe(ref2);
  });
});

// ─── Layer state ──────────────────────────────────────────────────────────────

describe("MapStateStore — layer state", () => {
  it("stores and retrieves layer arrays correctly", () => {
    const store = makeStore();
    store.setUrlState({ layers: ["satellite", "terrain"] });
    expect(store.getState().layers).toEqual(["satellite", "terrain"]);
  });

  it("detects layer changes via diffMapUrlState", () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setUrlState({ layers: ["heat"] });
    expect(listener).toHaveBeenCalledOnce();
  });
});
