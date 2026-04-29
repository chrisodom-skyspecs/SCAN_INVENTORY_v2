/**
 * src/app/scan/actions.ts — SCAN app server actions
 *
 * Next.js Server Actions for the SCAN mobile web app.  These run on the
 * server and can be used directly inside `<form action={...}>` or called
 * from Client Components via `import`.
 *
 * Actions defined here:
 *   scanLogout  — clears the Kinde session and redirects to /scan/login
 *
 * Logout flow:
 *   1. A Client Component (e.g. ScanLogoutButton) renders a <form> whose
 *      `action` prop is set to `scanLogout`.
 *   2. On submit, Next.js invokes `scanLogout` on the server.
 *   3. The action redirects to the Kinde logout endpoint, which clears
 *      the session cookie and then forwards the browser to /scan/login.
 *   4. The SCAN login page is displayed so the next field technician can
 *      authenticate with their account.
 *
 * Kinde logout URL structure:
 *   /api/auth/logout?post_logout_redirect_url=<destination>
 *   ↓
 *   SDK reads KINDE_POST_LOGOUT_REDIRECT_URL env var as the default;
 *   the query param overrides it for this specific logout.
 *
 * Security notes:
 *   - `scanLogout` contains no user-supplied data; the redirect target is
 *     hardcoded to /scan/login to prevent open-redirect attacks.
 *   - The action is marked "use server" so it cannot be called client-side.
 *   - Kinde's handleAuth() validates the post_logout_redirect_url against
 *     the Allowed logout redirect URLs configured in the Kinde dashboard.
 *
 * Kinde dashboard — Allowed logout redirect URLs (must include):
 *   http://localhost:3000/scan/login      (development)
 *   https://inventory.skyspecsops.com/scan/login   (production)
 *
 * @see src/app/api/auth/[kindeAuth]/route.ts  — Kinde SDK route handler
 * @see src/app/scan/login/page.tsx            — destination after logout
 * @see src/components/ScanLogoutButton/       — form component that calls this action
 */

"use server";

import { redirect } from "next/navigation";

/**
 * SCAN logout server action.
 *
 * Redirects the current user to the Kinde logout endpoint, which clears
 * the session and then redirects to /scan/login.
 *
 * Usage:
 *   <form action={scanLogout}>
 *     <button type="submit">Sign out</button>
 *   </form>
 *
 * Or via `startTransition` in a Client Component:
 *   import { scanLogout } from "@/app/scan/actions";
 *   <button onClick={() => startTransition(() => scanLogout())}>Sign out</button>
 */
export async function scanLogout(): Promise<never> {
  // The redirect target must be registered in the Kinde dashboard's
  // "Allowed logout redirect URLs" list.  Hard-coding /scan/login prevents
  // open-redirect attacks from a tampered form action.
  redirect("/api/auth/logout?post_logout_redirect_url=/scan/login");
}
