/**
 * ScanRoleGate — role-based access control boundary for SCAN app screens.
 *
 * When a pilot navigates to a page that requires the `technician` role (e.g.
 * the checklist inspection screen, the QR association screen), this component
 * renders an accessible "access denied" view in place of the protected content.
 *
 * This is a client-side guard layered on top of the server-side middleware
 * which already restricts /scan/* routes to authenticated users.  The role
 * gate prevents pilots from performing technician-only mutations — the Convex
 * mutations themselves also enforce RBAC server-side via `assertPermission`.
 *
 * Usage
 * ─────
 *   <ScanRoleGate require="technician" caseId={caseId}>
 *     <ScanInspectClient caseId={caseId} />
 *   </ScanRoleGate>
 *
 * Props
 * ─────
 *   require   — the minimum role required to see the content.
 *               "technician" → allowed for admin + technician, denied for pilot.
 *               "admin"      → allowed for admin only.
 *   caseId    — optional; used to build the "Back to case" link in the denied view.
 *   children  — the protected UI to render when access is granted.
 *   loading   — optional element to show while the role is being resolved.
 *
 * Design system compliance
 * ────────────────────────
 * All colors via CSS custom properties — no hex literals.
 * Inter Tight for all text.
 * Touch target for the "Back to case" button: ≥ 44 × 44 px (WCAG 2.5.5).
 * WCAG AA contrast in both light and dark themes.
 */

"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCurrentUser } from "../../hooks/use-current-user";
import type { Role } from "../../../convex/rbac";
import styles from "./ScanRoleGate.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ScanRoleGateProps {
  /**
   * The minimum role required to access this content.
   *
   * "technician" — permitted for admin + technician; denied for pilot.
   * "admin"      — permitted for admin only.
   */
  require: Extract<Role, "technician" | "admin">;

  /** Convex case ID string — used to build the "Back to Case" link. */
  caseId?: string;

  /** The protected content. Rendered only when access is granted. */
  children: ReactNode;

  /**
   * Element to render while the Kinde session / roles are loading.
   * Defaults to a minimal loading skeleton that matches the SCAN page shell.
   */
  loading?: ReactNode;
}

// ─── Default loading state ─────────────────────────────────────────────────────

function DefaultLoading() {
  return (
    <div
      className={styles.loadingShell}
      role="status"
      aria-live="polite"
      aria-label="Verifying access"
    >
      <div className={styles.skeletonLine} />
      <div className={styles.skeletonLine} style={{ width: "60%" }} />
      <div className={styles.skeletonBtn} />
    </div>
  );
}

// ─── Access denied view ────────────────────────────────────────────────────────

interface AccessDeniedProps {
  requiredRole: Extract<Role, "technician" | "admin">;
  userRole: Role | null;
  caseId?: string;
}

function AccessDenied({ requiredRole, userRole, caseId }: AccessDeniedProps) {
  const roleLabel =
    requiredRole === "technician" ? "Technician or Admin" : "Admin";

  const userRoleLabel =
    userRole === "pilot"
      ? "Pilot"
      : userRole === "technician"
      ? "Technician"
      : userRole === "admin"
      ? "Admin"
      : "Unknown";

  return (
    <div
      className={styles.deniedView}
      role="alert"
      aria-live="assertive"
      data-testid="scan-role-gate-denied"
    >
      {/* Lock icon */}
      <div className={styles.iconWrap} aria-hidden="true">
        <svg
          className={styles.lockIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      <h2 className={styles.deniedTitle}>Access Restricted</h2>

      <p className={styles.deniedBody}>
        This action requires the{" "}
        <strong className={styles.roleHighlight}>{roleLabel}</strong> role.
      </p>

      {userRole && (
        <p className={styles.deniedMeta}>
          Your current role:{" "}
          <span className={styles.roleHighlight}>{userRoleLabel}</span>
        </p>
      )}

      <p className={styles.deniedHelp}>
        Contact your administrator if you need access to this feature.
      </p>

      {/* Navigation CTAs */}
      <div className={styles.deniedActions}>
        {caseId ? (
          <Link
            href={`/scan/${caseId}`}
            className={styles.backBtn}
            aria-label="Return to case detail"
            data-testid="scan-role-gate-back"
          >
            {/* Chevron left */}
            <svg
              className={styles.btnIcon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Case
          </Link>
        ) : (
          <Link
            href="/scan"
            className={styles.backBtn}
            aria-label="Return to SCAN home"
            data-testid="scan-role-gate-back"
          >
            <svg
              className={styles.btnIcon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to SCAN
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ScanRoleGate — renders `children` only when the current user holds the
 * required role.  Shows a styled "Access Restricted" view for denied users.
 */
export function ScanRoleGate({
  require: requiredRole,
  caseId,
  children,
  loading,
}: ScanRoleGateProps) {
  const { isLoading, primaryRole, isTechnician, isAdmin } = useCurrentUser();

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <>{loading ?? <DefaultLoading />}</>;
  }

  // ── Access check ──────────────────────────────────────────────────────────
  const hasAccess =
    requiredRole === "admin"
      ? isAdmin
      : /* "technician" */ isTechnician; // admin is a superset of technician

  if (!hasAccess) {
    return (
      <AccessDenied
        requiredRole={requiredRole}
        userRole={primaryRole}
        caseId={caseId}
      />
    );
  }

  // ── Granted ───────────────────────────────────────────────────────────────
  return <>{children}</>;
}

export default ScanRoleGate;
