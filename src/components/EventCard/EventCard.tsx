/**
 * EventCard — event-focused card for use within swim-lane columns.
 *
 * Represents a single lifecycle event (e.g. "Inspection Completed",
 * "Shipped", "Damage Reported") as a compact card suitable for
 * embedding in T3 swim-lane columns or any event-log surface.
 *
 * Contrast with CaseCard (inside T3SwimLane): CaseCard represents a
 * piece of equipment at its current status; EventCard represents a
 * discrete action or transition in that equipment's lifecycle.
 *
 * Data shape
 * ──────────
 * The card requires only `eventType`, `timestamp`, and `label`.
 * Everything else is optional enrichment that enhances context when
 * available (status, actor, detail, caseLabel).
 *
 * Variant states
 * ──────────────
 * Four visual variants signal the event's outcome / urgency:
 *
 *   default   — neutral resting state (no accent)
 *   active    — event is current / in-progress (brand-blue left border)
 *   completed — event resolved successfully (green left border)
 *   flagged   — event requires attention / has issues (amber left border)
 *
 * The variant controls:
 *   • Left-side accent bar color
 *   • Background tint (subtle, theme-safe)
 *   • The event type dot color if no event-type-specific color applies
 *
 * Layout
 * ──────
 * ┌────────────────────────────────────────────────────────────────┐
 * │ ● [Event Type Label]                          [Status Pill?]  │
 * │   [Case Label (mono)]          [Timestamp (mono)]             │
 * │   [Actor · Detail]                                            │
 * └────────────────────────────────────────────────────────────────┘
 * │ ← left accent bar (variant color)
 *
 * Typography
 * ──────────
 *   Inter Tight  — event type label, actor name, detail, meta text
 *   IBM Plex Mono — case label, timestamp
 *
 * Design tokens
 * ─────────────
 *   All colors and elevations come from CSS custom properties.
 *   No hex literals in component code or companion CSS module.
 *
 * Accessibility
 * ─────────────
 *   • Root is an `<article>` with a descriptive `aria-label`.
 *   • Timestamp wrapped in `<time dateTime={ISO}>`.
 *   • Event type dot is `aria-hidden` (decorative; label provides context).
 *   • StatusPill carries its own `role="status"` + aria-label.
 *   • `data-variant` attribute is CSS-only — not exposed semantically
 *     (semantic state is in the aria-label).
 *   • WCAG AA contrast for all text/icon elements in both themes.
 *
 * Interactive mode
 * ────────────────
 *   When `onClick` is provided the card renders as a `<button>` inside
 *   the root `<article>`.  When `onClick` is omitted the content is
 *   rendered as a static layout — suitable for read-only display panels.
 *
 * @example
 *   // Basic usage
 *   <EventCard
 *     eventType="inspection_completed"
 *     timestamp={Date.now()}
 *     label="Inspection Completed"
 *     status="completed"
 *     variant="completed"
 *   />
 *
 * @example
 *   // Interactive event card with damage flag
 *   <EventCard
 *     eventType="damage_reported"
 *     timestamp={1700000000000}
 *     label="Damage Reported"
 *     caseLabel="CS-042"
 *     actorName="Alice Tech"
 *     detail="Blade tip crack · Severe"
 *     status="flagged"
 *     variant="flagged"
 *     onClick={() => openEventDetail(eventId)}
 *   />
 */

"use client";

import { StatusPill } from "../StatusPill";
import type { StatusKind } from "../StatusPill/StatusPill";
import styles from "./EventCard.module.css";

// ─── Event type label map ─────────────────────────────────────────────────────

/**
 * Known event type slugs → human-readable labels.
 * Matches the vocabulary used in JourneyTimeline and T2Timeline.
 */
const EVENT_TYPE_LABELS: Record<string, string> = {
  status_change:        "Status Changed",
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
 * Map event type slugs to dot semantic color variants.
 * Controls the CSS data-event-dot attribute for dot coloring.
 *
 *   brand   — lifecycle progression (status_change, mission_assigned)
 *   transit — field action / movement (inspection_started, shipped)
 *   success — positive completion (inspection_completed, delivered)
 *   error   — requires attention (damage_reported)
 *   neutral — transfer / configuration (custody_handoff, template_applied)
 */
const EVENT_DOT_VARIANTS: Record<string, EventDotVariant> = {
  status_change:        "brand",
  inspection_started:   "transit",
  inspection_completed: "success",
  damage_reported:      "error",
  shipped:              "transit",
  delivered:            "success",
  custody_handoff:      "neutral",
  mission_assigned:     "brand",
  template_applied:     "neutral",
  scan_check_in:        "transit",
  qr_associated:        "neutral",
};

// ─── Types ────────────────────────────────────────────────────────────────────

/** Semantic color variant for the event type indicator dot. */
export type EventDotVariant = "brand" | "transit" | "success" | "error" | "neutral";

/**
 * Visual variant state for the card.
 *
 *   default   — neutral resting state
 *   active    — event is current / in-progress (brand-blue accent)
 *   completed — event resolved successfully (green accent)
 *   flagged   — event requires attention / has issues (amber accent)
 */
export type EventVariant = "default" | "active" | "completed" | "flagged";

/** Props for the EventCard component. */
export interface EventCardProps {
  /**
   * Event type slug (e.g. "inspection_completed", "shipped").
   * Used to derive the dot color and display label fallback.
   */
  eventType: string;

  /**
   * Unix timestamp in milliseconds for the event.
   * Rendered in a `<time dateTime={ISO}>` element.
   */
  timestamp: number;

  /**
   * Primary display label for the event.
   * Typically the human-readable event type label, but may be
   * customized (e.g. "FedEx #794…" for a shipment event).
   * If omitted, falls back to the formatted eventType.
   */
  label?: string;

  /**
   * Current status associated with this event.
   * When provided, renders a `<StatusPill>` in the card header.
   * Useful for status_change events (show the new status) or
   * outcome events (delivered → StatusPill("delivered")).
   */
  status?: StatusKind;

  /**
   * Visual variant controlling the card's accent color and tint.
   * @default "default"
   */
  variant?: EventVariant;

  /**
   * Case identifier in monospace font (e.g. "CS-042", "QR-1234").
   * Shown below the event type label.
   */
  caseLabel?: string;

  /**
   * Name of the person or system that performed the event.
   * Rendered as secondary meta text.
   */
  actorName?: string;

  /**
   * Brief supplemental detail string (e.g. "12 / 15 items · 2 damaged").
   * Rendered as tertiary meta text, truncated if it overflows.
   */
  detail?: string;

  /**
   * When provided, the entire card content is wrapped in a `<button>`
   * so the card is keyboard-accessible and click-activatable.
   * The button fires `onClick` with the React synthetic event.
   */
  onClick?: () => void;

  /**
   * When `onClick` is provided and the card is an interactive button,
   * this controls whether the card appears "selected" (aria-pressed).
   * Has no effect on non-interactive (static) cards.
   * @default false
   */
  isSelected?: boolean;

  /** Additional CSS class applied to the root `<article>` element. */
  className?: string;

  /** `data-testid` forwarded to the root element for test targeting. */
  "data-testid"?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an event type slug to a human-readable label.
 * Falls back to Title Case for unknown slugs.
 */
function formatEventType(eventType: string): string {
  if (EVENT_TYPE_LABELS[eventType]) return EVENT_TYPE_LABELS[eventType];
  return eventType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Format epoch ms to a short human-readable display string.
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

/** Convert epoch ms to ISO 8601 string for `<time dateTime={…}>`. */
function toISOString(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * EventCard — event-focused card for swim-lane columns and event logs.
 *
 * Purely prop-driven — no data fetching or real-time subscriptions.
 * The parent is responsible for providing all event data.
 *
 * @example
 *   <EventCard
 *     eventType="damage_reported"
 *     timestamp={event.timestamp}
 *     label="Damage Reported"
 *     caseLabel="CS-042"
 *     actorName="Alice Tech"
 *     detail="Blade tip crack · Severe"
 *     status="flagged"
 *     variant="flagged"
 *   />
 */
export function EventCard({
  eventType,
  timestamp,
  label,
  status,
  variant = "default",
  caseLabel,
  actorName,
  detail,
  onClick,
  isSelected = false,
  className,
  "data-testid": testId = "event-card",
}: EventCardProps) {
  const displayLabel   = label ?? formatEventType(eventType);
  const dotVariant     = EVENT_DOT_VARIANTS[eventType] ?? "neutral";
  const isInteractive  = typeof onClick === "function";

  // Build accessible article label
  const ariaLabel = [
    displayLabel,
    caseLabel ? `case ${caseLabel}` : null,
    isSelected ? "selected" : null,
  ]
    .filter(Boolean)
    .join(", ");

  // Inner content — shared between static and interactive variants
  const cardContent = (
    <>
      {/* ── Header row: dot + event type label + status pill ───────── */}
      <div className={styles.headerRow}>
        {/* Semantic indicator dot (event-type colored) */}
        <span
          className={styles.dot}
          data-dot-variant={dotVariant}
          aria-hidden="true"
        />

        {/* Event type label */}
        <span className={styles.eventType} data-testid="event-card-type">
          {displayLabel}
        </span>

        {/* Optional status pill */}
        {status && (
          <StatusPill kind={status} />
        )}
      </div>

      {/* ── Meta row: case label + timestamp ───────────────────────── */}
      <div className={styles.metaRow}>
        {caseLabel ? (
          <span
            className={styles.caseLabel}
            data-testid="event-card-case-label"
          >
            {caseLabel}
          </span>
        ) : (
          /* Spacer so timestamp floats right even without a case label */
          <span className={styles.caseLabelEmpty} aria-hidden="true" />
        )}

        <time
          className={styles.timestamp}
          dateTime={toISOString(timestamp)}
          data-testid="event-card-timestamp"
        >
          {formatTimestamp(timestamp)}
        </time>
      </div>

      {/* ── Detail row: actor name + supplemental detail ─────────────── */}
      {(actorName || detail) && (
        <div className={styles.detailRow}>
          {actorName && (
            <span
              className={styles.actorName}
              data-testid="event-card-actor"
            >
              {actorName}
            </span>
          )}
          {actorName && detail && (
            <span className={styles.metaSep} aria-hidden="true">·</span>
          )}
          {detail && (
            <span
              className={styles.detail}
              data-testid="event-card-detail"
              title={detail}
            >
              {detail}
            </span>
          )}
        </div>
      )}
    </>
  );

  const articleClass = [styles.card, className].filter(Boolean).join(" ");

  return (
    <article
      className={articleClass}
      data-testid={testId}
      data-event-type={eventType}
      data-variant={variant}
      aria-label={ariaLabel}
    >
      {isInteractive ? (
        <button
          type="button"
          className={styles.cardButton}
          onClick={onClick}
          aria-pressed={isSelected}
          aria-label={ariaLabel}
          data-testid="event-card-button"
        >
          {cardContent}
        </button>
      ) : (
        cardContent
      )}
    </article>
  );
}

export default EventCard;
