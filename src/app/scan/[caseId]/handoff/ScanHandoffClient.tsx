/**
 * ScanHandoffClient — SCAN app custody handoff screen
 *
 * Sub-AC 36b-5: Wire custody handoff mutation to write through Convex and
 * invalidate custody/assignment subscriptions for the relevant case.
 *
 * Flow overview
 * ─────────────
 * The technician arrives here from the case detail action card "Transfer
 * Custody".  The screen presents:
 *
 *   1. Case header       — label + current status pill + current custodian
 *   2. Recipient fields  — recipient user ID + display name
 *   3. Location row      — optional GPS capture toggle
 *   4. Notes field       — optional free-text note
 *   5. Submit CTA        — calls handoffCustody mutation
 *   6. Result view       — success (custody record + "View Case" link) or error
 *
 * Convex mutation wiring
 * ──────────────────────
 * `useHandoffCustody()` from src/hooks/use-scan-mutations.ts wraps
 * `api.custody.handoffCustody`.  On submit:
 *
 *   await handoff({
 *     caseId, fromUserId, fromUserName,
 *     toUserId, toUserName, handoffAt,
 *     lat?, lng?, locationName?, notes?,
 *   });
 *
 * The mutation writes:
 *   • custodyRecords (new row)     → invalidates getCustodyRecordsByCase,
 *                                    getLatestCustodyRecord, getCustodyChain,
 *                                    getCustodyRecordsByCustodian(toUserId),
 *                                    getCustodyRecordsByTransferrer(fromUserId),
 *                                    getCustodianIdentitySummary for both users
 *   • cases.assigneeId             → invalidates M2 assignment map, M1/M3
 *                                    assigneeId filter
 *   • cases.assigneeName           → invalidates M2 pin tooltips, T2 layout
 *   • cases.updatedAt              → invalidates M1 by_updated sort index
 *   • cases.lat / .lng             → all map modes withinBounds() (optional)
 *   • cases.locationName           → map pin location label (optional)
 *   • events "custody_handoff" row → T5 immutable audit timeline
 *   • notifications row            → in-app alert to incoming custodian
 *
 * Convex automatically re-evaluates all subscribed queries that read the
 * touched rows — no polling, no manual refetch needed.  The INVENTORY
 * dashboard reflects the change within ~100–300 ms, satisfying the ≤ 2-second
 * real-time fidelity requirement (real_time_fidelity AC principle).
 *
 * User identity
 * ─────────────
 * fromUserId / fromUserName are sourced from the Kinde auth context when
 * available (useKindeAuth).  This file uses a placeholder fallback pending
 * full Kinde integration — the auth shape is wired in `useCurrentUser()`.
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
import { useHandoffCustody } from "../../../../hooks/use-scan-mutations";
import { useLatestCustodyRecord } from "../../../../hooks/use-custody";
import { StatusPill } from "../../../../components/StatusPill";
import { trackEvent } from "../../../../lib/telemetry.lib";
import { TelemetryEventName } from "../../../../types/telemetry.types";
import type { HandoffType } from "../../../../types/telemetry.types";
import type { CaseStatus } from "../../../../../convex/cases";
import styles from "./page.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ScanHandoffClientProps {
  caseId: string;
}

// ─── User identity helper ─────────────────────────────────────────────────────

/**
 * Returns the current user's Kinde ID and display name.
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
              : "Optional — records handoff location"}
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
  fromUserName: string;
  toUserName: string;
  handoffAt: number;
}

function SuccessView({
  caseId,
  caseLabel,
  fromUserName,
  toUserName,
  handoffAt,
}: SuccessViewProps) {
  const formattedTime = new Date(handoffAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={styles.successView}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="handoff-success"
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

      <h2 className={styles.successTitle}>Custody Transferred</h2>
      <p className={styles.successSubtitle}>
        <strong>{caseLabel}</strong> has been handed off from{" "}
        <span className={styles.successUserName}>{fromUserName}</span>
        {" "}to{" "}
        <span className={styles.successUserName}>{toUserName}</span>.
      </p>

      <div className={styles.successMeta}>
        <div className={styles.successMetaItem}>
          <span className={styles.successMetaLabel}>New custodian</span>
          <span className={styles.successMetaValue}>{toUserName}</span>
        </div>
        <div className={styles.successMetaItem}>
          <span className={styles.successMetaLabel}>Transferred at</span>
          <span className={[styles.successMetaValue, styles.mono].join(" ")}>
            {formattedTime}
          </span>
        </div>
      </div>

      {/* Real-time update notice */}
      <p className={styles.successRealtime}>
        Dashboard map and custody subscriptions updated in real time via Convex.
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
 * ScanHandoffClient
 *
 * Interactive custody handoff screen.  Wires `useHandoffCustody()` to the form
 * so submitting writes through Convex and automatically invalidates all
 * custody/assignment subscriptions for the relevant case:
 *
 *   custodyRecords subscriptions → getCustodyRecordsByCase, getLatestCustodyRecord,
 *                                   getCustodyChain, getCustodyRecordsByCustodian,
 *                                   getCustodyRecordsByTransferrer,
 *                                   getCustodianIdentitySummary
 *
 *   cases subscriptions         → getCaseById, listCases, getCasesInBounds,
 *                                   getCaseStatusCounts (assigneeId + updatedAt)
 *
 *   M2 map assignment           → assembleM2 reads cases.assigneeId for pin groups
 *
 * No manual cache invalidation is required — Convex's reactive transport
 * handles all subscription re-evaluation automatically.
 */
export function ScanHandoffClient({ caseId }: ScanHandoffClientProps) {
  // ── Convex subscriptions ──────────────────────────────────────────────────
  // getCaseById is a real-time subscription: the header refreshes automatically
  // after a successful handoff (Convex pushes the updated doc back).
  const caseDoc = useQuery(api.cases.getCaseById, { caseId });

  // Subscribe to the latest custody record so we can show the current holder.
  // This subscription is also invalidated by the handoffCustody mutation, so
  // the "current holder" display updates reactively if another device performs
  // a handoff while this screen is open.
  const latestCustody = useLatestCustodyRecord(caseId);

  // ── Mutation ──────────────────────────────────────────────────────────────
  // useHandoffCustody wraps api.custody.handoffCustody.
  //
  // When called, the mutation:
  //   1. Inserts into custodyRecords  → invalidates all custody subscriptions
  //   2. Patches cases.assigneeId,
  //        cases.assigneeName,
  //        cases.updatedAt            → invalidates all case + M2 subscriptions
  //   3. Inserts custody_handoff event → invalidates T5 audit subscriptions
  //   4. Inserts notification          → notifies incoming custodian in-app
  const handoff = useHandoffCustody();

  // ── User identity ─────────────────────────────────────────────────────────
  const user = useCurrentUser();

  // ── Form state ────────────────────────────────────────────────────────────
  const [recipientId, setRecipientId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [locationEnabled, setLocationEnabled] = useState(true);
  const [locationName, setLocationName] = useState("");
  const [notes, setNotes] = useState("");
  const [handoffType, setHandoffType] = useState<HandoffType>("peer_to_peer");
  const [phase, setPhase] = useState<Phase>("form");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<{
    fromUserName: string;
    toUserName: string;
    caseLabel: string;
    handoffAt: number;
  } | null>(null);

  // ── Telemetry: flow open timestamp ─────────────────────────────────────────
  // Capture the epoch ms when the handoff flow opens.  Used to compute
  // handoffDurationMs in the SCAN_ACTION_CUSTODY_COMPLETED event (spec §23).
  const flowOpenedAtRef = useRef<number>(Date.now());

  // ── GPS ───────────────────────────────────────────────────────────────────
  const { geo, capture: retryGeo, clear: clearGeo } = useGeoCapture(locationEnabled);

  // ── Telemetry: custody flow opened ────────────────────────────────────────
  // Emit SCAN_NAV_CUSTODY_FLOW_OPENED once the case document is available
  // (not undefined — the case may not exist, but the flow was still opened).
  // Guard with a ref so the effect fires exactly once per mount, not each
  // time caseDoc transitions from undefined → loaded.
  const flowOpenedEmittedRef = useRef(false);
  useEffect(() => {
    if (caseDoc === undefined) return;         // still loading — wait
    if (flowOpenedEmittedRef.current) return;  // already emitted
    flowOpenedEmittedRef.current = true;

    // Record the flow-open timestamp for handoffDurationMs calculation
    flowOpenedAtRef.current = Date.now();

    // Only emit the navigation event when the case exists (caseId is valid)
    if (caseDoc !== null) {
      trackEvent({
        eventCategory: "navigation",
        eventName:     TelemetryEventName.SCAN_NAV_CUSTODY_FLOW_OPENED,
        app:           "scan",
        caseId,
      });
    }
  }, [caseDoc, caseId]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const canSubmit =
    phase === "form" &&
    recipientId.trim().length > 0 &&
    recipientName.trim().length > 0 &&
    caseDoc !== null &&
    caseDoc !== undefined;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleLocationToggle = useCallback(
    (enabled: boolean) => {
      setLocationEnabled(enabled);
      if (!enabled) clearGeo();
    },
    [clearGeo]
  );

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !caseDoc) return;

    setPhase("submitting");
    setSubmitError(null);

    const now = Date.now();
    const trimmedRecipientId   = recipientId.trim();
    const trimmedRecipientName = recipientName.trim();
    const trimmedLocationName  = locationName.trim() || undefined;
    const trimmedNotes         = notes.trim() || undefined;

    // ── Telemetry: handoff initiated (spec §23) ──────────────────────────
    // Emitted at form submission time, before the mutation is sent to Convex.
    // Captures case ID, from-custodian (user.id), to-custodian (recipientId),
    // handoff type, and timestamp (auto-filled by the telemetry client).
    trackEvent({
      eventCategory:   "user_action",
      eventName:       TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED,
      app:             "scan",
      caseId,
      fromUserId:      user.id,
      recipientUserId: trimmedRecipientId,
      handoffType,
    });

    try {
      // ── Core mutation call ─────────────────────────────────────────────
      // handoffCustody writes to three tables in one transaction:
      //
      //   custodyRecords (INSERT) — invalidates:
      //     • getCustodyRecordsByCase({ caseId })
      //     • getLatestCustodyRecord({ caseId })
      //     • getCustodyChain({ caseId })
      //     • getCustodyRecordsByCustodian({ userId: trimmedRecipientId })
      //     • getCustodyRecordsByTransferrer({ userId: user.id })
      //     • getCustodyRecordsByParticipant({ userId: ... }) for both users
      //     • getCustodianIdentitySummary({ userId: ... }) for both users
      //     • listAllCustodyTransfers (fleet-wide)
      //     • getCustodyTransferSummary (fleet-wide aggregate)
      //
      //   cases (PATCH: assigneeId, assigneeName, updatedAt, lat?, lng?,
      //          locationName?) — invalidates:
      //     • getCaseById({ caseId })
      //     • listCases  (M1/M2/M3/M4/M5 map pin feeds)
      //     • getCasesInBounds  (viewport-clipped map subscriptions)
      //     • getCaseStatusCounts  (dashboard summary bar counts)
      //     • getCaseStatus  (case detail panel header)
      //
      //   events (INSERT: custody_handoff) — invalidates:
      //     • getCaseEvents / getCaseAssignmentLayout  (T2/T5 panels)
      //
      //   notifications (INSERT) — in-app alert to incoming custodian
      //
      // Convex propagates these invalidations to all connected clients within
      // ~100–300 ms — well within the ≤ 2-second real-time fidelity requirement.
      await handoff({
        caseId,
        fromUserId:   user.id,
        fromUserName: user.name,
        toUserId:     trimmedRecipientId,
        toUserName:   trimmedRecipientName,
        handoffAt:    now,
        lat:          locationEnabled && geo.status === "success" ? geo.lat : undefined,
        lng:          locationEnabled && geo.status === "success" ? geo.lng : undefined,
        locationName: trimmedLocationName,
        notes:        trimmedNotes,
      });

      // ── Telemetry: handoff completed (spec §23) ────────────────────────
      // Emitted only on mutation success.  Captures:
      //   • case ID              — caseId
      //   • from-custodian       — user.id / user.name
      //   • to-custodian         — trimmedRecipientId / trimmedRecipientName
      //   • handoff type         — handoffType (selected in form, default "peer_to_peer")
      //   • timestamp (handoffAt) — now (epoch ms passed to mutation)
      //   • handoffDurationMs    — total duration from flow open to success
      //   • hasSignature         — false (signature capture not yet implemented)
      trackEvent({
        eventCategory:    "user_action",
        eventName:        TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED,
        app:              "scan",
        caseId,
        fromUserId:       user.id,
        fromUserName:     user.name,
        toUserId:         trimmedRecipientId,
        toUserName:       trimmedRecipientName,
        handoffType,
        hasSignature:     false,
        handoffDurationMs: now - flowOpenedAtRef.current,
        handoffAt:        now,
      });

      setSuccessData({
        fromUserName: user.name,
        toUserName:   trimmedRecipientName,
        caseLabel:    caseDoc.label,
        handoffAt:    now,
      });
      setPhase("success");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Handoff failed. Please try again.";
      setSubmitError(message);
      setPhase("error");
    }
  }, [
    canSubmit,
    caseDoc,
    caseId,
    handoff,
    user,
    recipientId,
    recipientName,
    handoffType,
    locationEnabled,
    geo,
    locationName,
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
          <div className={styles.skeletonCard} />
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
          fromUserName={successData.fromUserName}
          toUserName={successData.toUserName}
          handoffAt={successData.handoffAt}
        />
      </div>
    );
  }

  // ── Form / submitting / error ──────────────────────────────────────────────
  return (
    <div className={styles.page}>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div className={styles.caseHeaderRow}>
          <h1 className={styles.caseLabel}>{caseDoc.label}</h1>
          <StatusPill kind={caseDoc.status as CaseStatus} filled />
        </div>
        <p className={styles.pageSubheading}>Transfer Custody</p>
      </div>

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Current custodian info ────────────────────────────────────────── */}
      <section className={styles.section} aria-labelledby="current-custodian-label">
        <h2 id="current-custodian-label" className={styles.sectionTitle}>
          Current Custodian
        </h2>

        <div className={styles.custodianCard}>
          {/* Person icon */}
          <svg
            className={styles.custodianIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <div className={styles.custodianInfo}>
            <span className={styles.custodianName}>
              {latestCustody?.toUserName ?? caseDoc.assigneeName ?? user.name}
            </span>
            <span className={styles.custodianMeta}>
              {latestCustody
                ? `Received custody ${new Date(latestCustody.transferredAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}`
                : "Initial custodian (no prior handoff)"}
            </span>
          </div>
          {/* Transfer-out arrow */}
          <svg
            className={styles.transferArrow}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </div>
      </section>

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Recipient fields ──────────────────────────────────────────────── */}
      <section className={styles.section} aria-labelledby="recipient-section-label">
        <h2 id="recipient-section-label" className={styles.sectionTitle}>
          Transfer To
        </h2>
        <p className={styles.sectionHint}>
          Enter the recipient&apos;s ID and name to record the custody transfer.
        </p>

        <div className={styles.fieldGroup}>
          <label htmlFor="recipientId" className={styles.fieldLabel}>
            Recipient User ID
            <span className={styles.fieldRequired} aria-hidden="true"> *</span>
          </label>
          <input
            id="recipientId"
            type="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className={styles.fieldInput}
            placeholder="e.g. kp_123abc"
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            disabled={phase === "submitting"}
            required
            aria-required="true"
            aria-describedby="recipient-id-hint"
          />
          <span id="recipient-id-hint" className={styles.fieldHint}>
            Kinde user ID of the person receiving custody of this case.
          </span>
        </div>

        <div className={styles.fieldGroup}>
          <label htmlFor="recipientName" className={styles.fieldLabel}>
            Recipient Display Name
            <span className={styles.fieldRequired} aria-hidden="true"> *</span>
          </label>
          <input
            id="recipientName"
            type="text"
            autoComplete="name"
            autoCorrect="off"
            autoCapitalize="words"
            spellCheck={false}
            className={styles.fieldInput}
            placeholder="e.g. Jane Pilot"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            disabled={phase === "submitting"}
            required
            aria-required="true"
            aria-describedby="recipient-name-hint"
          />
          <span id="recipient-name-hint" className={styles.fieldHint}>
            Full name of the recipient — displayed on the dashboard custody panel.
          </span>
        </div>
      </section>

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Handoff Type (spec §23 telemetry field) ───────────────────────── */}
      <section
        className={styles.section}
        aria-labelledby="handoff-type-section-label"
      >
        <h2 id="handoff-type-section-label" className={styles.sectionTitle}>
          Handoff Type
        </h2>
        <p className={styles.sectionHint}>
          Classify this transfer for operations reporting and audit logs.
        </p>
        <div className={styles.fieldGroup}>
          <label htmlFor="handoffType" className={styles.fieldLabel}>
            Transfer Type
            <span className={styles.fieldRequired} aria-hidden="true"> *</span>
          </label>
          <select
            id="handoffType"
            className={styles.fieldInput}
            value={handoffType}
            onChange={(e) => setHandoffType(e.target.value as HandoffType)}
            disabled={phase === "submitting"}
            aria-required="true"
            aria-describedby="handoff-type-hint"
            data-testid="handoff-type-select"
          >
            <option value="peer_to_peer">Peer-to-peer (field transfer)</option>
            <option value="field_transfer">Field transfer (same deployment)</option>
            <option value="return">Return to base / warehouse</option>
            <option value="initial_assignment">Initial assignment (first holder)</option>
          </select>
          <span id="handoff-type-hint" className={styles.fieldHint}>
            Recorded in telemetry for custody audit (spec §23).
          </span>
        </div>
      </section>

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Location ──────────────────────────────────────────────────────── */}
      <section
        className={styles.section}
        aria-labelledby="location-section-label"
      >
        <h2 id="location-section-label" className={styles.sectionTitle}>
          Handoff Location
          <span className={styles.optionalBadge}>optional</span>
        </h2>

        <LocationRow
          captureEnabled={locationEnabled}
          geo={geo}
          onToggle={handleLocationToggle}
          onRetry={retryGeo}
        />

        {/* Named location field — optional */}
        <div className={styles.fieldGroup}>
          <label htmlFor="locationName" className={styles.fieldLabel}>
            Location Name
          </label>
          <input
            id="locationName"
            type="text"
            className={styles.fieldInput}
            placeholder="e.g. Site Alpha — Turbine Row 3"
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            disabled={phase === "submitting"}
            aria-describedby="location-name-hint"
          />
          <span id="location-name-hint" className={styles.fieldHint}>
            Human-readable location label for map pin tooltips and T2 display.
          </span>
        </div>
      </section>

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Notes ─────────────────────────────────────────────────────────── */}
      <section
        className={styles.section}
        aria-labelledby="notes-section-label"
      >
        <h2 id="notes-section-label" className={styles.sectionTitle}>
          Notes
          <span className={styles.optionalBadge}>optional</span>
        </h2>
        <textarea
          id="handoffNotes"
          className={styles.notesTextarea}
          rows={3}
          placeholder="Any observations, conditions, or context for this handoff…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Custody handoff notes (optional)"
          disabled={phase === "submitting"}
        />
      </section>

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Error banner ──────────────────────────────────────────────────── */}
      {phase === "error" && submitError && (
        <div
          className={styles.errorBanner}
          role="alert"
          aria-live="assertive"
          data-testid="handoff-error"
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

      {/* ── Submit row ────────────────────────────────────────────────────── */}
      <div className={styles.submitRow}>
        {/* Cancel / back */}
        <Link
          href={`/scan/${caseId}`}
          className={[styles.ctaButton, styles.ctaButtonSecondary].join(" ")}
          aria-label="Cancel custody transfer and return to case detail"
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
            data-testid="handoff-submit"
          >
            {phase === "submitting" ? (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                Transferring…
              </>
            ) : (
              <>
                {/* Swap/transfer icon */}
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
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                Confirm Transfer
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
