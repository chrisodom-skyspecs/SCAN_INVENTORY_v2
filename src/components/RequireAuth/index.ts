/**
 * RequireAuth — client-side authentication guard for protected routes.
 *
 * Redirects unauthenticated users to the Kinde login flow when the browser
 * session expires or client-side navigation reaches a protected route.
 *
 * Complements:
 *   • src/middleware.ts              — edge-level guard (withAuth)
 *   • src/app/inventory/layout.tsx   — server-side layout guard
 *
 * @module RequireAuth
 */

export { RequireAuth, type RequireAuthProps } from "./RequireAuth";
export { default } from "./RequireAuth";
