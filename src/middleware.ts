/**
 * Next.js Middleware — Kinde Authentication Guard
 *
 * Protects INVENTORY dashboard routes (/inventory/*) and SCAN app routes
 * (/scan/*) behind Kinde authentication.  Unauthenticated requests are
 * redirected to /scan/login (the branded SCAN login page) which in turn
 * links to the Kinde hosted login flow.
 *
 * Public routes (no auth required):
 *   • / (marketing / root redirect)
 *   • /scan/login (SCAN login page — auto-excluded by withAuth loginPage option)
 *   • /api/auth/* (Kinde auth callbacks and login/logout handlers)
 *   • /api/auth/scan-login (SCAN-specific login entry point — redirects to login)
 *   • /api/telemetry (server-to-server telemetry ingest)
 *   • /case/:caseId (QR deep-link redirect — handled by next.config.ts)
 *
 * Protected routes:
 *   • /inventory and all sub-paths (INVENTORY dashboard)
 *   • /scan and all sub-paths (SCAN mobile app)
 *
 * SCAN Mobile App Auth Flow:
 *   1. Field technician scans a QR code → opens /scan/<caseId>
 *   2. Middleware detects no session → redirects to /scan/login with
 *      ?post_login_redirect_url=/scan/<caseId> (via isReturnToCurrentPage)
 *   3. User authenticates on the branded SCAN login page (Kinde hosted login)
 *   4. After auth, user lands back on the original /scan/<caseId> page
 *
 * INVENTORY Auth Flow:
 *   1. Dashboard user navigates to /inventory (no session)
 *   2. Middleware redirects to /scan/login with
 *      ?post_login_redirect_url=/inventory
 *   3. User authenticates; Kinde redirects back to /inventory
 *
 * Logout flows:
 *   • SCAN users: /api/auth/logout?post_logout_redirect_url=/scan/login
 *     → clears session → lands on /scan/login
 *   • INVENTORY users: /api/auth/logout?post_logout_redirect_url=/
 *     → clears session → lands on root page
 *
 * Kinde application (dashboard) settings required:
 *   Allowed callback URLs:
 *     http://localhost:3000/api/auth/kinde_callback
 *     https://inventory.skyspecsops.com/api/auth/kinde_callback
 *   Allowed logout redirect URLs:
 *     http://localhost:3000                                    (INVENTORY)
 *     http://localhost:3000/scan                               (SCAN landing)
 *     http://localhost:3000/scan/login                         (SCAN login)
 *     https://inventory.skyspecsops.com                        (INVENTORY)
 *     https://inventory.skyspecsops.com/scan                   (SCAN landing)
 *     https://inventory.skyspecsops.com/scan/login             (SCAN login)
 *   Allowed origins (CORS):
 *     http://localhost:3000
 *     https://inventory.skyspecsops.com
 *
 * withAuth options used:
 *   loginPage: "/scan/login"
 *     — Redirects unauthenticated users to the branded SCAN login page.
 *       The SDK automatically treats this path as public (no auth loop).
 *   isReturnToCurrentPage: true
 *     — Appends ?post_login_redirect_url=<current-path> to the loginPage
 *       redirect so users return to the page they were trying to access.
 *
 * @see src/app/scan/login/page.tsx              — SCAN login page UI
 * @see src/app/api/auth/[kindeAuth]/route.ts    — OAuth callback handler
 * @see https://kinde.com/docs/developer-tools/nextjs-sdk/
 */

import { withAuth } from "@kinde-oss/kinde-auth-nextjs/middleware";
import { NextResponse, type NextRequest } from "next/server";

export default withAuth(
  function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    // Authenticated user visiting /scan/login → they don't need to log in.
    // Redirect to the SCAN landing page instead.
    if (pathname === "/scan/login") {
      return NextResponse.redirect(new URL("/scan", req.url));
    }

    // Additional middleware logic can be added here (e.g., RBAC, org checks).
    // req.kindeAuth is populated by withAuth with { token, user } for
    // authenticated users.  SCAN-specific role checks (pilot vs. technician)
    // can be implemented by inspecting req.kindeAuth.token.roles.
  },
  {
    /*
     * loginPage — all unauthenticated requests to protected routes are
     * redirected here instead of directly to Kinde's hosted login.
     * The SDK treats this path as implicitly public (no auth loop).
     */
    loginPage: "/scan/login",

    /*
     * isReturnToCurrentPage — appends ?post_login_redirect_url=<current-path>
     * to the loginPage redirect.  The login page reads this and passes it
     * through to Kinde so users land back on the originally requested page
     * after authentication (critical for QR code deep-links like /scan/<id>).
     */
    isReturnToCurrentPage: true,
  }
);

export const config = {
  /*
   * Explicitly protect only the INVENTORY dashboard and SCAN mobile app.
   *
   * Protected:
   *   /inventory          — INVENTORY dashboard (and all sub-paths)
   *   /scan               — SCAN mobile app (and all sub-paths, including /scan/login)
   *
   * Note on /scan/login:
   *   Even though /scan/login is matched here, withAuth's loginPage option
   *   auto-excludes it from the auth guard.  Unauthenticated users can
   *   reach /scan/login freely; authenticated users are redirected to /scan
   *   by the middleware callback above.
   *
   * Intentionally NOT matched (public routes):
   *   /                   — root page (INVENTORY login / post-logout redirect)
   *   /api/auth/*         — Kinde auth handlers (MUST be public so callbacks work)
   *   /api/telemetry      — server-to-server telemetry ingest (no user session)
   *   /case/*             — QR deep-link redirects (public → redirect to /scan/*)
   *   /_next/*            — Next.js static/image assets
   *   /favicon.ico etc.   — public static assets
   *
   * Using an explicit allowlist so that new routes are NOT automatically
   * protected — only /inventory and /scan require auth.
   */
  matcher: ["/inventory/:path*", "/scan/:path*"],
};
