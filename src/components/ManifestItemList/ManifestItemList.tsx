/**
 * ManifestItemList — Pure presentational item list sub-component.
 *
 * Renders a list of manifest (packing list) item rows, each showing:
 *   1. Status indicator icon  — color-coded icon for quick visual scanning
 *   2. Item name              — the equipment item name
 *   3. Quantity badge         — numeric quantity when provided (IBM Plex Mono)
 *   4. Status pill/label      — explicit "Verified / Flagged / Missing / Unchecked"
 *
 * Design contract
 * ───────────────
 * This is a pure presentational component — it receives items via `items` prop
 * and has no knowledge of Convex, hooks, or authentication.  All state comes
 * from the caller.  This makes it suitable for:
 *   • Dashboard ManifestPanel (fed from Convex real-time subscription)
 *   • SCAN app checklist view (fed from useChecklistWithInspection)
 *   • Print preview / PDF export (fed from pre-fetched data)
 *   • Storybook / visual regression testing (fed from fixture data)
 *
 * Status vocabulary
 * ─────────────────
 * The four item inspection states and their visual mapping:
 *   "verified"   → success (green checkmark)   — item confirmed present & undamaged
 *   "flagged"    → warning (amber flag)         — item present with documented damage
 *   "missing"    → error   (red x-circle)       — item not found during inspection
 *   "unchecked"  → neutral (gray hollow circle) — item not yet reviewed
 *
 * These align with the data-model states stored as:
 *   "ok" → "verified",  "damaged" → "flagged"
 * The mapping to display terms is the caller's responsibility.
 *
 * Quantity display
 * ────────────────
 * When `quantity` is provided on an item (≥ 1), a monospaced quantity badge
 * is shown between the name and the status pill:  "× 3"
 * When absent or undefined, the quantity slot is omitted entirely.
 *
 * Typography & tokens
 * ───────────────────
 * - Inter Tight for item names and labels
 * - IBM Plex Mono for quantity values
 * - All colors via CSS custom properties — no hex literals
 *
 * Accessibility
 * ─────────────
 * - Each <li> has an aria-label combining name + status display label
 * - The status icon is aria-hidden (the <li> aria-label covers it)
 * - The quantity, when present, is announced as "quantity N"
 * - WCAG AA contrast in light and dark themes via design-system signal tokens
 *
 * Props:
 *   items      — Array of ManifestItemListItem data objects (required)
 *   className  — Optional outer CSS class for the <ul> container
 *   testId     — data-testid for the <ul> container (default: "manifest-item-list")
 *   emptyText  — Fallback message when items array is empty
 *
 * Sub-exports:
 *   ManifestItemRow     — Individual row component (for use in custom list renderers)
 *   ManifestItemListItem — Type for the item data objects
 *   ManifestItemStatus   — Union type for the four inspection states
 */

import { ItemStatusIcon } from "@/components/ItemStatusBadge";
import type { ItemInspectionStatus } from "@/components/ItemStatusBadge";
import styles from "./ManifestItemList.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The four item inspection states accepted by this component.
 * Aligned with ItemInspectionStatus from ItemStatusBadge.
 */
export type ManifestItemStatus = ItemInspectionStatus;

/**
 * Data shape for a single item row in the list.
 *
 * The caller is responsible for mapping Convex data-model states to display
 * states before passing items here:
 *   ok → verified,  damaged → flagged
 */
export interface ManifestItemListItem {
  /**
   * Stable unique identifier for the row (used as React key + data-testid).
   * Typically the Convex document _id or templateItemId.
   */
  id: string;

  /** Human-readable equipment item name, e.g. "Drone Body", "Battery Pack" */
  name: string;

  /**
   * Optional item quantity.
   * When provided (≥ 1), rendered as "× N" in IBM Plex Mono beside the name.
   * When absent or 0, the quantity slot is omitted.
   */
  quantity?: number;

  /**
   * Inspection state driving the icon color and status pill/label.
   * Maps to display terminology:
   *   "verified"   — confirmed present & undamaged (data: "ok")
   *   "flagged"    — present with damage documented (data: "damaged")
   *   "missing"    — not found during inspection
   *   "unchecked"  — not yet reviewed
   */
  status: ManifestItemStatus;

  /**
   * Optional free-text note recorded by the inspector (e.g. "scuff on corner").
   * Rendered as a secondary line below the primary row.
   */
  notes?: string;

  /**
   * Name of the person who last checked this item.
   * When provided, renders an attribution line: "Verified by Alice"
   */
  checkedByName?: string;
}

// ─── Status display labels ────────────────────────────────────────────────────

/** Display label for each inspection status, used in StatusIndicator and aria-labels. */
const STATUS_LABELS: Record<ManifestItemStatus, string> = {
  verified:  "Verified",
  flagged:   "Flagged",
  missing:   "Missing",
  unchecked: "Unchecked",
};

// ─── ManifestItemRow ──────────────────────────────────────────────────────────

export interface ManifestItemRowProps {
  /** Item data to render. */
  item: ManifestItemListItem;
  /**
   * `data-testid` applied to the <li> element.
   * Defaults to `"manifest-item-row"`.
   */
  testId?: string;
}

/**
 * Single manifest item row.
 *
 * Renders:
 *   [StatusIcon]  [Item Name]  [× Qty]  [StatusLabel]
 *
 * Optionally also renders:
 *   - a notes line below the primary row
 *   - a checker attribution line ("Verified by Alice")
 *
 * The row is a pure presentational component — no Convex, no hooks.
 *
 * @example
 * <ManifestItemRow
 *   item={{ id: "i1", name: "Drone Body", status: "verified", quantity: 1 }}
 * />
 */
export function ManifestItemRow({ item, testId = "manifest-item-row" }: ManifestItemRowProps) {
  const statusLabel = STATUS_LABELS[item.status];
  const showQuantity = typeof item.quantity === "number" && item.quantity > 0;

  return (
    <li
      className={styles.item}
      data-testid={testId}
      data-status={item.status}
      aria-label={`${item.name}${showQuantity ? `, quantity ${item.quantity}` : ""}: ${statusLabel}`}
    >
      {/* Primary row: icon + name + quantity + status label ──────────────── */}
      <div className={styles.itemRow}>
        {/* Status icon — decorative for sighted users; covered by <li> aria-label
            for screen readers, so this wrapper is aria-hidden. */}
        <span className={styles.iconWrap} aria-hidden="true">
          <ItemStatusIcon status={item.status} size="sm" />
        </span>

        {/* Item name */}
        <span className={styles.itemName}>{item.name}</span>

        {/* Quantity badge — only shown when quantity is a positive integer */}
        {showQuantity && (
          <span
            className={styles.quantityBadge}
            aria-hidden="true"  /* quantity is already in the <li> aria-label */
          >
            ×&thinsp;{item.quantity}
          </span>
        )}

        {/* Status indicator label */}
        <StatusIndicator status={item.status} label={statusLabel} />
      </div>

      {/* Notes line — secondary info when inspector left a comment */}
      {item.notes && (
        <p className={styles.itemNote}>{item.notes}</p>
      )}

      {/* Attribution line — who checked this item */}
      {item.checkedByName && (
        <p className={styles.itemAttribution}>
          {statusLabel} by {item.checkedByName}
        </p>
      )}
    </li>
  );
}

// ─── StatusIndicator ──────────────────────────────────────────────────────────

/**
 * Inline status label with color-coded background.
 *
 * Unlike StatusPill (which covers all system status kinds), StatusIndicator is
 * specific to the four manifest item inspection states and directly uses the
 * design-system signal tokens via CSS data-status.
 *
 * Rendering this inline keeps the ManifestItemList self-contained without
 * requiring a Convex-aware StatusPill kind mapping at the call site.
 */
interface StatusIndicatorProps {
  status: ManifestItemStatus;
  label: string;
}

function StatusIndicator({ status, label }: StatusIndicatorProps) {
  return (
    <span
      className={styles.statusIndicator}
      data-status={status}
      aria-hidden="true" /* covered by the parent <li> aria-label */
    >
      {label}
    </span>
  );
}

// ─── ManifestItemList ─────────────────────────────────────────────────────────

export interface ManifestItemListProps {
  /**
   * Array of item data objects to render.
   * When empty, renders the `emptyText` message (or nothing if not provided).
   */
  items: ManifestItemListItem[];

  /**
   * Additional CSS class applied to the <ul> container.
   * Useful for embedding in parent layouts with custom sizing.
   */
  className?: string;

  /**
   * `data-testid` applied to the <ul> container.
   * Defaults to `"manifest-item-list"`.
   */
  testId?: string;

  /**
   * Fallback text displayed when items is empty.
   * When omitted, an empty items array renders nothing (null).
   */
  emptyText?: string;

  /**
   * ARIA label for the <ul> element (e.g. "Manifest items for Case 007").
   * Defaults to "Manifest items".
   */
  "aria-label"?: string;
}

/**
 * ManifestItemList
 *
 * Pure presentational component that renders an ordered list of manifest item
 * rows, each showing the item name, optional quantity, and inspection status.
 *
 * State vocabulary visible to users:
 *   - "Verified"  → item confirmed present and undamaged  (data: "ok")
 *   - "Flagged"   → item has documented damage            (data: "damaged")
 *   - "Missing"   → item not found in case                (data: "missing")
 *   - "Unchecked" → item not yet reviewed                 (data: "unchecked")
 *
 * @example
 * // Basic usage — feed pre-mapped items from Convex
 * <ManifestItemList items={[
 *   { id: "i1", name: "Drone Body",   quantity: 1, status: "verified" },
 *   { id: "i2", name: "Battery Pack", quantity: 2, status: "flagged"  },
 *   { id: "i3", name: "Charger",                   status: "unchecked"},
 * ]} />
 *
 * @example
 * // Embedded with custom aria-label and empty state
 * <ManifestItemList
 *   items={filteredItems}
 *   aria-label="Flagged items"
 *   emptyText="No flagged items"
 * />
 */
export function ManifestItemList({
  items,
  className,
  testId = "manifest-item-list",
  emptyText,
  "aria-label": ariaLabel = "Manifest items",
}: ManifestItemListProps) {
  // ── Empty state ──────────────────────────────────────────────────────────
  if (items.length === 0) {
    if (!emptyText) return null;
    return (
      <div
        className={styles.emptyState}
        data-testid={`${testId}-empty`}
        role="status"
        aria-live="polite"
      >
        {emptyText}
      </div>
    );
  }

  // ── Item list ────────────────────────────────────────────────────────────
  const listClass = [styles.list, className].filter(Boolean).join(" ");

  return (
    <ul
      className={listClass}
      data-testid={testId}
      aria-label={ariaLabel}
    >
      {items.map((item) => (
        <ManifestItemRow key={item.id} item={item} />
      ))}
    </ul>
  );
}

export default ManifestItemList;
