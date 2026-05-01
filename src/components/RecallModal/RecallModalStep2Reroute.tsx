/**
 * RecallModalStep2Reroute — Step 2 of the Recall case flow.
 *
 * Presents the operator with return-method options for getting the recalled
 * case back to base, plus an optional notes field.  Clicking "Submit Recall"
 * calls `onSubmit` with the selected method and notes; clicking "Back" returns
 * to Step 1 via `onBack`.
 *
 * Return methods:
 *   fedex                — Ship via FedEx carrier pick-up or drop-off
 *   driver_pickup        — A driver collects the case from site
 *   warehouse_drop_off   — Pilot/tech delivers case directly to warehouse
 *
 * Layout (top → bottom):
 *   1. Header           — "Recall — Reroute" title, case label, step indicator, × close
 *   2. Method selection — styled radio cards, one per return method
 *   3. Notes textarea   — optional free-text note attached to the recall event
 *   4. Footer           — Back (left) + Submit Recall (right, primary CTA)
 *
 * Design-system compliance:
 *   - No hex literals — CSS custom property tokens only
 *   - Inter Tight for UI labels / headings
 *   - IBM Plex Mono for case identifier
 *   - WCAG AA: keyboard navigation, focus ring, radio role, aria-labels
 *   - Fully mobile-responsive (stack layout ≤ 480 px)
 */

import * as React from "react";
import type { RecallCaseSummary } from "./RecallModal";
import styles from "./RecallModal.module.css";

// ─── Public types ─────────────────────────────────────────────────────────────

/** Discriminated union of valid case return methods. */
export type RecallReturnMethod =
  | "fedex"
  | "driver_pickup"
  | "warehouse_drop_off";

/** Data emitted by the reroute form on submit. */
export interface RecallRerouteData {
  /** Required reason shown to the current case holder and audit trail. */
  reason: string;
  /** The chosen return-logistics method. */
  returnMethod: RecallReturnMethod;
  /** Optional operator note attached to the recall event. */
  notes?: string;
}

export interface RecallModalStep2RerouteProps {
  /** Convex document ID — for accessibility ID namespacing. */
  caseId: string;
  /** Pre-fetched case metadata shown in the step header. */
  caseData: RecallCaseSummary;
  /** Called when the user clicks × close. */
  onClose: () => void;
  /** Called when the user clicks "Back" — parent should return to Step 1. */
  onBack: () => void;
  /**
   * Called when the user submits the form.
   * Receives validated form data; parent handles the mutation.
   */
  onSubmit: (data: RecallRerouteData) => void;
  /**
   * True while the submit mutation is in flight.
   * Disables all controls and shows a spinner.
   * @default false
   */
  isSubmitting?: boolean;
  /** Ref forwarded to the Submit button for focus management. */
  submitButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

// ─── Internal constants ───────────────────────────────────────────────────────

/**
 * The form element serves as the `aria-describedby` target for the parent
 * <dialog aria-describedby="recall-modal-desc">.  Using the same id ensures
 * the assistive-technology description stays in sync across both steps.
 */
const FORM_ID = "recall-modal-desc";

interface MethodMeta {
  value: RecallReturnMethod;
  label: string;
  description: string;
  Icon: React.FC;
}

const METHOD_OPTIONS: MethodMeta[] = [
  {
    value: "fedex",
    label: "FedEx",
    description: "Ship via FedEx carrier pick-up or scheduled drop-off.",
    Icon: FedExIcon,
  },
  {
    value: "driver_pickup",
    label: "Driver Pickup",
    description: "Dispatch a driver to collect the case from the field site.",
    Icon: DriverPickupIcon,
  },
  {
    value: "warehouse_drop_off",
    label: "Warehouse Drop-off",
    description:
      "Pilot or technician delivers the case directly to the warehouse.",
    Icon: WarehouseDropOffIcon,
  },
];

// ─── Icons ────────────────────────────────────────────────────────────────────

/** Delivery truck icon — represents FedEx / carrier shipment. */
function FedExIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={styles.methodIcon}
    >
      <rect x="2" y="7" width="11" height="8" rx="1" />
      <path d="M13 9h3l2 3v3h-5V9z" />
      <circle cx="5.5" cy="16" r="1.5" />
      <circle cx="15.5" cy="16" r="1.5" />
    </svg>
  );
}

/** Car + person icon — represents driver pickup. */
function DriverPickupIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={styles.methodIcon}
    >
      <path d="M3 12l1.5-5h11L17 12" />
      <rect x="2" y="12" width="16" height="4" rx="1" />
      <circle cx="6" cy="16.5" r="1.5" />
      <circle cx="14" cy="16.5" r="1.5" />
      <circle cx="10" cy="5" r="2" />
      <path d="M10 7v3" />
    </svg>
  );
}

/** Building icon — represents warehouse drop-off. */
function WarehouseDropOffIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={styles.methodIcon}
    >
      <path d="M1 8l9-5 9 5" />
      <rect x="3" y="8" width="14" height="10" rx="1" />
      <rect x="8" y="13" width="4" height="5" rx="0.5" />
    </svg>
  );
}

/** × close icon — 16×16. */
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

/** Left-pointing chevron — used in "Back" button. */
function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10 12L6 8l4-4" />
    </svg>
  );
}

/** Checkmark — rendered inside a selected radio card. */
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 6l3 3 5-5" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Step 2 of the Recall flow — return-method selection + optional notes.
 *
 * Emits `onSubmit(data)` with validated form values on Submit click.
 * Emits `onBack()` on the Back button.
 */
export function RecallModalStep2Reroute({
  caseId,
  caseData,
  onClose,
  onBack,
  onSubmit,
  isSubmitting = false,
  submitButtonRef,
}: RecallModalStep2RerouteProps) {
  // ── Form state ────────────────────────────────────────────────────────────
  const [selectedMethod, setSelectedMethod] =
    React.useState<RecallReturnMethod>("fedex");
  const [reason, setReason] = React.useState("");
  const [notes, setNotes] = React.useState("");

  // ── Stable IDs (scoped to caseId to avoid collisions if multiple modals) ─
  const groupLabelId = `recall-method-lbl-${caseId}`;
  const reasonId = `recall-reason-${caseId}`;
  const reasonLabelId = `recall-reason-lbl-${caseId}`;
  const notesId = `recall-notes-${caseId}`;
  const notesLabelId = `recall-notes-lbl-${caseId}`;

  // ── Keyboard: Escape cancels ──────────────────────────────────────────────
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  // ── Submit handler ────────────────────────────────────────────────────────
  const handleSubmit = React.useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (isSubmitting) return;
      const trimmedReason = reason.trim();
      if (!trimmedReason) return;
      onSubmit({
        reason: trimmedReason,
        returnMethod: selectedMethod,
        notes: notes.trim() || undefined,
      });
    },
    [isSubmitting, onSubmit, selectedMethod, reason, notes]
  );

  return (
    <div
      className={styles.step2}
      onKeyDown={handleKeyDown}
      data-testid="recall-modal-step2-reroute"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h2 id="recall-modal-title" className={styles.title}>
            Recall — Reroute
          </h2>
          <p className={styles.subtitleRow}>
            <span className={styles.subtitleMono}>{caseData.label}</span>
            <span
              className={styles.stepBadge}
              aria-label="Step 2 of 2"
            >
              2 / 2
            </span>
          </p>
        </div>

        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          disabled={isSubmitting}
          aria-label="Close recall dialog"
          data-testid="recall-step2-close"
        >
          <CloseIcon className={styles.closeIcon} />
        </button>
      </header>

      {/* ── Form body ──────────────────────────────────────────────────── */}
      {/*
        id="recall-modal-desc" provides the target for the <dialog>'s
        aria-describedby attribute (set in RecallModal.tsx).
        The same element is the <form> so the browser associates
        the submit button via the `form` attribute below.
      */}
      <form
        id={FORM_ID}
        className={styles.step2Body}
        onSubmit={handleSubmit}
        noValidate
        data-testid="recall-reroute-form"
        aria-label="Recall reroute options"
      >
        {/* ── Return method radio group ──────────────────────────────────── */}
        <fieldset
          className={styles.methodFieldset}
          disabled={isSubmitting}
          data-testid="recall-method-fieldset"
        >
          <legend id={groupLabelId} className={styles.methodGroupLabel}>
            Return Method
          </legend>

          <div className={styles.methodOptionList}>
            {METHOD_OPTIONS.map(({ value, label, description, Icon }) => {
              const inputId = `recall-method-${value}-${caseId}`;
              const descId = `${inputId}-desc`;
              const isSelected = selectedMethod === value;

              return (
                <div
                  key={value}
                  className={[
                    styles.methodOption,
                    isSelected ? styles.methodOptionSelected : "",
                    isSubmitting ? styles.methodOptionDisabled : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-testid={`recall-method-option-${value}`}
                  data-selected={String(isSelected)}
                >
                  <input
                    type="radio"
                    id={inputId}
                    name={`recall-return-method-${caseId}`}
                    value={value}
                    checked={isSelected}
                    onChange={() => setSelectedMethod(value)}
                    disabled={isSubmitting}
                    className={styles.methodRadioInput}
                    aria-describedby={descId}
                    data-testid={`recall-method-radio-${value}`}
                  />
                  <label
                    htmlFor={inputId}
                    className={styles.methodOptionLabel}
                  >
                    {/* Icon */}
                    <span
                      className={styles.methodOptionIconWrap}
                      aria-hidden="true"
                    >
                      <Icon />
                    </span>

                    {/* Text content */}
                    <span className={styles.methodOptionContent}>
                      <span className={styles.methodOptionTitle}>{label}</span>
                      <span id={descId} className={styles.methodOptionDesc}>
                        {description}
                      </span>
                    </span>

                    {/* Check indicator (visible when selected) */}
                    <span
                      className={[
                        styles.methodOptionCheck,
                        isSelected ? styles.methodOptionCheckSelected : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-hidden="true"
                    >
                      {isSelected && (
                        <CheckIcon className={styles.checkIcon} />
                      )}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>

        {/* ── Recall reason ─────────────────────────────────────────────── */}
        <div className={styles.notesSection}>
          <label
            id={reasonLabelId}
            htmlFor={reasonId}
            className={styles.notesLabel}
          >
            Recall Reason
          </label>
          <textarea
            id={reasonId}
            name="recall-reason"
            className={styles.notesTextarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isSubmitting}
            placeholder="Maintenance, upgrade, incident review, or known issue…"
            maxLength={500}
            rows={2}
            required
            aria-labelledby={reasonLabelId}
            data-testid="recall-reason-textarea"
          />
        </div>

        {/* ── Notes textarea ────────────────────────────────────────────── */}
        <div className={styles.notesSection}>
          <label
            id={notesLabelId}
            htmlFor={notesId}
            className={styles.notesLabel}
          >
            Notes{" "}
            <span className={styles.notesOptional} aria-hidden="true">
              (optional)
            </span>
          </label>
          <textarea
            id={notesId}
            name="recall-notes"
            className={styles.notesTextarea}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isSubmitting}
            placeholder="Add context about the recall or return instructions…"
            maxLength={1000}
            rows={3}
            aria-labelledby={notesLabelId}
            data-testid="recall-notes-textarea"
          />
          {notes.length > 900 && (
            <p
              className={styles.notesCount}
              aria-live="polite"
              role="status"
              data-testid="recall-notes-count"
            >
              {notes.length} / 1000
            </p>
          )}
        </div>
      </form>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        {/* Left: Back */}
        <button
          type="button"
          className={styles.backButton}
          onClick={onBack}
          disabled={isSubmitting}
          aria-label="Back to step 1"
          data-testid="recall-back-btn"
        >
          <ChevronLeftIcon className={styles.backIcon} />
          Back
        </button>

        {/* Right: Submit Recall */}
        <button
          ref={submitButtonRef}
          type="submit"
          form={FORM_ID}
          className={styles.submitButton}
          disabled={isSubmitting || reason.trim().length === 0}
          aria-disabled={isSubmitting || reason.trim().length === 0}
          aria-label={
            isSubmitting
              ? "Submitting recall…"
              : `Submit recall for case ${caseData.label}`
          }
          data-testid="recall-submit-btn"
        >
          {isSubmitting ? (
            <>
              <span className={styles.submitSpinner} aria-hidden="true" />
              Submitting…
            </>
          ) : (
            "Submit Recall"
          )}
        </button>
      </footer>
    </div>
  );
}

export default RecallModalStep2Reroute;
