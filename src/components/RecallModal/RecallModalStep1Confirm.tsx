/**
 * RecallModalStep1Confirm — Step 1 of the Recall case flow.
 *
 * Shows a case summary card and a "Confirm Recall" CTA.  Clicking Confirm
 * advances the parent RecallModal to Step 2 (details / reason capture).
 *
 * This component is purely presentational — it accepts pre-fetched case data
 * and calls the provided `onConfirm` / `onClose` callbacks.  It does NOT own
 * the <dialog> element or the portal; those are managed by RecallModal.
 *
 * Layout (top → bottom):
 *   1. Header       — "Recall Case" title, case label subtitle, × close button
 *   2. Warning banner — describes the consequences of a recall
 *   3. Case summary  — key metadata fields in a definition list grid
 *   4. Footer        — Cancel (left) + Confirm Recall (right, destructive)
 *
 * Design-system compliance:
 *   - No hex literals — CSS custom properties only
 *   - StatusPill for all status rendering
 *   - Inter Tight for UI labels / headings
 *   - IBM Plex Mono for case identifier, timestamps
 *   - WCAG AA: keyboard navigation, aria-labels, focus management
 */

import * as React from "react";
import { StatusPill } from "../StatusPill";
import type { StatusKind } from "../StatusPill";
import type { RecallCaseSummary } from "./RecallModal";
import styles from "./RecallModal.module.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Formats epoch-ms timestamps into a human-readable "Month D, YYYY HH:MM" string. */
function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Icons ────────────────────────────────────────────────────────────────────

/** × close icon — 16×16 viewBox */
function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}

/** Warning triangle icon — used in the recall consequence banner. */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575L6.457 1.047zM8 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 6zm0 7.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface RecallModalStep1ConfirmProps {
  /** Convex document ID — for accessibility labelling only (not used for queries). */
  caseId: string;
  /** Pre-fetched case metadata displayed in the summary card. */
  caseData: RecallCaseSummary;
  /** Called when the user clicks Cancel or presses Escape. */
  onClose: () => void;
  /** Called when the user clicks "Confirm Recall" — should advance to step 2. */
  onConfirm: () => void;
  /** True while the recall mutation / step transition is pending. */
  isConfirming?: boolean;
  /** Ref forwarded to the Confirm button so RecallModal can manage focus. */
  confirmButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Step 1 of the Recall flow — shows a case summary and asks the operator
 * to confirm before proceeding.  Calls `onConfirm()` on confirmation and
 * `onClose()` on cancel.
 */
export function RecallModalStep1Confirm({
  caseId,
  caseData,
  onClose,
  onConfirm,
  isConfirming = false,
  confirmButtonRef,
}: RecallModalStep1ConfirmProps) {
  // ── Keyboard: Escape cancels ──────────────────────────────────────────────
  // The native <dialog> "cancel" event already handles Escape for the modal
  // shell, but we also listen here so Step 1 content can use onKeyDown without
  // a separate event listener.
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  return (
    <div
      className={styles.step1}
      onKeyDown={handleKeyDown}
      data-testid="recall-step1-confirm"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h2
            id="recall-modal-title"
            className={styles.title}
          >
            Recall Case
          </h2>
          <p
            id="recall-modal-title-sub"
            className={styles.subtitle}
          >
            {caseData.label}
          </p>
        </div>

        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close recall dialog"
          data-testid="recall-modal-close"
        >
          <CloseIcon className={styles.closeIcon} />
        </button>
      </header>

      {/* ── Warning banner ─────────────────────────────────────────────── */}
      <div
        className={styles.warningBanner}
        role="alert"
        aria-live="assertive"
        data-testid="recall-warning-banner"
      >
        <WarningIcon className={styles.warningIcon} />
        <div className={styles.warningContent}>
          <p className={styles.warningTitle}>
            This action cannot be undone from this screen.
          </p>
          <p className={styles.warningBody}>
            Initiating a recall will flag&nbsp;
            <strong className={styles.warningCaseLabel}>{caseData.label}</strong>
            &nbsp;as recalled and notify relevant personnel. All active field
            operations associated with this case should be paused immediately.
          </p>
        </div>
      </div>

      {/* ── Case summary ───────────────────────────────────────────────── */}
      <section
        className={styles.summarySection}
        aria-label="Case summary"
        id="recall-modal-desc"
        data-testid="recall-case-summary"
      >
        <h3 className={styles.summaryHeading}>Case Summary</h3>

        <dl className={styles.summaryGrid}>
          {/* Case label */}
          <div className={styles.summaryItem}>
            <dt className={styles.summaryLabel}>Case ID</dt>
            <dd className={styles.summaryValueMono}>{caseData.label}</dd>
          </div>

          {/* Current status */}
          <div className={styles.summaryItem}>
            <dt className={styles.summaryLabel}>Status</dt>
            <dd className={styles.summaryValue}>
              <StatusPill kind={caseData.status as StatusKind} />
            </dd>
          </div>

          {/* Location — omit if not set */}
          {caseData.locationName && (
            <div className={styles.summaryItem}>
              <dt className={styles.summaryLabel}>Location</dt>
              <dd className={styles.summaryValue}>{caseData.locationName}</dd>
            </div>
          )}

          {/* Assignee — omit if not set */}
          {caseData.assigneeName ? (
            <div className={styles.summaryItem}>
              <dt className={styles.summaryLabel}>Assigned To</dt>
              <dd className={styles.summaryValue}>{caseData.assigneeName}</dd>
            </div>
          ) : (
            <div className={styles.summaryItem}>
              <dt className={styles.summaryLabel}>Assigned To</dt>
              <dd className={[styles.summaryValue, styles.summaryValueEmpty].join(" ")}>
                Unassigned
              </dd>
            </div>
          )}

          {/* Template — omit if not set */}
          {caseData.templateName && (
            <div className={styles.summaryItem}>
              <dt className={styles.summaryLabel}>Template</dt>
              <dd className={styles.summaryValue}>{caseData.templateName}</dd>
            </div>
          )}

          {/* Last updated */}
          <div className={styles.summaryItem}>
            <dt className={styles.summaryLabel}>Last Updated</dt>
            <dd className={styles.summaryValueMono}>{formatDate(caseData.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        {/* Left: Cancel */}
        <button
          type="button"
          className={styles.cancelButton}
          onClick={onClose}
          disabled={isConfirming}
          data-testid="recall-cancel-btn"
        >
          Cancel
        </button>

        {/* Right: Confirm Recall (destructive CTA) */}
        <button
          ref={confirmButtonRef}
          type="button"
          className={styles.confirmButton}
          onClick={onConfirm}
          disabled={isConfirming}
          aria-disabled={isConfirming}
          aria-label={
            isConfirming
              ? "Confirming recall…"
              : `Confirm recall of case ${caseData.label}`
          }
          data-testid="recall-confirm-btn"
        >
          {isConfirming ? (
            <>
              <span className={styles.confirmSpinner} aria-hidden="true" />
              Confirming…
            </>
          ) : (
            <>
              <WarningIcon className={styles.confirmIcon} />
              Confirm Recall
            </>
          )}
        </button>
      </footer>
    </div>
  );
}

export default RecallModalStep1Confirm;
