/**
 * CaseStatusTable — Real-time case list with Convex useQuery subscriptions.
 *
 * Displays all cases in a filterable, scrollable table in the INVENTORY
 * dashboard.  Two Convex subscriptions drive the component:
 *
 *   1. useAllCases() → api.cases.listCases({})
 *      Reactive list of all case documents, ordered by updatedAt descending.
 *      Convex re-evaluates within ~100–300 ms whenever any case row changes
 *      (SCAN check-in, custody handoff, status edit, etc.).
 *
 *   2. useCaseStatusCounts() → api.cases.getCaseStatusCounts({})
 *      Aggregate counts per lifecycle status for the status filter bar.
 *      Convex re-evaluates on any case status change — the badge counts
 *      update live alongside the table rows.
 *
 * Status rendering:
 *   All status values are rendered via <StatusPill kind={status} /> — never
 *   ad-hoc colored spans.  This ensures design-system compliance across all
 *   case status states (hangar, assembled, transit_out, deployed, flagged,
 *   recalled, transit_in, received, archived).
 *
 * Status filter:
 *   A pill-shaped filter bar at the top lets operators click a status to
 *   show only cases in that phase.  Clicking "All" (or the active filter)
 *   clears the filter and shows the full fleet.  Filter state is local
 *   (not URL-persisted) — this is a read-only visibility control.
 *
 * Case selection:
 *   Clicking a row fires `onSelectCase(caseId)` so the parent can open the
 *   case detail panel (e.g., setting the ?case= URL param in InventoryMapClient).
 *   The currently selected row receives `data-selected="true"` for CSS styling.
 *
 * Loading state:
 *   While either subscription is pending (result === undefined), skeleton
 *   shimmer rows are rendered in the table body and shimmer pills in the
 *   status bar — no layout shift on data arrival.
 *
 * Empty state:
 *   When the filtered result is an empty array, a centered empty-state
 *   message is shown inside the table body.
 *
 * Real-time fidelity:
 *   Both useAllCases() and useCaseStatusCounts() wrap Convex useQuery() —
 *   they establish WebSocket subscriptions that receive pushed diff updates
 *   within ~100–300 ms of any SCAN app mutation.  The component re-renders
 *   automatically, satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Design system compliance:
 *   - No hex literals — all colors from CSS custom properties
 *   - Inter Tight for UI text, IBM Plex Mono for case labels and timestamps
 *   - StatusPill is the single source of truth for all status rendering
 *   - WCAG AA contrast in both light and dark themes
 */

"use client";

import { useState, useCallback, useMemo } from "react";
import { StatusPill } from "../StatusPill";
import type { StatusKind } from "../StatusPill";
import {
  useAllCases,
  useCaseStatusCounts,
} from "../../hooks/use-case-status";
import type { CaseStatus } from "../../hooks/use-case-status";
import styles from "./CaseStatusTable.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * All case lifecycle statuses in display order.
 * Mirrors CASE_STATUSES in convex/cases.ts and the CaseStatus union.
 */
const CASE_STATUSES: CaseStatus[] = [
  "hangar",
  "assembled",
  "transit_out",
  "deployed",
  "flagged",
  "recalled",
  "transit_in",
  "received",
  "archived",
];

/**
 * Human-readable labels for the status filter bar.
 * Shorter than StatusPill labels to fit in the compact bar.
 */
const STATUS_FILTER_LABELS: Record<CaseStatus, string> = {
  hangar:      "Hangar",
  assembled:   "Assembled",
  transit_out: "Transit Out",
  deployed:    "Deployed",
  flagged:     "Flagged",
  recalled:    "Recalled",
  transit_in:  "Transit In",
  received:    "Received",
  archived:    "Archived",
};

/** Number of skeleton rows to show while loading. */
const SKELETON_ROW_COUNT = 8;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an epoch-ms timestamp as a concise relative or absolute string.
 * Shows "Today HH:MM" for today, "Mon DD" for this year, otherwise "Mon DD, YYYY".
 */
function formatTimestamp(epochMs: number): string {
  const date = new Date(epochMs);
  const now = new Date();

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const isThisYear = date.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * StatusBarSkeleton — shimmer placeholder while getCaseStatusCounts loads.
 */
function StatusBarSkeleton() {
  return (
    <div className={styles.statusBarSkeleton} aria-hidden="true">
      {[80, 100, 90, 110, 70].map((w, i) => (
        <div
          key={i}
          className={styles.skeletonPill}
          style={{ width: `${w}px` }}
        />
      ))}
    </div>
  );
}

/**
 * TableSkeleton — shimmer placeholder while listCases loads.
 */
function TableSkeleton() {
  return (
    <>
      {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
        <tr key={i} className={styles.skeletonRow}>
          <td className={styles.skeletonCell}>
            <div className={`${styles.skeletonBar} ${styles.skeletonBarMed}`} />
          </td>
          <td className={styles.skeletonCell}>
            <div className={`${styles.skeletonBar} ${styles.skeletonBarStatus}`} />
          </td>
          <td className={styles.skeletonCell}>
            <div className={`${styles.skeletonBar} ${styles.skeletonBarLong}`} />
          </td>
          <td className={styles.skeletonCell}>
            <div className={`${styles.skeletonBar} ${styles.skeletonBarMed}`} />
          </td>
          <td className={styles.skeletonCell}>
            <div className={`${styles.skeletonBar} ${styles.skeletonBarShort}`} />
          </td>
        </tr>
      ))}
    </>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CaseStatusTableProps {
  /**
   * Called when the user clicks a case row.
   * The parent uses this to open the case detail panel.
   * @param caseId  Convex document ID of the selected case.
   */
  onSelectCase?: (caseId: string) => void;

  /**
   * Currently selected case ID (for visual selection highlight).
   * Set to null when no case is selected.
   */
  selectedCaseId?: string | null;

  /**
   * Additional CSS class for the root element.
   */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * CaseStatusTable — live, filterable case fleet table.
 *
 * Subscribes to all cases and aggregate status counts via Convex real-time
 * queries.  Both subscriptions update reactively within ~100–300 ms of any
 * SCAN app mutation — no manual refresh required.
 */
export function CaseStatusTable({
  onSelectCase,
  selectedCaseId = null,
  className,
}: CaseStatusTableProps) {
  // ── Local filter state ─────────────────────────────────────────────────────
  //
  // statusFilter = null → show all statuses ("All" selected)
  // statusFilter = CaseStatus → show only cases with that status
  //
  // This is intentionally local state (not URL) — it is a UI convenience
  // filter that does not need to survive page reload or be shareable via link.
  const [statusFilter, setStatusFilter] = useState<CaseStatus | null>(null);

  // ── Convex subscriptions ───────────────────────────────────────────────────
  //
  // useAllCases() wraps useQuery(api.cases.listCases, {}) from convex/react.
  // Convex maintains a persistent WebSocket subscription and pushes diff updates
  // whenever any row in the `cases` table is mutated — satisfying the ≤ 2-second
  // real-time fidelity requirement between SCAN app actions and this dashboard view.
  //
  // Result contract:
  //   undefined  → initial fetch in flight (show skeleton)
  //   Doc[]      → case list (may be empty array)
  const allCases = useAllCases();

  // useCaseStatusCounts() wraps useQuery(api.cases.getCaseStatusCounts, {}).
  // Re-evaluates on any cases table write — the pill counts update together with
  // the table rows so the status bar always matches what is visible in the table.
  //
  // Result contract:
  //   undefined           → initial fetch in flight (show skeleton)
  //   CaseStatusCounts    → { total: number; byStatus: Record<CaseStatus, number> }
  const counts = useCaseStatusCounts();

  // ── Derived: filtered rows ─────────────────────────────────────────────────
  //
  // When statusFilter is set, filter the case list client-side.
  // Because allCases is already sorted by updatedAt desc (server-side ordering
  // via the by_updated index in listCases handler), the filtered result is also
  // in recency order without a secondary sort.
  //
  // useMemo so the filter only re-runs when allCases or statusFilter changes —
  // not on unrelated parent state updates.
  const filteredCases = useMemo(() => {
    if (!allCases) return undefined; // propagate loading state
    if (!statusFilter) return allCases;
    return allCases.filter((c) => c.status === statusFilter);
  }, [allCases, statusFilter]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleStatusFilterClick = useCallback(
    (status: CaseStatus) => {
      setStatusFilter((prev) => (prev === status ? null : status));
    },
    []
  );

  const handleClearFilter = useCallback(() => {
    setStatusFilter(null);
  }, []);

  const handleRowClick = useCallback(
    (caseId: string) => {
      onSelectCase?.(caseId);
    },
    [onSelectCase]
  );

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableRowElement>, caseId: string) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelectCase?.(caseId);
      }
    },
    [onSelectCase]
  );

  // ── Loading states ─────────────────────────────────────────────────────────
  const isCountsLoading = counts === undefined;
  const isCasesLoading  = filteredCases === undefined;

  const rootClass = [styles.root, className].filter(Boolean).join(" ");

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={rootClass} data-testid="case-status-table">

      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Cases</h1>
          <p className={styles.pageTitleSub}>
            Real-time fleet case registry — updates live via Convex
          </p>
        </div>
      </div>

      {/* ── Status summary bar ───────────────────────────────────────── */}
      {/*
        Subscribes to getCaseStatusCounts via useCaseStatusCounts().
        The count badges update reactively whenever any SCAN app mutation
        changes a case status — satisfying the ≤ 2-second real-time SLA.
        Each pill doubles as a filter control: clicking filters the table
        to show only cases with that status.
      */}
      {isCountsLoading ? (
        <StatusBarSkeleton />
      ) : (
        <div
          className={styles.statusBar}
          role="toolbar"
          aria-label="Filter cases by status"
        >
          {/* Total count */}
          <div className={styles.statusBarTotal} aria-live="polite" aria-atomic="true">
            <span className={styles.statusBarTotalLabel}>Total</span>
            <span className={styles.statusBarTotalCount}>{counts!.total}</span>
          </div>

          <div className={styles.statusBarDivider} aria-hidden="true" />

          {/* Per-status filter pills — only show statuses with ≥ 0 count */}
          {CASE_STATUSES.map((status) => {
            const count = counts!.byStatus[status] ?? 0;
            // Skip statuses with zero cases to keep the bar compact.
            // When a filter is active and its count drops to 0, keep it visible
            // so the user can clearly see the filter is active but shows no results.
            if (count === 0 && status !== statusFilter) return null;

            const isActive = statusFilter === status;
            return (
              <button
                key={status}
                type="button"
                className={styles.statusBarItem}
                aria-pressed={isActive}
                onClick={() => handleStatusFilterClick(status)}
                title={
                  isActive
                    ? `Clear ${STATUS_FILTER_LABELS[status]} filter`
                    : `Filter to ${STATUS_FILTER_LABELS[status]} cases`
                }
              >
                {/* Status pill — uses design system tokens via StatusPill */}
                <StatusPill kind={status as StatusKind} />
                {/* Count badge */}
                <span className={styles.statusBarCount} aria-label={`${count} cases`}>
                  {count}
                </span>
              </button>
            );
          })}

          {/* Clear filter button — visible when a filter is active */}
          {statusFilter !== null && (
            <>
              <div className={styles.statusBarDivider} aria-hidden="true" />
              <button
                type="button"
                className={styles.statusBarItem}
                onClick={handleClearFilter}
                aria-label="Clear status filter — show all cases"
                title="Show all cases"
              >
                All
                <span className={styles.statusBarCount}>
                  {counts!.total}
                </span>
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Case table ──────────────────────────────────────────────── */}
      <div className={styles.tableWrapper}>
        <table
          className={styles.table}
          aria-label="Case fleet table — updates in real time"
          aria-busy={isCasesLoading}
          aria-live="polite"
          aria-atomic="false"
          aria-relevant="all"
        >
          <thead className={styles.thead}>
            <tr>
              <th className={styles.th} scope="col">Case ID</th>
              <th className={styles.th} scope="col">Status</th>
              <th className={styles.th} scope="col">Location</th>
              <th className={styles.th} scope="col">Assigned To</th>
              <th className={styles.th} scope="col">Updated</th>
            </tr>
          </thead>

          <tbody className={styles.tbody}>
            {/* Loading skeleton — shown while Convex initial fetch is in flight */}
            {isCasesLoading && <TableSkeleton />}

            {/* Empty state — shown when query resolved but no cases match */}
            {!isCasesLoading && filteredCases!.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className={styles.emptyState}>
                    <p className={styles.emptyTitle}>
                      {statusFilter
                        ? `No ${STATUS_FILTER_LABELS[statusFilter].toLowerCase()} cases`
                        : "No cases found"}
                    </p>
                    <p className={styles.emptyText}>
                      {statusFilter
                        ? "There are currently no cases with this status. Cases appear here when their status changes."
                        : "Cases will appear here once they are created in the system."}
                    </p>
                    {statusFilter && (
                      <button
                        type="button"
                        className={styles.statusBarItem}
                        onClick={handleClearFilter}
                        aria-label="Clear filter and show all cases"
                      >
                        Show all cases
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {/* Case rows — rendered once subscription delivers data.
                Each row reactively re-renders when its case status changes
                via the Convex subscription pushing a new allCases array. */}
            {!isCasesLoading &&
              filteredCases!.map((caseDoc) => {
                const isSelected = caseDoc._id === selectedCaseId;

                return (
                  <tr
                    key={caseDoc._id}
                    className={styles.tr}
                    data-selected={isSelected ? "true" : undefined}
                    data-testid={`case-row-${caseDoc._id}`}
                    data-case-id={caseDoc._id}
                    data-status={caseDoc.status}
                    onClick={() => handleRowClick(caseDoc._id)}
                    onKeyDown={(e) => handleRowKeyDown(e, caseDoc._id)}
                    tabIndex={0}
                    role="row"
                    aria-selected={isSelected}
                    aria-label={`Case ${caseDoc.label}, status: ${caseDoc.status}`}
                    title={caseDoc.recallReason ? `Recall reason: ${caseDoc.recallReason}` : undefined}
                  >
                    {/* Case label — IBM Plex Mono, machine-readable identifier */}
                    <td className={`${styles.td} ${styles.labelCell}`}>
                      {caseDoc.label}
                    </td>

                    {/* Status — always rendered via <StatusPill> for design compliance */}
                    <td className={`${styles.td} ${styles.statusCell}`}>
                      <span title={caseDoc.recallReason ? `Recall reason: ${caseDoc.recallReason}` : undefined}>
                        <StatusPill kind={caseDoc.status as StatusKind} />
                      </span>
                    </td>

                    {/* Location — optional; shows dash when not set */}
                    <td className={`${styles.td} ${styles.locationCell}`}>
                      {caseDoc.locationName ?? (
                        <span className={styles.dash} aria-label="No location">—</span>
                      )}
                    </td>

                    {/* Assignee — optional; shows dash when not set */}
                    <td className={`${styles.td} ${styles.assigneeCell}`}>
                      {caseDoc.assigneeName ?? (
                        <span className={styles.dash} aria-label="Unassigned">—</span>
                      )}
                    </td>

                    {/* Last updated timestamp — IBM Plex Mono for data alignment */}
                    <td className={`${styles.td} ${styles.updatedCell}`}>
                      <time
                        dateTime={new Date(caseDoc.updatedAt).toISOString()}
                        title={new Date(caseDoc.updatedAt).toLocaleString()}
                      >
                        {formatTimestamp(caseDoc.updatedAt)}
                      </time>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CaseStatusTable;
