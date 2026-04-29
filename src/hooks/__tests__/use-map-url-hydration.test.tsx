/**
 * @vitest-environment jsdom
 *
 * Tests for URL hydration hooks (Sub-AC 12b):
 *   - useInitialMapUrlState — parse and validate URL params at first render
 *   - useMapUrlHydration    — hydrate a MapStateStore at mount from URL params
 *   - useMapUrlHydratedStore — create a store pre-initialized from URL params
 *
 * Strategy
 * ────────
 * `next/navigation` is mocked with a mutable `_searchParamsString` that acts
 * as the current URL query string.  Tests mutate this variable before rendering
 * to simulate different page-load URLs.
 *
 * The `MapStateStore` is used directly (not mocked) so we can assert on real
 * state values — making these integration-level tests that verify the full
 * URL → parse → validate → store initialization pipeline.
 *
 * Covered scenarios
 * ─────────────────
 * A. useInitialMapUrlState
 *    A1  Empty URL → all params default
 *    A2  Valid params parsed correctly (view, case, window, panel, layers, org, kit, at)
 *    A3  Invalid view → defaults to M1, warning emitted
 *    A4  Invalid window → defaults to T1, warning emitted
 *    A5  Invalid case ID (whitespace-only) → null
 *    A6  Control characters in case ID → stripped
 *    A7  Over-long case ID → truncated to MAX_ID_LENGTH
 *    A8  Invalid at timestamp → null, warning emitted
 *    A9  Unknown layer IDs → dropped, warning emitted
 *    A10 Cached result — same object reference on re-render
 *    A11 All params valid → empty warnings array
 *    A12 Lowercase view normalised to uppercase
 *    A13 Lowercase window normalised to uppercase
 *
 * B. useMapUrlHydration (store.hydrate() integration)
 *    B1  store.hydrate() called at mount with parsed URL state
 *    B2  store.hydrate() called with defaults when URL is empty
 *    B3  store.hydrate() NOT called again on re-render (idempotency)
 *    B4  Preserves store ephemeral state across hydration
 *    B5  Listener notified when store is hydrated with non-default state
 *    B6  Listener NOT notified when URL state matches store defaults
 *    B7  Invalid params → store hydrated with defaults
 *    B8  All eight URL params hydrated correctly
 *
 * C. useMapUrlHydratedStore
 *    C1  Returns a MapStateStore instance
 *    C2  Store contains URL state after mount
 *    C3  Store reference is stable across re-renders
 *    C4  All URL params reflected in store on first getState() call
 *    C5  Invalid params → store created with defaults
 *    C6  Store can be subscribed to immediately (no effect needed)
 *    C7  Two calls in same component yield the same stable store instance
 */

import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MAP_URL_STATE_DEFAULTS } from "@/types/map";
import { MAX_ID_LENGTH } from "@/lib/map-url-params";
import { MapStateStore } from "@/stores/map-state-store";

// ─── Mock next/navigation ─────────────────────────────────────────────────────
//
// `_searchParamsString` acts as the current URL query string.
// Tests update it before rendering to simulate a page loaded at a specific URL.

let _searchParamsString = "";

const mockSearchParams = {
  get(key: string): string | null {
    return new URLSearchParams(_searchParamsString).get(key);
  },
  toString() {
    return _searchParamsString;
  },
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/inventory",
  useSearchParams: () => mockSearchParams,
}));

// ─── Import hooks AFTER mock is set up ───────────────────────────────────────

import {
  useInitialMapUrlState,
  useMapUrlHydration,
  useMapUrlHydratedStore,
} from "@/hooks/use-map-url-hydration";

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _searchParamsString = "";
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// A. useInitialMapUrlState
// ═══════════════════════════════════════════════════════════════════════════════

describe("A — useInitialMapUrlState", () => {
  // ── A1: Empty URL → all defaults ────────────────────────────────────────────

  it("A1: empty URL yields all default param values", () => {
    _searchParamsString = "";
    const { result } = renderHook(() => useInitialMapUrlState());
    const { state } = result.current;

    expect(state.view).toBe("M1");
    expect(state.case).toBeNull();
    expect(state.window).toBe("T1");
    expect(state.panelOpen).toBe(false);
    expect(state.layers).toEqual(MAP_URL_STATE_DEFAULTS.layers);
    expect(state.org).toBeNull();
    expect(state.kit).toBeNull();
    expect(state.at).toBeNull();
  });

  // ── A2: Valid params parsed correctly ───────────────────────────────────────

  it("A2: valid params are parsed to their typed values", () => {
    const at = "2025-06-15T10:30:00.000Z";
    _searchParamsString = [
      "view=M4",
      "case=case-abc",
      "window=T3",
      "panel=1",
      "org=org-001",
      "kit=kit-999",
      `at=${encodeURIComponent(at)}`,
      "layers=satellite%2Cheat",
    ].join("&");

    const { result } = renderHook(() => useInitialMapUrlState());
    const { state } = result.current;

    expect(state.view).toBe("M4");
    expect(state.case).toBe("case-abc");
    expect(state.window).toBe("T3");
    expect(state.panelOpen).toBe(true);
    expect(state.org).toBe("org-001");
    expect(state.kit).toBe("kit-999");
    expect(state.at?.toISOString()).toBe(at);
    expect(state.layers).toEqual(["satellite", "heat"]);
  });

  // ── A3: Invalid view → defaults to M1, warning collected ───────────────────

  it("A3: invalid view falls back to M1 and collects a warning", () => {
    _searchParamsString = "view=BOGUS";

    const { result } = renderHook(() => useInitialMapUrlState());
    const { state, warnings } = result.current;

    expect(state.view).toBe("M1");
    expect(warnings.length).toBeGreaterThan(0);
    // The warning message must mention the "view" param and the invalid value
    expect(warnings.some((w) => w.includes('"view"'))).toBe(true);
  });

  // ── A4: Invalid window → defaults to T1, warning collected ─────────────────

  it("A4: invalid window falls back to T1 and collects a warning", () => {
    _searchParamsString = "window=Z9";

    const { result } = renderHook(() => useInitialMapUrlState());
    const { state, warnings } = result.current;

    expect(state.window).toBe("T1");
    expect(warnings.some((w) => w.includes('"window"'))).toBe(true);
  });

  // ── A5: Whitespace-only case ID → null ─────────────────────────────────────

  it("A5: whitespace-only case ID resolves to null", () => {
    // URL-encode spaces ('+' decodes to space in query strings)
    _searchParamsString = "case=+++";

    const { result } = renderHook(() => useInitialMapUrlState());
    expect(result.current.state.case).toBeNull();
  });

  // ── A6: Control characters in case ID → stripped ────────────────────────────

  it("A6: control characters in case ID are stripped before use", () => {
    // NUL byte (%00) should be stripped; remaining chars form a valid ID
    _searchParamsString = "case=case%00abc";

    const { result } = renderHook(() => useInitialMapUrlState());
    // parseId strips \x00 → "caseabc"
    expect(result.current.state.case).toBe("caseabc");
  });

  // ── A7: Over-long case ID → truncated ──────────────────────────────────────

  it("A7: case ID longer than MAX_ID_LENGTH is truncated", () => {
    const longId = "a".repeat(MAX_ID_LENGTH + 50);
    _searchParamsString = `case=${longId}`;

    const { result } = renderHook(() => useInitialMapUrlState());
    const caseId = result.current.state.case;

    expect(caseId).not.toBeNull();
    expect(caseId!.length).toBe(MAX_ID_LENGTH);
    expect(caseId).toBe("a".repeat(MAX_ID_LENGTH));
  });

  // ── A8: Invalid ISO-8601 timestamp → null, warning collected ───────────────

  it("A8: invalid 'at' timestamp resolves to null and collects a warning", () => {
    _searchParamsString = "at=not-a-date";

    const { result } = renderHook(() => useInitialMapUrlState());
    const { state, warnings } = result.current;

    expect(state.at).toBeNull();
    expect(warnings.some((w) => w.includes('"at"'))).toBe(true);
  });

  // ── A9: Unknown layer IDs → dropped, warning collected ─────────────────────

  it("A9: unknown layer IDs are dropped and a warning is collected", () => {
    _searchParamsString = "layers=satellite%2CUNKNOWN_LAYER%2Cheat";

    const { result } = renderHook(() => useInitialMapUrlState());
    const { state, warnings } = result.current;

    // "UNKNOWN_LAYER" is dropped; valid IDs are kept
    expect(state.layers).toEqual(["satellite", "heat"]);
    expect(warnings.some((w) => w.includes('"layers"'))).toBe(true);
  });

  // ── A10: Cached result — same object reference on re-render ────────────────

  it("A10: returns the same object reference on re-renders (result is cached)", () => {
    _searchParamsString = "view=M3&case=case-ref";

    const { result, rerender } = renderHook(() => useInitialMapUrlState());
    const firstResult = result.current;

    rerender();
    const secondResult = result.current;

    // Same reference — no recomputation
    expect(firstResult).toBe(secondResult);
    expect(firstResult.state).toBe(secondResult.state);
  });

  // ── A11: All params valid → empty warnings array ────────────────────────────

  it("A11: empty warnings array when all params are valid", () => {
    const at = "2025-08-01T00:00:00.000Z";
    _searchParamsString = [
      "view=M2",
      "case=valid-case",
      "window=T4",
      "panel=1",
      "org=org-x",
      "kit=kit-y",
      `at=${encodeURIComponent(at)}`,
      "layers=cases%2Cclusters",
    ].join("&");

    const { result } = renderHook(() => useInitialMapUrlState());
    expect(result.current.warnings).toHaveLength(0);
  });

  // ── A12: Lowercase view normalised to uppercase ─────────────────────────────

  it("A12: lowercase view param is normalised to uppercase", () => {
    _searchParamsString = "view=m3";
    const { result } = renderHook(() => useInitialMapUrlState());
    expect(result.current.state.view).toBe("M3");
  });

  // ── A13: Lowercase window normalised to uppercase ───────────────────────────

  it("A13: lowercase window param is normalised to uppercase", () => {
    _searchParamsString = "window=t5";
    const { result } = renderHook(() => useInitialMapUrlState());
    expect(result.current.state.window).toBe("T5");
  });

  // ── A14: All five MapView values parse correctly ─────────────────────────────

  it.each([
    ["M1", "M1"],
    ["M2", "M2"],
    ["M3", "M3"],
    ["M4", "M4"],
    ["M5", "M5"],
  ])("A14: view=%s parses to %s", (raw, expected) => {
    _searchParamsString = `view=${raw}`;
    const { result } = renderHook(() => useInitialMapUrlState());
    expect(result.current.state.view).toBe(expected);
  });

  // ── A15: All five CaseWindow values parse correctly ──────────────────────────

  it.each([
    ["T1", "T1"],
    ["T2", "T2"],
    ["T3", "T3"],
    ["T4", "T4"],
    ["T5", "T5"],
  ])("A15: window=%s parses to %s", (raw, expected) => {
    _searchParamsString = `window=${raw}`;
    const { result } = renderHook(() => useInitialMapUrlState());
    expect(result.current.state.window).toBe(expected);
  });

  // ── A16: panelOpen parses correctly ─────────────────────────────────────────

  it("A16: panel=1 parses to panelOpen=true", () => {
    _searchParamsString = "panel=1";
    const { result } = renderHook(() => useInitialMapUrlState());
    expect(result.current.state.panelOpen).toBe(true);
  });

  it("A16b: absent panel param → panelOpen=false", () => {
    _searchParamsString = "";
    const { result } = renderHook(() => useInitialMapUrlState());
    expect(result.current.state.panelOpen).toBe(false);
  });

  it("A16c: panel=0 → panelOpen=false", () => {
    _searchParamsString = "panel=0";
    const { result } = renderHook(() => useInitialMapUrlState());
    expect(result.current.state.panelOpen).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. useMapUrlHydration — store.hydrate() integration
// ═══════════════════════════════════════════════════════════════════════════════

describe("B — useMapUrlHydration", () => {
  function makeStore(initialParams?: Partial<typeof MAP_URL_STATE_DEFAULTS>) {
    return new MapStateStore(
      initialParams
        ? { ...MAP_URL_STATE_DEFAULTS, ...initialParams }
        : undefined
    );
  }

  // ── B1: store.hydrate() called at mount with parsed URL state ───────────────

  it("B1: store is hydrated at mount with the parsed URL state", async () => {
    _searchParamsString = "view=M3&case=case-b1&window=T2&panel=1";
    const store = makeStore();
    const hydrateSpy = vi.spyOn(store, "hydrate");

    renderHook(() => useMapUrlHydration(store));

    await waitFor(() => {
      expect(hydrateSpy).toHaveBeenCalledOnce();
    });

    const [hydratedState] = hydrateSpy.mock.calls[0] as [typeof MAP_URL_STATE_DEFAULTS];
    expect(hydratedState.view).toBe("M3");
    expect(hydratedState.case).toBe("case-b1");
    expect(hydratedState.window).toBe("T2");
    expect(hydratedState.panelOpen).toBe(true);
  });

  // ── B2: store.hydrate() called with defaults when URL is empty ──────────────

  it("B2: store is hydrated with all defaults when URL has no params", async () => {
    _searchParamsString = "";
    // Give the store a non-default initial state so hydrate() would be called
    // (store's own diff check: hydrate is a no-op when state is already equal)
    const store = makeStore({ view: "M3" });
    const hydrateSpy = vi.spyOn(store, "hydrate");

    renderHook(() => useMapUrlHydration(store));

    await waitFor(() => {
      expect(hydrateSpy).toHaveBeenCalledOnce();
    });

    const [hydratedState] = hydrateSpy.mock.calls[0] as [typeof MAP_URL_STATE_DEFAULTS];
    expect(hydratedState.view).toBe("M1"); // default
    expect(hydratedState.case).toBeNull(); // default
    expect(hydratedState.window).toBe("T1"); // default
  });

  // ── B3: store.hydrate() NOT called again on re-render ──────────────────────

  it("B3: store.hydrate() is called exactly once — not on subsequent re-renders", async () => {
    _searchParamsString = "view=M2";
    const store = makeStore();
    const hydrateSpy = vi.spyOn(store, "hydrate");

    const { rerender } = renderHook(() => useMapUrlHydration(store));

    await waitFor(() => {
      expect(hydrateSpy).toHaveBeenCalledOnce();
    });

    // Re-render the hook — hydrate should NOT be called again
    rerender();
    rerender();
    rerender();

    // Still only called once
    expect(hydrateSpy).toHaveBeenCalledOnce();
  });

  // ── B4: Preserves store ephemeral state across hydration ────────────────────

  it("B4: ephemeral state is preserved during URL hydration", async () => {
    _searchParamsString = "view=M4";
    const store = makeStore();
    store.setEphemeral({ isMapLoading: true, hoveredCaseId: "case-hover" });

    renderHook(() => useMapUrlHydration(store));

    await waitFor(() => {
      expect(store.getUrlState().view).toBe("M4");
    });

    // Ephemeral state must be untouched by hydration
    expect(store.getEphemeral().isMapLoading).toBe(true);
    expect(store.getEphemeral().hoveredCaseId).toBe("case-hover");
  });

  // ── B5: Listener notified when store is hydrated with non-default state ─────

  it("B5: store subscribers are notified when URL state differs from store defaults", async () => {
    _searchParamsString = "view=M5&org=org-notify";
    const store = makeStore(); // starts at defaults (view=M1, org=null)
    const listener = vi.fn();
    store.subscribe(listener);

    renderHook(() => useMapUrlHydration(store));

    await waitFor(() => {
      expect(listener).toHaveBeenCalled();
    });

    expect(listener.mock.calls[0][0].view).toBe("M5");
    expect(listener.mock.calls[0][0].org).toBe("org-notify");
  });

  // ── B6: Listener NOT notified when URL state matches store defaults ──────────

  it("B6: no subscriber notification when URL yields the same state as the store's current state", async () => {
    _searchParamsString = ""; // empty URL → all defaults
    const store = makeStore(); // also defaults
    const listener = vi.fn();
    store.subscribe(listener);

    renderHook(() => useMapUrlHydration(store));

    // The store's hydrate() diff check should suppress emission
    await new Promise((r) => setTimeout(r, 20));
    expect(listener).not.toHaveBeenCalled();
  });

  // ── B7: Invalid params → store hydrated with defaults ──────────────────────

  it("B7: store is hydrated with per-param defaults when URL params are invalid", async () => {
    _searchParamsString = "view=BOGUS&window=X7&at=not-a-date";
    // Start the store at a non-default view so hydrate is triggered
    const store = makeStore({ view: "M3" });
    const hydrateSpy = vi.spyOn(store, "hydrate");

    renderHook(() => useMapUrlHydration(store));

    await waitFor(() => {
      expect(hydrateSpy).toHaveBeenCalledOnce();
    });

    const [hydratedState] = hydrateSpy.mock.calls[0] as [typeof MAP_URL_STATE_DEFAULTS];
    // All invalid → defaults
    expect(hydratedState.view).toBe("M1");   // BOGUS → M1
    expect(hydratedState.window).toBe("T1"); // X7 → T1
    expect(hydratedState.at).toBeNull();      // not-a-date → null
  });

  // ── B8: All eight URL params hydrated correctly ──────────────────────────────

  it("B8: all eight URL params are correctly reflected in the store after hydration", async () => {
    const at = "2025-09-20T14:00:00.000Z";
    _searchParamsString = [
      "view=M5",
      "case=case-b8",
      "window=T5",
      "panel=1",
      "org=org-b8",
      "kit=kit-b8",
      `at=${encodeURIComponent(at)}`,
      "layers=satellite%2Cterrain%2Cheat",
    ].join("&");

    const store = makeStore();

    renderHook(() => useMapUrlHydration(store));

    await waitFor(() => {
      expect(store.getUrlState().view).toBe("M5");
    });

    const urlState = store.getUrlState();
    expect(urlState.view).toBe("M5");
    expect(urlState.case).toBe("case-b8");
    expect(urlState.window).toBe("T5");
    expect(urlState.panelOpen).toBe(true);
    expect(urlState.org).toBe("org-b8");
    expect(urlState.kit).toBe("kit-b8");
    expect(urlState.at?.toISOString()).toBe(at);
    expect(urlState.layers).toEqual(["satellite", "terrain", "heat"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. useMapUrlHydratedStore
// ═══════════════════════════════════════════════════════════════════════════════

describe("C — useMapUrlHydratedStore", () => {
  // ── C1: Returns a MapStateStore instance ────────────────────────────────────

  it("C1: returns a MapStateStore instance", () => {
    _searchParamsString = "";
    const { result } = renderHook(() => useMapUrlHydratedStore());
    expect(result.current).toBeInstanceOf(MapStateStore);
  });

  // ── C2: Store contains URL state after mount ─────────────────────────────────

  it("C2: store URL state reflects parsed URL params immediately on first getState()", () => {
    _searchParamsString = "view=M3&case=case-c2&window=T4&panel=1";
    const { result } = renderHook(() => useMapUrlHydratedStore());
    const store = result.current;

    const urlState = store.getUrlState();
    expect(urlState.view).toBe("M3");
    expect(urlState.case).toBe("case-c2");
    expect(urlState.window).toBe("T4");
    expect(urlState.panelOpen).toBe(true);
  });

  // ── C3: Store reference is stable across re-renders ─────────────────────────

  it("C3: the same store reference is returned on every re-render", () => {
    _searchParamsString = "view=M2";
    const { result, rerender } = renderHook(() => useMapUrlHydratedStore());
    const storeRef1 = result.current;

    rerender();
    rerender();

    expect(result.current).toBe(storeRef1);
  });

  // ── C4: All URL params reflected in store on first getState() call ───────────

  it("C4: all eight URL params are reflected in store.getUrlState() on the first call", () => {
    const at = "2025-10-01T08:00:00.000Z";
    _searchParamsString = [
      "view=M4",
      "case=case-c4",
      "window=T3",
      "panel=1",
      "org=org-c4",
      "kit=kit-c4",
      `at=${encodeURIComponent(at)}`,
      "layers=transit%2Ccases",
    ].join("&");

    const { result } = renderHook(() => useMapUrlHydratedStore());
    const store = result.current;
    const urlState = store.getUrlState();

    expect(urlState.view).toBe("M4");
    expect(urlState.case).toBe("case-c4");
    expect(urlState.window).toBe("T3");
    expect(urlState.panelOpen).toBe(true);
    expect(urlState.org).toBe("org-c4");
    expect(urlState.kit).toBe("kit-c4");
    expect(urlState.at?.toISOString()).toBe(at);
    expect(urlState.layers).toEqual(["transit", "cases"]);
  });

  // ── C5: Invalid params → store created with defaults ────────────────────────

  it("C5: invalid URL params produce a store initialized with per-param defaults", () => {
    _searchParamsString = "view=BOGUS&window=X1&at=invalid-date";
    const { result } = renderHook(() => useMapUrlHydratedStore());
    const store = result.current;
    const urlState = store.getUrlState();

    expect(urlState.view).toBe("M1");   // BOGUS → M1
    expect(urlState.window).toBe("T1"); // X1 → T1
    expect(urlState.at).toBeNull();      // invalid → null
  });

  // ── C6: Store can be subscribed to immediately (no effect needed) ────────────

  it("C6: store subscribers receive updates without waiting for any effect", () => {
    _searchParamsString = "view=M2";
    const { result } = renderHook(() => useMapUrlHydratedStore());
    const store = result.current;

    const listener = vi.fn();
    store.subscribe(listener);

    // Trigger a state change
    act(() => {
      store.setUrlState({ view: "M5" });
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].view).toBe("M5");
  });

  // ── C7: All five views initialized correctly ─────────────────────────────────

  it.each([
    ["view=M1", "M1"],
    ["view=M2", "M2"],
    ["view=M3", "M3"],
    ["view=M4", "M4"],
    ["view=M5", "M5"],
  ])("C7: URL '%s' initializes store with view=%s", (qs, expectedView) => {
    _searchParamsString = qs;
    const { result } = renderHook(() => useMapUrlHydratedStore());
    expect(result.current.getUrlState().view).toBe(expectedView);
  });

  // ── C8: Empty URL produces a store at defaults ───────────────────────────────

  it("C8: empty URL produces a store with all URL state at defaults", () => {
    _searchParamsString = "";
    const { result } = renderHook(() => useMapUrlHydratedStore());
    const urlState = result.current.getUrlState();

    expect(urlState).toEqual(MAP_URL_STATE_DEFAULTS);
  });

  // ── C9: Ephemeral state is always at defaults regardless of URL params ───────

  it("C9: ephemeral state is always initialized to defaults (URL params don't affect it)", () => {
    _searchParamsString = "view=M3&case=case-c9&panel=1";
    const { result } = renderHook(() => useMapUrlHydratedStore());
    const eph = result.current.getEphemeral();

    // All ephemeral fields at defaults
    expect(eph.isMapLoading).toBe(false);
    expect(eph.hoveredCaseId).toBeNull();
    expect(eph.isLayerPanelOpen).toBe(false);
    expect(eph.isFilterDrawerOpen).toBe(false);
    expect(eph.layerToggles.deployed).toBe(true);
    expect(eph.layerToggles.transit).toBe(true);
    expect(eph.layerToggles.flagged).toBe(true);
    expect(eph.layerToggles.hangar).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. Round-trip integration
// ═══════════════════════════════════════════════════════════════════════════════

describe("D — Round-trip: URL params survive parse → store initialization → read-back", () => {
  it("D1: all seven useMapParams-equivalent params survive the full URL → store pipeline", () => {
    const at = "2025-11-05T12:00:00.000Z";
    _searchParamsString = [
      "view=M3",
      "case=rt-case",
      "org=rt-org",
      "kit=rt-kit",
      `at=${encodeURIComponent(at)}`,
      "window=T2",
      "layers=satellite%2Ctransit",
    ].join("&");

    const { result } = renderHook(() => useMapUrlHydratedStore());
    const urlState = result.current.getUrlState();

    expect(urlState.view).toBe("M3");
    expect(urlState.case).toBe("rt-case");
    expect(urlState.org).toBe("rt-org");
    expect(urlState.kit).toBe("rt-kit");
    expect(urlState.at?.toISOString()).toBe(at);
    expect(urlState.window).toBe("T2");
    expect(urlState.layers).toEqual(["satellite", "transit"]);
  });

  it("D2: store initialized from URL can then accept setUrlState patches normally", () => {
    _searchParamsString = "view=M2&case=rt-case-d2";
    const { result } = renderHook(() => useMapUrlHydratedStore());
    const store = result.current;

    // URL state is M2 on load
    expect(store.getUrlState().view).toBe("M2");

    // After setUrlState, the store updates correctly
    act(() => {
      store.setUrlState({ view: "M4", window: "T5" });
    });

    expect(store.getUrlState().view).toBe("M4");
    expect(store.getUrlState().window).toBe("T5");
    // case is preserved from URL
    expect(store.getUrlState().case).toBe("rt-case-d2");
  });

  it("D3: simultaneous invalid + valid params — valid ones survive, invalid fall back to defaults", () => {
    _searchParamsString = "view=BOGUS&case=valid-case-d3&window=T4&at=not-a-date";
    const { result } = renderHook(() => useMapUrlHydratedStore());
    const urlState = result.current.getUrlState();

    expect(urlState.view).toBe("M1");            // BOGUS → default
    expect(urlState.case).toBe("valid-case-d3"); // valid → preserved
    expect(urlState.window).toBe("T4");          // valid → preserved
    expect(urlState.at).toBeNull();               // not-a-date → null
  });
});
