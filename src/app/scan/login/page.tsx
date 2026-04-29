/**
 * /scan/login — SCAN mobile app login page (public, no auth required)
 *
 * This is the branded login entry point for the SCAN mobile web app.
 * Field technicians and pilots who access SCAN directly (or arrive after
 * a logout) see this page before authenticating.
 *
 * Flows that lead here:
 *   1. withAuth middleware redirects an unauthenticated user to /scan/login
 *      (because loginPage: "/scan/login" is set in the middleware config).
 *      The current path is preserved as ?post_login_redirect_url=<original>.
 *   2. POST /api/auth/logout redirects here after sign-out when called
 *      with ?post_logout_redirect_url=/scan/login.
 *   3. A field technician bookmarks this URL on their phone.
 *
 * Auth check:
 *   If the user already has a valid session (e.g., navigated here manually
 *   while logged in), they are immediately redirected to /scan.
 *
 * Sign-in flow:
 *   Clicking "Sign in" links to /api/auth/login with post_login_redirect_url
 *   set to the value of ?post_login_redirect_url (from withAuth isReturnToCurrentPage)
 *   or /scan as a default.  This routes through Kinde's hosted login and
 *   returns the user to the originally requested page.
 *
 * Kinde settings required (same as root application config):
 *   Allowed callback URLs:
 *     http://localhost:3000/api/auth/kinde_callback
 *     https://inventory.skyspecsops.com/api/auth/kinde_callback
 *   Allowed logout redirect URLs:
 *     http://localhost:3000/scan/login
 *     https://inventory.skyspecsops.com/scan/login
 *
 * @see src/middleware.ts                        — routes /scan/* through this page
 * @see src/app/api/auth/[kindeAuth]/route.ts    — OAuth callback handler
 * @see src/app/api/auth/scan-login/route.ts     — SCAN-specific login entry point
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import styles from "./page.module.css";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export const metadata: Metadata = {
  title: "Sign In — SkySpecs SCAN",
  description:
    "Sign in to the SkySpecs SCAN field inspection and equipment tracking app.",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScanLoginPageProps {
  searchParams: Promise<{
    /** Set by withAuth (isReturnToCurrentPage: true) — original requested path. */
    post_login_redirect_url?: string;
    /** Legacy/alternative param used by the scan-landing logout link. */
    returnTo?: string;
  }>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * SCAN login page — server component.
 *
 * Reads auth state and renders the mobile-optimized sign-in card.
 * Authenticated users are immediately redirected to /scan.
 */
export default async function ScanLoginPage({ searchParams }: ScanLoginPageProps) {
  // ── Auth guard ────────────────────────────────────────────────────────────
  const { isAuthenticated } = getKindeServerSession();
  const authenticated = await isAuthenticated();

  if (authenticated) {
    // Already logged in — skip the login page and go to the SCAN landing.
    redirect("/scan");
  }

  // ── Resolve post-login destination ────────────────────────────────────────
  const params = await searchParams;
  const rawReturnTo =
    params.post_login_redirect_url ??
    params.returnTo ??
    "/scan";

  // Allow only root-relative paths to prevent open-redirect attacks.
  // - Must start with "/" (blocks absolute URLs like "https://evil.com")
  // - Must NOT start with "//" (blocks protocol-relative URLs like "//evil.com")
  const safeReturnTo =
    rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")
      ? rawReturnTo
      : "/scan";

  // Build the Kinde login URL with the resolved post-login redirect.
  // /api/auth/login is the Kinde SDK's standard login entry point.
  const loginHref = `/api/auth/login?post_login_redirect_url=${encodeURIComponent(safeReturnTo)}`;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.root}>
      <div className={styles.card} role="main" aria-label="Sign in to SkySpecs SCAN">
        {/* ── Wordmark ───────────────────────────────────────────────── */}
        <div className={styles.wordmark} aria-label="SkySpecs SCAN">
          <div className={styles.wordmarkLogo}>
            <span className={styles.wordmarkSky}>Sky</span>
            <span className={styles.wordmarkSpecs}>Specs</span>
          </div>
          <span className={styles.wordmarkApp} aria-hidden="true">
            SCAN
          </span>
        </div>

        <hr className={styles.divider} aria-hidden="true" />

        {/* ── QR Icon ────────────────────────────────────────────────── */}
        <div className={styles.iconWrap} aria-hidden="true">
          <svg
            className={styles.icon}
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
            {/* Data modules (bottom-right) */}
            <rect x="28" y="28" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="36" y="28" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="44" y="28" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="28" y="36" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="44" y="36" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="28" y="44" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="36" y="44" width="4" height="4" rx="0.5" fill="currentColor" />
            <rect x="44" y="44" width="4" height="4" rx="0.5" fill="currentColor" />
          </svg>
        </div>

        {/* ── Body copy ──────────────────────────────────────────────── */}
        <div className={styles.body}>
          <h1 className={styles.heading}>Sign in to SCAN</h1>
          <p className={styles.subheading}>
            Field inspection and equipment tracking for SkySpecs technicians and pilots.
          </p>
        </div>

        {/* ── Primary CTA ────────────────────────────────────────────── */}
        <a
          href={loginHref}
          className={styles.signInButton}
          aria-label="Sign in with your SkySpecs account"
        >
          Sign in with SkySpecs
        </a>

        {/* ── Footer note ────────────────────────────────────────────── */}
        <p className={styles.footerNote}>
          Access is restricted to authorized SkySpecs personnel.
        </p>
      </div>

      {/* ── Back to INVENTORY (secondary link for desktop users) ────── */}
      <nav className={styles.altNav} aria-label="Alternative navigation">
        <a href="/" className={styles.altLink}>
          Back to INVENTORY dashboard
        </a>
      </nav>
    </div>
  );
}
