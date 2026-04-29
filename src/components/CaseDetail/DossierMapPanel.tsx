/**
 * DossierMapPanel — Map tab content for the T4 Tabbed Dossier.
 *
 * Implements Sub-AC 1: Map tab content panel with location/GPS data display,
 * case position markers, and geographic layout.
 *
 * Rendered in the "Map" tab of T4DossierShell when the FF_INV_REDESIGN feature
 * flag is active.  Provides a full-panel interactive Mapbox GL JS map centred
 * on the case's last-known location, with:
 *
 *   Map canvas       — react-map-gl (Mapbox GL JS), fills the panel edge-to-edge
 *   Location marker  — status-colored CSS pin at the case's lat/lng position
 *   Location overlay — floating badge (bottom-left) showing location name + coords
 *   GPS data strip   — below-map info row: lat, lng, accuracy, last updated
 *
 * Rendering states (matching T1MapPanel patterns):
 *   1. undefined (loading)  → skeleton shimmer placeholder
 *   2. null (not found)     → "Case not found" placeholder
 *   3. no lat/lng on case   → "Location unavailable" placeholder
 *   4. no mapboxToken       → coordinate-text panel (no map canvas)
 *   5. lat/lng + token      → full interactive map + GPS data strip
 *
 * Layout contract:
 *   DossierMapPanel is designed to be rendered inside T4DossierShell's
 *   tabPanel cell.  For the "map" tab, T4DossierShell applies a
 *   .tabPanelMap CSS class override that removes the standard 1.25rem
 *   padding and sets overflow: hidden — enabling the map canvas
 *   (position: absolute; inset: 0 within .mapContainer) to fill the cell
 *   fully without clipping artefacts from the parent padding.
 *
 *   The GPS data strip is rendered as a separate block BELOW the map canvas,
 *   within the same flex column (.mapRoot).  The map canvas takes all
 *   remaining space via `flex: 1`.
 *
 * Design constraints:
 *   - No hex literals — all colors via CSS custom properties (var(--*))
 *   - WCAG AA contrast in both light and dark themes
 *   - Typography: Inter Tight (UI), IBM Plex Mono (coordinate values)
 *   - Reduced motion: skeleton shimmer respects prefers-reduced-motion
 *   - Touch-friendly controls on mobile viewports
 *
 * Props:
 *   caseId      — Convex document ID for the case to locate on the map.
 *   mapboxToken — Optional Mapbox access token.  When absent, falls back to
 *                 a styled placeholder that still shows coordinate data.
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Map as MapboxMap, Marker } from "react-map-gl";
import { useIsDark } from "@/providers/theme-provider";
import type { CaseStatus } from "../../types/case-status";
import styles from "./DossierMapPanel.module.css";

// ─── Mapbox style URLs ────────────────────────────────────────────────────────

const MAPBOX_STYLE_LIGHT = "mapbox://styles/mapbox/streets-v12";
const MAPBOX_STYLE_DARK  = "mapbox://styles/mapbox/dark-v11";

/**
 * Default zoom level for the dossier case location map.
 * Zoom 12 shows roughly a 5km radius — more precise than the T1 mini-map
 * (zoom 11) since the panel is larger and the user expects more detail.
 */
const DEFAULT_CASE_ZOOM = 12;

// ─── Mapbox token ──────────────────────────────────────────────────────────────

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DossierMapPanelProps {
  /** Convex document ID of the case to show on the map. */
  caseId: string;
  /**
   * Mapbox access token.  When absent, the panel falls back to a
   * coordinate-text display that shows the GPS values without a map canvas.
   * Defaults to process.env.NEXT_PUBLIC_MAPBOX_TOKEN when not provided.
   */
  mapboxToken?: string;
}

// ─── Coordinate formatter ─────────────────────────────────────────────────────

/**
 * formatCoord — formats a decimal degree to 5dp with a hemisphere suffix.
 *
 * @example formatCoord(42.28082, "lat") → "42.28082° N"
 * @example formatCoord(-83.74304, "lng") → "83.74304° W"
 */
function formatCoord(value: number, axis: "lat" | "lng"): string {
  const abs = Math.abs(value).toFixed(5);
  if (axis === "lat") {
    return `${abs}° ${value >= 0 ? "N" : "S"}`;
  }
  return `${abs}° ${value >= 0 ? "E" : "W"}`;
}

/**
 * formatDecimalCoord — compact decimal representation for the GPS strip.
 *
 * @example formatDecimalCoord(42.28082, "lat") → "42.28082°"
 * @example formatDecimalCoord(-83.74304, "lng") → "-83.74304°"
 */
function formatDecimalCoord(value: number): string {
  return `${value.toFixed(5)}°`;
}

/**
 * formatTimestamp — formats an epoch-ms timestamp to a short date+time.
 */
function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * DossierMapSkeleton — shimmer placeholder shown while Convex query is loading.
 */
function DossierMapSkeleton() {
  return (
    <div
      className={styles.skeleton}
      aria-busy="true"
      aria-label="Loading case location map…"
      data-testid="dossier-map-skeleton"
    />
  );
}

/**
 * DossierMapPlaceholder — generic fallback for cases where the map cannot render.
 * Fills the panel space with a centered icon, title, and optional hint text.
 */
interface DossierMapPlaceholderProps {
  title: string;
  hint?: string;
  detail?: React.ReactNode;
  testId?: string;
}

function DossierMapPlaceholder({
  title,
  hint,
  detail,
  testId,
}: DossierMapPlaceholderProps) {
  return (
    <div
      className={styles.placeholder}
      role="img"
      aria-label={`Map placeholder: ${title}`}
      data-testid={testId ?? "dossier-map-placeholder"}
    >
      {/* Map pin icon — pure CSS */}
      <div className={styles.placeholderIconWrap} aria-hidden="true">
        <span className={styles.placeholderPinIcon} />
      </div>
      <p className={styles.placeholderTitle}>{title}</p>
      {hint && <p className={styles.placeholderHint}>{hint}</p>}
      {detail && <p className={styles.placeholderDetail}>{detail}</p>}
    </div>
  );
}

/**
 * GPSDataStrip — the below-map info row showing lat, lng, location, and update time.
 *
 * Displayed only in the live-map and no-token states.
 * Hides automatically when neither lat nor lng is available.
 */
interface GPSDataStripProps {
  lat: number;
  lng: number;
  locationName?: string;
  updatedAt: number;
}

function GPSDataStrip({ lat, lng, locationName, updatedAt }: GPSDataStripProps) {
  return (
    <div
      className={styles.gpsStrip}
      aria-label="GPS location data"
      data-testid="dossier-map-gps-strip"
    >
      {/* Latitude */}
      <div className={styles.gpsDataItem}>
        <span className={styles.gpsDataLabel}>Latitude</span>
        <span
          className={styles.gpsDataValue}
          aria-label={`Latitude: ${formatCoord(lat, "lat")}`}
        >
          {formatDecimalCoord(lat)}
        </span>
      </div>

      {/* Longitude */}
      <div className={styles.gpsDataItem}>
        <span className={styles.gpsDataLabel}>Longitude</span>
        <span
          className={styles.gpsDataValue}
          aria-label={`Longitude: ${formatCoord(lng, "lng")}`}
        >
          {formatDecimalCoord(lng)}
        </span>
      </div>

      {/* Location name (when available) */}
      {locationName && (
        <div className={styles.gpsDataItem}>
          <span className={styles.gpsDataLabel}>Location</span>
          <span className={styles.gpsDataValueText}>{locationName}</span>
        </div>
      )}

      {/* Last updated */}
      <div className={styles.gpsDataItem}>
        <span className={styles.gpsDataLabel}>Updated</span>
        <span
          className={styles.gpsDataValueTime}
          title={new Date(updatedAt).toISOString()}
        >
          {formatTimestamp(updatedAt)}
        </span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * DossierMapPanel
 *
 * Full-panel interactive map for the T4 Tabbed Dossier "Map" tab.
 *
 * Subscribes to getCaseById in real time via Convex — the map pin position
 * and GPS strip update within ~100–300 ms of any mutation that writes
 * lat/lng to the cases table (e.g., scanCheckIn with location enabled).
 *
 * The panel uses a two-section flex column:
 *   1. .mapContainer — fills all remaining flex space; contains the
 *      absolute-positioned MapboxMap canvas + location overlay badge
 *   2. .gpsStrip     — fixed-height data row at the bottom
 *
 * T4DossierShell applies `.tabPanelMap` to the tabPanel when "map" is
 * active, removing the standard 1.25rem padding so .mapRoot can fill
 * the cell edge-to-edge.
 */
export function DossierMapPanel({ caseId, mapboxToken }: DossierMapPanelProps) {
  // ── Convex real-time subscription ─────────────────────────────────────────
  //
  // getCaseById returns:
  //   undefined  — loading (subscription not yet resolved)
  //   null       — case not found (document deleted / invalid ID)
  //   CaseDoc    — hydrated document with optional lat/lng/locationName
  //
  // Convex re-evaluates within ~100–300 ms of any mutation that touches
  // the cases table (scanCheckIn, updateCaseLocation, etc.), keeping
  // the map pin and GPS strip current in real time.
  const caseDoc = useQuery(api.cases.getCaseById, {
    caseId: caseId as Id<"cases">,
  });

  // ── Dark mode ─────────────────────────────────────────────────────────────
  //
  // Switches between light and dark Mapbox base styles when .theme-dark
  // is toggled on the html element.  useIsDark reads the JS-visible flag
  // maintained by ThemeProvider.
  const isDark   = useIsDark();
  const mapStyle = isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT;

  // ── Resolved token ────────────────────────────────────────────────────────
  //
  // mapboxToken prop takes precedence; env var is the default source.
  // Allows tests to inject a token without touching process.env.
  const resolvedToken = mapboxToken ?? MAPBOX_TOKEN;

  // ── State 1: Loading ──────────────────────────────────────────────────────
  if (caseDoc === undefined) {
    return (
      <div
        className={styles.mapRoot}
        data-testid="dossier-map-panel"
        data-state="loading"
        aria-label="Case location map"
      >
        <DossierMapSkeleton />
      </div>
    );
  }

  // ── State 2: Not found ────────────────────────────────────────────────────
  if (caseDoc === null) {
    return (
      <div
        className={styles.mapRoot}
        data-testid="dossier-map-panel"
        data-state="not-found"
        aria-label="Case location map"
      >
        <DossierMapPlaceholder
          title="Case not found"
          hint="The case may have been deleted or the ID is invalid."
          testId="dossier-map-not-found"
        />
      </div>
    );
  }

  const { lat, lng, locationName, status, updatedAt } = caseDoc;
  const hasCoordinates = lat !== undefined && lat !== null &&
                         lng !== undefined && lng !== null;

  // ── State 3: No location data ─────────────────────────────────────────────
  if (!hasCoordinates) {
    return (
      <div
        className={styles.mapRoot}
        data-testid="dossier-map-panel"
        data-state="no-location"
        aria-label="Case location map"
      >
        <DossierMapPlaceholder
          title="Location unavailable"
          hint="No GPS coordinates on record for this case. Use the Check In action in the SCAN app with location capture enabled to record the case position."
          testId="dossier-map-no-location"
        />
      </div>
    );
  }

  // lat and lng are defined beyond this point
  const caseLat = lat!;
  const caseLng = lng!;

  // ── State 4: Coordinates present but no Mapbox token ─────────────────────
  if (!resolvedToken) {
    return (
      <div
        className={styles.mapRoot}
        data-testid="dossier-map-panel"
        data-state="no-token"
        aria-label="Case location map"
      >
        <DossierMapPlaceholder
          title="Map unavailable"
          hint="Set NEXT_PUBLIC_MAPBOX_TOKEN to enable the interactive map."
          detail={
            <>
              {formatCoord(caseLat, "lat")}
              {" / "}
              {formatCoord(caseLng, "lng")}
              {locationName && <> — {locationName}</>}
            </>
          }
          testId="dossier-map-no-token"
        />
        {/* GPS data strip is still useful without the map canvas */}
        <GPSDataStrip
          lat={caseLat}
          lng={caseLng}
          locationName={locationName}
          updatedAt={updatedAt}
        />
      </div>
    );
  }

  // ── State 5: Full map — coordinates + token ───────────────────────────────

  return (
    <div
      className={styles.mapRoot}
      data-testid="dossier-map-panel"
      data-state="map"
      data-lat={caseLat}
      data-lng={caseLng}
      aria-label={
        locationName
          ? `Case location map — ${locationName}`
          : `Case location map — ${formatCoord(caseLat, "lat")}, ${formatCoord(caseLng, "lng")}`
      }
    >
      {/* ── Map container — fills flex-1 space ───────────────────────────────
          .mapContainer uses position: relative to establish the containing
          block for the absolutely-positioned MapboxMap canvas.  The canvas
          itself uses inset: 0 to fill the container exactly.

          The overflow: hidden clips map tiles at the container boundary,
          preventing the Mapbox GL canvas from painting outside the panel.  */}
      <div className={styles.mapContainer} data-testid="dossier-map-container">
        <MapboxMap
          mapboxAccessToken={resolvedToken}
          initialViewState={{
            longitude: caseLng,
            latitude:  caseLat,
            zoom:      DEFAULT_CASE_ZOOM,
          }}
          style={{ width: "100%", height: "100%" }}
          mapStyle={mapStyle}
          /* Attribution is provided via URL in compliance with Mapbox ToS.
             The compact attribution control is disabled to save panel space. */
          attributionControl={false}
          /* reuseMaps prevents WebGL context re-initialisation on re-renders,
             reducing GPU pressure in the detail panel. */
          reuseMaps={true}
        >
          {/* Case location marker — status-colored CSS pin at lat/lng */}
          <Marker
            longitude={caseLng}
            latitude={caseLat}
            anchor="bottom"
          >
            <div
              className={styles.caseMarker}
              aria-label={
                locationName
                  ? `Case location: ${locationName}`
                  : `Case location: ${formatCoord(caseLat, "lat")}, ${formatCoord(caseLng, "lng")}`
              }
              data-testid="dossier-map-marker"
            >
              {/* Marker head — color driven by data-status → CSS token */}
              <div
                className={styles.caseMarkerHead}
                data-status={(status as CaseStatus) ?? "hangar"}
              />
              {/* Marker tail — small stem connecting head to the coordinate point */}
              <div className={styles.caseMarkerTail} aria-hidden="true" />
            </div>
          </Marker>
        </MapboxMap>

        {/* ── Location overlay — floating info badge bottom-left ──────────────
            Sits on top of the map tiles (z-index 20 > GL layers at 0–15),
            below any modal overlays (z-index 30+).
            Frosted glass effect where backdrop-filter is supported.        */}
        <div
          className={styles.locationOverlay}
          aria-label="Case location details"
          data-testid="dossier-map-location-overlay"
        >
          {locationName && (
            <span className={styles.locationName}>{locationName}</span>
          )}
          <span
            className={styles.locationCoords}
            aria-label={`Coordinates: ${formatCoord(caseLat, "lat")}, ${formatCoord(caseLng, "lng")}`}
          >
            {formatCoord(caseLat, "lat")}
            {" "}
            {formatCoord(caseLng, "lng")}
          </span>
        </div>
      </div>

      {/* ── GPS data strip ────────────────────────────────────────────────────
          A compact row of data fields below the map canvas.  Shows the raw
          decimal coordinates (IBM Plex Mono), location name, and last-updated
          timestamp so operators can confirm the data without reading the overlay. */}
      <GPSDataStrip
        lat={caseLat}
        lng={caseLng}
        locationName={locationName}
        updatedAt={updatedAt}
      />
    </div>
  );
}

export default DossierMapPanel;
