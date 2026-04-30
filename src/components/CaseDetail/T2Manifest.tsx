/**
 * T2Manifest — Manifest / Packing List Panel
 *
 * Displays the full packing list (manifest items) for a case in a tabular
 * layout with equipment item list, quantity/status columns, and checklist data.
 *
 * Layout
 * ──────
 *   [ShipmentStatusBanner]       — compact in-transit indicator (when applicable)
 *   [Progress bar]               — aggregate review progress (reviewed / total)
 *   [Filter bar]                 — filter by status: All / Unchecked / OK / Damaged / Missing
 *   [Column headers: Item | Qty | Status]
 *   [Item rows]                  — name column + qty column (1×) + status pill column
 *     [Damage severity badge]    — when item.status === "damaged"
 *     [Photo count line]         — when damage photos have been submitted
 *     [Notes]                    — technician free-text notes
 *     [Attribution timestamp]    — checker name + date
 *   [Custody section]            — compact current-custodian row
 *
 * Data flow (real-time via Convex)
 * ─────────────────────────────────
 * • useChecklistWithInspection   — manifest items + inspection record + summary
 * • useDamageReportsByCase       — damage severity + photo counts per item
 * • useLatestShipment            — shipment status for the transit banner
 *
 * Convex re-evaluates all three queries within ~100–300 ms of any SCAN app
 * action (check-in, item update, damage photo, ship), satisfying the ≤ 2-second
 * real-time fidelity requirement between field action and dashboard visibility.
 *
 * Quantity column
 * ───────────────
 * The packing list schema stores one `manifestItems` row per physical unit —
 * each template item maps to exactly one manifest item, so the expected
 * quantity is always 1.  The "Qty" column displays "1×" per item, making the
 * manifest read like a proper equipment manifest rather than a flat checklist.
 *
 * Props
 * ─────
 *   caseId              — Convex document ID of the case to display.
 *   onNavigateToShipping — optional callback fired when the user clicks
 *                          "View Shipping →" to jump to the T4 Shipping tab.
 */

"use client";

import { useState } from "react";
import { useChecklistWithInspection } from "../../queries/checklist";
import { useDamageReportsByCase } from "../../hooks/use-damage-reports";
import {
  useLatestShipment,
  getTrackingUrl,
} from "../../hooks/use-shipment-status";
import type { ShipmentRecord } from "../../hooks/use-shipment-status";
import { useCaseById } from "../../hooks/use-case-status";
import { StatusPill } from "../StatusPill";
import CustodySection from "./CustodySection";
import { LabelManagementPanel } from "../LabelManagementPanel";
import { QcSignOffHistory } from "./QcSignOffHistory";
import { useCurrentUser } from "../../hooks/use-current-user";
import { OPERATIONS } from "@/lib/rbac-client";
import shared from "./shared.module.css";
import styles from "./T2Manifest.module.css";
import type { ManifestItemStatus, ChecklistWithInspection } from "../../queries/checklist";
import type { StatusKind } from "../StatusPill/StatusPill";
import type { CaseStatus } from "../../../convex/cases";

// ─── Props ────────────────────────────────────────────────────────────────────

interface T2ManifestProps {
  caseId: string;
  /** Called when the user clicks "View Shipping Details →" to navigate to T4. */
  onNavigateToShipping?: () => void;
}

// ─── Shipment status banner ───────────────────────────────────────────────────
//
// Compact in-transit indicator shown at the top of T2 when a shipment with a
// tracking number has been recorded for this case.
//
// Real-time behavior:
//   useLatestShipment subscribes to api.shipping.listShipmentsByCase via Convex.
//   Convex re-evaluates and pushes an update within ~100–300 ms whenever:
//     • The SCAN app calls shipCase (new shipment row inserted)
//     • updateShipmentStatus changes a shipment's status (tracking poll result)
//   This satisfies the ≤ 2-second real-time fidelity requirement between a
//   SCAN app action and visibility on the INVENTORY dashboard.

const VALID_PILL_STATUSES: Set<string> = new Set([
  "label_created", "picked_up", "in_transit",
  "out_for_delivery", "delivered", "exception",
]);

interface ShipmentStatusBannerProps {
  caseId: string;
  onNavigateToShipping?: () => void;
}

function ShipmentStatusBanner({
  caseId,
  onNavigateToShipping,
}: ShipmentStatusBannerProps) {
  // useLatestShipment is a real-time Convex subscription backed by
  // api.shipping.listShipmentsByCase.  Updates arrive within ~100–300 ms of any
  // SCAN app shipCase call or FedEx tracking status change.
  const shipment: ShipmentRecord | null | undefined = useLatestShipment(caseId);

  // Still loading or no shipment — render nothing
  if (!shipment || !shipment.trackingNumber?.trim()) return null;

  const validStatus = VALID_PILL_STATUSES.has(shipment.status)
    ? shipment.status
    : "in_transit";

  // Build a short ETA label when estimatedDelivery is present
  let etaLabel: string | null = null;
  if (shipment.estimatedDelivery) {
    try {
      etaLabel = new Date(shipment.estimatedDelivery).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch {
      // ignore parse errors — ETA is optional
    }
  }

  return (
    <div
      className={styles.shipmentBanner}
      data-testid="t2-shipment-banner"
      role="status"
      aria-label={`Case is in ${shipment.status.replace(/_/g, " ")} transit`}
    >
      <div className={styles.shipmentBannerLeft}>
        {/* Carrier label */}
        <span className={styles.shipmentBannerLabel}>{shipment.carrier}</span>

        {/* Tracking status pill — uses the shared <StatusPill /> component */}
        <StatusPill
          kind={validStatus as Parameters<typeof StatusPill>[0]["kind"]}
        />

        {/* Tracking number — monospace, links to FedEx portal */}
        <a
          href={getTrackingUrl(shipment.trackingNumber)}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.shipmentBannerTracking}
          aria-label={`Track FedEx shipment ${shipment.trackingNumber}`}
        >
          {shipment.trackingNumber}
        </a>

        {/* ETA chip — shown when an estimated delivery date is known */}
        {etaLabel && (
          <span className={styles.shipmentBannerEta} aria-label={`Estimated delivery: ${etaLabel}`}>
            ETA {etaLabel}
          </span>
        )}
      </div>

      {/* "View Shipping →" navigation link to T4 */}
      {onNavigateToShipping && (
        <button
          type="button"
          className={styles.shipmentBannerLink}
          onClick={onNavigateToShipping}
          aria-label="View full shipping details"
        >
          View Shipping →
        </button>
      )}
    </div>
  );
}

// ─── Filter config ────────────────────────────────────────────────────────────

type FilterKind = "all" | ManifestItemStatus;

const FILTERS: { id: FilterKind; label: string }[] = [
  { id: "all",       label: "All" },
  { id: "unchecked", label: "Unchecked" },
  { id: "ok",        label: "OK" },
  { id: "damaged",   label: "Damaged" },
  { id: "missing",   label: "Missing" },
];

// ─── Status to StatusKind mapping ────────────────────────────────────────────
// ManifestItemStatus includes "unchecked" which is not a StatusKind.
// Map to the nearest semantic signal equivalent for StatusPill.

const MANIFEST_STATUS_KIND: Record<ManifestItemStatus, StatusKind> = {
  unchecked: "pending",    // neutral — not yet inspected
  ok:        "completed",  // success — item is present and undamaged
  damaged:   "flagged",    // error   — item requires attention
  missing:   "exception",  // error   — item is absent
};

/**
 * Human-readable status labels for aria attributes and screen readers.
 * These are the user-facing terms that operators and technicians see.
 */
const MANIFEST_STATUS_LABEL: Record<ManifestItemStatus, string> = {
  unchecked: "Unchecked",
  ok:        "Verified",
  damaged:   "Flagged",
  missing:   "Missing",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function T2Manifest({ caseId, onNavigateToShipping }: T2ManifestProps) {
  const [filter, setFilter] = useState<FilterKind>("all");

  // Permission check — only admin/technician can manage QR labels.
  // Called unconditionally (hook rules) before any early returns.
  const { can } = useCurrentUser();
  const canManageLabels = can(OPERATIONS.QR_CODE_GENERATE);

  // ── Live case-detail subscription (Sub-AC 2: useQuery for live updates) ──
  //
  // useCaseById wraps `useQuery(api.cases.getCaseById, { caseId })` so the
  // T2 Manifest panel receives push updates whenever the case row changes
  // — status transitions, custody handoffs, location updates, label edits.
  // Convex re-evaluates and pushes within ~100–300 ms of any SCAN app
  // mutation that touches the cases table, satisfying the ≤ 2-second
  // real-time fidelity SLA.  The case header below uses these live values
  // so operators always see the current case identity / status without a
  // page reload.  Returns:
  //   undefined → loading (no header rendered)
  //   null      → not found (no header rendered)
  //   Doc<"cases"> → live case document
  const caseDoc = useCaseById(caseId);

  // useChecklistWithInspection is a real-time subscription via Convex.
  // Convex re-runs getChecklistWithInspection whenever any manifestItem or
  // inspections row for this case changes — the T2 manifest view updates
  // within ~100–300 ms of a SCAN app action without requiring a page reload.
  const checklistData = useChecklistWithInspection(caseId) as ChecklistWithInspection | undefined;

  // useDamageReportsByCase subscribes to getDamageReportsByCase — a real-time
  // query joining damaged manifest items with their audit events.  Convex
  // re-runs it whenever manifestItems or events rows for this case change,
  // so the photo count and severity badges here reflect the latest SCAN
  // submissions within ~100–300 ms (≤ 2-second real-time fidelity).
  const damageReports = useDamageReportsByCase(caseId);

  // Build a lookup map: templateItemId → DamageReport for O(1) access in
  // the item list render loop below.  Undefined while the query is loading;
  // empty map when no items are damaged.
  const damageByTemplateId = new Map(
    (damageReports ?? []).map((r) => [r.templateItemId, r])
  );

  // Loading
  if (checklistData === undefined) {
    return (
      <div className={shared.emptyState} aria-busy="true" data-testid="t2-manifest-loading">
        <div className={shared.spinner} />
      </div>
    );
  }

  const { items, summary } = checklistData;

  // No items
  if (items.length === 0) {
    return (
      <div className={styles.manifest} data-testid="t2-manifest">
        {/*
          ── Live case-detail header — Sub-AC 2 useQuery integration ───────
          Subscribes via useCaseById (api.cases.getCaseById) so the case
          label and status pill always reflect the current Convex state.
          Updates within ~100–300 ms of any SCAN app or admin status edit.
          Hidden while caseDoc is loading (undefined) or not found (null).
        */}
        {caseDoc && (
          <div
            className={styles.caseContext}
            data-testid="t2-case-context"
            aria-label="Case context"
          >
            <span className={styles.caseContextLabel}>{caseDoc.label}</span>
            <StatusPill kind={caseDoc.status as CaseStatus} />
          </div>
        )}
        {/*
          ── Shipment status banner — real-time via useLatestShipment ──────
          Shown even when no items exist — the case could be in transit
          without a completed template application.
        */}
        <ShipmentStatusBanner
          caseId={caseId}
          onNavigateToShipping={onNavigateToShipping}
        />
        <div className={shared.emptyState}>
          <p className={shared.emptyStateTitle}>No manifest items</p>
          <p className={shared.emptyStateText}>
            Apply a case template to define the expected packing list.
          </p>
        </div>
        <hr className={shared.divider} />
        <div className={styles.custodyRow}>
          <CustodySection caseId={caseId} variant="compact" />
        </div>

        {/*
          ── QC Sign-off History — compact recent decisions (Sub-AC 4) ────
          QcSignOffHistory subscribes to api["queries/qcSignOff"].getQcSignOffHistory
          via the useQcSignOffHistory Convex real-time hook.  Updates from any
          submitQcSignOff mutation arrive within ~100–300 ms, satisfying the
          ≤ 2-second real-time fidelity requirement between SCAN app actions
          and the INVENTORY dashboard.

          limit={3} shows the three most recent QC decisions; a truncation
          notice directs operators to the T5 Audit panel for the full trail.
        */}
        <hr className={shared.divider} />
        <QcSignOffHistory caseId={caseId} limit={3} />

        {/*
          ── QR Label Management — operator-permission-gated ──────────────
          Sub-AC 2c: LabelManagementPanel mounted in the T2 Manifest layout.
          Rendered only for admin/technician (qrCode:generate permission).
        */}
        {canManageLabels && (
          <>
            <hr className={shared.divider} />
            <LabelManagementPanel caseId={caseId} />
          </>
        )}
      </div>
    );
  }

  const filteredItems = filter === "all"
    ? items
    : items.filter((item) => item.status === filter);

  return (
    <div className={styles.manifest} data-testid="t2-manifest">
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
          data-testid="t2-case-context"
          aria-label="Case context"
        >
          <span className={styles.caseContextLabel}>{caseDoc.label}</span>
          <StatusPill kind={caseDoc.status as CaseStatus} />
        </div>
      )}
      {/*
        ── Shipment status banner — real-time via useLatestShipment ──────
        Sub-AC 36d-4: useLatestShipment subscribes to
        api.shipping.listShipmentsByCase via Convex real-time transport.
        Convex re-evaluates and pushes within ~100–300 ms of any SCAN app
        shipCase call or FedEx tracking status update — the banner
        appears/updates live without a page reload.
        Only rendered when the case has a recorded shipment with a tracking number.
      */}
      <ShipmentStatusBanner
        caseId={caseId}
        onNavigateToShipping={onNavigateToShipping}
      />

      {/* ── Progress bar ─────────────────────────────────────────── */}
      <div className={styles.progressSection}>
        <div className={shared.sectionHeader}>
          <h3 className={shared.sectionTitle}>Packing List</h3>
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
            aria-label={`Packing list progress: ${summary.progressPct}%`}
          >
            <div
              className={[
                shared.progressFill,
                (summary.damaged > 0 || summary.missing > 0)
                  ? shared.progressFillDamaged
                  : "",
              ].filter(Boolean).join(" ")}
              style={{ width: `${summary.progressPct}%` }}
            />
          </div>
          <div className={shared.progressMeta}>
            <span>{summary.progressPct}% reviewed</span>
            <span>
              {[
                summary.ok      > 0 && `${summary.ok} verified`,
                summary.damaged > 0 && `${summary.damaged} flagged`,
                summary.missing > 0 && `${summary.missing} missing`,
              ]
                .filter(Boolean)
                .join(" · ") || `${summary.unchecked} unchecked`}
            </span>
          </div>
        </div>
      </div>

      <hr className={shared.divider} />

      {/* ── Status filters ────────────────────────────────────────── */}
      <div className={styles.filterBar} role="group" aria-label="Filter by item status">
        {FILTERS.map((f) => {
          const count = f.id === "all"
            ? items.length
            : items.filter((i) => i.status === f.id).length;

          return (
            <button
              key={f.id}
              type="button"
              className={[
                styles.filterBtn,
                filter === f.id ? styles.filterBtnActive : "",
              ].filter(Boolean).join(" ")}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              aria-label={`Show ${f.label.toLowerCase()} items (${count})`}
            >
              {f.label}
              {count > 0 && (
                <span className={styles.filterCount} aria-hidden="true">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Column headers — Item | Qty | Status ─────────────────── */}
      {/*
        The packing list is rendered as a semantic table-like structure.
        Column headers are visually distinct from item rows and
        provide screen-reader context for the columnar layout.
        "Qty" is always 1 per manifest item (one row per physical unit).
      */}
      <div
        className={styles.columnHeaders}
        aria-hidden="true"
        data-testid="t2-manifest-col-headers"
      >
        <span className={styles.colHeaderItem}>Item</span>
        <span className={styles.colHeaderQty}>Qty</span>
        <span className={styles.colHeaderStatus}>Status</span>
      </div>

      {/* ── Item list / empty-filter state ─────────────────────────── */}
      {filteredItems.length === 0 ? (
        <div className={shared.emptyState} data-testid="t2-manifest-empty-filtered">
          <p className={shared.emptyStateText}>
            No items matching &ldquo;{FILTERS.find(f => f.id === filter)?.label}&rdquo;.
          </p>
        </div>
      ) : (
        <ul
          className={styles.itemList}
          aria-label="Manifest items"
          data-testid="t2-manifest-item-list"
        >
          {filteredItems.map((item) => {
            // Lookup damage report for this item (by stable templateItemId).
            // damageReport is present only when the item is actually damaged;
            // undefined for ok / missing / unchecked items or while loading.
            const damageReport = item.status === "damaged"
              ? damageByTemplateId.get(item.templateItemId)
              : undefined;

            const statusKind = MANIFEST_STATUS_KIND[item.status as ManifestItemStatus] ?? "pending";
            const statusLabel = MANIFEST_STATUS_LABEL[item.status as ManifestItemStatus] ?? item.status;

            return (
              <li
                key={item._id}
                className={styles.item}
                data-testid="manifest-item"
                data-status={item.status}
                aria-label={`${item.name}: ${statusLabel}`}
              >
                {/*
                  ── Primary row: Name | Qty | Status ──────────────────
                  Columnar layout matching the column headers above.
                  - colName: item name (flexible, ellipsis on overflow)
                  - colQty:  expected quantity — always "1×" per template item
                  - colStatus: StatusPill + optional severity badge
                */}
                <div className={styles.itemRow}>
                  <span className={styles.colName}>{item.name}</span>
                  <span
                    className={styles.colQty}
                    aria-label="Expected quantity: 1"
                    title="Expected quantity"
                  >
                    1×
                  </span>
                  <div className={styles.colStatus}>
                    <StatusPill kind={statusKind} />
                    {/* Severity badge — shown when a damage report with severity exists */}
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
                  </div>
                </div>

                {/* Photo count — shown for damaged items that have photo evidence */}
                {damageReport && damageReport.photoStorageIds.length > 0 && (
                  <p
                    className={styles.itemPhotoCount}
                    aria-label={`${damageReport.photoStorageIds.length} damage photo${damageReport.photoStorageIds.length !== 1 ? "s" : ""}`}
                  >
                    <span aria-hidden="true" className={styles.photoIcon}>Photo</span>
                    {damageReport.photoStorageIds.length} photo{damageReport.photoStorageIds.length !== 1 ? "s" : ""}
                    {damageReport.reportedByName && (
                      <span className={shared.timestamp}>
                        {" "}· {damageReport.reportedByName}
                      </span>
                    )}
                  </p>
                )}

                {/* Free-text notes entered by the technician */}
                {item.notes && (
                  <p className={styles.itemNote}>{item.notes}</p>
                )}

                {/* Attribution — checker name + timestamp */}
                {item.checkedByName && item.checkedAt && (
                  <p className={shared.timestamp}>
                    {statusLabel} by {item.checkedByName} ·{" "}
                    {new Date(item.checkedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Custody — compact current custodian ──────────────────── */}
      {/*
        Sub-AC 36d-3: CustodySection (compact) subscribes to
        api.custody.getLatestCustodyRecord via useLatestCustodyRecord.
        Any handoffCustody mutation from the SCAN app causes Convex to
        push an update here within ~100–300 ms — no page reload required.
      */}
      <hr className={shared.divider} />
      <div className={styles.custodyRow}>
        <CustodySection caseId={caseId} variant="compact" />
      </div>

      {/*
        ── QC Sign-off History — compact recent decisions (Sub-AC 4) ────
        QcSignOffHistory subscribes to api["queries/qcSignOff"].getQcSignOffHistory
        via the useQcSignOffHistory Convex real-time hook.  Updates from any
        submitQcSignOff mutation arrive within ~100–300 ms, satisfying the
        ≤ 2-second real-time fidelity requirement between SCAN app actions
        and the INVENTORY dashboard.

        limit={3} shows the three most recent QC decisions; a truncation
        notice directs operators to the T5 Audit panel for the full trail.
      */}
      <hr className={shared.divider} />
      <QcSignOffHistory caseId={caseId} limit={3} />

      {/*
        ── QR Label Management — operator-permission-gated ──────────────
        Sub-AC 2c: LabelManagementPanel mounted in the T2 Manifest layout.
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
    </div>
  );
}
