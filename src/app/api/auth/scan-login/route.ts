/**
 * SCAN Mobile App Login Route
 *
 * A dedicated login entry-point for the SCAN mobile web app.  Field
 * technicians and pilots accessing the SCAN app directly (not via a case
 * QR deep-link) are sent here to authenticate and then land on the SCAN
 * dashboard rather than the INVENTORY dashboard.
 *
 * Redirect flow:
 *   1. User visits /scan (unauthenticated, no caseId in URL)
 *   2. SCAN landing page links to /api/auth/scan-login
 *   3. This route builds a Kinde login URL with post_login_redirect_url
 *      set to KINDE_SCAN_POST_LOGIN_REDIRECT_URL (/scan by default)
 *   4. User authenticates with Kinde
 *   5. Kinde redirects to /api/auth/kinde_callback
 *   6. SDK session is established, user is forwarded to /scan
 *
 * For case QR deep-links (/scan/<caseId>), the standard withAuth middleware
 * handles the redirect automatically — this route is not involved.
 *
 * Environment variables used:
 *   KINDE_SCAN_POST_LOGIN_REDIRECT_URL  — destination after SCAN login
 *   KINDE_SITE_URL                      — base URL for building the login URL
 *
 * Kinde dashboard must include these callback URLs (already covered by the
 * shared INVENTORY/SCAN application configuration):
 *   http://localhost:3000/api/auth/kinde_callback
 *   https://inventory.skyspecsops.com/api/auth/kinde_callback
 */

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const siteUrl = (process.env.KINDE_SITE_URL ?? "").replace(/\/$/, "");

  // Destination after successful authentication — default to /scan
  const scanRedirect =
    (process.env.KINDE_SCAN_POST_LOGIN_REDIRECT_URL ?? "").replace(/\/$/, "") ||
    `${siteUrl}/scan`;

  // Build the standard Kinde login URL, injecting the SCAN redirect target.
  // The withAuth middleware and Kinde SDK will validate this URL against
  // KINDE_POST_LOGIN_ALLOWED_URL_REGEX before honouring it.
  const loginUrl = new URL(`${siteUrl}/api/auth/login`);
  loginUrl.searchParams.set("post_login_redirect_url", scanRedirect);

  // Preserve any query params passed to scan-login (e.g. ?returnTo=/scan/CASE-001)
  const returnTo = req.nextUrl.searchParams.get("returnTo");
  if (returnTo) {
    loginUrl.searchParams.set("post_login_redirect_url", returnTo);
  }

  return NextResponse.redirect(loginUrl.toString());
}
