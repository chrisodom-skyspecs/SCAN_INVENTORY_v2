/**
 * ThemeToggle — INVENTORY dashboard light/dark mode toggle button
 *
 * A compact icon button that switches between light and dark themes.
 * Reads current theme state from ThemeContext via useThemeContext() and
 * calls toggleTheme() on click.
 *
 * Visual design:
 *   • Shows a sun icon (☀) in dark mode → clicking switches to light.
 *   • Shows a moon icon (☾) in light mode → clicking switches to dark.
 *   • Styled as a 36×36px square icon button matching the notification bell.
 *   • Uses design tokens for all colors — no hex literals.
 *
 * Accessibility:
 *   • aria-pressed reflects whether dark mode is currently active.
 *   • aria-label changes dynamically: "Switch to dark mode" / "Switch to light mode".
 *   • title attribute mirrors aria-label for tooltip visibility.
 *   • Icons are aria-hidden — the accessible name comes from aria-label.
 *   • Focus visible ring via --border-focus token.
 *
 * WCAG AA:
 *   • Light theme: --ink-secondary on --surface-raised — passes ≥ 4.5:1.
 *   • Dark theme: --ink-secondary (--_n-300) on --surface-raised (--_n-900)
 *     — contrast ratio ≥ 7:1, well above AA.
 *
 * Reduced motion:
 *   The icon-swap involves no animation. The transition on hover background
 *   is suppressed when prefers-reduced-motion is active (see CSS module).
 */

"use client";

import { useThemeContext } from "@/providers/theme-provider";
import styles from "./ThemeToggle.module.css";

// ─── Icons ────────────────────────────────────────────────────────────────────

interface IconProps {
  className?: string;
}

/**
 * SunIcon — shown in dark mode (clicking switches to light).
 * 16×16 SVG sun: central circle + 8 radiating lines.
 */
function SunIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {/* Central sun disc */}
      <circle cx="8" cy="8" r="2.5" />
      {/* Radiating rays — 8 directions */}
      <line x1="8" y1="1"   x2="8" y2="3"   stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="13"  x2="8" y2="15"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="1"   y1="8" x2="3"   y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="13"  y1="8" x2="15"  y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2.9" y1="2.9" x2="4.3" y2="4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="11.7" y1="11.7" x2="13.1" y2="13.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="11.7" y1="2.9" x2="13.1" y2="4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            transform="scale(-1,1) translate(-16,0)" />
      <line x1="2.9" y1="11.7" x2="4.3" y2="13.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            transform="scale(-1,1) translate(-16,0)" />
    </svg>
  );
}

/**
 * MoonIcon — shown in light mode (clicking switches to dark).
 * 16×16 SVG crescent moon using a clip/mask approach.
 */
function MoonIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {/*
       * Crescent moon: a filled circle with another white circle cut from
       * the upper-right to create the crescent shape.
       * Using a path that approximates a crescent.
       */}
      <path
        fillRule="evenodd"
        d="M7.5 1.5a6 6 0 1 0 6.9 8.3 4.5 4.5 0 0 1-6.9-8.3Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ThemeToggleProps {
  /**
   * Additional CSS class applied to the outer button element.
   * Use for layout positioning from the parent (e.g. margin adjustments).
   */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ThemeToggle — icon button for switching between light and dark mode.
 *
 * Reads current theme from ThemeContext via useThemeContext().
 * Calls toggleTheme() on click — the context handles DOM class updates,
 * localStorage persistence, and OS-preference sync.
 *
 * Renders a sun icon in dark mode and a moon icon in light mode so the
 * button always communicates "what you'll get if you click" (i.e. the
 * target state) rather than "what is currently active".
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { isDark, toggleTheme } = useThemeContext();

  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      className={[styles.toggle, className].filter(Boolean).join(" ")}
      onClick={toggleTheme}
      aria-pressed={isDark}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      data-dark={isDark ? "true" : "false"}
    >
      {isDark ? (
        <SunIcon className={styles.icon} />
      ) : (
        <MoonIcon className={styles.icon} />
      )}
    </button>
  );
}

export default ThemeToggle;
