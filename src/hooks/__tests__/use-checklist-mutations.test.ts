/**
 * @vitest-environment jsdom
 *
 * Unit tests for canonical checklist mutation hooks.
 *
 * Sub-AC 36a-2: Convex mutations for checklist updates — verify that each hook
 * calls the correct canonical mutation (`api.mutations.checklist.*`) and that the
 * optimistic update applies the correct field shape to the cached queries.
 *
 * Tests cover the five canonical hooks added to use-scan-mutations.ts:
 *   useChecklistItemUpdate  — api.mutations.checklist.updateChecklistItem
 *   useMarkItemOk           — api.mutations.checklist.markItemOk
 *   useMarkItemDamaged      — api.mutations.checklist.markItemDamaged
 *   useMarkItemMissing      — api.mutations.checklist.markItemMissing
 *   useResetChecklistItem   — api.mutations.checklist.resetChecklistItem
 *
 * Coverage matrix
 * ───────────────
 * useChecklistItemUpdate:
 *   ✓ calls useMutation with api.mutations.checklist.updateChecklistItem
 *   ✓ optimistic update patches getChecklistByCase with newStatus
 *   ✓ optimistic update patches getChecklistWithInspection with newStatus + summary
 *   ✓ optimistic update skips when getChecklistByCase query is not cached
 *   ✓ optimistic update uses canonical newStatus field (not status)
 *   ✓ notes are only applied when provided
 *
 * useMarkItemOk:
 *   ✓ calls useMutation with api.mutations.checklist.markItemOk
 *   ✓ optimistic update sets status = "ok"
 *   ✓ optimistic update sets checkedAt, checkedById, checkedByName
 *
 * useMarkItemDamaged:
 *   ✓ calls useMutation with api.mutations.checklist.markItemDamaged
 *   ✓ optimistic update sets status = "damaged"
 *
 * useMarkItemMissing:
 *   ✓ calls useMutation with api.mutations.checklist.markItemMissing
 *   ✓ optimistic update sets status = "missing"
 *
 * useResetChecklistItem:
 *   ✓ calls useMutation with api.mutations.checklist.resetChecklistItem
 *   ✓ optimistic update sets status = "unchecked"
 *   ✓ optimistic update clears checkedAt, checkedById, checkedByName
 *   ✓ optimistic update preserves notes and photoStorageIds
 *
 * Optimistic update contract tests (all five hooks):
 *   ✓ patches only the matching templateItemId; other items unchanged
 *   ✓ summary.progressPct updates correctly after each status change
 *   ✓ summary.isComplete becomes true when all items reviewed
 *
 * Mocking strategy
 * ────────────────
 * We mock `convex/react` so `useMutation` is a vi.fn() that captures the
 * mutation reference and exposes a `withOptimisticUpdate` chain.
 * We mock the generated `api` with stable Symbol() references.
 * The tests never hit a real Convex backend.
 *
 * To test optimistic update logic, we invoke the captured `withOptimisticUpdate`
 * callback directly with a mock localStore (getQuery/setQuery spy).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// ─── Stable mock symbols ──────────────────────────────────────────────────────

const {
  MOCK_UPDATE_CHECKLIST_ITEM,
  MOCK_MARK_ITEM_OK,
  MOCK_MARK_ITEM_DAMAGED,
  MOCK_MARK_ITEM_MISSING,
  MOCK_RESET_CHECKLIST_ITEM,
  MOCK_GET_CHECKLIST_BY_CASE,
  MOCK_GET_CHECKLIST_WITH_INSPECTION,
} = vi.hoisted(() => ({
  MOCK_UPDATE_CHECKLIST_ITEM:          Symbol("updateChecklistItem"),
  MOCK_MARK_ITEM_OK:                   Symbol("markItemOk"),
  MOCK_MARK_ITEM_DAMAGED:              Symbol("markItemDamaged"),
  MOCK_MARK_ITEM_MISSING:              Symbol("markItemMissing"),
  MOCK_RESET_CHECKLIST_ITEM:           Symbol("resetChecklistItem"),
  MOCK_GET_CHECKLIST_BY_CASE:          Symbol("getChecklistByCase"),
  MOCK_GET_CHECKLIST_WITH_INSPECTION:  Symbol("getChecklistWithInspection"),
}));

// ─── Mock convex/_generated/api ──────────────────────────────────────────────

vi.mock("../../../convex/_generated/api", () => ({
  api: {
    mutations: {
      checklist: {
        updateChecklistItem: MOCK_UPDATE_CHECKLIST_ITEM,
        markItemOk:          MOCK_MARK_ITEM_OK,
        markItemDamaged:     MOCK_MARK_ITEM_DAMAGED,
        markItemMissing:     MOCK_MARK_ITEM_MISSING,
        resetChecklistItem:  MOCK_RESET_CHECKLIST_ITEM,
      },
      scan: {
        checkInCase:  Symbol("checkInCase"),
        logScanOnly:  Symbol("logScanOnly"),
      },
    },
    scan: {
      scanCheckIn:          Symbol("scanCheckIn"),
      updateChecklistItem:  Symbol("scan_updateChecklistItem"),
      startInspection:      Symbol("startInspection"),
      completeInspection:   Symbol("completeInspection"),
    },
    checklists: {
      getChecklistByCase:         MOCK_GET_CHECKLIST_BY_CASE,
      getChecklistWithInspection: MOCK_GET_CHECKLIST_WITH_INSPECTION,
      getChecklistSummary:        Symbol("getChecklistSummary"),
      getChecklistItem:           Symbol("getChecklistItem"),
      getChecklistItemsByStatus:  Symbol("getChecklistItemsByStatus"),
      getUncheckedItems:          Symbol("getUncheckedItems"),
    },
    cases: {
      getCaseById:     Symbol("getCaseById"),
      getCaseStatus:   Symbol("getCaseStatus"),
      getCaseByQrCode: Symbol("getCaseByQrCode"),
    },
    shipping: {
      shipCase:             Symbol("shipCase"),
      listShipmentsByCase:  Symbol("listShipmentsByCase"),
    },
    custodyHandoffs: {
      handoffCustody: Symbol("handoffCustody"),
    },
    qrCodes: {
      associateQRCodeToCase: Symbol("associateQRCodeToCase"),
    },
  },
}));

// ─── Mock convex/react::useMutation ──────────────────────────────────────────
//
// We capture:
//   mutationRef  — the query reference passed to useMutation()
//   optimisticFn — the callback passed to .withOptimisticUpdate()
//
// This lets us verify which mutation was selected AND invoke the optimistic
// update callback manually to test its logic.

let capturedMutationRef: unknown = null;
let capturedOptimisticFn: ((localStore: unknown, args: unknown) => void) | null = null;

const mockMutate = vi.fn();
const mockWithOptimisticUpdate = vi.fn((fn: (localStore: unknown, args: unknown) => void) => {
  capturedOptimisticFn = fn;
  return mockMutate;
});
const mockUseMutation = vi.fn((ref: unknown) => {
  capturedMutationRef = ref;
  return { withOptimisticUpdate: mockWithOptimisticUpdate };
});

vi.mock("convex/react", () => ({
  useMutation: (ref: unknown) => mockUseMutation(ref),
}));

// ─── Import hooks under test ──────────────────────────────────────────────────
// Must be after vi.mock calls.

import {
  useChecklistItemUpdate,
  useMarkItemOk,
  useMarkItemDamaged,
  useMarkItemMissing,
  useResetChecklistItem,
} from "../use-scan-mutations";

// ─── Test data ────────────────────────────────────────────────────────────────

const CASE_ID  = "case-id-test-001" as unknown as import("../../../convex/_generated/dataModel").Id<"cases">;
const ITEM_ID  = "item-id-001";
const TEMPLATE_ITEM_ID = "item-battery-pack";
const TECHNICIAN_ID    = "kinde-user-tech-001";
const TECHNICIAN_NAME  = "Jane Pilot";
const TIMESTAMP        = 1_700_000_000_000;

/** Checklist rows after optimistic mutations may include optional inspector fields */
type WrittenChecklistItem = Record<string, unknown> & {
  templateItemId: string;
  status?: string;
  notes?: string;
  checkedAt?: number;
  checkedById?: string;
  checkedByName?: string;
  photoStorageIds?: unknown;
};

/** Factory for a minimal ChecklistItem mock row. */
function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    _id:            ITEM_ID,
    _creationTime:  TIMESTAMP,
    caseId:         CASE_ID,
    templateItemId: TEMPLATE_ITEM_ID,
    name:           "Battery Pack",
    status:         "unchecked",
    ...overrides,
  };
}

/** Factory for a minimal ChecklistWithInspection mock. */
function makeChecklistWithInspection(items: ReturnType<typeof makeItem>[]) {
  const total     = items.length;
  const reviewed  = items.filter((i) => i.status !== "unchecked").length;
  const ok        = items.filter((i) => i.status === "ok").length;
  const damaged   = items.filter((i) => i.status === "damaged").length;
  const missing   = items.filter((i) => i.status === "missing").length;
  const unchecked = items.filter((i) => i.status === "unchecked").length;

  return {
    items,
    inspection: null,
    summary: {
      caseId:      CASE_ID,
      total,
      ok,
      damaged,
      missing,
      unchecked,
      progressPct: total > 0 ? Math.round((reviewed / total) * 100) : 0,
      isComplete:  total > 0 && unchecked === 0,
    },
  };
}

/** Build a mock localStore that stores query values in a Map. */
function makeMockLocalStore(
  cachedValues: Map<symbol, unknown>
) {
  return {
    getQuery: vi.fn((queryRef: symbol, _args: unknown) => cachedValues.get(queryRef)),
    setQuery: vi.fn((queryRef: symbol, _args: unknown, value: unknown) => {
      cachedValues.set(queryRef, value);
    }),
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  capturedMutationRef  = null;
  capturedOptimisticFn = null;
});

// ─── useChecklistItemUpdate ───────────────────────────────────────────────────

describe("useChecklistItemUpdate", () => {
  it("calls useMutation with api.mutations.checklist.updateChecklistItem", () => {
    renderHook(() => useChecklistItemUpdate());
    expect(capturedMutationRef).toBe(MOCK_UPDATE_CHECKLIST_ITEM);
  });

  it("returns a function via withOptimisticUpdate", () => {
    renderHook(() => useChecklistItemUpdate());
    expect(mockWithOptimisticUpdate).toHaveBeenCalledOnce();
    expect(capturedOptimisticFn).toBeTypeOf("function");
  });

  it("optimistic update patches getChecklistByCase with newStatus", () => {
    renderHook(() => useChecklistItemUpdate());

    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_BY_CASE, [makeItem({ status: "unchecked" })]],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,
      newStatus:      "ok",           // ← canonical field name
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
    });

    // getChecklistByCase was read and written
    expect(localStore.getQuery).toHaveBeenCalledWith(MOCK_GET_CHECKLIST_BY_CASE, { caseId: CASE_ID });
    expect(localStore.setQuery).toHaveBeenCalledWith(
      MOCK_GET_CHECKLIST_BY_CASE,
      { caseId: CASE_ID },
      expect.arrayContaining([
        expect.objectContaining({
          templateItemId: TEMPLATE_ITEM_ID,
          status:         "ok",
          checkedAt:      TIMESTAMP,
          checkedById:    TECHNICIAN_ID,
          checkedByName:  TECHNICIAN_NAME,
        }),
      ])
    );
  });

  it("optimistic update patches getChecklistWithInspection and recomputes summary", () => {
    renderHook(() => useChecklistItemUpdate());

    const items = [
      makeItem({ status: "unchecked" }),
      makeItem({ templateItemId: "item-charger", status: "ok" }),
    ];
    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_WITH_INSPECTION, makeChecklistWithInspection(items)],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,  // the "unchecked" item
      newStatus:      "ok",
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
    });

    const written = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === MOCK_GET_CHECKLIST_WITH_INSPECTION
    );
    expect(written).toBeDefined();

    const writtenValue = written![2] as ReturnType<typeof makeChecklistWithInspection>;
    // After both items are ok → isComplete should be true and progressPct 100
    expect(writtenValue.summary.progressPct).toBe(100);
    expect(writtenValue.summary.isComplete).toBe(true);
    expect(writtenValue.summary.ok).toBe(2);
  });

  it("optimistic update skips when getChecklistByCase is not cached (undefined)", () => {
    renderHook(() => useChecklistItemUpdate());

    // No cached value → getQuery returns undefined
    const cachedValues = new Map<symbol, unknown>();
    const localStore = makeMockLocalStore(cachedValues);

    expect(() => {
      capturedOptimisticFn!(localStore, {
        caseId:         CASE_ID,
        templateItemId: TEMPLATE_ITEM_ID,
        newStatus:      "ok",
        timestamp:      TIMESTAMP,
        technicianId:   TECHNICIAN_ID,
        technicianName: TECHNICIAN_NAME,
      });
    }).not.toThrow();

    // setQuery should not be called when getQuery returned undefined
    expect(localStore.setQuery).not.toHaveBeenCalled();
  });

  it("optimistic update preserves other items that don't match templateItemId", () => {
    renderHook(() => useChecklistItemUpdate());

    const chargerItem = makeItem({ templateItemId: "item-charger", status: "unchecked" });
    const batteryItem = makeItem({ templateItemId: TEMPLATE_ITEM_ID, status: "unchecked" });

    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_BY_CASE, [batteryItem, chargerItem]],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,  // only update the battery item
      newStatus:      "ok",
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
    });

    const writtenItems = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls[0][2] as typeof batteryItem[];

    // Battery item updated
    const battery = writtenItems.find((i) => i.templateItemId === TEMPLATE_ITEM_ID);
    expect(battery?.status).toBe("ok");

    // Charger item unchanged
    const charger = writtenItems.find((i) => i.templateItemId === "item-charger");
    expect(charger?.status).toBe("unchecked");
  });

  it("optimistic update only overwrites notes when provided", () => {
    renderHook(() => useChecklistItemUpdate());

    const existingNotes = "Pre-existing technician notes";
    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_BY_CASE, [makeItem({ notes: existingNotes })]],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    // No notes in args — should not overwrite
    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,
      newStatus:      "ok",
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
      // notes deliberately omitted
    });

    const writtenItems = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls[0][2] as WrittenChecklistItem[];
    const updatedItem = writtenItems.find((i) => i.templateItemId === TEMPLATE_ITEM_ID);
    // Notes should remain untouched — the spread will keep the existing value
    expect(updatedItem?.notes).toBe(existingNotes);
  });

  it("optimistic update overwrites notes when explicitly provided", () => {
    renderHook(() => useChecklistItemUpdate());

    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_BY_CASE, [makeItem({ notes: "old notes" })]],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,
      newStatus:      "ok",
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
      notes:          "new notes",
    });

    const writtenItems = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls[0][2] as WrittenChecklistItem[];
    const updatedItem = writtenItems.find((i) => i.templateItemId === TEMPLATE_ITEM_ID);
    expect(updatedItem?.notes).toBe("new notes");
  });
});

// ─── useMarkItemOk ────────────────────────────────────────────────────────────

describe("useMarkItemOk", () => {
  it("calls useMutation with api.mutations.checklist.markItemOk", () => {
    renderHook(() => useMarkItemOk());
    expect(capturedMutationRef).toBe(MOCK_MARK_ITEM_OK);
  });

  it("optimistic update sets status = 'ok'", () => {
    renderHook(() => useMarkItemOk());

    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_BY_CASE, [makeItem({ status: "unchecked" })]],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
    });

    const writtenItems = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls[0][2] as WrittenChecklistItem[];
    const item = writtenItems.find((i) => i.templateItemId === TEMPLATE_ITEM_ID);
    expect(item?.status).toBe("ok");
  });

  it("optimistic update writes checkedAt, checkedById, checkedByName", () => {
    renderHook(() => useMarkItemOk());

    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_BY_CASE, [makeItem()]],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
    });

    const writtenItems = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls[0][2] as WrittenChecklistItem[];
    const item = writtenItems.find((i) => i.templateItemId === TEMPLATE_ITEM_ID);
    expect(item?.checkedAt).toBe(TIMESTAMP);
    expect(item?.checkedById).toBe(TECHNICIAN_ID);
    expect(item?.checkedByName).toBe(TECHNICIAN_NAME);
  });

  it("updates summary.ok count in getChecklistWithInspection", () => {
    renderHook(() => useMarkItemOk());

    const items = [makeItem({ status: "unchecked" })];
    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_WITH_INSPECTION, makeChecklistWithInspection(items)],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
    });

    const written = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === MOCK_GET_CHECKLIST_WITH_INSPECTION
    );
    const writtenValue = written![2] as ReturnType<typeof makeChecklistWithInspection>;
    expect(writtenValue.summary.ok).toBe(1);
    expect(writtenValue.summary.unchecked).toBe(0);
    expect(writtenValue.summary.isComplete).toBe(true);
  });
});

// ─── useMarkItemDamaged ───────────────────────────────────────────────────────

describe("useMarkItemDamaged", () => {
  it("calls useMutation with api.mutations.checklist.markItemDamaged", () => {
    renderHook(() => useMarkItemDamaged());
    expect(capturedMutationRef).toBe(MOCK_MARK_ITEM_DAMAGED);
  });

  it("optimistic update sets status = 'damaged'", () => {
    renderHook(() => useMarkItemDamaged());

    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_BY_CASE, [makeItem({ status: "unchecked" })]],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:            CASE_ID,
      templateItemId:    TEMPLATE_ITEM_ID,
      timestamp:         TIMESTAMP,
      technicianId:      TECHNICIAN_ID,
      technicianName:    TECHNICIAN_NAME,
      damageDescription: "Impact crack on housing",
      damageSeverity:    "moderate",
    });

    const writtenItems = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls[0][2] as WrittenChecklistItem[];
    const item = writtenItems.find((i) => i.templateItemId === TEMPLATE_ITEM_ID);
    expect(item?.status).toBe("damaged");
  });

  it("updates summary.damaged count in getChecklistWithInspection", () => {
    renderHook(() => useMarkItemDamaged());

    const items = [makeItem({ status: "unchecked" })];
    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_WITH_INSPECTION, makeChecklistWithInspection(items)],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:            CASE_ID,
      templateItemId:    TEMPLATE_ITEM_ID,
      timestamp:         TIMESTAMP,
      technicianId:      TECHNICIAN_ID,
      technicianName:    TECHNICIAN_NAME,
      damageDescription: "Cracked housing",
      damageSeverity:    "minor",
    });

    const written = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === MOCK_GET_CHECKLIST_WITH_INSPECTION
    );
    const writtenValue = written![2] as ReturnType<typeof makeChecklistWithInspection>;
    expect(writtenValue.summary.damaged).toBe(1);
    expect(writtenValue.summary.unchecked).toBe(0);
    expect(writtenValue.summary.isComplete).toBe(true);
  });
});

// ─── useMarkItemMissing ───────────────────────────────────────────────────────

describe("useMarkItemMissing", () => {
  it("calls useMutation with api.mutations.checklist.markItemMissing", () => {
    renderHook(() => useMarkItemMissing());
    expect(capturedMutationRef).toBe(MOCK_MARK_ITEM_MISSING);
  });

  it("optimistic update sets status = 'missing'", () => {
    renderHook(() => useMarkItemMissing());

    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_BY_CASE, [makeItem({ status: "unchecked" })]],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
    });

    const writtenItems = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls[0][2] as WrittenChecklistItem[];
    const item = writtenItems.find((i) => i.templateItemId === TEMPLATE_ITEM_ID);
    expect(item?.status).toBe("missing");
  });

  it("updates summary.missing count in getChecklistWithInspection", () => {
    renderHook(() => useMarkItemMissing());

    const items = [makeItem({ status: "unchecked" })];
    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_WITH_INSPECTION, makeChecklistWithInspection(items)],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
      notes:          "Last seen at turbine T-42",
    });

    const written = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === MOCK_GET_CHECKLIST_WITH_INSPECTION
    );
    const writtenValue = written![2] as ReturnType<typeof makeChecklistWithInspection>;
    expect(writtenValue.summary.missing).toBe(1);
    expect(writtenValue.summary.unchecked).toBe(0);
    expect(writtenValue.summary.isComplete).toBe(true);
  });
});

// ─── useResetChecklistItem ────────────────────────────────────────────────────

describe("useResetChecklistItem", () => {
  it("calls useMutation with api.mutations.checklist.resetChecklistItem", () => {
    renderHook(() => useResetChecklistItem());
    expect(capturedMutationRef).toBe(MOCK_RESET_CHECKLIST_ITEM);
  });

  it("optimistic update sets status = 'unchecked'", () => {
    renderHook(() => useResetChecklistItem());

    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_BY_CASE, [makeItem({ status: "ok" })]],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
    });

    const writtenItems = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls[0][2] as WrittenChecklistItem[];
    const item = writtenItems.find((i) => i.templateItemId === TEMPLATE_ITEM_ID);
    expect(item?.status).toBe("unchecked");
  });

  it("optimistic update clears checkedAt, checkedById, checkedByName", () => {
    renderHook(() => useResetChecklistItem());

    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_BY_CASE, [makeItem({
        status:        "ok",
        checkedAt:     TIMESTAMP,
        checkedById:   TECHNICIAN_ID,
        checkedByName: TECHNICIAN_NAME,
      })]],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
    });

    const writtenItems = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls[0][2] as WrittenChecklistItem[];
    const item = writtenItems.find((i) => i.templateItemId === TEMPLATE_ITEM_ID);
    expect(item?.checkedAt).toBeUndefined();
    expect(item?.checkedById).toBeUndefined();
    expect(item?.checkedByName).toBeUndefined();
  });

  it("optimistic update preserves existing notes and photoStorageIds", () => {
    renderHook(() => useResetChecklistItem());

    const existingNotes = "Cracked housing";
    const existingPhotos = ["storage-abc", "storage-def"];

    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_BY_CASE, [makeItem({
        status:          "damaged",
        notes:           existingNotes,
        photoStorageIds: existingPhotos,
      })]],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
    });

    const writtenItems = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls[0][2] as WrittenChecklistItem[];
    const item = writtenItems.find((i) => i.templateItemId === TEMPLATE_ITEM_ID);
    // Notes and photos should be preserved on reset
    expect(item?.notes).toBe(existingNotes);
    expect(item?.photoStorageIds).toEqual(existingPhotos);
  });

  it("decrements summary counts when resetting a previously reviewed item", () => {
    renderHook(() => useResetChecklistItem());

    const items = [
      makeItem({ templateItemId: TEMPLATE_ITEM_ID, status: "ok" }),
      makeItem({ templateItemId: "item-charger",   status: "ok" }),
    ];
    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_WITH_INSPECTION, makeChecklistWithInspection(items)],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,  // reset only the battery item
      timestamp:      TIMESTAMP,
      technicianId:   TECHNICIAN_ID,
      technicianName: TECHNICIAN_NAME,
    });

    const written = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0] === MOCK_GET_CHECKLIST_WITH_INSPECTION
    );
    const writtenValue = written![2] as ReturnType<typeof makeChecklistWithInspection>;
    // One ok item remains; one is now unchecked again
    expect(writtenValue.summary.ok).toBe(1);
    expect(writtenValue.summary.unchecked).toBe(1);
    expect(writtenValue.summary.progressPct).toBe(50);
    expect(writtenValue.summary.isComplete).toBe(false);
  });
});

// ─── Cross-hook contract: optimistic-update-compatible structure ──────────────
//
// Verifies the fields required by Sub-AC 36a-2:
//   "optimistic-update-compatible structure" means the result written to the
//   local query cache must include all fields that the query's reactive subscription
//   returns from the server:
//     itemId (as _id), updatedBy (as checkedById), timestamp (as checkedAt),
//     newStatus (as status), and itemName (as name).

describe("optimistic update field shape contract (Sub-AC 36a-2)", () => {
  it("written item includes itemId (_id), updatedBy (checkedById), timestamp (checkedAt), newStatus (status)", () => {
    renderHook(() => useChecklistItemUpdate());

    const cachedValues = new Map<symbol, unknown>([
      [MOCK_GET_CHECKLIST_BY_CASE, [makeItem()]],
    ]);
    const localStore = makeMockLocalStore(cachedValues);

    capturedOptimisticFn!(localStore, {
      caseId:         CASE_ID,
      templateItemId: TEMPLATE_ITEM_ID,
      newStatus:      "ok",        // newStatus
      timestamp:      TIMESTAMP,   // timestamp → checkedAt
      technicianId:   TECHNICIAN_ID,  // updatedBy → checkedById
      technicianName: TECHNICIAN_NAME,
    });

    const writtenItems = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls[0][2] as WrittenChecklistItem[];
    const item = writtenItems[0];

    // itemId — preserved from original (_id unchanged by status update)
    expect(item._id).toBe(ITEM_ID);
    // newStatus → written as `status`
    expect(item.status).toBe("ok");
    // updatedBy → written as `checkedById`
    expect(item.checkedById).toBe(TECHNICIAN_ID);
    // timestamp → written as `checkedAt`
    expect(item.checkedAt).toBe(TIMESTAMP);
    // itemName — preserved from original (name unchanged)
    expect(item.name).toBe("Battery Pack");
  });

  it("all four status transitions produce a valid optimistic item shape", () => {
    const statuses = ["ok", "damaged", "missing", "unchecked"] as const;

    for (const newStatus of statuses) {
      renderHook(() => useChecklistItemUpdate());
      vi.clearAllMocks();
      capturedOptimisticFn = null;
      renderHook(() => useChecklistItemUpdate());

      const cachedValues = new Map<symbol, unknown>([
        [MOCK_GET_CHECKLIST_BY_CASE, [makeItem()]],
      ]);
      const localStore = makeMockLocalStore(cachedValues);

      capturedOptimisticFn!(localStore, {
        caseId:         CASE_ID,
        templateItemId: TEMPLATE_ITEM_ID,
        newStatus,
        timestamp:      TIMESTAMP,
        technicianId:   TECHNICIAN_ID,
        technicianName: TECHNICIAN_NAME,
      });

      const writtenItems = (localStore.setQuery as ReturnType<typeof vi.fn>).mock.calls[0][2] as WrittenChecklistItem[];
      const item = writtenItems.find((i) => i.templateItemId === TEMPLATE_ITEM_ID);

      expect(item).toBeDefined();
      expect(item?.status).toBe(newStatus);
      expect(item?.checkedById).toBe(TECHNICIAN_ID);
      // checkedAt should be set for ok/damaged/missing; for unchecked the reset hook clears it
      if (newStatus !== "unchecked") {
        expect(item?.checkedAt).toBe(TIMESTAMP);
      }
    }
  });
});
