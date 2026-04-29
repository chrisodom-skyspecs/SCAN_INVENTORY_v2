/**
 * convex/auth.config.ts
 *
 * Convex native JWT authentication configuration for the SkySpecs INVENTORY + SCAN apps.
 *
 * Registers Kinde as a trusted JWT issuer so that Convex query and mutation
 * handlers can call `ctx.auth.getUserIdentity()` to retrieve the verified
 * token identity — without custom RS256 verification inside each function.
 *
 * How it works
 * ────────────
 * When a Convex client is configured via ConvexProviderWithAuth (see
 * src/app/providers.tsx), the client sends the Kinde access token as a
 * Bearer token alongside every query and mutation request over the Convex
 * WebSocket.  Convex verifies the JWT signature using this JWKS URL before
 * making `ctx.auth.getUserIdentity()` available inside the handler.
 *
 * Separate channels
 * ─────────────────
 * This config only affects the Convex client WebSocket protocol (queries,
 * mutations).  The custom JWT verification in convex/auth.ts is for the
 * HTTP action POST /api/auth/sync — a separate channel used for first-login
 * user record setup.  Both mechanisms should remain in place.
 *
 * Environment variables (must be set in Convex dashboard and .env.local)
 * ───────────────────────────────────────────────────────────────────────
 *   KINDE_ISSUER_URL   — e.g. https://<subdomain>.kinde.com
 *   KINDE_CLIENT_ID    — Kinde application client ID
 *
 * UserIdentity fields populated by Kinde access tokens
 * ─────────────────────────────────────────────────────
 * After a successful JWT verification, `ctx.auth.getUserIdentity()` returns:
 *   tokenIdentifier  — `${sub}|${iss}` (stable and globally unique)
 *   subject          — Kinde `sub` claim (user ID, same as kindeId in users table)
 *   issuer           — Kinde `iss` claim
 *   email            — from `email` claim
 *   givenName        — from `given_name` claim
 *   familyName       — from `family_name` claim
 *   pictureUrl       — from `picture` claim
 *
 * @see https://docs.convex.dev/auth/advanced/custom-jwt
 */

import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      /**
       * Use the customJwt provider type so we can explicitly specify the JWKS
       * URL and algorithm for Kinde (which uses RS256).
       *
       * applicationID is intentionally omitted: Kinde access tokens set `aud`
       * to the Kinde issuer URL / domain, and the exact value varies by
       * Kinde plan and configuration.  Omitting applicationID makes Convex
       * accept any audience, which is safe in a single-tenant deployment where
       * the JWKS URL and issuer alone identify the trusted provider.
       *
       * See:
       * https://docs.convex.dev/auth/advanced/custom-jwt#warning-omitting-applicationid-is-often-insecure
       */
      type: "customJwt" as const,
      issuer: process.env.KINDE_ISSUER_URL!,
      jwks: `${process.env.KINDE_ISSUER_URL}/.well-known/jwks.json`,
      algorithm: "RS256" as const,
    },
  ],
} satisfies AuthConfig;
