/**
 * src/lib/css-tokens.ts
 *
 * Utilities for reading CSS custom property design tokens from JavaScript.
 *
 * The SkySpecs INVENTORY + SCAN design system defines all colors, spacing, and
 * shadow values as CSS custom properties (tokens) in src/styles/tokens/base.css.
 * Component CSS files consume these tokens via var() references with no hex literals.
 *
 * When non-CSS contexts need color values — Mapbox GL JS layer paint expressions,
 * HTML5 Canvas fillStyle/strokeStyle, SVG attributes, or inline style objects —
 * they must read the resolved token value from the browser at runtime via
 * getComputedStyle().  This module provides the canonical utilities for doing so.
 *
 * Usage patterns:
 *
 * 1. Single token (non-reactive):
 *    const fill = resolveCssToken("--layer-deployed-bg", "#2b9348");
 *
 * 2. Mapbox GL JS paint resolver:
 *    const resolver = makeCssTokenResolver();
 *    map.setPaintProperty("pins", "circle-color",
 *      buildMapboxStatusExpression("bgToken", resolver, "#666666"));
 *
 * 3. Canvas 2D context (via element's scoped CSS custom property):
 *    const strokeColor = resolveElementToken(canvas, "--sig-stroke-color", "#000");
 *
 * 4. Reactive token with theme-change subscription (for Mapbox layers):
 *    // Call makeReactiveTokenResolver(); it returns a resolver plus a cleanup fn.
 *    const { resolver, cleanup } = makeReactiveTokenResolver(onThemeChange);
 *    // Call cleanup() in your useEffect return / component teardown.
 *
 * Constraints:
 *   - All fallback values MUST be hsl() strings derived from the design system
 *     palette, never arbitrary hex.  This keeps fallbacks documentable and
 *     consistent across light/dark themes.
 *   - On the server (SSR), getComputedStyle() is unavailable; all functions
 *     return the provided fallback value gracefully.
 *   - Functions are synchronous and side-effect-free (except the reactive variant
 *     which attaches a MutationObserver to the <html> element).
 */


// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A function that takes a CSS custom property name (with leading "--") and
 * returns the resolved string value suitable for a Mapbox paint expression
 * or canvas draw call.
 */
export type CssTokenResolver = (token: string) => string;


// ─── Core resolver ────────────────────────────────────────────────────────────

/**
 * Read a single CSS custom property from the document root element.
 *
 * @param token    - CSS custom property name, e.g. "--layer-deployed-bg"
 * @param fallback - Fallback string returned when: (a) the property is not
 *                   defined, (b) the browser returns an empty string, or
 *                   (c) running server-side (SSR / Node.js).
 * @returns        Resolved CSS value string (e.g. "hsl(142, 60%, 42%)")
 *                 or the fallback.
 *
 * @example
 * const fill = resolveCssToken("--map-m1-marker-healthy", "hsl(141, 60%, 42%)");
 * ctx.fillStyle = fill;
 */
export function resolveCssToken(token: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  return val || fallback;
}


/**
 * Read a CSS custom property from a specific DOM element.
 *
 * Use this when the token is scoped to an element's local styles (e.g.
 * a `--sig-stroke-color` set on a canvas element in its CSS Module).
 *
 * @param el       - DOM element whose computed style should be read
 * @param token    - CSS custom property name, e.g. "--sig-stroke-color"
 * @param fallback - Fallback string for missing / SSR context
 */
export function resolveElementToken(
  el: Element,
  token: string,
  fallback: string
): string {
  if (typeof window === "undefined") return fallback;
  const val = getComputedStyle(el).getPropertyValue(token).trim();
  return val || fallback;
}


// ─── Bulk resolver ────────────────────────────────────────────────────────────

/**
 * Create a reusable CssTokenResolver bound to the document root.
 *
 * Returns a resolver function that can be passed to buildMapboxStatusExpression()
 * or used inline in Mapbox setPaintProperty calls.  Reads from the live
 * computed style each time it is invoked, so it always reflects the current theme.
 *
 * @returns CssTokenResolver — a function (token: string) => string
 *
 * @example
 * const resolver = makeCssTokenResolver();
 * const color = resolver("--layer-deployed-bg");  // "hsl(141, 60%, 42%)"
 */
export function makeCssTokenResolver(): CssTokenResolver {
  return (token: string): string => {
    if (typeof window === "undefined") return token; // SSR: return the token itself
    const val = getComputedStyle(document.documentElement)
      .getPropertyValue(token)
      .trim();
    return val || token; // fallback to the token name so callers can debug
  };
}


// ─── Resolve multiple tokens at once ─────────────────────────────────────────

/**
 * Resolve multiple CSS custom property tokens in a single getComputedStyle call.
 *
 * More efficient than calling resolveCssToken() repeatedly when you need
 * several tokens for a paint spec update.
 *
 * @param tokens  - Record mapping key names to CSS custom property names
 * @param fallbacks - Corresponding fallback values (must match tokens keys)
 * @returns         Record with the same keys, values resolved from CSS
 *
 * @example
 * const colors = resolveCssTokens(
 *   { healthy: "--map-m1-marker-healthy", warning: "--map-m1-marker-warning" },
 *   { healthy: "hsl(141, 60%, 42%)",      warning: "hsl(34, 92%, 44%)" }
 * );
 * // → { healthy: "hsl(141, 60%, 42%)", warning: "hsl(34, 92%, 44%)" }
 */
export function resolveCssTokens<K extends string>(
  tokens: Record<K, string>,
  fallbacks: Record<K, string>
): Record<K, string> {
  if (typeof window === "undefined") return { ...fallbacks };

  const style = getComputedStyle(document.documentElement);
  const result = {} as Record<K, string>;

  for (const key in tokens) {
    const prop = tokens[key];
    const val = style.getPropertyValue(prop).trim();
    result[key] = val || fallbacks[key];
  }

  return result;
}


// ─── Reactive token resolver ──────────────────────────────────────────────────

/**
 * Create a reactive CSS token resolver that calls `onChange` whenever the
 * theme changes (i.e. when the "theme-dark" class is added/removed on <html>).
 *
 * Used by Mapbox GL JS layer components to re-compute paint expressions when
 * the user toggles between light and dark themes.
 *
 * @param onChange - Callback fired whenever the theme class changes.
 *                   The callback receives the new CssTokenResolver.
 * @returns An object with:
 *   - `resolver`: Initial CssTokenResolver bound to the current theme.
 *   - `cleanup`:  Call this function to disconnect the MutationObserver
 *                 (do this in React's useEffect cleanup / component unmount).
 *
 * @example
 * useEffect(() => {
 *   const { resolver, cleanup } = makeReactiveTokenResolver((newResolver) => {
 *     // Re-apply Mapbox paint with updated colors
 *     applyPaintFromResolver(newResolver);
 *   });
 *   // Apply initial paint
 *   applyPaintFromResolver(resolver);
 *   return cleanup; // Disconnect observer on unmount
 * }, []);
 */
export function makeReactiveTokenResolver(
  onChange: (resolver: CssTokenResolver) => void
): { resolver: CssTokenResolver; cleanup: () => void } {
  const resolver = makeCssTokenResolver();

  if (typeof window === "undefined" || typeof MutationObserver === "undefined") {
    return { resolver, cleanup: () => {} };
  }

  const htmlEl = document.documentElement;
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "class"
      ) {
        onChange(makeCssTokenResolver());
        break;
      }
    }
  });

  observer.observe(htmlEl, { attributes: true, attributeFilter: ["class"] });

  return {
    resolver,
    cleanup: () => observer.disconnect(),
  };
}


// ─── Well-known token fallbacks ───────────────────────────────────────────────

/**
 * Light-theme fallback values for all map tokens.
 *
 * These mirror the hsl() values defined in src/styles/tokens/base.css §5
 * so that Mapbox components render correctly during SSR and initial paint
 * before CSS tokens are resolved.
 *
 * Rules:
 *   - Fallback values must match the :root (light theme) definitions in base.css.
 *   - No hex literals — all values use hsl().
 *   - This object is the ONLY place in the codebase where raw hsl() values
 *     for map colors appear in TypeScript.  All other code uses tokens.
 */
export const MAP_TOKEN_FALLBACKS = {
  // §5c M1 — Case Status Overview
  "m1-marker-healthy":       "hsl(141, 72%, 31%)",
  "m1-marker-warning":       "hsl(34, 92%, 44%)",
  "m1-marker-critical":      "hsl(0, 80%, 40%)",
  "m1-marker-inactive":      "hsl(210, 9%, 50%)",
  "m1-marker-transit":       "hsl(211, 85%, 52%)",
  "m1-cluster-fill":         "hsl(210, 12%, 27%)",

  // §5e M3 — Shipping / Route Tracking
  "m3-route-active":         "hsl(25, 90%, 50%)",
  "m3-route-completed":      "hsl(141, 60%, 42%)",
  "m3-route-pending":        "hsl(210, 10%, 66%)",
  "m3-route-exception":      "hsl(0, 74%, 50%)",
  "m3-origin-fill":          "hsl(211, 100%, 42%)",
  "m3-dest-fill":            "hsl(141, 72%, 31%)",
  "m3-waypoint-fill":        "hsl(25, 90%, 50%)",

  // §5f M4 — Deployment & Field Staging
  "m4-marker-assembly":      "hsl(248, 74%, 54%)",
  "m4-marker-staging":       "hsl(34, 92%, 44%)",
  "m4-marker-deployed":      "hsl(211, 85%, 52%)",
  "m4-marker-returning":     "hsl(84, 64%, 40%)",
  "m4-marker-retired":       "hsl(210, 9%, 50%)",

  // §7 Layer tokens
  "layer-deployed-bg":       "hsl(141, 72%, 31%)",
  "layer-transit-bg":        "hsl(211, 100%, 42%)",
  "layer-flagged-bg":        "hsl(25, 90%, 50%)",
  "layer-hangar-bg":         "hsl(248, 74%, 54%)",
  "layer-heat-bg":           "hsl(322, 70%, 52%)",
  "layer-history-bg":        "hsl(210, 9%, 50%)",
  "layer-turbines-bg":       "hsl(84, 64%, 40%)",
} as const;

/**
 * Type for the MAP_TOKEN_FALLBACKS key union.
 */
export type MapTokenFallbackKey = keyof typeof MAP_TOKEN_FALLBACKS;
