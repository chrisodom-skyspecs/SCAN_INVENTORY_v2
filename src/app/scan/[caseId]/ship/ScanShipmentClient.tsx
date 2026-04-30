/**
 * ScanShipmentClient — SCAN app shipment screen client component
 *
 * Sub-AC 3c: Integrates the FedEx tracking Convex query into the SCAN
 * shipment screens so tracking status is conditionally displayed when a
 * tracking number exists on the case.
 *
 * Conditional rendering contract:
 *   hasTracking === false  →  <TrackingEntryForm>   (enter FedEx # )
 *   hasTracking === true   →  <TrackingStatusSection> (live + persisted status)
 *
 * Data flow:
 *   1. `useFedExTracking(caseId)` subscribes to `api.shipping.listShipmentsByCase`
 *      — a real-time Convex query that updates within ~100–300 ms of any
 *      `shipCase` mutation (from this screen or another device).
 *   2. `hasTracking` is derived in the hook: true when `latestShipment.trackingNumber`
 *      is non-empty.
 *   3. When tracking exists, `refreshTracking()` triggers `api.shipping.trackShipment`
 *      (FedEx Track API) and overlays live events on the persisted record.
 *   4. When no tracking exists, the form calls `api.shipping.shipCase` via the
 *      `useShipCase` hook, which writes denormalized tracking fields to both the
 *      cases table (invalidating M1/M4 map subscriptions, T3 layout) and the
 *      shipments table (invalidating `listShipmentsByCase`), causing `hasTracking`
 *      to flip to `true` — the UI transitions without a page reload.
 *
 * Mobile UX notes:
 *   • All touch targets ≥ 44px (WCAG 2.5.5)
 *   • Form input type="text" with inputMode="numeric" for FedEx tracking numbers
 *   • Safe area insets applied in the parent layout
 *   • Reduced motion respected by CSS keyframe guards in the CSS module
 */

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  useFedExTracking,
  type ShipmentRecord,
  type LiveTrackingResult,
} from "../../../../hooks/use-fedex-tracking";
import { useScanCaseDetail } from "../../../../hooks/use-scan-queries";
import { useShipCase } from "../../../../hooks/use-scan-mutations";
import { useKindeUser } from "../../../../hooks/use-kinde-user";
import { useServerStateReconciliation } from "../../../../hooks/use-server-state-reconciliation";
import { StatusPill } from "../../../../components/StatusPill";
import { ReconciliationBanner } from "../../../../components/ReconciliationBanner";
import { FieldError } from "../../../../components/FieldError";
import {
  required,
  fedexTrackingNumber,
  composeValidators,
  maxLength,
  parseConvexFieldError,
  extractConvexErrorCode,
  shouldShowError,
} from "../../../../lib/form-validation";
import { trackEvent } from "../../../../lib/telemetry.lib";
import { TelemetryEventName } from "../../../../types/telemetry.types";
import styles from "./page.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ScanShipmentClientProps {
  caseId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

function formatEventTimestamp(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function formatLocation(location: {
  city?: string;
  state?: string;
  country?: string;
}): string {
  return [location.city, location.state, location.country]
    .filter(Boolean)
    .join(", ");
}

// ─── Sub-component: Loading skeleton ─────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className={styles.loadingShell} aria-busy="true" aria-label="Loading shipment data">
      <div className={styles.skeletonHeader} />
      <div className={styles.skeletonBody} />
      <div className={styles.skeletonBody} style={{ width: "72%" }} />
      <div className={styles.skeletonBody} style={{ width: "56%" }} />
    </div>
  );
}

// ─── Sub-component: Case not found ───────────────────────────────────────────

function CaseNotFound({ caseId }: { caseId: string }) {
  return (
    <div className={styles.errorState} role="alert">
      <svg
        className={styles.errorIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p className={styles.errorTitle}>Case not found</p>
      <p className={styles.errorText}>
        No case found for ID <code className={styles.errorCode}>{caseId}</code>.
        Scan the QR code again or contact support.
      </p>
    </div>
  );
}

// ─── Sub-component: Tracking entry form ──────────────────────────────────────
// Displayed when hasTracking === false (no FedEx tracking number on record).

interface TrackingEntryFormProps {
  caseId: string;
  caseLabel: string;
  /** Current lifecycle status of the case (e.g. "hangar", "assembled"). */
  caseStatus: string;
  /**
   * Current QC sign-off status from cases.qcSignOffStatus.
   * Undefined means "not yet submitted".
   * "approved" → QC cleared for dispatch.
   * "pending" / "rejected" / undefined → blocked for outbound dispatch.
   */
  qcSignOffStatus: "pending" | "approved" | "rejected" | undefined;
  onSuccess: () => void;
}

// ─── Validators for the tracking entry form ───────────────────────────────────

const validateTrackingNumber = composeValidators(
  required("FedEx tracking number is required."),
  fedexTrackingNumber()
);

const validateDestinationName = maxLength(
  120,
  "Destination name must be 120 characters or fewer."
);

const validateNotes = maxLength(
  500,
  "Notes must be 500 characters or fewer."
);

// ─── Statuses from which shipping is outbound (toward field site) ────────────
// These mirror the OUTBOUND_SHIPPABLE_STATUSES constant in convex/mutations/ship.ts.
// Used for proactive QC gate: if the case is in one of these statuses and the
// QC sign-off is not "approved", show the gate banner before the technician
// even attempts to submit the form.
const OUTBOUND_SHIPPABLE_STATUSES = new Set(["hangar", "assembled", "received"]);

function TrackingEntryForm({
  caseId,
  caseLabel,
  caseStatus,
  qcSignOffStatus,
  onSuccess,
}: TrackingEntryFormProps) {
  // useShipCase wraps api.shipping.shipCase — the authoritative ship mutation.
  //
  // Why shipCase instead of createShipment:
  //   shipCase writes denormalized tracking fields to the cases table in addition
  //   to inserting the shipments row, so ALL subscribed dashboard queries
  //   re-evaluate within ~100–300 ms:
  //
  //     cases.status          → M1/M4 status-filter subscriptions re-evaluate
  //     cases.trackingNumber  → getCaseShippingLayout (T3 panel) re-evaluates
  //     cases.carrier         → T3 carrier chip re-evaluates
  //     cases.shippedAt       → T3 "Shipped N ago" timestamp re-evaluates
  //     cases.destinationName → T3 destination chip re-evaluates
  //     cases.destinationLat  → M4 logistics map destination pin re-evaluates
  //     cases.destinationLng  → (same)
  //     cases.updatedAt       → M1 by_updated sort index re-evaluates
  //     shipments (new row)   → listShipmentsByCase re-evaluates
  //                             useFedExTracking.hasTracking flips to true
  //     events (2 rows)       → T5 audit timeline re-evaluates
  //
  //   createShipment only writes to shipments + transitions case status, missing
  //   the denormalized fields that M4/M3 map subscriptions and the T3 layout
  //   depend on.  shipCase satisfies the ≤ 2-second real-time fidelity requirement
  //   for ALL dashboard query families simultaneously.
  const shipCase = useShipCase();
  const { id: userId, name: userName } = useKindeUser();

  // ── Sub-AC 2c: Server-state reconciliation ───────────────────────────────
  // The optimistic update in useShipCase() predicts the new case status
  // (transit_out for outbound-eligible statuses; transit_in otherwise).
  // If another user concurrently changed the case status, the server may
  // have derived a different transit direction.  Divergence is surfaced here.
  const reconciliation = useServerStateReconciliation();

  const [trackingNumber, setTrackingNumber] = useState("");
  const [originName, setOriginName] = useState("");
  const [destinationName, setDestinationName] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Sub-AC 3: QC dispatch gate state ──────────────────────────────────────
  // Set to true when the server returns [QC_APPROVAL_REQUIRED], signalling
  // that an operator/admin must approve the case in INVENTORY before dispatch.
  // The flag persists until the user explicitly dismisses it or successfully
  // retries (in case QC approval arrives in the background).
  const [qcGateBlocked, setQcGateBlocked] = useState(false);

  // Proactive QC gate: derive from props whether this case is blocked for
  // outbound dispatch before the form is even submitted.  This surfaces the
  // error immediately when the technician opens the ship screen, avoiding a
  // wasted network round-trip.
  //   isOutbound — true when the current case status would produce "transit_out"
  //   isQcBlocked — true when isOutbound AND QC is not approved
  const isOutbound = OUTBOUND_SHIPPABLE_STATUSES.has(caseStatus);
  const isQcBlockedProactive = isOutbound && qcSignOffStatus !== "approved";

  // ── Sub-AC 2: Inline validation state ────────────────────────────────────
  // touchedFields: tracks which fields the user has focused+blurred at least
  // once.  Errors are hidden until a field is touched OR submit is attempted.
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // fieldErrors: per-field error messages surfaced from Convex mutation errors
  // or client-side validation.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // ── Derived: client-side validation errors ────────────────────────────────
  const trackingNumberError =
    validateTrackingNumber(trackingNumber) ?? fieldErrors.trackingNumber ?? null;
  const destinationNameError =
    validateDestinationName(destinationName) ?? fieldErrors.destinationName ?? null;
  const notesError =
    validateNotes(notes) ?? fieldErrors.notes ?? null;

  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus tracking number input on mount (mobile keyboard shows immediately)
  useEffect(() => {
    // Small delay to avoid iOS keyboard fighting layout shift
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  // ── Blur handler — marks field as touched ─────────────────────────────────
  const handleFieldBlur = useCallback((fieldName: string) => {
    setTouchedFields((prev) => {
      const next = new Set(prev);
      next.add(fieldName);
      return next;
    });
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      // ── Sub-AC 2: Client-side validation before sending to Convex ──────────
      // Mark submit as attempted so all field errors become visible.
      setSubmitAttempted(true);

      const tn = trackingNumber.trim();

      // Run validators on all required fields
      const tnError = validateTrackingNumber(tn);
      const destError = validateDestinationName(destinationName);
      const notesErr = validateNotes(notes);

      if (tnError || destError || notesErr) {
        // Surface validation errors inline; abort mutation
        setFieldErrors({
          ...(tnError ? { trackingNumber: tnError } : {}),
          ...(destError ? { destinationName: destError } : {}),
          ...(notesErr ? { notes: notesErr } : {}),
        });
        // Focus the first invalid field
        if (tnError) inputRef.current?.focus();
        return;
      }

      // Clear stale field-level errors on a clean submit
      setFieldErrors({});

      setIsSubmitting(true);
      setSubmitError(null);

      // ── Sub-AC 2c: Track optimistic prediction before mutation ──────────────
      // The optimistic update in useShipCase() predicts one of:
      //   "transit_out" — if the case was in hangar/assembled/received
      //   "transit_in"  — if the case was in any other status
      //
      // We record the carrier as "FedEx" (always for this form) and the
      // tracking number so we can detect if the server normalised either.
      const mutationId = `ship-${tn}-${Date.now()}`;
      reconciliation.trackMutation(mutationId, {
        trackingNumber: tn,
        carrier:        "FedEx",
      });

      try {
        // shipCase writes through Convex to both the cases table (denormalized
        // tracking fields) and the shipments table (full record), then appends
        // status_change and shipped events to the immutable audit timeline.
        //
        // Convex automatically invalidates all reactive subscriptions that read
        // either table — including:
        //   • useFedExTracking → listShipmentsByCase (shipments table read)
        //     hasTracking flips to true, UI transitions to TrackingStatusSection
        //   • useQuery(api.cases.getCaseById) on this screen (cases table read)
        //     status pill updates to "shipping" within ~100–300 ms
        //   • INVENTORY dashboard subscriptions (cases + shipments table reads):
        //     M1 fleet overview, M4 logistics map, T3/T4 case detail panels
        //
        const result = await shipCase({
          caseId:         caseId as Id<"cases">,
          trackingNumber: tn,
          userId,
          userName,
          carrier: "FedEx",
          originName: originName.trim() || undefined,
          destinationName: destinationName.trim() || undefined,
          notes: notes.trim() || undefined,
        });

        // ── Sub-AC 2c: Confirm against server result ────────────────────────
        // result.trackingNumber is the normalised tracking number the server
        // stored; result.carrier is what the server persisted.
        reconciliation.confirmMutation(mutationId, {
          trackingNumber: result.trackingNumber,
          carrier:        result.carrier,
        });

        // ── Telemetry: FedEx label generation / shipment recorded (spec §23) ──
        // Emit a structured event capturing caseId, trackingNumber, timestamp
        // (auto-filled by the telemetry client), and the initiating user.
        // This fires only on mutation success — failures are handled in the catch
        // block and must NOT emit a success event.
        trackEvent({
          eventCategory: "user_action",
          eventName: TelemetryEventName.SCAN_ACTION_SHIPMENT_SUBMITTED,
          app: "scan",
          caseId,
          success: true,
          carrier: "FedEx",
          trackingNumber: tn,
          initiatingUserId: userId,
        });

        // The Convex reactive subscription (`listShipmentsByCase`) will update
        // `hasTracking` to true automatically — `onSuccess` signals parent to
        // show the confirmation briefly before Convex flips the UI.
        onSuccess();
      } catch (err) {
        // ── Sub-AC 2c: Cancel pending record — Convex rolled back ──────────
        reconciliation.cancelMutation(mutationId);

        // ── Sub-AC 3: QC dispatch gate error ────────────────────────────────
        // Detect the [QC_APPROVAL_REQUIRED] error code before falling through
        // to the generic error handling path.  When detected, activate the
        // dedicated QC gate banner — a mobile-optimized, prominent message that
        // makes it unambiguous to the technician that QC approval is required
        // and prevents them from retrying the dispatch until it is resolved.
        const errorCode = extractConvexErrorCode(err);
        if (errorCode === "QC_APPROVAL_REQUIRED") {
          setQcGateBlocked(true);
          setSubmitError(null);
          setFieldErrors({});
          // Scroll to top of form so the banner is immediately visible
          inputRef.current?.closest("form")?.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }

        // ── Sub-AC 2: Surface Convex errors at field level ──────────────────
        // Parse the Convex error to determine whether it maps to a specific
        // form field (e.g. "[FIELD:trackingNumber] Invalid format") or is a
        // form-level error (e.g. "[RATE_LIMITED] Try again later").
        const parsed = parseConvexFieldError(err);
        const knownFields = ["trackingNumber", "originName", "destinationName", "notes"];

        // Clear any previous QC gate error when a new non-QC error arrives
        setQcGateBlocked(false);

        if (parsed.fieldName && knownFields.includes(parsed.fieldName)) {
          // Field-specific error — show inline below the field
          setFieldErrors({ [parsed.fieldName]: parsed.message });
          setSubmitError(null);
        } else {
          // Form-level error — show in banner
          setFieldErrors({});
          setSubmitError(
            parsed.message ||
            "Failed to record shipment. Check the tracking number and try again."
          );
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [caseId, shipCase, trackingNumber, originName, destinationName, notes, onSuccess, userId, userName, reconciliation]
  );

  // ── Determine if the submit button should be disabled ───────────────────────
  // Block submission when:
  //   a) The form is currently submitting (prevents double-submit)
  //   b) No tracking number has been entered (primary required field)
  //   c) QC approval is proactively blocked OR the server returned a QC gate error
  //      The submit button re-enables once the QC issue is resolved and the
  //      technician dismisses the banner (sets qcGateBlocked = false) — at that
  //      point the Convex subscription will have updated qcSignOffStatus as well.
  const isSubmitDisabled = isSubmitting || !trackingNumber.trim() || isQcBlockedProactive || qcGateBlocked;

  return (
    <div className={styles.section} data-testid="tracking-entry-form">
      {/* Section header */}
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Ship This Case</h2>
      </div>

      {/* ── Sub-AC 3: Proactive QC gate banner ─────────────────────────────
          Shown immediately when the case is in an outbound-shippable status
          but has not received QC approval.  This saves the technician a wasted
          network round-trip before reaching the server gate.  The banner is
          also shown after the server returns [QC_APPROVAL_REQUIRED].        */}
      {(isQcBlockedProactive || qcGateBlocked) && (
        <div
          className={styles.qcGateBanner}
          role="alert"
          aria-live="assertive"
          data-testid="qc-gate-banner"
        >
          {/* Warning icon */}
          <svg
            className={styles.qcGateIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className={styles.qcGateBody}>
            <p className={styles.qcGateTitle}>QC Approval Required</p>
            <p className={styles.qcGateMessage}>
              This case must be approved by an operator or admin via{" "}
              <strong>INVENTORY</strong> before it can be dispatched.
              {qcSignOffStatus === "rejected" && (
                <> The previous QC review was <strong>rejected</strong> — a new approval is needed.</>
              )}
              {(!qcSignOffStatus || qcSignOffStatus === "pending") && qcGateBlocked && (
                <> QC sign-off has not been submitted or is still pending.</>
              )}
            </p>
            <p className={styles.qcGateAction}>
              Contact your operations team to approve this case, then return here to complete dispatch.
            </p>
            {/* Dismiss button — only shown after a server-side gate error.
                Proactive gate auto-dismisses when qcSignOffStatus becomes "approved"
                via Convex real-time subscription. */}
            {qcGateBlocked && !isQcBlockedProactive && (
              <button
                type="button"
                className={styles.qcGateDismiss}
                onClick={() => setQcGateBlocked(false)}
                aria-label="Dismiss QC gate error"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      <p className={styles.formLead}>
        Enter the FedEx tracking number for{" "}
        <strong className={styles.caseRef}>{caseLabel}</strong>.
        Tracking status will appear here once recorded.
      </p>

      <form onSubmit={handleSubmit} noValidate className={styles.form}>
        {/* FedEx tracking number — primary field */}
        <div className={styles.fieldGroup}>
          <label htmlFor="trackingNumber" className={styles.fieldLabel}>
            FedEx Tracking Number
            <span className={styles.fieldRequired} aria-hidden="true"> *</span>
          </label>
          <input
            ref={inputRef}
            id="trackingNumber"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className={[
              styles.fieldInput,
              shouldShowError("trackingNumber", touchedFields, submitAttempted) && trackingNumberError
                ? styles.fieldInputInvalid
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            placeholder="e.g. 794644823741"
            value={trackingNumber}
            onChange={(e) => {
              setTrackingNumber(e.target.value);
              // Clear field-level Convex error when user edits
              if (fieldErrors.trackingNumber) {
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  delete next.trackingNumber;
                  return next;
                });
              }
            }}
            onBlur={() => handleFieldBlur("trackingNumber")}
            disabled={isSubmitting}
            required
            aria-required="true"
            aria-invalid={
              shouldShowError("trackingNumber", touchedFields, submitAttempted) && !!trackingNumberError
                ? true
                : undefined
            }
            aria-describedby={
              shouldShowError("trackingNumber", touchedFields, submitAttempted) && trackingNumberError
                ? "trackingNumber-error"
                : "tracking-number-hint"
            }
          />
          {/* Inline field error — shown after blur or submit attempt */}
          {shouldShowError("trackingNumber", touchedFields, submitAttempted) && trackingNumberError ? (
            <FieldError id="trackingNumber-error" error={trackingNumberError} />
          ) : (
            <span id="tracking-number-hint" className={styles.fieldHint}>
              Enter the 12– or 22-digit FedEx tracking number from the shipping label.
            </span>
          )}
        </div>

        {/* Optional route info — collapsible on mobile */}
        <details className={styles.optionalDetails}>
          <summary className={styles.optionalSummary}>
            Optional: Origin &amp; Destination
          </summary>
          <div className={styles.optionalBody}>
            <div className={styles.fieldGroup}>
              <label htmlFor="originName" className={styles.fieldLabel}>
                Origin Location
              </label>
              <input
                id="originName"
                type="text"
                className={styles.fieldInput}
                placeholder="e.g. Site Alpha"
                value={originName}
                onChange={(e) => setOriginName(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="destinationName" className={styles.fieldLabel}>
                Destination
              </label>
              <input
                id="destinationName"
                type="text"
                className={[
                  styles.fieldInput,
                  shouldShowError("destinationName", touchedFields, submitAttempted) && destinationNameError
                    ? styles.fieldInputInvalid
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                placeholder="e.g. SkySpecs HQ"
                value={destinationName}
                onChange={(e) => {
                  setDestinationName(e.target.value);
                  if (fieldErrors.destinationName) {
                    setFieldErrors((prev) => { const n = { ...prev }; delete n.destinationName; return n; });
                  }
                }}
                onBlur={() => handleFieldBlur("destinationName")}
                disabled={isSubmitting}
                aria-invalid={
                  shouldShowError("destinationName", touchedFields, submitAttempted) && !!destinationNameError
                    ? true
                    : undefined
                }
                aria-describedby={
                  shouldShowError("destinationName", touchedFields, submitAttempted) && destinationNameError
                    ? "destinationName-error"
                    : undefined
                }
              />
              {shouldShowError("destinationName", touchedFields, submitAttempted) && destinationNameError && (
                <FieldError id="destinationName-error" error={destinationNameError} />
              )}
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="shipmentNotes" className={styles.fieldLabel}>
                Notes
              </label>
              <textarea
                id="shipmentNotes"
                className={[
                  styles.fieldTextarea,
                  shouldShowError("notes", touchedFields, submitAttempted) && notesError
                    ? styles.fieldInputInvalid
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                placeholder="Any notes for the operations team"
                rows={2}
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  if (fieldErrors.notes) {
                    setFieldErrors((prev) => { const n = { ...prev }; delete n.notes; return n; });
                  }
                }}
                onBlur={() => handleFieldBlur("notes")}
                disabled={isSubmitting}
                aria-invalid={
                  shouldShowError("notes", touchedFields, submitAttempted) && !!notesError
                    ? true
                    : undefined
                }
                aria-describedby={
                  shouldShowError("notes", touchedFields, submitAttempted) && notesError
                    ? "shipmentNotes-error"
                    : undefined
                }
                maxLength={505}
              />
              {shouldShowError("notes", touchedFields, submitAttempted) && notesError && (
                <FieldError id="shipmentNotes-error" error={notesError} />
              )}
            </div>
          </div>
        </details>

        {/* Error banner */}
        {submitError && (
          <div
            id="tracking-form-error"
            className={styles.errorBanner}
            role="alert"
            aria-live="assertive"
          >
            <svg
              className={styles.bannerIcon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{submitError}</span>
          </div>
        )}

        {/* ── Reconciliation banners (Sub-AC 2c) ──────────────────────── */}
        {reconciliation.isStale && !reconciliation.hasDivergence && (
          <ReconciliationBanner
            stale
            staleSince={reconciliation.staleSince}
            onDismiss={reconciliation.dismiss}
          />
        )}
        {reconciliation.hasDivergence && (
          <ReconciliationBanner
            divergedFields={reconciliation.divergedFields}
            onDismiss={reconciliation.dismiss}
          />
        )}

        {/* Submit */}
        <button
          type="submit"
          className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
          disabled={isSubmitDisabled}
          aria-busy={isSubmitting}
          aria-describedby={
            (isQcBlockedProactive || qcGateBlocked)
              ? "qc-gate-banner"
              : undefined
          }
        >
          {isSubmitting ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              Recording shipment…
            </>
          ) : (
            "Record Shipment"
          )}
        </button>
      </form>
    </div>
  );
}

// ─── Sub-component: Tracking events timeline ─────────────────────────────────

interface EventsTimelineProps {
  events: LiveTrackingResult["events"];
  isLive: boolean;
}

function EventsTimeline({ events, isLive }: EventsTimelineProps) {
  if (events.length === 0) return null;

  return (
    <div className={styles.eventsSection}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>Tracking Events</h3>
        {isLive && (
          <span className={styles.liveBadge} aria-label="Live data from FedEx">
            Live
          </span>
        )}
      </div>

      <ol className={styles.eventTimeline} aria-label="Shipment scan events">
        {events.map((event, idx) => (
          <li
            key={`${event.timestamp}-${idx}`}
            className={styles.eventItem}
          >
            <div className={styles.eventDot} aria-hidden="true" />
            <div className={styles.eventBody}>
              <div className={styles.eventHeader}>
                <span className={styles.eventDescription}>
                  {event.description}
                </span>
                <span className={styles.eventTime}>
                  {formatEventTimestamp(event.timestamp)}
                </span>
              </div>
              {(event.location.city ||
                event.location.state ||
                event.location.country) && (
                <span className={styles.eventLocation}>
                  {formatLocation(event.location)}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ─── Sub-component: Tracking status section ──────────────────────────────────
// Displayed when hasTracking === true.

interface TrackingStatusSectionProps {
  caseId: string;
  shipment: ShipmentRecord;
  allShipments: ShipmentRecord[];
}

function TrackingStatusSection({
  caseId,
  shipment,
  allShipments,
}: TrackingStatusSectionProps) {
  const {
    liveTracking,
    isRefreshing,
    refreshError,
    refreshTracking,
    isActiveShipment,
  } = useFedExTracking(caseId);

  // Overlay live data on top of the persisted record
  const effectiveStatus = liveTracking?.status ?? shipment.status;
  const effectiveEta =
    liveTracking?.estimatedDelivery ?? shipment.estimatedDelivery;
  const effectiveEvents = liveTracking?.events ?? [];
  const liveDescription = liveTracking?.description;

  // Validate status — fall back to "in_transit" if unexpected value
  const validStatusKinds = [
    "label_created",
    "picked_up",
    "in_transit",
    "out_for_delivery",
    "delivered",
    "exception",
  ] as const;
  type ValidStatusKind = (typeof validStatusKinds)[number];
  const safeStatus: ValidStatusKind = validStatusKinds.includes(
    effectiveStatus as ValidStatusKind
  )
    ? (effectiveStatus as ValidStatusKind)
    : "in_transit";

  return (
    <div className={styles.trackingSection} data-testid="tracking-status-section">
      {/* ── Status card ────────────────────────────────────────────── */}
      <div className={styles.statusCard}>
        <div className={styles.statusCardHeader}>
          <div className={styles.statusCardLeft}>
            <span className={styles.carrierLabel}>{shipment.carrier}</span>
            <StatusPill kind={safeStatus} filled />
          </div>

          {/* Refresh button — only for active (non-delivered) shipments */}
          {isActiveShipment && (
            <button
              className={[
                styles.ctaButton,
                styles.ctaButtonSecondary,
                styles.refreshBtn,
              ].join(" ")}
              onClick={refreshTracking}
              disabled={isRefreshing}
              aria-label={
                isRefreshing
                  ? "Refreshing FedEx tracking data…"
                  : "Refresh FedEx tracking data"
              }
              aria-busy={isRefreshing}
            >
              {isRefreshing ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" />
                  Refreshing…
                </>
              ) : (
                <>
                  {/* Refresh icon */}
                  <svg
                    className={styles.btnIcon}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  Refresh
                </>
              )}
            </button>
          )}
        </div>

        {/* Live status description (e.g. "Package in transit") */}
        {liveDescription && (
          <p className={styles.statusDescription}>{liveDescription}</p>
        )}

        {/* Refresh error */}
        {refreshError && (
          <div className={styles.errorBanner} role="alert" aria-live="polite">
            <svg
              className={styles.bannerIcon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{refreshError}</span>
          </div>
        )}
      </div>

      {/* ── Tracking details grid ───────────────────────────────────── */}
      <dl className={styles.detailsGrid}>
        <div className={styles.detailItem}>
          <dt className={styles.detailLabel}>Tracking Number</dt>
          <dd className={[styles.detailValue, styles.detailValueMono].join(" ")}>
            {shipment.trackingNumber}
          </dd>
        </div>

        {effectiveEta && (
          <div className={styles.detailItem}>
            <dt className={styles.detailLabel}>Est. Delivery</dt>
            <dd className={styles.detailValue}>
              {formatShortDate(effectiveEta)}
            </dd>
          </div>
        )}

        {shipment.originName && (
          <div className={styles.detailItem}>
            <dt className={styles.detailLabel}>Origin</dt>
            <dd className={styles.detailValue}>{shipment.originName}</dd>
          </div>
        )}

        {shipment.destinationName && (
          <div className={styles.detailItem}>
            <dt className={styles.detailLabel}>Destination</dt>
            <dd className={styles.detailValue}>{shipment.destinationName}</dd>
          </div>
        )}

        {shipment.shippedAt && (
          <div className={styles.detailItem}>
            <dt className={styles.detailLabel}>Shipped</dt>
            <dd className={[styles.detailValue, styles.timestamp].join(" ")}>
              {formatDate(shipment.shippedAt)}
            </dd>
          </div>
        )}

        {shipment.deliveredAt && (
          <div className={styles.detailItem}>
            <dt className={styles.detailLabel}>Delivered</dt>
            <dd className={[styles.detailValue, styles.timestamp].join(" ")}>
              {formatDate(shipment.deliveredAt)}
            </dd>
          </div>
        )}
      </dl>

      {/* ── Live tracking events ────────────────────────────────────── */}
      {effectiveEvents.length > 0 && (
        <EventsTimeline
          events={effectiveEvents}
          isLive={liveTracking !== null}
        />
      )}

      {/* ── Prompt to refresh if no live events yet ────────────────── */}
      {effectiveEvents.length === 0 && isActiveShipment && !isRefreshing && (
        <div className={styles.noEventsHint} aria-live="polite">
          <p className={styles.noEventsText}>
            No scan events yet.{" "}
            <button
              className={styles.inlineLink}
              onClick={refreshTracking}
              type="button"
            >
              Refresh
            </button>{" "}
            to fetch the latest from FedEx.
          </p>
        </div>
      )}

      {/* ── Shipment history (if multiple shipments) ────────────────── */}
      {allShipments.length > 1 && (
        <ShipmentHistory shipments={allShipments} activeId={shipment._id} />
      )}
    </div>
  );
}

// ─── Sub-component: Shipment history ─────────────────────────────────────────

interface ShipmentHistoryProps {
  shipments: ShipmentRecord[];
  activeId: string;
}

function ShipmentHistory({ shipments, activeId }: ShipmentHistoryProps) {
  const validStatusKinds = [
    "label_created",
    "picked_up",
    "in_transit",
    "out_for_delivery",
    "delivered",
    "exception",
  ] as const;
  type ValidStatusKind = (typeof validStatusKinds)[number];

  return (
    <section className={styles.historySection} aria-label="Shipment history">
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>All Shipments</h3>
        <span className={styles.timestamp}>{shipments.length} total</span>
      </div>

      <ul className={styles.historyList} aria-label="Previous shipments">
        {shipments.map((s) => {
          const isActive = s._id === activeId;
          const safeStatus: ValidStatusKind = validStatusKinds.includes(
            s.status as ValidStatusKind
          )
            ? (s.status as ValidStatusKind)
            : "in_transit";

          return (
            <li
              key={s._id}
              className={[
                styles.historyItem,
                isActive ? styles.historyItemActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={isActive ? "true" : undefined}
            >
              <div className={styles.historyItemHeader}>
                <span className={styles.historyTrackingNum}>
                  {s.trackingNumber}
                </span>
                <StatusPill kind={safeStatus} />
              </div>
              <span className={styles.timestamp}>
                {s.shippedAt
                  ? formatDate(s.shippedAt)
                  : formatDate(s.createdAt)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── Main exported component ──────────────────────────────────────────────────

/**
 * ScanShipmentClient
 *
 * The heart of Sub-AC 3c.  Integrates `useFedExTracking` to conditionally
 * render the tracking status section when a FedEx tracking number exists.
 *
 * State machine:
 *   Loading (shipments === undefined || caseDoc === undefined)
 *     → show skeleton
 *   Case not found (caseDoc === null)
 *     → show error state
 *   No tracking (hasTracking === false)
 *     → show <TrackingEntryForm> to enter a tracking number
 *   Tracking exists (hasTracking === true)
 *     → show <TrackingStatusSection> with live + persisted FedEx data
 */
export function ScanShipmentClient({ caseId }: ScanShipmentClientProps) {
  // ── Case document ─────────────────────────────────────────────────────────
  // useScanCaseDetail delegates to useCaseById via the SCAN query layer.
  // The subscription re-evaluates within ~100–300 ms whenever the case row
  // changes (e.g., after shipCase flips status to transit_out/transit_in).
  const caseDoc = useScanCaseDetail(caseId);

  // ── FedEx tracking hook ───────────────────────────────────────────────────
  // `hasTracking` — true when at least one shipment with a non-empty
  //   trackingNumber exists for this case.
  // `latestShipment` — the most recent persisted shipment record.
  // `shipments` — all shipment records (for the history section).
  const { hasTracking, latestShipment, shipments } = useFedExTracking(caseId);

  // ── Local UI state ────────────────────────────────────────────────────────
  // Brief "success" flash after recording a new shipment (before Convex
  // subscription flips hasTracking to true).
  const [showSuccessFlash, setShowSuccessFlash] = useState(false);

  const handleShipmentCreated = useCallback(() => {
    setShowSuccessFlash(true);
    // Auto-dismiss after 3 s — by then Convex has updated hasTracking
    const t = setTimeout(() => setShowSuccessFlash(false), 3000);
    return () => clearTimeout(t);
  }, []);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (caseDoc === undefined || shipments === undefined) {
    return (
      <div className={styles.page}>
        <LoadingSkeleton />
      </div>
    );
  }

  // ── Case not found ────────────────────────────────────────────────────────
  if (caseDoc === null) {
    return (
      <div className={styles.page}>
        <CaseNotFound caseId={caseId} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.caseRow}>
          <h1 className={styles.caseLabel}>{caseDoc.label}</h1>
          <StatusPill
            kind={
              caseDoc.status as Parameters<typeof StatusPill>[0]["kind"]
            }
          />
        </div>
        {caseDoc.locationName && (
          <p className={styles.caseLocation}>
            <svg
              className={styles.locationIcon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {caseDoc.locationName}
          </p>
        )}
      </div>

      <div className={styles.divider} aria-hidden="true" />

      {/* ── Success flash banner ──────────────────────────────────────────
          Briefly shown after createShipment succeeds, before the Convex
          reactive subscription flips `hasTracking` to true. */}
      {showSuccessFlash && (
        <div
          className={styles.successBanner}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <svg
            className={styles.bannerIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Shipment recorded — loading tracking status…
        </div>
      )}

      {/*
        ── Conditional tracking display — the core of Sub-AC 3c ─────────

        `hasTracking` is derived from `listShipmentsByCase` Convex query:
          true  → at least one shipment with a non-empty trackingNumber
          false → no shipments or all shipments have empty trackingNumbers

        The Convex real-time subscription ensures this section transitions
        within ~100–300 ms of any `createShipment` mutation call, whether
        from this device or another.
      */}
      {!hasTracking || !latestShipment ? (
        /* No tracking number on file → show entry form */
        <TrackingEntryForm
          caseId={caseId}
          caseLabel={caseDoc.label}
          caseStatus={caseDoc.status}
          qcSignOffStatus={
            caseDoc.qcSignOffStatus as "pending" | "approved" | "rejected" | undefined
          }
          onSuccess={handleShipmentCreated}
        />
      ) : (
        /* Tracking number exists → show live + persisted status */
        <TrackingStatusSection
          caseId={caseId}
          shipment={latestShipment}
          allShipments={shipments}
        />
      )}
    </div>
  );
}
