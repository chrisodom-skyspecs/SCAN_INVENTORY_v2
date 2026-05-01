/**
 * src/lib/marker-style-config.ts
 *
 * Marker style configuration — per-status and per-layer visual properties
 * for INVENTORY map pins, CSS-rendered pin dots, and Mapbox GL JS markers.
 *
 * Each `CaseStatus` has a distinct `MarkerStyleDef` that carries:
 *   • CSS custom property references (tokens, not hex literals) for color,
 *     background fill, border/stroke, and subtle tint.
 *   • A `shape` descriptor for the pin geometry (used for Mapbox symbol
 *     layers and CSS clip-path rendering).
 *   • An `icon` identifier that maps to the icon sprite/symbol name in the
 *     Mapbox GL JS sprite sheet or an inline SVG icon component key.
 *   • An `ariaLabel` for screen-reader announcements in pin tooltips.
 *
 * Relationship to the layer system
 * ─────────────────────────────────
 * The `LayerToggleKey` provides coarser (4-group) visual styling shared by
 * all statuses within a group.  `MarkerStyleDef` provides finer (8-status)
 * per-status styling.
 *
 * Priority in CSS rendering:
 *   per-status tokens  (highest — distinct shape / icon when needed)
 *   └─ per-layer tokens (used for fill color — the 4 group colors)
 *   └─ design-system signal tokens (fallback)
 *
 * Design rules
 * ─────────────
 * • All `colorToken` / `bgToken` / `borderToken` / `subtleToken` values
 *   reference CSS custom properties defined in src/styles/tokens/base.css.
 *   No hex literals appear in this module.
 * • Shapes are drawn from a fixed set: "circle" | "diamond" | "triangle" |
 *   "square" | "hexagon".  Each shape is visually distinct at small sizes
 *   (8px–16px) and suitable for colorblind-safe differentiation.
 * • Icons are named per a simple vocabulary: mapbox symbol name patterns
 *   used in the SCAN_INVENTORY sprite sheet (e.g. "circle-filled-sm").
 *
 * Usage
 * ─────
 * @example
 * // Look up marker style for a specific case status
 * import { getMarkerStyle } from "@/lib/marker-style-config";
 *
 * const style = getMarkerStyle("deployed");
 * // → { bgToken: "--layer-deployed-bg", shape: "circle", icon: "pin-deployed", ... }
 *
 * @example
 * // Look up marker style for a layer group (all statuses in that group)
 * import { getLayerMarkerStyle } from "@/lib/marker-style-config";
 *
 * const style = getLayerMarkerStyle("transit");
 * // → { bgToken: "--layer-transit-bg", shape: "diamond", icon: "pin-transit", ... }
 *
 * @example
 * // Obtain CSS variables object for inline style application
 * import { getMarkerStyle, markerStyleToCssVars } from "@/lib/marker-style-config";
 *
 * const style = getMarkerStyle("flagged");
 * const cssVars = markerStyleToCssVars(style);
 * // → { "--marker-bg": "var(--layer-flagged-bg)", "--marker-color": ..., ... }
 */

import type { CaseStatus } from "@/types/case-status";
import { CASE_STATUSES } from "@/types/case-status";
import type { LayerToggleKey } from "@/types/map";
import { LAYER_TOGGLE_KEYS } from "@/types/map";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Geometric shape of the map pin.
 *
 * Shapes provide a secondary visual differentiator beyond color,
 * ensuring pins remain distinguishable for users with color vision
 * deficiencies (WCAG 1.4.1 Use of Color).
 *
 *   circle   — default round pin (deployed, healthy, active)
 *   diamond  — rotated square (in transit, moving)
 *   triangle — upward-pointing triangle (flagged, attention needed)
 *   square   — solid square (hangar, stationary storage)
 *   hexagon  — six-sided (assembled/packed, ready to move)
 *   star     — five-pointed star (archived, notable/decommissioned)
 */
export type MarkerShape =
  | "circle"
  | "diamond"
  | "triangle"
  | "square"
  | "hexagon"
  | "star";

/**
 * Complete visual style definition for a single case status or layer group.
 *
 * All `*Token` fields are CSS custom property names (strings beginning with
 * `--`).  Never use raw color values here — always reference design tokens.
 */
export interface MarkerStyleDef {
  /**
   * The `CaseStatus` or `LayerToggleKey` this style applies to.
   * Included for debugging / introspection.
   */
  key: CaseStatus | LayerToggleKey;

  /**
   * CSS custom property name for the primary foreground/text/icon color.
   * Used for text on or adjacent to the pin.
   *
   * @example "--layer-deployed-color"
   */
  colorToken: string;

  /**
   * CSS custom property name for the background fill of the pin.
   * This is the dominant color visible on the map.
   *
   * @example "--layer-deployed-bg"
   */
  bgToken: string;

  /**
   * CSS custom property name for the pin border/stroke color.
   *
   * @example "--layer-deployed-border"
   */
  borderToken: string;

  /**
   * CSS custom property name for a low-opacity tint (hover fill, focus ring).
   *
   * @example "--layer-deployed-subtle"
   */
  subtleToken: string;

  /**
   * Geometric shape of the map pin.
   * Provides a non-color visual differentiator for accessibility.
   */
  shape: MarkerShape;

  /**
   * Mapbox GL JS symbol name / icon key used in the sprite sheet.
   * Also serves as the key for inline SVG icon lookups in React components.
   *
   * Convention: `"pin-{layerKey}"` for layer-level icons,
   *             `"pin-{status}"` for per-status icons (hyphen-separated).
   *
   * @example "pin-deployed", "pin-transit-out", "pin-flagged"
   */
  icon: string;

  /**
   * Human-readable ARIA label for map pin accessibility.
   * Used in `aria-label` on the pin element and in tooltip text.
   *
   * @example "Deployed case pin", "Case in outbound transit"
   */
  ariaLabel: string;

  /**
   * Numeric z-index priority for overlapping pins.
   * Higher-priority pins render on top when pins overlap at the same location.
   * Flagged cases always render on top (highest urgency).
   *
   * Scale:
   *   flagged (100) > deployed (80) > transit (60) > hangar (40)
   *
   * Within a group, sub-statuses have the same priority as the group.
   */
  zPriority: number;
}

// ─── Per-status style table ───────────────────────────────────────────────────

/**
 * Complete per-status marker style map.
 *
 * Each of the 8 `CaseStatus` values has a distinct `MarkerStyleDef` that
 * carries layer-aware color tokens plus a unique shape and icon so that pins
 * are visually distinguishable both by color and geometry.
 *
 * Color tokens come from §7 "SEMANTIC LAYER TOKENS" in src/styles/tokens/base.css.
 * Status-specific shape assignments follow visual logic:
 *
 *   hangar      → square     (stationary / stored; box = case in box)
 *   assembled   → hexagon    (packed and ready; faceted = complex packing)
 *   transit_out → diamond    (in motion outbound; rotated = directional)
 *   deployed    → circle     (active field use; round = full deployment)
 *   flagged     → triangle   (attention needed; warning shape)
 *   transit_in  → diamond    (in motion inbound; same as transit_out)
 *   received    → square     (back in storage; returned to base)
 *   archived    → star       (decommissioned; notable / end-of-life)
 *
 * Accessibility: shape + color together satisfy WCAG 1.4.1 (Use of Color)
 * since two independent visual cues differentiate each status.
 */
export const STATUS_MARKER_STYLES: Readonly<Record<CaseStatus, MarkerStyleDef>> = {
  hangar: {
    key:         "hangar",
    colorToken:  "--layer-hangar-color",
    bgToken:     "--layer-hangar-bg",
    borderToken: "--layer-hangar-border",
    subtleToken: "--layer-hangar-subtle",
    shape:       "square",
    icon:        "pin-hangar",
    ariaLabel:   "Case in hangar storage",
    zPriority:   40,
  },

  assembled: {
    key:         "assembled",
    colorToken:  "--layer-hangar-color",
    bgToken:     "--layer-hangar-bg",
    borderToken: "--layer-hangar-border",
    subtleToken: "--layer-hangar-subtle",
    shape:       "hexagon",
    icon:        "pin-assembled",
    ariaLabel:   "Case assembled and ready to deploy",
    zPriority:   45,
  },

  transit_out: {
    key:         "transit_out",
    colorToken:  "--layer-transit-color",
    bgToken:     "--layer-transit-bg",
    borderToken: "--layer-transit-border",
    subtleToken: "--layer-transit-subtle",
    shape:       "diamond",
    icon:        "pin-transit-out",
    ariaLabel:   "Case in outbound transit",
    zPriority:   60,
  },

  deployed: {
    key:         "deployed",
    colorToken:  "--layer-deployed-color",
    bgToken:     "--layer-deployed-bg",
    borderToken: "--layer-deployed-border",
    subtleToken: "--layer-deployed-subtle",
    shape:       "circle",
    icon:        "pin-deployed",
    ariaLabel:   "Case deployed at field site",
    zPriority:   80,
  },

  flagged: {
    key:         "flagged",
    colorToken:  "--layer-flagged-color",
    bgToken:     "--layer-flagged-bg",
    borderToken: "--layer-flagged-border",
    subtleToken: "--layer-flagged-subtle",
    shape:       "triangle",
    icon:        "pin-flagged",
    ariaLabel:   "Case flagged — outstanding issues",
    zPriority:   100,
  },

  recalled: {
    key:         "recalled",
    colorToken:  "--layer-flagged-color",
    bgToken:     "--layer-flagged-bg",
    borderToken: "--layer-flagged-border",
    subtleToken: "--layer-flagged-subtle",
    shape:       "triangle",
    icon:        "pin-recalled",
    ariaLabel:   "Case recalled to hangar",
    zPriority:   100,
  },

  transit_in: {
    key:         "transit_in",
    colorToken:  "--layer-transit-color",
    bgToken:     "--layer-transit-bg",
    borderToken: "--layer-transit-border",
    subtleToken: "--layer-transit-subtle",
    shape:       "diamond",
    icon:        "pin-transit-in",
    ariaLabel:   "Case in inbound transit",
    zPriority:   60,
  },

  received: {
    key:         "received",
    colorToken:  "--layer-hangar-color",
    bgToken:     "--layer-hangar-bg",
    borderToken: "--layer-hangar-border",
    subtleToken: "--layer-hangar-subtle",
    shape:       "square",
    icon:        "pin-received",
    ariaLabel:   "Case received at base",
    zPriority:   40,
  },

  archived: {
    key:         "archived",
    colorToken:  "--layer-history-color",
    bgToken:     "--layer-history-bg",
    borderToken: "--layer-history-border",
    subtleToken: "--layer-history-subtle",
    shape:       "star",
    icon:        "pin-archived",
    ariaLabel:   "Case archived — decommissioned",
    zPriority:   20,
  },
} as const;

// ─── Per-layer style table ────────────────────────────────────────────────────

/**
 * Coarser per-layer (group-level) marker styles.
 *
 * Each of the 4 `LayerToggleKey` groups gets a representative `MarkerStyleDef`
 * used when per-status precision is not needed — for example, in the
 * LayerTogglePanel legend swatches, cluster bubble fills, and the map legend.
 *
 * Shapes are assigned to match the "primary" status in each group:
 *   deployed → circle  (deployed status shape)
 *   transit  → diamond (transit_out/transit_in shape)
 *   flagged  → triangle (flagged status shape)
 *   hangar   → square  (hangar status shape; the "default" storage state)
 */
export const LAYER_MARKER_STYLES: Readonly<Record<LayerToggleKey, MarkerStyleDef>> = {
  deployed: {
    key:         "deployed",
    colorToken:  "--layer-deployed-color",
    bgToken:     "--layer-deployed-bg",
    borderToken: "--layer-deployed-border",
    subtleToken: "--layer-deployed-subtle",
    shape:       "circle",
    icon:        "pin-deployed",
    ariaLabel:   "Deployed cases layer",
    zPriority:   80,
  },

  transit: {
    key:         "transit",
    colorToken:  "--layer-transit-color",
    bgToken:     "--layer-transit-bg",
    borderToken: "--layer-transit-border",
    subtleToken: "--layer-transit-subtle",
    shape:       "diamond",
    icon:        "pin-transit",
    ariaLabel:   "Cases in transit layer",
    zPriority:   60,
  },

  flagged: {
    key:         "flagged",
    colorToken:  "--layer-flagged-color",
    bgToken:     "--layer-flagged-bg",
    borderToken: "--layer-flagged-border",
    subtleToken: "--layer-flagged-subtle",
    shape:       "triangle",
    icon:        "pin-flagged",
    ariaLabel:   "Flagged cases layer",
    zPriority:   100,
  },

  hangar: {
    key:         "hangar",
    colorToken:  "--layer-hangar-color",
    bgToken:     "--layer-hangar-bg",
    borderToken: "--layer-hangar-border",
    subtleToken: "--layer-hangar-subtle",
    shape:       "square",
    icon:        "pin-hangar",
    ariaLabel:   "Hangar cases layer",
    zPriority:   40,
  },
} as const;

// ─── Lookup functions ─────────────────────────────────────────────────────────

/**
 * Return the `MarkerStyleDef` for the given `CaseStatus`.
 *
 * Throws for unknown status values (programming error — callers should guard
 * with `isCaseStatus` when the value comes from untrusted input).
 *
 * @param status - A valid `CaseStatus` value.
 * @returns The full `MarkerStyleDef` for that status.
 *
 * @example
 * const style = getMarkerStyle("deployed");
 * // → { bgToken: "--layer-deployed-bg", shape: "circle", icon: "pin-deployed", ... }
 */
export function getMarkerStyle(status: CaseStatus): MarkerStyleDef {
  const def = STATUS_MARKER_STYLES[status];
  if (!def) {
    throw new Error(
      `[MarkerStyleConfig] Unknown CaseStatus "${status}". ` +
        `Valid statuses: ${CASE_STATUSES.join(", ")}.`
    );
  }
  return def;
}

/**
 * Return the `MarkerStyleDef` for the given `LayerToggleKey` group.
 *
 * Throws for unknown layer keys (programming error).
 *
 * @param layerKey - A valid `LayerToggleKey`.
 * @returns The representative `MarkerStyleDef` for that layer group.
 *
 * @example
 * const style = getLayerMarkerStyle("transit");
 * // → { bgToken: "--layer-transit-bg", shape: "diamond", icon: "pin-transit", ... }
 */
export function getLayerMarkerStyle(layerKey: LayerToggleKey): MarkerStyleDef {
  const def = LAYER_MARKER_STYLES[layerKey];
  if (!def) {
    throw new Error(
      `[MarkerStyleConfig] Unknown LayerToggleKey "${layerKey}". ` +
        `Valid keys: ${LAYER_TOGGLE_KEYS.join(", ")}.`
    );
  }
  return def;
}

/**
 * Convert a `MarkerStyleDef` into a CSS custom-property object suitable for
 * use as a React `style` prop or passed to Mapbox GL JS `setLayoutProperty`.
 *
 * The returned object uses `--marker-*` local tokens that component CSS can
 * consume without knowing the specific status/layer.  This decouples the
 * component from the global token names.
 *
 * @example
 * const style = getMarkerStyle("flagged");
 * const cssVars = markerStyleToCssVars(style);
 * // → {
 * //     "--marker-color":   "var(--layer-flagged-color)",
 * //     "--marker-bg":      "var(--layer-flagged-bg)",
 * //     "--marker-border":  "var(--layer-flagged-border)",
 * //     "--marker-subtle":  "var(--layer-flagged-subtle)",
 * //   }
 *
 * // In JSX:
 * <div className={styles.pin} style={cssVars} data-shape="triangle" />
 */
export function markerStyleToCssVars(
  def: MarkerStyleDef
): Record<string, string> {
  return {
    "--marker-color":  `var(${def.colorToken})`,
    "--marker-bg":     `var(${def.bgToken})`,
    "--marker-border": `var(${def.borderToken})`,
    "--marker-subtle": `var(${def.subtleToken})`,
  };
}

// ─── Filtering integration helpers ───────────────────────────────────────────

/**
 * Filter a marker style array to only those whose `LayerToggleKey` is active
 * in the provided `toggles` record.
 *
 * This is the bridge between the pure filtering logic in `case-status-filter.ts`
 * and the marker rendering layer.  It accepts an array of objects that have
 * both a `status` field and a `layerKey` field (i.e., `FilteredCasePin` from
 * `use-filtered-case-pins.ts`), and returns only the objects whose layer is
 * currently active.
 *
 * Generic over `T` so this works with any shape that carries `layerKey`.
 *
 * @example
 * // In a map component:
 * const { pins, layerToggles } = useFilteredCasePins();
 * const styledPins = pins.map(pin => ({
 *   ...pin,
 *   markerStyle: getMarkerStyle(pin.status),
 * }));
 */
export type PinWithLayerKey = {
  layerKey: LayerToggleKey | null;
};

/**
 * A `CaseStatus` enriched with its full `MarkerStyleDef` for rendering.
 *
 * Produced by `enrichWithMarkerStyle` — callers can destructure either
 * the `markerStyle` object or individual `markerStyleToken` properties.
 */
export interface MarkerStyledRecord {
  /** The status this record's marker style is derived from. */
  status: CaseStatus;
  /** The derived `LayerToggleKey` (may be null for unknown statuses). */
  layerKey: LayerToggleKey | null;
  /** Full marker style definition including tokens, shape, icon. */
  markerStyle: MarkerStyleDef;
  /** CSS vars object for inline `style` prop (--marker-*). */
  cssVars: Record<string, string>;
}

/**
 * Enrich a `{ status, layerKey }` record with its full `MarkerStyleDef`.
 *
 * @param status  - The case lifecycle status.
 * @param layerKey - The derived LayerToggleKey (from `getToggleKeyForStatus`).
 * @returns A `MarkerStyledRecord` with `markerStyle` and `cssVars` populated.
 *
 * @example
 * const record = enrichWithMarkerStyle("deployed", "deployed");
 * // → { status: "deployed", layerKey: "deployed", markerStyle: {...}, cssVars: {...} }
 */
export function enrichWithMarkerStyle(
  status: CaseStatus,
  layerKey: LayerToggleKey | null
): MarkerStyledRecord {
  const markerStyle = STATUS_MARKER_STYLES[status] ?? LAYER_MARKER_STYLES[layerKey ?? "hangar"];
  return {
    status,
    layerKey,
    markerStyle,
    cssVars: markerStyleToCssVars(markerStyle),
  };
}

// ─── Shape lookup (for Mapbox paint expressions) ───────────────────────────────

/**
 * Returns the marker shape for a given `CaseStatus`.
 *
 * Convenience wrapper around `getMarkerStyle` for callers that only need the
 * shape (e.g., Mapbox GL JS `circle-radius` / `icon-image` expressions).
 *
 * @example
 * const shape = getMarkerShape("flagged"); // → "triangle"
 */
export function getMarkerShape(status: CaseStatus): MarkerShape {
  return STATUS_MARKER_STYLES[status]?.shape ?? "circle";
}

/**
 * Returns the icon identifier for a given `CaseStatus`.
 *
 * Used in Mapbox GL JS `icon-image` paint expressions and React SVG icon
 * component key lookups.
 *
 * @example
 * const icon = getMarkerIcon("transit_out"); // → "pin-transit-out"
 */
export function getMarkerIcon(status: CaseStatus): string {
  return STATUS_MARKER_STYLES[status]?.icon ?? "pin-default";
}

/**
 * Returns the z-priority for a given `CaseStatus`.
 *
 * Used to sort overlapping pins on the map so higher-priority statuses
 * (flagged) render on top of lower-priority ones (archived).
 *
 * @example
 * const z = getMarkerZPriority("flagged"); // → 100
 * const z = getMarkerZPriority("archived"); // → 20
 */
export function getMarkerZPriority(status: CaseStatus): number {
  return STATUS_MARKER_STYLES[status]?.zPriority ?? 40;
}

// ─── Mapbox paint expression helper ──────────────────────────────────────────

/**
 * Build a Mapbox GL JS `match` expression for a given style property,
 * mapping each `CaseStatus` to its corresponding token value.
 *
 * Returns a Mapbox expression array of the form:
 *   ["match", ["get", "status"], "hangar", VALUE, "assembled", VALUE, ..., DEFAULT]
 *
 * Since Mapbox GL JS paint expressions operate on raw hex/color values rather
 * than CSS custom properties, callers must pass a `resolveToken` function that
 * converts a CSS custom property name to a resolved hex/rgb value.
 *
 * @param property  - Which style property to build for ("bgToken" | "borderToken").
 * @param resolveToken - Function that resolves a CSS token to a paint-safe value.
 * @param fallback  - Fallback value for unknown statuses.
 * @returns A Mapbox GL JS expression array.
 *
 * @example
 * // In a Mapbox GL JS layer setup:
 * const resolver = (token: string) => getComputedStyle(doc.documentElement)
 *   .getPropertyValue(token.slice(2)).trim();
 *
 * const fillExpr = buildMapboxStatusExpression("bgToken", resolver, "#666");
 * map.setPaintProperty("case-pins", "circle-color", fillExpr);
 */
export function buildMapboxStatusExpression(
  property: keyof Pick<MarkerStyleDef, "bgToken" | "borderToken" | "colorToken">,
  resolveToken: (token: string) => string,
  fallback: string
): unknown[] {
  const expr: unknown[] = ["match", ["get", "status"]];
  for (const status of CASE_STATUSES) {
    const def = STATUS_MARKER_STYLES[status];
    expr.push(status, resolveToken(def[property]));
  }
  expr.push(fallback); // final fallback for unknown statuses
  return expr;
}
