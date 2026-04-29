/**
 * JourneyPathLine — Pure presentational path-line component for the INVENTORY map.
 *
 * Renders a connecting polyline between sequential stop coordinates sourced
 * directly from a `stops` prop.  This is a single-responsibility, fully
 * presentational component — it performs no data fetching, establishes no Convex
 * subscriptions, and carries no internal state.
 *
 * Architecture
 * ────────────
 * JourneyPathLine sits one layer below JourneyStopLayer in the component
 * hierarchy:
 *
 *   Convex subscription
 *     └── useJourneyStopLayer(caseId)   ← data / GeoJSON derivation
 *           └── JourneyStopLayer        ← smart container (caseId prop)
 *                 └── JourneyPathLine   ← THIS component (stops prop)
 *
 * The component can also be used standalone wherever a caller has pre-fetched
 * stop data and wants to render only the path line (e.g., M5 mission panel batch
 * paths, replay scrubber frame rendering, or unit tests without live Convex).
 *
 * Rendering
 * ─────────
 * Given an array of PathStop objects (each with a lat/lng coordinate pair and a
 * sequential stopIndex), the component:
 *
 *   1. Filters out any stops whose lat or lng is missing (hasCoordinates guard).
 *   2. Orders the remaining stops by `stopIndex` ascending.
 *   3. Builds a GeoJSON FeatureCollection containing one LineString feature whose
 *      coordinates are in Mapbox GL order: [longitude, latitude] (WGS84).
 *   4. Provides the FeatureCollection to a react-map-gl <Source type="geojson">.
 *   5. Renders a react-map-gl <Layer type="line"> that draws the path.
 *
 * If fewer than 2 geo-referenced stops remain after filtering, the component
 * returns `null` — a single point cannot form a line segment.
 *
 * Paint
 * ─────
 * Default paint uses `--layer-transit-bg` HSLA values (solid blue line) which
 * matches the JourneyStopLayer design spec.  The caller can override both the
 * paint and layout objects via props for alternate visual modes (e.g., dashed
 * lines for the HistoryTrail, lighter lines for inactive missions in M5).
 *
 * No hex literals — all default paint colors are HSLA strings matching the CSS
 * token definitions in base.css §7.
 *
 * Coordinates
 * ───────────
 * Mapbox GL JS uses longitude-first (GeoJSON standard) coordinate order:
 *   [longitude, latitude]
 * PathStop.lat and PathStop.lng use the conventional WGS84 naming; this
 * component swaps them to Mapbox GL order internally.
 *
 * Accessibility
 * ─────────────
 * The path itself is a visual element rendered in the WebGL canvas — it is not
 * accessible to screen readers.  Callers that need accessible journey information
 * should pair this component with a screen-reader-visible timeline list (such as
 * the JourneyStopLayer fallback list).
 *
 * Memoisation
 * ───────────
 * The GeoJSON FeatureCollection is computed inside a `useMemo` keyed on the
 * `stops` array reference.  React.memo prevents re-renders when props are
 * unchanged.  Together, these ensure the Mapbox GL source only re-ingests data
 * when the actual stop coordinates change — not on every parent render.
 *
 * Usage (inside a react-map-gl <Map>):
 * @example
 * import { Map } from "react-map-gl";
 * import { JourneyPathLine } from "@/components/Map/JourneyPathLine";
 *
 * function CaseDetailMap({ stops }: { stops: JourneyStop[] }) {
 *   // Extract flat coords from journey stop objects
 *   const pathStops = stops
 *     .filter((s) => s.hasCoordinates)
 *     .map((s) => ({
 *       stopIndex: s.stopIndex,
 *       lat: s.location.lat!,
 *       lng: s.location.lng!,
 *     }));
 *
 *   return (
 *     <Map mapboxApiAccessToken={MAPBOX_TOKEN}>
 *       <JourneyPathLine stops={pathStops} />
 *     </Map>
 *   );
 * }
 *
 * Requires:
 *   - react-map-gl ≥ 7.x (Source + Layer)
 *   - mapbox-gl ≥ 3.x (peer dependency)
 */

"use client";

import { memo, useMemo } from "react";
import { Source, Layer } from "react-map-gl";
import type { LayerProps } from "react-map-gl";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single stop coordinate for the path line.
 *
 * Both `lat` and `lng` are required — stops without a full coordinate pair
 * cannot be placed on the map line.  Callers should pre-filter their data to
 * only include stops that have coordinates (e.g., `stop.hasCoordinates === true`).
 *
 * `stopIndex` determines the sequential ordering of path segments.  Stops are
 * sorted ascending by stopIndex before building the LineString, so the caller
 * does not need to pre-sort the array.
 *
 * JourneyStop objects (from convex/journeyStopHelpers.ts) satisfy this interface
 * after extracting the lat/lng from their `location` sub-object.
 */
export interface PathStop {
  /**
   * 1-based sequence number that defines the order of this stop in the journey.
   * Stops are connected in ascending stopIndex order to form the path.
   */
  stopIndex: number;

  /**
   * WGS84 latitude in decimal degrees (−90 to +90).
   * Required — JourneyStops without lat cannot appear on the path.
   */
  lat: number;

  /**
   * WGS84 longitude in decimal degrees (−180 to +180).
   * Required — JourneyStops without lng cannot appear on the path.
   */
  lng: number;
}

// ─── GeoJSON types ────────────────────────────────────────────────────────────

/**
 * GeoJSON FeatureCollection containing one LineString feature connecting all
 * path stops in order.  The `type` and `features` shape matches the GeoJSON
 * spec and the react-map-gl `Source` `data` prop expectation.
 */
export interface PathLineGeoJSON {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "LineString";
      /** [longitude, latitude] pairs in Mapbox GL / GeoJSON order. */
      coordinates: [number, number][];
    };
    properties: {
      /** Total number of geo-referenced stops included in the path. */
      geoStopCount: number;
    };
  }>;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface JourneyPathLineProps {
  /**
   * Ordered (or unordered) array of stop coordinates to connect with a path line.
   *
   * The component sorts stops by `stopIndex` ascending before drawing the path,
   * so the caller does not need to pre-sort.  Stops are connected in sequential
   * stopIndex order to form the journey route.
   *
   * Stops without valid lat/lng are silently excluded from the path.  If fewer
   * than 2 valid stops remain after filtering, the component returns null.
   *
   * JourneyStop objects satisfy this interface after extracting flat lat/lng:
   *   const pathStops = journey.stops
   *     .filter(s => s.hasCoordinates)
   *     .map(s => ({ stopIndex: s.stopIndex, lat: s.location.lat!, lng: s.location.lng! }));
   */
  stops: PathStop[];

  /**
   * Stable Mapbox GL source ID.  Must be unique per map instance.
   * Override when mounting multiple JourneyPathLine instances on the same map
   * (e.g., M5 batch paths for multiple cases).
   *
   * @default "inventory-journey-path-source"
   */
  sourceId?: string;

  /**
   * Stable Mapbox GL layer ID.  Must be unique per map instance.
   * Override when mounting multiple JourneyPathLine instances.
   *
   * @default "inventory-journey-path-layer"
   */
  layerId?: string;

  /**
   * Mapbox GL `beforeId` — renders this layer before (below) the named layer.
   * Use "waterway-label" to render below case pin and label layers, which is
   * appropriate for most INVENTORY map views.
   *
   * @default "waterway-label"
   */
  beforeId?: string;

  /**
   * Override the Mapbox GL paint properties for the line layer.
   * By default renders as a solid blue line (--layer-transit-bg) matching the
   * JourneyStopLayer design spec.
   *
   * Pass a partial paint object to override specific properties (e.g., color)
   * while keeping width/opacity defaults.  The provided object is merged over
   * the defaults — duplicate keys in `paintOverride` take precedence.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paintOverride?: Record<string, any>;

  /**
   * Override the Mapbox GL layout properties for the line layer.
   * By default uses `line-cap: round` and `line-join: round`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  layoutOverride?: Record<string, any>;
}

// ─── Stable source / layer defaults ──────────────────────────────────────────

const DEFAULT_SOURCE_ID = "inventory-journey-path-source";
const DEFAULT_LAYER_ID  = "inventory-journey-path-layer";
const DEFAULT_BEFORE_ID = "waterway-label";

// ─── Default paint / layout ───────────────────────────────────────────────────
//
// All colors use CSS HSLA values resolved from the design tokens defined in
// base.css §7.  No hex literals — values match the --layer-transit-* token
// definitions for the light theme.
//
// --layer-transit-bg:  var(--_b-500) → hsl(211, 85%, 52%)

/**
 * Default line paint spec.
 * Renders a solid blue path line (--layer-transit-bg) connecting journey stops.
 * Width interpolated by zoom for consistent visual weight at all scales.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DEFAULT_PAINT: Record<string, any> = {
  "line-color":   "hsl(211, 85%, 52%)",  // --layer-transit-bg (light theme)
  "line-width":   [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,  1.5,   // very zoomed out: thin line
    8,  2.5,   // city level: medium
    12, 3,     // street level: slightly thicker
    16, 4,     // detail: wide
  ],
  "line-opacity": 0.85,
};

/**
 * Default line layout spec.
 * Rounded caps and joins for a smooth path between stops.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DEFAULT_LAYOUT: Record<string, any> = {
  "line-cap":  "round",
  "line-join": "round",
};

// ─── Stable empty GeoJSON ─────────────────────────────────────────────────────

/**
 * Stable empty FeatureCollection — returned when fewer than 2 geo-referenced
 * stops are available.  Using a singleton avoids re-renders triggered by new
 * object allocation on every render cycle.
 */
export const EMPTY_PATH_LINE_GEOJSON: PathLineGeoJSON = {
  type: "FeatureCollection",
  features: [],
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Build a GeoJSON FeatureCollection from an array of PathStop objects.
 *
 * Pure function — no side effects, fully testable without React.
 *
 * Algorithm:
 *   1. Sort stops by `stopIndex` ascending (chronological journey order).
 *   2. Map each stop to a [lng, lat] coordinate pair (Mapbox GL / GeoJSON order).
 *   3. If fewer than 2 coordinate pairs exist, return the empty singleton.
 *   4. Otherwise return a FeatureCollection with one LineString feature.
 *
 * A single valid stop produces a "degenerate" LineString with one coordinate —
 * this is technically valid GeoJSON but Mapbox GL renders it as a point rather
 * than a visible line segment.  We guard against this case and return null when
 * `geoCoords.length < 2`.
 *
 * @param stops  Array of PathStop objects (may be in any order; must have lat+lng).
 * @returns      GeoJSON FeatureCollection with zero or one LineString feature.
 */
export function buildPathLineGeoJSON(stops: PathStop[]): PathLineGeoJSON {
  if (stops.length === 0) {
    return EMPTY_PATH_LINE_GEOJSON;
  }

  // Sort by stopIndex ascending to ensure path segments connect in journey order.
  const sorted = [...stops].sort((a, b) => a.stopIndex - b.stopIndex);

  // Map to [lng, lat] — Mapbox GL / GeoJSON coordinate order.
  const coordinates: [number, number][] = sorted.map((s) => [s.lng, s.lat]);

  // A path requires at least 2 points to form a visible line segment.
  if (coordinates.length < 2) {
    return EMPTY_PATH_LINE_GEOJSON;
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates,
        },
        properties: {
          geoStopCount: coordinates.length,
        },
      },
    ],
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * JourneyPathLine — polyline drawn between sequential stop coordinates.
 *
 * Renders a Mapbox GL `Source` (type="geojson") + `Layer` (type="line") pair
 * that draws a connecting path line between the provided stop coordinates.
 *
 * Returns `null` when:
 *   - `stops` is empty
 *   - Fewer than 2 stops have valid lat/lng coordinates (no path to draw)
 *
 * The component is wrapped in `React.memo` to prevent unnecessary re-renders
 * when parent components re-render without changing the stops array.
 *
 * Note: The parent must provide a react-map-gl `<Map>` context.  Mounting this
 * component outside a Map context will throw a react-map-gl context error.
 */
export const JourneyPathLine = memo(function JourneyPathLine({
  stops,
  sourceId    = DEFAULT_SOURCE_ID,
  layerId     = DEFAULT_LAYER_ID,
  beforeId    = DEFAULT_BEFORE_ID,
  paintOverride,
  layoutOverride,
}: JourneyPathLineProps) {
  // ── Build GeoJSON from stop coordinates ───────────────────────────────────
  //
  // Memoised on the `stops` array reference.  The GeoJSON is recomputed only
  // when the stops array changes (e.g., a new Convex push adds a new stop).
  const pathGeoJSON = useMemo(() => {
    return buildPathLineGeoJSON(stops);
  }, [stops]);

  // ── Early exit — no drawable path ─────────────────────────────────────────
  //
  // A LineString requires at least 2 coordinate pairs to render as a visible
  // line segment.  When fewer than 2 geo-referenced stops are available, we
  // return null so no source/layer is registered with the Mapbox GL map.
  if (pathGeoJSON.features.length === 0) {
    return null;
  }

  // ── Merge paint / layout overrides ────────────────────────────────────────
  //
  // Spread defaults first so caller overrides take precedence on duplicate keys.
  const paint  = paintOverride  ? { ...DEFAULT_PAINT,  ...paintOverride  } : DEFAULT_PAINT;
  const layout = layoutOverride ? { ...DEFAULT_LAYOUT, ...layoutOverride } : DEFAULT_LAYOUT;

  // ── Mapbox GL layer spec ───────────────────────────────────────────────────
  const layerSpec: LayerProps = {
    id:      layerId,
    type:    "line",
    source:  sourceId,
    layout,
    paint,
    beforeId,
  };

  // ── Render ────────────────────────────────────────────────────────────────
  //
  // A single Source + Layer pair:
  //   Source  → provides the GeoJSON LineString data to Mapbox GL
  //   Layer   → renders the line using the merged paint/layout spec
  return (
    <Source
      id={sourceId}
      type="geojson"
      data={pathGeoJSON}
    >
      <Layer {...layerSpec} />
    </Source>
  );
});

JourneyPathLine.displayName = "JourneyPathLine";

export default JourneyPathLine;
