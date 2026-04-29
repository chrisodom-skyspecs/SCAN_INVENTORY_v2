/**
 * RequireAuth — client-side authentication guard for INVENTORY dashboard routes.
 *
 * Provides defense-in-depth authentication checking on the client side,
 * complementing the server-side middleware guard (src/middleware.ts) and the
 * server-side layout auth check (src/app/inventory/layout.tsx).
 *
 * When to use:
 *   Use RequireAuth when you need client-side protection against session expiry
 *   while the SPA is open, or when a protected component might be rendered after
 *   client-side navigation before the server can enforce the auth guard.
 *
 * Behavior:
 *   • isLoading=true (Kinde session resolving):
 *     Renders `fallback` — defaults to a full-height "Authenticating…" panel
 *     using design tokens to avoid FOUC (flash of unauthenticated content).
 *   • isAuthenticated=false (no session or session expired):
 *     Redirects to `loginUrl` via router.replace() and renders null.
 *   • isAuthenticated=true (valid session):
 *     Renders `children` as-is.
 *
 * Auth flow:
 *   1. User opens INVENTORY dashboard with a valid session → children render.
 *   2. User's session expires mid-session → next hook tick detects the change,
 *      RequireAuth redirects to /scan/login, Kinde handles re-authentication,
 *      and the user returns to /inventory after login.
 *
 * Design system compliance:
 *   • Loading fallback uses CSS custom properties (--surface-base, --ink-secondary)
 *   • Typography: Inter Tight (--font-ui)
 *   • No hex literals in inline styles
 *
 * @see src/middleware.ts                   — server-side edge auth guard
 * @see src/app/inventory/layout.tsx        — server-side layout auth guard
 * @see https://kinde.com/docs/developer-tools/nextjs-sdk/
 */

"use client";

import { useEffect, type ReactNode } from "react";
import { useKindeBrowserClient } from "@kinde-oss/kinde-auth-nextjs";
import { useRouter } from "next/navigation";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface RequireAuthProps {
  /**
   * The protected content to render when the user is authenticated.
   */
  children: ReactNode;

  /**
   * URL to redirect unauthenticated users to.
   *
   * Defaults to "/scan/login?post_login_redirect_url=/inventory" which matches
   * the middleware's loginPage + isReturnToCurrentPage behavior and sends the
   * user through the Kinde hosted login flow, returning them to /inventory.
   *
   * Override for pages outside the root /inventory path, e.g.:
   *   loginUrl="/scan/login?post_login_redirect_url=/inventory/settings"
   */
  loginUrl?: string;

  /**
   * Loading state UI rendered while the Kinde session is being resolved.
   *
   * Defaults to a centered "Authenticating…" text panel styled with design
   * tokens.  Override to provide a skeleton or a layout-specific placeholder.
   */
  fallback?: ReactNode;
}

// ─── Default loading fallback ─────────────────────────────────────────────────

/**
 * AuthLoadingFallback — design-token-compliant loading panel.
 *
 * Shown while Kinde's session check is in flight.  Uses CSS custom properties
 * so it automatically adapts to light and dark themes.
 */
function AuthLoadingFallback() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100dvh",
        background: "var(--surface-base)",
        color: "var(--ink-secondary)",
        fontFamily: "var(--font-ui, 'Inter Tight', sans-serif)",
        fontSize: "0.875rem",
        letterSpacing: "0.01em",
      }}
      role="status"
      aria-live="polite"
      aria-label="Verifying authentication"
    >
      Authenticating…
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * RequireAuth — wraps protected content with a client-side auth check.
 *
 * Reads the Kinde session state via useKindeBrowserClient() and redirects
 * unauthenticated users to the Kinde login flow.  Acts as defense-in-depth
 * after the server-side middleware guard.
 *
 * @example
 * // Protect a layout or page:
 * <RequireAuth>
 *   <InventoryShell>
 *     {children}
 *   </InventoryShell>
 * </RequireAuth>
 *
 * @example
 * // Protect a specific page with a targeted return URL:
 * <RequireAuth loginUrl="/scan/login?post_login_redirect_url=/inventory/settings">
 *   <SettingsPage />
 * </RequireAuth>
 */
export function RequireAuth({
  children,
  loginUrl = "/scan/login?post_login_redirect_url=/inventory",
  fallback,
}: RequireAuthProps): ReactNode {
  const { isAuthenticated, isLoading } = useKindeBrowserClient();
  const router = useRouter();

  useEffect(() => {
    // Only trigger the redirect once the Kinde session check has resolved.
    // Avoids premature redirects during SSR / initial hydration where
    // isAuthenticated may briefly appear false before the token is read.
    if (!isLoading && !isAuthenticated) {
      router.replace(loginUrl);
    }
  }, [isAuthenticated, isLoading, loginUrl, router]);

  // ── Loading state ──────────────────────────────────────────────────────────
  // Show fallback while session is being fetched to avoid FOUC.
  if (isLoading) {
    return fallback ?? <AuthLoadingFallback />;
  }

  // ── Unauthenticated state ─────────────────────────────────────────────────
  // Redirect is in progress (fired in the useEffect above).
  // Render nothing to prevent flash of protected content.
  if (!isAuthenticated) {
    return null;
  }

  // ── Authenticated ─────────────────────────────────────────────────────────
  return <>{children}</>;
}

export default RequireAuth;
