/**
 * AuditLedgerTable — T5 Audit Ledger tabular view
 *
 * Displays audit events in a sortable table with columns:
 *   - Timestamp  (epoch ms → formatted locale string + <time> element)
 *   - Actor      (user display name)
 *   - Action     (event type label)
 *   - Case ID    (Convex document ID, monospace)
 *   - Hash       (SHA-256 hash prefix, shown only when FF_AUDIT_HASH_CHAIN enabled)
 *
 * Sort state is managed internally via useState.  Clicking a column header
 * toggles direction (asc → desc → asc) for that column; clicking a different
 * header resets direction to ascending.
 *
 * No data fetching — all rows are passed in as props.  The parent (T5Audit)
 * owns the data subscription and passes pre-loaded entries here.
 *
 * Accessibility:
 *   - <th aria-sort="ascending|descending|none"> on every column
 *   - Sort button aria-label describes current sort state
 *   - <time dateTime="ISO8601"> on every timestamp cell
 *   - Role="region" scroll container with aria-label
 *   - WCAG AA contrast via design-token CSS custom properties
 *
 * Design system compliance:
 *   - No hex literals — CSS custom properties only (see AuditLedgerTable.module.css)
 *   - Inter Tight for all UI text
 *   - IBM Plex Mono for Case ID and Hash values
 */

"use client";

import { useState, useCallback } from "react";
import styles from "./AuditLedgerTable.module.css";
import shared from "./shared.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/** The five sortable columns of the ledger table. */
export type AuditLedgerSortColumn =
  | "timestamp"
  | "actor"
  | "action"
  | "caseId"
  | "hash";

export type AuditLedgerSortDirection = "asc" | "desc";

export interface AuditLedgerSortState {
  column: AuditLedgerSortColumn;
  direction: AuditLedgerSortDirection;
}

/** A single row in the audit ledger table. */
export interface AuditLedgerRow {
  /** Unique row identifier — used as React key */
  id: string;
  /** Event timestamp in epoch milliseconds */
  timestamp: number;
  /** Display name of the actor who performed the action */
  actor: string;
  /** Human-readable event type label (e.g. "Status Changed", "Shipped") */
  action: string;
  /** Convex case document ID for the affected case */
  caseId: string;
  /** SHA-256 hash of this event (present only when hash chain is active) */
  hash?: string;
}

interface AuditLedgerTableProps {
  /** Pre-loaded audit event rows — no data fetching inside this component */
  rows: AuditLedgerRow[];
  /**
   * When true, the Hash column is shown and populated.
   * Should mirror the FF_AUDIT_HASH_CHAIN feature flag.
   * @default true
   */
  ffEnabled?: boolean;
  /** Initial sort state — defaults to timestamp descending (newest first). */
  initialSort?: AuditLedgerSortState;
  /** data-testid passthrough */
  "data-testid"?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    month:  "short",
    day:    "numeric",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function sortRows(
  rows: AuditLedgerRow[],
  sort: AuditLedgerSortState
): AuditLedgerRow[] {
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (sort.column) {
      case "timestamp":
        return (a.timestamp - b.timestamp) * dir;
      case "actor":
        return a.actor.localeCompare(b.actor) * dir;
      case "action":
        return a.action.localeCompare(b.action) * dir;
      case "caseId":
        return a.caseId.localeCompare(b.caseId) * dir;
      case "hash":
        return ((a.hash ?? "").localeCompare(b.hash ?? "")) * dir;
      default:
        return 0;
    }
  });
}

// ─── Column header button ──────────────────────────────────────────────────────

interface ColumnHeaderProps {
  label: string;
  column: AuditLedgerSortColumn;
  currentSort: AuditLedgerSortState;
  onSort: (column: AuditLedgerSortColumn) => void;
}

function ColumnHeader({ label, column, currentSort, onSort }: ColumnHeaderProps) {
  const isActive = currentSort.column === column;
  const direction = isActive ? currentSort.direction : null;

  const ariaSortValue = isActive
    ? direction === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <th
      scope="col"
      className={[
        styles.th,
        isActive ? styles.thActive : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-sort={ariaSortValue}
      data-column={column}
    >
      <button
        type="button"
        className={styles.sortBtn}
        onClick={() => onSort(column)}
        aria-label={
          isActive
            ? `Sort by ${label}, currently ${direction === "asc" ? "ascending" : "descending"}`
            : `Sort by ${label}`
        }
        data-testid={`sort-${column}`}
      >
        <span className={styles.sortBtnLabel}>{label}</span>
        <span className={styles.sortIcon} aria-hidden="true">
          {isActive
            ? direction === "asc"
              ? "↑"
              : "↓"
            : "↕"}
        </span>
      </button>
    </th>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyLedger() {
  return (
    <div className={shared.emptyState} data-testid="ledger-empty">
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
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <line x1="9" y1="12" x2="15" y2="12" />
        <line x1="9" y1="16" x2="12" y2="16" />
      </svg>
      <p className={shared.emptyStateTitle}>No audit events recorded</p>
      <p className={shared.emptyStateText}>
        Events will appear here as actions are performed on this case.
      </p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AuditLedgerTable({
  rows,
  ffEnabled = true,
  initialSort = { column: "timestamp", direction: "desc" },
  "data-testid": testId = "audit-ledger-table",
}: AuditLedgerTableProps) {
  const [sort, setSort] = useState<AuditLedgerSortState>(initialSort);

  /**
   * Handle column header click.
   * Same column: toggle direction asc ↔ desc.
   * Different column: set that column, reset to asc.
   */
  const handleSort = useCallback((column: AuditLedgerSortColumn) => {
    setSort((prev) => {
      if (prev.column === column) {
        return {
          column,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { column, direction: "asc" };
    });
  }, []);

  if (rows.length === 0) {
    return (
      <div data-testid={testId}>
        <EmptyLedger />
      </div>
    );
  }

  const sortedRows = sortRows(rows, sort);

  return (
    <div className={styles.ledgerWrapper} data-testid={testId}>
      {/* Horizontally scrollable on narrow viewports */}
      <div
        className={styles.tableScroll}
        role="region"
        aria-label="Audit event ledger"
      >
        <table
          className={styles.table}
          aria-label="Audit event ledger"
          data-sort-column={sort.column}
          data-sort-direction={sort.direction}
        >
          <thead className={styles.thead}>
            <tr>
              <ColumnHeader
                label="Timestamp"
                column="timestamp"
                currentSort={sort}
                onSort={handleSort}
              />
              <ColumnHeader
                label="Actor"
                column="actor"
                currentSort={sort}
                onSort={handleSort}
              />
              <ColumnHeader
                label="Action"
                column="action"
                currentSort={sort}
                onSort={handleSort}
              />
              <ColumnHeader
                label="Case ID"
                column="caseId"
                currentSort={sort}
                onSort={handleSort}
              />
              {ffEnabled && (
                <ColumnHeader
                  label="Hash"
                  column="hash"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
            </tr>
          </thead>

          <tbody className={styles.tbody}>
            {sortedRows.map((row) => (
              <tr
                key={row.id}
                className={styles.tr}
                data-testid="ledger-row"
                data-row-id={row.id}
              >
                {/* ── Timestamp ──────────────────────────────── */}
                <td className={[styles.td, styles.tdTimestamp].join(" ")}>
                  <time
                    dateTime={new Date(row.timestamp).toISOString()}
                    className={[shared.timestamp, styles.timestampCell].join(" ")}
                    data-testid="cell-timestamp"
                  >
                    {formatTimestamp(row.timestamp)}
                  </time>
                </td>

                {/* ── Actor ──────────────────────────────────── */}
                <td className={styles.td}>
                  <span className={styles.cellActor} data-testid="cell-actor">
                    {row.actor}
                  </span>
                </td>

                {/* ── Action ─────────────────────────────────── */}
                <td className={styles.td}>
                  <span className={styles.cellAction} data-testid="cell-action">
                    {row.action}
                  </span>
                </td>

                {/* ── Case ID ────────────────────────────────── */}
                <td className={styles.td}>
                  <code
                    className={styles.cellCaseId}
                    data-testid="cell-case-id"
                    aria-label={`Case ID: ${row.caseId}`}
                  >
                    {row.caseId}
                  </code>
                </td>

                {/* ── Hash (feature-gated) ────────────────────── */}
                {ffEnabled && (
                  <td className={styles.td}>
                    {row.hash ? (
                      <code
                        className={styles.cellHash}
                        title={row.hash}
                        aria-label={`SHA-256 hash: ${row.hash}`}
                        data-testid="cell-hash"
                      >
                        {row.hash.slice(0, 12)}…
                      </code>
                    ) : (
                      <span
                        className={styles.cellHashEmpty}
                        aria-label="No hash"
                        data-testid="cell-hash-empty"
                      >
                        —
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Row count footer */}
      <div className={styles.ledgerFooter} aria-live="polite" aria-atomic="true">
        <span className={styles.rowCount} data-testid="ledger-row-count">
          {sortedRows.length} event{sortedRows.length !== 1 ? "s" : ""}
        </span>
        <span className={styles.sortIndicator}>
          Sorted by{" "}
          <span className={styles.sortIndicatorCol}>
            {sort.column === "caseId"
              ? "Case ID"
              : sort.column.charAt(0).toUpperCase() + sort.column.slice(1)}
          </span>{" "}
          ({sort.direction === "asc" ? "A → Z" : "Z → A"})
        </span>
      </div>
    </div>
  );
}
