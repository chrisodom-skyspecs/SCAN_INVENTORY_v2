/**
 * QcSignOffForm — QC (Quality-Control) Sign-Off Form
 *
 * A controlled form component for submitting a QC sign-off decision on a case.
 * Renders a multi-line notes textarea and two action buttons ("Reject" and
 * "Approve") that call the `submitQcSignOff` Convex mutation.
 *
 * Validation rules
 * ────────────────
 *   • Rejection requires non-empty notes (enforced client-side and server-side).
 *   • Notes are optional for approval but strongly recommended.
 *   • The "Approve" button is disabled when `hasUnresolvedIssues` is true —
 *     a case with damaged or missing items cannot be approved until those issues
 *     are resolved.
 *   • Both action buttons are disabled while a submission is in flight.
 *
 * Disabled state
 * ──────────────
 *   The `hasUnresolvedIssues` prop puts the Approve button in a disabled state
 *   with an explanatory tooltip.  This gates approval on a clean checklist while
 *   still allowing rejection (to document the blockers) when issues remain.
 *
 * Authentication
 * ──────────────
 *   Uses `useCurrentUser` to populate `signedOffBy` (Kinde user ID) and
 *   `signedOffByName` (display name) from the active session.
 *
 * Real-time fidelity
 * ──────────────────
 *   `submitQcSignOff` writes to `qcSignOffs`, `cases`, and `events` in a single
 *   atomic Convex transaction.  Convex invalidates all subscribed queries for
 *   these tables within ~100–300 ms, so the T1 QC status badge and T5 audit
 *   timeline update without a page reload.
 *
 * Props
 * ─────
 *   caseId              — Convex document ID of the case to sign off.
 *   hasUnresolvedIssues — true when the case has damaged or missing items.
 *   unresolvedCount     — Optional count shown in the disabled-approve tooltip.
 *   currentStatus       — Optional current QC status ("pending" | "approved" | "rejected").
 *   onSuccess           — Optional callback invoked after a successful submission.
 *   className           — Optional additional CSS class for the outermost element.
 *
 * Accessibility
 * ─────────────
 *   • `<form>` with proper `aria-label`
 *   • `<textarea>` linked to label via `htmlFor` / `id`
 *   • Required indicator marked via `aria-required` and a visible asterisk
 *   • `aria-describedby` wires the textarea to its helper text and error message
 *   • Disabled state communicated via `aria-disabled` on buttons
 *   • Live error/success regions use `role="alert"` / `aria-live="polite"`
 *   • WCAG AA contrast on all text via design tokens
 */

"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useCurrentUser } from "../../hooks/use-current-user";
import { StatusPill } from "../StatusPill";
import shared from "../CaseDetail/shared.module.css";
import styles from "./QcSignOffForm.module.css";
import type { StatusKind } from "../StatusPill/StatusPill";

// ─── QC status → StatusPill kind mapping ─────────────────────────────────────

/** Map QC sign-off status → nearest semantic StatusKind for <StatusPill>. */
const QC_STATUS_TO_PILL: Record<"pending" | "approved" | "rejected", StatusKind> = {
  pending:  "pending",
  approved: "completed",
  rejected: "flagged",
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface QcSignOffFormProps {
  /**
   * Convex document ID of the case to submit the QC sign-off for.
   * Passed directly to the `submitQcSignOff` mutation.
   */
  caseId: string;

  /**
   * Whether the case has any unresolved manifest item issues (damaged / missing).
   *
   * When `true`, the "Approve" button is disabled with an explanatory message.
   * The "Reject" button remains enabled so operators can document the blockers.
   *
   * Set from the `damaged + missing` counts of `useChecklistSummary`.
   */
  hasUnresolvedIssues: boolean;

  /**
   * Number of unresolved items.  Used to build the descriptive tooltip on the
   * disabled Approve button.  Pass 0 when not known.
   */
  unresolvedCount?: number;

  /**
   * The current QC sign-off status for the case.
   *   "pending"  — no active decision (or previous decision revoked)
   *   "approved" — case cleared for deployment
   *   "rejected" — case requires rework
   *   null       — status not yet loaded (shows nothing)
   *
   * When provided, the current status is shown above the form as context.
   */
  currentStatus?: "pending" | "approved" | "rejected" | null;

  /**
   * Optional callback invoked after a successful QC sign-off submission.
   * Receives the confirmed status so the parent can update local state or
   * navigate to a confirmation view.
   */
  onSuccess?: (result: { status: "approved" | "rejected" | "pending" }) => void;

  /**
   * Optional additional CSS class applied to the outermost `<section>` element.
   */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * QcSignOffForm — form for submitting an "approved" or "rejected" QC decision.
 *
 * Renders a notes textarea and two action buttons.  "Approve" is disabled when
 * `hasUnresolvedIssues` is true.  Rejection requires non-empty notes.  Both
 * buttons are disabled while a submission is in flight.
 *
 * Calls `api.mutations.qcSignOff.submitQcSignOff` via Convex `useMutation`.
 */
export function QcSignOffForm({
  caseId,
  hasUnresolvedIssues,
  unresolvedCount = 0,
  currentStatus,
  onSuccess,
  className,
}: QcSignOffFormProps) {
  // ── Convex mutation ────────────────────────────────────────────────────────
  const submitQcSignOff = useMutation(
    api.mutations.qcSignOff.submitQcSignOff,
  );

  // ── Current user for sign-off attribution ─────────────────────────────────
  const { id: userId, name: userName, isLoading: userLoading } = useCurrentUser();

  // ── Local form state ───────────────────────────────────────────────────────

  /** Textarea value — the reviewer's notes */
  const [notes, setNotes] = useState("");

  /**
   * Which action is currently in flight.
   * null   → no submission in progress
   * "approved" | "rejected" → submission running
   */
  const [submittingStatus, setSubmittingStatus] = useState<
    "approved" | "rejected" | null
  >(null);

  /** Server-side or network error message to display below the form */
  const [error, setError] = useState<string | null>(null);

  /** Success message displayed after a sign-off is recorded */
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ── Derived validation ─────────────────────────────────────────────────────

  /** True while any submission is in flight */
  const isSubmitting = submittingStatus !== null;

  /**
   * Validate notes for the given action before sending the mutation.
   * Returns an error message string, or null if valid.
   */
  function validateForStatus(status: "approved" | "rejected"): string | null {
    if (status === "rejected" && !notes.trim()) {
      return "Rejection reason is required. Please describe the issues that need to be resolved.";
    }
    return null;
  }

  // ── Submit handler ─────────────────────────────────────────────────────────

  async function handleSubmit(status: "approved" | "rejected") {
    // Clear previous feedback
    setError(null);
    setSuccessMsg(null);

    // Client-side validation
    const validationError = validateForStatus(status);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmittingStatus(status);

    try {
      const result = await submitQcSignOff({
        caseId:          caseId as Id<"cases">,
        status,
        signedOffBy:     userId,
        signedOffByName: userName,
        signedOffAt:     Date.now(),
        notes:           notes.trim() || undefined,
      });

      // Success — show confirmation message
      const label = status === "approved" ? "Approved" : "Rejected";
      setSuccessMsg(`QC sign-off recorded: ${label}.`);

      // Reset notes so the form is ready for a follow-up action
      setNotes("");

      // Notify parent
      onSuccess?.({ status: result.status });
    } catch (err) {
      // Extract user-facing message from the Convex error
      const raw = err instanceof Error ? err.message : String(err);

      // Strip Convex "[ERROR_CODE]" prefixes for a cleaner UI message
      const cleaned = raw
        .replace(/^\[.*?\]\s*/, "")
        .replace(/^ConvexError:\s*/i, "")
        .trim();

      setError(cleaned || "An unexpected error occurred. Please try again.");
    } finally {
      setSubmittingStatus(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const notesId       = `qc-notes-${caseId}`;
  const notesHelpId   = `qc-notes-help-${caseId}`;
  const notesErrorId  = `qc-notes-error-${caseId}`;

  // Whether approve is blocked by unresolved issues
  const approveBlocked = hasUnresolvedIssues;
  const approveTitle   = approveBlocked
    ? `Cannot approve: ${unresolvedCount > 0
        ? `${unresolvedCount} item${unresolvedCount !== 1 ? "s have" : " has"} unresolved issues (damaged or missing).`
        : "case has unresolved issues."} Resolve all issues before approving.`
    : undefined;

  return (
    <section
      className={[styles.form, className].filter(Boolean).join(" ")}
      data-testid="qc-sign-off-form"
      aria-label="QC sign-off form"
    >
      {/* ── Section header ────────────────────────────────────────────── */}
      <div className={shared.sectionHeader}>
        <h3 className={shared.sectionTitle}>QC Sign-off</h3>

        {/* Current status pill — shown when a status is active */}
        {currentStatus && currentStatus !== "pending" && (
          <StatusPill
            kind={QC_STATUS_TO_PILL[currentStatus]}
            data-testid="qc-current-status-pill"
          />
        )}
      </div>

      {/*
        ── Unresolved issues warning banner ────────────────────────────
        Shown when the case has damaged or missing items.
        Informs the operator that approval is blocked until issues are resolved.
      */}
      {hasUnresolvedIssues && (
        <div
          className={styles.issuesBanner}
          role="status"
          data-testid="qc-issues-banner"
          aria-label={`${unresolvedCount > 0 ? `${unresolvedCount} unresolved item issue${unresolvedCount !== 1 ? "s" : ""}` : "Unresolved item issues"}: approval is blocked`}
        >
          <span className={styles.issuesBannerIcon} aria-hidden="true">⚠</span>
          <span className={styles.issuesBannerText}>
            {unresolvedCount > 0
              ? `${unresolvedCount} item${unresolvedCount !== 1 ? "s have" : " has"} unresolved issues.`
              : "Case has unresolved item issues."}{" "}
            Approval is blocked until all items are resolved.
          </span>
        </div>
      )}

      {/*
        ── Notes textarea ───────────────────────────────────────────────
        Multi-line text area for reviewer notes.  Required for rejection;
        optional (but recommended) for approval.
      */}
      <div className={styles.fieldGroup}>
        <label
          htmlFor={notesId}
          className={styles.label}
        >
          Reviewer Notes
          {/* Visual hint — required for rejection */}
          <span className={styles.labelHint} aria-hidden="true">
            (required for rejection)
          </span>
        </label>

        <textarea
          id={notesId}
          className={[
            styles.textarea,
            error ? styles.textareaError : "",
          ].filter(Boolean).join(" ")}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            // Clear error as the user corrects the field
            if (error) setError(null);
          }}
          placeholder="Add notes about this QC review decision…"
          rows={4}
          disabled={isSubmitting}
          aria-required={false}
          aria-describedby={[notesHelpId, error ? notesErrorId : ""]
            .filter(Boolean)
            .join(" ")}
          data-testid="qc-notes-textarea"
        />

        {/* Static helper text */}
        <p
          id={notesHelpId}
          className={styles.helperText}
        >
          Notes are required when rejecting. For approval, they are optional
          but provide a useful audit trail.
        </p>

        {/* Inline validation error */}
        {error && (
          <p
            id={notesErrorId}
            className={styles.fieldError}
            role="alert"
            data-testid="qc-form-error"
          >
            {error}
          </p>
        )}
      </div>

      {/*
        ── Success message ──────────────────────────────────────────────
        Shown after a successful submission. Auto-cleared on next submit.
      */}
      {successMsg && (
        <p
          className={styles.successMsg}
          role="status"
          aria-live="polite"
          data-testid="qc-form-success"
        >
          {successMsg}
        </p>
      )}

      {/*
        ── Action buttons ───────────────────────────────────────────────
        "Reject" is always available (allows documenting issues).
        "Approve" is disabled when `hasUnresolvedIssues` is true.
        Both are disabled while a submission is in flight or while the
        user session is loading.
      */}
      <div className={styles.actions}>
        {/* Reject button */}
        <button
          type="button"
          className={[styles.btn, styles.btnReject].join(" ")}
          onClick={() => handleSubmit("rejected")}
          disabled={isSubmitting || userLoading}
          aria-disabled={isSubmitting || userLoading}
          aria-busy={submittingStatus === "rejected"}
          data-testid="qc-reject-btn"
        >
          {submittingStatus === "rejected" ? (
            <span className={styles.btnSpinner} aria-hidden="true" />
          ) : null}
          {submittingStatus === "rejected" ? "Rejecting…" : "Reject"}
        </button>

        {/* Approve button — blocked by unresolved issues */}
        <button
          type="button"
          className={[styles.btn, styles.btnApprove].join(" ")}
          onClick={() => handleSubmit("approved")}
          disabled={isSubmitting || userLoading || approveBlocked}
          aria-disabled={isSubmitting || userLoading || approveBlocked}
          aria-busy={submittingStatus === "approved"}
          title={approveTitle}
          data-testid="qc-approve-btn"
        >
          {submittingStatus === "approved" ? (
            <span className={styles.btnSpinner} aria-hidden="true" />
          ) : null}
          {submittingStatus === "approved" ? "Approving…" : "Approve"}
        </button>
      </div>
    </section>
  );
}

export default QcSignOffForm;
