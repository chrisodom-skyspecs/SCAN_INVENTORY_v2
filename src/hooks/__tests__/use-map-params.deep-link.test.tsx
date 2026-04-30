/**
 * @vitest-environment jsdom
 *
 * Integration tests: deep-link hydration and back/forward navigation restoration
 * for useMapParams / useMapUrlState.
 *
 * AC 110204 Sub-AC 4 — Validate that:
 *   1. Loading a URL with activeCaseId and windowState pre-populates the
 *      correct case detail (`activeCaseId`, `caseWindow`) and panel
 *      (`panelOpen`) on mount.
 *   2. Browser back/forward navigation correctly transitions state — i.e.,
 *      when the URL changes (simulating history traversal), the hook returns
 *      the new URL's state.
 *
 * Sub-AC 3 (AC 110103) — State change handlers call window.history.replaceState
 * (no navigation side-effects) instead of router.replace.
 *
 * Strategy
 * --------
 * We mock `next/navigation` so these tests run in jsdom without a real Next.js
 * server.  `_searchParamsString` acts as the initial URL query string read by
 * the hook at mount time (via useSearchParams).
 *
 * Write path verification uses spies on `window.history.replaceState` and
 * `window.history.pushState` -- confirming the hook calls these browser APIs
 * directly and never the Next.js router.
 *
 * Back/forward navigation is simulated by pushing a new URL via
 * `window.history.pushState` and then firing a `popstate` event -- this
 * mirrors real browser behaviour where the popstate event fires after history
 * traversal and the hook's listener re-reads `window.location.search`.
 */

import React from "react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LayerId } from "@/types/map";

// ---- Mock next/navigation ---------------------------------------------------

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

import { useMapParams } from "@/hooks/use-map-params";

// ---- Spies on window.history (Sub-AC 3) ------------------------------------

let replaceStateSpy: ReturnType<typeof vi.spyOn>;
let pushStateSpy: ReturnType<typeof vi.spyOn>;

function renderMapParams() {
  return renderHook(() => useMapParams());
}

/** Extract url (3rd arg) from a replaceState / pushState spy call. */
function getSpyUrl(spy: ReturnType<typeof vi.spyOn>, callIndex = 0): string {
  const call = spy.mock.calls[callIndex] as [unknown, unknown, string];
  return call[2];
}

beforeEach(() => {
  _searchParamsString = "";
  // Set clean URL before spy so this setup call is NOT recorded.
  window.history.replaceState(null, "", "/inventory");
  replaceStateSpy = vi.spyOn(window.history, "replaceState");
  pushStateSpy = vi.spyOn(window.history, "pushState");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// A. MOUNT HYDRATION
// ============================================================================

describe("A -- Mount hydration from URL", () => {
  it("A1: empty URL yields all defaults", () => {
    _searchParamsString = "";
    const { result } = renderMapParams();

    expect(result.current.activeCaseId).toBeNull();
    expect(result.current.panelOpen).toBe(false);
    expect(result.current.view).toBe("M1");
    expect(result.current.caseWindow).toBe("T1");
    expect(result.current.org).toBeNull();
    expect(result.current.kit).toBeNull();
    expect(result.current.at).toBeNull();
  });

  it("A2: full deep-link URL restores all fields on mount", () => {
    _searchParamsString = "view=M3&case=jx7abc000xyz&window=T2&panel=1";
    const { result } = renderMapParams();

    expect(result.current.view).toBe("M3");
    expect(result.current.activeCaseId).toBe("jx7abc000xyz");
    expect(result.current.caseWindow).toBe("T2");
    expect(result.current.panelOpen).toBe(true);
  });

  it("A3: partial deep-link (case + panel only) defaults window to T1", () => {
    _searchParamsString = "case=case-001&panel=1";
    const { result } = renderMapParams();

    expect(result.current.activeCaseId).toBe("case-001");
    expect(result.current.panelOpen).toBe(true);
    expect(result.current.caseWindow).toBe("T1");
    expect(result.current.view).toBe("M1");
  });

  it.each([
    ["M1", "M1"],
    ["M2", "M2"],
    ["M3", "M3"],
    ["M4", "M4"],
    ["M5", "M5"],
  ])("A4: view=%s restores correctly on mount", (raw, expected) => {
    _searchParamsString = `view=${raw}`;
    const { result } = renderMapParams();
    expect(result.current.view).toBe(expected);
  });

  it.each([
    ["T1", "T1"],
    ["T2", "T2"],
    ["T3", "T3"],
    ["T4", "T4"],
    ["T5", "T5"],
  ])("A5: window=%s restores as caseWindow on mount", (raw, expected) => {
    _searchParamsString = `case=any-case&panel=1&window=${raw}`;
    const { result } = renderMapParams();
    expect(result.current.caseWindow).toBe(expected);
  });

  it("A6: activeCaseId is null when case param is absent", () => {
    _searchParamsString = "view=M2&window=T3";
    const { result } = renderMapParams();
    expect(result.current.activeCaseId).toBeNull();
  });

  it("A7: panelOpen is false when panel param is absent even with case present", () => {
    _searchParamsString = "case=case-xyz&window=T2";
    const { result } = renderMapParams();

    expect(result.current.activeCaseId).toBe("case-xyz");
    expect(result.current.panelOpen).toBe(false);
  });

  it("A8: panelOpen is true only when panel=1 is present", () => {
    _searchParamsString = "case=case-abc&panel=1";
    const { result } = renderMapParams();
    expect(result.current.panelOpen).toBe(true);

    _searchParamsString = "case=case-abc&panel=0";
    const { result: result2 } = renderMapParams();
    expect(result2.current.panelOpen).toBe(false);
  });

  it("A9: all deep-link params restored together on mount", () => {
    const at = "2025-08-15T10:00:00.000Z";
    _searchParamsString = `view=M4&case=case-full&window=T5&panel=1&org=org-1&kit=kit-2&at=${encodeURIComponent(at)}`;
    const { result } = renderMapParams();

    expect(result.current.view).toBe("M4");
    expect(result.current.activeCaseId).toBe("case-full");
    expect(result.current.caseWindow).toBe("T5");
    expect(result.current.panelOpen).toBe(true);
    expect(result.current.org).toBe("org-1");
    expect(result.current.kit).toBe("kit-2");
    expect(result.current.at?.toISOString()).toBe(at);
  });
});

// ============================================================================
// B. setActiveCaseId -- HISTORY ENTRY CONTROL (Sub-AC 3)
// ============================================================================

describe("B -- setActiveCaseId history entry semantics", () => {
  it("B1: setActiveCaseId(id) calls history.replaceState by default (no nav side-effects)", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setActiveCaseId("case-123");
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it("B2: setActiveCaseId(id, { replace:false }) calls history.pushState", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setActiveCaseId("case-456", { replace: false });
    });

    expect(pushStateSpy).toHaveBeenCalledOnce();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("B3: setActiveCaseId(id) atomically encodes panelOpen=true in the URL", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setActiveCaseId("case-789");
    });

    const url = getSpyUrl(replaceStateSpy);
    expect(url).toContain("case=case-789");
    expect(url).toContain("panel=1");
  });

  it("B4: setActiveCaseId(null) clears case and panelOpen from the URL", () => {
    _searchParamsString = "case=case-old&panel=1";
    const { result } = renderMapParams();

    act(() => {
      result.current.setActiveCaseId(null);
    });

    const url = getSpyUrl(replaceStateSpy);
    expect(url).not.toContain("case=");
    expect(url).not.toContain("panel=");
  });

  it("B5: resulting URL from setActiveCaseId contains both case and panel=1", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setActiveCaseId("jx7fieldcase");
    });

    const url = getSpyUrl(replaceStateSpy);
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("case")).toBe("jx7fieldcase");
    expect(qs.get("panel")).toBe("1");
  });
});

// ============================================================================
// C. setCaseWindow -- HISTORY ENTRY CONTROL
// ============================================================================

describe("C -- setCaseWindow history entry semantics", () => {
  it("C1: setCaseWindow('T3') calls history.replaceState by default", () => {
    _searchParamsString = "case=case-x&panel=1";
    const { result } = renderMapParams();

    act(() => {
      result.current.setCaseWindow("T3");
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it("C2: setCaseWindow('T4', { replace:false }) calls history.pushState", () => {
    _searchParamsString = "case=case-x&panel=1";
    const { result } = renderMapParams();

    act(() => {
      result.current.setCaseWindow("T4", { replace: false });
    });

    expect(pushStateSpy).toHaveBeenCalledOnce();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("C3: resulting URL contains window=T4 after setCaseWindow('T4')", () => {
    _searchParamsString = "case=case-x&panel=1";
    const { result } = renderMapParams();

    act(() => {
      result.current.setCaseWindow("T4");
    });

    const url = getSpyUrl(replaceStateSpy);
    expect(url).toContain("window=T4");
  });

  it("C4: setCaseWindow('T1') omits window param (default not encoded)", () => {
    _searchParamsString = "case=case-x&panel=1&window=T3";
    const { result } = renderMapParams();

    act(() => {
      result.current.setCaseWindow("T1");
    });

    const url = getSpyUrl(replaceStateSpy);
    expect(url).not.toContain("window=");
  });
});

// ============================================================================
// C2. setAt -- HISTORY ENTRY CONTROL (AC 110203 Sub-AC 3)
//
// Verifies that the `at` timestamp control is wired to the URL state hook so
// that timestamp changes update URL params via shallow routing
// (window.history.replaceState / pushState) WITHOUT triggering a Next.js
// navigation event or a full page reload.
//
// The wiring chain under test:
//   <input type="datetime-local"> onChange
//     → handleAtChange(e) in M2/M3/M4/M5 components
//     → setAt(date) from useMapParams()
//     → setMapUrlState({ at }, options) in useMapParams
//     → window.history.replaceState (replace:true default)
//     → window.history.pushState   (replace:false explicit opt-in)
//
// This block proves the URL writes happen via the History API (no router
// navigation), satisfying the "shallow routing without full reloads"
// requirement of AC 110203 Sub-AC 3.
// ============================================================================

describe("C2 -- setAt history entry semantics (AC 110203 Sub-AC 3)", () => {
  it("C2.1: setAt(date) calls history.replaceState by default (shallow routing)", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setAt(new Date("2025-08-15T10:00:00Z"));
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it("C2.2: setAt(date, { replace:false }) calls history.pushState (new history entry)", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setAt(new Date("2025-08-15T10:00:00Z"), { replace: false });
    });

    expect(pushStateSpy).toHaveBeenCalledOnce();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("C2.3: setAt(date) encodes at=<ISO 8601> in the URL", () => {
    const at = new Date("2025-08-15T10:00:00.000Z");
    const { result } = renderMapParams();

    act(() => {
      result.current.setAt(at);
    });

    const url = getSpyUrl(replaceStateSpy);
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("at")).toBe(at.toISOString());
  });

  it("C2.4: setAt(null) clears the at param from the URL (return to live)", () => {
    _searchParamsString = `at=${encodeURIComponent("2025-08-15T10:00:00.000Z")}`;
    const { result } = renderMapParams();

    act(() => {
      result.current.setAt(null);
    });

    const url = getSpyUrl(replaceStateSpy);
    expect(url).not.toContain("at=");
  });

  it("C2.5: setAt updates React state so consumers re-render with the new value", () => {
    const { result } = renderMapParams();
    expect(result.current.at).toBeNull();

    const target = new Date("2025-09-01T08:30:00.000Z");
    act(() => {
      result.current.setAt(target);
    });

    expect(result.current.at).not.toBeNull();
    expect(result.current.at?.toISOString()).toBe(target.toISOString());
  });

  it("C2.6: setAt preserves other URL params (org/kit/view/case) unchanged", () => {
    _searchParamsString = "view=M3&org=org-1&kit=kit-2&case=case-x&panel=1";
    const { result } = renderMapParams();

    act(() => {
      result.current.setAt(new Date("2025-08-15T10:00:00.000Z"));
    });

    const url = getSpyUrl(replaceStateSpy);
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("view")).toBe("M3");
    expect(qs.get("org")).toBe("org-1");
    expect(qs.get("kit")).toBe("kit-2");
    expect(qs.get("case")).toBe("case-x");
    expect(qs.get("panel")).toBe("1");
    expect(qs.get("at")).toBe("2025-08-15T10:00:00.000Z");
  });

  it("C2.7: rapid setAt calls (e.g., scrubber drag) all use replaceState — no history bloat", () => {
    const { result } = renderMapParams();

    const stamps = [
      new Date("2025-08-15T10:00:00.000Z"),
      new Date("2025-08-15T10:05:00.000Z"),
      new Date("2025-08-15T10:10:00.000Z"),
      new Date("2025-08-15T10:15:00.000Z"),
    ];

    act(() => {
      stamps.forEach((d) => result.current.setAt(d));
    });

    expect(replaceStateSpy).toHaveBeenCalledTimes(stamps.length);
    expect(pushStateSpy).not.toHaveBeenCalled();
    // Final URL reflects the last setAt value
    const finalUrl = getSpyUrl(replaceStateSpy, stamps.length - 1);
    expect(finalUrl).toContain(`at=${encodeURIComponent(stamps[stamps.length - 1]!.toISOString())}`);
  });

  it("C2.8: setAt -> simulate Back -> at returns to previous value (shallow nav round-trip)", () => {
    _searchParamsString = "";
    const { result } = renderMapParams();
    expect(result.current.at).toBeNull();

    const target = new Date("2025-08-15T10:00:00.000Z");
    act(() => {
      result.current.setAt(target, { replace: false });
    });
    expect(result.current.at?.toISOString()).toBe(target.toISOString());

    act(() => {
      window.history.pushState(null, "", "/inventory");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.at).toBeNull();
  });
});

// ============================================================================
// D. BACK-NAVIGATION SIMULATION
//
// Simulates browser back/forward by:
//   1. Updating window.location via history.pushState(null, "", newUrl)
//   2. Dispatching a "popstate" event to trigger the hook's listener
//
// The hook's listener re-reads window.location.search and updates React state.
// ============================================================================

describe("D -- Back/forward navigation simulation", () => {
  it("D1: navigate M1->M3, simulate back -> state shows M1", () => {
    _searchParamsString = "";
    const { result } = renderMapParams();
    expect(result.current.view).toBe("M1");

    act(() => {
      result.current.setView("M3", { replace: false });
    });
    expect(result.current.view).toBe("M3");

    act(() => {
      window.history.pushState(null, "", "/inventory");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.view).toBe("M1");
  });

  it("D2: open case panel, simulate back -> panel closed and case cleared", () => {
    _searchParamsString = "";
    const { result } = renderMapParams();
    expect(result.current.activeCaseId).toBeNull();
    expect(result.current.panelOpen).toBe(false);

    act(() => {
      result.current.setActiveCaseId("case-detail", { replace: false });
    });
    expect(result.current.activeCaseId).toBe("case-detail");
    expect(result.current.panelOpen).toBe(true);

    act(() => {
      window.history.pushState(null, "", "/inventory");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.activeCaseId).toBeNull();
    expect(result.current.panelOpen).toBe(false);
    expect(result.current.caseWindow).toBe("T1");
  });

  it("D3: switch caseWindow T1->T4, simulate back -> window returns to T1", () => {
    _searchParamsString = "case=case-abc&panel=1";
    const { result } = renderMapParams();
    expect(result.current.caseWindow).toBe("T1");

    act(() => {
      result.current.setCaseWindow("T4", { replace: false });
    });
    expect(result.current.caseWindow).toBe("T4");

    act(() => {
      window.history.pushState(null, "", "/inventory?case=case-abc&panel=1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.caseWindow).toBe("T1");
  });

  it("D4: full state change, simulate back and forward -> state follows URL", () => {
    _searchParamsString = "";
    const { result } = renderMapParams();

    act(() => {
      result.current.setParams(
        { view: "M3", activeCaseId: "case-b", caseWindow: "T3" },
        { replace: false }
      );
    });
    expect(result.current.view).toBe("M3");
    expect(result.current.activeCaseId).toBe("case-b");
    expect(result.current.caseWindow).toBe("T3");
    expect(result.current.panelOpen).toBe(true);

    act(() => {
      result.current.setParams(
        { view: "M4", activeCaseId: "case-c", caseWindow: "T5" },
        { replace: false }
      );
    });
    expect(result.current.view).toBe("M4");
    expect(result.current.activeCaseId).toBe("case-c");
    expect(result.current.caseWindow).toBe("T5");

    // Simulate Back -> State B
    act(() => {
      window.history.pushState(null, "", "/inventory?view=M3&case=case-b&window=T3&panel=1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.view).toBe("M3");
    expect(result.current.activeCaseId).toBe("case-b");
    expect(result.current.caseWindow).toBe("T3");
    expect(result.current.panelOpen).toBe(true);

    // Simulate Forward -> State C
    act(() => {
      window.history.pushState(null, "", "/inventory?view=M4&case=case-c&window=T5&panel=1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.view).toBe("M4");
    expect(result.current.activeCaseId).toBe("case-c");
    expect(result.current.caseWindow).toBe("T5");
    expect(result.current.panelOpen).toBe(true);
  });

  it("D5: panel can be toggled (close/reopen) without losing case selection", () => {
    _searchParamsString = "case=case-toggle&panel=1&window=T2";
    const { result } = renderMapParams();
    expect(result.current.activeCaseId).toBe("case-toggle");
    expect(result.current.panelOpen).toBe(true);

    act(() => {
      result.current.setPanelOpen(false);
    });
    expect(result.current.activeCaseId).toBe("case-toggle");
    expect(result.current.panelOpen).toBe(false);

    act(() => {
      window.history.pushState(null, "", "/inventory?case=case-toggle&panel=1&window=T2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.activeCaseId).toBe("case-toggle");
    expect(result.current.panelOpen).toBe(true);
  });

  it("D6: view changes are independent of case selection state across back/forward", () => {
    _searchParamsString = "view=M2";
    const { result } = renderMapParams();
    expect(result.current.view).toBe("M2");
    expect(result.current.activeCaseId).toBeNull();

    act(() => {
      result.current.setParams({ view: "M3", activeCaseId: "case-nav" }, { replace: false });
    });
    expect(result.current.view).toBe("M3");
    expect(result.current.activeCaseId).toBe("case-nav");

    act(() => {
      window.history.pushState(null, "", "/inventory?view=M2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.view).toBe("M2");
    expect(result.current.activeCaseId).toBeNull();
    expect(result.current.panelOpen).toBe(false);
  });
});

// ============================================================================
// E. setParams (bulk setter) -- PUSH / REPLACE SEMANTICS
// ============================================================================

describe("E -- setParams bulk setter", () => {
  it("E1: setParams with replace:false calls history.pushState", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setParams({ view: "M3", activeCaseId: "case-bulk" }, { replace: false });
    });

    expect(pushStateSpy).toHaveBeenCalledOnce();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("E2: setParams({ activeCaseId, caseWindow }) encodes correct URL keys", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setParams({ activeCaseId: "case-set", caseWindow: "T3" });
    });

    const url = getSpyUrl(replaceStateSpy);
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("case")).toBe("case-set");
    expect(qs.get("window")).toBe("T3");
    expect(qs.get("panel")).toBe("1");
  });

  it("E3: setParams({ activeCaseId, panelOpen:false }) encodes panelOpen override", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setParams({ activeCaseId: "case-closed", panelOpen: false });
    });

    const url = getSpyUrl(replaceStateSpy);
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("case")).toBe("case-closed");
    expect(qs.get("panel")).toBeNull();
  });

  it("E4: setParams preserves existing state not included in the patch", () => {
    _searchParamsString = "view=M3&case=existing&panel=1&window=T2";
    const { result } = renderMapParams();

    act(() => {
      result.current.setParams({ view: "M4" });
    });

    const url = getSpyUrl(replaceStateSpy);
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("view")).toBe("M4");
    expect(qs.get("case")).toBe("existing");
    expect(qs.get("window")).toBe("T2");
    expect(qs.get("panel")).toBe("1");
  });
});

// ============================================================================
// F. EDGE CASES -- Sanitization and Fallbacks
// ============================================================================

describe("F -- Edge cases: sanitization and fallbacks on mount", () => {
  it("F1: control characters in case ID are stripped", () => {
    _searchParamsString = "case=case%00abc&panel=1";
    const { result } = renderMapParams();
    expect(result.current.activeCaseId).toBe("caseabc");
  });

  it("F2: invalid window param defaults to T1 -- no throw", () => {
    _searchParamsString = "case=case-ok&panel=1&window=Z9";
    const { result } = renderMapParams();
    expect(result.current.caseWindow).toBe("T1");
    expect(result.current.activeCaseId).toBe("case-ok");
    expect(result.current.panelOpen).toBe(true);
  });

  it("F3: stale bookmark with M9 view falls back to M1 -- no throw", () => {
    _searchParamsString = "view=M9&case=case-stale&window=T2&panel=1";
    const { result } = renderMapParams();
    expect(result.current.view).toBe("M1");
    expect(result.current.activeCaseId).toBe("case-stale");
    expect(result.current.caseWindow).toBe("T2");
    expect(result.current.panelOpen).toBe(true);
  });

  it("F4: whitespace-only case ID resolves to null", () => {
    _searchParamsString = "case=+++&panel=1";
    const { result } = renderMapParams();
    expect(result.current.activeCaseId).toBeNull();
  });

  it("F5: all params invalid simultaneously -- full defaults, no throw", () => {
    _searchParamsString = "view=BOGUS&case=%00%01&window=X7&panel=nope&layers=bad1";
    const { result } = renderMapParams();

    expect(result.current.view).toBe("M1");
    expect(result.current.activeCaseId).toBeNull();
    expect(result.current.caseWindow).toBe("T1");
    expect(result.current.panelOpen).toBe(false);
  });

  it("F6: lowercase view param is normalised on mount", () => {
    _searchParamsString = "view=m4";
    const { result } = renderMapParams();
    expect(result.current.view).toBe("M4");
  });

  it("F7: lowercase window param is normalised on mount", () => {
    _searchParamsString = "case=case-x&panel=1&window=t3";
    const { result } = renderMapParams();
    expect(result.current.caseWindow).toBe("T3");
  });
});

// ============================================================================
// G. setPanelOpen -- INDEPENDENT PANEL CONTROL
// ============================================================================

describe("G -- setPanelOpen -- independent panel control", () => {
  it("G1: setPanelOpen(true) encodes panel=1 in URL", () => {
    _searchParamsString = "case=case-gx";
    const { result } = renderMapParams();

    act(() => {
      result.current.setPanelOpen(true);
    });

    const url = getSpyUrl(replaceStateSpy);
    expect(url).toContain("panel=1");
  });

  it("G2: setPanelOpen(false) removes panel from URL", () => {
    _searchParamsString = "case=case-gx&panel=1";
    const { result } = renderMapParams();

    act(() => {
      result.current.setPanelOpen(false);
    });

    const url = getSpyUrl(replaceStateSpy);
    expect(url).not.toContain("panel=");
  });

  it("G3: setPanelOpen does not affect case selection", () => {
    _searchParamsString = "case=case-gx&panel=1&window=T3";
    const { result } = renderMapParams();

    act(() => {
      result.current.setPanelOpen(false);
    });

    const url = getSpyUrl(replaceStateSpy);
    expect(url).toContain("case=case-gx");
    expect(url).toContain("window=T3");
    expect(url).not.toContain("panel=");
  });

  it("G4: simulate setPanelOpen(false) via back -> panel reopens", () => {
    _searchParamsString = "case=case-gy&panel=1&window=T2";
    const { result } = renderMapParams();
    expect(result.current.panelOpen).toBe(true);

    act(() => {
      result.current.setPanelOpen(false);
    });
    expect(result.current.panelOpen).toBe(false);
    expect(result.current.activeCaseId).toBe("case-gy");

    act(() => {
      window.history.pushState(null, "", "/inventory?case=case-gy&panel=1&window=T2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.panelOpen).toBe(true);
    expect(result.current.activeCaseId).toBe("case-gy");
  });
});

// ============================================================================
// H. ROUND-TRIP ENCODE -> HYDRATION FIDELITY
// ============================================================================

describe("H -- Round-trip fidelity: encode then hydrate", () => {
  it("H1: every param survives encode->URL->hydrate unchanged", () => {
    const at = "2025-07-04T00:00:00.000Z";
    _searchParamsString = [
      "view=M4",
      "case=round-trip-case",
      "window=T3",
      "panel=1",
      "org=org-rt",
      "kit=kit-rt",
      `at=${encodeURIComponent(at)}`,
      "layers=heat%2Csatellite",
    ].join("&");

    const { result } = renderMapParams();

    expect(result.current.view).toBe("M4");
    expect(result.current.activeCaseId).toBe("round-trip-case");
    expect(result.current.caseWindow).toBe("T3");
    expect(result.current.panelOpen).toBe(true);
    expect(result.current.org).toBe("org-rt");
    expect(result.current.kit).toBe("kit-rt");
    expect(result.current.at?.toISOString()).toBe(at);
  });

  it("H2: deep-link URL produced by setActiveCaseId can be re-hydrated correctly", () => {
    _searchParamsString = "";
    const { result } = renderMapParams();

    act(() => {
      result.current.setActiveCaseId("hydration-test-case");
    });

    const writtenUrl = getSpyUrl(replaceStateSpy);
    const writtenQs = writtenUrl.includes("?") ? writtenUrl.split("?")[1] : "";
    _searchParamsString = writtenQs;

    const { result: result2 } = renderMapParams();

    expect(result2.current.activeCaseId).toBe("hydration-test-case");
    expect(result2.current.panelOpen).toBe(true);
    expect(result2.current.view).toBe("M1");
  });

  it("H3: setCaseWindow produces a URL that hydrates caseWindow correctly", () => {
    _searchParamsString = "case=case-window&panel=1";
    const { result } = renderMapParams();

    act(() => {
      result.current.setCaseWindow("T5");
    });

    const writtenUrl = getSpyUrl(replaceStateSpy);
    const writtenQs = writtenUrl.includes("?") ? writtenUrl.split("?")[1] : "";
    _searchParamsString = writtenQs;

    const { result: result2 } = renderMapParams();

    expect(result2.current.caseWindow).toBe("T5");
    expect(result2.current.activeCaseId).toBe("case-window");
    expect(result2.current.panelOpen).toBe(true);
  });
});

// ============================================================================
// I. ROUND-TRIP INTEGRATION -- all seven params including layers
// ============================================================================

describe("I -- Round-trip integration: all seven params including layers", () => {
  const RT_AT_ISO = "2025-09-01T12:30:00.000Z";
  const RT_LAYERS: LayerId[] = ["satellite", "heat", "transit"];

  function extractQs(url: string): string {
    const idx = url.indexOf("?");
    return idx >= 0 ? url.slice(idx + 1) : "";
  }

  it("I1: all seven params parsed losslessly from a URL query string on mount", () => {
    _searchParamsString = [
      "view=M5",
      "case=rt-case-i1",
      "org=rt-org-i1",
      "kit=rt-kit-i1",
      `at=${encodeURIComponent(RT_AT_ISO)}`,
      "window=T4",
      `layers=${RT_LAYERS.join(",")}`,
    ].join("&");

    const { result } = renderMapParams();

    expect(result.current.view).toBe("M5");
    expect(result.current.activeCaseId).toBe("rt-case-i1");
    expect(result.current.org).toBe("rt-org-i1");
    expect(result.current.kit).toBe("rt-kit-i1");
    expect(result.current.at?.toISOString()).toBe(RT_AT_ISO);
    expect(result.current.caseWindow).toBe("T4");
    expect(result.current.layers).toEqual(RT_LAYERS);
  });

  it("I2: setParams serializes all seven params into the URL and re-parse is lossless", () => {
    _searchParamsString = "";
    const { result } = renderMapParams();

    act(() => {
      result.current.setParams({
        view: "M3",
        activeCaseId: "rt-case-i2",
        org: "rt-org-i2",
        kit: "rt-kit-i2",
        at: new Date(RT_AT_ISO),
        caseWindow: "T2",
        layers: RT_LAYERS,
      });
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const writtenUrl = getSpyUrl(replaceStateSpy);
    const writtenQs = extractQs(writtenUrl);

    const sp = new URLSearchParams(writtenQs);
    expect(sp.get("view")).toBe("M3");
    expect(sp.get("case")).toBe("rt-case-i2");
    expect(sp.get("org")).toBe("rt-org-i2");
    expect(sp.get("kit")).toBe("rt-kit-i2");
    expect(sp.get("at")).toBe(RT_AT_ISO);
    expect(sp.get("window")).toBe("T2");
    const layersParam = sp.get("layers");
    expect(layersParam).not.toBeNull();
    expect(layersParam!.split(",")).toEqual(RT_LAYERS);

    _searchParamsString = writtenQs;
    const { result: result2 } = renderMapParams();

    expect(result2.current.view).toBe("M3");
    expect(result2.current.activeCaseId).toBe("rt-case-i2");
    expect(result2.current.org).toBe("rt-org-i2");
    expect(result2.current.kit).toBe("rt-kit-i2");
    expect(result2.current.at?.toISOString()).toBe(RT_AT_ISO);
    expect(result2.current.caseWindow).toBe("T2");
    expect(result2.current.layers).toEqual(RT_LAYERS);
  });

  it("I3: layers param round-trips losslessly for multiple non-default layer sets", () => {
    const layerSets: LayerId[][] = [
      ["satellite", "heat", "transit"],
      ["cases", "terrain"],
      ["clusters", "sites", "labels"],
      ["heat"],
      ["satellite", "terrain", "heat", "sites"],
      ["transit", "cases"],
    ];

    for (const layers of layerSets) {
      _searchParamsString = "";
      replaceStateSpy.mockClear();
      pushStateSpy.mockClear();

      const { result } = renderMapParams();

      act(() => {
        result.current.setParams({ layers });
      });

      expect(replaceStateSpy).toHaveBeenCalledOnce();
      const writtenUrl = getSpyUrl(replaceStateSpy);
      const writtenQs = extractQs(writtenUrl);

      _searchParamsString = writtenQs;
      const { result: reMounted } = renderMapParams();

      expect(reMounted.current.layers).toEqual(layers);
    }
  });

  it("I4: parse -> setParams -> re-parse is idempotent", () => {
    const at = "2025-10-15T08:00:00.000Z";
    const layers: LayerId[] = ["satellite", "terrain"];

    _searchParamsString = [
      "view=M2",
      "case=rt-case-i4",
      "org=rt-org-i4",
      "kit=rt-kit-i4",
      `at=${encodeURIComponent(at)}`,
      "window=T3",
      `layers=${layers.join(",")}`,
    ].join("&");

    const { result: first } = renderMapParams();

    expect(first.current.view).toBe("M2");
    expect(first.current.activeCaseId).toBe("rt-case-i4");
    expect(first.current.org).toBe("rt-org-i4");
    expect(first.current.kit).toBe("rt-kit-i4");
    expect(first.current.at?.toISOString()).toBe(at);
    expect(first.current.caseWindow).toBe("T3");
    expect(first.current.layers).toEqual(layers);

    act(() => {
      first.current.setParams({
        view: first.current.view,
        activeCaseId: first.current.activeCaseId,
        org: first.current.org,
        kit: first.current.kit,
        at: first.current.at,
        caseWindow: first.current.caseWindow,
        layers: first.current.layers,
      });
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    const writtenUrl = getSpyUrl(replaceStateSpy);
    const writtenQs = extractQs(writtenUrl);

    _searchParamsString = writtenQs;
    const { result: second } = renderMapParams();

    expect(second.current.view).toBe(first.current.view);
    expect(second.current.activeCaseId).toBe(first.current.activeCaseId);
    expect(second.current.org).toBe(first.current.org);
    expect(second.current.kit).toBe(first.current.kit);
    expect(second.current.at?.toISOString()).toBe(first.current.at?.toISOString());
    expect(second.current.caseWindow).toBe(first.current.caseWindow);
    expect(second.current.layers).toEqual(first.current.layers);
  });
});
