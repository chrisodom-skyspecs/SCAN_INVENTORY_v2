/**
 * InlineStatusEditor — click-to-edit case status field.
 *
 * Provides a click-to-edit inline field for a case's lifecycle status in the
 * INVENTORY dashboard (T1 Summary, Dossier Overview Panel).
 *
 * States:
 *   idle     — Shows the current StatusPill + a pencil icon button (visible on
 *              hover or keyboard focus) that activates edit mode.
 *   editing  — Shows a dropdown selector with all case status options, plus
 *              Save and Cancel action buttons.  Escape cancels.
 *   saving   — Optimistic update applied immediately; spinner shown while the
 *              Convex mutation round-trip completes.
 *   error    — Server rejected the mutation; shows error message with Retry
 *              and Cancel options.
 *
 * Optimistic update:
 *   Uses `useMutation(api.cases.updateCaseStatus).withOptimisticUpdate()` to
 *   patch the local `getCaseById` and `getCaseStatus` query results immediately
 *   on Save, so the StatusPill reflects the new status before the server
 *   confirms.  Convex automatically rolls back if the mutation fails.
 *
 * Design system compliance:
 *   - No hex literals — CSS custom properties via InlineStatusEditor.module.css
 *   - StatusPill used for all status rendering (never ad-hoc spans)
 *   - Inter Tight for all UI labels and buttons
 *   - WCAG AA: proper aria-labels, keyboard navigation, focus management
 */

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { StatusPill } from "../StatusPill";
import type { StatusKind } from "../StatusPill";
import { useKindeUser } from "../../hooks/use-kinde-user";
import type { CaseStatus } from "../../../convex/cases";
import styles from "./InlineStatusEditor.module.css";
import shared from "./shared.module.css";

// ─── Status option list ────────────────────────────────────────────────────────
//
// All case lifecycle statuses in lifecycle order.
// Rendered as <option> elements in the dropdown selector.

const CASE_STATUS_OPTIONS: ReadonlyArray<{ value: CaseStatus; label: string }> = [
  { value: "hangar",      label: "In Hangar" },
  { value: "assembled",   label: "Assembled" },
  { value: "transit_out", label: "Transit Out" },
  { value: "deployed",    label: "Deployed" },
  { value: "flagged",     label: "Flagged" },
  { value: "transit_in",  label: "Transit In" },
  { value: "received",    label: "Received" },
  { value: "archived",    label: "Archived" },
] as const;

// ─── Edit state machine ────────────────────────────────────────────────────────

type EditState = "idle" | "editing" | "saving" | "error";

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface InlineStatusEditorProps {
  /** Convex document ID of the case whose status is being edited. */
  caseId: string;
  /** Currently persisted case status — drives the displayed pill and default selection. */
  currentStatus: CaseStatus;
  /** Optional additional class for the root element. */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * InlineStatusEditor — click-to-edit status field for the INVENTORY dashboard.
 *
 * Renders as a StatusPill + edit icon in idle mode.  Clicking the pencil icon
 * (or pressing Enter/Space while focused) opens a dropdown + Save/Cancel pair.
 * The Convex mutation applies an optimistic update immediately so the pill
 * reflects the selected status without waiting for the server round-trip.
 */
// ─── QC error detection ───────────────────────────────────────────────────────
//
// The [QC_APPROVAL_REQUIRED] error code is thrown by the `updateCaseStatus`
// mutation (and the SCAN app's recordShipment / scanCheckIn mutations) when an
// outbound dispatch to "transit_out" is attempted without an approved QC
// sign-off.  Detecting this code allows the UI to surface a specific,
// actionable message rather than a generic error.

function isQcApprovalError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes("[QC_APPROVAL_REQUIRED]");
}

export function InlineStatusEditor({
  caseId,
  currentStatus,
  className,
}: InlineStatusEditorProps) {
  const [editState, setEditState] = useState<EditState>("idle");
  const [selectedStatus, setSelectedStatus] = useState<CaseStatus>(currentStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Tracks whether the current error is a QC approval gate failure so the UI
  // can render a specific, actionable message instead of the generic error text.
  const [isQcError, setIsQcError] = useState(false);

  // Ref for the select element — focused automatically when edit mode opens.
  const selectRef = useRef<HTMLSelectElement>(null);

  // Current Kinde user identity for mutation attribution.
  const { id: userId, name: userName } = useKindeUser({ fallbackName: "Operator" });

  // ── Convex mutation with optimistic update ─────────────────────────────────
  //
  // withOptimisticUpdate patches the local getCaseById result immediately,
  // so the parent T1Overview (which subscribes to getCaseById) re-renders with
  // the new status before the server round-trip completes.  Convex automatically
  // rolls back the optimistic patch if the mutation throws.
  const updateCaseStatus = useMutation(api.cases.updateCaseStatus)
    .withOptimisticUpdate((localStore, args) => {
      // ── Patch getCaseById result ─────────────────────────────────────────
      const caseDoc = localStore.getQuery(api.cases.getCaseById, {
        caseId: args.caseId as Id<"cases">,
      });
      if (caseDoc != null) {
        localStore.setQuery(
          api.cases.getCaseById,
          { caseId: args.caseId as Id<"cases"> },
          { ...caseDoc, status: args.newStatus, updatedAt: Date.now() }
        );
      }

      // ── Patch getCaseStatus result ─────────────────────────────────────────
      // getCaseStatus is a lighter subscription used by status badge consumers.
      // Patching it keeps all dependent components in sync during the optimistic
      // window without waiting for Convex to re-evaluate the query.
      const caseStatus = localStore.getQuery(api.cases.getCaseStatus, {
        caseId: args.caseId as Id<"cases">,
      });
      if (caseStatus != null) {
        localStore.setQuery(
          api.cases.getCaseStatus,
          { caseId: args.caseId as Id<"cases"> },
          { ...caseStatus, status: args.newStatus, updatedAt: Date.now() }
        );
      }
    });

  // ── Sync selected status when external value changes ──────────────────────
  //
  // If Convex pushes an update while the editor is in idle mode (e.g., a SCAN
  // app mutation changed the status), reset the selected value to the new one.
  // When editing, preserve the in-progress selection to avoid disrupting the user.
  useEffect(() => {
    if (editState === "idle") {
      setSelectedStatus(currentStatus);
    }
  }, [currentStatus, editState]);

  // ── Auto-focus select when entering edit mode ──────────────────────────────
  useEffect(() => {
    if (editState === "editing") {
      selectRef.current?.focus();
    }
  }, [editState]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleEditClick = useCallback(() => {
    setSelectedStatus(currentStatus);
    setErrorMessage(null);
    setIsQcError(false);
    setEditState("editing");
  }, [currentStatus]);

  const handleCancel = useCallback(() => {
    setSelectedStatus(currentStatus);
    setErrorMessage(null);
    setIsQcError(false);
    setEditState("idle");
  }, [currentStatus]);

  const handleSave = useCallback(async () => {
    // No-op if the user didn't change the status.
    if (selectedStatus === currentStatus) {
      setEditState("idle");
      return;
    }

    setEditState("saving");
    try {
      await updateCaseStatus({
        caseId:    caseId as Id<"cases">,
        newStatus: selectedStatus,
        userId,
        userName,
      });
      setEditState("idle");
    } catch (err) {
      // Convex rolled back the optimistic update — surface the error.
      // Detect QC approval gate failures (thrown when attempting dispatch to
      // "transit_out" without an approved QC sign-off) and surface a specific,
      // actionable message instead of the generic error text.
      if (isQcApprovalError(err)) {
        setIsQcError(true);
        setErrorMessage(
          "QC sign-off approval is required before this case can be dispatched. " +
            "An admin or operator must approve QC via the T1/T3 QC Sign-Off panel."
        );
      } else {
        setIsQcError(false);
        const msg =
          err instanceof Error
            ? err.message.replace(/^\[.*?\]\s*/, "") // strip [AUTH_REQUIRED] prefix
            : "Failed to update status. Please try again.";
        setErrorMessage(msg);
      }
      setEditState("error");
    }
  }, [selectedStatus, currentStatus, caseId, userId, userName, updateCaseStatus]);

  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    setIsQcError(false);
    setEditState("editing");
  }, []);

  // Keyboard: Escape cancels from anywhere within the edit row.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleCancel]
  );

  // ── Render: error state ────────────────────────────────────────────────────
  //
  // QC approval errors get a prominent full-width banner (shared.errorBanner)
  // so the message is not truncated and clearly explains the required action.
  // Generic errors use the compact inline error row.

  if (editState === "error") {
    if (isQcError) {
      return (
        <div
          className={[styles.qcErrorWrapper, className].filter(Boolean).join(" ")}
          role="alert"
          aria-live="assertive"
          data-testid="inline-status-error"
          data-qc-error="true"
        >
          {/* QC error banner — full-width, wraps message for readability */}
          <div className={shared.errorBanner} data-testid="qc-dispatch-error-banner">
            <svg
              aria-hidden="true"
              className={styles.qcErrorIcon}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="8" r="7" />
              <line x1="8" y1="5" x2="8" y2="8" />
              <circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none" />
            </svg>
            <span>{errorMessage ?? "QC sign-off approval is required before dispatch."}</span>
          </div>
          {/* Action row: current status pill + Retry + Cancel */}
          <div className={styles.qcErrorActions}>
            <StatusPill kind={currentStatus as StatusKind} filled />
            <button
              className={styles.retryButton}
              onClick={handleRetry}
              type="button"
              aria-label="Retry status update"
            >
              Retry
            </button>
            <button
              className={[styles.cancelButtonSmall, styles.actionButton].filter(Boolean).join(" ")}
              onClick={handleCancel}
              type="button"
              aria-label="Cancel status edit"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        className={[styles.errorRow, className].filter(Boolean).join(" ")}
        role="alert"
        data-testid="inline-status-error"
      >
        <StatusPill kind={currentStatus as StatusKind} filled />
        <span className={styles.errorText} title={errorMessage ?? undefined}>
          {errorMessage ?? "Error saving status"}
        </span>
        <button
          className={styles.retryButton}
          onClick={handleRetry}
          type="button"
          aria-label="Retry status update"
        >
          Retry
        </button>
        <button
          className={[styles.cancelButtonSmall, styles.actionButton].filter(Boolean).join(" ")}
          onClick={handleCancel}
          type="button"
          aria-label="Cancel status edit"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Render: saving state ───────────────────────────────────────────────────
  //
  // Optimistic update is already in effect — the parent sees the new status.
  // Show the (optimistically updated) new status pill + spinner.

  if (editState === "saving") {
    return (
      <div
        className={[styles.idleRow, className].filter(Boolean).join(" ")}
        data-testid="inline-status-saving"
        aria-busy="true"
        aria-label="Saving status…"
      >
        <StatusPill kind={selectedStatus as StatusKind} filled />
        <span className={styles.savingSpinner} aria-label="Saving…" />
      </div>
    );
  }

  // ── Render: idle state ─────────────────────────────────────────────────────

  if (editState === "idle") {
    return (
      <div
        className={[styles.idleRow, className].filter(Boolean).join(" ")}
        data-testid="inline-status-idle"
      >
        <StatusPill kind={currentStatus as StatusKind} filled />
        <button
          className={styles.editButton}
          onClick={handleEditClick}
          type="button"
          aria-label="Edit case status"
          title="Click to edit status"
          data-testid="inline-status-edit-btn"
        >
          {/* Pencil / edit icon — SVG inline so no external dependency needed */}
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11.5 2.5a1.41 1.41 0 0 1 2 2L5 13H2v-3L11.5 2.5z" />
          </svg>
        </button>
      </div>
    );
  }

  // ── Render: editing state ──────────────────────────────────────────────────

  return (
    <div
      className={[styles.editRow, className].filter(Boolean).join(" ")}
      role="group"
      aria-label="Edit case status"
      onKeyDown={handleKeyDown}
      data-testid="inline-status-editing"
    >
      <label
        className={styles.selectLabel}
        htmlFor={`case-status-select-${caseId}`}
      >
        Status
      </label>

      <select
        id={`case-status-select-${caseId}`}
        ref={selectRef}
        className={styles.select}
        value={selectedStatus}
        onChange={(e) => setSelectedStatus(e.target.value as CaseStatus)}
        aria-label="Select new case status"
        data-testid="inline-status-select"
      >
        {CASE_STATUS_OPTIONS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <div className={styles.actionButtons}>
        <button
          className={[styles.saveButton, styles.actionButton].filter(Boolean).join(" ")}
          onClick={handleSave}
          type="button"
          aria-label="Save status change"
          disabled={selectedStatus === currentStatus}
          data-testid="inline-status-save-btn"
        >
          Save
        </button>
        <button
          className={[styles.cancelButton, styles.actionButton].filter(Boolean).join(" ")}
          onClick={handleCancel}
          type="button"
          aria-label="Cancel status edit"
          data-testid="inline-status-cancel-btn"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default InlineStatusEditor;
