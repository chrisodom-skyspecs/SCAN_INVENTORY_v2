/**
 * /scan/[caseId]/associate — QR code association screen (server component wrapper)
 *
 * Sub-AC 2: Dedicated association screen for binding a QR code to a case.
 *
 * Flow handled by AssociateQRClient:
 *   Step 1 — QR Input  : camera scan (BarcodeDetector API) OR manual text entry
 *   Step 2 — Lookup    : case info + conflict check against existing QR mapping
 *   Step 3 — Confirm   : summary card before committing the association
 *   Step 4 — Result    : success confirmation or error recovery
 *
 * The server wrapper resolves the async params (Next.js 15 App Router) and
 * passes the plain `caseId` string to the client component.  All interactive
 * logic, Convex subscriptions, and mutations live in AssociateQRClient.
 */

import type { Metadata } from "next";
import { AssociateQRClient } from "./AssociateQRClient";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Associate QR Code",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ caseId: string }>;
}

/**
 * Server component: resolves async params, renders the interactive client.
 */
export default async function AssociateQRPage({ params }: PageProps) {
  const { caseId } = await params;
  return <AssociateQRClient caseId={caseId} />;
}
