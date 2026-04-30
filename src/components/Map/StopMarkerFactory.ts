/**
 * StopMarkerFactory — Custom marker icon factory for the M2 map layer.
 *
 * Provides imperative (non-React) functions for creating numbered stop-pin
 * icons suitable for:
 *   1. SVG strings — embeddable data URIs for `<img>` elements or inline SVG.
 *   2. HTMLElement creation — for use with native `mapboxgl.Marker(element)` or
 *      react-map-gl's `<Marker>` without the full React component tree.
 *   3. Mapbox GL image registration — `addStopMarkerImage` adds a numbered icon
 *      to the Mapbox GL map's image sprite so symbol layers can reference it via
 *      `icon-image: "stop-marker-<N>-<variant>"`.
 *
 * This factory is the imperative companion to the `StopMarker` React component.
 * Both produce visually identical numbered circle badges; choose based on context:
 *
 *   React tree (react-map-gl <Map>):  → use `<StopMarker>` component
 *   Non-React / Mapbox GL native:     → use `createStopMarkerElement()`
 *   Mapbox GL symbol layer icon:      → use `addStopMarkerImage()`
 *   Unit tests / SVG generation:      → use `createStopMarkerSVG()`
 *
 * Visual design
 * ─────────────
 * Matches `StopMarker.module.css` and the INVENTORY design spec:
 *
 *   First stop  (variant: "first")        → green  (--layer-deployed-bg)
 *   Last stop   (variant: "last")         → blue   (--layer-transit-bg)
 *   Intermediate (variant: "intermediate") → gray   (--layer-history-bg)
 *   Selected     (variant: "selected")    → blue ring + scale-up
 *
 * Color constants are HSLA values matching the CSS token definitions in
 * base.css §7 — the same HSLA strings used in `JourneyStopLayer.tsx` paint
 * specs and `JourneyPathLine.tsx`.  No hex literals.
 *
 * Typography
 * ──────────
 * IBM Plex Mono is specified for the numeric badge (data/tabular typography spec).
 * The SVG font-family declaration includes the standard monospace fallback stack.
 *
 * Accessibility
 * ─────────────
 * `createStopMarkerElement()` sets `role="img"` and `aria-label="Stop N"` on the
 * returned element so screen readers can announce stop position.
 *
 * Dark theme
 * ──────────
 * Token colors here reflect the **light theme** HSLA values.  For dark theme
 * support in DOM element mode, callers should apply the `.theme-dark` class to
 * the root element and re-derive colors, or use `createStopMarkerElement` with
 * `darkTheme: true` (which uses the dark-mode token HSLA values).
 *
 * @module StopMarkerFactory
 */

// ─── Color constants (matching CSS tokens) ────────────────────────────────────
//
// Values from base.css §7:
//   --layer-deployed-bg: var(--_g-500) → hsl(142, 54%, 48%)
//   --layer-transit-bg:  var(--_b-500) → hsl(211, 85%, 52%)
//   --layer-history-bg:  var(--_n-500) → hsl(210, 9%,  50%)
//
// Dark theme values (for `darkTheme: true` option):
//   --layer-deployed-bg (dark): hsl(142, 45%, 40%)
//   --layer-transit-bg  (dark): hsl(211, 75%, 60%)
//   --layer-history-bg  (dark): hsl(210, 8%,  55%)
//
// White halo ring: rgba(255,255,255,0.9) — provides contrast on any map tile.
// In dark mode: rgba(0,0,0,0.5) — semi-transparent overlay (per StopMarker.module.css).

const TOKEN_COLORS = {
  light: {
    first:        "hsl(142, 54%, 48%)",   // --layer-deployed-bg
    last:         "hsl(211, 85%, 52%)",   // --layer-transit-bg
    intermediate: "hsl(210, 9%, 50%)",    // --layer-history-bg
    selected:     "hsl(211, 85%, 52%)",   // same blue as last
  },
  dark: {
    first:        "hsl(142, 45%, 40%)",   // --layer-deployed-bg (dark)
    last:         "hsl(211, 75%, 60%)",   // --layer-transit-bg  (dark)
    intermediate: "hsl(210, 8%, 55%)",    // --layer-history-bg  (dark)
    selected:     "hsl(211, 75%, 60%)",   // same blue as last (dark)
  },
} as const;

/** White halo ring around the badge for contrast on map tiles (light theme). */
const HALO_LIGHT = "rgba(255, 255, 255, 0.9)";
/** Semi-transparent halo ring for dark theme (per StopMarker.module.css comment). */
const HALO_DARK  = "rgba(30, 35, 40, 0.8)";
/** Text color — white for contrast on all badge backgrounds. */
const TEXT_COLOR = "rgba(255, 255, 255, 1)";

// ─── Default sizes ────────────────────────────────────────────────────────────
//
// Matches StopMarker.module.css badge sizes:
//   .badge          → 1.5rem  = 24px (intermediate)
//   .badgeFirst     → 1.625rem = 26px (origin — slightly larger)
//   .badgeLast      → 1.625rem = 26px (latest stop — slightly larger)
//   .badgeSelected  → same as variant size + scale transform (we bake in 28px)

const DEFAULT_SIZE: Record<StopMarkerVariant, number> = {
  first:        26,
  last:         26,
  intermediate: 24,
  selected:     28,
};

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The visual variant of a stop marker badge.
 *
 * Matches the CSS modifier classes in `StopMarker.module.css`:
 *   "first"        → .badgeFirst        — green  (origin, --layer-deployed-bg)
 *   "last"         → .badgeLast         — blue   (latest stop, --layer-transit-bg)
 *   "intermediate" → .badgeIntermediate — gray   (middle stop, --layer-history-bg)
 *   "selected"     → .badgeSelected     — blue ring + scale (selected stop)
 *
 * When a stop is both first AND last (single-stop journey), use `"first"` —
 * matching the StopMarker component's priority rule (`isFirst` overrides `isLast`).
 */
export type StopMarkerVariant = "first" | "last" | "intermediate" | "selected";

/**
 * Options for controlling the generated stop marker icon appearance and output.
 */
export interface StopMarkerIconOptions {
  /**
   * Physical pixel size of the badge (diameter in px).
   *
   * Defaults to variant-specific sizes matching the CSS module:
   *   "first" / "last" / "selected" → 26–28px
   *   "intermediate"                → 24px
   *
   * For Mapbox GL `addStopMarkerImage`, use the logical size (not HiDPI size);
   * the `devicePixelRatio` option controls HiDPI rendering separately.
   */
  size?: number;

  /**
   * Device pixel ratio for HiDPI rendering.
   *
   * Used only in `addStopMarkerImage` — the `pixelRatio` passed to
   * `map.addImage()` so Mapbox GL renders the icon at native resolution on
   * Retina displays.
   *
   * @default 2
   */
  devicePixelRatio?: number;

  /**
   * When true, uses dark-theme color values for the badge background.
   * Token HSLA values from `--layer-*-bg` dark theme overrides.
   *
   * Only applies to `createStopMarkerElement()` — SVG strings and Mapbox GL
   * images are typically rendered in a light context (map tile background).
   *
   * @default false
   */
  darkTheme?: boolean;

  /**
   * When true, renders the selection pulse ring around the badge.
   *
   * In SVG mode, this renders as a semi-transparent outer circle.
   * In element mode, a separate ring `<div>` is inserted behind the badge.
   *
   * @default false
   */
  showSelectionRing?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Truncate a stop index to at most 3 characters for display inside the badge.
 * Handles large stop counts gracefully (e.g. stopIndex=1000 → "100").
 */
function badgeLabel(stopIndex: number): string {
  return String(stopIndex).slice(0, 3);
}

/**
 * Derive the font size for a badge of the given diameter.
 * Scales proportionally so text fits inside the circle at all supported sizes.
 *
 * At 24px badge: 10px font  (matches `.badge` font-size: 0.625rem = 10px)
 * At 26px badge: 11px font  (matches `.badgeFirst/.badgeLast` 0.6875rem ≈ 11px)
 * At 28px badge: 12px font  (selected / slightly larger)
 */
function deriveFontSize(badgeSize: number): number {
  return Math.max(7, Math.round(badgeSize * 0.41));
}

/**
 * Resolve the fill color for a given variant and theme.
 */
function resolveColor(
  variant: StopMarkerVariant,
  darkTheme: boolean
): string {
  const theme = darkTheme ? "dark" : "light";
  return TOKEN_COLORS[theme][variant];
}

// ─── createStopMarkerSVG ──────────────────────────────────────────────────────

/**
 * Build a raw SVG string for a numbered stop marker badge.
 *
 * The SVG represents a circular numbered badge matching the `StopMarker`
 * component's visual design — solid colored circle, white halo ring,
 * white IBM Plex Mono number centered inside.
 *
 * Use cases:
 *   - Convert to a data URI: `"data:image/svg+xml," + encodeURIComponent(svg)`
 *   - Embed as inline SVG in HTML
 *   - Pass to `addStopMarkerImage()` via an HTMLImageElement
 *   - Snapshot testing (pure string, no DOM required)
 *
 * @param stopIndex  1-based sequence number to display in the badge.
 * @param variant    Visual variant ("first" | "last" | "intermediate" | "selected").
 * @param options    Size, DPR, and theme overrides.
 * @returns          A complete SVG XML string, UTF-8 encoded.
 *
 * @example
 * const svg = createStopMarkerSVG(3, "first");
 * const dataUri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
 * img.src = dataUri;
 */
export function createStopMarkerSVG(
  stopIndex: number,
  variant: StopMarkerVariant = "intermediate",
  options: StopMarkerIconOptions = {}
): string {
  const size     = options.size ?? DEFAULT_SIZE[variant];
  const dark     = options.darkTheme ?? false;
  const fill     = resolveColor(variant, dark);
  const halo     = dark ? HALO_DARK : HALO_LIGHT;
  const label    = badgeLabel(stopIndex);
  const fontSize = deriveFontSize(size);
  const cx = size / 2;
  const cy = size / 2;
  const haloR  = cx;                     // outer halo = full radius
  const badgeR = cx - 1.5;              // badge = slightly inset for halo ring visibility
  const showRing = options.showSelectionRing ?? variant === "selected";

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Stop ${stopIndex}">`,
  ];

  // ── Selection ring (optional) ───────────────────────────────────────────────
  // Rendered as a larger semi-transparent outer circle behind the badge.
  // Matches `.selectionRing` in StopMarker.module.css.
  if (showRing) {
    const ringR = cx + 4; // slightly larger than badge
    const ringSize = size + 8;
    // Extend viewBox to accommodate the ring (centered on same cx/cy)
    parts[0] = `<svg xmlns="http://www.w3.org/2000/svg" width="${ringSize}" height="${ringSize}" viewBox="-4 -4 ${ringSize} ${ringSize}" role="img" aria-label="Stop ${stopIndex}">`;
    parts.push(
      `  <circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none" stroke="${fill}" stroke-width="1.5" opacity="0.5"/>`
    );
  }

  // ── White halo ring ─────────────────────────────────────────────────────────
  parts.push(
    `  <circle cx="${cx}" cy="${cy}" r="${haloR}" fill="${halo}"/>`
  );

  // ── Badge fill circle ───────────────────────────────────────────────────────
  parts.push(
    `  <circle cx="${cx}" cy="${cy}" r="${badgeR}" fill="${fill}"/>`
  );

  // ── Stop index number ───────────────────────────────────────────────────────
  // `dominant-baseline="central"` + `text-anchor="middle"` visually centers
  // the text inside the circle across all SVG renderers.
  parts.push(
    `  <text`,
    `    x="${cx}"`,
    `    y="${cy}"`,
    `    text-anchor="middle"`,
    `    dominant-baseline="central"`,
    `    font-family="IBM Plex Mono, monospace"`,
    `    font-size="${fontSize}"`,
    `    font-weight="700"`,
    `    fill="${TEXT_COLOR}"`,
    `    letter-spacing="-0.5"`,
    `    aria-hidden="true"`,
    `  >${label}</text>`
  );

  parts.push(`</svg>`);

  return parts.join("\n");
}

// ─── createStopMarkerElement ──────────────────────────────────────────────────

/**
 * Create an HTMLElement representing a numbered stop marker badge.
 *
 * The returned element is a `<div>` styled to match `StopMarker.module.css`,
 * suitable for use as:
 *   - A native `mapboxgl.Marker` element:
 *     ```ts
 *     new mapboxgl.Marker(createStopMarkerElement(3, "first")).setLngLat([lng, lat]).addTo(map);
 *     ```
 *   - A custom marker in non-React code that manages DOM markers directly.
 *
 * Accessibility: the root element has `role="img"` and `aria-label="Stop N"`.
 * For interactive markers, callers should add a click handler and `tabIndex=0`.
 *
 * Note: This function requires a DOM environment (`document.createElement`).
 * In SSR/Node.js contexts, use `createStopMarkerSVG()` instead.
 *
 * @param stopIndex  1-based sequence number to display in the badge.
 * @param variant    Visual variant.
 * @param options    Size, theme, and ring options.
 * @returns          An HTMLDivElement styled as the stop marker badge.
 *
 * @example
 * const el = createStopMarkerElement(1, "first");
 * el.addEventListener("click", () => console.log("Stop 1 clicked"));
 * new mapboxgl.Marker(el).setLngLat([-71.06, 42.36]).addTo(map);
 */
export function createStopMarkerElement(
  stopIndex: number,
  variant: StopMarkerVariant = "intermediate",
  options: StopMarkerIconOptions = {}
): HTMLElement {
  const size       = options.size ?? DEFAULT_SIZE[variant];
  const dark       = options.darkTheme ?? false;
  const fill       = resolveColor(variant, dark);
  const halo       = dark ? HALO_DARK : HALO_LIGHT;
  const label      = badgeLabel(stopIndex);
  const fontSize   = deriveFontSize(size);
  const showRing   = options.showSelectionRing ?? variant === "selected";

  // ── Wrapper ─────────────────────────────────────────────────────────────────
  // Relative-positioned container so the selection ring can be placed behind
  // the badge (matches `.root` in StopMarker.module.css).
  const wrapper = document.createElement("div");
  wrapper.setAttribute("role", "img");
  wrapper.setAttribute("aria-label", `Stop ${stopIndex}`);
  wrapper.setAttribute("data-stop-index", String(stopIndex));
  wrapper.setAttribute("data-variant", variant);
  wrapper.style.cssText = [
    "position: relative",
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "pointer-events: auto",
  ].join("; ");

  // ── Selection pulse ring ────────────────────────────────────────────────────
  // A semi-transparent ring rendered behind the badge (z-index: -1).
  // Matches `.selectionRing` in StopMarker.module.css.
  if (showRing) {
    const ringSize = size + 12;
    const ring = document.createElement("span");
    ring.setAttribute("aria-hidden", "true");
    ring.setAttribute("data-testid", "stop-marker-factory-selection-ring");
    ring.style.cssText = [
      "position: absolute",
      `top: ${-(ringSize - size) / 2}px`,
      `left: ${-(ringSize - size) / 2}px`,
      `width: ${ringSize}px`,
      `height: ${ringSize}px`,
      "border-radius: 50%",
      "background: transparent",
      `border: 1.5px solid ${fill}`,
      "opacity: 0.5",
      "z-index: -1",
      "pointer-events: none",
    ].join("; ");
    wrapper.appendChild(ring);
  }

  // ── Badge ───────────────────────────────────────────────────────────────────
  // Circular badge with the stop number inside.  Matches `.badge` + variant
  // modifier classes in StopMarker.module.css.
  const badge = document.createElement("div");
  badge.setAttribute("aria-hidden", "true");
  badge.setAttribute("data-testid", "stop-marker-factory-badge");
  badge.style.cssText = [
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    `width: ${size}px`,
    `height: ${size}px`,
    "border-radius: 50%",
    `background: ${fill}`,
    // White halo ring matching `.badge` box-shadow in StopMarker.module.css
    `box-shadow: 0 2px 6px rgba(0,0,0,0.28), 0 0 0 1.5px ${halo}`,
    `font-family: "IBM Plex Mono", monospace`,
    `font-size: ${fontSize}px`,
    "font-weight: 700",
    "font-variant-numeric: tabular-nums",
    "line-height: 1",
    "color: rgba(255, 255, 255, 1)",
    "user-select: none",
    "cursor: pointer",
  ].join("; ");

  const text = document.createElement("span");
  text.style.cssText = "display: block; line-height: 1; max-width: 1.25em; overflow: hidden;";
  text.textContent = label;
  badge.appendChild(text);
  wrapper.appendChild(badge);

  return wrapper;
}

// ─── addStopMarkerImage ───────────────────────────────────────────────────────

/**
 * A minimal interface for the Mapbox GL map instance methods needed by
 * `addStopMarkerImage`.  Using a structural interface rather than importing
 * `mapboxgl.Map` directly keeps the factory dependency-free (no mapbox-gl peer
 * import required — callers supply the map object).
 */
export interface MapboxGLMapLike {
  /**
   * Add an image to the map's sprite.
   * @see https://docs.mapbox.com/mapbox-gl-js/api/map/#map#addimage
   */
  addImage(
    id: string,
    image: HTMLImageElement | ImageData | ImageBitmap,
    options?: { pixelRatio?: number; sdf?: boolean }
  ): void;

  /**
   * Check whether an image with the given ID exists in the map's sprite.
   * @see https://docs.mapbox.com/mapbox-gl-js/api/map/#map#hasimage
   */
  hasImage(id: string): boolean;
}

/**
 * Compute the stable Mapbox GL image ID for a numbered stop marker icon.
 *
 * This ID can be used in Mapbox GL layer paint specs to reference the icon:
 *   `"icon-image": "stop-marker-3-first"`
 *
 * @param stopIndex  1-based stop sequence number.
 * @param variant    Visual variant.
 * @returns          Stable string ID for use with `map.addImage()` / `map.hasImage()`.
 *
 * @example
 * const id = getStopMarkerImageId(3, "first"); // → "stop-marker-3-first"
 * map.setLayoutProperty("stops-layer", "icon-image", id);
 */
export function getStopMarkerImageId(
  stopIndex: number,
  variant: StopMarkerVariant = "intermediate"
): string {
  return `stop-marker-${stopIndex}-${variant}`;
}

/**
 * Add a numbered stop marker icon to a Mapbox GL map's image sprite.
 *
 * Internally creates an SVG via `createStopMarkerSVG()`, encodes it as a
 * data URI, and loads it into an HTMLImageElement before calling
 * `map.addImage()`.  The async loading is required because `map.addImage()`
 * needs a fully-loaded image object.
 *
 * If an image with the same ID already exists in the map sprite (`map.hasImage`)
 * the function short-circuits and returns the ID immediately — safe to call
 * multiple times for the same stop.
 *
 * Returns the image ID (`"stop-marker-<N>-<variant>"`) that can be used in
 * Mapbox GL layer `icon-image` properties.
 *
 * Requirements:
 *   - Must be called inside a `map.on("load", ...)` handler or after the map
 *     style is loaded (so the sprite is ready to accept new images).
 *   - Requires `window.Image` — do not call in Node.js / SSR environments.
 *
 * @param map        Mapbox GL map instance (or any object implementing MapboxGLMapLike).
 * @param stopIndex  1-based stop sequence number.
 * @param variant    Visual variant.
 * @param options    Size and DPR overrides.
 * @returns          Promise resolving to the image ID once loaded.
 *
 * @example
 * // Inside map.on("load"):
 * const id = await addStopMarkerImage(map, 3, "first");
 * map.setLayoutProperty("journey-stops-layer", "icon-image", id);
 */
export async function addStopMarkerImage(
  map: MapboxGLMapLike,
  stopIndex: number,
  variant: StopMarkerVariant = "intermediate",
  options: StopMarkerIconOptions = {}
): Promise<string> {
  const id = getStopMarkerImageId(stopIndex, variant);

  // ── Idempotency guard ───────────────────────────────────────────────────────
  // If the image is already in the map's sprite, skip loading to avoid
  // "Image already added" Mapbox GL errors and unnecessary re-encoding.
  if (map.hasImage(id)) {
    return id;
  }

  // ── Build SVG and encode as data URI ─────────────────────────────────────────
  const svg     = createStopMarkerSVG(stopIndex, variant, options);
  const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  // ── Load SVG into HTMLImageElement ────────────────────────────────────────────
  // `map.addImage()` requires a fully-loaded image object — we await the `load`
  // event before calling addImage.
  const img = new Image();
  const size = options.size ?? DEFAULT_SIZE[variant];
  img.width  = size;
  img.height = size;

  await new Promise<void>((resolve, reject) => {
    img.onload  = () => resolve();
    img.onerror = (err) => reject(
      new Error(
        `StopMarkerFactory: failed to load SVG image for stop-marker-${stopIndex}-${variant}. ` +
        `${err instanceof ErrorEvent ? err.message : String(err)}`
      )
    );
    img.src = dataUri;
  });

  // ── Register with Mapbox GL sprite ─────────────────────────────────────────────
  map.addImage(id, img, {
    pixelRatio: options.devicePixelRatio ?? 2,
  });

  return id;
}

// ─── Bulk helpers ─────────────────────────────────────────────────────────────

/**
 * Pre-load a range of numbered stop marker icons into a Mapbox GL map's sprite.
 *
 * Registers icons for stop indices 1..maxStopIndex for each variant in
 * `variants`.  This is useful for pre-populating the sprite before rendering
 * a symbol layer with data-driven `icon-image` expressions (e.g., symbol layers
 * where each feature has a `stop-marker-<N>-<variant>` image reference).
 *
 * All icons are loaded in parallel via `Promise.all` for fast startup.
 *
 * @param map           Mapbox GL map instance.
 * @param maxStopIndex  Highest stop index to pre-register (1-based inclusive).
 * @param variants      Variants to register (default: all four variants).
 * @param options       Size and DPR overrides applied to all icons.
 * @returns             Promise resolving to an array of registered image IDs.
 *
 * @example
 * map.on("load", async () => {
 *   await preloadStopMarkerImages(map, 20);
 *   // Now all stop-marker-1-first through stop-marker-20-selected are in the sprite.
 *   map.setLayoutProperty("stops-layer", "icon-image", [
 *     "case",
 *     ["==", ["get", "variant"], "first"], "stop-marker-1-first",
 *     // …
 *   ]);
 * });
 */
export async function preloadStopMarkerImages(
  map: MapboxGLMapLike,
  maxStopIndex: number,
  variants: StopMarkerVariant[] = ["first", "last", "intermediate", "selected"],
  options: StopMarkerIconOptions = {}
): Promise<string[]> {
  const tasks: Promise<string>[] = [];

  for (let i = 1; i <= maxStopIndex; i++) {
    for (const variant of variants) {
      tasks.push(addStopMarkerImage(map, i, variant, options));
    }
  }

  return Promise.all(tasks);
}
