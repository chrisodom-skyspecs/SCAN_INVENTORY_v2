/**
 * ReconciliationBanner
 *
 * Sub-AC 2c: SCAN app server-state reconciliation notice.
 *
 * Renders a contextual banner when optimistic local state diverges from the
 * confirmed Convex server state, or when a mutation has been pending longer
 * than the stale threshold (indicating a possible connectivity problem).
 *
 * Two visual variants:
 *   "divergence" — warning amber: one or more fields confirmed by the server
 *                  differ from the value the optimistic update applied locally.
 *                  The user sees which fields changed and what the server value is.
 *
 *   "stale"      — info blue: a mutation has been pending for > STALE_THRESHOLD_MS
 *                  without server confirmation.  The local state may not have been
 *                  persisted yet.
 *
 * Usage — divergence:
 *   import { ReconciliationBanner } from "@/components/ReconciliationBanner";
 *
 *   {reconciliation.hasDivergence && (
 *     <ReconciliationBanner
 *       divergedFields={reconciliation.divergedFields}
 *       onDismiss={reconciliation.dismiss}
 *     />
 *   )}
 *
 * Usage — stale:
 *   {reconciliation.isStale && (
 *     <ReconciliationBanner
 *       stale
 *       staleSince={reconciliation.staleSince}
 *       onDismiss={reconciliation.dismiss}
 *     />
 *   )}
 *
 * Design system compliance
 * ────────────────────────
 * All colors via CSS custom properties — no hex literals in this file.
 * Inter Tight for all text; IBM Plex Mono for field names and values.
 * Touch targets ≥ 44 × 44 px (WCAG 2.5.5).
 * WCAG AA contrast in both light and dark themes via signal tokens.
 * prefers-reduced-motion respected in the CSS module (no JS animation).
 */

"use client";

import { useEffect, useState } from "react";
import type { DivergenceRecord } from "../../hooks/use-server-state-reconciliation";
import styles from "./ReconciliationBanner.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DivergenceBannerProps {
  /** Diverged field records from `useServerStateReconciliation`. */
  divergedFields: DivergenceRecord[];
  /** Called when the user taps "Dismiss" or the close (×) button. */
  onDismiss: () => void;
  stale?: never;
  staleSince?: never;
}

interface StaleBannerProps {
  /** Show the stale-mutation variant. */
  stale: true;
  /** Epoch ms when staleness was first detected (from `reconciliation.staleSince`). */
  staleSince: number | null;
  /** Called when the user taps "Dismiss". */
  onDismiss: () => void;
  divergedFields?: never;
}

export type ReconciliationBannerProps = DivergenceBannerProps | StaleBannerProps;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an unknown value for display in the field-row chips.
 * Truncates long strings to keep the UI clean on mobile screens.
 */
function formatValue(value: unknown, maxLen = 14): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  const str = String(value);
  if (str.length > maxLen) return `${str.slice(0, maxLen)}…`;
  return str;
}

/**
 * Returns a human-readable relative duration string from `since` to now.
 * e.g. "5s", "1m 2s"
 */
function formatStaleDuration(sinceMs: number): string {
  const elapsedSec = Math.floor((Date.now() - sinceMs) / 1_000);
  if (elapsedSec < 60) return `${elapsedSec}s`;
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

// ─── Sub-component: Diverged field row ───────────────────────────────────────

function DivergenceFieldRow({ field, predicted, actual }: DivergenceRecord) {
  return (
    <li className={styles.fieldRow} data-testid="divergence-field-row">
      {/* Field name */}
      <span className={styles.fieldName}>{field}</span>

      {/* Predicted value (crossed-out) */}
      <span
        className={[styles.fieldValue, styles.fieldValuePredicted].join(" ")}
        title={`Predicted: ${String(predicted)}`}
        aria-label={`Predicted value: ${formatValue(predicted)}`}
      >
        {formatValue(predicted)}
      </span>

      {/* Arrow */}
      <span className={styles.fieldArrow} aria-hidden="true">→</span>

      {/* Server-confirmed value */}
      <span
        className={[styles.fieldValue, styles.fieldValueActual].join(" ")}
        title={`Server value: ${String(actual)}`}
        aria-label={`Server-confirmed value: ${formatValue(actual)}`}
      >
        {formatValue(actual)}
      </span>
    </li>
  );
}

// ─── Sub-component: Stale duration ticker ────────────────────────────────────

function StaleDurationTicker({ staleSince }: { staleSince: number | null }) {
  const [duration, setDuration] = useState(
    staleSince !== null ? formatStaleDuration(staleSince) : "…",
  );

  useEffect(() => {
    if (staleSince === null) return;

    const timer = setInterval(() => {
      setDuration(formatStaleDuration(staleSince));
    }, 1_000);

    return () => clearInterval(timer);
  }, [staleSince]);

  return (
    <span className={styles.staleDuration} aria-live="off">
      {duration}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * ReconciliationBanner
 *
 * Renders either a divergence notice (warning) or a stale-mutation notice
 * (info) based on the props provided.  The user can dismiss both variants.
 */
export function ReconciliationBanner(props: ReconciliationBannerProps) {
  const isDivergence = !props.stale;

  return (
    <div
      className={styles.banner}
      data-variant={isDivergence ? "divergence" : "stale"}
      role="alert"
      aria-live="polite"
      aria-atomic="false"
      data-testid="reconciliation-banner"
    >
      {/* ── Header row ───────────────────────────────────────────────── */}
      <div className={styles.bannerHeader}>
        {/* Icon */}
        <div className={styles.bannerIconWrap} aria-hidden="true">
          <svg
            className={styles.bannerIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {isDivergence ? (
              /* Warning triangle */
              <>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </>
            ) : (
              /* Info circle */
              <>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </>
            )}
          </svg>
        </div>

        {/* Title + body */}
        <div className={styles.bannerTextGroup}>
          <p className={styles.bannerTitle}>
            {isDivergence
              ? "Server state differs from local update"
              : "Action pending — waiting for server"}
          </p>
          <p className={styles.bannerBody}>
            {isDivergence
              ? "The server confirmed different field values than what was applied locally. The view has been updated to match the server."
              : "Your action was submitted but has not been confirmed by the server yet. Check your connection."}
          </p>

          {/* Stale duration */}
          {!isDivergence && (
            <StaleDurationTicker staleSince={(props as StaleBannerProps).staleSince} />
          )}
        </div>

        {/* Dismiss (×) button */}
        <button
          type="button"
          className={styles.dismissBtn}
          onClick={props.onDismiss}
          aria-label="Dismiss this notice"
          data-testid="reconciliation-dismiss-btn"
        >
          <svg
            className={styles.dismissIcon}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="4" x2="4" y2="12" />
            <line x1="4" y1="4" x2="12" y2="12" />
          </svg>
        </button>
      </div>

      {/* ── Diverged field list ──────────────────────────────────────── */}
      {isDivergence && (props as DivergenceBannerProps).divergedFields.length > 0 && (
        <ul
          className={styles.fieldList}
          aria-label="Fields that differ between local and server state"
        >
          {(props as DivergenceBannerProps).divergedFields.map((record) => (
            <DivergenceFieldRow
              key={record.field}
              field={record.field}
              predicted={record.predicted}
              actual={record.actual}
            />
          ))}
        </ul>
      )}

      {/* ── Dismiss action row ───────────────────────────────────────── */}
      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.dismissTextBtn}
          onClick={props.onDismiss}
          data-testid="reconciliation-dismiss-text-btn"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
