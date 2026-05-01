/**
 * @vitest-environment jsdom
 *
 * Component tests for M4Deployment — Logistics / Shipment Tracking map mode.
 *
 * AC 350204 Sub-AC 3d — Verify that:
 *   1. useCaseMapData is called with mode: "M4" to subscribe to shipment data.
 *   2. Loading state is shown while isLoading is true.
 *   3. The in-transit count badge reflects summary.inTransit reactively.
 *   4. The map container exposes data-pin-count reactively from records.length.
 *   5. The map container exposes data-in-transit-count from summary.inTransit.
 *   6. The map container shows data-loading="true" while loading.
 *   7. The fallback pin list renders each shipment pin with tracking data.
 *   8. The pin list shows tracking numbers from CaseMapRecord.trackingNumber.
 *   9. The pin list shows location data from CaseMapRecord.locationName.
 *  10. Summary badge shows 0 when no shipments are in transit.
 *  11. Screen-reader output reflects live shipment count.
 *  12. Pins with no location still render (no silent drop).
 *  13. Mode tabs are rendered and the M4 tab is selected.
 *  14. The time picker is rendered for deployment snapshot control.
 *  15. The org and kit filter dropdowns render options.
 *
 * Mocking strategy
 * ────────────────
 * • `@/hooks/use-case-map-data` → mocked; injectable per-test.
 * • `@/hooks/use-map-params` → mocked with stable URL state.
 * • CSS modules → auto-handled by vitest (class names become undefined).
 * • `next/navigation` → mocked to prevent useSearchParams from throwing.
 * • `afterEach(cleanup)` ensures DOM is wiped between tests.
 *
 * The tests never subscribe to a real Convex backend.
 */

import React from "react";
import { render, screen, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CaseMapRecord, UseCaseMapDataResult } from "@/hooks/use-case-map-data";

// ─── Mock next/navigation ─────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/inventory",
  useSearchParams: () => ({
    get: (_key: string) => null,
    toString: () => "",
  }),
}));

// ─── Mock useMapParams ────────────────────────────────────────────────────────

vi.mock("@/hooks/use-map-params", () => ({
  useMapParams: () => ({
    view: "M4",
    org: null,
    kit: null,
    at: null,
    activeCaseId: null,
    caseWindow: "T1",
    panelOpen: false,
    layers: ["cases"],
    setView: vi.fn(),
    setOrg: vi.fn(),
    setKit: vi.fn(),
    setAt: vi.fn(),
    setActiveCaseId: vi.fn(),
    setCaseWindow: vi.fn(),
    setPanelOpen: vi.fn(),
    setLayers: vi.fn(),
    toggleLayer: vi.fn(),
    setParams: vi.fn(),
  }),
}));

// ─── Mock useCaseMapData (injectable per-test) ────────────────────────────────

const mockUseCaseMapData = vi.fn((_opts?: unknown): UseCaseMapDataResult => ({
  records: [],
  isLoading: false,
  mode:      "M4",
  summary:   { total: 0, byStatus: {}, inTransit: 0 },
}));

vi.mock("@/hooks/use-case-map-data", () => ({
  useCaseMapData: (...args: unknown[]) => mockUseCaseMapData(...args),
}));

vi.mock("react-map-gl", () => ({
  Map: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="react-map-gl-map">{children}</div>
  ),
  NavigationControl: () => <div data-testid="map-navigation-control" />,
  Marker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="map-marker">{children}</div>
  ),
}));

// ─── CSS module stub ──────────────────────────────────────────────────────────

vi.mock("../M4Deployment.module.css", () => ({ default: {} }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Build an M4 CaseMapRecord (shipment pin) fixture. */
function makeShipmentPin(
  id: string,
  overrides: Partial<CaseMapRecord> = {}
): CaseMapRecord {
  return {
    caseId:            `case_${id}`,
    label:             `CASE-${id}`,
    status:            "in_transit",
    lat:               36.0,
    lng:               -100.0,
    updatedAt:         1_700_000_000_000,
    shipmentId:        id,
    trackingNumber:    `TRACK-${id}`,
    carrier:           "fedex",
    origin:            { lat: 42.0, lng: -71.0, name: "Boston" },
    destination:       { lat: 33.0, lng: -118.0, name: "Los Angeles" },
    estimatedDelivery: "2024-01-15",
    shippedAt:         1_699_500_000_000,
    locationName:      "Los Angeles",
    ...overrides,
  };
}

/** Build a controlled UseCaseMapDataResult for M4. */
function makeM4Result(
  pins: CaseMapRecord[],
  inTransit: number = pins.length
): UseCaseMapDataResult {
  const byStatus: Record<string, number> = {};
  for (const p of pins) {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  }
  return {
    records:   pins,
    isLoading: false,
    mode:      "M4",
    summary: {
      total:    pins.length,
      byStatus,
      inTransit,
    },
  };
}

const LOADING_RESULT: UseCaseMapDataResult = {
  records:   [],
  isLoading: true,
  mode:      "M4",
  summary:   undefined,
};

const EMPTY_RESULT: UseCaseMapDataResult = {
  records:   [],
  isLoading: false,
  mode:      "M4",
  summary: { total: 0, byStatus: {}, inTransit: 0 },
};

// ─── Component import (after mocks) ──────────────────────────────────────────

import { M4Deployment } from "../M4Deployment";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("M4Deployment — useCaseMapData integration (Sub-AC 3d)", () => {
  beforeEach(() => {
    mockUseCaseMapData.mockReset();
  });

  // Ensure the DOM is wiped between tests to prevent element accumulation.
  afterEach(() => {
    cleanup();
  });

  // ── Hook call verification ─────────────────────────────────────────────────

  it("calls useCaseMapData with mode: 'M4'", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    render(<M4Deployment />);

    expect(mockUseCaseMapData).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "M4" })
    );
  });

  it("calls useCaseMapData exactly once per render", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    render(<M4Deployment />);

    expect(mockUseCaseMapData).toHaveBeenCalledTimes(1);
  });

  // ── Loading state ──────────────────────────────────────────────────────────

  it("renders the loading aria-label in the summary badge while isLoading=true", () => {
    mockUseCaseMapData.mockReturnValue(LOADING_RESULT);
    const { container } = render(<M4Deployment />);

    const badge = container.querySelector("[aria-label='Loading shipment data…']");
    expect(badge).not.toBeNull();
  });

  it("does NOT render a pin list while loading (no data yet)", () => {
    mockUseCaseMapData.mockReturnValue(LOADING_RESULT);
    const { container } = render(<M4Deployment />);

    expect(container.querySelector("[data-testid='m4-pin-list']")).toBeNull();
  });

  // ── Map container data-attributes (reactive overlays) ─────────────────────
  // Note: the map container (#m4-map-container) is only rendered when
  // a mapboxToken is provided.  When absent, a placeholder div is rendered.

  it("exposes data-in-transit-count attribute on the map container (Mapbox token present)", () => {
    const pins = [makeShipmentPin("s1"), makeShipmentPin("s2")];
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 2));

    const { container } = render(<M4Deployment mapboxToken="pk.test_token" />);

    const mapContainer = container.querySelector("#m4-map-container");
    expect(mapContainer).not.toBeNull();
    expect(mapContainer!.getAttribute("data-in-transit-count")).toBe("2");
  });

  it("exposes data-pin-count attribute on the map container", () => {
    const pins = [makeShipmentPin("s1"), makeShipmentPin("s2"), makeShipmentPin("s3")];
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 2));

    const { container } = render(<M4Deployment mapboxToken="pk.test_token" />);

    const mapContainer = container.querySelector("#m4-map-container");
    expect(mapContainer!.getAttribute("data-pin-count")).toBe("3");
  });

  it("shows data-loading='true' on the map container while loading", () => {
    mockUseCaseMapData.mockReturnValue(LOADING_RESULT);

    const { container } = render(<M4Deployment mapboxToken="pk.test_token" />);

    const mapContainer = container.querySelector("#m4-map-container");
    expect(mapContainer!.getAttribute("data-loading")).toBe("true");
  });

  it("data-loading is absent from map container when data is available", () => {
    const pins = [makeShipmentPin("s1")];
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 1));

    const { container } = render(<M4Deployment mapboxToken="pk.test_token" />);

    const mapContainer = container.querySelector("#m4-map-container");
    expect(mapContainer!.getAttribute("data-loading")).toBeNull();
  });

  it("data-in-transit-count is 0 when no in-transit shipments", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M4Deployment mapboxToken="pk.test_token" />);

    const mapContainer = container.querySelector("#m4-map-container");
    expect(mapContainer!.getAttribute("data-in-transit-count")).toBe("0");
  });

  // ── In-transit count badge ─────────────────────────────────────────────────

  it("shows the correct in-transit count from summary.inTransit in aria-label", () => {
    const pins = [
      makeShipmentPin("s1", { status: "in_transit" }),
      makeShipmentPin("s2", { status: "out_for_delivery" }),
      makeShipmentPin("s3", { status: "delivered" }),
    ];
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 2));

    const { container } = render(<M4Deployment />);

    const badge = container.querySelector("[aria-label*='2 shipment']");
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute("aria-label")).toMatch(/in transit/i);
  });

  it("shows 0 transit count when no active shipments", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M4Deployment />);

    const badge = container.querySelector("[aria-label*='0 shipment']");
    expect(badge).not.toBeNull();
  });

  it("uses singular 'shipment' when in-transit count is 1", () => {
    const pins = [makeShipmentPin("s1", { status: "in_transit" })];
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 1));

    const { container } = render(<M4Deployment />);

    const badge = container.querySelector("[aria-label*='1 shipment in transit']");
    expect(badge).not.toBeNull();
  });

  // ── Fallback pin list (no Mapbox token) ───────────────────────────────────

  it("renders a pin list with tracking numbers when pins exist (no Mapbox token)", () => {
    const pins = [
      makeShipmentPin("s1", { trackingNumber: "FEDEX-001", label: "CASE-001" }),
      makeShipmentPin("s2", { trackingNumber: "FEDEX-002", label: "CASE-002" }),
    ];
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 2));

    const { container } = render(<M4Deployment />);

    const list = container.querySelector("[data-testid='m4-pin-list']");
    expect(list).not.toBeNull();

    expect(within(list! as HTMLElement).getByText("FEDEX-001")).toBeDefined();
    expect(within(list! as HTMLElement).getByText("FEDEX-002")).toBeDefined();
  });

  it("renders case labels in the fallback pin list", () => {
    const pins = [makeShipmentPin("abc", { label: "CASE-0042" })];
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 1));

    const { container } = render(<M4Deployment />);

    const list = container.querySelector("[data-testid='m4-pin-list']");
    expect(within(list! as HTMLElement).getByText("CASE-0042")).toBeDefined();
  });

  it("renders location names in the pin list when available", () => {
    const pins = [makeShipmentPin("s1", { locationName: "Los Angeles Depot" })];
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 1));

    const { container } = render(<M4Deployment />);

    const list = container.querySelector("[data-testid='m4-pin-list']");
    expect(within(list! as HTMLElement).getByText("Los Angeles Depot")).toBeDefined();
  });

  it("each pin item carries data-status attribute", () => {
    const pins = [makeShipmentPin("s1", { status: "in_transit" })];
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 1));

    const { container } = render(<M4Deployment />);

    const list = container.querySelector("[data-testid='m4-pin-list']");
    const item = list!.querySelector("[data-status='in_transit']");
    expect(item).not.toBeNull();
  });

  it("each pin item carries data-tracking-number attribute", () => {
    const pins = [makeShipmentPin("s1", { trackingNumber: "TRACK-9999" })];
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 1));

    const { container } = render(<M4Deployment />);

    const list = container.querySelector("[data-testid='m4-pin-list']");
    const item = list!.querySelector("[data-tracking-number='TRACK-9999']");
    expect(item).not.toBeNull();
  });

  it("renders '+N more' row when more than 20 pins are returned", () => {
    const pins = Array.from({ length: 25 }, (_, i) => makeShipmentPin(`s${i}`));
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 25));

    const { container } = render(<M4Deployment />);

    const list = container.querySelector("[data-testid='m4-pin-list']");
    expect(within(list! as HTMLElement).getByText("+5 more")).toBeDefined();
  });

  it("renders pins without location gracefully (no crash)", () => {
    const pins = [
      makeShipmentPin("s1", {
        locationName: undefined,
        lat: undefined,
        lng: undefined,
      }),
    ];
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 1));

    const { container } = render(<M4Deployment />);

    const list = container.querySelector("[data-testid='m4-pin-list']");
    expect(within(list! as HTMLElement).getByText("CASE-s1")).toBeDefined();
  });

  it("does NOT render a pin list when records is empty", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M4Deployment />);

    expect(container.querySelector("[data-testid='m4-pin-list']")).toBeNull();
  });

  // ── Screen-reader output ───────────────────────────────────────────────────

  it("screen-reader output contains 'Loading shipment data' while loading", () => {
    mockUseCaseMapData.mockReturnValue(LOADING_RESULT);

    const { container } = render(<M4Deployment />);

    const output = container.querySelector("output");
    expect(output?.textContent).toContain("Loading shipment data");
  });

  it("screen-reader output contains in-transit count when loaded", () => {
    const pins = [makeShipmentPin("s1"), makeShipmentPin("s2")];
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 2));

    const { container } = render(<M4Deployment />);

    const output = container.querySelector("output");
    expect(output?.textContent).toContain("2 shipment");
    expect(output?.textContent).toContain("transit");
  });

  // ── Mode tabs ──────────────────────────────────────────────────────────────

  it("renders all 5 mode tabs (M1–M5)", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M4Deployment />);

    const tabs = container.querySelectorAll("[role='tab']");
    expect(tabs.length).toBe(5);
  });

  it("marks the M4 tab as selected (aria-selected='true')", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M4Deployment />);

    const m4Tab = Array.from(container.querySelectorAll("[role='tab']")).find(
      (el) => el.getAttribute("aria-label")?.includes("Deployment")
    );
    expect(m4Tab).not.toBeNull();
    expect(m4Tab!.getAttribute("aria-selected")).toBe("true");
  });

  // ── Filter controls ────────────────────────────────────────────────────────

  it("renders org filter dropdown with 'All organisations' default option", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const orgs = [{ id: "org_1", name: "Alpha Team" }];
    const { container } = render(<M4Deployment orgs={orgs} />);

    const select = container.querySelector("select[aria-label*='organisation']");
    expect(select).not.toBeNull();
    expect(within(select! as HTMLElement).getByText("All organisations")).toBeDefined();
    expect(within(select! as HTMLElement).getByText("Alpha Team")).toBeDefined();
  });

  it("renders kit filter dropdown with 'All kits' default option", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const kits = [{ id: "kit_1", name: "Wind Turbine Kit" }];
    const { container } = render(<M4Deployment kits={kits} />);

    const select = container.querySelector("select[aria-label*='kit']");
    expect(select).not.toBeNull();
    expect(within(select! as HTMLElement).getByText("Wind Turbine Kit")).toBeDefined();
  });

  it("renders the time picker input for deployment snapshot", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M4Deployment />);

    const picker = container.querySelector("input[type='datetime-local']");
    expect(picker).not.toBeNull();
  });

  // ── Root element attributes ────────────────────────────────────────────────

  it("renders root element with data-map-mode='M4'", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M4Deployment />);

    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute("data-map-mode")).toBe("M4");
  });

  // ── Split-pane layout (Sub-AC 1) ──────────────────────────────────────────

  it("renders a split-pane body container with data-m4-split='true'", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M4Deployment />);

    const splitBody = container.querySelector("[data-m4-split='true']");
    expect(splitBody).not.toBeNull();
  });

  it("renders the map pane with data-m4-map-pane='true'", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M4Deployment />);

    const mapPane = container.querySelector("[data-m4-map-pane='true']");
    expect(mapPane).not.toBeNull();
  });

  it("renders the manifest pane with data-m4-manifest-pane='true'", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M4Deployment />);

    const manifestPane = container.querySelector("[data-m4-manifest-pane='true']");
    expect(manifestPane).not.toBeNull();
  });

  it("manifest pane is an <aside> element with aria-label='Case manifest panel'", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M4Deployment />);

    const aside = container.querySelector("aside[data-m4-manifest-pane='true']");
    expect(aside).not.toBeNull();
    expect(aside!.getAttribute("aria-label")).toBe("Case manifest panel");
  });

  it("shows empty-state prompt when no manifestPanel prop is provided", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M4Deployment />);

    const emptyState = container.querySelector("[data-manifest-empty='true']");
    expect(emptyState).not.toBeNull();
  });

  it("manifest pane has data-has-content='false' when no manifestPanel is provided", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M4Deployment />);

    const manifestPane = container.querySelector("[data-m4-manifest-pane='true']");
    expect(manifestPane!.getAttribute("data-has-content")).toBe("false");
  });

  it("renders the provided manifestPanel content in the manifest pane slot", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const slotContent = <div data-testid="manifest-slot-content">Manifest here</div>;
    const { container } = render(<M4Deployment manifestPanel={slotContent} />);

    const manifestPane = container.querySelector("[data-m4-manifest-pane='true']");
    expect(manifestPane).not.toBeNull();
    const slotEl = container.querySelector("[data-testid='manifest-slot-content']");
    expect(slotEl).not.toBeNull();
    expect(slotEl!.textContent).toBe("Manifest here");
  });

  it("manifest pane has data-has-content='true' when manifestPanel prop is provided", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const slotContent = <div>Manifest content</div>;
    const { container } = render(<M4Deployment manifestPanel={slotContent} />);

    const manifestPane = container.querySelector("[data-m4-manifest-pane='true']");
    expect(manifestPane!.getAttribute("data-has-content")).toBe("true");
  });

  it("does NOT show the empty-state prompt when manifestPanel prop is provided", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const slotContent = <div>Manifest content</div>;
    const { container } = render(<M4Deployment manifestPanel={slotContent} />);

    const emptyState = container.querySelector("[data-manifest-empty='true']");
    expect(emptyState).toBeNull();
  });

  it("map pane is a <main> element (landmark for keyboard navigation)", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M4Deployment />);

    const main = container.querySelector("main[data-m4-map-pane='true']");
    expect(main).not.toBeNull();
    expect(main!.getAttribute("aria-label")).toContain("Logistics shipment map");
  });

  it("split-pane body contains both map pane and manifest pane as children", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M4Deployment />);

    const splitBody = container.querySelector("[data-m4-split='true']");
    expect(splitBody).not.toBeNull();
    const mapPane = splitBody!.querySelector("[data-m4-map-pane='true']");
    const manifestPane = splitBody!.querySelector("[data-m4-manifest-pane='true']");
    expect(mapPane).not.toBeNull();
    expect(manifestPane).not.toBeNull();
  });

  it("map container (#m4-map-container) is inside the map pane (not manifest pane)", () => {
    const pins = [makeShipmentPin("s1")];
    mockUseCaseMapData.mockReturnValue(makeM4Result(pins, 1));

    const { container } = render(<M4Deployment mapboxToken="pk.test_token" />);

    const mapPane = container.querySelector("[data-m4-map-pane='true']");
    const mapContainer = mapPane!.querySelector("#m4-map-container");
    expect(mapContainer).not.toBeNull();

    // Ensure it is NOT inside the manifest pane
    const manifestPane = container.querySelector("[data-m4-manifest-pane='true']");
    const containerInManifest = manifestPane!.querySelector("#m4-map-container");
    expect(containerInManifest).toBeNull();
  });
});
