/**
 * /scan/[caseId]/damage — SCAN app damage photo submission page
 *
 * Sub-AC 36b-3: Wire damage photo submission mutation to write through Convex
 * and invalidate damage report subscriptions for the relevant case.
 *
 * What the page does
 * ──────────────────
 * This page is the primary entry point for the SCAN app damage reporting
 * workflow:
 *
 *   1. Technician navigates here after marking an item "damaged" on the
 *      checklist (/scan/[caseId]/inspect), or directly from the case detail
 *      page (/scan/[caseId]) to report standalone case-level damage.
 *
 *   2. ScanDamageReportClient renders the two-phase photo submission form:
 *      Phase 1 — Capture: select or take a photo (HTML file input with capture)
 *      Phase 2 — Annotate & Submit: place pins, select severity, add notes,
 *                optionally link to a manifest item, then submit.
 *
 * Mutation write path (Sub-AC 36b-3)
 * ───────────────────────────────────
 * When the technician submits the form:
 *
 *   1. `useGenerateDamagePhotoUploadUrl()` → call `generateDamagePhotoUploadUrl`
 *      mutation → receive a one-time Convex storage upload URL.
 *
 *   2. `fetch(uploadUrl, { method: "POST", body: photoFile })` → Convex storage
 *      persists the photo binary and returns `{ storageId }`.
 *
 *   3. `useSubmitDamagePhoto()` → call `submitDamagePhoto` mutation with the
 *      storageId, annotations, severity, item link, and notes.
 *      The mutation writes to four tables in one transaction:
 *
 *      ┌────────────────────────────┬──────────────────────────────────────────┐
 *      │ Table / field written      │ Subscriptions invalidated                │
 *      ├────────────────────────────┼──────────────────────────────────────────┤
 *      │ damage_reports (new row)   │ getDamagePhotoReports → T4 photo gallery │
 *      │                            │ getDamageReportsByCase → T4 item list    │
 *      │ manifestItems.status       │ getChecklistByCase → SCAN checklist      │
 *      │ manifestItems.photoStorage │ getChecklistWithInspection               │
 *      │ events (damage_reported)   │ getDamageReportEvents → T5 audit trail   │
 *      │                            │ getDamageReportSummary → status pills    │
 *      │ cases.updatedAt            │ listCases by_updated → M1 sort order     │
 *      └────────────────────────────┴──────────────────────────────────────────┘
 *
 * Subscription invalidation (Convex reactive engine)
 * ────────────────────────────────────────────────────
 * Convex re-evaluates every subscribed query that reads a row touched by
 * `submitDamagePhoto` and pushes the diff to all connected clients within
 * ~100–300 ms — satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * The INVENTORY dashboard T4 panel subscribes to `getDamageReportsByCase` and
 * `getDamagePhotoReports`; the T5 panel subscribes to `getDamageReportEvents`.
 * Both update automatically — no polling, no manual refetch needed.
 *
 * Optional `templateItemId` search param
 * ────────────────────────────────────────
 * When the technician arrives from the inspect checklist after marking an item
 * "damaged", the inspect page passes `?templateItemId=<id>` so this page can
 * pre-select the manifest item in the item-link selector, streamlining the flow.
 *
 * The server component reads `searchParams` (Next.js App Router) and forwards
 * the value to the client component as a plain string prop.
 */

import type { Metadata } from "next";
import { ScanDamageReportClient } from "./ScanDamageReportClient";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Report Damage",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ caseId: string }>;
  /**
   * Optional `templateItemId` search param passed from the inspect checklist
   * when the technician taps "Report Damage" after marking an item "damaged".
   * Pre-selects the linked manifest item in the item selector.
   */
  searchParams: Promise<{ templateItemId?: string }>;
}

/**
 * Server component: resolves async params and search params (Next.js 15 App
 * Router), then renders the interactive damage photo submission client.
 */
export default async function ScanDamageReportPage({
  params,
  searchParams,
}: PageProps) {
  const { caseId } = await params;
  const { templateItemId } = await searchParams;

  return (
    <ScanDamageReportClient
      caseId={caseId}
      templateItemId={templateItemId ?? null}
    />
  );
}
