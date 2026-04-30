/**
 * Browser-safe checklist summary helpers.
 *
 * This mirrors the pure `buildSummary` helper used by Convex without importing
 * files from `convex/` into client bundles.
 */

export type ManifestItemStatus = "unchecked" | "ok" | "damaged" | "missing";

export const MANIFEST_ITEM_STATUSES: readonly ManifestItemStatus[] = [
  "unchecked",
  "ok",
  "damaged",
  "missing",
];

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

export interface ChecklistSummary {
  caseId: string;
  total: number;
  unchecked: number;
  ok: number;
  damaged: number;
  missing: number;
  progressPct: number;
  isComplete: boolean;
}

export interface ChecklistWithInspection {
  items: ChecklistItem[];
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
