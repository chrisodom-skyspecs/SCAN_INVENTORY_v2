/**
 * Next.js Middleware — Kinde Authentication Guard
 *
 * Protects INVENTORY dashboard routes (/inventory/*) and SCAN app routes
 * (/scan/*) behind Kinde authentication.  Unauthenticated requests are
 * redirected to the Kinde hosted login page.
 *
 * Public routes (no auth required):
 *   • / (marketing / root redirect)
 *   • /api/auth/* (Kinde auth callbacks and login/logout handlers)
 *   • /api/telemetry (server-to-server telemetry ingest)
 *
 * Protected routes:
 *   • /inventory and all sub-paths
 *   • /scan and all sub-paths
 *
 * The withAuth wrapper is provided by @kinde-oss/kinde-auth-nextjs and handles:
 *   • Session validation (JWT verification against Kinde JWKS)
 *   • Redirect to Kinde login when no valid session exists
 *   • Passing the authenticated user into page/route handler context
 *
 * @see https://kinde.com/docs/developer-tools/nextjs-sdk/
 */

import { withAuth } from "@kinde-oss/kinde-auth-nextjs/middleware";
import type { NextRequest } from "next/server";

export default withAuth(function middleware(_req: NextRequest) {
  // Additional middleware logic can be added here (e.g., RBAC, org checks).
  // The withAuth wrapper has already validated the session by this point.
});

export const config = {
  /*
   * Match all routes except:
   *   • Next.js internals (_next/static, _next/image, favicon.ico)
   *   • Kinde auth route handlers (/api/auth/*)
   *   • Public API endpoints (/api/telemetry)
   *
   * Using a negative lookahead to keep the matcher simple and avoid
   * accidentally blocking legitimate auth callbacks.
   */
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *   - _next/static (static files)
     *   - _next/image (image optimization)
     *   - favicon.ico
     *   - manifest.json
     *   - api/auth/* (Kinde auth handlers — MUST be public)
     *   - api/telemetry (server-to-server ingest — no user session)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|api/auth|api/telemetry).*)",
  ],
};
