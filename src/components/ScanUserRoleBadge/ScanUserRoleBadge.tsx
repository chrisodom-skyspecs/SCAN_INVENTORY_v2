/**
 * ScanUserRoleBadge — displays the current user's SkySpecs role as a pill.
 *
 * Used on the SCAN landing page and case detail header to surface the user's
 * role so they can understand which actions are available to them.
 *
 * Roles displayed:
 *   admin       → "Admin"       (blue/brand accent)
 *   technician  → "Technician"  (green/success accent)
 *   pilot       → "Pilot"       (amber/warning accent)
 *   (loading)   → skeleton animation while roles are being resolved
 *   (no role)   → nothing rendered (user not registered or role not assigned)
 *
 * Design system compliance
 * ────────────────────────
 * All colors via CSS custom properties — no hex literals.
 * Inter Tight for all text.
 * WCAG AA contrast in both light and dark themes.
 */

"use client";

import { useCurrentUser } from "../../hooks/use-current-user";
import type { Role } from "../../../convex/rbac";
import styles from "./ScanUserRoleBadge.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ScanUserRoleBadgeProps {
  /** Optional: override the displayed role (for storybook / testing). */
  roleOverride?: Role;
  /** Optional: render with smaller font / padding for compact contexts. */
  size?: "sm" | "md";
}

// ─── Role display config ───────────────────────────────────────────────────────

const ROLE_CONFIG: Record<Role, { label: string; modifier: string }> = {
  admin:      { label: "Admin",      modifier: styles.badgeAdmin },
  technician: { label: "Technician", modifier: styles.badgeTechnician },
  pilot:      { label: "Pilot",      modifier: styles.badgePilot },
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ScanUserRoleBadge
 *
 * Client component that reads the current user's primary role from
 * `useCurrentUser()` and renders a colored role pill.
 *
 * Renders nothing when the user has no recognised role assigned.
 * Renders a loading skeleton while the Kinde session is resolving.
 */
export function ScanUserRoleBadge({
  roleOverride,
  size = "md",
}: ScanUserRoleBadgeProps) {
  const { primaryRole, isLoading } = useCurrentUser();
  const role = roleOverride ?? primaryRole;

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <span
        className={[
          styles.badge,
          styles.badgeSkeleton,
          size === "sm" ? styles.badgeSm : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-hidden="true"
      />
    );
  }

  // ── No role assigned ───────────────────────────────────────────────────────
  if (!role) return null;

  const config = ROLE_CONFIG[role];

  return (
    <span
      className={[
        styles.badge,
        config.modifier,
        size === "sm" ? styles.badgeSm : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Your role: ${config.label}`}
      data-testid="scan-user-role-badge"
      data-role={role}
    >
      {config.label}
    </span>
  );
}

export default ScanUserRoleBadge;
