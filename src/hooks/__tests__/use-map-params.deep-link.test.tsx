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
 * Strategy
 * ────────
 * We mock `next/navigation` in the same style as map-state-provider.test.tsx
 * so these tests run in jsdom without a real Next.js server.
 *
 * Back/forward navigation is simulated by swapping `_searchParamsString` to
 * a different URL state and forcing a re-render — this mirrors what the App
 * Router does when the browser back/forward buttons trigger a `popstate`
 * event and Next.js updates `useSearchParams()`.
 *
 * Covered scenarios
 * ─────────────────
 * A. Mount hydration
 *    A1  Empty URL → all defaults (no case selected, panel closed, T1 view)
 *    A2  Full deep-link → activeCaseId, caseWindow, panelOpen all restored
 *    A3  Partial deep-link (case + panel, no window) → window defaults to T1
 *    A4  All five view modes round-trip from URL
 *    A5  All five caseWindow values round-trip from URL
 *    A6  activeCaseId=null when case param absent
 *    A7  panelOpen=false when panel param absent even with case present
 *    A8  panelOpen=true only when panel=1 present
 *
 * B. setActiveCaseId behaviour (history entry control)
 *    B1  setActiveCaseId(id) calls router.replace (default)
 *    B2  setActiveCaseId(id, { replace:false }) calls router.push
 *    B3  setActiveCaseId(id) sets panelOpen:true atomically in the URL
 *    B4  setActiveCaseId(null) clears case and sets panelOpen:false
 *    B5  Resulting URL from setActiveCaseId contains both case and panel=1
 *
 * C. setCaseWindow behaviour
 *    C1  setCaseWindow("T3") calls router.replace (default)
 *    C2  setCaseWindow("T4", { replace:false }) calls router.push
 *    C3  Resulting URL contains window=T4
 *
 * D. Back-navigation simulation (URL reverts → state reverts)
 *    D1  Navigate M1→M3, simulate back → state shows M1
 *    D2  Open case panel, simulate back → panel closed and case cleared
 *    D3  Change caseWindow T1→T4, simulate back → window restores to T1
 *    D4  Full state change, simulate back, then forward → state follows URL
 *
 * E. setParams (bulk setter) push / replace semantics
 *    E1  setParams with replace:false calls router.push
 *    E2  setParams({ activeCaseId, caseWindow }) produces correct URL keys
 *    E3  setParams with explicit panelOpen:false closes panel
 *
 * F. Edge cases
 *    F1  Invalid activeCaseId in URL → null (sanitized)
 *    F2  Invalid window in URL → T1 default
 *    F3  Stale bookmark (M9 view) → M1 default with no throw
 *    F4  XSS-like case ID → passthrough as opaque string (sanitized for controls)
 */

import React from "react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LayerId } from "@/types/map";

// ─── Mock next/navigation ─────────────────────────────────────────────────────
//
// This mirrors the pattern in map-state-provider.test.tsx.
// `_searchParamsString` acts as the "current URL query string" and can be
// swapped between test assertions to simulate browser history navigation.

const mockReplace = vi.fn();
const mockPush = vi.fn();

/** Mutable "current URL state" — swap this to simulate back/forward. */
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
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  usePathname: () => "/inventory",
  useSearchParams: () => mockSearchParams,
}));

// ─── Import under test (after mock) ──────────────────────────────────────────

import { useMapParams } from "@/hooks/use-map-params";

// ─── Helper: render useMapParams with no wrapping provider ───────────────────
//
// useMapParams delegates to useMapUrlState which delegates to useSearchParams
// and useRouter — both are mocked above. No provider wrapper is needed.

function renderMapParams() {
  return renderHook(() => useMapParams());
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _searchParamsString = "";
  mockReplace.mockClear();
  mockPush.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// A. MOUNT HYDRATION
// ═══════════════════════════════════════════════════════════════════════════════

describe("A — Mount hydration from URL", () => {
  it("A1: empty URL yields all defaults — no case, panel closed, view M1, window T1", () => {
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

  it("A2: full deep-link URL restores activeCaseId, caseWindow, panelOpen, and view on mount", () => {
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
    expect(result.current.caseWindow).toBe("T1"); // window absent → default
    expect(result.current.view).toBe("M1");       // view absent → default
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
  ])("A5: window=%s restores as caseWindow correctly on mount", (raw, expected) => {
    _searchParamsString = `case=any-case&panel=1&window=${raw}`;
    const { result } = renderMapParams();
    expect(result.current.caseWindow).toBe(expected);
  });

  it("A6: activeCaseId is null when case param is absent from URL", () => {
    _searchParamsString = "view=M2&window=T3";
    const { result } = renderMapParams();
    expect(result.current.activeCaseId).toBeNull();
  });

  it("A7: panelOpen is false when panel param is absent, even when case is present", () => {
    // A case can be in the URL without the panel being open (e.g., panel was
    // explicitly closed via setPanelOpen(false) then the user shared the URL).
    _searchParamsString = "case=case-xyz&window=T2";
    const { result } = renderMapParams();

    expect(result.current.activeCaseId).toBe("case-xyz");
    expect(result.current.panelOpen).toBe(false);
  });

  it("A8: panelOpen is true only when panel=1 is present in URL", () => {
    _searchParamsString = "case=case-abc&panel=1";
    const { result } = renderMapParams();
    expect(result.current.panelOpen).toBe(true);

    // Confirm 'false' is the result for panel=0
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

// ═══════════════════════════════════════════════════════════════════════════════
// B. setActiveCaseId — HISTORY ENTRY CONTROL
// ═══════════════════════════════════════════════════════════════════════════════

describe("B — setActiveCaseId history entry semantics", () => {
  it("B1: setActiveCaseId(id) calls router.replace by default", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setActiveCaseId("case-123");
    });

    expect(mockReplace).toHaveBeenCalledOnce();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("B2: setActiveCaseId(id, { replace:false }) calls router.push (new history entry)", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setActiveCaseId("case-456", { replace: false });
    });

    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("B3: setActiveCaseId(id) atomically encodes panelOpen=true in the URL", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setActiveCaseId("case-789");
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    expect(url).toContain("case=case-789");
    expect(url).toContain("panel=1");
  });

  it("B4: setActiveCaseId(null) clears case and sets panelOpen:false in the URL", () => {
    _searchParamsString = "case=case-old&panel=1";
    const { result } = renderMapParams();

    act(() => {
      result.current.setActiveCaseId(null);
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    expect(url).not.toContain("case=");
    expect(url).not.toContain("panel=");
  });

  it("B5: resulting URL from setActiveCaseId contains both case and panel=1", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setActiveCaseId("jx7fieldcase");
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("case")).toBe("jx7fieldcase");
    expect(qs.get("panel")).toBe("1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. setCaseWindow — HISTORY ENTRY CONTROL
// ═══════════════════════════════════════════════════════════════════════════════

describe("C — setCaseWindow history entry semantics", () => {
  it("C1: setCaseWindow('T3') calls router.replace by default", () => {
    _searchParamsString = "case=case-x&panel=1";
    const { result } = renderMapParams();

    act(() => {
      result.current.setCaseWindow("T3");
    });

    expect(mockReplace).toHaveBeenCalledOnce();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("C2: setCaseWindow('T4', { replace:false }) calls router.push", () => {
    _searchParamsString = "case=case-x&panel=1";
    const { result } = renderMapParams();

    act(() => {
      result.current.setCaseWindow("T4", { replace: false });
    });

    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("C3: resulting URL contains window=T4 after setCaseWindow('T4')", () => {
    _searchParamsString = "case=case-x&panel=1";
    const { result } = renderMapParams();

    act(() => {
      result.current.setCaseWindow("T4");
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    expect(url).toContain("window=T4");
  });

  it("C4: setCaseWindow('T1') omits window param (default not encoded)", () => {
    _searchParamsString = "case=case-x&panel=1&window=T3";
    const { result } = renderMapParams();

    act(() => {
      result.current.setCaseWindow("T1"); // T1 is the default
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    // T1 is the default — should be omitted from the URL
    expect(url).not.toContain("window=");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. BACK-NAVIGATION SIMULATION
//
// Strategy: update `_searchParamsString` to simulate the URL that would result
// from the browser's back/forward button.  Then force a re-render and verify
// the hook reflects the "previous" URL state.
//
// This mirrors real browser behaviour: pressing Back causes a popstate event,
// Next.js App Router calls useSearchParams() with the previous URL's params,
// and React re-renders the component tree with the new search params reference.
// ═══════════════════════════════════════════════════════════════════════════════

describe("D — Back/forward navigation simulation", () => {
  it("D1: navigate M1→M3, simulate back → state shows M1", () => {
    // Initial URL: M1 (default, empty params)
    _searchParamsString = "";
    const { result, rerender } = renderMapParams();
    expect(result.current.view).toBe("M1");

    // Simulate router.push to M3 (the hook would have been called, but we
    // directly update the mock to reflect the new URL state)
    _searchParamsString = "view=M3";
    rerender();
    expect(result.current.view).toBe("M3");

    // Simulate browser Back: URL reverts to the previous entry
    _searchParamsString = "";
    rerender();
    expect(result.current.view).toBe("M1");
  });

  it("D2: open case panel, simulate back → panel closed and case cleared", () => {
    // Start: no case selected
    _searchParamsString = "";
    const { result, rerender } = renderMapParams();
    expect(result.current.activeCaseId).toBeNull();
    expect(result.current.panelOpen).toBe(false);

    // Navigate forward: open a case (push entry)
    _searchParamsString = "case=case-detail&panel=1&window=T2";
    rerender();
    expect(result.current.activeCaseId).toBe("case-detail");
    expect(result.current.panelOpen).toBe(true);
    expect(result.current.caseWindow).toBe("T2");

    // Simulate browser Back: revert to state with no case selected
    _searchParamsString = "";
    rerender();
    expect(result.current.activeCaseId).toBeNull();
    expect(result.current.panelOpen).toBe(false);
    expect(result.current.caseWindow).toBe("T1");
  });

  it("D3: switch caseWindow T1→T4, simulate back → window returns to T1", () => {
    // Start: case open with T1 (default window)
    _searchParamsString = "case=case-abc&panel=1";
    const { result, rerender } = renderMapParams();
    expect(result.current.caseWindow).toBe("T1");

    // Navigate to T4 tab
    _searchParamsString = "case=case-abc&panel=1&window=T4";
    rerender();
    expect(result.current.caseWindow).toBe("T4");

    // Simulate browser Back: window reverts
    _searchParamsString = "case=case-abc&panel=1";
    rerender();
    expect(result.current.caseWindow).toBe("T1");
  });

  it("D4: full state change, simulate back and forward → state follows URL", () => {
    // State A: empty
    _searchParamsString = "";
    const { result, rerender } = renderMapParams();

    // State B: M3, case selected, T3 window
    _searchParamsString = "view=M3&case=case-b&window=T3&panel=1";
    rerender();
    expect(result.current.view).toBe("M3");
    expect(result.current.activeCaseId).toBe("case-b");
    expect(result.current.caseWindow).toBe("T3");
    expect(result.current.panelOpen).toBe(true);

    // State C: M4, different case, T5 window
    _searchParamsString = "view=M4&case=case-c&window=T5&panel=1";
    rerender();
    expect(result.current.view).toBe("M4");
    expect(result.current.activeCaseId).toBe("case-c");
    expect(result.current.caseWindow).toBe("T5");

    // Simulate Back → go to State B
    _searchParamsString = "view=M3&case=case-b&window=T3&panel=1";
    rerender();
    expect(result.current.view).toBe("M3");
    expect(result.current.activeCaseId).toBe("case-b");
    expect(result.current.caseWindow).toBe("T3");
    expect(result.current.panelOpen).toBe(true);

    // Simulate Forward → go to State C
    _searchParamsString = "view=M4&case=case-c&window=T5&panel=1";
    rerender();
    expect(result.current.view).toBe("M4");
    expect(result.current.activeCaseId).toBe("case-c");
    expect(result.current.caseWindow).toBe("T5");
    expect(result.current.panelOpen).toBe(true);
  });

  it("D5: panel can be toggled (close/reopen) without losing case selection across nav", () => {
    // Open panel
    _searchParamsString = "case=case-toggle&panel=1&window=T2";
    const { result, rerender } = renderMapParams();
    expect(result.current.activeCaseId).toBe("case-toggle");
    expect(result.current.panelOpen).toBe(true);

    // Close panel (case still selected, panel hidden)
    _searchParamsString = "case=case-toggle&window=T2";
    rerender();
    expect(result.current.activeCaseId).toBe("case-toggle"); // still selected
    expect(result.current.panelOpen).toBe(false);            // panel hidden

    // Simulate Back → panel reopens
    _searchParamsString = "case=case-toggle&panel=1&window=T2";
    rerender();
    expect(result.current.activeCaseId).toBe("case-toggle");
    expect(result.current.panelOpen).toBe(true);
  });

  it("D6: view changes are independent of case selection state across back/forward", () => {
    // Start: M2 view, no case
    _searchParamsString = "view=M2";
    const { result, rerender } = renderMapParams();
    expect(result.current.view).toBe("M2");
    expect(result.current.activeCaseId).toBeNull();

    // Navigate to M3 + select a case
    _searchParamsString = "view=M3&case=case-nav&panel=1";
    rerender();
    expect(result.current.view).toBe("M3");
    expect(result.current.activeCaseId).toBe("case-nav");

    // Back to M2 (case is gone, it was pushed as a fresh URL)
    _searchParamsString = "view=M2";
    rerender();
    expect(result.current.view).toBe("M2");
    expect(result.current.activeCaseId).toBeNull();
    expect(result.current.panelOpen).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E. setParams (bulk setter) — PUSH / REPLACE SEMANTICS
// ═══════════════════════════════════════════════════════════════════════════════

describe("E — setParams bulk setter", () => {
  it("E1: setParams with replace:false calls router.push (new history entry)", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setParams({ view: "M3", activeCaseId: "case-bulk" }, { replace: false });
    });

    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("E2: setParams({ activeCaseId, caseWindow }) encodes correct URL keys", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setParams({ activeCaseId: "case-set", caseWindow: "T3" });
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("case")).toBe("case-set");
    expect(qs.get("window")).toBe("T3");
    // activeCaseId being set should also set panelOpen=true
    expect(qs.get("panel")).toBe("1");
  });

  it("E3: setParams({ activeCaseId, panelOpen:false }) encodes panelOpen override", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setParams({ activeCaseId: "case-closed", panelOpen: false });
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("case")).toBe("case-closed");
    // Explicit panelOpen:false must be respected over auto-derive
    expect(qs.get("panel")).toBeNull();
  });

  it("E4: setParams preserves existing state not included in the patch", () => {
    _searchParamsString = "view=M3&case=existing&panel=1&window=T2";
    const { result } = renderMapParams();

    act(() => {
      // Only update the view — case, window, and panel should be preserved
      result.current.setParams({ view: "M4" });
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("view")).toBe("M4");
    expect(qs.get("case")).toBe("existing");
    expect(qs.get("window")).toBe("T2");
    expect(qs.get("panel")).toBe("1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F. EDGE CASES — Sanitization and Fallbacks
// ═══════════════════════════════════════════════════════════════════════════════

describe("F — Edge cases: sanitization and fallbacks on mount", () => {
  it("F1: control characters in case ID are stripped; result is non-null sanitized value", () => {
    // NUL byte should be stripped; the remaining characters form a valid ID
    _searchParamsString = "case=case%00abc&panel=1";
    const { result } = renderMapParams();
    // parseId strips \x00 → "caseabc"
    expect(result.current.activeCaseId).toBe("caseabc");
  });

  it("F2: invalid window param in URL defaults to T1 on mount — no throw", () => {
    _searchParamsString = "case=case-ok&panel=1&window=Z9";
    const { result } = renderMapParams();
    expect(result.current.caseWindow).toBe("T1");
    expect(result.current.activeCaseId).toBe("case-ok");
    expect(result.current.panelOpen).toBe(true);
  });

  it("F3: stale bookmark with M9 view falls back to M1 on mount — no throw", () => {
    _searchParamsString = "view=M9&case=case-stale&window=T2&panel=1";
    const { result } = renderMapParams();
    expect(result.current.view).toBe("M1");   // M9 invalid → M1
    expect(result.current.activeCaseId).toBe("case-stale"); // case still restored
    expect(result.current.caseWindow).toBe("T2");           // window still restored
    expect(result.current.panelOpen).toBe(true);
  });

  it("F4: whitespace-only case ID resolves to null", () => {
    // URL-encoded spaces only → parseId returns null
    _searchParamsString = "case=+++&panel=1"; // '+' decodes as space in query strings
    const { result } = renderMapParams();
    expect(result.current.activeCaseId).toBeNull();
  });

  it("F5: all params invalid simultaneously — full defaults, no throw", () => {
    _searchParamsString = "view=BOGUS&case=%00%01&window=X7&panel=nope&layers=bad1";
    const { result } = renderMapParams();

    expect(result.current.view).toBe("M1");
    // case with only control chars → null
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

// ═══════════════════════════════════════════════════════════════════════════════
// G. setPanelOpen — INDEPENDENT PANEL CONTROL
// ═══════════════════════════════════════════════════════════════════════════════

describe("G — setPanelOpen — independent panel control", () => {
  it("G1: setPanelOpen(true) encodes panel=1 in URL", () => {
    _searchParamsString = "case=case-gx";
    const { result } = renderMapParams();

    act(() => {
      result.current.setPanelOpen(true);
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    expect(url).toContain("panel=1");
  });

  it("G2: setPanelOpen(false) removes panel from URL", () => {
    _searchParamsString = "case=case-gx&panel=1";
    const { result } = renderMapParams();

    act(() => {
      result.current.setPanelOpen(false);
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    expect(url).not.toContain("panel=");
  });

  it("G3: setPanelOpen does not affect case selection", () => {
    _searchParamsString = "case=case-gx&panel=1&window=T3";
    const { result } = renderMapParams();

    act(() => {
      result.current.setPanelOpen(false);
    });

    const [url] = mockReplace.mock.calls[0] as [string];
    // case and window should be preserved
    expect(url).toContain("case=case-gx");
    expect(url).toContain("window=T3");
    expect(url).not.toContain("panel=");
  });

  it("G4: simulate setPanelOpen(false) via back → panel reopens", () => {
    // Panel open
    _searchParamsString = "case=case-gy&panel=1&window=T2";
    const { result, rerender } = renderMapParams();
    expect(result.current.panelOpen).toBe(true);

    // setPanelOpen(false) was called (replace) → URL without panel
    // Simulate what would happen after the URL update propagates
    _searchParamsString = "case=case-gy&window=T2";
    rerender();
    expect(result.current.panelOpen).toBe(false);
    expect(result.current.activeCaseId).toBe("case-gy"); // case still selected

    // Simulate Back: panel reopens
    _searchParamsString = "case=case-gy&panel=1&window=T2";
    rerender();
    expect(result.current.panelOpen).toBe(true);
    expect(result.current.activeCaseId).toBe("case-gy");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// H. ROUND-TRIP ENCODE → HYDRATION FIDELITY
// ═══════════════════════════════════════════════════════════════════════════════

describe("H — Round-trip fidelity: encode then hydrate", () => {
  it("H1: every param survives encode→URL→hydrate unchanged", () => {
    // This test verifies the full encode→decode round-trip that happens when
    // a user clicks a case pin (setActiveCaseId), the URL updates, and the
    // Next.js router re-renders the hook with the new searchParams.

    // Simulate the URL that setActiveCaseId / setCaseWindow would produce
    // (we manually compose the URL to match what encodeMapUrlState would emit)
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
    // Step 1: start with no state
    _searchParamsString = "";
    const { result } = renderMapParams();

    // Step 2: call setActiveCaseId — capture the URL written to the router
    act(() => {
      result.current.setActiveCaseId("hydration-test-case");
    });

    const [writtenUrl] = mockReplace.mock.calls[0] as [string];

    // Step 3: simulate what happens when Next.js re-renders with the new URL
    // Extract the query string from the written URL and re-hydrate
    const writtenQs = writtenUrl.includes("?")
      ? writtenUrl.split("?")[1]
      : "";
    _searchParamsString = writtenQs;

    // Re-render the hook with the new URL
    const { result: result2 } = renderMapParams();

    // Step 4: verify state matches what was written
    expect(result2.current.activeCaseId).toBe("hydration-test-case");
    expect(result2.current.panelOpen).toBe(true);
    expect(result2.current.view).toBe("M1"); // view unchanged from default
  });

  it("H3: setCaseWindow produces a URL that hydrates caseWindow correctly", () => {
    _searchParamsString = "case=case-window&panel=1";
    const { result } = renderMapParams();

    act(() => {
      result.current.setCaseWindow("T5");
    });

    const [writtenUrl] = mockReplace.mock.calls[0] as [string];
    const writtenQs = writtenUrl.includes("?") ? writtenUrl.split("?")[1] : "";

    _searchParamsString = writtenQs;
    const { result: result2 } = renderMapParams();

    expect(result2.current.caseWindow).toBe("T5");
    expect(result2.current.activeCaseId).toBe("case-window");
    expect(result2.current.panelOpen).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// I. ROUND-TRIP INTEGRATION — all seven useMapParams params including layers
//
// Sub-AC 2: An integration test that round-trips all seven useMapParams params
// (view, activeCaseId, org, kit, at, caseWindow, layers) through a full URL
// parse/serialize cycle and asserts lossless reconstruction at each stage.
//
// "Lossless" means: every param value read from the hook after re-hydrating
// the serialized URL is bit-for-bit identical to the value that was originally
// written — no truncation, no re-ordering, no type coercion loss.
//
// Covered scenarios
// ─────────────────
// I1  Direct URL → hook parse: all seven params reconstructed exactly on mount.
// I2  setParams (serialize) → URL → re-parse: full round-trip via hook setter.
// I3  layers-only round-trips: multiple non-default layer sets survive encode
//     → decode unchanged (order preserved, no duplicates introduced).
// I4  Read-back round-trip: params parsed from URL are re-serialized via
//     setParams and the resulting URL re-parsed — state is stable (idempotent).
// ═══════════════════════════════════════════════════════════════════════════════

describe("I — Round-trip integration: all seven params including layers", () => {
  // Fixed values used across multiple tests — chosen to differ from every
  // default so they are always encoded in the URL (making the round-trip
  // non-trivial: a default value would simply be omitted from the URL and
  // trivially "survive").
  const RT_AT_ISO = "2025-09-01T12:30:00.000Z";
  const RT_LAYERS: LayerId[] = ["satellite", "heat", "transit"];

  // Helper: extract the query-string portion of a URL written to the mock router.
  function extractQs(url: string): string {
    const idx = url.indexOf("?");
    return idx >= 0 ? url.slice(idx + 1) : "";
  }

  // ── I1: Parse direction — URL string → hook state ─────────────────────────
  //
  // Construct a URL that encodes all seven params at non-default values,
  // mount the hook, and assert every param is reconstructed correctly.

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

  // ── I2: Serialize direction — setParams → URL → re-parse ──────────────────
  //
  // Call setParams with all seven params, capture the URL written to the
  // router, simulate Next.js re-rendering with that URL, and verify that
  // every param is faithfully reconstructed after the round-trip.

  it("I2: setParams serializes all seven params into the URL and re-parse is lossless", () => {
    // Start from defaults so every non-default param must be encoded.
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

    // The hook must have written exactly one URL to the router.
    expect(mockReplace).toHaveBeenCalledOnce();
    const [writtenUrl] = mockReplace.mock.calls[0] as [string];
    const writtenQs = extractQs(writtenUrl);

    // ── Intermediate assertion: URL contains each param key ──────────────────
    const sp = new URLSearchParams(writtenQs);
    expect(sp.get("view")).toBe("M3");
    expect(sp.get("case")).toBe("rt-case-i2");
    expect(sp.get("org")).toBe("rt-org-i2");
    expect(sp.get("kit")).toBe("rt-kit-i2");
    expect(sp.get("at")).toBe(RT_AT_ISO);
    expect(sp.get("window")).toBe("T2");
    // layers param must contain all three layer IDs (order preserved)
    const layersParam = sp.get("layers");
    expect(layersParam).not.toBeNull();
    expect(layersParam!.split(",")).toEqual(RT_LAYERS);

    // ── Full round-trip: simulate Next.js re-rendering with the new URL ──────
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

  // ── I3: layers-only round-trips — multiple non-default layer sets ──────────
  //
  // Verifies that the layers param specifically (the one called out in
  // Sub-AC 2) survives encode → decode losslessly for a variety of
  // non-default layer combinations including varying lengths and orderings.

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
      mockReplace.mockClear();

      const { result } = renderMapParams();

      act(() => {
        result.current.setParams({ layers });
      });

      expect(mockReplace).toHaveBeenCalledOnce();
      const [writtenUrl] = mockReplace.mock.calls[0] as [string];
      const writtenQs = extractQs(writtenUrl);

      // Re-mount with the serialized URL and verify lossless reconstruction.
      _searchParamsString = writtenQs;
      const { result: reMounted } = renderMapParams();

      expect(reMounted.current.layers).toEqual(layers);
    }
  });

  // ── I4: Read-back round-trip — idempotency of parse → serialize → re-parse ─
  //
  // Parse a URL with all seven params, re-serialize the read-back state via
  // setParams, then parse again and assert the final state is identical to
  // the initial parse.  This proves the cycle is idempotent — running it a
  // second time produces no changes ("lossless reconstruction").

  it("I4: parse → setParams → re-parse is idempotent: second decode equals first decode", () => {
    const at = "2025-10-15T08:00:00.000Z";
    const layers: LayerId[] = ["satellite", "terrain"];

    // Step 1 — establish initial URL with all seven params.
    _searchParamsString = [
      "view=M2",
      "case=rt-case-i4",
      "org=rt-org-i4",
      "kit=rt-kit-i4",
      `at=${encodeURIComponent(at)}`,
      "window=T3",
      `layers=${layers.join(",")}`,
    ].join("&");

    // Step 2 — first parse: mount hook and read all seven params.
    const { result: first } = renderMapParams();

    expect(first.current.view).toBe("M2");
    expect(first.current.activeCaseId).toBe("rt-case-i4");
    expect(first.current.org).toBe("rt-org-i4");
    expect(first.current.kit).toBe("rt-kit-i4");
    expect(first.current.at?.toISOString()).toBe(at);
    expect(first.current.caseWindow).toBe("T3");
    expect(first.current.layers).toEqual(layers);

    // Step 3 — serialize: call setParams with the values just read back.
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

    expect(mockReplace).toHaveBeenCalledOnce();
    const [writtenUrl] = mockReplace.mock.calls[0] as [string];
    const writtenQs = extractQs(writtenUrl);

    // Step 4 — second parse: mount hook with the re-serialized URL.
    _searchParamsString = writtenQs;
    const { result: second } = renderMapParams();

    // Step 5 — assert idempotency: second parse == first parse (no mutation).
    expect(second.current.view).toBe(first.current.view);
    expect(second.current.activeCaseId).toBe(first.current.activeCaseId);
    expect(second.current.org).toBe(first.current.org);
    expect(second.current.kit).toBe(first.current.kit);
    expect(second.current.at?.toISOString()).toBe(first.current.at?.toISOString());
    expect(second.current.caseWindow).toBe(first.current.caseWindow);
    expect(second.current.layers).toEqual(first.current.layers);
  });
});
