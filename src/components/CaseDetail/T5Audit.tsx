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
 *   - Filter panel (AuditLedgerFilterPanel) for date range, actor, action, case ID.
 *   - Lists all events from the `events` table ordered by timestamp.
 *   - Shows hash chain verification status per event.
 *   - Displays the event type, actor, and associated data.
 *
 * Sub-AC 1 filter panel:
 *   The AuditLedgerFilterPanel shell is mounted above the audit ledger.
 *   Filter state is owned here (T5Audit) and threaded down as props.
 *   The actual query integration (passing filters to usePaginatedCaseEvents)
 *   will be added in subsequent sub-ACs.
 *
 * Sub-AC 3 data flow:
 *   Shipment events now come from `useShipmentEventsForAudit(caseId)` which
 *   subscribes to `api["queries/shipment"].getShipmentEventsForAudit`.  This
 *   server-side-formatted query returns `ShipmentAuditEntry[]` — pre-typed
 *   audit timeline entries — eliminating the client-side mapping of
 *   `ShipmentRecord[]` into synthetic event objects.
 *
 *   Convex re-evaluates and pushes within ~100–300 ms of any SCAN app
 *   `shipCase` call or `updateShipmentStatus` tracking refresh, satisfying
 *   the ≤ 2-second real-time fidelity requirement for the T5 timeline.
 *
 *   Custody handoff records update in real-time via `CustodySection` which
 *   subscribes to `api.custody.getCustodyChain` via `useCustodyChain`.
 */

"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { StatusPill } from "../StatusPill";
import { useChecklistByCase } from "../../hooks/use-checklist";
import { useDamageReportEvents } from "../../hooks/use-damage-reports";
import { LabelManagementPanel } from "../LabelManagementPanel";
import { useCurrentUser } from "../../hooks/use-current-user";
import { OPERATIONS } from "@/lib/rbac-client";
import {
  useShipmentsByCase,
  useShipmentEventsForAudit,
  getTrackingUrl,
} from "../../hooks/use-shipment-status";
import {
  usePaginatedCaseEvents,
  useCaseEvents,
  useDistinctCaseActors,
  AUDIT_LEDGER_PAGE_SIZE,
  type PaginatedCaseEventsFilters,
} from "../../hooks/use-case-events";
import type { DamageReportEvent } from "../../hooks/use-damage-reports";
import type { ShipmentRecord, ShipmentAuditEntry } from "../../hooks/use-shipment-status";
import type { CaseEvent } from "../../hooks/use-case-events";
import type { ManifestItemStatus } from "../../hooks/use-checklist";
import { verifyHashChain } from "../../lib/audit-hash-chain";
import type { AuditEntry, HashChainVerificationResult } from "../../lib/audit-hash-chain";
import AuditLedgerTable from "./AuditLedgerTable";
import type { AuditLedgerRow } from "./AuditLedgerTable";
import AuditLedgerFilterPanel from "./AuditLedgerFilterPanel";
import type { AuditFilterState } from "./AuditLedgerFilterPanel";
import CustodySection from "./CustodySection";
import { QcSignOffHistory } from "./QcSignOffHistory";
import { exportAuditLedgerCsv } from "../../lib/exportAuditCsv";
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

// ─── AuditFilterState → PaginatedCaseEventsFilters conversion ────────────────

/**
 * Convert the UI-level `AuditFilterState` (ISO date strings, actor name, event
 * type key, and case-ID search term) into the `PaginatedCaseEventsFilters`
 * object expected by `usePaginatedCaseEvents` / `getCaseEventsPaginated`.
 *
 * Sub-AC 4: called every time `auditFilters` changes so the paginated query
 * args are always in sync with the filter panel state.
 *
 * Date conversion:
 *   dateFrom ("YYYY-MM-DD") → fromTimestamp: start of that day in local time
 *   dateTo   ("YYYY-MM-DD") → toTimestamp:   end of that day in local time (23:59:59.999)
 *
 * Actor / action:
 *   Empty strings are excluded from the filter object so the Convex arg
 *   fingerprint remains stable when no filter is selected (omitted optional
 *   args vs. undefined-valued args — both treated as "no filter" server-side,
 *   but omitting avoids unnecessary Convex arg-hash cache misses).
 *
 * Case ID search:
 *   Passed through as-is to the server, which performs a substring match on
 *   the caseId string and returns an empty result when there is no match.
 */
function auditFilterStateToQueryFilters(
  filters: AuditFilterState,
): PaginatedCaseEventsFilters {
  const result: PaginatedCaseEventsFilters = {};

  if (filters.dateFrom) {
    // Start of dateFrom day in local time (00:00:00.000)
    result.fromTimestamp = new Date(filters.dateFrom + "T00:00:00").getTime();
  }

  if (filters.dateTo) {
    // End of dateTo day in local time (23:59:59.999)
    result.toTimestamp = new Date(filters.dateTo + "T23:59:59.999").getTime();
  }

  if (filters.actor) {
    result.actorName = filters.actor;
  }

  if (filters.action) {
    result.eventType = filters.action;
  }

  if (filters.caseIdSearch) {
    result.caseIdSearch = filters.caseIdSearch;
  }

  return result;
}

// ─── CaseEvent → AuditLedgerRow projection ───────────────────────────────────

/**
 * Map a `CaseEvent` from the immutable events table to an `AuditLedgerRow`
 * expected by the `AuditLedgerTable` presentational component.
 *
 * Called for each item in the `results` array from `usePaginatedCaseEvents`.
 */
function eventToLedgerRow(event: CaseEvent): AuditLedgerRow {
  return {
    id:        event._id,
    timestamp: event.timestamp,
    actor:     event.userName,
    action:    EVENT_LABELS[event.eventType] ?? event.eventType,
    caseId:    event.caseId,
    hash:      event.hash,
  };
}

// ─── PaginatedAuditLedger — paginated table section ──────────────────────────

/**
 * Inner component that owns the paginated subscription to the events table.
 *
 * Renders the `AuditLedgerTable` presentational component wired to live data
 * from `usePaginatedCaseEvents`, which subscribes to
 * `api["queries/events"].getCaseEventsPaginated` in descending timestamp order.
 *
 * Sub-AC 4: accepts `filters: AuditFilterState` from the parent (T5Audit) and
 * converts them to `PaginatedCaseEventsFilters` before passing to the hook.
 * When any filter value changes:
 *   1. `auditFilterStateToQueryFilters` computes updated Convex args.
 *   2. `usePaginatedCaseEvents` detects the arg change and resets cursor to page 1.
 *   3. Convex re-evaluates `getCaseEventsPaginated` with the new filters server-side.
 *   4. The filtered result is pushed to the client within ~100–300 ms.
 *   5. `AuditLedgerTable` re-renders with the updated rows.
 * This satisfies the ≤ 2-second real-time fidelity requirement for filter changes.
 *
 * State machine:
 *   LoadingFirstPage → spinner skeleton
 *   CanLoadMore      → table + "Load 20 more events" button
 *   Exhausted        → table (no load-more button)
 *   0 results        → AuditLedgerTable empty state (handled by the table itself)
 *
 * Real-time fidelity:
 *   Convex re-evaluates the active pages within ~100–300 ms of any SCAN app
 *   mutation that inserts a new event row for this case.  New events appear at
 *   the head of `results` automatically — the ledger stays live without any
 *   user interaction, satisfying the ≤ 2-second fidelity requirement.
 */
interface PaginatedAuditLedgerProps {
  caseId: string;
  ffEnabled: boolean;
  /** Sub-AC 4: filter state from AuditLedgerFilterPanel, threaded via T5Audit. */
  filters: AuditFilterState;
  /**
   * Sub-AC 160202: callback invoked whenever the current page of rows changes.
   * T5Audit stores the latest rows in a ref so the Export CSV handler always
   * exports the currently-visible data without requiring state hoisting.
   * The callback is stable (useCallback with no deps) so it does not cause
   * PaginatedAuditLedger to re-render.
   */
  onRowsChange?: (rows: AuditLedgerRow[]) => void;
}

function PaginatedAuditLedger({ caseId, ffEnabled, filters, onRowsChange }: PaginatedAuditLedgerProps) {
  // Sub-AC 4: convert UI filter state to Convex query args before passing to hook.
  // This conversion is pure (no side effects) and runs on every render — React
  // batches re-renders when state settles, so the Convex subscription only
  // receives a new arg fingerprint when the filter actually changes.
  const queryFilters = auditFilterStateToQueryFilters(filters);

  const { results, status, loadMore } = usePaginatedCaseEvents(caseId, AUDIT_LEDGER_PAGE_SIZE, queryFilters);

  // ── Loading state: first page not yet received ───────────────────────────
  if (status === "LoadingFirstPage") {
    return (
      <div
        className={shared.emptyState}
        aria-busy="true"
        aria-label="Loading audit events"
        data-testid="ledger-loading"
      >
        <div className={shared.spinner} />
        <p className={shared.emptyStateText}>Loading audit events…</p>
      </div>
    );
  }

  // ── Map events to ledger rows ─────────────────────────────────────────────
  // useMemo ensures `rows` is a stable reference that only changes when
  // `results` changes — prevents `onRowsChange` useEffect below from
  // firing on every render due to a new array reference from .map().
  // results.length === 0 is handled by AuditLedgerTable's own EmptyLedger state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows: AuditLedgerRow[] = useMemo(() => results.map(eventToLedgerRow), [results]);

  // Sub-AC 160202: report current rows to T5Audit via onRowsChange so the
  // Export CSV handler in the toolbar can access the latest loaded rows.
  // Fires only when `rows` reference changes (Convex push or pagination).
  // Writing to a ref in T5Audit means no additional re-renders are triggered.
  useEffect(() => {
    onRowsChange?.(rows);
  }, [rows, onRowsChange]);

  return (
    <div data-testid="paginated-audit-ledger">
      {/* Sortable audit ledger table — shows EmptyLedger when rows is empty */}
      <AuditLedgerTable
        rows={rows}
        ffEnabled={ffEnabled}
        data-testid="audit-ledger-table"
      />

      {/* ── Pagination controls ──────────────────────────────────────────── */}
      {status === "CanLoadMore" && (
        <div className={styles.loadMoreRow}>
          <button
            type="button"
            className={[shared.ctaButton, shared.ctaButtonSecondary, styles.loadMoreBtn].join(" ")}
            onClick={() => loadMore(AUDIT_LEDGER_PAGE_SIZE)}
            aria-label={`Load ${AUDIT_LEDGER_PAGE_SIZE} more audit events`}
            data-testid="load-more-events"
          >
            Load {AUDIT_LEDGER_PAGE_SIZE} more events
          </button>
        </div>
      )}

      {/* ── Exhausted indicator — all events loaded ──────────────────────── */}
      {status === "Exhausted" && rows.length > 0 && (
        <div className={styles.exhaustedRow} aria-live="polite" data-testid="ledger-exhausted">
          <span className={styles.exhaustedText}>All {rows.length} events loaded</span>
        </div>
      )}
    </div>
  );
}

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
  if (event.eventType === "shipped") statusKind = "transit_out";
  else if (event.eventType === "delivered") statusKind = "delivered";
  else if (event.eventType === "damage_reported") statusKind = "flagged";
  else if (event.eventType === "status_change" && data?.to) {
    const to = String(data.to);
    const validCaseStatuses = [
      "hangar", "assembled", "transit_out", "deployed",
      "flagged", "transit_in", "received", "archived",
    ];
    if (validCaseStatuses.includes(to)) {
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
            {data.trackingNumber ? (
              <>
                {/* Sub-AC 36d-4: label URL — links to FedEx tracking portal */}
                <a
                  href={getTrackingUrl(String(data.trackingNumber))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.trackingLink}
                  aria-label={`Track FedEx shipment ${String(data.trackingNumber)}`}
                >
                  FedEx {String(data.trackingNumber)}
                </a>
                {data.originName && data.destinationName
                  ? ` · ${String(data.originName)} → ${String(data.destinationName)}`
                  : ""}
              </>
            ) : (
              "Shipment recorded"
            )}
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

// ─── Hash-chain verification footer ──────────────────────────────────────────

/**
 * Internal state machine for the hash-chain verification footer.
 *
 *   loading   — waiting for the Convex subscription to deliver events
 *   checking  — events received; verifyHashChain is running asynchronously
 *   valid     — all hashed entries passed SHA-256 verification
 *   broken    — chain integrity failure detected; brokenAt index + reason set
 *   empty     — events received but none carry a hash field (pre-FF events only)
 */
type VerifyStatus =
  | { status: "loading" }
  | { status: "checking" }
  | { status: "valid"; checkedCount: number }
  | { status: "broken"; brokenAt: number; reason: "broken_chain_link" | "hash_mismatch" }
  | { status: "empty" };

/**
 * HashChainVerificationFooter — live SHA-256 integrity check footer.
 *
 * Subscribes to all case events in chronological (ASC) order via
 * `useCaseEvents` and runs `verifyHashChain` client-side whenever the event
 * list changes.  Results are displayed as a compact status strip at the
 * bottom of the T5 Audit panel.
 *
 * Lifecycle:
 *   1. Mount → status "loading" (spinner dot).
 *   2. Convex delivers events → status "checking" (spinner dot).
 *   3. verifyHashChain resolves →
 *        • "valid"   — N entries verified (green shield).
 *        • "broken"  — broken at index N, reason code (amber warning).
 *        • "empty"   — 0 entries had hash fields (info notice).
 *   4. Convex pushes updated events (real-time) → back to step 2.
 *
 * The footer is rendered only when the parent T5Audit has `ffEnabled=true`.
 * It is suppressed in print output via `@media print { display: none }` in
 * T5Audit.module.css (the print header already notes hash-chain status).
 *
 * Gated by FF_AUDIT_HASH_CHAIN via the `ffEnabled` prop on T5Audit —
 * this component is never mounted when the flag is off.
 */
interface HashChainVerificationFooterProps {
  caseId: string;
}

function HashChainVerificationFooter({ caseId }: HashChainVerificationFooterProps) {
  // Subscribe to all events in chronological (ASC) order.
  // verifyHashChain requires entries sorted by timestamp ascending — this is
  // the natural order returned by getCaseEvents.
  const events = useCaseEvents(caseId);

  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>({ status: "loading" });

  useEffect(() => {
    if (events === undefined) {
      // Convex subscription still loading — keep "loading" state.
      setVerifyStatus({ status: "loading" });
      return;
    }

    // Events received — start async verification.
    setVerifyStatus({ status: "checking" });

    let cancelled = false;

    // Cast to AuditEntry[]: CaseEvent has a superset of the required fields.
    // The cast is safe because verifyHashChain only accesses _id, caseId,
    // eventType, userId, userName, timestamp, data, hash, and prevHash.
    verifyHashChain(events as unknown as AuditEntry[]).then(
      (result: HashChainVerificationResult) => {
        if (cancelled) return;

        if (result.valid) {
          if (result.checkedCount === 0) {
            setVerifyStatus({ status: "empty" });
          } else {
            setVerifyStatus({ status: "valid", checkedCount: result.checkedCount });
          }
        } else {
          setVerifyStatus({
            status: "broken",
            brokenAt: result.brokenAt,
            reason: result.reason,
          });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [events]);

  // ── Icon selection ──────────────────────────────────────────────────────────
  const iconClass =
    verifyStatus.status === "valid"
      ? styles.hashChainFooterIconValid
      : verifyStatus.status === "broken"
        ? styles.hashChainFooterIconBroken
        : styles.hashChainFooterIconNeutral;

  const titleClass =
    verifyStatus.status === "valid"
      ? styles.hashChainFooterTitleValid
      : verifyStatus.status === "broken"
        ? styles.hashChainFooterTitleBroken
        : undefined;

  // ── Label / subtitle copy ───────────────────────────────────────────────────
  let title: string;
  let subtitle: React.ReactNode;

  switch (verifyStatus.status) {
    case "loading":
      title = "Verifying hash chain…";
      subtitle = "Waiting for event data";
      break;
    case "checking":
      title = "Verifying hash chain…";
      subtitle = "Computing SHA-256 digests";
      break;
    case "valid":
      title = "Chain Verified";
      subtitle = `${verifyStatus.checkedCount} entr${verifyStatus.checkedCount === 1 ? "y" : "ies"} verified · SHA-256`;
      break;
    case "broken":
      title = "Chain Integrity Failure";
      subtitle = (
        <>
          Broken at entry {verifyStatus.brokenAt} ·{" "}
          <code className={styles.hashChainFooterCode}>{verifyStatus.reason}</code>
        </>
      );
      break;
    case "empty":
      title = "No Hashed Entries";
      subtitle = "Events pre-date FF_AUDIT_HASH_CHAIN — nothing to verify";
      break;
  }

  // ── Icon SVG ────────────────────────────────────────────────────────────────
  const icon =
    verifyStatus.status === "valid" ? (
      /* Shield-check (verified) */
      <svg
        className={[styles.hashChainFooterIcon, iconClass].join(" ")}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M8 1.5 L13.5 4 V8.5 C13.5 11.5 8 14.5 8 14.5 C8 14.5 2.5 11.5 2.5 8.5 V4 Z" />
        <polyline points="5.5,8 7,9.5 10.5,6" />
      </svg>
    ) : verifyStatus.status === "broken" ? (
      /* Warning triangle */
      <svg
        className={[styles.hashChainFooterIcon, iconClass].join(" ")}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M8 2 L14 13 H2 Z" />
        <line x1="8" y1="6.5" x2="8" y2="9.5" />
        <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
      </svg>
    ) : (
      /* Spinner / neutral circle for loading, checking, empty */
      <svg
        className={[styles.hashChainFooterIcon, iconClass].join(" ")}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="8" cy="8" r="5.5" strokeDasharray="3 2" />
      </svg>
    );

  return (
    <div
      className={styles.hashChainFooter}
      data-testid="hash-chain-footer"
      aria-label={`Hash chain verification: ${title}`}
    >
      <div className={styles.hashChainFooterInner}>
        {icon}
        <div className={styles.hashChainFooterBody}>
          <p
            className={[
              styles.hashChainFooterTitle,
              titleClass,
            ].filter(Boolean).join(" ")}
          >
            {title}
          </p>
          <p className={styles.hashChainFooterSubtitle}>{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function T5Audit({ caseId, ffEnabled = true }: T5AuditProps) {
  // Permission check — only admin/technician can manage QR labels.
  // Called unconditionally (hook rules) before any early returns
  // (including the FeatureFlagGate early return below).
  const { can } = useCurrentUser();
  const canManageLabels = can(OPERATIONS.QR_CODE_GENERATE);

  // ── Sub-AC 2: Filter state received from AuditLedgerFilterPanel ──────────
  //
  // Sub-AC 2 moved dateFrom/dateTo/caseIdSearch state into AuditLedgerFilterPanel
  // (local useState) — the filter panel is now self-contained for those controls.
  //
  // T5Audit only needs to track the *latest committed* filter state for passing
  // to the Convex paginated query (in a later sub-AC).  We receive it via the
  // `onFilterChange` callback and store a local copy here for that purpose.
  const [auditFilters, setAuditFilters] = useState<AuditFilterState>({
    dateFrom: "",
    dateTo: "",
    actor: "",
    action: "",
    caseIdSearch: "",
  });

  const handleFilterChange = useCallback((next: AuditFilterState) => {
    setAuditFilters(next);
  }, []);

  // ── Sub-AC 160201-1: Print PDF support ───────────────────────────────────
  //
  // Sets a temporary `data-printing-audit="1"` attribute on document.body
  // before calling window.print().  The global @media print rule in
  // globals.css uses this attribute to isolate the [data-print-target="t5-audit"]
  // subtree (visibility-isolation technique), so only the audit panel is
  // printed regardless of the surrounding dashboard layout.
  //
  // The attribute is removed in the `afterprint` event so that a subsequent
  // browser-initiated Cmd+P print (from any other view) is unaffected.
  const handlePrint = useCallback(() => {
    document.body.setAttribute("data-printing-audit", "1");

    const cleanup = () => {
      document.body.removeAttribute("data-printing-audit");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);

    window.print();
  }, []);

  // ── Sub-AC 160202: Export CSV support ────────────────────────────────────
  //
  // `latestRowsRef` holds a reference to the most recently-reported set of
  // AuditLedgerRow objects from PaginatedAuditLedger.  Writing to a ref (not
  // state) means the update does not trigger a T5Audit re-render.
  //
  // `handleRowsChange` is the stable callback passed to PaginatedAuditLedger
  // via the `onRowsChange` prop.  PaginatedAuditLedger calls it via useEffect
  // whenever `rows` changes (Convex push or "Load more" pagination click).
  //
  // `handleExportCsv` is the button onClick handler.  It reads `latestRowsRef`
  // at click-time so the export always reflects the currently-visible rows
  // (including any pagination increments since component mount).
  const latestRowsRef = useRef<AuditLedgerRow[]>([]);

  const handleRowsChange = useCallback((rows: AuditLedgerRow[]) => {
    latestRowsRef.current = rows;
  }, []);

  const handleExportCsv = useCallback(() => {
    exportAuditLedgerCsv(latestRowsRef.current, caseId, ffEnabled);
  }, [caseId, ffEnabled]);

  // Load events via the cases API
  // Note: events are loaded from the `events` table via a raw query.
  // The T5 panel queries events directly for the audit view.
  const caseDoc = useQuery(api.cases.getCaseById, { caseId: caseId as Id<"cases"> });

  // Sub-AC 3: useShipmentEventsForAudit subscribes to
  // `api["queries/shipment"].getShipmentEventsForAudit` — the new dedicated
  // query in convex/queries/shipment.ts that returns shipments pre-formatted
  // as audit timeline entries (ShipmentAuditEntry[]).
  //
  // This replaces the previous pattern of:
  //   1. useShipmentsByCase → ShipmentRecord[]
  //   2. Client-side .map() to convert records to synthetic event objects
  //
  // With a single server-side-formatted query that:
  //   • Returns typed ShipmentAuditEntry[] directly usable in the timeline
  //   • Eliminates client-side type casting and transformation logic
  //   • Provides the same real-time fidelity — Convex re-evaluates and pushes
  //     within ~100–300 ms of any SCAN app `shipCase` call or `updateShipmentStatus`
  //
  // The fallback `useShipmentsByCase` subscription is retained for backward
  // compatibility with components that consume `shipments` directly, and as a
  // fallback while the queries/shipment API types are being regenerated by
  // `npx convex dev`.  Once the API types are generated, `shipmentAuditEntries`
  // is preferred and `shipments` can be dropped from this component.
  const shipmentAuditEntries: ShipmentAuditEntry[] | undefined =
    useShipmentEventsForAudit(caseId);

  // Fallback: keep useShipmentsByCase for loading-gate compatibility
  // (we need *something* to block render until shipment data is available).
  // Once shipmentAuditEntries is available from the new hook, this can be
  // removed. For now it guards the `if (shipments === undefined)` loading gate.
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
  //
  // Loading gate: use whichever shipment data source is available first.
  // `shipmentAuditEntries` (from the new queries/shipment hook) or `shipments`
  // (from the legacy hook) — both are undefined while loading and non-undefined
  // once the Convex subscription delivers data.
  const shipmentsLoading =
    shipmentAuditEntries === undefined && shipments === undefined;

  if (caseDoc === undefined || shipmentsLoading) {
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
  //
  // Sub-AC 3: Shipment events now prefer `shipmentAuditEntries` from the new
  // `getShipmentEventsForAudit` query — these are pre-typed `ShipmentAuditEntry`
  // objects returned directly by the server.  When `shipmentAuditEntries` is
  // unavailable (still loading from the new hook during API type regeneration),
  // we fall back to `shipments` and manually map them to the event shape.
  //
  // Real damage events come from useDamageReportEvents (the authoritative
  // append-only events table).  Other event types are synthesised from case
  // metadata.  All event sources are merged and sorted newest-first.
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

  // Prefer the new pre-formatted `ShipmentAuditEntry[]` from the dedicated
  // `api["queries/shipment"].getShipmentEventsForAudit` subscription.  This
  // eliminates the manual mapping below and provides typed audit entries
  // directly.  Falls back to the manual mapping from `shipments` if
  // `shipmentAuditEntries` is not yet available.
  const shipmentEventEntries: Array<{
    _id: string;
    eventType: string;
    userName: string;
    timestamp: number;
    data: {
      trackingNumber?: string;
      originName?: string;
      destinationName?: string;
    };
    hash: undefined;
    prevHash: undefined;
  }> = shipmentAuditEntries
    ? shipmentAuditEntries.map((entry) => ({
        _id:       entry._id,
        eventType: entry.eventType,   // "shipped"
        userName:  entry.userName,    // "SCAN app"
        timestamp: entry.timestamp,   // shippedAt ?? createdAt
        data: {
          trackingNumber:  entry.trackingNumber,
          originName:      entry.originName,
          destinationName: entry.destinationName,
        },
        hash:     undefined,
        prevHash: undefined,
      }))
    : (shipments ?? []).map((s: ShipmentRecord) => ({
        _id:       `shipped-${s._id}`,
        eventType: "shipped",
        userName:  "SCAN app",
        timestamp: s.shippedAt ?? s.createdAt,
        data: {
          trackingNumber:  s.trackingNumber,
          originName:      s.originName,
          destinationName: s.destinationName,
        },
        hash:     undefined,
        prevHash: undefined,
      }));

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
    // Shipment events — from the new getShipmentEventsForAudit query (Sub-AC 3)
    // or from the legacy useShipmentsByCase fallback.
    ...shipmentEventEntries,
    // Real damage events from the authoritative events table.
    // These replace any synthetic placeholder entries for damage activity.
    ...realDamageEventEntries,
  ].sort((a, b) => b.timestamp - a.timestamp);

  // ── Sub-AC 3: knownActors from Convex getDistinctActors query ────────────
  //
  // useDistinctCaseActors subscribes to api["queries/events"].getDistinctActors,
  // which scans the full events table for this case and returns a deduplicated,
  // alphabetically-sorted list of all actor display-names.
  //
  // This replaces the Sub-AC 1 useMemo derivation that only covered actors
  // from synthetic events (shipments, damage, case creation).  The new Convex
  // query covers ALL event types — status changes, custody handoffs, inspection
  // events, checklist actions, etc. — providing a comprehensive actor list.
  //
  // Real-time fidelity: the actor list updates automatically within ~100–300 ms
  // whenever a SCAN app mutation appends a new event row for this case.
  // New field technicians or pilots appear in the dropdown the moment they act.
  //
  // Loading contract:
  //   undefined → still loading → AuditLedgerFilterPanel shows "Loading…"
  //               and disables the Actor dropdown.
  //   string[]  → deduplicated, sorted actor names ready for the dropdown.
  //               Empty array when no events exist (brand-new case).
  const knownActors = useDistinctCaseActors(caseId);

  // ── Sub-AC 160201-1: Print timestamp (generated at render time) ───────────
  // Captured at render so it reflects the moment the print dialog opens
  // (not the mount time of T5Audit).  Formatted as a locale string for
  // readability on the printed page.
  const printTimestamp = new Date().toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className={styles.audit} data-testid="t5-audit" data-print-target="t5-audit">

      {/* ── Sub-AC 160201-1: Print-only report header ─────────────────── */}
      {/*
        Hidden on screen (display:none in .printOnly).
        Revealed by @media print { .printOnly { display: block } } in
        T5Audit.module.css when window.print() is triggered.
        Provides context on the printed page: title, case ID, print time,
        and a note about hash-chain status.
      */}
      <div className={styles.printOnly} aria-hidden="true">
        <div className={styles.printHeader}>
          <h1 className={styles.printHeaderTitle}>T5 Audit Ledger</h1>
          <p className={styles.printHeaderMeta}>
            Case {caseId} · Printed {printTimestamp}
          </p>
          {ffEnabled && (
            <p className={styles.printHeaderNote}>
              Hash-chain verification active — event hashes are SHA-256 digests.
            </p>
          )}
        </div>
      </div>

      {/* ── Sub-AC 3: Audit Ledger filter panel ───────────────────────── */}
      {/*
        The filter panel is rendered above the paginated ledger table.
        Filter state is owned here (auditFilters / setAuditFilters).

        Sub-AC 3: knownActors now comes from useDistinctCaseActors(caseId),
        a live Convex subscription to api["queries/events"].getDistinctActors.
        This replaces the Sub-AC 1 useMemo derivation that only covered actors
        from synthetic events.  The full events table is now the source of truth
        for actor names — covering all event types including status changes,
        custody handoffs, inspection events, and checklist actions.

        When knownActors === undefined (still loading), the Actor dropdown shows
        "Loading…" and is disabled (AuditLedgerFilterPanel handles this state).
        When knownActors === [] (no events for case), only "All actors" shows.
        When knownActors is a populated string[], those names become options.

        Action options come from the static ACTION_OPTIONS enum defined inside
        AuditLedgerFilterPanel — no additional Convex query needed.

        Sub-AC 2: dateFrom/dateTo/caseIdSearch are owned locally by the filter
        panel via useState.  The `filters` prop provides initial actor/action
        values; those three date/search inputs are internally managed.
        T5Audit stores the committed filter state via handleFilterChange.

        Sub-AC 160201-1: Wrapped in .printHide so the filter controls are
        suppressed in the printed / PDF output — they are interactive UI not
        useful on paper.
      */}
      <div className={styles.printHide}>
        <AuditLedgerFilterPanel
          filters={{ actor: auditFilters.actor, action: auditFilters.action }}
          onFilterChange={handleFilterChange}
          knownActors={knownActors}
          data-testid="t5-filter-panel"
        />
      </div>

      {/* ── Audit Ledger — paginated events table ─────────────────────── */}
      {/*
        Sub-AC 2: The "Audit Ledger" section uses PaginatedAuditLedger, which
        owns the usePaginatedCaseEvents subscription.  This replaces the previous
        synthetic event timeline (which built events from multiple sources) with
        a direct, paginated read from the immutable `events` table.

        State flow:
          LoadingFirstPage → spinner shown inside PaginatedAuditLedger
          CanLoadMore      → AuditLedgerTable + "Load 20 more events" button
          Exhausted        → AuditLedgerTable + "All N events loaded" indicator
          0 results        → AuditLedgerTable's own EmptyLedger state

        Sub-AC 160201-1: The section header right-side is expanded into
        .auditLedgerActions to host both the Hash Chain badge and the Print
        button side by side.  The print button calls handlePrint() which sets
        data-printing-audit on document.body and invokes window.print().
      */}
      <div className={shared.sectionHeader}>
        <h3 className={shared.sectionTitle}>Audit Ledger</h3>
        <div className={styles.auditLedgerActions}>
          {ffEnabled && (
            <span className={styles.auditBadge} aria-label="Audit hash chain enabled">
              Hash Chain
            </span>
          )}
          {/* ── Sub-AC 160201-1: Print toolbar button ─────────────────── */}
          <button
            type="button"
            className={styles.printBtn}
            onClick={handlePrint}
            aria-label="Print audit ledger as PDF"
            data-testid="print-audit-btn"
          >
            {/* Printer SVG (16×16 viewBox, 1.5px stroke) */}
            <svg
              className={styles.printBtnIcon}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              {/* Paper feed tray (top sheet) */}
              <path d="M4.5 6V2.5a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 .5.5V6" />
              {/* Printer body */}
              <rect x="1.5" y="6" width="13" height="7" rx="1" />
              {/* Output tray (bottom paper) */}
              <path d="M4.5 10h7v4h-7z" />
              {/* Status light dot */}
              <circle cx="12" cy="9" r="0.6" fill="currentColor" stroke="none" />
            </svg>
            Print
          </button>

          {/* ── Sub-AC 160202: Export CSV toolbar button ───────────────── */}
          {/*
            Triggers a client-side Blob download of the currently-visible
            audit ledger rows as a RFC 4180 CSV file.  The rows come from
            `latestRowsRef` which PaginatedAuditLedger keeps up-to-date via
            its `onRowsChange` callback whenever Convex pushes new data or
            the user clicks "Load more".

            The button is hidden in print output (.exportCsvBtn in @media print).
            Filename: "audit-<caseId>.csv"
          */}
          <button
            type="button"
            className={styles.exportCsvBtn}
            onClick={handleExportCsv}
            aria-label="Export audit ledger as CSV"
            data-testid="export-csv-btn"
          >
            {/* Download / CSV icon — arrow pointing down into a tray (16×16) */}
            <svg
              className={styles.exportCsvBtnIcon}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              {/* Arrow shaft */}
              <line x1="8" y1="2" x2="8" y2="10" />
              {/* Arrowhead */}
              <polyline points="5,7.5 8,10.5 11,7.5" />
              {/* Download tray baseline */}
              <path d="M2.5 12.5h11" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/*
        Sub-AC 4: `filters={auditFilters}` wires all filter state to the Convex
        paginated query.  PaginatedAuditLedger converts the AuditFilterState to
        PaginatedCaseEventsFilters and passes it to usePaginatedCaseEvents.
        When any filter field changes (date range, actor, action, caseIdSearch),
        the Convex subscription args update → cursor resets to page 1 → server
        re-evaluates the filtered query → filtered results pushed in ~100–300 ms.
      */}
      <PaginatedAuditLedger
        caseId={caseId}
        ffEnabled={ffEnabled}
        filters={auditFilters}
        onRowsChange={handleRowsChange}
      />

      {/* ── Legacy event timeline (supplemental) ────────────────────────── */}
      {/*
        The legacy synthetic timeline is retained below as a supplemental view
        for shipment and case-creation events that may not yet be in the events
        table in all deployment environments.  It is hidden behind an HR divider
        and rendered only when there are synthetic events to show.

        Once the events table is consistently populated by all mutations, this
        section can be removed.

        Sub-AC 160201-1: Wrapped in .printHide so the legacy timeline is
        suppressed in the printed / PDF output.  The paginated AuditLedgerTable
        above is the canonical print representation of the audit trail.
      */}
      {syntheticEvents.length > 0 && (
        <div className={styles.printHide}>
          <hr className={shared.divider} />
          <div className={shared.sectionHeader}>
            <h3 className={shared.sectionTitle}>Event Timeline</h3>
          </div>
          <ol
            className={styles.timeline}
            aria-label="Case audit event timeline"
            reversed
          >
            {syntheticEvents.map((event) => (
              <EventItem key={event._id} event={event} ffEnabled={ffEnabled} />
            ))}
          </ol>
        </div>
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

      {/*
        ── QC Sign-off History — full chronological trail (Sub-AC 4) ────
        QcSignOffHistory subscribes to api["queries/qcSignOff"].getQcSignOffHistory
        via the useQcSignOffHistory Convex real-time hook.  Convex re-evaluates
        and pushes within ~100–300 ms of any submitQcSignOff mutation, satisfying
        the ≤ 2-second real-time fidelity requirement between SCAN app actions
        and the INVENTORY dashboard.

        No `limit` is specified here — T5 (Audit) shows the full chronological
        sign-off trail as part of the comprehensive audit record.  This is the
        canonical full-history view that T1–T4 compact "see Audit tab" notices
        direct operators to.

        Rendered unconditionally when ffEnabled=true — the audit trail is the
        complete record of all QC decisions for this case.
      */}
      <hr className={shared.divider} />
      <QcSignOffHistory caseId={caseId} />

      {/* ── Hash-chain verification footer ────────────────────────── */}
      {/*
        Sub-AC 4b: Gated by FF_AUDIT_HASH_CHAIN (ffEnabled prop).

        HashChainVerificationFooter subscribes to all case events in
        chronological order via useCaseEvents and runs verifyHashChain
        client-side.  Results are displayed as a compact status strip
        showing one of:
          • "Chain Verified" (N entries · SHA-256) — green shield
          • "Chain Integrity Failure" (broken at N, reason code) — amber warning
          • "No Hashed Entries" (pre-FF events only) — neutral notice
          • "Verifying hash chain…" (loading or checking) — neutral spinner

        The footer is suppressed in print output via @media print in
        T5Audit.module.css (the print header already covers hash-chain
        status in the printed report header).

        Not rendered when ffEnabled=false — the FeatureFlagGate is shown
        instead of the full audit view when the flag is off (see the early
        return at line ~572), so this conditional is a belt-and-suspenders
        guard for any render path that reaches this point with the flag off.
      */}
      {ffEnabled && <HashChainVerificationFooter caseId={caseId} />}

      {/*
        ── QR Label Management — operator-permission-gated ──────────────
        Sub-AC 2c: LabelManagementPanel mounted in the T5 Audit layout.
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
