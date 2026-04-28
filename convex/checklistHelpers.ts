/**
 * convex/checklistHelpers.ts
 *
 * Pure, Convex-runtime-free helper functions for the checklist items module.
 *
 * These functions are extracted from convex/checklists.ts so they can be
 * imported and unit-tested without a live Convex environment.  The Convex
 * query functions in checklists.ts import from this module; unit tests also
 * import directly from here.
 *
 * No imports from convex/server, convex/values, or _generated/* — this file
 * must remain safe to import in any JavaScript environment.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Valid inspection states for a single manifest item. */
export type ManifestItemStatus = "unchecked" | "ok" | "damaged" | "missing";

export const MANIFEST_ITEM_STATUSES: ManifestItemStatus[] = [
  "unchecked",
  "ok",
  "damaged",
  "missing",
];

/**
 * Typed representation of a manifest item row returned to the client.
 * Matches the `manifestItems` table columns in convex/schema.ts.
 */
export interface ChecklistItem {
  _id: string;
  _creationTime: number;
  caseId: string;
  templateItemId: string;
  name: string;
  status: ManifestItemStatus;
  notes?: string;
  photoStorageIds?: string[];
  checkedAt?: number;
  checkedById?: string;
  checkedByName?: string;
}

/**
 * Aggregate progress counts computed from the item list for a case.
 * Used by the SCAN app progress bar and the T3/T4 dashboard panels.
 */
export interface ChecklistSummary {
  caseId: string;
  total: number;
  unchecked: number;
  ok: number;
  damaged: number;
  missing: number;
  /**
   * Percentage of items that have been reviewed (ok + damaged + missing)
   * out of total.  0 when there are no items.
   */
  progressPct: number;
  /**
   * True when every item has been reviewed — no unchecked items remain.
   * Useful for enabling the "Complete Inspection" CTA in the SCAN app.
   */
  isComplete: boolean;
}

/**
 * Combined return type for getChecklistWithInspection.
 * Bundles the item list, the latest inspection record, and the computed
 * summary so the SCAN inspection view can render in a single subscription.
 */
export interface ChecklistWithInspection {
  items: ChecklistItem[];
  /**
   * The most recent inspection record for this case, or null if no
   * inspection has been started yet.
   */
  inspection: {
    _id: string;
    _creationTime: number;
    status: string;
    inspectorId: string;
    inspectorName: string;
    startedAt?: number;
    completedAt?: number;
    totalItems: number;
    checkedItems: number;
    damagedItems: number;
    missingItems: number;
    notes?: string;
  } | null;
  summary: ChecklistSummary;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Build a ChecklistSummary from an array of raw manifest items.
 *
 * Pure function — no DB calls.  Exported so unit tests can verify the summary
 * computation logic without a live Convex environment.
 */
export function buildSummary(
  caseId: string,
  items: { status: string }[]
): ChecklistSummary {
  const counts = { unchecked: 0, ok: 0, damaged: 0, missing: 0 };

  for (const item of items) {
    if (item.status === "unchecked") counts.unchecked++;
    else if (item.status === "ok") counts.ok++;
    else if (item.status === "damaged") counts.damaged++;
    else if (item.status === "missing") counts.missing++;
  }

  const total = items.length;
  const reviewed = counts.ok + counts.damaged + counts.missing;
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  return {
    caseId,
    total,
    unchecked: counts.unchecked,
    ok: counts.ok,
    damaged: counts.damaged,
    missing: counts.missing,
    progressPct,
    isComplete: total > 0 && counts.unchecked === 0,
  };
}

/**
 * Project a raw DB row to a typed ChecklistItem — strips internal Convex ID
 * types to plain strings so the client receives a serializable object.
 *
 * Pure function — exported for unit testing without a live Convex environment.
 */
export function projectItem(row: {
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
}): ChecklistItem {
  return {
    _id: row._id.toString(),
    _creationTime: row._creationTime,
    caseId: row.caseId.toString(),
    templateItemId: row.templateItemId,
    name: row.name,
    status: row.status as ManifestItemStatus,
    notes: row.notes,
    photoStorageIds: row.photoStorageIds,
    checkedAt: row.checkedAt,
    checkedById: row.checkedById,
    checkedByName: row.checkedByName,
  };
}
