/**
 * Map mode registry — static metadata for the 5 INVENTORY map view modes.
 *
 * This module is a pure data table.  It has no dependencies on React, Convex,
 * or browser APIs and can be imported safely in any environment (SSR, tests,
 * web workers).
 *
 * The registry is intentionally separate from runtime state so consumers can
 * read metadata (labels, groups, feature flags) without instantiating any
 * state manager.
 *
 * Map modes (M1–M5)
 * ──────────────────
 *   M1 Fleet Overview   — all cases on a world/region map with status pins
 *   M2 Site Detail      — zoomed view of a single deployment site
 *   M3 Transit Tracker  — cases in transit with FedEx route overlays
 *   M4 Heat Map         — status density / damage heat map
 *   M5 Mission Control  — time-scrubbing replay (requires FF_MAP_MISSION)
 *
 * Groups
 * ──────
 *   core    — M1–M4, always available to authenticated users
 *   mission — M5, requires the FF_MAP_MISSION feature flag
 *
 * Usage
 * ─────
 *   import { MAP_MODE_REGISTRY, getMapModeDef } from "@/lib/map-mode-registry";
 *
 *   // Iterate all modes
 *   MAP_MODE_REGISTRY.forEach(def => console.log(def.label));
 *
 *   // Iterate only core (always-available) modes
 *   getMapModesByGroup("core").forEach(def => console.log(def.id));
 *
 *   // Look up a single mode
 *   const def = getMapModeDef("M3"); // throws if not found
 *   const def = findMapModeDef("M3"); // returns undefined if not found
 */

import type { MapModeDef, MapModeGroup, MapView } from "@/types/map";

// ─── Registry table ───────────────────────────────────────────────────────────

/**
 * Ordered registry of all 5 map view modes.
 *
 * Sorted by `order` (ascending) to match the mode picker display order:
 *   0. M1 — Fleet Overview    (core)    — default active mode
 *   1. M2 — Site Detail       (core)    — available by default
 *   2. M3 — Transit Tracker   (core)    — available by default
 *   3. M4 — Heat Map          (core)    — available by default
 *   4. M5 — Mission Control   (mission) — requires FF_MAP_MISSION
 *
 * `defaultActive` reflects whether the mode is ACCESSIBLE by default
 * (i.e., without a feature flag being enabled), NOT which mode is currently
 * selected.  The selected mode is stored in MapUrlState.view (URL param).
 *
 * Design tokens for the mode picker are defined in globals.css under
 * the --map-mode-* namespace.
 */
export const MAP_MODE_REGISTRY: readonly MapModeDef[] = [
  {
    id: "M1",
    label: "Fleet Overview",
    description:
      "All cases on a world/region map with status pins and cluster indicators.",
    group: "core",
    defaultActive: true,
    order: 0,
  },
  {
    id: "M2",
    label: "Site Detail",
    description:
      "Zoomed view of a single deployment site with per-case overlays and turbine markers.",
    group: "core",
    defaultActive: true,
    order: 1,
  },
  {
    id: "M3",
    label: "Transit Tracker",
    description:
      "Cases in transit with active FedEx tracking route overlays and ETA indicators.",
    group: "core",
    defaultActive: true,
    order: 2,
  },
  {
    id: "M4",
    label: "Heat Map",
    description:
      "Status density and damage concentration heat map — highlights hot zones.",
    group: "core",
    defaultActive: true,
    order: 3,
  },
  {
    id: "M5",
    label: "Mission Control",
    description:
      "Time-scrubbing replay of historical case positions and field events.",
    group: "mission",
    defaultActive: false,
    featureFlag: "FF_MAP_MISSION",
    order: 4,
  },
] as const;

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Pre-built Map for O(1) mode definition lookup by ID.
 */
const REGISTRY_MAP = new Map<MapView, MapModeDef>(
  MAP_MODE_REGISTRY.map((def) => [def.id, def])
);

/**
 * Look up the static definition for a map mode by ID.
 *
 * @throws {Error} When the ID is not in the registry.  This is a programming
 *   error — the caller should guard with `isMapView` when the ID comes from
 *   untrusted input.
 *
 * @example
 * const def = getMapModeDef("M3");
 * console.log(def.label); // "Transit Tracker"
 */
export function getMapModeDef(id: MapView): MapModeDef {
  const def = REGISTRY_MAP.get(id);
  if (!def) {
    throw new Error(
      `[MapModeRegistry] Unknown map mode ID "${id}". ` +
        `Valid IDs: ${MAP_MODE_REGISTRY.map((d) => d.id).join(", ")}.`
    );
  }
  return def;
}

/**
 * Returns the definition for a map mode ID, or `undefined` when not found.
 *
 * Safe variant of `getMapModeDef` — use this when the ID comes from untrusted
 * input (e.g., URL params, user input).
 *
 * @example
 * const def = findMapModeDef(rawParam);
 * if (def) { /* use def *\/ }
 */
export function findMapModeDef(id: string): MapModeDef | undefined {
  return REGISTRY_MAP.get(id as MapView);
}

/**
 * Returns all map mode definitions in a given group.
 *
 * @example
 * // Get only the always-available modes
 * const coreModes = getMapModesByGroup("core");
 *
 * // Get feature-flagged modes
 * const missionModes = getMapModesByGroup("mission");
 */
export function getMapModesByGroup(group: MapModeGroup): MapModeDef[] {
  return MAP_MODE_REGISTRY.filter((def) => def.group === group);
}

/**
 * Returns the ordered list of map mode IDs (same order as MAP_MODE_REGISTRY).
 *
 * @example
 * getMapModeIds(); // ["M1", "M2", "M3", "M4", "M5"]
 */
export function getMapModeIds(): MapView[] {
  return MAP_MODE_REGISTRY.map((def) => def.id);
}

/**
 * Returns all map modes that are accessible by default (no feature flag required).
 *
 * Equivalent to `MAP_MODE_REGISTRY.filter(d => d.defaultActive)`.
 *
 * @example
 * getDefaultActiveModes(); // [M1, M2, M3, M4 definitions]
 */
export function getDefaultActiveModes(): MapModeDef[] {
  return MAP_MODE_REGISTRY.filter((def) => def.defaultActive);
}

/**
 * Returns all map modes that require a feature flag to be enabled.
 *
 * @example
 * getFeatureFlaggedModes(); // [M5 definition]
 */
export function getFeatureFlaggedModes(): MapModeDef[] {
  return MAP_MODE_REGISTRY.filter((def) => def.featureFlag !== undefined);
}

/**
 * Returns map modes accessible under a given feature flag set.
 *
 * Includes:
 *   - All `defaultActive: true` modes (always accessible)
 *   - All feature-flagged modes whose `featureFlag` value is present in `activeFlags`
 *
 * @param activeFlags  Set of enabled feature flag identifiers.
 *
 * @example
 * const modes = getAccessibleModes(new Set(["FF_MAP_MISSION"]));
 * // Returns all 5 modes (M1–M5) since FF_MAP_MISSION is active
 *
 * const modes = getAccessibleModes(new Set());
 * // Returns only M1–M4 (defaultActive modes)
 */
export function getAccessibleModes(activeFlags: Set<string>): MapModeDef[] {
  return MAP_MODE_REGISTRY.filter(
    (def) =>
      def.defaultActive ||
      (def.featureFlag !== undefined && activeFlags.has(def.featureFlag))
  );
}

/**
 * Returns the definition of the default map mode (the one shown on first load).
 *
 * This is always M1 (Fleet Overview) — it is the only mode with
 * `defaultActive: true` AND order 0, matching MAP_URL_STATE_DEFAULTS.view.
 */
export function getDefaultMapMode(): MapModeDef {
  // M1 is always first and is the canonical default
  return MAP_MODE_REGISTRY[0];
}
