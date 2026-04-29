/**
 * T1TimelinePanel — Scrollable vertical event timeline for the T1 right panel.
 *
 * Positioned in the right 50% of the T1Shell CSS grid (grid-template-columns:
 * 1fr 1fr).  Shows the full chronological lifecycle event history for a single
 * case as a vertical spine timeline, newest-first by default.
 *
 * Architecture
 * ────────────
 * This component is the right-panel content of T1Overview.  It subscribes
 * to `getCaseEvents` (convex/queries/events.ts) via Convex WebSocket, which
 * returns the complete, immutable append-only event log for the case in
 * chronological order (oldest first from the server).  T1TimelinePanel
 * reverses the list to show newest first — appropriate for a summary view
 * where the most recent activity is most relevant.
 *
 * Unlike T2Timeline (which uses journey stops from getM2JourneyStops),
 * T1TimelinePanel subscribes to the raw events table via getCaseEvents.
 * This gives access to all event types including item_checked, note_added,
 * photo_added, and qr_associated which are excluded from journey stops.
 *
 * Data mapping
 * ────────────
 * CaseEvent.data is adapted to TimelineEvent's metadata format.  The key
 * difference is that status_change events in the events table use
 * `fromStatus` / `toStatus` field names, while TimelineEvent expects
 * `from` / `to`.  The `adaptEventData` helper normalises this difference.
 *
 * Location data (lat, lng, locationName) is extracted from event.data when
 * present — not all events carry geographic context.
 *
 * Real-time fidelity
 * ──────────────────
 * Convex re-evaluates the getCaseEvents subscription and pushes the updated
 * event list within ~100–300 ms whenever any SCAN app mutation inserts a new
 * event row for this case, satisfying the ≤ 2-second real-time fidelity SLA.
 *
 * States
 * ──────
 *   events === undefined — loading (shows animated skeleton rows)
 *   events.length === 0  — empty (shows placeholder with icon + message)
 *   events.length >  0   — renders events via TimelineEvent (newest first)
 *
 * Grid placement
 * ──────────────
 * T1Shell's right panel cell is a flex-column with overflow-y: auto and
 * padding: 1.25rem.  T1TimelinePanel does NOT create a second scroll
 * container — it lets the parent panel cell handle scrolling.  The sticky
 * panel header compensates for the parent's 1.25rem padding by setting
 * `top: -1.25rem`, exactly matching T2Timeline's sticky offset calculation.
 *
 * Design tokens
 * ─────────────
 *   • No hex literals — all colors via CSS custom properties
 *   • Inter Tight for headings, labels, actor names, and metadata text
 *   • IBM Plex Mono for timestamps, count badges, and data values
 *   • WCAG AA contrast in both light and dark themes
 *
 * Usage (in T1Overview):
 * @example
 *   // T1Overview passes this as the rightPanel slot of T1Shell
 *   <T1Shell
 *     leftPanel={<T1MapPanel caseId={caseId} mapboxToken={MAPBOX_TOKEN} />}
 *     rightPanel={<T1TimelinePanel caseId={caseId} />}
 *     leftPanelHasMap
 *   />
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { TimelineEvent } from "../TimelineEvent/TimelineEvent";
import type { CaseEvent } from "../../../convex/queries/events";
import styles from "./T1TimelinePanel.module.css";
import shared from "./shared.module.css";

// ─── Convex API key access ─────────────────────────────────────────────────────
//
// queries/events is a sub-module registered as api["queries/events"].
// We use the dynamic-key pattern used by other hooks in this codebase
// (use-scan-queries.ts, use-custody.ts, use-damage-reports.ts) to remain
// compatible with stale generated types.
const eventsApi = (api as unknown as Record<string, Record<string, unknown>>)[
  "queries/events"
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface T1TimelinePanelProps {
  /**
   * Convex document ID of the case whose events to display.
   * Required — the panel is always rendered in the context of a selected case.
   */
  caseId: string;

  /**
   * Additional CSS class applied to the root element for caller-side overrides.
   * Optional — most consumers use the component without a custom class.
   */
  className?: string;
}

// ─── Data mapping helpers ──────────────────────────────────────────────────────

/**
 * Adapt CaseEvent.data to TimelineEvent's metadata format.
 *
 * The main difference between events table payloads and TimelineEvent's
 * expected metadata is the field names for status_change events:
 *
 *   events table:   { fromStatus: "hangar", toStatus: "deployed" }
 *   TimelineEvent:  { from: "hangar", to: "deployed" }
 *
 * For all other event types, the data object is passed through as-is since
 * the field names align (fromUserName/toUserName for custody_handoff,
 * trackingNumber/originName/destinationName for shipped, etc.).
 *
 * Preserves all original fields from data so that any custom metadata
 * rendered by TimelineEvent's EventDescription sub-component is accessible.
 */
function adaptEventData(
  eventType: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  if (eventType === "status_change") {
    // Remap fromStatus → from and toStatus → to for TimelineEvent's
    // EventDescription.  Keep the original fromStatus/toStatus fields too
    // in case any future component reads them directly.
    return {
      ...data,
      from: data.fromStatus ?? data.from,
      to:   data.toStatus   ?? data.to,
    };
  }
  return data;
}

/**
 * Extract location context from an event's data payload.
 *
 * Location data is embedded in event.data for events that capture
 * geographic context at write time (status_change with GPS, scan_check_in).
 * Events that don't carry location data (template_applied, mission_assigned)
 * return undefined for all fields, and hasCoordinates will be false.
 *
 * @returns { lat?, lng?, locationName? } and hasCoordinates boolean
 */
function deriveEventLocation(data: Record<string, unknown>): {
  location: { lat?: number; lng?: number; locationName?: string };
  hasCoordinates: boolean;
} {
  const lat          = typeof data.lat          === "number" ? data.lat          : undefined;
  const lng          = typeof data.lng          === "number" ? data.lng          : undefined;
  const locationName = typeof data.locationName === "string" ? data.locationName : undefined;

  return {
    location: { lat, lng, locationName },
    hasCoordinates: lat !== undefined && lng !== undefined,
  };
}

// ─── Loading skeleton ──────────────────────────────────────────────────────────

/**
 * Skeleton shown while the getCaseEvents Convex query is in-flight.
 * Renders 3 shimmer rows in the same grid layout as the real event items,
 * so the layout doesn't shift when data arrives.
 */
function T1TimelineSkeleton() {
  return (
    <div
      className={styles.skeleton}
      aria-busy="true"
      aria-label="Loading event timeline"
      role="status"
      data-testid="t1-timeline-skeleton"
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.skeletonItem}>
          {/* Spine column: dot + thread */}
          <div className={styles.skeletonSpineCol} aria-hidden="true">
            <div className={styles.skeletonDot} />
            {/* No thread after the last skeleton row */}
            {i < 2 && <div className={styles.skeletonThread} />}
          </div>

          {/* Content column: title + meta + detail bars */}
          <div className={styles.skeletonContentCol}>
            <div className={`${styles.skeletonLine} ${styles.skeletonLineTitle}`} />
            <div className={`${styles.skeletonLine} ${styles.skeletonLineMeta}`} />
            <div className={`${styles.skeletonLine} ${styles.skeletonLineDetail}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────

/**
 * Shown when getCaseEvents returns an empty array (no events yet recorded).
 * Uses the shared emptyState layout from shared.module.css.
 */
function T1TimelineEmpty() {
  return (
    <div
      className={shared.emptyState}
      data-testid="t1-timeline-empty"
    >
      {/* Clock / history icon */}
      <svg
        className={shared.emptyStateIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <p className={shared.emptyStateTitle}>No events yet</p>
      <p className={shared.emptyStateText}>
        Lifecycle events — status changes, inspections, shipments, and custody
        handoffs — will appear here as they occur.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * T1TimelinePanel
 *
 * Scrollable vertical event timeline for the right 50% of the T1 case detail
 * grid.  Subscribes to getCaseEvents via Convex, adapts each CaseEvent to
 * TimelineEvent props, and renders the full event history newest-first.
 *
 * The parent T1Shell right panel cell handles overflow-y: auto scrolling.
 * T1TimelinePanel does not create its own scroll container.
 *
 * Accessibility:
 *   • Sticky panel header: role implicit (div), labelled by .panelTitle h3
 *   • Event list: <ol> with aria-label describing total event count
 *   • Each event: aria-label via TimelineEvent's position prop
 *   • Loading state: aria-busy + role="status" on skeleton container
 *   • Empty state: uses shared.emptyState layout (aria implicitly readable)
 *   • Count badge: aria-live="polite" aria-atomic="true"
 */
export function T1TimelinePanel({
  caseId,
  className,
}: T1TimelinePanelProps) {
  // ── Convex subscription ──────────────────────────────────────────────────────
  //
  // getCaseEvents returns all events for this case ordered by timestamp ASC
  // (oldest first from the server).  We reverse for display (newest first).
  //
  // Return values:
  //   undefined    — subscription loading (first fetch or reconnect)
  //   CaseEvent[]  — hydrated event list (may be empty array)
  //
  // Convex re-evaluates and pushes within ~100–300 ms of any new event insert,
  // satisfying the ≤ 2-second real-time fidelity requirement.
  const events = useQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventsApi?.["getCaseEvents"] as any,
    { caseId: caseId as Id<"cases"> }
  ) as CaseEvent[] | undefined;

  const rootClass = [styles.root, className].filter(Boolean).join(" ");

  // ── Panel header (shared across all states) ──────────────────────────────────
  //
  // Sticky header stays pinned below the top of the panel scroll area.
  // top: -1.25rem compensates for the parent T1Shell .panel padding: 1.25rem,
  // following the same offset calculation as T2Timeline.module.css.
  const panelHeader = (
    <div className={styles.panelHeader}>
      <div className={styles.panelHeaderLeft}>
        <h3 className={styles.panelTitle} id={`t1-timeline-heading-${caseId}`}>
          Recent Activity
        </h3>
        {/*
         * Count badge — live update announced to screen readers when new
         * events arrive via Convex push.  Shown only when events are loaded.
         */}
        {Array.isArray(events) && events.length > 0 && (
          <span
            className={styles.countBadge}
            aria-live="polite"
            aria-atomic="true"
            aria-label={`${events.length} event${events.length !== 1 ? "s" : ""}`}
            data-testid="t1-timeline-count"
          >
            {events.length}
          </span>
        )}
      </div>
    </div>
  );

  // ── Loading state ─────────────────────────────────────────────────────────────
  if (events === undefined) {
    return (
      <div
        className={rootClass}
        data-testid="t1-timeline-panel"
        data-state="loading"
        aria-labelledby={`t1-timeline-heading-${caseId}`}
      >
        {panelHeader}
        <T1TimelineSkeleton />
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (events.length === 0) {
    return (
      <div
        className={rootClass}
        data-testid="t1-timeline-panel"
        data-state="empty"
        aria-labelledby={`t1-timeline-heading-${caseId}`}
      >
        {panelHeader}
        <T1TimelineEmpty />
      </div>
    );
  }

  // ── Events available — render vertical spine timeline ─────────────────────────
  //
  // Reverse to show newest first (server returns oldest first).
  // A shallow copy is created (spread) to avoid mutating the query result,
  // which may be cached by Convex and shared across renders.
  const sortedEvents: CaseEvent[] = [...events].reverse();
  const totalEvents = sortedEvents.length;

  return (
    <div
      className={rootClass}
      data-testid="t1-timeline-panel"
      data-state="loaded"
      data-event-count={totalEvents}
      aria-labelledby={`t1-timeline-heading-${caseId}`}
    >
      {panelHeader}

      {/*
       * ── Vertical spine timeline ─────────────────────────────────────────────
       *
       * <ol> provides ordinal semantics — the sequence of events is
       * meaningful (newest to oldest in display order).
       *
       * Each <TimelineEvent> renders as an <li> — valid HTML list item.
       *
       * isFirst / isLast flags are based on the REVERSED (display) order:
       *   index === 0          → isFirst (newest event, shown at top)
       *   index === total - 1  → isLast  (oldest event, shown at bottom)
       *
       * position.current counts from 1 (top) to N (bottom), so
       * the screen reader reads: "Event 1 of N: Shipped" for the newest.
       */}
      <ol
        className={styles.eventList}
        aria-label={`${totalEvents} recent event${totalEvents !== 1 ? "s" : ""} for this case`}
        data-testid="t1-timeline-list"
      >
        {sortedEvents.map((event, index) => {
          const { location, hasCoordinates } = deriveEventLocation(event.data);
          const metadata = adaptEventData(event.eventType, event.data);

          return (
            <TimelineEvent
              key={event._id}
              eventId={event._id}
              eventType={event.eventType}
              timestamp={event.timestamp}
              actorName={event.userName}
              metadata={metadata}
              location={location}
              hasCoordinates={hasCoordinates}
              isFirst={index === 0}
              isLast={index === totalEvents - 1}
              position={{ current: index + 1, total: totalEvents }}
              data-testid="t1-timeline-event"
            />
          );
        })}
      </ol>
    </div>
  );
}

export default T1TimelinePanel;
