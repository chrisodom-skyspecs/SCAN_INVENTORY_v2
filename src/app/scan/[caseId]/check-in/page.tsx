/**
 * /scan/[caseId]/check-in — SCAN app check-in page (server component wrapper)
 *
 * Sub-AC 36b-1: QR scan check-in — wire mutation to write through Convex and
 * invalidate case status/location subscriptions.
 *
 * This page is reached when a field technician or pilot:
 *   1. Scans a case QR code from the root SCAN scanner
 *   2. Taps "Check In" on the case detail view (/scan/[caseId])
 *
 * What happens on check-in
 * ────────────────────────
 * The ScanCheckInClient calls `api.scan.scanCheckIn` via `useScanCheckIn()`.
 * That mutation writes to:
 *
 *   cases.status      → M1/M2/M3 status filters; M5 heatmap weight
 *   cases.assigneeId  → M1/M3 assigneeId filter
 *   cases.lat / .lng  → all map modes withinBounds() check
 *   cases.updatedAt   → M1 by_updated sort index
 *
 * Convex's reactive subscription engine re-evaluates every subscribed query
 * that reads a touched row and pushes the diff to all connected clients within
 * ~100–300 ms — satisfying the ≤ 2-second real-time fidelity requirement
 * without any manual cache invalidation or polling.
 *
 * Subscription invalidation (automatic via Convex)
 * ─────────────────────────────────────────────────
 * After `scanCheckIn` writes to `cases`, these queries immediately re-evaluate:
 *   • api.cases.getCaseStatus    (case detail panel header)
 *   • api.cases.getCaseById      (T1–T5 panel full document)
 *   • api.cases.listCases        (M1/M2/M3/M4/M5 map pin feeds)
 *   • api.cases.getCasesInBounds (viewport-clipped map subscriptions)
 *   • api.cases.getCaseStatusCounts (dashboard summary bar counts)
 *
 * If the transition is to "in_field", the mutation also inserts into
 * `inspections`, which causes:
 *   • api.maps.getMapMode3Data (M3 inspection progress pins) to re-evaluate
 *
 * The server component resolves async params (Next.js 15 App Router) and
 * passes the plain `caseId` string to the client component.
 */

import type { Metadata } from "next";
import { ScanCheckInClient } from "./ScanCheckInClient";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Check In",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ caseId: string }>;
}

/**
 * Server component: resolves async params, renders the interactive client.
 */
export default async function ScanCheckInPage({ params }: PageProps) {
  const { caseId } = await params;
  return <ScanCheckInClient caseId={caseId} />;
}
