/**
 * Layer Engine types for INVENTORY map overlay system.
 *
 * The INVENTORY map supports 7 semantic data layers that can be independently
 * toggled on/off.  These are distinct from the map *rendering* layers (CSS pins,
 * clusters, satellite) — they control which categories of *data* are visible.
 *
 * Layer IDs
 * ─────────
 *   deployed  — cases currently deployed at field sites
 *   transit   — cases in transit (FedEx tracking active)
 *   flagged   — cases flagged for inspection or with active damage reports
 *   hangar    — cases in hangar / storage / awaiting deployment
 *   heat      — density heat-map overlay (damage / activity concentration)
 *   history   — historical event timeline overlay (past states)
 *   turbines  — turbine site markers (deployment targets)
 */

// ─── Semantic layer identifier ─────────────────────────────────────────────

/**
 * The 7 semantic data layers available on the INVENTORY map.
 *
 * Each layer controls which subset of case data (or site data) is rendered.
 * Multiple layers can be active simultaneously.
 */
export type SemanticLayerId =
  | "deployed"
  | "transit"
  | "flagged"
  | "hangar"
  | "heat"
  | "history"
  | "turbines";

/** Ordered tuple of all 7 semantic layer IDs. */
export const SEMANTIC_LAYER_IDS: readonly SemanticLayerId[] = [
  "deployed",
  "transit",
  "flagged",
  "hangar",
  "heat",
  "history",
  "turbines",
] as const;

/** Type-guard for SemanticLayerId. */
export function isSemanticLayerId(value: unknown): value is SemanticLayerId {
  return (
    typeof value === "string" &&
    SEMANTIC_LAYER_IDS.includes(value as SemanticLayerId)
  );
}

// ─── Layer definition (registry entry) ─────────────────────────────────────

/**
 * Static metadata for a single semantic layer, stored in the registry.
 *
 * This record is immutable — the registry describes layers but does not
 * hold their runtime visibility state (that lives in `LayerEngineState`).
 */
export interface LayerDef {
  /** Stable identifier. */
  id: SemanticLayerId;

  /**
   * Short human-readable label shown in the layer picker.
   * Max ~20 chars so it fits in compact UI.
   */
  label: string;

  /**
   * One-sentence description shown in the layer picker tooltip.
   */
  description: string;

  /**
   * Whether this layer is active by default (on first load, before any
   * user interaction or URL-driven override).
   */
  defaultActive: boolean;

  /**
   * CSS custom property name for the layer's primary color token.
   *
   * Consumers use this as `style={{ color: `var(${colorToken})` }}` etc.
   * All tokens must be defined in the design system (globals.css).
   *
   * Convention: `--layer-<id>-color`
   */
  colorToken: string;

  /**
   * CSS custom property name for the layer's background/fill color token
   * (used for pin fill, legend swatch, etc.).
   *
   * Convention: `--layer-<id>-bg`
   */
  bgToken: string;

  /**
   * Keyboard shortcut key (single char) for toggling this layer.
   * Shown in layer picker tooltips.  Undefined when no shortcut is assigned.
   */
  shortcutKey?: string;

  /**
   * Display order for the layer picker (ascending, 0-first).
   * Registry entries are pre-sorted; this field exists for documentation.
   */
  order: number;
}

// ─── Per-layer visibility state ─────────────────────────────────────────────

/**
 * Snapshot of runtime visibility state for all 7 layers.
 *
 * This is the value returned by `LayerEngine.getState()` and emitted to
 * subscribers on every change.  It is a plain record — easy to serialize,
 * diff, or pass as props.
 */
export type LayerEngineState = Readonly<Record<SemanticLayerId, boolean>>;

/** Default visibility state derived from each layer's `defaultActive` field. */
export const DEFAULT_LAYER_ENGINE_STATE: LayerEngineState = {
  deployed: true,
  transit: true,
  flagged: true,
  hangar: true,
  heat: false,
  history: false,
  turbines: true,
} as const;

// ─── Subscriber types ───────────────────────────────────────────────────────

/** Called whenever the layer visibility state changes. */
export type LayerEngineListener = (state: LayerEngineState) => void;

/** Change event emitted by `LayerEngine.onchange`. */
export interface LayerEngineChangeEvent {
  /** Full updated state. */
  state: LayerEngineState;
  /** Which layer(s) changed and their new visibility values. */
  diff: Partial<LayerEngineState>;
}

export type LayerEngineChangeListener = (event: LayerEngineChangeEvent) => void;
