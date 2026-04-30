/**
 * ItemStatusBadge — Inspection item status indicator primitives.
 *
 * Provides icon + count badge components for the four manifest item inspection
 * states:
 *   - verified   (data: "ok")      — item confirmed present and undamaged
 *   - flagged    (data: "damaged") — item present but has documented issues
 *   - missing    (data: "missing") — item not found during inspection
 *   - unchecked  (data: "unchecked") — item not yet reviewed
 *
 * Components exported:
 *   - ItemStatusBadge     — Single-state badge with icon, count, and label
 *   - InspectionStatusBar — Row of status badges showing counts across all states
 *   - ItemStatusIcon      — Icon-only, no label or count (for inline use)
 *
 * Design rules:
 *   - Verified  → success signal tokens  (green  checkmark)
 *   - Flagged   → warning signal tokens  (amber  flag)
 *   - Missing   → error signal tokens    (red    x-circle)
 *   - Unchecked → neutral signal tokens  (gray   circle)
 *
 * All colors via CSS custom properties — no hex literals.
 * WCAG AA contrast compliant in light and dark themes.
 * Inter Tight for labels, IBM Plex Mono for count values.
 */

import styles from "./ItemStatusBadge.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/** The four manifest item inspection states visible to users. */
export type ItemInspectionStatus = "verified" | "flagged" | "missing" | "unchecked";

// ─── Icon paths ───────────────────────────────────────────────────────────────

/**
 * SVG path data for each status icon.
 * All icons use a 24×24 viewBox at strokeWidth=2.
 * No fill — stroke-only icons for clearest legibility at small sizes.
 */
const STATUS_ICONS: Record<ItemInspectionStatus, React.ReactNode> = {
  // Verified — checkmark inside a circle (success)
  verified: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={styles.icon}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  ),

  // Flagged — filled flag shape (warning / damage documented)
  flagged: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={styles.icon}
    >
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  ),

  // Missing — circle with an X (error / absent)
  missing: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={styles.icon}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),

  // Unchecked — hollow circle (neutral / pending)
  unchecked: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={styles.icon}
    >
      <circle cx="12" cy="12" r="10" />
    </svg>
  ),
};

/** Human-readable display labels for each status. */
const STATUS_LABELS: Record<ItemInspectionStatus, string> = {
  verified:  "Verified",
  flagged:   "Flagged",
  missing:   "Missing",
  unchecked: "Unchecked",
};

/** CSS module class names for each status variant. */
const STATUS_CLASS: Record<ItemInspectionStatus, string> = {
  verified:  styles.statusVerified,
  flagged:   styles.statusFlagged,
  missing:   styles.statusMissing,
  unchecked: styles.statusUnchecked,
};

/** Filled variant CSS module class names. */
const STATUS_FILLED_CLASS: Record<ItemInspectionStatus, string> = {
  verified:  styles.statusVerifiedFilled,
  flagged:   styles.statusFlaggedFilled,
  missing:   styles.statusMissingFilled,
  unchecked: styles.statusUncheckedFilled,
};

// ─── ItemStatusIcon ───────────────────────────────────────────────────────────

export interface ItemStatusIconProps {
  /** Which inspection state to render. */
  status: ItemInspectionStatus;
  /**
   * Size of the icon wrapper.
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /** Additional CSS class applied to the icon wrapper. */
  className?: string;
  /** ARIA label override. Defaults to the status display label. */
  "aria-label"?: string;
}

/**
 * Standalone status icon with semantic coloring — no label or count.
 * Use in tight spaces where a badge with text would be too wide.
 *
 * @example
 * // In an item list row beside the item name
 * <ItemStatusIcon status="verified" size="sm" />
 * <span>{item.name}</span>
 */
export function ItemStatusIcon({
  status,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: ItemStatusIconProps) {
  const sizeClass = size === "sm" ? styles.iconSm : size === "lg" ? styles.iconLg : styles.iconMd;
  const colorClass = STATUS_CLASS[status];

  return (
    <span
      className={[styles.iconWrap, colorClass, sizeClass, className]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label={ariaLabel ?? STATUS_LABELS[status]}
    >
      {STATUS_ICONS[status]}
    </span>
  );
}

// ─── ItemStatusBadge ──────────────────────────────────────────────────────────

export interface ItemStatusBadgeProps {
  /** Which inspection state this badge represents. */
  status: ItemInspectionStatus;

  /**
   * Number of items in this state.
   * When provided, displayed next to the label in IBM Plex Mono.
   * When 0 or undefined, only label/icon are shown.
   */
  count?: number;

  /**
   * Badge size.
   * - "sm"  — compact, 11px label, 12px icon
   * - "md"  — standard, 12px label, 14px icon (default)
   * - "lg"  — prominent, 13px label, 16px icon
   */
  size?: "sm" | "md" | "lg";

  /**
   * Whether to show the icon alongside the label.
   * @default true
   */
  showIcon?: boolean;

  /**
   * Whether to show the status label text.
   * Set false to render icon + count only.
   * @default true
   */
  showLabel?: boolean;

  /**
   * Filled (solid background) vs subtle (tinted background) variant.
   * @default false
   */
  filled?: boolean;

  /** Additional CSS class applied to the badge element. */
  className?: string;

  /**
   * ARIA label override.
   * Defaults to "{count} {label} items" when count is provided,
   * or "{label}" otherwise.
   */
  "aria-label"?: string;
}

/**
 * Status badge for a single manifest item inspection state.
 *
 * Renders an icon, label, and optional item count with distinct color coding
 * for each of the four inspection states (verified / flagged / missing /
 * unchecked). All colors come from design-system signal tokens.
 *
 * @example
 * // Show "5 Verified" badge with checkmark icon
 * <ItemStatusBadge status="verified" count={5} />
 *
 * @example
 * // Compact icon + count only for a header chip
 * <ItemStatusBadge status="missing" count={2} showLabel={false} size="sm" />
 *
 * @example
 * // Filled variant for high-emphasis alert states
 * <ItemStatusBadge status="missing" count={3} filled />
 */
export function ItemStatusBadge({
  status,
  count,
  size = "md",
  showIcon = true,
  showLabel = true,
  filled = false,
  className,
  "aria-label": ariaLabel,
}: ItemStatusBadgeProps) {
  const label = STATUS_LABELS[status];
  const hasCount = count !== undefined && count >= 0;

  const defaultAriaLabel = hasCount
    ? `${count} ${label.toLowerCase()}${count !== 1 ? " items" : " item"}`
    : label;

  const sizeClass =
    size === "sm" ? styles.badgeSm :
    size === "lg" ? styles.badgeLg :
    styles.badgeMd;

  const colorClass = filled
    ? STATUS_FILLED_CLASS[status]
    : STATUS_CLASS[status];

  const badgeClass = [
    styles.badge,
    sizeClass,
    colorClass,
    className,
  ].filter(Boolean).join(" ");

  return (
    <span
      className={badgeClass}
      role="status"
      aria-label={ariaLabel ?? defaultAriaLabel}
      data-status={status}
    >
      {showIcon && STATUS_ICONS[status]}

      {showLabel && (
        <span className={styles.badgeLabel}>{label}</span>
      )}

      {hasCount && (
        <span className={styles.badgeCount} aria-hidden="true">
          {count}
        </span>
      )}
    </span>
  );
}

// ─── ChecklistStatusCounts ────────────────────────────────────────────────────

/**
 * Minimal item shape required by ChecklistStatusCounts for count derivation.
 *
 * Duck-typed so any object with a `status` field matching the manifest item
 * status vocabulary is compatible — including `ChecklistItem` from the Convex
 * schema and any local mock/fixture types used in tests.
 */
export interface StatusCountItem {
  /** Inspection state of the item. */
  status: "unchecked" | "ok" | "damaged" | "missing";
}

export interface ChecklistStatusCountsProps {
  /**
   * Array of manifest items from which status counts are derived.
   *
   * The component iterates this list to compute the verified (ok), flagged
   * (damaged), missing, and unchecked counts — no pre-computation required
   * by the caller.  Any object with a `status` field is accepted.
   */
  items: StatusCountItem[];

  /**
   * Whether to include the unchecked count in the rendered summary.
   *
   * Default: `false` — the summary focuses on the three *reviewed* states
   * (verified / flagged / missing) which operators care about most.
   * Set to `true` in inspection-progress contexts where remaining work
   * needs to be visible alongside completed counts.
   */
  showUnchecked?: boolean;

  /**
   * Badge size passed to the underlying `InspectionStatusBar`.
   * @default "sm"
   */
  size?: "sm" | "md";

  /** Additional CSS class applied to the container. */
  className?: string;

  /**
   * ARIA label override for the summary container.
   * Defaults to `"Item status summary"` which is more specific than the
   * generic `InspectionStatusBar` label of `"Inspection status summary"`.
   */
  "aria-label"?: string;
}

/**
 * Status counts summary sub-component.
 *
 * Derives aggregate counts for **verified**, **flagged**, and **missing** items
 * directly from the provided item list, then renders them using the
 * `InspectionStatusBar` primitive so callers never need to pre-compute counts.
 *
 * This is the canonical pattern for displaying inspection status counts in
 * both the INVENTORY dashboard (ManifestPanel, T3/T4 panels) and the SCAN
 * mobile app (inspection progress section).
 *
 * Status vocabulary mapping:
 *   - `"Verified"` → items with `status === "ok"`   (confirmed present, undamaged)
 *   - `"Flagged"`  → items with `status === "damaged"` (documented damage)
 *   - `"Missing"`  → items with `status === "missing"` (absent from case)
 *
 * Rendering rules:
 *   - Badges for counts > 0 are always shown.
 *   - Zero-count badges are omitted unless `alwaysShow` is set on the
 *     underlying bar (not exposed here — use `InspectionStatusBar` directly
 *     for scorecard contexts).
 *   - The unchecked count is hidden by default; pass `showUnchecked` to include it.
 *   - Returns `null` when `items` is empty (nothing to display).
 *
 * @example
 * // Basic usage — derive counts from a live item subscription
 * <ChecklistStatusCounts items={items} />
 *
 * @example
 * // Inspection progress — also show how many items are still unchecked
 * <ChecklistStatusCounts items={items} showUnchecked />
 *
 * @example
 * // Compact embed with custom aria context
 * <ChecklistStatusCounts
 *   items={items}
 *   size="sm"
 *   aria-label="Packing list inspection summary"
 * />
 */
export function ChecklistStatusCounts({
  items,
  showUnchecked = false,
  size = "sm",
  className,
  "aria-label": ariaLabel = "Item status summary",
}: ChecklistStatusCountsProps) {
  // Nothing to summarise — return null so callers can conditionally render.
  if (items.length === 0) return null;

  // ── Derive aggregate counts from item list ────────────────────────────────
  // Single-pass O(n) loop — avoids multiple filter() calls over the same list.
  let verified  = 0;
  let flagged   = 0;
  let missing   = 0;
  let unchecked = 0;

  for (const item of items) {
    if      (item.status === "ok")      verified++;
    else if (item.status === "damaged") flagged++;
    else if (item.status === "missing") missing++;
    else                                unchecked++;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  // Delegate to InspectionStatusBar with the derived counts.
  // Pass unchecked only when showUnchecked is true — passing 0 causes the
  // badge to be omitted by InspectionStatusBar's default hide-zero logic.
  return (
    <InspectionStatusBar
      verified={verified}
      flagged={flagged}
      missing={missing}
      unchecked={showUnchecked ? unchecked : 0}
      size={size}
      className={className}
      aria-label={ariaLabel}
    />
  );
}

// ─── InspectionStatusBar ──────────────────────────────────────────────────────

export interface InspectionStatusBarProps {
  /**
   * Count of items with status "ok" (shown as "Verified").
   * Badge is omitted when 0.
   */
  verified?: number;

  /**
   * Count of items with status "damaged" (shown as "Flagged").
   * Badge is omitted when 0.
   */
  flagged?: number;

  /**
   * Count of items with status "missing".
   * Badge is omitted when 0.
   */
  missing?: number;

  /**
   * Count of items with status "unchecked".
   * Badge is omitted when 0.
   */
  unchecked?: number;

  /**
   * Whether to always show all status badges, even when count is 0.
   * Useful for "dashboard scorecard" contexts where all four slots
   * should always be visible for visual consistency.
   * @default false
   */
  alwaysShow?: boolean;

  /**
   * Badge size passed to each child ItemStatusBadge.
   * @default "sm"
   */
  size?: "sm" | "md";

  /** Additional CSS class applied to the bar container. */
  className?: string;

  /**
   * ARIA label override for the summary group element.
   * Defaults to `"Inspection status summary"`.
   */
  "aria-label"?: string;
}

/**
 * Horizontal row of status badges summarising inspection counts.
 *
 * Renders one `ItemStatusBadge` per non-zero status count.  Non-zero counts
 * are always shown; zero-count badges are hidden unless `alwaysShow` is true.
 *
 * Intended for panel headers, case summary rows, and mobile progress sections.
 *
 * @example
 * // Summary in a panel header (only non-zero counts shown)
 * <InspectionStatusBar verified={14} flagged={2} missing={1} />
 *
 * @example
 * // Dashboard scorecard — always show all 4 slots
 * <InspectionStatusBar
 *   verified={summary.verified}
 *   flagged={summary.flagged}
 *   missing={summary.missing}
 *   unchecked={summary.unchecked}
 *   alwaysShow
 * />
 */
export function InspectionStatusBar({
  verified  = 0,
  flagged   = 0,
  missing   = 0,
  unchecked = 0,
  alwaysShow = false,
  size = "sm",
  className,
  "aria-label": ariaLabel = "Inspection status summary",
}: InspectionStatusBarProps) {
  const barClass = [styles.bar, className].filter(Boolean).join(" ");

  const showVerified  = alwaysShow || verified  > 0;
  const showFlagged   = alwaysShow || flagged   > 0;
  const showMissing   = alwaysShow || missing   > 0;
  const showUnchecked = alwaysShow || unchecked > 0;

  // Nothing to render — all counts are zero and alwaysShow is false
  if (!showVerified && !showFlagged && !showMissing && !showUnchecked) {
    return null;
  }

  return (
    <div
      className={barClass}
      role="group"
      aria-label={ariaLabel}
      data-testid="inspection-status-bar"
    >
      {showVerified && (
        <ItemStatusBadge
          status="verified"
          count={verified}
          size={size}
          data-testid="status-badge-verified"
        />
      )}
      {showFlagged && (
        <ItemStatusBadge
          status="flagged"
          count={flagged}
          size={size}
          data-testid="status-badge-flagged"
        />
      )}
      {showMissing && (
        <ItemStatusBadge
          status="missing"
          count={missing}
          size={size}
          data-testid="status-badge-missing"
        />
      )}
      {showUnchecked && (
        <ItemStatusBadge
          status="unchecked"
          count={unchecked}
          size={size}
          data-testid="status-badge-unchecked"
        />
      )}
    </div>
  );
}
