/**
 * /inventory/admin/users — User management page
 *
 * Admin UI for viewing and managing all registered SkySpecs users.
 * Displays a real-time table (via Convex subscription) with columns:
 *   Name, Email, Role, Status, Actions (edit role, deactivate/reactivate)
 *
 * Architecture:
 *   Server Component shell that renders UserListTable, a Client Component
 *   that hosts the Convex useQuery subscription.  All data fetching and
 *   mutations run client-side via Convex hooks.
 *
 * Auth:
 *   Protected by the /inventory layout.tsx server-side Kinde auth guard.
 *   Action buttons (edit role, deactivate) are additionally guarded:
 *     - Client-side: hidden for non-admin callers (useCurrentUser().isAdmin)
 *     - Server-side: requireAdmin() in convex/users.ts mutations
 *
 * Layout:
 *   Renders as {children} inside the /inventory layout which provides the
 *   AppShell top bar + side nav.  UserListTable uses display:flex + height:100%
 *   to fill the available AppShell main content area.
 */

import type { Metadata } from "next";
import { UserListTable } from "@/components/UserListTable";

// ─── Metadata ──────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Users — Admin | SkySpecs INVENTORY",
  description:
    "Manage SkySpecs platform users. View all registered users, update roles, and manage account statuses.",
};

// ─── Page ──────────────────────────────────────────────────────────────────────

/**
 * UsersPage — Server Component shell for the admin user management route.
 *
 * Delegates all rendering and data management to the UserListTable Client
 * Component, which subscribes to Convex in real-time.
 */
export default function UsersPage() {
  return <UserListTable />;
}
