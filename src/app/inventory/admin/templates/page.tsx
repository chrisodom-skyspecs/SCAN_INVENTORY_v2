/**
 * /inventory/admin/templates — Kit template management page
 *
 * Admin UI for creating, editing, archiving, restoring, and duplicating kit
 * templates (packing list definitions).  Kit templates define the manifest
 * items that field technicians inspect via the SCAN mobile app.
 *
 * Architecture:
 *   This is a Server Component shell that renders TemplateListClient, which
 *   is a Client Component hosting the real-time Convex subscription.
 *
 *   All data fetching and mutations run on the client side via the Convex
 *   useQuery/useMutation hooks inside TemplateList.
 *
 * Auth:
 *   Protected by the /inventory layout.tsx server-side Kinde auth guard and
 *   the RequireAuth client-side component — no additional guard needed here.
 *
 * Layout:
 *   Renders as {children} inside the /inventory layout which provides the
 *   AppShell top bar + side nav.  TemplateList uses display:flex + height:100%
 *   to fill the available AppShell main content area.
 */

import type { Metadata } from "next";
import { TemplateList } from "@/components/TemplateList";

// ─── Metadata ──────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Kit Templates — Admin | SkySpecs INVENTORY",
  description:
    "Manage kit template packing list definitions. Create, edit, archive, and duplicate templates that define the manifest items for equipment case inspections.",
};

// ─── Page ──────────────────────────────────────────────────────────────────────

/**
 * TemplatesPage — Server Component shell for the kit template admin route.
 *
 * Delegates all rendering and data management to the TemplateList Client
 * Component, which subscribes to Convex in real-time.
 */
export default function TemplatesPage() {
  return <TemplateList />;
}
