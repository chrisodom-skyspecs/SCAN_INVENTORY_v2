/**
 * T4Shipping — Shipping & Custody Chain Panel
 *
 * Primary FedEx tracking integration point for the INVENTORY dashboard.
 *
 * Conditionally displays tracking status when a tracking number exists:
 *   - TRACKING EXISTS: Full tracking section with status badge, tracking
 *     number, carrier, origin/destination, ETA, tracking events timeline,
 *     and a "Refresh" button to fetch live data from the FedEx Track API.
 *   - NO TRACKING:     Placeholder state informing operators that no
 *     shipment has been recorded yet.
 *
 * Data flow (Sub-AC 3):
 *   1. `useFedExTracking(caseId)` subscribes to `api.shipping.listShipmentsByCase`
 *      — a real-time Convex query that delivers updates within ~100–300 ms
 *      of any SCAN app `createShipment` mutation.
 *   2. `hasTracking` is derived from the latest shipment record and drives
 *      the conditional rendering gate below.
 *   3. When the user clicks "Refresh", `refreshTracking()` calls the
 *      `api.shipping.trackShipment` action to fetch live data from FedEx.
 *   4. `liveTracking` state overlays the persisted data when available.
 *   5. `useCaseShipmentAndCustody(caseId)` — NEW Sub-AC 3 hook — subscribes to
 *      `api["queries/shipment"].getCaseShipmentAndCustody`, a combined query that
 *      returns both the latest shipment AND current custodian in a SINGLE
 *      Convex subscription.  Used to drive the panel summary badges (total
 *      shipments, total handoffs, current custodian name) without a separate
 *      subscription to the custodyRecords table.
 *
 * Displays all historical shipments (full list) at the bottom.
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { StatusPill } from "../StatusPill";
import { useFedExTracking, type ShipmentRecord } from "../../hooks/use-fedex-tracking";
import { useChecklistSummary } from "../../hooks/use-checklist";
import {
  useDamageReportSummary,
  useDamageReportsByCase,
} from "../../hooks/use-damage-reports";
import type { DamageReport } from "../../hooks/use-damage-reports";
import { useCaseShipmentAndCustody } from "../../hooks/use-shipment-status";
import { TrackingStatus } from "../TrackingStatus";
import CustodySection from "./CustodySection";
import { LabelManagementPanel } from "../LabelManagementPanel";
import { useCurrentUser } from "../../hooks/use-current-user";
import { OPERATIONS } from "../../../convex/rbac";
import shared from "./shared.module.css";
import styles from "./T4Shipping.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

interface T4ShippingProps {
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

// ─── Inspection summary banner ────────────────────────────────────────────────
//
// Real-time checklist summary shown at the top of T4.  Operators can see at a
// glance whether the case passed inspection before or after being shipped.
// Uses useChecklistSummary which subscribes to api.checklists.getChecklistSummary
// — Convex re-evaluates the query within ~100–300 ms of any SCAN app item update.

interface InspectionSummaryBannerProps {
  caseId: string;
}

function InspectionSummaryBanner({ caseId }: InspectionSummaryBannerProps) {
  // useChecklistSummary provides real-time aggregate checklist counts.
  // Returns undefined while loading, then a ChecklistSummary object.
  const summary = useChecklistSummary(caseId);

  // Skip render until data arrives (prevents layout shift in Suspense boundary)
  if (summary === undefined || summary.total === 0) return null;

  const hasIssues = summary.damaged > 0 || summary.missing > 0;

  return (
    <section aria-label="Pre-shipment inspection summary" className={styles.inspectionSummary}>
      <div className={shared.sectionHeader}>
        <h3 className={shared.sectionTitle}>Inspection Summary</h3>
        <StatusPill
          kind={
            summary.isComplete
              ? hasIssues ? "flagged" : "completed"
              : "pending"
          }
        />
      </div>

      <div className={shared.progressBar}>
        <div
          className={shared.progressTrack}
          role="progressbar"
          aria-valuenow={summary.progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Inspection progress: ${summary.progressPct}%`}
        >
          <div
            className={[
              shared.progressFill,
              hasIssues ? shared.progressFillDamaged : "",
            ].filter(Boolean).join(" ")}
            style={{ width: `${summary.progressPct}%` }}
          />
        </div>
        <div className={shared.progressMeta}>
          <span>{summary.progressPct}% inspected</span>
          <span>
            {summary.ok > 0 && `${summary.ok} OK`}
            {summary.damaged > 0 && ` · ${summary.damaged} damaged`}
            {summary.missing > 0 && ` · ${summary.missing} missing`}
            {summary.unchecked > 0 && ` · ${summary.unchecked} unchecked`}
          </span>
        </div>
      </div>
    </section>
  );
}

// ─── Damage Reports section ───────────────────────────────────────────────────
//
// Real-time damage reports derived from getDamageReportsByCase + getDamageReportSummary.
// Convex re-evaluates both queries whenever manifestItems or events rows change,
// so this section reflects SCAN submissions within ~100–300 ms.
// Rendered only when at least one item has been marked damaged.

interface DamageReportsSectionProps {
  caseId: string;
}

function DamageReportsSection({ caseId }: DamageReportsSectionProps) {
  // Aggregate summary — drives the header badge and is lightweight.
  const summary = useDamageReportSummary(caseId);

  // Full report list — provides per-item severity and photo evidence.
  const reports = useDamageReportsByCase(caseId);

  // Still loading — render nothing to avoid layout shift.
  if (summary === undefined || reports === undefined) return null;

  // No damage — render nothing (clean slate).
  if (summary.totalDamaged === 0) return null;

  return (
    <section
      aria-label="Damage reports"
      className={styles.damageSection}
      data-testid="t4-damage-section"
    >
      <div className={shared.sectionHeader}>
        <h3 className={shared.sectionTitle}>Damage Reports</h3>
        <StatusPill kind="flagged" />
      </div>

      {/* ── Aggregate counts ───────────────────────────────────────── */}
      <div className={styles.damageCounts}>
        <span className={styles.damageStat}>
          <span className={styles.damageStatVal}>{summary.totalDamaged}</span>
          <span className={styles.damageStatLbl}>damaged</span>
        </span>
        {summary.withPhotos > 0 && (
          <span className={styles.damageStat}>
            <span className={styles.damageStatVal}>{summary.withPhotos}</span>
            <span className={styles.damageStatLbl}>with photos</span>
          </span>
        )}
        {summary.withoutPhotos > 0 && (
          <span className={[styles.damageStat, styles.damageStatWarn].join(" ")}>
            <span className={styles.damageStatVal}>{summary.withoutPhotos}</span>
            <span className={styles.damageStatLbl}>undocumented</span>
          </span>
        )}
        {summary.withNotes > 0 && (
          <span className={styles.damageStat}>
            <span className={styles.damageStatVal}>{summary.withNotes}</span>
            <span className={styles.damageStatLbl}>with notes</span>
          </span>
        )}
      </div>

      {/* ── Per-item damage report list ────────────────────────────── */}
      <ul className={styles.damageList} aria-label="Damaged items">
        {reports.map((report: DamageReport) => (
          <li
            key={report.manifestItemId}
            className={styles.damageItem}
            data-testid="damage-report-item"
          >
            <div className={styles.damageItemHeader}>
              <span className={styles.damageItemName}>{report.itemName}</span>
              {report.severity && (
                <span
                  className={[
                    styles.severityBadge,
                    styles[`severity-${report.severity}`],
                  ].filter(Boolean).join(" ")}
                  aria-label={`Severity: ${report.severity}`}
                >
                  {report.severity}
                </span>
              )}
            </div>

            {/* Metadata row: reporter + timestamp */}
            {(report.reportedByName || report.reportedAt) && (
              <p className={shared.timestamp}>
                {report.reportedByName && (
                  <span>{report.reportedByName}</span>
                )}
                {report.reportedAt && (
                  <span>
                    {report.reportedByName ? " · " : ""}
                    {new Date(report.reportedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </p>
            )}

            {/* Photo count */}
            {report.photoStorageIds.length > 0 && (
              <p className={styles.damagePhotoCount}>
                {report.photoStorageIds.length} photo{report.photoStorageIds.length !== 1 ? "s" : ""}
              </p>
            )}

            {/* Description / notes from damage report event */}
            {report.description && (
              <p className={shared.noteBlock}>{report.description}</p>
            )}
            {!report.description && report.notes && (
              <p className={shared.noteBlock}>{report.notes}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── No-shipment placeholder ──────────────────────────────────────────────────

function NoShipmentPlaceholder() {
  return (
    <div className={shared.emptyState} data-testid="no-shipment-placeholder">
      <svg
        className={shared.emptyStateIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
      <p className={shared.emptyStateTitle}>No shipment recorded</p>
      <p className={shared.emptyStateText}>
        No FedEx tracking number has been entered for this case.
        Field technicians can create a shipment from the SCAN app.
      </p>
    </div>
  );
}

// ─── Historical shipments list ────────────────────────────────────────────────

interface ShipmentHistoryProps {
  shipments: ShipmentRecord[];
  activeId: string;
}

function ShipmentHistory({ shipments, activeId }: ShipmentHistoryProps) {
  if (shipments.length <= 1) return null;

  return (
    <section aria-label="Shipment history">
      <div className={shared.sectionHeader}>
        <h3 className={shared.sectionTitle}>All Shipments</h3>
        <span className={shared.timestamp}>{shipments.length} total</span>
      </div>

      <ul className={styles.historyList} aria-label="Historical shipments">
        {shipments.map((s) => {
          const isActive = s._id === activeId;
          const validStatus = [
            "label_created", "picked_up", "in_transit",
            "out_for_delivery", "delivered", "exception",
          ].includes(s.status) ? s.status : "in_transit";

          return (
            <li
              key={s._id}
              className={[
                styles.historyItem,
                isActive ? styles.historyItemActive : "",
              ].filter(Boolean).join(" ")}
              aria-current={isActive ? "true" : undefined}
            >
              <div className={styles.historyItemHeader}>
                <span className={styles.historyTrackingNum}>
                  {s.trackingNumber}
                </span>
                <StatusPill
                  kind={validStatus as Parameters<typeof StatusPill>[0]["kind"]}
                />
              </div>
              <span className={shared.timestamp}>
                {s.shippedAt ? formatDate(s.shippedAt) : formatDate(s.createdAt)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function T4Shipping({ caseId }: T4ShippingProps) {
  // Permission check — only admin/technician can manage QR labels.
  // Called unconditionally (hook rules) before any early returns.
  const { can } = useCurrentUser();
  const canManageLabels = can(OPERATIONS.QR_CODE_GENERATE);

  // Subscribe to the case document to show basic case context
  const caseDoc = useQuery(api.cases.getCaseById, { caseId: caseId as Id<"cases"> });

  // FedEx tracking integration — the central query for this panel.
  // All values are passed down to the controlled <TrackingStatus variant="full" />
  // to avoid a second Convex subscription for the same caseId.
  const {
    hasTracking,
    latestShipment,
    shipments,
    liveTracking,
    isRefreshing,
    isActiveShipment,
    refreshError,
    refreshTracking,
  } = useFedExTracking(caseId);

  // Sub-AC 3 — Combined shipment + custody subscription from queries/shipment.ts.
  //
  // `useCaseShipmentAndCustody` subscribes to
  // `api["queries/shipment"].getCaseShipmentAndCustody` — a single Convex query
  // that reads BOTH the `shipments` and `custodyRecords` tables and returns:
  //   • latestShipment    — current FedEx tracking status (mirrors useFedExTracking)
  //   • currentCustodian  — the person who most recently received this case
  //   • totalShipments    — aggregate count for the panel summary badge
  //   • totalHandoffs     — aggregate count for the custody section header
  //
  // This combined subscription re-evaluates and pushes to all connected clients
  // within ~100–300 ms of EITHER a new shipment OR a new custody handoff,
  // satisfying the ≤ 2-second real-time fidelity requirement for BOTH data sources.
  //
  // Note: useFedExTracking is still used for the full tracking panel (refresh
  // button, live tracking events) since it includes local state for isRefreshing.
  // useCaseShipmentAndCustody provides the combined reactive counts/summary.
  const combinedStatus = useCaseShipmentAndCustody(caseId);

  // Loading state while queries are in flight
  if (caseDoc === undefined || shipments === undefined) {
    return (
      <div className={shared.emptyState} aria-busy="true">
        <div className={shared.spinner} />
      </div>
    );
  }

  // Derive combined summary values (available once combinedStatus resolves).
  // While combinedStatus is undefined (loading), fall back to derived values
  // from useFedExTracking so the panel renders with existing data immediately.
  const totalShipments = combinedStatus?.totalShipments ?? shipments?.length ?? 0;
  const totalHandoffs  = combinedStatus?.totalHandoffs ?? 0;
  const currentCustodianName = combinedStatus?.currentCustodian?.toUserName;

  return (
    <div className={styles.shipping} data-testid="t4-shipping">
      {/* ── Case context header ───────────────────────────────────── */}
      {caseDoc && (
        <div className={styles.caseContext}>
          <span className={styles.caseContextLabel}>{caseDoc.label}</span>
          <StatusPill
            kind={caseDoc.status as Parameters<typeof StatusPill>[0]["kind"]}
          />
        </div>
      )}

      {/*
        ── Panel summary badges — real-time via useCaseShipmentAndCustody ───
        Sub-AC 3: These aggregate counts are derived from the combined
        `api["queries/shipment"].getCaseShipmentAndCustody` subscription.
        Convex re-evaluates and pushes within ~100–300 ms of any shipment
        or custody handoff mutation from the SCAN app.

        Rendered only when there is data to show (at least one shipment or
        custodian) to avoid empty badge rows.
      */}
      {(totalShipments > 0 || totalHandoffs > 0 || currentCustodianName) && (
        <div
          className={styles.panelSummaryBadges}
          data-testid="t4-summary-badges"
          aria-label="Panel summary"
        >
          {totalShipments > 0 && (
            <span className={styles.summaryBadge}>
              {totalShipments} shipment{totalShipments !== 1 ? "s" : ""}
            </span>
          )}
          {totalHandoffs > 0 && (
            <span className={styles.summaryBadge}>
              {totalHandoffs} handoff{totalHandoffs !== 1 ? "s" : ""}
            </span>
          )}
          {currentCustodianName && (
            <span className={styles.summaryBadge} aria-label={`Currently held by ${currentCustodianName}`}>
              Held by: {currentCustodianName}
            </span>
          )}
        </div>
      )}

      {/* ── Pre-shipment inspection summary — real-time checklist data ── */}
      {/*
        InspectionSummaryBanner subscribes to useChecklistSummary which uses
        api.checklists.getChecklistSummary under the hood. Convex pushes updates
        within ~100–300 ms of any SCAN app item status change — the progress bar
        here reflects the real-time inspection state without a page reload.
      */}
      <InspectionSummaryBanner caseId={caseId} />

      {/*
        ── Damage reports section — real-time via useDamageReportsByCase ───
        Subscribes to getDamageReportsByCase + getDamageReportSummary.
        Convex re-evaluates both queries within ~100–300 ms of any SCAN app
        damage submission (photo upload, severity selection, or notes entry).
        Section is only rendered when at least one item is marked damaged.
      */}
      <DamageReportsSection caseId={caseId} />

      <hr className={shared.divider} />

      {/*
        ── FedEx tracking section ────────────────────────────────────
        Sub-AC 3: The entire tracking UI is gated on `hasTracking`.

        `hasTracking` is derived from the `listShipmentsByCase` Convex query
        result via useFedExTracking. It is `true` only when at least one
        shipment with a non-empty `trackingNumber` exists for this case.

        The Convex real-time subscription ensures this section appears
        within ~100–300 ms of the SCAN app recording a new shipment.

        Additionally, `combinedStatus.latestShipment` from the new
        `getCaseShipmentAndCustody` combined query provides the same
        real-time shipment status data in a single subscription that also
        includes custody information — satisfying Sub-AC 3's requirement
        that FedEx shipment status and custody handoff records update
        in real-time without manual refresh.
      */}
      {!hasTracking || !latestShipment ? (
        <NoShipmentPlaceholder />
      ) : (
        <>
          <section aria-label="Current shipment tracking">
            <div className={shared.sectionHeader}>
              <h3 className={shared.sectionTitle}>Tracking</h3>
            </div>
            {/*
              Sub-AC 3: TrackingStatus in full mode, controlled by the parent
              T4Shipping hook call above. This renders the canonical tracking
              display: status pill, tracking #, current location, ETA, live
              description, refresh button, and events timeline.
            */}
            <TrackingStatus
              caseId={caseId}
              variant="full"
              shipment={latestShipment}
              liveTracking={liveTracking}
              isRefreshing={isRefreshing}
              isActiveShipment={isActiveShipment}
              onRefresh={refreshTracking}
              refreshError={refreshError}
            />
          </section>

          {shipments && shipments.length > 0 && (
            <>
              <hr className={shared.divider} />
              <ShipmentHistory
                shipments={shipments}
                activeId={latestShipment._id}
              />
            </>
          )}
        </>
      )}

      {/* ── Custody history — real-time via useCustodyRecordsByCase ── */}
      {/*
        Sub-AC 3: CustodySection (recent variant) subscribes to
        api.custody.getCustodyRecordsByCase via useCustodyRecordsByCase.
        Shows the most recent 5 custody handoffs (descending order).
        Convex re-evaluates and pushes within ~100–300 ms of any
        handoffCustody mutation — the list updates live without a
        page reload, satisfying the ≤ 2-second real-time fidelity SLA.

        The combined `useCaseShipmentAndCustody` hook above also subscribes
        to custodyRecords for the summary badge (total handoffs, current
        holder name) — two complementary real-time subscriptions covering
        both summary (combined hook) and full history (CustodySection).

        Full chronological chain is available in the T5 Audit panel.
      */}
      <hr className={shared.divider} />
      <CustodySection caseId={caseId} variant="recent" recentLimit={5} />

      {/*
        ── QR Label Management — operator-permission-gated ──────────────
        Sub-AC 2c: LabelManagementPanel mounted in the T4 Shipping layout.
        Rendered only for admin/technician (qrCode:generate permission).
        Passes caseLabel and hasExistingQrCode from the already-loaded
        caseDoc for contextual panel header and generate-flow UI.
        Pilots — who scan QR codes but do not generate them — will not see
        this panel.
      */}
      {canManageLabels && caseDoc && (
        <>
          <hr className={shared.divider} />
          <LabelManagementPanel
            caseId={caseId}
            caseLabel={caseDoc.label}
            hasExistingQrCode={!!caseDoc.qrCode}
          />
        </>
      )}
    </div>
  );
}
