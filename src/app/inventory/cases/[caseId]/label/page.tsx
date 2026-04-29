/**
 * /inventory/cases/[caseId]/label — printable case label page
 *
 * Renders a single equipment case label (QR code + identifier + metadata) at
 * physical print dimensions, ready to send to a thermal label printer or any
 * standard office printer.
 *
 * Why a dedicated route (instead of opening the LabelPreviewModal)?
 *   The modal is great for in-context spot checks, but real label printing
 *   workflows need:
 *     • A direct, shareable URL the operations team can bookmark or send to
 *       a kiosk machine wired to a label printer.
 *     • Window-level @media print isolation that does not have to fight with
 *       the dashboard chrome (top bar / side nav).
 *     • A "minimal" host page (no map, no side nav, no global search) so the
 *       browser print preview shows only the label.
 *
 * Architecture
 * ────────────
 *   • This file is a Server Component.  It exports route metadata (title) and
 *     renders the LabelPageClient (a Client Component).
 *
 *   • LabelPageClient owns the Convex subscriptions:
 *       useQuery(api.cases.getCaseById, { caseId })            ← case document
 *       useQuery(api.caseTemplates.getCaseTemplateById, …)     ← template name
 *       useQuery(api.missions.getMissionById, …)               ← mission name
 *
 *   • The QR code is generated client-side via `usePrintLabel(caseId)` so it
 *     uses the live caseId from the URL and the Web Crypto API for a stable
 *     SHA-256 derived UID.  No round-trip to the server is required.
 *
 *   • The CaseLabel component is rendered with `data-case-label-root` on its
 *     wrapper.  Its `@media print` CSS hides the rest of the page and lays
 *     the label out at physical dimensions for the selected size.
 *
 * Auth / layout
 * ─────────────
 *   The /inventory layout already handles the three-layer Kinde auth guard
 *   (middleware → server-side session → RequireAuth).  This page therefore
 *   inherits all auth protection automatically.  The InventoryShell chrome
 *   (top bar + side nav) wraps this page on screen.  When the user prints,
 *   the @media print rules in CaseLabel.module.css hide everything except
 *   the label root.
 */

import type { Metadata } from "next";
import { LabelPageClient } from "./LabelPageClient";

// ─── Metadata ──────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Print Label — INVENTORY | SkySpecs",
  description:
    "Print a case label with QR code, identifier, and metadata for physical attachment to an equipment case.",
  robots: {
    // Print labels are an internal operations tool — keep them out of search
    // engine indexes even if they ever leak past the auth guard.
    index: false,
    follow: false,
  },
};

// ─── Route segment config ──────────────────────────────────────────────────────

/**
 * Force dynamic rendering — the case ID comes from a route segment and the
 * page subscribes to live Convex data, so static generation would be wrong.
 */
export const dynamic = "force-dynamic";

// ─── Page ──────────────────────────────────────────────────────────────────────

interface LabelPageProps {
  /**
   * Next.js 15 params are a Promise — must be awaited before use.
   * The single dynamic segment is `caseId` (the Convex document ID of the case).
   */
  params: Promise<{ caseId: string }>;
}

/**
 * LabelPage — Server Component shell for /inventory/cases/[caseId]/label.
 *
 * Awaits the route params, then hands the caseId off to LabelPageClient
 * (a Client Component) which owns the Convex subscriptions and rendering.
 *
 * No server-side data fetching is performed here: the case document and any
 * related metadata (template, mission) are loaded via reactive Convex queries
 * inside LabelPageClient so the page benefits from the same real-time updates
 * as the rest of the dashboard.
 */
export default async function LabelPage({ params }: LabelPageProps) {
  const { caseId } = await params;
  return <LabelPageClient caseId={caseId} />;
}
