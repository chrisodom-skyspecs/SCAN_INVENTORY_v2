/**
 * /scan/associate — QR-first case association flow (server component wrapper)
 *
 * Sub-AC 3: Case selection/confirmation UI flow for associating a QR code with
 * an equipment case when the target case is NOT known at the start of the flow.
 *
 * This page is the entry point for the REVERSE association flow:
 *
 *   Case-first (/scan/[caseId]/associate):
 *     → Technician navigates to a specific case, then scans a QR code to link.
 *
 *   QR-first (/scan/associate) ← this page:
 *     → Technician scans a QR code label, then searches for and selects the
 *        target case, confirms the association, and sees success or error.
 *
 * Use case
 * ─────────
 * A technician receives a batch of printed QR code labels.  They scan each
 * label and select which equipment case to link it to.  No prior navigation
 * to a specific case detail page is required.
 *
 * Role gating
 * ───────────
 * QR code association requires the `technician` role (or `admin`).
 * Pilots have `qrCode:read` (scan to open a case) but NOT `qrCode:generate`
 * (associate a new QR code label).  The ScanRoleGate client component renders
 * an "Access Restricted" view for pilots.  The Convex `associateQRCodeToCase`
 * mutation also enforces this RBAC rule server-side.
 *
 * The server wrapper resolves async params (Next.js 15 App Router) and passes
 * them to the client component.  All interactive logic, Convex subscriptions,
 * and mutations live in CaseSelectionAssociateClient.
 */

import type { Metadata } from "next";
import { CaseSelectionAssociateClient } from "./CaseSelectionAssociateClient";
import { ScanRoleGate } from "@/components/ScanRoleGate";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Associate QR Code — Select Case",
  description:
    "Scan a QR code label and link it to an equipment case in the SkySpecs fleet.",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Server component: renders the interactive client wrapped in a role gate.
 *
 * Only technicians (and admins) can associate QR codes.  Pilots see an
 * "Access Restricted" view with a "Back to SCAN Home" navigation link.
 */
export default function AssociateQRSelectCasePage() {
  return (
    <ScanRoleGate require="technician">
      <CaseSelectionAssociateClient />
    </ScanRoleGate>
  );
}
