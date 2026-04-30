/**
 * /scan — SCAN mobile app landing page (server component)
 *
 * The root of the SCAN mobile web app.  Authenticated users land here after:
 *   1. Visiting /scan directly (the Kinde middleware validates the session)
 *   2. The SCAN login flow (/api/auth/scan-login → Kinde → /scan)
 *
 * The page:
 *   • Reads the authenticated Kinde user via getKindeServerSession
 *   • Greets the user by name
 *   • Provides the primary CTA: scan a QR code to open a case
 *   • Shows a text input fallback for entering a case ID directly (client component)
 *
 * Authentication:
 *   The withAuth middleware (src/middleware.ts) guards /scan — this page is
 *   only reachable with a valid Kinde session.  If the session is somehow
 *   absent the middleware already redirected; a null-guard on the user is
 *   included for defensive rendering.
 *
 * Kinde SDK usage:
 *   getKindeServerSession is the App Router server-component API.
 *   It reads the session from the HTTP-only Kinde cookie set during the
 *   OAuth callback (GET /api/auth/kinde_callback → handleAuth()).
 *
 * Kinde dashboard settings required (Application → Authentication):
 *   Allowed callback URLs:
 *     http://localhost:3000/api/auth/kinde_callback          (development)
 *     https://inventory.skyspecsops.com/api/auth/kinde_callback   (production)
 *   Allowed logout redirect URLs:
 *     http://localhost:3000                          (development — INVENTORY)
 *     http://localhost:3000/scan                     (development — SCAN)
 *     https://inventory.skyspecsops.com              (production — INVENTORY)
 *     https://inventory.skyspecsops.com/scan         (production — SCAN)
 *   Allowed origins (CORS — required for SCAN mobile browser XHR):
 *     http://localhost:3000
 *     https://inventory.skyspecsops.com
 *
 * Required environment variables (see .env.local):
 *   KINDE_CLIENT_ID                     Kinde application client ID
 *   KINDE_CLIENT_SECRET                 Kinde application client secret
 *   KINDE_ISSUER_URL                    https://<subdomain>.kinde.com
 *   KINDE_SITE_URL                      Base URL of this deployment
 *   KINDE_POST_LOGOUT_REDIRECT_URL      Post-logout destination
 *   KINDE_POST_LOGIN_REDIRECT_URL       Default post-login destination (INVENTORY)
 *   KINDE_SCAN_POST_LOGIN_REDIRECT_URL  Post-login destination for SCAN flows
 *
 * @see src/middleware.ts                        — protects /scan
 * @see src/app/api/auth/[kindeAuth]/route.ts    — handles OAuth callbacks
 * @see src/app/api/auth/scan-login/route.ts     — SCAN-specific login entry point
 */

import type { Metadata } from "next";
import Link from "next/link";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { ScanLandingManualEntry } from "./ScanLandingManualEntry";
import { ScanLogoutButton } from "@/components/ScanLogoutButton";
import { ScanUserRoleBadge } from "@/components/ScanUserRoleBadge";
import { ScanAssociateQRLink } from "@/components/ScanAssociateQRLink";
import styles from "./scan-landing.module.css";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Scan a Case",
  description: "Open a SkySpecs equipment case by scanning its QR code.",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * SCAN landing page — server component.
 *
 * Reads the Kinde session and renders the QR scan entry point.
 */
export default async function ScanLandingPage() {
  const { getUser } = getKindeServerSession();
  const user = await getUser();

  const displayName =
    user?.given_name ??
    user?.family_name ??
    user?.email ??
    "Technician";

  return (
    <div className={styles.page}>
      {/* ── Greeting ─────────────────────────────────────────────────── */}
      <section className={styles.greeting} aria-label="Welcome">
        <p className={styles.greetingLabel}>Welcome back</p>
        <div className={styles.greetingNameRow}>
          <p className={styles.greetingName}>{displayName}</p>
          {/*
           * ScanUserRoleBadge is a client component that reads the user's
           * primary role (admin / technician / pilot) from the Kinde JWT
           * access token via useCurrentUser() and renders a colored badge.
           * This surfaces the user's role so they understand which SCAN
           * actions are available to them before navigating to a case.
           */}
          <ScanUserRoleBadge />
        </div>
      </section>

      {/* ── Primary action — QR scan ─────────────────────────────────── */}
      <section className={styles.primary} aria-label="Scan a case">
        <div className={styles.scanCard}>
          {/* QR icon */}
          <svg
            className={styles.scanIcon}
            viewBox="0 0 48 48"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            {/* Top-left finder square */}
            <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="2.5" fill="none" />
            <rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" />
            {/* Top-right finder square */}
            <rect x="28" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="2.5" fill="none" />
            <rect x="32" y="8" width="8" height="8" rx="1" fill="currentColor" />
            {/* Bottom-left finder square */}
            <rect x="4" y="28" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="2.5" fill="none" />
            <rect x="8" y="32" width="8" height="8" rx="1" fill="currentColor" />
            {/* Data modules (bottom-right quadrant) */}
            <rect x="28" y="28" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="36" y="28" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="44" y="28" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="28" y="36" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="44" y="36" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="28" y="44" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="36" y="44" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="44" y="44" width="4" height="4" rx="0.5" fill="currentColor" />
          </svg>

          <h1 className={styles.scanTitle}>Scan a Case QR Code</h1>
          <p className={styles.scanDescription}>
            Open the in-app scanner to decode a SkySpecs equipment case label
            and jump straight into the inspection and action flow.
          </p>

          {/*
           * Primary CTA: opens the in-app QR scanner at /scan/scanner.
           * The scanner activates the device camera and decodes QR codes
           * via the BarcodeDetector API (Chrome/Edge/Android).
           * Safari / Firefox fall back to manual text entry automatically.
           */}
          <Link href="/scan/scanner" className={styles.scanCta} aria-label="Open QR code scanner">
            {/* Camera icon */}
            <svg
              className={styles.scanCtaIcon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Open Camera Scanner
          </Link>

          {/* Deep-link note */}
          <p className={styles.scanHint}>
            Alternatively, use your device&apos;s native camera app to scan the QR
            code — the SCAN app opens automatically via the deep-link redirect.
          </p>
        </div>
      </section>

      {/* ── Manual entry fallback (client component) ─────────────────── */}
      <ScanLandingManualEntry />

      {/*
       * ── QR-first association entry point (Sub-AC 3) ─────────────────
       *
       * ScanAssociateQRLink is a role-gated client component.  It surfaces
       * a discoverable card that navigates to /scan/associate — the QR-first
       * (case-selection) variant of the association flow used when a
       * technician has a pre-printed physical QR label and needs to bind
       * it to a case record without first navigating to that case.
       *
       * Visibility:
       *   • admin / technician → rendered
       *   • pilot              → hidden (pilots have qrCode:read but not
       *                          qrCode:generate)
       *   • loading            → hidden (avoids flash for pilots)
       *
       * Server-side enforcement:
       *   • /scan/associate    → wraps client in ScanRoleGate
       *   • Convex mutation    → re-checks RBAC server-side
       */}
      <ScanAssociateQRLink />

      {/* ── Sign out ──────────────────────────────────────────────────── */}
      {/*
       * The ScanLogoutButton uses a Server Action (scanLogout) to redirect
       * through the Kinde logout endpoint to /scan/login.  This is safer
       * than a plain <a> link (CSRF protection, no open-redirect risk) and
       * shows a pending state while the session is being cleared.
       *
       * The persistent header also shows a logout button on all authenticated
       * SCAN pages — this footer copy provides an additional affordance on
       * the landing page for visibility.
       */}
      <footer className={styles.footer}>
        <ScanLogoutButton variant="link" label="Sign out of SkySpecs SCAN" />
      </footer>
    </div>
  );
}
