/**
 * DossierActivityPanel — Activity tab content for the T4 Tabbed Dossier.
 *
 * Rendered in the "Activity" tab of T4DossierShell (used under the
 * FF_INV_REDESIGN code path, gated by FF_AUDIT_HASH_CHAIN).
 *
 * Provides a chronological "recent actions feed" — the complete case event
 * history displayed as a flat activity feed rather than a spine timeline.
 *
 * Key differentiation from other timeline views:
 *   • T1TimelinePanel  — compact right-panel vertical spine (dot + thread)
 *   • T2Timeline       — full-page vertical spine (timeline-is-the-page)
 *   • T5Audit          — paginated audit ledger table with hash chain
 *   • DossierActivityPanel — flat activity feed with prominent action-type
 *                            indicators and user attribution badges
 *
 * Panel anatomy (per entry):
 * ─────────────────────────
 *   [action-chip]  [event-label]               [status-pill?]
 *   [user-avatar]  [user-name] · [timestamp]
 *   [event-description]
 *
 * Action type indicators
 * ──────────────────────
 * Each event row leads with a compact colored chip that identifies the action
 * category.  The chip uses a short uppercase label and a category-specific
 * background color derived from the design-system token palette:
 *
 *   STATUS  → brand blue   (status_change)
 *   INSPECT → transit blue (inspection_started, inspection_completed, item_checked)
 *   DAMAGE  → error red    (damage_reported)
 *   SHIP    → transit blue (shipped, delivered)
 *   CUSTODY → neutral      (custody_handoff)
 *   MISSION → brand blue   (mission_assigned)
 *   CONFIG  → neutral      (template_applied)
 *   MEDIA   → neutral      (photo_added, note_added, scan_check_in, qr_associated)
 *
 * User activity entries
 * ─────────────────────
 * User attribution is visually prominent: each entry shows a circular avatar
 * with the user's initials (derived from the actor display name) alongside
 * the full name and a separator before the ISO timestamp.
 *
 * Real-time fidelity
 * ──────────────────
 * Subscribes to all case events via `useCaseEvents` (wraps
 * `api["queries/events"].getCaseEvents`).  Convex re-evaluates and pushes
 * the updated event list within ~100–300 ms of any SCAN app mutation,
 * satisfying the ≤ 2-second real-time SLA between field action and dashboard.
 *
 * Sort order
 * ──────────
 * Newest-first by default (most recent action at top of feed).  The server
 * returns events oldest-first; the panel reverses in memory for display.
 *
 * States
 * ──────
 *   events === undefined  — loading (shows animated skeleton rows)
 *   events.length === 0   — empty (shows placeholder with activity icon + message)
 *   events.length > 0     — renders activity feed (newest first)
 *
 * Design-system compliance
 * ─────────────────────────
 *   • No hex literals — CSS custom properties only
 *   • Inter Tight for all UI typography (labels, names, descriptions)
 *   • IBM Plex Mono for timestamps and data identifiers
 *   • StatusPill for all status indicators
 *   • WCAG AA contrast in both light and dark themes
 *   • dark theme via .theme-dark on html element
 *
 * @example
 *   // Used inside T4DossierShell as the "activity" tab content:
 *   if (tab === "activity") {
 *     return <DossierActivityPanel caseId={caseId} />;
 *   }
 */

"use client";

import { useCaseEvents } from "../../hooks/use-case-events";
import type { CaseEvent, CaseEventType } from "../../hooks/use-case-events";
import { StatusPill } from "../StatusPill";
import type { StatusKind } from "../StatusPill/StatusPill";
import shared from "./shared.module.css";
import styles from "./DossierActivityPanel.module.css";

// ─── Action category vocabulary ───────────────────────────────────────────────

/**
 * Action category short labels used in the colored indicator chip.
 * These are intentionally brief (≤ 7 chars) so they fit in a compact chip.
 */
const ACTION_CATEGORY_LABEL: Record<CaseEventType, string> = {
  status_change:        "STATUS",
  inspection_started:   "INSPECT",
  inspection_completed: "INSPECT",
  item_checked:         "INSPECT",
  damage_reported:      "DAMAGE",
  shipped:              "SHIP",
  delivered:            "SHIP",
  custody_handoff:      "CUSTODY",
  mission_assigned:     "MISSION",
  template_applied:     "CONFIG",
  photo_added:          "MEDIA",
  note_added:           "MEDIA",
  qc_sign_off:          "QC",
  case_recalled:        "RECALL",
  condition_note:       "FLAG",
  shipment_created:     "SHIP",
  shipment_released:    "SHIP",
};

/**
 * CSS data-category attribute value per event type.
 * Used in conjunction with [data-category] attribute selectors in the CSS
 * to apply the correct chip color without hardcoding colors in TSX.
 *
 *   brand   → brand blue  (status_change, mission_assigned)
 *   field   → transit blue (inspection_*, item_checked, shipped, delivered)
 *   damage  → error red   (damage_reported)
 *   neutral → gray        (custody_handoff, template_applied, photo_added, note_added)
 */
const ACTION_CATEGORY_VARIANT: Record<CaseEventType, string> = {
  status_change:        "brand",
  inspection_started:   "field",
  inspection_completed: "field",
  item_checked:         "field",
  damage_reported:      "damage",
  shipped:              "field",
  delivered:            "field",
  custody_handoff:      "neutral",
  mission_assigned:     "brand",
  template_applied:     "neutral",
  photo_added:          "neutral",
  note_added:           "neutral",
  qc_sign_off:          "field",
  case_recalled:        "damage",
  condition_note:       "damage",
  shipment_created:     "field",
  shipment_released:    "field",
};

/**
 * Human-readable labels for each event type.
 * Displayed as the primary title of each activity entry.
 */
const EVENT_TYPE_LABELS: Record<CaseEventType, string> = {
  status_change:        "Status Changed",
  inspection_started:   "Inspection Started",
  inspection_completed: "Inspection Completed",
  item_checked:         "Item Checked",
  damage_reported:      "Damage Reported",
  shipped:              "Shipped",
  delivered:            "Delivered",
  custody_handoff:      "Custody Handoff",
  mission_assigned:     "Mission Assigned",
  template_applied:     "Template Applied",
  photo_added:          "Photo Added",
  note_added:           "Note Added",
  qc_sign_off:          "QC Sign-Off",
  case_recalled:        "Case Recalled",
  condition_note:       "Condition Note",
  shipment_created:     "Shipment Created",
  shipment_released:    "Shipment Released",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive a 1-2 character initials string from a display name.
 * "Alice Tech" → "AT", "Bob" → "B", "" → "?"
 */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === "") return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Format epoch ms to a concise display string.
 * "Apr 20, 2:34 PM"
 */
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
 * Derive a StatusPill kind for events with semantic status outcomes.
 * Returns null when the event type has no meaningful pill.
 */
function deriveStatusKind(event: CaseEvent): StatusKind | null {
  const validCaseStatuses = new Set([
    "hangar", "assembled", "transit_out", "deployed",
    "flagged", "recalled", "transit_in", "received", "archived",
  ]);

  switch (event.eventType) {
    case "status_change": {
      // status_change in events table uses toStatus (not "to")
      const to = event.data.toStatus ?? event.data.to;
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

/**
 * Format a human-readable event type label from the slug.
 * Falls back to Title-Case slug for unknown types.
 */
function getEventLabel(eventType: string): string {
  return (
    EVENT_TYPE_LABELS[eventType as CaseEventType] ??
    eventType
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

/**
 * Get the short category label for the action chip.
 * Falls back to "ACTION" for unknown types.
 */
function getCategoryLabel(eventType: string): string {
  return ACTION_CATEGORY_LABEL[eventType as CaseEventType] ?? "ACTION";
}

/**
 * Get the CSS variant token for the action chip color.
 * Falls back to "neutral" for unknown types.
 */
function getCategoryVariant(eventType: string): string {
  return ACTION_CATEGORY_VARIANT[eventType as CaseEventType] ?? "neutral";
}

// ─── Event description sub-component ─────────────────────────────────────────

interface EventDescriptionProps {
  event: CaseEvent;
}

/**
 * Renders a concise one-line description for each event type.
 * Returns null when no useful summary is available.
 */
function EventDescription({ event }: EventDescriptionProps): React.ReactElement | null {
  const data = event.data;

  switch (event.eventType) {
    case "status_change": {
      const from = data.fromStatus ?? data.from;
      const to   = data.toStatus   ?? data.to;
      if (!from && !to) return null;
      return (
        <p className={styles.entryDescription} data-testid="activity-event-description">
          <span className={styles.descFrom}>
            {from ? String(from).replace(/_/g, " ") : "—"}
          </span>
          <span className={styles.descArrow} aria-hidden="true">→</span>
          <span className={styles.descTo}>
            {to ? String(to).replace(/_/g, " ") : "—"}
          </span>
        </p>
      );
    }

    case "inspection_started":
    case "inspection_completed": {
      const total   = typeof data.totalItems   === "number" ? data.totalItems   : null;
      const checked = typeof data.checkedItems === "number" ? data.checkedItems : null;
      const damaged = typeof data.damagedItems === "number" ? data.damagedItems : null;
      if (total === null) return null;
      const parts: string[] = [];
      if (checked !== null) parts.push(`${checked} / ${total} items`);
      if (damaged !== null && damaged > 0) parts.push(`${damaged} damaged`);
      if (parts.length === 0) return null;
      return (
        <p className={styles.entryDescription} data-testid="activity-event-description">
          {parts.join(" · ")}
        </p>
      );
    }

    case "item_checked": {
      const itemName = typeof data.itemName === "string" ? data.itemName : null;
      const newStatus = typeof data.newStatus === "string" ? data.newStatus : null;
      if (!itemName && !newStatus) return null;
      return (
        <p className={styles.entryDescription} data-testid="activity-event-description">
          {itemName && <span className={styles.descItemName}>{itemName}</span>}
          {itemName && newStatus && (
            <span className={styles.descArrow} aria-hidden="true">·</span>
          )}
          {newStatus && (
            <span className={styles.descItemStatus}>
              {newStatus.replace(/_/g, " ")}
            </span>
          )}
        </p>
      );
    }

    case "damage_reported": {
      const itemName = typeof data.itemName   === "string" ? data.itemName   : null;
      const severity = typeof data.severity   === "string" ? data.severity   : null;
      const parts: string[] = [];
      if (itemName) parts.push(itemName);
      if (severity) parts.push(severity);
      if (parts.length === 0) return null;
      return (
        <p className={styles.entryDescription} data-testid="activity-event-description">
          {parts.join(" · ")}
        </p>
      );
    }

    case "shipped": {
      const trackingNumber  = typeof data.trackingNumber  === "string" ? data.trackingNumber  : null;
      const destinationName = typeof data.destinationName === "string" ? data.destinationName : null;
      const originName      = typeof data.originName      === "string" ? data.originName      : null;
      if (!trackingNumber && !destinationName) return null;
      return (
        <p className={styles.entryDescription} data-testid="activity-event-description">
          {trackingNumber && (
            <span className={styles.descTrackingNumber}>{trackingNumber}</span>
          )}
          {destinationName && (
            <span className={styles.descRoute}>
              {originName ? `${originName} → ${destinationName}` : `→ ${destinationName}`}
            </span>
          )}
        </p>
      );
    }

    case "custody_handoff": {
      const toName   = typeof data.toUserName   === "string" ? data.toUserName   : null;
      const fromName = typeof data.fromUserName === "string" ? data.fromUserName : null;
      if (!toName && !fromName) return null;
      return (
        <p className={styles.entryDescription} data-testid="activity-event-description">
          {fromName && <span className={styles.descFrom}>{fromName}</span>}
          {fromName && toName && (
            <span className={styles.descArrow} aria-hidden="true">→</span>
          )}
          {toName && <span className={styles.descTo}>{toName}</span>}
        </p>
      );
    }

    case "mission_assigned": {
      const missionName = typeof data.missionName === "string" ? data.missionName : null;
      if (!missionName) return null;
      return (
        <p className={styles.entryDescription} data-testid="activity-event-description">
          {missionName}
        </p>
      );
    }

    case "template_applied": {
      const templateName = typeof data.templateName === "string" ? data.templateName : null;
      const itemCount    = typeof data.itemCount    === "number" ? data.itemCount    : null;
      if (!templateName && itemCount === null) return null;
      const parts: string[] = [];
      if (templateName) parts.push(templateName);
      if (itemCount !== null) parts.push(`${itemCount} items`);
      return (
        <p className={styles.entryDescription} data-testid="activity-event-description">
          {parts.join(" · ")}
        </p>
      );
    }

    case "note_added": {
      const note = typeof data.note === "string" ? data.note : null;
      if (!note) return null;
      return (
        <p className={styles.entryDescription} data-testid="activity-event-description">
          {note.length > 80 ? note.slice(0, 80) + "…" : note}
        </p>
      );
    }

    default:
      return null;
  }
}

// ─── Single activity entry ────────────────────────────────────────────────────

interface ActivityEntryProps {
  event: CaseEvent;
  position: { current: number; total: number };
  isFirst: boolean;
  isLast: boolean;
}

/**
 * A single row in the activity feed.
 *
 * Layout:
 *   Row 1: [action-type-chip]  [event-label]       [status-pill?]
 *   Row 2: [user-avatar]  [user-name] · [timestamp]
 *   Row 3: [event-description]
 */
function ActivityEntry({ event, position, isFirst, isLast }: ActivityEntryProps) {
  const eventLabel    = getEventLabel(event.eventType);
  const categoryLabel = getCategoryLabel(event.eventType);
  const categoryVariant = getCategoryVariant(event.eventType);
  const statusKind    = deriveStatusKind(event);
  const initials      = getInitials(event.userName);

  return (
    <li
      className={styles.entry}
      data-testid="activity-entry"
      data-event-type={event.eventType}
      data-event-id={event._id}
      data-is-first={isFirst ? "true" : undefined}
      data-is-last={isLast ? "true" : undefined}
      aria-label={`Activity ${position.current} of ${position.total}: ${eventLabel} by ${event.userName}`}
    >
      {/* ── Row 1: action type indicator + event label + status pill ───── */}
      <div className={styles.entryHeader}>
        {/* Action type indicator chip */}
        <span
          className={styles.actionChip}
          data-category={categoryVariant}
          data-testid="activity-action-chip"
          aria-label={`Action type: ${categoryLabel}`}
        >
          {categoryLabel}
        </span>

        {/* Event type label */}
        <span
          className={styles.eventLabel}
          data-testid="activity-event-label"
        >
          {eventLabel}
        </span>

        {/* Optional StatusPill for events with semantic outcomes */}
        {statusKind && (
          <StatusPill kind={statusKind} data-testid="activity-status-pill" />
        )}
      </div>

      {/* ── Row 2: user avatar + attribution + timestamp ──────────────── */}
      <div className={styles.entryMeta}>
        {/* User avatar circle with initials */}
        <div
          className={styles.userAvatar}
          aria-hidden="true"
          title={event.userName}
        >
          {initials}
        </div>

        <span
          className={styles.userName}
          data-testid="activity-user-name"
        >
          {event.userName}
        </span>

        <span className={styles.metaSep} aria-hidden="true">·</span>

        <time
          className={styles.timestamp}
          dateTime={toISOString(event.timestamp)}
          data-testid="activity-timestamp"
        >
          {formatTimestamp(event.timestamp)}
        </time>
      </div>

      {/* ── Row 3: event-type-specific description ─────────────────────── */}
      <EventDescription event={event} />
    </li>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

/**
 * Skeleton shown while the getCaseEvents Convex query is in-flight.
 * Renders 4 shimmer rows in the same proportional layout as real entries
 * to prevent layout shift when data arrives.
 */
function ActivitySkeleton() {
  return (
    <div
      className={styles.skeleton}
      aria-busy="true"
      aria-label="Loading activity feed"
      role="status"
      data-testid="activity-skeleton"
    >
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={styles.skeletonEntry}>
          <div className={styles.skeletonRow}>
            <div className={`${styles.skeletonBlock} ${styles.skeletonChip}`} />
            <div className={`${styles.skeletonBlock} ${styles.skeletonLabel}`} />
          </div>
          <div className={styles.skeletonRow}>
            <div className={`${styles.skeletonBlock} ${styles.skeletonAvatar}`} />
            <div className={`${styles.skeletonBlock} ${styles.skeletonMeta}`} />
          </div>
          {i % 2 === 0 && (
            <div className={styles.skeletonRow}>
              <div className={`${styles.skeletonBlock} ${styles.skeletonDesc}`} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

/**
 * Shown when no events have been recorded yet for this case.
 */
function ActivityEmpty() {
  return (
    <div
      className={shared.emptyState}
      data-testid="activity-empty"
    >
      {/* Activity pulse icon */}
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
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
      <p className={shared.emptyStateTitle}>No activity yet</p>
      <p className={shared.emptyStateText}>
        Activity events — status changes, inspections, shipments, custody
        handoffs, and damage reports — will appear here as they occur.
      </p>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DossierActivityPanelProps {
  /**
   * Convex document ID of the case whose activity to display.
   * Required — the panel is always rendered in the context of a selected case.
   */
  caseId: string;

  /**
   * Additional CSS class applied to the root element for caller overrides.
   * Optional — most consumers use the component without a custom class.
   */
  className?: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * DossierActivityPanel
 *
 * Activity feed for the "Activity" tab of T4DossierShell.
 *
 * Subscribes to all case events via `useCaseEvents`, reverses for newest-first
 * display, and renders each event as a rich activity entry with a colored
 * action type chip, user attribution badge, timestamp, and event description.
 *
 * Real-time fidelity:
 *   Convex re-evaluates and pushes within ~100–300 ms of any SCAN app mutation
 *   that inserts a new event row for this case.  New events appear at the top
 *   of the feed automatically, satisfying the ≤ 2-second real-time SLA.
 *
 * Accessibility:
 *   • Panel header: h3 with countBadge announced via aria-live="polite"
 *   • Event list: <ol> with aria-label describing total count
 *   • Each entry: aria-label with position and event type via `ActivityEntry`
 *   • Timestamps: <time dateTime={ISO}> element
 *   • Action chips: aria-label="Action type: {CATEGORY}"
 *   • Loading state: aria-busy + role="status" on skeleton container
 *   • Empty state: shared emptyState layout (readable by screen readers)
 *   • User avatar: aria-hidden (name is in the adjacent span)
 */
export function DossierActivityPanel({ caseId, className }: DossierActivityPanelProps) {
  // ── Convex subscription ─────────────────────────────────────────────────────
  //
  // useCaseEvents returns events ordered oldest-first from the server.
  // We reverse in memory for newest-first display (most recent action at top).
  //
  // Real-time fidelity: Convex re-evaluates and pushes within ~100–300 ms of
  // any new event insert, satisfying the ≤ 2-second real-time SLA.
  const events = useCaseEvents(caseId);

  const rootClass = [styles.panel, className].filter(Boolean).join(" ");

  // ── Panel header (shared across all states) ─────────────────────────────────
  const panelHeader = (
    <div className={styles.panelHeader} data-testid="activity-panel-header">
      <div className={styles.panelHeaderLeft}>
        <h3
          className={styles.panelTitle}
          id={`activity-heading-${caseId}`}
        >
          Activity
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
            data-testid="activity-count-badge"
          >
            {events.length}
          </span>
        )}
      </div>

      <p className={styles.panelSubtitle}>
        Newest first
      </p>
    </div>
  );

  // ── Loading state ───────────────────────────────────────────────────────────
  if (events === undefined) {
    return (
      <div
        className={rootClass}
        data-testid="dossier-activity-panel"
        data-state="loading"
        aria-labelledby={`activity-heading-${caseId}`}
      >
        {panelHeader}
        <ActivitySkeleton />
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (events.length === 0) {
    return (
      <div
        className={rootClass}
        data-testid="dossier-activity-panel"
        data-state="empty"
        aria-labelledby={`activity-heading-${caseId}`}
      >
        {panelHeader}
        <ActivityEmpty />
      </div>
    );
  }

  // ── Events available — render activity feed ─────────────────────────────────
  //
  // Reverse to show newest first (server returns oldest first).
  // Shallow copy to avoid mutating the cached query result.
  const sortedEvents: CaseEvent[] = [...events].reverse();
  const totalEvents = sortedEvents.length;

  return (
    <div
      className={rootClass}
      data-testid="dossier-activity-panel"
      data-state="loaded"
      data-event-count={totalEvents}
      aria-labelledby={`activity-heading-${caseId}`}
    >
      {panelHeader}

      {/*
       * ── Activity feed list ────────────────────────────────────────────────
       *
       * <ol> provides ordinal semantics — the sequence of activities is
       * meaningful (newest at position 1, oldest at position N).
       *
       * Each <ActivityEntry> renders as an <li> with an aria-label that
       * describes its position ("Activity N of M: Event Label by User").
       */}
      <ol
        className={styles.feedList}
        aria-label={`${totalEvents} activity event${totalEvents !== 1 ? "s" : ""} for this case`}
        data-testid="activity-feed-list"
      >
        {sortedEvents.map((event, index) => (
          <ActivityEntry
            key={event._id}
            event={event}
            position={{ current: index + 1, total: totalEvents }}
            isFirst={index === 0}
            isLast={index === totalEvents - 1}
          />
        ))}
      </ol>
    </div>
  );
}

export default DossierActivityPanel;
