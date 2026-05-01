/**
 * TimelineEvent — reusable single-event entry for vertical spine timelines.
 *
 * Renders one lifecycle event on a vertical spine: a semantic color dot,
 * a connecting thread (hidden for the last event), and a content column
 * with the event type label, actor name, timestamp, and event-type-specific
 * description block.
 *
 * Supported event types
 * ─────────────────────
 *   status_change        — from → to status transition with StatusPill
 *   inspection_started   — field technician opened the checklist
 *   inspection_completed — inspection finished with item progress
 *   damage_reported      — damage found (item name + severity)
 *   shipped              — handed to carrier (tracking number + route)
 *   delivered            — carrier confirmed delivery
 *   custody_handoff      — custody transferred between persons (from → to)
 *   mission_assigned     — case linked to a mission
 *   template_applied     — packing template applied (name + item count)
 *   scan_check_in        — QR code scanned at a check-in point
 *   <any other>          — generic label derived from the slug
 *
 * Dot semantics
 * ─────────────
 * The spine dot color conveys the category of the event:
 *   brand   — lifecycle progression (status_change, mission_assigned)
 *   transit — field action / movement (inspection_started, shipped)
 *   success — positive completion (inspection_completed, delivered)
 *   error   — requires attention (damage_reported)
 *   neutral — transfer / configuration (custody_handoff, template_applied)
 *
 * Position flags
 * ──────────────
 * isFirst / isLast control dot size and the connecting thread:
 *   • First event: dot is slightly larger (anchor visual)
 *   • Last event: dot has a brand ring accent; thread is hidden
 *   • Both: combined styles
 *
 * Accessibility
 * ─────────────
 *   • Renders as an <li> element (parent provides the <ol>/<ul>)
 *   • aria-label describes position and event type for screen readers
 *   • Timestamps are wrapped in <time dateTime={ISO}>
 *   • Spine dot is aria-hidden (decorative; label carries meaning)
 *   • Thread is aria-hidden (decorative)
 *   • WCAG AA contrast on all text in both light and dark themes
 *
 * Design system
 * ─────────────
 *   • No hex literals — all colors via CSS custom properties
 *   • Inter Tight for UI text (labels, actor, detail)
 *   • IBM Plex Mono for data values (timestamps, tracking numbers, coordinates)
 *   • Design tokens: --surface-*, --ink-*, --border-*, --layer-*, --signal-*
 *
 * Usage
 * ─────
 *   // Standalone usage with explicit props:
 *   <ol>
 *     <TimelineEvent
 *       eventId="evt-001"
 *       eventType="status_change"
 *       timestamp={1700000000000}
 *       actorName="Alice Tech"
 *       metadata={{ from: "hangar", to: "deployed" }}
 *       position={{ current: 1, total: 3 }}
 *       isFirst
 *     />
 *   </ol>
 *
 *   // From a JourneyStop (using the fromStop() helper):
 *   <ol>
 *     {stops.map((stop, i) => (
 *       <TimelineEvent
 *         key={stop.eventId}
 *         {...TimelineEvent.fromStop(stop, i, stops.length)}
 *       />
 *     ))}
 *   </ol>
 */

"use client";

import React from "react";
import { StatusPill } from "../StatusPill";
import type { StatusKind } from "../StatusPill/StatusPill";
import type { JourneyStop } from "../../hooks/use-m2-journey-stops";
import styles from "./TimelineEvent.module.css";

// ─── Vocabulary maps ──────────────────────────────────────────────────────────

/**
 * Human-readable labels for known event type slugs.
 * Falls back to Title Case for unknown types.
 */
export const EVENT_TYPE_LABELS: Record<string, string> = {
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
 * Dot semantic variant per event type.
 * Controls the CSS [data-variant] attribute on the spine dot.
 *
 *   brand   → brand blue  (status_change, mission_assigned)
 *   transit → transit blue (inspection_started, shipped)
 *   success → green       (inspection_completed, delivered)
 *   error   → red         (damage_reported)
 *   neutral → gray        (custody_handoff, template_applied, scan_check_in)
 */
export const EVENT_DOT_VARIANTS: Record<string, DotVariant> = {
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

/** Semantic color variant for the spine dot indicator. */
export type DotVariant = "brand" | "transit" | "success" | "error" | "neutral";

/** Location data for a timeline event. */
export interface EventLocation {
  lat?:          number;
  lng?:          number;
  locationName?: string;
}

/**
 * Optional position context for a timeline event item.
 * Used to build the aria-label ("Event N of M") and for isFirst/isLast
 * when those booleans are not supplied explicitly.
 */
export interface EventPosition {
  /** 1-based index of this event in the list. */
  current: number;
  /** Total number of events in the list. */
  total:   number;
}

/**
 * Props for the TimelineEvent component.
 *
 * The component is a "controlled" presentational item — all state
 * (including ordering context) is passed via props from the parent.
 *
 * The minimum required props are `eventType` and `timestamp`.
 * Everything else is optional enrichment for context and accessibility.
 */
export interface TimelineEventProps {
  /**
   * Stable unique ID for the event (Convex document ID or any unique string).
   * Used as the React key in lists. Not rendered in the UI.
   */
  eventId?: string;

  /**
   * Event type discriminant controlling dot color and description block.
   *
   * Known types: "status_change" | "inspection_started" | "inspection_completed" |
   * "damage_reported" | "shipped" | "delivered" | "custody_handoff" |
   * "mission_assigned" | "template_applied" | "scan_check_in"
   *
   * Unknown types render a Title-Cased label from the slug.
   */
  eventType: string;

  /**
   * Epoch milliseconds for the event timestamp.
   * Rendered inside a `<time dateTime={ISO}>` element.
   */
  timestamp: number;

  /**
   * Display name of the person or system that performed the event.
   * Rendered in the meta line below the event type label.
   */
  actorName?: string;

  /**
   * Event-type-specific payload for the description block.
   *
   * For status_change: { from?: string, to?: string }
   * For inspection_*:  { totalItems?: number, checkedItems?: number, damagedItems?: number }
   * For damage_reported: { itemName?: string, severity?: string }
   * For shipped:       { trackingNumber?: string, originName?: string, destinationName?: string }
   * For custody_handoff: { fromUserName?: string, toUserName?: string }
   * For mission_assigned: { missionName?: string }
   * For template_applied: { templateName?: string, itemCount?: number }
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;

  /**
   * Geographic location associated with this event.
   * When both lat and lng are present, a coordinate display is shown.
   * When locationName is present, it is preferred over coordinates.
   */
  location?: EventLocation;

  /**
   * Whether the event has valid geographic coordinates.
   * Controls the no-location dot style and "No location recorded" message.
   * @default false
   */
  hasCoordinates?: boolean;

  /**
   * Whether this is the first event in the timeline.
   * The first event gets a slightly larger dot to anchor the spine visually.
   * @default false
   */
  isFirst?: boolean;

  /**
   * Whether this is the last (most recent) event in the timeline.
   * The last event gets an accent ring on its dot and hides the connecting thread.
   * @default false
   */
  isLast?: boolean;

  /**
   * Position of this event in the sequence.
   * Used to build the accessible aria-label: "Event 1 of 5: Status Changed"
   * If omitted, the aria-label uses only the event type label.
   */
  position?: EventPosition;

  /**
   * Override for the event type display label.
   * Defaults to the label from EVENT_TYPE_LABELS, or Title-Cased slug.
   */
  label?: string;

  /** Additional CSS class applied to the root `<li>` element. */
  className?: string;

  /** `data-testid` forwarded to the root element for test targeting. */
  "data-testid"?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an event type slug to a human-readable label.
 * Uses the vocabulary map with Title Case fallback for unknown types.
 */
export function formatEventType(eventType: string): string {
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

/** Convert epoch ms to ISO 8601 string for `<time dateTime={...}>`. */
function toISOString(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Derive the StatusPill kind for an event, if one applies.
 *
 * Only events with semantically meaningful status outcomes
 * map to a StatusPill — others use the dot color alone.
 */
function deriveStatusKind(
  eventType: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any> | undefined
): StatusKind | null {
  const validCaseStatuses = new Set([
    "hangar", "assembled", "transit_out", "deployed",
    "flagged", "recalled", "transit_in", "received", "archived",
  ]);

  switch (eventType) {
    case "status_change": {
      const to = metadata?.to;
      if (typeof to === "string" && validCaseStatuses.has(to)) {
        return to as StatusKind;
      }
      return null;
    }
    case "damage_reported":
      return "flagged";
    case "shipped":
      return "transit_out";
    case "delivered":
      return "received";
    default:
      return null;
  }
}

// ─── Event description sub-components ────────────────────────────────────────

interface EventDescriptionProps {
  eventType: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any> | undefined;
}

/**
 * Renders the event-type-specific description block below the meta line.
 *
 * Each event type has its own display logic:
 *   status_change      → "hangar → deployed" (status from/to)
 *   inspection_*       → "12 / 15 items · 2 damaged"
 *   damage_reported    → "Blade tip crack · Severe"
 *   shipped            → "794644823741\nHangar → Site Alpha"
 *   custody_handoff    → "Alice → Bob"
 *   mission_assigned   → mission name
 *   template_applied   → "Standard Kit · 15 items"
 *   <others>           → renders nothing
 *
 * Returns null when there is no metadata to render for this event type.
 */
function EventDescription({
  eventType,
  metadata,
}: EventDescriptionProps): React.ReactElement | null {
  if (!metadata) return null;

  switch (eventType) {
    case "status_change": {
      const from = typeof metadata.from === "string" ? metadata.from : null;
      const to   = typeof metadata.to   === "string" ? metadata.to   : null;
      if (!from && !to) return null;
      return (
        <span className={styles.description} data-testid="timeline-event-description">
          {from
            ? <span className={styles.statusFrom}>{from.replace(/_/g, " ")}</span>
            : <span className={styles.statusFrom}>—</span>
          }
          <span className={styles.statusArrow} aria-hidden="true">→</span>
          {to
            ? <span className={styles.statusTo}>{to.replace(/_/g, " ")}</span>
            : <span className={styles.statusTo}>—</span>
          }
        </span>
      );
    }

    case "inspection_started":
    case "inspection_completed": {
      const total   = typeof metadata.totalItems   === "number" ? metadata.totalItems   : null;
      const checked = typeof metadata.checkedItems === "number" ? metadata.checkedItems : null;
      const damaged = typeof metadata.damagedItems === "number" ? metadata.damagedItems : null;
      if (total === null) return null;
      const parts: string[] = [];
      if (checked !== null) parts.push(`${checked} / ${total} items`);
      if (damaged !== null && damaged > 0) parts.push(`${damaged} damaged`);
      if (parts.length === 0) return null;
      return (
        <span className={styles.description} data-testid="timeline-event-description">
          {parts.join(" · ")}
        </span>
      );
    }

    case "damage_reported": {
      const itemName = typeof metadata.itemName === "string" ? metadata.itemName : null;
      const severity = typeof metadata.severity === "string" ? metadata.severity : null;
      const parts: string[] = [];
      if (itemName) parts.push(itemName);
      if (severity) parts.push(severity);
      if (parts.length === 0) return null;
      return (
        <span className={styles.description} data-testid="timeline-event-description">
          {parts.join(" · ")}
        </span>
      );
    }

    case "shipped": {
      const trackingNumber  = typeof metadata.trackingNumber  === "string" ? metadata.trackingNumber  : null;
      const destinationName = typeof metadata.destinationName === "string" ? metadata.destinationName : null;
      const originName      = typeof metadata.originName      === "string" ? metadata.originName      : null;
      if (!trackingNumber && !destinationName) return null;
      return (
        <span className={styles.description} data-testid="timeline-event-description">
          {trackingNumber && (
            <span className={styles.trackingNumber}>{trackingNumber}</span>
          )}
          {destinationName && originName && (
            <span className={styles.routeSummary}>
              {originName} → {destinationName}
            </span>
          )}
          {destinationName && !originName && (
            <span className={styles.routeSummary}>→ {destinationName}</span>
          )}
        </span>
      );
    }

    case "custody_handoff": {
      const toName   = typeof metadata.toUserName   === "string" ? metadata.toUserName   : null;
      const fromName = typeof metadata.fromUserName === "string" ? metadata.fromUserName : null;
      if (!toName && !fromName) return null;
      return (
        <span className={styles.description} data-testid="timeline-event-description">
          {fromName && <span className={styles.custodyFrom}>{fromName}</span>}
          {fromName && toName && (
            <span className={styles.statusArrow} aria-hidden="true">→</span>
          )}
          {toName && <span className={styles.custodyTo}>{toName}</span>}
        </span>
      );
    }

    case "mission_assigned": {
      const missionName = typeof metadata.missionName === "string" ? metadata.missionName : null;
      if (!missionName) return null;
      return (
        <span className={styles.description} data-testid="timeline-event-description">
          {missionName}
        </span>
      );
    }

    case "template_applied": {
      const templateName = typeof metadata.templateName === "string" ? metadata.templateName : null;
      const itemCount    = typeof metadata.itemCount    === "number" ? metadata.itemCount    : null;
      const parts: string[] = [];
      if (templateName) parts.push(templateName);
      if (itemCount !== null) parts.push(`${itemCount} items`);
      if (parts.length === 0) return null;
      return (
        <span className={styles.description} data-testid="timeline-event-description">
          {parts.join(" · ")}
        </span>
      );
    }

    default:
      return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * TimelineEvent — a single entry in a vertical spine timeline.
 *
 * Renders as an `<li>` element — the parent must provide a `<ol>` or `<ul>`
 * container for valid HTML semantics.
 *
 * The component is purely presentational — no data fetching or subscriptions.
 * The parent is responsible for providing all event data (e.g., from
 * `useM2JourneyStops` or the SCAN app's local event state).
 *
 * @example
 *   // Minimal usage:
 *   <ol>
 *     <TimelineEvent
 *       eventType="custody_handoff"
 *       timestamp={Date.now()}
 *       actorName="Alice Tech"
 *       metadata={{ fromUserName: "Alice Tech", toUserName: "Bob Pilot" }}
 *       isFirst
 *       isLast
 *     />
 *   </ol>
 *
 * @example
 *   // From JourneyStop data (using the static helper):
 *   <ol>
 *     {stops.map((stop, i) => (
 *       <TimelineEvent
 *         key={stop.eventId}
 *         {...TimelineEvent.fromStop(stop, i, stops.length)}
 *       />
 *     ))}
 *   </ol>
 */
export function TimelineEvent({
  eventId,
  eventType,
  timestamp,
  actorName,
  metadata,
  location,
  hasCoordinates = false,
  isFirst  = false,
  isLast   = false,
  position,
  label,
  className,
  "data-testid": testId = "timeline-event",
}: TimelineEventProps) {
  const displayLabel = label ?? formatEventType(eventType);
  const dotVariant   = EVENT_DOT_VARIANTS[eventType] ?? "neutral";
  const statusKind   = deriveStatusKind(eventType, metadata);

  const hasLocation =
    location?.locationName ||
    (location?.lat !== undefined && location?.lng !== undefined);

  // Build accessible list item label
  const ariaLabel = position
    ? `Event ${position.current} of ${position.total}: ${displayLabel}`
    : displayLabel;

  const liClass = [styles.item, className].filter(Boolean).join(" ");

  return (
    <li
      className={liClass}
      data-testid={testId}
      data-event-type={eventType}
      data-event-id={eventId}
      data-is-first={isFirst ? "true" : undefined}
      data-is-last={isLast  ? "true" : undefined}
      aria-label={ariaLabel}
    >
      {/* ── Spine column: dot + connecting thread ─────────────────── */}
      <div className={styles.spineCol} aria-hidden="true">
        <div
          className={styles.dot}
          data-variant={dotVariant}
          data-no-location={!hasCoordinates ? "true" : undefined}
          data-testid="timeline-event-dot"
        />
        {/* Thread hidden for last event via CSS ([data-is-last="true"] .thread) */}
        <div className={styles.thread} data-testid="timeline-event-thread" />
      </div>

      {/* ── Content column ─────────────────────────────────────────── */}
      <div className={styles.contentCol}>
        {/* Event type label + optional StatusPill */}
        <div className={styles.eventHeader}>
          <span
            className={styles.eventType}
            data-testid="timeline-event-type"
          >
            {displayLabel}
          </span>
          {statusKind && (
            <StatusPill
              kind={statusKind}
              data-testid="timeline-event-pill"
            />
          )}
        </div>

        {/* Actor name + timestamp meta line */}
        <p className={styles.meta}>
          {actorName && (
            <span
              className={styles.actorName}
              data-testid="timeline-event-actor"
            >
              {actorName}
            </span>
          )}
          {actorName && (
            <span className={styles.metaSep} aria-hidden="true">·</span>
          )}
          <time
            className={styles.timestamp}
            dateTime={toISOString(timestamp)}
            data-testid="timeline-event-timestamp"
          >
            {formatTimestamp(timestamp)}
          </time>
        </p>

        {/* Event-type-specific description */}
        <EventDescription eventType={eventType} metadata={metadata} />

        {/* Location */}
        {hasLocation ? (
          <p className={styles.location} data-testid="timeline-event-location">
            {location?.locationName ||
              (location?.lat !== undefined && location?.lng !== undefined
                ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`
                : null)}
          </p>
        ) : (
          <p
            className={styles.locationMissing}
            data-testid="timeline-event-no-location"
          >
            No location recorded
          </p>
        )}
      </div>
    </li>
  );
}

// ─── Static helper ────────────────────────────────────────────────────────────

/**
 * Build `TimelineEventProps` from a `JourneyStop` and position context.
 *
 * Convenience helper for callers that have a JourneyStop array from
 * `useM2JourneyStops` and want to avoid spreading props manually.
 *
 * @example
 *   {stops.map((stop, i) => (
 *     <TimelineEvent
 *       key={stop.eventId}
 *       {...TimelineEvent.fromStop(stop, i, stops.length)}
 *     />
 *   ))}
 */
TimelineEvent.fromStop = function fromStop(
  stop: JourneyStop,
  index: number,
  total: number
): TimelineEventProps {
  return {
    eventId:       stop.eventId,
    eventType:     stop.eventType,
    timestamp:     stop.timestamp,
    actorName:     stop.actorName,
    metadata:      stop.metadata as Record<string, unknown>,
    location:      stop.location,
    hasCoordinates: stop.hasCoordinates,
    isFirst:       index === 0,
    isLast:        index === total - 1,
    position:      { current: index + 1, total },
  };
};

export default TimelineEvent;
