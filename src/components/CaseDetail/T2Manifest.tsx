/**
 * T2Manifest — Manifest / Packing List Panel
 *
 * Displays the full packing list (manifest items) for a case with per-item
 * status indicators.  Includes:
 *   - Aggregate progress bar
 *   - Status filter tabs (all / ok / damaged / missing / unchecked)
 *   - Item list with StatusPill for each item's inspection state
 *   - Item notes when present
 */

"use client";

import { useState } from "react";
import { useChecklistWithInspection } from "../../hooks/use-checklist";
import { useDamageReportsByCase } from "../../hooks/use-damage-reports";
import {
  useLatestShipment,
  getTrackingUrl,
} from "../../hooks/use-shipment-status";
import type { ShipmentRecord } from "../../hooks/use-shipment-status";
import { StatusPill } from "../StatusPill";
import CustodySection from "./CustodySection";
import shared from "./shared.module.css";
import styles from "./T2Manifest.module.css";
import type { ManifestItemStatus, ChecklistWithInspection } from "../../../convex/checklists";
import type { StatusKind } from "../StatusPill/StatusPill";

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function T2Manifest({ caseId, onNavigateToShipping }: T2ManifestProps) {
  const [filter, setFilter] = useState<FilterKind>("all");

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
      <div className={shared.emptyState} aria-busy="true">
        <div className={shared.spinner} />
      </div>
    );
  }

  const { items, summary } = checklistData;

  // No items
  if (items.length === 0) {
    return (
      <div className={shared.emptyState}>
        <p className={shared.emptyStateTitle}>No manifest items</p>
        <p className={shared.emptyStateText}>
          Apply a case template to define the expected packing list.
        </p>
      </div>
    );
  }

  const filteredItems = filter === "all"
    ? items
    : items.filter((item) => item.status === filter);

  return (
    <div className={styles.manifest} data-testid="t2-manifest">
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
            {summary.ok + summary.damaged + summary.missing} / {summary.total}
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
              {summary.ok > 0 && `${summary.ok} OK`}
              {summary.damaged > 0 && ` · ${summary.damaged} damaged`}
              {summary.missing > 0 && ` · ${summary.missing} missing`}
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
              className={[
                styles.filterBtn,
                filter === f.id ? styles.filterBtnActive : "",
              ].filter(Boolean).join(" ")}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
            >
              {f.label}
              {count > 0 && (
                <span className={styles.filterCount}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Item list ─────────────────────────────────────────────── */}
      {filteredItems.length === 0 ? (
        <div className={shared.emptyState}>
          <p className={shared.emptyStateText}>
            No items matching &ldquo;{FILTERS.find(f => f.id === filter)?.label}&rdquo;.
          </p>
        </div>
      ) : (
        <ul className={styles.itemList} aria-label="Manifest items">
          {filteredItems.map((item) => {
            // Lookup damage report for this item (by stable templateItemId).
            // damageReport is present only when the item is actually damaged;
            // undefined for ok / missing / unchecked items or while loading.
            const damageReport = item.status === "damaged"
              ? damageByTemplateId.get(item.templateItemId)
              : undefined;

            return (
              <li key={item._id} className={styles.item} data-testid="manifest-item">
                <div className={styles.itemHeader}>
                  <span className={styles.itemName}>{item.name}</span>
                  <div className={styles.itemPills}>
                    <StatusPill kind={MANIFEST_STATUS_KIND[item.status as ManifestItemStatus] ?? "pending"} />
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
                  <p className={styles.itemPhotoCount} aria-label={`${damageReport.photoStorageIds.length} damage photo${damageReport.photoStorageIds.length !== 1 ? "s" : ""}`}>
                    <span aria-hidden="true" className={styles.photoIcon}>Photo</span>
                    {damageReport.photoStorageIds.length} photo{damageReport.photoStorageIds.length !== 1 ? "s" : ""}
                    {damageReport.reportedByName && (
                      <span className={shared.timestamp}>
                        {" "}· {damageReport.reportedByName}
                      </span>
                    )}
                  </p>
                )}

                {item.notes && (
                  <p className={styles.itemNote}>{item.notes}</p>
                )}

                {item.checkedByName && item.checkedAt && (
                  <p className={shared.timestamp}>
                    Checked by {item.checkedByName} ·{" "}
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
    </div>
  );
}
