/**
 * /scan/[caseId] — SCAN app case detail page (server component wrapper)
 *
 * Sub-AC 3: Case detail view for the SCAN mobile app.
 *
 * This page is the primary landing view when a field technician or pilot
 * navigates to a specific case in the SCAN app.  It shows:
 *   • Case label + status pill
 *   • Key metadata (location, assignee, last updated)
 *   • QR code section — linked (shows payload) or unlinked (shows CTA)
 *   • Action cards for key SCAN operations (associate QR, ship case)
 *   • Notes (if any)
 *
 * After a successful `associateQRCodeToCase` mutation in the association
 * flow, Convex pushes the updated case document to this view's Convex
 * subscription within ~100–300 ms.  If this page is already open, the QR
 * code section updates in place.  If the user navigated here after the
 * ResultStep in AssociateQRClient, the QR is already visible in the
 * first rendered frame (Convex serves from the updated cache).
 *
 * The server component resolves the async params (Next.js 15 App Router)
 * and passes the plain `caseId` string to the client component.  All
 * interactive logic and real-time Convex subscriptions live in
 * ScanCaseDetailClient.
 */

import type { Metadata } from "next";
import { ScanCaseDetailClient } from "./ScanCaseDetailClient";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Case Detail",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ caseId: string }>;
}

/**
 * Server component: resolves async params, renders the interactive client.
 */
export default async function ScanCaseDetailPage({ params }: PageProps) {
  const { caseId } = await params;
  return <ScanCaseDetailClient caseId={caseId} />;
}
