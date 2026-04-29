/**
 * Root page — / (public, no auth required)
 *
 * Serves two roles:
 *
 *   1. Authenticated users visiting / → immediately redirected to /inventory
 *      (server-side redirect, no flash of content).
 *
 *   2. Unauthenticated users (post-logout, direct URL access, first visit) →
 *      shown a branded login card that links to the Kinde hosted login page.
 *      After successful authentication Kinde redirects to /inventory via
 *      KINDE_POST_LOGIN_REDIRECT_URL (configured in .env.local).
 *
 * Auth check is performed server-side via getKindeServerSession() so there
 * is no client-side flash or redirect loop.
 *
 * Post-logout UX flow:
 *   1. User clicks "Log out" in InventoryNavbar
 *   2. Browser navigates to /api/auth/logout
 *   3. Kinde SDK clears session cookies and redirects to KINDE_POST_LOGOUT_REDIRECT_URL (/)
 *   4. This page renders the login card — user is clearly in the logged-out state
 *   5. Clicking "Log in" sends user through Kinde hosted login → /inventory
 */

import { redirect } from "next/navigation";
import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import { LoginLink } from "@kinde-oss/kinde-auth-nextjs/components";
import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Log in — SkySpecs INVENTORY",
  description: "Sign in to the SkySpecs INVENTORY + SCAN operations platform.",
};

export default async function RootPage() {
  // Check auth server-side — avoid any client-side redirect flash.
  const { isAuthenticated } = getKindeServerSession();
  const authenticated = await isAuthenticated();

  // Authenticated users go directly to the INVENTORY dashboard.
  if (authenticated) {
    redirect("/inventory");
  }

  // Unauthenticated: render the login card.
  return (
    <div className={styles.root}>
      <div className={styles.card} role="main" aria-label="SkySpecs INVENTORY login">
        {/* Wordmark */}
        <div className={styles.wordmark}>
          <div className={styles.wordmarkLogo} aria-label="SkySpecs">
            <span className={styles.wordmarkSky}>Sky</span>
            <span className={styles.wordmarkSpecs}>Specs</span>
          </div>
          <span className={styles.wordmarkProduct} aria-label="INVENTORY">
            INVENTORY
          </span>
        </div>

        <hr className={styles.divider} aria-hidden="true" />

        {/* Body copy */}
        <div className={styles.body}>
          <h1 className={styles.heading}>Sign in to continue</h1>
          <p className={styles.subheading}>
            Track equipment cases through assembly, deployment,
            and field inspection.
          </p>
        </div>

        {/* Login CTA — links to Kinde hosted login, returns to /inventory */}
        <LoginLink
          className={styles.loginButton}
          postLoginRedirectURL="/inventory"
        >
          Log in with SkySpecs
        </LoginLink>

        <p className={styles.footer}>
          Access is restricted to authorized SkySpecs personnel.
        </p>
      </div>
    </div>
  );
}
