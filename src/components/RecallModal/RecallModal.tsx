/**
 * RecallModal — multi-step modal for initiating a case recall.
 *
 * A recall is the process of removing a deployed case from active field
 * operations and returning it for inspection / repair.  This modal guides
 * operations staff through a confirmation flow before the recall is committed.
 *
 * Steps:
 *   Step 1 — Confirm       : Case summary + "Confirm Recall" CTA  ← built here
 *   Step 2 — Reason / Notes: (future Sub-AC — placeholder rendered for now)
 *
 * Modal shell features:
 *   - Native <dialog> element (top-layer, Escape to close, ::backdrop scrim)
 *   - ReactDOM.createPortal — immune to ancestor overflow/z-index
 *   - Focus management: Confirm button focused on open (Step 1)
 *   - Escape key: cancels at any step
 *   - Backdrop click: closes the modal
 *   - Step resets to 1 on every open (isOpen: false → true transition)
 *
 * Design-system compliance:
 *   - No hex literals — CSS custom property tokens only
 *   - StatusPill for all status rendering
 *   - Inter Tight for UI labels / headings
 *   - IBM Plex Mono for case identifiers, timestamps
 *   - WCAG AA: keyboard navigation, focus ring, aria-labelledby/describedby
 *
 * Usage:
 * ```tsx
 *   const [open, setOpen] = React.useState(false);
 *
 *   <button onClick={() => setOpen(true)}>Recall</button>
 *
 *   <RecallModal
 *     isOpen={open}
 *     onClose={() => setOpen(false)}
 *     onConfirm={() => { // called when step 1 is confirmed
 *       // advance to step 2 or trigger mutation here
 *     }}
 *     caseId={selectedCaseId}
 *     caseData={{
 *       label: "CASE-001",
 *       status: "deployed",
 *       locationName: "Wind Farm Alpha — Turbine 7",
 *       assigneeName: "Jane Doe",
 *       templateName: "Inspection Kit v2",
 *       updatedAt: Date.now(),
 *     }}
 *   />
 * ```
 */

"use client";

import * as React from "react";
import * as ReactDOM from "react-dom";
import type { CaseStatus } from "../../../convex/cases";
import { RecallModalStep1Confirm } from "./RecallModalStep1Confirm";
import { RecallModalStep2Reroute } from "./RecallModalStep2Reroute";
import type { RecallRerouteData } from "./RecallModalStep2Reroute";
import styles from "./RecallModal.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Lightweight case summary passed into the Recall modal.
 * The parent component is expected to have already fetched the full case
 * document (e.g., via useQuery(api.cases.getCaseById)) before opening the
 * modal, so no internal Convex subscription is needed here.
 */
export interface RecallCaseSummary {
  /** Human-readable case identifier, e.g. "CASE-001". */
  label: string;
  /** Current lifecycle status — drives the StatusPill color. */
  status: CaseStatus;
  /** Last known location name (optional). */
  locationName?: string;
  /** Display name of the current custodian (optional). */
  assigneeName?: string;
  /** Packing list template name (optional). */
  templateName?: string;
  /** Epoch-ms timestamp of the last update — displayed in the summary. */
  updatedAt: number;
}

/** Modal step discriminant. */
export type RecallStep = 1 | 2;

export interface RecallModalProps {
  /** Controls whether the modal dialog is open. */
  isOpen: boolean;
  /** Called when the user cancels (close button, Cancel button, Escape, backdrop). */
  onClose: () => void;
  /**
   * Called when the user clicks "Confirm Recall" in Step 1.
   *
   * The modal internally advances to Step 2 after calling this callback.
   * Use this callback to trigger any pre-Step-2 side effects (e.g. analytics,
   * initiating an async lookup for reason options).
   */
  onConfirm: () => void;
  /**
   * Called when the user submits the reroute form in Step 2.
   * Receives the selected return method and optional notes.
   * Responsible for triggering the recall mutation.
   */
  onSubmit?: (data: RecallRerouteData) => void;
  /** Convex document ID of the case being recalled. */
  caseId: string;
  /** Pre-fetched case metadata rendered in Step 1's summary card. */
  caseData: RecallCaseSummary;
  /**
   * True while the Step 1 recall confirmation action is pending.
   * Disables the Confirm button and shows a loading indicator.
   * @default false
   */
  isConfirming?: boolean;
  /**
   * True while the Step 2 submit mutation is in flight.
   * Disables the Submit button and shows a loading indicator.
   * @default false
   */
  isSubmitting?: boolean;
  /** Current step override — use to control step from outside the modal. */
  step?: RecallStep;
  /** Called when the internal step changes (for controlled step management). */
  onStepChange?: (step: RecallStep) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * RecallModal — top-level modal shell for the case recall flow.
 *
 * Manages:
 *   - Native <dialog> lifecycle (showModal / close / cancel event)
 *   - Portal rendering into document.body
 *   - Step state (1 = Confirm, 2 = future placeholder)
 *   - Focus management on open
 *   - Backdrop click handling
 */
export function RecallModal({
  isOpen,
  onClose,
  onConfirm,
  onSubmit,
  caseId,
  caseData,
  isConfirming = false,
  isSubmitting = false,
  step: externalStep,
  onStepChange,
}: RecallModalProps) {
  // ── SSR guard ─────────────────────────────────────────────────────────────
  // Portal requires document.body — only available client-side after hydration.
  const [isMounted, setIsMounted] = React.useState(false);

  // ── Step state ────────────────────────────────────────────────────────────
  // When `step` prop is provided, use it (controlled mode).
  // Otherwise manage step internally (uncontrolled mode).
  const [internalStep, setInternalStep] = React.useState<RecallStep>(1);
  const activeStep = externalStep !== undefined ? externalStep : internalStep;

  // ── Refs ─────────────────────────────────────────────────────────────────
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  /** Forwarded to the Confirm button so we can auto-focus it on modal open. */
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);

  // ── Mount detection ───────────────────────────────────────────────────────
  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  // ── Reset step to 1 whenever the modal re-opens ───────────────────────────
  React.useEffect(() => {
    if (isOpen) {
      setInternalStep(1);
      onStepChange?.(1);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Open / close the native dialog ───────────────────────────────────────
  React.useEffect(() => {
    if (!isMounted) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
      // Focus the confirm button in step 1; step 2 manages its own focus.
      if (activeStep === 1) {
        requestAnimationFrame(() => {
          confirmButtonRef.current?.focus();
        });
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [isOpen, isMounted, activeStep]);

  // ── Native cancel event (Escape key) ─────────────────────────────────────
  // Intercept the browser "cancel" event (fired before auto-close) to keep
  // our controlled `isOpen` state in sync via `onClose`.
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault(); // prevent browser auto-close
      onClose();
    };

    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  // ── Backdrop click → close ────────────────────────────────────────────────
  // Click events on the <dialog> element itself (not any child) originate from
  // the ::backdrop.  Detect that by comparing e.target to the dialog element.
  const handleDialogClick = React.useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        onClose();
      }
    },
    [onClose]
  );

  // ── Step advancement ──────────────────────────────────────────────────────
  const handleConfirm = React.useCallback(() => {
    const nextStep: RecallStep = 2;
    setInternalStep(nextStep);
    onStepChange?.(nextStep);
    onConfirm();
  }, [onConfirm, onStepChange]);

  // ── Portal gate ───────────────────────────────────────────────────────────
  if (!isMounted) return null;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const modal = (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="recall-modal-title"
      aria-describedby="recall-modal-desc"
      onClick={handleDialogClick}
      data-testid="recall-modal"
      data-step={activeStep}
    >
      {/* ── Step indicator (screen-reader only) ─────────────────────────── */}
      <div className={styles.srOnly} aria-live="polite" role="status">
        Step {activeStep} of 2
      </div>

      {/* ── Step 1: Confirm ─────────────────────────────────────────────── */}
      {activeStep === 1 && (
        <RecallModalStep1Confirm
          caseId={caseId}
          caseData={caseData}
          onClose={onClose}
          onConfirm={handleConfirm}
          isConfirming={isConfirming}
          confirmButtonRef={confirmButtonRef}
        />
      )}

      {/* ── Step 2: Reroute ─────────────────────────────────────────────── */}
      {activeStep === 2 && (
        <RecallModalStep2Reroute
          caseId={caseId}
          caseData={caseData}
          onClose={onClose}
          onBack={() => {
            const prevStep: RecallStep = 1;
            setInternalStep(prevStep);
            onStepChange?.(prevStep);
          }}
          onSubmit={(data) => {
            onSubmit?.(data);
          }}
          isSubmitting={isSubmitting}
        />
      )}
    </dialog>
  );

  return ReactDOM.createPortal(modal, document.body);
}

export default RecallModal;
