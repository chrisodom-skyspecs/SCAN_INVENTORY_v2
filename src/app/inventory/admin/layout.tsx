/**
 * /inventory/admin layout — server-side role guard for admin routes.
 *
 * Protects the entire `/inventory/admin/*` subtree with a two-tier guard:
 *
 *   Tier 1 — Server-side role check (this file):
 *     Reads the user's Kinde roles via `getServerUserRoles()` before rendering
 *     any admin content.  Non-admin/non-operator users are redirected to
 *     `/inventory` (the main dashboard).
 *
 *   Tier 2 — Client-side InventoryRoleGate (also in this file):
 *     Wraps children with the `InventoryRoleGate` client component to handle
 *     client-side navigation that bypasses server rendering and session changes
 *     (e.g. role downgrade) while the SPA is open.
 *
 * This guard sits on top of the existing three-tier auth stack from the parent
 * `/inventory/layout.tsx`:
 *   1. Middleware (`src/middleware.ts`)        — edge auth (unauthenticated → login)
 *   2. Parent layout (`/inventory/layout.tsx`) — server auth (unauthenticated → login)
 *   3. Parent RequireAuth client component     — client auth (session expiry → login)
 *   4. Admin layout (this file)                — server role (wrong role → /inventory)
 *   5. InventoryRoleGate client component      — client role (role change → /inventory)
 *   6. Convex mutation guards (`requireRole`)  — DB-level role (mutation denied)
 *
 * Role requirements for admin routes:
 *   `/inventory/admin`           → operator + admin  (redirects to /templates)
 *   `/inventory/admin/templates` → operator + admin  (TEMPLATE_CREATE/UPDATE/READ)
 *   `/inventory/admin/orgs`      → operator + admin  (USER_LIST, org management)
 *   `/inventory/admin/users`     → admin only         (USER_MANAGE — see users/page.tsx)
 *
 * The layout enforces the minimum "operator" requirement for the admin section
 * as a whole.  The `/inventory/admin/users` page adds an additional admin-only
 * check via `InventoryRoleGate require="admin"` at the component level.
 *
 * Redirect destinations:
 *   • Unauthenticated users → /scan/login?post_login_redirect_url=/inventory/admin
 *     (handled by middleware + parent layout; this is defense-in-depth only)
 *   • Authenticated but insufficient role → /inventory
 *     (handled here and by InventoryRoleGate client component)
 *
 * @see src/app/inventory/layout.tsx              — parent auth guard
 * @see src/components/InventoryRoleGate          — client-side role guard
 * @see src/lib/kinde.ts#getServerUserRoles       — Kinde roles helper
 * @see convex/rbac.ts                            — role definitions
 */

import { type ReactNode } from "react";
import { redirect } from "next/navigation";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { getServerUserRoles } from "@/lib/kinde";
import { ROLES } from "../../../../convex/rbac";
import { InventoryRoleGate } from "@/components/InventoryRoleGate";

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Roles permitted to access the `/inventory/admin/*` subtree.
 *
 * operator — can create/update templates and missions; manages orgs
 * admin    — full access including user management and feature flag control
 *
 * technician and pilot are denied at this layer.
 */
const ADMIN_SECTION_ALLOWED_ROLES = [ROLES.ADMIN, ROLES.OPERATOR] as const;

// ─── Layout ────────────────────────────────────────────────────────────────────

/**
 * AdminLayout — server-side role guard + client-side InventoryRoleGate wrapper
 * for all `/inventory/admin/*` routes.
 *
 * Auth/role enforcement runs before any admin page content is rendered.
 * Unauthorized users are redirected before the page component executes.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  // ─── Layer 0: Auth defense-in-depth ─────────────────────────────────────────
  //
  // The parent /inventory/layout.tsx and the middleware already enforce
  // authentication.  This check is a safety net for edge cases where the parent
  // layout is bypassed (direct RSC requests, misconfigured environments).
  const { isAuthenticated } = getKindeServerSession();
  if (!(await isAuthenticated())) {
    redirect("/scan/login?post_login_redirect_url=/inventory/admin");
  }

  // ─── Layer 1: Server-side role check ────────────────────────────────────────
  //
  // Read the current user's roles from the Kinde access token.
  // Redirect to /inventory if the user holds neither admin nor operator.
  //
  // This is the primary role enforcement layer — it runs server-side before
  // any admin page content is rendered, preventing unauthorized users from
  // even seeing the admin shell.
  const roles = await getServerUserRoles();
  const hasAccess = roles.some((role) =>
    (ADMIN_SECTION_ALLOWED_ROLES as readonly string[]).includes(role)
  );

  if (!hasAccess) {
    // Redirect to the main INVENTORY dashboard.
    // Technicians and pilots are legitimate INVENTORY users — they can view
    // the map — but they are not authorized to manage admin resources.
    redirect("/inventory");
  }

  // ─── Layer 2: Client-side role gate (defense-in-depth) ──────────────────────
  //
  // Wrap children with the InventoryRoleGate client component.
  // This catches client-side navigation that bypasses the server layout
  // (e.g. Next.js client router pushing /inventory/admin without a full page load)
  // and role changes that happen while the SPA is open (e.g. admin revokes
  // operator role during an active session).
  return (
    <InventoryRoleGate require="operator">
      {children}
    </InventoryRoleGate>
  );
}
