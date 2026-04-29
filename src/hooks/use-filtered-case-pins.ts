/**
 * src/hooks/use-filtered-case-pins.ts
 *
 * useFilteredCasePins — Bridge between LayerEngine and map pin rendering.
 *
 * Reads the shared LayerEngine state (via `useSharedLayerEngine`), derives a
 * `LayerToggles` record from the four case-relevant semantic layers (deployed,
 * transit, flagged, hangar), and filters the full Convex pin set so only
 * pins whose status belongs to an active layer are returned.
 *
 * Layer → Status mapping (LAYER_TOGGLE_STATUS_MAP):
 *   deployed → ["deployed"]
 *   transit  → ["transit_out", "transit_in"]
 *   flagged  → ["flagged"]
 *   hangar   → ["hangar", "assembled", "received", "archived"]
 *
 * The remaining semantic layers (heat, history, turbines) control overlay
 * rendering (density heat maps, event timelines, site markers) rather than
 * case pin visibility — they are intentionally omitted from LayerToggles.
 *
 * Real-time fidelity
 * ──────────────────
 * Both the Convex subscription (useMapCasePins) and the LayerEngine state
 * (useSyncExternalStore) notify React of changes within their respective
 * propagation windows:
 *   • Convex mutations → new pins within ~100–300 ms (satisfies ≤ 2-second SLA)
 *   • Layer toggle clicks → synchronous (engine state updates in the same event)
 *
 * Performance
 * ───────────
 * `filteredPins` and `allPins` are memoised so the O(n) filter scan only runs
 * when either the raw pin array or the layerToggles object changes.
 *
 * Dependencies
 * ────────────
 * Requires a `<LayerEngineProvider>` ancestor in the component tree.
 * `useSharedLayerEngine()` throws a descriptive error when no provider is found
 * (intentional — it always indicates a programmer error).
 *
 * Usage
 * ─────
 * @example
 * // Inside a component wrapped with LayerEngineProvider:
 * const { pins, allPins, isLoading, hiddenCount } = useFilteredCasePins({
 *   missionId: org ?? undefined,
 * });
 *
 * // Only active-layer pins:
 * pins.forEach(pin => renderMarker(pin.lat, pin.lng, pin.layerKey));
 *
 * // Show filter badge:
 * `${pins.length} / ${allPins.length} cases visible`
 */

"use client";

import { useMemo } from "react";
import { useSharedLayerEngine } from "@/providers/layer-engine-provider";
import {
  useMapCasePins,
  type MapCasePin,
  type UseMapCasePinsArgs,
  type MapCasePinSummary,
} from "./use-map-case-pins";
import { getToggleKeyForStatus } from "@/lib/case-status-filter";
import type { LayerToggles, LayerToggleKey } from "@/types/map";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A case pin enriched with its semantic layer key.
 *
 * Extends `MapCasePin` with `layerKey` — the `LayerToggleKey` that governs
 * this pin's visibility based on its status.  `null` for statuses that do not
 * map to any toggle (defensive; should not occur in practice with a valid
 * CaseStatus).
 *
 * Components use `layerKey` to:
 *   1. Apply layer-specific visual styling (color, size, opacity).
 *   2. Show/hide pins based on the active layer toggle state.
 *   3. Render layer-aware tooltips and legends.
 */
export interface FilteredCasePin extends MapCasePin {
  /**
   * The `LayerToggleKey` that controls this pin's visibility.
   * Derived from the pin's `status` via `getToggleKeyForStatus`.
   *
   * Values:
   *   "deployed" — pin has status "deployed"
   *   "transit"  — pin has status "transit_out" or "transit_in"
   *   "flagged"  — pin has status "flagged"
   *   "hangar"   — pin has status "hangar", "assembled", "received", or "archived"
   *   null       — unknown status (excluded from rendering)
   */
  layerKey: LayerToggleKey | null;
}

/**
 * Arguments accepted by `useFilteredCasePins`.
 *
 * A subset of `UseMapCasePinsArgs` — the `status` filter is excluded because
 * this hook derives visible statuses from the LayerEngine state automatically.
 */
export interface UseFilteredCasePinsArgs {
  /**
   * Filter to cases assigned to a specific mission (Convex mission document ID).
   * Omit (or `null`) for a global fleet view.
   */
  missionId?: string | null;

  /**
   * Filter to cases assigned to a specific technician or pilot (Kinde user ID).
   * Omit (or `null`) for all assignees.
   */
  assigneeId?: string | null;

  /**
   * Geographic viewport bounds for spatial filtering.
   * When provided, only cases within this box are returned as pins.
   */
  bounds?: UseMapCasePinsArgs["bounds"];

  /**
   * When `true`, the Convex subscription is suspended and the hook immediately
   * returns `{ pins: [], allPins: [], isLoading: false, … }`.
   *
   * Use this to defer the query until the map viewport is ready.
   * @default false
   */
  skip?: boolean;
}

/**
 * Return value of `useFilteredCasePins`.
 */
export interface UseFilteredCasePinsResult {
  /**
   * Case pins that belong to at least one active layer.
   * Sorted in the same order as the Convex response.
   * Empty while loading or when `skip` is true.
   */
  pins: FilteredCasePin[];

  /**
   * All case pins, regardless of active layer state.
   * Use for the total-count display and for computing `hiddenCount`.
   * Empty while loading or when `skip` is true.
   */
  allPins: FilteredCasePin[];

  /**
   * `true` while the initial Convex fetch has not yet returned.
   * Always `false` when `skip` is true.
   */
  isLoading: boolean;

  /**
   * Fleet-wide summary counts from the Convex response (unfiltered by layers).
   * `undefined` while loading or when `skip` is true.
   */
  summary: MapCasePinSummary | undefined;

  /**
   * The `LayerToggles` object derived from the current `LayerEngine` state.
   * Exposes the four case-pin-relevant toggles (deployed, transit, flagged, hangar).
   * Use this to render the active-layer badge or pass to other utilities.
   */
  layerToggles: LayerToggles;

  /**
   * Number of pins hidden by the layer filter (allPins.length − pins.length).
   * Use for "N hidden by filter" UI callouts.
   */
  hiddenCount: number;
}

// ─── Pure helpers (testable without React) ────────────────────────────────────

/**
 * Derive a `LayerToggles` record from the four case-relevant keys of a
 * `LayerEngineState` snapshot.
 *
 * The remaining semantic layer IDs (heat, history, turbines) control non-pin
 * overlays and are intentionally excluded from the returned object.
 *
 * @param deployed - Visibility of the "deployed" semantic layer.
 * @param transit  - Visibility of the "transit" semantic layer.
 * @param flagged  - Visibility of the "flagged" semantic layer.
 * @param hangar   - Visibility of the "hangar" semantic layer.
 */
export function deriveLayerToggles(
  deployed: boolean,
  transit: boolean,
  flagged: boolean,
  hangar: boolean
): LayerToggles {
  return { deployed, transit, flagged, hangar };
}

/**
 * Enrich a raw `MapCasePin` array with the `layerKey` field.
 *
 * Each pin gets a `layerKey` derived from `getToggleKeyForStatus(pin.status)`.
 * Pins with unrecognised statuses receive `layerKey: null` — these are excluded
 * by the filter step downstream.
 *
 * @param pins - Raw normalised pins from `useMapCasePins`.
 * @returns New array with the `layerKey` field added to each element.
 */
export function enrichPinsWithLayerKey(pins: MapCasePin[]): FilteredCasePin[] {
  return pins.map((pin) => ({
    ...pin,
    layerKey: getToggleKeyForStatus(pin.status),
  }));
}

/**
 * Filter an enriched pin array to only those whose layer toggle is active.
 *
 * @param enrichedPins - Pins already enriched with `layerKey`.
 * @param layerToggles - Active/inactive state for each of the four toggle keys.
 * @returns New array containing only pins for active layers.
 */
export function applyLayerFilter(
  enrichedPins: FilteredCasePin[],
  layerToggles: LayerToggles
): FilteredCasePin[] {
  return enrichedPins.filter((pin) => {
    // Pins with an unrecognised status (layerKey === null) are always excluded.
    if (pin.layerKey === null) return false;
    return layerToggles[pin.layerKey];
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to filtered case pins based on the active LayerEngine state.
 *
 * Combines two reactive sources:
 *   1. `useSharedLayerEngine()` — re-renders when any layer toggle changes.
 *   2. `useMapCasePins(…)` — re-renders when Convex pushes pin data updates.
 *
 * The filtered result is memoised via `useMemo` so the O(n) filter scan only
 * runs when the underlying data actually changes.
 *
 * Must be called inside a component that has a `<LayerEngineProvider>` ancestor.
 * Use `useSharedLayerEngine` directly if you need the engine in other contexts.
 *
 * @param args - Optional filters (missionId, assigneeId, bounds, skip).
 * @returns The filtered and enriched pin set plus metadata.
 */
export function useFilteredCasePins(
  args: UseFilteredCasePinsArgs = {}
): UseFilteredCasePinsResult {
  const { missionId, assigneeId, bounds, skip = false } = args;

  // ── Layer engine state ────────────────────────────────────────────────────
  //
  // `useSharedLayerEngine` reads from the nearest `LayerEngineProvider` via
  // React context.  The returned `state` object changes reference only when a
  // layer visibility actually changes (immutable snapshot model).
  //
  // We only destructure the four case-pin-relevant fields so the useMemo
  // dependency array can be as narrow as possible.
  const { state } = useSharedLayerEngine();

  // Derive a stable LayerToggles object from the engine state.
  // useMemo ensures we don't create a new object on every render — only when
  // one of the four relevant layers actually changes.
  const layerToggles = useMemo(
    () => deriveLayerToggles(
      state.deployed,
      state.transit,
      state.flagged,
      state.hangar
    ),
    // Destructure to primitive booleans so the dep array is trivially stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.deployed, state.transit, state.flagged, state.hangar]
  );

  // ── Convex pin subscription ───────────────────────────────────────────────
  //
  // We subscribe to ALL statuses here and apply the layer filter client-side.
  // This avoids an extra Convex query round-trip each time a layer toggle
  // changes — the full pin set is already in the browser, and filtering is O(n).
  //
  // A server-side status filter (useMapCasePins({ status: [...] })) would be
  // more efficient for very large fleets but requires a Convex round-trip per
  // toggle click.  For ≤5,000 cases, client-side filtering is imperceptible.
  const { pins: rawPins, isLoading, summary } = useMapCasePins({
    missionId:  missionId  ?? undefined,
    assigneeId: assigneeId ?? undefined,
    bounds:     bounds     ?? undefined,
    skip,
  });

  // ── Enrich pins with layerKey ─────────────────────────────────────────────
  //
  // Runs once per rawPins identity change (i.e., per Convex update).
  // The layerKey derivation is a simple O(1) map lookup per pin.
  const allPins = useMemo(
    () => enrichPinsWithLayerKey(rawPins),
    [rawPins]
  );

  // ── Apply layer filter ────────────────────────────────────────────────────
  //
  // Runs when either allPins or layerToggles changes.
  // applyLayerFilter is O(n) — safe for per-render use for typical fleet sizes.
  const filteredPins = useMemo(
    () => applyLayerFilter(allPins, layerToggles),
    [allPins, layerToggles]
  );

  // ── Derived metadata ──────────────────────────────────────────────────────

  const hiddenCount = allPins.length - filteredPins.length;

  return {
    pins:         filteredPins,
    allPins,
    isLoading,
    summary,
    layerToggles,
    hiddenCount,
  };
}
