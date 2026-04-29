/**
 * JourneyStopLayer — M2 journey stops overlay for the INVENTORY map.
 *
 * Renders the lifecycle journey of a single case as:
 *   1. A path LineString connecting all geo-referenced stops in chronological
 *      order (blue — transit color tokens).
 *   2. Numbered circle markers at each stop position, with distinct colors for
 *      the first stop (origin — green) and latest stop (blue).
 *
 * This component is the visual counterpart of the M2 journey stops data layer
 * built in Sub-AC 1 (convex/queries/journeyStops.ts and src/hooks/use-m2-journey-stops.ts).
 * It consumes the derived M2CaseJourney via `useJourneyStopLayer`, which
 * establishes a live Convex WebSocket subscription and memoises GeoJSON
 * conversion so Mapbox GL only re-ingests when data actually changes.
 *
 * Architecture
 * ────────────
 * 1. `useJourneyStopLayer(caseId)` — subscription + GeoJSON hook.
 *      - Subscribes to `api["queries/journeyStops"].getM2JourneyStops`.
 *      - Derives pathGeoJSON (LineString) and stopsGeoJSON (Points).
 *      - Memoises GeoJSON conversion on the journey reference.
 *
 * 2. `<JourneyStopLayer>` — renders three react-map-gl Source + Layer pairs:
 *      - Path source:  "geojson" with one LineString feature (journey path)
 *        Layer type:   "line" — rendered in --layer-transit-bg color
 *      - Stops source: "geojson" with Point features (stop markers)
 *        Layer types:  two "circle" layers — intermediate stops + endpoint markers
 *      - Optional fallback list (when `fallbackMode=true`)
 *
 * Real-time fidelity
 * ──────────────────
 * Convex re-evaluates the journey subscription within ~100–300 ms when any
 * SCAN app mutation appends a new event (scanCheckIn, handoffCustody, shipCase,
 * completeInspection), satisfying the ≤ 2-second real-time fidelity requirement.
 * The dashboard user sees the new stop marker appear on the map almost immediately.
 *
 * Null-geometry stops
 * ───────────────────
 * Stops without GPS coordinates are included in the stopsGeoJSON as null-geometry
 * GeoJSON Features (valid per spec, ignored by Mapbox GL).  They appear in the
 * fallback list with "No location" shown as their position.
 *
 * Color / styling
 * ───────────────
 * All colors use CSS custom property HSLA values resolved from the design tokens:
 *   --layer-transit-*  → journey path line + latest stop marker
 *   --layer-deployed-* → origin/first stop marker
 *   --layer-history-*  → intermediate stop markers
 *
 * No hex literals — all paint values use HSLA strings resolved from the same
 * hue/saturation/lightness as the CSS token definitions in base.css §7.
 *
 * Requires:
 *   - react-map-gl ≥ 7.x (Source + Layer)
 *   - mapbox-gl ≥ 3.x (peer dependency)
 *   - No LayerEngineProvider required — this component is always-on when mounted.
 *
 * Usage (inside a react-map-gl <Map>):
 * @example
 * import { Map } from "react-map-gl";
 * import { JourneyStopLayer } from "@/components/Map/JourneyStopLayer";
 *
 * function M2CaseMap({ caseId }: { caseId: string | null }) {
 *   return (
 *     <Map mapboxApiAccessToken={MAPBOX_TOKEN}>
 *       <JourneyStopLayer caseId={caseId} showLegend />
 *     </Map>
 *   );
 * }
 */

"use client";

import { memo } from "react";
import { Source, Layer } from "react-map-gl";
import { useJourneyStopLayer } from "@/hooks/use-journey-stop-layer";
import type { M2CaseJourney, JourneyStop } from "@/hooks/use-m2-journey-stops";
import styles from "./JourneyStopLayer.module.css";

// ─── Layer / Source IDs ───────────────────────────────────────────────────────

/** Stable Mapbox GL source/layer IDs. Must not clash with other layers. */
const JOURNEY_PATH_SOURCE_ID       = "inventory-journey-path-source";
const JOURNEY_PATH_LAYER_ID        = "inventory-journey-path-layer";
const JOURNEY_STOPS_SOURCE_ID      = "inventory-journey-stops-source";
const JOURNEY_STOPS_LAYER_ID       = "inventory-journey-stops-layer";
const JOURNEY_ENDPOINTS_LAYER_ID   = "inventory-journey-endpoints-layer";

// ─── Mapbox paint specs ───────────────────────────────────────────────────────
//
// All color values must be resolved CSS HSLA strings (no hex literals).
// We use HSLA values that match the CSS token definitions in base.css §7.
//
// Light theme HSLA values:
//   --layer-transit-bg:   var(--_b-500)  → hsl(211, 85%, 52%)
//   --layer-deployed-bg:  var(--_g-500)  → hsl(142, 54%, 48%)
//   --layer-history-bg:   var(--_n-500)  → hsl(210, 9%, 50%)

/**
 * Journey path line paint spec.
 * Renders the connecting line between journey stops (transit/blue).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const JOURNEY_PATH_PAINT: Record<string, any> = {
  "line-color":   "hsl(211, 85%, 52%)",  // --layer-transit-bg
  "line-width":   [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,  1.5,   // very zoomed out: thin
    8,  2.5,   // city level: medium
    12, 3,     // street level: thicker
    16, 4,     // detail: wide
  ],
  "line-opacity": 0.85,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const JOURNEY_PATH_LAYOUT: Record<string, any> = {
  "line-cap":  "round",
  "line-join": "round",
};

/**
 * Intermediate stop circle paint spec.
 * Smaller gray dots for stops that are neither first nor last.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const JOURNEY_STOPS_PAINT: Record<string, any> = {
  "circle-radius": [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,  3,    // very zoomed out: 3px
    8,  5,    // city level: 5px
    12, 7,    // street level: 7px
    16, 9,    // detail: 9px
  ],
  "circle-color":        "hsl(210, 9%, 50%)",   // --layer-history-bg
  "circle-stroke-width": 1.5,
  "circle-stroke-color": "hsl(255, 100%, 100%)", // white ring
  "circle-opacity":      0.85,
};

/**
 * Endpoint marker paint spec (first + last stops).
 * Larger circles with distinct colors:
 *   isFirst = true → green (--layer-deployed-bg)
 *   isLast  = true → blue  (--layer-transit-bg)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const JOURNEY_ENDPOINTS_PAINT: Record<string, any> = {
  "circle-radius": [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,  5,
    8,  7,
    12, 10,
    16, 13,
  ],
  "circle-color": [
    "case",
    ["==", ["get", "isFirst"], true],
    "hsl(142, 54%, 48%)",  // --layer-deployed-bg — origin marker (green)
    ["==", ["get", "isLast"], true],
    "hsl(211, 85%, 52%)",  // --layer-transit-bg — latest stop (blue)
    "hsl(210, 9%, 50%)",   // fallback — gray
  ],
  "circle-stroke-width": 2,
  "circle-stroke-color": "hsl(255, 100%, 100%)",  // white ring
  "circle-opacity":      0.95,
};

/** Filter: endpoint layers only (first or last stop). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const JOURNEY_ENDPOINTS_FILTER: any[] = [
  "any",
  ["==", ["get", "isFirst"], true],
  ["==", ["get", "isLast"],  true],
];

/** Filter: intermediate stops (neither first nor last). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const JOURNEY_STOPS_FILTER: any[] = [
  "all",
  ["!=", ["get", "isFirst"], true],
  ["!=", ["get", "isLast"],  true],
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface JourneyStopLayerProps {
  /**
   * Convex case document ID to render the journey for.
   * Pass null to unmount the layer (no subscription established).
   */
  caseId: string | null;

  /**
   * When true, renders an accessible HTML fallback list instead of Mapbox GL
   * source/layer pairs.  Use when no Mapbox token is configured.
   *
   * @default false
   */
  fallbackMode?: boolean;

  /**
   * Show the floating legend overlay in the map canvas corner.
   *
   * @default true
   */
  showLegend?: boolean;

  /**
   * Additional CSS class applied to the legend element.
   */
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an event type string for display.
 * Converts underscore_names to "Title Case" labels.
 */
function formatEventType(eventType: string): string {
  return eventType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Format a timestamp for display in the fallback list.
 * Shows date + time in the user's locale.
 */
function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month:  "short",
    day:    "numeric",
    hour:   "numeric",
    minute: "2-digit",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * JourneyStopLayer — M2 journey stops overlay for the INVENTORY Mapbox map.
 *
 * When caseId is null → returns null immediately (no subscription).
 * When loading  → returns null (map shows nothing while data arrives).
 * When journey is null (case not found) → returns null.
 * When journey has no geo-referenced stops → no path rendered; stops shown
 *   only in fallback mode (timeline list without map pins).
 *
 * Does NOT require a `<LayerEngineProvider>` — this component is always-on
 * when a case is selected, not a user-toggled layer.
 *
 * The component is wrapped in `React.memo` — it only re-renders when its
 * props change or the underlying hook data changes, avoiding unnecessary
 * Mapbox GL source re-ingestion.
 */
export const JourneyStopLayer = memo(function JourneyStopLayer({
  caseId,
  fallbackMode = false,
  showLegend   = true,
  className,
}: JourneyStopLayerProps) {
  // ── Subscribe and compute GeoJSON ─────────────────────────────────────────
  const {
    pathGeoJSON,
    stopsGeoJSON,
    journey,
    stopCount,
    hasPath,
  } = useJourneyStopLayer(caseId);

  // No case selected — render nothing.
  if (!caseId) return null;

  // Loading or not found (`isLoading === (journey === undefined)` — direct check narrows for TypeScript).
  if (journey === undefined || journey === null) return null;

  // Journey loaded but no stops yet (newly created case).
  if (stopCount === 0) return null;

  // ── Legend element ─────────────────────────────────────────────────────────
  const legendElement = showLegend ? (
    <div
      className={[styles.legend, className].filter(Boolean).join(" ")}
      data-testid="journey-stop-legend"
      aria-label={`Journey stops for case ${journey.caseLabel}`}
      role="region"
    >
      <span className={styles.legendTitle} aria-hidden="true">
        Journey
      </span>

      {/* Case label — identifies which case this legend belongs to */}
      <span
        className={styles.legendCaseLabel}
        title={journey.caseLabel}
        aria-label={`Case ${journey.caseLabel}`}
      >
        {journey.caseLabel}
      </span>

      {/* Visual legend items */}
      <ul className={styles.legendItems} aria-label="Journey stop symbols">
        <li className={styles.legendItem}>
          <span className={styles.legendLineSwatch} aria-hidden="true" />
          <span>Journey path</span>
        </li>
        <li className={styles.legendItem}>
          <span
            className={[styles.legendDotSwatch, styles.legendDotSwatchFirst].join(" ")}
            aria-hidden="true"
          />
          <span>Origin (first stop)</span>
        </li>
        <li className={styles.legendItem}>
          <span
            className={[styles.legendDotSwatch, styles.legendDotSwatchLast].join(" ")}
            aria-hidden="true"
          />
          <span>Latest stop</span>
        </li>
        <li className={styles.legendItem}>
          <span className={styles.legendDotSwatch} aria-hidden="true" />
          <span>Intermediate stop</span>
        </li>
      </ul>

      {/* Live stop count — updates via Convex subscription */}
      <span
        className={styles.legendCount}
        aria-live="polite"
        aria-atomic="true"
        data-testid="journey-stop-count"
        aria-label={`${stopCount} journey stop${stopCount !== 1 ? "s" : ""}`}
      >
        {stopCount} stop{stopCount !== 1 ? "s" : ""}
      </span>
    </div>
  ) : null;

  // ── Fallback mode (no Mapbox token) ───────────────────────────────────────
  if (fallbackMode) {
    const stops: JourneyStop[] = journey.stops;
    const displayStops = stops.slice(0, 15);
    const moreCount    = Math.max(0, stops.length - displayStops.length);

    return (
      <div
        className={styles.fallback}
        data-testid="journey-stop-fallback"
        role="region"
        aria-label={`Journey stops for case ${journey.caseLabel}`}
      >
        <div className={styles.fallbackHeader}>
          <span className={styles.fallbackBadge} aria-hidden="true">
            Journey
          </span>
          <span className={styles.fallbackTitle}>
            {journey.caseLabel}
          </span>
          <span
            className={styles.fallbackCount}
            aria-live="polite"
            aria-atomic="true"
          >
            {`${stopCount} stop${stopCount !== 1 ? "s" : ""}`}
          </span>
        </div>

        {displayStops.length > 0 ? (
          <ol
            className={styles.fallbackStopList}
            aria-label={`${stopCount} journey stop${stopCount !== 1 ? "s" : ""} for case ${journey.caseLabel}`}
          >
            {displayStops.map((stop, i) => {
              const isFirst = i === 0;
              const isLast  = i === stops.length - 1;
              return (
                <li
                  key={stop.eventId}
                  className={styles.fallbackStopItem}
                  data-is-first={isFirst ? "true" : undefined}
                  data-is-last={isLast ? "true" : undefined}
                  data-event-type={stop.eventType}
                  data-stop-index={stop.stopIndex}
                >
                  <span
                    className={styles.fallbackStopIndex}
                    aria-hidden="true"
                  >
                    {stop.stopIndex}
                  </span>
                  <div className={styles.fallbackStopContent}>
                    <span className={styles.fallbackStopType}>
                      {formatEventType(stop.eventType)}
                    </span>
                    <span className={styles.fallbackStopMeta}>
                      {formatTimestamp(stop.timestamp)}
                      {stop.actorName ? ` · ${stop.actorName}` : ""}
                    </span>
                    {(stop.location.locationName || stop.hasCoordinates) && (
                      <span className={styles.fallbackStopLocation}>
                        {stop.location.locationName ||
                          (stop.hasCoordinates &&
                          stop.location.lat !== undefined &&
                          stop.location.lng !== undefined
                            ? `${stop.location.lat.toFixed(4)}, ${stop.location.lng.toFixed(4)}`
                            : "No location")}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
            {moreCount > 0 && (
              <li className={styles.fallbackEmpty}>
                +{moreCount} more stop{moreCount !== 1 ? "s" : ""}
              </li>
            )}
          </ol>
        ) : (
          <p className={styles.fallbackEmpty}>No journey stops recorded yet.</p>
        )}
      </div>
    );
  }

  // ── Mapbox GL mode ────────────────────────────────────────────────────────
  //
  // Render three Mapbox GL layers:
  //   1. Journey path (LineString) — connects stops in chronological order
  //   2. Intermediate stop markers (Circle) — small gray dots
  //   3. Endpoint markers (Circle) — larger origin (green) + latest (blue)
  //
  // The path layer is only added when at least one geo-referenced stop exists.
  // "waterway-label" is a reliable beforeId present in all Mapbox styles.
  return (
    <>
      {/* ── Journey path source + layer ── */}
      {hasPath && (
        <Source
          id={JOURNEY_PATH_SOURCE_ID}
          type="geojson"
          data={pathGeoJSON}
        >
          <Layer
            id={JOURNEY_PATH_LAYER_ID}
            type="line"
            source={JOURNEY_PATH_SOURCE_ID}
            layout={JOURNEY_PATH_LAYOUT}
            paint={JOURNEY_PATH_PAINT}
            // Render below case pin layers and heat layer
            beforeId="waterway-label"
          />
        </Source>
      )}

      {/* ── Stop markers source + layers ── */}
      <Source
        id={JOURNEY_STOPS_SOURCE_ID}
        type="geojson"
        data={stopsGeoJSON}
      >
        {/* Intermediate stop markers (small gray dots) */}
        <Layer
          id={JOURNEY_STOPS_LAYER_ID}
          type="circle"
          source={JOURNEY_STOPS_SOURCE_ID}
          paint={JOURNEY_STOPS_PAINT}
          filter={JOURNEY_STOPS_FILTER}
          beforeId="waterway-label"
        />

        {/* Endpoint markers — origin (green) + latest stop (blue) */}
        <Layer
          id={JOURNEY_ENDPOINTS_LAYER_ID}
          type="circle"
          source={JOURNEY_STOPS_SOURCE_ID}
          paint={JOURNEY_ENDPOINTS_PAINT}
          filter={JOURNEY_ENDPOINTS_FILTER}
          // Render above intermediate stop markers
          beforeId="waterway-label"
        />
      </Source>

      {/* Legend rendered outside the Source/Layer tree so it renders as DOM */}
      {legendElement}
    </>
  );
});

JourneyStopLayer.displayName = "JourneyStopLayer";

export default JourneyStopLayer;
