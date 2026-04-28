/**
 * /scan/[caseId]/handoff — SCAN app custody handoff page (server component wrapper)
 *
 * Sub-AC 36b-5: Wire custody handoff mutation to write through Convex and
 * invalidate custody/assignment subscriptions for the relevant case.
 *
 * This page is reached when a field technician or pilot taps "Transfer Custody"
 * on the case detail view (/scan/[caseId]).
 *
 * What happens on handoff
 * ────────────────────────
 * The ScanHandoffClient calls `api.custody.handoffCustody` via
 * `useHandoffCustody()`.  That mutation writes to:
 *
 *   custodyRecords (new row)    → invalidates all custody subscriptions
 *   cases.assigneeId            → M2 assignment map re-evaluates
 *   cases.assigneeName          → M2 pin tooltips + T2 layout update
 *   cases.updatedAt             → M1 by_updated sort index
 *   cases.lat / .lng (optional) → all map modes withinBounds() check
 *   events "custody_handoff"    → T5 immutable audit timeline
 *   notifications               → in-app alert to incoming custodian
 *
 * Subscription invalidation (automatic via Convex)
 * ─────────────────────────────────────────────────
 * After `handoffCustody` writes, these queries immediately re-evaluate:
 *
 *   Custody subscriptions:
 *     • api.custody.getCustodyRecordsByCase     (T2/T5 custody history panels)
 *     • api.custody.getLatestCustodyRecord      (case sidebar current holder)
 *     • api.custody.getCustodyChain             (T5 audit chain view)
 *     • api.custody.getCustodyRecordsByCustodian(toUserId)  (SCAN "My Cases")
 *     • api.custody.getCustodyRecordsByTransferrer(fromUserId)
 *     • api.custody.getCustodianIdentitySummary (badge count)
 *     • api.custody.listAllCustodyTransfers     (fleet-wide overview)
 *
 *   Case/assignment subscriptions:
 *     • api.cases.getCaseStatus                (case detail panel header)
 *     • api.cases.getCaseById                  (T1–T5 panel full document)
 *     • api.cases.listCases                    (M1/M2/M3/M4/M5 map pin feeds)
 *     • api.cases.getCasesInBounds             (viewport-clipped map subscriptions)
 *     • api.cases.getCaseStatusCounts          (dashboard summary bar counts)
 *
 * The server component resolves async params (Next.js 15 App Router) and
 * passes the plain `caseId` string to the client component.
 */

import type { Metadata } from "next";
import { ScanHandoffClient } from "./ScanHandoffClient";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Transfer Custody",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ caseId: string }>;
}

/**
 * Server component: resolves async params, renders the interactive client.
 */
export default async function ScanHandoffPage({ params }: PageProps) {
  const { caseId } = await params;
  return <ScanHandoffClient caseId={caseId} />;
}
