/**
 * /scan/[caseId]/associate — QR code association screen (server component wrapper)
 *
 * Sub-AC 2: Dedicated association screen for binding a QR code to a case.
 *
 * Role gating
 * ───────────
 * QR code generation / association requires the `technician` role (or `admin`).
 * Pilots have the `qrCode:read` permission (they can scan QR codes to find cases)
 * but not `qrCode:generate` (they cannot associate a new QR code label to a case).
 *
 * The ScanRoleGate client component reads the user's role from the Kinde JWT
 * access token and renders an "Access Restricted" view for pilots.  The Convex
 * `associateQRCodeToCase` mutation also enforces this RBAC rule server-side.
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
import { ScanRoleGate } from "@/components/ScanRoleGate";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Associate QR Code",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ caseId: string }>;
}

/**
 * Server component: resolves async params, renders the interactive client
 * wrapped in a role gate.
 *
 * Only technicians (and admins) can associate QR codes.  Pilots see an
 * "Access Restricted" view with a "Back to Case" navigation link.
 */
export default async function AssociateQRPage({ params }: PageProps) {
  const { caseId } = await params;
  return (
    <ScanRoleGate require="technician" caseId={caseId}>
      <AssociateQRClient caseId={caseId} />
    </ScanRoleGate>
  );
}
