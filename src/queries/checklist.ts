/**
 * src/queries/checklist.ts
 *
 * Convex useQuery hooks for real-time manifest item (checklist) subscriptions.
 *
 * This is the canonical import path for checklist query hooks. All components
 * that need real-time checklist data should import from here.
 *
 * Architecture
 * ────────────
 * Each exported hook is a thin `useQuery` wrapper around the corresponding
 * Convex query function in convex/checklists.ts.  Convex's reactive transport
 * pushes updates to all active subscriptions within ~100–300 ms whenever the
 * underlying `manifestItems` or `inspections` rows change — satisfying the
 * ≤ 2-second real-time fidelity requirement between a SCAN app action and
 * dashboard visibility, without any polling or manual refresh.
 *
 * When a field technician marks an item ok/damaged/missing in the SCAN app,
 * the mutation updates the `manifestItems` row; Convex re-evaluates every
 * subscribed query that touches that row and pushes the diff to connected
 * dashboard sessions — T1Overview and T2Manifest update automatically.
 *
 * Available hooks
 * ───────────────
 * useChecklistByCase(caseId)
 *   All manifest items for a case, sorted by name. Used by T3 and SCAN app.
 *
 * useChecklistItem(caseId, templateItemId)
 *   Single manifest item by (caseId, templateItemId) — narrow per-item watch.
 *
 * useChecklistSummary(caseId)
 *   Aggregate progress counts: total, ok, damaged, missing, unchecked,
 *   progressPct, isComplete. Lightweight subscription for progress bars.
 *   PRIMARY hook for T1Overview checklist progress section.
 *
 * useChecklistWithInspection(caseId)
 *   Combined items + inspection + summary in one subscription. Avoids
 *   two-query flicker for views needing both item list and inspection metadata.
 *   PRIMARY hook for T2Manifest packing list panel.
 *
 * useChecklistItemsByStatus(caseId, status)
 *   Items filtered to a specific completion state (unchecked|ok|damaged|missing).
 *   Uses the by_case_status compound index for O(log n) server-side filtering.
 *
 * useUncheckedItems(caseId)
 *   Convenience hook — only unchecked items for the SCAN app inspection flow.
 *
 * Loading / error states
 * ──────────────────────
 * `useQuery` returns:
 *   • `undefined`  — query is loading (initial fetch or reconnect)
 *   • `null`       — query returned null (item not found, nullable return type)
 *   • `T`          — successful result
 *
 * Skip pattern
 * ────────────
 * All hooks accept `null` as caseId and pass `"skip"` to useQuery when null,
 * suppressing the Convex subscription when no case is selected.
 *
 * Usage in T1Overview:
 *   import { useChecklistSummary } from "@/queries/checklist";
 *   const summary = useChecklistSummary(caseId);  // live aggregate counts
 *
 * Usage in T2Manifest:
 *   import { useChecklistWithInspection } from "@/queries/checklist";
 *   const data = useChecklistWithInspection(caseId);  // live items + inspection
 */

// Re-export all hooks from the canonical hook implementation.
// The hook file remains the single source of truth for the useQuery wiring;
// this module provides the canonical "queries/" import path for components.
export {
  useChecklistByCase,
  useChecklistItem,
  useChecklistSummary,
  useChecklistWithInspection,
  useChecklistItemsByStatus,
  useUncheckedItems,
  // Type exports
  MANIFEST_ITEM_STATUSES,
} from "../hooks/use-checklist";

export type {
  ManifestItemStatus,
  ChecklistItem,
  ChecklistSummary,
  ChecklistWithInspection,
} from "../hooks/use-checklist";
