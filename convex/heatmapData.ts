/**
 * convex/heatmapData.ts
 *
 * Dedicated Convex query for heat map density data.
 *
 * This module provides a purpose-built query (`getHeatmapPins`) for the
 * INVENTORY map M2 Activity Density heat overlay.  It is distinct from
 * getM1MapData — it returns only the fields the heat layer needs (id, lat,
 * lng, status, updatedAt) with zero overhead from fields the heat layer
 * doesn't use (assignee, location name, etc.).
 *
 * Architecture
 * ────────────
 * The heat layer renders a Mapbox GL JS density heatmap over case locations.
 * The data source must be:
 *   1. Real-time: Convex pushes updates within ~100–300 ms of any case change.
 *   2. Lightweight: only lat/lng/status are needed — nothing else.
 *   3. Filterable: can be scoped to a missionId or assigneeId.
 *   4. Weighted: flagged cases contribute more to density (weight: 3) vs normal (weight: 1).
 *
 * The `weight` field is derived server-side to reduce client-side work per
 * subscription update.  Flagged cases (status === "flagged") receive weight 3;
 * all other cases receive weight 1.
 *
 * GeoGrid aggregation
 * ───────────────────
 * When `aggregate: true` is passed, the query returns geographic grid cells
 * (lat/lng bins) with an aggregated point count and combined weight instead of
 * individual pins.  This is significantly faster to render for large fleets
 * (> 5,000 cases) because Mapbox GL JS processes far fewer source features.
 *
 * Grid resolution is fixed at 0.5° lat × 0.5° lng cells.  This produces ~720
 * distinct cells world-wide, ensuring O(1) GeoJSON feature count regardless
 * of fleet size.  Individual-pin mode is the default and preferred for fleets
 * ≤ 5,000 cases (which is the expected SkySpecs fleet size).
 *
 * Real-time fidelity
 * ──────────────────
 * Convex re-evaluates the subscription within ~100–300 ms of any case row
 * mutation:
 *   • scan.scanCheckIn: changes status, lat, lng → re-weights all affected cells
 *   • shipping.shipCase: changes lat/lng to origin of shipment → cell shifts
 *   • custody.transferCustody: updates assigneeId → may re-filter with assigneeId arg
 *   • Any damage report: may toggle status to "flagged" → weight 1 → 3
 *
 * Client usage
 * ────────────
 * Use the companion hook `useHeatmapDensity` in src/hooks/use-heatmap-density.ts:
 *
 *   const { pins, isLoading, totalWeight } = useHeatmapDensity({
 *     missionId: selectedMissionId,
 *     skip: !heatLayerActive,
 *   });
 *
 *   // With aggregation (for large fleets):
 *   const { pins, isLoading } = useHeatmapDensity({
 *     aggregate: true,
 *     skip: !heatLayerActive,
 *   });
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Auth, UserIdentity } from "convex/server";

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

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Weight multiplier for flagged cases on the heat density overlay.
 * Flagged cases represent active damage or inspection issues — they should
 * appear as hotspots even in regions with few cases.
 */
const FLAGGED_WEIGHT = 3;

/**
 * Default weight for all non-flagged cases.
 */
const DEFAULT_WEIGHT = 1;

/**
 * Grid resolution for geographic aggregation.
 * 0.5 degrees ≈ ~55 km at the equator — sufficient resolution to show
 * regional activity patterns without individual-case precision.
 */
const GRID_RESOLUTION = 0.5;

// ─── Response types ───────────────────────────────────────────────────────────

/**
 * A single heat map data point: one case location with its density weight.
 *
 * The `weight` field encodes the case's contribution to the heatmap density:
 *   • 1 for all non-flagged statuses (normal density contribution)
 *   • 3 for "flagged" status (3× density contribution)
 */
export interface HeatmapPin {
  /** Convex document ID of the case (string form). */
  caseId: string;
  /** WGS-84 latitude. */
  lat: number;
  /** WGS-84 longitude. */
  lng: number;
  /** Case lifecycle status. */
  status: string;
  /**
   * Density weight for Mapbox heatmap-weight expression.
   * 1 = normal, 3 = flagged (hotspot amplification).
   */
  weight: number;
  /** Epoch ms timestamp of the last update to this case record. */
  updatedAt: number;
}

/**
 * An aggregated geographic grid cell for large-fleet rendering.
 *
 * Used when `aggregate: true` is passed to the query.  Each cell represents
 * a 0.5° × 0.5° geographic bin containing one or more cases.
 */
export interface HeatmapGridCell {
  /**
   * Stable cell identifier: `"lat:lng"` at GRID_RESOLUTION precision.
   * e.g. "40.5:-74.0" for a cell near New York.
   */
  cellId: string;
  /** Cell centroid latitude (bin center, not average of cases). */
  lat: number;
  /** Cell centroid longitude (bin center, not average of cases). */
  lng: number;
  /** Total number of cases in this cell. */
  count: number;
  /**
   * Combined weight for the Mapbox heatmap-weight expression.
   * Sum of all case weights in the cell (flagged = 3, others = 1).
   * Capped at 10 to prevent single-cell dominance in dense regions.
   */
  weight: number;
}

/**
 * Response from getHeatmapPins (individual-pin mode, the default).
 */
export interface HeatmapPinsResponse {
  mode: "pins";
  /** All case pins with valid lat/lng and their weights. */
  pins: HeatmapPin[];
  /** Total combined weight of all pins (sum of all case weights). */
  totalWeight: number;
  /** Count of flagged cases contributing weight-3 amplification. */
  flaggedCount: number;
  /** Count of non-flagged cases contributing weight-1. */
  normalCount: number;
}

/**
 * Response from getHeatmapPins (aggregate/grid mode).
 */
export interface HeatmapGridResponse {
  mode: "grid";
  /** Aggregated geographic grid cells. */
  cells: HeatmapGridCell[];
  /** Total combined weight across all cells. */
  totalWeight: number;
  /** Total number of cases included in the grid. */
  totalCases: number;
}

/** Union response type for getHeatmapPins. */
export type HeatmapResponse = HeatmapPinsResponse | HeatmapGridResponse;

// ─── Grid helpers ─────────────────────────────────────────────────────────────

/**
 * Snap a coordinate to the nearest grid cell boundary.
 * Grid cells start at 0,0 and increment by GRID_RESOLUTION.
 */
function snapToGrid(value: number): number {
  return Math.floor(value / GRID_RESOLUTION) * GRID_RESOLUTION;
}

/**
 * Build a stable string cell ID from snapped lat/lng.
 */
function makeCellId(snappedLat: number, snappedLng: number): string {
  return `${snappedLat.toFixed(1)}:${snappedLng.toFixed(1)}`;
}

// ─── getHeatmapPins ───────────────────────────────────────────────────────────

/**
 * Subscribe to heat map density pin data.
 *
 * Returns case pins (or aggregated grid cells when aggregate: true) for the
 * INVENTORY map M2 Activity Density heat overlay.
 *
 * Only cases with valid lat/lng coordinates are included.  Cases without a
 * location do not contribute to the heat overlay.
 *
 * Reactive to:
 *   • Any mutation that changes `cases.lat`, `cases.lng`, or `cases.status`
 *     (scan.scanCheckIn, shipping.shipCase, custody.transferCustody)
 *   → Convex re-evaluates within ~100–300 ms, satisfying the ≤ 2-second
 *     real-time fidelity requirement between SCAN app and INVENTORY dashboard.
 *
 * @param missionId  - Optional: filter to cases on a specific mission.
 * @param assigneeId - Optional: filter to cases assigned to a specific user.
 * @param aggregate  - When true: return aggregated grid cells instead of pins.
 *                     Default: false (individual pins, preferred for ≤ 5,000 cases).
 * @param maxWeight  - Cap on per-cell weight in aggregate mode (default: 10).
 *
 * Client usage:
 *   const data = useQuery(api.heatmapData.getHeatmapPins, {});
 *   const data = useQuery(api.heatmapData.getHeatmapPins, {
 *     missionId: "mission-abc",
 *     aggregate: false,
 *   });
 */
export const getHeatmapPins = query({
  args: {
    /** Filter to cases on a specific mission (Convex mission document ID). */
    missionId: v.optional(v.string()),
    /** Filter to cases assigned to a specific technician (Kinde user ID). */
    assigneeId: v.optional(v.string()),
    /**
     * Return geographic grid cells instead of individual pins.
     * Use for large fleets (> 5,000 cases) to improve rendering performance.
     * @default false
     */
    aggregate: v.optional(v.boolean()),
    /**
     * Maximum per-cell weight in aggregate mode.
     * Prevents a single dense cell from dominating the entire heatmap.
     * @default 10
     */
    maxWeight: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<HeatmapResponse> => {
    await requireAuth(ctx);

    const { missionId, assigneeId, aggregate = false, maxWeight = 10 } = args;

    // ── Load cases ────────────────────────────────────────────────────────────
    //
    // Use the by_updated index so Convex can efficiently track changes:
    // Any case update (status change, location update) invalidates this
    // subscription and pushes a new result within ~100–300 ms.
    let allCases = await ctx.db
      .query("cases")
      .withIndex("by_updated")
      .order("desc")
      .collect();

    // ── Apply filters ─────────────────────────────────────────────────────────
    //
    // Use toString() for Convex ID comparisons to handle branded Id types.
    // Convex IDs are opaque string-like values that must be compared via toString().

    if (missionId) {
      allCases = allCases.filter(
        (c) => c.missionId?.toString() === missionId
      );
    }

    if (assigneeId) {
      allCases = allCases.filter((c) => c.assigneeId === assigneeId);
    }

    // ── Filter to cases with valid coordinates ────────────────────────────────
    //
    // Only cases with both lat AND lng contribute to the heat overlay.
    // Cases without coordinates are excluded (they have no map position).
    const locatedCases = allCases.filter(
      (c) =>
        c.lat !== undefined &&
        c.lat !== null &&
        c.lng !== undefined &&
        c.lng !== null
    ) as Array<typeof allCases[0] & { lat: number; lng: number }>;

    // ── Individual-pin mode (default) ─────────────────────────────────────────

    if (!aggregate) {
      const pins: HeatmapPin[] = locatedCases.map((c) => ({
        caseId:    c._id.toString(),
        lat:       c.lat,
        lng:       c.lng,
        status:    c.status,
        weight:    c.status === "flagged" ? FLAGGED_WEIGHT : DEFAULT_WEIGHT,
        updatedAt: c.updatedAt,
      }));

      const flaggedCount = pins.filter((p) => p.weight === FLAGGED_WEIGHT).length;
      const normalCount  = pins.length - flaggedCount;
      const totalWeight  = pins.reduce((sum, p) => sum + p.weight, 0);

      return {
        mode: "pins",
        pins,
        totalWeight,
        flaggedCount,
        normalCount,
      };
    }

    // ── Grid aggregation mode ─────────────────────────────────────────────────
    //
    // Aggregate cases into geographic grid cells.  Each cell accumulates the
    // combined weight of all cases whose snapped lat/lng falls in that cell.
    // The weight is capped at `maxWeight` to prevent hot-spot dominance.

    const cellMap = new Map<string, HeatmapGridCell>();

    for (const c of locatedCases) {
      const snappedLat = snapToGrid(c.lat);
      const snappedLng = snapToGrid(c.lng);
      const cellId = makeCellId(snappedLat, snappedLng);
      const caseWeight = c.status === "flagged" ? FLAGGED_WEIGHT : DEFAULT_WEIGHT;

      const existing = cellMap.get(cellId);
      if (existing) {
        existing.count  += 1;
        existing.weight  = Math.min(existing.weight + caseWeight, maxWeight);
      } else {
        cellMap.set(cellId, {
          cellId,
          // Cell centroid: center of the 0.5° bin
          lat:    snappedLat + GRID_RESOLUTION / 2,
          lng:    snappedLng + GRID_RESOLUTION / 2,
          count:  1,
          weight: caseWeight,
        });
      }
    }

    const cells = Array.from(cellMap.values());
    const totalWeight = cells.reduce((sum, cell) => sum + cell.weight, 0);
    const totalCases  = cells.reduce((sum, cell) => sum + cell.count, 0);

    return {
      mode: "grid",
      cells,
      totalWeight,
      totalCases,
    };
  },
});
