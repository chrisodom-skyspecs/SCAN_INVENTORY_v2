/**
 * T3SwimLane — Four-column swim-lane fleet operations board.
 *
 * Organizes equipment cases into four lifecycle stage columns:
 *
 *   Hangar   — cases in storage or assembly (hangar, assembled)
 *   Carrier  — cases in outbound transit via carrier (transit_out, label_created,
 *               picked_up, in_transit, out_for_delivery)
 *   Field    — cases deployed or flagged at site (deployed, flagged)
 *   Returning — cases on inbound journey or received back (transit_in,
 *               delivered, received, archived)
 *
 * Design principles:
 *   - Pure layout component: accepts pre-fetched case data as props.
 *     Data loading lives in a parent container (e.g. T3SwimLaneConnected).
 *   - CSS grid with 4 equal columns on desktop; horizontal scroll on smaller
 *     viewports (each column has a 15rem / 240px minimum width).
 *   - Per-column empty-state placeholder with context-specific messaging.
 *   - Loading state renders skeleton cards in each column.
 *   - All colors via design-system CSS custom properties — no hex literals.
 *   - StatusPill for all status rendering.
 *   - WCAG AA contrast in light and dark themes.
 *
 * Usage:
 *   <T3SwimLane
 *     cases={cases}
 *     selectedCaseId={selectedId}
 *     onSelectCase={handleSelect}
 *   />
 */

"use client";

import type { StatusKind } from "../StatusPill/StatusPill";
import { StatusPill } from "../StatusPill";
import styles from "./T3SwimLane.module.css";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Minimal case data shape required by the swim-lane component.
 * Consumers map their full case objects to this interface before passing them.
 */
export interface SwimLaneCase {
  /** Convex document ID or other unique identifier for the case. */
  id: string;
  /** Primary display identifier — serial/QR label, shown in mono font. */
  label: string;
  /** Current lifecycle status — drives column assignment and StatusPill. */
  status: StatusKind;
  /** Optional secondary identifier (template name, case type, etc.). */
  subLabel?: string;
  /** Current location label (depot name, site name, city, etc.). */
  location?: string;
  /** Person or team currently assigned custody of this case. */
  assignee?: string;
  /** True when the case has at least one open damage/flag report. */
  hasDamage?: boolean;
  /** True when the case has an active outbound or inbound shipment. */
  hasShipment?: boolean;
}

/** The four swim-lane column identifiers. */
export type SwimLaneColumnId = "hangar" | "carrier" | "field" | "returning";

export interface T3SwimLaneProps {
  /**
   * Array of cases to distribute across the four columns.
   * Cases are partitioned by `status` using the COLUMN_STATUSES map.
   * If undefined, all columns render loading skeletons.
   */
  cases?: SwimLaneCase[];
  /**
   * ID of the currently selected case. The matching card receives
   * `aria-selected="true"` and the selected card style.
   */
  selectedCaseId?: string;
  /**
   * Called when the user clicks a case card, with the case ID.
   * If omitted, cards render as non-interactive display elements.
   */
  onSelectCase?: (caseId: string) => void;
  /**
   * When true, renders loading skeleton cards in each column instead of
   * real case data. Set while the parent is fetching from Convex.
   */
  isLoading?: boolean;
  /**
   * When set, each column renders an inline error state instead of cards
   * or skeletons. Accepts an Error object, a string message, or null/undefined
   * (no error).  Typically driven by a caught Convex query failure.
   */
  error?: Error | string | null;
  /**
   * Optional callback invoked when the user clicks "Try again" in the error
   * state. When omitted, no retry button is shown.
   */
  onRetry?: () => void;
  /** Additional class applied to the outermost grid wrapper. */
  className?: string;
}

// ─── Column definitions ───────────────────────────────────────────────────────

interface ColumnDef {
  id: SwimLaneColumnId;
  /** Human-readable column header label */
  label: string;
  /** Statuses that route to this column */
  statuses: StatusKind[];
  /** Primary message when the column has no cases */
  emptyTitle: string;
  /** Supporting message for the empty state */
  emptyText: string;
}

/**
 * Ordered column definitions.
 * The `statuses` arrays are disjoint — each StatusKind maps to exactly one
 * column. Statuses not listed anywhere fall through to the "hangar" column.
 */
const COLUMNS: ColumnDef[] = [
  {
    id: "hangar",
    label: "Hangar",
    statuses: ["hangar", "assembled"],
    emptyTitle: "No cases in hangar",
    emptyText: "Cases appear here when staged for assembly or stored.",
  },
  {
    id: "carrier",
    label: "Carrier",
    statuses: [
      "transit_out",
      "label_created",
      "picked_up",
      "in_transit",
      "out_for_delivery",
    ],
    emptyTitle: "No cases in transit",
    emptyText: "Cases appear here once handed off to a carrier.",
  },
  {
    id: "field",
    label: "Field",
    statuses: ["deployed", "flagged"],
    emptyTitle: "No cases deployed",
    emptyText: "Cases appear here when they arrive at a field site.",
  },
  {
    id: "returning",
    label: "Returning",
    statuses: ["transit_in", "delivered", "received", "archived"],
    emptyTitle: "No cases returning",
    emptyText: "Cases appear here when shipped back to base.",
  },
];

/** Fast O(1) lookup: status → column ID. Built once at module load. */
const STATUS_TO_COLUMN: Map<StatusKind, SwimLaneColumnId> = new Map(
  COLUMNS.flatMap((col) =>
    col.statuses.map((status) => [status, col.id] as [StatusKind, SwimLaneColumnId])
  )
);

/** Partition cases into their respective columns. */
function partitionCases(
  cases: SwimLaneCase[]
): Record<SwimLaneColumnId, SwimLaneCase[]> {
  const buckets: Record<SwimLaneColumnId, SwimLaneCase[]> = {
    hangar:    [],
    carrier:   [],
    field:     [],
    returning: [],
  };
  for (const c of cases) {
    const colId = STATUS_TO_COLUMN.get(c.status) ?? "hangar";
    buckets[colId].push(c);
  }
  return buckets;
}

// ─── Skeleton loading card ────────────────────────────────────────────────────

function SkeletonCard({ index }: { index: number }) {
  // Vary widths for a natural-looking shimmer pattern
  const widths = ["skeletonLineFull", "skeletonLineMed", "skeletonLineShort"] as const;
  const w = widths[index % widths.length];
  return (
    <li className={styles.skeletonCard} aria-hidden="true">
      <div className={`${styles.skeletonLine} ${styles.skeletonLineFull}`} />
      <div className={`${styles.skeletonLine} ${styles[w]}`} />
    </li>
  );
}

// ─── Empty-state placeholder ──────────────────────────────────────────────────

interface EmptyStateProps {
  title: string;
  text: string;
}

function EmptyState({ title, text }: EmptyStateProps) {
  return (
    <li className={styles.emptyState} role="presentation">
      {/* Box icon — fully inlined SVG so no external dependency */}
      <svg
        className={styles.emptyStateIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </svg>
      <p className={styles.emptyStateTitle}>{title}</p>
      <p className={styles.emptyStateText}>{text}</p>
    </li>
  );
}

// ─── Error-state placeholder ──────────────────────────────────────────────────

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <li className={styles.errorState} role="alert" aria-live="assertive">
      {/* Alert triangle icon — fully inlined SVG */}
      <svg
        className={styles.errorStateIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
      <p className={styles.errorStateTitle}>Failed to load</p>
      {message && (
        <p className={styles.errorStateText}>{message}</p>
      )}
      {onRetry && (
        <button
          type="button"
          className={styles.errorStateRetry}
          onClick={onRetry}
        >
          Try again
        </button>
      )}
    </li>
  );
}

// ─── Case card ────────────────────────────────────────────────────────────────

interface CaseCardProps {
  caseData: SwimLaneCase;
  isSelected: boolean;
  onSelect?: (id: string) => void;
}

function CaseCard({ caseData, isSelected, onSelect }: CaseCardProps) {
  const isInteractive = typeof onSelect === "function";
  const cardClass = [
    styles.card,
    !isInteractive ? styles.cardStatic : "",
  ]
    .filter(Boolean)
    .join(" ");

  function handleClick() {
    onSelect?.(caseData.id);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(caseData.id);
    }
  }

  const metaItems: Array<{ key: string; text: string }> = [];
  if (caseData.location) {
    metaItems.push({ key: "loc", text: caseData.location });
  }
  if (caseData.assignee) {
    metaItems.push({ key: "asgn", text: caseData.assignee });
  }

  const cardElement = (
    <>
      {/* Top row: label + status pill */}
      <div className={styles.cardTop}>
        <span
          className={styles.cardLabel}
          title={caseData.label}
        >
          {caseData.label}
        </span>
        <StatusPill kind={caseData.status} />
      </div>

      {/* Sub-label row */}
      {caseData.subLabel && (
        <p className={styles.cardSubLabel} title={caseData.subLabel}>
          {caseData.subLabel}
        </p>
      )}

      {/* Meta row: location, assignee, damage flag */}
      {(metaItems.length > 0 || caseData.hasDamage) && (
        <div className={styles.cardMeta}>
          {caseData.hasDamage && (
            <span
              className={styles.cardMetaItem}
              aria-label="Has damage reports"
            >
              <span
                className={styles.cardFlagDot}
                aria-hidden="true"
              />
              Flagged
            </span>
          )}
          {metaItems.map(({ key, text }) => (
            <span
              key={key}
              className={styles.cardMetaItem}
              title={text}
            >
              {text}
            </span>
          ))}
        </div>
      )}
    </>
  );

  if (isInteractive) {
    return (
      <li>
        <button
          type="button"
          className={cardClass}
          aria-selected={isSelected}
          aria-label={`Case ${caseData.label}${isSelected ? ", selected" : ""}`}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          data-testid={`swim-lane-card-${caseData.id}`}
        >
          {cardElement}
        </button>
      </li>
    );
  }

  return (
    <li
      className={cardClass}
      aria-label={`Case ${caseData.label}`}
      data-testid={`swim-lane-card-${caseData.id}`}
    >
      {cardElement}
    </li>
  );
}

// ─── Swim-lane column ─────────────────────────────────────────────────────────

interface SwimLaneColumnProps {
  column: ColumnDef;
  cases: SwimLaneCase[];
  selectedCaseId?: string;
  onSelectCase?: (id: string) => void;
  isLoading: boolean;
  /** When set, the column renders an error state instead of cards or skeletons. */
  error?: Error | string | null;
  /** Retry callback forwarded to the per-column ErrorState button. */
  onRetry?: () => void;
}

/** Number of skeleton cards to show per column while loading. */
const SKELETON_COUNT = 3;

function SwimLaneColumn({
  column,
  cases,
  selectedCaseId,
  onSelectCase,
  isLoading,
  error,
  onRetry,
}: SwimLaneColumnProps) {
  const hasError = error != null;
  const count = cases.length;

  // When in error state, show "!" in the badge; when loading, show "…"
  const badgeText = hasError ? "!" : isLoading ? "…" : count;
  const countClass = [
    styles.columnCount,
    hasError
      ? styles.columnCountError
      : count === 0
      ? styles.columnCountZero
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const errorMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : undefined;

  return (
    <div
      className={styles.column}
      data-column={column.id}
      data-testid={`swim-lane-column-${column.id}`}
      role="region"
      aria-label={
        hasError
          ? `${column.label} column, failed to load`
          : `${column.label} column${count > 0 ? `, ${count} case${count !== 1 ? "s" : ""}` : ", empty"}`
      }
    >
      {/* Column header */}
      <div className={styles.columnHeader} data-testid={`swim-lane-col-header-${column.id}`}>
        <h3 className={styles.columnTitle}>{column.label}</h3>
        <span
          className={countClass}
          aria-label={
            hasError
              ? "Error loading cases"
              : `${count} case${count !== 1 ? "s" : ""}`
          }
          data-testid={`swim-lane-col-count-${column.id}`}
        >
          {badgeText}
        </span>
      </div>

      {/* Card list */}
      <ul
        className={styles.cardList}
        aria-label={`${column.label} cases`}
        data-testid={`swim-lane-col-list-${column.id}`}
      >
        {hasError ? (
          /* Error state */
          <ErrorState message={errorMessage} onRetry={onRetry} />
        ) : isLoading ? (
          /* Loading skeletons */
          Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <SkeletonCard key={i} index={i} />
          ))
        ) : count === 0 ? (
          /* Empty state placeholder */
          <EmptyState title={column.emptyTitle} text={column.emptyText} />
        ) : (
          /* Case cards */
          cases.map((c) => (
            <CaseCard
              key={c.id}
              caseData={c}
              isSelected={c.id === selectedCaseId}
              onSelect={onSelectCase}
            />
          ))
        )}
      </ul>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * T3SwimLane renders the four-column swim-lane fleet operations board.
 *
 * Cases are partitioned into columns by status using the STATUS_TO_COLUMN map.
 * Each column shows a sticky header, a case count badge, and a scrollable list
 * of case cards.  When empty the column shows a context-specific placeholder.
 * When isLoading is true all columns show shimmer skeleton cards.
 *
 * @example
 * // Basic usage with real case data
 * <T3SwimLane
 *   cases={cases.map(c => ({
 *     id: c._id,
 *     label: c.label,
 *     status: c.status,
 *     location: c.location,
 *   }))}
 *   selectedCaseId={selectedId}
 *   onSelectCase={setSelectedId}
 * />
 *
 * @example
 * // Loading state while fetching from Convex
 * <T3SwimLane isLoading />
 */
export function T3SwimLane({
  cases,
  selectedCaseId,
  onSelectCase,
  isLoading = false,
  error,
  onRetry,
  className,
}: T3SwimLaneProps) {
  // Error state takes priority — don't attempt to show skeleton or cards
  const hasError = error != null;
  // Only show loading when not in error state
  const effectiveLoading = !hasError && (isLoading || cases === undefined);
  const partitioned = cases ? partitionCases(cases) : {
    hangar: [], carrier: [], field: [], returning: [],
  };

  const gridClass = [styles.swimLane, className].filter(Boolean).join(" ");

  return (
    <div
      className={gridClass}
      role="group"
      aria-label="Fleet operations board"
      data-testid="t3-swim-lane"
    >
      {COLUMNS.map((col) => (
        <SwimLaneColumn
          key={col.id}
          column={col}
          cases={partitioned[col.id]}
          selectedCaseId={selectedCaseId}
          onSelectCase={onSelectCase}
          isLoading={effectiveLoading}
          error={hasError ? error : undefined}
          onRetry={onRetry}
        />
      ))}
    </div>
  );
}

export default T3SwimLane;
