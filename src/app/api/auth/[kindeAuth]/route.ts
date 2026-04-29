/**
 * Kinde Auth Route Handler
 *
 * Handles all Kinde authentication flows for the INVENTORY dashboard and SCAN
 * mobile app. This single catch-all route supports:
 *
 *   GET /api/auth/login           — Redirect to Kinde hosted login (INVENTORY default)
 *   GET /api/auth/logout          — Clear session and redirect post-logout
 *   GET /api/auth/register        — Redirect to Kinde hosted registration
 *   GET /api/auth/kinde_callback  — Handle OAuth callback from Kinde
 *   GET /api/auth/scan-login      — SCAN-specific login (redirects to /scan after auth)
 *
 * The [kindeAuth] dynamic segment is consumed by the Kinde SDK for the
 * standard routes. The scan-login endpoint is a custom alias that injects the
 * SCAN app post-login redirect URL so field technicians land on /scan after auth.
 *
 * The [kindeAuth] dynamic segment must remain — do not rename this file.
 *
 * Environment variables required (see .env.local):
 *   KINDE_CLIENT_ID                       Kinde application client ID
 *   KINDE_CLIENT_SECRET                   Kinde application client secret
 *   KINDE_ISSUER_URL                      https://<subdomain>.kinde.com
 *   KINDE_SITE_URL                        Base URL of this deployment
 *   KINDE_POST_LOGOUT_REDIRECT_URL        Post-logout destination
 *   KINDE_POST_LOGIN_REDIRECT_URL         Default post-login destination (INVENTORY)
 *   KINDE_POST_LOGIN_ALLOWED_URL_REGEX    Open-redirect guard regex
 *   KINDE_SCAN_POST_LOGIN_REDIRECT_URL    Post-login destination for SCAN flows
 *
 * Kinde dashboard settings required (Application → Authentication):
 *   Allowed callback URLs:
 *     http://localhost:3000/api/auth/kinde_callback
 *     https://inventory.skyspecsops.com/api/auth/kinde_callback
 *   Allowed logout redirect URLs:
 *     http://localhost:3000
 *     http://localhost:3000/scan
 *     https://inventory.skyspecsops.com
 *     https://inventory.skyspecsops.com/scan
 *   Allowed origins (CORS):
 *     http://localhost:3000
 *     https://inventory.skyspecsops.com
 *
 * @see https://kinde.com/docs/developer-tools/nextjs-sdk/
 */

import { handleAuth } from "@kinde-oss/kinde-auth-nextjs/server";

/**
 * Standard Kinde auth handler — covers login, logout, register, kinde_callback.
 * The SDK reads KINDE_* env vars automatically from the environment.
 *
 * SCAN-specific login is handled by the dedicated route at:
 *   src/app/api/auth/scan-login/route.ts → GET /api/auth/scan-login
 */
export const GET = handleAuth();
