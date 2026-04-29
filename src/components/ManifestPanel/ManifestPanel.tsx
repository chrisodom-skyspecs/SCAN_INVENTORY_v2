/**
 * ManifestPanel — Container component for case manifest items.
 *
 * Fetches and renders the full packing list for a case with per-item status
 * indicators. Designed as a standalone container that can be used in any
 * context (dashboard panels, SCAN app views, print previews) — not tied to
 * the T2 tab layout inside CaseDetailPanel.
 *
 * Data fetching
 * ─────────────
 * Uses `useChecklistByCase` (Convex real-time subscription backed by
 * `api.checklists.getChecklistByCase`) to receive live item updates.
 * Convex re-evaluates and pushes updates within ~100–300 ms whenever the
 * SCAN app records a status change, satisfying the ≤ 2-second real-time
 * fidelity requirement between SCAN app action and dashboard visibility.
 *
 * Status vocabulary
 * ─────────────────
 * The manifest item status values map to display terminology as follows:
 *   "ok"        → "Verified"   — item confirmed present and undamaged
 *   "damaged"   → "Flagged"    — item present but has documented issues
 *   "missing"   → "Missing"    — item not found during inspection
 *   "unchecked" → "Unchecked"  — item not yet reviewed
 *
 * Loading / error states
 * ──────────────────────
 * Loading:  Shows a repeating skeleton row list while Convex resolves.
 * Error:    Shows an error banner with retry functionality.
 * Empty:    Shows a contextual empty-state message when no items exist.
 * Data:     Renders the full item list with status indicators.
 *
 * Props:
 *   caseId      — Convex document ID of the case to display.
 *   className   — Optional outer CSS class override.
 *   showFilters — Show the status filter toolbar (default: true).
 *   showProgress — Show the aggregate progress bar (default: true).
 *   testId      — data-testid for E2E test targeting.
 */

"use client";

import { useState, useCallback } from "react";
import { useChecklistByCase } from "@/hooks/use-checklist";
import { StatusPill } from "@/components/StatusPill";
import { InspectionStatusBar, ItemStatusIcon } from "@/components/ItemStatusBadge";
import { useMapManifestHover } from "@/providers/map-manifest-hover-provider";
import styles from "./ManifestPanel.module.css";
import type { ChecklistItem, ManifestItemStatus } from "@/hooks/use-checklist";
import type { StatusKind } from "@/components/StatusPill/StatusPill";
import type { ItemInspectionStatus } from "@/components/ItemStatusBadge";

// ─── Status mappings ──────────────────────────────────────────────────────────

/**
 * Maps manifest item completion state to the nearest semantic StatusPill kind.
 * Drives the per-row StatusPill in the item list.
 */
const ITEM_STATUS_TO_PILL: Record<ManifestItemStatus, StatusKind> = {
  unchecked: "pending",   // neutral — item not yet reviewed
  ok:        "completed", // success — item verified present and undamaged
  damaged:   "flagged",   // error   — item has documented damage
  missing:   "exception", // error   — item absent from case
};

/**
 * Maps manifest item status to its display label in the UI.
 * "verified" and "flagged" are the user-facing terms; the underlying
 * data model stores "ok" and "damaged" respectively.
 */
const ITEM_STATUS_LABEL: Record<ManifestItemStatus, string> = {
  unchecked: "Unchecked",
  ok:        "Verified",
  damaged:   "Flagged",
  missing:   "Missing",
};

/**
 * Maps manifest item data-model status to the `ItemInspectionStatus` type
 * used by `ItemStatusIcon` / `ItemStatusBadge` for icon + color rendering.
 *
 * Data model  → Display layer
 *   "ok"      → "verified"   (success / green checkmark)
 *   "damaged" → "flagged"    (warning / amber flag)
 *   "missing" → "missing"    (error   / red x-circle)
 *   "unchecked"→ "unchecked" (neutral / gray hollow circle)
 */
const ITEM_STATUS_TO_ICON_STATUS: Record<ManifestItemStatus, ItemInspectionStatus> = {
  unchecked: "unchecked",
  ok:        "verified",
  damaged:   "flagged",
  missing:   "missing",
};

// ─── Status group configuration (ordered by priority for "all" view) ──────────

/**
 * Defines the ordered render groups for the "show all" grouped view.
 * Issues are surfaced first so operators immediately see what needs attention.
 * Priority: missing (critical) → flagged (warning) → unchecked (pending) → verified (done)
 */
interface StatusGroupConfig {
  /** Data-model status to match against `ChecklistItem.status`. */
  status: ManifestItemStatus;
  /** Human-visible group header label. */
  label: string;
  /** Corresponding `ItemInspectionStatus` for icon rendering. */
  iconStatus: ItemInspectionStatus;
}

const STATUS_GROUPS: StatusGroupConfig[] = [
  { status: "missing",   label: "Missing",   iconStatus: "missing"   },
  { status: "damaged",   label: "Flagged",   iconStatus: "flagged"   },
  { status: "unchecked", label: "Unchecked", iconStatus: "unchecked" },
  { status: "ok",        label: "Verified",  iconStatus: "verified"  },
];

// ─── Filter configuration ─────────────────────────────────────────────────────

type FilterKind = "all" | ManifestItemStatus;

interface FilterConfig {
  id: FilterKind;
  label: string;
}

const FILTERS: FilterConfig[] = [
  { id: "all",       label: "All" },
  { id: "unchecked", label: "Unchecked" },
  { id: "ok",        label: "Verified" },
  { id: "damaged",   label: "Flagged" },
  { id: "missing",   label: "Missing" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Skeleton loader — shown while Convex resolves the initial query.
 * Renders `count` placeholder rows matching the item list layout.
 */
function ManifestSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div
      className={styles.skeleton}
      aria-busy="true"
      aria-label="Loading manifest items"
      data-testid="manifest-skeleton"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <div className={`${styles.skeletonBar} ${styles.skeletonBarName}`} />
          <div className={`${styles.skeletonBar} ${styles.skeletonBarStatus}`} />
        </div>
      ))}
    </div>
  );
}

/**
 * Error banner — shown when the Convex subscription throws.
 * Convex's real-time transport automatically retries; this is displayed
 * while a retry is in progress or when auth fails.
 */
interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div
      className={styles.errorBanner}
      role="alert"
      aria-live="polite"
      data-testid="manifest-error"
    >
      <span className={styles.errorIcon} aria-hidden="true">!</span>
      <span className={styles.errorMessage}>{message}</span>
      {onRetry && (
        <button
          type="button"
          className={styles.retryButton}
          onClick={onRetry}
          aria-label="Retry loading manifest items"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * Empty state — shown when the case has no manifest items.
 * Guides the user to apply a case template to define the packing list.
 */
function EmptyState({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return (
      <div className={styles.emptyState} data-testid="manifest-empty-filtered">
        <p className={styles.emptyTitle}>No items match this filter</p>
        <p className={styles.emptyBody}>Try selecting a different status filter.</p>
      </div>
    );
  }
  return (
    <div className={styles.emptyState} data-testid="manifest-empty">
      <p className={styles.emptyTitle}>No manifest items</p>
      <p className={styles.emptyBody}>
        Apply a case template to define the expected packing list for this case.
      </p>
    </div>
  );
}

// ─── ManifestGroup ────────────────────────────────────────────────────────────

/**
 * Props for a single status group section rendered inside the grouped view.
 */
interface ManifestGroupProps {
  config: StatusGroupConfig;
  items: ChecklistItem[];
}

/**
 * Renders a status-group section: a visually differentiated header row (icon +
 * label + count) followed by a list of manifest items in that status bucket.
 *
 * Only rendered when `items.length > 0` — empty groups are omitted entirely
 * so the "issues first" layout collapses cleanly when a status has no items.
 *
 * The group header is `aria-hidden` because the containing `<ul>` on each
 * group carries an `aria-label` that conveys the same grouping context to
 * screen readers.
 */
function ManifestGroup({ config, items }: ManifestGroupProps) {
  if (items.length === 0) return null;

  return (
    <div className={styles.statusGroup} data-status={config.status}>
      {/* Group header — decorative for sighted users; aria-hidden to avoid
          duplication since the <ul> aria-label conveys the group name. */}
      <div className={styles.groupHeader} aria-hidden="true" data-status={config.status}>
        <span className={styles.groupHeaderIcon}>
          <ItemStatusIcon status={config.iconStatus} size="sm" />
        </span>
        <span className={styles.groupHeaderLabel}>{config.label}</span>
        <span className={styles.groupHeaderCount}>{items.length}</span>
      </div>
      <ul
        className={styles.groupItemList}
        aria-label={`${config.label} items`}
      >
        {items.map((item) => (
          <ManifestItem key={item._id} item={item} />
        ))}
      </ul>
    </div>
  );
}

// ─── Progress bar helpers ─────────────────────────────────────────────────────

function computeSummary(items: ChecklistItem[]) {
  let verified = 0;
  let flagged  = 0;
  let missing  = 0;
  let unchecked = 0;

  for (const item of items) {
    if (item.status === "ok")        verified++;
    else if (item.status === "damaged") flagged++;
    else if (item.status === "missing") missing++;
    else                                unchecked++;
  }

  const total    = items.length;
  const reviewed = verified + flagged + missing;
  const pct      = total > 0 ? Math.round((reviewed / total) * 100) : 0;
  const hasIssues = flagged > 0 || missing > 0;

  return { verified, flagged, missing, unchecked, total, pct, hasIssues };
}

// ─── Component props ──────────────────────────────────────────────────────────

export interface ManifestPanelProps {
  /**
   * Convex document ID of the case whose manifest items will be fetched.
   * Pass `null` to skip the subscription (nothing rendered in that state).
   */
  caseId: string | null;

  /**
   * Additional CSS class applied to the panel root element.
   * Useful for embedding the panel within a larger layout with custom sizing.
   */
  className?: string;

  /**
   * Whether to show the status filter toolbar.
   * Defaults to `true`. Set to `false` to always display all items.
   */
  showFilters?: boolean;

  /**
   * Whether to show the aggregate progress bar in the panel header.
   * Defaults to `true`. Set to `false` for compact embedding.
   */
  showProgress?: boolean;

  /**
   * `data-testid` applied to the panel root for E2E test targeting.
   * Defaults to `"manifest-panel"`.
   */
  testId?: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * ManifestPanel
 *
 * Container component that owns Convex data fetching for a case's manifest
 * items. Renders a filterable, status-aware list of packing list items with
 * real-time updates via Convex subscriptions.
 *
 * Status vocabulary visible to users:
 *   - "Verified"   → item confirmed present and undamaged (data: "ok")
 *   - "Flagged"    → item has documented issues (data: "damaged")
 *   - "Missing"    → item not found in case (data: "missing")
 *   - "Unchecked"  → item not yet reviewed (data: "unchecked")
 *
 * The component handles all lifecycle states internally:
 *   - Loading   → skeleton rows
 *   - Error     → error banner with retry
 *   - Empty     → contextual empty-state message
 *   - Populated → filterable item list with StatusPill per row
 *
 * @example
 * // Basic usage in a dashboard detail panel
 * <ManifestPanel caseId={selectedCaseId} />
 *
 * @example
 * // Compact embed without filter toolbar
 * <ManifestPanel caseId={caseId} showFilters={false} showProgress={false} />
 */
export function ManifestPanel({
  caseId,
  className,
  showFilters = true,
  showProgress = true,
  testId = "manifest-panel",
}: ManifestPanelProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKind>("all");
  const [errorRetryKey, setErrorRetryKey] = useState(0);

  // ── Map ↔ Manifest hover binding ────────────────────────────────────────────
  //
  // Reads and writes the shared hover state so hovering this panel highlights
  // the corresponding case marker on the map, and vice versa.
  //
  // null-safe: useMapManifestHover returns { hoveredCaseId: null, setHoveredCaseId: noop }
  // when called outside a <MapManifestHoverProvider>, so the panel renders
  // correctly in standalone / embedded contexts without a provider.
  const { hoveredCaseId, setHoveredCaseId } = useMapManifestHover();

  // This panel is "map-highlighted" when the hover originated from the map
  // (i.e., the user is hovering the corresponding case marker on the map).
  const isMapHighlighted = caseId !== null && hoveredCaseId === caseId;

  // Stable handlers — created once via useCallback so they don't break
  // React.memo optimisations on parent components.
  const handleMouseEnter = useCallback(() => {
    if (caseId) setHoveredCaseId(caseId);
  }, [caseId, setHoveredCaseId]);

  const handleMouseLeave = useCallback(() => {
    setHoveredCaseId(null);
  }, [setHoveredCaseId]);

  // ── Convex real-time subscription ──────────────────────────────────────────
  //
  // useChecklistByCase subscribes to api.checklists.getChecklistByCase.
  // Convex re-evaluates this query and pushes updates within ~100–300 ms
  // whenever a manifest item for the case changes status — satisfying the
  // ≤ 2-second real-time fidelity requirement.
  //
  // Return semantics:
  //   undefined      → loading (initial fetch or reconnect in progress)
  //   ChecklistItem[] → live item list (may be empty array)
  //
  // Note: useChecklistByCase accepts null and passes "skip" to useQuery,
  // suppressing the subscription when no case is selected.
  const items = useChecklistByCase(caseId);

  // Retry handler — increments key to force a re-mount of the subscription.
  const handleRetry = useCallback(() => {
    setErrorRetryKey((k) => k + 1);
  }, []);

  // ── Guard: no caseId provided ─────────────────────────────────────────────
  if (!caseId) return null;

  // ── Loading state ─────────────────────────────────────────────────────────
  // `useQuery` returns `undefined` while the initial fetch is in flight or
  // during a reconnect after network interruption.
  if (items === undefined) {
    return (
      <section
        className={[styles.panel, className].filter(Boolean).join(" ")}
        aria-label="Case manifest"
        data-testid={testId}
        data-map-hover={isMapHighlighted ? "highlighted" : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        key={errorRetryKey}
      >
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <h2 className={styles.title}>Packing List</h2>
          </div>
        </header>
        <ManifestSkeleton />
      </section>
    );
  }

  // ── Summary computation ───────────────────────────────────────────────────
  const summary = computeSummary(items);

  // ── Filtered items ────────────────────────────────────────────────────────
  const filteredItems: ChecklistItem[] =
    activeFilter === "all"
      ? items
      : items.filter((item) => item.status === activeFilter);

  // ── Filter counts ─────────────────────────────────────────────────────────
  const filterCounts: Record<FilterKind, number> = {
    all:       items.length,
    unchecked: summary.unchecked,
    ok:        summary.verified,
    damaged:   summary.flagged,
    missing:   summary.missing,
  };

  const panelClass = [styles.panel, className].filter(Boolean).join(" ");

  return (
    <section
      className={panelClass}
      aria-label="Case manifest"
      data-testid={testId}
      data-map-hover={isMapHighlighted ? "highlighted" : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      key={errorRetryKey}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h2 className={styles.title}>Packing List</h2>
          {items.length > 0 && (
            <span className={styles.totalBadge} aria-label={`${items.length} items total`}>
              {items.length}
            </span>
          )}
        </div>

        {/* Status summary — ItemStatusBadge primitives with icon + count */}
        {items.length > 0 && (
          <InspectionStatusBar
            verified={summary.verified}
            flagged={summary.flagged}
            missing={summary.missing}
            unchecked={summary.unchecked}
            size="sm"
            data-testid="manifest-summary-chips"
          />
        )}
      </header>

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      {showProgress && items.length > 0 && (
        <div className={styles.progressSection}>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuenow={summary.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Packing list review progress: ${summary.pct}%`}
          >
            <div
              className={[
                styles.progressFill,
                summary.hasIssues ? styles.progressFillAlert : "",
              ].filter(Boolean).join(" ")}
              style={{ width: `${summary.pct}%` }}
            />
          </div>
          <div className={styles.progressMeta}>
            <span>{summary.pct}% reviewed</span>
            <span>
              {[
                summary.verified > 0 && `${summary.verified} verified`,
                summary.flagged  > 0 && `${summary.flagged} flagged`,
                summary.missing  > 0 && `${summary.missing} missing`,
              ]
                .filter(Boolean)
                .join(" · ") || `${summary.unchecked} remaining`}
            </span>
          </div>
        </div>
      )}

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      {showFilters && items.length > 0 && (
        <div
          className={styles.filterBar}
          role="group"
          aria-label="Filter manifest items by status"
        >
          {FILTERS.map((f) => {
            const count = filterCounts[f.id];
            const isActive = activeFilter === f.id;

            return (
              <button
                key={f.id}
                type="button"
                className={[
                  styles.filterBtn,
                  isActive ? styles.filterBtnActive : "",
                ].filter(Boolean).join(" ")}
                onClick={() => setActiveFilter(f.id)}
                aria-pressed={isActive}
                aria-label={`Show ${f.label.toLowerCase()} items (${count})`}
              >
                {f.label}
                {count > 0 && (
                  <span className={styles.filterCount} aria-hidden="true">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Item list / empty state ──────────────────────────────────────── */}
      {items.length === 0 ? (
        <EmptyState filtered={false} />
      ) : activeFilter === "all" ? (
        /* ── Grouped view (issues-first order) ─────────────────────────────
           When showing all items, group them by status with visual section
           headers so operators see missing → flagged → unchecked → verified.
           ManifestGroup omits empty groups automatically.
        ─────────────────────────────────────────────────────────────────── */
        <div
          className={styles.itemGroups}
          aria-label="All manifest items"
        >
          {STATUS_GROUPS.map((group) => (
            <ManifestGroup
              key={group.status}
              config={group}
              items={items.filter((item) => item.status === group.status)}
            />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState filtered={true} />
      ) : (
        <ul
          className={styles.itemList}
          aria-label={`${FILTERS.find((f) => f.id === activeFilter)?.label ?? activeFilter} manifest items`}
        >
          {filteredItems.map((item) => (
            <ManifestItem key={item._id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── ManifestItem ─────────────────────────────────────────────────────────────

/**
 * Single manifest item row.
 *
 * Renders the item name, a StatusPill for its current inspection state, and
 * optional secondary info (notes, checker attribution, timestamp).
 *
 * Pure presentational component — receives `ChecklistItem` from the container.
 */
interface ManifestItemProps {
  item: ChecklistItem;
}

function ManifestItem({ item }: ManifestItemProps) {
  const pillKind    = ITEM_STATUS_TO_PILL[item.status as ManifestItemStatus]      ?? "pending";
  const statusLabel = ITEM_STATUS_LABEL[item.status as ManifestItemStatus]        ?? item.status;
  const iconStatus  = ITEM_STATUS_TO_ICON_STATUS[item.status as ManifestItemStatus] ?? "unchecked";

  // Format the timestamp if the item has been reviewed
  let checkedTimeLabel: string | null = null;
  if (item.checkedAt) {
    try {
      checkedTimeLabel = new Date(item.checkedAt).toLocaleString("en-US", {
        month:  "short",
        day:    "numeric",
        hour:   "2-digit",
        minute: "2-digit",
      });
    } catch {
      // ignore formatting errors — timestamp display is non-critical
    }
  }

  return (
    <li
      className={styles.item}
      data-testid="manifest-item"
      data-status={item.status}
      aria-label={`${item.name}: ${statusLabel}`}
    >
      {/* Primary row: status icon + name + status pill
          The icon is wrapped in aria-hidden="true" because the <li> element's
          aria-label already conveys the name and status to screen readers.
          The icon is purely a visual affordance for sighted users to quickly
          scan item status without reading the pill label. */}
      <div className={styles.itemRow}>
        <span className={styles.itemIconWrap} aria-hidden="true">
          <ItemStatusIcon status={iconStatus} size="sm" />
        </span>
        <span className={styles.itemName}>{item.name}</span>
        <div className={styles.itemMeta}>
          <StatusPill kind={pillKind} aria-label={statusLabel} />
        </div>
      </div>

      {/* Notes — shown when the technician entered free-text alongside the check */}
      {item.notes && (
        <p className={styles.itemNote}>{item.notes}</p>
      )}

      {/* Attribution row — shown when an item has been checked by someone */}
      {item.checkedByName && (
        <p className={styles.itemTimestamp}>
          {statusLabel} by {item.checkedByName}
          {checkedTimeLabel && ` · ${checkedTimeLabel}`}
        </p>
      )}
    </li>
  );
}

export default ManifestPanel;
