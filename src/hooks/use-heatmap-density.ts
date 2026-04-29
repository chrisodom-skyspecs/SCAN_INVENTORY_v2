/**
 * src/hooks/use-heatmap-density.ts
 *
 * useHeatmapDensity — real-time heat map density data hook.
 *
 * Wraps the dedicated `convex/heatmapData.getHeatmapPins` Convex query for
 * the INVENTORY map M2 Activity Density heat overlay.  Unlike `useMapCasePins`
 * (which serves M1 fleet overview), this hook is purpose-built for the heat
 * layer and returns only the fields the heatmap rendering needs.
 *
 * Two modes
 * ─────────
 * 1. Individual-pin mode (default, `aggregate: false`):
 *    Returns one data point per case location.  Preferred for normal fleet
 *    sizes (≤ 5,000 cases).  Mapbox GL JS receives a GeoJSON FeatureCollection
 *    with one Point feature per case, weighted by case status.
 *
 * 2. Grid aggregation mode (`aggregate: true`):
 *    Returns one data point per 0.5° geographic grid cell.  Used for large
 *    fleets where individual-pin rendering degrades performance.  Mapbox GL JS
 *    receives far fewer features but still produces a smooth density heatmap
 *    because the weight drives the Mapbox heatmap-weight expression.
 *
 * GeoJSON output
 * ──────────────
 * Both modes produce a HeatGeoJSON FeatureCollection compatible with
 * `<Source type="geojson" data={geojsonData}>` in react-map-gl.
 * Individual features carry a `weight` property:
 *   • Pin mode:  weight ∈ {1, 3}  (1 = normal, 3 = flagged)
 *   • Grid mode: weight ∈ [1, 10] (bounded by maxWeight cap in the query)
 *
 * Skip semantics
 * ──────────────
 * Pass `skip: true` to suspend the Convex subscription when the heat layer is
 * toggled off.  While skipped: `isLoading = false`, `geojsonData = empty`.
 *
 * Real-time fidelity
 * ──────────────────
 * Convex re-evaluates `getHeatmapPins` within ~100–300 ms of any case row
 * mutation (status, lat, lng changes), satisfying the ≤ 2-second real-time
 * fidelity requirement between the SCAN app and the INVENTORY dashboard.
 *
 * Usage
 * ─────
 * @example
 * // Basic usage — individual pins, no filter
 * const { geojsonData, isLoading, pointCount } = useHeatmapDensity();
 *
 * @example
 * // Filtered to a mission, skip when heat layer is off
 * const { geojsonData, pointCount } = useHeatmapDensity({
 *   missionId: activeMissionId,
 *   skip: !state.heat,
 * });
 *
 * @example
 * // Grid aggregation for large fleets
 * const { geojsonData } = useHeatmapDensity({
 *   aggregate: true,
 *   skip: !state.heat,
 * });
 */

"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type {
  HeatmapPinsResponse,
  HeatmapGridResponse,
} from "../../convex/heatmapData";
import type { HeatGeoJSON, HeatFeature } from "@/lib/heat-layer-colors";

// ─── Args ─────────────────────────────────────────────────────────────────────

/**
 * Arguments for `useHeatmapDensity`.
 */
export interface UseHeatmapDensityArgs {
  /**
   * Filter heat data to cases on a specific mission (Convex mission document ID).
   * Omit or `null` for a global (all-missions) heat overlay.
   */
  missionId?: string | null;

  /**
   * Filter heat data to cases assigned to a specific technician (Kinde user ID).
   * Omit or `null` for all assignees.
   */
  assigneeId?: string | null;

  /**
   * Use geographic grid aggregation instead of individual pins.
   * Recommended for fleets > 5,000 cases.
   * @default false
   */
  aggregate?: boolean;

  /**
   * Maximum per-cell weight in aggregate mode (passed to Convex query).
   * @default 10
   */
  maxWeight?: number;

  /**
   * When `true`, suspend the Convex subscription.
   * Returns `{ geojsonData: empty, isLoading: false, pointCount: 0 }`.
   * Use this when the heat layer toggle is OFF so no network traffic is incurred.
   * @default false
   */
  skip?: boolean;
}

// ─── Return ───────────────────────────────────────────────────────────────────

/**
 * Return value of `useHeatmapDensity`.
 */
export interface UseHeatmapDensityResult {
  /**
   * GeoJSON FeatureCollection of heat data points for the Mapbox heatmap source.
   *
   * Each feature is a Point with a `weight` property:
   *   • Pin mode:  weight ∈ {1, 3}
   *   • Grid mode: weight ∈ [1, 10]
   *
   * Empty FeatureCollection while loading or when `skip` is true.
   */
  geojsonData: HeatGeoJSON;

  /**
   * `true` while the initial Convex fetch is in flight.
   * Always `false` when `skip` is true.
   */
  isLoading: boolean;

  /**
   * Number of GeoJSON features in the collection.
   * In pin mode: one feature per case.
   * In grid mode: one feature per non-empty geographic cell.
   */
  pointCount: number;

  /**
   * Total weight of all features in the collection.
   * Useful for displaying a "total activity" metric alongside the map.
   */
  totalWeight: number;

  /**
   * (Pin mode only) Number of flagged cases contributing weight-3 amplification.
   * `undefined` in grid mode.
   */
  flaggedCount: number | undefined;
}

// ─── Empty GeoJSON constant ───────────────────────────────────────────────────

/**
 * Stable empty GeoJSON for the "inactive" state.
 * Module-scope so its reference identity is stable — prevents Mapbox from
 * re-ingesting the source on every render when the heat layer is off.
 */
const EMPTY_GEOJSON: HeatGeoJSON = {
  type: "FeatureCollection",
  features: [],
};

// ─── GeoJSON converters ───────────────────────────────────────────────────────

/**
 * Convert a HeatmapPinsResponse into a GeoJSON FeatureCollection.
 *
 * Each pin becomes one Point feature with:
 *   • geometry.coordinates: [lng, lat]
 *   • properties.weight:    1 or 3
 *   • properties.caseId:    Convex document ID (string)
 */
function pinsResponseToGeoJSON(response: HeatmapPinsResponse): HeatGeoJSON {
  const features: HeatFeature[] = response.pins.map((pin) => ({
    type: "Feature",
    properties: {
      weight: pin.weight,
      caseId: pin.caseId,
    },
    geometry: {
      type: "Point",
      coordinates: [pin.lng, pin.lat],
    },
  }));
  return { type: "FeatureCollection", features };
}

/**
 * Convert a HeatmapGridResponse into a GeoJSON FeatureCollection.
 *
 * Each grid cell becomes one Point feature at the cell centroid with:
 *   • geometry.coordinates: [lng, lat]  (cell center, not average of cases)
 *   • properties.weight:    1–10 (bounded combined weight)
 *   • properties.caseId:    cellId (used as stable feature ID)
 */
function gridResponseToGeoJSON(response: HeatmapGridResponse): HeatGeoJSON {
  const features: HeatFeature[] = response.cells.map((cell) => ({
    type: "Feature",
    properties: {
      weight: cell.weight,
      caseId: cell.cellId,
    },
    geometry: {
      type: "Point",
      coordinates: [cell.lng, cell.lat],
    },
  }));
  return { type: "FeatureCollection", features };
}

/**
 * Convert a Convex heatmap response to GeoJSON.
 * Returns EMPTY_GEOJSON for null/undefined input.
 */
function responseToGeoJSON(
  response: HeatmapPinsResponse | HeatmapGridResponse | null | undefined
): HeatGeoJSON {
  if (!response) return EMPTY_GEOJSON;
  if (response.mode === "pins") return pinsResponseToGeoJSON(response as HeatmapPinsResponse);
  if (response.mode === "grid") return gridResponseToGeoJSON(response as HeatmapGridResponse);
  return EMPTY_GEOJSON;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to real-time heat map density data from Convex.
 *
 * Uses the dedicated `api.heatmapData.getHeatmapPins` query — a purpose-built
 * endpoint that returns only the fields needed for heat layer rendering.
 *
 * When `skip` is true (heat layer toggled off), no Convex subscription is
 * active and the stable EMPTY_GEOJSON constant is returned — no network cost.
 *
 * @param args - Filter and mode options.
 * @returns `{ geojsonData, isLoading, pointCount, totalWeight, flaggedCount }`.
 */
export function useHeatmapDensity(
  args: UseHeatmapDensityArgs = {}
): UseHeatmapDensityResult {
  const {
    missionId,
    assigneeId,
    aggregate = false,
    maxWeight = 10,
    skip = false,
  } = args;

  // ── Convex subscription ───────────────────────────────────────────────────
  //
  // Build a minimal args object — only include defined optional filters so
  // the serialised query args remain cache-friendly.
  // `skip` sentinel suspends the subscription entirely when heat is off.
  const queryArgs = skip
    ? ("skip" as const)
    : {
        ...(missionId  ? { missionId }  : {}),
        ...(assigneeId ? { assigneeId } : {}),
        aggregate,
        ...(aggregate && maxWeight !== 10 ? { maxWeight } : {}),
      };

  const result = useQuery(
    // Cast needed because the generated api types may lag behind the actual
    // convex/heatmapData.ts export.  The runtime will correctly resolve this
    // to the getHeatmapPins handler once the Convex dev server regenerates.
    (api as unknown as Record<string, any>).heatmapData?.getHeatmapPins,
    queryArgs
  );

  // ── GeoJSON conversion ────────────────────────────────────────────────────
  //
  // useMemo is always called (hooks rules — no conditionals before it).
  // When `skip` is true, `result` is always undefined, so we return EMPTY_GEOJSON.
  const geojsonData = useMemo<HeatGeoJSON>(
    () => responseToGeoJSON(result as HeatmapPinsResponse | HeatmapGridResponse | null | undefined),
    [result]
  );

  // ── Skip / loading state ──────────────────────────────────────────────────

  if (skip) {
    return {
      geojsonData:  EMPTY_GEOJSON,
      isLoading:    false,
      pointCount:   0,
      totalWeight:  0,
      flaggedCount: undefined,
    };
  }

  const isLoading = result === undefined;

  // ── Derived metrics ───────────────────────────────────────────────────────

  const pointCount  = geojsonData.features.length;
  const totalWeight = result ? result.totalWeight : 0;
  const flaggedCount =
    result && result.mode === "pins"
      ? (result as HeatmapPinsResponse).flaggedCount
      : undefined;

  return {
    geojsonData,
    isLoading,
    pointCount,
    totalWeight,
    flaggedCount,
  };
}
