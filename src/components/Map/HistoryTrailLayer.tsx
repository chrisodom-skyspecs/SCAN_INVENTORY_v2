/**
 * HistoryTrailLayer — Case movement history trails overlay for the INVENTORY map.
 *
 * Renders the movement path of each case as a sequence of connected line segments
 * (one LineString per case trail) with circle markers at each scan waypoint.
 * The layer is driven by the `history` toggle in the shared `LayerEngine`; when
 * the toggle is off the component returns `null` and no Mapbox source/layer is
 * registered.
 *
 * Architecture
 * ────────────
 * 1. `useHistoryTrail(args)` — subscriptions + GeoJSON hook.
 *      - Reads `state.history` from the LayerEngine context.
 *      - When active: subscribes to `api.historyTrails.getHistoryTrails` (Convex).
 *      - When inactive: skips the subscription.
 *      - Derives GeoJSON FeatureCollections for lines and waypoint points.
 *
 * 2. `<HistoryTrailLayer>` — renders two react-map-gl <Source> + <Layer> pairs:
 *      - Lines source:  "geojson" with LineString features (trail paths)
 *        Layer type:     "line" — rendered in --layer-history-bg color
 *      - Points source: "geojson" with Point features (waypoint markers)
 *        Layer types:    two "circle" layers — intermediate (small dots) +
 *                        endpoint markers (origin = deployed color, latest = history color)
 *      - Returns `null` when the history toggle is off.
 *
 * Toggle control
 * ──────────────
 * The component optionally renders an in-map toggle button (prop `showToggle`)
 * that dispatches directly to the LayerEngine, providing a discoverable on/off
 * control directly on the map canvas.  The LayerTogglePanelConnected floating
 * panel (opened via the Layers toolbar button) also controls this layer — both
 * controls are synchronized via the LayerEngine state.
 *
 * Fallback (no Mapbox token)
 * ──────────────────────────
 * When `fallbackMode` is true, renders an accessible HTML trail list instead of
 * Mapbox layers, showing the case label, waypoint count, and most recent scan
 * time for each trail.  This allows operators to verify the Convex subscription
 * is working in environments without a Mapbox access token.
 *
 * Color / styling
 * ───────────────
 * All colors use `--layer-history-*` CSS custom properties from §7 of base.css,
 * resolved to neutral grays in light theme and brighter grays in dark theme.
 * Endpoint markers use `--layer-deployed-*` (origin) and `--layer-history-*`
 * (most recent) to visually distinguish start and end of a trail.
 *
 * No hex literals — all paint expressions use CSS var() or HSLA-resolved values.
 *
 * Design constraints
 * ──────────────────
 * - All colors via CSS custom properties (var(--layer-history-*) tokens)
 * - No hex literals in this file or its CSS module
 * - WCAG AA contrast in both light and dark themes
 * - Keyboard-accessible toggle control (focus-visible ring)
 * - Reduced motion: no transition animations
 *
 * Requires:
 *   - `<LayerEngineProvider>` ancestor (throws without it)
 *   - react-map-gl ≥ 7.x (Source + Layer from "react-map-gl")
 *   - mapbox-gl ≥ 3.x (peer dependency of react-map-gl)
 *
 * Usage (inside a react-map-gl <Map> component):
 * @example
 * import { Map } from "react-map-gl";
 * import { HistoryTrailLayer } from "@/components/Map/HistoryTrailLayer";
 *
 * function MyMap() {
 *   return (
 *     <Map mapboxApiAccessToken={MAPBOX_TOKEN}>
 *       <HistoryTrailLayer showToggle showLegend />
 *     </Map>
 *   );
 * }
 */

"use client";

import { memo, useCallback } from "react";
import { Source, Layer } from "react-map-gl";
import { useHistoryTrail } from "@/hooks/use-history-trail";
import { useSharedLayerEngine } from "@/providers/layer-engine-provider";
import styles from "./HistoryTrailLayer.module.css";

// ─── Layer / Source IDs ───────────────────────────────────────────────────────

/**
 * Stable Mapbox GL source/layer IDs for the history trail layer.
 * Must not clash with any other layer IDs registered on the map.
 */
const TRAIL_LINES_SOURCE_ID   = "inventory-trail-lines-source";
const TRAIL_LINES_LAYER_ID    = "inventory-trail-lines-layer";
const TRAIL_POINTS_SOURCE_ID  = "inventory-trail-points-source";
const TRAIL_POINTS_LAYER_ID   = "inventory-trail-points-layer";
const TRAIL_ENDPOINTS_LAYER_ID = "inventory-trail-endpoints-layer";

// ─── Mapbox paint specs ───────────────────────────────────────────────────────
//
// All color values must be resolved CSS HSLA strings (no hex literals).
// We use the computed property values from the design token CSS custom properties.
// Mapbox GL JS paint expressions don't support var() natively — we resolve the
// values to concrete HSLA strings that match the CSS token definitions in base.css.
//
// Light theme values:
//   --layer-history-bg:     var(--_n-500)  → hsl(210, 9%, 50%)
//   --layer-history-color:  var(--_n-600)  → hsl(210, 9%, 40%)
//   --layer-history-border: var(--_n-400)  → hsl(210, 9%, 60%)
//   --layer-deployed-bg:    var(--_g-500)  → hsl(142, 54%, 48%)
//
// Dark theme values use the .theme-dark overrides from §5h of base.css;
// those are applied automatically by CSS — Mapbox GL paint is light-theme only.
// For production, the paint expressions could be toggled via theme state.
//
// Using CSS-resolved HSLA strings per the "no hex literals" constraint.

/**
 * Trail line (path segment) paint spec.
 * Renders the path connecting scan waypoints for each case.
 * Using `as unknown as` casts to satisfy Mapbox GL expression type narrowing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TRAIL_LINE_PAINT: Record<string, any> = {
  "line-color":     "hsl(210, 9%, 50%)",  // --layer-history-bg light
  "line-width":     [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,  1.5,   // very zoomed out: thin line
    8,  2,     // city level: medium
    12, 2.5,   // street level: slightly thicker
    16, 3,     // detail: 3px
  ],
  "line-opacity":   0.7,
  "line-dasharray": [2, 1.5],  // dashed line to distinguish from solid routes
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TRAIL_LINE_LAYOUT: Record<string, any> = {
  "line-cap":  "round",
  "line-join": "round",
};

/**
 * Intermediate waypoint circle paint spec.
 * Small gray dots for scan positions that are neither first nor last.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TRAIL_POINTS_PAINT: Record<string, any> = {
  "circle-radius": [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,  2,    // very zoomed out: 2px
    8,  3.5,  // city level: 3.5px
    12, 5,    // street level: 5px
    16, 7,    // detail: 7px
  ],
  "circle-color":        "hsl(210, 9%, 50%)",  // --layer-history-bg
  "circle-stroke-width": 1,
  "circle-stroke-color": "hsl(210, 9%, 60%)",  // --layer-history-border
  "circle-opacity":      0.65,
};

/**
 * Endpoint marker paint spec (origin and latest-position markers).
 * Larger circles with distinct colors:
 *   isFirst = true → green (--layer-deployed-bg)
 *   isLast  = true → dark gray (--layer-history-color)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TRAIL_ENDPOINTS_PAINT: Record<string, any> = {
  "circle-radius": [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,  4,
    8,  6,
    12, 8,
    16, 10,
  ],
  // Use a case expression to color first/last endpoints differently
  "circle-color": [
    "case",
    ["==", ["get", "isFirst"], true],
    "hsl(142, 54%, 48%)",  // --layer-deployed-bg — origin marker (green)
    ["==", ["get", "isLast"], true],
    "hsl(210, 9%, 40%)",   // --layer-history-color — latest position (dark gray)
    "hsl(210, 9%, 50%)",   // fallback
  ],
  "circle-stroke-width": 1.5,
  "circle-stroke-color": "hsl(255, 100%, 100%)",  // white ring for contrast
  "circle-opacity":      0.9,
};

// Filter expressions for endpoint vs. intermediate waypoint layers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TRAIL_ENDPOINTS_FILTER: any[] = [
  "any",
  ["==", ["get", "isFirst"], true],
  ["==", ["get", "isLast"],  true],
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TRAIL_POINTS_FILTER: any[] = [
  "all",
  ["!=", ["get", "isFirst"], true],
  ["!=", ["get", "isLast"],  true],
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface HistoryTrailLayerProps {
  /**
   * Filter trails to cases on a specific mission.
   * Omit or pass `null` for a fleet-wide history overlay.
   */
  missionId?: string | null;

  /**
   * Only show waypoints after this epoch ms timestamp.
   * Use to show "last 24 hours" movement.
   * Omit to show all history.
   */
  since?: number | null;

  /**
   * When true, renders the accessible HTML fallback (trail list) instead of
   * Mapbox GL source/layer pairs.  Use when no Mapbox token is configured.
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
   * Show the in-map toggle button for the history layer.
   *
   * Provides a discoverable on/off control directly on the canvas.
   * Complements the LayerTogglePanelConnected floating panel.
   *
   * @default false
   */
  showToggle?: boolean;

  /**
   * Additional CSS class applied to the legend element.
   */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * HistoryTrailLayer — movement history trails overlay for the INVENTORY map.
 *
 * When the `history` toggle in the `LayerEngine` is OFF → returns null.
 * When the `history` toggle is ON:
 *   - Inside a react-map-gl <Map>: renders Mapbox GL line + circle layers.
 *   - Fallback mode (no Mapbox token): renders an accessible HTML trail list.
 *
 * Requires a `<LayerEngineProvider>` ancestor.
 *
 * The component is wrapped in `React.memo` — it only re-renders when its
 * props change or the underlying hook data changes, avoiding unnecessary
 * Mapbox GL source re-ingestion.
 */
export const HistoryTrailLayer = memo(function HistoryTrailLayer({
  missionId,
  since,
  fallbackMode  = false,
  showLegend    = true,
  showToggle    = false,
  className,
}: HistoryTrailLayerProps) {
  // ── History trail data + activation state ─────────────────────────────────
  //
  // useHistoryTrail reads `state.history` from the LayerEngine and conditionally
  // subscribes to the Convex trail data.  When the toggle is off, linesGeoJSON
  // and pointsGeoJSON are the stable empty FeatureCollections (no subscription
  // in flight).
  const {
    isActive,
    linesGeoJSON,
    pointsGeoJSON,
    isLoading,
    trailCount,
    totalWaypoints,
  } = useHistoryTrail({
    missionId: missionId ?? undefined,
    since:     since     ?? undefined,
  });

  // ── Engine toggle dispatcher ──────────────────────────────────────────────
  //
  // Used by the optional in-map toggle button.
  const { toggle } = useSharedLayerEngine();

  const handleToggle = useCallback(() => {
    toggle("history");
  }, [toggle]);

  // ── Toggle control element (shared across both render modes) ──────────────
  const toggleElement = showToggle ? (
    <button
      type="button"
      className={styles.toggleControl}
      data-active={isActive ? "true" : undefined}
      onClick={handleToggle}
      aria-pressed={isActive}
      aria-label={`${isActive ? "Hide" : "Show"} case movement history trails`}
      data-testid="history-trail-toggle"
    >
      <span className={styles.toggleDot} aria-hidden="true" />
      <span>History</span>
    </button>
  ) : null;

  // ── Early exit — history layer toggled off ────────────────────────────────
  //
  // When the toggle is off, render only the toggle button (if showToggle).
  // No Mapbox sources/layers are registered — returning null removes any
  // previously-registered GL resources.
  if (!isActive) {
    return toggleElement;
  }

  // ── Legend element (shared by both rendering modes) ───────────────────────

  const legendElement = showLegend ? (
    <div
      className={[styles.legend, className].filter(Boolean).join(" ")}
      data-testid="history-trail-legend"
      aria-label="Case movement history trails legend"
      role="region"
    >
      <span className={styles.legendTitle} aria-hidden="true">
        History
      </span>

      {/* Visual legend items */}
      <ul className={styles.legendItems} aria-label="Trail symbols legend">
        <li className={styles.legendItem}>
          <span className={styles.legendLineSwatch} aria-hidden="true" />
          <span>Movement path</span>
        </li>
        <li className={styles.legendItem}>
          <span
            className={[styles.legendDotSwatch, styles.legendDotSwatchFirst].join(" ")}
            aria-hidden="true"
          />
          <span>Origin (first scan)</span>
        </li>
        <li className={styles.legendItem}>
          <span
            className={[styles.legendDotSwatch, styles.legendDotSwatchLast].join(" ")}
            aria-hidden="true"
          />
          <span>Latest position</span>
        </li>
        <li className={styles.legendItem}>
          <span className={styles.legendDotSwatch} aria-hidden="true" />
          <span>Intermediate scan</span>
        </li>
      </ul>

      {/* Live trail count — updates via Convex subscription */}
      <span
        className={styles.legendCount}
        aria-live="polite"
        aria-atomic="true"
        data-loading={isLoading ? "true" : undefined}
        data-testid="history-trail-count"
      >
        {isLoading ? (
          <span
            className={styles.legendCountLoading}
            aria-label="Loading history trail data"
          />
        ) : (
          <span
            aria-label={
              `${trailCount} case trail${trailCount !== 1 ? "s" : ""}, ` +
              `${totalWaypoints} waypoint${totalWaypoints !== 1 ? "s" : ""}`
            }
          >
            {trailCount} trail{trailCount !== 1 ? "s" : ""},{" "}
            {totalWaypoints} pt{totalWaypoints !== 1 ? "s" : ""}
          </span>
        )}
      </span>
    </div>
  ) : null;

  // ── Fallback mode (no Mapbox token) ───────────────────────────────────────
  //
  // When `fallbackMode` is true, render an accessible HTML trail list.
  // This allows operators to verify the Convex subscription is active
  // even in environments without a Mapbox access token.
  if (fallbackMode) {
    // Extract trail data from the GeoJSON for the fallback list.
    // Line features carry the per-case metadata we need.
    const trailItems = linesGeoJSON.features.slice(0, 10).map((f) => ({
      caseId:        f.properties.caseId,
      caseLabel:     f.properties.caseLabel,
      waypointCount: f.properties.waypointCount,
      latestScan:    f.properties.latestScan,
    }));

    const moreCount = Math.max(0, trailCount - trailItems.length);

    return (
      <>
        {toggleElement}
        <div
          className={styles.fallback}
          data-testid="history-trail-fallback"
          role="region"
          aria-label="Case movement history trails"
        >
          <div className={styles.fallbackHeader}>
            <span className={styles.fallbackBadge} aria-hidden="true">
              History
            </span>
            <span className={styles.fallbackTitle}>Movement Trails</span>
            <span
              className={styles.fallbackCount}
              aria-live="polite"
              aria-atomic="true"
            >
              {isLoading
                ? "Loading…"
                : `${trailCount} trail${trailCount !== 1 ? "s" : ""}`}
            </span>
          </div>

          {trailItems.length > 0 && (
            <ul
              className={styles.fallbackTrailList}
              aria-label={`${trailCount} case movement trail${trailCount !== 1 ? "s" : ""}`}
            >
              {trailItems.map((trail) => (
                <li key={trail.caseId} className={styles.fallbackTrailItem}>
                  <span className={styles.fallbackTrailLabel}>
                    {trail.caseLabel}
                  </span>
                  <span className={styles.fallbackTrailMeta}>
                    {trail.waypointCount} scan{trail.waypointCount !== 1 ? "s" : ""}
                    {" · "}
                    {new Date(trail.latestScan).toLocaleDateString(undefined, {
                      month: "short",
                      day:   "numeric",
                    })}
                  </span>
                </li>
              ))}
              {moreCount > 0 && (
                <li className={styles.fallbackTrailMore}>
                  +{moreCount} more trail{moreCount !== 1 ? "s" : ""}
                </li>
              )}
            </ul>
          )}

          {trailItems.length === 0 && !isLoading && (
            <p className={styles.fallbackTrailMore}>
              No georeferenced scan history available.
            </p>
          )}
        </div>
      </>
    );
  }

  // ── Mapbox GL mode (standard path) ────────────────────────────────────────
  //
  // Render three Mapbox GL layers:
  //   1. Trail lines (LineString) — dashed path connecting waypoints
  //   2. Intermediate waypoints (Circle) — small dots at non-endpoint positions
  //   3. Endpoint markers (Circle) — larger origin (green) + latest (gray) dots
  //
  // Layer ordering (beforeId): trails render below case pins but above base map.
  // "waterway-label" is a reliable anchor present in all Mapbox styles.
  return (
    <>
      {/* In-map toggle button (optional) */}
      {toggleElement}

      {/* ── Trail lines source + layer ── */}
      <Source
        id={TRAIL_LINES_SOURCE_ID}
        type="geojson"
        data={linesGeoJSON}
        // lineMetrics: true enables line-gradient paint property (not used here
        // but useful for future per-segment color weighting by recency).
        lineMetrics={true}
      >
        <Layer
          id={TRAIL_LINES_LAYER_ID}
          type="line"
          source={TRAIL_LINES_SOURCE_ID}
          layout={TRAIL_LINE_LAYOUT}
          paint={TRAIL_LINE_PAINT}
          // Render below case pin layers and heat layer
          beforeId="waterway-label"
        />
      </Source>

      {/* ── Trail waypoints source + layers ── */}
      <Source
        id={TRAIL_POINTS_SOURCE_ID}
        type="geojson"
        data={pointsGeoJSON}
      >
        {/* Intermediate waypoints (small gray dots) */}
        <Layer
          id={TRAIL_POINTS_LAYER_ID}
          type="circle"
          source={TRAIL_POINTS_SOURCE_ID}
          paint={TRAIL_POINTS_PAINT}
          filter={TRAIL_POINTS_FILTER}
          // Render above the trail lines but below endpoint markers
          beforeId="waterway-label"
        />

        {/* Endpoint markers (origin + latest position — larger, colored) */}
        <Layer
          id={TRAIL_ENDPOINTS_LAYER_ID}
          type="circle"
          source={TRAIL_POINTS_SOURCE_ID}
          paint={TRAIL_ENDPOINTS_PAINT}
          filter={TRAIL_ENDPOINTS_FILTER}
          // Render above intermediate points
          beforeId="waterway-label"
        />
      </Source>

      {/* Legend rendered outside the Source/Layer tree so it renders as DOM */}
      {legendElement}
    </>
  );
});

HistoryTrailLayer.displayName = "HistoryTrailLayer";

export default HistoryTrailLayer;
