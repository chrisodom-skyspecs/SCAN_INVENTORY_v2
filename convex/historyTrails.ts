/**
 * convex/historyTrails.ts
 *
 * Public query functions for the INVENTORY map history trails overlay.
 *
 * The history trails layer renders the movement path of each case over time,
 * derived from the immutable `scans` table.  Each scan event that recorded a
 * GPS position contributes a waypoint; waypoints for the same case are
 * connected in chronological order to form a movement trail.
 *
 * Architecture
 * ────────────
 * 1. `getHistoryTrails` — primary subscribed query.
 *      Loads all scans with valid lat/lng coordinates, optionally filtered by
 *      caseId, missionId, or a time window.  Returns per-case trail objects with
 *      an ordered waypoint array and metadata for map rendering.
 *
 * 2. `getHistoryTrailByCaseId` — single-case trail query.
 *      Returns the complete movement history for one specific case.
 *      Used by the T5 CaseDetail panel to show a case-specific path.
 *
 * Reactive dependency chain
 * ─────────────────────────
 * Both queries read the `scans` table.  Any insert to `scans` (from
 * `scanCheckIn`, `updateChecklistItem`, or any SCAN app workflow that records
 * a new scan position) invalidates active subscriptions and pushes updated
 * trail data to connected clients within ~100–300 ms — satisfying the
 * ≤ 2-second real-time fidelity requirement.
 *
 * Data shape
 * ──────────
 * Each CaseTrail includes:
 *   caseId       — Convex cases document ID (string)
 *   caseLabel    — human-readable label (e.g. "CASE-0042")
 *   waypoints    — chronological array of { lat, lng, scannedAt, scannedByName, scanContext }
 *   latestScan   — epoch ms of the most recent waypoint (for sort/filter)
 *   waypointCount — total number of georeferenced scan events
 *
 * Client usage
 * ────────────
 *   const data = useQuery(api.historyTrails.getHistoryTrails, {});
 *   const data = useQuery(api.historyTrails.getHistoryTrails, {
 *     caseId: "some-case-id",
 *     since: Date.now() - 7 * 24 * 60 * 60 * 1000,  // last 7 days
 *   });
 *
 * Use the companion hook in src/hooks/use-history-trail.ts:
 *   const { trailData, isActive } = useHistoryTrail();
 */

import { query } from "./_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";

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

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A single georeferenced scan event — one waypoint in a case trail.
 */
export interface TrailWaypoint {
  /** Scan document ID (for key/dedup). */
  scanId: string;
  /** WGS-84 latitude at scan time. */
  lat: number;
  /** WGS-84 longitude at scan time. */
  lng: number;
  /** Epoch ms when the scan occurred. */
  scannedAt: number;
  /** Display name of the technician who performed the scan. */
  scannedByName: string;
  /**
   * Why the scan was initiated (check_in | inspection | handoff | lookup).
   * Used to style waypoint markers differently by context.
   */
  scanContext: string | undefined;
  /** Human-readable location name at time of scan, if recorded. */
  locationName: string | undefined;
}

/**
 * Movement trail for a single case — an ordered sequence of scan waypoints.
 */
export interface CaseTrail {
  /** Convex cases document ID (string form). */
  caseId: string;
  /** Human-readable case label (e.g. "CASE-0042"). */
  caseLabel: string;
  /**
   * Chronologically ordered waypoints (oldest first).
   * Only includes scans that recorded a valid lat/lng coordinate.
   */
  waypoints: TrailWaypoint[];
  /** Epoch ms of the most recent waypoint (for sorting/filtering). */
  latestScan: number;
  /** Total number of georeferenced scan events for this case. */
  waypointCount: number;
}

/**
 * Response shape from getHistoryTrails.
 */
export interface HistoryTrailsResponse {
  /** Per-case trail data, sorted by latestScan descending (most recently seen first). */
  trails: CaseTrail[];
  /** Total number of georeferenced scan events across all cases. */
  totalWaypoints: number;
  /** Number of distinct cases with at least one georeferenced scan. */
  trailCount: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of waypoints to return per case trail.
 * Prevents a single case with thousands of scans from dominating the payload.
 * The most recent `MAX_WAYPOINTS_PER_CASE` scans are kept when the limit is hit.
 */
const MAX_WAYPOINTS_PER_CASE = 100;

/**
 * Maximum number of case trails to return in a single query.
 * Limits the GeoJSON payload for fleet-wide views.
 */
const MAX_TRAILS = 500;

// ─── getHistoryTrails — Fleet history overlay ────────────────────────────────

/**
 * Subscribe to fleet-wide case movement history for the history trails overlay.
 *
 * Returns per-case trail data: an ordered array of scan waypoints for each case
 * that has at least one georeferenced scan event.  Trails are sorted by
 * `latestScan` descending so recently-active cases appear first.
 *
 * Filters
 * ───────
 * • caseId  — limit to a single case (used by T5 case detail panel)
 * • missionId — limit to cases on a specific mission
 * • since   — only include waypoints after this epoch ms timestamp
 * • limit   — max trails to return (default MAX_TRAILS)
 *
 * Reactive to:
 *   • Any scan mutation (scanCheckIn, startInspection, handoffCustody) that
 *     inserts a new row into the `scans` table with a valid lat/lng.
 *
 * Client usage:
 *   const data = useQuery(api.historyTrails.getHistoryTrails, {});
 *   const data = useQuery(api.historyTrails.getHistoryTrails, {
 *     missionId: "abc123",
 *     since: Date.now() - 7 * 24 * 60 * 60 * 1000,
 *   });
 */
export const getHistoryTrails = query({
  args: {
    /**
     * Filter to a single case's trail.
     * When provided, returns an array with at most one CaseTrail entry.
     */
    caseId:    v.optional(v.string()),
    /**
     * Filter to cases on a specific mission (Convex mission document ID).
     * Requires a secondary join against the cases table.
     * Omit for a fleet-wide trail view.
     */
    missionId: v.optional(v.string()),
    /**
     * Only include waypoints after this epoch ms timestamp.
     * Use to show "last 24 hours" or "last 7 days" movement.
     * Omit to include all history.
     */
    since:     v.optional(v.number()),
    /**
     * Maximum number of case trails to return.
     * @default 500
     */
    limit:     v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<HistoryTrailsResponse> => {
    await requireAuth(ctx);

    const maxTrails = Math.min(args.limit ?? MAX_TRAILS, MAX_TRAILS);

    // ── Load scans with geographic coordinates ────────────────────────────
    //
    // We need scans with valid lat/lng.  Convex doesn't support IS NOT NULL
    // filters natively, so we load by index and filter in memory.
    // The by_scanned_at index gives us a time-ordered scan feed efficiently.
    //
    // For time-window filtering (since), use the by_scanned_at index with
    // a range query to avoid loading older scan history.
    let scanDocs;
    if (args.since !== undefined) {
      scanDocs = await ctx.db
        .query("scans")
        .withIndex("by_scanned_at", (q) => q.gte("scannedAt", args.since!))
        .order("asc")
        .collect();
    } else {
      // Full history — still ordered by scannedAt ascending so waypoints
      // are in chronological order within each per-case group.
      scanDocs = await ctx.db
        .query("scans")
        .withIndex("by_scanned_at")
        .order("asc")
        .collect();
    }

    // ── Filter to scans with valid GPS coordinates ────────────────────────
    //
    // Many scans won't have lat/lng (device couldn't get a GPS fix).
    // We only include those that have both coordinates.
    const geoScans = scanDocs.filter(
      (s) => s.lat !== undefined && s.lng !== undefined
    );

    // ── Build per-case waypoint groups ────────────────────────────────────
    //
    // O(n) single pass: group scans by caseId into Map<caseId, TrailWaypoint[]>.
    // Waypoints are already in chronological order (from the by_scanned_at index).
    const waypointsByCase = new Map<string, TrailWaypoint[]>();
    for (const scan of geoScans) {
      const key = scan.caseId.toString();
      const waypoints = waypointsByCase.get(key) ?? [];
      waypoints.push({
        scanId:       scan._id.toString(),
        lat:          scan.lat!,
        lng:          scan.lng!,
        scannedAt:    scan.scannedAt,
        scannedByName: scan.scannedByName,
        scanContext:  scan.scanContext,
        locationName: scan.locationName,
      });
      waypointsByCase.set(key, waypoints);
    }

    // ── Load case labels for the grouped case IDs ─────────────────────────
    //
    // Always load all cases in a single query to build an O(1) label lookup map.
    // This avoids complex index query type issues and keeps the code clean.
    // Cases are the primary entity (≤ ~10k), so a full table scan is acceptable.
    //
    // For missionId filtering, we use in-memory comparison of the string ID
    // against cases.missionId.toString() — this avoids v.id() type complexity.
    const allCases = await ctx.db.query("cases").collect();

    // Build label lookup map (string key → case label)
    const caseLabels = new Map<string, string>(
      allCases.map((c) => [c._id.toString(), c.label])
    );

    // Build missionId lookup map (case string ID → mission string ID)
    // Used for in-memory missionId filtering below.
    const caseMissionId = new Map<string, string | undefined>(
      allCases.map((c) => [c._id.toString(), c.missionId?.toString()])
    );

    // ── Apply caseId / missionId filters ─────────────────────────────────
    //
    // When caseId is specified: keep only that case's waypoints.
    // When missionId is specified: keep only cases assigned to that mission
    //   (using the in-memory caseMissionId map built above — avoids index types).
    // When neither is specified: keep all cases.
    let filteredCaseIds: string[];
    if (args.caseId) {
      filteredCaseIds = waypointsByCase.has(args.caseId)
        ? [args.caseId]
        : [];
    } else if (args.missionId) {
      // In-memory filter: keep cases whose missionId matches
      filteredCaseIds = [...waypointsByCase.keys()].filter((id) =>
        caseMissionId.get(id) === args.missionId
      );
    } else {
      filteredCaseIds = [...waypointsByCase.keys()];
    }

    // ── Build CaseTrail objects ────────────────────────────────────────────
    //
    // For each case with waypoints, build a CaseTrail.
    // Sort by latestScan descending (most recently seen cases first).
    // Truncate long trails to MAX_WAYPOINTS_PER_CASE (keep most recent).
    const trails: CaseTrail[] = filteredCaseIds
      .filter((id) => (waypointsByCase.get(id)?.length ?? 0) > 0)
      .map((id) => {
        const allWaypoints = waypointsByCase.get(id)!;
        // Keep most recent waypoints if exceeding the per-case limit
        const waypoints =
          allWaypoints.length > MAX_WAYPOINTS_PER_CASE
            ? allWaypoints.slice(allWaypoints.length - MAX_WAYPOINTS_PER_CASE)
            : allWaypoints;

        const latestScan = waypoints[waypoints.length - 1]?.scannedAt ?? 0;
        const caseLabel = caseLabels.get(id) ?? id;

        return {
          caseId:        id,
          caseLabel,
          waypoints,
          latestScan,
          waypointCount: allWaypoints.length,
        };
      })
      // Sort: most recently active cases first
      .sort((a, b) => b.latestScan - a.latestScan)
      // Apply trail count limit
      .slice(0, maxTrails);

    const totalWaypoints = trails.reduce(
      (sum, t) => sum + t.waypoints.length,
      0
    );

    return {
      trails,
      totalWaypoints,
      trailCount: trails.length,
    };
  },
});

// ─── getHistoryTrailByCaseId — Single-case trail ──────────────────────────────

/**
 * Subscribe to the complete movement history for a single case.
 *
 * Used by the T5 CaseDetail panel to render a case-specific path map.
 * Returns a single CaseTrail (or null if the case has no georeferenced scans).
 *
 * Reactive to:
 *   • Any scan mutation that inserts a new row for this caseId.
 *
 * Client usage:
 *   const trail = useQuery(api.historyTrails.getHistoryTrailByCaseId, {
 *     caseId: "kj7abc123...",
 *   });
 */
export const getHistoryTrailByCaseId = query({
  args: {
    /** Convex case document ID. */
    caseId: v.id("cases"),
  },
  handler: async (ctx, args): Promise<CaseTrail | null> => {
    await requireAuth(ctx);

    // Load all scans for this case ordered by scannedAt ascending.
    // Using v.id("cases") for caseId allows the withIndex call to typecheck.
    const scans = await ctx.db
      .query("scans")
      .withIndex("by_case_scanned_at", (q) =>
        q.eq("caseId", args.caseId)
      )
      .order("asc")
      .collect();

    // Filter to scans with valid GPS coordinates
    const geoScans = scans.filter(
      (s) => s.lat !== undefined && s.lng !== undefined
    );

    if (geoScans.length === 0) return null;

    // Load case label via primary key lookup (O(1) with ctx.db.get)
    const caseDoc = await ctx.db.get(args.caseId);

    const waypoints: TrailWaypoint[] = geoScans.map((scan) => ({
      scanId:        scan._id.toString(),
      lat:           scan.lat!,
      lng:           scan.lng!,
      scannedAt:     scan.scannedAt,
      scannedByName: scan.scannedByName,
      scanContext:   scan.scanContext,
      locationName:  scan.locationName,
    }));

    const caseIdStr = args.caseId.toString();
    return {
      caseId:        caseIdStr,
      caseLabel:     caseDoc?.label ?? caseIdStr,
      waypoints,
      latestScan:    waypoints[waypoints.length - 1]!.scannedAt,
      waypointCount: geoScans.length,
    };
  },
});
