/**
 * convex/checklists.ts
 *
 * Public query functions for manifest item (checklist) state subscriptions.
 *
 * These are callable from the client via `useQuery` (convex/react) and deliver
 * real-time reactive updates to the INVENTORY dashboard and the SCAN mobile
 * app.  Convex re-runs any subscribed query automatically whenever the
 * underlying `manifestItems` or `inspections` rows change — no polling needed.
 *
 * Architecture
 * ────────────
 * Manifest items are the per-case state of each item on the packing list.
 * They are created when a case template is applied and updated by the SCAN
 * app during field inspection (status: unchecked → ok | damaged | missing).
 *
 * This module exposes six query functions covering all access patterns:
 *
 *   getChecklistByCase          — all items for a case, sorted for display
 *   getChecklistItem            — single item by (caseId, templateItemId)
 *   getChecklistSummary         — aggregate progress counts for a case
 *   getChecklistItemsByStatus   — items filtered by caseId + completion state
 *   getUncheckedItems           — convenience: only unchecked items for a case
 *   getChecklistWithInspection  — combined items + inspection (SCAN view)
 *
 * Index usage
 * ───────────
 *   getChecklistByCase         → by_case index         O(log n + |items|)
 *   getChecklistItem           → by_case index + filter O(log n + |items|)
 *   getChecklistSummary        → by_case index          O(log n + |items|)
 *   getChecklistItemsByStatus  → by_case_status index   O(log n + |results|)
 *   getUncheckedItems          → by_case_status index   O(log n + |results|)
 *   getChecklistWithInspection → by_case (both tables), parallel fetch
 *
 * All queries avoid N+1 patterns: they load all needed rows in one query
 * or a single Promise.all and join in memory.
 *
 * Pure helpers
 * ────────────
 * buildSummary and projectItem are pure functions (no DB calls).  They live in
 * convex/checklistHelpers.ts so they can be imported by unit tests without
 * pulling in the Convex server runtime.  This module re-exports them as
 * public symbols for backwards-compatibility with existing consumers.
 *
 * Client usage example:
 *   const items = useQuery(api.checklists.getChecklistByCase, { caseId });
 *   const damaged = useQuery(api.checklists.getChecklistItemsByStatus, {
 *     caseId,
 *     status: "damaged",
 *   });
 */

import { query } from "./_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";
import {
  buildSummary,
  projectItem,
} from "./checklistHelpers";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token."
    );
  }
  return identity;
}

// ─── Re-exports (types and pure helpers) ──────────────────────────────────────
// Consumers should import types from convex/checklists (this module) or from
// convex/checklistHelpers — both are stable public surfaces.

export type {
  ManifestItemStatus,
  ChecklistItem,
  ChecklistSummary,
  ChecklistWithInspection,
} from "./checklistHelpers";

export { MANIFEST_ITEM_STATUSES, buildSummary, projectItem } from "./checklistHelpers";

// ─── getChecklistByCase ───────────────────────────────────────────────────────

/**
 * Subscribe to all manifest items (checklist) for a given case.
 *
 * Returns items sorted by name for consistent checklist display.  Convex
 * will push a fresh update to all subscribers within ~100–300 ms whenever
 * the SCAN app records an item status change, satisfying the ≤ 2-second
 * real-time fidelity requirement.
 *
 * Use this query when rendering the full item checklist in:
 *   • SCAN app checklist view (field technician working through packing list)
 *   • T3 dashboard panel (inspection progress detail)
 *   • T4 dashboard panel (damage report with photo thumbnails)
 *
 * Returns an empty array when no template has been applied to the case yet.
 *
 * Client usage:
 *   const items = useQuery(api.checklists.getChecklistByCase, { caseId });
 */
export const getChecklistByCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    // Sort by name for deterministic display order.
    // Items are typically inserted in template order, but explicit sort
    // guarantees stable ordering regardless of insertion history.
    rows.sort((a, b) => a.name.localeCompare(b.name));

    return rows.map(projectItem);
  },
});

// ─── getChecklistItem ─────────────────────────────────────────────────────────

/**
 * Subscribe to a single manifest item identified by (caseId, templateItemId).
 *
 * Uses the `by_case` index + in-memory filter for point lookup.
 * Useful when the SCAN app needs to subscribe to updates on one specific
 * item — for example, watching for photo uploads to complete on an item
 * that was marked damaged.
 *
 * Returns `null` when no matching item is found (template item not applied
 * to this case, or invalid arguments).
 *
 * Client usage:
 *   const item = useQuery(api.checklists.getChecklistItem, {
 *     caseId,
 *     templateItemId,
 *   });
 */
export const getChecklistItem = query({
  args: {
    caseId: v.id("cases"),
    templateItemId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    // Load all items for the case via the by_case index, then filter by
    // templateItemId in memory.  Each case has at most ~10–50 manifest items,
    // so a full in-memory filter after the index scan is negligible.
    const rows = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    const row = rows.find((r) => r.templateItemId === args.templateItemId);
    return row ? projectItem(row) : null;
  },
});

// ─── getChecklistSummary ──────────────────────────────────────────────────────

/**
 * Subscribe to aggregate checklist progress counts for a case.
 *
 * Returns the total item count broken down by status, a progress percentage,
 * and a boolean indicating whether all items have been reviewed.  This is a
 * lighter-weight alternative to `getChecklistByCase` when only the summary
 * numbers are needed (e.g., map pin progress bar, dashboard T2 panel header).
 *
 * Convex re-runs this query whenever any manifest item for the case changes
 * — the counts stay accurate within 2 seconds of any SCAN app action.
 *
 * Returns a summary with all zeros when no items have been applied yet.
 *
 * Client usage:
 *   const summary = useQuery(api.checklists.getChecklistSummary, { caseId });
 *   // → { total: 12, ok: 9, damaged: 1, missing: 0, unchecked: 2, progressPct: 83 }
 */
export const getChecklistSummary = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    return buildSummary(args.caseId.toString(), rows);
  },
});

// ─── getChecklistItemsByStatus ────────────────────────────────────────────────

/**
 * Subscribe to manifest items for a case filtered by a specific completion state.
 *
 * This is the primary "completion-state scoped" query required by Sub-AC 36a-2.
 * It uses the `by_case_status` compound index for O(log n + |results|) lookups,
 * making it efficient even for cases with large packing lists.
 *
 * Convex re-runs this query automatically whenever:
 *   • A manifest item for the case changes status (e.g., unchecked → ok)
 *   • A new item is added to the case with the matching status
 *   • A note or photo is updated on a matching item
 *
 * All connected clients — dashboard panels and SCAN app views — receive the
 * updated result within ~100–300 ms of any mutation, satisfying the ≤ 2-second
 * real-time fidelity requirement.
 *
 * Valid status values:
 *   "unchecked" — items not yet reviewed (default after template apply)
 *   "ok"        — items confirmed present and undamaged
 *   "damaged"   — items present but with documented damage
 *   "missing"   — items not found during inspection
 *
 * Use cases:
 *   • Dashboard T3 panel: show only damaged/missing items in the issues list
 *   • Dashboard T4 panel: fetch damaged items with their photo storage IDs
 *   • SCAN app: highlight remaining unchecked items in the checklist view
 *   • SCAN app: group items by status for review
 *
 * Returns an empty array when no items match (not null) — callers can render
 * an empty state without guarding for null.
 *
 * Client usage:
 *   const damaged = useQuery(api.checklists.getChecklistItemsByStatus, {
 *     caseId,
 *     status: "damaged",
 *   });
 */
export const getChecklistItemsByStatus = query({
  args: {
    caseId: v.id("cases"),
    status: v.union(
      v.literal("unchecked"),
      v.literal("ok"),
      v.literal("damaged"),
      v.literal("missing"),
    ),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    // Use the by_case_status compound index for O(log n + |results|) lookup.
    // This avoids loading all items for the case and filtering in memory when
    // the caller only needs items in one specific completion state.
    const rows = await ctx.db
      .query("manifestItems")
      .withIndex("by_case_status", (q) =>
        q.eq("caseId", args.caseId).eq("status", args.status)
      )
      .collect();

    // Sort by name for deterministic display order across all status queries.
    rows.sort((a, b) => a.name.localeCompare(b.name));

    return rows.map(projectItem);
  },
});

// ─── getUncheckedItems ────────────────────────────────────────────────────────

/**
 * Subscribe to all unchecked (not-yet-reviewed) manifest items for a case.
 *
 * Convenience query for the SCAN app inspection workflow. Returns only items
 * still in the "unchecked" completion state — the technician's remaining
 * work list.  Uses the `by_case_status` compound index with status="unchecked"
 * for an efficient O(log n + |results|) lookup.
 *
 * This query is the reactive counterpart to the `isComplete` flag in
 * `getChecklistSummary`: when `getUncheckedItems` returns an empty array, the
 * inspection is complete and the "Finish Inspection" CTA should be enabled.
 *
 * Convex re-runs this query every time a manifest item transitions from
 * "unchecked" to any other status — so the SCAN app checklist view shrinks
 * in real-time as the technician works through the packing list.
 *
 * Returns an empty array when all items have been reviewed (not null).
 *
 * Client usage:
 *   const remaining = useQuery(api.checklists.getUncheckedItems, { caseId });
 *   // remaining?.length === 0 means the checklist is complete
 */
export const getUncheckedItems = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("manifestItems")
      .withIndex("by_case_status", (q) =>
        q.eq("caseId", args.caseId).eq("status", "unchecked")
      )
      .collect();

    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows.map(projectItem);
  },
});

// ─── getChecklistWithInspection ───────────────────────────────────────────────

/**
 * Subscribe to the combined checklist + inspection state for a case.
 *
 * This is the primary query for the SCAN app inspection view.  It bundles:
 *   1. All manifest items (the checklist the technician works through)
 *   2. The most recent inspection record (status, counters, inspector name)
 *   3. A computed summary (progress %, isComplete flag)
 *
 * Using a single subscription avoids the "two-query flicker" that would occur
 * if the item list and inspection record were fetched separately — Convex
 * guarantees that both tables are read at the same logical timestamp.
 *
 * Implementation note: both table queries run in a single Promise.all to
 * avoid sequential awaits.  The inspections query uses the `by_case` index
 * and returns all rows; we then pick the latest by _creationTime in memory
 * (same strategy as convex/maps.ts getMapData / assembleM3).
 *
 * Returns:
 *   items       — all manifest items, sorted by name
 *   inspection  — latest inspection record for the case, or null
 *   summary     — aggregate counts computed from the items list
 *
 * Client usage:
 *   const state = useQuery(api.checklists.getChecklistWithInspection, {
 *     caseId,
 *   });
 *   if (state === undefined) return <InspectionSkeleton />;
 *   const { items, inspection, summary } = state;
 */
export const getChecklistWithInspection = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    // Load manifest items and all inspections for this case in parallel.
    // Single Promise.all — no sequential awaits, no N+1.
    const [itemRows, inspectionRows] = await Promise.all([
      ctx.db
        .query("manifestItems")
        .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
        .collect(),

      ctx.db
        .query("inspections")
        .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
        .collect(),
    ]);

    // Sort items by name for deterministic display order.
    itemRows.sort((a, b) => a.name.localeCompare(b.name));

    // Select the latest inspection by _creationTime (same pattern as maps.ts).
    let latestInspection: (typeof inspectionRows)[number] | null = null;
    for (const ins of inspectionRows) {
      if (
        !latestInspection ||
        ins._creationTime > latestInspection._creationTime
      ) {
        latestInspection = ins;
      }
    }

    const items = itemRows.map(projectItem);
    const summary = buildSummary(args.caseId.toString(), itemRows);

    const inspection = latestInspection
      ? {
          _id: latestInspection._id.toString(),
          _creationTime: latestInspection._creationTime,
          status: latestInspection.status,
          inspectorId: latestInspection.inspectorId,
          inspectorName: latestInspection.inspectorName,
          startedAt: latestInspection.startedAt,
          completedAt: latestInspection.completedAt,
          totalItems: latestInspection.totalItems,
          checkedItems: latestInspection.checkedItems,
          damagedItems: latestInspection.damagedItems,
          missingItems: latestInspection.missingItems,
          notes: latestInspection.notes,
        }
      : null;

    return { items, inspection, summary };
  },
});
