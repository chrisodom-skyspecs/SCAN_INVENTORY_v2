/**
 * heat-layer-colors.ts
 *
 * Color ramp constants for the INVENTORY map heat layer (density overlay).
 *
 * These values mirror the --map-m2-heat-* CSS custom properties defined in
 * §5d of src/styles/tokens/base.css.  They are expressed as HSL/HSLA strings
 * (never hex) so the constraint "no hex literals in component code" is
 * satisfied while remaining compatible with Mapbox GL JS's expression parser.
 *
 * Palette source
 * ──────────────
 * Each stop references the same private raw-palette tokens used in base.css:
 *   stop 0   transparent              → zero-density (no overlay)
 *   stop 1   --_map-ind-400 @ 0.55   → very low — indigo
 *   stop 2   --_b-400       @ 0.65   → low — brand blue
 *   stop 3   --_i-400       @ 0.70   → medium-low — teal
 *   stop 4   --_g-400       @ 0.72   → medium — green
 *   stop 5   --_map-lim-400 @ 0.75   → medium-high — lime
 *   stop 6   --_a-300       @ 0.80   → high — amber
 *   stop 7   --_map-org-400 @ 0.85   → very high — orange
 *   stop 8   --_r-400       @ 0.90   → peak — red
 *
 * Colorblind-safety: viridis-inspired sequential ramp (indigo→red).
 * Varying both hue and lightness provides distinct perception even for
 * deuteranopia / protanopia viewers (unlike red/green-only ramps).
 *
 * Usage (Mapbox GL JS heatmap-color expression)
 * ─────────────────────────────────────────────
 * @example
 * import { buildHeatColorExpression } from "@/lib/heat-layer-colors";
 *
 * const paint = {
 *   "heatmap-color": buildHeatColorExpression(),
 * };
 */

// ─── Heat stop ────────────────────────────────────────────────────────────────

/**
 * A single density stop: `[density, color]` where
 *   density ∈ [0, 1] maps to `heatmap-density`
 *   color   is an HSLA string (no hex; readable by Mapbox GL JS)
 */
export type HeatStop = [density: number, color: string];

// ─── Color ramp ───────────────────────────────────────────────────────────────

/**
 * Ordered density color stops for the heatmap layer.
 *
 * Density 0   → transparent (no overlay visible)
 * Density 1   → deep red    (maximum concentration)
 *
 * The 9 stops produce a smooth viridis-style gradient that is:
 *   • Colorblind-safe (varies both hue and lightness)
 *   • WCAG AA compliant at each opaque stop against a light or dark map base
 *   • Consistent with the §5d M2 heat palette tokens in base.css
 */
export const HEAT_COLOR_RAMP: readonly HeatStop[] = [
  [0,     "hsla(0, 0%, 0%, 0)"],         // transparent — --map-m2-heat-0
  [0.125, "hsla(248, 74%, 54%, 0.55)"],  // indigo      — --map-m2-heat-1  (--_map-ind-400)
  [0.25,  "hsla(211, 85%, 52%, 0.65)"],  // brand blue  — --map-m2-heat-2  (--_b-400)
  [0.375, "hsla(196, 80%, 44%, 0.70)"],  // teal        — --map-m2-heat-3  (--_i-400)
  [0.5,   "hsla(141, 60%, 42%, 0.72)"],  // green       — --map-m2-heat-4  (--_g-400)
  [0.625, "hsla(84, 64%, 40%, 0.75)"],   // lime        — --map-m2-heat-5  (--_map-lim-400)
  [0.75,  "hsla(45, 92%, 44%, 0.80)"],   // amber       — --map-m2-heat-6  (--_a-300)
  [0.875, "hsla(25, 90%, 50%, 0.85)"],   // orange      — --map-m2-heat-7  (--_map-org-400)
  [1.0,   "hsla(0, 74%, 50%, 0.90)"],    // red         — --map-m2-heat-8  (--_r-400)
] as const;

/**
 * Legend swatch colors (fully opaque, for legend/tooltip display).
 *
 * Mirrors the --map-m2-swatch-* CSS tokens in base.css §5d.
 * Only swatches 1–8 are returned (stop 0 is transparent, no legend entry).
 */
export const HEAT_SWATCH_COLORS: readonly string[] = [
  "hsl(248, 74%, 54%)",   // --map-m2-swatch-1 indigo
  "hsl(211, 85%, 52%)",   // --map-m2-swatch-2 brand blue
  "hsl(196, 80%, 44%)",   // --map-m2-swatch-3 teal
  "hsl(141, 60%, 42%)",   // --map-m2-swatch-4 green
  "hsl(84, 64%, 40%)",    // --map-m2-swatch-5 lime
  "hsl(45, 92%, 44%)",    // --map-m2-swatch-6 amber
  "hsl(25, 90%, 50%)",    // --map-m2-swatch-7 orange
  "hsl(0, 74%, 50%)",     // --map-m2-swatch-8 red
] as const;

// ─── Mapbox expression builder ─────────────────────────────────────────────────

/**
 * Build a Mapbox GL JS `heatmap-color` expression from the HEAT_COLOR_RAMP.
 *
 * Returns an `["interpolate", ["linear"], ["heatmap-density"], …stops]`
 * expression array compatible with Mapbox GL JS v2/v3 paint properties.
 *
 * The expression is pure: it has no side effects and produces a new array
 * on every call (safe to spread directly into a Mapbox GL layer paint spec).
 *
 * @example
 * const paint = {
 *   "heatmap-color": buildHeatColorExpression(),
 *   "heatmap-radius": 30,
 *   "heatmap-intensity": 1,
 *   "heatmap-opacity": 0.85,
 * };
 */
export function buildHeatColorExpression(): unknown[] {
  const stops: unknown[] = [];

  for (const [density, color] of HEAT_COLOR_RAMP) {
    stops.push(density, color);
  }

  return ["interpolate", ["linear"], ["heatmap-density"], ...stops];
}

/**
 * Build a Mapbox GL JS `heatmap-weight` expression that amplifies
 * flagged cases (status === "flagged") by a configurable multiplier.
 *
 * By default flagged cases have weight 3 (three times the density
 * contribution of a normal case), making damage hotspots immediately
 * visible on the heat overlay even in sparse regions.
 *
 * Requires the GeoJSON source to include a `weight` property on each
 * feature (produced by `buildHeatGeoJSON` below).
 *
 * @param maxWeight - Maximum weight value in the source data.
 *   Used as the upper bound of the `["get", "weight"]` interpolation.
 *   Defaults to 3 (matching flagged-case amplification).
 */
export function buildHeatWeightExpression(maxWeight: number = 3): unknown[] {
  return [
    "interpolate",
    ["linear"],
    ["get", "weight"],
    0, 0,
    1, 0.33,
    maxWeight, 1,
  ];
}

// ─── GeoJSON builder ──────────────────────────────────────────────────────────

/**
 * A single GeoJSON point feature for the heat layer.
 * `weight` encodes the density contribution of this case (1 = normal, 3 = flagged).
 */
export interface HeatFeature {
  type: "Feature";
  properties: { weight: number; caseId: string };
  geometry: { type: "Point"; coordinates: [longitude: number, latitude: number] };
}

/**
 * A GeoJSON FeatureCollection ready for use as a Mapbox GL JS source.
 */
export interface HeatGeoJSON {
  type: "FeatureCollection";
  features: HeatFeature[];
}

/**
 * Case-like object that `buildHeatGeoJSON` accepts.
 * Only the fields required to build the heatmap feature are needed.
 */
export interface HeatCasePin {
  caseId: string;
  status: string;
  lat: number | undefined;
  lng: number | undefined;
}

/**
 * Convert an array of case pins into a GeoJSON FeatureCollection for the
 * Mapbox GL JS heatmap source.
 *
 * Only pins with valid lat/lng are included.  Flagged cases receive
 * `weight: 3` to amplify their visual footprint on the density overlay.
 * All other cases receive `weight: 1`.
 *
 * @param pins - Array of case pin objects (must have caseId, status, lat, lng).
 * @returns GeoJSON FeatureCollection suitable for `<Source type="geojson" />`.
 */
export function buildHeatGeoJSON(pins: HeatCasePin[]): HeatGeoJSON {
  const features: HeatFeature[] = [];

  for (const pin of pins) {
    if (pin.lat === undefined || pin.lng === undefined) continue;

    features.push({
      type: "Feature",
      properties: {
        weight: pin.status === "flagged" ? 3 : 1,
        caseId: pin.caseId,
      },
      geometry: {
        type: "Point",
        coordinates: [pin.lng, pin.lat],
      },
    });
  }

  return { type: "FeatureCollection", features };
}
