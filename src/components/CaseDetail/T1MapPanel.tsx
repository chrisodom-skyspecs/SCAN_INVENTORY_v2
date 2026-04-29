/**
 * T1MapPanel — Mini-map panel for the T1 Summary layout.
 *
 * Designed to occupy the left 50% of T1Shell's CSS grid (grid-template-columns:
 * 1fr 1fr).  Shows the case's last-known geographic position on a Mapbox
 * GL JS map via react-map-gl, with a status-colored pin at the case location.
 *
 * Grid placement:
 *   This component is a direct child of T1Shell's left panel cell.  The cell
 *   is a flex-column with min-height: 0 and overflow: hidden.  T1MapPanel's
 *   .root fills that cell with height: 100% + position: relative, providing
 *   the containing block for the absolute-positioned map canvas (inset: 0).
 *
 *   ┌─────────────────────┬─────────────────────┐
 *   │  T1MapPanel         │  Right panel        │
 *   │  (left 50%)         │  (right 50%)        │
 *   │  ┌───────────────┐  │                     │
 *   │  │  Mapbox map   │  │  Case identity +    │
 *   │  │  (abs fill)   │  │  operational data   │
 *   │  └───────────────┘  │                     │
 *   └─────────────────────┴─────────────────────┘
 *
 * Rendering modes:
 *   1. data === undefined (loading)  → skeleton shimmer placeholder
 *   2. data === null (not found)     → "No location" placeholder
 *   3. no lat/lng on case            → "No location data" placeholder
 *   4. no mapboxToken                → coordinate-text placeholder
 *   5. lat/lng + token               → react-map-gl Map + Marker
 *
 * Props:
 *   caseId       — Convex document ID for the case to locate.
 *   mapboxToken  — Optional Mapbox access token.  When absent, falls back
 *                  to a styled placeholder that still shows coordinate data.
 *
 * Design constraints:
 *   - No hex literals — all colors via CSS custom properties (var(--*))
 *   - WCAG AA contrast in both light and dark themes
 *   - Typography: Inter Tight (UI), IBM Plex Mono (coordinates)
 *   - Reduced motion: skeleton shimmer respects prefers-reduced-motion
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Map as MapboxMap, Marker } from "react-map-gl";
import { useIsDark } from "@/providers/theme-provider";
import type { CaseStatus } from "../../types/case-status";
import styles from "./T1MapPanel.module.css";

// ─── Mapbox style URLs ────────────────────────────────────────────────────────

/**
 * T1MapPanel uses the "light-v11" / "dark-v11" base style pair.
 * These are minimal styles that show terrain context without heavy road
 * labels, keeping the mini-map readable at compact sizes.
 */
const MAPBOX_STYLE_LIGHT = "mapbox://styles/mapbox/light-v11";
const MAPBOX_STYLE_DARK  = "mapbox://styles/mapbox/dark-v11";

/**
 * Default zoom for a case location map.
 * Zoom 11 shows roughly a 10km radius — enough context without getting too wide.
 */
const DEFAULT_CASE_ZOOM = 11;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface T1MapPanelProps {
  /** Convex document ID of the case to show on the map. */
  caseId: string;
  /**
   * Mapbox access token.  When absent, the map falls back to a styled
   * placeholder that displays the coordinate values as text.
   */
  mapboxToken?: string;
  /**
   * Optional CSS class applied to the root element for
   * caller-side composition overrides.
   */
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * formatCoord — formats a decimal degree to 4dp with a hemisphere suffix.
 *
 * @example formatCoord(42.2808, "lat") → "42.2808° N"
 * @example formatCoord(-83.7430, "lng") → "83.7430° W"
 */
function formatCoord(value: number, axis: "lat" | "lng"): string {
  const abs = Math.abs(value).toFixed(4);
  if (axis === "lat") {
    return `${abs}° ${value >= 0 ? "N" : "S"}`;
  }
  return `${abs}° ${value >= 0 ? "E" : "W"}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * T1MapSkeleton — shimmer placeholder shown while the Convex query is loading.
 * Preserves the left 50% panel proportions during the loading state.
 */
function T1MapSkeleton() {
  return (
    <div
      className={styles.skeleton}
      aria-busy="true"
      aria-label="Loading case location…"
      data-testid="t1-map-panel-skeleton"
    />
  );
}

/**
 * T1MapPlaceholder — generic fallback for cases where the map cannot render.
 * Shows a CSS pin icon, a title, and optional hint text.
 */
interface T1MapPlaceholderProps {
  title: string;
  hint?: string;
  /** Extra detail line (coordinate text, env variable name, etc.) */
  detail?: React.ReactNode;
  testId?: string;
}

function T1MapPlaceholder({ title, hint, detail, testId }: T1MapPlaceholderProps) {
  return (
    <div
      className={styles.placeholder}
      role="img"
      aria-label={`Map placeholder: ${title}`}
      data-testid={testId ?? "t1-map-panel-placeholder"}
    >
      <div className={styles.placeholderIcon} aria-hidden="true">
        <span className={styles.placeholderPinIcon} />
      </div>
      <p className={styles.placeholderTitle}>{title}</p>
      {hint && <p className={styles.placeholderText}>{hint}</p>}
      {detail && <p className={styles.placeholderText}>{detail}</p>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * T1MapPanel
 *
 * Renders a mini Mapbox GL JS map centred on the case's last-known lat/lng.
 * The map canvas is absolutely positioned within the component's root
 * (position: relative), which fills the entire left 50% cell of T1Shell.
 *
 * All conditional rendering states (loading, not-found, no-coords, no-token,
 * live-map) are handled inline so callers receive a single stable element
 * regardless of data or configuration state.
 */
export function T1MapPanel({ caseId, mapboxToken, className }: T1MapPanelProps) {
  // ── Convex data subscription ─────────────────────────────────────────────────
  //
  // useQuery subscribes to getCaseById via the Convex real-time transport.
  // The query result is:
  //   undefined — loading (subscription not yet resolved)
  //   null      — case not found (document deleted / invalid ID)
  //   CaseDoc   — hydrated case with optional lat/lng/locationName fields
  //
  // Convex re-evaluates this query within ~100–300 ms of any mutation that
  // touches the cases table (e.g., updateCaseLocation, checkIn, shipCase),
  // keeping the map pin position up-to-date in real time.
  const caseDoc = useQuery(api.cases.getCaseById, {
    caseId: caseId as Id<"cases">,
  });

  // ── Dark mode — Mapbox style ──────────────────────────────────────────────────
  //
  // Switches the Mapbox base map style when the theme changes.  ThemeProvider
  // adds/removes `.theme-dark` on <html>; useIsDark reads the JS-visible flag.
  const isDark    = useIsDark();
  const mapStyle  = isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT;

  // ── Root class ────────────────────────────────────────────────────────────────
  const rootClass = [styles.root, className].filter(Boolean).join(" ");

  // ── State 1: Loading ──────────────────────────────────────────────────────────
  if (caseDoc === undefined) {
    return (
      <div
        className={rootClass}
        data-testid="t1-map-panel"
        data-state="loading"
        aria-label="Case location map"
      >
        <T1MapSkeleton />
      </div>
    );
  }

  // ── State 2: Not found ────────────────────────────────────────────────────────
  if (caseDoc === null) {
    return (
      <div
        className={rootClass}
        data-testid="t1-map-panel"
        data-state="not-found"
        aria-label="Case location map"
      >
        <T1MapPlaceholder
          title="Case not found"
          hint="The case may have been deleted or the ID is invalid."
          testId="t1-map-panel-not-found"
        />
      </div>
    );
  }

  const { lat, lng, locationName, status } = caseDoc;
  const hasCoordinates = lat !== undefined && lng !== undefined;

  // ── State 3: No location data ─────────────────────────────────────────────────
  if (!hasCoordinates) {
    return (
      <div
        className={rootClass}
        data-testid="t1-map-panel"
        data-state="no-location"
        aria-label="Case location map"
      >
        <T1MapPlaceholder
          title="Location unavailable"
          hint="No coordinates on record for this case."
          testId="t1-map-panel-no-location"
        />
      </div>
    );
  }

  // lat and lng are defined beyond this point
  const caseLat = lat!;
  const caseLng = lng!;

  // ── State 4: Coordinates available, no Mapbox token ──────────────────────────
  if (!mapboxToken) {
    return (
      <div
        className={rootClass}
        data-testid="t1-map-panel"
        data-state="no-token"
        aria-label="Case location map"
      >
        <T1MapPlaceholder
          title="Map unavailable"
          hint="Set NEXT_PUBLIC_MAPBOX_TOKEN to enable the map."
          detail={
            <>
              <span>{formatCoord(caseLat, "lat")}</span>
              {" "}/{" "}
              <span>{formatCoord(caseLng, "lng")}</span>
              {locationName && <> — {locationName}</>}
            </>
          }
          testId="t1-map-panel-no-token"
        />
      </div>
    );
  }

  // ── State 5: Full map — coordinates + token ───────────────────────────────────

  return (
    <div
      className={rootClass}
      data-testid="t1-map-panel"
      data-state="map"
      data-lat={caseLat}
      data-lng={caseLng}
      aria-label={
        locationName
          ? `Case location map — ${locationName}`
          : `Case location map — ${formatCoord(caseLat, "lat")}, ${formatCoord(caseLng, "lng")}`
      }
    >
      {/* ── Map canvas — absolute fill within .root ────────────────────────────
          The .mapCanvas div provides width/height to react-map-gl's <Map>.
          react-map-gl requires the map's direct container to have explicit
          dimensions (via CSS width + height, not intrinsic sizing).
          .mapCanvas uses position: absolute + inset: 0 so it fills the
          positioning context established by .root without requiring a fixed
          pixel height. */}
      <div className={styles.mapCanvas}>
        <MapboxMap
          mapboxAccessToken={mapboxToken}
          initialViewState={{
            longitude: caseLng,
            latitude:  caseLat,
            zoom:      DEFAULT_CASE_ZOOM,
          }}
          style={{ width: "100%", height: "100%" }}
          mapStyle={mapStyle}
          /* Disable attribution control — the compact panel doesn't have
             room for the full Mapbox attribution text.  Attribution is still
             displayed via the URL in the parent page per Mapbox ToS. */
          attributionControl={false}
          /* reuseMaps prevents Mapbox GL from re-initialising the WebGL
             context on every React re-render, reducing GPU pressure. */
          reuseMaps={true}
        >
          {/* Case location marker — status-colored CSS pin */}
          <Marker
            longitude={caseLng}
            latitude={caseLat}
            anchor="bottom"
          >
            <div
              className={styles.caseMarker}
              aria-label={`Case location: ${locationName ?? `${formatCoord(caseLat, "lat")}, ${formatCoord(caseLng, "lng")}`}`}
              data-testid="t1-map-panel-marker"
            >
              <div
                className={styles.caseMarkerHead}
                data-status={(status as CaseStatus) ?? "hangar"}
              />
              <div className={styles.caseMarkerTail} aria-hidden="true" />
            </div>
          </Marker>
        </MapboxMap>
      </div>

      {/* ── Location overlay — floating info badge ─────────────────────────────
          Shows the locationName (if available) and coordinates as a legible
          badge anchored to the bottom of the map canvas.
          z-index 20 places it above map GL layers (elevation 0-15 in Mapbox
          GL default stacking) but below any overlay panels (z-index 30+). */}
      <div
        className={styles.locationOverlay}
        aria-label="Case location details"
        data-testid="t1-map-panel-overlay"
      >
        {locationName ? (
          <span className={styles.locationName}>{locationName}</span>
        ) : (
          <span className={styles.locationName} aria-label="Coordinates">
            {formatCoord(caseLat, "lat")}
          </span>
        )}
        <span className={styles.locationCoords} aria-label="Coordinates">
          {formatCoord(caseLat, "lat")}
          {" "}
          {formatCoord(caseLng, "lng")}
        </span>
      </div>
    </div>
  );
}

export default T1MapPanel;
