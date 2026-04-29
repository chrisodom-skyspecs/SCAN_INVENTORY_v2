/**
 * TurbineLayer — Wind turbine site markers overlay for the INVENTORY map.
 *
 * Renders wind turbine locations as circle markers on the Mapbox GL map,
 * with per-status color coding (active = lime, inactive = muted, decommissioned = gray).
 * The layer is driven by the `turbines` toggle in the shared `LayerEngine`; when
 * the toggle is off the component returns `null` and no Mapbox source/layer is
 * registered.
 *
 * Architecture
 * ────────────
 * 1. `useTurbineLayer(args)` — subscription + GeoJSON hook (src/hooks/use-turbine-layer.ts)
 *      - Reads `state.turbines` from the LayerEngine context.
 *      - When active: subscribes to `api.turbines.getTurbineLocations` (Convex).
 *      - When inactive: skips the subscription.
 *      - Derives a GeoJSON FeatureCollection of Point features.
 *
 * 2. `<TurbineLayer>` — renders one react-map-gl <Source> + two <Layer> pairs:
 *      - Markers source: "geojson" with Point features (turbine positions)
 *        Circle layer:   status-colored filled circles
 *        Symbol layer:   turbine name text labels (at zoom ≥ 10)
 *      - Returns `null` when the turbines toggle is off.
 *
 * Toggle control
 * ──────────────
 * The component optionally renders an in-map toggle button (prop `showToggle`)
 * that dispatches directly to the LayerEngine.  The `LayerTogglePanelConnected`
 * floating panel (opened via the Layers toolbar button) also controls this layer —
 * both controls are synchronized via the LayerEngine state.
 *
 * Fallback (no Mapbox token)
 * ──────────────────────────
 * When `fallbackMode` is true, renders an accessible HTML turbine list instead of
 * Mapbox GL layers, showing name, status, and coordinates for each turbine.
 *
 * Color / styling
 * ───────────────
 * All colors use `--layer-turbines-*` CSS custom properties from §7 of base.css,
 * resolved to lime/yellow-green in light theme and brighter lime in dark theme.
 * Mapbox GL paint expressions use resolved HSLA strings (no hex literals).
 *
 * Mapbox GL paint color values (light theme):
 *   "active"         → hsl(84, 64%, 40%)   (--layer-turbines-bg   = --_map-lim-400)
 *   "inactive"       → hsl(84, 72%, 68%)   (--layer-turbines-border = --_map-lim-300)
 *   "decommissioned" → hsl(210, 9%, 50%)   (neutral gray)
 *
 * Design constraints
 * ──────────────────
 * - All colors via CSS custom properties (var(--layer-turbines-*) tokens)
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
 * import { TurbineLayer } from "@/components/Map/TurbineLayer";
 *
 * function MyMap() {
 *   return (
 *     <Map mapboxApiAccessToken={MAPBOX_TOKEN}>
 *       <TurbineLayer showToggle showLegend />
 *     </Map>
 *   );
 * }
 */

"use client";

import { memo, useCallback } from "react";
import { Source, Layer } from "react-map-gl";
import { useTurbineLayer } from "@/hooks/use-turbine-layer";
import { useSharedLayerEngine } from "@/providers/layer-engine-provider";
import styles from "./TurbineLayer.module.css";

// ─── Layer / Source IDs ───────────────────────────────────────────────────────

/**
 * Stable Mapbox GL source/layer IDs for the turbine layer.
 * Must not clash with any other layer IDs registered on the map.
 */
const TURBINE_SOURCE_ID       = "inventory-turbines-source";
const TURBINE_CIRCLES_LAYER_ID = "inventory-turbines-circles-layer";
const TURBINE_LABELS_LAYER_ID  = "inventory-turbines-labels-layer";

// ─── Mapbox paint specs ───────────────────────────────────────────────────────
//
// Color values are resolved CSS HSLA strings matching design token definitions:
//   --layer-turbines-bg     → hsl(84, 64%, 40%)  (--_map-lim-400, light theme active)
//   --layer-turbines-border → hsl(84, 68%, 52%)  (--_map-lim-300, light theme inactive)
//   Decommissioned          → hsl(210, 9%, 50%)  (neutral gray, same as history-bg)
//
// Mapbox GL JS paint expressions don't support CSS var() natively — resolved
// HSLA strings are used per the "no hex literals" constraint.

/**
 * Circle layer paint spec — status-colored turbine markers.
 * Uses a Mapbox GL expression to switch color based on the `status` property.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TURBINE_CIRCLES_PAINT: Record<string, any> = {
  // Marker fill color — switches by turbine status
  "circle-color": [
    "case",
    ["==", ["get", "status"], "active"],
    "hsl(84, 64%, 40%)",          // --layer-turbines-bg (lime, active)
    ["==", ["get", "status"], "inactive"],
    "hsl(84, 72%, 68%)",          // --layer-turbines-border (light lime, inactive)
    "hsl(210, 9%, 50%)",          // neutral gray (decommissioned)
  ],
  // Marker radius — scales with zoom level
  "circle-radius": [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,  4,    // very zoomed out: 4px
    8,  6,    // city level: 6px
    10, 8,    // regional: 8px
    12, 10,   // street level: 10px
    14, 12,   // detail: 12px
  ],
  // White stroke ring for WCAG contrast against map tiles
  "circle-stroke-width": [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,  1,
    8,  1.5,
    12, 2,
  ],
  "circle-stroke-color": "hsl(255, 100%, 100%)",  // white ring for contrast
  // Reduce opacity for inactive/decommissioned turbines
  "circle-opacity": [
    "case",
    ["==", ["get", "status"], "active"],
    0.9,
    ["==", ["get", "status"], "inactive"],
    0.55,
    0.3,    // decommissioned — very muted
  ],
  "circle-stroke-opacity": [
    "case",
    ["==", ["get", "status"], "active"],
    0.9,
    ["==", ["get", "status"], "inactive"],
    0.55,
    0.3,
  ],
};

/**
 * Text label layout spec — turbine name labels at zoom ≥ 10.
 * Labels appear only when the user zooms in close enough to be useful.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TURBINE_LABELS_LAYOUT: Record<string, any> = {
  "text-field":       ["get", "name"],
  "text-font":        ["literal", ["IBM Plex Mono", "Arial Unicode MS Regular"]],
  "text-size":        [
    "interpolate",
    ["linear"],
    ["zoom"],
    10, 9,
    12, 11,
    14, 12,
  ],
  "text-offset":      ["literal", [0, 1.5]],    // shift label below circle
  "text-anchor":      "top",
  "text-max-width":   8,
  "visibility":       "visible",
};

/**
 * Text label paint spec — turbine name labels.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TURBINE_LABELS_PAINT: Record<string, any> = {
  "text-color": "hsl(84, 62%, 31%)",            // --layer-turbines-color (lime 500)
  "text-halo-color": "hsl(255, 100%, 100%)",    // white halo for legibility
  "text-halo-width": 1.5,
  "text-opacity": [
    "interpolate",
    ["linear"],
    ["zoom"],
    10, 0,    // invisible below zoom 10
    11, 1,    // fully visible at zoom 11+
  ],
};

// ─── Filter expressions ───────────────────────────────────────────────────────

// Labels only appear for active turbines (inactive/decommissioned are unlabeled
// to reduce clutter when the overlay is shown with most turbines inactive).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TURBINE_LABELS_FILTER: any[] = [
  "==", ["get", "status"], "active",
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TurbineLayerProps {
  /**
   * Filter turbine markers to a specific mission.
   * Omit or pass `null` for a fleet-wide turbine overlay.
   */
  missionId?: string | null;

  /**
   * When true, renders the accessible HTML fallback (turbine list) instead of
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
   * Show the in-map toggle button for the turbines layer.
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
 * TurbineLayer — wind turbine site markers overlay for the INVENTORY map.
 *
 * When the `turbines` toggle in the `LayerEngine` is OFF → returns null.
 * When the `turbines` toggle is ON:
 *   - Inside a react-map-gl <Map>: renders Mapbox GL circle + symbol layers.
 *   - Fallback mode (no Mapbox token): renders an accessible HTML turbine list.
 *
 * Requires a `<LayerEngineProvider>` ancestor.
 *
 * The component is wrapped in `React.memo` — it only re-renders when its
 * props change or the underlying hook data changes, avoiding unnecessary
 * Mapbox GL source re-ingestion.
 */
export const TurbineLayer = memo(function TurbineLayer({
  missionId,
  fallbackMode  = false,
  showLegend    = true,
  showToggle    = false,
  className,
}: TurbineLayerProps) {
  // ── Turbine data + activation state ──────────────────────────────────────
  //
  // useTurbineLayer reads `state.turbines` from the LayerEngine and conditionally
  // subscribes to the Convex turbine data.  When the toggle is off, turbinesGeoJSON
  // is the stable empty FeatureCollection (no subscription in flight).
  const {
    isActive,
    turbinesGeoJSON,
    isLoading,
    turbineCount,
    activeCount,
  } = useTurbineLayer({
    missionId: missionId ?? undefined,
  });

  // ── Engine toggle dispatcher ──────────────────────────────────────────────
  //
  // Used by the optional in-map toggle button.
  const { toggle } = useSharedLayerEngine();

  const handleToggle = useCallback(() => {
    toggle("turbines");
  }, [toggle]);

  // ── Toggle control element (shared across both render modes) ──────────────
  const toggleElement = showToggle ? (
    <button
      type="button"
      className={styles.toggleControl}
      data-active={isActive ? "true" : undefined}
      onClick={handleToggle}
      aria-pressed={isActive}
      aria-label={`${isActive ? "Hide" : "Show"} turbine site markers`}
      data-testid="turbine-layer-toggle"
    >
      <span className={styles.toggleDot} aria-hidden="true" />
      <span>Turbines</span>
    </button>
  ) : null;

  // ── Early exit — turbines layer toggled off ───────────────────────────────
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
      data-testid="turbine-layer-legend"
      aria-label="Turbine site markers legend"
      role="region"
    >
      <span className={styles.legendTitle} aria-hidden="true">
        Turbines
      </span>

      {/* Visual legend items — three status levels */}
      <ul className={styles.legendItems} aria-label="Turbine status legend">
        <li className={styles.legendItem}>
          <span
            className={[styles.legendDotSwatch, styles.legendDotSwatchActive].join(" ")}
            aria-hidden="true"
          />
          <span>Active</span>
        </li>
        <li className={styles.legendItem}>
          <span
            className={[styles.legendDotSwatch, styles.legendDotSwatchInactive].join(" ")}
            aria-hidden="true"
          />
          <span>Inactive</span>
        </li>
        <li className={styles.legendItem}>
          <span
            className={[styles.legendDotSwatch, styles.legendDotSwatchDecommissioned].join(" ")}
            aria-hidden="true"
          />
          <span>Decommissioned</span>
        </li>
      </ul>

      {/* Live turbine count — updates via Convex subscription */}
      <span
        className={styles.legendCount}
        aria-live="polite"
        aria-atomic="true"
        data-loading={isLoading ? "true" : undefined}
        data-testid="turbine-layer-count"
      >
        {isLoading ? (
          <span
            className={styles.legendCountLoading}
            aria-label="Loading turbine data"
          />
        ) : (
          <span
            aria-label={
              `${activeCount} active turbine${activeCount !== 1 ? "s" : ""} ` +
              `of ${turbineCount} total`
            }
          >
            {activeCount} active / {turbineCount} total
          </span>
        )}
      </span>
    </div>
  ) : null;

  // ── Fallback mode (no Mapbox token) ───────────────────────────────────────
  //
  // When `fallbackMode` is true, render an accessible HTML turbine list.
  // This allows operators to verify the Convex subscription is active even
  // in environments without a Mapbox access token.
  if (fallbackMode) {
    // Extract turbine data from the GeoJSON for the fallback list.
    // Show up to 10 turbines in the list.
    const turbineItems = turbinesGeoJSON.features.slice(0, 10).map((f) => ({
      turbineId: f.properties.turbineId,
      name:      f.properties.name,
      status:    f.properties.status,
      siteCode:  f.properties.siteCode,
      lat:       f.geometry.coordinates[1],
      lng:       f.geometry.coordinates[0],
    }));

    const moreCount = Math.max(0, turbineCount - turbineItems.length);

    return (
      <>
        {toggleElement}
        <div
          className={styles.fallback}
          data-testid="turbine-layer-fallback"
          role="region"
          aria-label="Turbine site markers"
        >
          <div className={styles.fallbackHeader}>
            <span className={styles.fallbackBadge} aria-hidden="true">
              Turbines
            </span>
            <span className={styles.fallbackTitle}>Site Markers</span>
            <span
              className={styles.fallbackCount}
              aria-live="polite"
              aria-atomic="true"
            >
              {isLoading
                ? "Loading…"
                : `${turbineCount} turbine${turbineCount !== 1 ? "s" : ""}`}
            </span>
          </div>

          {turbineItems.length > 0 && (
            <ul
              className={styles.fallbackTurbineList}
              aria-label={`${turbineCount} turbine site marker${turbineCount !== 1 ? "s" : ""}`}
            >
              {turbineItems.map((turbine) => (
                <li
                  key={turbine.turbineId}
                  className={styles.fallbackTurbineItem}
                  data-status={turbine.status}
                >
                  <span className={styles.fallbackTurbineLabel}>
                    {turbine.name}
                  </span>
                  <span className={styles.fallbackTurbineMeta}>
                    {turbine.siteCode ? `${turbine.siteCode} · ` : ""}
                    {turbine.lat.toFixed(4)}, {turbine.lng.toFixed(4)}
                  </span>
                  <span className={styles.fallbackTurbineStatus}>
                    {turbine.status}
                  </span>
                </li>
              ))}
              {moreCount > 0 && (
                <li className={styles.fallbackTurbineMore}>
                  +{moreCount} more turbine{moreCount !== 1 ? "s" : ""}
                </li>
              )}
            </ul>
          )}

          {turbineItems.length === 0 && !isLoading && (
            <p className={styles.fallbackTurbineMore}>
              No turbine sites configured.
            </p>
          )}
        </div>
      </>
    );
  }

  // ── Mapbox GL mode (standard path) ────────────────────────────────────────
  //
  // Render two Mapbox GL layers on a single GeoJSON source:
  //   1. Circle layer — status-colored filled circles (all zoom levels)
  //   2. Symbol (text) layer — turbine name labels (zoom ≥ 10, active only)
  //
  // Layer ordering (beforeId): turbine markers render above trail lines but
  // below case pins.  "waterway-label" is a reliable anchor in all Mapbox styles.
  return (
    <>
      {/* In-map toggle button (optional) */}
      {toggleElement}

      {/* ── Turbines GeoJSON source + layers ── */}
      <Source
        id={TURBINE_SOURCE_ID}
        type="geojson"
        data={turbinesGeoJSON}
        // cluster: false — turbines are sparse enough that individual markers
        // are always visible; clustering would hide the turbine-case spatial correlation
        cluster={false}
      >
        {/* Circle markers — status-colored, visible at all zoom levels */}
        <Layer
          id={TURBINE_CIRCLES_LAYER_ID}
          type="circle"
          source={TURBINE_SOURCE_ID}
          paint={TURBINE_CIRCLES_PAINT}
          // Render above trail lines (waterway-label anchor) but below case pins
          beforeId="waterway-label"
        />

        {/* Text labels — turbine name, visible at zoom ≥ 10, active turbines only */}
        <Layer
          id={TURBINE_LABELS_LAYER_ID}
          type="symbol"
          source={TURBINE_SOURCE_ID}
          layout={TURBINE_LABELS_LAYOUT}
          paint={TURBINE_LABELS_PAINT}
          filter={TURBINE_LABELS_FILTER}
          // Labels render above circles but still below case pins
          beforeId="waterway-label"
        />
      </Source>

      {/* Legend rendered outside the Source/Layer tree so it renders as DOM */}
      {legendElement}
    </>
  );
});

TurbineLayer.displayName = "TurbineLayer";

export default TurbineLayer;
