/**
 * convex/cases.ts
 *
 * Public query functions for case status subscriptions.
 *
 * These are callable from the client via `useQuery` (convex/react) and
 * provide real-time reactive updates to the INVENTORY dashboard and the
 * SCAN mobile app.  Convex re-runs any subscribed query automatically
 * whenever the underlying rows change — no polling required.
 *
 * All functions here use `query` (public visibility), in contrast to the
 * `internalQuery` functions in convex/maps.ts which are server-side only.
 *
 * Query functions:
 *   getCaseStatus        — status + key display fields for a single case
 *   getCaseById          — full case document by Convex ID
 *   getCaseByQrCode      — case lookup by QR payload (SCAN app entry point)
 *   listCases            — all cases with optional status / mission / bounds filter
 *   getCasesInBounds     — all cases within a geographic bounding box
 *   getCaseStatusCounts  — aggregate counts per status for dashboard header
 *
 * Performance notes:
 *   • getCaseStatus / getCaseById use ctx.db.get — O(1) primary-key lookup.
 *   • getCaseByQrCode uses the by_qr_code index — O(log n).
 *   • listCases uses by_status or by_mission indexes when filters are
 *     provided; falls back to by_updated full scan when neither is set.
 *     Bounding-box filtering is applied in-memory after the index scan.
 *   • getCasesInBounds performs a full table scan with in-memory geo filter
 *     (no spatial index available in Convex) — acceptable for fleets up
 *     to ~10k cases; Convex re-evaluates on any cases row change.
 *   • getCaseStatusCounts performs a full table scan and aggregates in
 *     memory — acceptable for a single-tenant fleet up to ~10k cases.
 */

import { query } from "./_generated/server";
import { v } from "convex/values";

// ─── Shared status literal validator ─────────────────────────────────────────

/**
 * Convex value validator for the case status union.
 * Mirrors the `caseStatus` definition in convex/schema.ts.
 * Defined once here so query args can re-use it without duplication.
 */
const caseStatusValidator = v.union(
  v.literal("assembled"),
  v.literal("deployed"),
  v.literal("in_field"),
  v.literal("shipping"),
  v.literal("returned"),
);

// ─── Exported TypeScript type (for use in hook / component files) ─────────────

/**
 * Valid lifecycle statuses for a case.
 * Matches the `caseStatus` union in convex/schema.ts.
 */
export type CaseStatus =
  | "assembled"
  | "deployed"
  | "in_field"
  | "shipping"
  | "returned";

export const CASE_STATUSES: CaseStatus[] = [
  "assembled",
  "deployed",
  "in_field",
  "shipping",
  "returned",
];

// ─── Return-type interfaces ───────────────────────────────────────────────────

/**
 * Lightweight status projection returned by getCaseStatus.
 * Contains only the fields needed for map pins and status badges —
 * avoids transferring the full document when only status is needed.
 */
export interface CaseStatusResult {
  _id: string;
  label: string;
  status: CaseStatus;
  lat?: number;
  lng?: number;
  locationName?: string;
  assigneeId?: string;
  assigneeName?: string;
  missionId?: string;
  updatedAt: number;
}

/**
 * Aggregate status counts for the dashboard global summary bar.
 */
export interface CaseStatusCounts {
  total: number;
  byStatus: Record<CaseStatus, number>;
}

// ─── getCaseStatus ────────────────────────────────────────────────────────────

/**
 * Subscribe to a single case's status and key display fields.
 *
 * Designed for the dashboard's case-detail panel: provides enough data to
 * render the status badge, location, and assignee without fetching the full
 * document.  Convex will re-run this query and push the update whenever the
 * case row changes (e.g., the SCAN app calls a mutation to advance status).
 *
 * Returns `null` if the case does not exist (deleted or invalid ID).
 *
 * Client usage:
 *   const status = useQuery(api.cases.getCaseStatus, { caseId });
 */
export const getCaseStatus = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<CaseStatusResult | null> => {
    const c = await ctx.db.get(args.caseId);
    if (!c) return null;

    return {
      _id: c._id.toString(),
      label: c.label,
      status: c.status as CaseStatus,
      lat: c.lat,
      lng: c.lng,
      locationName: c.locationName,
      assigneeId: c.assigneeId,
      assigneeName: c.assigneeName,
      missionId: c.missionId?.toString(),
      updatedAt: c.updatedAt,
    };
  },
});

// ─── getCaseById ──────────────────────────────────────────────────────────────

/**
 * Subscribe to the full case document for T1–T5 detail panel rendering.
 *
 * Returns the complete `Doc<"cases">` row including all optional fields.
 * Use this when the detail panel needs notes, templateId, or other fields
 * not included in the lightweight getCaseStatus projection.
 *
 * Returns `null` if the case does not exist.
 *
 * Client usage:
 *   const caseDoc = useQuery(api.cases.getCaseById, { caseId });
 */
export const getCaseById = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.caseId);
  },
});

// ─── getCaseByQrCode ──────────────────────────────────────────────────────────

/**
 * Look up a case by its QR code payload.
 *
 * This is the primary entry point for the SCAN mobile app.  After the camera
 * decodes a QR code, the app subscribes to this query with the decoded string.
 * The `by_qr_code` index makes this an O(log n) lookup.
 *
 * Returns the full case document, or `null` if no case matches the QR code.
 *
 * Client usage:
 *   const caseDoc = useQuery(api.cases.getCaseByQrCode, { qrCode });
 */
export const getCaseByQrCode = query({
  args: { qrCode: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("cases")
      .withIndex("by_qr_code", (q) => q.eq("qrCode", args.qrCode))
      .first();
  },
});

// ─── listCases ────────────────────────────────────────────────────────────────

/**
 * Subscribe to all cases with optional status, mission, or bounding-box filter.
 *
 * Used by the dashboard map views (M1–M5) and the dashboard case list.
 * Convex will re-run this query and push incremental updates to all
 * subscribed dashboard sessions whenever any case row changes.
 *
 * Filtering behaviour:
 *   • `status` provided   → uses `by_status` index (efficient)
 *   • `missionId` provided → uses `by_mission` index (efficient)
 *   • Neither provided    → full scan ordered by `updatedAt` desc
 *   • Both provided       → status index scan, then in-memory mission filter
 *   • Bounds (all four of swLat/swLng/neLat/neLng provided) → additional
 *     in-memory bounding-box filter applied after the index/full scan.
 *     Cases without lat/lng are excluded when bounds are active.
 *
 * Client usage:
 *   // All cases (Fleet Overview)
 *   const cases = useQuery(api.cases.listCases, {});
 *
 *   // Cases in the field
 *   const fieldCases = useQuery(api.cases.listCases, { status: "in_field" });
 *
 *   // Cases on a specific mission
 *   const missionCases = useQuery(api.cases.listCases, { missionId });
 *
 *   // Cases within a map viewport (real-time map subscriptions)
 *   const viewportCases = useQuery(api.cases.listCases, {
 *     swLat: 40.0, swLng: -74.5, neLat: 41.0, neLng: -73.5,
 *   });
 */
export const listCases = query({
  args: {
    status: v.optional(caseStatusValidator),
    missionId: v.optional(v.id("missions")),
    // Geographic bounding box — all four must be provided together.
    // Cases without lat/lng are excluded when bounds are active.
    swLat: v.optional(v.number()),
    swLng: v.optional(v.number()),
    neLat: v.optional(v.number()),
    neLng: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let results;

    if (args.status !== undefined && args.missionId !== undefined) {
      // Both filters: status index + in-memory mission filter
      const byStatus = await ctx.db
        .query("cases")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
      results = byStatus.filter(
        (c) => c.missionId?.toString() === args.missionId!.toString()
      );
    } else if (args.status !== undefined) {
      // Status index scan — O(|cases with that status|)
      results = await ctx.db
        .query("cases")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else if (args.missionId !== undefined) {
      // Mission index scan — O(|cases on that mission|)
      results = await ctx.db
        .query("cases")
        .withIndex("by_mission", (q) => q.eq("missionId", args.missionId!))
        .collect();
    } else {
      // No filter: full scan ordered by updatedAt desc
      results = await ctx.db
        .query("cases")
        .withIndex("by_updated")
        .order("desc")
        .collect();
    }

    // Apply geographic bounding-box filter in-memory when all four bounds
    // params are provided.  Cases with no lat/lng are excluded.
    const hasBounds =
      args.swLat !== undefined &&
      args.swLng !== undefined &&
      args.neLat !== undefined &&
      args.neLng !== undefined;

    if (hasBounds) {
      results = results.filter(
        (c) =>
          c.lat !== undefined &&
          c.lng !== undefined &&
          c.lat >= args.swLat! &&
          c.lat <= args.neLat! &&
          c.lng >= args.swLng! &&
          c.lng <= args.neLng!
      );
    }

    return results;
  },
});

// ─── BoundsFilter type ────────────────────────────────────────────────────────

/**
 * Geographic bounding box for location-based case queries.
 * All four coordinates must be provided together.
 */
export interface BoundsFilter {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

// ─── getCasesInBounds ─────────────────────────────────────────────────────────

/**
 * Subscribe to all cases whose last-known location falls within a geographic
 * bounding box.  An optional `status` filter further narrows results.
 *
 * This is the dedicated real-time watcher for viewport-constrained map views.
 * Convex re-runs this query whenever any case row changes — the subscription
 * automatically reflects position updates, status transitions, and new cases
 * added within the bounds.
 *
 * Cases with no lat/lng are always excluded.
 *
 * Performance:
 *   • No spatial index is available in Convex; the query performs a full
 *     table scan with in-memory bounding-box filtering.  This is acceptable
 *     for fleets up to ~10k cases — the bottleneck is network transfer, not
 *     the O(n) filter pass.
 *   • When `status` is provided, the `by_status` index is used first to
 *     reduce the in-memory filter set.
 *
 * Returns cases sorted by `updatedAt` descending (most recently changed first).
 *
 * Client usage:
 *   const viewportCases = useQuery(api.cases.getCasesInBounds, {
 *     swLat: bounds.swLat,
 *     swLng: bounds.swLng,
 *     neLat: bounds.neLat,
 *     neLng: bounds.neLng,
 *   });
 *
 *   // With status filter (e.g., only show in_field cases in viewport)
 *   const fieldCasesInView = useQuery(api.cases.getCasesInBounds, {
 *     ...bounds,
 *     status: "in_field",
 *   });
 */
export const getCasesInBounds = query({
  args: {
    swLat: v.number(),
    swLng: v.number(),
    neLat: v.number(),
    neLng: v.number(),
    // Optional status filter — applied before the bounds filter using the index
    status: v.optional(caseStatusValidator),
  },
  handler: async (ctx, args) => {
    // Fetch candidates: use by_status index when status is specified,
    // otherwise scan by_updated for consistent desc ordering.
    const candidates = args.status !== undefined
      ? await ctx.db
          .query("cases")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .collect()
      : await ctx.db
          .query("cases")
          .withIndex("by_updated")
          .order("desc")
          .collect();

    // In-memory bounding-box filter: exclude cases with no position
    return candidates.filter(
      (c) =>
        c.lat !== undefined &&
        c.lng !== undefined &&
        c.lat >= args.swLat &&
        c.lat <= args.neLat &&
        c.lng >= args.swLng &&
        c.lng <= args.neLng
    );
  },
});

// ─── getCaseStatusCounts ──────────────────────────────────────────────────────

/**
 * Subscribe to aggregate case status counts for the dashboard header.
 *
 * Provides the total case count and a breakdown by status, used to render
 * the summary bar and status filter pills in the INVENTORY dashboard.
 *
 * Convex re-runs this query on any case row change, ensuring the header
 * counts stay accurate within 2 seconds of any SCAN app action.
 *
 * Client usage:
 *   const counts = useQuery(api.cases.getCaseStatusCounts, {});
 *   // → { total: 42, byStatus: { assembled: 5, deployed: 12, ... } }
 */
export const getCaseStatusCounts = query({
  args: {},
  handler: async (ctx): Promise<CaseStatusCounts> => {
    const allCases = await ctx.db.query("cases").collect();

    const byStatus: Record<CaseStatus, number> = {
      assembled: 0,
      deployed: 0,
      in_field: 0,
      shipping: 0,
      returned: 0,
    };

    for (const c of allCases) {
      if (Object.prototype.hasOwnProperty.call(byStatus, c.status)) {
        byStatus[c.status as CaseStatus]++;
      }
    }

    return {
      total: allCases.length,
      byStatus,
    };
  },
});
