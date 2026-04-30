/**
 * DossierOverviewPanel — Overview tab content for the T4 Tabbed Dossier.
 *
 * Rendered in the "Overview" tab of T4DossierShell (used under the
 * FF_INV_REDESIGN code path).  Provides a consolidated at-a-glance view of
 * a case's key operational data:
 *
 *   Stats row      — Total items, OK count, Damaged count, Missing count;
 *                    derived in real-time from useChecklistSummary.
 *   Case header    — Case label, QR code reference, and current StatusPill.
 *   Key metadata   — Location, assignee, created/updated timestamps.
 *   Custody        — Current custodian via CustodySection "compact" variant;
 *                    real-time from useLatestCustodyRecord (Convex).
 *   FedEx tracking — Compact badge rendered only when hasTracking is true;
 *                    links to Shipping tab via onNavigateToShipping callback.
 *   Notes          — Free-text notes block when present on the case doc.
 *
 * Real-time fidelity:
 *   All data subscriptions run through Convex reactive queries.  Updates from
 *   the SCAN app (inspection completions, custody handoffs, damage reports)
 *   arrive within ~100–300 ms, satisfying the ≤ 2-second real-time SLA.
 *
 * Design-system compliance:
 *   - No hex literals — CSS custom properties only.
 *   - Inter Tight for all UI typography.
 *   - IBM Plex Mono for timestamps and case identifiers.
 *   - StatusPill for all status indicators.
 *   - WCAG AA contrast in both light and dark themes.
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { StatusPill } from "../StatusPill";
import { useChecklistSummary } from "../../queries/checklist";
import { useFedExTracking } from "../../hooks/use-fedex-tracking";
import { TrackingStatus } from "../TrackingStatus";
import CustodySection from "./CustodySection";
import { InlineStatusEditor } from "./InlineStatusEditor";
import { InlineHolderEditor } from "./InlineHolderEditor";
import { QcSignOffHistory } from "./QcSignOffHistory";
import shared from "./shared.module.css";
import styles from "./DossierOverviewPanel.module.css";
import type { CaseStatus } from "../../../convex/cases";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DossierOverviewPanelProps {
  /** Convex document ID for the case to display. */
  caseId: string;
  /**
   * Called when the user clicks "View full tracking →" in the FedEx badge.
   * Parent typically switches the dossier to the "timeline" or a shipping tab.
   */
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

// ─── Stat card ────────────────────────────────────────────────────────────────
//
// A single numeric stat in the summary row (total items, ok, damaged, missing).
// Color-coded by variant so "damaged" and "missing" stand out visually.

interface StatCardProps {
  label: string;
  value: number | string;
  variant?: "default" | "ok" | "damaged" | "missing" | "neutral";
  loading?: boolean;
}

function StatCard({ label, value, variant = "default", loading = false }: StatCardProps) {
  const variantClass =
    variant === "ok"
      ? styles.statCardOk
      : variant === "damaged"
      ? styles.statCardDamaged
      : variant === "missing"
      ? styles.statCardMissing
      : variant === "neutral"
      ? styles.statCardNeutral
      : "";

  return (
    <div
      className={[styles.statCard, variantClass].filter(Boolean).join(" ")}
      aria-label={`${label}: ${loading ? "loading" : value}`}
    >
      <span className={styles.statValue}>
        {loading ? (
          <span className={styles.statSkeleton} aria-hidden="true" />
        ) : (
          value
        )}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

// ─── Checklist stats row ─────────────────────────────────────────────────────
//
// Subscribes to useChecklistSummary (lightweight aggregate).  Renders a 4-card
// stats row showing Total, OK, Damaged, Missing item counts.
// The "assigned items count" required by the spec is the `total` field here —
// it represents the number of items assigned to (loaded into) the case
// manifest via its associated case template.

interface ChecklistStatsRowProps {
  caseId: string;
}

function ChecklistStatsRow({ caseId }: ChecklistStatsRowProps) {
  const summary = useChecklistSummary(caseId);

  const isLoading = summary === undefined;
  const total = summary?.total ?? 0;
  const ok = summary?.ok ?? 0;
  const damaged = summary?.damaged ?? 0;
  const missing = summary?.missing ?? 0;

  return (
    <div
      className={styles.statsRow}
      role="group"
      aria-label="Case item counts"
      data-testid="dossier-overview-stats"
    >
      <StatCard
        label="Total Items"
        value={total}
        variant="neutral"
        loading={isLoading}
      />
      <StatCard
        label="OK"
        value={ok}
        variant={ok > 0 ? "ok" : "default"}
        loading={isLoading}
      />
      <StatCard
        label="Damaged"
        value={damaged}
        variant={damaged > 0 ? "damaged" : "default"}
        loading={isLoading}
      />
      <StatCard
        label="Missing"
        value={missing}
        variant={missing > 0 ? "missing" : "default"}
        loading={isLoading}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * DossierOverviewPanel — the Overview tab content for T4DossierShell.
 *
 * Composes multiple real-time Convex subscriptions to render a unified
 * at-a-glance summary of a case's current operational state.
 */
export function DossierOverviewPanel({
  caseId,
  onNavigateToShipping,
}: DossierOverviewPanelProps) {
  // Subscribe to the full case document
  const caseDoc = useQuery(api.cases.getCaseById, {
    caseId: caseId as Id<"cases">,
  });

  // FedEx tracking — reactive subscription via useFedExTracking.
  // All values destructured here so we avoid a duplicate subscription
  // downstream in the compact TrackingStatus.
  const {
    latestShipment,
    hasTracking,
    liveTracking,
    isRefreshing,
    isActiveShipment,
    refreshError,
    refreshTracking,
  } = useFedExTracking(caseId);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (caseDoc === undefined) {
    return (
      <div
        className={styles.loadingWrapper}
        aria-busy="true"
        aria-label="Loading case overview"
        data-testid="dossier-overview-loading"
      >
        <div className={shared.spinner} />
      </div>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (caseDoc === null) {
    return (
      <div
        className={styles.loadingWrapper}
        role="alert"
        data-testid="dossier-overview-not-found"
      >
        <p className={shared.emptyStateTitle}>Case not found</p>
        <p className={shared.emptyStateText}>
          This case may have been deleted or the ID is invalid.
        </p>
      </div>
    );
  }

  return (
    <article
      className={styles.panel}
      data-testid="dossier-overview-panel"
      aria-label="Case overview"
    >
      {/* ── Case header ─────────────────────────────────────────────── */}
      {/*
       * Case label, QR code reference, and InlineStatusEditor for current
       * lifecycle status.  The label uses IBM Plex Mono per the design spec.
       * InlineStatusEditor wraps the StatusPill with a click-to-edit pencil
       * icon — on click it opens a dropdown selector, Save, and Cancel.
       * The Convex mutation applies an optimistic update so the pill reflects
       * the new status immediately on Save.
       */}
      <div className={shared.caseHeader}>
        <div>
          <h2 className={shared.caseLabel}>{caseDoc.label}</h2>
          {caseDoc.qrCode && (
            <p className={shared.caseLabelSub}>QR: {caseDoc.qrCode}</p>
          )}
        </div>
        <InlineStatusEditor
          caseId={caseId}
          currentStatus={caseDoc.status as CaseStatus}
        />
      </div>

      {/* ── Checklist stats row ──────────────────────────────────────── */}
      {/*
       * The primary "assigned items count" display.  Total Items = the count
       * of manifest items assigned to this case via its template.  OK, Damaged,
       * Missing break down the current inspection state in real-time.
       *
       * Real-time fidelity: useChecklistSummary subscribes to Convex and
       * re-evaluates within ~100–300 ms of any SCAN app inspection action.
       */}
      <ChecklistStatsRow caseId={caseId} />

      {/* ── Key metadata grid ────────────────────────────────────────── */}
      {/*
       * Location, assignee, and timestamps in a responsive grid.
       * Grid collapses from multi-column to single-column at narrow widths.
       */}
      <dl className={shared.metaGrid}>
        {caseDoc.locationName && (
          <div className={shared.metaItem}>
            <dt className={shared.metaLabel}>Location</dt>
            <dd className={shared.metaValue}>{caseDoc.locationName}</dd>
          </div>
        )}

        {caseDoc.lat !== undefined && caseDoc.lng !== undefined && (
          <div className={shared.metaItem}>
            <dt className={shared.metaLabel}>Coordinates</dt>
            <dd className={`${shared.metaValue} ${shared.metaValueMono}`}>
              {caseDoc.lat.toFixed(4)}, {caseDoc.lng.toFixed(4)}
            </dd>
          </div>
        )}

        <div className={shared.metaItem}>
          <dt className={shared.metaLabel}>Assigned to</dt>
          <dd className={shared.metaValue}>
            <InlineHolderEditor
              caseId={caseId}
              currentHolder={caseDoc.assigneeName}
            />
          </dd>
        </div>

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

      {/* ── Custody section ─────────────────────────────────────────── */}
      {/*
       * Real-time custody display via CustodySection (compact variant).
       * Subscribes to api.custody.getLatestCustodyRecord; Convex pushes
       * the update within ~100–300 ms of any handoffCustody mutation.
       * Shows current holder + time of receipt.
       */}
      <hr className={shared.divider} />
      <CustodySection caseId={caseId} variant="compact" />

      {/* ── FedEx tracking badge ─────────────────────────────────────── */}
      {/*
       * Only rendered when hasTracking is true (i.e., a shipment record with
       * a tracking number exists for this case).  Renders a compact inline
       * summary with a "View full tracking →" link to switch to the Shipping
       * tab via the onNavigateToShipping callback.
       */}
      {hasTracking && latestShipment && (
        <>
          <hr className={shared.divider} />
          <section aria-label="Shipment tracking summary">
            <div className={shared.sectionHeader}>
              <h3 className={shared.sectionTitle}>Shipment Tracking</h3>
            </div>
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

      {/* ── Notes ───────────────────────────────────────────────────── */}
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

      {/*
       * ── QC Sign-off History — compact recent decisions (Sub-AC 4) ───
       *
       * QcSignOffHistory subscribes to api["queries/qcSignOff"].getQcSignOffHistory
       * via the useQcSignOffHistory Convex real-time hook.  Convex re-evaluates
       * and pushes within ~100–300 ms of any submitQcSignOff mutation, satisfying
       * the ≤ 2-second real-time fidelity requirement between SCAN app actions
       * and the INVENTORY dashboard.
       *
       * limit={3} shows the three most recent QC decisions in this overview
       * context.  A truncation notice directs operators to the T5 Audit panel
       * for the full chronological sign-off trail.
       *
       * Rendered for all users — the QC history is a read-only informational
       * display, not gated by the write-level canQcSignOff permission.
       */}
      <hr className={shared.divider} />
      <QcSignOffHistory caseId={caseId} limit={3} />
    </article>
  );
}

export default DossierOverviewPanel;
