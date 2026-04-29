/**
 * breakpoints.ts — SCAN app responsive breakpoint utilities
 *
 * Exposes canonical breakpoint values as typed TypeScript constants for use in:
 *   • useBreakpoint() hook — reactive breakpoint detection via matchMedia
 *   • Mapbox camera constraints — different bounds at different screen sizes
 *   • Conditional rendering — bottom-sheet vs. dialog, stack vs. row, etc.
 *
 * Two breakpoint systems are defined:
 *
 *   BREAKPOINTS — Device-level breakpoints (component-level adjustments)
 *     Mirrors CSS custom properties from src/styles/tokens/base.css §8.
 *     These target specific device widths for fine-grained component tweaks.
 *     sm: 390px, md: 640px, lg: 1024px
 *
 *   TIERS — Page-level responsive tiers (layout-level decisions)
 *     Mirrors CSS custom properties from src/styles/tokens/breakpoints.css.
 *     These define the three-tier mobile / tablet / desktop layout system.
 *     mobile: ≤767px (base), tablet: 768–1023px, desktop: ≥1024px
 *
 * The pixel values here MUST stay in sync with the CSS custom properties.
 * If the CSS values change, update the constants below and re-run tests.
 */

/** Canonical SCAN device-level breakpoint values in pixels. */
export const BREAKPOINTS = {
  /** sm — standard phone width (390px) */
  sm: 390,
  /** md — large phone / phablet (640px) */
  md: 640,
  /** lg — tablet / wide-glass (1024px) */
  lg: 1024,
} as const;

export type BreakpointKey = keyof typeof BREAKPOINTS;

/**
 * Page-level responsive tier thresholds in pixels.
 *
 * These define the three-tier layout system used by both INVENTORY and SCAN:
 *   mobile  — base tier; styles applied without a @media wrapper (mobile-first)
 *   tablet  — medium tier; @media (min-width: 768px) ... (max-width: 1023px)
 *   desktop — wide tier; @media (min-width: 1024px)
 *
 * Mirrors the CSS custom properties in src/styles/tokens/breakpoints.css.
 *
 * @example
 * // Detect current tier
 * const isTablet = window.matchMedia(
 *   `(min-width: ${TIERS.tabletMin}px) and (max-width: ${TIERS.tabletMax}px)`
 * ).matches;
 */
export const TIERS = {
  /** Maximum width for the mobile tier (767px — below this is mobile) */
  mobileMax: 767,
  /** Minimum width for the tablet tier (768px) */
  tabletMin: 768,
  /** Maximum width for the tablet tier (1023px) */
  tabletMax: 1023,
  /** Minimum width for the desktop tier (1024px) */
  desktopMin: 1024,
} as const;

export type TierKey = keyof typeof TIERS;

/**
 * Returns the current responsive tier name based on window width.
 * Falls back to "mobile" in SSR environments.
 */
export function getCurrentTier(): "mobile" | "tablet" | "desktop" {
  if (typeof window === "undefined") return "mobile";
  const w = window.innerWidth;
  if (w >= TIERS.desktopMin) return "desktop";
  if (w >= TIERS.tabletMin) return "tablet";
  return "mobile";
}

/**
 * Returns the CSS media query string for "tablet and above" (≥ 768px).
 * Use in matchMedia calls when you need tablet-up behaviour.
 */
export const MQ_TABLET_UP = `(min-width: ${TIERS.tabletMin}px)` as const;

/**
 * Returns the CSS media query string for "desktop and above" (≥ 1024px).
 */
export const MQ_DESKTOP_UP = `(min-width: ${TIERS.desktopMin}px)` as const;

/**
 * Returns the CSS media query string for the tablet tier only (768–1023px).
 */
export const MQ_TABLET_ONLY =
  `(min-width: ${TIERS.tabletMin}px) and (max-width: ${TIERS.tabletMax}px)` as const;

/**
 * Returns the CSS media query string for a min-width breakpoint.
 *
 * @example
 * const mq = minWidth("md"); // "(min-width: 640px)"
 * window.matchMedia(mq).matches;
 */
export function minWidth(bp: BreakpointKey): string {
  return `(min-width: ${BREAKPOINTS[bp]}px)`;
}

/**
 * Returns the CSS media query string for a max-width breakpoint
 * (exclusive — 1px below the next tier to avoid overlap with min-width).
 *
 * @example
 * const mq = maxWidth("md"); // "(max-width: 639px)"
 */
export function maxWidth(bp: BreakpointKey): string {
  return `(max-width: ${BREAKPOINTS[bp] - 1}px)`;
}

/**
 * Returns the CSS media query string for a specific breakpoint range.
 *
 * @example
 * const mq = between("sm", "md"); // "(min-width: 390px) and (max-width: 639px)"
 */
export function between(from: BreakpointKey, to: BreakpointKey): string {
  return `(min-width: ${BREAKPOINTS[from]}px) and (max-width: ${BREAKPOINTS[to] - 1}px)`;
}

/**
 * Reads a breakpoint token value directly from the CSS custom property
 * on the document root — confirms CSS and JS are in sync at runtime.
 *
 * Returns null in SSR environments where `document` is unavailable.
 *
 * @example
 * const smPx = getCSSBreakpoint("sm"); // 390 (number) or null
 */
export function getCSSBreakpoint(bp: BreakpointKey): number | null {
  if (typeof document === "undefined") return null;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--bp-${bp}-raw`)
    .trim();
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? null : parsed;
}
