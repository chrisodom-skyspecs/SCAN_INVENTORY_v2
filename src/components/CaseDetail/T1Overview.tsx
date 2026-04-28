/**
 * T1Overview — Case Summary Panel
 *
 * The primary landing view for a selected case in the INVENTORY dashboard.
 * Displays:
 *   - Case label and current lifecycle status
 *   - Location (last known) and assignee
 *   - Notes
 *   - Compact FedEx tracking badge — conditionally rendered when a shipment
 *     with a tracking number exists for the case.  Links to T4 for full detail.
 *   - Checklist progress summary (progress bar + counts)
 *   - Last updated timestamp
 *
 * FedEx tracking integration (Sub-AC 3b):
 *   - Subscribes to `api.shipping.listShipmentsByCase` via `useFedExTracking`.
 *   - The tracking section is ONLY rendered when `hasTracking` is true.
 *   - Shows the carrier, tracking number, status badge, and ETA inline.
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { StatusPill } from "../StatusPill";
import { useFedExTracking } from "../../hooks/use-fedex-tracking";
import { useChecklistSummary } from "../../hooks/use-checklist";
import { useDamageReportSummary } from "../../hooks/use-damage-reports";
import { TrackingStatus } from "../TrackingStatus";
import CustodySection from "./CustodySection";
import styles from "./T1Overview.module.css";
import shared from "./shared.module.css";
import type { CaseStatus } from "../../../convex/cases";

// ─── Props ────────────────────────────────────────────────────────────────────

interface T1OverviewProps {
  caseId: string;
  /** Called when the user clicks "View full tracking →" (to switch to T4). */
  onNavigateToShipping?: () => void;
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

// Note: TrackingBanner replaced by shared <TrackingStatus variant="compact" />

// ─── Checklist progress mini-bar ─────────────────────────────────────────────

interface ChecklistProgressProps {
  caseId: string;
}

function ChecklistProgress({ caseId }: ChecklistProgressProps) {
  // useChecklistSummary subscribes via Convex real-time transport.
  // Convex re-runs the underlying getChecklistSummary query whenever any
  // manifestItem row for this case changes — updates arrive within ~100–300 ms
  // of a SCAN app action, satisfying the ≤ 2-second real-time fidelity SLA.
  const summary = useChecklistSummary(caseId);

  if (summary === undefined) return null;
  if (summary.total === 0) return null;

  const hasIssues = summary.damaged > 0 || summary.missing > 0;

  return (
    <div className={styles.checklistProgress}>
      <div className={shared.sectionHeader}>
        <h3 className={shared.sectionTitle}>Checklist</h3>
        <span className={shared.timestamp}>
          {summary.ok + summary.damaged + summary.missing} / {summary.total} reviewed
        </span>
      </div>

      <div className={shared.progressBar}>
        <div className={shared.progressTrack} role="progressbar"
          aria-valuenow={summary.progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Checklist progress: ${summary.progressPct}%`}
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
          <span>{summary.progressPct}% complete</span>
          {summary.damaged > 0 && (
            <span className={styles.issueCount}>
              {summary.damaged} damaged
            </span>
          )}
          {summary.missing > 0 && (
            <span className={styles.issueCount}>
              {summary.missing} missing
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Damage summary section ───────────────────────────────────────────────────
//
// Subscribes to the aggregate damage count via useDamageReportSummary.
// Convex re-evaluates the underlying getDamageReportSummary query whenever
// any manifestItem for this case changes — the damage flag here reflects
// SCAN submissions within ~100–300 ms (≤ 2-second real-time fidelity).
// Rendered only when at least one item is marked damaged.

interface DamageSummarySectionProps {
  caseId: string;
}

function DamageSummarySection({ caseId }: DamageSummarySectionProps) {
  const summary = useDamageReportSummary(caseId);

  // Loading or no damage — render nothing.
  if (summary === undefined || summary.totalDamaged === 0) return null;

  const undocumented = summary.withoutPhotos;

  return (
    <>
      <hr className={shared.divider} />
      <section aria-label="Damage summary" className={styles.damageSummary}>
        <div className={shared.sectionHeader}>
          <h3 className={shared.sectionTitle}>Damage Reports</h3>
          <StatusPill kind="flagged" />
        </div>
        <div className={styles.damageCounts}>
          <span className={styles.damageTotal}>
            {summary.totalDamaged} item{summary.totalDamaged !== 1 ? "s" : ""} damaged
          </span>
          {summary.withPhotos > 0 && (
            <span className={styles.damagePhotos}>
              {summary.withPhotos} with photo{summary.withPhotos !== 1 ? "s" : ""}
            </span>
          )}
          {undocumented > 0 && (
            <span className={styles.damageUnphoto}>
              {undocumented} undocumented
            </span>
          )}
        </div>
      </section>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function T1Overview({
  caseId,
  onNavigateToShipping,
}: T1OverviewProps) {
  // Subscribe to full case document
  const caseDoc = useQuery(api.cases.getCaseById, { caseId });

  // FedEx tracking integration — reactive subscription via useFedExTracking.
  // Destructure all values needed by the controlled TrackingStatus below,
  // so we avoid a second Convex subscription inside the child component.
  const {
    latestShipment,
    hasTracking,
    liveTracking,
    isRefreshing,
    isActiveShipment,
    refreshError,
    refreshTracking,
  } = useFedExTracking(caseId);

  // Loading state
  if (caseDoc === undefined) {
    return (
      <div className={shared.emptyState} aria-busy="true" aria-label="Loading case">
        <div className={shared.spinner} />
      </div>
    );
  }

  // Not found
  if (caseDoc === null) {
    return (
      <div className={shared.emptyState} role="alert">
        <p className={shared.emptyStateTitle}>Case not found</p>
        <p className={shared.emptyStateText}>
          This case may have been deleted or the ID is invalid.
        </p>
      </div>
    );
  }

  return (
    <article className={styles.overview} data-testid="t1-overview">
      {/* ── Case header ──────────────────────────────────────────── */}
      <div className={shared.caseHeader}>
        <div>
          <h2 className={shared.caseLabel}>{caseDoc.label}</h2>
          {caseDoc.qrCode && (
            <p className={shared.caseLabelSub}>QR: {caseDoc.qrCode}</p>
          )}
        </div>
        <StatusPill kind={caseDoc.status as CaseStatus} filled />
      </div>

      {/* ── Key metadata grid ─────────────────────────────────────── */}
      <dl className={shared.metaGrid}>
        {caseDoc.locationName && (
          <div className={shared.metaItem}>
            <dt className={shared.metaLabel}>Location</dt>
            <dd className={shared.metaValue}>{caseDoc.locationName}</dd>
          </div>
        )}

        {caseDoc.assigneeName && (
          <div className={shared.metaItem}>
            <dt className={shared.metaLabel}>Assigned to</dt>
            <dd className={shared.metaValue}>{caseDoc.assigneeName}</dd>
          </div>
        )}

        <div className={shared.metaItem}>
          <dt className={shared.metaLabel}>Last updated</dt>
          <dd className={`${shared.metaValue} ${shared.timestamp}`}>
            {formatDate(caseDoc.updatedAt)}
          </dd>
        </div>

        <div className={shared.metaItem}>
          <dt className={shared.metaLabel}>Created</dt>
          <dd className={`${shared.metaValue} ${shared.timestamp}`}>
            {formatDate(caseDoc.createdAt)}
          </dd>
        </div>
      </dl>

      {/* ── Custody section — real-time via useLatestCustodyRecord ─── */}
      {/*
        Sub-AC 36d-3: CustodySection (compact variant) subscribes to
        api.custody.getLatestCustodyRecord via useLatestCustodyRecord.
        Convex pushes an update within ~100–300 ms of any handoffCustody
        mutation, so the "Currently held by" display updates live without
        a page reload, satisfying the ≤ 2-second real-time fidelity SLA.
      */}
      <hr className={shared.divider} />
      <CustodySection caseId={caseId} variant="compact" />

      {/* ── FedEx tracking section — conditionally rendered ─────── */}
      {/*
        Sub-AC 3b: Only rendered when `hasTracking` is true.
        `hasTracking` is derived from `listShipmentsByCase` — it becomes
        true as soon as any shipment with a tracking number is recorded for
        this case in the Convex database.
      */}
      {hasTracking && latestShipment && (
        <>
          <hr className={shared.divider} />
          <section aria-label="Shipment tracking summary">
            <div className={shared.sectionHeader}>
              <h3 className={shared.sectionTitle}>Shipment Tracking</h3>
            </div>
            {/*
              Sub-AC 3: TrackingStatus in compact mode wired to Convex via
              controlled props (parent already called useFedExTracking above).
              Avoids a duplicate Convex subscription for the same caseId.
            */}
            <TrackingStatus
              caseId={caseId}
              variant="compact"
              shipment={latestShipment}
              liveTracking={liveTracking}
              isRefreshing={isRefreshing}
              isActiveShipment={isActiveShipment}
              onRefresh={refreshTracking}
              refreshError={refreshError}
              onViewDetails={onNavigateToShipping}
            />
          </section>
        </>
      )}

      {/* ── Notes ─────────────────────────────────────────────────── */}
      {caseDoc.notes && (
        <>
          <hr className={shared.divider} />
          <section aria-label="Case notes">
            <div className={shared.sectionHeader}>
              <h3 className={shared.sectionTitle}>Notes</h3>
            </div>
            <p className={shared.noteBlock}>{caseDoc.notes}</p>
          </section>
        </>
      )}

      <hr className={shared.divider} />

      {/* ── Checklist progress ────────────────────────────────────── */}
      <ChecklistProgress caseId={caseId} />

      {/* ── Damage summary — real-time via useDamageReportSummary ─── */}
      {/*
        Subscribes to getDamageReportSummary; Convex pushes updates within
        ~100–300 ms of any SCAN app damage submission.  Section is hidden
        when no items are currently marked damaged.
      */}
      <DamageSummarySection caseId={caseId} />
    </article>
  );
}
