/**
 * StopCard — standalone card for a single journey stop.
 *
 * Displays a numbered stop badge, event type label, timestamp, and an optional
 * horizontal strip of evidence photo thumbnails.  This component is entirely
 * prop-driven — it contains no Convex subscriptions, useQuery calls, or other
 * async logic.  Data must be prepared by the parent before rendering.
 *
 * Layout
 * ──────
 * ┌─────────────────────────────────────────────────────────┐
 * │  ●   Event Type Label                      Apr 20, 2:34 │
 * │  1   Actor Name (optional)                              │
 * │  │   Location Name (optional)                          │
 * │      [thumb] [thumb] [thumb]  …                        │
 * └─────────────────────────────────────────────────────────┘
 *
 * Stop badge color:
 *   • First stop (origin) → green  (--layer-deployed-*)
 *   • Last stop (recent)  → blue   (--layer-transit-*)
 *   • Intermediate stops  → gray   (--layer-history-*)
 *   • No location recorded → dashed border on badge
 *
 * Thumbnail strip:
 *   • Renders only when `thumbnails` is a non-empty array.
 *   • Each thumbnail is a 48×48 px square with object-fit:cover.
 *   • Interactive thumbnails (with `onClick`) meet the 44×44 touch target
 *     requirement (WCAG 2.5.5) via 44×44 px minimum tap region.
 *   • Thumbnail images carry a contextual alt text; if none is supplied
 *     the alt defaults to "Evidence photo N of M".
 *
 * Typography
 * ──────────
 *   • Inter Tight — all labels, event type, actor, location
 *   • IBM Plex Mono — stop number badge, timestamp
 *
 * Design tokens
 * ─────────────
 *   All color and elevation values come from CSS custom properties; no hex
 *   literals appear in component code or the companion module CSS.
 *
 * Accessibility
 * ─────────────
 *   • `<article>` element with `aria-label` describing the stop number.
 *   • Timestamp wrapped in `<time dateTime={ISO}>`.
 *   • Evidence thumbnails: each interactive thumbnail is a `<button>` with a
 *     descriptive `aria-label`; non-interactive thumbnails are plain `<img>`
 *     elements with alt text.
 *   • Stop number badge is `aria-hidden` (stop context is in the aria-label).
 *   • Reduced-motion: no CSS animations beyond token-level elevation shadows.
 *
 * @example
 *   <StopCard
 *     stopNumber={1}
 *     eventType="status_change"
 *     timestamp={1700000000000}
 *   />
 *
 * @example
 *   <StopCard
 *     stopNumber={3}
 *     eventType="damage_reported"
 *     timestamp={Date.now()}
 *     actorName="Alice Tech"
 *     locationName="Site Alpha"
 *     isLast
 *     thumbnails={[
 *       { id: "t1", src: "https://…", alt: "Crack on blade tip", onClick: openLightbox },
 *     ]}
 *   />
 */

import styles from "./StopCard.module.css";

// ─── Event type label map ─────────────────────────────────────────────────────

/**
 * Known event type slugs mapped to human-readable labels.
 * Follows the same vocabulary as JourneyTimeline.tsx.
 */
const EVENT_TYPE_LABELS: Record<string, string> = {
  status_change:        "Status Change",
  inspection_started:   "Inspection Started",
  inspection_completed: "Inspection Completed",
  damage_reported:      "Damage Reported",
  shipped:              "Shipped",
  delivered:            "Delivered",
  custody_handoff:      "Custody Handoff",
  mission_assigned:     "Mission Assigned",
  template_applied:     "Template Applied",
  scan_check_in:        "Scan Check-In",
  qr_associated:        "QR Associated",
};

/**
 * Format an event type slug for display.
 * Looks up known slugs first; falls back to Title Case from underscore_slug.
 */
function formatEventType(eventType: string): string {
  if (EVENT_TYPE_LABELS[eventType]) return EVENT_TYPE_LABELS[eventType];
  return eventType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ─── Timestamp helpers ────────────────────────────────────────────────────────

/**
 * Format epoch ms → short human-readable display string.
 * Example: "Apr 20, 2:34 PM"
 */
function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month:  "short",
    day:    "numeric",
    hour:   "numeric",
    minute: "2-digit",
  });
}

/**
 * Convert epoch ms → ISO 8601 string for use in <time dateTime={…}>.
 */
function toISOString(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single evidence photo thumbnail to display in the card's thumbnail strip. */
export interface EvidenceThumbnail {
  /**
   * Unique identifier — used as the React `key` prop.
   * May be a Convex storage ID, UUID, or any stable string.
   */
  id: string;

  /**
   * Image source URL.
   * Typically a Convex file-storage serving URL or a local object URL for
   * preview during upload.
   */
  src: string;

  /**
   * Accessible alt text for the thumbnail image.
   * If omitted, falls back to "Evidence photo {N} of {total}".
   */
  alt?: string;

  /**
   * When provided, the thumbnail is rendered as an interactive `<button>`
   * (e.g. to open a full-screen lightbox view).  When omitted the thumbnail
   * is a decorative `<img>` element.
   */
  onClick?: () => void;
}

/** Props for the StopCard component. */
export interface StopCardProps {
  /**
   * 1-based sequential position number for this stop.
   * Displayed in the numbered circle badge.
   */
  stopNumber: number;

  /**
   * Event type identifier.  May be a raw slug (e.g. "status_change") or any
   * string; unknown slugs fall back to Title Case formatting.
   */
  eventType: string;

  /**
   * Unix timestamp in milliseconds (e.g. Date.now() or Convex _creationTime).
   * Rendered in a <time dateTime={ISO}> element.
   */
  timestamp: number;

  /**
   * Evidence photo thumbnails to display below the stop metadata.
   * Rendered as a horizontally scrollable strip.
   * Omit or pass an empty array to hide the thumbnail strip entirely.
   */
  thumbnails?: EvidenceThumbnail[];

  /**
   * Mark this stop as the first / origin stop in a journey.
   * The badge renders with a green fill (--layer-deployed-*).
   * @default false
   */
  isFirst?: boolean;

  /**
   * Mark this stop as the most recent / last stop in a journey.
   * The badge renders with a blue fill (--layer-transit-*).
   * Takes precedence over `isFirst` in the combined case.
   * @default false
   */
  isLast?: boolean;

  /**
   * Whether this stop has an associated GPS location.
   * When false the badge border is rendered as a dashed line to signal
   * missing location data — matching the JourneyTimeline convention.
   * @default true
   */
  hasLocation?: boolean;

  /**
   * Display name of the person or system that performed the action.
   * Shown as a secondary line below the event type label.
   */
  actorName?: string;

  /**
   * Human-readable location name (e.g. "Site Alpha", "Main Hangar").
   * Shown as a tertiary line in monospace below actor name.
   */
  locationName?: string;

  /**
   * Additional CSS class applied to the root `<article>` element.
   * Use for margin/spacing overrides from parent layout code.
   */
  className?: string;

  /** `data-testid` value forwarded to the root element for test targeting. */
  "data-testid"?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * StopCard — prop-driven card for a single journey stop.
 *
 * Renders stop number, event type label, timestamp, and optional evidence
 * photo thumbnails.  No data-fetching or real-time logic — all data supplied
 * via props by the parent component.
 */
export function StopCard({
  stopNumber,
  eventType,
  timestamp,
  thumbnails,
  isFirst = false,
  isLast  = false,
  hasLocation = true,
  actorName,
  locationName,
  className,
  "data-testid": testId = "stop-card",
}: StopCardProps) {
  const hasThumbnails = thumbnails && thumbnails.length > 0;
  const eventLabel    = formatEventType(eventType);

  // Derive CSS modifier attributes for badge coloring
  const badgePosition: "first" | "last" | "intermediate" = isFirst
    ? "first"
    : isLast
    ? "last"
    : "intermediate";

  return (
    <article
      className={[styles.card, className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-event-type={eventType}
      data-stop-number={stopNumber}
      aria-label={`Stop ${stopNumber}: ${eventLabel}`}
    >
      {/* ── Left column: stop number badge ──────────────────────────────── */}
      <div className={styles.badgeCol} aria-hidden="true">
        <span
          className={styles.badge}
          data-position={badgePosition}
          data-no-location={!hasLocation ? "true" : undefined}
        >
          {stopNumber}
        </span>
      </div>

      {/* ── Right column: stop content ───────────────────────────────────── */}
      <div className={styles.contentCol}>
        {/* Event type label + timestamp on same row */}
        <div className={styles.headerRow}>
          <span className={styles.eventType}>{eventLabel}</span>
          <time
            className={styles.timestamp}
            dateTime={toISOString(timestamp)}
            data-testid="stop-card-timestamp"
          >
            {formatTimestamp(timestamp)}
          </time>
        </div>

        {/* Actor name */}
        {actorName && (
          <span className={styles.actorName} data-testid="stop-card-actor">
            {actorName}
          </span>
        )}

        {/* Location name */}
        {locationName ? (
          <span className={styles.locationName} data-testid="stop-card-location">
            {locationName}
          </span>
        ) : !hasLocation ? (
          <span className={styles.locationMissing} data-testid="stop-card-no-location">
            No location
          </span>
        ) : null}

        {/* Evidence thumbnail strip */}
        {hasThumbnails && (
          <div
            className={styles.thumbnailStrip}
            role="list"
            aria-label={`${thumbnails!.length} evidence photo${thumbnails!.length !== 1 ? "s" : ""}`}
            data-testid="stop-card-thumbnails"
          >
            {thumbnails!.map((thumb, idx) => {
              const altText =
                thumb.alt ?? `Evidence photo ${idx + 1} of ${thumbnails!.length}`;

              return (
                <div
                  key={thumb.id}
                  className={styles.thumbnailItem}
                  role="listitem"
                >
                  {thumb.onClick ? (
                    /* Interactive thumbnail — rendered as a button for keyboard/touch */
                    <button
                      type="button"
                      className={styles.thumbnailButton}
                      onClick={thumb.onClick}
                      aria-label={`View ${altText}`}
                      data-testid={`stop-card-thumb-${idx}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumb.src}
                        alt=""
                        aria-hidden="true"
                        className={styles.thumbnailImg}
                        draggable={false}
                      />
                    </button>
                  ) : (
                    /* Static thumbnail — decorative image with alt text */
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb.src}
                      alt={altText}
                      className={styles.thumbnailImg}
                      draggable={false}
                      data-testid={`stop-card-thumb-${idx}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}

export default StopCard;
