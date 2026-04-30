/**
 * /inventory/admin/orgs — Organization group management page
 *
 * Admin UI for viewing and managing organizational groups (both internal
 * SkySpecs teams and external contractor companies).
 *
 * Renders a paginated, searchable table with:
 *   • Organization name
 *   • Type (Internal / Contractor)
 *   • Active member count (real-time via Convex)
 *   • Active / Inactive status
 *
 * Architecture:
 *   Server Component shell → OrgGroupList Client Component.
 *   All data fetching is done on the client via Convex subscriptions;
 *   the server component provides only route metadata.
 *
 * Auth:
 *   Protected by the /inventory layout.tsx Kinde auth guard.
 *   OrgGroupList's "Show inactive" toggle is additionally controlled
 *   server-side by the listOrgsWithMemberCount Convex query (only
 *   admin/operator callers receive inactive orgs regardless of the arg).
 *
 * Layout:
 *   Renders as {children} inside the /inventory layout which provides
 *   the AppShell top bar + side nav.
 */

import type { Metadata } from "next";
import { OrgGroupList } from "@/components/OrgGroupList";

// ─── Metadata ──────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Org Groups — Admin | SkySpecs INVENTORY",
  description:
    "Manage organizational groups — internal SkySpecs teams and external contractor companies. View member counts and group types.",
};

// ─── Page ──────────────────────────────────────────────────────────────────────

/**
 * OrgsPage — Server Component shell for the org group admin route.
 *
 * Delegates all rendering to the OrgGroupList Client Component, which
 * subscribes to Convex real-time data and handles search/filter/pagination
 * entirely on the client.
 */
export default function OrgsPage() {
  return <OrgGroupList />;
}
