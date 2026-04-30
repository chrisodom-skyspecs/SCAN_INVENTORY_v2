/**
 * QcSignOffHistory — QC Sign-Off Decision History
 *
 * A reusable component that renders a chronological list of QC (quality-control)
 * sign-off decisions for a case, ordered newest-first.  Each entry shows:
 *   - Decision status (StatusPill: approved → completed, rejected → flagged,
 *     pending → pending)
 *   - Reviewer display name
 *   - Timestamp of the sign-off action (IBM Plex Mono)
 *   - Previous → current status transition (when `previousStatus` is present)
 *   - Reviewer notes (when provided; required for "rejected" decisions)
 *
 * Designed for embedding in T-layout case detail views:
 *   T3 (Inspection) — compact recent-decisions summary
 *   T5 (Audit)       — full chronological sign-off history
 *
 * Data source
 * ───────────
 * Uses `useQcSignOffHistory(caseId, limit?)` from `src/hooks/use-qc-sign-off.ts`.
 * This subscribes to `api["queries/qcSignOff"].getQcSignOffHistory` via Convex
 * reactive transport.  Convex re-evaluates and pushes updates within ~100–300 ms
 * of any `submitQcSignOff` / `addQcSignOff` mutation, satisfying the ≤ 2-second
 * real-time fidelity requirement between SCAN app actions and the INVENTORY
 * dashboard without any polling or manual refresh.
 *
 * Loading / empty states
 * ──────────────────────
 *   undefined → Convex subscription loading; spinner shown
 *   []        → No QC decisions recorded; empty state message shown
 *   entry[]   → Decision list rendered, newest first
 *
 * Props
 * ─────
 *   caseId    — Convex document ID of the case.
 *   limit     — Optional max entries to display (useful for compact views).
 *               When omitted, all available history is shown.
 *   className — Optional additional CSS class for the outermost element.
 *
 * Accessibility
 * ─────────────
 *   - Semantic `<section>` with `aria-label`
 *   - `<ol>` list (ordered, newest first) with `aria-label`
 *   - Each `<li>` carries `aria-label` describing the decision and actor
 *   - Loading state uses `aria-busy="true"`
 *   - StatusPill provides visually distinct color + text per status
 *   - Timestamp uses IBM Plex Mono (data/tabular per spec)
 *   - Reviewer name uses Inter Tight (UI typography per spec)
 *   - WCAG AA contrast on both light and dark themes via design tokens
 *
 * Design system compliance
 * ────────────────────────
 *   - No hex literals — CSS custom properties only
 *   - IBM Plex Mono for timestamps and IDs (data/tabular content)
 *   - Inter Tight for UI labels and names (UI typography)
 *   - StatusPill as the sole status rendering mechanism (no ad-hoc status colors)
 *   - Light theme default; dark theme via `.theme-dark` on `<html>`
 */

"use client";

import { useQcSignOffHistory } from "../../hooks/use-qc-sign-off";
import { StatusPill } from "../StatusPill";
import shared from "./shared.module.css";
import styles from "./QcSignOffHistory.module.css";
import type { QcSignOffRecord, QcSignOffStatus } from "../../hooks/use-qc-sign-off";
import type { StatusKind } from "../StatusPill/StatusPill";

// ─── QC status → StatusPill kind mapping ─────────────────────────────────────
//
// Maps each QC decision status to the nearest semantic StatusKind so that
// status pills are rendered via the shared <StatusPill /> component, not
// ad-hoc inline color styles.

const QC_STATUS_TO_PILL: Record<QcSignOffStatus, StatusKind> = {
  pending:  "pending",   // no active decision (or decision revoked)
  approved: "completed", // case cleared for deployment
  rejected: "flagged",   // case requires rework
};

// ─── QC status human-readable labels ─────────────────────────────────────────
//
// Used in aria-label attributes and status delta lines.

const QC_STATUS_LABEL: Record<QcSignOffStatus, string> = {
  pending:  "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an epoch-ms timestamp as a locale string with date + time.
 * Uses IBM Plex Mono formatting per the design spec for data/tabular content.
 */
function formatSignOffDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface QcSignOffHistoryProps {
  /**
   * Convex document ID of the case whose QC sign-off history to display.
   * Passed directly to `useQcSignOffHistory` — setting to null suppresses the
   * subscription.
   */
  caseId: string;

  /**
   * Optional maximum number of history entries to display.
   * When omitted, the component renders all entries returned by the subscription.
   * Useful for compact "recent decisions" views (T3) vs. the full audit trail (T5).
   *
   * Note: this is a client-side display cap.  The `useQcSignOffHistory` hook
   * also accepts a `limit` parameter that bounds the server-side query; both
   * can be used in combination to control data fetch and UI truncation.
   */
  limit?: number;

  /**
   * Optional additional CSS class applied to the outermost `<section>` element.
   * Use for layout adjustments when embedding in a parent container.
   */
  className?: string;
}

// ─── SignOffEntry — individual history item ────────────────────────────────

interface SignOffEntryProps {
  record: QcSignOffRecord;
  /** 1-based display index within the visible list (newest = index 1). */
  index: number;
  /** Total count in the visible list — used to detect the last item. */
  total: number;
}

function SignOffEntry({ record, index, total }: SignOffEntryProps) {
  const statusLabel = QC_STATUS_LABEL[record.status] ?? record.status;
  const pillKind    = QC_STATUS_TO_PILL[record.status] ?? "pending";
  const isLast      = index === total;

  return (
    <li
      className={[
        styles.entry,
        isLast ? styles.entryLast : "",
      ].filter(Boolean).join(" ")}
      data-testid="qc-sign-off-entry"
      aria-label={`${statusLabel} by ${record.signedOffByName} on ${formatSignOffDate(record.signedOffAt)}`}
    >
      {/* ── Timeline connector — dot + vertical line ─────────────────── */}
      <div className={styles.connector} aria-hidden="true">
        <div
          className={[
            styles.connectorDot,
            record.status === "approved" ? styles.connectorDotApproved : "",
            record.status === "rejected" ? styles.connectorDotRejected : "",
          ].filter(Boolean).join(" ")}
        />
        {!isLast && <div className={styles.connectorLine} />}
      </div>

      {/* ── Entry body ────────────────────────────────────────────────── */}
      <div className={styles.entryBody}>
        {/* Primary row: status pill + reviewer name */}
        <div className={styles.entryHeader}>
          <StatusPill kind={pillKind} />
          <span className={styles.reviewerName}>{record.signedOffByName}</span>
          <span className={shared.timestamp}>
            {formatSignOffDate(record.signedOffAt)}
          </span>
        </div>

        {/*
          Status transition delta — shown when previousStatus is recorded.
          Renders as "Previous → Current" to give operators a quick diff
          of what decision changed.  Omitted when there is no prior status
          (i.e., this is the first sign-off action for the case).
        */}
        {record.previousStatus != null && (
          <p className={styles.statusDelta} aria-label={`Decision changed from ${QC_STATUS_LABEL[record.previousStatus]} to ${statusLabel}`}>
            <span className={styles.statusDeltaFrom}>
              {QC_STATUS_LABEL[record.previousStatus]}
            </span>
            <span className={styles.statusDeltaArrow} aria-hidden="true">→</span>
            <span className={styles.statusDeltaTo}>
              {statusLabel}
            </span>
          </p>
        )}

        {/* Reviewer notes — shown when present (required for "rejected") */}
        {record.notes && (
          <p className={shared.noteBlock} data-testid="qc-sign-off-notes">
            {record.notes}
          </p>
        )}
      </div>
    </li>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * QcSignOffHistory — chronological list of QC sign-off decisions for a case.
 *
 * Integrates the `useQcSignOffHistory` Convex real-time subscription and
 * renders each decision with its status pill, reviewer attribution, timestamp,
 * optional status delta, and optional reviewer notes.
 *
 * Use in T3 (Inspection) for a compact recent-decisions view, and in T5 (Audit)
 * for the full chronological QC decision trail.  Pass `limit` to truncate the
 * display in space-constrained contexts.
 *
 * All updates arrive within ~100–300 ms of any `submitQcSignOff` mutation via
 * Convex reactive transport — no page reload or manual refresh required.
 */
export function QcSignOffHistory({ caseId, limit, className }: QcSignOffHistoryProps) {
  // useQcSignOffHistory subscribes to api["queries/qcSignOff"].getQcSignOffHistory.
  // Returns an array sorted descending by signedOffAt (newest sign-off first).
  // Convex re-evaluates and pushes within ~100–300 ms of any submitQcSignOff call,
  // satisfying the ≤ 2-second real-time fidelity requirement.
  //
  //   undefined → loading (initial fetch or reconnect)
  //   []        → no sign-offs recorded for this case
  //   entry[]   → full history, newest first
  const history = useQcSignOffHistory(caseId);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (history === undefined) {
    return (
      <section
        className={[styles.container, className].filter(Boolean).join(" ")}
        data-testid="qc-sign-off-history-loading"
        aria-busy="true"
        aria-label="Loading QC sign-off history"
      >
        <div className={shared.sectionHeader}>
          <h3 className={shared.sectionTitle}>QC Sign-off History</h3>
        </div>
        <div className={shared.emptyState}>
          <div className={shared.spinner} />
        </div>
      </section>
    );
  }

  // ── Apply optional display cap ────────────────────────────────────────────
  //
  // `limit` is a client-side display cap that truncates the visible list.
  // The server-side query already returns entries in descending timestamp order
  // (newest first), so we slice from the front to get the most recent N entries.
  const visible     = limit != null ? history.slice(0, limit) : history;
  const totalCount  = history.length;
  const hiddenCount = totalCount - visible.length;

  // ── Empty state — no decisions recorded ─────────────────────────────────
  if (visible.length === 0) {
    return (
      <section
        className={[styles.container, className].filter(Boolean).join(" ")}
        data-testid="qc-sign-off-history-empty"
        aria-label="QC sign-off history — no decisions"
      >
        <div className={shared.sectionHeader}>
          <h3 className={shared.sectionTitle}>QC Sign-off History</h3>
        </div>
        <div className={shared.emptyState}>
          <p className={shared.emptyStateTitle}>No QC decisions recorded</p>
          <p className={shared.emptyStateText}>
            QC sign-offs submitted from the Inspection panel will appear here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={[styles.container, className].filter(Boolean).join(" ")}
      data-testid="qc-sign-off-history"
      aria-label="QC sign-off history"
    >
      {/* ── Section header with decision count badge ─────────────────── */}
      <div className={shared.sectionHeader}>
        <h3 className={shared.sectionTitle}>QC Sign-off History</h3>
        <span
          className={shared.timestamp}
          aria-label={`${totalCount} QC decision${totalCount !== 1 ? "s" : ""}`}
        >
          {totalCount} decision{totalCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/*
        ── Decision list ────────────────────────────────────────────────
        Ordered list (newest → oldest).  ol semantics communicate that
        recency order is meaningful to screen readers.
      */}
      <ol
        className={styles.list}
        aria-label="QC sign-off decisions, newest first"
        data-testid="qc-sign-off-history-list"
      >
        {visible.map((record, idx) => (
          <SignOffEntry
            key={record._id}
            record={record}
            index={idx + 1}
            total={visible.length}
          />
        ))}
      </ol>

      {/*
        ── Truncation notice — shown when limit clips the full list ─────
        Informs the operator that older decisions exist but are not shown.
        Directs them to the Audit (T5) tab for the full chronological trail.
      */}
      {hiddenCount > 0 && (
        <div className={styles.truncationNotice} data-testid="qc-sign-off-history-truncated">
          <span className={shared.timestamp}>
            +{hiddenCount} older decision{hiddenCount !== 1 ? "s" : ""} · see Audit tab for full history
          </span>
        </div>
      )}
    </section>
  );
}

export default QcSignOffHistory;
