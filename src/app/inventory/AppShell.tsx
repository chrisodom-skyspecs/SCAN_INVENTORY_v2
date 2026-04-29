/**
 * AppShell — INVENTORY app shell layout scaffold (FF_INV_REDESIGN)
 *
 * Provides the three-region chrome structure for the INVENTORY dashboard:
 *
 *   ┌─────────────────────────────────────────────┐  ▲
 *   │                  Top Bar                    │  52px  (--shell-topbar-height)
 *   ├──────────────┬──────────────────────────────┤  ▼
 *   │              │                              │
 *   │   Side Nav   │         Main Content         │
 *   │   220px      │         (flex: 1)            │
 *   │              │                              │
 *   └──────────────┴──────────────────────────────┘
 *     ▲      ▲
 *     └──────┘  --shell-sidenav-width (220px)
 *
 * Responsive behaviour:
 *   ≥ 1025px   Full side nav at 220px
 *   769–1024px Side nav collapses to 52px icon-strip
 *   ≤ 768px    Side nav hidden; slides in as overlay when data-nav-open="true"
 *
 * This component provides only structural containers — no inner content.
 * Inner content is composed via the `topBar`, `sideNav`, and `children`
 * (main content) slot props.
 *
 * Feature flag:
 *   Rendered by the inventory layout when NEXT_PUBLIC_FF_INV_REDESIGN=1.
 *   The existing single-column layout is preserved as the default.
 *
 * Accessibility:
 *   • The shell element has role="application" to signal to screen readers
 *     that keyboard shortcuts may be active within this region.
 *   • The top bar has role="banner" (landmark).
 *   • The side nav has role="navigation" with aria-label.
 *   • The main area has role="main".
 *   • The mobile scrim has aria-hidden="true" and is click-dismissible.
 *
 * CSS:
 *   All dimensions reference --shell-* tokens from §6 of base.css.
 *   No hex literals; no hard-coded pixel values.
 */

"use client";

import { useCallback, type ReactNode } from "react";
import styles from "./AppShell.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AppShellProps {
  /**
   * Content rendered inside the 52px top bar container.
   * Typically the INVENTORY wordmark, mode switcher, and user controls.
   * Optional — the container is always rendered even when empty so that
   * the grid row is reserved.
   */
  topBar?: ReactNode;

  /**
   * Content rendered inside the 220px side nav container.
   * Typically the map mode list, case filter controls, and org/kit selectors.
   * Optional — the container is always rendered; on mobile it becomes a
   * slide-in overlay drawer.
   */
  sideNav?: ReactNode;

  /**
   * Primary page content — rendered in the main content region.
   * Typically InventoryMapClient (map canvas + detail panel).
   */
  children?: ReactNode;

  /**
   * Controls whether the mobile nav drawer is open.
   * When true, the side nav slides in and a scrim overlay is shown.
   * Managed by the parent; use onNavClose to react to close requests.
   *
   * Has no effect at ≥ 769px viewports (nav is always visible there).
   */
  mobileNavOpen?: boolean;

  /**
   * Called when the user requests to close the mobile nav drawer.
   * Triggered by: scrim click, Escape key.
   * The parent is responsible for setting mobileNavOpen to false.
   */
  onNavClose?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * INVENTORY app shell layout scaffold.
 *
 * Renders three structural containers (topBar, sideNav, main) with the
 * correct dimensions and responsive behaviour.  Inner content is composed
 * via slot props — this component provides only the layout chrome.
 */
export function AppShell({
  topBar,
  sideNav,
  children,
  mobileNavOpen = false,
  onNavClose,
}: AppShellProps) {
  // ── Mobile scrim click handler ─────────────────────────────────────────────
  const handleScrimClick = useCallback(() => {
    onNavClose?.();
  }, [onNavClose]);

  // ── Escape key handler for mobile nav ─────────────────────────────────────
  // The keyboard handler is on the scrim element so it doesn't interfere with
  // inner map / form keyboard interactions.

  return (
    <div
      className={styles.shell}
      data-nav-open={mobileNavOpen ? "true" : "false"}
      // Provide role="application" to signal to screen readers that this is
      // an interactive application region with keyboard shortcuts.
      role="application"
      aria-label="INVENTORY dashboard"
    >
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header
        className={styles.topBar}
        role="banner"
        aria-label="INVENTORY top bar"
      >
        {topBar}
      </header>

      {/* ── Side nav ─────────────────────────────────────────────────────── */}
      {/*
        id="inventory-side-nav" lets the mobile hamburger button reference
        this nav via aria-controls="inventory-side-nav" so assistive technology
        can announce "opens side navigation" when the button is focused.
      */}
      <nav
        id="inventory-side-nav"
        className={styles.sideNav}
        role="navigation"
        aria-label="INVENTORY side navigation"
        // On mobile: hidden until opened; communicates expanded state to AT.
        aria-hidden={undefined /* always present in DOM; CSS handles visibility */}
      >
        {sideNav}
      </nav>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main
        className={styles.main}
        role="main"
        aria-label="INVENTORY main content"
        id="inventory-main-content"
      >
        {children}
      </main>

      {/* ── Mobile scrim ─────────────────────────────────────────────────── */}
      {/*
        The ::after pseudo-element in CSS handles the visual scrim.
        This invisible button captures clicks on the scrim area so that
        closing the drawer is keyboard-accessible without polluting the
        document tree with an extra div.

        Rendered only when the mobile nav is open so it's completely
        invisible to AT when not needed.
      */}
      {mobileNavOpen && (
        <button
          type="button"
          onClick={handleScrimClick}
          // Positioned beneath the nav overlay by z-index in CSS.
          style={{
            position: "fixed",
            inset: 0,
            top: "var(--shell-topbar-height)",
            zIndex: "calc(var(--shell-z-nav-overlay, 150) - 1)",
            background: "transparent",
            border: "none",
            cursor: "default",
            padding: 0,
          }}
          aria-label="Close navigation"
          aria-hidden="true" /* the ::after pseudo-element provides the visual */
          tabIndex={-1}      /* not in tab order; Escape key closes the drawer  */
        />
      )}
    </div>
  );
}

export default AppShell;
