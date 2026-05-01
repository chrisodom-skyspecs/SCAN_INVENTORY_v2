/**
 * T2Timeline — Vertical Spine Event Timeline Panel
 *
 * The T2 "timeline-is-the-page" layout: the entire case detail panel is a
 * full-height scrollable vertical spine timeline of lifecycle events.
 *
 * Architecture
 * ────────────
 * This component is the T2-slot layout for the CaseDetailPanel.  Unlike T2Manifest
 * (which shows packing list items) or the compact JourneyTimeline embedded in T1,
 * T2Timeline makes the event timeline the PRIMARY content — every significant case
 * event fills the panel from top to bottom with no secondary sections.
 *
 * Data source
 * ───────────
 * Subscribes to `getM2JourneyStops` via `useM2JourneyStops(caseId)`.  Journey stops
 * include all meaningful lifecycle events (status changes, inspections, shipments,
 * custody handoffs, damage reports, mission assignments, template applications) but
 * exclude high-frequency noise events (item_checked, photo_added, note_added).
 *
 * Convex re-evaluates the subscription within ~100–300 ms of any SCAN app mutation
 * that appends a new event — satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Layout structure
 * ────────────────
 * The panel body (CaseDetailPanel .body) already handles overflow-y: auto and
 * padding.  T2Timeline does NOT create a second scrollable container — it relies on
 * the panel body to scroll.  The vertical spine threads through all events, with
 * each event displaying:
 *
 *   ── [Date Header: "Today"]  ← sticky, pins below panelHeader as user scrolls
 *
 *   ● ── [Event type label]  [StatusPill?]
 *   │    [Actor name · timestamp]
 *   │    [Location or metadata detail]
 *   │
 *   ● ── [Event type label]  ...
 *
 *   ── [Date Header: "Yesterday"]  ← next group's header pushes previous out
 *
 *   ● ── [Event type label]  ...
 *
 * The leftmost column is the "spine column" — a vertical thread connecting event
 * dots.  The line is continuous from event to event, hidden after the last event.
 *
 * Sticky date headers (Sub-AC 2)
 * ──────────────────────────────
 * Events are grouped by calendar day (local time).  Each day section begins with
 * a sticky date header that pins to the top of the scrollable viewport beneath
 * the fixed panelHeader.  As the user scrolls:
 *
 *   1. The panelHeader stays at the very top (position: sticky, top: -1.25rem).
 *   2. Date headers stick at 1.125rem from the scroll area top — i.e., flush
 *      below the panelHeader — as the user scrolls through each day's events.
 *   3. When a new date group enters, its header pushes the previous one up.
 *
 * Date labels:
 *   • Today     — "Today"
 *   • Yesterday — "Yesterday"
 *   • This year — "Mon, Jan 15"   (abbreviated weekday + month + day)
 *   • Older     — "Mon, Jan 15, 2025" (adds year)
 *
 * Visual design
 * ─────────────
 * Event dots use event-type-specific semantic colors:
 *   • status_change       → brand color (blue) — lifecycle progression
 *   • inspection_started  → transit color (blue) — field action
 *   • inspection_completed → deployed color (green) — positive completion
 *   • damage_reported     → error color (red) — requires attention
 *   • shipped             → transit color (blue) — in transit
 *   • delivered           → deployed color (green) — positive outcome
 *   • custody_handoff     → neutral color (gray) — transfer of responsibility
 *   • mission_assigned    → brand color (blue) — operational assignment
 *   • template_applied    → neutral color (gray) — configuration
 *
 * Sort order
 * ──────────
 * Default: oldest-first (chronological, reading top-to-bottom like a story).
 * A toggle button switches to newest-first (most recent at top).
 * The sort preference is local state — not persisted.
 *
 * Accessibility
 * ─────────────
 * • The timeline wrapper has role="group" with an aria-label (total event count).
 * • Each date group is a <section> with an aria-label (events on that date).
 * • Date headers have role="heading" aria-level={4} below the h3 panel title.
 * • Each date group's events are an <ol> (ordinal sequence is semantically significant).
 * • Timestamps use `<time dateTime={isoString}>`.
 * • Sort toggle button has aria-label describing its action.
 * • Loading state has aria-busy + aria-label.
 * • WCAG AA contrast on all text + icon elements in both themes.
 *
 * Usage (in CaseDetailPanel T2 slot):
 * @example
 *   // CaseDetailPanel routes to T2Timeline when window === "T2"
 *   case "T2":
 *     return <T2Timeline caseId={caseId} />;
 */

"use client";

import { useState } from "react";
import { useM2JourneyStops } from "../../hooks/use-m2-journey-stops";
import type { JourneyStop } from "../../hooks/use-m2-journey-stops";
import { StatusPill } from "../StatusPill";
import shared from "./shared.module.css";
import styles from "./T2Timeline.module.css";

// ─── Date grouping helpers ─────────────────────────────────────────────────────

/**
 * Build a stable cache key for the local calendar day of an epoch timestamp.
 * Produces "YYYY-M-D" (no zero-padding) using local time — consistent with
 * how `getDateLabel` determines "today" and "yesterday."
 */
function getDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Produce a human-readable label for a calendar day:
 *   • "Today"      — same local calendar date as now
 *   • "Yesterday"  — one local calendar date before now
 *   • "Mon, Jan 15"     — this year (abbreviated weekday + short month + day)
 *   • "Mon, Jan 15, 2025" — prior years (adds the year)
 *
 * Uses the browser's locale via `toLocaleDateString` for month abbreviations.
 */
function getDateLabel(epochMs: number): string {
  const now = new Date();
  const d   = new Date(epochMs);

  // Build midnight-local Date objects for comparison
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eventMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const diffDays = Math.round(
    (todayMidnight.getTime() - eventMidnight.getTime()) / 86_400_000
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month:   "short",
    day:     "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** A group of timeline stops that share the same calendar day. */
interface DateGroup {
  /** Stable key: "YYYY-M-D" (local time). */
  dateKey:   string;
  /** Display label: "Today", "Yesterday", or formatted date string. */
  dateLabel: string;
  /** Stops in this group, in the caller's sorted order. */
  stops:     JourneyStop[];
}

/**
 * Group a sorted array of journey stops by their local calendar day.
 *
 * Preserves the input sort order within each group (oldest-first or
 * newest-first depending on the current `sortOrder` setting).  Groups
 * are returned in the order that the first stop of each group appears in
 * the sorted input — i.e., the grouping order follows the display order.
 */
function groupStopsByDate(stops: JourneyStop[]): DateGroup[] {
  const groups: DateGroup[]       = [];
  const keyToIndex                = new Map<string, number>();

  for (const stop of stops) {
    const key     = getDateKey(stop.timestamp);
    const existing = keyToIndex.get(key);
    if (existing !== undefined) {
      groups[existing].stops.push(stop);
    } else {
      keyToIndex.set(key, groups.length);
      groups.push({
        dateKey:   key,
        dateLabel: getDateLabel(stop.timestamp),
        stops:     [stop],
      });
    }
  }

  return groups;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Human-readable labels for each event type slug. */
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
};

/**
 * Map event type slugs to CSS data-attributes on the dot element.
 * These control the semantic color of the spine dot via CSS attribute selectors.
 */
const EVENT_DOT_VARIANTS: Record<string, string> = {
  status_change:        "brand",
  inspection_started:   "transit",
  inspection_completed: "success",
  damage_reported:      "error",
  shipped:              "transit",
  delivered:            "success",
  custody_handoff:      "neutral",
  mission_assigned:     "brand",
  template_applied:     "neutral",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format an event type slug to a human-readable label. */
function formatEventType(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ??
    eventType
      .split("_")
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ");
}

/** Full date + time for display in the timeline. */
function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month:  "short",
    day:    "numeric",
    hour:   "numeric",
    minute: "2-digit",
  });
}

/** ISO 8601 string for `<time dateTime={...}>`. */
function toISOString(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Derive the StatusPill kind for a journey stop, if applicable.
 *
 * Only status_change and semantically positive/negative events
 * map to a StatusPill — others are represented via dot color alone.
 */
function deriveStatusKind(stop: JourneyStop): string | null {
  const validCaseStatuses = new Set([
    "hangar", "assembled", "transit_out", "deployed",
    "flagged", "recalled", "transit_in", "received", "archived",
  ]);

  switch (stop.eventType) {
    case "status_change": {
      const to = stop.metadata?.to;
      if (typeof to === "string" && validCaseStatuses.has(to)) return to;
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

/**
 * Render a concise metadata summary line for an event.
 * Returns null when no summary is available.
 */
function EventMetaDetail({ stop }: { stop: JourneyStop }): React.ReactElement | null {
  const data = stop.metadata;

  switch (stop.eventType) {
    case "status_change": {
      const from = typeof data?.from === "string" ? data.from : null;
      const to   = typeof data?.to   === "string" ? data.to   : null;
      if (!from && !to) return null;
      return (
        <span className={styles.eventDetail}>
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
      const total   = typeof data?.totalItems   === "number" ? data.totalItems   : null;
      const checked = typeof data?.checkedItems === "number" ? data.checkedItems : null;
      const damaged = typeof data?.damagedItems === "number" ? data.damagedItems : null;
      if (total === null) return null;
      const parts: string[] = [];
      if (checked !== null && total !== null) parts.push(`${checked} / ${total} items`);
      if (damaged !== null && damaged > 0)   parts.push(`${damaged} damaged`);
      return <span className={styles.eventDetail}>{parts.join(" · ")}</span>;
    }

    case "damage_reported": {
      const itemName  = typeof data?.itemName  === "string" ? data.itemName  : null;
      const severity  = typeof data?.severity  === "string" ? data.severity  : null;
      const parts: string[] = [];
      if (itemName) parts.push(itemName);
      if (severity) parts.push(severity);
      if (parts.length === 0) return null;
      return <span className={styles.eventDetail}>{parts.join(" · ")}</span>;
    }

    case "shipped": {
      const trackingNumber  = typeof data?.trackingNumber  === "string" ? data.trackingNumber  : null;
      const destinationName = typeof data?.destinationName === "string" ? data.destinationName : null;
      const originName      = typeof data?.originName      === "string" ? data.originName      : null;
      if (!trackingNumber && !destinationName) return null;
      return (
        <span className={styles.eventDetail}>
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
      const toName   = typeof data?.toUserName   === "string" ? data.toUserName   : null;
      const fromName = typeof data?.fromUserName === "string" ? data.fromUserName : null;
      if (!toName && !fromName) return null;
      return (
        <span className={styles.eventDetail}>
          {fromName && <span className={styles.custodyFrom}>{fromName}</span>}
          {fromName && toName && (
            <span className={styles.statusArrow} aria-hidden="true">→</span>
          )}
          {toName && <span className={styles.custodyTo}>{toName}</span>}
        </span>
      );
    }

    case "mission_assigned": {
      const missionName = typeof data?.missionName === "string" ? data.missionName : null;
      if (!missionName) return null;
      return <span className={styles.eventDetail}>{missionName}</span>;
    }

    case "template_applied": {
      const templateName = typeof data?.templateName === "string" ? data.templateName : null;
      const itemCount    = typeof data?.itemCount    === "number" ? data.itemCount    : null;
      if (!templateName && itemCount === null) return null;
      const parts: string[] = [];
      if (templateName) parts.push(templateName);
      if (itemCount !== null) parts.push(`${itemCount} items`);
      return <span className={styles.eventDetail}>{parts.join(" · ")}</span>;
    }

    default:
      return null;
  }
}

// ─── Single timeline event item ───────────────────────────────────────────────

interface TimelineEventProps {
  stop:    JourneyStop;
  isFirst: boolean;
  isLast:  boolean;
  /** Total event count — used for accessible positioning label. */
  total:   number;
}

function TimelineEvent({ stop, isFirst, isLast, total }: TimelineEventProps) {
  const eventLabel  = formatEventType(stop.eventType);
  const statusKind  = deriveStatusKind(stop);
  const dotVariant  = EVENT_DOT_VARIANTS[stop.eventType] ?? "neutral";

  const hasLocation =
    stop.location.locationName ||
    (stop.location.lat !== undefined && stop.location.lng !== undefined);

  return (
    <li
      className={styles.eventItem}
      data-event-type={stop.eventType}
      data-is-first={isFirst ? "true" : undefined}
      data-is-last={isLast ? "true" : undefined}
      aria-label={`Event ${stop.stopIndex} of ${total}: ${eventLabel}`}
    >
      {/* ── Spine column: dot + vertical thread ─────────────────── */}
      <div className={styles.spineCol} aria-hidden="true">
        <div className={styles.dot} data-variant={dotVariant} data-no-location={!stop.hasCoordinates ? "true" : undefined} />
        {!isLast && <div className={styles.thread} />}
      </div>

      {/* ── Content column: event details ────────────────────────── */}
      <div className={styles.contentCol}>
        {/* Event type + optional StatusPill */}
        <div className={styles.eventHeader}>
          <span className={styles.eventType}>{eventLabel}</span>
          {statusKind && (
            <StatusPill
              kind={statusKind as Parameters<typeof StatusPill>[0]["kind"]}
            />
          )}
        </div>

        {/* Actor + timestamp */}
        <p className={styles.eventMeta}>
          {stop.actorName && (
            <span className={styles.actorName}>{stop.actorName}</span>
          )}
          {stop.actorName && <span className={styles.metaSep} aria-hidden="true">·</span>}
          <time
            dateTime={toISOString(stop.timestamp)}
            className={styles.timestamp}
          >
            {formatTimestamp(stop.timestamp)}
          </time>
        </p>

        {/* Event-type-specific metadata detail */}
        <EventMetaDetail stop={stop} />

        {/* Location */}
        {hasLocation && (
          <p className={styles.location}>
            {stop.location.locationName ||
              (stop.location.lat !== undefined && stop.location.lng !== undefined
                ? `${stop.location.lat.toFixed(4)}, ${stop.location.lng.toFixed(4)}`
                : null)}
          </p>
        )}
        {!hasLocation && (
          <p className={styles.locationMissing}>No location recorded</p>
        )}
      </div>
    </li>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function TimelineSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Loading event timeline">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={styles.skeletonItem}>
          <div className={styles.skeletonSpineCol} aria-hidden="true">
            <div className={styles.skeletonDot} />
            {i < 3 && <div className={styles.skeletonThread} />}
          </div>
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

// ─── Props ────────────────────────────────────────────────────────────────────

export interface T2TimelineProps {
  /** Convex document ID of the case to display events for. */
  caseId: string;
  /** Additional CSS class applied to the root element. */
  className?: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * T2Timeline — the "timeline-is-the-page" case detail layout.
 *
 * The full panel content is a vertical spine timeline of lifecycle events.
 * Subscribes in real-time to journey stops via `useM2JourneyStops`.
 *
 * States:
 *   loading          — renders a 4-row skeleton
 *   case not found   — renders an error notice
 *   no events        — renders an empty-state illustration
 *   data available   — renders the full vertical spine timeline
 */
export default function T2Timeline({ caseId, className }: T2TimelineProps) {
  // Sort order: "asc" = oldest first (chronological), "desc" = newest first
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Real-time subscription to journey stops via Convex WebSocket.
  // Convex re-evaluates the query and pushes an update within ~100–300 ms of
  // any SCAN app mutation that appends a new event (scanCheckIn, handoffCustody,
  // shipCase, completeInspection), satisfying the ≤ 2-second real-time fidelity
  // requirement between SCAN app actions and INVENTORY dashboard visibility.
  const journey = useM2JourneyStops(caseId);

  const rootClass = [styles.root, className].filter(Boolean).join(" ");

  // ── Loading state ──────────────────────────────────────────────────────────
  if (journey === undefined) {
    return (
      <div className={rootClass} data-testid="t2-timeline">
        <TimelineSkeleton />
      </div>
    );
  }

  // ── Case not found ─────────────────────────────────────────────────────────
  if (journey === null) {
    return (
      <div className={rootClass} data-testid="t2-timeline">
        <div className={shared.emptyState} role="alert">
          <p className={shared.emptyStateTitle}>Case not found</p>
          <p className={shared.emptyStateText}>
            This case may have been deleted or the ID is invalid.
          </p>
        </div>
      </div>
    );
  }

  const { stops, stopCount, caseLabel } = journey;

  // ── Sort stops per user preference ────────────────────────────────────────
  // journey.stops is already sorted oldest-first by the server.
  // For newest-first we just reverse the copy in memory.
  const sortedStops: JourneyStop[] =
    sortOrder === "asc" ? stops : [...stops].reverse();

  // ── Date grouping ─────────────────────────────────────────────────────────
  // Group the sorted stops by local calendar day so each day section gets a
  // sticky date header.  The grouping order follows the current sort order —
  // oldest-first or newest-first — so the date headers read in display order.
  const dateGroups = groupStopsByDate(sortedStops);
  const totalStops = sortedStops.length;

  // Build a lookup from eventId → global index in sortedStops so we can
  // determine isFirst / isLast across all date groups efficiently.
  const globalIndexByEventId = new Map<string, number>(
    sortedStops.map((s, i) => [s.eventId, i])
  );

  return (
    <div
      className={rootClass}
      data-testid="t2-timeline"
    >
      {/* ── Panel header ─────────────────────────────────────────────── */}
      <div className={styles.panelHeader}>
        <div className={styles.panelHeaderLeft}>
          <h3 className={styles.panelTitle}>Event Timeline</h3>
          {stopCount > 0 && (
            <span
              className={styles.countBadge}
              aria-live="polite"
              aria-atomic="true"
              aria-label={`${stopCount} event${stopCount !== 1 ? "s" : ""}`}
              data-testid="t2-timeline-count"
            >
              {stopCount}
            </span>
          )}
        </div>

        {stopCount > 1 && (
          <button
            type="button"
            className={styles.sortToggle}
            onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))}
            aria-label={
              sortOrder === "asc"
                ? "Switch to newest first"
                : "Switch to oldest first"
            }
            data-testid="t2-timeline-sort-toggle"
          >
            <span className={styles.sortIcon} aria-hidden="true">
              {sortOrder === "asc" ? "↓" : "↑"}
            </span>
            {sortOrder === "asc" ? "Oldest first" : "Newest first"}
          </button>
        )}
      </div>

      {/* ── Case identity row ─────────────────────────────────────────── */}
      <div className={styles.caseIdentity}>
        <span className={styles.caseLabel}>{caseLabel}</span>
        <span className={styles.currentStatus}>
          {journey.currentStatus.replace(/_/g, " ")}
        </span>
      </div>

      <hr className={shared.divider} />

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {stops.length === 0 ? (
        <div className={shared.emptyState} data-testid="t2-timeline-empty">
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
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
          <p className={shared.emptyStateTitle}>No events recorded yet</p>
          <p className={shared.emptyStateText}>
            Events will appear here as the case moves through its lifecycle —
            status changes, inspections, shipments, and custody handoffs.
          </p>
        </div>
      ) : (
        /*
         * ── Date-grouped vertical spine timeline ─────────────────────────
         *
         * Events are organised into per-day sections.  Each section has a
         * sticky date header that pins below the panelHeader as the user
         * scrolls.  The spine thread is continuous within each section; it
         * terminates after the last event in the entire timeline (not per
         * section), so isFirst/isLast are tracked globally.
         */
        <div
          className={styles.timeline}
          aria-label={`${stopCount} lifecycle event${stopCount !== 1 ? "s" : ""} for case ${caseLabel}`}
          data-sort={sortOrder}
          data-testid="t2-timeline-list"
          role="group"
        >
          {dateGroups.map((group) => (
            <section
              key={group.dateKey}
              className={styles.dateGroup}
              aria-label={`${group.stops.length} event${group.stops.length !== 1 ? "s" : ""} on ${group.dateLabel}`}
            >
              {/*
               * Sticky date header
               * ──────────────────
               * position: sticky; top: 1.125rem places this header flush below
               * the panelHeader (which sticks at top: -1.25rem and has a visual
               * height of ≈2.375rem; net = 2.375rem - 1.25rem = 1.125rem).
               *
               * As the user scrolls, the current day's header sticks below the
               * panelHeader.  When the next day's events reach the sticky
               * threshold, that header pushes the previous one upward.
               */}
              <div
                className={styles.dateHeader}
                role="heading"
                aria-level={4}
                data-testid="timeline-date-header"
              >
                <span className={styles.dateHeaderLabel}>{group.dateLabel}</span>
                <span
                  className={styles.dateHeaderCount}
                  aria-hidden="true"
                  title={`${group.stops.length} event${group.stops.length !== 1 ? "s" : ""} on this day`}
                >
                  {group.stops.length}
                </span>
              </div>

              {/* Ordered event list for this date group */}
              <ol
                className={styles.eventList}
                aria-label={`${group.stops.length} event${group.stops.length !== 1 ? "s" : ""} on ${group.dateLabel}`}
              >
                {group.stops.map((stop) => {
                  // isFirst / isLast are global across all date groups so the
                  // first event in the oldest-day group is "first" and the last
                  // event in the newest-day group (or vice-versa when desc) is "last".
                  const globalIdx = globalIndexByEventId.get(stop.eventId) ?? 0;
                  const isFirst   = globalIdx === 0;
                  const isLast    = globalIdx === totalStops - 1;

                  return (
                    <TimelineEvent
                      key={stop.eventId}
                      stop={stop}
                      isFirst={isFirst}
                      isLast={isLast}
                      total={totalStops}
                    />
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
