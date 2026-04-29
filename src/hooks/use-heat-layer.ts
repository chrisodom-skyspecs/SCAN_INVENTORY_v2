/**
 * src/hooks/use-heat-layer.ts
 *
 * useHeatLayer — Wires the INVENTORY map heat layer to the LayerEngine.
 *
 * Responsibilities
 * ────────────────
 * 1. Reads the `heat` layer visibility from the shared `LayerEngine` context.
 * 2. When the heat layer is active, subscribes to case pin data via
 *    `useMapCasePins` (Convex real-time subscription).
 * 3. Derives a GeoJSON FeatureCollection from the pin data for Mapbox GL JS.
 * 4. Returns a stable result object that the `HeatLayer` component consumes.
 *
 * Design decisions
 * ────────────────
 * • The Convex subscription is skipped (`skip: true`) when the heat layer
 *   is toggled off, avoiding unnecessary network traffic.
 * • GeoJSON conversion is memoised so the Mapbox GL source only re-ingests
 *   data when the underlying pin array actually changes.
 * • Flagged cases contribute weight 3 (vs. 1 for normal cases) to make
 *   damage/inspection hotspots visible even in sparse regions.
 *
 * Real-time fidelity
 * ──────────────────
 * Convex re-evaluates the underlying `getM1MapData` query within ~100–300 ms
 * of any SCAN app mutation that touches the cases table, satisfying the
 * ≤ 2-second real-time fidelity requirement between the SCAN app and the
 * INVENTORY dashboard.
 *
 * Dependencies
 * ────────────
 * Requires a `<LayerEngineProvider>` ancestor in the component tree.
 * `useSharedLayerEngine()` throws a descriptive error when no provider is found.
 *
 * Usage
 * ─────
 * @example
 * // Inside a component tree wrapped with LayerEngineProvider:
 * function MapCanvas() {
 *   const { geojsonData, isActive, isLoading } = useHeatLayer();
 *
 *   if (!isActive) return null;
 *
 *   return (
 *     <Source type="geojson" data={geojsonData}>
 *       <Layer type="heatmap" ... />
 *     </Source>
 *   );
 * }
 */

"use client";

import { useMemo } from "react";
import { useSharedLayerEngine } from "@/providers/layer-engine-provider";
import { useMapCasePins } from "./use-map-case-pins";
import { buildHeatGeoJSON, type HeatGeoJSON } from "@/lib/heat-layer-colors";

// ─── Args ─────────────────────────────────────────────────────────────────────

/**
 * Arguments for `useHeatLayer`.
 */
export interface UseHeatLayerArgs {
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
}

// ─── Return ───────────────────────────────────────────────────────────────────

/**
 * Return value of `useHeatLayer`.
 */
export interface UseHeatLayerResult {
  /**
   * Whether the `heat` layer is currently active in the LayerEngine.
   *
   * The `HeatLayer` component should return `null` when this is `false`
   * (no Mapbox source/layer should be added while the heat toggle is off).
   */
  isActive: boolean;

  /**
   * GeoJSON FeatureCollection of case locations for the Mapbox heatmap source.
   *
   * Each feature is a Point at the case's lat/lng with a `weight` property:
   *   • flagged cases → weight 3 (amplified contribution)
   *   • all other cases → weight 1 (normal contribution)
   *
   * Only includes cases with valid lat/lng coordinates.
   * Empty FeatureCollection while loading or when `isActive` is false.
   */
  geojsonData: HeatGeoJSON;

  /**
   * `true` while the Convex subscription is in flight (initial fetch).
   * Always `false` when `isActive` is false (subscription is skipped).
   */
  isLoading: boolean;

  /**
   * Number of case pins included in the heatmap.
   * Useful for displaying a count badge or placeholder message.
   */
  pointCount: number;
}

// ─── Empty GeoJSON constant ───────────────────────────────────────────────────

/**
 * Stable empty GeoJSON returned while loading or when the layer is inactive.
 * Defined at module scope so its reference identity is stable across renders,
 * preventing unnecessary Mapbox source re-ingestion.
 */
const EMPTY_GEOJSON: HeatGeoJSON = {
  type: "FeatureCollection",
  features: [],
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to heat layer data and wire it to the LayerEngine `heat` toggle.
 *
 * Returns a stable `UseHeatLayerResult` that changes reference only when
 * the heat toggle state or the underlying pin data changes.
 *
 * Must be called inside a `<LayerEngineProvider>` ancestor.
 *
 * @param args - Optional filters: missionId, assigneeId.
 */
export function useHeatLayer(
  args: UseHeatLayerArgs = {}
): UseHeatLayerResult {
  const { missionId, assigneeId } = args;

  // ── Layer engine state ────────────────────────────────────────────────────
  //
  // `state.heat` drives both the skip flag and the returned `isActive` field.
  // Using `state.heat` directly (rather than `isVisible("heat")`) is slightly
  // more efficient — it avoids an extra function call on every render.
  const { state } = useSharedLayerEngine();
  const isActive = state.heat;

  // ── Convex pin subscription ───────────────────────────────────────────────
  //
  // Skip the subscription when the heat layer is toggled off.
  // This avoids wasting Convex bandwidth when the overlay isn't visible.
  //
  // When the user re-enables the heat layer, `skip` becomes false and Convex
  // immediately starts delivering the current pin set (no manual refetch needed).
  const { pins, isLoading } = useMapCasePins({
    missionId:  missionId  ?? undefined,
    assigneeId: assigneeId ?? undefined,
    skip: !isActive,
  });

  // ── GeoJSON conversion ───────────────────────────────────────────────────
  //
  // Convert the raw pin array to a GeoJSON FeatureCollection.
  // Memoised against `pins` — only re-runs when Convex delivers a new array.
  //
  // When loading or inactive, `pins` is [] (from useMapCasePins skip semantics),
  // so `buildHeatGeoJSON` returns an empty FeatureCollection on first render.
  // We use the stable EMPTY_GEOJSON constant when pins is empty to keep
  // the Mapbox source reference stable across renders.
  const geojsonData = useMemo<HeatGeoJSON>(() => {
    if (pins.length === 0) return EMPTY_GEOJSON;
    return buildHeatGeoJSON(pins);
  }, [pins]);

  // ── Derived: point count ──────────────────────────────────────────────────

  const pointCount = geojsonData.features.length;

  return {
    isActive,
    geojsonData,
    isLoading,
    pointCount,
  };
}
