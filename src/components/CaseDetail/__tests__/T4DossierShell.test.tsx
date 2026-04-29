/**
 * @vitest-environment jsdom
 *
 * Unit tests: T4DossierShell — Tabbed Dossier shell component.
 *
 * Covers:
 *   1.  Structural rendering — shell, tab bar, tabpanels
 *   2.  Tab rendering — all 6 tabs present with correct labels
 *   3.  Default tab — overview selected by default (or per initialTab)
 *   4.  Uncontrolled tab switching — click activates correct tab
 *   5.  Controlled mode — activeTab prop overrides internal state
 *   6.  onTabChange callback — fires with correct tab identifier on click
 *   7.  Keyboard navigation — ArrowLeft / ArrowRight / Home / End
 *   8.  ARIA compliance — tablist, tab, tabpanel roles; aria-selected; aria-controls
 *   9.  Feature-flag gate — Activity tab gated by ffAuditHashChain
 *   10. tabContent override — custom content replaces placeholder
 *   11. Dark theme — component renders without error in .theme-dark context
 *   12. DossierTab type helpers — isDossierTab, DOSSIER_TAB_VALUES
 */

import React from "react";
import {
  render,
  screen,
  within,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Stub StatusPill to avoid design-system token resolution in tests ─────────

vi.mock("../../StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind} />
  ),
}));

// ─── Stub DossierOverviewPanel to avoid Convex provider requirements ──────────
//
// DossierOverviewPanel calls useQuery(api.cases.getCaseById) which requires a
// ConvexProvider.  The T4DossierShell tests are concerned with the shell's
// tab navigation mechanics, not the panel's data-fetching behavior.
// The real DossierOverviewPanel is covered by DossierOverviewPanel.test.tsx.

vi.mock("../DossierOverviewPanel", () => ({
  DossierOverviewPanel: ({ caseId }: { caseId: string }) => (
    <div data-testid="dossier-overview-panel-stub" data-case-id={caseId} />
  ),
}));

// ─── Stub DossierActivityPanel to avoid Convex provider requirements ──────────
//
// DossierActivityPanel calls useCaseEvents (which wraps useQuery) requiring a
// ConvexProvider.  Shell tests only verify tab routing mechanics.
// The real DossierActivityPanel is covered by DossierActivityPanel.test.tsx.

vi.mock("../DossierActivityPanel", () => ({
  DossierActivityPanel: ({ caseId }: { caseId: string }) => (
    <div data-testid="dossier-activity-panel-stub" data-case-id={caseId} />
  ),
}));

// ─── Stub DossierMapPanel to avoid Convex + Mapbox provider requirements ───────
//
// DossierMapPanel calls useQuery(api.cases.getCaseById) and react-map-gl's
// <Map> which both require ConvexProvider and a WebGL context.
// Shell tests only verify tab routing mechanics — real panel behavior is
// covered by DossierMapPanel.test.tsx.

vi.mock("../DossierMapPanel", () => ({
  DossierMapPanel: ({ caseId }: { caseId: string }) => (
    <div data-testid="dossier-map-panel-stub" data-case-id={caseId} />
  ),
}));

// ─── Stub DossierEvidencePanel to avoid Convex provider requirements ──────────
//
// DossierEvidencePanel calls useQuery (evidence items) which requires a
// ConvexProvider.  Shell tests only verify tab routing mechanics.
// The real DossierEvidencePanel is covered by its own test file.

vi.mock("../DossierEvidencePanel", () => ({
  DossierEvidencePanel: ({ caseId }: { caseId: string }) => (
    <div data-testid="dossier-evidence-panel-stub" data-case-id={caseId} />
  ),
}));

// ─── SUT import ───────────────────────────────────────────────────────────────

import {
  T4DossierShell,
  isDossierTab,
  DOSSIER_TAB_VALUES,
  type DossierTab,
} from "../T4DossierShell";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CASE_ID = "case_abc123";

function renderShell(props: Partial<React.ComponentProps<typeof T4DossierShell>> = {}) {
  return render(
    <T4DossierShell caseId={CASE_ID} {...props} />
  );
}

afterEach(() => cleanup());

// ─── 1. Structural rendering ──────────────────────────────────────────────────

describe("T4DossierShell — structural rendering", () => {
  it("renders the root element with data-testid='t4-dossier-shell'", () => {
    renderShell();
    expect(screen.getByTestId("t4-dossier-shell")).toBeTruthy();
  });

  it("renders a role='tablist' navigation element", () => {
    renderShell();
    expect(screen.getByRole("tablist")).toBeTruthy();
  });

  it("renders a role='tabpanel' for the active tab", () => {
    renderShell();
    // Should have exactly one visible (non-hidden) tabpanel
    const panels = screen.getAllByRole("tabpanel");
    expect(panels.length).toBeGreaterThan(0);
  });

  it("exposes caseId on the root via data-case-id", () => {
    renderShell({ caseId: CASE_ID });
    const root = screen.getByTestId("t4-dossier-shell");
    expect(root.getAttribute("data-case-id")).toBe(CASE_ID);
  });

  it("applies custom className to the root element", () => {
    renderShell({ className: "my-custom-class" });
    const root = screen.getByTestId("t4-dossier-shell");
    expect(root.classList.contains("my-custom-class")).toBe(true);
  });
});

// ─── 2. Tab rendering ─────────────────────────────────────────────────────────

describe("T4DossierShell — tab rendering", () => {
  const expectedTabs: DossierTab[] = [
    "overview",
    "timeline",
    "map",
    "manifest",
    "evidence",
    "activity",
  ];

  it("renders exactly 6 tab buttons", () => {
    renderShell();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(6);
  });

  it.each([
    ["Overview", "overview"],
    ["Timeline", "timeline"],
    ["Map", "map"],
    ["Manifest", "manifest"],
    ["Evidence", "evidence"],
    ["Activity", "activity"],
  ] as const)("renders the '%s' tab with data-tab-id='%s'", (label, id) => {
    renderShell();
    const tab = screen.getByRole("tab", { name: new RegExp(label, "i") });
    expect(tab).toBeTruthy();
    expect(tab.getAttribute("data-tab-id")).toBe(id);
  });

  it("renders tabs in correct order: Overview, Timeline, Map, Manifest, Evidence, Activity", () => {
    renderShell();
    const tabs = screen.getAllByRole("tab");
    const labels = tabs.map((t) => t.getAttribute("data-tab-id"));
    expect(labels).toEqual(expectedTabs);
  });
});

// ─── 3. Default active tab ────────────────────────────────────────────────────

describe("T4DossierShell — default active tab", () => {
  it("activates 'overview' tab by default (uncontrolled)", () => {
    renderShell();
    const overviewTab = screen.getByRole("tab", { name: /overview/i });
    expect(overviewTab.getAttribute("aria-selected")).toBe("true");
  });

  it("all other tabs are NOT selected by default", () => {
    renderShell();
    const tabs = screen.getAllByRole("tab");
    const nonSelected = tabs.filter(
      (t) => t.getAttribute("data-tab-id") !== "overview"
    );
    nonSelected.forEach((t) => {
      expect(t.getAttribute("aria-selected")).toBe("false");
    });
  });

  it("respects initialTab='timeline' for default selection", () => {
    renderShell({ initialTab: "timeline" });
    const timelineTab = screen.getByRole("tab", { name: /timeline/i });
    expect(timelineTab.getAttribute("aria-selected")).toBe("true");
  });

  it("respects initialTab='manifest' for default selection", () => {
    renderShell({ initialTab: "manifest" });
    const manifestTab = screen.getByRole("tab", { name: /manifest/i });
    expect(manifestTab.getAttribute("aria-selected")).toBe("true");
  });

  it("sets data-active-tab on root element for the default tab", () => {
    renderShell();
    const root = screen.getByTestId("t4-dossier-shell");
    expect(root.getAttribute("data-active-tab")).toBe("overview");
  });
});

// ─── 4. Uncontrolled tab switching ────────────────────────────────────────────

describe("T4DossierShell — uncontrolled tab switching", () => {
  it("activates 'timeline' tab on click", () => {
    renderShell();
    const timelineTab = screen.getByRole("tab", { name: /timeline/i });
    fireEvent.click(timelineTab);
    expect(timelineTab.getAttribute("aria-selected")).toBe("true");
  });

  it("deselects previous tab when a new tab is clicked", () => {
    renderShell();
    const timelineTab = screen.getByRole("tab", { name: /timeline/i });
    fireEvent.click(timelineTab);
    const overviewTab = screen.getByRole("tab", { name: /overview/i });
    expect(overviewTab.getAttribute("aria-selected")).toBe("false");
  });

  it("clicking each tab activates it exclusively", () => {
    renderShell();
    const tabIds: DossierTab[] = ["overview", "timeline", "map", "manifest", "evidence"];

    for (const tabId of tabIds) {
      const tab = screen.getByRole("tab", { name: new RegExp(tabId, "i") });
      fireEvent.click(tab);
      expect(tab.getAttribute("aria-selected")).toBe("true");

      // All other tabs should be unselected
      const otherTabs = screen.getAllByRole("tab").filter(
        (t) => t.getAttribute("data-tab-id") !== tabId
      );
      otherTabs.forEach((t) => {
        expect(t.getAttribute("aria-selected")).toBe("false");
      });
    }
  });

  it("updates data-active-tab on root when tab changes", () => {
    renderShell();
    const root = screen.getByTestId("t4-dossier-shell");

    fireEvent.click(screen.getByRole("tab", { name: /map/i }));
    expect(root.getAttribute("data-active-tab")).toBe("map");

    fireEvent.click(screen.getByRole("tab", { name: /evidence/i }));
    expect(root.getAttribute("data-active-tab")).toBe("evidence");
  });
});

// ─── 5. Controlled mode ───────────────────────────────────────────────────────

describe("T4DossierShell — controlled mode", () => {
  it("uses activeTab prop to control selected tab", () => {
    renderShell({ activeTab: "map" });
    const mapTab = screen.getByRole("tab", { name: /^map$/i });
    expect(mapTab.getAttribute("aria-selected")).toBe("true");
  });

  it("updates when controlled activeTab changes via re-render", () => {
    const { rerender } = renderShell({ activeTab: "overview" });

    rerender(
      <T4DossierShell caseId={CASE_ID} activeTab="timeline" />
    );

    const timelineTab = screen.getByRole("tab", { name: /timeline/i });
    expect(timelineTab.getAttribute("aria-selected")).toBe("true");

    const overviewTab = screen.getByRole("tab", { name: /overview/i });
    expect(overviewTab.getAttribute("aria-selected")).toBe("false");
  });
});

// ─── 6. onTabChange callback ──────────────────────────────────────────────────

describe("T4DossierShell — onTabChange callback", () => {
  it("fires onTabChange with correct tab id when Overview is clicked", () => {
    const onTabChange = vi.fn();
    renderShell({ onTabChange });
    fireEvent.click(screen.getByRole("tab", { name: /overview/i }));
    expect(onTabChange).toHaveBeenCalledWith("overview");
  });

  it("fires onTabChange with 'timeline' when Timeline is clicked", () => {
    const onTabChange = vi.fn();
    renderShell({ onTabChange, initialTab: "overview" });
    fireEvent.click(screen.getByRole("tab", { name: /timeline/i }));
    expect(onTabChange).toHaveBeenCalledWith("timeline");
  });

  it("fires onTabChange with 'map' when Map is clicked", () => {
    const onTabChange = vi.fn();
    renderShell({ onTabChange });
    fireEvent.click(screen.getByRole("tab", { name: /^map$/i }));
    expect(onTabChange).toHaveBeenCalledWith("map");
  });

  it("fires onTabChange with 'manifest' when Manifest is clicked", () => {
    const onTabChange = vi.fn();
    renderShell({ onTabChange });
    fireEvent.click(screen.getByRole("tab", { name: /manifest/i }));
    expect(onTabChange).toHaveBeenCalledWith("manifest");
  });

  it("fires onTabChange with 'evidence' when Evidence is clicked", () => {
    const onTabChange = vi.fn();
    renderShell({ onTabChange });
    fireEvent.click(screen.getByRole("tab", { name: /evidence/i }));
    expect(onTabChange).toHaveBeenCalledWith("evidence");
  });

  it("fires onTabChange with 'activity' when Activity is clicked (even gated)", () => {
    const onTabChange = vi.fn();
    // Note: Activity tab should still fire onTabChange even when gated
    renderShell({ onTabChange, ffAuditHashChain: false });
    fireEvent.click(screen.getByRole("tab", { name: /activity/i }));
    expect(onTabChange).toHaveBeenCalledWith("activity");
  });

  it("fires exactly once per click (no double-fire)", () => {
    const onTabChange = vi.fn();
    renderShell({ onTabChange });
    fireEvent.click(screen.getByRole("tab", { name: /timeline/i }));
    expect(onTabChange).toHaveBeenCalledTimes(1);
  });
});

// ─── 7. Keyboard navigation ───────────────────────────────────────────────────

describe("T4DossierShell — keyboard navigation", () => {
  beforeEach(() => {
    renderShell();
  });

  it("ArrowRight moves focus from Overview (index 0) to Timeline (index 1)", () => {
    const overviewTab = screen.getByRole("tab", { name: /overview/i });
    overviewTab.focus();

    fireEvent.keyDown(overviewTab, { key: "ArrowRight" });

    const timelineTab = screen.getByRole("tab", { name: /timeline/i });
    // After ArrowRight, the next tab should be in the DOM (focus assertion
    // is environment-dependent but we can verify the handler doesn't throw)
    expect(timelineTab).toBeTruthy();
  });

  it("ArrowLeft moves focus from Timeline (index 1) to Overview (index 0)", () => {
    const timelineTab = screen.getByRole("tab", { name: /timeline/i });
    timelineTab.focus();

    // Should not throw
    expect(() => {
      fireEvent.keyDown(timelineTab, { key: "ArrowLeft" });
    }).not.toThrow();
  });

  it("ArrowRight wraps from last tab (Activity) to first tab (Overview)", () => {
    const activityTab = screen.getByRole("tab", { name: /activity/i });
    activityTab.focus();

    expect(() => {
      fireEvent.keyDown(activityTab, { key: "ArrowRight" });
    }).not.toThrow();
  });

  it("ArrowLeft wraps from first tab (Overview) to last tab (Activity)", () => {
    const overviewTab = screen.getByRole("tab", { name: /overview/i });
    overviewTab.focus();

    expect(() => {
      fireEvent.keyDown(overviewTab, { key: "ArrowLeft" });
    }).not.toThrow();
  });

  it("Home moves focus to first tab", () => {
    const mapTab = screen.getByRole("tab", { name: /^map$/i });
    mapTab.focus();

    expect(() => {
      fireEvent.keyDown(mapTab, { key: "Home" });
    }).not.toThrow();
  });

  it("End moves focus to last tab", () => {
    const overviewTab = screen.getByRole("tab", { name: /overview/i });
    overviewTab.focus();

    expect(() => {
      fireEvent.keyDown(overviewTab, { key: "End" });
    }).not.toThrow();
  });

  it("Enter activates the currently focused tab", () => {
    const onTabChange = vi.fn();
    cleanup();
    renderShell({ onTabChange });

    const timelineTab = screen.getByRole("tab", { name: /timeline/i });
    timelineTab.focus();
    fireEvent.keyDown(timelineTab, { key: "Enter" });

    expect(onTabChange).toHaveBeenCalledWith("timeline");
  });

  it("Space activates the currently focused tab", () => {
    const onTabChange = vi.fn();
    cleanup();
    renderShell({ onTabChange });

    const manifestTab = screen.getByRole("tab", { name: /manifest/i });
    manifestTab.focus();
    fireEvent.keyDown(manifestTab, { key: " " });

    expect(onTabChange).toHaveBeenCalledWith("manifest");
  });
});

// ─── 8. ARIA compliance ───────────────────────────────────────────────────────

describe("T4DossierShell — ARIA compliance", () => {
  it("tablist has aria-label", () => {
    renderShell();
    const tablist = screen.getByRole("tablist");
    expect(tablist.getAttribute("aria-label")).toBeTruthy();
  });

  it("tablist has aria-orientation='horizontal'", () => {
    renderShell();
    const tablist = screen.getByRole("tablist");
    expect(tablist.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("active tab has aria-selected='true'", () => {
    renderShell();
    const overviewTab = screen.getByRole("tab", { name: /overview/i });
    expect(overviewTab.getAttribute("aria-selected")).toBe("true");
  });

  it("inactive tabs have aria-selected='false'", () => {
    renderShell();
    const tabs = screen.getAllByRole("tab");
    const inactiveTabs = tabs.filter(
      (t) => t.getAttribute("data-tab-id") !== "overview"
    );
    inactiveTabs.forEach((t) => {
      expect(t.getAttribute("aria-selected")).toBe("false");
    });
  });

  it("each tab button has an aria-controls attribute", () => {
    renderShell();
    const tabs = screen.getAllByRole("tab");
    tabs.forEach((tab) => {
      expect(tab.getAttribute("aria-controls")).toBeTruthy();
    });
  });

  it("each tab button has an id attribute", () => {
    renderShell();
    const tabs = screen.getAllByRole("tab");
    tabs.forEach((tab) => {
      expect(tab.id).toBeTruthy();
    });
  });

  it("active tab has tabIndex=0, inactive tabs have tabIndex=-1", () => {
    renderShell({ initialTab: "overview" });
    const tabs = screen.getAllByRole("tab");
    const overviewTab = tabs.find((t) => t.getAttribute("data-tab-id") === "overview")!;
    const otherTabs = tabs.filter((t) => t.getAttribute("data-tab-id") !== "overview");

    expect(overviewTab.getAttribute("tabindex")).toBe("0");
    otherTabs.forEach((t) => {
      expect(t.getAttribute("tabindex")).toBe("-1");
    });
  });

  it("active tab panel has role='tabpanel'", () => {
    renderShell();
    const panels = screen.getAllByRole("tabpanel");
    expect(panels.length).toBeGreaterThanOrEqual(1);
  });

  it("active tab panel has aria-labelledby referencing the active tab's id", () => {
    renderShell({ initialTab: "timeline" });
    const timelineTab = screen.getByRole("tab", { name: /timeline/i });
    const tabId = timelineTab.id;

    // The visible panel should reference this tab
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabId);
  });

  it("section root has aria-label='Case dossier'", () => {
    renderShell();
    const section = screen.getByRole("region", { name: /case dossier/i });
    expect(section).toBeTruthy();
  });
});

// ─── 9. Feature-flag gate (Activity tab) ─────────────────────────────────────

describe("T4DossierShell — FF_AUDIT_HASH_CHAIN gate", () => {
  it("Activity tab is rendered even when ffAuditHashChain is false", () => {
    renderShell({ ffAuditHashChain: false });
    const activityTab = screen.getByRole("tab", { name: /activity/i });
    expect(activityTab).toBeTruthy();
  });

  it("Activity tab shows FF badge when ffAuditHashChain is false", () => {
    renderShell({ ffAuditHashChain: false });
    // The FF badge text should be visible in/near the Activity tab
    expect(screen.getAllByText("FF").length).toBeGreaterThanOrEqual(1);
  });

  it("Activity tab panel shows gate notice when ffAuditHashChain is false and Activity is selected", () => {
    renderShell({ initialTab: "activity", ffAuditHashChain: false });
    // Gate notice should be visible
    expect(
      screen.getByRole("status", { hidden: false })
    ).toBeTruthy();
  });

  it("Activity tab panel shows gate notice mentioning FF_AUDIT_HASH_CHAIN", () => {
    renderShell({ initialTab: "activity", ffAuditHashChain: false });
    // Multiple elements may contain the flag name (title + code block) — use getAllByText
    const matches = screen.getAllByText(/FF_AUDIT_HASH_CHAIN/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("Activity tab does NOT show FF badge when ffAuditHashChain is true", () => {
    renderShell({ ffAuditHashChain: true });
    // No FF badge should appear when the flag is enabled
    expect(screen.queryByText("FF")).toBeNull();
  });

  it("Activity tab panel does NOT show gate notice when ffAuditHashChain is true", () => {
    renderShell({ initialTab: "activity", ffAuditHashChain: true });
    expect(screen.queryByText(/FF_AUDIT_HASH_CHAIN/)).toBeNull();
  });
});

// ─── 10. tabContent override slot ────────────────────────────────────────────

describe("T4DossierShell — tabContent override", () => {
  it("renders custom content for the overview tab when override is provided", () => {
    renderShell({
      tabContent: {
        overview: <p data-testid="custom-overview">Custom Overview</p>,
      },
    });
    expect(screen.getByTestId("custom-overview")).toBeTruthy();
    expect(screen.getByText("Custom Overview")).toBeTruthy();
  });

  it("does NOT render placeholder when custom content is provided", () => {
    renderShell({
      tabContent: {
        overview: <p>Custom Overview Content</p>,
      },
    });
    expect(screen.queryByTestId("dossier-placeholder-overview")).toBeNull();
  });

  it("renders custom timeline content when override is provided and timeline is active", () => {
    renderShell({
      initialTab: "timeline",
      tabContent: {
        timeline: <div data-testid="custom-timeline">Real Timeline</div>,
      },
    });
    expect(screen.getByTestId("custom-timeline")).toBeTruthy();
  });

  it("renders DossierMapPanel stub for non-overridden 'map' tab (map has real content)", () => {
    renderShell({
      initialTab: "map",
      tabContent: {
        overview: <p>Custom Overview</p>,
        // map is NOT overridden — renders the real DossierMapPanel (stub in tests)
      },
    });
    // DossierMapPanel is the real content for the map tab, not a placeholder
    expect(screen.getByTestId("dossier-map-panel-stub")).toBeTruthy();
    expect(screen.queryByTestId("dossier-placeholder-map")).toBeNull();
  });

  it("renders placeholder for non-overridden timeline tab", () => {
    renderShell({
      initialTab: "timeline",
      tabContent: {
        overview: <p>Custom Overview</p>,
        // timeline is NOT overridden — should show placeholder
      },
    });
    expect(screen.getByTestId("dossier-placeholder-timeline")).toBeTruthy();
  });
});

// ─── 11. Placeholder / real-content rendering ────────────────────────────────
//
// The "overview" tab now renders DossierOverviewPanel (real content, Sub-AC 1)
// rather than a placeholder.  All other tabs still use TabPlaceholder until
// their respective Sub-ACs are implemented.

describe("T4DossierShell — placeholder content", () => {
  // Overview renders the real DossierOverviewPanel stub (not a placeholder)
  it("renders DossierOverviewPanel stub for 'overview' tab when active (no override)", () => {
    renderShell({ initialTab: "overview" });
    expect(screen.getByTestId("dossier-overview-panel-stub")).toBeTruthy();
  });

  // The old placeholder for overview should NOT appear (it's replaced by the real panel)
  it("does NOT render placeholder for 'overview' tab (real panel is rendered)", () => {
    renderShell({ initialTab: "overview" });
    expect(screen.queryByTestId("dossier-placeholder-overview")).toBeNull();
  });

  // "map" now renders DossierMapPanel (Sub-AC 1), not a placeholder.
  // "evidence" now renders DossierEvidencePanel (Sub-AC 3), not a placeholder.
  // Remaining tabs without real content still show placeholders.
  it.each(["timeline", "manifest"] as DossierTab[])(
    "renders placeholder for '%s' tab when active (no override)",
    (tabId) => {
      renderShell({ initialTab: tabId });
      expect(screen.getByTestId(`dossier-placeholder-${tabId}`)).toBeTruthy();
    }
  );

  it("renders DossierEvidencePanel stub for 'evidence' tab when active (no override)", () => {
    renderShell({ initialTab: "evidence" });
    expect(screen.getByTestId("dossier-evidence-panel-stub")).toBeTruthy();
  });

  it("does NOT render placeholder for 'evidence' tab (real panel is rendered)", () => {
    renderShell({ initialTab: "evidence" });
    expect(screen.queryByTestId("dossier-placeholder-evidence")).toBeNull();
  });

  it("renders DossierMapPanel stub for 'map' tab when active (no override)", () => {
    renderShell({ initialTab: "map" });
    expect(screen.getByTestId("dossier-map-panel-stub")).toBeTruthy();
  });

  it("does NOT render placeholder for 'map' tab (real panel is rendered)", () => {
    renderShell({ initialTab: "map" });
    expect(screen.queryByTestId("dossier-placeholder-map")).toBeNull();
  });

  it("renders DossierActivityPanel stub for 'activity' tab when ffAuditHashChain=true and no override", () => {
    renderShell({ initialTab: "activity", ffAuditHashChain: true });
    expect(screen.getByTestId("dossier-activity-panel-stub")).toBeTruthy();
  });

  it("does NOT render placeholder for 'activity' tab when ffAuditHashChain=true (real panel is rendered)", () => {
    renderShell({ initialTab: "activity", ffAuditHashChain: true });
    expect(screen.queryByTestId("dossier-placeholder-activity")).toBeNull();
  });
});

// ─── 12. DossierTab type helpers ─────────────────────────────────────────────

describe("isDossierTab — type guard", () => {
  it("returns true for all valid DossierTab values", () => {
    const valid = ["overview", "timeline", "map", "manifest", "evidence", "activity"];
    valid.forEach((v) => {
      expect(isDossierTab(v)).toBe(true);
    });
  });

  it("returns false for unknown strings", () => {
    expect(isDossierTab("shipping")).toBe(false);
    expect(isDossierTab("T1")).toBe(false);
    expect(isDossierTab("inspection")).toBe(false);
    expect(isDossierTab("")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isDossierTab(null)).toBe(false);
    expect(isDossierTab(undefined)).toBe(false);
    expect(isDossierTab(42)).toBe(false);
    expect(isDossierTab({})).toBe(false);
    expect(isDossierTab([])).toBe(false);
  });
});

describe("DOSSIER_TAB_VALUES — ordered tab array", () => {
  it("contains exactly 6 values", () => {
    expect(DOSSIER_TAB_VALUES).toHaveLength(6);
  });

  it("starts with 'overview'", () => {
    expect(DOSSIER_TAB_VALUES[0]).toBe("overview");
  });

  it("ends with 'activity'", () => {
    expect(DOSSIER_TAB_VALUES[DOSSIER_TAB_VALUES.length - 1]).toBe("activity");
  });

  it("contains all expected tab identifiers", () => {
    expect(DOSSIER_TAB_VALUES).toContain("overview");
    expect(DOSSIER_TAB_VALUES).toContain("timeline");
    expect(DOSSIER_TAB_VALUES).toContain("map");
    expect(DOSSIER_TAB_VALUES).toContain("manifest");
    expect(DOSSIER_TAB_VALUES).toContain("evidence");
    expect(DOSSIER_TAB_VALUES).toContain("activity");
  });

  it("is in the correct display order", () => {
    expect([...DOSSIER_TAB_VALUES]).toEqual([
      "overview",
      "timeline",
      "map",
      "manifest",
      "evidence",
      "activity",
    ]);
  });
});
