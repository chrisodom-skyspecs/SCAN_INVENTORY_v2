/**
 * useLayerEngine — React integration for the INVENTORY map LayerEngine.
 *
 * Wraps a `LayerEngine` instance in React's `useSyncExternalStore` so component
 * trees re-render automatically whenever layer visibility changes, without any
 * useEffect or manual subscription management in component bodies.
 *
 * Two usage modes
 * ───────────────
 *
 * 1. **Singleton (recommended)** — Pass no arguments.  The hook creates a
 *    stable `LayerEngine` instance via `useRef` that is shared by all callers
 *    of this hook on the same component.  For cross-component sharing, wrap in
 *    a context (see `LayerEngineProvider`).
 *
 * 2. **Provided engine** — Pass a `LayerEngine` instance created externally
 *    (e.g., from a context).  Useful when multiple components need to read from
 *    the same engine instance.
 *
 * Return value
 * ────────────
 *   state          — full visibility snapshot (Record<SemanticLayerId, boolean>)
 *   isVisible(id)  — per-layer shortcut (derived from state, stable reference)
 *   toggle(id)     — flip one layer on/off
 *   setVisible(id, visible)  — explicitly set one layer
 *   setPartial(patch)        — partially update multiple layers
 *   activateAll()  — turn all layers on
 *   deactivateAll() — turn all layers off
 *   reset()        — restore default visibility
 *   registry       — the LAYER_REGISTRY static metadata array
 *   engine         — the underlying LayerEngine instance (escape hatch)
 *
 * URL sync (optional)
 * ───────────────────
 * Layer visibility is ephemeral by default — it resets on page load.
 * To persist via URL, pass `onStateChange` and use `useMapParams().setLayers`
 * to reflect the active layer set in the `layers` URL param.  The AC 10b
 * URL-sync layer will wire this up; this hook purposely stays decoupled.
 *
 * Example
 * ───────
 *   "use client";
 *   import { useLayerEngine } from "@/hooks/use-layer-engine";
 *
 *   function LayerPicker() {
 *     const { state, toggle, registry } = useLayerEngine();
 *
 *     return (
 *       <ul>
 *         {registry.map(def => (
 *           <li key={def.id}>
 *             <button
 *               aria-pressed={state[def.id]}
 *               onClick={() => toggle(def.id)}
 *             >
 *               {def.label}
 *             </button>
 *           </li>
 *         ))}
 *       </ul>
 *     );
 *   }
 */

"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import { LayerEngine } from "@/lib/layer-engine";
import { LAYER_REGISTRY } from "@/lib/layer-registry";
import {
  DEFAULT_LAYER_ENGINE_STATE,
  type LayerEngineState,
  type SemanticLayerId,
} from "@/types/layer-engine";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface UseLayerEngineReturn {
  /**
   * Full visibility state snapshot.
   * Reference changes whenever any layer visibility changes.
   * Stable when nothing changed (reference-equality safe for memoization).
   */
  state: LayerEngineState;

  /**
   * Whether a specific layer is currently visible.
   * Equivalent to `state[id]` but provided as a stable callback for
   * consumers that only care about one layer.
   */
  isVisible: (id: SemanticLayerId) => boolean;

  /**
   * Toggle a single layer on or off.
   * Stable callback — safe for use in dependency arrays.
   */
  toggle: (id: SemanticLayerId) => void;

  /**
   * Explicitly set the visibility of a single layer.
   * No-op when the layer is already in the requested state.
   * Stable callback.
   */
  setVisible: (id: SemanticLayerId, visible: boolean) => void;

  /**
   * Enable (make visible) a single layer.
   * Convenience alias for setVisible(id, true).
   * No-op when the layer is already visible.
   * Stable callback.
   */
  enable: (id: SemanticLayerId) => void;

  /**
   * Disable (hide) a single layer.
   * Convenience alias for setVisible(id, false).
   * No-op when the layer is already hidden.
   * Stable callback.
   */
  disable: (id: SemanticLayerId) => void;

  /**
   * Partially update multiple layer visibilities atomically.
   * Only changed layers trigger a re-render.
   * Stable callback.
   */
  setPartial: (patch: Partial<LayerEngineState>) => void;

  /**
   * Make all 7 layers visible.
   * No-op when all are already active.
   * Stable callback.
   */
  activateAll: () => void;

  /**
   * Hide all 7 layers.
   * No-op when all are already hidden.
   * Stable callback.
   */
  deactivateAll: () => void;

  /**
   * Reset to the default visibility state.
   * No-op when state already equals defaults.
   * Stable callback.
   */
  reset: () => void;

  /**
   * Ordered static metadata array for all 7 layers.
   * Use for rendering the layer picker UI (labels, colors, shortcuts).
   * Always the same object reference — safe for use as a stable dep.
   */
  registry: typeof LAYER_REGISTRY;

  /**
   * Escape hatch: the underlying LayerEngine instance.
   * Prefer the stable callbacks above over calling engine methods directly
   * in render paths.
   */
  engine: LayerEngine;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * React hook that exposes the INVENTORY map layer engine.
 *
 * @param engineOverride  Optional externally-created engine (e.g., from a
 *   context).  When omitted the hook creates its own stable instance.
 * @param initialState    Initial visibility overrides applied only when the
 *   hook creates its own engine (ignored when `engineOverride` is provided).
 */
export function useLayerEngine(
  engineOverride?: LayerEngine,
  initialState?: Partial<LayerEngineState>
): UseLayerEngineReturn {
  // ── Stable engine instance ───────────────────────────────────────────────
  //
  // When no external engine is provided, create one via useRef so the same
  // instance survives re-renders.  `initialState` is only applied once (on
  // first render) via `useRef`'s lazy initializer pattern.
  const internalEngineRef = useRef<LayerEngine | null>(null);

  if (!internalEngineRef.current && !engineOverride) {
    internalEngineRef.current = new LayerEngine(initialState);
  }

  const engine = engineOverride ?? internalEngineRef.current!;

  // ── useSyncExternalStore integration ─────────────────────────────────────
  //
  // `subscribe` and `getState` are stable references bound to the engine.
  // The SSR snapshot uses DEFAULT_LAYER_ENGINE_STATE so the server render
  // matches the client's initial render (no hydration mismatch).
  //
  // We wrap engine.subscribe in useCallback to produce a stable reference
  // that React's reconciler can compare across renders.  If `engine` itself
  // changes (e.g., due to context switch), the new subscribe reference is
  // captured automatically.
  const subscribe = useCallback(
    (onStoreChange: () => void) => engine.subscribe(() => onStoreChange()),
    [engine]
  );

  const getSnapshot = useCallback(
    () => engine.getState(),
    [engine]
  );

  const getServerSnapshot = useCallback(
    () => DEFAULT_LAYER_ENGINE_STATE,
    []
  );

  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // ── Stable action callbacks ───────────────────────────────────────────────
  //
  // All actions are memoized against `engine` — they remain stable as long
  // as the same engine instance is in use, preventing unnecessary child
  // re-renders due to prop identity changes.

  const isVisible = useCallback(
    (id: SemanticLayerId) => state[id],
    [state]
  );

  const toggle = useCallback(
    (id: SemanticLayerId) => engine.toggle(id),
    [engine]
  );

  const setVisible = useCallback(
    (id: SemanticLayerId, visible: boolean) => engine.setVisible(id, visible),
    [engine]
  );

  const enable = useCallback(
    (id: SemanticLayerId) => engine.enable(id),
    [engine]
  );

  const disable = useCallback(
    (id: SemanticLayerId) => engine.disable(id),
    [engine]
  );

  const setPartial = useCallback(
    (patch: Partial<LayerEngineState>) => engine.setPartial(patch),
    [engine]
  );

  const activateAll = useCallback(
    () => engine.activateAll(),
    [engine]
  );

  const deactivateAll = useCallback(
    () => engine.deactivateAll(),
    [engine]
  );

  const reset = useCallback(
    () => engine.reset(),
    [engine]
  );

  // ── Return value ──────────────────────────────────────────────────────────
  //
  // `registry` is the same frozen array every render — no useMemo needed.
  // Wrap in useMemo only the object that bundles everything together so
  // consumers can destructure without breaking referential equality checks
  // in subtrees that accept the full return value as a prop.
  return useMemo(
    () => ({
      state,
      isVisible,
      toggle,
      enable,
      disable,
      setVisible,
      setPartial,
      activateAll,
      deactivateAll,
      reset,
      registry: LAYER_REGISTRY,
      engine,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, engine, isVisible, toggle, enable, disable, setVisible, setPartial, activateAll, deactivateAll, reset]
  );
}
