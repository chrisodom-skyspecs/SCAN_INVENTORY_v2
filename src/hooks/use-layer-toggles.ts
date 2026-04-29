/**
 * useLayerToggles — per-status-category map layer visibility state.
 *
 * Manages boolean on/off toggles for the four case-status map layers:
 *   • deployed — cases at an active field site
 *   • transit  — cases in active transit / shipping
 *   • flagged  — cases with open damage reports or inspection failures
 *   • hangar   — cases in assembly, ready state, or hangar storage
 *
 * These toggles are *distinct* from the `layers: LayerId[]` URL param
 * (which controls map overlay layers like clusters, heat, satellite).
 * The layer-toggle state is ephemeral: it is not serialised to the URL
 * and resets to all-visible when the component unmounts.
 *
 * Usage — standalone (no MapStateProvider required)
 * ─────────────────────────────────────────────────
 *   "use client";
 *   import { useLayerToggles } from "@/hooks/use-layer-toggles";
 *
 *   function LayerPanel() {
 *     const { layerToggles, toggleLayer } = useLayerToggles();
 *
 *     return (
 *       <fieldset>
 *         <legend>Case layers</legend>
 *         {LAYER_TOGGLE_KEYS.map((key) => (
 *           <label key={key}>
 *             <input
 *               type="checkbox"
 *               checked={layerToggles[key]}
 *               onChange={() => toggleLayer(key)}
 *             />
 *             {key}
 *           </label>
 *         ))}
 *       </fieldset>
 *     );
 *   }
 *
 * Usage — via MapStateProvider (reads from shared ephemeral store)
 * ────────────────────────────────────────────────────────────────
 *   Pass `storeContext` to bind the hook to the map state store's ephemeral
 *   layer-toggle state. When bound, `toggleLayer` and `setLayerToggles`
 *   update `store.ephemeral.layerToggles` so all store subscribers see the
 *   change.
 *
 *   import { useMapState } from "@/providers/map-state-provider";
 *   import { useLayerToggles } from "@/hooks/use-layer-toggles";
 *
 *   function BoundLayerPanel() {
 *     const { state, setEphemeral } = useMapState();
 *     const { layerToggles, toggleLayer } = useLayerToggles({
 *       storeContext: { layerToggles: state.ephemeral.layerToggles, setEphemeral },
 *     });
 *     ...
 *   }
 */

"use client";

import { useCallback, useState } from "react";
import type { LayerToggles, LayerToggleKey } from "@/types/map";
import { DEFAULT_LAYER_TOGGLES } from "@/types/map";
import type { MapEphemeralState } from "@/stores/map-state-store";

// ─── Store context binding ─────────────────────────────────────────────────────

/**
 * Optional binding to the MapStateStore ephemeral state.
 *
 * When provided, the hook reads and writes `layerToggles` through the store
 * rather than local `useState`, so all consumers share the same toggle state.
 */
export interface LayerToggleStoreContext {
  /** Current `layerToggles` from the store's ephemeral state. */
  layerToggles: LayerToggles;
  /** Dispatch function that patches `MapEphemeralState`. */
  setEphemeral: (patch: Partial<MapEphemeralState>) => void;
}

// ─── Hook options ─────────────────────────────────────────────────────────────

export interface UseLayerTogglesOptions {
  /**
   * Optional initial toggle state.
   *
   * Merged with `DEFAULT_LAYER_TOGGLES` — only the provided keys override the
   * default (all-visible) values.  Ignored when `storeContext` is provided.
   *
   * @example
   * // Start with transit layer hidden
   * useLayerToggles({ initialToggles: { transit: false } });
   */
  initialToggles?: Partial<LayerToggles>;

  /**
   * Optional binding to the MapStateStore ephemeral state.
   *
   * When provided, the hook skips its own `useState` and uses the store's
   * `layerToggles` directly.  This keeps toggle state in sync across multiple
   * components that consume the same `MapStateProvider`.
   */
  storeContext?: LayerToggleStoreContext;
}

// ─── Return type ──────────────────────────────────────────────────────────────

export interface UseLayerTogglesReturn {
  /**
   * Current toggle state — one boolean per status category.
   * `true` = layer visible, `false` = layer hidden.
   *
   * @example
   * layerToggles.deployed // true  → deployed cases shown on map
   * layerToggles.flagged  // false → flagged cases hidden from map
   */
  layerToggles: LayerToggles;

  /**
   * Flip a single layer's visibility.
   *
   * If the layer is currently visible it becomes hidden; if hidden, visible.
   * All other layers are unaffected.
   *
   * @param key — "deployed" | "transit" | "flagged" | "hangar"
   *
   * @example
   * toggleLayer("transit"); // hide if visible, show if hidden
   */
  toggleLayer: (key: LayerToggleKey) => void;

  /**
   * Set one or more layer toggles to explicit values.
   *
   * Merges the provided partial patch into the current toggle state.
   * Use this when you need to set multiple layers at once without
   * multiple re-renders, or to apply a preset.
   *
   * @example
   * setLayerToggles({ deployed: true, hangar: false });
   * setLayerToggles({ flagged: false });   // only hide flagged, rest unchanged
   */
  setLayerToggles: (patch: Partial<LayerToggles>) => void;

  /**
   * Set all four layers to the same visibility value at once.
   *
   * Useful for "Show all" / "Hide all" buttons.
   *
   * @example
   * setAllLayers(true);  // show all
   * setAllLayers(false); // hide all
   */
  setAllLayers: (visible: boolean) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manage per-status-category map layer visibility toggles.
 *
 * Returns a stable `{ layerToggles, toggleLayer, setLayerToggles, setAllLayers }`
 * interface.  All setter callbacks are memoised with `useCallback` and will
 * not change identity across re-renders as long as the binding mode (standalone
 * vs. store-bound) stays the same.
 *
 * @param options — see `UseLayerTogglesOptions`
 */
export function useLayerToggles(
  options: UseLayerTogglesOptions = {}
): UseLayerTogglesReturn {
  const { initialToggles, storeContext } = options;

  // ── Local state (standalone mode) ─────────────────────────────────────
  //
  // Only used when `storeContext` is NOT provided.  Initialised from
  // `initialToggles` merged over the defaults.
  const [localToggles, setLocalToggles] = useState<LayerToggles>(() => ({
    ...DEFAULT_LAYER_TOGGLES,
    ...initialToggles,
  }));

  // ── Determine which state to read ─────────────────────────────────────
  //
  // When a `storeContext` binding is provided, use the store's layerToggles;
  // otherwise fall through to local state.  The boolean `isBound` drives
  // which branch the callbacks take.
  const isBound = storeContext !== undefined;
  const layerToggles: LayerToggles = isBound
    ? storeContext.layerToggles
    : localToggles;

  // ── toggleLayer ───────────────────────────────────────────────────────

  const toggleLayer = useCallback(
    (key: LayerToggleKey): void => {
      if (isBound && storeContext) {
        // Update through the store so all subscribers see the change.
        const current = storeContext.layerToggles;
        storeContext.setEphemeral({
          layerToggles: { ...current, [key]: !current[key] },
        });
      } else {
        setLocalToggles((prev) => ({ ...prev, [key]: !prev[key] }));
      }
    },
    // storeContext reference may change each render when the caller doesn't
    // memoise — that's acceptable; the callback always reads the current ref
    // via the closure.  isBound is stable as long as storeContext stays
    // defined/undefined across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isBound, storeContext]
  );

  // ── setLayerToggles ───────────────────────────────────────────────────

  const setLayerToggles = useCallback(
    (patch: Partial<LayerToggles>): void => {
      if (isBound && storeContext) {
        const current = storeContext.layerToggles;
        storeContext.setEphemeral({
          layerToggles: { ...current, ...patch },
        });
      } else {
        setLocalToggles((prev) => ({ ...prev, ...patch }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isBound, storeContext]
  );

  // ── setAllLayers ──────────────────────────────────────────────────────

  const setAllLayers = useCallback(
    (visible: boolean): void => {
      const allSame: LayerToggles = {
        deployed: visible,
        transit: visible,
        flagged: visible,
        hangar: visible,
      };
      if (isBound && storeContext) {
        storeContext.setEphemeral({ layerToggles: allSame });
      } else {
        setLocalToggles(allSame);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isBound, storeContext]
  );

  return { layerToggles, toggleLayer, setLayerToggles, setAllLayers };
}
