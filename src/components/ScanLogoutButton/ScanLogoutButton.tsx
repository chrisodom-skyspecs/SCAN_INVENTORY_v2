/**
 * ScanLogoutButton — touch-optimized logout button for the SCAN mobile app
 *
 * Renders a form that invokes the `scanLogout` server action when submitted.
 * Using a form + server action (rather than a plain `<a>` link) provides:
 *
 *   1. Correct semantics — logout is a mutating action; POST > GET
 *   2. CSRF protection  — Next.js Server Actions include CSRF validation
 *   3. Progressive enhancement — works even before JS hydration completes
 *   4. No open-redirect risk — the destination is hardcoded server-side
 *
 * The component is used in two locations:
 *   • SCAN landing page footer (/scan) — "Sign out" link style
 *   • SCAN layout header (/scan/*) — icon + text for persistent access
 *
 * Design system compliance:
 *   - Design tokens only — no hex literals
 *   - Min-height 44px (WCAG 2.5.5 / iOS HIG touch targets)
 *   - Inter Tight typography (matches SCAN UI)
 *   - -webkit-tap-highlight-color: transparent (suppress mobile tap flash)
 *   - prefers-reduced-motion respected via CSS module
 *   - WCAG AA contrast for both light and dark themes
 *
 * Props:
 *   variant  — "link" (subtle footer text) | "header" (header icon+text)
 *   label    — accessible label (default: "Sign out of SkySpecs SCAN")
 *
 * @see src/app/scan/actions.ts  — the `scanLogout` server action
 */

"use client";

import { useTransition } from "react";
import { scanLogout } from "@/app/scan/actions";
import styles from "./ScanLogoutButton.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ScanLogoutButtonProps {
  /**
   * Visual variant:
   *   "link"   — subtle text link used in the SCAN landing page footer
   *   "header" — compact icon + text for use in the persistent SCAN header
   *
   * @default "link"
   */
  variant?: "link" | "header";
  /**
   * Accessible label for the button.
   * @default "Sign out of SkySpecs SCAN"
   */
  label?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Touch-optimized logout button for the SCAN mobile app.
 *
 * Wraps the `scanLogout` server action in a form for CSRF safety and
 * progressive enhancement.  While the action is pending (network round-trip
 * to the Kinde logout endpoint), the button is disabled and shows a subtle
 * opacity shift to communicate state.
 */
export function ScanLogoutButton({
  variant = "link",
  label = "Sign out of SkySpecs SCAN",
}: ScanLogoutButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await scanLogout();
    });
  }

  return (
    /*
     * Using a <form> with method="POST" and action={scanLogout} would be the
     * pure server-action pattern, but because we want to show a pending state,
     * we use a button + useTransition instead. The scanLogout server action
     * is called programmatically via startTransition.
     *
     * The form still wraps the button for correct semantics even in JS-less
     * environments (the action attribute provides the redirect target when
     * JavaScript is unavailable — see the noscript href in page.tsx).
     */
    <form
      action={scanLogout}
      className={variant === "header" ? styles.formHeader : styles.formLink}
    >
      <button
        type="submit"
        className={
          variant === "header" ? styles.buttonHeader : styles.buttonLink
        }
        aria-label={label}
        aria-busy={isPending}
        disabled={isPending}
        onClick={(e) => {
          // Intercept submit to show pending state via useTransition.
          // Fall through to native form submit if JS is unavailable.
          e.preventDefault();
          handleClick();
        }}
      >
        {variant === "header" && (
          /*
           * Log-out icon (arrow pointing right from a door opening).
           * Decorative — aria-hidden since the button has an aria-label.
           */
          <svg
            className={styles.icon}
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M7 3H4a1 1 0 00-1 1v12a1 1 0 001 1h3M14 15l4-5-4-5M18 10H8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <span className={styles.label}>Sign out</span>
      </button>
    </form>
  );
}

export default ScanLogoutButton;
