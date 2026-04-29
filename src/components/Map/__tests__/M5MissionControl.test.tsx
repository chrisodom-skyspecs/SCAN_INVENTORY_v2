/**
 * @vitest-environment jsdom
 *
 * Component tests for M5MissionControl — Mission Control map mode.
 *
 * AC 350204 Sub-AC 3d — Verify that:
 *   1. useCaseMapData is called with mode: "M5" to subscribe to fleet data.
 *   2. Loading state is shown while isLoading is true.
 *   3. The fleet count badge reflects summary.total reactively.
 *   4. The map container exposes data-fleet-count reactively from summary.total.
 *   5. The map container exposes data-by-status (JSON) from summary.byStatus.
 *   6. The map container shows data-loading="true" while loading.
 *   7. The placeholder renders a reactive status breakdown from summary.byStatus.
 *   8. Status breakdown items update when byStatus changes.
 *   9. LIVE badge shown when at=null (live mode).
 *  10. REPLAY badge shown when at is non-null.
 *  11. Exit replay button appears when at is set.
 *  12. The replay scrubber input is rendered for mission time control.
 *  13. Mode tabs are rendered and M5 is selected.
 *  14. Org and kit filter dropdowns render correctly.
 *  15. Screen-reader output reflects live fleet count.
 *  16. Status breakdown is sorted descending by count (most common first).
 *  17. Status items with count=0 are hidden.
 *  18. data-map-mode='M5' is present on the root element.
 *
 * Mocking strategy
 * ────────────────
 * • `@/hooks/use-case-map-data` → mocked; injectable per-test.
 *   For M5, records is always [] — only summary drives reactive renders.
 * • `@/hooks/use-map-params` → mocked with module-level `_mockAt` control.
 * • CSS modules → auto-handled by vitest.
 * • `next/navigation` → mocked to prevent useSearchParams from throwing.
 * • `afterEach(cleanup)` ensures DOM is wiped between tests.
 *
 * The tests never subscribe to a real Convex backend.
 */

import React from "react";
import { render, screen, within, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UseCaseMapDataResult } from "@/hooks/use-case-map-data";

// ─── Mock next/navigation ─────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/inventory",
  useSearchParams: () => ({
    get: (_key: string) => null,
    toString: () => "",
  }),
}));

// ─── Controllable useMapParams mock ───────────────────────────────────────────

// Allows individual tests to set the `at` param to simulate live vs. replay.
let _mockAt: Date | null = null;

vi.mock("@/hooks/use-map-params", () => ({
  useMapParams: () => ({
    view: "M5",
    org: null,
    kit: null,
    at: _mockAt,
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
  mode:      "M5",
  summary:   { total: 0, byStatus: {} },
}));

vi.mock("@/hooks/use-case-map-data", () => ({
  useCaseMapData: (...args: unknown[]) => mockUseCaseMapData(...args),
}));

// ─── CSS module stub ──────────────────────────────────────────────────────────

vi.mock("../M5MissionControl.module.css", () => ({ default: {} }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Build a controlled UseCaseMapDataResult for M5. */
function makeM5Result(
  totalCases: number,
  byStatus: Record<string, number> = {}
): UseCaseMapDataResult {
  return {
    records:   [],   // M5 always returns [] — cluster/heatmap mode, not case pins
    isLoading: false,
    mode:      "M5",
    summary: {
      total:    totalCases,
      byStatus,
    },
  };
}

const LOADING_RESULT: UseCaseMapDataResult = {
  records:   [],
  isLoading: true,
  mode:      "M5",
  summary:   undefined,
};

const EMPTY_RESULT: UseCaseMapDataResult = {
  records:   [],
  isLoading: false,
  mode:      "M5",
  summary:   { total: 0, byStatus: {} },
};

// ─── Component import (after mocks) ──────────────────────────────────────────

import { M5MissionControl } from "../M5MissionControl";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("M5MissionControl — useCaseMapData integration (Sub-AC 3d)", () => {
  beforeEach(() => {
    mockUseCaseMapData.mockReset();
    _mockAt = null; // default to live mode
  });

  // Ensure the DOM is wiped between tests to prevent element accumulation.
  afterEach(() => {
    cleanup();
  });

  // ── Hook call verification ─────────────────────────────────────────────────

  it("calls useCaseMapData with mode: 'M5'", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    render(<M5MissionControl />);

    expect(mockUseCaseMapData).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "M5" })
    );
  });

  it("calls useCaseMapData exactly once per render", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    render(<M5MissionControl />);

    expect(mockUseCaseMapData).toHaveBeenCalledTimes(1);
  });

  // ── Loading state ──────────────────────────────────────────────────────────

  it("renders the loading aria-label in the fleet count badge while isLoading=true", () => {
    mockUseCaseMapData.mockReturnValue(LOADING_RESULT);
    const { container } = render(<M5MissionControl />);

    const badge = container.querySelector("[aria-label='Loading fleet data…']");
    expect(badge).not.toBeNull();
  });

  it("shows data-loading='true' on the map container while loading", () => {
    mockUseCaseMapData.mockReturnValue(LOADING_RESULT);
    const { container } = render(<M5MissionControl mapboxToken="pk.test_token" />);

    const mapContainer = container.querySelector("#m5-map-container");
    expect(mapContainer).not.toBeNull();
    expect(mapContainer!.getAttribute("data-loading")).toBe("true");
  });

  // ── Map container data-attributes (reactive overlays) ─────────────────────

  it("exposes data-fleet-count attribute reactively from summary.total", () => {
    mockUseCaseMapData.mockReturnValue(makeM5Result(42, { deployed: 42 }));

    const { container } = render(<M5MissionControl mapboxToken="pk.test_token" />);

    const mapContainer = container.querySelector("#m5-map-container");
    expect(mapContainer).not.toBeNull();
    expect(mapContainer!.getAttribute("data-fleet-count")).toBe("42");
  });

  it("exposes data-by-status attribute as JSON-serialized summary.byStatus", () => {
    const byStatus = { deployed: 15, flagged: 5, assembled: 30 };
    mockUseCaseMapData.mockReturnValue(makeM5Result(50, byStatus));

    const { container } = render(<M5MissionControl mapboxToken="pk.test_token" />);

    const mapContainer = container.querySelector("#m5-map-container");
    const rawAttr = mapContainer!.getAttribute("data-by-status");
    expect(rawAttr).not.toBeNull();

    const parsed = JSON.parse(rawAttr!);
    expect(parsed.deployed).toBe(15);
    expect(parsed.flagged).toBe(5);
    expect(parsed.assembled).toBe(30);
  });

  it("data-by-status is absent when summary is undefined (loading)", () => {
    mockUseCaseMapData.mockReturnValue(LOADING_RESULT);
    const { container } = render(<M5MissionControl mapboxToken="pk.test_token" />);

    const mapContainer = container.querySelector("#m5-map-container");
    // summary is undefined during loading → attribute should not be set
    expect(mapContainer!.getAttribute("data-by-status")).toBeNull();
  });

  it("data-loading is absent from map container when data is available", () => {
    mockUseCaseMapData.mockReturnValue(makeM5Result(10, { deployed: 10 }));
    const { container } = render(<M5MissionControl mapboxToken="pk.test_token" />);

    const mapContainer = container.querySelector("#m5-map-container");
    expect(mapContainer!.getAttribute("data-loading")).toBeNull();
  });

  // ── Fleet count badge ──────────────────────────────────────────────────────

  it("shows fleet count from summary.total in aria-label", () => {
    mockUseCaseMapData.mockReturnValue(makeM5Result(87));

    const { container } = render(<M5MissionControl />);

    const badge = container.querySelector("[aria-label*='87 case']");
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute("aria-label")).toMatch(/total/i);
  });

  it("shows 0 cases when fleet is empty", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M5MissionControl />);

    const badge = container.querySelector("[aria-label*='0 case']");
    expect(badge).not.toBeNull();
  });

  it("uses singular 'case' when total is 1", () => {
    mockUseCaseMapData.mockReturnValue(makeM5Result(1, { hangar: 1 }));

    const { container } = render(<M5MissionControl />);

    // aria-label: "1 case total"
    const badge = container.querySelector("[aria-label='1 case total']");
    expect(badge).not.toBeNull();
  });

  // ── Status breakdown in placeholder (reactive from summary.byStatus) ───────

  it("renders status breakdown list in placeholder when byStatus has non-zero entries", () => {
    mockUseCaseMapData.mockReturnValue(
      makeM5Result(50, { deployed: 20, flagged: 10, assembled: 20 })
    );

    const { container } = render(<M5MissionControl />); // No mapboxToken → placeholder

    const breakdown = container.querySelector("[data-testid='m5-status-breakdown']");
    expect(breakdown).not.toBeNull();
  });

  it("renders each non-zero status in the breakdown list", () => {
    const byStatus = { deployed: 20, flagged: 5, assembled: 15 };
    mockUseCaseMapData.mockReturnValue(makeM5Result(40, byStatus));

    const { container } = render(<M5MissionControl />);

    const breakdown = container.querySelector("[data-testid='m5-status-breakdown']")!;
    expect(within(breakdown as HTMLElement).getByText("deployed")).toBeDefined();
    expect(within(breakdown as HTMLElement).getByText("flagged")).toBeDefined();
    expect(within(breakdown as HTMLElement).getByText("assembled")).toBeDefined();
  });

  it("renders the count for each status in the breakdown", () => {
    const byStatus = { deployed: 20, flagged: 5 };
    mockUseCaseMapData.mockReturnValue(makeM5Result(25, byStatus));

    const { container } = render(<M5MissionControl />);

    const breakdown = container.querySelector("[data-testid='m5-status-breakdown']")!;
    expect(within(breakdown as HTMLElement).getByText("20")).toBeDefined();
    expect(within(breakdown as HTMLElement).getByText("5")).toBeDefined();
  });

  it("does NOT render breakdown when all counts are 0", () => {
    // All counts are 0 → filtered out → empty list → not rendered
    const byStatus = { deployed: 0, flagged: 0 };
    mockUseCaseMapData.mockReturnValue(makeM5Result(0, byStatus));

    const { container } = render(<M5MissionControl />);

    expect(container.querySelector("[data-testid='m5-status-breakdown']")).toBeNull();
  });

  it("does NOT render breakdown while loading (summary undefined)", () => {
    mockUseCaseMapData.mockReturnValue(LOADING_RESULT);

    const { container } = render(<M5MissionControl />);

    expect(container.querySelector("[data-testid='m5-status-breakdown']")).toBeNull();
  });

  it("does NOT render breakdown when byStatus is empty", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M5MissionControl />);

    expect(container.querySelector("[data-testid='m5-status-breakdown']")).toBeNull();
  });

  it("breakdown items carry data-status attribute matching the status key", () => {
    const byStatus = { deployed: 10, flagged: 5 };
    mockUseCaseMapData.mockReturnValue(makeM5Result(15, byStatus));

    const { container } = render(<M5MissionControl />);

    const breakdown = container.querySelector("[data-testid='m5-status-breakdown']")!;
    expect(breakdown.querySelector("[data-status='deployed']")).not.toBeNull();
    expect(breakdown.querySelector("[data-status='flagged']")).not.toBeNull();
  });

  it("sorts breakdown descending by count (most common status first)", () => {
    // deployed=30 > assembled=15 > flagged=5
    const byStatus = { flagged: 5, deployed: 30, assembled: 15 };
    mockUseCaseMapData.mockReturnValue(makeM5Result(50, byStatus));

    const { container } = render(<M5MissionControl />);

    const breakdown = container.querySelector("[data-testid='m5-status-breakdown']")!;
    const items = Array.from(breakdown.querySelectorAll("li[data-status]"));
    const statuses = items.map((el) => el.getAttribute("data-status"));

    expect(statuses[0]).toBe("deployed");   // 30 — first
    expect(statuses[1]).toBe("assembled");  // 15 — second
    expect(statuses[2]).toBe("flagged");    // 5  — last
  });

  // ── Live vs. Replay mode ───────────────────────────────────────────────────

  it("shows LIVE badge when at=null (no replay active)", () => {
    _mockAt = null;
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M5MissionControl />);

    const liveBadge = container.querySelector("[aria-label='Live mission feed']");
    expect(liveBadge).not.toBeNull();
    expect(container.querySelector("[aria-label='Replay mode active']")).toBeNull();
  });

  it("shows REPLAY badge when at is non-null", () => {
    _mockAt = new Date("2024-01-15T10:30:00");
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M5MissionControl />);

    const replayBadge = container.querySelector("[aria-label='Replay mode active']");
    expect(replayBadge).not.toBeNull();
    expect(container.querySelector("[aria-label='Live mission feed']")).toBeNull();
  });

  it("root has data-replaying='true' when at is non-null", () => {
    _mockAt = new Date("2024-01-15T10:30:00");
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M5MissionControl />);

    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute("data-replaying")).toBe("true");
  });

  it("root has no data-replaying when at=null", () => {
    _mockAt = null;
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M5MissionControl />);

    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute("data-replaying")).toBeNull();
  });

  it("shows Exit replay button when replaying (at is non-null)", () => {
    _mockAt = new Date("2024-01-15T10:30:00");
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M5MissionControl />);

    const exitBtn = container.querySelector("button[aria-label*='Exit replay']");
    expect(exitBtn).not.toBeNull();
  });

  it("does NOT show Exit replay button in live mode (at=null)", () => {
    _mockAt = null;
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M5MissionControl />);

    expect(container.querySelector("button[aria-label*='Exit replay']")).toBeNull();
  });

  // ── Replay scrubber ────────────────────────────────────────────────────────

  it("renders the datetime-local scrubber input", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M5MissionControl />);

    const scrubberInput = container.querySelector("input[type='datetime-local']");
    expect(scrubberInput).not.toBeNull();
  });

  it("scrubber hint says 'Select a time to replay' in live mode", () => {
    _mockAt = null;
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M5MissionControl />);

    const hint = container.querySelector("#m5-scrubber-hint");
    expect(hint?.textContent).toContain("Select a time to replay");
  });

  it("scrubber hint shows 'Replaying mission at' when at is set", () => {
    _mockAt = new Date("2024-01-15T10:30:00");
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M5MissionControl />);

    const hint = container.querySelector("#m5-scrubber-hint");
    expect(hint?.textContent).toContain("Replaying mission at");
  });

  // ── Mode tabs ──────────────────────────────────────────────────────────────

  it("renders all 5 mode tabs (M1–M5)", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M5MissionControl />);

    const tabs = container.querySelectorAll("[role='tab']");
    expect(tabs.length).toBe(5);
  });

  it("marks the M5 tab as selected (aria-selected='true')", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const { container } = render(<M5MissionControl />);

    const m5Tab = Array.from(container.querySelectorAll("[role='tab']")).find(
      (el) => el.getAttribute("aria-label")?.includes("Mission Control")
    );
    expect(m5Tab).not.toBeNull();
    expect(m5Tab!.getAttribute("aria-selected")).toBe("true");
  });

  // ── Filter controls ────────────────────────────────────────────────────────

  it("renders org filter dropdown with 'All organisations' default", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const orgs = [{ id: "org_1", name: "Alpha Team" }];
    const { container } = render(<M5MissionControl orgs={orgs} />);

    const select = container.querySelector("select[aria-label*='organisation']");
    expect(select).not.toBeNull();
    expect(within(select! as HTMLElement).getByText("Alpha Team")).toBeDefined();
  });

  it("renders kit filter dropdown", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);
    const kits = [{ id: "kit_1", name: "Wind Turbine Kit" }];
    const { container } = render(<M5MissionControl kits={kits} />);

    const select = container.querySelector("select[aria-label*='kit']");
    expect(within(select! as HTMLElement).getByText("Wind Turbine Kit")).toBeDefined();
  });

  // ── Screen-reader output ───────────────────────────────────────────────────

  it("screen-reader output contains the fleet count when loaded", () => {
    mockUseCaseMapData.mockReturnValue(makeM5Result(33, { deployed: 20, flagged: 13 }));

    const { container } = render(<M5MissionControl />);

    const output = container.querySelector("output");
    expect(output?.textContent).toContain("33 case");
  });

  it("screen-reader output mentions 'Live mission feed' when at=null", () => {
    _mockAt = null;
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M5MissionControl />);

    const output = container.querySelector("output");
    expect(output?.textContent).toContain("Live mission feed");
  });

  it("screen-reader output mentions 'Replaying mission' when at is set", () => {
    _mockAt = new Date("2024-01-15T10:30:00");
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M5MissionControl />);

    const output = container.querySelector("output");
    expect(output?.textContent).toContain("Replaying mission");
  });

  it("screen-reader output mentions 'Loading fleet data' while loading", () => {
    mockUseCaseMapData.mockReturnValue(LOADING_RESULT);

    const { container } = render(<M5MissionControl />);

    const output = container.querySelector("output");
    expect(output?.textContent).toContain("Loading fleet data");
  });

  // ── Root element ───────────────────────────────────────────────────────────

  it("renders root element with data-map-mode='M5'", () => {
    mockUseCaseMapData.mockReturnValue(EMPTY_RESULT);

    const { container } = render(<M5MissionControl />);

    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute("data-map-mode")).toBe("M5");
  });
});
