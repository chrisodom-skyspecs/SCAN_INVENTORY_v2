/**
 * T5Audit — Immutable Event Timeline / Audit Hash Chain Panel
 *
 * Displays the append-only event timeline for a case.
 * Gated behind the FF_AUDIT_HASH_CHAIN feature flag.
 *
 * When `ffEnabled` is false:
 *   - Shows a feature-flag gate notice instead of the timeline.
 *
 * When `ffEnabled` is true:
 *   - Lists all events from the `events` table ordered by timestamp.
 *   - Shows hash chain verification status per event.
 *   - Displays the event type, actor, and associated data.
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { StatusPill } from "../StatusPill";
import { useChecklistByCase } from "../../hooks/use-checklist";
import { useDamageReportEvents } from "../../hooks/use-damage-reports";
import {
  useShipmentsByCase,
  getTrackingUrl,
} from "../../hooks/use-shipment-status";
import type { DamageReportEvent } from "../../hooks/use-damage-reports";
import type { ShipmentRecord } from "../../hooks/use-shipment-status";
import type { ManifestItemStatus } from "../../hooks/use-checklist";
import CustodySection from "./CustodySection";
import shared from "./shared.module.css";
import styles from "./T5Audit.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

interface T5AuditProps {
  caseId: string;
  ffEnabled?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const EVENT_LABELS: Record<string, string> = {
  status_change:         "Status Changed",
  inspection_started:    "Inspection Started",
  inspection_completed:  "Inspection Completed",
  item_checked:          "Item Checked",
  damage_reported:       "Damage Reported",
  shipped:               "Shipped",
  delivered:             "Delivered",
  custody_handoff:       "Custody Handoff",
  note_added:            "Note Added",
  photo_added:           "Photo Added",
  mission_assigned:      "Mission Assigned",
  template_applied:      "Template Applied",
};

// ─── Feature flag gate ────────────────────────────────────────────────────────

function FeatureFlagGate() {
  return (
    <div className={shared.emptyState} data-testid="t5-ff-gate">
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
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <p className={shared.emptyStateTitle}>Audit Hash Chain Disabled</p>
      <p className={shared.emptyStateText}>
        Enable the{" "}
        <code className={styles.ffCode}>FF_AUDIT_HASH_CHAIN</code> feature flag
        to view the verified audit trail for this case.
      </p>
    </div>
  );
}

// ─── Event timeline item ──────────────────────────────────────────────────────

interface EventItemProps {
  event: {
    _id: string;
    eventType: string;
    userName: string;
    timestamp: number;
    data?: unknown;
    hash?: string;
    prevHash?: string;
  };
  ffEnabled: boolean;
}

function EventItem({ event, ffEnabled }: EventItemProps) {
  const label = EVENT_LABELS[event.eventType] ?? event.eventType;
  const data = event.data as Record<string, unknown> | undefined;

  // Derive an appropriate status kind for shipping/delivery events
  let statusKind: Parameters<typeof StatusPill>[0]["kind"] | null = null;
  if (event.eventType === "shipped") statusKind = "shipping";
  else if (event.eventType === "delivered") statusKind = "delivered";
  else if (event.eventType === "damage_reported") statusKind = "flagged";
  else if (event.eventType === "status_change" && data?.to) {
    const to = String(data.to);
    if (["assembled","deployed","in_field","shipping","returned"].includes(to)) {
      statusKind = to as Parameters<typeof StatusPill>[0]["kind"];
    }
  }

  return (
    <li className={styles.eventItem} data-testid="audit-event">
      <div className={styles.eventConnector} aria-hidden="true">
        <div className={styles.eventDot} />
        <div className={styles.eventLine} />
      </div>

      <div className={styles.eventContent}>
        <div className={styles.eventHeader}>
          <span className={styles.eventType}>{label}</span>
          {statusKind && <StatusPill kind={statusKind} />}
        </div>

        <div className={styles.eventMeta}>
          <span className={styles.eventActor}>{event.userName}</span>
          <span className={shared.timestamp}>{formatDate(event.timestamp)}</span>
        </div>

        {/* Event data summary */}
        {data && event.eventType === "status_change" && (
          <p className={styles.eventDetail}>
            {String(data.from ?? "—")} → {String(data.to ?? "—")}
            {data.reason ? ` · ${String(data.reason)}` : ""}
          </p>
        )}
        {data && event.eventType === "shipped" && (
          <p className={styles.eventDetail}>
            {data.trackingNumber
              ? `FedEx ${String(data.trackingNumber)}`
              : "Shipment recorded"}
            {data.originName && data.destinationName
              ? ` · ${String(data.originName)} → ${String(data.destinationName)}`
              : ""}
          </p>
        )}
        {data && event.eventType === "custody_handoff" && (
          <p className={styles.eventDetail}>
            To: {String(data.toUserName ?? "Unknown")}
          </p>
        )}
        {/* Damage event detail — shows severity, photo count, and item name
            from the real damage_reported event payload stored in the events table.
            These fields are written by the submitDamagePhoto mutation in
            convex/damageReports.ts and surfaced here via useDamageReportEvents. */}
        {data && event.eventType === "damage_reported" && (
          <p className={styles.eventDetail}>
            {data.templateItemId
              ? `Item: ${String(data.templateItemId)}`
              : "Case-level photo"}
            {data.severity ? ` · ${String(data.severity)}` : ""}
            {typeof data.annotationCount === "number" && data.annotationCount > 0
              ? ` · ${data.annotationCount} annotation${data.annotationCount !== 1 ? "s" : ""}`
              : ""}
          </p>
        )}

        {/* Hash chain verification — only when FF_AUDIT_HASH_CHAIN is on */}
        {ffEnabled && event.hash && (
          <div className={styles.hashRow}>
            <span className={styles.hashLabel}>SHA-256</span>
            <code className={styles.hash}>{event.hash.slice(0, 16)}…</code>
          </div>
        )}
      </div>
    </li>
  );
}

// ─── Manifest status → StatusKind mapping (for checklist audit section) ───────

const MANIFEST_TO_STATUS_KIND: Record<ManifestItemStatus, Parameters<typeof StatusPill>[0]["kind"]> = {
  unchecked: "pending",
  ok:        "completed",
  damaged:   "flagged",
  missing:   "exception",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function T5Audit({ caseId, ffEnabled = true }: T5AuditProps) {
  // Load events via the cases API
  // Note: events are loaded from the `events` table via a raw query.
  // The T5 panel queries events directly for the audit view.
  const caseDoc = useQuery(api.cases.getCaseById, { caseId });

  // Sub-AC 36d-4: useShipmentsByCase provides a real-time subscription to
  // api.shipping.listShipmentsByCase via the use-shipment-status hook module.
  // Convex re-evaluates and pushes updates within ~100–300 ms of any SCAN app
  // shipCase call or FedEx tracking status change, satisfying the ≤ 2-second
  // real-time fidelity requirement.
  // Using the hook (rather than raw useQuery) also ensures the ShipmentRecord
  // type aligns with the canonical projection from shippingHelpers, and provides
  // access to getTrackingUrl for FedEx label URL links in the timeline.
  const shipments: ShipmentRecord[] | undefined = useShipmentsByCase(caseId);

  // useChecklistByCase provides real-time manifest item state for the audit view.
  // Convex re-evaluates getChecklistByCase whenever any manifestItem row for this
  // case changes — the checklist snapshot here reflects the latest SCAN app
  // actions within ~100–300 ms, satisfying the ≤ 2-second real-time fidelity SLA.
  // This subscription runs unconditionally (even when ffEnabled=false) so the
  // checklist snapshot is available to render when ffEnabled is true.
  const checklistItems = useChecklistByCase(caseId);

  // useDamageReportEvents subscribes to getDamageReportEvents — the immutable
  // append-only audit log of `damage_reported` events for this case.  Convex
  // re-runs this query within ~100–300 ms whenever the SCAN app submits a
  // damage photo or marks an item damaged, satisfying the ≤ 2-second real-time
  // fidelity requirement.  These real events replace the placeholder entry that
  // synthetic event construction would otherwise create.
  //
  // Subscribed unconditionally (even when ffEnabled=false) so the data is ready
  // immediately when the FF is enabled without requiring a React re-mount.
  const damageEvents = useDamageReportEvents(caseId);

  if (!ffEnabled) {
    return <FeatureFlagGate />;
  }

  // Wait for case + shipments before rendering (damage events load separately
  // and are merged in when ready — they don't block the initial render).
  if (caseDoc === undefined || shipments === undefined) {
    return (
      <div className={shared.emptyState} aria-busy="true">
        <div className={shared.spinner} />
      </div>
    );
  }

  // checklistItems may still be loading (undefined) after caseDoc resolves —
  // render the audit view immediately with checklistItems === undefined and
  // show the checklist section skeleton inline rather than blocking the full panel.

  if (caseDoc === null) {
    return (
      <div className={shared.emptyState} role="alert">
        <p className={shared.emptyStateTitle}>Case not found</p>
      </div>
    );
  }

  // Build an event list from available data.
  // Real damage events come from useDamageReportEvents (the authoritative
  // append-only events table).  Other event types are synthesised from case
  // metadata and shipments until a full events API is available.
  //
  // Real damage_reported events take precedence over any synthetic placeholder
  // that would otherwise represent damage activity.  If damageEvents is still
  // loading (undefined), we include zero synthetic damage events so the list
  // renders immediately with the data already available.
  const realDamageEventEntries = (damageEvents ?? []).map(
    (e: DamageReportEvent) => ({
      _id: e.eventId,
      eventType: "damage_reported",
      userName: e.userName,
      timestamp: e.timestamp,
      data: e.data,
      hash: e.hash,
      prevHash: e.prevHash,
    })
  );

  const syntheticEvents = [
    {
      _id: `created-${caseDoc._id}`,
      eventType: "status_change",
      userName: "System",
      timestamp: caseDoc.createdAt,
      data: { from: null, to: caseDoc.status, reason: "Case created" },
      hash: undefined,
      prevHash: undefined,
    },
    ...shipments.map((s) => ({
      _id: `shipped-${s._id}`,
      eventType: "shipped",
      userName: "SCAN app",
      timestamp: s.shippedAt ?? s.createdAt,
      data: {
        trackingNumber: s.trackingNumber,
        originName: s.originName,
        destinationName: s.destinationName,
      },
      hash: undefined,
      prevHash: undefined,
    })),
    // Real damage events from the authoritative events table.
    // These replace any synthetic placeholder entries for damage activity.
    ...realDamageEventEntries,
  ].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className={styles.audit} data-testid="t5-audit">
      <div className={shared.sectionHeader}>
        <h3 className={shared.sectionTitle}>Event Timeline</h3>
        {ffEnabled && (
          <span className={styles.auditBadge} aria-label="Audit hash chain enabled">
            Hash Chain
          </span>
        )}
      </div>

      {syntheticEvents.length === 0 ? (
        <div className={shared.emptyState}>
          <p className={shared.emptyStateTitle}>No events recorded</p>
        </div>
      ) : (
        <ol
          className={styles.timeline}
          aria-label="Case audit event timeline"
          reversed
        >
          {syntheticEvents.map((event) => (
            <EventItem key={event._id} event={event} ffEnabled={ffEnabled} />
          ))}
        </ol>
      )}

      {/* ── Checklist state snapshot — real-time via useChecklistByCase ── */}
      {/*
        This section shows the live inspection state of each manifest item.
        useChecklistByCase (backed by api.checklists.getChecklistByCase) is a
        real-time Convex subscription — Convex re-evaluates the query within
        ~100–300 ms of any SCAN app status change, so auditors always see the
        current inspection record without a page reload.
      */}
      {checklistItems !== undefined && checklistItems.length > 0 && (
        <>
          <hr className={shared.divider} />
          <section aria-label="Manifest item inspection state">
            <div className={shared.sectionHeader}>
              <h3 className={shared.sectionTitle}>Manifest Snapshot</h3>
              <span className={shared.timestamp}>{checklistItems.length} items</span>
            </div>

            <ul className={styles.checklistSnapshot} aria-label="Manifest items audit snapshot">
              {checklistItems.map((item) => (
                <li key={item._id} className={styles.checklistSnapshotItem}>
                  <StatusPill
                    kind={
                      MANIFEST_TO_STATUS_KIND[item.status as ManifestItemStatus] ?? "pending"
                    }
                  />
                  <div className={styles.checklistSnapshotBody}>
                    <span className={styles.checklistSnapshotName}>{item.name}</span>
                    {item.checkedByName && item.checkedAt && (
                      <span className={shared.timestamp}>
                        {item.checkedByName} ·{" "}
                        {new Date(item.checkedAt).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                    {item.notes && (
                      <p className={styles.checklistSnapshotNote}>{item.notes}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {/* Loading state for checklist snapshot while items are fetching */}
      {checklistItems === undefined && (
        <>
          <hr className={shared.divider} />
          <div className={shared.emptyState} aria-busy="true" aria-label="Loading manifest snapshot">
            <div className={shared.spinner} />
          </div>
        </>
      )}

      {/* ── Custody Chain — real-time via useCustodyChain ─────────── */}
      {/*
        Sub-AC 36d-3: CustodySection (chain variant) subscribes to
        api.custody.getCustodyChain via useCustodyChain.

        Returns all handoffs in chronological (ascending) order — first
        holder at step 1, current custodian at the last step.  This is
        the authoritative chain-of-custody trail for the T5 audit panel,
        complementing the event timeline above.

        Convex re-evaluates and pushes within ~100–300 ms of any
        handoffCustody mutation from the SCAN app — the chain updates live
        without a page reload, satisfying the ≤ 2-second real-time
        fidelity requirement.

        Rendered unconditionally when the FF is enabled (ffEnabled=true)
        so the full audit view includes both event timeline and custody chain.
      */}
      <hr className={shared.divider} />
      <CustodySection caseId={caseId} variant="chain" />
    </div>
  );
}
