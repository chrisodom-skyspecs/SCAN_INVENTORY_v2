/**
 * /scan/[caseId]/ship — SCAN app shipment screen (server component wrapper)
 *
 * Extracts the `caseId` route param (async in Next.js 15 App Router) and
 * passes it to the client component that integrates the FedEx tracking
 * Convex query.
 *
 * Conditional rendering contract (Sub-AC 3c):
 *   hasTracking === false  →  TrackingEntryForm (enter FedEx tracking number)
 *   hasTracking === true   →  TrackingStatusSection (live + persisted status)
 *
 * The `hasTracking` flag is derived from the reactive `listShipmentsByCase`
 * Convex query inside the `useFedExTracking` hook.  Updates propagate to the
 * UI within ~100–300 ms of the SCAN app calling `createShipment`.
 */

import type { Metadata } from "next";
import { ScanShipmentClient } from "./ScanShipmentClient";

// ─── Metadata ───────────────────────────────���─────────────────────────────────

export const metadata: Metadata = {
  title: "Shipment",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  params: Promise<{ caseId: string }>;
}

/**
 * Server component: resolves the async params, then hands off to the
 * client component for real-time Convex data and interactive form handling.
 */
export default async function ScanShipmentPage({ params }: PageProps) {
  const { caseId } = await params;
  return <ScanShipmentClient caseId={caseId} />;
}
