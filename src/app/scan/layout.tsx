/**
 * SCAN app layout — mobile-first shell
 *
 * Provides the outer chrome for all SCAN mobile app screens:
 *   • Fixed header with SkySpecs wordmark + logout button (authenticated)
 *   • Scrollable content area (100dvh - header)
 *   • Safe area insets for notched/edge-to-edge devices
 *
 * Typography and colors use design tokens only — no hex literals.
 *
 * Viewport:
 *   viewportFit="cover" enables the CSS safe-area-inset-* env()
 *   values consumed by layout.module.css to extend content under
 *   the iOS status bar / home indicator / Android camera cutout.
 *   User scaling is allowed (WCAG 1.4.4 — Resize Text: AA).
 *
 * Header logout button:
 *   The layout reads the Kinde session server-side and conditionally renders
 *   a ScanLogoutButton in the header right rail when the user is authenticated.
 *   On the /scan/login page, the user is unauthenticated (the middleware auto-
 *   excludes /scan/login from the auth guard), so the button is not shown.
 *   This gives field technicians a persistent, accessible logout path from any
 *   SCAN screen without needing to navigate back to the landing page.
 */

import type { Metadata, Viewport } from "next";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { ScanShell } from "@/components/ScanShell";
import { ScanLogoutButton } from "@/components/ScanLogoutButton";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { ThemeToggle } from "@/components/ThemeToggle";
import "../../styles/scan/base.css";
import styles from "./layout.module.css";

export const metadata: Metadata = {
  title: {
    template: "%s — SkySpecs SCAN",
    default: "SkySpecs SCAN",
  },
  description: "Field inspection and equipment tracking for SkySpecs technicians.",
};

/**
 * SCAN-specific viewport configuration.
 *
 * Next.js translates this export into a <meta name="viewport"> tag
 * in the <head> of every /scan/* page:
 *
 *   <meta name="viewport"
 *     content="width=device-width, initial-scale=1,
 *              maximum-scale=5, viewport-fit=cover">
 *
 * Settings rationale:
 *   - width=device-width     — viewport equals the physical device width;
 *                              no shrink-wrapping on phones.
 *   - initial-scale=1        — render at 1:1 CSS-px to device-px ratio.
 *   - maximum-scale=5        — allows pinch-zoom up to 5×; WCAG 1.4.4
 *                              (Resize Text AA) requires user scaling to
 *                              be permitted — this provides a sensible cap.
 *   - viewport-fit=cover     — content may paint under the iOS notch and
 *                              home indicator; the CSS shell compensates
 *                              with env(safe-area-inset-*) padding tokens.
 *
 * Overrides the root layout's viewport (which has userScalable:false for
 * the INVENTORY dashboard) — App Router applies the most-specific segment's
 * viewport export, so all /scan/* routes get this configuration.
 *
 * Breakpoint tiers applied within this viewport:
 *   mobile  ≤ 767px  — single-column, full-bleed (default / no @media)
 *   tablet  768–1023px — @media (min-width: 768px)
 *   desktop ≥ 1024px   — @media (min-width: 1024px)
 *
 * Token source: src/styles/tokens/breakpoints.css
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default async function ScanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ── Auth state for conditional header controls ───────────────────────────
  // Read the Kinde session here in the Server Component layout so we can
  // show the logout button only when the user is authenticated.
  // On /scan/login the user is unauthenticated → no logout button.
  // On /scan/* (all other routes) the middleware has validated the session.
  const { isAuthenticated } = getKindeServerSession();
  const authenticated = await isAuthenticated();

  return (
    /*
     * ScanShell is a Client Component that:
     *   1. Reads the user's density preference from localStorage ("scan_density").
     *   2. Applies data-density="comfy"|"compact" to the root div so that the
     *      §9 density CSS token cascade (base.css) propagates to all children.
     *   3. Provides ScanDensityContext so child components can read/change density
     *      via useScanDensityContext() without deriving state from the DOM.
     *
     * The SCAN layout itself stays a Server Component (exports metadata + viewport)
     * while ScanShell encapsulates the only stateful client-side logic.
     */
    <ScanShell>
      {/* Register the SCAN service worker for PWA installation support */}
      <ServiceWorkerRegistration />

      <header className={styles.header} role="banner">
        <div className={styles.headerInner}>
          {/* Wordmark */}
          <span className={styles.wordmark} aria-label="SkySpecs SCAN">
            <span className={styles.wordmarkBrand}>Sky</span>
            <span className={styles.wordmarkProduct}>Specs</span>
            <span className={styles.wordmarkApp}>SCAN</span>
          </span>

          {/*
           * Right-side header controls: theme toggle + logout button.
           *
           * Both controls are always visible in the header so field technicians
           * can switch dark mode or sign out from any SCAN screen without
           * navigating back to the landing page.
           *
           * ThemeToggle reads the theme from ThemeContext (via ThemeProvider in
           * src/app/providers.tsx) which hydrates from localStorage on mount.
           * Toggling writes back to localStorage["theme_preference"] and adds /
           * removes the `theme-dark` CSS class on <html>, activating the dark
           * token cascade from base.css §3 for both INVENTORY and SCAN.
           */}
          <div className={styles.headerControls}>
            {/*
             * ThemeToggle — light/dark mode switcher for SCAN.
             * Applies the stored preference from localStorage on initial load
             * (managed by useTheme → readThemePreference in theme-storage.ts).
             * The `scan-header` className variant targets the compact sizing
             * rules in layout.module.css so the button fits the 48px header.
             */}
            <ThemeToggle className={styles.headerThemeToggle} />

            {/*
             * Logout button — only rendered for authenticated users.
             * Uses the "header" variant (compact icon + label) to fit the 48px
             * header height while maintaining the ≥44px touch target.
             */}
            {authenticated && (
              <ScanLogoutButton
                variant="header"
                label="Sign out of SkySpecs SCAN"
              />
            )}
          </div>
        </div>
      </header>

      <main className={styles.main} id="main-content">
        {children}
      </main>
    </ScanShell>
  );
}
