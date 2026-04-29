/**
 * src/lib/use-auth-from-kinde.ts
 *
 * Kinde → Convex auth adapter hook.
 *
 * Adapts the Kinde browser client state into the shape required by
 * `ConvexProviderWithAuth` (convex/react). This hook wraps
 * `useKindeBrowserClient()` and exposes the three fields Convex needs:
 *   { isLoading, isAuthenticated, fetchAccessToken }
 *
 * Exported as a standalone module so it can be:
 *   - unit-tested independently of the full Providers tree
 *   - imported into both src/app/providers.tsx and tests
 *
 * Used in:
 *   src/app/providers.tsx — wired into ConvexProviderWithAuth.useAuth
 *
 * How it works
 * ─────────────
 * ConvexProviderWithAuth calls `useAuth()` (the hook reference passed as
 * the `useAuth` prop) on every render.  The returned `fetchAccessToken`
 * function is called by Convex when it needs a fresh bearer token to send
 * with WebSocket query/mutation requests.
 *
 * When the user is authenticated:
 *   • `isAuthenticated: true` — Convex sends auth headers
 *   • `fetchAccessToken()` returns the current Kinde access token
 *   • `ctx.auth.getUserIdentity()` in Convex handlers returns the verified identity
 *
 * When the user is NOT authenticated:
 *   • `isAuthenticated: false` — Convex does not send auth headers
 *   • `fetchAccessToken()` returns null
 *   • `ctx.auth.getUserIdentity()` in Convex handlers returns null
 *   • Protected handlers calling `requireAuth(ctx)` or `requireCurrentUser(ctx)`
 *     throw [AUTH_REQUIRED]
 *
 * Token refresh
 * ─────────────
 * When Convex suspects the token is expired, it calls
 * `fetchAccessToken({ forceRefreshToken: true })`. In that case, this hook
 * calls Kinde's `refreshData()` to re-fetch the session before returning
 * the new token. If `refreshData()` fails, the error is swallowed and
 * `getToken()` is called anyway — Convex will handle the expired-token error.
 */

"use client";

import { useKindeBrowserClient } from "@kinde-oss/kinde-auth-nextjs";

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * The auth adapter shape required by `ConvexProviderWithAuth.useAuth`.
 *
 * @see https://docs.convex.dev/auth/advanced/custom-auth
 */
export interface ConvexAuthAdapter {
  /**
   * True while the Kinde session is being resolved (loading from server).
   * Convex waits for isLoading to become false before making requests.
   */
  isLoading: boolean;

  /**
   * True when the user has a valid, non-expired Kinde session.
   * When false, Convex will not include an Authorization header.
   */
  isAuthenticated: boolean;

  /**
   * Fetch the current Kinde access token for inclusion in Convex requests.
   *
   * @param opts.forceRefreshToken
   *   When true, re-fetch the Kinde session before returning the token.
   *   Convex calls this after receiving a token-expired error from the backend.
   *
   * @returns
   *   The Kinde access token string when authenticated.
   *   `null` when the user is not authenticated or the token is unavailable.
   */
  fetchAccessToken: (opts: { forceRefreshToken: boolean }) => Promise<string | null>;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useAuthFromKinde — bridges Kinde browser client state to the shape required
 * by `ConvexProviderWithAuth`.
 *
 * Must be declared at module level (not inline inside a component) so React's
 * rules-of-hooks are satisfied — the function reference passed to
 * `ConvexProviderWithAuth.useAuth` must be stable across renders.
 *
 * @returns ConvexAuthAdapter — { isLoading, isAuthenticated, fetchAccessToken }
 *
 * @example
 * // src/app/providers.tsx
 * import { useAuthFromKinde } from "@/lib/use-auth-from-kinde";
 *
 * <ConvexProviderWithAuth client={convex} useAuth={useAuthFromKinde}>
 *   {children}
 * </ConvexProviderWithAuth>
 */
export function useAuthFromKinde(): ConvexAuthAdapter {
  const { isAuthenticated, isLoading, getToken, refreshData } =
    useKindeBrowserClient();

  return {
    // `?? true` ensures we return loading=true when the Kinde client has not
    // yet resolved its state — prevents premature unauthenticated requests.
    isLoading: isLoading ?? true,

    // `?? false` ensures we default to not-authenticated (safe default).
    isAuthenticated: isAuthenticated ?? false,

    fetchAccessToken: async ({
      forceRefreshToken,
    }: {
      forceRefreshToken: boolean;
    }): Promise<string | null> => {
      // When Convex requests a forced refresh (e.g. after a 401 response),
      // re-fetch the Kinde session so the token is up-to-date before we call
      // getToken(). The refreshData() call is async and fetches a fresh session
      // from the Kinde issuer endpoint.
      if (forceRefreshToken) {
        try {
          await refreshData();
        } catch {
          // refreshData failure is non-fatal — the client may be offline or the
          // session may be truly expired.  Fall through to getToken() which will
          // return the existing token (possibly expired) or null.  Convex will
          // handle the subsequent auth failure and surface it to the user.
        }
      }

      // getToken() returns the current Kinde access token (a signed RS256 JWT)
      // or null/undefined when the user is not authenticated.
      return getToken() ?? null;
    },
  };
}
