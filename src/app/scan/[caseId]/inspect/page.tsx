/**
 * /scan/[caseId]/inspect — SCAN app checklist inspection page
 *
 * Sub-AC 36b-2: Wire checklist update mutation to write through Convex and
 * invalidate item checklist subscriptions for the relevant case.
 *
 * This page is reached when a field technician taps "Inspect" on the case
 * detail view (/scan/[caseId]), or navigates here directly after starting
 * an inspection via the Check In flow.
 *
 * Role gating
 * ───────────
 * Inspection requires the `technician` role (or `admin`).  Pilots do NOT
 * have the INSPECTION_START, INSPECTION_UPDATE_ITEM, or INSPECTION_COMPLETE
 * operations in the RBAC permission matrix (convex/rbac.ts).
 *
 * The ScanRoleGate client component reads the user's role from the Kinde
 * JWT access token and renders an "Access Restricted" view for pilots before
 * the ScanInspectClient is mounted — preventing any mutation attempt.  The
 * Convex mutations themselves also enforce RBAC server-side as defence-in-depth.
 *
 * What happens on each checklist item update
 * ──────────────────────────────────────────
 * The ScanInspectClient calls `api.scan.updateChecklistItem` via
 * `useUpdateChecklistItem()`.  That mutation writes to:
 *
 *   manifestItems.status         → drives checklist UI state, M3 hasDamage filter
 *   manifestItems.checkedAt      → "last checked" timestamp display
 *   manifestItems.checkedById    → technician attribution
 *   inspections.checkedItems     → M3 inspectionProgress = checked/total
 *   inspections.damagedItems     → M3 pin damage indicator + summary
 *   inspections.missingItems     → M3 pin missing indicator + summary
 *   inspections.totalItems       → M3 inspectionProgress denominator
 *
 * Subscription invalidation (automatic via Convex)
 * ─────────────────────────────────────────────────
 * Convex's reactive subscription engine re-evaluates every subscribed query
 * that reads a touched row and pushes the diff to all connected clients within
 * ~100–300 ms.  Writing to `manifestItems` causes all of these to re-evaluate:
 *
 *   api.checklists.getChecklistByCase          — full item list subscription
 *   api.checklists.getChecklistSummary         — progress % and isComplete flag
 *   api.checklists.getChecklistItemsByStatus   — status-filtered item lists
 *   api.checklists.getUncheckedItems           — remaining items list
 *   api.checklists.getChecklistWithInspection  — combined view (used by this page)
 *
 * Writing to `inspections` also causes:
 *   api.maps.getMapMode3Data → M3 Field Mode map pin progress bars to update
 *
 * No manual cache invalidation or refetch is needed — Convex handles it.
 * This satisfies the ≤ 2-second real-time fidelity requirement.
 *
 * The server component resolves async params (Next.js 15 App Router) and
 * passes the plain `caseId` string to the client component.
 */

import type { Metadata } from "next";
import { ScanInspectClient } from "./ScanInspectClient";
import { ScanRoleGate } from "@/components/ScanRoleGate";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Inspect — Checklist",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ caseId: string }>;
}

/**
 * Server component: resolves async params, renders the interactive
 * checklist inspection client wrapped in a role gate.
 *
 * The ScanRoleGate ensures only technicians (and admins) can reach
 * ScanInspectClient.  Pilots see an "Access Restricted" view with a
 * "Back to Case" navigation link instead.
 */
export default async function ScanInspectPage({ params }: PageProps) {
  const { caseId } = await params;
  return (
    <ScanRoleGate require="technician" caseId={caseId}>
      <ScanInspectClient caseId={caseId} />
    </ScanRoleGate>
  );
}
