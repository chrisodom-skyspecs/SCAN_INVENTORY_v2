/**
 * MiniMapSidebar — compact timeline sidebar overlay for map views.
 *
 * A fixed-dimension vertical layout container that renders a condensed
 * representation of all timeline entries alongside a map canvas.  The
 * component follows the same overlay-inside-map-canvas pattern as
 * M2StopSidebar: it is `position: absolute` within a `position: relative;
 * overflow: hidden` map canvas container.
 *
 * Architecture
 * ────────────
 * The sidebar is purely presentational — it accepts a flat array of
 * `MiniMapEntry` objects (pre-derived from `JourneyStop` records or any
 * event source) and renders each as a compact row in a scrollable list.
 *
 * Callers are responsible for subscribing to Convex, sorting, and mapping
 * stop data to `MiniMapEntry` shape before rendering the sidebar.  This
 * keeps the component testable in isolation without Convex or auth context.
 *
 * Layout
 * ──────
 * ┌─────────────────────────────────────────────────────┐
 * │  [Title]                             [count]  [×]   │  ← header (fixed)
 * ├─────────────────────────────────────────────────────┤
 * │  ● [Event Type]         [Case Label]  [Timestamp]   │  ← entry row
 * │  ● [Event Type]         [Case Label]  [Timestamp]   │
 * │  …                                                  │  ← scrollable
 * └─────────────────────────────────────────────────────┘
 *
 * Each condensed entry row shows:
 *   • A semantic color dot (same dot variants as T2Timeline / TimelineEvent)
 *   • Event type label (Inter Tight, 0.75 rem, semi-bold)
 *   • Case label (IBM Plex Mono, 0.625 rem, tertiary ink)
 *   • Timestamp (IBM Plex Mono, 0.625 rem, tabular-nums)
 *
 * Dimensions
 * ──────────
 * Default layout:
 *   width:  20rem (320 px) — right/left edge overlay
 *   height: 100% — fills the map canvas top to bottom
 *
 * Narrow-screen (≤ 640 px):
 *   width:  100% (full canvas width)
 *   height: 50%  (bottom-drawer)
 *
 * Scrolling
 * ─────────
 * The entry list (`.entryList`) is the sole scrollable region:
 *   overflow-y: auto; flex: 1; min-height: 0
 *
 * `overscroll-behavior: contain` prevents scroll chaining to the map canvas
 * or the page body when the sidebar list reaches its end.
 *
 * Accessibility
 * ─────────────
 * • Root is `<aside role="complementary">` with `aria-label`.
 * • Entry list is an `<ol>` (chronological order is semantically meaningful).
 * • Each `<li>` has an `aria-label` combining event type + case label.
 * • Timestamps use `<time dateTime={ISO}>` for machine-readable dates.
 * • Semantic color dots are `aria-hidden` (decorative — label provides context).
 * • Close button has a descriptive `aria-label`; min 44×44 px touch target.
 * • Entry count chip has `aria-live="polite"` + `aria-atomic="true"` so Convex
 *   real-time updates are announced to screen readers.
 * • WCAG AA contrast for all text in both light and dark themes.
 * • No motion — no CSS animation on any element (reduced-motion friendly).
 *
 * Design tokens
 * ─────────────
 * All colors via CSS custom properties (var(--*)) — no hex literals.
 * Inter Tight: UI text (title, event type label, no-data message).
 * IBM Plex Mono: data text (case label, timestamp, count).
 *
 * Usage
 * ─────
 * @example
 *   // Basic static usage with pre-fetched entries:
 *   <MiniMapSidebar
 *     title="Recent Events"
 *     entries={allJourneyStops.map(s => ({
 *       entryId:   s.eventId,
 *       eventType: s.eventType,
 *       timestamp: s.timestamp,
 *       caseLabel: s.caseLabel ?? "—",
 *       actorName: s.actorName,
 *       hasCoordinates: s.hasCoordinates,
 *     }))}
 *   />
 *
 * @example
 *   // With loading state and close button:
 *   <MiniMapSidebar
 *     title="All Timeline Events"
 *     entries={entries}
 *     isLoading={entries === undefined}
 *     onClose={() => setShowSidebar(false)}
 *     className={styles.sidebarOverlay}
 *   />
 */

"use client";

import React, { type ReactNode } from "react";
import { useScrollPositionIndicator } from "@/hooks/use-scroll-position-indicator";
import styles from "./MiniMapSidebar.module.css";

// ─── Event type vocabulary ────────────────────────────────────────────────────

/**
 * Known event type slugs → human-readable display labels.
 * Matches the vocabulary used across T2Timeline, TimelineEvent, and StopCard.
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
 * Dot semantic color variants per event type.
 * Controls CSS `data-variant` attribute → color via attribute selector in CSS.
 *
 *   brand   — brand blue  (lifecycle progression: status_change, mission_assigned)
 *   transit — transit blue (field action: inspection_started, shipped, scan_check_in)
 *   success — green       (positive completion: inspection_completed, delivered)
 *   error   — red         (requires attention: damage_reported)
 *   neutral — gray        (transfer/config: custody_handoff, template_applied, qr_associated)
 */
const EVENT_DOT_VARIANTS: Record<string, EntryDotVariant> = {
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

/** Semantic dot color variant — controls the indicator dot color. */
export type EntryDotVariant = "brand" | "transit" | "success" | "error" | "neutral";

/**
 * A single timeline entry in the MiniMapSidebar list.
 *
 * This shape is a flattened, presentation-ready subset of `JourneyStop` that
 * callers map from their data subscriptions before rendering the sidebar.
 */
export interface MiniMapEntry {
  /**
   * Stable unique ID — used as the React list `key`.
   * Typically the Convex event document ID.
   */
  entryId: string;

  /**
   * Event type discriminant.  Controls the dot color and the display label.
   *
   * Known types: "status_change" | "inspection_started" | "inspection_completed" |
   * "damage_reported" | "shipped" | "delivered" | "custody_handoff" |
   * "mission_assigned" | "template_applied" | "scan_check_in" | "qr_associated"
   *
   * Unknown types fall back to Title Case from the underscore slug.
   */
  eventType: string;

  /**
   * Unix timestamp in milliseconds (e.g. Convex `_creationTime` or event time).
   * Rendered inside a `<time dateTime={ISO}>` element.
   */
  timestamp: number;

  /**
   * Human-readable case identifier (e.g. "CS-042", "QR-1234").
   * Rendered in IBM Plex Mono below the event type label.
   * Use "—" when no case label is available.
   */
  caseLabel: string;

  /**
   * Display name of the person or system that recorded the event.
   * Shown as secondary text when present.
   */
  actorName?: string;

  /**
   * Whether the event has associated GPS coordinates.
   * When false the dot renders with a dashed border (missing location signal).
   * @default false
   */
  hasCoordinates?: boolean;
}

/** Props for the MiniMapSidebar container component. */
export interface MiniMapSidebarProps {
  /**
   * Sidebar header title text.
   * Shown above the entry list in the fixed header bar.
   * @default "Timeline"
   */
  title?: string;

  /**
   * Array of timeline entries to render in the scrollable list.
   * Each entry is displayed as a single condensed row.
   *
   * Pass an empty array with `isLoading={true}` to show the skeleton state.
   * Pass an empty array with `isLoading={false}` to show the empty state.
   */
  entries: MiniMapEntry[];

  /**
   * Total count of entries, which may differ from `entries.length` when
   * server-side display caps are applied (e.g., showing the 100 most recent
   * events out of 250 total).
   *
   * When omitted, the count badge shows `entries.length`.
   * Set to 0 to hide the count badge entirely.
   */
  totalCount?: number;

  /**
   * When true, the sidebar renders a skeleton shimmer placeholder list
   * instead of the entries.  Used while the Convex subscription is loading.
   * @default false
   */
  isLoading?: boolean;

  /**
   * When provided, a × close button is rendered in the sidebar header.
   * Calling `onClose` is the sidebar's only side-effect — the parent is
   * responsible for unmounting the sidebar.
   */
  onClose?: () => void;

  /**
   * Additional CSS class applied to the root `<aside>` element.
   * Useful for positioning overrides from the parent layout (e.g., left vs.
   * right anchor, or a custom width for a specific map mode).
   */
  className?: string;

  /**
   * Optional footer content rendered below the scrollable entry list.
   * The footer is non-scrolling and stays anchored to the sidebar bottom.
   * Use for action buttons, load-more triggers, or summary stats.
   */
  footer?: ReactNode;

  /** `data-testid` forwarded to the root `<aside>` element. */
  "data-testid"?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an event type slug to a human-readable display label.
 * Looks up the vocabulary map first; falls back to Title Case from underscore slug.
 */
function formatEventType(eventType: string): string {
  if (EVENT_TYPE_LABELS[eventType]) return EVENT_TYPE_LABELS[eventType];
  return eventType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Format epoch ms to an abbreviated human-readable display string.
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
 * Convert epoch ms to an ISO 8601 string for use in `<time dateTime={...}>`.
 */
function toISOString(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * MiniMapSidebarSkeleton — shimmer placeholder list shown during loading.
 * Renders 5 skeleton rows to approximate the expected entry count.
 */
function MiniMapSidebarSkeleton() {
  return (
    <ol
      className={styles.entryList}
      aria-label="Loading timeline entries"
      aria-busy="true"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className={styles.skeletonRow} aria-hidden="true">
          <div className={styles.skeletonDot} />
          <div className={styles.skeletonContent}>
            <div className={`${styles.skeletonLine} ${styles.skeletonLineType}`} />
            <div className={styles.skeletonMeta}>
              <div className={`${styles.skeletonLine} ${styles.skeletonLineCase}`} />
              <div className={`${styles.skeletonLine} ${styles.skeletonLineTime}`} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * MiniMapSidebar — fixed-dimension overlay sidebar with scrollable timeline list.
 *
 * Renders as `position: absolute` inside a `position: relative; overflow: hidden`
 * map canvas container.  The sidebar header is non-scrolling; the entry list
 * fills the remaining vertical space and scrolls independently.
 *
 * All state (loading, entries, close callback) is managed externally — the
 * component is purely presentational, accepting pre-processed `MiniMapEntry`
 * objects from the parent's Convex subscription or other data source.
 *
 * States:
 *   isLoading=true            — renders skeleton shimmer rows
 *   isLoading=false, 0 entries — renders an empty-state message
 *   isLoading=false, N entries — renders condensed entry rows
 *
 * Position indicator
 * ──────────────────
 * A thin vertical track (`.positionTrack`) is rendered on the left edge of the
 * scrollable region whenever the entry list overflows its container.  Inside the
 * track, a sized thumb (`.positionThumb`) marks the currently visible viewport:
 *
 *   thumb height = (clientHeight / scrollHeight) × clientHeight   (≥ 16 px)
 *   thumb top    = (scrollTop / scrollRange)     × maxThumbTop
 *
 * The geometry is kept in sync via a passive scroll listener and a ResizeObserver
 * that watches the entry list element.  The indicator is purely decorative
 * (aria-hidden="true") — it does not respond to pointer or keyboard interaction.
 */
export function MiniMapSidebar({
  title = "Timeline",
  entries,
  totalCount,
  isLoading = false,
  onClose,
  className,
  footer,
  "data-testid": testId = "mini-map-sidebar",
}: MiniMapSidebarProps) {
  // Effective count displayed in the header badge:
  //   • If totalCount is explicitly provided (including 0), use it.
  //   • If totalCount is undefined, derive from entries.length.
  const displayCount = totalCount !== undefined ? totalCount : entries.length;
  const showCountBadge = displayCount > 0 || isLoading;

  // ── Position indicator ────────────────────────────────────────────────────
  //
  // contentKey changes whenever the number of entries or the loading state
  // changes.  This drives the useEffect inside useScrollPositionIndicator to
  // re-attach listeners and recompute geometry after the list is re-mounted.
  const contentKey = `${isLoading ? "loading" : "loaded"}:${entries.length}`;
  const { state: positionState, listRef } = useScrollPositionIndicator({ contentKey });

  return (
    <aside
      className={[styles.sidebar, className].filter(Boolean).join(" ")}
      data-testid={testId}
      role="complementary"
      aria-label={`${title} — ${displayCount} event${displayCount !== 1 ? "s" : ""}`}
    >
      {/* ── Fixed header ────────────────────────────────────────────────── */}
      {/*
       * The header is `flex-shrink: 0` so it never scrolls with the list.
       * It contains:
       *   1. Title text (Inter Tight, small-caps uppercase)
       *   2. Entry count badge (IBM Plex Mono — aria-live for real-time updates)
       *   3. Close button (optional — only rendered when onClose is provided)
       */}
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          <span className={styles.headerTitle}>{title}</span>
          {showCountBadge && (
            <span
              className={styles.countBadge}
              aria-live="polite"
              aria-atomic="true"
              aria-label={`${displayCount} event${displayCount !== 1 ? "s" : ""}`}
              data-testid="mini-map-sidebar-count"
            >
              {displayCount}
            </span>
          )}
        </div>

        {onClose && (
          /*
           * Close button — × icon SVG, minimum 44×44 px touch target (WCAG 2.5.5).
           * The visual size is smaller (1.75rem × 1.75rem) but `min-width` and
           * `min-height` extend the tap/click area to meet the accessible minimum.
           */
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label={`Close ${title} panel`}
            data-testid="mini-map-sidebar-close"
          >
            <svg
              className={styles.closeIcon}
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
              fill="currentColor"
            >
              <path d="M4.293 4.293a1 1 0 011.414 0L8 6.586l2.293-2.293a1 1 0 111.414 1.414L9.414 8l2.293 2.293a1 1 0 01-1.414 1.414L8 9.414l-2.293 2.293a1 1 0 01-1.414-1.414L6.586 8 4.293 5.707a1 1 0 010-1.414z" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Scroll region: entry list + position indicator overlay ──────── */}
      {/*
       * .scrollRegion is a `position: relative` flex container that fills all
       * remaining vertical space between the header and optional footer.
       * It wraps the scrollable entry list (or skeleton / empty state) and
       * hosts the absolute-positioned position indicator track.
       *
       * Why a wrapper instead of making .sidebar position: relative?
       * The position indicator should only span the scrollable content area,
       * not the header or footer.  Wrapping just the content region makes the
       * coordinate system precise and avoids z-index conflicts with the header.
       */}
      <div className={styles.scrollRegion}>
        {/* ── Position indicator track (left edge of scroll region) ─── */}
        {/*
         * Only rendered when the entry list is actually overflowing.
         * Purely decorative — aria-hidden so screen readers skip it.
         *
         * Track: full-height strip on the left edge, 3 px wide.
         * Thumb: sized and positioned by JS via inline style.
         *   height = (clientHeight / scrollHeight) × clientHeight  (≥ 16 px)
         *   top    = (scrollTop / scrollRange) × maxThumbTop
         */}
        {positionState.visible && (
          <div
            className={styles.positionTrack}
            aria-hidden="true"
            data-testid="mini-map-position-track"
          >
            <div
              className={styles.positionThumb}
              style={{
                top:    `${positionState.thumbTop}px`,
                height: `${positionState.thumbHeight}px`,
              }}
              data-testid="mini-map-position-indicator"
            />
          </div>
        )}

        {/* ── Entry list / skeleton / empty state ──────────────────── */}
        {isLoading ? (
          <MiniMapSidebarSkeleton />
        ) : entries.length === 0 ? (
          /* ── Empty state ─────────────────────────────────────────── */
          <div
            className={styles.emptyState}
            data-testid="mini-map-sidebar-empty"
          >
            <svg
              className={styles.emptyIcon}
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
            <p className={styles.emptyTitle}>No events recorded</p>
            <p className={styles.emptyText}>
              Events will appear here as cases move through their lifecycle.
            </p>
          </div>
        ) : (
          /* ── Entry list ────────────────────────────────────────────── */
          /*
           * ref={listRef} attaches the scroll position observer.
           * The useScrollPositionIndicator hook reads scrollTop, scrollHeight,
           * and clientHeight from this element to compute indicator geometry.
           */
          <ol
            ref={listRef as React.RefObject<HTMLOListElement>}
            className={styles.entryList}
            aria-label={`${displayCount} timeline event${displayCount !== 1 ? "s" : ""}`}
            data-testid="mini-map-sidebar-list"
          >
            {entries.map((entry, i) => {
              const isFirst    = i === 0;
              const isLast     = i === entries.length - 1;
              const dotVariant = EVENT_DOT_VARIANTS[entry.eventType] ?? "neutral";
              const eventLabel = formatEventType(entry.eventType);

              return (
                <li
                  key={entry.entryId}
                  className={styles.entryRow}
                  data-event-type={entry.eventType}
                  data-is-first={isFirst ? "true" : undefined}
                  data-is-last={isLast ? "true" : undefined}
                  aria-label={`${eventLabel} — case ${entry.caseLabel}`}
                  data-testid={`mini-map-sidebar-entry-${i}`}
                >
                  {/* ── Spine column: dot indicator ────────────────────── */}
                  {/*
                   * The dot column also contains the connecting thread line
                   * that runs between entries.  The thread is hidden on the
                   * last entry via the CSS [data-is-last="true"] selector.
                   */}
                  <div className={styles.dotCol} aria-hidden="true">
                    <div
                      className={styles.dot}
                      data-variant={dotVariant}
                      data-no-location={!entry.hasCoordinates ? "true" : undefined}
                    />
                    <div className={styles.thread} />
                  </div>

                  {/* ── Content column: event type + case label + timestamp ─ */}
                  <div className={styles.entryContent}>
                    {/* Row 1: event type label */}
                    <span
                      className={styles.entryEventType}
                      data-event-type={entry.eventType}
                    >
                      {eventLabel}
                    </span>

                    {/* Row 2: case label + timestamp inline */}
                    <div className={styles.entryMeta}>
                      <span
                        className={styles.entryCaseLabel}
                        data-testid="mini-map-sidebar-case-label"
                      >
                        {entry.caseLabel}
                      </span>
                      <time
                        className={styles.entryTimestamp}
                        dateTime={toISOString(entry.timestamp)}
                        data-testid="mini-map-sidebar-timestamp"
                      >
                        {formatTimestamp(entry.timestamp)}
                      </time>
                    </div>

                    {/* Row 3: actor name (optional) */}
                    {entry.actorName && (
                      <span
                        className={styles.entryActor}
                        data-testid="mini-map-sidebar-actor"
                      >
                        {entry.actorName}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* ── Optional footer ──────────────────────────────────────────────── */}
      {/*
       * Non-scrolling footer anchored to the sidebar bottom.
       * `flex-shrink: 0` prevents it from being compressed by the list.
       * Use for action buttons, "Load more" triggers, or aggregate stats.
       */}
      {footer && (
        <div className={styles.footer} data-testid="mini-map-sidebar-footer">
          {footer}
        </div>
      )}
    </aside>
  );
}

export default MiniMapSidebar;
