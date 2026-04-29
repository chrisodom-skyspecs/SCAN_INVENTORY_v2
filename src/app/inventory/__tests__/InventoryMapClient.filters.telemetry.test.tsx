/**
 * @vitest-environment jsdom
 *
 * Unit tests: filter, case-selection, page-load, and layer-toggle
 * telemetry for InventoryMapClient.
 *
 * Verifies that the following events are fired with the correct payloads:
 *   • INV_NAV_PAGE_LOADED           — once on mount
 *   • INV_NAV_CASE_SELECTED         — when activeCaseId becomes non-null
 *   • INV_NAV_CASE_DESELECTED       — when activeCaseId becomes null (was non-null)
 *   • INV_ACTION_FILTER_ORG_CHANGED — when org URL param changes
 *   • INV_ACTION_FILTER_KIT_CHANGED — when kit URL param changes
 *   • INV_ACTION_LAYER_TOGGLED      — when layers array changes
 *
 * Strategy
 * ────────
 * • `trackEvent` is mocked at the module level so we can assert on
 *   exactly which events were emitted without touching any transport.
 * • `useMapParams` is mocked with module-level variables for each
 *   controllable param, mutated between renders to simulate user actions.
 * • Child components (M1-M5, CaseDetailPanel) and data hooks (useMissions,
 *   useCaseTemplates) are stubbed — irrelevant to the filter telemetry concern.
 * • `next/navigation` is mocked so the hooks that wrap useSearchParams
 *   and useRouter do not throw in jsdom.
 *
 * Covered scenarios
 * ─────────────────
 *  1. INV_NAV_PAGE_LOADED fires once on mount with loadDurationMs ≥ 0.
 *  2. INV_NAV_PAGE_LOADED does NOT fire again on re-renders.
 *  3. INV_NAV_CASE_SELECTED fires when activeCaseId changes from null → string.
 *  4. INV_NAV_CASE_DESELECTED fires when activeCaseId changes from string → null.
 *  5. No spurious case event fires on initial render with activeCaseId = null.
 *  6. No spurious case event fires on initial render with activeCaseId = a string.
 *  7. INV_ACTION_FILTER_ORG_CHANGED fires when org changes (null → id).
 *  8. INV_ACTION_FILTER_ORG_CHANGED fires when org is cleared (id → null).
 *  9. INV_ACTION_FILTER_ORG_CHANGED does NOT fire on initial render.
 * 10. INV_ACTION_FILTER_KIT_CHANGED fires when kit changes (null → id).
 * 11. INV_ACTION_FILTER_KIT_CHANGED fires when kit is cleared (id → null).
 * 12. INV_ACTION_FILTER_KIT_CHANGED does NOT fire on initial render.
 * 13. INV_ACTION_LAYER_TOGGLED fires (enabled=true) when a layer is added.
 * 14. INV_ACTION_LAYER_TOGGLED fires (enabled=false) when a layer is removed.
 * 15. INV_ACTION_LAYER_TOGGLED does NOT fire on initial render.
 * 16. Multiple layer changes in one update fire one event per changed layer.
 */

import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MapView } from "@/types/map";
import { MAP_URL_STATE_DEFAULTS } from "@/types/map";
import { TelemetryEventName } from "@/types/telemetry.types";

// ─── Mock next/navigation (required by useMapParams → useMapUrlState) ─────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/inventory",
  useSearchParams: () => ({
    get: () => null,
    toString: () => "",
  }),
}));

// ─── Mock telemetry (spy on trackEvent, never hit transport) ──────────────────

const mockTrackEvent = vi.fn();

vi.mock("@/lib/telemetry.lib", () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  telemetry: {
    track: vi.fn(),
    identify: vi.fn(),
    flush: vi.fn(),
  },
}));

// ─── Mock useMapParams (control all params via module-level variables) ────────

let _mockView: MapView = "M1";
let _mockActiveCaseId: string | null = null;
let _mockOrg: string | null = null;
let _mockKit: string | null = null;
let _mockLayers: string[] = ["cases", "clusters", "labels"];

vi.mock("@/hooks/use-map-params", () => ({
  useMapParams: () => ({
    view: _mockView,
    activeCaseId: _mockActiveCaseId,
    caseWindow: "T1",
    panelOpen: _mockActiveCaseId !== null,
    org: _mockOrg,
    kit: _mockKit,
    at: null,
    layers: _mockLayers,
    setView: vi.fn(),
    setActiveCaseId: vi.fn(),
    setOrg: vi.fn(),
    setKit: vi.fn(),
    setAt: vi.fn(),
    setCaseWindow: vi.fn(),
    setPanelOpen: vi.fn(),
    setLayers: vi.fn(),
    toggleLayer: vi.fn(),
    setParams: vi.fn(),
  }),
}));

// ─── Mock Convex data hooks (not under test) ──────────────────────────────────

vi.mock("@/hooks/use-missions", () => ({
  useMissions: () => ({ orgs: [] }),
}));

vi.mock("@/hooks/use-case-templates", () => ({
  useCaseTemplates: () => ({ kits: [] }),
}));

// ─── Mock useKindeUser (not under test here) ──────────────────────────────────

vi.mock("@/hooks/use-kinde-user", () => ({
  useKindeUser: () => ({
    id: "test_user_001",
    name: "Operator",
    isLoading: false,
    isAuthenticated: true,
  }),
}));

// ─── Mock useDefaultLayoutOnCaseChange (not under test here) ─────────────────

vi.mock("@/hooks/use-default-layout-on-case-change", () => ({
  useDefaultLayoutOnCaseChange: () => undefined,
}));

// ─── Stub child map / panel components (avoid complex render deps) ────────────

vi.mock("@/components/Map/M1FleetOverview", () => ({
  M1FleetOverview: () => <div data-testid="m1" />,
}));
vi.mock("@/components/Map/M2SiteDetail", () => ({
  M2SiteDetail: () => <div data-testid="m2" />,
}));
vi.mock("@/components/Map/M3TransitTracker", () => ({
  M3TransitTracker: () => <div data-testid="m3" />,
}));
vi.mock("@/components/Map/M4Deployment", () => ({
  M4Deployment: () => <div data-testid="m4" />,
}));
vi.mock("@/components/Map/M5MissionControl", () => ({
  M5MissionControl: () => <div data-testid="m5" />,
}));
vi.mock("@/components/CaseDetail", () => ({
  CaseDetailPanel: () => <div data-testid="case-detail" />,
}));

// ─── Import SUT (after all mocks are registered) ─────────────────────────────

import { InventoryMapClient } from "../InventoryMapClient";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderClient() {
  return render(
    <InventoryMapClient
      initialState={{ ...MAP_URL_STATE_DEFAULTS, view: _mockView }}
    />
  );
}

/**
 * Filter mockTrackEvent.mock.calls by eventName.
 * Returns an array of the first argument (the event object) for each matching call.
 */
function callsForEvent(eventName: string): Record<string, unknown>[] {
  return mockTrackEvent.mock.calls
    .map((args: unknown[]) => args[0] as Record<string, unknown>)
    .filter((event) => event.eventName === eventName);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InventoryMapClient — page load telemetry", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    _mockView = "M1";
    _mockActiveCaseId = null;
    _mockOrg = null;
    _mockKit = null;
    _mockLayers = ["cases", "clusters", "labels"];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. Fires once on mount ───────────────────────────────────────────────

  it("fires INV_NAV_PAGE_LOADED once on mount", () => {
    renderClient();

    const events = callsForEvent(TelemetryEventName.INV_NAV_PAGE_LOADED);
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.eventCategory).toBe("navigation");
    expect(event.app).toBe("inventory");
    expect(typeof event.loadDurationMs).toBe("number");
    expect(event.loadDurationMs as number).toBeGreaterThanOrEqual(0);
    expect(typeof event.hydratedFromUrl).toBe("boolean");
  });

  // ─── 2. Does not fire again on re-render ─────────────────────────────────

  it("does NOT fire INV_NAV_PAGE_LOADED again on re-render", () => {
    const { rerender } = renderClient();

    mockTrackEvent.mockClear();
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_NAV_PAGE_LOADED);
    expect(events).toHaveLength(0);
  });
});

describe("InventoryMapClient — case selection/deselection telemetry", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    _mockView = "M1";
    _mockActiveCaseId = null;
    _mockOrg = null;
    _mockKit = null;
    _mockLayers = ["cases", "clusters", "labels"];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 3. INV_NAV_CASE_SELECTED fires when case selected ───────────────────

  it("fires INV_NAV_CASE_SELECTED when activeCaseId changes from null to a string", () => {
    const { rerender } = renderClient();

    mockTrackEvent.mockClear(); // ignore mount events (page_loaded, map_view_changed)

    _mockActiveCaseId = "case_xyz789";
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_NAV_CASE_SELECTED);
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.eventCategory).toBe("navigation");
    expect(event.app).toBe("inventory");
    expect(event.caseId).toBe("case_xyz789");
    expect(event.mapView).toBe("M1");
    expect(event.selectionSource).toBeDefined();
  });

  // ─── 4. INV_NAV_CASE_DESELECTED fires when case cleared ──────────────────

  it("fires INV_NAV_CASE_DESELECTED when activeCaseId changes from string to null", () => {
    _mockActiveCaseId = "case_abc123";
    const { rerender } = renderClient();

    mockTrackEvent.mockClear(); // ignore mount events

    _mockActiveCaseId = null;
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_NAV_CASE_DESELECTED);
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.eventCategory).toBe("navigation");
    expect(event.app).toBe("inventory");
    expect(event.previousCaseId).toBe("case_abc123");
  });

  // ─── 5. No spurious case event on initial render with activeCaseId = null ──

  it("does NOT fire a case event on initial render when activeCaseId is null", () => {
    _mockActiveCaseId = null;
    renderClient();

    const selected = callsForEvent(TelemetryEventName.INV_NAV_CASE_SELECTED);
    const deselected = callsForEvent(TelemetryEventName.INV_NAV_CASE_DESELECTED);
    expect(selected).toHaveLength(0);
    expect(deselected).toHaveLength(0);
  });

  // ─── 6. No spurious CASE_SELECTED on initial render with a pre-set case ───

  it("does NOT fire INV_NAV_CASE_SELECTED on initial render when a case was pre-selected via deep link", () => {
    _mockActiveCaseId = "case_deeplink";
    renderClient();

    const events = callsForEvent(TelemetryEventName.INV_NAV_CASE_SELECTED);
    expect(events).toHaveLength(0);
  });

  // ─── Switching between two different cases ────────────────────────────────

  it("fires INV_NAV_CASE_SELECTED with the new caseId when switching between cases", () => {
    _mockActiveCaseId = "case_first";
    const { rerender } = renderClient();

    mockTrackEvent.mockClear();

    _mockActiveCaseId = "case_second";
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_NAV_CASE_SELECTED);
    expect(events).toHaveLength(1);
    expect(events[0].caseId).toBe("case_second");
  });
});

describe("InventoryMapClient — org filter telemetry", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    _mockView = "M1";
    _mockActiveCaseId = null;
    _mockOrg = null;
    _mockKit = null;
    _mockLayers = ["cases", "clusters", "labels"];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 7. Fires when org changes null → id ─────────────────────────────────

  it("fires INV_ACTION_FILTER_ORG_CHANGED when org changes from null to an id", () => {
    const { rerender } = renderClient();

    mockTrackEvent.mockClear(); // ignore mount events

    _mockOrg = "org_alpha";
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_ACTION_FILTER_ORG_CHANGED);
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.eventCategory).toBe("user_action");
    expect(event.app).toBe("inventory");
    expect(event.orgId).toBe("org_alpha");
    expect(event.previousOrgId).toBeNull();
  });

  // ─── 8. Fires when org is cleared id → null ──────────────────────────────

  it("fires INV_ACTION_FILTER_ORG_CHANGED when org is cleared (id → null)", () => {
    _mockOrg = "org_beta";
    const { rerender } = renderClient();

    mockTrackEvent.mockClear();

    _mockOrg = null;
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_ACTION_FILTER_ORG_CHANGED);
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.orgId).toBeNull();
    expect(event.previousOrgId).toBe("org_beta");
  });

  // ─── 9. Does NOT fire on initial render ──────────────────────────────────

  it("does NOT fire INV_ACTION_FILTER_ORG_CHANGED on initial render", () => {
    _mockOrg = "org_gamma";
    renderClient();

    const events = callsForEvent(TelemetryEventName.INV_ACTION_FILTER_ORG_CHANGED);
    expect(events).toHaveLength(0);
  });

  // ─── Changing from one org to another ────────────────────────────────────

  it("records correct previousOrgId when switching from one org to another", () => {
    _mockOrg = "org_one";
    const { rerender } = renderClient();

    mockTrackEvent.mockClear();

    _mockOrg = "org_two";
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_ACTION_FILTER_ORG_CHANGED);
    expect(events).toHaveLength(1);
    expect(events[0].orgId).toBe("org_two");
    expect(events[0].previousOrgId).toBe("org_one");
  });

  // ─── No duplicate on same org value ──────────────────────────────────────

  it("does NOT fire a duplicate event when org stays the same on re-render", () => {
    _mockOrg = "org_stable";
    const { rerender } = renderClient();

    mockTrackEvent.mockClear();
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />); // same org, new render

    const events = callsForEvent(TelemetryEventName.INV_ACTION_FILTER_ORG_CHANGED);
    expect(events).toHaveLength(0);
  });
});

describe("InventoryMapClient — kit filter telemetry", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    _mockView = "M1";
    _mockActiveCaseId = null;
    _mockOrg = null;
    _mockKit = null;
    _mockLayers = ["cases", "clusters", "labels"];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 10. Fires when kit changes null → id ────────────────────────────────

  it("fires INV_ACTION_FILTER_KIT_CHANGED when kit changes from null to an id", () => {
    const { rerender } = renderClient();

    mockTrackEvent.mockClear();

    _mockKit = "kit_drone";
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_ACTION_FILTER_KIT_CHANGED);
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.eventCategory).toBe("user_action");
    expect(event.app).toBe("inventory");
    expect(event.kitId).toBe("kit_drone");
    expect(event.previousKitId).toBeNull();
  });

  // ─── 11. Fires when kit is cleared id → null ─────────────────────────────

  it("fires INV_ACTION_FILTER_KIT_CHANGED when kit is cleared (id → null)", () => {
    _mockKit = "kit_sensor";
    const { rerender } = renderClient();

    mockTrackEvent.mockClear();

    _mockKit = null;
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_ACTION_FILTER_KIT_CHANGED);
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.kitId).toBeNull();
    expect(event.previousKitId).toBe("kit_sensor");
  });

  // ─── 12. Does NOT fire on initial render ─────────────────────────────────

  it("does NOT fire INV_ACTION_FILTER_KIT_CHANGED on initial render", () => {
    _mockKit = "kit_prefilled";
    renderClient();

    const events = callsForEvent(TelemetryEventName.INV_ACTION_FILTER_KIT_CHANGED);
    expect(events).toHaveLength(0);
  });

  // ─── No duplicate on same kit value ──────────────────────────────────────

  it("does NOT fire a duplicate event when kit stays the same on re-render", () => {
    _mockKit = "kit_stable";
    const { rerender } = renderClient();

    mockTrackEvent.mockClear();
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_ACTION_FILTER_KIT_CHANGED);
    expect(events).toHaveLength(0);
  });
});

describe("InventoryMapClient — layer toggle telemetry", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    _mockView = "M1";
    _mockActiveCaseId = null;
    _mockOrg = null;
    _mockKit = null;
    _mockLayers = ["cases", "clusters", "labels"];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 13. Fires enabled=true when a layer is added ────────────────────────

  it("fires INV_ACTION_LAYER_TOGGLED with enabled=true when a layer is added", () => {
    const { rerender } = renderClient();

    mockTrackEvent.mockClear();

    _mockLayers = ["cases", "clusters", "labels", "heat"];
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_ACTION_LAYER_TOGGLED);
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.eventCategory).toBe("user_action");
    expect(event.app).toBe("inventory");
    expect(event.layerId).toBe("heat");
    expect(event.enabled).toBe(true);
    expect(event.activeLayers).toEqual(["cases", "clusters", "labels", "heat"]);
  });

  // ─── 14. Fires enabled=false when a layer is removed ─────────────────────

  it("fires INV_ACTION_LAYER_TOGGLED with enabled=false when a layer is removed", () => {
    _mockLayers = ["cases", "clusters", "labels", "satellite"];
    const { rerender } = renderClient();

    mockTrackEvent.mockClear();

    _mockLayers = ["cases", "clusters", "labels"]; // satellite removed
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_ACTION_LAYER_TOGGLED);
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.layerId).toBe("satellite");
    expect(event.enabled).toBe(false);
    expect(event.activeLayers).toEqual(["cases", "clusters", "labels"]);
  });

  // ─── 15. Does NOT fire on initial render ─────────────────────────────────

  it("does NOT fire INV_ACTION_LAYER_TOGGLED on initial render", () => {
    _mockLayers = ["cases", "heat", "terrain"];
    renderClient();

    const events = callsForEvent(TelemetryEventName.INV_ACTION_LAYER_TOGGLED);
    expect(events).toHaveLength(0);
  });

  // ─── 16. Multiple layer changes fire one event per changed layer ──────────

  it("fires one INV_ACTION_LAYER_TOGGLED event per changed layer when multiple layers are added", () => {
    _mockLayers = ["cases", "clusters"];
    const { rerender } = renderClient();

    mockTrackEvent.mockClear();

    // Add "heat" and "terrain" simultaneously (e.g., via setLayers())
    _mockLayers = ["cases", "clusters", "heat", "terrain"];
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_ACTION_LAYER_TOGGLED);
    // One event for "heat" (added) + one for "terrain" (added)
    expect(events).toHaveLength(2);

    const layerIds = events.map((e) => e.layerId);
    expect(layerIds).toContain("heat");
    expect(layerIds).toContain("terrain");
    events.forEach((event) => {
      expect(event.enabled).toBe(true);
    });
  });

  it("fires events for both added and removed layers when a layer swap occurs", () => {
    _mockLayers = ["cases", "clusters", "labels"];
    const { rerender } = renderClient();

    mockTrackEvent.mockClear();

    // Remove "labels", add "heat"
    _mockLayers = ["cases", "clusters", "heat"];
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_ACTION_LAYER_TOGGLED);
    expect(events).toHaveLength(2); // one removed ("labels"), one added ("heat")

    const enabledEvent = events.find((e) => e.enabled === true);
    const disabledEvent = events.find((e) => e.enabled === false);

    expect(enabledEvent).toBeDefined();
    expect(enabledEvent!.layerId).toBe("heat");
    expect(disabledEvent).toBeDefined();
    expect(disabledEvent!.layerId).toBe("labels");
  });

  // ─── No duplicate on same layers array contents ───────────────────────────

  it("does NOT fire a duplicate event when layers array contents are the same on re-render", () => {
    _mockLayers = ["cases", "clusters", "labels"];
    const { rerender } = renderClient();

    mockTrackEvent.mockClear();
    // Same array contents (new reference — React re-renders even with the same values)
    _mockLayers = ["cases", "clusters", "labels"];
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    const events = callsForEvent(TelemetryEventName.INV_ACTION_LAYER_TOGGLED);
    expect(events).toHaveLength(0);
  });
});
