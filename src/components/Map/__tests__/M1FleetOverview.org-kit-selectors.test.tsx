/**
 * @vitest-environment jsdom
 *
 * AC 110202 Sub-AC 2 — M1FleetOverview org / kit dropdown wiring.
 *
 * Integration tests that mount M1FleetOverview and verify the org and kit
 * <select> dropdowns are wired through to setOrg / setKit on useMapParams,
 * which in turn writes to the URL via window.history.replaceState (shallow
 * routing — no full page reload).
 *
 * Companion tests at the hook level (`use-map-params.org-kit-selectors.test.tsx`)
 * verify shallow-routing semantics directly on the hook.  These tests verify
 * that the M1FleetOverview component actually calls those setters with the
 * correct values when the user changes the dropdown selection.
 *
 * Strategy
 * ────────
 * • Mock useMapParams so we can capture setOrg / setKit calls.
 * • Mock useCaseMapData so the M1 component renders with no data deps.
 * • Mock convex/react and next/navigation so the component tree mounts.
 * • Drive the dropdowns via @testing-library/react fireEvent.change.
 * • Assert that:
 *     1. setOrg is called with the selected option's value.
 *     2. setOrg is called with null when "All organisations" is chosen.
 *     3. setKit is called with the selected kit id.
 *     4. setKit is called with null when "All kits" is chosen.
 */

import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UseCaseMapDataResult } from "@/hooks/use-case-map-data";
import { LayerEngineProvider } from "@/providers/layer-engine-provider";

// ─── Mock next/navigation ─────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/inventory",
  useSearchParams: () => ({
    get: (_key: string) => null,
    toString: () => "",
  }),
}));

// ─── Mock useMapParams (capture setter calls) ────────────────────────────────

const setOrgSpy = vi.fn();
const setKitSpy = vi.fn();

vi.mock("@/hooks/use-map-params", () => ({
  useMapParams: () => ({
    view: "M1",
    org: null,
    kit: null,
    at: null,
    activeCaseId: null,
    caseWindow: "T1",
    panelOpen: false,
    layers: ["cases"],
    setView: vi.fn(),
    setOrg: setOrgSpy,
    setKit: setKitSpy,
    setAt: vi.fn(),
    setActiveCaseId: vi.fn(),
    setCaseWindow: vi.fn(),
    setPanelOpen: vi.fn(),
    setLayers: vi.fn(),
    toggleLayer: vi.fn(),
    setParams: vi.fn(),
  }),
}));

// ─── Mock convex/react (HistoryTrailLayer dep) ────────────────────────────────

vi.mock("convex/react", () => ({
  useQuery: (_api: unknown, _args?: unknown) => undefined,
  useMutation: (_api: unknown) => vi.fn().mockResolvedValue(undefined),
  useConvexConnectionState: () => ({
    isWebSocketConnected: true,
    hasEverConnected: true,
    connectionRetries: 0,
    connectionCount: 1,
    hasInflightRequests: false,
    timeOfOldestInflightRequest: null,
  }),
}));

// ─── Mock useCaseMapData ──────────────────────────────────────────────────────

const EMPTY_RESULT: UseCaseMapDataResult = {
  records: [],
  isLoading: false,
  summary: { total: 0, byStatus: {} },
  mode: "M1",
};

vi.mock("@/hooks/use-case-map-data", () => ({
  useCaseMapData: () => EMPTY_RESULT,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORGS = [
  { id: "org_alpha", name: "Alpha Operations" },
  { id: "org_beta", name: "Beta Inspections" },
];

const KITS = [
  { id: "kit_drone", name: "Drone Kit" },
  { id: "kit_sensor", name: "Sensor Kit" },
];

async function renderM1() {
  const { M1FleetOverview } = await import("../M1FleetOverview");
  render(
    <LayerEngineProvider>
      <M1FleetOverview orgs={ORGS} kits={KITS} />
    </LayerEngineProvider>
  );
}

function getOrgSelect(): HTMLSelectElement {
  return screen.getByLabelText("Filter by organisation") as HTMLSelectElement;
}

function getKitSelect(): HTMLSelectElement {
  return screen.getByLabelText("Filter by kit type") as HTMLSelectElement;
}

beforeEach(() => {
  setOrgSpy.mockClear();
  setKitSpy.mockClear();
});

afterEach(() => cleanup());

// ============================================================================
// A. Dropdown rendering
// ============================================================================

describe("AC 110202 Sub-AC 2 — M1FleetOverview dropdowns render", () => {
  it("renders the org filter <select> with all org options", async () => {
    await renderM1();
    const select = getOrgSelect();
    expect(select.tagName).toBe("SELECT");
    // 1 placeholder + 2 orgs
    expect(select.querySelectorAll("option")).toHaveLength(3);
  });

  it("renders the kit filter <select> with all kit options", async () => {
    await renderM1();
    const select = getKitSelect();
    expect(select.tagName).toBe("SELECT");
    expect(select.querySelectorAll("option")).toHaveLength(3);
  });
});

// ============================================================================
// B. onChange wiring — setOrg
// ============================================================================

describe("AC 110202 Sub-AC 2 — org dropdown calls setOrg", () => {
  it("calls setOrg with the selected org id when the user picks an option", async () => {
    await renderM1();
    const select = getOrgSelect();

    fireEvent.change(select, { target: { value: "org_alpha" } });

    expect(setOrgSpy).toHaveBeenCalledTimes(1);
    expect(setOrgSpy).toHaveBeenCalledWith("org_alpha");
  });

  it("calls setOrg(null) when the user picks 'All organisations' (value='')", async () => {
    await renderM1();
    const select = getOrgSelect();

    // First select an org
    fireEvent.change(select, { target: { value: "org_beta" } });
    setOrgSpy.mockClear();

    // Then clear by selecting the "all organisations" placeholder option
    fireEvent.change(select, { target: { value: "" } });

    expect(setOrgSpy).toHaveBeenCalledTimes(1);
    expect(setOrgSpy).toHaveBeenCalledWith(null);
  });

  it("never calls setKit when the org dropdown changes", async () => {
    await renderM1();
    const select = getOrgSelect();

    fireEvent.change(select, { target: { value: "org_alpha" } });

    expect(setKitSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// C. onChange wiring — setKit
// ============================================================================

describe("AC 110202 Sub-AC 2 — kit dropdown calls setKit", () => {
  it("calls setKit with the selected kit id when the user picks an option", async () => {
    await renderM1();
    const select = getKitSelect();

    fireEvent.change(select, { target: { value: "kit_drone" } });

    expect(setKitSpy).toHaveBeenCalledTimes(1);
    expect(setKitSpy).toHaveBeenCalledWith("kit_drone");
  });

  it("calls setKit(null) when the user picks 'All kits' (value='')", async () => {
    await renderM1();
    const select = getKitSelect();

    fireEvent.change(select, { target: { value: "kit_sensor" } });
    setKitSpy.mockClear();

    fireEvent.change(select, { target: { value: "" } });

    expect(setKitSpy).toHaveBeenCalledTimes(1);
    expect(setKitSpy).toHaveBeenCalledWith(null);
  });

  it("never calls setOrg when the kit dropdown changes", async () => {
    await renderM1();
    const select = getKitSelect();

    fireEvent.change(select, { target: { value: "kit_drone" } });

    expect(setOrgSpy).not.toHaveBeenCalled();
  });
});
