/**
 * src/hooks/use-journey-stop-layer.ts
 *
 * Journey stop layer hook — derives Mapbox-ready GeoJSON from an M2CaseJourney.
 *
 * Exported symbols:
 *
 *   buildJourneyStopGeoJSON(journey)
 *     Pure function.  Converts a single M2CaseJourney into two GeoJSON
 *     FeatureCollections:
 *       pathGeoJSON   — one LineString connecting all geo-referenced stops
 *       stopsGeoJSON  — one Point per stop (including non-geo stops as nulls)
 *
 *   useJourneyStopLayer(caseId)
 *     React hook.  Subscribes to M2 journey data via useM2JourneyStops and
 *     memoises the GeoJSON conversion.  Designed for use inside the
 *     JourneyStopLayer Mapbox component.
 *
 * GeoJSON structure
 * ─────────────────
 * Path line features:
 *   geometry: LineString with [lng, lat] coordinate pairs (only geo stops)
 *   properties: { caseId, caseLabel, stopCount, hasAllCoordinates }
 *
 * Stop point features:
 *   geometry: Point at [lng, lat]
 *   properties: {
 *     caseId, caseLabel, stopIndex, eventType, timestamp,
 *     actorName, locationName,
 *     isFirst, isLast,       — endpoint markers rendered distinctly
 *     hasCoordinates,        — false for stops with no GPS data
 *   }
 *
 * Stops without GPS coordinates are excluded from the path LineString but
 * are included in the stops FeatureCollection with a null geometry Feature
 * (type: "Feature", geometry: null) so they can be listed in timeline UI.
 * Mapbox GL ignores null-geometry features automatically.
 *
 * Performance
 * ───────────
 * buildJourneyStopGeoJSON runs in O(n) time and space where n = stop count.
 * useJourneyStopLayer memoises the result on the journey reference — the GeoJSON
 * is recomputed only when the journey object changes (Convex pushes new data),
 * not on every render.
 *
 * Real-time fidelity
 * ──────────────────
 * useJourneyStopLayer delegates to useM2JourneyStops which establishes a live
 * Convex subscription.  Any SCAN app mutation (scanCheckIn, handoffCustody,
 * shipCase) that appends a new event will cause Convex to push a new journey
 * within ~100–300 ms, satisfying the ≤ 2-second fidelity requirement.
 *
 * Usage in JourneyStopLayer component:
 * @example
 *   const { pathGeoJSON, stopsGeoJSON, journey, isLoading } =
 *     useJourneyStopLayer(selectedCaseId);
 *
 *   return (
 *     <>
 *       <Source type="geojson" data={pathGeoJSON}>
 *         <Layer type="line" ... />
 *       </Source>
 *       <Source type="geojson" data={stopsGeoJSON}>
 *         <Layer type="circle" ... />
 *       </Source>
 *     </>
 *   );
 */

"use client";

import { useMemo } from "react";
import { useM2JourneyStops } from "./use-m2-journey-stops";
import type { M2CaseJourney, JourneyStop } from "./use-m2-journey-stops";

// ─── GeoJSON types ────────────────────────────────────────────────────────────

/**
 * Properties attached to the journey path LineString feature.
 */
export interface JourneyPathProperties {
  caseId:             string;
  caseLabel:          string;
  /** Total number of stops in the journey (not just geo-referenced ones). */
  stopCount:          number;
  /** True when every stop has GPS coordinates. */
  hasAllCoordinates:  boolean;
}

/**
 * Properties attached to each journey stop Point feature.
 */
export interface JourneyStopProperties {
  caseId:         string;
  caseLabel:      string;
  /** 1-based sequential position in the journey. */
  stopIndex:      number;
  eventType:      string;
  /** Epoch milliseconds. */
  timestamp:      number;
  actorName:      string;
  locationName:   string;
  /** true for the first stop (origin). */
  isFirst:        boolean;
  /** true for the most recent stop. */
  isLast:         boolean;
  /** false for stops with no GPS coordinates (geometry will be null). */
  hasCoordinates: boolean;
}

/**
 * GeoJSON FeatureCollection for the journey path line.
 *
 * Contains zero or one LineString features:
 *   • zero  — no geo-referenced stops exist (no path to draw)
 *   • one   — LineString connecting all stops that have GPS coordinates
 *
 * A single-stop journey produces a degenerate LineString with one coordinate
 * pair — Mapbox GL renders it as a point rather than a line segment, which is
 * acceptable.  (A real point marker is still placed by the stopsGeoJSON.)
 */
export interface JourneyPathGeoJSON {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "LineString";
      /** Coordinates in Mapbox GL order: [longitude, latitude]. */
      coordinates: [number, number][];
    };
    properties: JourneyPathProperties;
  }>;
}

/**
 * GeoJSON FeatureCollection of journey stop markers.
 *
 * One feature per stop.  Stops with GPS data have `geometry: Point`;
 * stops without GPS have `geometry: null` (valid GeoJSON, ignored by
 * Mapbox GL's source/layer system but included for timeline UI).
 */
export interface JourneyStopsGeoJSON {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] } | null;
    properties: JourneyStopProperties;
  }>;
}

// ─── Stable empty GeoJSON singletons ─────────────────────────────────────────
//
// Used as the return value when there are no stops or no journey.
// Stable references ensure the Mapbox GL source does not re-ingest data
// on every render when nothing has changed.

/** Empty path FeatureCollection — stable reference. */
export const EMPTY_PATH_GEOJSON: JourneyPathGeoJSON = {
  type: "FeatureCollection",
  features: [],
};

/** Empty stops FeatureCollection — stable reference. */
export const EMPTY_STOPS_GEOJSON: JourneyStopsGeoJSON = {
  type: "FeatureCollection",
  features: [],
};

// ─── buildJourneyStopGeoJSON ──────────────────────────────────────────────────

/**
 * Convert an M2CaseJourney into Mapbox-ready GeoJSON FeatureCollections.
 *
 * Pure function — no side effects, no React dependencies, fully testable.
 *
 * Algorithm:
 *   1. Filter stops to those with GPS coordinates for the path LineString.
 *   2. Build one Point feature per stop (null geometry for non-geo stops).
 *   3. Build zero or one LineString connecting the geo-referenced stops.
 *
 * @param journey  M2CaseJourney to convert.
 * @returns        { pathGeoJSON, stopsGeoJSON }
 */
export function buildJourneyStopGeoJSON(journey: M2CaseJourney): {
  pathGeoJSON:  JourneyPathGeoJSON;
  stopsGeoJSON: JourneyStopsGeoJSON;
} {
  const { caseId, caseLabel, stops } = journey;

  if (stops.length === 0) {
    return { pathGeoJSON: EMPTY_PATH_GEOJSON, stopsGeoJSON: EMPTY_STOPS_GEOJSON };
  }

  const lastStopIndex = stops.length - 1;

  // ── Build stop point features ─────────────────────────────────────────────
  const stopFeatures: JourneyStopsGeoJSON["features"] = stops.map(
    (stop: JourneyStop, arrayIndex: number) => {
      const isFirst = arrayIndex === 0;
      const isLast  = arrayIndex === lastStopIndex;

      const properties: JourneyStopProperties = {
        caseId,
        caseLabel,
        stopIndex:      stop.stopIndex,
        eventType:      stop.eventType,
        timestamp:      stop.timestamp,
        actorName:      stop.actorName,
        locationName:   stop.location.locationName ?? "",
        isFirst,
        isLast,
        hasCoordinates: stop.hasCoordinates,
      };

      if (
        stop.hasCoordinates &&
        stop.location.lat !== undefined &&
        stop.location.lng !== undefined
      ) {
        return {
          type:       "Feature" as const,
          geometry:   {
            type:        "Point" as const,
            // GeoJSON / Mapbox GL coordinate order is [lng, lat].
            coordinates: [stop.location.lng, stop.location.lat] as [number, number],
          },
          properties,
        };
      }

      // Null geometry for stops without GPS data.
      return {
        type:       "Feature" as const,
        geometry:   null,
        properties,
      };
    }
  );

  // ── Build path LineString ─────────────────────────────────────────────────
  // Collect only the stops that have GPS coordinates, in chronological order.
  const geoCoords: [number, number][] = stops
    .filter(
      (s: JourneyStop): s is JourneyStop & {
        location: { lat: number; lng: number };
      } =>
        s.hasCoordinates &&
        s.location.lat !== undefined &&
        s.location.lng !== undefined
    )
    .map((s) => [s.location.lng!, s.location.lat!] as [number, number]);

  const pathFeatures: JourneyPathGeoJSON["features"] =
    geoCoords.length > 0
      ? [
          {
            type: "Feature" as const,
            geometry: {
              type:        "LineString" as const,
              coordinates: geoCoords,
            },
            properties: {
              caseId,
              caseLabel,
              stopCount:         stops.length,
              hasAllCoordinates: geoCoords.length === stops.length,
            },
          },
        ]
      : [];

  return {
    pathGeoJSON: {
      type:     "FeatureCollection" as const,
      features: pathFeatures,
    },
    stopsGeoJSON: {
      type:     "FeatureCollection" as const,
      features: stopFeatures,
    },
  };
}

// ─── Return type ──────────────────────────────────────────────────────────────

/**
 * Return value of `useJourneyStopLayer`.
 */
export interface UseJourneyStopLayerResult {
  /**
   * GeoJSON FeatureCollection for the journey path line.
   * Empty FeatureCollection when there is no data yet or no geo stops.
   */
  pathGeoJSON:  JourneyPathGeoJSON;

  /**
   * GeoJSON FeatureCollection of journey stop markers.
   * Empty FeatureCollection when there is no data yet.
   */
  stopsGeoJSON: JourneyStopsGeoJSON;

  /**
   * The resolved journey, or null (case not found), or undefined (loading).
   * Consumers can use this to render loading/not-found states outside the
   * Mapbox GL layer tree.
   */
  journey: M2CaseJourney | null | undefined;

  /**
   * True while the initial Convex subscription fetch is in flight.
   * Callers should show a loading indicator when true.
   */
  isLoading: boolean;

  /**
   * Number of journey stops.  0 while loading or when journey is null.
   */
  stopCount: number;

  /**
   * True when at least one stop has GPS coordinates (the path has length > 0).
   */
  hasPath: boolean;
}

// ─── useJourneyStopLayer ──────────────────────────────────────────────────────

/**
 * Subscribe to an M2 case journey and derive Mapbox-ready GeoJSON.
 *
 * Subscribes to `getM2JourneyStops` via `useM2JourneyStops` and memoises the
 * GeoJSON conversion via `useMemo`.  The GeoJSON is recomputed only when the
 * journey reference changes — i.e., when Convex pushes a new journey snapshot.
 *
 * Return states:
 *   isLoading = true   — initial fetch in flight; pathGeoJSON/stopsGeoJSON are empty
 *   journey = null     — case not found; empty GeoJSON returned
 *   journey = M2CaseJourney — data available; GeoJSON populated
 *
 * @param caseId  Convex case document ID.  Pass null to skip the subscription.
 *
 * @returns  UseJourneyStopLayerResult
 *
 * @example
 *   const { pathGeoJSON, stopsGeoJSON, isLoading, stopCount } =
 *     useJourneyStopLayer(selectedCaseId);
 *   if (isLoading) return <LayerSkeleton />;
 *   if (!stopCount) return null;
 *   return (
 *     <>
 *       <Source type="geojson" data={pathGeoJSON}>
 *         <Layer type="line" ... />
 *       </Source>
 *       <Source type="geojson" data={stopsGeoJSON}>
 *         <Layer type="circle" ... />
 *       </Source>
 *     </>
 *   );
 */
export function useJourneyStopLayer(
  caseId: string | null
): UseJourneyStopLayerResult {
  const journey = useM2JourneyStops(caseId);

  const isLoading = journey === undefined;

  // Memoise GeoJSON conversion.  Recomputes only when `journey` reference
  // changes (Convex push) — Mapbox GL source re-ingestion is expensive.
  const { pathGeoJSON, stopsGeoJSON } = useMemo(() => {
    if (!journey) {
      return { pathGeoJSON: EMPTY_PATH_GEOJSON, stopsGeoJSON: EMPTY_STOPS_GEOJSON };
    }
    return buildJourneyStopGeoJSON(journey);
  }, [journey]);

  const stopCount = journey?.stopCount ?? 0;
  const hasPath   = pathGeoJSON.features.length > 0;

  return { pathGeoJSON, stopsGeoJSON, journey, isLoading, stopCount, hasPath };
}
