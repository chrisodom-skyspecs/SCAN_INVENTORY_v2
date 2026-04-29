/**
 * INVENTORY route layout
 *
 * Provides:
 *   • Server-side auth guard — redirects unauthenticated requests to Kinde login
 *   • InventoryNavbar — authenticated user identity + logout button
 *   • RequireAuth — client-side auth guard for defense-in-depth (session expiry)
 *   • MapStateProvider — URL ↔ React map state sync for all /inventory children
 *   • Suspense boundary — required by Next.js App Router for components
 *     that call useSearchParams() (MapStateProvider, useMapUrlState, useMapParams)
 *
 * Authentication layers (defense-in-depth):
 *   1. Middleware (src/middleware.ts) — edge-level guard using withAuth.
 *      Fires before any RSC request; redirects unauthenticated users to
 *      /scan/login with isReturnToCurrentPage=true so they return to their
 *      original URL after authentication.
 *   2. Server-side layout guard (this file) — runs inside the RSC pipeline.
 *      Handles edge cases where the middleware is bypassed (e.g. direct RSC
 *      requests, misconfigured edge environments).  Redirects to Kinde login
 *      via /scan/login?post_login_redirect_url=/inventory.
 *   3. RequireAuth client component — runs in the browser after hydration.
 *      Guards against session expiry while the SPA is open; redirects to the
 *      Kinde login flow whenever the Kinde session resolves as unauthenticated.
 *
 * Feature flag — FF_INV_REDESIGN:
 *   When NEXT_PUBLIC_FF_INV_REDESIGN=1, the layout switches to the redesigned
 *   AppShell (52px top bar + 220px side nav grid) described in spec §2.
 *   When disabled, the original single-column layout is preserved for
 *   backwards compatibility.
 *
 * Legacy layout structure:
 *   <html>
 *     <body>
 *       <Providers>              ← KindeProvider + ConvexProvider (root layout)
 *         <InventoryLayout>      ← server-side auth guard runs here
 *           <RequireAuth>        ← client-side auth guard (session expiry)
 *             <InventoryNavbar />  ← sticky header: wordmark + user chip + logout
 *             <Suspense>
 *               <MapStateProvider>
 *                 {children}       ← InventoryMapClient (map + case detail panel)
 *               </MapStateProvider>
 *             </Suspense>
 *           </RequireAuth>
 *         </InventoryLayout>
 *       </Providers>
 *     </body>
 *   </html>
 *
 * Redesign layout structure (FF_INV_REDESIGN=1):
 *   <html>
 *     <body>
 *       <Providers>
 *         <InventoryLayout>      ← server-side auth guard runs here
 *           <RequireAuth>        ← client-side auth guard (session expiry)
 *             <AppShell topBar={<InventoryNavbar />} sideNav={null}>
 *               <Suspense>
 *                 <MapStateProvider>
 *                   {children}       ← InventoryMapClient
 *                 </MapStateProvider>
 *               </Suspense>
 *             </AppShell>
 *           </RequireAuth>
 *         </InventoryLayout>
 *       </Providers>
 *     </body>
 *   </html>
 *
 * Height budget:
 *   Legacy:  --inv-navbar-height (3rem / 48px) drives the map height calc.
 *   Redesign: --shell-topbar-height (3.25rem / 52px) + --shell-sidenav-width
 *   (13.75rem / 220px) are set as CSS custom properties by the AppShell component.
 *
 * All child components inside /app/inventory may safely call:
 *   useMapState, useMapView, useOrgFilter, useKitFilter, etc.
 *   useMapParams (does NOT require the Provider, but benefits from it)
 */

import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { MapStateProvider } from "@/providers/map-state-provider";
import { RequireAuth } from "@/components/RequireAuth";
import { InventoryNavbar } from "./InventoryNavbar";
import { AppShell } from "./AppShell";
import { InventorySideNav } from "./InventorySideNav";
import { InventoryShell } from "./InventoryShell";

// ─── Feature flags ─────────────────────────────────────────────────────────────

/**
 * FF_INV_REDESIGN — enables the INVENTORY dashboard redesign (spec §0–25).
 *
 * When enabled:
 *   - AppShell replaces the legacy single-column layout
 *   - Top bar height: 52px (--shell-topbar-height) instead of 48px
 *   - Side nav: 220px (--shell-sidenav-width) — scaffold only in this AC
 *
 * Set NEXT_PUBLIC_FF_INV_REDESIGN=1 in your environment to activate.
 */
const FF_INV_REDESIGN =
  process.env.NEXT_PUBLIC_FF_INV_REDESIGN === "1" ||
  process.env.NEXT_PUBLIC_FF_INV_REDESIGN === "true";

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Legacy navbar height — used by the legacy layout and the map height calc.
 * Must stay in sync with --inv-navbar-height in InventoryNavbar.module.css.
 */
const LEGACY_NAVBAR_HEIGHT = "3rem"; /* 48px */

// ─── Loading fallbacks ─────────────────────────────────────────────────────────

/**
 * Full-height spinner shown while search params are being read.
 * Used by both legacy and redesign layouts.
 *
 * Accepts a `height` prop so the fallback fills the correct region in each
 * layout context:
 *   - Legacy: calc(100dvh - navbar height)
 *   - Redesign: 100% (fills the main grid area)
 */
function MapLoadingFallback({ height = "100%" }: { height?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height,
        background: "var(--surface-base)",
        color: "var(--ink-secondary)",
        fontFamily: "'Inter Tight', sans-serif",
        fontSize: "0.875rem",
      }}
      aria-live="polite"
      aria-label="Loading INVENTORY map"
    >
      Loading…
    </div>
  );
}

// ─── Layout variants ───────────────────────────────────────────────────────────

/**
 * Redesign layout — AppShell grid with 52px top bar + 220px side nav scaffold.
 *
 * Uses InventoryShell (a Client Component) to manage mobile nav open/close state.
 * InventoryShell orchestrates:
 *   - InventoryNavbar   — top bar with hamburger toggle on mobile (≤ 768px)
 *   - InventorySideNav  — side nav links; collapses by default on mobile
 *   - AppShell          — CSS grid; applies data-nav-open for overlay drawer
 *
 * The layout itself stays a Server Component — only the client-side state
 * (mobileNavOpen toggle) lives inside InventoryShell.
 *
 * RequireAuth wraps InventoryShell to provide the client-side auth guard.
 * This is the third layer of defense-in-depth after the middleware and the
 * server-side layout auth check.
 */
function RedesignLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <InventoryShell>
        <Suspense fallback={<MapLoadingFallback height="100%" />}>
          <MapStateProvider defaultPathname="/inventory">
            {children}
          </MapStateProvider>
        </Suspense>
      </InventoryShell>
    </RequireAuth>
  );
}

/**
 * Legacy layout — original single-column flex layout preserved for
 * compatibility when FF_INV_REDESIGN is disabled.
 *
 * RequireAuth wraps the layout body to provide the client-side auth guard.
 */
function LegacyLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100dvh",
          overflow: "hidden",
          // Expose navbar height as a CSS variable for child components
          // (InventoryMapClient uses it to calculate its own height).
          ["--inv-navbar-height" as string]: LEGACY_NAVBAR_HEIGHT,
        }}
      >
        {/* Top navigation bar — always visible above the map */}
        <InventoryNavbar />

        {/* Map content area — fills remaining viewport height */}
        <Suspense
          fallback={
            <MapLoadingFallback
              height={`calc(100dvh - ${LEGACY_NAVBAR_HEIGHT})`}
            />
          }
        >
          <MapStateProvider defaultPathname="/inventory">
            {children}
          </MapStateProvider>
        </Suspense>
      </div>
    </RequireAuth>
  );
}

// ─── Exported layout ───────────────────────────────────────────────────────────

/**
 * InventoryLayout — server-side auth guard + layout shell for /inventory routes.
 *
 * Auth guard (layer 2 of 3):
 *   Calls getKindeServerSession().isAuthenticated() before rendering any layout
 *   content.  Unauthenticated requests are redirected to the Kinde login flow
 *   via /scan/login with post_login_redirect_url=/inventory.
 *
 *   This complements the middleware guard (layer 1) by handling edge cases where
 *   the middleware is bypassed, and prepares the session for the client-side
 *   RequireAuth guard (layer 3) which fires after hydration.
 */
export default async function InventoryLayout({ children }: { children: ReactNode }) {
  // ─── Server-side auth guard (layer 2 of 3) ─────────────────────────────────
  //
  // Verify the Kinde session server-side before rendering any layout content.
  // This runs inside the RSC pipeline on every /inventory/* page load.
  //
  // Redirect destination: /scan/login?post_login_redirect_url=/inventory
  //   • /scan/login — the branded SCAN login page (also serves INVENTORY users)
  //   • post_login_redirect_url=/inventory — returns users to the dashboard
  //     after successful Kinde authentication
  //
  // The middleware (layer 1) already handles this redirect with isReturnToCurrentPage=true,
  // preserving the exact route the user was trying to access.  This layout guard
  // redirects to the base /inventory route since the layout cannot reliably
  // determine the full sub-path being requested.
  const { isAuthenticated } = getKindeServerSession();
  if (!(await isAuthenticated())) {
    redirect("/scan/login?post_login_redirect_url=/inventory");
  }

  return FF_INV_REDESIGN ? (
    <RedesignLayout>{children}</RedesignLayout>
  ) : (
    <LegacyLayout>{children}</LegacyLayout>
  );
}
