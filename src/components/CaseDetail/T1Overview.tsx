/**
 * T1Overview — Case Summary Panel
 *
 * The primary landing view for a selected case in the INVENTORY dashboard.
 * Renders inside T1Shell (50/50 CSS grid) with content split across two
 * equal panels:
 *
 *   Left panel  — interactive Mapbox GL JS mini-map (T1MapPanel):
 *     - React-map-gl Map centred on the case's last-known lat/lng
 *     - Status-colored CSS pin marker at the case location (data-status)
 *     - Location name / coordinate overlay badge
 *     - Responsive fallback placeholders (loading, no-coords, no-token)
 *
 *   Right panel — case identity and operational state:
 *     - Case label, QR code, and current lifecycle status pill
 *     - Key metadata: location, assignee, timestamps
 *     - Custody chain summary (real-time via useLatestCustodyRecord)
 *     - Compact FedEx tracking badge (conditional — shown when tracking exists)
 *     - Checklist progress summary (progress bar + counts)
 *     - Damage summary (conditional — shown when items are marked damaged)
 *     - Notes
 *
 * Map integration (Sub-AC 2):
 *   - T1MapPanel uses react-map-gl (Mapbox GL JS) to render an interactive map.
 *   - The <Marker> is positioned at the case's lat/lng with a CSS pin whose
 *     color is driven by the case status via data-status attribute tokens.
 *   - mapboxToken is read from NEXT_PUBLIC_MAPBOX_TOKEN; when absent, a
 *     styled placeholder with coordinate text is shown instead.
 *   - The map subscribes to getCaseById independently so the pin position
 *     updates in real time via Convex (≤ 2-second fidelity).
 *
 * FedEx tracking integration (Sub-AC 3b):
 *   - Subscribes to `api.shipping.listShipmentsByCase` via `useFedExTracking`.
 *   - The tracking section is ONLY rendered when `hasTracking` is true.
 *   - Shows the carrier, tracking number, status badge, and ETA inline.
 *
 * T1Shell integration:
 *   T1Overview uses T1Shell as its layout container with `leftPanelHasMap={true}`.
 *   This removes the standard padding from the left panel so T1MapPanel can fill
 *   it edge-to-edge (position: absolute; inset: 0).  T1Shell is a 50/50 CSS
 *   grid — each panel takes 1fr (exactly half the available width).  The shell
 *   stacks to a single column at ≤ 48rem viewport width for narrow contexts.
 *   T1Overview is lazy-loaded by CaseDetailPanel when `window === "T1"` — the
 *   shell is therefore automatically part of the T1–T5 router/switcher.
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { StatusPill } from "../StatusPill";
import { useFedExTracking } from "../../hooks/use-fedex-tracking";
import { useChecklistSummary } from "../../queries/checklist";
import { useDamageReportSummary } from "../../hooks/use-damage-reports";
import { TrackingStatus } from "../TrackingStatus";
import CustodySection from "./CustodySection";
import T1Shell from "./T1Shell";
import { T1MapPanel } from "./T1MapPanel";
import { T1TimelinePanel } from "./T1TimelinePanel";
import { InlineStatusEditor } from "./InlineStatusEditor";
import { InlineHolderEditor } from "./InlineHolderEditor";
import { LabelManagementPanel } from "../LabelManagementPanel";
import { QcSignOffHistory } from "./QcSignOffHistory";
import { useCurrentUser } from "../../hooks/use-current-user";
import { OPERATIONS } from "@/lib/rbac-client";
import styles from "./T1Overview.module.css";
import shared from "./shared.module.css";
import type { CaseStatus } from "../../../convex/cases";

// ─── Mapbox token ────────────────────────────────────────────────────────────
//
// Read from the NEXT_PUBLIC_MAPBOX_TOKEN environment variable.
// When absent, T1MapPanel renders a styled placeholder with coordinate text.
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

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
  const caseDoc = useQuery(api.cases.getCaseById, { caseId: caseId as Id<"cases"> });

  // Permission check — only admin/technician can manage QR labels.
  // Called unconditionally (hook rules) before any early returns.
  const { can } = useCurrentUser();
  const canManageLabels = can(OPERATIONS.QR_CODE_GENERATE);

  // FedEx tracking integration — reactive subscription via useFedExTracking.
  // Destructure all values needed by the controlled TrackingStatus below,
  // so we avoid a second Convex subscription for the same caseId.
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
  // Rendered before T1Shell — the body has padding: 0 for T1, so we use
  // the loadingWrapper class to fill the height and center the spinner.
  if (caseDoc === undefined) {
    return (
      <div className={styles.loadingWrapper} aria-busy="true" aria-label="Loading case">
        <div className={shared.spinner} />
      </div>
    );
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (caseDoc === null) {
    return (
      <div className={styles.loadingWrapper} role="alert">
        <p className={shared.emptyStateTitle}>Case not found</p>
        <p className={shared.emptyStateText}>
          This case may have been deleted or the ID is invalid.
        </p>
      </div>
    );
  }

  // ── Left panel content — interactive mini-map (Sub-AC 2) ─────────────────
  //
  // T1MapPanel renders a react-map-gl (Mapbox GL JS) map centred on the
  // case's last-known lat/lng with a status-colored CSS pin marker.
  //
  // The mapboxToken comes from NEXT_PUBLIC_MAPBOX_TOKEN (process.env).
  // When absent, T1MapPanel shows a styled coordinate-text placeholder.
  //
  // T1MapPanel subscribes to getCaseById independently so the pin position
  // updates in real time via the Convex subscription (≤ 2-second fidelity).
  //
  // T1Shell is rendered with leftPanelHasMap={true}, which applies the
  // panelLeftMap CSS class to remove padding and clip overflow — enabling
  // the map canvas (position: absolute; inset: 0) to fill the cell fully.
  const leftPanel = (
    <T1MapPanel
      caseId={caseId}
      mapboxToken={MAPBOX_TOKEN}
    />
  );

  // ── Right panel content — case identity + operational state ───────────────
  //
  // The right panel combines what was previously the "left" (identity info)
  // and "right" (operational state) sub-panels into a single scrollable column.
  // This re-arrangement accommodates the map occupying the full left 50%.
  const rightPanel = (
    <article data-testid="t1-overview-right">
      {/* ── Case header ──────────────────────────────────────────── */}
      {/*
        InlineStatusEditor replaces the static StatusPill to provide a
        click-to-edit dropdown for the case lifecycle status.  Operators
        can click the pencil icon (or navigate via keyboard) to open the
        dropdown, select a new status, and Save.  The Convex mutation is
        called with an optimistic update so the pill reflects the change
        immediately while the server confirms in the background.
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

      {/* ── Key metadata grid ─────────────────────────────────────── */}
      <dl className={shared.metaGrid}>
        {caseDoc.locationName && (
          <div className={shared.metaItem}>
            <dt className={shared.metaLabel}>Location</dt>
            <dd className={shared.metaValue}>{caseDoc.locationName}</dd>
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

      {/* ── Checklist progress ────────────────────────────────────── */}
      <hr className={shared.divider} />
      <ChecklistProgress caseId={caseId} />

      {/* ── Damage summary — real-time via useDamageReportSummary ─── */}
      {/*
        Subscribes to getDamageReportSummary; Convex pushes updates within
        ~100–300 ms of any SCAN app damage submission.  Section is hidden
        when no items are currently marked damaged.
      */}
      <DamageSummarySection caseId={caseId} />

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

      {/*
       * ── T1 Timeline Panel — scrollable vertical event timeline ───────
       *
       * Sub-AC 3: Positioned in the right 50% of the T1 grid.
       * T1TimelinePanel subscribes to getCaseEvents via Convex and
       * maps each event to a TimelineEvent component.  Shows newest-first
       * so the most recent activity is immediately visible.
       *
       * Real-time fidelity: Convex re-evaluates and pushes the updated
       * event list within ~100–300 ms of any SCAN app mutation, satisfying
       * the ≤ 2-second real-time SLA between field action and dashboard.
       *
       * States:
       *   loading — renders skeleton shimmer rows (3 placeholder items)
       *   empty   — renders "No events yet" placeholder with clock icon
       *   loaded  — renders events via TimelineEvent components
       */}
      <hr className={shared.divider} />
      <T1TimelinePanel caseId={caseId} />

      {/*
       * ── QC Sign-off History — compact recent decisions (Sub-AC 4) ────
       *
       * QcSignOffHistory subscribes to api["queries/qcSignOff"].getQcSignOffHistory
       * via useQcSignOffHistory (Convex real-time transport).  Convex re-evaluates
       * and pushes within ~100–300 ms of any submitQcSignOff mutation, satisfying
       * the ≤ 2-second real-time fidelity requirement.
       *
       * limit={3} shows only the three most recent decisions — a compact view
       * appropriate for the T1 summary panel.  A truncation notice directs
       * operators to the T5 Audit panel for the full chronological trail.
       *
       * Rendered for all users with case read access (no additional permission
       * gate needed — QC history is a read-only informational display).
       */}
      <hr className={shared.divider} />
      <QcSignOffHistory caseId={caseId} limit={3} />

      {/*
       * ── QR Label Management — operator-permission-gated ──────────────
       *
       * Sub-AC 2c: LabelManagementPanel is mounted in the appropriate slot
       * of the T1 Summary layout. Rendered only when the current user holds
       * the `qrCode:generate` permission (admin or technician role).
       * Pilots — who scan QR codes but do not generate them — will not see
       * this panel.
       *
       * Passes caseLabel and hasExistingQrCode so the panel header and
       * generate-flow UI can be contextualised to this specific case.
       */}
      {canManageLabels && (
        <>
          <hr className={shared.divider} />
          <LabelManagementPanel
            caseId={caseId}
            caseLabel={caseDoc.label}
            hasExistingQrCode={!!caseDoc.qrCode}
          />
        </>
      )}
    </article>
  );

  // ── Render: 50/50 T1Shell with map left (T1MapPanel) and info right ───────
  //
  // T1Shell renders a CSS grid with grid-template-columns: 1fr 1fr.
  // `leftPanelHasMap={true}` removes padding from the left panel so
  // T1MapPanel's absolutely-positioned canvas fills the cell edge-to-edge.
  // The shell integrates into CaseDetailPanel's T1–T5 router/switcher
  // via T1Overview's lazy import.
  return (
    <T1Shell
      leftPanel={leftPanel}
      rightPanel={rightPanel}
      leftPanelHasMap={true}
    />
  );
}
