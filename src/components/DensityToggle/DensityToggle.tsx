/**
 * DensityToggle — INVENTORY dashboard data-density toggle control
 *
 * A small two-button segment control that switches the INVENTORY dashboard
 * between "comfy" (spacious) and "compact" (dense) layouts.
 *
 * Clicking a button calls `useDensity().setDensity()` which:
 *   1. Updates the `data-density` attribute on `document.documentElement`
 *   2. Persists the choice to `localStorage["inv_density"]`
 *   3. Activates the CSS custom-property cascade in §9 of base.css
 *
 * Design:
 *   - Uses design tokens only — no hex literals in this file or its CSS module.
 *   - WCAG AA contrast in both light and dark themes (all colors via tokens).
 *   - Keyboard-navigable: Tab between buttons, Space/Enter to activate.
 *   - focus-visible ring via --border-focus token.
 *   - Reduced motion: transitions stripped by prefers-reduced-motion.
 *
 * Accessibility:
 *   - Outer wrapper has role="group" + aria-label="Display density".
 *   - Each button has aria-pressed reflecting its active (selected) state.
 *   - Icons are aria-hidden; the hidden `.label` span carries the accessible name.
 *   - title attribute provides a tooltip describing each option.
 */

"use client";

import { useDensity } from "@/hooks/use-density";
import styles from "./DensityToggle.module.css";

// ─── Icons ────────────────────────────────────────────────────────────────────

interface IconProps {
  className?: string;
}

/**
 * ComfyIcon — three wide rows representing a spacious layout.
 * Used as the visual indicator for "comfy" density mode.
 */
function ComfyIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {/* Three rows with generous vertical spacing */}
      <rect x="1" y="2" width="14" height="3" rx="0.5" />
      <rect x="1" y="7" width="14" height="3" rx="0.5" />
      <rect x="1" y="12" width="14" height="2" rx="0.5" />
    </svg>
  );
}

/**
 * CompactIcon — five narrow rows representing a dense layout.
 * Used as the visual indicator for "compact" density mode.
 */
function CompactIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {/* Five rows with tight vertical spacing */}
      <rect x="1" y="1.5" width="14" height="2" rx="0.5" />
      <rect x="1" y="4.5" width="14" height="2" rx="0.5" />
      <rect x="1" y="7.5" width="14" height="2" rx="0.5" />
      <rect x="1" y="10.5" width="14" height="2" rx="0.5" />
      <rect x="1" y="13.5" width="14" height="2" rx="0.5" />
    </svg>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DensityToggleProps {
  /**
   * Additional CSS class applied to the outer wrapper element.
   * Use for layout positioning from the parent (e.g. margin adjustments).
   */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * DensityToggle — two-button segment control for comfy / compact density.
 *
 * Reads current state from `useDensity` and calls `setDensity` on click.
 * The hook handles DOM attribute updates and localStorage persistence.
 */
export function DensityToggle({ className }: DensityToggleProps) {
  const { density, setDensity } = useDensity();

  return (
    <div
      className={[styles.wrapper, className].filter(Boolean).join(" ")}
      role="group"
      aria-label="Display density"
      data-testid="density-toggle"
    >
      {/* ── Comfy option ────────────────────────────────────────────────── */}
      <button
        type="button"
        className={styles.option}
        data-active={density === "comfy" ? "true" : "false"}
        aria-pressed={density === "comfy"}
        onClick={() => setDensity("comfy")}
        title="Comfy — spacious layout"
        data-testid="density-toggle-comfy"
      >
        <ComfyIcon className={styles.icon} />
        <span className={styles.label}>Comfy</span>
      </button>

      {/* ── Compact option ───────────────────────────────────────────────── */}
      <button
        type="button"
        className={styles.option}
        data-active={density === "compact" ? "true" : "false"}
        aria-pressed={density === "compact"}
        onClick={() => setDensity("compact")}
        title="Compact — dense layout"
        data-testid="density-toggle-compact"
      >
        <CompactIcon className={styles.icon} />
        <span className={styles.label}>Compact</span>
      </button>
    </div>
  );
}

export default DensityToggle;
