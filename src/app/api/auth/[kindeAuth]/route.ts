/**
 * Kinde Auth Route Handler
 *
 * Handles all Kinde authentication flows for the INVENTORY dashboard and SCAN
 * mobile app. This single catch-all route supports:
 *
 *   GET /api/auth/login        — Redirect to Kinde hosted login
 *   GET /api/auth/logout       — Clear session and redirect post-logout
 *   GET /api/auth/register     — Redirect to Kinde hosted registration
 *   GET /api/auth/kinde_callback — Handle OAuth callback from Kinde
 *
 * The [kindeAuth] dynamic segment is consumed by the Kinde SDK; it must
 * remain a dynamic catch-all. Do not rename this file.
 *
 * Environment variables required (see .env.local):
 *   KINDE_CLIENT_ID
 *   KINDE_CLIENT_SECRET
 *   KINDE_ISSUER_URL
 *   KINDE_SITE_URL
 *   KINDE_POST_LOGOUT_REDIRECT_URL
 *   KINDE_POST_LOGIN_REDIRECT_URL
 */

export { GET, POST } from "@kinde-oss/kinde-auth-nextjs/server";
