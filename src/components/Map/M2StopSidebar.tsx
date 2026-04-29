/**
 * M2StopSidebar — Overlay sidebar rendering StopCard list for the M2 replay timeline.
 *
 * Positioned as an absolute overlay on the right side of the M2 map canvas.
 * Renders a scrollable list of StopCard components for all stops in the
 * selected case's journey, with visual treatments for:
 *   • the active/current stop in the replay (highlighted border + auto-scroll)
 *   • future stops (dimmed, relative to the `at` replay timestamp)
 *   • first/last stops in the journey (badge coloring via StopCard isFirst/isLast)
 *
 * Positioning
 * ───────────
 * The sidebar is `position: absolute` within the M2 map canvas (.mapCanvas),
 * anchored to the right edge:  top: 0; right: 0; bottom: 0; width: 20rem.
 * On narrow screens (≤ 640 px) it transitions to a bottom drawer:
 *   bottom: 0; left: 0; right: 0; height: 55%; width: 100%.
 *
 * Data flow
 * ─────────
 *   M2SiteDetail → [stops, at, selectedStopIndex, caseLabel] → M2StopSidebar
 *   M2StopSidebar → [onStopClick(stopIndex), onClose] → M2SiteDetail
 *
 * Active stop determination (in priority order)
 * ─────────────────────────────────────────────
 *   1. selectedStopIndex — explicit user click (highest priority)
 *   2. at-based cursor   — last stop whose timestamp ≤ at.getTime()
 *   3. live mode default — last stop in journey (at=null, selection=null)
 *
 * Replay integration
 * ──────────────────
 * When the ReplayScrubber advances `at`, the active stop in the sidebar
 * updates reactively (useMemo on stops + at) and the list auto-scrolls to
 * keep the active stop visible.  This provides continuous visual feedback as
 * the replay progresses through the journey — satisfying the ≤ 2-second
 * real-time fidelity requirement for the replay UX.
 *
 * Accessibility
 * ─────────────
 *   • <aside role="complementary"> with aria-label describes the panel purpose
 *   • <ol> list with each <li role="button"> for keyboard-interactive stops
 *   • tabIndex=0 on each <li> for tab navigation
 *   • aria-pressed reflects explicit selection state
 *   • aria-current="true" on the replay-cursor active stop
 *   • aria-live="polite" on the replay banner and stop count
 *   • Close button has a descriptive aria-label
 *   • Enter / Space key on <li> triggers onStopClick
 *
 * Design tokens
 * ─────────────
 *   All colors via CSS custom properties (var(--*)); no hex literals.
 *   WCAG AA contrast compliant in both light and dark themes.
 *   Inter Tight for all labels; IBM Plex Mono for case label, counts, timestamps.
 *
 * @example
 * // Rendered inside M2SiteDetail when a case is selected (Mapbox mode):
 * <M2StopSidebar
 *   stops={selectedJourney.stops}
 *   caseLabel={selectedJourney.caseLabel}
 *   stopCount={selectedJourney.stopCount}
 *   at={at}
 *   selectedStopIndex={selectedStopIndex}
 *   onStopClick={handleStopClick}
 *   onClose={() => setSelectedCaseId(null)}
 *   className={styles.stopSidebar}
 * />
 */

"use client";

import { useMemo, useRef } from "react";
import type { JourneyStop } from "@/hooks/use-m2-journey-stops";
import { useReplayScrollSync } from "@/hooks/use-replay-scroll-sync";
import { StopCard } from "@/components/StopCard";
import styles from "./M2StopSidebar.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface M2StopSidebarProps {
  /**
   * All stops in the selected case's journey, in chronological order.
   * Each stop provides: stopIndex, eventType, timestamp, location, actorName.
   */
  stops: JourneyStop[];

  /** Human-readable case identifier shown in the sidebar header. */
  caseLabel: string;

  /**
   * Total number of stops for the case.
   * May differ from stops.length when a server-side display cap is applied.
   * Used in the header count badge and accessible labels.
   */
  stopCount: number;

  /**
   * Current replay timestamp.  null = live mode (no snapshot active).
   *
   * Used to:
   *   1. Determine the "active cursor" stop (last stop whose timestamp ≤ at).
   *   2. Dim future stops (stops with timestamp > at).
   *   3. Show the replay position banner below the header.
   */
  at: Date | null;

  /**
   * Index of the explicitly selected stop (e.g., from clicking a StopMarker badge).
   * When non-null, overrides the at-based active stop determination.
   * null = no explicit selection.
   */
  selectedStopIndex: number | null;

  /**
   * Called when the user clicks a stop row in the sidebar.
   * Receives the 1-based stop index of the clicked stop.
   * The parent handles updating selectedStopIndex and, optionally,
   * advancing the replay cursor (at) to that stop's timestamp.
   */
  onStopClick: (stopIndex: number) => void;

  /**
   * Called when the user clicks the × close button.
   * The parent should clear selectedCaseId to unmount the sidebar.
   */
  onClose: () => void;

  /**
   * Additional CSS class applied to the root <aside> element.
   * Use for positioning overrides from the parent layout (e.g., styles.stopSidebar).
   */
  className?: string;

  /** `data-testid` value forwarded to the root element for test targeting. */
  "data-testid"?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a Date for display in the replay banner.
 * e.g. "Apr 20, 02:34 PM"
 */
function formatReplayTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * M2StopSidebar — overlay panel listing all StopCards for the selected M2 case.
 *
 * Rendered as a position:absolute overlay on the right side of the M2 map
 * canvas (position: relative, overflow: hidden).  Appears when a case pin
 * is selected (selectedCaseId is set in M2SiteDetail).
 * Dismissed via the × button (calls onClose → clears selectedCaseId).
 */
export function M2StopSidebar({
  stops,
  caseLabel,
  stopCount,
  at,
  selectedStopIndex,
  onStopClick,
  onClose,
  className,
  "data-testid": testId = "m2-stop-sidebar",
}: M2StopSidebarProps) {
  // ── Ref for auto-scroll ──────────────────────────────────────────────────
  const listRef = useRef<HTMLOListElement>(null);

  // ── Replay-active stop index ─────────────────────────────────────────────
  //
  // Determines which stop is highlighted as the "current" replay position.
  // Priority order:
  //   1. selectedStopIndex — explicit user click on a stop row or StopMarker
  //   2. at-based cursor   — last stop with timestamp ≤ at (replay mode)
  //   3. live default      — last stop in the journey (live mode, no selection)
  //
  // This drives:
  //   • data-active="true" on the matching <li>
  //   • aria-current="true" for screen readers
  //   • .stopItemActive CSS class (brand border + background)
  //   • auto-scroll to the active item via useEffect
  const replayActiveIndex = useMemo((): number | null => {
    // Explicit selection always takes precedence
    if (selectedStopIndex !== null) return selectedStopIndex;
    // No stops — nothing to highlight
    if (stops.length === 0) return null;
    // Live mode — highlight the most recent stop
    if (at === null) return stops[stops.length - 1].stopIndex;
    // Replay mode — find the last stop at or before the cursor timestamp
    const atMs = at.getTime();
    let active: number | null = null;
    for (const stop of stops) {
      if (stop.timestamp <= atMs) {
        active = stop.stopIndex;
      }
    }
    return active;
  }, [selectedStopIndex, at, stops]);

  // ── Auto-scroll to the active stop (Sub-AC 3) ────────────────────────────
  //
  // useReplayScrollSync watches replayActiveIndex and calls scrollIntoView
  // on the matching [data-stop-index="N"] element whenever it changes.
  // This fires when:
  //   • The ReplayScrubber advances `at` past a stop timestamp boundary.
  //   • The user manually scrubs (step-forward / step-back / range slider).
  //   • The user clicks a stop row (selectedStopIndex changes).
  //   • Convex pushes new stops (stops[] changes → replayActiveIndex recomputes).
  //
  // "smooth" scrollBehavior provides visual continuity during auto-play.
  // The hook is a no-op when replayActiveIndex is null (no active stop).
  useReplayScrollSync({
    listRef,
    activeIndex: replayActiveIndex,
    scrollBehavior: "smooth",
  });

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <aside
      className={[styles.sidebar, className].filter(Boolean).join(" ")}
      data-testid={testId}
      aria-label={`Journey timeline for case ${caseLabel}`}
      role="complementary"
    >
      {/* ── Header: case label + stop count + close button ── */}
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          {/* Case label — IBM Plex Mono per typography spec */}
          <span
            className={styles.headerLabel}
            data-testid="m2-stop-sidebar-label"
          >
            {caseLabel}
          </span>
          {/* Live stop count — updates when Convex pushes new stops */}
          <span
            className={styles.headerCount}
            aria-live="polite"
            aria-atomic="true"
            data-testid="m2-stop-sidebar-count"
          >
            {stopCount} stop{stopCount !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Close button — × icon, dismisses the sidebar */}
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label={`Close journey timeline for case ${caseLabel}`}
          data-testid="m2-stop-sidebar-close"
        >
          {/* × icon SVG — path-based for crisp rendering at small sizes */}
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
      </div>

      {/* ── Replay position banner ── */}
      {/*
       * Shown only when at is non-null (replay mode active).
       * Pulsing dot + formatted timestamp indicate the active replay cursor.
       * aria-live="polite" announces position changes to screen readers.
       */}
      {at !== null && (
        <div
          className={styles.replayBanner}
          role="status"
          aria-live="polite"
          data-testid="m2-stop-sidebar-replay-banner"
        >
          <span className={styles.replayDot} aria-hidden="true" />
          <span className={styles.replayBannerText}>
            Replay:{" "}
            <time dateTime={at.toISOString()} className={styles.replayTime}>
              {formatReplayTime(at)}
            </time>
          </span>
        </div>
      )}

      {/* ── Stop list ── */}
      {stops.length === 0 ? (
        /*
         * Empty state — shown when the case has no journey stops yet.
         * This can happen for newly created cases that haven't been scanned.
         */
        <p className={styles.emptyText} data-testid="m2-stop-sidebar-empty">
          No stops recorded yet.
        </p>
      ) : (
        /*
         * Stop list — ordered list of StopCard components.
         *
         * Each <li> is an interactive keyboard-accessible row (role="button",
         * tabIndex=0) following the same pattern as the M2SiteDetail pin list.
         * Clicking a row fires onStopClick(stopIndex) → parent updates
         * selectedStopIndex → map filters visibleGeoStops + visiblePathStops.
         *
         * Visual states:
         *   .stopItemActive  → active cursor stop (brand border + background)
         *   .stopItemFuture  → dimmed when stop occurs after the replay cursor
         *   data-selected    → explicitly clicked stop (aria-pressed=true)
         */
        <ol
          ref={listRef}
          className={styles.stopList}
          aria-label={`${stopCount} journey stop${stopCount !== 1 ? "s" : ""} for case ${caseLabel}`}
          data-testid="m2-stop-sidebar-list"
        >
          {stops.map((stop, i) => {
            const isFirst    = i === 0;
            const isLast     = i === stops.length - 1;
            const isActive   = stop.stopIndex === replayActiveIndex;
            // "Future" = stop occurred after the replay cursor (only in replay mode)
            const isFuture   = at !== null && stop.timestamp > at.getTime();
            // "Selected" = user explicitly clicked this stop (aria-pressed)
            const isSelected = stop.stopIndex === selectedStopIndex;
            // Explicit selection (user jumped to this stop) overrides future suppression:
            // a directly-selected stop is always shown as active even if it's "future"
            // relative to the replay cursor.  Only at-based cursor stops are suppressed.
            const isExplicitlySelected = selectedStopIndex !== null && isSelected;
            // Suppress the future state visually only when not explicitly selected.
            const isFutureUnsuppressed = isFuture && !isExplicitlySelected;
            // Show as active when: (a) stop matches cursor AND stop is not suppressed future
            const showAsActive = isActive && (!isFuture || isExplicitlySelected);

            return (
              <li
                key={stop.eventId}
                className={[
                  styles.stopItem,
                  showAsActive          ? styles.stopItemActive : "",
                  isFutureUnsuppressed  ? styles.stopItemFuture : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-stop-index={stop.stopIndex}
                data-active={showAsActive ? "true" : undefined}
                data-future={isFutureUnsuppressed ? "true" : undefined}
                data-selected={isSelected ? "true" : undefined}
                /* Keyboard interaction pattern — matches M2SiteDetail pin list */
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-current={showAsActive ? "true" : undefined}
                aria-label={`Stop ${stop.stopIndex}${isActive && !isFuture ? " — current replay position" : ""}`}
                onClick={() => onStopClick(stop.stopIndex)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onStopClick(stop.stopIndex);
                  }
                }}
              >
                {/*
                 * StopCard — prop-driven display card for a single journey stop.
                 *
                 * Receives:
                 *   stopNumber  — 1-based index for the badge
                 *   eventType   — event slug → human-readable label
                 *   timestamp   — epoch ms → formatted short date
                 *   isFirst     — origin badge (green)
                 *   isLast      — latest stop badge (blue)
                 *   hasLocation — dashed badge when no GPS coords
                 *   actorName   — actor shown below event label
                 *   locationName — location shown in IBM Plex Mono
                 *   thumbnails  — omitted (not available in batch subscription)
                 */}
                <StopCard
                  stopNumber={stop.stopIndex}
                  eventType={stop.eventType}
                  timestamp={stop.timestamp}
                  isFirst={isFirst}
                  isLast={isLast}
                  hasLocation={stop.hasCoordinates}
                  actorName={stop.actorName}
                  locationName={stop.location.locationName}
                  className={styles.stopCard}
                  data-testid={`m2-stop-sidebar-stop-${stop.stopIndex}`}
                />
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

export default M2StopSidebar;
