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
 * Data flow (Sub-AC 3b):
 *   1. `useFedExTracking(caseId)` subscribes to `api.shipping.listShipmentsByCase`
 *      — a real-time Convex query that delivers updates within ~100–300 ms
 *      of any SCAN app `createShipment` mutation.
 *   2. `hasTracking` is derived from the latest shipment record and drives
 *      the conditional rendering gate below.
 *   3. When the user clicks "Refresh", `refreshTracking()` calls the
 *      `api.shipping.trackShipment` action to fetch live data from FedEx.
 *   4. `liveTracking` state overlays the persisted data when available.
 *
 * Displays all historical shipments (full list) at the bottom.
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { StatusPill } from "../StatusPill";
import { useFedExTracking, type ShipmentRecord } from "../../hooks/use-fedex-tracking";
import { useChecklistSummary } from "../../hooks/use-checklist";
import {
  useDamageReportSummary,
  useDamageReportsByCase,
} from "../../hooks/use-damage-reports";
import type { DamageReport } from "../../hooks/use-damage-reports";
import { TrackingStatus } from "../TrackingStatus";
import CustodySection from "./CustodySection";
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

// ─── Active tracking section ──────────────────────────────────────────────────

interface ActiveTrackingProps {
  shipment: ShipmentRecord;
  caseId: string;
}

function ActiveTracking({ shipment, caseId: _caseId }: ActiveTrackingProps) {
  const {
    liveTracking,
    isRefreshing,
    refreshError,
    refreshTracking,
    isActiveShipment,
  } = useFedExTracking(_caseId);

  // Use live tracking data when available, otherwise fall back to persisted
  const effectiveStatus = liveTracking?.status ?? shipment.status;
  const effectiveEta =
    liveTracking?.estimatedDelivery ?? shipment.estimatedDelivery;
  const effectiveEvents = liveTracking?.events ?? [];
  const liveDescription = liveTracking?.description;

  const validStatus = [
    "label_created", "picked_up", "in_transit",
    "out_for_delivery", "delivered", "exception",
  ].includes(effectiveStatus) ? effectiveStatus : "in_transit";

  return (
    <div className={styles.activeTracking} data-testid="active-tracking">
      {/* ── Status header ─────────────────────────────────────────── */}
      <div className={styles.statusHeader}>
        <div className={styles.statusLeft}>
          <span className={styles.carrierLabel}>{shipment.carrier}</span>
          <StatusPill
            kind={validStatus as Parameters<typeof StatusPill>[0]["kind"]}
            filled
          />
        </div>

        {isActiveShipment && (
          <button
            className={[
              shared.ctaButton,
              shared.ctaButtonSecondary,
              styles.refreshBtn,
            ].join(" ")}
            onClick={refreshTracking}
            disabled={isRefreshing}
            aria-label={isRefreshing ? "Refreshing tracking data…" : "Refresh FedEx tracking data"}
          >
            {isRefreshing ? (
              <>
                <span className={shared.spinner} aria-hidden="true" />
                Refreshing…
              </>
            ) : (
              "Refresh"
            )}
          </button>
        )}
      </div>

      {liveDescription && (
        <p className={styles.statusDescription}>{liveDescription}</p>
      )}

      {/* ── Error banner ──────────────────────────────────────────── */}
      {refreshError && (
        <div className={shared.errorBanner} role="alert">
          <span>⚠</span>
          <span>{refreshError}</span>
        </div>
      )}

      {/* ── Tracking details ──────────────────────────────────────── */}
      <dl className={[shared.metaGrid, styles.trackingMeta].join(" ")}>
        <div className={shared.metaItem}>
          <dt className={shared.metaLabel}>Tracking Number</dt>
          <dd className={`${shared.metaValue} ${shared.metaValueMono}`}>
            {shipment.trackingNumber}
          </dd>
        </div>

        {effectiveEta && (
          <div className={shared.metaItem}>
            <dt className={shared.metaLabel}>Est. Delivery</dt>
            <dd className={shared.metaValue}>
              {formatShortDate(effectiveEta)}
            </dd>
          </div>
        )}

        {shipment.originName && (
          <div className={shared.metaItem}>
            <dt className={shared.metaLabel}>Origin</dt>
            <dd className={shared.metaValue}>{shipment.originName}</dd>
          </div>
        )}

        {shipment.destinationName && (
          <div className={shared.metaItem}>
            <dt className={shared.metaLabel}>Destination</dt>
            <dd className={shared.metaValue}>{shipment.destinationName}</dd>
          </div>
        )}

        {shipment.shippedAt && (
          <div className={shared.metaItem}>
            <dt className={shared.metaLabel}>Shipped</dt>
            <dd className={`${shared.metaValue} ${shared.timestamp}`}>
              {formatDate(shipment.shippedAt)}
            </dd>
          </div>
        )}

        {shipment.deliveredAt && (
          <div className={shared.metaItem}>
            <dt className={shared.metaLabel}>Delivered</dt>
            <dd className={`${shared.metaValue} ${shared.timestamp}`}>
              {formatDate(shipment.deliveredAt)}
            </dd>
          </div>
        )}
      </dl>

      {/* ── Live tracking events (from FedEx API refresh) ─────────── */}
      {effectiveEvents.length > 0 && (
        <>
          <hr className={shared.divider} />
          <section aria-label="Tracking events">
            <div className={shared.sectionHeader}>
              <h4 className={shared.sectionTitle}>Tracking Events</h4>
              {liveTracking && (
                <span className={styles.liveBadge} aria-label="Live data from FedEx">
                  Live
                </span>
              )}
            </div>

            <ol className={styles.eventTimeline} aria-label="Shipment scan events">
              {effectiveEvents.map((event, idx) => (
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
                      <span className={`${shared.timestamp} ${styles.eventTime}`}>
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
          </section>
        </>
      )}
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
  // Subscribe to the case document to show basic case context
  const caseDoc = useQuery(api.cases.getCaseById, { caseId });

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

  // Loading state while queries are in flight
  if (caseDoc === undefined || shipments === undefined) {
    return (
      <div className={shared.emptyState} aria-busy="true">
        <div className={shared.spinner} />
      </div>
    );
  }

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
        Sub-AC 3b: The entire tracking UI is gated on `hasTracking`.

        `hasTracking` is derived from the `listShipmentsByCase` Convex query
        result. It is `true` only when at least one shipment with a non-empty
        `trackingNumber` exists for this case.

        The Convex real-time subscription ensures this section appears
        within ~100–300 ms of the SCAN app recording a new shipment.
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
        Sub-AC 36d-3: CustodySection (recent variant) subscribes to
        api.custody.getCustodyRecordsByCase via useCustodyRecordsByCase.
        Shows the most recent 5 custody handoffs (descending order).
        Convex re-evaluates and pushes within ~100–300 ms of any
        handoffCustody mutation — the list updates live without a
        page reload, satisfying the ≤ 2-second real-time fidelity SLA.
        Full chronological chain is available in the T5 Audit panel.
      */}
      <hr className={shared.divider} />
      <CustodySection caseId={caseId} variant="recent" recentLimit={5} />
    </div>
  );
}
