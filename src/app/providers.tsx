/**
 * providers.tsx
 *
 * Client-side provider tree for the SkySpecs INVENTORY + SCAN apps.
 * Wraps children with:
 *   1. ThemeProvider           — shared dark/light mode state + toggle (outermost
 *                                so the login page / loading states also support dark mode)
 *   2. KindeProvider           — authentication state (user session, org, permissions)
 *   3. ConvexProviderWithAuth  — real-time reactive subscriptions WITH Kinde JWT
 *   4. TelemetryInitializer    — wires the Convex mutation into the telemetry
 *                                singleton and identifies the authenticated user
 *
 * Authentication wiring
 * ─────────────────────
 * `ConvexProviderWithAuth` (not the plain `ConvexProvider`) is used so that the
 * Kinde access token is included as a Bearer token in every Convex WebSocket
 * message (query subscriptions, mutation calls, action invocations).
 *
 * On the Convex backend, `convex/auth.config.ts` registers Kinde as a trusted
 * JWT issuer.  When a request arrives with a valid Kinde token, Convex makes
 * `ctx.auth.getUserIdentity()` available inside query and mutation handlers —
 * enabling unauthenticated requests to be rejected at the function level.
 *
 * useAuthFromKinde
 * ────────────────
 * A module-level hook adapter that wraps `useKindeBrowserClient()` into the
 * shape required by `ConvexProviderWithAuth`:
 *   { isLoading, isAuthenticated, fetchAccessToken }
 *
 * `fetchAccessToken` calls Kinde's `getToken()` which returns the raw access
 * token (a signed RS256 JWT).  When `forceRefreshToken` is true, `refreshData()`
 * is awaited first so Convex gets a fresh token after session expiry.
 *
 * Provider order matters:
 *   KindeProvider must be outermost so that `useKindeBrowserClient()` (called
 *   inside `useAuthFromKinde`) has access to the Kinde context.
 *
 * TelemetryInitializer
 * ────────────────────
 * Rendered as the first child inside ConvexProviderWithAuth so both Kinde
 * and Convex are available.  It:
 *   • Obtains `useMutation(api.telemetry.recordTelemetryBatch)` — the Convex
 *     mutation function used by the telemetry queue in production mode.
 *   • Reads the Kinde user identity via `useKindeBrowserClient()`.
 *   • On mount/update: calls `initTelemetry({ convexMutateAsync, userId })` to
 *     swap in the production Convex sink and associate the authenticated user
 *     with all subsequent telemetry events.
 * This single initializer serves both INVENTORY (/inventory/*) and SCAN
 * (/scan/*) because both app segments share this provider tree.
 *
 * Must be "use client" so it can use React context and hooks.
 * The root layout imports this as a server component boundary.
 */

"use client";

import { useEffect } from "react";
import { useKindeBrowserClient } from "@kinde-oss/kinde-auth-nextjs";
import { KindeProvider } from "@kinde-oss/kinde-auth-nextjs";
import { ConvexProviderWithAuth, ConvexReactClient, useMutation } from "convex/react";
import type React from "react";
import { api } from "../../convex/_generated/api";
import { initTelemetry, identify } from "@/lib/telemetry";
import { UserIdentityProvider } from "@/providers/user-identity-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { useAuthFromKinde } from "@/lib/use-auth-from-kinde";
import { ConvexThemeSync } from "@/components/ConvexThemeSync/ConvexThemeSync";
import { ConvexDensitySync } from "@/components/ConvexDensitySync/ConvexDensitySync";
import { ConvexLayoutSync } from "@/components/ConvexLayoutSync/ConvexLayoutSync";

// ─── Convex client ────────────────────────────────────────────────────────────

/**
 * Module-level Convex client.
 *
 * Guarded against missing URL so Next.js static prerendering (`next build`)
 * does not throw "Provided address was not an absolute URL" when
 * NEXT_PUBLIC_CONVEX_URL is not set in the build environment.
 *
 * In production the env var is required; all dynamic routes that use
 * Convex hooks will show a loading state until the client is available.
 */
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

// ─── Telemetry initializer ────────────────────────────────────────────────────

/**
 * TelemetryInitializer — wires the Convex mutation into the telemetry singleton.
 *
 * Rendered as the first child inside `ConvexProviderWithAuth` so both Kinde
 * and Convex contexts are available.  Calling this component for all routes
 * means both INVENTORY and SCAN apps share the same initialization path.
 *
 * What it does
 * ─────────────
 * 1. Obtains the `recordTelemetryBatch` Convex mutation function via
 *    `useMutation`.  In production this replaces the default no-op sink with
 *    the Convex-direct delivery path, bypassing the /api/telemetry HTTP proxy.
 *
 * 2. Reads the authenticated Kinde user from `useKindeBrowserClient`.
 *    Once the user is resolved (non-null, non-loading), `identify(userId)` is
 *    called so all subsequent telemetry events carry the user's Kinde ID.
 *
 * This component renders nothing — it is a side-effect-only initializer.
 *
 * Note: `initTelemetry` and `identify` are safe to call multiple times.
 * Both are idempotent for the same values.  If the Convex mutation reference
 * changes (rare, but possible if the client reconnects) the sink is updated
 * automatically because the `useEffect` re-runs when `recordBatch` changes.
 */
function TelemetryInitializer(): null {
  const recordBatch = useMutation(api.telemetry.recordTelemetryBatch);
  const { user, isLoading } = useKindeBrowserClient();

  // Wire the Convex mutation into the telemetry queue whenever it changes.
  // In test / development modes, `initTelemetry` is a no-op (the sink is
  // already set at module load time).
  useEffect(() => {
    initTelemetry({ convexMutateAsync: recordBatch });
  }, [recordBatch]);

  // Associate the Kinde user ID with all subsequent telemetry events.
  // Guard: skip while auth is still loading or if user is not authenticated.
  useEffect(() => {
    if (!isLoading && user?.id) {
      identify(user.id);
    }
  }, [isLoading, user?.id]);

  return null;
}

// ─── Provider component ───────────────────────────────────────────────────────

export function Providers({ children }: { children: React.ReactNode }) {
  // During `next build` without a Convex URL, render children without the
  // Convex provider.  All Convex hooks will be inert (undefined data) but
  // the app shell will still server-render cleanly.
  if (!convex) {
    return (
      <ThemeProvider>
        <KindeProvider>
          <UserIdentityProvider>{children}</UserIdentityProvider>
        </KindeProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      {/*
       * ThemeProvider is outermost so that the dark/light CSS class on <html>
       * is applied before any auth-gated content renders.  The login page and
       * loading states support dark mode without needing Kinde or Convex.
       * Components call useThemeContext() / useIsDark() from anywhere in the tree.
       */}
      <KindeProvider>
        {/*
         * ConvexProviderWithAuth sends the Kinde JWT as a Bearer token on every
         * Convex request.  `convex/auth.config.ts` configures Convex to verify
         * these tokens using Kinde's JWKS endpoint.
         *
         * After verification, `ctx.auth.getUserIdentity()` is available in all
         * query and mutation handlers, allowing unauthenticated requests to be
         * rejected at the Convex function level.
         */}
        <ConvexProviderWithAuth client={convex} useAuth={useAuthFromKinde}>
          {/*
           * ConvexThemeSync bridges ThemeContext (localStorage) with the
           * Convex user profile so the dark/light preference syncs across
           * sessions and devices.
           *
           * On first resolution after auth:  reads user.themePreference from
           * Convex and calls setTheme() to override the localStorage/OS default.
           *
           * On every subsequent toggle:  writes the new preference back to
           * Convex via setMyThemePreference mutation.  localStorage is also
           * updated by useTheme (inside ThemeProvider) as a local fast-path.
           */}
          <ConvexThemeSync />
          {/*
           * ConvexDensitySync bridges the useDensity / useScanDensity hooks
           * (which manage localStorage) with the Convex user profile so density
           * preferences sync across sessions and devices.
           *
           * Priority on a fresh session:
           *   1. Convex user profile (cross-device sync, applied after auth)
           *   2. localStorage cache  (fast startup, applied on mount)
           *   3. Default ("comfy")   (when neither source has a stored value)
           *
           * On first resolution after auth: reads user.invDensityPreference and
           * user.scanDensityPreference from Convex and broadcasts them to the
           * density hooks via the density-sync event bus.
           *
           * On every subsequent density change: writes the new preference back
           * to Convex via setMyDensityPreference mutation.
           */}
          <ConvexDensitySync />
          {/*
           * ConvexLayoutSync bridges useLayoutPreferences (localStorage) with
           * the Convex userPreferences table so layout preferences (activeMapMode,
           * activeCaseLayout) sync across sessions and devices.
           *
           * Priority on a fresh session:
           *   1. Convex userPreferences row (cross-device sync, applied after auth)
           *   2. localStorage cache  (fast startup, applied on mount)
           *   3. Hard-coded defaults ("M1" map mode, "T1" case layout)
           *
           * On first resolution after auth: reads the user's stored preferences
           * from Convex and broadcasts them to useLayoutPreferences via the
           * layout-sync event bus.
           *
           * On every subsequent preference change: writes the new preference
           * back to Convex via upsertLayoutPreferences mutation.
           */}
          <ConvexLayoutSync />
          {/*
           * TelemetryInitializer must be inside ConvexProviderWithAuth so that
           * `useMutation` has a valid Convex client to bind against.  It renders
           * nothing — its only purpose is the side effects in its useEffect hooks.
           * Placing it here ensures it runs for all routes under both
           * /inventory/* (INVENTORY dashboard) and /scan/* (SCAN mobile app).
           */}
          <TelemetryInitializer />
          {/*
           * UserIdentityProvider reads from useKindeBrowserClient() once and
           * exposes { id, email, name, roles, isLoading, isAuthenticated } to
           * all descendant components via useUserIdentity().
           *
           * Mounted inside ConvexProviderWithAuth so it shares the same Kinde
           * session context that Convex uses for JWT authentication.
           * Available to both /inventory/* and /scan/* routes.
           */}
          <UserIdentityProvider>
            {children}
          </UserIdentityProvider>
        </ConvexProviderWithAuth>
      </KindeProvider>
    </ThemeProvider>
  );
}
