/**
 * InventoryShell — client wrapper that manages the INVENTORY app shell state.
 *
 * This component is the client-side orchestrator for the AppShell grid layout.
 * It owns the `mobileNavOpen` boolean state and wires the toggle/close callbacks
 * between the top bar (hamburger button in InventoryNavbar) and the AppShell
 * (which applies `data-nav-open` for the CSS-driven mobile overlay).
 *
 * Why a separate component?
 *   The `InventoryLayout` in layout.tsx is a Server Component — it cannot use
 *   React hooks.  This thin wrapper isolates the stateful client-side logic so
 *   that the Server Component boundary is not broken.
 *
 * Mobile nav behaviour:
 *   • Nav starts CLOSED (mobileNavOpen = false) on every page load.
 *   • The hamburger button in InventoryNavbar toggles the state.
 *   • Clicking the scrim or pressing Escape closes the nav.
 *   • Clicking any nav link also closes the nav (via onLinkClick → closeNav).
 *   • CSS in AppShell.module.css handles the slide-in animation entirely.
 *
 * Props:
 *   children — the main page content rendered inside AppShell.main.
 *              Typically a Suspense-wrapped MapStateProvider + page component.
 */

"use client";

import { useState, useCallback, type ReactNode } from "react";
import { AppShell } from "./AppShell";
import { InventoryNavbar } from "./InventoryNavbar";
import { InventorySideNav } from "./InventorySideNav";

// ─── Props ────────────────────────────────────────────────────────────────────

interface InventoryShellProps {
  /** Main page content rendered in the AppShell main region. */
  children: ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * InventoryShell — stateful client wrapper for the INVENTORY dashboard chrome.
 *
 * Manages mobile nav open/closed state and threads it through AppShell,
 * InventoryNavbar (hamburger toggle button), and InventorySideNav (close on link click).
 */
export function InventoryShell({ children }: InventoryShellProps) {
  // ── Mobile nav state ──────────────────────────────────────────────────────
  // Default: closed (collapsed). The nav is always visible at ≥ 769px via CSS;
  // this state only affects the mobile overlay behaviour.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const closeNav = useCallback(() => setMobileNavOpen(false), []);
  const toggleNav = useCallback(
    () => setMobileNavOpen((prev) => !prev),
    [],
  );

  return (
    <AppShell
      topBar={
        <InventoryNavbar
          onMenuToggle={toggleNav}
          mobileNavOpen={mobileNavOpen}
        />
      }
      sideNav={
        // Pass closeNav so that clicking a nav link on mobile closes the drawer.
        <InventorySideNav onLinkClick={closeNav} />
      }
      mobileNavOpen={mobileNavOpen}
      onNavClose={closeNav}
    >
      {children}
    </AppShell>
  );
}

export default InventoryShell;
