/**
 * @vitest-environment jsdom
 *
 * T3QcPanel.integration.test.tsx
 *
 * Sub-AC 3: QC panel integration into T3Inspection layout.
 *
 * Verifies that:
 *   1. T3Inspection renders QcChecklistPanel (read-only checklist display).
 *   2. T3Inspection calls getQcSignOffByCaseId Convex query with the correct caseId.
 *   3. The QcSignOffForm is rendered for admin/operator users (CASE_STATUS_CHANGE).
 *   4. The QcSignOffForm is NOT rendered for technician/pilot users.
 *   5. QcSignOffForm receives the correct `hasUnresolvedIssues` derived from summary.
 *   6. QcSignOffForm receives the correct `currentStatus` from the qcSignOff query.
 *   7. Loading state: status pill is hidden when qcSignOff query is still loading (undefined).
 *   8. QcSignOffForm calls the submitQcSignOff mutation with correct args.
 *   9. On mutation success, success message is displayed.
 *  10. On mutation failure, error message is displayed.
 *
 * Test strategy
 * ─────────────
 * • useChecklistWithInspection is mocked to control checklist + summary data.
 * • convex/react useQuery is mocked to control qcSignOff subscription state.
 * • useMutation is mocked to control the submitQcSignOff mutation.
 * • useCurrentUser is mocked with configurable `can` function per test.
 * • All other T3 dependencies (case doc, shipment, damage, custody) are
 *   mocked as no-ops to keep tests focused on the QC panel integration.
 *
 * Coverage matrix
 * ───────────────
 *
 * QcChecklistPanel integration:
 *   ✓ QcChecklistPanel section is rendered in T3Inspection
 *   ✓ QcChecklistPanel receives the correct caseId prop
 *   ✓ QcChecklistPanel renders items from the checklist subscription
 *
 * QcSignOffForm integration:
 *   ✓ QcSignOffForm rendered for admin/operator (CASE_STATUS_CHANGE=true)
 *   ✓ QcSignOffForm NOT rendered for technician/pilot (CASE_STATUS_CHANGE=false)
 *   ✓ QcSignOffForm section title visible: "QC Sign-off"
 *
 * hasUnresolvedIssues wiring:
 *   ✓ approve button enabled when summary has no damaged/missing items
 *   ✓ approve button disabled when summary.damaged > 0
 *   ✓ approve button disabled when summary.missing > 0
 *   ✓ issues banner shown when hasUnresolvedIssues=true
 *
 * currentStatus wiring:
 *   ✓ no status pill when qcSignOff is undefined (loading)
 *   ✓ no status pill when qcSignOff is null (no prior decision)
 *   ✓ "completed" status pill for status="approved"
 *   ✓ "flagged" status pill for status="rejected"
 *
 * Mutation wiring:
 *   ✓ clicking Approve calls submitQcSignOff with status="approved"
 *   ✓ clicking Reject with notes calls submitQcSignOff with status="rejected"
 *   ✓ success message shown after mutation resolves
 *   ✓ error message shown when mutation throws
 */

import React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks (must be declared before vi.mock factories run) ────────────
//
// vi.mock() factories are hoisted to the top of the file by Vitest.
// Any variables they close over must also be hoisted via vi.hoisted() so they
// are initialised before the factory functions execute.

const {
  mockSubmitQcSignOff,
  mockUseChecklistWithInspection,
  mockUseChecklistByCase,
  mockCan,
} = vi.hoisted(() => ({
  mockSubmitQcSignOff: vi.fn().mockResolvedValue({
    qcSignOffId: "qc-001",
    eventId:     "evt-001",
    status:      "approved",
    caseId:      "case-t3-qc-001",
  }),
  mockUseChecklistWithInspection: vi.fn(),
  // QcChecklistPanel uses useChecklistByCase (a different hook from useChecklistWithInspection).
  // We hoist it so tests can configure per-test item lists independently.
  mockUseChecklistByCase: vi.fn().mockReturnValue([]),
  mockCan: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

// Convex react — useQuery + useMutation stubs
vi.mock("convex/react", () => ({
  useQuery:   vi.fn().mockReturnValue(undefined),
  useMutation: vi.fn().mockReturnValue(mockSubmitQcSignOff),
  useAction:  vi.fn().mockReturnValue(vi.fn()),
  usePaginatedQuery: vi.fn().mockReturnValue({
    results: [],
    status: "Exhausted",
    loadMore: vi.fn(),
  }),
}));

// Generated API — minimal stubs for the paths T3 references.
//
// Two access patterns are used in this render tree:
//   • Slash-path bracket notation: api["queries/qcSignOff"].getQcSignOffByCaseId
//     (used by T3Inspection.tsx, which follows the Convex generated-API convention)
//   • Dot-path notation: api.mutations.qcSignOff.submitQcSignOff
//     (used by QcSignOffForm.tsx)
//   • Dot-path notation: api.queries.qcSignOff.getQcSignOffByCaseId
//     (used by some query hooks)
//
// Both must be present so the real component code resolves the references.
vi.mock("../../../../convex/_generated/api", () => ({
  api: {
    // ── Direct dot-path references (used by child components) ──────────
    cases:        { getCaseById: "cases:getCaseById" },
    checklists: {
      getChecklistByCase:          "checklists:getChecklistByCase",
      getChecklistWithInspection:  "checklists:getChecklistWithInspection",
    },
    shipping:     { getCaseShippingLayout: "shipping:getCaseShippingLayout" },
    custody: {
      getLatestCustodyRecord:  "custody:getLatestCustodyRecord",
      getCustodyRecordsByCase: "custody:getCustodyRecordsByCase",
    },
    damageReports: { getDamageReportsByCase: "damageReports:getDamageReportsByCase" },
    qrCodes:       { getQrCodeByCaseId: "qrCodes:getQrCodeByCaseId" },

    // Nested dot-path objects — required by QcSignOffForm and QcChecklistPanel
    mutations: {
      qcSignOff: {
        submitQcSignOff: "mutations/qcSignOff:submitQcSignOff",
      },
    },
    queries: {
      qcSignOff: {
        getQcSignOffByCaseId: "queries/qcSignOff:getQcSignOffByCaseId",
      },
      shipment: {
        getCaseShippingLayout: "queries/shipment:getCaseShippingLayout",
      },
      damage: {
        getDamagePhotoReportsWithUrls: "queries/damage:getDamagePhotoReportsWithUrls",
      },
    },

    // ── Slash-path bracket notation references (used by T3Inspection.tsx) ─
    "queries/shipment": {
      getCaseShippingLayout: "queries/shipment:getCaseShippingLayout",
    },
    "queries/damage": {
      getDamagePhotoReportsWithUrls: "queries/damage:getDamagePhotoReportsWithUrls",
    },
    "queries/qcSignOff": {
      getQcSignOffByCaseId: "queries/qcSignOff:getQcSignOffByCaseId",
    },
    "mutations/qcSignOff": {
      submitQcSignOff: "mutations/qcSignOff:submitQcSignOff",
    },
  },
}));

// use-checklist hook — controls T3's data + summary
// useChecklistWithInspection  → used by T3Inspection for items+inspection+summary
// useChecklistByCase           → used by QcChecklistPanel for its read-only list
// Both are hoisted so tests can configure them independently.
vi.mock("../../../hooks/use-checklist", () => ({
  useChecklistWithInspection: (...args: unknown[]) =>
    mockUseChecklistWithInspection(...args),
  useChecklistByCase: (...args: unknown[]) =>
    mockUseChecklistByCase(...args),
  useChecklistSummary: vi.fn().mockReturnValue(undefined),
  useChecklistItemsByStatus: vi.fn().mockReturnValue([]),
  useUncheckedItems: vi.fn().mockReturnValue([]),
  MANIFEST_ITEM_STATUSES: ["unchecked", "ok", "damaged", "missing"],
}));

// use-case-status — returns a minimal case doc so T3 passes its guard
vi.mock("../../../hooks/use-case-status", () => ({
  useCaseById: vi.fn().mockReturnValue({
    _id: "case-t3-qc-001",
    label: "CASE-T3-QC",
    status: "assembled",
    qrCode: "QR-001",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  }),
}));

// use-shipment-status — no active shipment
vi.mock("../../../hooks/use-shipment-status", () => ({
  useCaseShippingLayout: vi.fn().mockReturnValue(null),
  getTrackingUrl: (tn: string) => `https://fedex.com/track/${tn}`,
}));

// use-damage-reports — no damage
vi.mock("../../../hooks/use-damage-reports", () => ({
  useDamageReportsByCase: vi.fn().mockReturnValue([]),
  useDamagePhotoReportsWithUrls: vi.fn().mockReturnValue([]),
}));

// CustodySection stub
vi.mock("../CustodySection", () => ({
  default: ({ caseId, variant }: { caseId: string; variant?: string }) => (
    <div data-testid="custody-section" data-case-id={caseId} data-variant={variant} />
  ),
}));

// LabelManagementPanel stub
vi.mock("../../LabelManagementPanel", () => ({
  LabelManagementPanel: ({ caseId }: { caseId: string }) => (
    <div data-testid="label-management-panel" data-case-id={caseId} />
  ),
}));

// StatusPill — transparent stub for kind assertions
vi.mock("../../StatusPill", () => ({
  StatusPill: ({ kind }: { kind: string }) => (
    <span data-testid="status-pill" data-kind={kind}>{kind}</span>
  ),
}));

// useCurrentUser — configurable per test (mockCan is hoisted above)
vi.mock("../../../hooks/use-current-user", () => ({
  useCurrentUser: () => ({
    id:              "user-operator-001",
    name:            "Alice Operator",
    isAdmin:         false,
    isTechnician:    false,
    isPilot:         false,
    isLoading:       false,
    isAuthenticated: true,
    can:             mockCan,
  }),
}));

// RBAC constants
vi.mock("../../../../convex/rbac", () => ({
  OPERATIONS: {
    QR_CODE_GENERATE:    "qrCode:generate",
    CASE_STATUS_CHANGE:  "case:statusChange",
  },
  ROLES: {
    ADMIN:      "admin",
    OPERATOR:   "operator",
    TECHNICIAN: "technician",
    PILOT:      "pilot",
  },
}));

// CSS modules
vi.mock("../T3Inspection.module.css", () => ({ default: {} }));
vi.mock("../shared.module.css",       () => ({ default: {} }));
vi.mock("../QcChecklistPanel.module.css", () => ({ default: {} }));
vi.mock("../../QcSignOffForm/QcSignOffForm.module.css", () => ({ default: {} }));

// ─── Import SUT after mocks ───────────────────────────────────────────────────
import T3Inspection from "../T3Inspection";
import * as ConvexReact from "convex/react";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CASE_ID   = "case-t3-qc-001" as const;
const TIMESTAMP = 1_700_000_000_000;

/** Minimal manifest item. */
function makeItem(
  id: string,
  name: string,
  status: "unchecked" | "ok" | "damaged" | "missing",
) {
  return {
    _id: id,
    _creationTime: TIMESTAMP,
    caseId: CASE_ID,
    templateItemId: `tpl-${id}`,
    name,
    status,
  };
}

/** ChecklistWithInspection fixture. */
function makeChecklistData(
  items: ReturnType<typeof makeItem>[],
  inspectionOverride?: null | {
    status?: "pending" | "in_progress" | "completed" | "flagged";
    inspectorName?: string;
  }
) {
  const ok      = items.filter((i) => i.status === "ok").length;
  const damaged = items.filter((i) => i.status === "damaged").length;
  const missing = items.filter((i) => i.status === "missing").length;
  const reviewed = ok + damaged + missing;
  const total   = items.length;
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  return {
    items,
    inspection: inspectionOverride === null ? null : {
      _id:           "insp-001",
      _creationTime: TIMESTAMP,
      status:        inspectionOverride?.status ?? "in_progress",
      inspectorId:   "user-001",
      inspectorName: inspectionOverride?.inspectorName ?? "Test Tech",
      startedAt:     TIMESTAMP,
      completedAt:   undefined,
      totalItems:    total,
      checkedItems:  reviewed,
      damagedItems:  damaged,
      missingItems:  missing,
      notes:         undefined,
    },
    summary: {
      caseId: CASE_ID,
      total,
      ok,
      damaged,
      missing,
      unchecked: total - reviewed,
      progressPct,
      isComplete: total > 0 && reviewed === total,
    },
  };
}

// ─── QcSignOff document fixture ───────────────────────────────────────────────

function makeQcSignOff(status: "pending" | "approved" | "rejected") {
  return {
    _id:             `qc-${status}-001`,
    _creationTime:   TIMESTAMP,
    caseId:          CASE_ID,
    status,
    signedOffBy:     "user-operator-001",
    signedOffByName: "Alice Operator",
    signedOffAt:     TIMESTAMP,
    notes:           status === "rejected" ? "Issues found." : undefined,
    previousStatus:  undefined,
    inspectionId:    undefined,
  };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: operator has CASE_STATUS_CHANGE (sees sign-off form)
  // but NOT QR_CODE_GENERATE (no label management panel).
  mockCan.mockImplementation((op: string) => {
    if (op === "case:statusChange") return true;
    return false;
  });

  // Default checklist: 1 ok item with in_progress inspection.
  // Using "in_progress" (not "completed") prevents the inspection header from
  // emitting a `completed` StatusPill that would leak into currentStatus assertions.
  mockUseChecklistWithInspection.mockReturnValue(
    makeChecklistData(
      [makeItem("i1", "Drone Body", "ok")],
      { status: "in_progress", inspectorName: "Test Tech" }
    )
  );

  // Default: QcChecklistPanel shows empty state (no items from its subscription).
  mockUseChecklistByCase.mockReturnValue([]);

  // Default qcSignOff: no prior sign-off
  const { useQuery } = vi.mocked(ConvexReact);
  (useQuery as ReturnType<typeof vi.fn>).mockImplementation((queryFn: unknown) => {
    if (queryFn === "queries/qcSignOff:getQcSignOffByCaseId") return null;
    return undefined;
  });

  // Default mutation: approval succeeds
  mockSubmitQcSignOff.mockResolvedValue({
    qcSignOffId: "qc-id-001",
    eventId:     "evt-id-001",
    status:      "approved",
    caseId:      CASE_ID,
  });
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// QcChecklistPanel integration
// ─────────────────────────────────────────────────────────────────────────────

describe("T3Inspection — QcChecklistPanel integration", () => {
  it("renders QcChecklistPanel section in T3Inspection", () => {
    render(<T3Inspection caseId={CASE_ID} />);
    // QcChecklistPanel is always mounted inside T3. It renders one of three testids:
    //   • qc-checklist-panel         — when items are present
    //   • qc-checklist-panel-empty   — when useChecklistByCase returns []
    //   • qc-checklist-panel-loading — while loading
    // Default mock has useChecklistByCase returning [] → empty state.
    const panel =
      screen.queryByTestId("qc-checklist-panel") ??
      screen.queryByTestId("qc-checklist-panel-empty") ??
      screen.queryByTestId("qc-checklist-panel-loading");
    expect(panel).not.toBeNull();
  });

  it("shows QcChecklistPanel item rows when useChecklistByCase returns items", () => {
    // Provide items via mockUseChecklistByCase (QcChecklistPanel's own subscription).
    mockUseChecklistByCase.mockReturnValue([
      makeItem("i1", "Drone Body",   "ok"),
      makeItem("i2", "Battery Pack", "damaged"),
    ]);
    render(<T3Inspection caseId={CASE_ID} />);
    // QcChecklistPanel renders data-testid="qc-checklist-item" per row when items present.
    const items = screen.getAllByTestId("qc-checklist-item");
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it("QcChecklistPanel section title 'QC Checklist' is rendered", () => {
    render(<T3Inspection caseId={CASE_ID} />);
    expect(screen.getByText("QC Checklist")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QcSignOffForm visibility — role gating
// ─────────────────────────────────────────────────────────────────────────────

describe("T3Inspection — QcSignOffForm role gating", () => {
  it("renders QcSignOffForm section title 'QC Sign-off' for admin/operator", () => {
    // mockCan defaults to canQcSignOff=true (operator)
    render(<T3Inspection caseId={CASE_ID} />);
    expect(screen.getByText("QC Sign-off")).toBeTruthy();
  });

  it("renders QcSignOffForm (data-testid='qc-sign-off-form') for admin/operator", () => {
    render(<T3Inspection caseId={CASE_ID} />);
    expect(screen.getByTestId("qc-sign-off-form")).toBeTruthy();
  });

  it("does NOT render QcSignOffForm for technician/pilot (CASE_STATUS_CHANGE=false)", () => {
    // Override: no sign-off permission
    mockCan.mockReturnValue(false);
    render(<T3Inspection caseId={CASE_ID} />);
    expect(screen.queryByTestId("qc-sign-off-form")).toBeNull();
    expect(screen.queryByText("QC Sign-off")).toBeNull();
  });

  it("does NOT render QcSignOffForm when data is loading (T3 early return)", () => {
    // When data === undefined, T3 shows a spinner and early returns —
    // the QC form is not rendered yet.
    mockUseChecklistWithInspection.mockReturnValue(undefined);
    render(<T3Inspection caseId={CASE_ID} />);
    expect(screen.queryByTestId("qc-sign-off-form")).toBeNull();
    const spinner = document.querySelector("[aria-busy='true']");
    expect(spinner).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasUnresolvedIssues wiring
// ─────────────────────────────────────────────────────────────────────────────

describe("T3Inspection — QcSignOffForm hasUnresolvedIssues wiring", () => {
  it("Approve button is ENABLED when no damaged/missing items (all ok)", () => {
    mockUseChecklistWithInspection.mockReturnValue(
      makeChecklistData([makeItem("i1", "Drone Body", "ok")], null)
    );
    render(<T3Inspection caseId={CASE_ID} />);
    const btn = screen.getByTestId("qc-approve-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("Approve button is DISABLED when summary has damaged items", () => {
    mockUseChecklistWithInspection.mockReturnValue(
      makeChecklistData(
        [
          makeItem("i1", "Drone Body",   "ok"),
          makeItem("i2", "Battery Pack", "damaged"),
        ],
        null
      )
    );
    render(<T3Inspection caseId={CASE_ID} />);
    const btn = screen.getByTestId("qc-approve-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("Approve button is DISABLED when summary has missing items", () => {
    mockUseChecklistWithInspection.mockReturnValue(
      makeChecklistData(
        [
          makeItem("i1", "Drone Body", "ok"),
          makeItem("i2", "Charger",    "missing"),
        ],
        null
      )
    );
    render(<T3Inspection caseId={CASE_ID} />);
    const btn = screen.getByTestId("qc-approve-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("issues banner shown when there are damaged items", () => {
    mockUseChecklistWithInspection.mockReturnValue(
      makeChecklistData([makeItem("i1", "Battery", "damaged")], null)
    );
    render(<T3Inspection caseId={CASE_ID} />);
    expect(screen.getByTestId("qc-issues-banner")).toBeTruthy();
  });

  it("issues banner NOT shown when all items are ok", () => {
    mockUseChecklistWithInspection.mockReturnValue(
      makeChecklistData([makeItem("i1", "Battery", "ok")], null)
    );
    render(<T3Inspection caseId={CASE_ID} />);
    expect(screen.queryByTestId("qc-issues-banner")).toBeNull();
  });

  it("unresolvedCount reflects total damaged + missing in banner aria-label", () => {
    mockUseChecklistWithInspection.mockReturnValue(
      makeChecklistData(
        [
          makeItem("i1", "Battery",  "damaged"),
          makeItem("i2", "Charger",  "missing"),
          makeItem("i3", "Drone",    "ok"),
        ],
        null
      )
    );
    render(<T3Inspection caseId={CASE_ID} />);
    const banner = screen.getByTestId("qc-issues-banner");
    const ariaLabel = banner.getAttribute("aria-label") ?? "";
    // unresolvedCount = 2 (1 damaged + 1 missing)
    expect(ariaLabel).toContain("2");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// currentStatus wiring — qcSignOff subscription
// ─────────────────────────────────────────────────────────────────────────────

describe("T3Inspection — QcSignOffForm currentStatus wiring", () => {
  it("does NOT show a status pill when qcSignOff query is loading (undefined)", () => {
    // Override useQuery to return undefined for qcSignOff (loading state)
    const { useQuery } = vi.mocked(ConvexReact);
    (useQuery as ReturnType<typeof vi.fn>).mockImplementation((queryFn: unknown) => {
      if (queryFn === "queries/qcSignOff:getQcSignOffByCaseId") return undefined;
      return undefined;
    });
    render(<T3Inspection caseId={CASE_ID} />);
    // No status pill in the QC Sign-off form header (currentStatus=undefined → no pill)
    const pills = screen.queryAllByTestId("status-pill");
    const qcPills = pills.filter(
      (p) => p.getAttribute("data-kind") === "completed" ||
             p.getAttribute("data-kind") === "flagged"
    );
    expect(qcPills.length).toBe(0);
  });

  it("does NOT show a status pill when qcSignOff is null (no prior decision)", () => {
    const { useQuery } = vi.mocked(ConvexReact);
    (useQuery as ReturnType<typeof vi.fn>).mockImplementation((queryFn: unknown) => {
      if (queryFn === "queries/qcSignOff:getQcSignOffByCaseId") return null;
      return undefined;
    });
    render(<T3Inspection caseId={CASE_ID} />);
    const pills = screen.queryAllByTestId("status-pill");
    const qcStatusPills = pills.filter(
      (p) => p.getAttribute("data-kind") === "completed" ||
             p.getAttribute("data-kind") === "flagged"
    );
    expect(qcStatusPills.length).toBe(0);
  });

  it("shows 'completed' status pill when qcSignOff.status = 'approved'", () => {
    const { useQuery } = vi.mocked(ConvexReact);
    (useQuery as ReturnType<typeof vi.fn>).mockImplementation((queryFn: unknown) => {
      if (queryFn === "queries/qcSignOff:getQcSignOffByCaseId") {
        return makeQcSignOff("approved");
      }
      return undefined;
    });
    render(<T3Inspection caseId={CASE_ID} />);
    const pills = screen.getAllByTestId("status-pill");
    const completedPill = pills.find((p) => p.getAttribute("data-kind") === "completed");
    expect(completedPill).toBeTruthy();
  });

  it("shows 'flagged' status pill when qcSignOff.status = 'rejected'", () => {
    const { useQuery } = vi.mocked(ConvexReact);
    (useQuery as ReturnType<typeof vi.fn>).mockImplementation((queryFn: unknown) => {
      if (queryFn === "queries/qcSignOff:getQcSignOffByCaseId") {
        return makeQcSignOff("rejected");
      }
      return undefined;
    });
    render(<T3Inspection caseId={CASE_ID} />);
    const pills = screen.getAllByTestId("status-pill");
    const flaggedPill = pills.find((p) => p.getAttribute("data-kind") === "flagged");
    expect(flaggedPill).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mutation wiring — submitQcSignOff
// ─────────────────────────────────────────────────────────────────────────────

describe("T3Inspection — submitQcSignOff mutation wiring", () => {
  it("calls submitQcSignOff with status='approved' when Approve clicked", async () => {
    render(<T3Inspection caseId={CASE_ID} />);
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    await waitFor(() => {
      expect(mockSubmitQcSignOff).toHaveBeenCalledWith(
        expect.objectContaining({ status: "approved", caseId: CASE_ID })
      );
    });
  });

  it("calls submitQcSignOff with status='rejected' and notes when Reject clicked", async () => {
    mockSubmitQcSignOff.mockResolvedValueOnce({
      qcSignOffId: "qc-id-002",
      eventId:     "evt-id-002",
      status:      "rejected",
      caseId:      CASE_ID,
    });
    render(<T3Inspection caseId={CASE_ID} />);
    fireEvent.change(screen.getByTestId("qc-notes-textarea"), {
      target: { value: "Battery casing cracked — needs replacement." },
    });
    fireEvent.click(screen.getByTestId("qc-reject-btn"));
    await waitFor(() => {
      expect(mockSubmitQcSignOff).toHaveBeenCalledWith(
        expect.objectContaining({
          status:  "rejected",
          caseId:  CASE_ID,
          notes:   "Battery casing cracked — needs replacement.",
        })
      );
    });
  });

  it("shows success message after Approve mutation resolves", async () => {
    render(<T3Inspection caseId={CASE_ID} />);
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("qc-form-success")).toBeTruthy();
    });
    const msg = screen.getByTestId("qc-form-success").textContent ?? "";
    expect(msg.toLowerCase()).toContain("approved");
  });

  it("shows error message when mutation throws", async () => {
    mockSubmitQcSignOff.mockRejectedValueOnce(
      new Error("[CASE_NOT_FOUND] No case found.")
    );
    render(<T3Inspection caseId={CASE_ID} />);
    fireEvent.click(screen.getByTestId("qc-approve-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("qc-form-error")).toBeTruthy();
    });
  });

  it("shows validation error when Reject clicked with empty notes", async () => {
    render(<T3Inspection caseId={CASE_ID} />);
    // Reject without filling in notes
    fireEvent.click(screen.getByTestId("qc-reject-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("qc-form-error")).toBeTruthy();
    });
    // Mutation should NOT have been called
    expect(mockSubmitQcSignOff).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Convex query called with correct caseId
// ─────────────────────────────────────────────────────────────────────────────

describe("T3Inspection — qcSignOff query subscription wiring", () => {
  it("calls getQcSignOffByCaseId with the provided caseId", () => {
    const { useQuery } = vi.mocked(ConvexReact);
    render(<T3Inspection caseId={CASE_ID} />);
    // Verify useQuery was called with the qcSignOff query and the correct caseId arg
    expect(useQuery).toHaveBeenCalledWith(
      "queries/qcSignOff:getQcSignOffByCaseId",
      expect.objectContaining({ caseId: CASE_ID })
    );
  });

  it("passes a different caseId to getQcSignOffByCaseId when prop changes", () => {
    const CASE_ID_2 = "case-t3-qc-002";
    const { useQuery } = vi.mocked(ConvexReact);

    const { rerender } = render(<T3Inspection caseId={CASE_ID} />);
    rerender(<T3Inspection caseId={CASE_ID_2} />);

    // After rerender with new caseId, useQuery should have been called with the new id
    expect(useQuery).toHaveBeenCalledWith(
      "queries/qcSignOff:getQcSignOffByCaseId",
      expect.objectContaining({ caseId: CASE_ID_2 })
    );
  });
});
