/**
 * /inventory/cases/labels — batch printable case labels page
 *
 * Renders one printable case label per case ID supplied in the query string,
 * stacked vertically on screen and emitted as one printer-page per label
 * when the user invokes the browser print dialog.
 *
 * Why a dedicated route (alongside the per-case `[caseId]/label` route)?
 * ─────────────────────────────────────────────────────────────────────
 * Operations frequently need to print labels for an entire batch of cases
 * at once — for example, every case in an outgoing mission, or the full set
 * of cases freshly assembled in the hangar.  Sending the user one-by-one
 * to the per-case label route is impractical: dozens of tabs, dozens of
 * print dialogs, and no guarantee the labels print in a coherent order.
 *
 * This route accepts a list of case IDs in the URL and renders all of them
 * on a single page.  The shared CaseLabel print CSS already declares
 *
 *     break-after: page;
 *     page-break-after: always;
 *
 * on every `[data-case-label-root]`, with `:last-of-type` overriding to
 * `auto` so the printer does not emit a trailing blank page after the last
 * label.  As a result, stacking N CaseLabel components in this route yields
 * exactly N printer pages with one label per page — no extra work required.
 *
 * URL formats accepted (both supported simultaneously, deduplicated):
 *   1. Comma-separated:   /inventory/cases/labels?ids=id1,id2,id3
 *   2. Repeated key:      /inventory/cases/labels?id=id1&id=id2&id=id3
 *
 * Architecture
 * ────────────
 *   • This file is a Server Component.  It exports route metadata (title)
 *     and renders BatchLabelPageClient inside a Suspense boundary.
 *
 *   • BatchLabelPageClient (Client Component) reads the case ID list from
 *     `useSearchParams()` and renders one BatchLabelTile per ID.  Each tile
 *     owns its own Convex subscription (via `api.cases.getCaseById`) and its
 *     own client-side QR code generation (via `usePrintLabel`).
 *
 *   • The shared @media print CSS in CaseLabel.module.css handles the print
 *     isolation and per-label page breaks.  This page therefore does no
 *     bespoke print CSS — it just stacks the CaseLabel components in DOM
 *     order and lets the existing rules do their job.
 *
 * Auth / layout
 * ─────────────
 *   The /inventory layout already handles the three-layer Kinde auth guard
 *   (middleware → server-side session → RequireAuth).  This page therefore
 *   inherits all auth protection automatically.
 *
 *   The InventoryShell chrome (top bar + side nav) wraps this page on screen.
 *   When the user prints, the @media print rules in CaseLabel.module.css
 *   hide everything except the label roots, so the printout contains only
 *   the labels themselves — one per page.
 */

import type { Metadata } from "next";
import { Suspense } from "react";
import { BatchLabelPageClient } from "./BatchLabelPageClient";

// ─── Metadata ──────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Print Labels — INVENTORY | SkySpecs",
  description:
    "Print multiple case labels at once with QR codes, identifiers, and metadata. Each case is rendered on its own page for clean batch printing.",
  robots: {
    // Print labels are an internal operations tool — keep them out of search
    // engine indexes even if they ever leak past the auth guard.
    index: false,
    follow: false,
  },
};

// ─── Route segment config ──────────────────────────────────────────────────────

/**
 * Force dynamic rendering — the case IDs come from the query string and the
 * page subscribes to live Convex data, so static generation would be wrong.
 *
 * Using `useSearchParams()` inside the client component additionally requires
 * dynamic rendering at the route level when the page is server-rendered.
 */
export const dynamic = "force-dynamic";

// ─── Page ──────────────────────────────────────────────────────────────────────

/**
 * BatchLabelPage — Server Component shell for /inventory/cases/labels.
 *
 * Wraps BatchLabelPageClient in a Suspense boundary so that
 * `useSearchParams()` (which suspends on the server during streaming SSR)
 * does not de-opt the entire route to client-side rendering.
 *
 * No server-side data fetching is performed here: each per-case label
 * subscribes to Convex on the client, so the page benefits from the same
 * real-time updates as the rest of the dashboard.
 */
export default function BatchLabelPage() {
  return (
    <Suspense fallback={null}>
      <BatchLabelPageClient />
    </Suspense>
  );
}
