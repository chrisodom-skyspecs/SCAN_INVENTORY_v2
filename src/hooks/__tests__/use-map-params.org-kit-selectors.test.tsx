/**
 * @vitest-environment jsdom
 *
 * AC 110202 Sub-AC 2 — Org / Kit selector controls drive URL state via
 * shallow routing without full page reloads.
 *
 * Verifies the wiring contract for the organisation and kit-template
 * filter <select> controls rendered inside each map mode component
 * (M1FleetOverview, M2SiteDetail, M3TransitTracker, M4Deployment,
 * M5MissionControl):
 *
 *   1. setOrg / setKit write to the URL via window.history.replaceState
 *      (shallow routing — no Next.js navigation event, no full reload).
 *   2. setOrg(null) / setKit(null) remove the param from the URL.
 *   3. Passing { replace: false } switches to window.history.pushState
 *      so the change becomes a back-navigable history entry.
 *   4. Updating one selector preserves the value of the other (no cross-wipe).
 *   5. Org and kit changes never call useRouter().replace / push (verified
 *      by spying on the mocked next/navigation router) — confirming that
 *      the URL update bypasses the Next.js router entirely.
 *
 * Strategy
 * ────────
 * • Mock next/navigation so the hook runs in jsdom; expose router spy fns
 *   so we can assert they are NEVER called.
 * • Spy on window.history.replaceState and window.history.pushState to
 *   verify the actual URL writes.
 * • Use renderHook(useMapParams) to drive setOrg / setKit directly — this
 *   is the same hook the dropdown onChange handlers call.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock next/navigation ─────────────────────────────────────────────────────

let _searchParamsString = "";

const mockSearchParams = {
  get(key: string): string | null {
    return new URLSearchParams(_searchParamsString).get(key);
  },
  toString() {
    return _searchParamsString;
  },
};

const routerReplaceSpy = vi.fn();
const routerPushSpy = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceSpy, push: routerPushSpy }),
  usePathname: () => "/inventory",
  useSearchParams: () => mockSearchParams,
}));

import { useMapParams } from "@/hooks/use-map-params";

// ─── Spies on window.history (shallow-routing assertions) ────────────────────

let replaceStateSpy: ReturnType<typeof vi.spyOn>;
let pushStateSpy: ReturnType<typeof vi.spyOn>;

function renderMapParams() {
  return renderHook(() => useMapParams());
}

function getSpyUrl(
  spy: ReturnType<typeof vi.spyOn>,
  callIndex = 0
): string {
  const call = spy.mock.calls[callIndex] as [unknown, unknown, string];
  return call[2];
}

beforeEach(() => {
  _searchParamsString = "";
  routerReplaceSpy.mockClear();
  routerPushSpy.mockClear();
  // Reset URL so the spies don't capture this setup write.
  window.history.replaceState(null, "", "/inventory");
  replaceStateSpy = vi.spyOn(window.history, "replaceState");
  pushStateSpy = vi.spyOn(window.history, "pushState");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// A. setOrg — shallow URL routing
// ============================================================================

describe("AC 110202 Sub-AC 2 — setOrg shallow routing", () => {
  it("setOrg(id) calls window.history.replaceState by default", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setOrg("org_alpha");
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it("setOrg(id) does NOT trigger Next.js router navigation", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setOrg("org_alpha");
    });

    // Must bypass the Next.js router entirely — shallow routing is the contract.
    expect(routerReplaceSpy).not.toHaveBeenCalled();
    expect(routerPushSpy).not.toHaveBeenCalled();
  });

  it("setOrg(id) writes ?org=<id> to the URL", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setOrg("org_alpha");
    });

    const url = getSpyUrl(replaceStateSpy);
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("org")).toBe("org_alpha");
  });

  it("setOrg(null) removes the org param from the URL", () => {
    _searchParamsString = "org=org_existing";
    const { result } = renderMapParams();

    act(() => {
      result.current.setOrg(null);
    });

    const url = getSpyUrl(replaceStateSpy);
    expect(url).not.toContain("org=");
  });

  it("setOrg(id, { replace:false }) calls window.history.pushState", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setOrg("org_alpha", { replace: false });
    });

    expect(pushStateSpy).toHaveBeenCalledOnce();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("setOrg(id) reflects in result.current.org after the write", () => {
    const { result } = renderMapParams();

    expect(result.current.org).toBeNull();

    act(() => {
      result.current.setOrg("org_alpha");
    });

    expect(result.current.org).toBe("org_alpha");
  });
});

// ============================================================================
// B. setKit — shallow URL routing
// ============================================================================

describe("AC 110202 Sub-AC 2 — setKit shallow routing", () => {
  it("setKit(id) calls window.history.replaceState by default", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setKit("kit_drone");
    });

    expect(replaceStateSpy).toHaveBeenCalledOnce();
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it("setKit(id) does NOT trigger Next.js router navigation", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setKit("kit_drone");
    });

    expect(routerReplaceSpy).not.toHaveBeenCalled();
    expect(routerPushSpy).not.toHaveBeenCalled();
  });

  it("setKit(id) writes ?kit=<id> to the URL", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setKit("kit_drone");
    });

    const url = getSpyUrl(replaceStateSpy);
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("kit")).toBe("kit_drone");
  });

  it("setKit(null) removes the kit param from the URL", () => {
    _searchParamsString = "kit=kit_existing";
    const { result } = renderMapParams();

    act(() => {
      result.current.setKit(null);
    });

    const url = getSpyUrl(replaceStateSpy);
    expect(url).not.toContain("kit=");
  });

  it("setKit(id, { replace:false }) calls window.history.pushState", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setKit("kit_drone", { replace: false });
    });

    expect(pushStateSpy).toHaveBeenCalledOnce();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("setKit(id) reflects in result.current.kit after the write", () => {
    const { result } = renderMapParams();

    expect(result.current.kit).toBeNull();

    act(() => {
      result.current.setKit("kit_drone");
    });

    expect(result.current.kit).toBe("kit_drone");
  });
});

// ============================================================================
// C. Cross-preservation — setOrg / setKit do not wipe the other param
// ============================================================================

describe("AC 110202 Sub-AC 2 — cross-preservation between org and kit", () => {
  it("setOrg(id) preserves an existing kit value in the URL", () => {
    _searchParamsString = "kit=kit_existing";
    const { result } = renderMapParams();

    act(() => {
      result.current.setOrg("org_alpha");
    });

    const url = getSpyUrl(replaceStateSpy);
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("org")).toBe("org_alpha");
    expect(qs.get("kit")).toBe("kit_existing");
  });

  it("setKit(id) preserves an existing org value in the URL", () => {
    _searchParamsString = "org=org_existing";
    const { result } = renderMapParams();

    act(() => {
      result.current.setKit("kit_drone");
    });

    const url = getSpyUrl(replaceStateSpy);
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("kit")).toBe("kit_drone");
    expect(qs.get("org")).toBe("org_existing");
  });

  it("setOrg(null) clears org but preserves kit", () => {
    _searchParamsString = "org=org_existing&kit=kit_existing";
    const { result } = renderMapParams();

    act(() => {
      result.current.setOrg(null);
    });

    const url = getSpyUrl(replaceStateSpy);
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("org")).toBeNull();
    expect(qs.get("kit")).toBe("kit_existing");
  });

  it("setKit(null) clears kit but preserves org", () => {
    _searchParamsString = "org=org_existing&kit=kit_existing";
    const { result } = renderMapParams();

    act(() => {
      result.current.setKit(null);
    });

    const url = getSpyUrl(replaceStateSpy);
    const qs = new URL(url, "http://x").searchParams;
    expect(qs.get("kit")).toBeNull();
    expect(qs.get("org")).toBe("org_existing");
  });
});

// ============================================================================
// D. Round-trip: simulate a dropdown onChange flow
// ============================================================================

describe("AC 110202 Sub-AC 2 — selector control round trip", () => {
  it("simulates an org dropdown onChange flow: '' → id → '' (clear)", () => {
    const { result } = renderMapParams();

    // 1. User picks an org from the dropdown.  M*-component handlers map "" → null.
    act(() => {
      result.current.setOrg("org_first");
    });

    let url = getSpyUrl(replaceStateSpy, 0);
    expect(new URL(url, "http://x").searchParams.get("org")).toBe("org_first");

    // 2. User switches to a different org.
    act(() => {
      result.current.setOrg("org_second");
    });

    url = getSpyUrl(replaceStateSpy, 1);
    expect(new URL(url, "http://x").searchParams.get("org")).toBe("org_second");

    // 3. User selects "All organisations" (value=""), which the handler maps to null.
    act(() => {
      result.current.setOrg(null);
    });

    url = getSpyUrl(replaceStateSpy, 2);
    expect(new URL(url, "http://x").searchParams.get("org")).toBeNull();

    // All three writes used replaceState — none used pushState or the Next.js router.
    expect(replaceStateSpy).toHaveBeenCalledTimes(3);
    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(routerReplaceSpy).not.toHaveBeenCalled();
    expect(routerPushSpy).not.toHaveBeenCalled();
  });

  it("simulates a kit dropdown onChange flow: '' → id → '' (clear)", () => {
    const { result } = renderMapParams();

    act(() => {
      result.current.setKit("kit_a");
    });

    let url = getSpyUrl(replaceStateSpy, 0);
    expect(new URL(url, "http://x").searchParams.get("kit")).toBe("kit_a");

    act(() => {
      result.current.setKit("kit_b");
    });

    url = getSpyUrl(replaceStateSpy, 1);
    expect(new URL(url, "http://x").searchParams.get("kit")).toBe("kit_b");

    act(() => {
      result.current.setKit(null);
    });

    url = getSpyUrl(replaceStateSpy, 2);
    expect(new URL(url, "http://x").searchParams.get("kit")).toBeNull();

    expect(replaceStateSpy).toHaveBeenCalledTimes(3);
    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(routerReplaceSpy).not.toHaveBeenCalled();
    expect(routerPushSpy).not.toHaveBeenCalled();
  });
});
