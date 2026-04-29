/**
 * @vitest-environment jsdom
 *
 * checklist-subscription-wiring.test.tsx
 *
 * Sub-AC 3: Convex useQuery subscription for the checklist table wired to
 * all case detail layouts (T1–T5) in the INVENTORY dashboard.
 *
 * What this test verifies
 * ───────────────────────
 * For each T-layout that displays checklist data, we verify:
 *
 *   1. The layout subscribes to the correct Convex query hook with the correct
 *      caseId argument — ensuring Convex will re-evaluate the subscription
 *      whenever the underlying `manifestItems` or `inspections` rows change.
 *
 *   2. The layout renders a loading skeleton (aria-busy="true") when the
 *      subscription is pending (undefined return) — not crashing or showing
 *      stale data.
 *
 *   3. The layout renders the checklist data correctly when the subscription
 *      delivers a result — verifying the data is wired into the UI.
 *
 *   4. The layout re-renders with updated data when the hook return value
 *      changes between renders — simulating a Convex subscription push.
 *      This is the core real-time fidelity contract: when the SCAN app
 *      writes to `manifestItems`, Convex pushes the diff to all subscribed
 *      dashboard panels within ~100–300 ms, and each panel re-renders
 *      without a page refresh.
 *
 * Layout coverage
 * ───────────────
 * T1Overview — ChecklistProgress mini-bar:
 *   • Hook: useChecklistSummary (api.checklists.getChecklistSummary)
 *   • Renders: progress bar with percentage + damage/missing counts
 *
 * T2Manifest — Full packing list (covered by T2Manifest.test.tsx):
 *   • Hook: useChecklistWithInspection (api.checklists.getChecklistWithInspection)
 *   • Renders: item list, filter bar, column headers (tested separately)
 *
 * T3Inspection — Inspection state + item breakdown:
 *   • Hook: useChecklistWithInspection (api.checklists.getChecklistWithInspection)
 *   • Renders: inspection record, progress bar, issues list (damaged/missing)
 *
 * T4Shipping — InspectionSummaryBanner:
 *   • Hook: useChecklistSummary (api.checklists.getChecklistSummary)
 *   • Renders: progress bar showing pre-shipment inspection status
 *
 * T5Audit — Manifest Snapshot section:
 *   • Hook: useChecklistByCase (api.checklists.getChecklistByCase)
 *   • Renders: item list with status pills and attribution timestamps
 *
 * Test strategy
 * ─────────────
 * All non-checklist dependencies (case document, shipment, custody, map,
 * damage reports, FedEx tracking, auth, etc.) are mocked as no-ops.  Each
 * test exercises only the checklist subscription path to keep assertions
 * focused and to avoid brittle multi-dependency test setup.
 *
 * The `useChecklistWithInspection`, `useChecklistSummary`, and
 * `useChecklistByCase` mocks are controlled per-test via `mockReturnValue`.
 * Changing the mock return value between re-renders simulates a Convex
 * subscription push without requiring a live Convex deployment.
 *
 * Real-time fidelity contract
 * ───────────────────────────
 * When a SCAN app technician marks an item "ok" or "damaged":
 *   1. `updateChecklistItem` mutation writes to `manifestItems` + `inspections`.
 *   2. Convex re-evaluates all queries that read those tables and pushes diffs
 *      to all connected clients within ~100–300 ms.
 *   3. Each subscribed T-layout receives the new data and re-renders.
 *
 * This test verifies step 3: the component re-renders correctly when the
 * hook returns updated data, satisfying the ≤ 2-second fidelity requirement.
 */

import React from "react";
import { render, screen, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Shared fixture helpers ───────────────────────────────────────────────────

const CASE_ID = "case-wiring-test-001" as const;
const TIMESTAMP = 1_700_000_000_000;

/** Build a minimal ChecklistItem fixture. */
function makeItem(
  id: string,
  name: string,
  status: "unchecked" | "ok" | "damaged" | "missing",
  extras?: { checkedByName?: string; checkedAt?: number; notes?: string }
) {
  return {
    _id: id,
    _creationTime: TIMESTAMP,
    caseId: CASE_ID,
    templateItemId: `tpl-${id}`,
    name,
    status,
    checkedByName: extras?.checkedByName,
    checkedAt: extras?.checkedAt,
    notes: extras?.notes,
  };
}

/** Build a ChecklistSummary from item counts. */
function makeSummary(total: number, ok: number, damaged: number, missing: number) {
  const unchecked = total - ok - damaged - missing;
  const reviewed = ok + damaged + missing;
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
  return {
    caseId: CASE_ID,
    total,
    ok,
    damaged,
    missing,
    unchecked,
    progressPct,
    isComplete: total > 0 && unchecked === 0,
  };
}

/** Build a ChecklistWithInspection fixture. */
function makeChecklistWithInspection(
  items: ReturnType<typeof makeItem>[],
  inspection?: {
    status?: "flagged" | "completed" | "pending" | "in_progress";
    inspectorName?: string;
    totalItems?: number;
    checkedItems?: number;
  } | null
) {
  const ok = items.filter((i) => i.status === "ok").length;
  const damaged = items.filter((i) => i.status === "damaged").length;
  const missing = items.filter((i) => i.status === "missing").length;
  const summary = makeSummary(items.length, ok, damaged, missing);
  return {
    items,
    inspection: inspection === null ? null : (inspection ? {
      _id: "insp-001",
      _creationTime: TIMESTAMP,
      status: inspection.status ?? "in_progress",
      inspectorId: "user-001",
      inspectorName: inspection.inspectorName ?? "Test Tech",
      startedAt: TIMESTAMP,
      completedAt: undefined,
      totalItems: inspection.totalItems ?? items.length,
      checkedItems: inspection.checkedItems ?? ok + damaged + missing,
      damagedItems: damaged,
      missingItems: missing,
      notes: undefined,
    } : null),
    summary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1Overview — ChecklistProgress mini-bar subscription wiring
// ─────────────────────────────────────────────────────────────────────────────

// Mock the checklist summary hook
const mockUseChecklistSummaryT1 = vi.fn();

// Mock all other T1Overview dependencies
vi.mock("../../../queries/checklist", () => ({
  useChecklistSummary: (...args: unknown[]) => mockUseChecklistSummaryT1(...args),
  useChecklistWithInspection: vi.fn().mockReturnValue(undefined),
  useChecklistByCase: vi.fn().mockReturnValue(undefined),
  useChecklistItemsByStatus: vi.fn().mockReturnValue(undefined),
  useUncheckedItems: vi.fn().mockReturnValue(undefined),
}));

vi.mock("../../../hooks/use-checklist", () => ({
  useChecklistSummary: (...args: unknown[]) => mockUseChecklistSummaryT1(...args),
  useChecklistWithInspection: vi.fn().mockReturnValue(undefined),
  useChecklistByCase: vi.fn().mockReturnValue(undefined),
  useChecklistItemsByStatus: vi.fn().mockReturnValue(undefined),
  useUncheckedItems: vi.fn().mockReturnValue(undefined),
  MANIFEST_ITEM_STATUSES: ["unchecked", "ok", "damaged", "missing"],
}));

// Convex react mock — useQuery/useMutation/useAction stubs
vi.mock("convex/react", () => ({
  useQuery: vi.fn().mockReturnValue(undefined),
  useMutation: vi.fn().mockReturnValue(vi.fn()),
  useAction: vi.fn().mockReturnValue(vi.fn()),
  usePaginatedQuery: vi.fn().mockReturnValue({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}));

// Generated API types
vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    cases: { getCaseById: "cases:getCaseById", getCaseStatus: "cases:getCaseStatus", listCases: "cases:listCases" },
    checklists: {
      getChecklistByCase: "checklists:getChecklistByCase",
      getChecklistSummary: "checklists:getChecklistSummary",
      getChecklistWithInspection: "checklists:getChecklistWithInspection",
      getChecklistItemsByStatus: "checklists:getChecklistItemsByStatus",
      getUncheckedItems: "checklists:getUncheckedItems",
    },
    shipping: { listShipmentsByCase: "shipping:listShipmentsByCase", trackShipment: "shipping:trackShipment" },
    custody: { getLatestCustodyRecord: "custody:getLatestCustodyRecord", getCustodyRecordsByCase: "custody:getCustodyRecordsByCase", getCustodyChain: "custody:getCustodyChain" },
    custodyHandoffs: { handoffCustody: "custodyHandoffs:handoffCustody" },
    damageReports: { getDamageReportsByCase: "damageReports:getDamageReportsByCase" },
    notifications: { getUnreadForUser: "notifications:getUnreadForUser" },
    users: { getMe: "users:getMe" },
    qrCodes: { getQrCodeByCaseId: "qrCodes:getQrCodeByCaseId" },
    maps: { getMapData: "maps:getMapData" },
    "queries/events": { getCaseEventsPaginated: "queries/events:getCaseEventsPaginated", getDistinctActors: "queries/events:getDistinctActors", getCaseEvents: "queries/events:getCaseEvents" },
    "queries/shipment": { getShipmentEventsForAudit: "queries/shipment:getShipmentEventsForAudit", getCaseShipmentAndCustody: "queries/shipment:getCaseShipmentAndCustody", getCaseShippingLayout: "queries/shipment:getCaseShippingLayout" },
    "queries/damage": { getDamagePhotoReportsWithUrls: "queries/damage:getDamagePhotoReportsWithUrls" },
  },
}));

// CaseLabel stub
vi.mock("../../CaseLabel", () => ({
  CaseLabel: ({ caseId }: { caseId: string }) => <div data-testid="case-label" data-case-id={caseId} />,
}));

// StatusPill stub
vi.mock("../../StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind}>{kind}</span>
  ),
}));

// CustodySection stub
vi.mock("../CustodySection", () => ({
  default: ({ caseId, variant }: { caseId: string; variant?: string }) => (
    <div data-testid="custody-section" data-case-id={caseId} data-variant={variant} />
  ),
}));

// TrackingStatus stub
vi.mock("../../TrackingStatus", () => ({
  TrackingStatus: () => <div data-testid="tracking-status" />,
}));

// LabelManagementPanel stub
vi.mock("../../LabelManagementPanel", () => ({
  LabelManagementPanel: ({ caseId }: { caseId: string }) => (
    <div data-testid="label-management-panel" data-case-id={caseId} />
  ),
}));

// T1Shell stub
vi.mock("../T1Shell", () => ({
  default: ({ leftPanel, rightPanel }: { leftPanel: React.ReactNode; rightPanel: React.ReactNode }) => (
    <div data-testid="t1-shell">
      <div data-testid="t1-left">{leftPanel}</div>
      <div data-testid="t1-right">{rightPanel}</div>
    </div>
  ),
}));

// T1MapPanel stub
vi.mock("../T1MapPanel", () => ({
  T1MapPanel: ({ caseId }: { caseId: string }) => (
    <div data-testid="t1-map-panel" data-case-id={caseId} />
  ),
}));

// T1TimelinePanel stub
vi.mock("../T1TimelinePanel", () => ({
  T1TimelinePanel: ({ caseId }: { caseId: string }) => (
    <div data-testid="t1-timeline-panel" data-case-id={caseId} />
  ),
}));

// InlineStatusEditor stub
vi.mock("../InlineStatusEditor", () => ({
  InlineStatusEditor: ({ caseId, currentStatus }: { caseId: string; currentStatus: string }) => (
    <div data-testid="inline-status-editor" data-case-id={caseId} data-status={currentStatus} />
  ),
}));

// InlineHolderEditor stub
vi.mock("../InlineHolderEditor", () => ({
  InlineHolderEditor: ({ caseId }: { caseId: string }) => (
    <div data-testid="inline-holder-editor" data-case-id={caseId} />
  ),
}));

// useFedExTracking stub
vi.mock("../../../hooks/use-fedex-tracking", () => ({
  useFedExTracking: vi.fn().mockReturnValue({
    latestShipment: null,
    shipments: [],
    hasTracking: false,
    liveTracking: null,
    isRefreshing: false,
    isActiveShipment: false,
    refreshError: null,
    refreshTracking: vi.fn(),
  }),
}));

// use-damage-reports stub
// NOTE: Return `undefined` (loading), not `null`.  T1Overview guards with
// `summary === undefined` and T4Shipping guards with `summary === undefined`;
// returning `null` would bypass both guards and crash on `null.totalDamaged`.
vi.mock("../../../hooks/use-damage-reports", () => ({
  useDamageReportsByCase: vi.fn().mockReturnValue([]),
  useDamageReportSummary: vi.fn().mockReturnValue(undefined),
  useDamagePhotoReportsWithUrls: vi.fn().mockReturnValue([]),
  useDamageReportEvents: vi.fn().mockReturnValue([]),
}));

// use-shipment-status stub
vi.mock("../../../hooks/use-shipment-status", () => ({
  useLatestShipment: vi.fn().mockReturnValue(null),
  useCaseShippingLayout: vi.fn().mockReturnValue(null),
  useCaseShipmentAndCustody: vi.fn().mockReturnValue(null),
  useShipmentsByCase: vi.fn().mockReturnValue([]),
  useShipmentEventsForAudit: vi.fn().mockReturnValue([]),
  getTrackingUrl: (tn: string) => `https://fedex.com/track/${tn}`,
}));

// use-case-events stub
vi.mock("../../../hooks/use-case-events", () => ({
  usePaginatedCaseEvents: vi.fn().mockReturnValue({ results: [], status: "Exhausted", loadMore: vi.fn() }),
  useCaseEvents: vi.fn().mockReturnValue([]),
  useDistinctCaseActors: vi.fn().mockReturnValue([]),
  AUDIT_LEDGER_PAGE_SIZE: 20,
}));

// use-current-user stub — returns no permissions
vi.mock("../../../hooks/use-current-user", () => ({
  useCurrentUser: vi.fn().mockReturnValue({
    user: null,
    can: vi.fn().mockReturnValue(false),
    isLoading: false,
  }),
}));

// convex/rbac
vi.mock("../../../../convex/rbac", () => ({
  OPERATIONS: {
    QR_CODE_GENERATE: "qrCode:generate",
    CASE_WRITE: "case:write",
  },
}));

// CSS modules
vi.mock("../T1Overview.module.css", () => ({ default: {} }));
vi.mock("../T2Manifest.module.css", () => ({ default: {} }));
vi.mock("../T3Inspection.module.css", () => ({ default: {} }));
vi.mock("../T4Shipping.module.css", () => ({ default: {} }));
vi.mock("../T5Audit.module.css", () => ({ default: {} }));
vi.mock("../shared.module.css", () => ({ default: {} }));

// audit-hash-chain
vi.mock("../../../lib/audit-hash-chain", () => ({
  verifyHashChain: vi.fn().mockResolvedValue({ valid: true, checkedCount: 0 }),
}));

// exportAuditCsv
vi.mock("../../../lib/exportAuditCsv", () => ({
  exportAuditLedgerCsv: vi.fn(),
}));

// AuditLedgerTable and AuditLedgerFilterPanel stubs
vi.mock("../AuditLedgerTable", () => ({
  default: ({ rows }: { rows: unknown[] }) => (
    <div data-testid="audit-ledger-table" data-row-count={rows.length} />
  ),
}));
vi.mock("../AuditLedgerFilterPanel", () => ({
  default: ({ onFilterChange }: { onFilterChange: (f: unknown) => void }) => (
    <div data-testid="audit-filter-panel" onClick={() => onFilterChange({ dateFrom: "", dateTo: "", actor: "", action: "", caseIdSearch: "" })} />
  ),
}));

// next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inventory",
  useSearchParams: () => ({ get: () => null }),
}));

// telemetry
vi.mock("../../../lib/telemetry.lib", () => ({
  trackEvent: vi.fn(),
}));

// ─── Import SUTs after mocks ──────────────────────────────────────────────────
import T1Overview from "../T1Overview";
import T3Inspection from "../T3Inspection";
import T4Shipping from "../T4Shipping";
import T5Audit from "../T5Audit";

// ─── Import mocked modules for vi.mocked() access ────────────────────────────
// These are the mocked versions (vi.mock() is hoisted above these imports).
import * as ConvexReact from "convex/react";
import * as UseChecklistHooks from "../../../hooks/use-checklist";
import * as UseShipmentStatusHooks from "../../../hooks/use-shipment-status";

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: loading state
  mockUseChecklistSummaryT1.mockReturnValue(undefined);
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// T1Overview — ChecklistProgress subscription
// ─────────────────────────────────────────────────────────────────────────────

describe("T1Overview — useChecklistSummary subscription wiring", () => {
  /**
   * T1Overview requires a live case document before rendering the checklist
   * section. We wire the Convex useQuery mock to return a case doc so the
   * component progresses past its loading/not-found guards and renders the
   * ChecklistProgress sub-component.
   */
  const CASE_DOC = {
    _id: CASE_ID,
    label: "CASE-T1",
    status: "assembled",
    qrCode: "",
    assigneeName: "Alice",
    locationName: "Test Site",
    lat: 42.36,
    lng: -71.06,
    notes: "",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };

  beforeEach(() => {
    // Wire the Convex useQuery mock to return the case doc for getCaseById.
    // The `convex/react` `useQuery` mock is used by T1Overview's inline
    // `useQuery(api.cases.getCaseById, ...)` call.
    const { useQuery } = vi.mocked(ConvexReact);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useQuery as any).mockImplementation((queryFn: unknown) => {
      if (queryFn === "cases:getCaseById") return CASE_DOC;
      return undefined;
    });
  });

  it("calls useChecklistSummary with the correct caseId", () => {
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(5, 3, 1, 0));
    render(<T1Overview caseId={CASE_ID} />);
    expect(mockUseChecklistSummaryT1).toHaveBeenCalledWith(CASE_ID);
  });

  it("does not render the checklist progress section when summary is undefined (loading)", () => {
    mockUseChecklistSummaryT1.mockReturnValue(undefined);
    render(<T1Overview caseId={CASE_ID} />);
    // When undefined, ChecklistProgress renders nothing
    const progressBars = document.querySelectorAll("[role='progressbar']");
    expect(progressBars.length).toBe(0);
  });

  it("does not render checklist progress when there are no items (total === 0)", () => {
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(0, 0, 0, 0));
    render(<T1Overview caseId={CASE_ID} />);
    const progressBars = document.querySelectorAll("[role='progressbar']");
    expect(progressBars.length).toBe(0);
  });

  it("renders checklist progress bar when summary has items", () => {
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(5, 3, 1, 0));
    render(<T1Overview caseId={CASE_ID} />);
    // Progress bar is rendered with the correct aria values
    const progressBar = document.querySelector("[role='progressbar']");
    expect(progressBar).not.toBeNull();
    expect(progressBar?.getAttribute("aria-valuenow")).toBe("80");
  });

  it("shows damage count when items are damaged", () => {
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(5, 2, 2, 0));
    render(<T1Overview caseId={CASE_ID} />);
    expect(screen.getByText(/2 damaged/)).toBeTruthy();
  });

  it("shows missing count when items are missing", () => {
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(5, 3, 0, 1));
    render(<T1Overview caseId={CASE_ID} />);
    expect(screen.getByText(/1 missing/)).toBeTruthy();
  });

  it("re-renders with updated progress when subscription data changes", () => {
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(10, 3, 0, 0));
    const { rerender } = render(<T1Overview caseId={CASE_ID} />);

    // Initial: 30% progress
    let progressBar = document.querySelector("[role='progressbar']");
    expect(progressBar?.getAttribute("aria-valuenow")).toBe("30");

    // Simulate Convex subscription push: 8 of 10 items now reviewed
    act(() => {
      mockUseChecklistSummaryT1.mockReturnValue(makeSummary(10, 7, 1, 0));
    });
    rerender(<T1Overview caseId={CASE_ID} />);

    // Re-renders to show updated progress without page refresh
    progressBar = document.querySelector("[role='progressbar']");
    expect(progressBar?.getAttribute("aria-valuenow")).toBe("80");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3Inspection — useChecklistWithInspection subscription
// ─────────────────────────────────────────────────────────────────────────────

describe("T3Inspection — useChecklistWithInspection subscription wiring", () => {
  it("calls useChecklistWithInspection with the correct caseId", () => {
    const { useChecklistWithInspection } = vi.mocked(UseChecklistHooks);
    useChecklistWithInspection.mockReturnValue(makeChecklistWithInspection([], null));

    render(<T3Inspection caseId={CASE_ID} />);
    expect(useChecklistWithInspection).toHaveBeenCalledWith(CASE_ID);
  });

  it("renders loading spinner when subscription is pending (undefined)", () => {
    const { useChecklistWithInspection } = vi.mocked(UseChecklistHooks);
    useChecklistWithInspection.mockReturnValue(undefined);

    render(<T3Inspection caseId={CASE_ID} />);
    const busyEl = document.querySelector("[aria-busy='true']");
    expect(busyEl).not.toBeNull();
  });

  it("renders t3-inspection root element when data is available", () => {
    const { useChecklistWithInspection } = vi.mocked(UseChecklistHooks);
    useChecklistWithInspection.mockReturnValue(
      makeChecklistWithInspection(
        [makeItem("i1", "Battery", "ok")],
        { status: "in_progress", inspectorName: "Jane Tech" }
      )
    );

    render(<T3Inspection caseId={CASE_ID} />);
    expect(screen.getByTestId("t3-inspection")).toBeTruthy();
  });

  it("renders inspection inspector name when inspection data is provided", () => {
    const { useChecklistWithInspection } = vi.mocked(UseChecklistHooks);
    useChecklistWithInspection.mockReturnValue(
      makeChecklistWithInspection(
        [makeItem("i1", "Drone Body", "ok")],
        { status: "in_progress", inspectorName: "Alice Inspector" }
      )
    );

    render(<T3Inspection caseId={CASE_ID} />);
    expect(screen.getByText("Alice Inspector")).toBeTruthy();
  });

  it("renders progress bar with correct aria-valuenow from summary", () => {
    const { useChecklistWithInspection } = vi.mocked(UseChecklistHooks);
    const items = [
      makeItem("i1", "Item A", "ok"),
      makeItem("i2", "Item B", "ok"),
      makeItem("i3", "Item C", "unchecked"),
      makeItem("i4", "Item D", "unchecked"),
    ];
    useChecklistWithInspection.mockReturnValue(
      makeChecklistWithInspection(items, null)
    );

    render(<T3Inspection caseId={CASE_ID} />);
    const progressBar = document.querySelector("[role='progressbar']");
    expect(progressBar).not.toBeNull();
    // 2 of 4 reviewed = 50%
    expect(progressBar?.getAttribute("aria-valuenow")).toBe("50");
  });

  it("renders issues list when there are damaged or missing items", () => {
    const { useChecklistWithInspection } = vi.mocked(UseChecklistHooks);
    const items = [
      makeItem("i1", "Battery Pack", "damaged"),
      makeItem("i2", "Charger",      "missing"),
    ];
    useChecklistWithInspection.mockReturnValue(
      makeChecklistWithInspection(items, null)
    );

    render(<T3Inspection caseId={CASE_ID} />);
    expect(screen.getByText("Battery Pack")).toBeTruthy();
    expect(screen.getByText("Charger")).toBeTruthy();
  });

  it("re-renders when a SCAN app item update arrives via subscription push", () => {
    const { useChecklistWithInspection } = vi.mocked(UseChecklistHooks);

    // Initial: 1 unchecked item
    useChecklistWithInspection.mockReturnValue(
      makeChecklistWithInspection(
        [makeItem("i1", "Prop Kit", "unchecked")],
        null
      )
    );
    const { rerender } = render(<T3Inspection caseId={CASE_ID} />);

    // Initial progress: 0%
    let progressBar = document.querySelector("[role='progressbar']");
    expect(progressBar?.getAttribute("aria-valuenow")).toBe("0");

    // Simulate Convex push: technician marked item "ok"
    act(() => {
      useChecklistWithInspection.mockReturnValue(
        makeChecklistWithInspection(
          [makeItem("i1", "Prop Kit", "ok", { checkedByName: "Bob", checkedAt: TIMESTAMP + 1000 })],
          { status: "completed", inspectorName: "Bob", checkedItems: 1 }
        )
      );
    });
    rerender(<T3Inspection caseId={CASE_ID} />);

    // Component re-renders with updated data — no page refresh
    progressBar = document.querySelector("[role='progressbar']");
    expect(progressBar?.getAttribute("aria-valuenow")).toBe("100");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4Shipping — useChecklistSummary subscription (InspectionSummaryBanner)
// ─────────────────────────────────────────────────────────────────────────────

describe("T4Shipping — useChecklistSummary subscription wiring", () => {
  const CASE_DOC = {
    _id: CASE_ID,
    label: "CASE-T4",
    status: "transit_out",
    qrCode: "QR-T4-001",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };

  beforeEach(() => {
    const { useQuery } = vi.mocked(ConvexReact);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useQuery as any).mockImplementation((queryFn: unknown) => {
      if (queryFn === "cases:getCaseById") return CASE_DOC;
      return undefined;
    });
  });

  it("calls useChecklistSummary with the correct caseId for the InspectionSummaryBanner", () => {
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(5, 5, 0, 0));
    render(<T4Shipping caseId={CASE_ID} />);
    expect(mockUseChecklistSummaryT1).toHaveBeenCalledWith(CASE_ID);
  });

  it("does not render InspectionSummaryBanner when summary is undefined (loading)", () => {
    mockUseChecklistSummaryT1.mockReturnValue(undefined);
    render(<T4Shipping caseId={CASE_ID} />);
    // When summary is undefined, the banner renders nothing
    expect(screen.queryByLabelText("Pre-shipment inspection summary")).toBeNull();
  });

  it("does not render InspectionSummaryBanner when there are no items (total === 0)", () => {
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(0, 0, 0, 0));
    render(<T4Shipping caseId={CASE_ID} />);
    expect(screen.queryByLabelText("Pre-shipment inspection summary")).toBeNull();
  });

  it("renders InspectionSummaryBanner when summary has items", () => {
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(8, 6, 1, 0));
    render(<T4Shipping caseId={CASE_ID} />);
    const banner = screen.getByLabelText("Pre-shipment inspection summary");
    expect(banner).toBeTruthy();
  });

  it("shows correct progress in the banner", () => {
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(4, 2, 0, 0));
    render(<T4Shipping caseId={CASE_ID} />);
    // 2 of 4 reviewed = 50%
    const progressBar = document.querySelector("[role='progressbar']");
    expect(progressBar?.getAttribute("aria-valuenow")).toBe("50");
  });

  it("shows 'completed' status pill when all items reviewed with no issues", () => {
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(5, 5, 0, 0));
    render(<T4Shipping caseId={CASE_ID} />);
    const pills = screen.getAllByTestId("status-pill");
    const completedPill = pills.find((p) => p.getAttribute("data-kind") === "completed");
    expect(completedPill).toBeTruthy();
  });

  it("shows 'flagged' status pill when items are damaged", () => {
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(5, 3, 2, 0));
    render(<T4Shipping caseId={CASE_ID} />);
    const pills = screen.getAllByTestId("status-pill");
    const flaggedPill = pills.find((p) => p.getAttribute("data-kind") === "flagged");
    expect(flaggedPill).toBeTruthy();
  });

  it("re-renders InspectionSummaryBanner when subscription pushes updated data", () => {
    // Initial: 3 of 6 reviewed (50%)
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(6, 3, 0, 0));
    const { rerender } = render(<T4Shipping caseId={CASE_ID} />);

    let progressBar = document.querySelector("[role='progressbar']");
    expect(progressBar?.getAttribute("aria-valuenow")).toBe("50");

    // Simulate Convex push: all items now reviewed
    act(() => {
      mockUseChecklistSummaryT1.mockReturnValue(makeSummary(6, 6, 0, 0));
    });
    rerender(<T4Shipping caseId={CASE_ID} />);

    // Banner updates to show 100% — no page refresh
    progressBar = document.querySelector("[role='progressbar']");
    expect(progressBar?.getAttribute("aria-valuenow")).toBe("100");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5Audit — useChecklistByCase subscription (Manifest Snapshot)
// ─────────────────────────────────────────────────────────────────────────────

describe("T5Audit — useChecklistByCase subscription wiring", () => {
  const CASE_DOC = {
    _id: CASE_ID,
    label: "CASE-T5",
    status: "assembled",
    qrCode: "QR-T5-001",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };

  beforeEach(() => {
    const { useQuery } = vi.mocked(ConvexReact);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useQuery as any).mockImplementation((queryFn: unknown) => {
      if (queryFn === "cases:getCaseById") return CASE_DOC;
      return undefined;
    });
  });

  it("calls useChecklistByCase with the correct caseId", () => {
    const { useChecklistByCase } = vi.mocked(UseChecklistHooks);
    useChecklistByCase.mockReturnValue([]);

    render(<T5Audit caseId={CASE_ID} ffEnabled={true} />);
    expect(useChecklistByCase).toHaveBeenCalledWith(CASE_ID);
  });

  it("does not render the Manifest Snapshot section when checklistItems is an empty array", () => {
    const { useChecklistByCase } = vi.mocked(UseChecklistHooks);
    useChecklistByCase.mockReturnValue([]);

    render(<T5Audit caseId={CASE_ID} ffEnabled={true} />);
    expect(screen.queryByText("Manifest Snapshot")).toBeNull();
  });

  it("renders a loading spinner when checklistItems is undefined", () => {
    const { useChecklistByCase } = vi.mocked(UseChecklistHooks);
    useChecklistByCase.mockReturnValue(undefined);

    const { useShipmentsByCase, useShipmentEventsForAudit } = vi.mocked(UseShipmentStatusHooks);
    useShipmentsByCase.mockReturnValue([]);
    useShipmentEventsForAudit.mockReturnValue([]);

    render(<T5Audit caseId={CASE_ID} ffEnabled={true} />);
    // The inline loading skeleton for the checklist section is rendered
    const busyEl = document.querySelector("[aria-busy='true'][aria-label='Loading manifest snapshot']");
    expect(busyEl).not.toBeNull();
  });

  it("renders Manifest Snapshot section with item names when items are loaded", () => {
    const { useChecklistByCase } = vi.mocked(UseChecklistHooks);
    const items = [
      makeItem("i1", "Drone Body",  "ok",      { checkedByName: "Alice", checkedAt: TIMESTAMP }),
      makeItem("i2", "Battery Pack","damaged",  { notes: "Cracked casing" }),
      makeItem("i3", "Charger",     "missing"),
    ];
    useChecklistByCase.mockReturnValue(items);

    const { useShipmentsByCase, useShipmentEventsForAudit } = vi.mocked(UseShipmentStatusHooks);
    useShipmentsByCase.mockReturnValue([]);
    useShipmentEventsForAudit.mockReturnValue([]);

    render(<T5Audit caseId={CASE_ID} ffEnabled={true} />);

    expect(screen.getByText("Manifest Snapshot")).toBeTruthy();
    expect(screen.getByText("Drone Body")).toBeTruthy();
    expect(screen.getByText("Battery Pack")).toBeTruthy();
    expect(screen.getByText("Charger")).toBeTruthy();
  });

  it("renders status pills for each manifest item in the snapshot", () => {
    const { useChecklistByCase } = vi.mocked(UseChecklistHooks);
    const items = [
      makeItem("i1", "Item OK",      "ok"),
      makeItem("i2", "Item Damaged", "damaged"),
      makeItem("i3", "Item Missing", "missing"),
      makeItem("i4", "Item Pending", "unchecked"),
    ];
    useChecklistByCase.mockReturnValue(items);

    const { useShipmentsByCase, useShipmentEventsForAudit } = vi.mocked(UseShipmentStatusHooks);
    useShipmentsByCase.mockReturnValue([]);
    useShipmentEventsForAudit.mockReturnValue([]);

    render(<T5Audit caseId={CASE_ID} ffEnabled={true} />);

    const pills = screen.getAllByTestId("status-pill");
    const kinds = pills.map((p) => p.getAttribute("data-kind"));
    expect(kinds).toContain("completed");  // ok → completed
    expect(kinds).toContain("flagged");    // damaged → flagged
    expect(kinds).toContain("exception");  // missing → exception
    expect(kinds).toContain("pending");    // unchecked → pending
  });

  it("re-renders Manifest Snapshot when subscription pushes updated checklist state", () => {
    const { useChecklistByCase } = vi.mocked(UseChecklistHooks);
    const { useShipmentsByCase, useShipmentEventsForAudit } = vi.mocked(UseShipmentStatusHooks);
    useShipmentsByCase.mockReturnValue([]);
    useShipmentEventsForAudit.mockReturnValue([]);

    // Initial: two unchecked items
    useChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body",  "unchecked"),
      makeItem("i2", "Battery Pack","unchecked"),
    ]);
    const { rerender } = render(<T5Audit caseId={CASE_ID} ffEnabled={true} />);

    // Snapshot shows both items as unchecked
    let pills = screen.getAllByTestId("status-pill");
    let pendingPills = pills.filter((p) => p.getAttribute("data-kind") === "pending");
    expect(pendingPills.length).toBe(2);

    // Simulate Convex push: technician marked first item "ok"
    act(() => {
      useChecklistByCase.mockReturnValue([
        makeItem("i1", "Drone Body",  "ok",     { checkedByName: "Alice", checkedAt: TIMESTAMP + 500 }),
        makeItem("i2", "Battery Pack","unchecked"),
      ]);
    });
    rerender(<T5Audit caseId={CASE_ID} ffEnabled={true} />);

    // Snapshot re-renders with updated status pills — no page refresh
    pills = screen.getAllByTestId("status-pill");
    const completedPills = pills.filter((p) => p.getAttribute("data-kind") === "completed");
    pendingPills = pills.filter((p) => p.getAttribute("data-kind") === "pending");
    expect(completedPills.length).toBe(1);
    expect(pendingPills.length).toBe(1);
  });

  it("shows the feature flag gate when ffEnabled=false (no checklist subscription)", () => {
    render(<T5Audit caseId={CASE_ID} ffEnabled={false} />);
    expect(screen.getByTestId("t5-ff-gate")).toBeTruthy();
  });

  it("shows the item count badge in Manifest Snapshot section header", () => {
    const { useChecklistByCase } = vi.mocked(UseChecklistHooks);
    const { useShipmentsByCase, useShipmentEventsForAudit } = vi.mocked(UseShipmentStatusHooks);
    useShipmentsByCase.mockReturnValue([]);
    useShipmentEventsForAudit.mockReturnValue([]);
    useChecklistByCase.mockReturnValue([
      makeItem("i1", "Item A", "ok"),
      makeItem("i2", "Item B", "ok"),
      makeItem("i3", "Item C", "damaged"),
    ]);

    render(<T5Audit caseId={CASE_ID} ffEnabled={true} />);
    // The section header shows "3 items"
    expect(screen.getByText("3 items")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-layout contract: all T-layouts pass the same caseId to their hooks
// ─────────────────────────────────────────────────────────────────────────────

describe("Cross-layout contract — caseId threading", () => {
  const DIFFERENT_CASE_ID = "different-case-xyz";

  it("T1Overview useChecklistSummary is called with the provided caseId", () => {
    const { useQuery } = vi.mocked(ConvexReact);
    useQuery.mockReturnValue({
      _id: DIFFERENT_CASE_ID,
      label: "CASE-XYZ",
      status: "assembled",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    mockUseChecklistSummaryT1.mockReturnValue(undefined);

    render(<T1Overview caseId={DIFFERENT_CASE_ID} />);
    expect(mockUseChecklistSummaryT1).toHaveBeenCalledWith(DIFFERENT_CASE_ID);
    expect(mockUseChecklistSummaryT1).not.toHaveBeenCalledWith(CASE_ID);
  });

  it("T3Inspection useChecklistWithInspection is called with the provided caseId", () => {
    const { useChecklistWithInspection } = vi.mocked(UseChecklistHooks);
    useChecklistWithInspection.mockReturnValue(undefined);

    render(<T3Inspection caseId={DIFFERENT_CASE_ID} />);
    expect(useChecklistWithInspection).toHaveBeenCalledWith(DIFFERENT_CASE_ID);
    expect(useChecklistWithInspection).not.toHaveBeenCalledWith(CASE_ID);
  });

  it("T4Shipping useChecklistSummary is called with the provided caseId", () => {
    // T4Shipping has an early-return loading guard: if caseDoc === undefined,
    // InspectionSummaryBanner never renders and useChecklistSummary is not called.
    // Provide a valid case doc so the component fully renders.
    const { useQuery } = vi.mocked(ConvexReact);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useQuery as any).mockImplementation((queryFn: unknown) => {
      if (queryFn === "cases:getCaseById") {
        return {
          _id: DIFFERENT_CASE_ID,
          label: "CASE-XYZ",
          status: "transit_out",
          qrCode: "QR-XYZ",
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        };
      }
      return undefined;
    });
    // Return a non-zero summary so InspectionSummaryBanner renders past its
    // own guard (summary.total === 0 → return null).
    mockUseChecklistSummaryT1.mockReturnValue(makeSummary(3, 1, 0, 0));

    render(<T4Shipping caseId={DIFFERENT_CASE_ID} />);
    expect(mockUseChecklistSummaryT1).toHaveBeenCalledWith(DIFFERENT_CASE_ID);
    expect(mockUseChecklistSummaryT1).not.toHaveBeenCalledWith(CASE_ID);
  });

  it("T5Audit useChecklistByCase is called with the provided caseId", () => {
    const { useChecklistByCase } = vi.mocked(UseChecklistHooks);
    useChecklistByCase.mockReturnValue(undefined);

    render(<T5Audit caseId={DIFFERENT_CASE_ID} ffEnabled={true} />);
    expect(useChecklistByCase).toHaveBeenCalledWith(DIFFERENT_CASE_ID);
    expect(useChecklistByCase).not.toHaveBeenCalledWith(CASE_ID);
  });
});
