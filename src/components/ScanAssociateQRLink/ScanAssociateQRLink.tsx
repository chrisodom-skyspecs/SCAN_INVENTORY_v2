/**
 * ScanAssociateQRLink — discoverable entry point for the QR-first association
 * flow at /scan/associate.
 *
 * Sub-AC 3: When a technician receives a batch of pre-printed physical QR
 * labels, they need a way to scan a label and bind it to a case record in
 * Convex *without* first navigating to that case's detail page.  That flow
 * lives at `/scan/associate` (the QR-first / case-selection variant of the
 * association flow).  This component surfaces a discoverable link to that
 * flow from the SCAN landing page, but only for users who actually have the
 * required role.
 *
 * Role gating
 * ───────────
 * QR association requires the `technician` role (or `admin`).  Pilots have
 * `qrCode:read` (scan-to-open) but not `qrCode:generate` (associate a label).
 * This component reads the current user's role via `useCurrentUser()` and
 * renders nothing for pilots — the link is only shown to technicians and admins.
 *
 * Server-side enforcement is duplicated in two places:
 *   1. The `/scan/associate` page wraps `CaseSelectionAssociateClient` in a
 *      `ScanRoleGate require="technician"` boundary.
 *   2. The Convex `associateQRCodeToCase` mutation re-checks RBAC.
 *
 * Loading state
 * ─────────────
 * While the Kinde session is resolving (`isLoading === true`), this component
 * renders nothing.  This avoids a flash of the link for pilots before their
 * role information is available.
 *
 * Design system compliance
 * ────────────────────────
 * All colors via CSS custom properties — no hex literals.
 * Inter Tight for typography.
 * Touch target ≥ 44 px (WCAG 2.5.5).
 * WCAG AA contrast in both light and dark themes.
 */

"use client";

import Link from "next/link";
import { useCurrentUser } from "../../hooks/use-current-user";
import styles from "./ScanAssociateQRLink.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ScanAssociateQRLinkProps {
  /**
   * Optional: override role-gating for storybook / testing.
   * When `forceShow === true`, the link is rendered regardless of role.
   */
  forceShow?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ScanAssociateQRLink
 *
 * Renders a card-style secondary CTA on the SCAN landing page that navigates
 * the user to the QR-first association flow (`/scan/associate`).
 *
 * Visibility:
 *   • admin       → rendered
 *   • technician  → rendered
 *   • pilot       → hidden (returns null)
 *   • loading     → hidden (returns null)
 *   • no role     → hidden (returns null)
 */
export function ScanAssociateQRLink({
  forceShow = false,
}: ScanAssociateQRLinkProps) {
  const { isLoading, isTechnician } = useCurrentUser();

  // ── Loading or no role: render nothing ─────────────────────────────────────
  if (!forceShow && (isLoading || !isTechnician)) {
    return null;
  }

  return (
    <section
      className={styles.section}
      aria-label="Associate a QR code label"
      data-testid="scan-associate-qr-link"
    >
      <Link
        href="/scan/associate"
        className={styles.card}
        aria-label="Open the QR code association flow"
        data-testid="scan-associate-qr-link-cta"
      >
        {/* QR-link icon */}
        <span className={styles.iconWrap} aria-hidden="true">
          <svg
            className={styles.icon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <path d="M14 14h3v3h-3z M18 14h3v3h-3z M14 18h3v3h-3z M18 18h3v3h-3z" />
          </svg>
        </span>

        <span className={styles.copy}>
          <span className={styles.title}>Associate a QR Label</span>
          <span className={styles.body}>
            Scan a pre-printed QR label and link it to an equipment case.
          </span>
        </span>

        {/* Chevron right */}
        <svg
          className={styles.chevron}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </Link>
    </section>
  );
}

export default ScanAssociateQRLink;
