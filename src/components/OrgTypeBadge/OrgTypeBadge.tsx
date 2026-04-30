/**
 * OrgTypeBadge — Visual differentiation chip for internal staff vs contractor orgs.
 *
 * Renders a pill badge with:
 *   • A distinct icon to differentiate org categories at a glance
 *   • Distinct color palettes:
 *       "internal"   → sky-blue (brand) — SkySpecs staff teams
 *       "contractor" → amber (caution)   — external contractor organizations
 *
 * The badge is designed to be immediately recognizable via both color AND icon
 * so it remains accessible for users with color-vision deficiencies (WCAG 1.4.1).
 *
 * Used in:
 *   - OrgGroupList table rows (Type column)
 *   - OrgGroupFormModal locked-type display (edit mode)
 *   - Any shared UI that exposes org type context (custody pickers, member panels)
 *
 * Props:
 *   orgType   — "internal" | "contractor"  (required)
 *   size      — "sm" | "md" | "lg"         (default: "md")
 *   showIcon  — whether to render the icon (default: true)
 *   className — optional extra class(es) from the caller
 *
 * Design system compliance:
 *   - All colors via CSS custom properties — no hex literals
 *   - Inter Tight typography
 *   - WCAG AA contrast in light and dark themes
 *   - Reduced-motion safe
 */

import styles from "./OrgTypeBadge.module.css";

// ─── Icon: Internal (SkySpecs building / office) ─────────────────────────────

/**
 * BuildingOffice2Icon — compact building silhouette representing SkySpecs
 * internal staff teams.
 */
function InternalIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {/* Simplified building: base rect + two window squares + door */}
      <path
        fillRule="evenodd"
        d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5H3.5A1.5 1.5 0 0 1 2 12.5v-9ZM5 4.75a.75.75 0 0 0 0 1.5h1a.75.75 0 0 0 0-1.5H5Zm4.25 0a.75.75 0 0 0 0 1.5h1a.75.75 0 0 0 0-1.5h-1ZM5 7.75a.75.75 0 0 0 0 1.5h1a.75.75 0 0 0 0-1.5H5Zm4.25 0a.75.75 0 0 0 0 1.5h1a.75.75 0 0 0 0-1.5h-1ZM7 11v2H5.5a.5.5 0 0 1-.5-.5V11h2Zm1.5 0v2H9v-2H8.5Zm1 0v1.5a.5.5 0 0 1-.5.5H10v-2h-.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ─── Icon: Contractor (hard hat / field worker) ───────────────────────────────

/**
 * HardHatIcon — safety helmet representing external contractor field workers.
 */
function ContractorIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {/* Hard-hat shape: dome + brim + cross stripe */}
      <path
        fillRule="evenodd"
        d="M8 1.5C5.5 1.5 3.5 3.38 3.5 5.75V7H2.5a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5H12.5V5.75C12.5 3.38 10.5 1.5 8 1.5ZM7.25 3.5v3.25H5.5V5.75a2.5 2.5 0 0 1 1.75-2.375V3.5Zm1.5 3.25V3.5a2.5 2.5 0 0 1 1.75 2.25v1.5H8.75ZM2 11a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface OrgTypeBadgeProps {
  /** Organization type to differentiate visually. */
  orgType: "internal" | "contractor";
  /**
   * Badge size.
   *   "sm"  — compact; used in dense detail panels
   *   "md"  — default; used in tables and lists
   *   "lg"  — prominent; used in modal headers
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /**
   * Whether to render the leading icon.
   * Set to false when space is critically constrained.
   * @default true
   */
  showIcon?: boolean;
  /** Additional class name(s) applied to the badge element. */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * OrgTypeBadge — pill chip that visually distinguishes internal SkySpecs staff
 * organizations from external contractor organizations.
 *
 * Uses both color (blue vs amber) and iconography (building vs hard-hat) to
 * satisfy WCAG 1.4.1 (Use of Color: information is not conveyed by color alone).
 *
 * @example
 * // Default (md, with icon)
 * <OrgTypeBadge orgType="internal" />
 * <OrgTypeBadge orgType="contractor" />
 *
 * // Compact table cell (no icon)
 * <OrgTypeBadge orgType="contractor" size="sm" showIcon={false} />
 *
 * // Prominent modal display
 * <OrgTypeBadge orgType="internal" size="lg" />
 */
export function OrgTypeBadge({
  orgType,
  size = "md",
  showIcon = true,
  className,
}: OrgTypeBadgeProps) {
  const sizeClass =
    size === "sm" ? styles.sizeSm
    : size === "lg" ? styles.sizeLg
    : styles.sizeMd;

  const typeClass =
    orgType === "internal" ? styles.internal : styles.contractor;

  const label = orgType === "internal" ? "Internal" : "Contractor";

  return (
    <span
      className={[styles.badge, typeClass, sizeClass, className]
        .filter(Boolean)
        .join(" ")}
      data-org-type={orgType}
      aria-label={`Organization type: ${label}`}
    >
      {showIcon && (
        orgType === "internal" ? (
          <InternalIcon className={styles.icon} />
        ) : (
          <ContractorIcon className={styles.icon} />
        )
      )}
      {label}
    </span>
  );
}
