/**
 * InventoryRoleGate — role-based access control for INVENTORY dashboard routes.
 *
 * Client-side guard that provides defense-in-depth RBAC enforcement for
 * dashboard routes that require elevated roles (operator or admin).
 *
 * This component complements the server-side admin layout guard
 * (`src/app/inventory/admin/layout.tsx`) which performs the primary
 * server-side role check.  InventoryRoleGate catches:
 *   • Client-side navigation that bypasses the server layout
 *   • Session changes (role downgrade) while the SPA is open
 *   • Direct component-level gating within a page (e.g., admin-only sections)
 *
 * Defense-in-depth layers for admin routes:
 *   1. Middleware (`src/middleware.ts`)          — edge-level auth check
 *   2. Main layout (`/inventory/layout.tsx`)     — server-side auth check
 *   3. Admin layout (`/inventory/admin/layout.tsx`) — server-side role check
 *   4. InventoryRoleGate (this component)        — client-side role check
 *   5. Convex mutation guards (`requireRole`)    — server-side DB check
 *
 * Behavior:
 *   • isLoading=true  → renders `loading` fallback (skeleton panel)
 *   • Access denied   → redirects to `fallbackUrl` (default: "/inventory")
 *   • Access granted  → renders `children`
 *
 * Role hierarchy for this gate:
 *   require="operator" → admin + operator may pass; technician + pilot are denied
 *   require="admin"    → admin only; all other roles are denied
 *
 * Design system compliance:
 *   • All colors via CSS custom properties — no hex literals
 *   • Inter Tight (--font-ui) for all text
 *   • WCAG AA contrast in both light and dark themes
 *   • Loading skeleton respects prefers-reduced-motion
 *
 * @see src/app/inventory/admin/layout.tsx — server-side role guard (primary)
 * @see src/components/ScanRoleGate        — equivalent guard for the SCAN app
 * @see convex/rbac.ts                     — role definitions and permission matrix
 */

"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/use-current-user";
import { ROLES, type Role } from "@/lib/rbac-client";
import styles from "./InventoryRoleGate.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface InventoryRoleGateProps {
  /**
   * The minimum role required to access this content.
   *
   * "operator" — permitted for admin + operator; denied for technician + pilot.
   * "admin"    — permitted for admin only; all other roles are denied.
   */
  require: Extract<Role, "operator" | "admin">;

  /**
   * The protected content. Rendered only when access is granted.
   */
  children: ReactNode;

  /**
   * URL to redirect unauthorized users to.
   *
   * Defaults to "/inventory" — the main dashboard.
   * Override for context-specific fallbacks, e.g.:
   *   fallbackUrl="/inventory/cases"  — cases list
   */
  fallbackUrl?: string;

  /**
   * Element to render while the Kinde session / roles are loading.
   * Defaults to a minimal loading skeleton styled with design tokens.
   */
  loading?: ReactNode;
}

// ─── Default loading fallback ─────────────────────────────────────────────────

/**
 * RoleLoadingFallback — design-token-compliant loading panel.
 *
 * Shown while the Kinde session is being resolved on the client.
 * Uses CSS custom properties for automatic light/dark theme adaptation.
 * Shimmer animation is disabled when prefers-reduced-motion is active.
 */
function RoleLoadingFallback() {
  return (
    <div
      className={styles.loadingShell}
      role="status"
      aria-live="polite"
      aria-label="Verifying access"
      data-testid="inv-role-gate-loading"
    >
      <div className={styles.skeletonLine} />
      <div className={styles.skeletonLine} style={{ width: "55%" }} />
      <div className={styles.skeletonLine} style={{ width: "70%" }} />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * InventoryRoleGate — renders `children` only when the current user holds the
 * required role.  Redirects unauthorized users to `fallbackUrl`.
 *
 * This is the client-side layer of the INVENTORY admin route guard stack.
 * Server-side enforcement is handled by `/inventory/admin/layout.tsx`.
 *
 * @example
 * // Guard an admin-only section within a page:
 * <InventoryRoleGate require="admin">
 *   <UserManagementPanel />
 * </InventoryRoleGate>
 *
 * @example
 * // Guard operator+ content with a custom fallback:
 * <InventoryRoleGate require="operator" fallbackUrl="/inventory/cases">
 *   <TemplateAdminSection />
 * </InventoryRoleGate>
 */
export function InventoryRoleGate({
  require: requiredRole,
  children,
  fallbackUrl = "/inventory",
  loading,
}: InventoryRoleGateProps): ReactNode {
  const { isLoading, isAuthenticated, roles } = useCurrentUser();
  const router = useRouter();

  // ── Access evaluation ───────────────────────────────────────────────────────
  //
  // Evaluate whether the user holds the required role.
  // Admins are a superset of operators: admin passes both "operator" and "admin" gates.
  // Operators pass "operator" but NOT "admin" gates.
  // Technicians and pilots are denied at both gate levels.
  const isAdmin    = roles.includes(ROLES.ADMIN);
  const isOperator = roles.includes(ROLES.OPERATOR);

  const hasAccess = requiredRole === "admin"
    ? isAdmin                           // admin only
    : /* "operator" */ isAdmin || isOperator; // admin or operator

  // ── Redirect on denial (after session resolves) ────────────────────────────
  useEffect(() => {
    // Only redirect once the session has fully resolved to avoid premature
    // redirects during hydration where roles may briefly appear empty.
    if (isLoading) return;

    // Deny access if: no valid session, or session resolved but lacks the role.
    if (!isAuthenticated || !hasAccess) {
      router.replace(fallbackUrl);
    }
  }, [isLoading, isAuthenticated, hasAccess, fallbackUrl, router]);

  // ── Loading state ──────────────────────────────────────────────────────────
  // Show fallback while session is being fetched to avoid FOUC.
  if (isLoading) {
    return <>{loading ?? <RoleLoadingFallback />}</>;
  }

  // ── Unauthorized — redirect in flight ─────────────────────────────────────
  // Render nothing while the router.replace() is executing to prevent
  // a flash of the protected content.
  if (!isAuthenticated || !hasAccess) {
    return null;
  }

  // ── Authorized ────────────────────────────────────────────────────────────
  return <>{children}</>;
}

export default InventoryRoleGate;
