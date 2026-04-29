/**
 * @vitest-environment jsdom
 *
 * Tests for useMapStoreSyncToUrl (Sub-AC 12c):
 *   Reactive URL sync — store state changes are written to the browser address
 *   bar via window.history.replaceState() whenever URL state changes.
 *
 * Strategy
 * ────────
 * We use the real MapStateStore (no mocks) and spy on
 * window.history.replaceState to verify it is called with the correct URL.
 *
 * next/navigation is mocked (required by the "use client" import chain in the
 * hooks under test).
 *
 * Covered scenarios
 * ─────────────────
 * A. Basic URL sync
 *    A1  setUrlState({ view }) → replaceState called with view=M2 in URL
 *    A2  setUrlState({ case }) → replaceState called with case param in URL
 *    A3  setUrlState({ window }) → replaceState called with window param in URL
 *    A4  setUrlState({ panelOpen: true }) → replaceState called with panel=1
 *    A5  setUrlState({ layers }) → replaceState called with layers param
 *    A6  setUrlState({ org }) → replaceState called with org param
 *    A7  setUrlState({ kit }) → replaceState called with kit param
 *    A8  setUrlState({ at }) → replaceState called with at param (ISO-8601)
 *
 * B. Ephemeral changes skipped
 *    B1  setEphemeral() does NOT call replaceState
 *    B2  toggleLayerVisibility() does NOT call replaceState
 *    B3  setLayerToggles() does NOT call replaceState
 *
 * C. All 8 params written atomically
 *    C1  Bulk setUrlState with all 8 fields → single replaceState with all params
 *    C2  Default params omitted from URL (minimal URL)
 *
 * D. Pathname resolution
 *    D1  options.pathname is used when provided
 *    D2  window.location.pathname is used when no override provided
 *
 * E. Subscription lifecycle
 *    E1  replaceState NOT called before any store change (no spurious initial write)
 *    E2  replaceState called on first URL change after mount
 *    E3  Subscription is torn down on unmount (no further calls after unmount)
 *    E4  re-subscription when store instance changes (new store → still syncs)
 *
 * F. State round-trip fidelity
 *    F1  URL written by replaceState can be decoded back to the same MapUrlState
 *    F2  Multiple sequential changes each produce correct URLs
 *    F3  reset() writes default URL (no params = clean pathname)
 *
 * G. Edge cases
 *    G1  No params when all fields equal defaults → URL is just the pathname
 *    G2  null case/org/kit values → those params absent from URL
 *    G3  Date serialized as ISO-8601 in 'at' param
 *    G4  Long layer list survives encode → URL round-trip
 */

import React from "react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MAP_URL_STATE_DEFAULTS } from "@/types/map";
import type { LayerId } from "@/types/map";
import { MapStateStore } from "@/stores/map-state-store";
import { decodeMapUrlState } from "@/lib/map-url-params";
import { useMapStoreSyncToUrl } from "@/hooks/use-map-store-sync-to-url";

// ─── Mock next/navigation ─────────────────────────────────────────────────────
// Required because useMapStoreSyncToUrl (and its imports) are "use client"
// modules that may import from next/navigation transitively.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/inventory",
  useSearchParams: () => ({
    get: () => null,
    toString: () => "",
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStore(
  init?: Partial<typeof MAP_URL_STATE_DEFAULTS>
): MapStateStore {
  return new MapStateStore(
    init ? { ...MAP_URL_STATE_DEFAULTS, ...init } : undefined
  );
}

/**
 * Render the hook with the given store (and optional pathname).
 * Returns the replaceState spy and an unmount function.
 */
function renderSyncHook(
  store: MapStateStore,
  pathname?: string
): { replaceStateSpy: ReturnType<typeof vi.spyOn>; unmount: () => void } {
  const replaceStateSpy = vi.spyOn(window.history, "replaceState");

  const { unmount } = renderHook(() =>
    useMapStoreSyncToUrl(store, pathname !== undefined ? { pathname } : {})
  );

  return { replaceStateSpy, unmount };
}

/**
 * Extract the query string from a replaceState URL argument.
 * Works with both "/inventory?foo=bar" and just "foo=bar".
 */
function extractQs(url: unknown): string {
  if (typeof url !== "string") return "";
  const idx = url.indexOf("?");
  return idx >= 0 ? url.slice(idx + 1) : "";
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Reset window.location.pathname to a known value
  // jsdom supports history manipulation; push a clean state first
  window.history.replaceState(null, "", "/inventory");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// A. Basic URL sync — each URL param is written correctly
// ═══════════════════════════════════════════════════════════════════════════════

describe("A — Basic URL sync: each param is written to the address bar", () => {
  it("A1: setUrlState({ view: 'M2' }) → replaceState URL contains view=M2", () => {
    const store = makeStore();
    const { replaceStateSpy } = renderSyncHook(store, "/inventory");

    act(() => {
      store.setUrlState({ view: "M2" });
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const sp = new URLSearchParams(extractQs(url));
    expect(sp.get("view")).toBe("M2");
  });

  it("A2: setUrlState({ case }) → replaceState URL contains case param", () => {
    const store = makeStore();
    const { replaceStateSpy } = renderSyncHook(store, "/inventory");

    act(() => {
      store.setUrlState({ case: "case-abc123" });
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const sp = new URLSearchParams(extractQs(url));
    expect(sp.get("case")).toBe("case-abc123");
  });

  it("A3: setUrlState({ window: 'T3' }) → replaceState URL contains window=T3", () => {
    const store = makeStore();
    const { replaceStateSpy } = renderSyncHook(store, "/inventory");

    act(() => {
      store.setUrlState({ window: "T3" });
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const sp = new URLSearchParams(extractQs(url));
    expect(sp.get("window")).toBe("T3");
  });

  it("A4: setUrlState({ panelOpen: true }) → replaceState URL contains panel=1", () => {
    const store = makeStore();
    const { replaceStateSpy } = renderSyncHook(store, "/inventory");

    act(() => {
      store.setUrlState({ panelOpen: true });
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const sp = new URLSearchParams(extractQs(url));
    expect(sp.get("panel")).toBe("1");
  });

  it("A5: setUrlState({ layers }) → replaceState URL contains layers param", () => {
    const store = makeStore();
    const { replaceStateSpy } = renderSyncHook(store, "/inventory");
    const layers: LayerId[] = ["satellite", "heat", "transit"];

    act(() => {
      store.setUrlState({ layers });
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const sp = new URLSearchParams(extractQs(url));
    expect(sp.get("layers")).toBe("satellite,heat,transit");
  });

  it("A6: setUrlState({ org }) → replaceState URL contains org param", () => {
    const store = makeStore();
    const { replaceStateSpy } = renderSyncHook(store, "/inventory");

    act(() => {
      store.setUrlState({ org: "org-skyspecs-001" });
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const sp = new URLSearchParams(extractQs(url));
    expect(sp.get("org")).toBe("org-skyspecs-001");
  });

  it("A7: setUrlState({ kit }) → replaceState URL contains kit param", () => {
    const store = makeStore();
    const { replaceStateSpy } = renderSyncHook(store, "/inventory");

    act(() => {
      store.setUrlState({ kit: "kit-template-42" });
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const sp = new URLSearchParams(extractQs(url));
    expect(sp.get("kit")).toBe("kit-template-42");
  });

  it("A8: setUrlState({ at }) → replaceState URL contains at param as ISO-8601", () => {
    const store = makeStore();
    const { replaceStateSpy } = renderSyncHook(store, "/inventory");
    const timestamp = new Date("2025-08-15T10:00:00.000Z");

    act(() => {
      store.setUrlState({ at: timestamp });
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const sp = new URLSearchParams(extractQs(url));
    expect(sp.get("at")).toBe("2025-08-15T10:00:00.000Z");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. Ephemeral changes MUST NOT call replaceState
// ═══════════════════════════════════════════════════════════════════════════════

describe("B — Ephemeral changes: replaceState must NOT be called", () => {
  it("B1: setEphemeral() does NOT call replaceState", () => {
    // The spy is created inside renderSyncHook, AFTER the beforeEach
    // replaceState call, so it only captures calls made during this test.
    const store = makeStore();
    const { replaceStateSpy } = renderSyncHook(store, "/inventory");

    act(() => {
      store.setEphemeral({ isMapLoading: true, hoveredCaseId: "case-hover" });
    });

    // An ephemeral-only change must never call replaceState.
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("B2: toggleLayerVisibility() does NOT call replaceState", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear(); // clear mount-time call

    act(() => {
      store.toggleLayerVisibility("transit");
    });

    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("B3: setLayerToggles() does NOT call replaceState", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    act(() => {
      store.setLayerToggles({ deployed: false, transit: false });
    });

    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("B4: setEphemeral({ isFilterDrawerOpen: true }) does NOT call replaceState", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    act(() => {
      store.setEphemeral({ isFilterDrawerOpen: true });
    });

    expect(replaceStateSpy).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. All 8 params written atomically in a single replaceState call
// ═══════════════════════════════════════════════════════════════════════════════

describe("C — All 8 URL params written in a single replaceState call", () => {
  it("C1: bulk setUrlState with all 8 fields → single replaceState with all params", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    const timestamp = new Date("2025-09-01T12:30:00.000Z");
    const layers: LayerId[] = ["satellite", "heat"];

    act(() => {
      store.setUrlState({
        view: "M3",
        case: "case-full-sync",
        window: "T4",
        panelOpen: true,
        layers,
        org: "org-bulk",
        kit: "kit-bulk",
        at: timestamp,
      });
    });

    // Only one call to replaceState for all 8 fields atomically
    expect(replaceStateSpy).toHaveBeenCalledOnce();

    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const sp = new URLSearchParams(extractQs(url));

    expect(sp.get("view")).toBe("M3");
    expect(sp.get("case")).toBe("case-full-sync");
    expect(sp.get("window")).toBe("T4");
    expect(sp.get("panel")).toBe("1");
    expect(sp.get("layers")).toBe("satellite,heat");
    expect(sp.get("org")).toBe("org-bulk");
    expect(sp.get("kit")).toBe("kit-bulk");
    expect(sp.get("at")).toBe("2025-09-01T12:30:00.000Z");
  });

  it("C2: default params are omitted from the URL (minimal URL)", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    // Set only one non-default field; all others remain at defaults
    act(() => {
      store.setUrlState({ view: "M2" });
    });

    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const sp = new URLSearchParams(extractQs(url));

    // Only view should be present
    expect(sp.get("view")).toBe("M2");
    // Default fields must be absent
    expect(sp.get("case")).toBeNull();
    expect(sp.get("window")).toBeNull();
    expect(sp.get("panel")).toBeNull();
    expect(sp.get("org")).toBeNull();
    expect(sp.get("kit")).toBeNull();
    expect(sp.get("at")).toBeNull();
    // Default layers are also absent (encodeMapUrlState omits them)
    expect(sp.get("layers")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. Pathname resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe("D — Pathname resolution", () => {
  it("D1: options.pathname is used when provided", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() =>
      useMapStoreSyncToUrl(store, { pathname: "/custom/path" })
    );
    replaceStateSpy.mockClear();

    act(() => {
      store.setUrlState({ view: "M3" });
    });

    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    expect(url).toMatch(/^\/custom\/path/);
  });

  it("D2: window.location.pathname is used when no override is provided", () => {
    // Set a specific pathname in jsdom
    window.history.replaceState(null, "", "/inventory");

    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    replaceStateSpy.mockClear();

    renderHook(() => useMapStoreSyncToUrl(store));
    replaceStateSpy.mockClear();

    act(() => {
      store.setUrlState({ view: "M4" });
    });

    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    expect(url).toMatch(/^\/inventory/);
  });

  it("D3: URL starts with the resolved pathname followed by '?'", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() =>
      useMapStoreSyncToUrl(store, { pathname: "/inventory" })
    );
    replaceStateSpy.mockClear();

    act(() => {
      store.setUrlState({ case: "case-path-test", panelOpen: true });
    });

    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    expect(url.startsWith("/inventory?")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E. Subscription lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("E — Subscription lifecycle", () => {
  it("E1: replaceState NOT called before any store change (no spurious initial write)", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    replaceStateSpy.mockClear();

    // Just mount the hook — no store mutations
    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));

    // replaceState should NOT have been called simply by mounting
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("E2: replaceState called on first URL change after mount", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    act(() => {
      store.setUrlState({ view: "M5" });
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
  });

  it("E3: subscription is torn down on unmount — no further calls after unmount", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    const { unmount } = renderHook(() =>
      useMapStoreSyncToUrl(store, { pathname: "/inventory" })
    );
    replaceStateSpy.mockClear();

    // Verify it works before unmount
    act(() => {
      store.setUrlState({ view: "M2" });
    });
    expect(replaceStateSpy).toHaveBeenCalledOnce();

    // Unmount — subscription should be torn down
    unmount();
    replaceStateSpy.mockClear();

    // Mutations after unmount must NOT trigger replaceState
    act(() => {
      store.setUrlState({ view: "M3" });
    });
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("E4: re-subscribes when the store instance changes", () => {
    const storeA = makeStore();
    const storeB = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    // Start with storeA
    const { rerender } = renderHook(
      ({ store }) => useMapStoreSyncToUrl(store, { pathname: "/inventory" }),
      { initialProps: { store: storeA } }
    );
    replaceStateSpy.mockClear();

    // Change storeA — should sync
    act(() => {
      storeA.setUrlState({ view: "M2" });
    });
    expect(replaceStateSpy).toHaveBeenCalledOnce();
    replaceStateSpy.mockClear();

    // Switch to storeB
    rerender({ store: storeB });
    replaceStateSpy.mockClear();

    // storeA mutations should no longer trigger replaceState
    act(() => {
      storeA.setUrlState({ view: "M3" });
    });
    expect(replaceStateSpy).not.toHaveBeenCalled();

    // storeB mutations should trigger replaceState
    act(() => {
      storeB.setUrlState({ org: "org-new" });
    });
    expect(replaceStateSpy).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F. State round-trip fidelity
// ═══════════════════════════════════════════════════════════════════════════════

describe("F — Round-trip fidelity: URL written by replaceState can be decoded back", () => {
  it("F1: URL written by replaceState decodes back to the same MapUrlState", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    const at = new Date("2025-07-04T00:00:00.000Z");
    const layers: LayerId[] = ["satellite", "terrain", "heat"];

    act(() => {
      store.setUrlState({
        view: "M4",
        case: "rt-case",
        window: "T5",
        panelOpen: true,
        layers,
        org: "rt-org",
        kit: "rt-kit",
        at,
      });
    });

    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const qs = extractQs(url);
    const decoded = decodeMapUrlState(new URLSearchParams(qs));

    expect(decoded.view).toBe("M4");
    expect(decoded.case).toBe("rt-case");
    expect(decoded.window).toBe("T5");
    expect(decoded.panelOpen).toBe(true);
    expect(decoded.layers).toEqual(layers);
    expect(decoded.org).toBe("rt-org");
    expect(decoded.kit).toBe("rt-kit");
    expect(decoded.at?.toISOString()).toBe(at.toISOString());
  });

  it("F2: multiple sequential changes each produce the correct URL", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    // Change 1: set view
    act(() => { store.setUrlState({ view: "M2" }); });
    // Change 2: set case
    act(() => { store.setUrlState({ case: "case-seq" }); });
    // Change 3: switch view
    act(() => { store.setUrlState({ view: "M3" }); });

    expect(replaceStateSpy).toHaveBeenCalledTimes(3);

    // First call: view=M2 (all others default → absent)
    const [, , url1] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    expect(new URLSearchParams(extractQs(url1)).get("view")).toBe("M2");
    expect(new URLSearchParams(extractQs(url1)).get("case")).toBeNull();

    // Second call: view=M2 preserved, case added
    const [, , url2] = replaceStateSpy.mock.calls[1] as [unknown, unknown, string];
    expect(new URLSearchParams(extractQs(url2)).get("view")).toBe("M2");
    expect(new URLSearchParams(extractQs(url2)).get("case")).toBe("case-seq");

    // Third call: view=M3, case still present
    const [, , url3] = replaceStateSpy.mock.calls[2] as [unknown, unknown, string];
    expect(new URLSearchParams(extractQs(url3)).get("view")).toBe("M3");
    expect(new URLSearchParams(extractQs(url3)).get("case")).toBe("case-seq");
  });

  it("F3: reset() writes the default URL (no query params → pathname only)", () => {
    // Start with a non-default state
    const store = makeStore({ view: "M3", case: "some-case", window: "T4" });
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    act(() => {
      store.reset();
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    // All params are default → qs is empty → URL is just the pathname
    expect(url).toBe("/inventory");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// G. Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("G — Edge cases", () => {
  it("G1: when all fields equal defaults, URL is just the pathname (no '?')", () => {
    // Start with a non-default value so changing BACK to default triggers a write
    const store = makeStore({ view: "M2" });
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    act(() => {
      store.setUrlState({ view: "M1" }); // back to default
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    // No query string when all params are default
    expect(url).not.toContain("?");
    expect(url).toBe("/inventory");
  });

  it("G2: null case/org/kit values are absent from the URL", () => {
    // Start with non-null values
    const store = makeStore({
      case: "some-case",
      org: "some-org",
      kit: "some-kit",
    });
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    act(() => {
      store.setUrlState({ case: null, org: null, kit: null });
    });

    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const sp = new URLSearchParams(extractQs(url));
    expect(sp.get("case")).toBeNull();
    expect(sp.get("org")).toBeNull();
    expect(sp.get("kit")).toBeNull();
  });

  it("G3: Date is serialized as ISO-8601 string in 'at' param", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    const d = new Date("2025-12-25T00:00:00.000Z");
    act(() => {
      store.setUrlState({ at: d });
    });

    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const sp = new URLSearchParams(extractQs(url));
    expect(sp.get("at")).toBe("2025-12-25T00:00:00.000Z");
  });

  it("G4: a long layer list survives the encode → URL round-trip intact", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    const layers: LayerId[] = [
      "satellite",
      "terrain",
      "heat",
      "transit",
      "sites",
      "labels",
    ];

    act(() => {
      store.setUrlState({ layers });
    });

    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const decoded = decodeMapUrlState(new URLSearchParams(extractQs(url)));
    expect(decoded.layers).toEqual(layers);
  });

  it("G5: mixed URL + ephemeral changes in sequence only trigger replaceState for URL changes", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    act(() => {
      // URL change → should call replaceState
      store.setUrlState({ view: "M2" });
      // Ephemeral change → must NOT call replaceState
      store.setEphemeral({ hoveredCaseId: "case-hover" });
      // Ephemeral change → must NOT call replaceState
      store.toggleLayerVisibility("transit");
      // URL change → should call replaceState
      store.setUrlState({ view: "M3" });
    });

    // Only the two URL changes should have triggered replaceState
    expect(replaceStateSpy).toHaveBeenCalledTimes(2);
  });

  it("G6: replaceState is called with null as the first two arguments (state and title)", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    act(() => {
      store.setUrlState({ view: "M2" });
    });

    const [state, title] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    expect(state).toBeNull();
    expect(title).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// H. Hydrate + sync integration
// ═══════════════════════════════════════════════════════════════════════════════

describe("H — Hydrate + sync integration", () => {
  it("H1: hydrate() triggers replaceState when URL state changes", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    act(() => {
      store.hydrate({ ...MAP_URL_STATE_DEFAULTS, view: "M5", org: "org-hydrate" });
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const sp = new URLSearchParams(extractQs(url));
    expect(sp.get("view")).toBe("M5");
    expect(sp.get("org")).toBe("org-hydrate");
  });

  it("H2: hydrate() does NOT trigger replaceState when URL state is unchanged", () => {
    const store = makeStore();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    // Hydrating with the same defaults → no diff → no replaceState call
    act(() => {
      store.hydrate({ ...MAP_URL_STATE_DEFAULTS });
    });

    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("H3: full URL → store → URL round-trip produces identical URLs", () => {
    // Simulate the URL → store pipeline (hydration)
    const initialState = {
      ...MAP_URL_STATE_DEFAULTS,
      view: "M3" as const,
      case: "case-rt-h3",
      window: "T2" as const,
      panelOpen: true,
      org: "org-rt",
      layers: ["satellite", "terrain"] as LayerId[],
    };
    const store = new MapStateStore(initialState);

    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    renderHook(() => useMapStoreSyncToUrl(store, { pathname: "/inventory" }));
    replaceStateSpy.mockClear();

    // Simulate a user action that changes just one field
    act(() => {
      store.setUrlState({ view: "M4" });
    });

    const [, , url] = replaceStateSpy.mock.calls[0] as [unknown, unknown, string];
    const decoded = decodeMapUrlState(new URLSearchParams(extractQs(url)));

    // All fields should reflect the post-setUrlState store state
    expect(decoded.view).toBe("M4");
    expect(decoded.case).toBe("case-rt-h3");  // preserved
    expect(decoded.window).toBe("T2");          // preserved
    expect(decoded.panelOpen).toBe(true);        // preserved
    expect(decoded.org).toBe("org-rt");          // preserved
    expect(decoded.layers).toEqual(["satellite", "terrain"]); // preserved
  });
});
