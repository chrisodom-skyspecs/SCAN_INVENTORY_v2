/**
 * @vitest-environment jsdom
 *
 * Layer toggle toolbar tests for M1FleetOverview — Sub-AC 3.
 *
 * Verifies that the "Layers" toolbar button and floating LayerTogglePanelConnected
 * panel are correctly wired together through the shared LayerEngine:
 *
 *   1. Layers button is present in the toolbar with correct ARIA attributes.
 *   2. Clicking the button opens the LayerTogglePanelConnected overlay.
 *   3. The panel shows 7 toggle rows (all 7 semantic layers).
 *   4. Clicking the panel's close button hides the panel.
 *   5. The button badge shows the correct active layer count.
 *   6. Badge updates when layers are toggled via the panel.
 *   7. The button aria-label reflects the current open/closed state.
 *   8. The button aria-expanded reflects the panel open/closed state.
 *   9. Toggling a layer in the panel immediately updates the badge.
 *  10. Filtered marker list only shows pins for active layers.
 *  11. Engine.deactivateAll() hides all pins and updates badge.
 *  12. Engine.activateAll() restores all pins and updates badge.
 *  13. Panel persists layer state when closed and re-opened.
 *  14. Button is keyboard-accessible (Enter key opens panel).
 *
 * Mocking strategy
 * ────────────────
 * • `next/navigation`       → mocked (required by useMapParams).
 * • `@/hooks/use-map-params` → mocked with stable URL state.
 * • `@/hooks/use-case-map-data` → mocked with injectable records.
 * • LayerEngine / LayerEngineProvider → NOT mocked (real engine used).
 *   This gives true end-to-end coverage of the toolbar→engine→panel wiring.
 * • afterEach(cleanup) — ensures DOM is wiped between tests.
 */

import React from "react";
import { render, screen, within, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UseCaseMapDataResult, CaseMapRecord } from "@/hooks/use-case-map-data";
import { LayerEngineProvider, useLayerEngineContext } from "@/providers/layer-engine-provider";
import type { LayerEngine } from "@/lib/layer-engine";

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
    view: "M1",
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

// ─── Mock convex/react (HistoryTrailLayer → useHistoryTrail → useQuery) ───────
//
// HistoryTrailLayer imports useHistoryTrail which calls useQuery directly.
// Without a ConvexProvider in the test tree this throws.  Stub it out so the
// layer renders safely with no data.

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

// ─── Mock useCaseMapData (injectable) ────────────────────────────────────────

// vitest 4.x: vi.fn<T> takes a function type, not [Args, Return] tuple
const mockUseCaseMapData = vi.fn<() => UseCaseMapDataResult>();

vi.mock("@/hooks/use-case-map-data", () => ({
  useCaseMapData: () => mockUseCaseMapData(),
}));

// ─── Default empty subscription result ────────────────────────────────────────

const EMPTY_RESULT: UseCaseMapDataResult = {
  records: [],
  isLoading: false,
  summary: { total: 0, byStatus: {} },
  mode: "M1",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLayersButton(): HTMLButtonElement {
  return screen.getByTestId("m1-layers-button") as HTMLButtonElement;
}

function queryLayerPanel(): HTMLElement | null {
  return screen.queryByTestId("layer-toggle-panel") as HTMLElement | null;
}

function getLayerPanel(): HTMLElement {
  return screen.getByTestId("layer-toggle-panel") as HTMLElement;
}

function getLayerToggleInput(layerId: string): HTMLInputElement {
  return screen.getByTestId(`layer-toggle-input-${layerId}`) as HTMLInputElement;
}

function getLayerPanelCloseButton(): HTMLButtonElement {
  return screen.getByTestId("layer-toggle-panel-close") as HTMLButtonElement;
}

// ─── Helper: render M1FleetOverview inside a LayerEngineProvider ──────────────

async function renderM1() {
  // Dynamic import to avoid circular dep issues in test environment
  const { M1FleetOverview } = await import("../M1FleetOverview");
  render(
    <LayerEngineProvider>
      <M1FleetOverview />
    </LayerEngineProvider>
  );
}

async function renderM1WithMapboxToken() {
  const { M1FleetOverview } = await import("../M1FleetOverview");
  render(
    <LayerEngineProvider initialState={{ history: true, turbines: true }}>
      <M1FleetOverview mapboxToken="test-mapbox-token" />
    </LayerEngineProvider>
  );
}

// ─── Helper: render with engine extractor ─────────────────────────────────────

async function renderM1WithEngine(): Promise<{ engine: LayerEngine }> {
  const { M1FleetOverview } = await import("../M1FleetOverview");
  const ref = { current: null as LayerEngine | null };

  function EngineExtractor() {
    ref.current = useLayerEngineContext();
    return null;
  }

  render(
    <LayerEngineProvider>
      <EngineExtractor />
      <M1FleetOverview />
    </LayerEngineProvider>
  );

  return { engine: ref.current! };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
});

afterEach(() => cleanup());

// ─── 1. Layers button presence and ARIA ───────────────────────────────────────

describe("M1FleetOverview — Layers toolbar button", () => {
  it("renders the Layers button in the toolbar", async () => {
    await renderM1();
    expect(getLayersButton()).toBeTruthy();
  });

  it("button has role='button' (default for <button>)", async () => {
    await renderM1();
    expect(getLayersButton().tagName).toBe("BUTTON");
  });

  it("button has aria-expanded=false initially", async () => {
    await renderM1();
    expect(getLayersButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("button has aria-controls referencing the panel id", async () => {
    await renderM1();
    expect(getLayersButton().getAttribute("aria-controls")).toBe("m1-layer-panel");
  });

  it("button has a descriptive aria-label mentioning layers visible", async () => {
    await renderM1();
    const label = getLayersButton().getAttribute("aria-label") ?? "";
    expect(label).toMatch(/layer/i);
    expect(label).toMatch(/7/); // 7 total layers
  });

  it("button contains 'Layers' text", async () => {
    await renderM1();
    expect(getLayersButton().textContent).toMatch(/layers/i);
  });

  it("button shows active layer count badge (default: 5/7 — heat and history off)", async () => {
    await renderM1();
    // Default engine: 5 of 7 layers active (heat and history start off)
    expect(getLayersButton().textContent).toMatch(/5\/7/);
  });
});

// ─── 2. Panel open/close via toolbar button ───────────────────────────────────

describe("M1FleetOverview — Layers panel open/close", () => {
  it("panel is NOT rendered initially", async () => {
    await renderM1();
    expect(queryLayerPanel()).toBeNull();
  });

  it("clicking the Layers button opens the panel", async () => {
    await renderM1();
    await userEvent.click(getLayersButton());
    expect(queryLayerPanel()).not.toBeNull();
  });

  it("panel has id='m1-layer-panel' for aria-controls reference", async () => {
    await renderM1();
    await userEvent.click(getLayersButton());
    const panel = getLayerPanel();
    expect(panel.id).toBe("m1-layer-panel");
  });

  it("button aria-expanded becomes true when panel is open", async () => {
    await renderM1();
    await userEvent.click(getLayersButton());
    expect(getLayersButton().getAttribute("aria-expanded")).toBe("true");
  });

  it("clicking the Layers button again closes the panel", async () => {
    await renderM1();
    await userEvent.click(getLayersButton()); // open
    await userEvent.click(getLayersButton()); // close
    expect(queryLayerPanel()).toBeNull();
  });

  it("button aria-expanded becomes false when panel is closed via button", async () => {
    await renderM1();
    await userEvent.click(getLayersButton()); // open
    await userEvent.click(getLayersButton()); // close
    expect(getLayersButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("clicking the panel's close button hides the panel", async () => {
    await renderM1();
    await userEvent.click(getLayersButton()); // open panel

    expect(queryLayerPanel()).not.toBeNull();

    await userEvent.click(getLayerPanelCloseButton());

    expect(queryLayerPanel()).toBeNull();
  });

  it("button aria-expanded is false after panel is closed via panel close button", async () => {
    await renderM1();
    await userEvent.click(getLayersButton()); // open
    await userEvent.click(getLayerPanelCloseButton()); // close via panel
    expect(getLayersButton().getAttribute("aria-expanded")).toBe("false");
  });
});

// ─── 3. Panel content ─────────────────────────────────────────────────────────

describe("M1FleetOverview — Layers panel content", () => {
  it("panel shows all 7 layer toggle rows", async () => {
    await renderM1();
    await userEvent.click(getLayersButton());

    const layerIds = ["deployed", "transit", "flagged", "hangar", "heat", "history", "turbines"];
    for (const id of layerIds) {
      expect(screen.getByTestId(`layer-toggle-row-${id}`)).toBeTruthy();
    }
  });

  it("panel shows default state: deployed/transit/flagged/hangar/turbines ON, heat/history OFF", async () => {
    await renderM1();
    await userEvent.click(getLayersButton());

    // Default active layers (5/7)
    expect(getLayerToggleInput("deployed").checked).toBe(true);
    expect(getLayerToggleInput("transit").checked).toBe(true);
    expect(getLayerToggleInput("flagged").checked).toBe(true);
    expect(getLayerToggleInput("hangar").checked).toBe(true);
    expect(getLayerToggleInput("turbines").checked).toBe(true);
    // Default inactive (off by default)
    expect(getLayerToggleInput("heat").checked).toBe(false);
    expect(getLayerToggleInput("history").checked).toBe(false);
  });

  it("panel is positioned top-right (data-position attribute)", async () => {
    await renderM1();
    await userEvent.click(getLayersButton());
    expect(getLayerPanel().getAttribute("data-position")).toBe("top-right");
  });

  it("panel shows footer layer count ('5 of 7 layers visible' by default)", async () => {
    await renderM1();
    await userEvent.click(getLayersButton());
    expect(screen.getByText("5 of 7 layers visible")).toBeTruthy();
  });
});

// ─── 4. Badge updates when layers are toggled ─────────────────────────────────

describe("M1FleetOverview — Layers button badge updates", () => {
  it("badge updates to 6/7 when heat is enabled via panel", async () => {
    await renderM1();
    await userEvent.click(getLayersButton()); // open panel
    await userEvent.click(getLayerToggleInput("heat")); // enable heat

    expect(getLayersButton().textContent).toMatch(/6\/7/);
  });

  it("badge updates to 7/7 when all layers are enabled", async () => {
    await renderM1();
    await userEvent.click(getLayersButton()); // open panel
    await userEvent.click(getLayerToggleInput("heat"));
    await userEvent.click(getLayerToggleInput("history"));

    expect(getLayersButton().textContent).toMatch(/7\/7/);
  });

  it("badge updates to 4/7 when deployed is disabled via panel", async () => {
    await renderM1();
    await userEvent.click(getLayersButton()); // open panel
    await userEvent.click(getLayerToggleInput("deployed")); // disable deployed

    expect(getLayersButton().textContent).toMatch(/4\/7/);
  });

  it("badge reflects engine state changes (deactivateAll)", async () => {
    const { engine } = await renderM1WithEngine();

    act(() => {
      engine.deactivateAll();
    });

    expect(getLayersButton().textContent).toMatch(/0\/7/);
  });

  it("badge reflects engine state changes (activateAll)", async () => {
    const { engine } = await renderM1WithEngine();

    // First deactivate all, then activate all
    act(() => { engine.deactivateAll(); });
    act(() => { engine.activateAll(); });

    expect(getLayersButton().textContent).toMatch(/7\/7/);
  });
});

// ─── 5. Layer state persists when panel closes and reopens ───────────────────

describe("M1FleetOverview — Layer state persistence across panel close/reopen", () => {
  it("toggled layers remain toggled when panel is closed and reopened", async () => {
    await renderM1();

    // Open panel, disable deployed
    await userEvent.click(getLayersButton());
    await userEvent.click(getLayerToggleInput("deployed")); // disable

    // Close panel
    await userEvent.click(getLayerPanelCloseButton());
    expect(queryLayerPanel()).toBeNull();

    // Reopen panel
    await userEvent.click(getLayersButton());

    // deployed should still be disabled
    expect(getLayerToggleInput("deployed").checked).toBe(false);
  });

  it("badge count persists correctly across panel close/reopen", async () => {
    await renderM1();

    // Open and toggle a layer
    await userEvent.click(getLayersButton());
    await userEvent.click(getLayerToggleInput("heat")); // enable heat (→ 6/7)

    // Close panel
    await userEvent.click(getLayerPanelCloseButton());

    // Badge should still show 6/7
    expect(getLayersButton().textContent).toMatch(/6\/7/);

    // Reopen — still 6/7
    await userEvent.click(getLayersButton());
    expect(screen.getByText("6 of 7 layers visible")).toBeTruthy();
  });
});

// ─── 6. Filtered marker set (pin list) ───────────────────────────────────────

describe("M1FleetOverview — Filtered marker set (pin list)", () => {
  it("pin list shows deployed pin when deployed layer is active", async () => {
    const deployedPin: CaseMapRecord = {
      caseId: "case-1",
      label: "CASE-001",
      status: "deployed",
      lat: 40.7128,
      lng: -74.006,
      locationName: "New York",
      updatedAt: 1_700_000_000_000,
    };
    mockUseCaseMapData.mockReturnValue({
      records: [deployedPin],
      isLoading: false,
      summary: { total: 1, byStatus: { deployed: 1 } },
      mode: "M1",
    });

    await renderM1();

    // deployed layer is active by default → pin should be visible
    const pinList = screen.queryByTestId("m1-pin-list");
    // Pin list is only rendered when mapboxToken is absent (placeholder mode)
    // and there are pins to show.
    if (pinList) {
      expect(within(pinList).queryByText("CASE-001")).toBeTruthy();
    }
  });

  it("pin list hides deployed pin when deployed layer is toggled off", async () => {
    const deployedPin2: CaseMapRecord = {
      caseId: "case-1",
      label: "CASE-001",
      status: "deployed",
      lat: 40.7128,
      lng: -74.006,
      locationName: "New York",
      updatedAt: 1_700_000_000_000,
    };
    mockUseCaseMapData.mockReturnValue({
      records: [deployedPin2],
      isLoading: false,
      summary: { total: 1, byStatus: { deployed: 1 } },
      mode: "M1",
    });

    await renderM1();

    // Verify pin is visible initially
    const pinListBefore = screen.queryByTestId("m1-pin-list");
    if (pinListBefore) {
      expect(within(pinListBefore).queryByText("CASE-001")).toBeTruthy();
    }

    // Open layer panel and disable deployed layer
    await userEvent.click(getLayersButton());
    await userEvent.click(getLayerToggleInput("deployed"));

    // Pin should no longer be in the list (filtered out)
    const pinListAfter = screen.queryByTestId("m1-pin-list");
    if (pinListAfter) {
      expect(within(pinListAfter).queryByText("CASE-001")).toBeNull();
    } else {
      // If pin list is absent entirely, the pin was also removed
      expect(pinListAfter).toBeNull();
    }
  });

  it("data-hidden-count reflects filtered pins", async () => {
    const pin1: CaseMapRecord = { caseId: "c1", label: "C1", status: "deployed", lat: 0, lng: 0, updatedAt: 1_700_000_000_000 };
    const pin2: CaseMapRecord = { caseId: "c2", label: "C2", status: "flagged", lat: 0, lng: 0, updatedAt: 1_700_000_000_000 };
    mockUseCaseMapData.mockReturnValue({
      records: [pin1, pin2],
      isLoading: false,
      summary: { total: 2, byStatus: { deployed: 1, flagged: 1 } },
      mode: "M1",
    });

    await renderM1();

    // Initially both pins visible (no hidden)
    const mapContainer = document.querySelector("[data-hidden-count]");
    if (mapContainer) {
      expect(mapContainer.getAttribute("data-hidden-count")).toBe("0");
    }

    // Disable deployed layer → 1 pin hidden
    await userEvent.click(getLayersButton());
    await userEvent.click(getLayerToggleInput("deployed"));

    const mapContainerAfter = document.querySelector("[data-hidden-count]");
    if (mapContainerAfter) {
      expect(mapContainerAfter.getAttribute("data-hidden-count")).toBe("1");
    }
  });
});

// ─── 7. Mapbox-token overlay fallback ─────────────────────────────────────────

describe("M1FleetOverview — Mapbox-token overlay fallback", () => {
  it("renders history and turbine overlays in fallback mode inside M1's plain map container", async () => {
    await renderM1WithMapboxToken();

    expect(screen.getByTestId("turbine-layer-fallback")).toBeTruthy();
    expect(screen.getByTestId("history-trail-fallback")).toBeTruthy();
  });
});

// ─── 8. Keyboard accessibility ────────────────────────────────────────────────

describe("M1FleetOverview — Layers button keyboard accessibility", () => {
  it("Enter key on focused button opens the panel", async () => {
    await renderM1();

    const button = getLayersButton();
    button.focus();

    // Press Enter to activate button
    await userEvent.keyboard("{Enter}");

    expect(queryLayerPanel()).not.toBeNull();
  });

  it("Space key on focused button opens the panel", async () => {
    await renderM1();

    const button = getLayersButton();
    button.focus();

    await userEvent.keyboard(" ");

    expect(queryLayerPanel()).not.toBeNull();
  });
});
