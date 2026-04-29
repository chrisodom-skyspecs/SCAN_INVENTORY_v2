/**
 * ScanDensityProvider — React context for SCAN mobile app density mode
 *
 * Provides the current density preference (`"comfy"` | `"compact"`) and a
 * setter to any descendant component that needs to read or change the SCAN
 * app density at the JS level — for example, a density toggle control within
 * a SCAN screen, or a component that renders different JSX (not just CSS) based
 * on density.
 *
 * CSS cascade vs. React context:
 *   The primary propagation mechanism is CSS.  The `data-density` HTML attribute
 *   on the ScanShell root div activates the `[data-density="comfy"]` /
 *   `[data-density="compact"]` blocks from §9 of base.css, which override the
 *   density custom properties for all descendant elements automatically.
 *
 *   This context is the secondary propagation mechanism — needed when a component
 *   must branch on density in JSX (e.g. render a compact list vs. an expanded
 *   card).  Components that only need padding/spacing adjustments should rely
 *   on CSS tokens alone and NOT subscribe to this context.
 *
 * Provider:
 *   `ScanDensityProvider` is rendered by `ScanShell` (the client wrapper that
 *   owns the density state and applies `data-density` to the root element).
 *
 * Consumer:
 *   Call `useScanDensityContext()` inside any SCAN client component to read the
 *   current density or update it programmatically.
 *
 * @module
 */

"use client";

import { createContext, useContext } from "react";
import type { Density } from "@/hooks/use-density";

// ─── Context shape ────────────────────────────────────────────────────────────

export interface ScanDensityContextValue {
  /**
   * Current density mode of the SCAN app.
   *
   * "comfy"   — comfortable / spacious (default)
   * "compact" — dense / information-maximising
   */
  density: Density;

  /**
   * Update the SCAN density mode.
   *
   * Propagation:
   *   1. Updates React state in ScanShell.
   *   2. Re-renders ScanShell root div with new `data-density` attribute.
   *   3. CSS attribute selectors from §9 of base.css pick up the change.
   *   4. Context consumers see the new value on next render.
   */
  setDensity: (next: Density) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * ScanDensityContext — holds the current SCAN app density state.
 *
 * Default value is the "comfy" fallback so that components rendered outside
 * a ScanDensityProvider (e.g. unit tests, Storybook) get a sensible default
 * without throwing.
 */
export const ScanDensityContext = createContext<ScanDensityContextValue>({
  density: "comfy",
  setDensity: () => {
    // Default no-op; replaced by ScanShell's real implementation.
  },
});

// ─── Consumer hook ────────────────────────────────────────────────────────────

/**
 * useScanDensityContext — read (and update) the SCAN app density mode.
 *
 * Must be called inside a component that is a descendant of `ScanShell`.
 * Outside the SCAN app layout (e.g. in INVENTORY components), the hook returns
 * the context default ("comfy", no-op setter) rather than throwing — this is
 * intentional to allow shared components to be safely rendered in either app.
 *
 * @returns `{ density, setDensity }` — current mode + setter.
 *
 * @example
 * ```tsx
 * // Inside a SCAN screen component:
 * import { useScanDensityContext } from "@/providers/scan-density-provider";
 *
 * function ItemRow({ label }: { label: string }) {
 *   const { density } = useScanDensityContext();
 *   return density === "compact" ? (
 *     <span>{label}</span>
 *   ) : (
 *     <div className={styles.cardRow}>{label}</div>
 *   );
 * }
 * ```
 */
export function useScanDensityContext(): ScanDensityContextValue {
  return useContext(ScanDensityContext);
}
