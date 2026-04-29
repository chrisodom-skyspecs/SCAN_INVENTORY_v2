/**
 * src/hooks/use-turbine-layer.ts
 *
 * useTurbineLayer — Wires the INVENTORY map turbines overlay layer to the LayerEngine.
 *
 * Responsibilities
 * ────────────────
 * 1. Reads the `turbines` layer visibility from the shared `LayerEngine` context.
 * 2. When the turbines layer is active, subscribes to turbine location data via
 *    `api.turbines.getTurbineLocations` (Convex real-time subscription).
 * 3. When inactive, skips the subscription — no network traffic.
 * 4. Converts the raw turbine records into a GeoJSON FeatureCollection of
 *    Point features for Mapbox GL rendering.
 * 5. Returns a stable result object that the `TurbineLayer` component consumes.
 *
 * GeoJSON structure
 * ─────────────────
 * Point features (one per turbine):
 *   geometry: Point at [lng, lat]
 *   properties: {
 *     turbineId, name, status, siteCode, missionId,
 *     hubHeight, rotorDiameter, notes
 *   }
 *
 * The `status` property drives the per-marker color expression in Mapbox GL:
 *   "active"         → lime (--layer-turbines-bg)
 *   "inactive"       → muted lime (lighter opacity)
 *   "decommissioned" → neutral gray
 *
 * Design decisions
 * ────────────────
 * • The Convex subscription is skipped (`skip: true`) when the turbines layer is
 *   toggled off — no network traffic when the overlay is not visible.
 * • GeoJSON conversion is memoised so Mapbox GL only re-ingests data when the
 *   underlying turbine array actually changes.
 * • The stable empty FeatureCollection constant is returned while loading or
 *   inactive so Mapbox GL doesn't receive undefined data.
 *
 * Real-time fidelity
 * ──────────────────
 * Convex re-evaluates `getTurbineLocations` within ~100–300 ms of any mutation
 * that inserts, updates, or deletes a turbine record, satisfying the ≤ 2-second
 * real-time fidelity requirement.
 *
 * Dependencies
 * ────────────
 * Requires a `<LayerEngineProvider>` ancestor in the component tree.
 * `useSharedLayerEngine()` throws a descriptive error when no provider is found.
 *
 * Usage
 * ─────
 * @example
 * function TurbineLayer() {
 *   const { isActive, turbinesGeoJSON, isLoading } = useTurbineLayer();
 *   if (!isActive) return null;
 *
 *   return (
 *     <Source type="geojson" data={turbinesGeoJSON}>
 *       <Layer type="circle" ... />
 *     </Source>
 *   );
 * }
 */

"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSharedLayerEngine } from "@/providers/layer-engine-provider";

// ─── GeoJSON types ────────────────────────────────────────────────────────────

/** GeoJSON FeatureCollection of Point features — one per turbine location. */
export interface TurbinesGeoJSON {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "Point";
      coordinates: [number, number];  // [lng, lat]
    };
    properties: {
      /** Convex turbine document ID (string). */
      turbineId: string;
      /** Turbine display name, e.g. "T-042". */
      name: string;
      /**
       * Operational status — drives marker color in Mapbox GL paint expressions:
       *   "active"         → lime (--layer-turbines-bg)
       *   "inactive"       → subdued lime
       *   "decommissioned" → neutral gray
       */
      status: "active" | "inactive" | "decommissioned";
      /** Short site code for grouping (optional). */
      siteCode: string;
      /** Linked mission ID (optional). */
      missionId: string;
      /** Hub height in meters (optional, shown in tooltip). */
      hubHeight: number | null;
      /** Rotor diameter in meters (optional, shown in tooltip). */
      rotorDiameter: number | null;
      /** Operator notes (optional, shown in tooltip). */
      notes: string;
    };
  }>;
}

// ─── Args ─────────────────────────────────────────────────────────────────────

/**
 * Arguments for `useTurbineLayer`.
 */
export interface UseTurbineLayerArgs {
  /**
   * Filter turbines to a specific mission (matches the `org` URL param / missionId).
   * Omit or `null` for a fleet-wide turbine overlay.
   */
  missionId?: string | null;
}

// ─── Return ───────────────────────────────────────────────────────────────────

/**
 * Return value of `useTurbineLayer`.
 */
export interface UseTurbineLayerResult {
  /**
   * Whether the `turbines` layer is currently active in the LayerEngine.
   *
   * The `TurbineLayer` component should return null when this is false
   * (no Mapbox source/layer should be added while the turbines toggle is off).
   */
  isActive: boolean;

  /**
   * GeoJSON FeatureCollection of Point features — one per turbine location.
   *
   * Stable empty FeatureCollection while loading or inactive.
   * Only updates reference identity when the underlying turbine data changes.
   */
  turbinesGeoJSON: TurbinesGeoJSON;

  /**
   * `true` while the Convex subscription is in flight (initial fetch).
   * Always `false` when `isActive` is false (subscription is skipped).
   */
  isLoading: boolean;

  /**
   * Total number of turbine records in the current result set.
   */
  turbineCount: number;

  /**
   * Number of turbines with status = "active".
   */
  activeCount: number;
}

// ─── Stable empty GeoJSON constant ───────────────────────────────────────────

/**
 * Stable empty turbines GeoJSON — returned while loading or inactive.
 * Module-scope constant keeps reference stable across renders, preventing
 * unnecessary Mapbox GL source re-ingestion.
 */
const EMPTY_TURBINES_GEOJSON: TurbinesGeoJSON = {
  type: "FeatureCollection",
  features: [],
};

// ─── GeoJSON builder (pure function — testable without React) ─────────────────

/**
 * Turbine record shape from the Convex query.
 * Mirrors convex/turbines.ts TurbineLocation interface.
 */
interface TurbineRecord {
  turbineId: string;
  name: string;
  lat: number;
  lng: number;
  status: "active" | "inactive" | "decommissioned";
  siteCode?: string;
  missionId?: string;
  hubHeight?: number;
  rotorDiameter?: number;
  notes?: string;
}

/**
 * Convert raw turbine records from Convex into a GeoJSON FeatureCollection.
 *
 * Returns a FeatureCollection of Point features — one per turbine.
 * Each feature carries the turbine's status and metadata in its `properties`
 * so Mapbox GL paint expressions can drive marker color by status.
 *
 * @param turbines - TurbineLocation array from Convex getTurbineLocations.
 * @returns GeoJSON FeatureCollection of turbine Point features.
 */
export function buildTurbinesGeoJSON(turbines: TurbineRecord[]): TurbinesGeoJSON {
  if (turbines.length === 0) {
    return EMPTY_TURBINES_GEOJSON;
  }

  const features: TurbinesGeoJSON["features"] = turbines.map((t) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [t.lng, t.lat],  // GeoJSON uses [lng, lat] order
    },
    properties: {
      turbineId:     t.turbineId,
      name:          t.name,
      status:        t.status,
      siteCode:      t.siteCode   ?? "",
      missionId:     t.missionId  ?? "",
      hubHeight:     t.hubHeight  ?? null,
      rotorDiameter: t.rotorDiameter ?? null,
      notes:         t.notes      ?? "",
    },
  }));

  return {
    type: "FeatureCollection",
    features,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to turbine location data and wire it to the LayerEngine `turbines` toggle.
 *
 * Returns a stable GeoJSON FeatureCollection that only changes reference when
 * the turbines toggle state or the underlying turbine data changes.
 *
 * Must be called inside a `<LayerEngineProvider>` ancestor.
 *
 * @param args - Optional filters: missionId.
 */
export function useTurbineLayer(
  args: UseTurbineLayerArgs = {}
): UseTurbineLayerResult {
  const { missionId } = args;

  // ── Layer engine state ────────────────────────────────────────────────────
  //
  // `state.turbines` drives both the skip flag and the returned `isActive` field.
  const { state } = useSharedLayerEngine();
  const isActive = state.turbines;

  // ── Convex subscription ───────────────────────────────────────────────────
  //
  // The "skip" sentinel suspends the subscription when the layer is toggled off.
  // When the user re-enables the turbines layer, Convex immediately starts
  // delivering the current turbine set (no manual refetch needed).
  //
  // NOTE: `api.turbines` may not yet appear in the generated types if the
  // Convex CLI has not re-run since turbines.ts was added.  We cast through
  // `unknown as Record<string, any>` to handle stale generated types safely —
  // the runtime query path ("turbines.getTurbineLocations") is authoritative.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiAny = api as unknown as Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getTurbineLocationsQuery = apiAny["turbines"]?.["getTurbineLocations"] as any;

  const queryArgs = isActive
    ? {
        ...(missionId ? { missionId } : {}),
      }
    : "skip";

  const result = useQuery(getTurbineLocationsQuery, queryArgs);

  // ── Derive loading state ──────────────────────────────────────────────────
  //
  // `result === undefined` means the initial Convex fetch is in flight.
  // When skipped (layer inactive), result is always undefined but isLoading = false.
  const isLoading = isActive && result === undefined;

  // ── Build GeoJSON ─────────────────────────────────────────────────────────
  //
  // Memoised against `result` so Mapbox GL doesn't re-ingest unchanged data.
  // When loading or inactive, use the stable empty constant.
  const turbinesGeoJSON = useMemo((): TurbinesGeoJSON => {
    if (!result || result.turbines.length === 0) {
      return EMPTY_TURBINES_GEOJSON;
    }
    return buildTurbinesGeoJSON(result.turbines);
  }, [result]);

  return {
    isActive,
    turbinesGeoJSON,
    isLoading,
    turbineCount: result?.turbineCount ?? 0,
    activeCount:  result?.activeCount  ?? 0,
  };
}
