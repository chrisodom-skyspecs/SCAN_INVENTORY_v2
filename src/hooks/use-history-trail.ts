/**
 * src/hooks/use-history-trail.ts
 *
 * useHistoryTrail — Wires the INVENTORY map history trails layer to the LayerEngine.
 *
 * Responsibilities
 * ────────────────
 * 1. Reads the `history` layer visibility from the shared `LayerEngine` context.
 * 2. When the history layer is active, subscribes to case movement history via
 *    `api.historyTrails.getHistoryTrails` (Convex real-time subscription).
 * 3. Derives GeoJSON FeatureCollections from the trail data:
 *      - LineString features: one per case trail (path lines)
 *      - Point features:      one per scan waypoint (position markers)
 * 4. Returns a stable result object that the `HistoryTrailLayer` component consumes.
 *
 * GeoJSON structure
 * ─────────────────
 * Line features (for the path lines source):
 *   geometry: LineString with coordinates [[lng, lat], ...]
 *   properties: { caseId, caseLabel, waypointCount, latestScan, color }
 *
 * Point features (for the waypoint markers source):
 *   geometry: Point at [lng, lat]
 *   properties: { caseId, caseLabel, scannedAt, scannedByName, scanContext,
 *                 locationName, isFirst, isLast }
 *
 * Design decisions
 * ────────────────
 * • The Convex subscription is skipped (`skip: true`) when the history layer
 *   is toggled off — no network traffic when the overlay is not visible.
 * • GeoJSON conversion is memoised so the Mapbox GL source only re-ingests data
 *   when the underlying trail array actually changes.
 * • Trails with only one waypoint are included as Point + degenerate LineString
 *   (single-coordinate LineString) so a dot appears at the single scan location.
 * • Trail colors cycle through a palette derived from the case label for visual
 *   distinction between overlapping trails.
 *
 * Real-time fidelity
 * ──────────────────
 * Convex re-evaluates the underlying `getHistoryTrails` query within ~100–300 ms
 * of any SCAN app scan that inserts a new row into the `scans` table, satisfying
 * the ≤ 2-second real-time fidelity requirement.
 *
 * Dependencies
 * ────────────
 * Requires a `<LayerEngineProvider>` ancestor in the component tree.
 * `useSharedLayerEngine()` throws a descriptive error when no provider is found.
 *
 * Usage
 * ─────
 * @example
 * function HistoryTrailLayer() {
 *   const { isActive, linesGeoJSON, pointsGeoJSON, isLoading } = useHistoryTrail();
 *   if (!isActive) return null;
 *
 *   return (
 *     <>
 *       <Source type="geojson" data={linesGeoJSON}>
 *         <Layer type="line" ... />
 *       </Source>
 *       <Source type="geojson" data={pointsGeoJSON}>
 *         <Layer type="circle" ... />
 *       </Source>
 *     </>
 *   );
 * }
 */

"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSharedLayerEngine } from "@/providers/layer-engine-provider";

// ─── GeoJSON types ────────────────────────────────────────────────────────────

/** GeoJSON FeatureCollection of LineString features (one per case trail). */
export interface TrailLinesGeoJSON {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "LineString";
      coordinates: [number, number][];
    };
    properties: {
      caseId: string;
      caseLabel: string;
      waypointCount: number;
      latestScan: number;
    };
  }>;
}

/** GeoJSON FeatureCollection of Point features (one per scan waypoint). */
export interface TrailPointsGeoJSON {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
    properties: {
      caseId: string;
      caseLabel: string;
      scannedAt: number;
      scannedByName: string;
      scanContext: string;
      locationName: string;
      /** true for the oldest waypoint in the trail (origin marker). */
      isFirst: boolean;
      /** true for the most recent waypoint in the trail (current marker). */
      isLast: boolean;
    };
  }>;
}

// ─── Args ─────────────────────────────────────────────────────────────────────

/**
 * Arguments for `useHistoryTrail`.
 */
export interface UseHistoryTrailArgs {
  /**
   * Filter history to cases on a specific mission (Convex mission document ID).
   * Omit or `null` for a fleet-wide history overlay.
   */
  missionId?: string | null;

  /**
   * Only include waypoints after this epoch ms timestamp.
   * Use to show "last 24 hours" or "last 7 days" movement.
   * Omit to include all history.
   */
  since?: number | null;
}

// ─── Return ───────────────────────────────────────────────────────────────────

/**
 * Return value of `useHistoryTrail`.
 */
export interface UseHistoryTrailResult {
  /**
   * Whether the `history` layer is currently active in the LayerEngine.
   *
   * The `HistoryTrailLayer` component should return `null` when this is `false`
   * (no Mapbox source/layer should be added while the history toggle is off).
   */
  isActive: boolean;

  /**
   * GeoJSON FeatureCollection of LineString features — one line per case trail.
   *
   * Each line connects the case's scan waypoints in chronological order.
   * Stable empty FeatureCollection while loading or inactive.
   */
  linesGeoJSON: TrailLinesGeoJSON;

  /**
   * GeoJSON FeatureCollection of Point features — one point per scan waypoint.
   *
   * Each point is a scan event where the case was physically located.
   * The `isFirst` and `isLast` properties allow styling origin/destination markers
   * differently from intermediate waypoints.
   * Stable empty FeatureCollection while loading or inactive.
   */
  pointsGeoJSON: TrailPointsGeoJSON;

  /**
   * `true` while the Convex subscription is in flight (initial fetch).
   * Always `false` when `isActive` is false (subscription is skipped).
   */
  isLoading: boolean;

  /**
   * Total number of case trails with at least one georeferenced waypoint.
   */
  trailCount: number;

  /**
   * Total number of waypoints across all trails.
   */
  totalWaypoints: number;
}

// ─── Stable empty GeoJSON constants ──────────────────────────────────────────

/**
 * Stable empty trail lines GeoJSON — returned while loading or inactive.
 * Module-scope constant keeps the reference stable across renders, preventing
 * unnecessary Mapbox source re-ingestion.
 */
const EMPTY_LINES_GEOJSON: TrailLinesGeoJSON = {
  type: "FeatureCollection",
  features: [],
};

/**
 * Stable empty trail points GeoJSON — returned while loading or inactive.
 */
const EMPTY_POINTS_GEOJSON: TrailPointsGeoJSON = {
  type: "FeatureCollection",
  features: [],
};

// ─── GeoJSON builder (pure function — testable without React) ─────────────────

/**
 * Trail data shape from the Convex query.
 * Mirrors convex/historyTrails.ts CaseTrail interface.
 */
interface CaseTrailData {
  caseId: string;
  caseLabel: string;
  waypoints: Array<{
    scanId: string;
    lat: number;
    lng: number;
    scannedAt: number;
    scannedByName: string;
    scanContext?: string;
    locationName?: string;
  }>;
  latestScan: number;
  waypointCount: number;
}

/**
 * Convert raw trail data from Convex into GeoJSON FeatureCollections.
 *
 * Returns both the line features (one LineString per case trail) and point
 * features (one Point per scan waypoint).
 *
 * Cases with fewer than 2 waypoints produce a degenerate LineString with
 * a repeated coordinate so Mapbox GL accepts the geometry without errors.
 *
 * @param trails - CaseTrail array from Convex getHistoryTrails response.
 * @returns `{ linesGeoJSON, pointsGeoJSON }`
 */
export function buildTrailGeoJSON(trails: CaseTrailData[]): {
  linesGeoJSON: TrailLinesGeoJSON;
  pointsGeoJSON: TrailPointsGeoJSON;
} {
  if (trails.length === 0) {
    return {
      linesGeoJSON:  EMPTY_LINES_GEOJSON,
      pointsGeoJSON: EMPTY_POINTS_GEOJSON,
    };
  }

  const lineFeatures: TrailLinesGeoJSON["features"] = [];
  const pointFeatures: TrailPointsGeoJSON["features"] = [];

  for (const trail of trails) {
    const { caseId, caseLabel, waypoints, latestScan, waypointCount } = trail;

    if (waypoints.length === 0) continue;

    // ── Line feature ──────────────────────────────────────────────────────
    //
    // Build a LineString from the ordered waypoints.
    // Mapbox GL JS requires at least 2 coordinates for a valid LineString;
    // for single-waypoint trails, duplicate the coordinate.
    const coordinates: [number, number][] = waypoints.map(
      (wp) => [wp.lng, wp.lat]
    );

    // Ensure at least 2 coordinates (required by GeoJSON LineString spec)
    if (coordinates.length === 1) {
      coordinates.push(coordinates[0]);
    }

    lineFeatures.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates,
      },
      properties: {
        caseId,
        caseLabel,
        waypointCount,
        latestScan,
      },
    });

    // ── Point features ────────────────────────────────────────────────────
    //
    // One Point feature per waypoint, tagged with isFirst/isLast for endpoint styling.
    const lastIdx = waypoints.length - 1;
    for (let i = 0; i <= lastIdx; i++) {
      const wp = waypoints[i];
      pointFeatures.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [wp.lng, wp.lat],
        },
        properties: {
          caseId,
          caseLabel,
          scannedAt:     wp.scannedAt,
          scannedByName: wp.scannedByName,
          scanContext:   wp.scanContext ?? "unknown",
          locationName:  wp.locationName ?? "",
          isFirst:       i === 0,
          isLast:        i === lastIdx,
        },
      });
    }
  }

  return {
    linesGeoJSON: {
      type: "FeatureCollection",
      features: lineFeatures,
    },
    pointsGeoJSON: {
      type: "FeatureCollection",
      features: pointFeatures,
    },
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to history trail data and wire it to the LayerEngine `history` toggle.
 *
 * Returns stable GeoJSON FeatureCollections that only change reference when
 * the history toggle state or the underlying trail data changes.
 *
 * Must be called inside a `<LayerEngineProvider>` ancestor.
 *
 * @param args - Optional filters: missionId, since.
 */
export function useHistoryTrail(
  args: UseHistoryTrailArgs = {}
): UseHistoryTrailResult {
  const { missionId, since } = args;

  // ── Layer engine state ────────────────────────────────────────────────────
  //
  // `state.history` drives both the skip flag and the returned `isActive` field.
  const { state } = useSharedLayerEngine();
  const isActive = state.history;

  // ── Convex subscription ───────────────────────────────────────────────────
  //
  // The "skip" sentinel suspends the subscription when the layer is toggled off.
  // When the user re-enables the history layer, Convex immediately starts
  // delivering the current trail set (no manual refetch needed).
  //
  // NOTE: `api.historyTrails` may not yet appear in the generated types if
  // the Convex CLI has not re-run since historyTrails.ts was added.  We cast
  // through `unknown as Record<string, any>` to handle stale generated types
  // safely — the runtime query path ("historyTrails.getHistoryTrails") is
  // authoritative.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiAny = api as unknown as Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getHistoryTrailsQuery = apiAny["historyTrails"]?.["getHistoryTrails"] as any;

  const queryArgs = isActive
    ? {
        ...(missionId ? { missionId } : {}),
        ...(since !== undefined && since !== null ? { since } : {}),
      }
    : "skip";

  const result = useQuery(getHistoryTrailsQuery, queryArgs);

  // ── Derive loading state ──────────────────────────────────────────────────
  //
  // `result === undefined` means the initial Convex fetch is in flight.
  // When skipped (layer inactive), result is always undefined but isLoading = false.
  const isLoading = isActive && result === undefined;

  // ── Build GeoJSON ─────────────────────────────────────────────────────────
  //
  // Memoised against `result` so Mapbox GL doesn't re-ingest unchanged data.
  // When loading or inactive, use the stable empty constants.
  const { linesGeoJSON, pointsGeoJSON } = useMemo(() => {
    if (!result || result.trails.length === 0) {
      return {
        linesGeoJSON:  EMPTY_LINES_GEOJSON,
        pointsGeoJSON: EMPTY_POINTS_GEOJSON,
      };
    }
    return buildTrailGeoJSON(result.trails);
  }, [result]);

  return {
    isActive,
    linesGeoJSON,
    pointsGeoJSON,
    isLoading,
    trailCount:     result?.trailCount     ?? 0,
    totalWaypoints: result?.totalWaypoints ?? 0,
  };
}
