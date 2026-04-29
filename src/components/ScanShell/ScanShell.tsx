/**
 * ScanShell — client wrapper for the SCAN mobile app layout chrome
 *
 * This component is the client-side shell that:
 *   1. Manages the `data-density` attribute on the SCAN app root element.
 *   2. Provides the `ScanDensityContext` to all descendant SCAN components.
 *   3. Preserves the user's density preference in localStorage.
 *
 * Architecture
 * ────────────
 * The `/scan/layout.tsx` file is a Next.js Server Component (it exports
 * `metadata` and `viewport`).  This thin client wrapper isolates the stateful
 * density logic so the Server Component boundary is not broken.
 *
 * The same pattern is used by `InventoryShell.tsx` (INVENTORY app shell).
 *
 * Density propagation (two channels):
 *
 *   1. CSS attribute selectors (primary):
 *      `data-density={density}` on the root `<div>` activates the CSS custom
 *      property blocks from §9 of base.css:
 *        [data-density="comfy"]   → spacious layout tokens
 *        [data-density="compact"] → dense layout tokens
 *      All descendant elements that consume `--density-*` tokens automatically
 *      receive the correct values through the CSS cascade — no extra prop
 *      drilling needed.
 *
 *   2. React context (secondary):
 *      `ScanDensityContext` is provided so that components needing to branch
 *      on density at the JSX level (not just CSS) can call
 *      `useScanDensityContext()` without re-deriving the state from the DOM.
 *
 * Layout structure (rendered by /scan/layout.tsx):
 *   <ScanShell>
 *     <ServiceWorkerRegistration />
 *     <header>...</header>       ← sticky wordmark bar
 *     <main>{children}</main>    ← scrollable SCAN screen content
 *   </ScanShell>
 *
 * The outer `.shell` div is owned by ScanShell (not layout.tsx) so the
 * `data-density` and `data-app` attributes are co-located with the state
 * that manages them.
 *
 * WCAG note:
 *   Default density is "comfy" — comfortable spacing with ≥ 48px row heights —
 *   so touch targets satisfy WCAG 2.5.5 (44 × 44 CSS px) out of the box.
 *   Users who prefer "compact" mode accept the reduced row height (36px) which
 *   still meets the minimum 44px target for explicitly sized interactive elements
 *   (buttons, toggles) that carry their own `min-height: 44px` rule.
 */

"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { useScanDensity } from "@/hooks/use-scan-density";
import { ScanDensityContext } from "@/providers/scan-density-provider";
import { track } from "@/lib/telemetry";
import { TelemetryEventName } from "@/types/telemetry.types";
import styles from "./ScanShell.module.css";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ScanShellProps {
  /**
   * SCAN layout children: ServiceWorkerRegistration, header, and main content.
   * Rendered inside the density-aware root div.
   */
  children: ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ScanShell — stateful client wrapper for the SCAN app density system.
 *
 * Applies `data-density` to the root element and provides the density context
 * so CSS and React-tree consumers both receive the current density value.
 *
 * @param props.children  SCAN layout content (header + main region).
 */
export function ScanShell({ children }: ScanShellProps) {
  const { density, setDensity } = useScanDensity();

  // ── SCAN app entry-point telemetry ───────────────────────────────────────────
  //
  // Emit SCAN_NAV_PAGE_LOADED once when the SCAN shell mounts (i.e. the first
  // time a user lands on any /scan/* route).  This is the SCAN equivalent of
  // the INV_NAV_PAGE_LOADED event emitted by InventoryMapClient.
  //
  // `performance.now()` gives a rough "time from navigation start to SCAN shell
  // interactive" measurement — accurate enough for load-time trending.
  useEffect(() => {
    const loadDurationMs =
      typeof performance !== "undefined" ? Math.round(performance.now()) : 0;

    track({
      eventCategory: "navigation",
      eventName: TelemetryEventName.SCAN_NAV_PAGE_LOADED,
      app: "scan",
      loadDurationMs,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — fires exactly once on mount

  return (
    <ScanDensityContext.Provider value={{ density, setDensity }}>
      {/*
       * Root SCAN app shell element.
       *
       * Attributes:
       *   data-app="scan"         — identifies this tree as the SCAN app
       *   data-density={density}  — activates §9 density CSS token cascade
       *
       * The data-density attribute drives two types of consumers:
       *   a) CSS: [data-density="comfy"] / [data-density="compact"] selectors
       *      in base.css §9 override --density-* custom properties for all
       *      descendants automatically.
       *   b) JS: useScanDensityContext() reads from the React context above.
       */}
      <div
        className={styles.shell}
        data-app="scan"
        data-density={density}
        data-testid="scan-shell"
      >
        {children}
      </div>
    </ScanDensityContext.Provider>
  );
}

export default ScanShell;
