/**
 * /inventory/cases — Case Fleet Registry page
 *
 * Renders the CaseStatusTable — a real-time, filterable table of all fleet
 * cases subscribed via two Convex queries:
 *
 *   1. useAllCases()         → api.cases.listCases({})
 *      Live list of all case documents, ordered by updatedAt descending.
 *      Convex pushes diff updates within ~100–300 ms of any SCAN app mutation.
 *
 *   2. useCaseStatusCounts() → api.cases.getCaseStatusCounts({})
 *      Aggregate counts per lifecycle status for the status filter bar.
 *      Re-evaluates on any cases table write — badges and table stay in sync.
 *
 * Both subscriptions satisfy the ≤ 2-second real-time fidelity requirement:
 * when a SCAN field technician changes a case status (check-in, inspection,
 * custody handoff), the dashboard table reflects the change within seconds —
 * no manual refresh required.
 *
 * Case selection:
 *   Clicking a table row navigates to /inventory?case=<id>&panel=1, which
 *   opens the map view with the case detail panel (T1–T5) rendered for the
 *   selected case.  This reuses the InventoryMapClient case detail system
 *   without duplicating it on this page.
 *
 * Architecture note:
 *   This page is a Server Component (no "use client" directive).  It renders
 *   CasesPageClient — a Client Component that owns:
 *     - useRouter for programmatic navigation on case row click
 *     - CaseStatusTable (already a Client Component with Convex hooks)
 *
 *   The page itself exports metadata and a minimal RSC shell.  All Convex
 *   subscriptions execute on the client side inside CaseStatusTable via the
 *   ConvexProvider established in the root layout.
 *
 * Layout context:
 *   This page renders as {children} inside the inventory layout.tsx, which
 *   provides:
 *     - Kinde server-side auth guard (redirect to login if unauthenticated)
 *     - RequireAuth client-side auth guard (session expiry protection)
 *     - AppShell / InventoryShell (top bar + side nav)
 *     - MapStateProvider (URL ↔ React state sync)
 *
 *   The full viewport height is available inside the AppShell main content
 *   area.  CaseStatusTable uses height: 100% + overflow: hidden internally
 *   so the table scroll area fills the available space correctly.
 */

import type { Metadata } from "next";
import { CasesPageClient } from "./CasesPageClient";

// ─── Metadata ──────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Cases — INVENTORY | SkySpecs",
  description:
    "Real-time fleet case registry. View, filter, and inspect all equipment cases across their lifecycle: hangar, assembled, deployed, flagged, transit, and archived.",
};

// ─── Page ──────────────────────────────────────────────────────────────────────

/**
 * CasesPage — Server Component shell for the /inventory/cases route.
 *
 * Renders CasesPageClient (a Client Component) so that CaseStatusTable's
 * Convex subscriptions run on the client side inside the existing ConvexProvider
 * context established by the root layout.
 *
 * No server-side data fetching is needed: all case data is delivered via Convex
 * real-time subscriptions on the client.
 */
export default function CasesPage() {
  return <CasesPageClient />;
}
