/**
 * ScanCheckInClient — SCAN app QR scan check-in screen
 *
 * Sub-AC 36b-1: Wire QR scan check-in mutation to write through Convex and
 * invalidate case status/location subscriptions.
 *
 * Flow overview
 * ─────────────
 * The technician arrives here after scanning a case QR code or tapping
 * "Check In" on the case detail view.  The screen presents:
 *
 *   1. Case header  — label + current status pill
 *   2. Status grid  — selectable pills for valid transition targets
 *   3. Location row — optional GPS capture toggle
 *   4. Notes field  — optional free-text note
 *   5. Submit CTA   — calls scanCheckIn mutation
 *   6. Result view  — success (new status + "View Case" link) or error
 *
 * Convex mutation wiring
 * ──────────────────────
 * `useScanCheckIn()` from src/hooks/use-scan-mutations.ts wraps
 * `api.scan.scanCheckIn`.  On submit:
 *
 *   await checkIn({
 *     caseId, status, timestamp, technicianId, technicianName,
 *     lat?, lng?, locationName?, notes?,
 *   });
 *
 * The mutation writes `cases.status`, `cases.assigneeId`,
 * `cases.assigneeName`, `cases.updatedAt`, and optional position fields.
 * Convex automatically re-evaluates all subscribed queries that read the
 * `cases` row — getCaseStatus, getCaseById, listCases, getCasesInBounds,
 * getCaseStatusCounts — and pushes diffs to connected clients within
 * ~100–300 ms.  No manual refetch or cache busting required.
 *
 * If the transition is to "in_field", the mutation also inserts a new
 * `inspections` row (initial item counts), causing M3 (Field Mode) map
 * pins to update automatically.
 *
 * User identity
 * ─────────────
 * technicianId / technicianName are sourced from the Kinde auth context
 * when available (useKindeAuth).  This file uses a placeholder fallback
 * pending full Kinde integration — the auth shape is wired in the
 * getOrFallbackUser() helper below so it's a one-line swap.
 *
 * Design system compliance
 * ────────────────────────
 * All colors via CSS custom properties — no hex literals.
 * StatusPill for all status rendering.
 * IBM Plex Mono for case label and mono data values.
 * Inter Tight for all other text.
 * Touch targets ≥ 44 × 44 px (WCAG 2.5.5).
 * WCAG AA contrast in both light and dark themes.
 * prefers-reduced-motion respected in all transition/animation rules.
 */

"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useScanCheckIn } from "../../../../hooks/use-scan-mutations";
import { StatusPill } from "../../../../components/StatusPill";
import type { CaseStatus } from "../../../../../convex/cases";
import styles from "./page.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ScanCheckInClientProps {
  caseId: string;
}

// ─── Status transition map ────────────────────────────────────────────────────

/**
 * Valid outbound transitions per source status.
 * Mirrors VALID_TRANSITIONS in convex/scan.ts — kept in sync manually.
 * A no-op (same status) is rendered as "Re-check In" and allowed.
 */
const VALID_TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  assembled: ["deployed", "in_field", "shipping"],
  deployed:  ["in_field", "shipping", "returned", "assembled"],
  in_field:  ["deployed", "shipping", "returned"],
  shipping:  ["returned"],
  returned:  ["assembled", "deployed"],
};

/**
 * Human-readable labels for each status.
 */
const STATUS_LABELS: Record<CaseStatus, string> = {
  assembled: "Assembled",
  deployed:  "Deployed",
  in_field:  "In Field",
  shipping:  "Shipping",
  returned:  "Returned",
};

/**
 * Descriptive hint shown below the status label.
 */
const STATUS_HINTS: Record<CaseStatus, string> = {
  assembled: "Fully packed, ready to deploy",
  deployed:  "At site, awaiting field inspection",
  in_field:  "Actively in use — starts inspection",
  shipping:  "In transit via carrier",
  returned:  "Back at warehouse",
};

// ─── User identity helper ─────────────────────────────────────────────────────

/**
 * Returns the current user's ID and display name.
 *
 * Replace the body with Kinde auth hook calls when full auth integration
 * is wired:
 *
 *   import { useKindeAuth } from "@kinde-oss/kinde-auth-nextjs";
 *   const { user } = useKindeAuth();
 *   return {
 *     id:   user?.id   ?? "anon",
 *     name: user?.given_name
 *             ? `${user.given_name} ${user.family_name ?? ""}`.trim()
 *             : "Field Technician",
 *   };
 */
function useCurrentUser(): { id: string; name: string } {
  // Placeholder — replace with useKindeAuth() when wired
  return { id: "scan-user", name: "Field Technician" };
}

// ─── GPS capture hook ─────────────────────────────────────────────────────────

type GeoStatus = "idle" | "requesting" | "success" | "denied" | "unavailable";

interface GeoState {
  status: GeoStatus;
  lat?: number;
  lng?: number;
  /** Human-readable status message for display */
  label: string;
}

function useGeoCapture(enabled: boolean): {
  geo: GeoState;
  capture: () => void;
  clear: () => void;
} {
  const [geo, setGeo] = useState<GeoState>({ status: "idle", label: "Not captured" });
  const cancelledRef = useRef(false);

  const capture = useCallback(() => {
    if (!navigator.geolocation) {
      setGeo({ status: "unavailable", label: "GPS unavailable on this device" });
      return;
    }

    cancelledRef.current = false;
    setGeo({ status: "requesting", label: "Acquiring GPS…" });

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelledRef.current) return;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setGeo({
          status: "success",
          lat,
          lng,
          label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        });
      },
      (err) => {
        if (cancelledRef.current) return;
        const denied = err.code === GeolocationPositionError.PERMISSION_DENIED;
        setGeo({
          status: denied ? "denied" : "unavailable",
          label: denied
            ? "Location access denied — enable in browser settings"
            : "Could not determine location",
        });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
    );
  }, []);

  const clear = useCallback(() => {
    cancelledRef.current = true;
    setGeo({ status: "idle", label: "Not captured" });
  }, []);

  // Auto-capture when enabled and status is idle
  useEffect(() => {
    if (enabled && geo.status === "idle") {
      capture();
    }
  }, [enabled, geo.status, capture]);

  return { geo, capture, clear };
}

// ─── Phase types ──────────────────────────────────────────────────────────────

type Phase = "form" | "submitting" | "success" | "error";

// ─── Sub-component: Status option button ─────────────────────────────────────

interface StatusOptionProps {
  status: CaseStatus;
  isSelected: boolean;
  isCurrentStatus: boolean;
  onSelect: (status: CaseStatus) => void;
}

function StatusOption({
  status,
  isSelected,
  isCurrentStatus,
  onSelect,
}: StatusOptionProps) {
  return (
    <button
      type="button"
      className={[
        styles.statusOption,
        isSelected ? styles.statusOptionSelected : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onSelect(status)}
      aria-pressed={isSelected}
      aria-label={`Select status: ${STATUS_LABELS[status]}${isCurrentStatus ? " (current)" : ""}`}
      data-status={status}
    >
      <div className={styles.statusOptionHeader}>
        <StatusPill kind={status} />
        {isCurrentStatus && (
          <span className={styles.currentBadge} aria-label="Current status">
            current
          </span>
        )}
      </div>
      <p className={styles.statusOptionHint}>{STATUS_HINTS[status]}</p>
    </button>
  );
}

// ─── Sub-component: Location row ─────────────────────────────────────────────

interface LocationRowProps {
  captureEnabled: boolean;
  geo: GeoState;
  onToggle: (enabled: boolean) => void;
  onRetry: () => void;
}

function LocationRow({ captureEnabled, geo, onToggle, onRetry }: LocationRowProps) {
  return (
    <div className={styles.locationRow}>
      <div className={styles.locationToggleRow}>
        {/* GPS icon */}
        <svg
          className={styles.locationIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
        </svg>

        <div className={styles.locationLabelGroup}>
          <span className={styles.locationLabel}>GPS Location</span>
          <span className={styles.locationSubLabel}>
            {geo.status === "requesting"
              ? "Acquiring…"
              : geo.status === "success"
              ? geo.label
              : "Optional — improves map accuracy"}
          </span>
        </div>

        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={captureEnabled}
          className={[
            styles.locationToggle,
            captureEnabled ? styles.locationToggleOn : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onToggle(!captureEnabled)}
          aria-label={captureEnabled ? "Disable GPS location capture" : "Enable GPS location capture"}
        >
          <span className={styles.locationToggleThumb} aria-hidden="true" />
        </button>
      </div>

      {/* Error / retry row */}
      {captureEnabled && (geo.status === "denied" || geo.status === "unavailable") && (
        <div className={styles.locationErrorRow} role="alert">
          <svg
            className={styles.locationErrorIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className={styles.locationErrorText}>{geo.label}</span>
          {geo.status === "unavailable" && (
            <button
              type="button"
              className={styles.locationRetryBtn}
              onClick={onRetry}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Success row with coordinates */}
      {captureEnabled && geo.status === "success" && geo.lat !== undefined && geo.lng !== undefined && (
        <div className={styles.locationSuccessRow}>
          <svg
            className={styles.locationSuccessIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className={styles.locationCoords}>
            {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: Success view ─────────────────────────────────────────────

interface SuccessViewProps {
  caseId: string;
  caseLabel: string;
  previousStatus: CaseStatus;
  newStatus: CaseStatus;
  inspectionId: string | undefined;
}

function SuccessView({
  caseId,
  caseLabel,
  previousStatus,
  newStatus,
  inspectionId,
}: SuccessViewProps) {
  const isNoOp = previousStatus === newStatus;

  return (
    <div
      className={styles.successView}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="check-in-success"
    >
      {/* Success icon */}
      <div className={styles.successIconWrap} aria-hidden="true">
        <svg
          className={styles.successIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      </div>

      <h2 className={styles.successTitle}>
        {isNoOp ? "Check-in Recorded" : "Status Updated"}
      </h2>
      <p className={styles.successSubtitle}>
        {isNoOp
          ? `${caseLabel} re-checked in — no status change.`
          : `${caseLabel} moved from`}
        {!isNoOp && (
          <>
            {" "}
            <span className={styles.successStatusInline}>
              {STATUS_LABELS[previousStatus]}
            </span>
            {" → "}
            <span className={styles.successStatusInline}>
              {STATUS_LABELS[newStatus]}
            </span>
          </>
        )}
      </p>

      {/* New status pill */}
      <div className={styles.successPillRow}>
        <StatusPill kind={newStatus} filled />
      </div>

      {/* Inspection started notice */}
      {inspectionId && (
        <div className={styles.successNotice} role="status">
          <svg
            className={styles.successNoticeIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <span>Inspection started — review the checklist to mark items.</span>
        </div>
      )}

      {/* Real-time update notice */}
      <p className={styles.successRealtime}>
        Dashboard map updated in real time via Convex subscriptions.
      </p>

      {/* Actions */}
      <div className={styles.successActions}>
        <Link
          href={`/scan/${caseId}`}
          className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
          aria-label={`View case detail for ${caseLabel}`}
        >
          {/* Eye icon */}
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
            <path d="M1 12S5 5 12 5s11 7 11 7-4 7-11 7S1 12 1 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          View Case
        </Link>

        <Link
          href="/scan"
          className={[styles.ctaButton, styles.ctaButtonSecondary].join(" ")}
        >
          Scan Another Case
        </Link>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * ScanCheckInClient
 *
 * Interactive check-in screen.  Wires `useScanCheckIn()` to the form so
 * submitting writes through Convex and invalidates all case status /
 * location subscriptions automatically.
 */
export function ScanCheckInClient({ caseId }: ScanCheckInClientProps) {
  // ── Convex subscriptions ──────────────────────────────────────────────────
  // getCaseById is a real-time subscription: the header refreshes automatically
  // after a successful check-in (Convex pushes the updated doc back).
  const caseDoc = useQuery(api.cases.getCaseById, { caseId });

  // ── Mutation ──────────────────────────────────────────────────────────────
  const checkIn = useScanCheckIn();

  // ── User identity ─────────────────────────────────────────────────────────
  const user = useCurrentUser();

  // ── Form state ────────────────────────────────────────────────────────────
  const [selectedStatus, setSelectedStatus] = useState<CaseStatus | null>(null);
  const [locationEnabled, setLocationEnabled] = useState(true);
  const [notes, setNotes] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{
    previousStatus: CaseStatus;
    newStatus: CaseStatus;
    caseLabel: string;
    inspectionId: string | undefined;
  } | null>(null);

  // ── GPS ───────────────────────────────────────────────────────────────────
  const { geo, capture: retryGeo, clear: clearGeo } = useGeoCapture(locationEnabled);

  // ── Derived state ─────────────────────────────────────────────────────────

  // The case current status (from Convex subscription)
  const currentStatus: CaseStatus | null =
    caseDoc !== undefined && caseDoc !== null
      ? (caseDoc.status as CaseStatus)
      : null;

  // Valid target statuses for the current status
  const targetStatuses: readonly CaseStatus[] = currentStatus
    ? VALID_TRANSITIONS[currentStatus] ?? []
    : [];

  // Can submit: a target status selected and not currently submitting
  const canSubmit =
    phase === "form" &&
    selectedStatus !== null &&
    caseDoc !== null &&
    caseDoc !== undefined;

  // ── Auto-select current status as a no-op "re-check-in" default ──────────
  // Seeded once when caseDoc arrives; not overriding if user already chose
  const hasSeededRef = useRef(false);
  useEffect(() => {
    if (!hasSeededRef.current && currentStatus && targetStatuses.length > 0) {
      // Default to the first valid transition (most common forward transition)
      setSelectedStatus(targetStatuses[0]);
      hasSeededRef.current = true;
    }
  }, [currentStatus, targetStatuses]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleLocationToggle = useCallback(
    (enabled: boolean) => {
      setLocationEnabled(enabled);
      if (!enabled) clearGeo();
    },
    [clearGeo]
  );

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !selectedStatus || !caseDoc) return;

    setPhase("submitting");
    setSubmitError(null);

    try {
      const result = await checkIn({
        caseId,
        status:         selectedStatus,
        timestamp:      Date.now(),
        technicianId:   user.id,
        technicianName: user.name,
        // GPS position — only included when capture succeeded
        lat:            locationEnabled && geo.status === "success" ? geo.lat : undefined,
        lng:            locationEnabled && geo.status === "success" ? geo.lng : undefined,
        // Notes — only included when non-empty
        notes:          notes.trim() || undefined,
      });

      setSuccessData({
        previousStatus: result.previousStatus as CaseStatus,
        newStatus:      result.newStatus      as CaseStatus,
        caseLabel:      caseDoc.label,
        inspectionId:   result.inspectionId,
      });
      setPhase("success");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Check-in failed. Please try again.";
      setSubmitError(message);
      setPhase("error");
    }
  }, [
    canSubmit,
    selectedStatus,
    caseDoc,
    caseId,
    checkIn,
    user,
    locationEnabled,
    geo,
    notes,
  ]);

  const handleRetry = useCallback(() => {
    setSubmitError(null);
    setPhase("form");
  }, []);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (caseDoc === undefined) {
    return (
      <div className={styles.page}>
        <div
          className={styles.loadingShell}
          aria-busy="true"
          aria-label="Loading case"
        >
          <div className={styles.skeletonHeader} />
          <div className={styles.skeletonCard} />
          <div className={styles.skeletonCard} style={{ height: "5rem" }} />
        </div>
      </div>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────────
  if (caseDoc === null) {
    return (
      <div className={styles.page}>
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
          <h2 className={styles.errorTitle}>Case not found</h2>
          <p className={styles.errorBody}>
            No case found for this ID. The link may be invalid.
          </p>
          <Link href="/scan" className={[styles.ctaButton, styles.ctaButtonSecondary].join(" ")}>
            Back to scanner
          </Link>
        </div>
      </div>
    );
  }

  // ── Success view ──────────────────────────────────────────────────────────
  if (phase === "success" && successData) {
    return (
      <div className={styles.page}>
        <SuccessView
          caseId={caseId}
          caseLabel={successData.caseLabel}
          previousStatus={successData.previousStatus}
          newStatus={successData.newStatus}
          inspectionId={successData.inspectionId}
        />
      </div>
    );
  }

  // ── Form / submitting / error ──────────────────────────────────────────────
  return (
    <div className={styles.page}>
      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.caseHeaderRow}>
          <h1 className={styles.caseLabel}>{caseDoc.label}</h1>
          <StatusPill kind={caseDoc.status as CaseStatus} filled />
        </div>
        <p className={styles.pageSubheading}>Check In</p>
      </div>

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Status selection ──────────────────────────────────────────── */}
      <section
        className={styles.section}
        aria-labelledby="status-section-label"
      >
        <h2 id="status-section-label" className={styles.sectionTitle}>
          Set Status
        </h2>
        <p className={styles.sectionHint}>
          Select the new lifecycle status for this case.
        </p>

        {targetStatuses.length === 0 ? (
          <div className={styles.noTransitionsNotice} role="status">
            <svg
              className={styles.noticeIcon}
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
            <p>
              No status transitions are available from{" "}
              <strong>{STATUS_LABELS[caseDoc.status as CaseStatus]}</strong>.
            </p>
          </div>
        ) : (
          <div
            className={styles.statusGrid}
            role="group"
            aria-label="Select target status"
          >
            {targetStatuses.map((status) => (
              <StatusOption
                key={status}
                status={status}
                isSelected={selectedStatus === status}
                isCurrentStatus={status === currentStatus}
                onSelect={setSelectedStatus}
              />
            ))}
          </div>
        )}
      </section>

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Location ──────────────────────────────────────────────────── */}
      <section
        className={styles.section}
        aria-labelledby="location-section-label"
      >
        <h2 id="location-section-label" className={styles.sectionTitle}>
          Location
        </h2>
        <LocationRow
          captureEnabled={locationEnabled}
          geo={geo}
          onToggle={handleLocationToggle}
          onRetry={retryGeo}
        />
      </section>

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Notes ─────────────────────────────────────────────────────── */}
      <section
        className={styles.section}
        aria-labelledby="notes-section-label"
      >
        <h2 id="notes-section-label" className={styles.sectionTitle}>
          Notes
          <span className={styles.optionalBadge}>optional</span>
        </h2>
        <textarea
          id="checkInNotes"
          className={styles.notesTextarea}
          rows={3}
          placeholder="Any observations, issues, or context for this check-in…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Check-in notes (optional)"
          disabled={phase === "submitting"}
        />
      </section>

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Error banner ──────────────────────────────────────────────── */}
      {phase === "error" && submitError && (
        <div
          className={styles.errorBanner}
          role="alert"
          aria-live="assertive"
          data-testid="check-in-error"
        >
          <svg
            className={styles.errorBannerIcon}
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
          <span className={styles.errorBannerText}>{submitError}</span>
        </div>
      )}

      {/* ── Submit row ────────────────────────────────────────────────── */}
      <div className={styles.submitRow}>
        {/* Cancel / back */}
        <Link
          href={`/scan/${caseId}`}
          className={[styles.ctaButton, styles.ctaButtonSecondary].join(" ")}
          aria-label="Cancel check-in and return to case detail"
        >
          Cancel
        </Link>

        {/* Submit / retry */}
        {phase === "error" ? (
          <button
            type="button"
            className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
            onClick={handleRetry}
          >
            Try Again
          </button>
        ) : (
          <button
            type="button"
            className={[styles.ctaButton, styles.ctaButtonPrimary].join(" ")}
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-busy={phase === "submitting"}
            data-testid="check-in-submit"
          >
            {phase === "submitting" ? (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                Checking In…
              </>
            ) : (
              <>
                {/* Check icon */}
                <svg
                  className={styles.btnIcon}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Confirm Check-In
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
