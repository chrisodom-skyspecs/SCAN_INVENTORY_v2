/**
 * Unit tests for the checklist query module pure functions.
 *
 * Sub-AC 36a-2: Convex real-time query functions and table watchers for the
 * checklist items table, including queries scoped by case ID and completion state.
 *
 * These tests cover the pure, database-free utility functions exported from
 * convex/checklists.ts:
 *   - buildSummary — aggregate progress counts computation
 *   - projectItem  — raw DB row → typed ChecklistItem projection
 *
 * Convex query functions themselves (getChecklistByCase, getChecklistItemsByStatus,
 * etc.) require a live Convex environment and are exercised by integration tests.
 * The pure helpers are extracted and exported specifically to enable this
 * isolated unit test coverage.
 *
 * Coverage matrix:
 *   buildSummary:
 *     ✓ empty items array
 *     ✓ all unchecked items
 *     ✓ all ok items
 *     ✓ mixed statuses
 *     ✓ progressPct calculation
 *     ✓ isComplete flag
 *     ✓ caseId preserved in output
 *
 *   projectItem:
 *     ✓ basic field projection
 *     ✓ Convex ID toString() coercion
 *     ✓ optional fields (notes, photoStorageIds, checkedAt, checkedById, checkedByName)
 *     ✓ status preserved as ManifestItemStatus
 *
 *   MANIFEST_ITEM_STATUSES:
 *     ✓ exports expected values
 *     ✓ covers all valid ManifestItemStatus values
 */

import { describe, expect, it } from "vitest";

// Import the pure helpers from the helpers module (no Convex runtime dependencies).
// These functions have no DB calls — they are safe to import in Node test env.
import {
  buildSummary,
  MANIFEST_ITEM_STATUSES,
  projectItem,
} from "../../../convex/checklistHelpers";
import type { ChecklistItem, ManifestItemStatus } from "../../../convex/checklistHelpers";

// ─── buildSummary ─────────────────────────────────────────────────────────────

describe("buildSummary", () => {
  const CASE_ID = "test-case-123";

  it("returns zero counts for an empty items array", () => {
    const result = buildSummary(CASE_ID, []);
    expect(result).toEqual({
      caseId: CASE_ID,
      total: 0,
      unchecked: 0,
      ok: 0,
      damaged: 0,
      missing: 0,
      progressPct: 0,
      isComplete: false,
    });
  });

  it("counts all unchecked items correctly", () => {
    const items = [
      { status: "unchecked" },
      { status: "unchecked" },
      { status: "unchecked" },
    ];
    const result = buildSummary(CASE_ID, items);

    expect(result.total).toBe(3);
    expect(result.unchecked).toBe(3);
    expect(result.ok).toBe(0);
    expect(result.damaged).toBe(0);
    expect(result.missing).toBe(0);
    expect(result.progressPct).toBe(0);
    expect(result.isComplete).toBe(false);
  });

  it("counts all ok items correctly", () => {
    const items = [
      { status: "ok" },
      { status: "ok" },
    ];
    const result = buildSummary(CASE_ID, items);

    expect(result.total).toBe(2);
    expect(result.unchecked).toBe(0);
    expect(result.ok).toBe(2);
    expect(result.progressPct).toBe(100);
    expect(result.isComplete).toBe(true);
  });

  it("counts mixed statuses correctly", () => {
    const items = [
      { status: "unchecked" },
      { status: "ok" },
      { status: "ok" },
      { status: "damaged" },
      { status: "missing" },
    ];
    const result = buildSummary(CASE_ID, items);

    expect(result.total).toBe(5);
    expect(result.unchecked).toBe(1);
    expect(result.ok).toBe(2);
    expect(result.damaged).toBe(1);
    expect(result.missing).toBe(1);
  });

  it("calculates progressPct as reviewed / total * 100 (rounded)", () => {
    // 3 out of 4 items reviewed (ok + damaged + missing) = 75%
    const items = [
      { status: "unchecked" },
      { status: "ok" },
      { status: "damaged" },
      { status: "ok" },
    ];
    const result = buildSummary(CASE_ID, items);

    expect(result.progressPct).toBe(75);
  });

  it("rounds progressPct to nearest integer", () => {
    // 2 out of 3 = 66.666... → rounded to 67
    const items = [
      { status: "unchecked" },
      { status: "ok" },
      { status: "ok" },
    ];
    const result = buildSummary(CASE_ID, items);

    expect(result.progressPct).toBe(67);
  });

  it("sets isComplete=true only when all items are reviewed", () => {
    const allDone = [
      { status: "ok" },
      { status: "damaged" },
      { status: "missing" },
    ];
    expect(buildSummary(CASE_ID, allDone).isComplete).toBe(true);

    const oneLeft = [
      { status: "ok" },
      { status: "unchecked" },
    ];
    expect(buildSummary(CASE_ID, oneLeft).isComplete).toBe(false);
  });

  it("sets isComplete=false for empty items array (no items = not complete)", () => {
    expect(buildSummary(CASE_ID, []).isComplete).toBe(false);
  });

  it("preserves the caseId argument in the returned object", () => {
    const id = "some-case-id-xyz";
    expect(buildSummary(id, []).caseId).toBe(id);
  });

  it("handles all four status values together", () => {
    const items = [
      { status: "unchecked" },
      { status: "ok" },
      { status: "damaged" },
      { status: "missing" },
    ];
    const result = buildSummary(CASE_ID, items);

    expect(result.unchecked).toBe(1);
    expect(result.ok).toBe(1);
    expect(result.damaged).toBe(1);
    expect(result.missing).toBe(1);
    expect(result.total).toBe(4);
    // 3 reviewed out of 4 = 75%
    expect(result.progressPct).toBe(75);
    expect(result.isComplete).toBe(false);
  });

  it("ignores unknown status values gracefully", () => {
    // Unknown statuses are silently ignored (counts stay at 0)
    const items = [{ status: "ok" }, { status: "UNKNOWN_STATUS" }];
    const result = buildSummary(CASE_ID, items);

    expect(result.total).toBe(2);
    expect(result.ok).toBe(1);
    expect(result.unchecked).toBe(0);
    // Only 1 of 2 reviewed = 50%
    expect(result.progressPct).toBe(50);
  });
});

// ─── projectItem ──────────────────────────────────────────────────────────────

describe("projectItem", () => {
  /** Factory for a minimal valid raw DB row (as Convex would return it). */
  function makeRawRow(overrides: Partial<{
    _id: { toString(): string };
    _creationTime: number;
    caseId: { toString(): string };
    templateItemId: string;
    name: string;
    status: string;
    notes?: string;
    photoStorageIds?: string[];
    checkedAt?: number;
    checkedById?: string;
    checkedByName?: string;
  }> = {}) {
    return {
      _id: { toString: () => "manifest-item-id-001" },
      _creationTime: 1_700_000_000_000,
      caseId: { toString: () => "case-id-001" },
      templateItemId: "template-item-battery",
      name: "Battery Pack",
      status: "unchecked",
      ...overrides,
    };
  }

  it("projects all required fields to plain strings/values", () => {
    const row = makeRawRow();
    const result = projectItem(row);

    expect(result._id).toBe("manifest-item-id-001");
    expect(result._creationTime).toBe(1_700_000_000_000);
    expect(result.caseId).toBe("case-id-001");
    expect(result.templateItemId).toBe("template-item-battery");
    expect(result.name).toBe("Battery Pack");
    expect(result.status).toBe("unchecked");
  });

  it("calls toString() on Convex ID objects for _id and caseId", () => {
    let idCalled = false;
    let caseIdCalled = false;

    const row = makeRawRow({
      _id: { toString: () => { idCalled = true; return "item-xyz"; } },
      caseId: { toString: () => { caseIdCalled = true; return "case-xyz"; } },
    });

    const result = projectItem(row);
    expect(idCalled).toBe(true);
    expect(caseIdCalled).toBe(true);
    expect(result._id).toBe("item-xyz");
    expect(result.caseId).toBe("case-xyz");
  });

  it("omits optional fields when not present in the row", () => {
    const row = makeRawRow(); // no optional fields
    const result = projectItem(row);

    expect(result.notes).toBeUndefined();
    expect(result.photoStorageIds).toBeUndefined();
    expect(result.checkedAt).toBeUndefined();
    expect(result.checkedById).toBeUndefined();
    expect(result.checkedByName).toBeUndefined();
  });

  it("includes optional fields when present in the row", () => {
    const row = makeRawRow({
      notes: "Slight scratch on casing",
      photoStorageIds: ["storage-id-abc", "storage-id-def"],
      checkedAt: 1_700_001_000_000,
      checkedById: "kinde-user-123",
      checkedByName: "Alice Technician",
    });
    const result = projectItem(row);

    expect(result.notes).toBe("Slight scratch on casing");
    expect(result.photoStorageIds).toEqual(["storage-id-abc", "storage-id-def"]);
    expect(result.checkedAt).toBe(1_700_001_000_000);
    expect(result.checkedById).toBe("kinde-user-123");
    expect(result.checkedByName).toBe("Alice Technician");
  });

  it("casts status as ManifestItemStatus", () => {
    const statuses: ManifestItemStatus[] = ["unchecked", "ok", "damaged", "missing"];

    for (const status of statuses) {
      const result = projectItem(makeRawRow({ status }));
      expect(result.status).toBe(status);
    }
  });

  it("returns a plain object without Convex ID references", () => {
    const row = makeRawRow();
    const result = projectItem(row);

    // Result should serialize cleanly (no circular refs, no Convex types)
    expect(() => JSON.stringify(result)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(result)) as ChecklistItem;
    expect(parsed._id).toBe("manifest-item-id-001");
  });
});

// ─── MANIFEST_ITEM_STATUSES ───────────────────────────────────────────────────

describe("MANIFEST_ITEM_STATUSES", () => {
  it("exports an array of all valid ManifestItemStatus values", () => {
    expect(MANIFEST_ITEM_STATUSES).toEqual(["unchecked", "ok", "damaged", "missing"]);
  });

  it("contains exactly 4 statuses", () => {
    expect(MANIFEST_ITEM_STATUSES).toHaveLength(4);
  });

  it("includes unchecked as the first status (default for new items)", () => {
    expect(MANIFEST_ITEM_STATUSES[0]).toBe("unchecked");
  });

  it("all statuses are strings", () => {
    for (const s of MANIFEST_ITEM_STATUSES) {
      expect(typeof s).toBe("string");
    }
  });

  it("has no duplicate values", () => {
    const unique = new Set(MANIFEST_ITEM_STATUSES);
    expect(unique.size).toBe(MANIFEST_ITEM_STATUSES.length);
  });
});

// ─── Completion state query contract tests ────────────────────────────────────
// These tests verify the logical contracts that getChecklistItemsByStatus and
// getUncheckedItems must satisfy, using buildSummary as the source of truth.

describe("completion state query contracts", () => {
  it("getChecklistItemsByStatus(caseId, 'unchecked') is equivalent to items where status='unchecked'", () => {
    const allItems = [
      { status: "unchecked" },
      { status: "ok" },
      { status: "unchecked" },
      { status: "damaged" },
    ];

    // Simulate what the server-side filter does
    const unchecked = allItems.filter((i) => i.status === "unchecked");

    // buildSummary should reflect these items
    const summary = buildSummary("test-case", allItems);
    expect(summary.unchecked).toBe(unchecked.length);
  });

  it("getUncheckedItems returns empty when all items are reviewed", () => {
    const allReviewed = [
      { status: "ok" },
      { status: "damaged" },
      { status: "missing" },
    ];

    const unchecked = allReviewed.filter((i) => i.status === "unchecked");
    expect(unchecked).toHaveLength(0);

    const summary = buildSummary("test-case", allReviewed);
    expect(summary.isComplete).toBe(true);
    expect(summary.unchecked).toBe(0);
  });

  it("filtering by 'damaged' gives the same count as summary.damaged", () => {
    const items = [
      { status: "unchecked" },
      { status: "damaged" },
      { status: "damaged" },
      { status: "ok" },
    ];

    const damaged = items.filter((i) => i.status === "damaged");
    const summary = buildSummary("test-case", items);

    expect(damaged.length).toBe(summary.damaged);
  });

  it("filtering by 'missing' gives the same count as summary.missing", () => {
    const items = [
      { status: "ok" },
      { status: "missing" },
      { status: "unchecked" },
    ];

    const missing = items.filter((i) => i.status === "missing");
    const summary = buildSummary("test-case", items);

    expect(missing.length).toBe(summary.missing);
  });

  it("sum of all status-filtered counts equals total", () => {
    const items = [
      { status: "unchecked" },
      { status: "ok" },
      { status: "ok" },
      { status: "damaged" },
      { status: "missing" },
    ];

    const summary = buildSummary("test-case", items);
    const statusSum =
      summary.unchecked + summary.ok + summary.damaged + summary.missing;

    expect(statusSum).toBe(summary.total);
  });
});
