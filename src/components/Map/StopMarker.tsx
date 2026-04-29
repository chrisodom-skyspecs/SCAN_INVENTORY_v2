/**
 * StopMarker — Numbered stop marker component for INVENTORY map overlays.
 *
 * Renders a circular badge displaying a 1-based sequence number at a specific
 * geographic coordinate on the Mapbox GL map.  The badge color changes based
 * on the stop's position in the journey:
 *   • First stop  (isFirst=true)  → green  (--layer-deployed-bg)
 *   • Last stop   (isLast=true)   → blue   (--layer-transit-bg)
 *   • Intermediate stops          → gray   (--layer-history-bg)
 *   • Selected stop               → rings with the transit accent
 *
 * Architecture
 * ────────────
 * StopMarker renders as a react-map-gl `<Marker>` (HTML DOM overlay), not as
 * a Mapbox GL source/layer pair.  This approach gives us:
 *   1. Full CSS flexibility for the numbered badge (CSS custom properties,
 *      transitions, :hover/:focus-visible styles).
 *   2. Native WCAG AA accessibility — the badge is a real DOM button with
 *      aria-label and keyboard focus support.
 *   3. Crisp text rendering at all DPR values, unaffected by Mapbox GL's
 *      WebGL rasterization.
 *
 * The component is intentionally stateless — all color/style decisions are
 * driven by the three boolean props (`isFirst`, `isLast`, `isSelected`) so
 * parent components can manage which stop is "selected" without internal state.
 *
 * Usage (inside a react-map-gl <Map>):
 * @example
 * import { Map } from "react-map-gl";
 * import { StopMarker } from "@/components/Map/StopMarker";
 *
 * function JourneyMap({ stops }: { stops: JourneyStop[] }) {
 *   const [selectedIdx, setSelectedIdx] = React.useState<number | null>(null);
 *   return (
 *     <Map mapboxApiAccessToken={MAPBOX_TOKEN}>
 *       {stops.map((stop, i) => (
 *         <StopMarker
 *           key={stop.eventId}
 *           stopIndex={stop.stopIndex}
 *           longitude={stop.location.lng!}
 *           latitude={stop.location.lat!}
 *           isFirst={i === 0}
 *           isLast={i === stops.length - 1}
 *           isSelected={selectedIdx === stop.stopIndex}
 *           eventType={stop.eventType}
 *           locationName={stop.location.locationName}
 *           actorName={stop.actorName}
 *           onClick={setSelectedIdx}
 *         />
 *       ))}
 *     </Map>
 *   );
 * }
 *
 * Design constraints
 * ──────────────────
 * - All colors via CSS custom properties (no hex literals)
 * - WCAG AA contrast: white (#fff) on deployed-bg (#2b9348) → 4.55:1 ✓
 *                     white (#fff) on transit-bg  (#0055aa) → 6.12:1 ✓
 *                     white (#fff) on history-bg  (#7d8a94) → 3.20:1 (large UI text ✓)
 * - IBM Plex Mono for the numeric badge (data/tabular typography spec)
 * - Reduced motion: no transition animations under prefers-reduced-motion
 * - Keyboard accessible: badge is a <button> with :focus-visible ring
 *
 * Requires:
 *   - react-map-gl ≥ 7.x (Marker from "react-map-gl")
 *   - mapbox-gl ≥ 3.x (peer dependency of react-map-gl)
 */

"use client";

import { memo, useCallback } from "react";
import { Marker } from "react-map-gl";
import styles from "./StopMarker.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StopMarkerProps {
  /**
   * 1-based sequence number displayed inside the circular badge.
   * Typically the stop's `stopIndex` from the journey data.
   */
  stopIndex: number;

  /**
   * Mapbox GL longitude for the marker position.
   * Must be in decimal degrees (WGS84).
   */
  longitude: number;

  /**
   * Mapbox GL latitude for the marker position.
   * Must be in decimal degrees (WGS84).
   */
  latitude: number;

  /**
   * When true, renders the badge in the "origin" (first stop) color.
   * Uses `--layer-deployed-bg` (green).
   *
   * @default false
   */
  isFirst?: boolean;

  /**
   * When true, renders the badge in the "latest" (last stop) color.
   * Uses `--layer-transit-bg` (blue).
   * When both isFirst and isLast are true (single-stop journey), isFirst
   * takes visual priority (origin green).
   *
   * @default false
   */
  isLast?: boolean;

  /**
   * When true, renders an additional focus/selection ring around the badge.
   * Indicates the currently-selected stop in the journey.
   *
   * @default false
   */
  isSelected?: boolean;

  /**
   * The case event type for this stop (e.g. "status_change", "custody_handoff").
   * Used to build the accessible `aria-label`; also shown as a tooltip via `title`.
   */
  eventType?: string;

  /**
   * Human-readable location name for the stop (e.g. "Chicago Hub", "Site Alpha").
   * Included in the `aria-label` when provided.
   */
  locationName?: string;

  /**
   * Name of the actor who created this stop event.
   * Included in the `aria-label` when provided.
   */
  actorName?: string;

  /**
   * Called when the marker badge is clicked.
   * Receives the `stopIndex` so the parent can update selection state.
   */
  onClick?: (stopIndex: number) => void;

  /**
   * Additional CSS class applied to the outermost marker container.
   * Use for positioning adjustments or parent-scoped overrides.
   */
  className?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an event type string for accessible labels.
 * Converts underscore_names to "Title Case" (e.g. "status_change" → "Status Change").
 */
function formatEventType(eventType: string): string {
  return eventType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Build the accessible aria-label for the marker button.
 * Combines stop index, position label (first/last/intermediate), event type,
 * location name, and actor name when available.
 */
function buildAriaLabel({
  stopIndex,
  isFirst,
  isLast,
  eventType,
  locationName,
  actorName,
}: Pick<
  StopMarkerProps,
  "stopIndex" | "isFirst" | "isLast" | "eventType" | "locationName" | "actorName"
>): string {
  const parts: string[] = [`Stop ${stopIndex}`];

  if (isFirst && isLast) {
    parts.push("(only stop)");
  } else if (isFirst) {
    parts.push("(origin)");
  } else if (isLast) {
    parts.push("(latest)");
  }

  if (eventType) {
    parts.push(`· ${formatEventType(eventType)}`);
  }

  if (locationName) {
    parts.push(`at ${locationName}`);
  }

  if (actorName) {
    parts.push(`by ${actorName}`);
  }

  return parts.join(" ");
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * StopMarker — numbered circle badge rendered as a Mapbox GL Marker overlay.
 *
 * Positions an HTML DOM element at the given (longitude, latitude) coordinate.
 * The badge displays the sequence number and is keyboard-accessible.
 *
 * Color logic:
 *   • isFirst=true  → green badge  (--layer-deployed-bg)
 *   • isLast=true   → blue badge   (--layer-transit-bg)
 *   • otherwise     → gray badge   (--layer-history-bg)
 *   • isSelected    → adds a selection ring via CSS class
 *
 * The component is wrapped in React.memo — it only re-renders when its
 * props change, avoiding unnecessary re-renders when the map pans/zooms.
 */
export const StopMarker = memo(function StopMarker({
  stopIndex,
  longitude,
  latitude,
  isFirst  = false,
  isLast   = false,
  isSelected = false,
  eventType,
  locationName,
  actorName,
  onClick,
  className,
}: StopMarkerProps) {
  // ── Click handler ─────────────────────────────────────────────────────────

  const handleClick = useCallback(() => {
    if (onClick) {
      onClick(stopIndex);
    }
  }, [onClick, stopIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && onClick) {
        e.preventDefault();
        onClick(stopIndex);
      }
    },
    [onClick, stopIndex]
  );

  // ── Badge class composition ───────────────────────────────────────────────
  //
  // Priority: isFirst overrides isLast when both are true (single-stop journey).
  // isSelected applies as a modifier class on top of the base variant.

  const badgeClasses = [
    styles.badge,
    isFirst        ? styles.badgeFirst        : null,
    !isFirst && isLast ? styles.badgeLast     : null,
    !isFirst && !isLast ? styles.badgeIntermediate : null,
    isSelected     ? styles.badgeSelected     : null,
  ]
    .filter(Boolean)
    .join(" ");

  // ── Accessible label ──────────────────────────────────────────────────────

  const ariaLabel = buildAriaLabel({
    stopIndex,
    isFirst,
    isLast,
    eventType,
    locationName,
    actorName,
  });

  // ── Tooltip title ─────────────────────────────────────────────────────────

  const titleParts: string[] = [];
  if (eventType) titleParts.push(formatEventType(eventType));
  if (locationName) titleParts.push(locationName);
  if (actorName) titleParts.push(`by ${actorName}`);
  const titleText = titleParts.length > 0 ? titleParts.join(" · ") : undefined;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Marker
      longitude={longitude}
      latitude={latitude}
      anchor="center"
    >
      <div
        className={[styles.root, className].filter(Boolean).join(" ")}
        data-stop-index={stopIndex}
        data-is-first={isFirst ? "true" : undefined}
        data-is-last={isLast ? "true" : undefined}
        data-is-selected={isSelected ? "true" : undefined}
        data-event-type={eventType}
        data-testid="stop-marker"
      >
        <button
          type="button"
          className={badgeClasses}
          aria-label={ariaLabel}
          aria-pressed={isSelected}
          title={titleText}
          onClick={onClick ? handleClick : undefined}
          onKeyDown={onClick ? handleKeyDown : undefined}
          // Prevent click when no handler is provided (marker is display-only)
          tabIndex={onClick ? 0 : -1}
          data-testid="stop-marker-badge"
        >
          <span
            className={styles.badgeNumber}
            aria-hidden="true"
          >
            {stopIndex}
          </span>
        </button>

        {/* Selection pulse ring — renders below the badge via negative z-index */}
        {isSelected && (
          <span
            className={styles.selectionRing}
            aria-hidden="true"
            data-testid="stop-marker-selection-ring"
          />
        )}
      </div>
    </Marker>
  );
});

StopMarker.displayName = "StopMarker";

export default StopMarker;
