/**
 * HeatMapCanvas — Self-contained Mapbox GL JS map with heat density overlay.
 *
 * This component provides the complete heat map overlay implementation:
 *   1. A react-map-gl <Map> instance with a sensible default viewport.
 *   2. The <HeatLayer> as a child — subscribes to Convex case-pin data when
 *      the heat toggle is ON, renders a Mapbox GL heatmap Source+Layer.
 *   3. An in-map toggle button that drives the LayerEngine `heat` state.
 *   4. A live density legend floating in the map corner.
 *
 * The toggle drives the shared `LayerEngine` state via `useSharedLayerEngine()`.
 * This ensures the heat toggle is reflected in any other UI element that reads
 * the same engine (e.g., the LayerTogglePanelConnected panel in M1/M2 toolbars).
 *
 * When `mapboxToken` is not provided, the component renders an accessible
 * HTML fallback showing the live heat data without the map background.
 *
 * Architecture
 * ────────────
 * The component must be rendered inside a `<LayerEngineProvider>`.
 * <HeatLayer> reads `state.heat` from the shared engine and conditionally
 * subscribes to Convex case pin data.  When heat is OFF, no subscription is
 * active and no Mapbox GL source/layer is registered.
 *
 * Data flow:
 *   useSharedLayerEngine() → state.heat
 *     → useHeatLayer() → useMapCasePins() → Convex getM1MapData
 *     → GeoJSON FeatureCollection
 *     → react-map-gl <Source> + <Layer> (heatmap type)
 *     → Mapbox GL JS renders density heatmap on the map canvas
 *
 * Design tokens: all colors via CSS custom properties (var(--*)), no hex literals.
 * Typography: Inter Tight for UI, IBM Plex Mono for data labels.
 * WCAG AA contrast in both light and dark themes.
 *
 * Usage
 * ─────
 * @example
 * // Inside a LayerEngineProvider:
 * <HeatMapCanvas
 *   mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
 *   missionId={selectedMissionId}
 *   initialViewState={{ longitude: -98.35, latitude: 39.5, zoom: 4 }}
 * />
 *
 * Requires:
 *   - `<LayerEngineProvider>` ancestor
 *   - react-map-gl ≥ 7.x (peer dependency)
 *   - mapbox-gl ≥ 3.x (peer dependency of react-map-gl)
 */

"use client";

import { memo, useCallback, useState } from "react";
import { Map as MapboxMap, NavigationControl } from "react-map-gl";
import { HeatLayer } from "./HeatLayer";
import { HistoryTrailLayer } from "./HistoryTrailLayer";
import { useSharedLayerEngine } from "@/providers/layer-engine-provider";
import { useIsDark } from "@/providers/theme-provider";
import styles from "./HeatMapCanvas.module.css";

// ─── Default viewport ─────────────────────────────────────────────────────────

/**
 * Default viewport centered on the continental USA.
 * Zoom level 4 shows all 48 states without clipping.
 * Users can pan/zoom freely via the NavigationControl.
 */
const DEFAULT_VIEW_STATE = {
  longitude: -98.35,
  latitude:  39.5,
  zoom:      4,
};

/**
 * Mapbox base map style URLs.
 *
 * HeatMapCanvas uses "outdoors" as its light theme base — terrain and
 * topographic context aids heat density interpretation for field operations.
 * In dark theme we switch to "dark-v11" so the heat overlay pops against
 * the dark base map.  The active style is resolved at render time via
 * useIsDark() and passed to the react-map-gl <Map> mapStyle prop.
 *
 * Dark mode heat ramp values are pre-configured in base.css §5d §5h —
 * they use higher saturation stops for better visibility against dark tiles.
 */
const MAP_STYLE_LIGHT = "mapbox://styles/mapbox/outdoors-v12";
const MAP_STYLE_DARK  = "mapbox://styles/mapbox/dark-v11";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface HeatMapCanvasProps {
  /**
   * Mapbox access token.
   * When absent, renders the accessible fallback (no map tiles).
   */
  mapboxToken?: string;

  /**
   * Filter the heat overlay to cases on a specific mission.
   * Omit or pass `null` for a global (all-missions) overlay.
   */
  missionId?: string | null;

  /**
   * Filter the heat overlay to cases assigned to a specific technician.
   * Omit or pass `null` for all assignees.
   */
  assigneeId?: string | null;

  /**
   * Initial map viewport.  Defaults to continental USA zoom-4 view.
   */
  initialViewState?: {
    longitude: number;
    latitude: number;
    zoom: number;
  };

  /**
   * CSS class applied to the outermost container.
   * Use for layout positioning (height, width, etc.).
   */
  className?: string;

  /**
   * Accessible label for the map region.
   * @default "Heat density map"
   */
  "aria-label"?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * HeatMapCanvas — Mapbox GL map with integrated heat density overlay.
 *
 * Renders:
 *   - A full react-map-gl <Map> with NavigationControl
 *   - <HeatLayer> inside the map (auto-subscribes to Convex when heat is ON)
 *   - An in-canvas toggle button for the heat layer (bottom-right)
 *
 * Requires a <LayerEngineProvider> ancestor.
 */
export const HeatMapCanvas = memo(function HeatMapCanvas({
  mapboxToken,
  missionId,
  assigneeId,
  initialViewState = DEFAULT_VIEW_STATE,
  className,
  "aria-label": ariaLabel = "Heat density map",
}: HeatMapCanvasProps) {
  // ── Dark mode — Mapbox style switching ────────────────────────────────────────
  //
  // useIsDark() reads the ThemeContext set by ThemeProvider.  When isDark is true,
  // the dark Mapbox style ("dark-v11") is passed to the <Map> mapStyle prop so
  // the base map tiles match the overall dark UI theme.
  //
  // The heat ramp tokens in base.css §5h already override --map-m2-heat-* to
  // higher-saturation stops for dark mode — no additional JS logic is needed
  // for the heatmap colours themselves.
  const isDark    = useIsDark();
  const mapStyle  = isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;

  // ── Layer engine — heat toggle ─────────────────────────────────────────────
  //
  // `state.heat` controls whether <HeatLayer> subscribes to Convex and renders
  // the Mapbox GL heatmap source/layer.  Toggling via `toggle("heat")` updates
  // the shared engine, which propagates to any other consumer (e.g., the
  // LayerTogglePanelConnected panel in M1/M2 toolbars).
  const { state, toggle } = useSharedLayerEngine();
  const heatActive = state.heat;

  const handleHeatToggle = useCallback(() => {
    toggle("heat");
  }, [toggle]);

  // ── Mapbox fallback ────────────────────────────────────────────────────────

  if (!mapboxToken) {
    return (
      <div
        className={[styles.root, styles.fallbackRoot, className].filter(Boolean).join(" ")}
        role="region"
        aria-label={ariaLabel}
        data-heat-active={heatActive ? "true" : "false"}
      >
        {/* Fallback header */}
        <div className={styles.fallbackHeader}>
          <span className={styles.fallbackTitle}>Activity Density</span>
          <span className={styles.fallbackHint}>
            Set{" "}
            <code className={styles.fallbackCode}>NEXT_PUBLIC_MAPBOX_TOKEN</code>
            {" "}to enable the map
          </span>
        </div>

        {/* Heat toggle in fallback mode */}
        <button
          type="button"
          className={[
            styles.heatToggle,
            heatActive ? styles.heatToggleActive : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={handleHeatToggle}
          aria-pressed={heatActive}
          aria-label={heatActive ? "Disable heat density overlay" : "Enable heat density overlay"}
          data-testid="heat-map-canvas-toggle"
        >
          <span className={styles.heatToggleIcon} aria-hidden="true" />
          <span className={styles.heatToggleLabel}>
            {heatActive ? "Heat: On" : "Heat: Off"}
          </span>
        </button>

        {/* HeatLayer fallback — HTML summary when no Mapbox token */}
        <HeatLayer
          missionId={missionId}
          assigneeId={assigneeId}
          fallbackMode={true}
          showLegend={false}
        />

        {/* HistoryTrailLayer fallback — HTML trail list when no Mapbox token.
            Reads `state.history` from the LayerEngine; renders only when ON. */}
        <HistoryTrailLayer
          missionId={missionId}
          fallbackMode={true}
          showLegend={false}
          showToggle={true}
        />
      </div>
    );
  }

  // ── Full Mapbox GL map ─────────────────────────────────────────────────────

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      role="region"
      aria-label={ariaLabel}
      data-heat-active={heatActive ? "true" : "false"}
    >
      {/* react-map-gl Map instance.
          HeatLayer and HistoryTrailLayer are children — they register their
          Source + Layer pairs inside the Map's GL context when their respective
          toggles are ON.  When OFF, they return null (no subscription, no GL
          resources). */}
      <MapboxMap
        mapboxAccessToken={mapboxToken}
        initialViewState={initialViewState}
        style={{ width: "100%", height: "100%" }}
        mapStyle={mapStyle}
        attributionControl={false}
        reuseMaps={true}
      >
        {/* Navigation controls — zoom in/out, compass reset */}
        <NavigationControl position="top-left" />

        {/* Heat density layer.
            Reads `state.heat` from the LayerEngine context.
            When ON: subscribes to Convex case pins + renders Mapbox heatmap.
            When OFF: returns null (no subscription, no GPU texture). */}
        <HeatLayer
          missionId={missionId}
          assigneeId={assigneeId}
          showLegend={true}
        />

        {/* History trails layer.
            Reads `state.history` from the LayerEngine context.
            When ON: subscribes to Convex scan history + renders Mapbox
            line (path) and circle (waypoint) layers.
            When OFF: returns null (no subscription, no GL resources).
            showToggle=true renders an in-map toggle button. */}
        <HistoryTrailLayer
          missionId={missionId}
          showLegend={true}
          showToggle={true}
        />
      </MapboxMap>

      {/* ── In-map heat toggle button ──────────────────────────────────────────
          Positioned in the bottom-right corner of the map canvas.
          Drives the LayerEngine `heat` toggle — same as the LayerTogglePanel
          heat row — so both controls stay in sync automatically.
          Keyboard accessible: focusable, role="button", aria-pressed.
      */}
      <button
        type="button"
        className={[
          styles.heatToggle,
          heatActive ? styles.heatToggleActive : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={handleHeatToggle}
        aria-pressed={heatActive}
        aria-label={heatActive ? "Disable heat density overlay" : "Enable heat density overlay"}
        data-testid="heat-map-canvas-toggle"
      >
        <span className={styles.heatToggleIcon} aria-hidden="true" />
        <span className={styles.heatToggleLabel}>
          {heatActive ? "Heat" : "Heat"}
        </span>
        <span
          className={[
            styles.heatTogglePip,
            heatActive ? styles.heatTogglePipOn : styles.heatTogglePipOff,
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        />
      </button>
    </div>
  );
});

HeatMapCanvas.displayName = "HeatMapCanvas";

export default HeatMapCanvas;
