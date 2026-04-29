/**
 * Layer registry — static metadata for the 7 INVENTORY semantic map layers.
 *
 * This module is a pure data table.  It has no dependencies on React, Convex,
 * or browser APIs and can be imported safely in any environment (SSR, tests,
 * web workers).
 *
 * The registry is intentionally separate from runtime state so consumers can
 * read metadata (labels, colors, defaults) without instantiating a LayerEngine.
 *
 * Usage
 * ─────
 *   import { LAYER_REGISTRY, getLayerDef } from "@/lib/layer-registry";
 *
 *   // Iterate all layers
 *   LAYER_REGISTRY.forEach(def => console.log(def.label));
 *
 *   // Look up a single layer
 *   const def = getLayerDef("deployed");
 */

import type { LayerDef, SemanticLayerId } from "@/types/layer-engine";

// ─── Registry table ───────────────────────────────────────────────────────────

/**
 * Ordered registry of all 7 semantic data layers.
 *
 * Sorted by `order` (ascending) to match the layer picker display order:
 *   1. deployed  — green  (in-field cases)
 *   2. transit   — blue   (FedEx in-transit)
 *   3. flagged   — orange (damage/issues)
 *   4. hangar    — indigo (stored/idle)
 *   5. heat      — magenta (density overlay)
 *   6. history   — neutral (past events)
 *   7. turbines  — lime   (site markers)
 *
 * Color tokens map to design system variables defined in globals.css:
 *   --layer-deployed-color, --layer-deployed-bg, etc.
 */
export const LAYER_REGISTRY: readonly LayerDef[] = [
  {
    id: "deployed",
    label: "Deployed",
    description: "Cases currently deployed at field inspection sites.",
    defaultActive: true,
    colorToken: "--layer-deployed-color",
    bgToken: "--layer-deployed-bg",
    shortcutKey: "d",
    order: 0,
  },
  {
    id: "transit",
    label: "In Transit",
    description: "Cases in transit with active FedEx tracking.",
    defaultActive: true,
    colorToken: "--layer-transit-color",
    bgToken: "--layer-transit-bg",
    shortcutKey: "t",
    order: 1,
  },
  {
    id: "flagged",
    label: "Flagged",
    description: "Cases flagged for inspection or with open damage reports.",
    defaultActive: true,
    colorToken: "--layer-flagged-color",
    bgToken: "--layer-flagged-bg",
    shortcutKey: "f",
    order: 2,
  },
  {
    id: "hangar",
    label: "Hangar",
    description: "Cases in hangar storage awaiting deployment or return.",
    defaultActive: true,
    colorToken: "--layer-hangar-color",
    bgToken: "--layer-hangar-bg",
    shortcutKey: "h",
    order: 3,
  },
  {
    id: "heat",
    label: "Heat Map",
    description: "Density heat-map showing activity and damage concentration.",
    defaultActive: false,
    colorToken: "--layer-heat-color",
    bgToken: "--layer-heat-bg",
    shortcutKey: "e",
    order: 4,
  },
  {
    id: "history",
    label: "History",
    description: "Historical event timeline overlay showing past case states.",
    defaultActive: false,
    colorToken: "--layer-history-color",
    bgToken: "--layer-history-bg",
    shortcutKey: "y",
    order: 5,
  },
  {
    id: "turbines",
    label: "Turbines",
    description: "Turbine site markers — primary deployment targets.",
    defaultActive: true,
    colorToken: "--layer-turbines-color",
    bgToken: "--layer-turbines-bg",
    shortcutKey: "u",
    order: 6,
  },
] as const;

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Pre-built Map for O(1) layer definition lookup by ID.
 */
const REGISTRY_MAP = new Map<SemanticLayerId, LayerDef>(
  LAYER_REGISTRY.map((def) => [def.id, def])
);

/**
 * Look up the static definition for a layer by ID.
 *
 * @throws {Error} When the ID is not in the registry.  This is a programming
 *   error — the caller should guard with `isSemanticLayerId` when the ID
 *   comes from untrusted input.
 */
export function getLayerDef(id: SemanticLayerId): LayerDef {
  const def = REGISTRY_MAP.get(id);
  if (!def) {
    throw new Error(
      `[LayerRegistry] Unknown layer ID "${id}". ` +
        `Valid IDs: ${LAYER_REGISTRY.map((d) => d.id).join(", ")}.`
    );
  }
  return def;
}

/**
 * Returns the definition for a layer ID, or `undefined` when not found.
 * Safe variant of `getLayerDef` — use this when the ID comes from untrusted
 * input (e.g., URL params, user input).
 */
export function findLayerDef(id: string): LayerDef | undefined {
  return REGISTRY_MAP.get(id as SemanticLayerId);
}

/**
 * Returns the ordered list of layer IDs (same order as LAYER_REGISTRY).
 */
export function getLayerIds(): SemanticLayerId[] {
  return LAYER_REGISTRY.map((def) => def.id);
}

/**
 * Returns all layers that are active by default.
 */
export function getDefaultActiveLayers(): SemanticLayerId[] {
  return LAYER_REGISTRY.filter((def) => def.defaultActive).map((def) => def.id);
}
