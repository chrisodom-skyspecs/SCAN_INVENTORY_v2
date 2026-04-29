/**
 * HeatLayer — Mapbox GL JS density heat overlay for the INVENTORY map.
 *
 * Renders a density heatmap over case locations.  The layer is driven by the
 * `heat` toggle in the shared `LayerEngine`; when the toggle is off the
 * component returns `null` and no Mapbox source/layer is registered.
 *
 * Architecture
 * ────────────
 * 1. `useHeatLayer(args)` — subscriptions hook.
 *      - Reads `state.heat` from the LayerEngine context.
 *      - When active: subscribes to `useMapCasePins` (Convex real-time).
 *      - When inactive: skips the Convex subscription.
 *      - Derives a GeoJSON FeatureCollection from the live pin data.
 *
 * 2. `<HeatLayer>` — renders a react-map-gl `<Source>` + `<Layer>` when active.
 *      - Source type: "geojson" (Mapbox clusters for large datasets).
 *      - Layer type: "heatmap" with the §5d M2 density color ramp.
 *      - Returns `null` when the heat toggle is off — no DOM node, no GL resource.
 *
 * Color ramp
 * ──────────
 * The heatmap color expression uses the HEAT_COLOR_RAMP from
 * `@/lib/heat-layer-colors`, which mirrors the `--map-m2-heat-*` CSS tokens
 * defined in §5d of base.css.  Values are HSLA strings (not hex).
 *
 * Density weighting
 * ─────────────────
 * Flagged cases contribute `weight: 3` vs. `weight: 1` for normal cases,
 * so damage/inspection hotspots are visible even in sparse regions.
 * The `heatmap-weight` expression reads the `weight` GeoJSON property.
 *
 * Fallback (no Mapbox token)
 * ──────────────────────────
 * When `mapboxToken` is not provided, the component renders an accessible
 * HTML summary table instead of a Mapbox layer.  This shows the active
 * heat data (point count, top-weighted location) as text so operators can
 * verify the subscription is working in environments without a map token.
 *
 * Usage (inside a react-map-gl <Map> component)
 * ─────────────────────────────────────────────
 * @example
 * import { Map } from "react-map-gl";
 * import { HeatLayer } from "@/components/Map/HeatLayer";
 *
 * function MyMap() {
 *   return (
 *     <Map mapboxApiAccessToken={MAPBOX_TOKEN} ...>
 *       <HeatLayer />
 *     </Map>
 *   );
 * }
 *
 * Design constraints
 * ──────────────────
 * - All colors via CSS tokens (var(--*)) or HSLA strings from heat-layer-colors.ts
 * - No hex literals in this file or its CSS module
 * - WCAG AA contrast in both light and dark themes
 * - Keyboard-navigable legend (role="list", aria-label)
 * - Reduced motion: no animation added by this component
 *
 * Requires:
 *   - `<LayerEngineProvider>` ancestor (throws without it)
 *   - react-map-gl ≥ 7.x (Source + Layer from "react-map-gl")
 *   - mapbox-gl ≥ 3.x (peer dependency of react-map-gl)
 */

"use client";

import { memo, useMemo } from "react";
import { Source, Layer } from "react-map-gl";
import type { HeatmapLayer as MapboxHeatmapLayer } from "react-map-gl";
import {
  buildHeatColorExpression,
  buildHeatWeightExpression,
  HEAT_SWATCH_COLORS,
} from "@/lib/heat-layer-colors";
import { useHeatLayer } from "@/hooks/use-heat-layer";
import styles from "./HeatLayer.module.css";

// ─── Layer IDs ────────────────────────────────────────────────────────────────

/**
 * Stable Mapbox GL layer/source ID for the heat density layer.
 * Must not clash with any other layer IDs in the map.
 */
const HEAT_SOURCE_ID = "inventory-heat-source";
const HEAT_LAYER_ID  = "inventory-heat-layer";

// ─── Mapbox paint spec ────────────────────────────────────────────────────────

/**
 * Mapbox GL JS `heatmap` layer paint spec.
 *
 * heatmap-color:     viridis-style color ramp from §5d M2 heat tokens
 * heatmap-weight:    driven by the `weight` property in each GeoJSON feature
 *                    (3 for flagged, 1 for all other statuses)
 * heatmap-radius:    spatial influence radius in pixels (zoom-dependent)
 * heatmap-intensity: overall multiplier; 1.5 at high zoom to show hotspots
 * heatmap-opacity:   0.85 to keep the underlying map features legible
 *
 * All values must be static (computed once at module scope) so Mapbox GL JS
 * does not need to re-parse the expression on every render.
 */
/** Heatmap paint: react-map-gl's MapboxHeatmapLayer["paint"] omits heatmap-* keys — assert full Mapbox paint shape. */
const HEAT_PAINT = {
  "heatmap-color":     buildHeatColorExpression(),
  "heatmap-weight":    buildHeatWeightExpression(3),
  "heatmap-radius":    [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,  15,
    8,  25,
    12, 40,
    16, 60,
  ],
  "heatmap-intensity": [
    "interpolate",
    ["linear"],
    ["zoom"],
    3,  0.6,
    10, 1.0,
    14, 1.5,
  ],
  "heatmap-opacity":   0.85,
} as unknown as NonNullable<MapboxHeatmapLayer["paint"]>;

// ─── Legend labels ─────────────────────────────────────────────────────────────

const LEGEND_LABELS = [
  { label: "Very low",    index: 0 },
  { label: "Low",         index: 1 },
  { label: "Medium-low",  index: 2 },
  { label: "Medium",      index: 3 },
  { label: "Medium-high", index: 4 },
  { label: "High",        index: 5 },
  { label: "Very high",   index: 6 },
  { label: "Peak",        index: 7 },
] as const;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface HeatLayerProps {
  /**
   * Filter the heat overlay to cases on a specific mission.
   * Omit or pass `null` for a global (all-missions) heat overlay.
   */
  missionId?: string | null;

  /**
   * Filter the heat overlay to cases assigned to a specific technician.
   * Omit or pass `null` for all assignees.
   */
  assigneeId?: string | null;

  /**
   * When true, renders the accessible HTML fallback (legend + count) instead
   * of a Mapbox GL source/layer.  Use this when no Mapbox token is configured.
   *
   * The fallback is intentionally basic — it conveys "heat layer is active
   * with N points" without needing a full map rendering pipeline.
   *
   * @default false
   */
  fallbackMode?: boolean;

  /**
   * Show the density legend overlay floating over the map.
   *
   * When `false` the legend is suppressed (useful when the map already has
   * a shared legend panel).
   *
   * @default true
   */
  showLegend?: boolean;

  /**
   * Additional CSS class applied to the wrapping legend element.
   * Use for layout positioning (e.g., `position: absolute; bottom: 1rem`).
   */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * HeatLayer — density heatmap overlay for the INVENTORY map.
 *
 * When the `heat` toggle in the `LayerEngine` is OFF → returns null.
 * When the `heat` toggle is ON:
 *   - Inside a react-map-gl <Map>: renders a Mapbox GL heatmap source + layer.
 *   - Fallback mode (no Mapbox token): renders an accessible HTML summary.
 *
 * Requires a `<LayerEngineProvider>` ancestor.
 *
 * The component is wrapped in `React.memo` — it only re-renders when its
 * props change or the underlying hook data changes, avoiding unnecessary
 * Mapbox GL source re-ingestion.
 */
export const HeatLayer = memo(function HeatLayer({
  missionId,
  assigneeId,
  fallbackMode = false,
  showLegend   = true,
  className,
}: HeatLayerProps) {
  // ── Heat layer data + activation state ───────────────────────────────────
  //
  // useHeatLayer reads `state.heat` from the LayerEngine and conditionally
  // subscribes to the Convex pin data.  When the toggle is off, geojsonData
  // is the stable empty FeatureCollection (no subscription in flight).
  const { isActive, geojsonData, isLoading, pointCount } = useHeatLayer({
    missionId:  missionId  ?? undefined,
    assigneeId: assigneeId ?? undefined,
  });

  // ── Early exit — heat layer toggled off ───────────────────────────────────
  //
  // Returning null removes the <Source> + <Layer> from the Mapbox GL map,
  // which correctly deallocates the GPU texture for the heatmap.
  if (!isActive) return null;

  // ── Legend element (shared by both modes) ─────────────────────────────────
  //
  // Rendered conditionally based on `showLegend`.  The legend is keyboard-
  // navigable and screen-reader-accessible per WCAG SC 1.3.1.
  const legendElement = showLegend ? (
    <div
      className={[styles.legend, className].filter(Boolean).join(" ")}
      data-testid="heat-layer-legend"
      aria-label="Heat map density legend"
      role="region"
    >
      <span className={styles.legendTitle} aria-hidden="true">
        Density
      </span>

      {/* Gradient swatch — visual only, aria-hidden */}
      <div
        className={styles.legendGradient}
        aria-hidden="true"
        data-testid="heat-layer-gradient"
      />

      {/* Scale labels */}
      <div className={styles.legendScale} aria-hidden="true">
        <span className={styles.legendScaleLow}>Low</span>
        <span className={styles.legendScaleHigh}>High</span>
      </div>

      {/* Accessible legend list (screen-reader) */}
      <ul className={styles.srOnly} aria-label="Heat density scale">
        {LEGEND_LABELS.map(({ label, index }) => (
          <li key={label}>
            <span
              style={{ backgroundColor: HEAT_SWATCH_COLORS[index] }}
              aria-hidden="true"
              className={styles.srSwatch}
            />
            {label} density
          </li>
        ))}
      </ul>

      {/* Point count — live update via Convex */}
      <span
        className={styles.legendCount}
        aria-live="polite"
        aria-atomic="true"
        data-loading={isLoading ? "true" : undefined}
        data-testid="heat-layer-count"
      >
        {isLoading ? (
          <span className={styles.legendCountLoading} aria-label="Loading heat data" />
        ) : (
          <span aria-label={`${pointCount} case location${pointCount !== 1 ? "s" : ""} in heat overlay`}>
            {pointCount} pt{pointCount !== 1 ? "s" : ""}
          </span>
        )}
      </span>
    </div>
  ) : null;

  // ── Fallback mode (no Mapbox token) ──────────────────────────────────────
  //
  // When `fallbackMode` is true, skip react-map-gl Source/Layer (which
  // require a Mapbox map instance) and render an HTML summary table.
  if (fallbackMode) {
    return (
      <div
        className={styles.fallback}
        data-testid="heat-layer-fallback"
        role="region"
        aria-label="Heat layer density summary"
      >
        <div className={styles.fallbackHeader}>
          <span className={styles.fallbackBadge} aria-hidden="true">
            Heat
          </span>
          <span className={styles.fallbackTitle}>Activity Density</span>
          <span
            className={styles.fallbackCount}
            aria-live="polite"
            aria-atomic="true"
          >
            {isLoading
              ? "Loading…"
              : `${pointCount} location${pointCount !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* Inline legend swatches */}
        <div className={styles.fallbackSwatches} aria-label="Density scale">
          {LEGEND_LABELS.map(({ label, index }) => (
            <div
              key={label}
              className={styles.fallbackSwatch}
              data-testid={`heat-swatch-${index}`}
            >
              {/* CSS custom property for swatch color — no hex literal */}
              <span
                className={styles.fallbackSwatchDot}
                style={{ background: `var(--map-m2-swatch-${index + 1})` }}
                aria-hidden="true"
              />
              <span className={styles.fallbackSwatchLabel}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Mapbox GL mode (standard path) ────────────────────────────────────────
  //
  // Render a react-map-gl Source + Layer pair inside the parent Map component.
  // The Source re-ingests data only when `geojsonData` reference changes, which
  // only happens when the Convex subscription delivers a new pin set.
  return (
    <>
      <Source
        id={HEAT_SOURCE_ID}
        type="geojson"
        data={geojsonData}
        // No clustering on the source — the heatmap layer handles density itself.
        // Clustering would cause points to merge and undercount density.
      >
        <Layer
          id={HEAT_LAYER_ID}
          type="heatmap"
          source={HEAT_SOURCE_ID}
          paint={HEAT_PAINT}
          // beforeId ensures the heat layer renders below pins/labels
          // but above the base map style layers.
          // "waterway-label" is a reliable anchor present in all Mapbox styles.
          beforeId="waterway-label"
        />
      </Source>

      {/* Legend rendered outside the Source/Layer tree so it renders as DOM */}
      {legendElement}
    </>
  );
});

HeatLayer.displayName = "HeatLayer";

export default HeatLayer;
