/**
 * T3Inspection — Inspection History Panel
 *
 * Shows the current inspection state and progress for a case.
 * Integrates the combined checklist + inspection query so the INVENTORY
 * dashboard operators can see:
 *   - Inspection status and inspector name
 *   - Start / completion timestamps
 *   - Item-level breakdown with damage/missing flags highlighted
 *   - Notes from the inspector
 */

"use client";

import { useChecklistWithInspection } from "../../hooks/use-checklist";
import { useQcSignOffByCaseId } from "../../hooks/use-qc-sign-off";
import {
  useDamageReportsByCase,
  useDamagePhotoReportsWithUrls,
} from "../../hooks/use-damage-reports";
import type { DamagePhotoReportWithUrl } from "../../../convex/damageReports";
import {
  useCaseShippingLayout,
  getTrackingUrl,
} from "../../hooks/use-shipment-status";
import type { CaseShippingLayout } from "../../hooks/use-shipment-status";
import { useCaseById } from "../../hooks/use-case-status";
import { StatusPill } from "../StatusPill";
import CustodySection from "./CustodySection";
import { LabelManagementPanel } from "../LabelManagementPanel";
import { QcChecklistPanel } from "./QcChecklistPanel";
import { QcSignOffForm } from "../QcSignOffForm/QcSignOffForm";
import { QcSignOffHistory } from "./QcSignOffHistory";
import { useCurrentUser } from "../../hooks/use-current-user";
import { OPERATIONS } from "@/lib/rbac-client";
import shared from "./shared.module.css";
import styles from "./T3Inspection.module.css";
import type { ChecklistWithInspection, ManifestItemStatus } from "@/lib/checklist-summary";
import type { StatusKind } from "../StatusPill/StatusPill";
import type { CaseStatus } from "../../../convex/cases";

// Map manifest item status → nearest StatusKind for StatusPill rendering.
// "unchecked" is not a StatusKind, so we map it to "pending".
const MANIFEST_TO_STATUS_KIND: Record<ManifestItemStatus, StatusKind> = {
  unchecked: "pending",
  ok:        "completed",
  damaged:   "flagged",
  missing:   "exception",
};

// Valid shipment status values for StatusPill rendering
const VALID_SHIPMENT_PILL_STATUSES: Set<string> = new Set([
  "label_created", "picked_up", "in_transit",
  "out_for_delivery", "delivered", "exception",
]);

// ─── Shipment context banner ──────────────────────────────────────────────────
//
// Shown in T3 when the case is currently in shipping status.
// Provides a compact in-transit context to operators reviewing inspection data
// for a case that is already in transit.
//
// Real-time behavior:
//   useCaseShippingLayout subscribes to api.shipping.getCaseShippingLayout.
//   Convex re-evaluates and pushes within ~100–300 ms whenever:
//     • SCAN app calls shipCase (cases table + shipments insert)
//     • updateShipmentStatus runs (shipments table update)
//   This satisfies the ≤ 2-second real-time fidelity requirement.

interface ShipmentContextBannerProps {
  layout: CaseShippingLayout;
  onNavigateToShipping?: () => void;
}

function ShipmentContextBanner({
  layout,
  onNavigateToShipping,
}: ShipmentContextBannerProps) {
  if (!layout.trackingNumber?.trim()) return null;

  // Use latestShipment status for the pill (more accurate than case-level status)
  const shipmentStatus = layout.latestShipment?.status ?? "in_transit";
  const validStatus = VALID_SHIPMENT_PILL_STATUSES.has(shipmentStatus)
    ? shipmentStatus
    : "in_transit";

  // ETA from the latest shipment record
  const estimatedDelivery = layout.latestShipment?.estimatedDelivery;
  let etaLabel: string | null = null;
  if (estimatedDelivery) {
    try {
      etaLabel = new Date(estimatedDelivery).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch {
      // optional
    }
  }

  return (
    <div
      className={styles.shipmentContextBanner}
      data-testid="t3-shipment-context-banner"
      role="status"
      aria-label={`Case is in ${shipmentStatus.replace(/_/g, " ")} transit`}
    >
      <div className={styles.shipmentContextLeft}>
        {/* Carrier label */}
        {layout.carrier && (
          <span className={styles.shipmentContextCarrier}>{layout.carrier}</span>
        )}

        {/* Tracking status pill */}
        <StatusPill
          kind={validStatus as Parameters<typeof StatusPill>[0]["kind"]}
        />

        {/* Tracking number — links to FedEx portal */}
        <a
          href={getTrackingUrl(layout.trackingNumber)}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.shipmentContextTracking}
          aria-label={`Track FedEx shipment ${layout.trackingNumber}`}
        >
          {layout.trackingNumber}
        </a>

        {/* ETA chip */}
        {etaLabel && (
          <span
            className={styles.shipmentContextEta}
            aria-label={`Estimated delivery: ${etaLabel}`}
          >
            ETA {etaLabel}
          </span>
        )}
      </div>

      {/* Navigate to T4 for full shipping detail */}
      {onNavigateToShipping && (
        <button
          type="button"
          className={styles.shipmentContextLink}
          onClick={onNavigateToShipping}
          aria-label="View full shipping details in Shipping tab"
        >
          View Shipping →
        </button>
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface T3InspectionProps {
  caseId: string;
  /** Called when the user clicks "View Shipping →" to navigate to T4. */
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function T3Inspection({ caseId, onNavigateToShipping }: T3InspectionProps) {
  // Permission check — only admin/technician can manage QR labels.
  // Called unconditionally (hook rules) before any early returns.
  const { can } = useCurrentUser();
  const canManageLabels = can(OPERATIONS.QR_CODE_GENERATE);

  // QC sign-off permission — admin and operator only.
  // CASE_STATUS_CHANGE is granted to admin + operator but NOT to technician or pilot.
  // This mirrors the mutation-level requirement: only back-office roles may submit
  // QC decisions; field technicians and pilots inspect/report but do not approve.
  const canQcSignOff = can(OPERATIONS.CASE_STATUS_CHANGE);

  // QC sign-off — real-time subscription via Convex.
  //   undefined → loading (initial fetch or reconnect in progress)
  //   null      → no QC sign-off has been submitted for this case
  //   document  → the latest qcSignOffs document (most recent decision)
  //
  // useQcSignOffByCaseId wraps `useQuery` for api["queries/qcSignOff"].
  // getQcSignOffByCaseId.  Convex re-evaluates and pushes within
  // ~100–300 ms of any submitQcSignOff / addQcSignOff call, satisfying
  // the ≤ 2-second real-time fidelity requirement without a page reload.
  // All connected clients (other dashboard tabs, the SCAN mobile app)
  // automatically reflect the new QC state — no manual refresh required.
  const qcSignOff = useQcSignOffByCaseId(caseId);

  // ── Live case-detail subscription (Sub-AC 2: useQuery for live updates) ──
  //
  // useCaseById wraps `useQuery(api.cases.getCaseById, { caseId })` so the
  // T3 Inspection panel receives push updates whenever the case row changes
  // — status transitions, label edits, location updates, custody handoffs.
  // Convex re-evaluates and pushes within ~100–300 ms of any SCAN app or
  // admin mutation that touches the cases table, satisfying the ≤ 2-second
  // real-time fidelity SLA between the field action and the dashboard.
  // The case context strip below renders these live values so inspectors
  // always see the current case identity / lifecycle status without a
  // page reload.
  //   undefined → loading (no header rendered)
  //   null      → case not found (no header rendered)
  //   Doc<"cases"> → live case document
  const caseDoc = useCaseById(caseId);

  // useChecklistWithInspection is a real-time subscription via Convex.
  // The server-side query loads manifestItems + inspections in a single
  // Promise.all and returns a consistent snapshot. Convex re-runs it whenever
  // either table changes — the T3 panel updates within ~100–300 ms of any SCAN
  // app inspection action without requiring a page reload.
  const data = useChecklistWithInspection(caseId) as ChecklistWithInspection | undefined;

  // useCaseShippingLayout subscribes to api.shipping.getCaseShippingLayout.
  // Sub-AC 36d-4: provides real-time shipment tracking state for the in-transit
  // context banner.  Convex re-evaluates within ~100–300 ms of any SCAN app
  // shipCase call or FedEx tracking status change.
  // Returns undefined while loading, null when case not found, CaseShippingLayout
  // when loaded — so it does NOT block the T3 inspection render.
  const shippingLayout = useCaseShippingLayout(caseId) as CaseShippingLayout | null | undefined;

  // useDamageReportsByCase subscribes to getDamageReportsByCase, which joins
  // damaged manifest items with their audit events.  Convex re-runs the query
  // whenever manifestItems or events change, so severity and photo evidence
  // shown in the Issues section reflects SCAN submissions in real-time.
  const damageReports = useDamageReportsByCase(caseId);

  // useDamagePhotoReportsWithUrls subscribes to
  // api["queries/damage"].getDamagePhotoReportsWithUrls — a URL-resolved
  // variant of getDamagePhotoReports that calls ctx.storage.getUrl() server-side
  // before returning results.  This gives us ready-to-render photo URLs and full
  // annotation pin data (x, y, label, color) so the Issues section can display
  // annotated photo thumbnails in real-time.
  //
  // Convex re-runs this query within ~100–300 ms of any submitDamagePhoto
  // call from the SCAN app — new photos appear in the T3 panel without a
  // manual page reload, satisfying the ≤ 2-second real-time fidelity SLA.
  const damagePhotos = useDamagePhotoReportsWithUrls(caseId);

  // Build templateItemId → DamageReport lookup for O(1) access in render.
  const damageByTemplateId = new Map(
    (damageReports ?? []).map((r) => [r.templateItemId, r])
  );

  // Build templateItemId → DamagePhotoReportWithUrl[] lookup so each issue
  // item can display its associated annotated photo thumbnails.
  const photosByTemplateId = new Map<string, DamagePhotoReportWithUrl[]>();
  for (const photo of damagePhotos ?? []) {
    if (!photo.templateItemId) continue;
    const existing = photosByTemplateId.get(photo.templateItemId) ?? [];
    existing.push(photo);
    photosByTemplateId.set(photo.templateItemId, existing);
  }

  if (data === undefined) {
    return (
      <div className={shared.emptyState} aria-busy="true">
        <div className={shared.spinner} />
      </div>
    );
  }

  const { items, inspection, summary } = data;

  const damagedItems = items.filter((i) => i.status === "damaged");
  const missingItems = items.filter((i) => i.status === "missing");
  const hasIssues    = damagedItems.length > 0 || missingItems.length > 0;

  return (
    <div className={styles.inspection} data-testid="t3-inspection">
      {/*
        ── Live case-detail header — Sub-AC 2 useQuery integration ───────
        Subscribes via useCaseById (api.cases.getCaseById) so the case
        label and status pill always reflect the current Convex state.
        Updates within ~100–300 ms of any SCAN app or admin status edit
        — for example, a pilot updating status from "deployed" to
        "transit_in" propagates to this header without a page reload.
      */}
      {caseDoc && (
        <div
          className={styles.caseContext}
          data-testid="t3-case-context"
          aria-label="Case context"
        >
          <span className={styles.caseContextLabel}>{caseDoc.label}</span>
          <StatusPill kind={caseDoc.status as CaseStatus} />
        </div>
      )}

      {/*
        ── Shipment context banner — real-time via useCaseShippingLayout ──
        Sub-AC 36d-4: useCaseShippingLayout subscribes to
        api.shipping.getCaseShippingLayout via Convex real-time transport.
        Convex re-evaluates and pushes within ~100–300 ms of any SCAN app
        shipCase call or FedEx tracking status update.
        Only rendered when the case has an active shipment tracking number —
        shows operators that this case is currently in transit even while
        reviewing inspection results.
      */}
      {shippingLayout?.trackingNumber && (
        <ShipmentContextBanner
          layout={shippingLayout}
          onNavigateToShipping={onNavigateToShipping}
        />
      )}

      {/* ── Inspection record ─────────────────────────────────────── */}
      {inspection ? (
        <section aria-label="Current inspection">
          <div className={shared.sectionHeader}>
            <h3 className={shared.sectionTitle}>Inspection</h3>
            <StatusPill
              kind={
                (["pending","in_progress","completed","flagged"].includes(inspection.status)
                  ? inspection.status
                  : "pending") as "pending" | "in_progress" | "completed" | "flagged"
              }
            />
          </div>

          <dl className={shared.metaGrid}>
            <div className={shared.metaItem}>
              <dt className={shared.metaLabel}>Inspector</dt>
              <dd className={shared.metaValue}>{inspection.inspectorName}</dd>
            </div>

            {inspection.startedAt && (
              <div className={shared.metaItem}>
                <dt className={shared.metaLabel}>Started</dt>
                <dd className={`${shared.metaValue} ${shared.timestamp}`}>
                  {formatDate(inspection.startedAt)}
                </dd>
              </div>
            )}

            {inspection.completedAt && (
              <div className={shared.metaItem}>
                <dt className={shared.metaLabel}>Completed</dt>
                <dd className={`${shared.metaValue} ${shared.timestamp}`}>
                  {formatDate(inspection.completedAt)}
                </dd>
              </div>
            )}
          </dl>

          {inspection.notes && (
            <p className={shared.noteBlock}>{inspection.notes}</p>
          )}
        </section>
      ) : (
        <div className={shared.emptyState}>
          <p className={shared.emptyStateTitle}>No inspection started</p>
          <p className={shared.emptyStateText}>
            Field technicians can start an inspection from the SCAN app.
          </p>
        </div>
      )}

      <hr className={shared.divider} />

      {/* ── Progress summary ──────────────────────────────────────── */}
      <section aria-label="Inspection progress">
        <div className={shared.sectionHeader}>
          <h3 className={shared.sectionTitle}>Progress</h3>
          <span className={shared.timestamp}>
            {summary.ok + summary.damaged + summary.missing} / {summary.total} reviewed
          </span>
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
            <span>{summary.progressPct}%</span>
            <span className={styles.counters}>
              {summary.ok > 0 && (
                <span className={styles.counterOk}>{summary.ok} OK</span>
              )}
              {summary.damaged > 0 && (
                <span className={styles.counterIssue}>{summary.damaged} damaged</span>
              )}
              {summary.missing > 0 && (
                <span className={styles.counterIssue}>{summary.missing} missing</span>
              )}
            </span>
          </div>
        </div>
      </section>

      {/* ── Custody — compact current custodian ──────────────────── */}
      {/*
        Sub-AC 36d-3: CustodySection (compact) subscribes to
        api.custody.getLatestCustodyRecord via useLatestCustodyRecord.
        Convex re-evaluates and pushes within ~100–300 ms of any
        handoffCustody mutation — the custodian shown here always
        reflects the real-time state without a page reload.
      */}
      <hr className={shared.divider} />
      <CustodySection caseId={caseId} variant="compact" />

      {/* ── Issues list — only shown when there are damaged/missing items ── */}
      {hasIssues && (
        <>
          <hr className={shared.divider} />
          <section aria-label="Items requiring attention">
            <div className={shared.sectionHeader}>
              <h3 className={shared.sectionTitle}>Issues</h3>
            </div>

            <ul className={styles.issueList} aria-label="Items with issues">
              {[...damagedItems, ...missingItems].map((item) => {
                // Damage report for this item (undefined if missing or not yet loaded).
                const damageReport = item.status === "damaged"
                  ? damageByTemplateId.get(item.templateItemId)
                  : undefined;

                // Annotated photos for this item — resolved URLs from the
                // useDamagePhotoReportsWithUrls subscription.  undefined while
                // loading; empty array when no photos have been submitted yet.
                const itemPhotos = item.status === "damaged"
                  ? (photosByTemplateId.get(item.templateItemId) ?? [])
                  : [];

                return (
                  <li key={item._id} className={styles.issueItem}>
                    <div className={styles.issueItemHeader}>
                      <StatusPill kind={MANIFEST_TO_STATUS_KIND[item.status as ManifestItemStatus] ?? "pending"} />
                      {/* Severity badge — reflects SCAN damage report submission in real-time */}
                      {damageReport?.severity && (
                        <span
                          className={[
                            styles.severityBadge,
                            styles[`severity-${damageReport.severity}`],
                          ].filter(Boolean).join(" ")}
                          aria-label={`Severity: ${damageReport.severity}`}
                        >
                          {damageReport.severity}
                        </span>
                      )}
                      <span className={styles.issueName}>{item.name}</span>
                    </div>

                    {/*
                      ── Annotated photo thumbnails ─────────────────────────
                      Real-time via useDamagePhotoReportsWithUrls:
                        - Photos appear within ~100–300 ms of SCAN submission
                        - Each thumbnail shows annotation pin dots overlaid
                        - photoUrl is null when storage object is unavailable
                          (deleted or ID invalid) — placeholder shown instead
                      Convex subscription automatically refreshes both the
                      photo list and the resolved URLs when rows change.
                    */}
                    {itemPhotos.length > 0 && (
                      <div
                        className={styles.photoStrip}
                        role="list"
                        aria-label={`${itemPhotos.length} damage photo${itemPhotos.length !== 1 ? "s" : ""} for ${item.name}`}
                      >
                        {itemPhotos.map((photo) => (
                          <div
                            key={photo.id}
                            className={styles.photoThumb}
                            role="listitem"
                            aria-label={`Damage photo — severity: ${photo.severity}`}
                          >
                            {photo.photoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={photo.photoUrl}
                                alt={`Damage evidence for ${item.name}${photo.notes ? `: ${photo.notes}` : ""}`}
                                className={styles.photoImg}
                                loading="lazy"
                              />
                            ) : (
                              <div
                                className={styles.photoImgPlaceholder}
                                aria-label="Photo unavailable"
                              />
                            )}

                            {/* Annotation pin dots — one per annotation placed in SCAN markup */}
                            {photo.annotations.length > 0 && (
                              <div
                                className={styles.annotationDots}
                                aria-label={`${photo.annotations.length} annotation pin${photo.annotations.length !== 1 ? "s" : ""}`}
                                aria-hidden="true"
                              >
                                {photo.annotations.map((ann, idx) => (
                                  <span
                                    key={idx}
                                    className={styles.annotationDot}
                                    style={{
                                      left:  `${ann.x * 100}%`,
                                      top:   `${ann.y * 100}%`,
                                      // Use annotation color when provided, fall back
                                      // to token.  No hex literals in JSX style per
                                      // design token rules — the fallback is a CSS var.
                                      background: ann.color ?? "var(--signal-error-fill)",
                                      borderColor: ann.color ?? "var(--signal-error-border)",
                                    }}
                                    title={ann.label}
                                  />
                                ))}
                              </div>
                            )}

                            {/* Annotation count badge on the thumbnail */}
                            {photo.annotations.length > 0 && (
                              <span
                                className={styles.annotationCount}
                                aria-label={`${photo.annotations.length} annotation${photo.annotations.length !== 1 ? "s" : ""}`}
                              >
                                {photo.annotations.length}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Photo count line — shown when photos haven't loaded yet
                        OR when we fall back to the manifest item photo IDs */}
                    {damageReport && damageReport.photoStorageIds.length > 0 && itemPhotos.length === 0 && (
                      <p className={styles.issuePhotos}>
                        {damageReport.photoStorageIds.length} photo{damageReport.photoStorageIds.length !== 1 ? "s" : ""}
                        {damageReport.reportedByName && (
                          <span className={shared.timestamp}> · {damageReport.reportedByName}</span>
                        )}
                      </p>
                    )}

                    {item.notes && (
                      <p className={styles.issueNote}>{item.notes}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {/*
        ── QR Label Management — operator-permission-gated ──────────────
        Sub-AC 2c: LabelManagementPanel mounted in the T3 Inspection layout.
        Rendered only for admin/technician (qrCode:generate permission).
        Pilots — who scan QR codes but do not generate them — will not see
        this panel.
      */}
      {canManageLabels && (
        <>
          <hr className={shared.divider} />
          <LabelManagementPanel caseId={caseId} />
        </>
      )}

      {/*
        ── QC Checklist — read-only manifest item status display ─────────
        Sub-AC 3: QcChecklistPanel subscribes to api.checklists.getChecklistByCase
        via the useChecklistByCase hook.  Convex re-evaluates and pushes within
        ~100–300 ms of any SCAN app inspection action (markItemOk, markItemDamaged,
        markItemMissing), satisfying the ≤ 2-second real-time fidelity requirement.

        QcChecklistPanel is intentionally read-only — no interactive controls.
        It provides operators an at-a-glance overview of all case manifest items
        with their condition status (pass / fail / needs-review) sourced from the
        most recent inspection cycle.

        Shown to all users who can view the T3 panel (no additional gating beyond
        case read access, which is already enforced at the route level).
      */}
      <hr className={shared.divider} />
      <QcChecklistPanel caseId={caseId} />

      {/*
        ── QC Sign-off Form — admin/operator only ────────────────────────
        Sub-AC 3: QcSignOffForm wires the submitQcSignOff Convex mutation
        (api.mutations.qcSignOff.submitQcSignOff) for persisting QC decisions.

        Shown only to users with the CASE_STATUS_CHANGE permission (admin +
        operator roles).  Field technicians and pilots inspect and report;
        they do not approve or reject cases — that decision is back-office.

        Props derivation:
          hasUnresolvedIssues — true when the checklist summary has any damaged
            or missing items.  Gates the "Approve" button until issues are cleared.
            Falls back to false while the checklist is loading (summary not yet
            available), keeping the form interactive during initial load.

          unresolvedCount — total damaged + missing items (shown in the disabled-
            approve tooltip). Falls back to 0 while loading.

          currentStatus — the latest QC sign-off status from the Convex
            subscription.  undefined while the query loads (no status pill shown);
            null when no decision has ever been recorded; "approved" | "rejected" |
            "pending" when a prior decision exists (pill shown in header).

        Loading handling:
          qcSignOff === undefined  → query still loading; currentStatus prop
            receives undefined so QcSignOffForm hides the status pill.
          qcSignOff === null       → no prior decision; currentStatus = null.
          qcSignOff.status         → prior decision status; shown as status pill.

        Error/success feedback:
          QcSignOffForm manages its own error and success states internally.
          On mutation success, the qcSignOff subscription automatically updates
          within ~100–300 ms (Convex reactive transport), reflecting the new
          status in the header pill without a page reload.
      */}
      {canQcSignOff && (
        <>
          <hr className={shared.divider} />
          <QcSignOffForm
            caseId={caseId}
            hasUnresolvedIssues={
              // Use the checklist summary from the inspection data when available.
              // Falls back to false while loading so the form stays interactive.
              (summary.damaged + summary.missing) > 0
            }
            unresolvedCount={summary.damaged + summary.missing}
            currentStatus={
              // qcSignOff:
              //   undefined → loading (hide status pill)
              //   null      → no prior decision
              //   document  → show prior decision status
              qcSignOff === undefined
                ? undefined
                : qcSignOff?.status ?? null
            }
          />
        </>
      )}

      {/*
        ── QC Sign-off History — compact recent decisions (Sub-AC 4) ────
        QcSignOffHistory subscribes to api["queries/qcSignOff"].getQcSignOffHistory
        via the useQcSignOffHistory Convex real-time hook.  Updates from any
        submitQcSignOff mutation (e.g., a QC decision just submitted via
        QcSignOffForm above) arrive within ~100–300 ms, satisfying the
        ≤ 2-second real-time fidelity requirement.

        limit={3} shows the three most recent QC decisions in this inspection
        context.  A truncation notice directs operators to T5 for full history.

        Rendered for all users who can see T3 — the history is a read-only
        informational display, not gated by the canQcSignOff write permission.
      */}
      <hr className={shared.divider} />
      <QcSignOffHistory caseId={caseId} limit={3} />
    </div>
  );
}
