/**
 * /scan/scanner — QR scanner page (server component)
 *
 * AC 240101 Sub-AC 1: The dedicated in-app QR scanner screen for the SCAN
 * mobile app.  Provides an inline camera viewfinder that activates the device
 * rear camera, decodes QR codes via the W3C BarcodeDetector API, and displays
 * the raw scanned value to the technician.
 *
 * Architecture
 * ────────────
 * This is a thin server component that:
 *   1. Provides page-level metadata (title, description).
 *   2. Renders the QrScannerClient, which is a "use client" component that
 *      owns all camera/BarcodeDetector state and user interaction.
 *
 * Authentication
 * ──────────────
 * This route is protected by the SCAN middleware (/scan/* guard).  Reaching
 * this page requires a valid Kinde session.  If the session has expired, the
 * middleware redirects to /scan/login before this page renders.
 *
 * Browser compatibility
 * ─────────────────────
 * The BarcodeDetector API is supported in:
 *   • Chrome 83+ (desktop + Android)
 *   • Edge 83+
 *   • Samsung Internet 13+
 *   • Android WebView 83+
 *
 * Safari (iOS/macOS) and Firefox do NOT support BarcodeDetector as of 2025.
 * The QrScannerClient handles unavailability gracefully by falling back to
 * manual text entry so the full SCAN workflow remains accessible.
 */

import type { Metadata } from "next";
import { QrScannerClient } from "./QrScannerClient";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Scan QR Code",
  description:
    "Activate the camera to scan a SkySpecs equipment case QR code and open the case action flow.",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * QR scanner page — renders the in-app camera scanner.
 *
 * No server-side data is fetched here; the QrScannerClient is fully
 * self-contained and manages its own device camera lifecycle.
 */
export default function ScannerPage() {
  return <QrScannerClient />;
}
