/**
 * @vitest-environment jsdom
 *
 * Unit tests: map mode switch telemetry for InventoryMapClient.
 *
 * Verifies that INV_NAV_MAP_VIEW_CHANGED is fired with the correct
 * `mapView` and `previousMapView` values on every M1-M5 transition.
 *
 * Strategy
 * ────────
 * • `trackEvent` is mocked at the module level so we can assert on
 *   exactly which events were emitted without touching any transport.
 * • `useMapParams` is mocked to return a controlled `view` value.
 * • Child components (M1-M5, CaseDetailPanel) and data hooks (useMissions,
 *   useCaseTemplates) are stubbed — they are irrelevant to the telemetry
 *   concern under test.
 * • `next/navigation` is mocked so the hooks that wrap useSearchParams
 *   and useRouter do not throw in jsdom.
 *
 * Covered scenarios
 * ─────────────────
 * 1. Initial render fires INV_NAV_MAP_VIEW_CHANGED with previousMapView = null.
 * 2. Switching views fires the event with the correct previous / current modes.
 * 3. Re-rendering with the same view does NOT emit a duplicate event.
 * 4. Rapid sequential switches chain previousMapView correctly.
 * 5. All five modes (M1-M5) are tracked as mapView values.
 * 6. Event shape includes the required fields (eventCategory, eventName, app).
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

// ─── Mock useMapParams (control active view without a real URL) ───────────────

let _mockView: MapView = "M1";

vi.mock("@/hooks/use-map-params", () => ({
  useMapParams: () => ({
    view: _mockView,
    activeCaseId: null,
    caseWindow: "T1",
    panelOpen: false,
    org: null,
    kit: null,
    at: null,
    layers: ["cases", "clusters", "labels"],
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

/**
 * Render the component with a given view and return the unmount helper.
 * Updates the mock view before rendering so useMapParams returns it.
 * initialState is seeded with the same view so the server-decoded prop
 * matches the mocked URL state.
 */
function renderWithView(view: MapView) {
  _mockView = view;
  return render(
    <InventoryMapClient
      initialState={{ ...MAP_URL_STATE_DEFAULTS, view }}
    />
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InventoryMapClient — map mode telemetry", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    _mockView = "M1";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. Initial render ────────────────────────────────────────────────────

  it("fires INV_NAV_MAP_VIEW_CHANGED on initial render with previousMapView = null", () => {
    renderWithView("M1");

    // Note: the component now also emits INV_NAV_PAGE_LOADED on mount.
    // We check for the specific INV_NAV_MAP_VIEW_CHANGED event rather than
    // asserting on total call count.
    const mapViewChangedCalls = mockTrackEvent.mock.calls
      .map((args: unknown[]) => args[0] as Record<string, unknown>)
      .filter((e) => e.eventName === TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED);

    expect(mapViewChangedCalls).toHaveLength(1);
    expect(mapViewChangedCalls[0]).toMatchObject({
      eventCategory: "navigation",
      eventName: TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED,
      app: "inventory",
      mapView: "M1",
      previousMapView: null,
    });
  });

  it("fires with the correct mapView when starting on M3", () => {
    renderWithView("M3");

    const mapViewChangedCalls = mockTrackEvent.mock.calls
      .map((args: unknown[]) => args[0] as Record<string, unknown>)
      .filter((e) => e.eventName === TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED);

    expect(mapViewChangedCalls).toHaveLength(1);
    expect(mapViewChangedCalls[0]).toMatchObject({
      mapView: "M3",
      previousMapView: null,
    });
  });

  // ─── 2. View switch ───────────────────────────────────────────────────────

  it("fires the event with correct previousMapView when switching M1 → M2", () => {
    const { rerender } = renderWithView("M1");

    mockTrackEvent.mockClear(); // ignore the initial-render event
    _mockView = "M2";
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    expect(mockTrackEvent).toHaveBeenCalledOnce();
    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED,
        mapView: "M2",
        previousMapView: "M1",
      })
    );
  });

  it("fires the event with correct previousMapView when switching M2 → M4", () => {
    const { rerender } = renderWithView("M2");

    mockTrackEvent.mockClear();
    _mockView = "M4";
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        mapView: "M4",
        previousMapView: "M2",
      })
    );
  });

  // ─── 3. No duplicate on same view ─────────────────────────────────────────

  it("does NOT fire a duplicate event when the view stays the same on re-render", () => {
    const { rerender } = renderWithView("M1");

    mockTrackEvent.mockClear(); // clear initial event
    // Re-render with the same view (e.g., unrelated state update)
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  // ─── 4. Sequential rapid switches chain previousMapView ───────────────────

  it("chains previousMapView correctly across M1 → M2 → M3", () => {
    const { rerender } = renderWithView("M1");

    // M1 → M2
    mockTrackEvent.mockClear();
    _mockView = "M2";
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ mapView: "M2", previousMapView: "M1" })
    );

    // M2 → M3
    mockTrackEvent.mockClear();
    _mockView = "M3";
    rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ mapView: "M3", previousMapView: "M2" })
    );
  });

  it("chains correctly across all five modes M1 → M2 → M3 → M4 → M5", () => {
    const views: MapView[] = ["M1", "M2", "M3", "M4", "M5"];
    const { rerender } = renderWithView("M1");

    const capturedEvents: Array<{ mapView: MapView; previousMapView: MapView | null }> = [];

    // Collect the initial event
    capturedEvents.push(mockTrackEvent.mock.calls[0][0] as { mapView: MapView; previousMapView: MapView | null });

    // Transition through M2-M5
    for (let i = 1; i < views.length; i++) {
      mockTrackEvent.mockClear();
      _mockView = views[i];
      rerender(<InventoryMapClient initialState={{ ...MAP_URL_STATE_DEFAULTS, view: "M1" }} />);
      if (mockTrackEvent.mock.calls.length > 0) {
        capturedEvents.push(mockTrackEvent.mock.calls[0][0] as { mapView: MapView; previousMapView: MapView | null });
      }
    }

    expect(capturedEvents).toHaveLength(5);
    expect(capturedEvents[0]).toMatchObject({ mapView: "M1", previousMapView: null });
    expect(capturedEvents[1]).toMatchObject({ mapView: "M2", previousMapView: "M1" });
    expect(capturedEvents[2]).toMatchObject({ mapView: "M3", previousMapView: "M2" });
    expect(capturedEvents[3]).toMatchObject({ mapView: "M4", previousMapView: "M3" });
    expect(capturedEvents[4]).toMatchObject({ mapView: "M5", previousMapView: "M4" });
  });

  // ─── 5. All five modes are valid mapView values ───────────────────────────

  it.each<MapView>(["M1", "M2", "M3", "M4", "M5"])(
    "emits correct mapView=%s on initial render",
    (mode) => {
      renderWithView(mode);

      expect(mockTrackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED,
          mapView: mode,
        })
      );
    }
  );

  // ─── 6. Event shape ───────────────────────────────────────────────────────

  it("event has required shape fields: eventCategory, eventName, app", () => {
    renderWithView("M1");

    const [event] = mockTrackEvent.mock.calls[0] as [Record<string, unknown>];
    expect(event.eventCategory).toBe("navigation");
    expect(event.eventName).toBe(TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED);
    expect(event.app).toBe("inventory");
  });
});
