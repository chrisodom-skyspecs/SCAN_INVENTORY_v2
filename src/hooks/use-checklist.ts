/**
 * src/hooks/use-checklist.ts
 *
 * Convex `useQuery` hooks for real-time manifest item (checklist) subscriptions.
 *
 * Architecture
 * ────────────
 * Each hook is a thin wrapper around `useQuery` (from convex/react) that
 * subscribes to the corresponding public query function in convex/checklists.ts.
 * Convex's reactive transport layer pushes updates from the server to all
 * active subscriptions within ~100–300 ms of a mutation, satisfying the
 * ≤ 2-second real-time fidelity requirement.
 *
 * When a SCAN app technician marks an item as "damaged" or "ok", the mutation
 * updates the `manifestItems` row; Convex automatically re-evaluates all
 * subscribed queries that touch that row and pushes the diff to connected
 * dashboard sessions — no polling, no manual refetching.
 *
 * Loading / error states
 * ──────────────────────
 * `useQuery` returns:
 *   • `undefined`  — query is loading (initial fetch or reconnect)
 *   • `null`       — query returned null (item not found)
 *   • `T`          — successful result
 *
 * All hooks propagate this convention unchanged.  Components should guard
 * against `undefined` (show skeleton) and `null` (show not-found / empty state).
 *
 * Skip pattern
 * ────────────
 * Passing `"skip"` as the second argument to `useQuery` suppresses the
 * subscription entirely.  All hooks that accept a nullable caseId use `"skip"`
 * when the value is null, avoiding unnecessary Convex traffic while no case
 * is selected.
 *
 * Available hooks:
 *   useChecklistByCase(caseId)
 *     All manifest items for a case, sorted by name. Includes item status,
 *     notes, and photo storage IDs.
 *
 *   useChecklistItem(caseId, templateItemId)
 *     Single manifest item by (caseId, templateItemId). Useful for narrow
 *     per-item subscriptions when only one row needs to be watched.
 *
 *   useChecklistSummary(caseId)
 *     Aggregate progress counts for a case: total, ok, damaged, missing,
 *     unchecked, progressPct, isComplete. Lightweight alternative to the
 *     full item list for progress bars and dashboard headers.
 *
 *   useChecklistWithInspection(caseId)
 *     Combined items + inspection + summary in one subscription. Primary
 *     hook for the SCAN app inspection view — avoids two-query flicker.
 *
 *   useChecklistItemsByStatus(caseId, status)
 *     Real-time list of manifest items for a case filtered to a specific
 *     completion state (unchecked | ok | damaged | missing). Uses the
 *     by_case_status compound index for efficient O(log n) lookups.
 *     Primary hook for completion-state-scoped views (Sub-AC 36a-2).
 *
 *   useUncheckedItems(caseId)
 *     Convenience hook for the SCAN app inspection workflow — real-time list
 *     of items still requiring review. Shrinks to an empty array as the
 *     technician works through the packing list.
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MANIFEST_ITEM_STATUSES } from "@/lib/checklist-summary";

// Re-export types so consumers can import them from the hook module.
export type {
  ManifestItemStatus,
  ChecklistItem,
  ChecklistSummary,
  ChecklistWithInspection,
} from "@/lib/checklist-summary";

// Re-export constant for status iteration in UI components.
export { MANIFEST_ITEM_STATUSES };

// ─── useChecklistByCase ───────────────────────────────────────────────────────

/**
 * Subscribe to all manifest items for a case.
 *
 * Returns items sorted by name for consistent checklist display.  The list
 * updates in real-time whenever the SCAN app records a status change, photo
 * upload, or note on any item in the case.
 *
 * Use cases:
 *   • SCAN app checklist view — technician works through each packing item
 *   • Dashboard T3 panel — inspection progress detail with item list
 *   • Dashboard T4 panel — damage report showing flagged items with photos
 *
 * Pass `null` as `caseId` to skip the subscription (no case selected).
 *
 * Return values:
 *   `undefined`          — loading
 *   `ChecklistItem[]`    — live list of manifest items (may be empty)
 *
 * @example
 * function ChecklistPanel({ caseId }: { caseId: string | null }) {
 *   const items = useChecklistByCase(caseId);
 *   if (items === undefined) return <ChecklistSkeleton />;
 *   if (items.length === 0) return <NoItemsMessage />;
 *   return (
 *     <ul>
 *       {items.map((item) => (
 *         <ChecklistRow key={item._id} item={item} />
 *       ))}
 *     </ul>
 *   );
 * }
 */
export function useChecklistByCase(caseId: string | null) {
  return useQuery(
    api.checklists.getChecklistByCase,
    caseId !== null ? { caseId: caseId as Id<"cases"> } : "skip",
  );
}

// ─── useChecklistItem ─────────────────────────────────────────────────────────

/**
 * Subscribe to a single manifest item identified by (caseId, templateItemId).
 *
 * Uses the `by_case_item` compound index on the server for an O(log n)
 * point lookup.  This is the most granular subscription — use it when only
 * one specific item needs to be watched, such as monitoring photo upload
 * completion for a damaged item or reacting to a status correction.
 *
 * Pass `null` for either argument to skip the subscription.
 *
 * Return values:
 *   `undefined`        — loading
 *   `null`             — item not found (template item not applied to case)
 *   `ChecklistItem`    — live item state
 *
 * @example
 * function ItemStatusBadge({
 *   caseId,
 *   templateItemId,
 * }: {
 *   caseId: string | null;
 *   templateItemId: string | null;
 * }) {
 *   const item = useChecklistItem(caseId, templateItemId);
 *   if (item === undefined) return <Spinner />;
 *   if (item === null) return null;
 *   return <StatusPill kind={item.status} />;
 * }
 */
export function useChecklistItem(
  caseId: string | null,
  templateItemId: string | null,
) {
  return useQuery(
    api.checklists.getChecklistItem,
    caseId !== null && templateItemId !== null
      ? { caseId: caseId as Id<"cases">, templateItemId }
      : "skip",
  );
}

// ─── useChecklistSummary ──────────────────────────────────────────────────────

/**
 * Subscribe to aggregate checklist progress counts for a case.
 *
 * Returns the total item count, a breakdown by status, a progress percentage,
 * and an `isComplete` flag.  This is a lighter-weight subscription than
 * `useChecklistByCase` — it transfers a single summary object rather than
 * the full item array, making it suitable for:
 *   • Dashboard map pin progress bar (M3 Field Mode)
 *   • Dashboard T2 panel header inspection counter
 *   • SCAN app "Complete Inspection" button enablement
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`          — loading
 *   `ChecklistSummary`   — live aggregate counts
 *
 * @example
 * function InspectionProgressBar({ caseId }: { caseId: string | null }) {
 *   const summary = useChecklistSummary(caseId);
 *   if (!summary) return <ProgressBarSkeleton />;
 *   return (
 *     <div>
 *       <progress value={summary.progressPct} max={100} />
 *       <span>{summary.progressPct}% reviewed</span>
 *       <span>{summary.damaged} damaged · {summary.missing} missing</span>
 *     </div>
 *   );
 * }
 */
export function useChecklistSummary(caseId: string | null) {
  return useQuery(
    api.checklists.getChecklistSummary,
    caseId !== null ? { caseId: caseId as Id<"cases"> } : "skip",
  );
}

// ─── useChecklistWithInspection ───────────────────────────────────────────────

/**
 * Subscribe to the combined checklist items + inspection state for a case.
 *
 * This is the primary hook for the SCAN app inspection view.  It bundles:
 *   • `items`      — all manifest items, sorted by name
 *   • `inspection` — the most recent inspection record (status, inspector,
 *                    aggregate counters) or null if none started yet
 *   • `summary`    — aggregate progress counts computed from the item list
 *
 * Using a single subscription avoids the "two-query flicker" that would occur
 * if items and the inspection record were subscribed separately.  Convex
 * evaluates both table reads at the same logical timestamp, so the client
 * always receives a consistent snapshot.
 *
 * Also suitable for the dashboard T3 panel (inspection detail view) when
 * both the item list and inspection metadata are needed simultaneously.
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`                  — loading
 *   `ChecklistWithInspection`    — live combined checklist + inspection state
 *
 * @example
 * function ScanInspectionView({ caseId }: { caseId: string | null }) {
 *   const state = useChecklistWithInspection(caseId);
 *
 *   if (state === undefined) return <InspectionSkeleton />;
 *
 *   const { items, inspection, summary } = state;
 *
 *   return (
 *     <div>
 *       <InspectionHeader inspection={inspection} summary={summary} />
 *       <ChecklistItemList items={items} />
 *       <CompleteButton disabled={!summary.isComplete} />
 *     </div>
 *   );
 * }
 */
export function useChecklistWithInspection(caseId: string | null) {
  return useQuery(
    api.checklists.getChecklistWithInspection,
    caseId !== null ? { caseId: caseId as Id<"cases"> } : "skip",
  );
}

// ─── useChecklistItemsByStatus ────────────────────────────────────────────────

/**
 * Subscribe to manifest items for a case filtered to a specific completion state.
 *
 * This is the completion-state-scoped query hook required by Sub-AC 36a-2.
 * Backed by the `by_case_status` compound index for O(log n) server-side
 * filtering — only matching items are transferred from server to client.
 *
 * Convex re-runs this query automatically whenever a manifest item in the case
 * changes status.  All connected dashboard panels and SCAN app views receive
 * the updated list within ~100–300 ms — satisfying the ≤ 2-second fidelity
 * requirement between SCAN app actions and dashboard visibility.
 *
 * Status values:
 *   "unchecked" — not yet reviewed (default after template apply)
 *   "ok"        — confirmed present and undamaged
 *   "damaged"   — present but with documented damage
 *   "missing"   — not found during inspection
 *
 * Pass `null` for either argument to skip the subscription.
 *
 * Return values:
 *   `undefined`          — loading (initial fetch or reconnect)
 *   `ChecklistItem[]`    — live filtered item list (may be empty array)
 *
 * @example
 * // Dashboard T4 panel: show damaged items with their photo thumbnails
 * function DamagedItemsList({ caseId }: { caseId: string | null }) {
 *   const damaged = useChecklistItemsByStatus(caseId, "damaged");
 *   if (damaged === undefined) return <Skeleton />;
 *   if (damaged.length === 0) return <p>No damaged items.</p>;
 *   return (
 *     <ul>
 *       {damaged.map((item) => (
 *         <DamageReportRow key={item._id} item={item} />
 *       ))}
 *     </ul>
 *   );
 * }
 *
 * @example
 * // SCAN app: show only remaining unchecked items (progress through packing list)
 * function RemainingItems({ caseId }: { caseId: string | null }) {
 *   const remaining = useChecklistItemsByStatus(caseId, "unchecked");
 *   if (remaining === undefined) return <Spinner />;
 *   return <p>{remaining.length} items remaining</p>;
 * }
 */
export function useChecklistItemsByStatus(
  caseId: string | null,
  status: "unchecked" | "ok" | "damaged" | "missing" | null,
) {
  return useQuery(
    api.checklists.getChecklistItemsByStatus,
    caseId !== null && status !== null ? { caseId: caseId as Id<"cases">, status } : "skip",
  );
}

// ─── useUncheckedItems ────────────────────────────────────────────────────────

/**
 * Subscribe to all unchecked (not-yet-reviewed) manifest items for a case.
 *
 * Convenience hook for the SCAN app inspection workflow.  Returns the real-time
 * list of items still in "unchecked" state — the technician's remaining work.
 * Uses the `by_case_status` compound index with a hardcoded status="unchecked"
 * filter, equivalent to `useChecklistItemsByStatus(caseId, "unchecked")` but
 * with a more descriptive name at the call site.
 *
 * The list shrinks in real-time as the technician marks items ok/damaged/missing.
 * When the returned array is empty (and not undefined), the inspection is
 * complete and the "Finish Inspection" CTA can be enabled.
 *
 * Relationship to `useChecklistSummary`:
 *   • `useChecklistSummary(caseId).unchecked` gives the count
 *   • `useUncheckedItems(caseId)` gives the full item objects (for rendering
 *     the remaining checklist with names, notes, and photo slots)
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`          — loading
 *   `ChecklistItem[]`    — live list of unchecked items (empty when done)
 *
 * @example
 * function ScanChecklistRemaining({ caseId }: { caseId: string | null }) {
 *   const remaining = useUncheckedItems(caseId);
 *
 *   if (remaining === undefined) return <ChecklistSkeleton />;
 *
 *   if (remaining.length === 0) {
 *     return (
 *       <div>
 *         <p>All items reviewed!</p>
 *         <button>Finish Inspection</button>
 *       </div>
 *     );
 *   }
 *
 *   return (
 *     <ul>
 *       {remaining.map((item) => (
 *         <ChecklistRow key={item._id} item={item} />
 *       ))}
 *     </ul>
 *   );
 * }
 */
export function useUncheckedItems(caseId: string | null) {
  return useQuery(
    api.checklists.getUncheckedItems,
    caseId !== null ? { caseId: caseId as Id<"cases"> } : "skip",
  );
}
