/**
 * @vitest-environment jsdom
 *
 * Tests for useMapPopstateHydration (Sub-AC 12d):
 *   Wire a popstate listener so browser back/forward button presses
 *   re-hydrate the MapStateStore from the updated URL, enabling full
 *   deep-link and history support.
 *
 * Strategy
 * ────────
 * We use the real MapStateStore (no mocks) and dispatch synthetic
 * PopStateEvent objects to simulate browser back/forward navigation.
 * window.location.search is mutated via window.history.replaceState /
 * window.history.pushState before dispatching popstate so that the hook
 * reads the "new" URL exactly as the browser would after navigation.
 *
 * next/navigation is mocked (required by the "use client" import chain).
 *
 * Covered scenarios
 * ─────────────────
 * A. Core hydration on popstate
 *    A1  Popstate fires → store.hydrate() called with parsed URL state
 *    A2  All 8 URL params are parsed and applied atomically
 *    A3  Empty URL (no params) → all-defaults state applied
 *    A4  Partial URL (only some params) → others default
 *    A5  store.hydrate() NOT called before any popstate event (no spurious write)
 *
 * B. Back/forward simulation
 *    B1  Navigate forward (push), press Back → store reverts to previous state
 *    B2  Navigate forward twice, press Back twice → correct states at each step
 *    B3  Press Forward after Back → store reflects forward state
 *    B4  All five view modes (M1-M5) are correctly restored on back nav
 *    B5  activeCaseId and panelOpen are correctly restored on back nav
 *    B6  caseWindow (T1-T5) is correctly restored on back nav
 *
 * C. Duplicate / no-op popstate events
 *    C1  Popstate fires with same URL → no store change event emitted
 *    C2  Popstate fires multiple times with same URL → hydrate() still called
 *        but store change listeners fire only when state actually changes
 *
 * D. Subscription lifecycle
 *    D1  Listener is removed on unmount — no further hydrations after unmount
 *    D2  Re-subscribes when store instance changes (new store → still listens)
 *    D3  Old store does NOT receive hydrations after store instance changes
 *
 * E. Sanitization + fallbacks on popstate
 *    E1  Invalid view in URL → M1 default (no throw)
 *    E2  Invalid window in URL → T1 default (no throw)
 *    E3  Control characters in case ID → stripped / null
 *    E4  All params invalid → full defaults, no throw
 *
 * F. Integration with useMapStoreSyncToUrl
 *    F1  A full store→URL→popstate→store round-trip is lossless
 *    F2  Ephemeral state is preserved across a popstate hydration
 *
 * G. Edge cases
 *    G1  Hook is a no-op in non-browser environments (SSR guard)
 *    G2  layers param survives popstate round-trip unchanged
 *    G3  'at' timestamp is correctly parsed and applied via popstate
 */

import React from "react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MAP_URL_STATE_DEFAULTS } from "@/types/map";
import type { LayerId, MapView, CaseWindow } from "@/types/map";
import { MapStateStore } from "@/stores/map-state-store";
import type { MapStateChangeEvent } from "@/stores/map-state-store";
import { useMapPopstateHydration } from "@/hooks/use-map-popstate-hydration";

// ─── Mock next/navigation ─────────────────────────────────────────────────────
// Required because the "use client" import chain may reference next/navigation.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/inventory",
  useSearchParams: () => ({ get: () => null, toString: () => "" }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a URL query string from an object of string | null values. */
function buildQs(
  params: Record<string, string | null | undefined>
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) sp.set(key, value);
  }
  return sp.toString();
}

/**
 * Push a URL to browser history and dispatch a popstate event, simulating
 * what the browser does when the user presses Back or Forward.
 *
 * @param search  The query string to set, e.g. "view=M3&case=xyz&panel=1"
 */
function simulatePopstate(search: string): void {
  // Update window.location.search by pushing the URL to history.
  // jsdom supports window.history.pushState so this works in tests.
  const url = `/inventory${search ? `?${search}` : ""}`;
  window.history.pushState(null, "", url);

  // Dispatch a synthetic PopStateEvent — this is what the browser fires
  // when the user presses Back / Forward.
  window.dispatchEvent(new PopStateEvent("popstate", { bubbles: false }));
}

/** Create a fresh MapStateStore with optional non-default initial state. */
function makeStore(
  init?: Partial<typeof MAP_URL_STATE_DEFAULTS>
): MapStateStore {
  return new MapStateStore(
    init ? { ...MAP_URL_STATE_DEFAULTS, ...init } : undefined
  );
}

/**
 * Render the hook and return helpers for interacting with the store.
 */
function renderPopstateHook(store: MapStateStore) {
  return renderHook(() => useMapPopstateHydration(store));
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Start each test at a clean /inventory URL with no query params.
  window.history.replaceState(null, "", "/inventory");
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// A. Core hydration on popstate
// ═══════════════════════════════════════════════════════════════════════════════

describe("A — Core hydration on popstate", () => {
  it("A1: popstate fires → store is hydrated with new URL state", () => {
    const store = makeStore();
    renderPopstateHook(store);

    act(() => {
      simulatePopstate("view=M3");
    });

    expect(store.getUrlState().view).toBe("M3");
  });

  it("A2: all 8 URL params are parsed and applied atomically on popstate", () => {
    const store = makeStore();
    renderPopstateHook(store);

    const at = "2025-09-01T12:30:00.000Z";

    act(() => {
      simulatePopstate(
        buildQs({
          view: "M4",
          case: "case-popstate-a2",
          window: "T3",
          panel: "1",
          org: "org-a2",
          kit: "kit-a2",
          at,
          layers: "satellite,heat,transit",
        })
      );
    });

    const urlState = store.getUrlState();
    expect(urlState.view).toBe("M4");
    expect(urlState.case).toBe("case-popstate-a2");
    expect(urlState.window).toBe("T3");
    expect(urlState.panelOpen).toBe(true);
    expect(urlState.org).toBe("org-a2");
    expect(urlState.kit).toBe("kit-a2");
    expect(urlState.at?.toISOString()).toBe(at);
    expect(urlState.layers).toEqual(["satellite", "heat", "transit"]);
  });

  it("A3: popstate with empty URL applies all-defaults state", () => {
    // Start with non-default state
    const store = makeStore({
      view: "M3",
      case: "some-case",
      window: "T4",
      panelOpen: true,
    });
    renderPopstateHook(store);

    act(() => {
      simulatePopstate(""); // empty — all defaults
    });

    const urlState = store.getUrlState();
    expect(urlState.view).toBe("M1");
    expect(urlState.case).toBeNull();
    expect(urlState.window).toBe("T1");
    expect(urlState.panelOpen).toBe(false);
    expect(urlState.org).toBeNull();
    expect(urlState.kit).toBeNull();
    expect(urlState.at).toBeNull();
  });

  it("A4: popstate with partial URL — present params applied, missing ones default", () => {
    const store = makeStore({
      view: "M4",
      case: "old-case",
      window: "T5",
      org: "old-org",
    });
    renderPopstateHook(store);

    act(() => {
      simulatePopstate("view=M2&case=new-case&panel=1");
    });

    const urlState = store.getUrlState();
    expect(urlState.view).toBe("M2");
    expect(urlState.case).toBe("new-case");
    expect(urlState.panelOpen).toBe(true);
    // Missing params fall back to defaults — NOT to the previous store state
    expect(urlState.window).toBe("T1");
    expect(urlState.org).toBeNull();
  });

  it("A5: store.hydrate() is NOT called before any popstate event (no spurious hydration)", () => {
    const store = makeStore();
    const hydrateSpy = vi.spyOn(store, "hydrate");

    renderPopstateHook(store);

    // No popstate dispatched — hydrate should not have been called
    expect(hydrateSpy).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. Back/forward simulation
// ═══════════════════════════════════════════════════════════════════════════════

describe("B — Back/forward navigation simulation", () => {
  it("B1: navigate forward then press Back → store reverts to previous state", () => {
    const store = makeStore(); // starts at M1 (default)
    renderPopstateHook(store);

    // Store navigated to M3 (simulates useMapStoreSyncToUrl writing to URL)
    act(() => {
      store.setUrlState({ view: "M3" });
      // Now simulate what replaceState did to the history entry
      window.history.replaceState(null, "", "/inventory?view=M3");
    });

    expect(store.getUrlState().view).toBe("M3");

    // Simulate pressing Back → URL reverts to M1 (no params)
    act(() => {
      simulatePopstate("");
    });

    expect(store.getUrlState().view).toBe("M1");
  });

  it("B2: navigate forward twice then Back twice → correct states at each step", () => {
    // State A: M1, no case (default)
    const store = makeStore();
    renderPopstateHook(store);

    // Navigate to State B: M2, case selected
    act(() => {
      store.setUrlState({ view: "M2", case: "case-b", panelOpen: true });
    });

    // Navigate to State C: M3, different case
    act(() => {
      store.setUrlState({ view: "M3", case: "case-c", window: "T3" });
    });

    expect(store.getUrlState().view).toBe("M3");
    expect(store.getUrlState().case).toBe("case-c");

    // Press Back → go to State B
    act(() => {
      simulatePopstate("view=M2&case=case-b&panel=1");
    });

    expect(store.getUrlState().view).toBe("M2");
    expect(store.getUrlState().case).toBe("case-b");
    expect(store.getUrlState().panelOpen).toBe(true);
    expect(store.getUrlState().window).toBe("T1"); // T3 is gone

    // Press Back again → go to State A (defaults)
    act(() => {
      simulatePopstate("");
    });

    expect(store.getUrlState().view).toBe("M1");
    expect(store.getUrlState().case).toBeNull();
    expect(store.getUrlState().panelOpen).toBe(false);
  });

  it("B3: press Forward after Back → store reflects forward state", () => {
    const store = makeStore();
    renderPopstateHook(store);

    // Navigate to M3 state
    act(() => {
      store.setUrlState({ view: "M3", case: "forward-case", panelOpen: true });
    });

    // Press Back → M1
    act(() => {
      simulatePopstate("");
    });

    expect(store.getUrlState().view).toBe("M1");
    expect(store.getUrlState().case).toBeNull();

    // Press Forward → M3 with case
    act(() => {
      simulatePopstate("view=M3&case=forward-case&panel=1");
    });

    expect(store.getUrlState().view).toBe("M3");
    expect(store.getUrlState().case).toBe("forward-case");
    expect(store.getUrlState().panelOpen).toBe(true);
  });

  it.each<MapView>(["M1", "M2", "M3", "M4", "M5"])(
    "B4: view=%s is correctly restored via popstate",
    (view) => {
      const store = makeStore({ view: "M1" }); // start at different state
      renderPopstateHook(store);

      act(() => {
        simulatePopstate(view !== "M1" ? `view=${view}` : "");
      });

      expect(store.getUrlState().view).toBe(view);
    }
  );

  it("B5: activeCaseId and panelOpen are correctly restored on back navigation", () => {
    const store = makeStore();
    renderPopstateHook(store);

    // Navigate to case-selected state
    act(() => {
      simulatePopstate("case=case-b5&panel=1&window=T2");
    });

    expect(store.getUrlState().case).toBe("case-b5");
    expect(store.getUrlState().panelOpen).toBe(true);
    expect(store.getUrlState().window).toBe("T2");

    // Press Back → case deselected
    act(() => {
      simulatePopstate("");
    });

    expect(store.getUrlState().case).toBeNull();
    expect(store.getUrlState().panelOpen).toBe(false);
    expect(store.getUrlState().window).toBe("T1");
  });

  it.each<CaseWindow>(["T1", "T2", "T3", "T4", "T5"])(
    "B6: caseWindow=%s is correctly restored via popstate",
    (win) => {
      const store = makeStore();
      renderPopstateHook(store);

      act(() => {
        simulatePopstate(
          buildQs({
            case: "case-b6",
            panel: "1",
            window: win !== "T1" ? win : null, // T1 is the default, omit from URL
          })
        );
      });

      expect(store.getUrlState().window).toBe(win);
    }
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. Duplicate / no-op popstate events
// ═══════════════════════════════════════════════════════════════════════════════

describe("C — Duplicate / no-op popstate behaviour", () => {
  it("C1: popstate fires with same URL as current state → no change event emitted by store", () => {
    // Start with M2 state
    const store = makeStore({ view: "M2" });
    renderPopstateHook(store);

    const changeListener = vi.fn();
    store.onchange(changeListener);

    // Simulate popstate with the same M2 state
    act(() => {
      simulatePopstate("view=M2");
    });

    // store.hydrate() with identical state should be a no-op → no change event
    expect(changeListener).not.toHaveBeenCalled();
  });

  it("C2: popstate fires multiple times with different URLs → correct state at each step", () => {
    const store = makeStore();
    renderPopstateHook(store);

    act(() => {
      simulatePopstate("view=M2");
    });
    expect(store.getUrlState().view).toBe("M2");

    act(() => {
      simulatePopstate("view=M3&case=case-c2&panel=1");
    });
    expect(store.getUrlState().view).toBe("M3");
    expect(store.getUrlState().case).toBe("case-c2");

    act(() => {
      simulatePopstate("view=M1");
    });
    expect(store.getUrlState().view).toBe("M1");
    expect(store.getUrlState().case).toBeNull(); // cleared
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. Subscription lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("D — Subscription lifecycle", () => {
  it("D1: listener is removed on unmount — no further hydrations after unmount", () => {
    const store = makeStore();
    const { unmount } = renderPopstateHook(store);
    const hydrateSpy = vi.spyOn(store, "hydrate");

    // Works before unmount
    act(() => {
      simulatePopstate("view=M3");
    });
    expect(hydrateSpy).toHaveBeenCalledOnce();
    expect(store.getUrlState().view).toBe("M3");

    // Unmount — listener should be removed
    unmount();
    hydrateSpy.mockClear();

    // Popstate after unmount should NOT hydrate the store
    act(() => {
      simulatePopstate("view=M5");
    });
    expect(hydrateSpy).not.toHaveBeenCalled();
    // Store state should still be M3 (from before unmount)
    expect(store.getUrlState().view).toBe("M3");
  });

  it("D2: re-subscribes when store instance changes — new store receives hydrations", () => {
    const storeA = makeStore();
    const storeB = makeStore();

    const { rerender } = renderHook(
      ({ store }: { store: MapStateStore }) => useMapPopstateHydration(store),
      { initialProps: { store: storeA } }
    );

    const hydrateSpyA = vi.spyOn(storeA, "hydrate");
    const hydrateSpyB = vi.spyOn(storeB, "hydrate");

    // Confirm storeA receives events
    act(() => {
      simulatePopstate("view=M2");
    });
    expect(hydrateSpyA).toHaveBeenCalledOnce();
    expect(hydrateSpyB).not.toHaveBeenCalled();

    hydrateSpyA.mockClear();
    hydrateSpyB.mockClear();

    // Switch to storeB
    rerender({ store: storeB });

    act(() => {
      simulatePopstate("view=M4");
    });

    // storeA should NOT be hydrated after the switch
    expect(hydrateSpyA).not.toHaveBeenCalled();
    // storeB should be hydrated
    expect(hydrateSpyB).toHaveBeenCalledOnce();
  });

  it("D3: old store does NOT receive hydrations after store instance changes", () => {
    const storeA = makeStore();
    const storeB = makeStore();

    const { rerender } = renderHook(
      ({ store }: { store: MapStateStore }) => useMapPopstateHydration(store),
      { initialProps: { store: storeA } }
    );

    // Switch to storeB
    rerender({ store: storeB });

    act(() => {
      simulatePopstate("view=M5&org=org-d3");
    });

    // storeA must not have been touched
    expect(storeA.getUrlState().view).toBe("M1"); // unchanged (default)
    expect(storeA.getUrlState().org).toBeNull();  // unchanged

    // storeB should reflect the new URL
    expect(storeB.getUrlState().view).toBe("M5");
    expect(storeB.getUrlState().org).toBe("org-d3");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E. Sanitization + fallbacks on popstate
// ═══════════════════════════════════════════════════════════════════════════════

describe("E — Sanitization and fallbacks on popstate", () => {
  it("E1: invalid view in URL → M1 default, no throw", () => {
    const store = makeStore({ view: "M3" }); // start at M3
    renderPopstateHook(store);

    // M9 is not a valid view
    act(() => {
      simulatePopstate("view=M9");
    });

    expect(store.getUrlState().view).toBe("M1"); // fallback
  });

  it("E2: invalid window param in URL → T1 default, no throw", () => {
    const store = makeStore({ window: "T4" });
    renderPopstateHook(store);

    act(() => {
      simulatePopstate("case=case-e2&panel=1&window=Z9");
    });

    expect(store.getUrlState().window).toBe("T1"); // fallback
    expect(store.getUrlState().case).toBe("case-e2"); // other params still applied
  });

  it("E3: control characters in case ID are stripped on popstate", () => {
    const store = makeStore();
    renderPopstateHook(store);

    // URL-encoded NUL byte (%00) + valid chars → NUL stripped
    act(() => {
      simulatePopstate("case=case%00e3&panel=1");
    });

    // parseId strips \x00 → "casee3"
    expect(store.getUrlState().case).toBe("casee3");
    expect(store.getUrlState().panelOpen).toBe(true);
  });

  it("E4: all params invalid simultaneously → full defaults, no throw", () => {
    const store = makeStore({ view: "M3", case: "some-case" });
    renderPopstateHook(store);

    act(() => {
      simulatePopstate("view=BOGUS&case=%00%01&window=X7&panel=nope&layers=bad1");
    });

    expect(store.getUrlState().view).toBe("M1");
    expect(store.getUrlState().case).toBeNull();
    expect(store.getUrlState().window).toBe("T1");
    expect(store.getUrlState().panelOpen).toBe(false);
  });

  it("E5: lowercase view param is normalised on popstate", () => {
    const store = makeStore();
    renderPopstateHook(store);

    act(() => {
      simulatePopstate("view=m4"); // lowercase
    });

    expect(store.getUrlState().view).toBe("M4"); // normalised to uppercase
  });

  it("E6: lowercase window param is normalised on popstate", () => {
    const store = makeStore();
    renderPopstateHook(store);

    act(() => {
      simulatePopstate("case=case-e6&panel=1&window=t3"); // lowercase
    });

    expect(store.getUrlState().window).toBe("T3"); // normalised
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F. Integration with useMapStoreSyncToUrl pattern
// ═══════════════════════════════════════════════════════════════════════════════

describe("F — Integration: full store→URL→popstate→store round-trip", () => {
  it("F1: a full store→URL→popstate→store round-trip is lossless", () => {
    // This test simulates the complete round-trip:
    //   1. Store has state A
    //   2. useMapStoreSyncToUrl would call replaceState (simulated here)
    //   3. User presses Back → popstate fires → store re-hydrates to state A's
    //      previous URL

    const store = makeStore();
    renderPopstateHook(store);

    // Simulate the user navigating to M3 (as if useMapStoreSyncToUrl wrote this)
    act(() => {
      store.setUrlState({ view: "M3", case: "rt-case-f1", window: "T2", panelOpen: true });
      window.history.replaceState(null, "", "/inventory?view=M3&case=rt-case-f1&window=T2&panel=1");
    });

    // Simulate pressing Back → URL reverts to previous state (M1 defaults)
    act(() => {
      simulatePopstate("");
    });

    // Store should reflect the "previous" URL
    expect(store.getUrlState().view).toBe("M1");
    expect(store.getUrlState().case).toBeNull();
    expect(store.getUrlState().window).toBe("T1");
    expect(store.getUrlState().panelOpen).toBe(false);

    // Simulate pressing Forward → URL returns to M3 state
    act(() => {
      simulatePopstate("view=M3&case=rt-case-f1&window=T2&panel=1");
    });

    expect(store.getUrlState().view).toBe("M3");
    expect(store.getUrlState().case).toBe("rt-case-f1");
    expect(store.getUrlState().window).toBe("T2");
    expect(store.getUrlState().panelOpen).toBe(true);
  });

  it("F2: ephemeral state is preserved (not reset) across a popstate hydration", () => {
    // Ephemeral state (hover, panel open, layer toggles, etc.) must survive
    // back/forward navigation since it is not in the URL.
    const store = makeStore();
    renderPopstateHook(store);

    // Set some ephemeral state (e.g., user hovered a case pin)
    act(() => {
      store.setEphemeral({ hoveredCaseId: "hovered-f2", isMapLoading: true });
    });

    expect(store.getEphemeral().hoveredCaseId).toBe("hovered-f2");
    expect(store.getEphemeral().isMapLoading).toBe(true);

    // Simulate Back navigation
    act(() => {
      simulatePopstate("view=M2");
    });

    // URL state was updated
    expect(store.getUrlState().view).toBe("M2");

    // Ephemeral state must be preserved — hydrate() only changes URL fields
    expect(store.getEphemeral().hoveredCaseId).toBe("hovered-f2");
    expect(store.getEphemeral().isMapLoading).toBe(true);
  });

  it("F3: store change event is emitted with correct urlDiff on popstate hydration", () => {
    const store = makeStore({ view: "M2", org: "org-initial" });
    renderPopstateHook(store);

    const changeEvents: MapStateChangeEvent[] = [];
    store.onchange((e) => changeEvents.push(e));

    act(() => {
      simulatePopstate("view=M3&org=org-new&kit=kit-f3");
    });

    expect(changeEvents).toHaveLength(1);
    const event = changeEvents[0]!;

    // The diff must contain the changed fields
    expect(event.urlDiff).toMatchObject({ view: "M3", org: "org-new", kit: "kit-f3" });

    // Fields that did NOT change must be absent from the diff
    expect("case" in event.urlDiff).toBe(false);
    expect("window" in event.urlDiff).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// G. Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("G — Edge cases", () => {
  it("G1: layers param survives popstate round-trip unchanged", () => {
    const store = makeStore();
    renderPopstateHook(store);

    const layers: LayerId[] = ["satellite", "heat", "transit"];

    act(() => {
      simulatePopstate(`layers=${layers.join(",")}`);
    });

    expect(store.getUrlState().layers).toEqual(layers);
  });

  it("G2: ISO-8601 timestamp in 'at' param is correctly parsed and applied via popstate", () => {
    const store = makeStore();
    renderPopstateHook(store);

    const at = "2025-09-15T08:00:00.000Z";

    act(() => {
      simulatePopstate(`view=M5&at=${encodeURIComponent(at)}`);
    });

    expect(store.getUrlState().at?.toISOString()).toBe(at);
    expect(store.getUrlState().view).toBe("M5");
  });

  it("G3: popstate with null-value 'at' (absent) clears the at field", () => {
    // Start with a non-null at value
    const store = makeStore({ at: new Date("2025-01-01T00:00:00.000Z") });
    renderPopstateHook(store);

    // Popstate URL has no 'at' param → should be null
    act(() => {
      simulatePopstate("view=M3");
    });

    expect(store.getUrlState().at).toBeNull();
  });

  it("G4: multiple rapid popstate events each update the store correctly", () => {
    const store = makeStore();
    renderPopstateHook(store);

    act(() => {
      simulatePopstate("view=M2");
      simulatePopstate("view=M3");
      simulatePopstate("view=M4");
    });

    // Final state should match the last popstate
    expect(store.getUrlState().view).toBe("M4");
  });

  it("G5: popstate fires after store mutation — hydrate applies full URL, not a merge", () => {
    // This verifies that popstate hydration does a FULL replacement (not a merge).
    // If the store had org=org-old and the Back URL has no org, after popstate
    // org must be null (the URL default), not preserved from the store.
    const store = makeStore({ org: "org-old", view: "M3" });
    renderPopstateHook(store);

    // Popstate URL has view=M2 but no org param
    act(() => {
      simulatePopstate("view=M2");
    });

    expect(store.getUrlState().view).toBe("M2");
    expect(store.getUrlState().org).toBeNull(); // full replacement, not merge
  });

  it("G6: duplicate layers in URL are de-duplicated after popstate", () => {
    const store = makeStore();
    renderPopstateHook(store);

    // layers param with duplicate 'heat'
    act(() => {
      simulatePopstate("layers=satellite,heat,heat,transit");
    });

    // parseLayers deduplicates — 'heat' appears only once
    const layers = store.getUrlState().layers;
    expect(layers.filter((l) => l === "heat")).toHaveLength(1);
    expect(layers).toContain("satellite");
    expect(layers).toContain("transit");
  });
});
