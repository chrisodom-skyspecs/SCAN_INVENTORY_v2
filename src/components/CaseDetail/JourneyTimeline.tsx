/**
 * JourneyTimeline — vertical lifecycle timeline for the T1 case detail panel.
 *
 * Renders the M2 journey stops for a single case as a vertical chronological
 * timeline — numbered stop markers connected by a spine line, with event type,
 * timestamp, actor, and location details for each stop.
 *
 * Data source
 * ───────────
 * Subscribes to `getM2JourneyStops` via `useM2JourneyStops(caseId)`.
 * Convex re-evaluates the subscription within ~100–300 ms of any SCAN app
 * mutation that appends a new event (scanCheckIn, handoffCustody, shipCase,
 * completeInspection), so the timeline reflects the latest field activity
 * within the ≤ 2-second real-time fidelity requirement.
 *
 * Visual design
 * ─────────────
 * Each stop has a numbered circle badge (IBM Plex Mono) on the left and event
 * details on the right:
 *   • First stop (origin): green badge (--layer-deployed-bg)
 *   • Last stop (most recent): blue badge (--layer-transit-bg)
 *   • Intermediate stops: gray badge (--layer-history-*)
 *   • Stops without GPS: dashed badge border to signal missing location
 *
 * Stops are connected by a vertical spine line (--layer-transit-border).
 *
 * Truncation / show more
 * ──────────────────────
 * By default, shows the first `maxVisible` stops plus a "Show N more" button.
 * Pass `maxVisible={Infinity}` to show all stops without truncation.
 *
 * Accessibility
 * ─────────────
 * • The timeline is an `<ol>` (ordered list) — stop sequence is semantically
 *   significant, so ordinal semantics are appropriate.
 * • aria-label on the list describes the total stop count.
 * • aria-live="polite" on the count badge so screen readers hear updates.
 * • Timestamps are wrapped in `<time>` elements with `dateTime` ISO strings.
 * • Keyboard navigation works through the list items natively.
 *
 * Usage (in T1Overview):
 * @example
 *   <JourneyTimeline caseId={caseId} maxVisible={5} />
 *
 * @example
 *   // Show all stops, no truncation:
 *   <JourneyTimeline caseId={caseId} maxVisible={Infinity} />
 */

"use client";

import { useState } from "react";
import { useM2JourneyStops } from "../../hooks/use-m2-journey-stops";
import type { JourneyStop } from "../../hooks/use-m2-journey-stops";
import styles from "./JourneyTimeline.module.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map event type slugs to human-readable labels. */
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
};

/**
 * Format an event type slug for display.
 * Falls back to capitalized-words for unknown types.
 */
function formatEventType(eventType: string): string {
  if (EVENT_TYPE_LABELS[eventType]) {
    return EVENT_TYPE_LABELS[eventType];
  }
  // Fallback: underscore_slug → "Title Case"
  return eventType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Format a timestamp for display in the timeline.
 * Shows abbreviated date + time in the user's locale.
 */
function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month:   "short",
    day:     "numeric",
    hour:    "numeric",
    minute:  "2-digit",
  });
}

/**
 * ISO 8601 string for a timestamp (for <time dateTime={...}>).
 */
function toISOString(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface JourneyTimelineProps {
  /**
   * Convex case document ID to subscribe to.
   * Pass null to render nothing (subscription skipped).
   */
  caseId: string | null;

  /**
   * Maximum number of stops to show before the "Show N more" button appears.
   * Pass Infinity to show all stops without truncation.
   *
   * @default 5
   */
  maxVisible?: number;

  /**
   * Additional CSS class for the root element.
   */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * JourneyTimeline — vertical ordered timeline of M2 journey stops.
 *
 * Subscribes to `getM2JourneyStops` and renders each stop as a numbered
 * list item in a vertical timeline layout.
 *
 * States:
 *   caseId=null    — returns null (no subscription)
 *   loading        — renders a 3-row skeleton
 *   journey=null   — returns null (case not found)
 *   stopCount=0    — renders "No journey events recorded yet."
 *   data available — renders the numbered stop timeline
 */
export function JourneyTimeline({
  caseId,
  maxVisible = 5,
  className,
}: JourneyTimelineProps) {
  const [expanded, setExpanded] = useState(false);

  const journey = useM2JourneyStops(caseId);

  // No case selected
  if (!caseId) return null;

  // Loading state — show skeleton
  if (journey === undefined) {
    return (
      <div
        className={[styles.root, className].filter(Boolean).join(" ")}
        aria-busy="true"
        aria-label="Loading journey timeline"
      >
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Journey</span>
        </div>
        <div className={styles.loading} role="status">
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.loadingRow}>
              <div className={styles.loadingCircle} aria-hidden="true" />
              <div className={styles.loadingLines}>
                <div className={styles.loadingLine} />
                <div className={styles.loadingLine} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Case not found
  if (journey === null) return null;

  const { stops, stopCount, caseLabel } = journey;
  const lastStopArrayIndex = stops.length - 1;

  // Determine which stops to display
  const effectiveMax = expanded ? Infinity : maxVisible;
  const visibleStops: JourneyStop[] =
    effectiveMax === Infinity
      ? stops
      : stops.slice(0, effectiveMax);
  const hiddenCount = Math.max(0, stops.length - visibleStops.length);

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      data-testid="journey-timeline"
    >
      {/* Section header */}
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Journey</h3>
        {stopCount > 0 && (
          <span
            className={styles.stopCountBadge}
            aria-live="polite"
            aria-atomic="true"
            aria-label={`${stopCount} journey stop${stopCount !== 1 ? "s" : ""}`}
            data-testid="journey-timeline-count"
          >
            {stopCount}
          </span>
        )}
      </div>

      {/* Empty state */}
      {stops.length === 0 ? (
        <p className={styles.empty}>No journey events recorded yet.</p>
      ) : (
        <>
          <ol
            className={styles.timelineList}
            aria-label={`${stopCount} journey stop${stopCount !== 1 ? "s" : ""} for case ${caseLabel}`}
          >
            {visibleStops.map((stop, arrayIndex) => {
              const isFirst = arrayIndex === 0;
              // isLast relative to the FULL stops array, not the visible slice
              const isLast  = arrayIndex + (stops.length - visibleStops.length) === lastStopArrayIndex
                || (expanded && arrayIndex === lastStopArrayIndex);

              const hasLocation = stop.hasCoordinates &&
                (stop.location.lat !== undefined || stop.location.locationName !== undefined);

              return (
                <li
                  key={stop.eventId}
                  className={styles.stopItem}
                  data-is-first={isFirst ? "true" : undefined}
                  data-is-last={isLast ? "true" : undefined}
                  data-event-type={stop.eventType}
                  data-stop-index={stop.stopIndex}
                >
                  {/* Left column: index badge + spine */}
                  <div className={styles.indexCol}>
                    <span
                      className={styles.indexBadge}
                      data-no-location={!stop.hasCoordinates ? "true" : undefined}
                      aria-hidden="true"
                    >
                      {stop.stopIndex}
                    </span>
                    <div className={styles.spine} aria-hidden="true" />
                  </div>

                  {/* Right column: event details */}
                  <div className={styles.contentCol}>
                    <span className={styles.eventType}>
                      {formatEventType(stop.eventType)}
                    </span>

                    <span className={styles.meta}>
                      <time dateTime={toISOString(stop.timestamp)}>
                        {formatTimestamp(stop.timestamp)}
                      </time>
                      {stop.actorName ? ` · ${stop.actorName}` : ""}
                    </span>

                    {hasLocation ? (
                      <span className={styles.location}>
                        {stop.location.locationName ||
                          (stop.location.lat !== undefined && stop.location.lng !== undefined
                            ? `${stop.location.lat.toFixed(4)}, ${stop.location.lng.toFixed(4)}`
                            : null)}
                      </span>
                    ) : (
                      <span className={styles.locationMissing}>
                        No location
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Show more / less */}
          {hiddenCount > 0 && (
            <div className={styles.showMoreRow}>
              <button
                type="button"
                className={styles.showMoreButton}
                onClick={() => setExpanded(true)}
                aria-label={`Show ${hiddenCount} more journey stop${hiddenCount !== 1 ? "s" : ""}`}
                data-testid="journey-timeline-show-more"
              >
                Show {hiddenCount} more
              </button>
            </div>
          )}

          {expanded && stops.length > maxVisible && (
            <div className={styles.showMoreRow}>
              <button
                type="button"
                className={styles.showMoreButton}
                onClick={() => setExpanded(false)}
                aria-label="Show fewer journey stops"
                data-testid="journey-timeline-show-less"
              >
                Show fewer
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default JourneyTimeline;
