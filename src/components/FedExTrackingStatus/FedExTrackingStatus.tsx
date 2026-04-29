/**
 * FedExTrackingStatus — Pure UI component for displaying FedEx carrier status.
 *
 * A stateless presentation component that accepts carrier status, estimated
 * delivery, last event, and an optional event history as props and renders
 * them in a structured display.
 *
 * Unlike TrackingStatus (which integrates Convex subscriptions internally),
 * this component has no data dependencies — it renders exactly the props it
 * receives. This makes it reusable across the INVENTORY dashboard and SCAN
 * mobile app without importing Convex hooks.
 *
 * Display sections:
 *   1. Status row     — carrier badge + StatusPill + optional tracking number
 *                       (the "current state")
 *   2. Delivery row   — estimated delivery date, formatted for readability
 *                       (the "ETA")
 *   3. Last event     — most recent tracking scan: description, timestamp,
 *                       location (rendered when no `events` array is provided
 *                       or — when both are provided — as a featured highlight)
 *   4. Event history  — full chronological timeline of all tracking scans
 *                       (the "history"), rendered when an `events` array of
 *                       length ≥ 1 is provided
 *
 * This component is the canonical case-detail view UI for FedEx tracking.
 * It is consumed by the dashboard's T1/T4 case-detail panels (via the
 * `TrackingStatus` Convex-wired wrapper, or directly when shipment data is
 * already in scope) and by the SCAN mobile app's tracking display screens.
 *
 * Usage:
 *   // Minimal — status only
 *   <FedExTrackingStatus carrier="FedEx" status="in_transit" />
 *
 *   // With delivery ETA
 *   <FedExTrackingStatus
 *     carrier="FedEx"
 *     status="out_for_delivery"
 *     estimatedDelivery="2024-06-15T18:00:00.000Z"
 *   />
 *
 *   // Status + ETA + last event
 *   <FedExTrackingStatus
 *     carrier="FedEx"
 *     status="in_transit"
 *     estimatedDelivery="2024-06-15T18:00:00.000Z"
 *     lastEvent={{
 *       timestamp: "2024-06-14T09:30:00.000Z",
 *       eventType: "IT",
 *       description: "Departed FedEx hub",
 *       location: { city: "Memphis", state: "TN", country: "US" },
 *     }}
 *   />
 *
 *   // Full case-detail view — current state, history, ETA
 *   <FedExTrackingStatus
 *     carrier="FedEx"
 *     status="in_transit"
 *     trackingNumber="794612345678"
 *     estimatedDelivery="2024-06-15T18:00:00.000Z"
 *     events={shipment.events}
 *   />
 */

import { StatusPill } from "../StatusPill";
import type { StatusKind } from "../StatusPill";
import styles from "./FedExTrackingStatus.module.css";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Carrier status values that map to StatusPill kinds. */
export type CarrierStatus =
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";

/** Location data for a tracking event. */
export interface TrackingEventLocation {
  city?: string;
  state?: string;
  country?: string;
}

/** A single FedEx tracking scan event. */
export interface FedExTrackingEvent {
  /** ISO 8601 timestamp of the scan event. */
  timestamp: string;
  /** FedEx event type code (e.g. "PU", "IT", "OD", "DL"). */
  eventType: string;
  /** Human-readable description of the event. Falls back to eventType when empty. */
  description: string;
  /** Location of the scan. All fields are optional. */
  location: TrackingEventLocation;
}

export interface FedExTrackingStatusProps {
  /**
   * Carrier name displayed as a badge above the status pill.
   * Defaults to "FedEx" when omitted.
   */
  carrier?: string;

  /** Current FedEx carrier status — drives the StatusPill color and label. */
  status: CarrierStatus;

  /**
   * FedEx tracking number for the shipment.
   * Rendered in monospace as part of the current-state display.
   * Omit (or pass `null`) to hide this field.
   */
  trackingNumber?: string | null;

  /**
   * Estimated delivery as an ISO 8601 date-time string.
   * Rendered as a human-readable short date.
   * Omit (or pass `null`) to hide this row.
   */
  estimatedDelivery?: string | null;

  /**
   * Most recent tracking scan event.
   * Renders description, formatted timestamp, and location (when present).
   * Omit (or pass `null`) to hide this section.
   *
   * If `events` is also provided and non-empty, `lastEvent` defaults to the
   * first entry in `events` when omitted.
   */
  lastEvent?: FedExTrackingEvent | null;

  /**
   * Full chronological history of tracking scan events for this shipment.
   * When provided with at least one event, the component renders a timeline
   * of every event (most recent first) below the last-event highlight.
   *
   * Order is the caller's responsibility — typically the FedEx Track API
   * returns events most-recent-first, which is the order rendered here.
   *
   * Omit (or pass an empty array) to hide the history section.
   */
  events?: readonly FedExTrackingEvent[] | null;

  /** Additional CSS class applied to the root element. */
  className?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const VALID_STATUS_KINDS: ReadonlySet<string> = new Set<string>([
  "label_created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
]);

function toStatusKind(status: string): StatusKind {
  return VALID_STATUS_KINDS.has(status) ? (status as StatusKind) : "in_transit";
}

/** Format an ISO date string as "Weekday, Mon D, YYYY". */
function formatDeliveryDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

/** Format an ISO date-time string as "Mon D, HH:MM AM/PM". */
function formatEventTimestamp(isoString: string): string {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

/** Combine city/state/country into a comma-separated location string. */
function formatLocation(loc: TrackingEventLocation): string {
  return [loc.city, loc.state, loc.country].filter(Boolean).join(", ");
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Pin icon for location display (decorative). */
function PinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 1a4 4 0 0 1 4 4C10 8.2 6 13 6 13S2 8.2 2 5a4 4 0 0 1 4-4Z" />
      <circle cx="6" cy="5" r="1.25" />
    </svg>
  );
}

/** Calendar icon for ETA display (decorative). */
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1" y="2" width="12" height="11" rx="1.5" />
      <line x1="1" y1="6" x2="13" y2="6" />
      <line x1="4" y1="1" x2="4" y2="3.5" />
      <line x1="10" y1="1" x2="10" y2="3.5" />
    </svg>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

/**
 * Pure presentation component for FedEx carrier tracking status.
 *
 * Renders four optional sections from its props — no Convex subscriptions,
 * no internal state, no side effects.
 */
export function FedExTrackingStatus({
  carrier = "FedEx",
  status,
  trackingNumber,
  estimatedDelivery,
  lastEvent,
  events,
  className,
}: FedExTrackingStatusProps) {
  // When `events` is non-empty and `lastEvent` was not explicitly provided,
  // promote the first entry as the last-event highlight so the same payload
  // can drive both sections without callers having to duplicate the value.
  const eventsList: readonly FedExTrackingEvent[] = events ?? [];
  const hasHistory = eventsList.length > 0;
  const effectiveLastEvent: FedExTrackingEvent | null =
    lastEvent !== undefined && lastEvent !== null
      ? lastEvent
      : hasHistory
        ? eventsList[0]!
        : null;

  const location = effectiveLastEvent
    ? formatLocation(effectiveLastEvent.location)
    : "";
  const eventDescription =
    effectiveLastEvent?.description || effectiveLastEvent?.eventType || "";

  const rootClass = [styles.root, className].filter(Boolean).join(" ");

  return (
    <div className={rootClass} data-testid="fedex-tracking-status">
      {/* ── Section 1: Status row (current state) ─────────────────────── */}
      <div className={styles.statusRow} aria-label="Carrier tracking status">
        {/* Carrier badge */}
        <span
          className={styles.carrierBadge}
          aria-label={`Carrier: ${carrier}`}
        >
          {carrier}
        </span>

        {/* Status pill — single source of truth for all status rendering */}
        <StatusPill kind={toStatusKind(status)} />
      </div>

      {/* ── Tracking number ──────────────────────────────────────────── */}
      {trackingNumber && (
        <div className={styles.trackingRow} aria-label="Tracking number">
          <span className={styles.trackingLabel}>Tracking No.</span>
          <span
            className={styles.trackingValue}
            aria-label={`Tracking number: ${trackingNumber}`}
          >
            {trackingNumber}
          </span>
        </div>
      )}

      {/* ── Section 2: Estimated delivery (ETA) ──────────────────────── */}
      {estimatedDelivery && (
        <div className={styles.deliveryRow} aria-label="Estimated delivery">
          <CalendarIcon className={styles.deliveryIcon} />
          <span className={styles.deliveryLabel}>Est. Delivery</span>
          <span
            className={styles.deliveryValue}
            aria-label={`Estimated delivery: ${formatDeliveryDate(estimatedDelivery)}`}
          >
            {formatDeliveryDate(estimatedDelivery)}
          </span>
        </div>
      )}

      {/* ── Section 3: Last event highlight ───────────────────────────── */}
      {effectiveLastEvent && (
        <section
          className={styles.lastEventSection}
          aria-label="Last tracking event"
        >
          <h4 className={styles.lastEventHeading}>Last Event</h4>

          <div className={styles.lastEventCard}>
            {/* Event description */}
            {eventDescription && (
              <p className={styles.eventDescription}>{eventDescription}</p>
            )}

            {/* Timestamp + location row */}
            <div className={styles.eventMeta}>
              {/* Timestamp */}
              {effectiveLastEvent.timestamp && (
                <time
                  className={styles.eventTimestamp}
                  dateTime={effectiveLastEvent.timestamp}
                  aria-label={`Event time: ${formatEventTimestamp(effectiveLastEvent.timestamp)}`}
                >
                  {formatEventTimestamp(effectiveLastEvent.timestamp)}
                </time>
              )}

              {/* Location chip */}
              {location && (
                <span
                  className={styles.eventLocation}
                  aria-label={`Location: ${location}`}
                >
                  <PinIcon className={styles.locationPin} />
                  {location}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Section 4: Tracking history (full event timeline) ────────── */}
      {hasHistory && (
        <section
          className={styles.historySection}
          aria-label="Tracking history"
          data-testid="fedex-tracking-history"
        >
          <h4 className={styles.historyHeading}>Tracking History</h4>

          <ol
            className={styles.timeline}
            aria-label="Shipment scan events, most recent first"
          >
            {eventsList.map((event, idx) => {
              const loc = formatLocation(event.location);
              const desc = event.description || event.eventType || "";
              return (
                <li
                  key={`${event.timestamp || "no-ts"}-${event.eventType}-${idx}`}
                  className={styles.timelineItem}
                  data-testid="fedex-tracking-event"
                >
                  <span className={styles.timelineDot} aria-hidden="true" />
                  <div className={styles.timelineBody}>
                    <div className={styles.timelineRow}>
                      {desc && (
                        <span className={styles.timelineDesc}>{desc}</span>
                      )}
                      {event.timestamp && (
                        <time
                          className={styles.timelineTime}
                          dateTime={event.timestamp}
                          aria-label={`Event time: ${formatEventTimestamp(event.timestamp)}`}
                        >
                          {formatEventTimestamp(event.timestamp)}
                        </time>
                      )}
                    </div>
                    {loc && (
                      <span
                        className={styles.timelineLoc}
                        aria-label={`Location: ${loc}`}
                      >
                        <PinIcon className={styles.locationPin} />
                        {loc}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

export default FedExTrackingStatus;
