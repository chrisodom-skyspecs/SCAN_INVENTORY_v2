/**
 * ScanCaseDetailClient — SCAN app case detail view
 *
 * Sub-AC 3: Case detail view that displays the linked QR code (and other key
 * case details) after a successful QR code association via the associate flow.
 *
 * Real-time fidelity
 * ──────────────────
 * Subscribes to `api.cases.getCaseById` via Convex `useQuery`.  After the
 * `associateQRCodeToCase` mutation runs (in AssociateQRClient), Convex
 * automatically re-evaluates all subscribed queries that touch the affected
 * case row and pushes the updated document to connected clients within
 * ~100–300 ms — well within the ≤ 2-second fidelity requirement.
 *
 * This means:
 *   • If this page is open while the association completes, the QR code
 *     section appears without any page reload.
 *   • Navigating here from the ResultStep (via "View Case" CTA) shows the
 *     up-to-date document from Convex cache, so the QR is visible immediately.
 *
 * QR code display
 * ───────────────
 * When `caseDoc.qrCode` is a non-empty string, a QR code card is rendered
 * with:
 *   • A monospace payload display (IBM Plex Mono, truncated to 64 chars)
 *   • A "Reassociate" link to the `/scan/[caseId]/associate` flow for updates
 *
 * When `caseDoc.qrCode` is empty or absent, a call-to-action prompts the
 * operator to run the association flow.
 *
 * Action cards
 * ────────────
 * Three primary actions are surfaced as touch-friendly cards:
 *   1. Associate QR Code — links to /scan/[caseId]/associate
 *   2. Ship Case         — links to /scan/[caseId]/ship
 *   3. Back to cases     — links to /scan (root list, when built)
 *
 * Design system compliance
 * ────────────────────────
 * All colors via CSS custom properties. StatusPill for status rendering.
 * IBM Plex Mono for QR payload and case label. Inter Tight for all other text.
 * Touch targets ≥ 44 × 44 px (WCAG 2.5.5).
 * WCAG AA contrast in both light and dark themes.
 * prefers-reduced-motion respected in all transition/animation rules.
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useScanCaseDetail } from "../../../hooks/use-scan-queries";
import { useFedExTracking } from "../../../hooks/use-fedex-tracking";
import { StatusPill } from "../../../components/StatusPill";
import { TrackingStatus } from "../../../components/TrackingStatus";
import { useCurrentUser } from "../../../hooks/use-current-user";
import { OPERATIONS } from "@/lib/rbac-client";
import type { CaseStatus } from "../../../../convex/cases";
import styles from "./page.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ScanCaseDetailClientProps {
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

function truncateQR(payload: string, maxLen = 64): string {
  if (payload.length <= maxLen) return payload;
  return `${payload.slice(0, maxLen)}…`;
}

// ─── Sub-component: QR Code card (linked state) ───────────────────────────────

interface QRCodeLinkedCardProps {
  qrCode: string;
  caseId: string;
}

function QRCodeLinkedCard({ qrCode, caseId }: QRCodeLinkedCardProps) {
  return (
    <section
      className={styles.qrCard}
      aria-label="Linked QR code"
      data-testid="qr-code-linked-card"
    >
      {/* Card header */}
      <div className={styles.qrCardHeader}>
        {/* QR icon */}
        <svg
          className={styles.qrCardIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="3" height="3" />
          <rect x="18" y="14" width="3" height="3" />
          <rect x="14" y="18" width="3" height="3" />
          <rect x="18" y="18" width="3" height="3" />
        </svg>
        <div>
          <h3 className={styles.qrCardTitle}>QR Code Linked</h3>
          <p className={styles.qrCardSubtitle}>
            This case has an associated QR code.
          </p>
        </div>

        {/* Linked badge */}
        <div className={styles.qrLinkedBadge} aria-label="QR code linked">
          <svg
            className={styles.qrLinkedCheck}
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="2 5 4 7 8 3" />
          </svg>
        </div>
      </div>

      {/* QR payload */}
      <div className={styles.qrPayloadBlock}>
        <span className={styles.qrPayloadLabel}>QR Payload</span>
        <code
          className={styles.qrPayloadValue}
          title={qrCode}
          aria-label={`QR code payload: ${qrCode}`}
        >
          {truncateQR(qrCode)}
        </code>
      </div>

      {/* Reassociate link */}
      <Link
        href={`/scan/${caseId}/associate`}
        className={styles.qrReassociateLink}
        aria-label="Reassociate or update the QR code for this case"
      >
        Reassociate QR Code →
      </Link>
    </section>
  );
}

// ─── Sub-component: QR Code card (unlinked state) ─────────────────────────────

interface QRCodeUnlinkedCardProps {
  caseId: string;
}

function QRCodeUnlinkedCard({ caseId }: QRCodeUnlinkedCardProps) {
  return (
    <section
      className={styles.qrCardUnlinked}
      aria-label="No QR code linked"
      data-testid="qr-code-unlinked-card"
    >
      {/* Unlinked icon */}
      <svg
        className={styles.qrUnlinkedIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <line x1="18" y1="14" x2="22" y2="18" />
        <line x1="22" y1="14" x2="18" y2="18" />
      </svg>
      <div>
        <h3 className={styles.qrUnlinkedTitle}>No QR Code Linked</h3>
        <p className={styles.qrUnlinkedBody}>
          Associate a QR code to enable field scanning for this case.
        </p>
      </div>

      <Link
        href={`/scan/${caseId}/associate`}
        className={styles.ctaButton}
        data-variant="primary"
        aria-label="Associate a QR code with this case"
      >
        {/* Link icon */}
        <svg
          className={styles.ctaBtnIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        Associate QR Code
      </Link>
    </section>
  );
}

// ─── Sub-component: Action card ───────────────────────────────────────────────

interface ActionCardProps {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  variant?: "default" | "ship" | "checkin" | "handoff";
}

function ActionCard({
  href,
  icon,
  title,
  description,
  variant = "default",
}: ActionCardProps) {
  return (
    <Link
      href={href}
      className={[
        styles.actionCard,
        variant === "ship"    ? styles.actionCardShip    : "",
        variant === "checkin" ? styles.actionCardCheckIn : "",
        variant === "handoff" ? styles.actionCardHandoff : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`${title}: ${description}`}
    >
      <div className={styles.actionCardIcon} aria-hidden="true">
        {icon}
      </div>
      <div className={styles.actionCardBody}>
        <span className={styles.actionCardTitle}>{title}</span>
        <span className={styles.actionCardDesc}>{description}</span>
      </div>
      {/* Chevron */}
      <svg
        className={styles.actionCardChevron}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </Link>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * ScanCaseDetailClient
 *
 * Displays the full case summary for the SCAN mobile app.
 * Subscribes in real-time to getCaseById — the QR code section updates
 * automatically within ~300 ms of a successful associateQRCodeToCase mutation.
 */
export function ScanCaseDetailClient({ caseId }: ScanCaseDetailClientProps) {
  // ── Router (Next.js App Router) ───────────────────────────────────────────
  // Used for programmatic navigation from the "View full tracking →" link
  // in the compact TrackingStatus component to the dedicated ship page.
  const router = useRouter();

  // ── Real-time case subscription ───────────────────────────────────────────
  // useScanCaseDetail delegates to useCaseById which subscribes to
  // api.cases.getCaseById.  Convex re-evaluates and pushes the updated
  // document within ~100–300 ms of any mutation (associateQRCodeToCase,
  // scanCheckIn, shipCase, etc.) — satisfying the ≤ 2-second real-time
  // fidelity requirement.
  const caseDoc = useScanCaseDetail(caseId);

  // ── FedEx tracking subscription ───────────────────────────────────────────
  // Subscribes to api.shipping.listShipmentsByCase — a reactive Convex query
  // that updates within ~100–300 ms of any shipCase / createShipment mutation.
  //
  // Used in controlled mode for the compact TrackingStatus section below:
  //   • hasTracking      — true when at least one shipment with a tracking
  //                        number exists for this case.
  //   • latestShipment   — the most recent persisted shipment record.
  //   • liveTracking     — live FedEx data after a manual refresh; null until
  //                        the user taps Refresh on the ship page.
  //   • isRefreshing     — true while a live FedEx Track API call is in flight.
  //   • isActiveShipment — true when the shipment is not yet "delivered".
  //   • refreshError     — error message from the most recent failed refresh.
  //   • refreshTracking  — callback to trigger a live FedEx refresh.
  //
  // Passing these values to <TrackingStatus> in controlled mode avoids
  // opening a second Convex WebSocket subscription for the same query
  // (the ship page already opens its own subscription when navigated to).
  const {
    latestShipment,
    hasTracking,
    liveTracking,
    isRefreshing,
    isActiveShipment,
    refreshError,
    refreshTracking,
  } = useFedExTracking(caseId);

  // ── Role-based permission helpers ─────────────────────────────────────────
  // Drives conditional rendering of technician-only action cards.
  //   canInspect        → INSPECTION_START required → technician + admin only
  //   canGenerateQR     → QR_CODE_GENERATE required → technician + admin only
  // All other SCAN actions (Check In, Ship Case, Transfer Custody) are
  // permitted for admin, technician, and pilot (universal operations).
  const { can, isLoading: rolesLoading } = useCurrentUser();

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
          <div className={styles.skeletonCard} />
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
            No case exists for this ID. The case may have been deleted or the
            link is invalid.
          </p>
        </div>
      </div>
    );
  }

  // ── Derive QR linked state ─────────────────────────────────────────────────
  // qrCode is required in the schema but may be an empty string on new cases
  const hasQrCode = typeof caseDoc.qrCode === "string" && caseDoc.qrCode.trim().length > 0;

  return (
    <div className={styles.page}>
      {/* ── Case header ──────────────────────────────────────────────── */}
      <div className={styles.caseHeader}>
        <div className={styles.caseHeaderRow}>
          <h1 className={styles.caseLabel}>{caseDoc.label}</h1>
          <StatusPill kind={caseDoc.status as CaseStatus} filled />
        </div>

        {/* Key metadata */}
        <dl className={styles.metaGrid}>
          {caseDoc.locationName && (
            <div className={styles.metaItem}>
              <dt className={styles.metaLabel}>Location</dt>
              <dd className={styles.metaValue}>{caseDoc.locationName}</dd>
            </div>
          )}

          {caseDoc.assigneeName && (
            <div className={styles.metaItem}>
              <dt className={styles.metaLabel}>Assigned to</dt>
              <dd className={styles.metaValue}>{caseDoc.assigneeName}</dd>
            </div>
          )}

          <div className={styles.metaItem}>
            <dt className={styles.metaLabel}>Last updated</dt>
            <dd className={styles.metaValueMono}>{formatDate(caseDoc.updatedAt)}</dd>
          </div>
        </dl>
      </div>

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── QR code section ───────────────────────────────────────────── */}
      {/*
       * This section reactively shows the QR code after a successful
       * associateQRCodeToCase mutation.  Convex re-pushes the updated
       * caseDoc within ~300 ms, at which point hasQrCode flips to true
       * and QRCodeLinkedCard renders in place of QRCodeUnlinkedCard.
       */}
      {hasQrCode ? (
        <QRCodeLinkedCard
          qrCode={caseDoc.qrCode as string}
          caseId={caseId}
        />
      ) : (
        <QRCodeUnlinkedCard caseId={caseId} />
      )}

      <hr className={styles.divider} aria-hidden="true" />

      {/* ── Action cards ──────────────────────────────────────────────── */}
      <nav
        className={styles.actionGrid}
        aria-label="Case actions"
        data-testid="case-action-grid"
      >
        {/*
         * Check In — primary SCAN app action.
         *
         * Permitted for ALL roles: admin, technician, pilot (case:status:change).
         *
         * Navigates to /scan/[caseId]/check-in which calls the `scanCheckIn`
         * Convex mutation.  That mutation writes cases.status, cases.assigneeId,
         * cases.lat, cases.lng, cases.updatedAt — causing Convex to reactively
         * re-evaluate getCaseStatus, getCaseById, listCases, getCasesInBounds,
         * and getCaseStatusCounts subscriptions across the dashboard and SCAN app.
         */}
        <ActionCard
          href={`/scan/${caseId}/check-in`}
          title="Check In"
          description="Update case status and record your location."
          variant="checkin"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          }
        />

        {/*
         * Inspect — TECHNICIAN + ADMIN only (case:inspection:start).
         *
         * Pilots do not have the INSPECTION_START, INSPECTION_UPDATE_ITEM, or
         * INSPECTION_COMPLETE operations, so the Inspect card is hidden for them.
         * The underlying Convex mutations enforce this server-side as well.
         *
         * Navigates to /scan/[caseId]/inspect which calls the
         * `updateChecklistItem` Convex mutation for each item status change.
         * That mutation writes manifestItems.status + syncs inspection counters,
         * causing Convex to reactively re-evaluate all subscribed checklist
         * queries (getChecklistByCase, getChecklistSummary,
         * getChecklistItemsByStatus, getUncheckedItems,
         * getChecklistWithInspection) and M3 map pins — satisfying the ≤ 2-second
         * real-time fidelity requirement (Sub-AC 36b-2).
         */}
        {!rolesLoading && can(OPERATIONS.INSPECTION_START) && (
          <ActionCard
            href={`/scan/${caseId}/inspect`}
            title="Inspect"
            description="Review packing list items and record their condition."
            variant="checkin"
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                <line x1="9" y1="12" x2="15" y2="12" />
                <line x1="9" y1="16" x2="13" y2="16" />
              </svg>
            }
          />
        )}

        {/*
         * Associate / Reassociate QR Code — TECHNICIAN + ADMIN only (qrCode:generate).
         *
         * Pilots can read/scan QR codes (qrCode:read) but cannot generate or
         * associate them (qrCode:generate).  The card is hidden for pilots.
         * The Convex associateQRCodeToCase mutation enforces this server-side.
         */}
        {!rolesLoading && can(OPERATIONS.QR_CODE_GENERATE) && (
          <ActionCard
            href={`/scan/${caseId}/associate`}
            title={hasQrCode ? "Reassociate QR" : "Associate QR Code"}
            description={
              hasQrCode
                ? "Replace the current QR code with a new one."
                : "Link a QR code label to this case."
            }
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            }
          />
        )}

        <ActionCard
          href={`/scan/${caseId}/ship`}
          title="Ship Case"
          description="Enter FedEx tracking number and mark case as shipping."
          variant="ship"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="1" y="3" width="15" height="13" />
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
          }
        />

        {/*
         * Transfer Custody — Sub-AC 36b-5.
         *
         * Navigates to /scan/[caseId]/handoff which calls the
         * `handoffCustody` Convex mutation.  That mutation writes:
         *   • custodyRecords (new row) → invalidates all custody subscriptions
         *     (getCustodyRecordsByCase, getLatestCustodyRecord, getCustodyChain,
         *      getCustodyRecordsByCustodian, getCustodyRecordsByTransferrer,
         *      getCustodianIdentitySummary, listAllCustodyTransfers)
         *   • cases.assigneeId, cases.assigneeName, cases.updatedAt →
         *     invalidates all case and assignment subscriptions (getCaseById,
         *     listCases, getCasesInBounds, getCaseStatusCounts) and M2 map
         *     assignment view — satisfying the ≤ 2-second real-time fidelity
         *     requirement between SCAN app action and dashboard visibility.
         */}
        <ActionCard
          href={`/scan/${caseId}/handoff`}
          title="Transfer Custody"
          description="Hand off custody of this case to another technician or pilot."
          variant="handoff"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          }
        />
      </nav>

      {/*
        ── Shipping status (Sub-AC 4) ────────────────────────────────────────

        Conditionally rendered when a FedEx tracking number has been recorded
        for this case (hasTracking === true).  Uses the compact variant of
        <TrackingStatus> in controlled mode — the same `useFedExTracking(caseId)`
        call above provides the persisted shipment record and any live FedEx data
        fetched via the on-demand refresh action.

        Real-time fidelity:
          When the user taps "Ship Case" on this page or another device calls
          shipCase, Convex automatically invalidates the listShipmentsByCase
          subscription — causing `hasTracking` to flip to true and this section
          to appear within ~100–300 ms, well within the ≤ 2-second SLA.

        "View full tracking →" navigates to /scan/[caseId]/ship which shows
        the full <TrackingStatus variant="full"> with the complete events timeline,
        origin/destination details, and all historical shipments for this case.
      */}
      {hasTracking && latestShipment && (
        <>
          <hr className={styles.divider} aria-hidden="true" />
          <section
            aria-label="Shipping status"
            data-testid="case-detail-shipping-status"
          >
            <h3 className={styles.sectionTitle}>Shipping Status</h3>
            <TrackingStatus
              caseId={caseId}
              shipment={latestShipment}
              liveTracking={liveTracking}
              isRefreshing={isRefreshing}
              isActiveShipment={isActiveShipment}
              onRefresh={refreshTracking}
              refreshError={refreshError}
              variant="compact"
              onViewDetails={() => router.push(`/scan/${caseId}/ship`)}
            />
          </section>
        </>
      )}

      {/* ── Notes ─────────────────────────────────────────────────────── */}
      {caseDoc.notes && (
        <>
          <hr className={styles.divider} aria-hidden="true" />
          <section aria-label="Case notes">
            <h3 className={styles.sectionTitle}>Notes</h3>
            <p className={styles.noteBlock}>{caseDoc.notes}</p>
          </section>
        </>
      )}
    </div>
  );
}
