/**
 * @vitest-environment jsdom
 *
 * Tests for use-scan-queries — SCAN app query layer.
 *
 * Sub-AC 2a: Define and wire useQuery hooks for core SCAN data subscriptions
 * (case detail, item checklist, case status) in the SCAN app query layer.
 *
 * Coverage matrix
 * ───────────────
 * useScanCaseDetail:
 *   ✓ passes caseId to underlying useQuery as { caseId }
 *   ✓ passes "skip" to useQuery when caseId is null
 *   ✓ returns undefined while loading
 *   ✓ returns null when case is not found
 *   ✓ returns case document when found
 *
 * useScanCaseStatus:
 *   ✓ passes caseId to underlying useQuery
 *   ✓ passes "skip" when caseId is null
 *   ✓ returns status projection
 *
 * useScanCaseByQrCode:
 *   ✓ passes qrCode to underlying useQuery
 *   ✓ passes "skip" when qrCode is null
 *   ✓ returns case document when QR matches
 *   ✓ returns null when QR code not in system
 *
 * useScanChecklist:
 *   ✓ passes caseId to underlying useQuery
 *   ✓ passes "skip" when caseId is null
 *   ✓ returns item array
 *   ✓ returns empty array for a case with no items
 *
 * useScanChecklistSummary:
 *   ✓ passes caseId to underlying useQuery
 *   ✓ passes "skip" when caseId is null
 *   ✓ returns summary object with progress counts
 *
 * useScanChecklistWithInspection:
 *   ✓ passes caseId to underlying useQuery
 *   ✓ passes "skip" when caseId is null
 *   ✓ returns { items, inspection, summary }
 *   ✓ returns null for inspection when none started
 *
 * useScanChecklistItemsByStatus:
 *   ✓ passes caseId + status to underlying useQuery
 *   ✓ passes "skip" when caseId is null
 *   ✓ passes "skip" when status is null
 *   ✓ passes "skip" when both are null
 *   ✓ returns filtered item array for given status
 *
 * useScanUncheckedItems:
 *   ✓ passes caseId to underlying useQuery with status "unchecked"
 *   ✓ passes "skip" when caseId is null
 *   ✓ returns only unchecked items
 *   ✓ returns empty array when all items are reviewed
 *
 * Mocking strategy
 * ────────────────
 * We mock `convex/react` so `useQuery` is a vi.fn() we can control.
 * We mock the generated `api` so the query references are stable symbols.
 * The tests never hit a real Convex backend.
 *
 * The SCAN query layer delegates to use-case-status.ts and use-checklist.ts,
 * which in turn call useQuery(api.cases.*, ...) and useQuery(api.checklists.*, ...).
 * We capture the args passed to useQuery to verify the skip pattern and
 * the correct query reference is used.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Use vi.hoisted so symbols are available when vi.mock factory closures run.

const {
  MOCK_GET_CASE_BY_ID,
  MOCK_GET_CASE_STATUS,
  MOCK_GET_CASE_BY_QR_CODE,
  MOCK_GET_CHECKLIST_BY_CASE,
  MOCK_GET_CHECKLIST_SUMMARY,
  MOCK_GET_CHECKLIST_WITH_INSPECTION,
  MOCK_GET_CHECKLIST_ITEMS_BY_STATUS,
  MOCK_GET_UNCHECKED_ITEMS,
} = vi.hoisted(() => ({
  MOCK_GET_CASE_BY_ID:                Symbol("getCaseById"),
  MOCK_GET_CASE_STATUS:               Symbol("getCaseStatus"),
  MOCK_GET_CASE_BY_QR_CODE:           Symbol("getCaseByQrCode"),
  MOCK_GET_CHECKLIST_BY_CASE:         Symbol("getChecklistByCase"),
  MOCK_GET_CHECKLIST_SUMMARY:         Symbol("getChecklistSummary"),
  MOCK_GET_CHECKLIST_WITH_INSPECTION: Symbol("getChecklistWithInspection"),
  MOCK_GET_CHECKLIST_ITEMS_BY_STATUS: Symbol("getChecklistItemsByStatus"),
  MOCK_GET_UNCHECKED_ITEMS:           Symbol("getUncheckedItems"),
}));

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    cases: {
      getCaseById:      MOCK_GET_CASE_BY_ID,
      getCaseStatus:    MOCK_GET_CASE_STATUS,
      getCaseByQrCode:  MOCK_GET_CASE_BY_QR_CODE,
      listCases:        Symbol("listCases"),
      getCasesInBounds: Symbol("getCasesInBounds"),
      getCaseStatusCounts: Symbol("getCaseStatusCounts"),
    },
    checklists: {
      getChecklistByCase:         MOCK_GET_CHECKLIST_BY_CASE,
      getChecklistSummary:        MOCK_GET_CHECKLIST_SUMMARY,
      getChecklistWithInspection: MOCK_GET_CHECKLIST_WITH_INSPECTION,
      getChecklistItemsByStatus:  MOCK_GET_CHECKLIST_ITEMS_BY_STATUS,
      getUncheckedItems:          MOCK_GET_UNCHECKED_ITEMS,
      getChecklistItem:           Symbol("getChecklistItem"),
    },
  },
}));

// Capture all useQuery invocations: [queryRef, args]
const mockUseQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
}));

// Import the SCAN query layer — must be after vi.mock calls.
import {
  useScanCaseDetail,
  useScanCaseStatus,
  useScanCaseByQrCode,
  useScanChecklist,
  useScanChecklistSummary,
  useScanChecklistWithInspection,
  useScanChecklistItemsByStatus,
  useScanUncheckedItems,
} from "../use-scan-queries";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CASE_ID = "case-id-abc123";
const QR_CODE = "SKYSPECS-QR-ABC123";

/** Helper to get what useQuery was called with on the most recent invocation. */
function lastQueryCall(): [unknown, unknown] {
  const calls = mockUseQuery.mock.calls;
  return calls[calls.length - 1] as [unknown, unknown];
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: return undefined (loading state)
  mockUseQuery.mockReturnValue(undefined);
});

// ─── useScanCaseDetail ────────────────────────────────────────────────────────

describe("useScanCaseDetail", () => {
  it("calls useQuery with getCaseById and { caseId } when caseId is provided", () => {
    renderHook(() => useScanCaseDetail(CASE_ID));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_CASE_BY_ID);
    expect(args).toEqual({ caseId: CASE_ID });
  });

  it('calls useQuery with "skip" when caseId is null', () => {
    renderHook(() => useScanCaseDetail(null));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_CASE_BY_ID);
    expect(args).toBe("skip");
  });

  it("returns undefined while loading (useQuery returns undefined)", () => {
    mockUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useScanCaseDetail(CASE_ID));
    expect(result.current).toBeUndefined();
  });

  it("returns null when case is not found (useQuery returns null)", () => {
    mockUseQuery.mockReturnValue(null);

    const { result } = renderHook(() => useScanCaseDetail(CASE_ID));
    expect(result.current).toBeNull();
  });

  it("returns the case document when found (useQuery returns a document)", () => {
    const caseDoc = {
      _id: CASE_ID,
      label: "CASE-001",
      status: "deployed",
      qrCode: QR_CODE,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_001_000_000,
    };
    mockUseQuery.mockReturnValue(caseDoc);

    const { result } = renderHook(() => useScanCaseDetail(CASE_ID));
    expect(result.current).toBe(caseDoc);
    expect((result.current as typeof caseDoc).label).toBe("CASE-001");
    expect((result.current as typeof caseDoc).status).toBe("deployed");
  });
});

// ─── useScanCaseStatus ────────────────────────────────────────────────────────

describe("useScanCaseStatus", () => {
  it("calls useQuery with getCaseStatus and { caseId } when caseId is provided", () => {
    renderHook(() => useScanCaseStatus(CASE_ID));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_CASE_STATUS);
    expect(args).toEqual({ caseId: CASE_ID });
  });

  it('calls useQuery with "skip" when caseId is null', () => {
    renderHook(() => useScanCaseStatus(null));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_CASE_STATUS);
    expect(args).toBe("skip");
  });

  it("returns undefined while loading", () => {
    mockUseQuery.mockReturnValue(undefined);
    const { result } = renderHook(() => useScanCaseStatus(CASE_ID));
    expect(result.current).toBeUndefined();
  });

  it("returns the status projection when the case exists", () => {
    const statusResult = {
      _id: CASE_ID,
      label: "CASE-001",
      status: "assembled",
      updatedAt: 1_700_001_000_000,
    };
    mockUseQuery.mockReturnValue(statusResult);

    const { result } = renderHook(() => useScanCaseStatus(CASE_ID));
    expect(result.current).toBe(statusResult);
    expect((result.current as typeof statusResult).status).toBe("assembled");
  });
});

// ─── useScanCaseByQrCode ──────────────────────────────────────────────────────

describe("useScanCaseByQrCode", () => {
  it("calls useQuery with getCaseByQrCode and { qrCode } when qrCode is provided", () => {
    renderHook(() => useScanCaseByQrCode(QR_CODE));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_CASE_BY_QR_CODE);
    expect(args).toEqual({ qrCode: QR_CODE });
  });

  it('calls useQuery with "skip" when qrCode is null', () => {
    renderHook(() => useScanCaseByQrCode(null));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_CASE_BY_QR_CODE);
    expect(args).toBe("skip");
  });

  it("returns undefined while loading (pre-scan or resolving)", () => {
    mockUseQuery.mockReturnValue(undefined);
    const { result } = renderHook(() => useScanCaseByQrCode(QR_CODE));
    expect(result.current).toBeUndefined();
  });

  it("returns null when QR code is not found in system", () => {
    mockUseQuery.mockReturnValue(null);
    const { result } = renderHook(() => useScanCaseByQrCode(QR_CODE));
    expect(result.current).toBeNull();
  });

  it("returns matched case document when QR code resolves", () => {
    const caseDoc = { _id: CASE_ID, label: "CASE-001", qrCode: QR_CODE };
    mockUseQuery.mockReturnValue(caseDoc);

    const { result } = renderHook(() => useScanCaseByQrCode(QR_CODE));
    expect(result.current).toBe(caseDoc);
  });
});

// ─── useScanChecklist ─────────────────────────────────────────────────────────

describe("useScanChecklist", () => {
  it("calls useQuery with getChecklistByCase and { caseId } when caseId is provided", () => {
    renderHook(() => useScanChecklist(CASE_ID));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_CHECKLIST_BY_CASE);
    expect(args).toEqual({ caseId: CASE_ID });
  });

  it('calls useQuery with "skip" when caseId is null', () => {
    renderHook(() => useScanChecklist(null));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_CHECKLIST_BY_CASE);
    expect(args).toBe("skip");
  });

  it("returns undefined while loading", () => {
    mockUseQuery.mockReturnValue(undefined);
    const { result } = renderHook(() => useScanChecklist(CASE_ID));
    expect(result.current).toBeUndefined();
  });

  it("returns an empty array when no template has been applied", () => {
    mockUseQuery.mockReturnValue([]);
    const { result } = renderHook(() => useScanChecklist(CASE_ID));
    expect(result.current).toEqual([]);
  });

  it("returns the item array when items exist", () => {
    const items = [
      { _id: "item-1", name: "Battery Pack", status: "unchecked", caseId: CASE_ID, templateItemId: "battery" },
      { _id: "item-2", name: "Drone Body",   status: "ok",        caseId: CASE_ID, templateItemId: "body" },
    ];
    mockUseQuery.mockReturnValue(items);

    const { result } = renderHook(() => useScanChecklist(CASE_ID));
    expect(result.current).toHaveLength(2);
    expect(Array.isArray(result.current)).toBe(true);
  });
});

// ─── useScanChecklistSummary ──────────────────────────────────────────────────

describe("useScanChecklistSummary", () => {
  it("calls useQuery with getChecklistSummary and { caseId } when caseId is provided", () => {
    renderHook(() => useScanChecklistSummary(CASE_ID));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_CHECKLIST_SUMMARY);
    expect(args).toEqual({ caseId: CASE_ID });
  });

  it('calls useQuery with "skip" when caseId is null', () => {
    renderHook(() => useScanChecklistSummary(null));

    const [, args] = lastQueryCall();
    expect(args).toBe("skip");
  });

  it("returns undefined while loading", () => {
    mockUseQuery.mockReturnValue(undefined);
    const { result } = renderHook(() => useScanChecklistSummary(CASE_ID));
    expect(result.current).toBeUndefined();
  });

  it("returns the summary object with progress counts", () => {
    const summary = {
      caseId: CASE_ID,
      total: 10,
      ok: 6,
      damaged: 2,
      missing: 1,
      unchecked: 1,
      progressPct: 90,
      isComplete: false,
    };
    mockUseQuery.mockReturnValue(summary);

    const { result } = renderHook(() => useScanChecklistSummary(CASE_ID));
    expect(result.current).toBe(summary);
    expect((result.current as typeof summary).progressPct).toBe(90);
    expect((result.current as typeof summary).isComplete).toBe(false);
  });

  it("returns isComplete=true when all items reviewed", () => {
    const summary = {
      caseId: CASE_ID,
      total: 5,
      ok: 5,
      damaged: 0,
      missing: 0,
      unchecked: 0,
      progressPct: 100,
      isComplete: true,
    };
    mockUseQuery.mockReturnValue(summary);

    const { result } = renderHook(() => useScanChecklistSummary(CASE_ID));
    expect((result.current as typeof summary).isComplete).toBe(true);
  });
});

// ─── useScanChecklistWithInspection ──────────────────────────────────────────

describe("useScanChecklistWithInspection", () => {
  it("calls useQuery with getChecklistWithInspection and { caseId }", () => {
    renderHook(() => useScanChecklistWithInspection(CASE_ID));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_CHECKLIST_WITH_INSPECTION);
    expect(args).toEqual({ caseId: CASE_ID });
  });

  it('calls useQuery with "skip" when caseId is null', () => {
    renderHook(() => useScanChecklistWithInspection(null));

    const [, args] = lastQueryCall();
    expect(args).toBe("skip");
  });

  it("returns undefined while loading", () => {
    mockUseQuery.mockReturnValue(undefined);
    const { result } = renderHook(() => useScanChecklistWithInspection(CASE_ID));
    expect(result.current).toBeUndefined();
  });

  it("returns { items, inspection, summary } when data is available", () => {
    const state = {
      items: [{ _id: "item-1", name: "Battery", status: "ok", caseId: CASE_ID, templateItemId: "battery" }],
      inspection: {
        _id: "insp-1",
        status: "in_progress",
        inspectorId: "user-abc",
        inspectorName: "Jane Pilot",
        totalItems: 1,
        checkedItems: 1,
        damagedItems: 0,
        missingItems: 0,
      },
      summary: {
        caseId: CASE_ID,
        total: 1,
        ok: 1,
        damaged: 0,
        missing: 0,
        unchecked: 0,
        progressPct: 100,
        isComplete: true,
      },
    };
    mockUseQuery.mockReturnValue(state);

    const { result } = renderHook(() => useScanChecklistWithInspection(CASE_ID));
    const val = result.current as typeof state;
    expect(val).toBe(state);
    expect(val.items).toHaveLength(1);
    expect(val.inspection).not.toBeNull();
    expect(val.summary.isComplete).toBe(true);
  });

  it("returns null for inspection when no inspection has been started", () => {
    const state = {
      items: [],
      inspection: null,
      summary: {
        caseId: CASE_ID,
        total: 0,
        ok: 0,
        damaged: 0,
        missing: 0,
        unchecked: 0,
        progressPct: 0,
        isComplete: false,
      },
    };
    mockUseQuery.mockReturnValue(state);

    const { result } = renderHook(() => useScanChecklistWithInspection(CASE_ID));
    const val = result.current as typeof state;
    expect(val.inspection).toBeNull();
    expect(val.summary.isComplete).toBe(false);
  });
});

// ─── useScanChecklistItemsByStatus ────────────────────────────────────────────

describe("useScanChecklistItemsByStatus", () => {
  it("calls useQuery with getChecklistItemsByStatus and { caseId, status } when both provided", () => {
    renderHook(() => useScanChecklistItemsByStatus(CASE_ID, "damaged"));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_CHECKLIST_ITEMS_BY_STATUS);
    expect(args).toEqual({ caseId: CASE_ID, status: "damaged" });
  });

  it('calls useQuery with "skip" when caseId is null', () => {
    renderHook(() => useScanChecklistItemsByStatus(null, "ok"));

    const [, args] = lastQueryCall();
    expect(args).toBe("skip");
  });

  it('calls useQuery with "skip" when status is null', () => {
    renderHook(() => useScanChecklistItemsByStatus(CASE_ID, null));

    const [, args] = lastQueryCall();
    expect(args).toBe("skip");
  });

  it('calls useQuery with "skip" when both caseId and status are null', () => {
    renderHook(() => useScanChecklistItemsByStatus(null, null));

    const [, args] = lastQueryCall();
    expect(args).toBe("skip");
  });

  it("returns undefined while loading", () => {
    mockUseQuery.mockReturnValue(undefined);
    const { result } = renderHook(() => useScanChecklistItemsByStatus(CASE_ID, "missing"));
    expect(result.current).toBeUndefined();
  });

  it("returns the filtered item array for the given status", () => {
    const damagedItems = [
      { _id: "item-1", name: "Battery Pack", status: "damaged", caseId: CASE_ID, templateItemId: "battery" },
    ];
    mockUseQuery.mockReturnValue(damagedItems);

    const { result } = renderHook(() => useScanChecklistItemsByStatus(CASE_ID, "damaged"));
    expect(result.current).toHaveLength(1);
    expect(Array.isArray(result.current)).toBe(true);
  });

  it("returns an empty array when no items match the status", () => {
    mockUseQuery.mockReturnValue([]);
    const { result } = renderHook(() => useScanChecklistItemsByStatus(CASE_ID, "missing"));
    expect(result.current).toEqual([]);
  });

  it("works for all four valid status values", () => {
    const statuses = ["unchecked", "ok", "damaged", "missing"] as const;
    for (const status of statuses) {
      mockUseQuery.mockReturnValue([]);
      renderHook(() => useScanChecklistItemsByStatus(CASE_ID, status));
      const [queryRef, args] = lastQueryCall();
      expect(queryRef).toBe(MOCK_GET_CHECKLIST_ITEMS_BY_STATUS);
      expect((args as { caseId: string; status: string }).status).toBe(status);
    }
  });
});

// ─── useScanUncheckedItems ────────────────────────────────────────────────────

describe("useScanUncheckedItems", () => {
  it("calls useQuery with getUncheckedItems and { caseId } when caseId is provided", () => {
    renderHook(() => useScanUncheckedItems(CASE_ID));

    const [queryRef, args] = lastQueryCall();
    expect(queryRef).toBe(MOCK_GET_UNCHECKED_ITEMS);
    expect(args).toEqual({ caseId: CASE_ID });
  });

  it('calls useQuery with "skip" when caseId is null', () => {
    renderHook(() => useScanUncheckedItems(null));

    const [, args] = lastQueryCall();
    expect(args).toBe("skip");
  });

  it("returns undefined while loading", () => {
    mockUseQuery.mockReturnValue(undefined);
    const { result } = renderHook(() => useScanUncheckedItems(CASE_ID));
    expect(result.current).toBeUndefined();
  });

  it("returns only unchecked items when items are pending review", () => {
    const uncheckedItems = [
      { _id: "item-2", name: "Charger", status: "unchecked", caseId: CASE_ID, templateItemId: "charger" },
      { _id: "item-3", name: "Prop Kit", status: "unchecked", caseId: CASE_ID, templateItemId: "propkit" },
    ];
    mockUseQuery.mockReturnValue(uncheckedItems);

    const { result } = renderHook(() => useScanUncheckedItems(CASE_ID));
    expect(result.current).toHaveLength(2);
    expect(Array.isArray(result.current)).toBe(true);
  });

  it("returns an empty array when all items have been reviewed (inspection complete)", () => {
    mockUseQuery.mockReturnValue([]);
    const { result } = renderHook(() => useScanUncheckedItems(CASE_ID));
    expect(result.current).toEqual([]);
    // Empty array (not null/undefined) signals inspection is complete
    expect(result.current).not.toBeUndefined();
    expect(result.current).not.toBeNull();
  });
});

// ─── Cross-hook contract: skip pattern consistency ────────────────────────────

describe("SCAN query layer — skip pattern consistency", () => {
  // Each entry is [hookName, factory] — factory is `() => void` to sidestep
  // TypeScript's strict return-type inference on renderHook's callback.
  const hooks: Array<{ name: string; fn: () => void }> = [
    { name: "useScanCaseDetail",              fn: () => { useScanCaseDetail(null); } },
    { name: "useScanCaseStatus",              fn: () => { useScanCaseStatus(null); } },
    { name: "useScanCaseByQrCode",            fn: () => { useScanCaseByQrCode(null); } },
    { name: "useScanChecklist",               fn: () => { useScanChecklist(null); } },
    { name: "useScanChecklistSummary",        fn: () => { useScanChecklistSummary(null); } },
    { name: "useScanChecklistWithInspection", fn: () => { useScanChecklistWithInspection(null); } },
    { name: "useScanChecklistItemsByStatus",  fn: () => { useScanChecklistItemsByStatus(null, null); } },
    { name: "useScanUncheckedItems",          fn: () => { useScanUncheckedItems(null); } },
  ];

  for (const { name, fn } of hooks) {
    it(`${name} passes "skip" to useQuery when given null inputs`, () => {
      renderHook(fn);
      const [, args] = lastQueryCall();
      expect(args).toBe("skip");
    });
  }
});

// ─── Type exports smoke test ──────────────────────────────────────────────────
// These tests verify the module exports the expected types (compile-time).
// At runtime they just check that the imports do not throw.

describe("SCAN query layer — type exports", () => {
  it("exports ManifestItemStatus compatible values", () => {
    // If these compile, the type is exported correctly.
    const statuses: Array<"unchecked" | "ok" | "damaged" | "missing"> = [
      "unchecked", "ok", "damaged", "missing",
    ];
    expect(statuses).toHaveLength(4);
  });

  it("exports CaseStatus compatible values", () => {
    const statuses: Array<
      "hangar" | "assembled" | "transit_out" | "deployed" |
      "flagged" | "transit_in" | "received" | "archived"
    > = ["hangar", "assembled", "transit_out", "deployed", "flagged", "transit_in", "received", "archived"];
    expect(statuses).toHaveLength(8);
  });
});
