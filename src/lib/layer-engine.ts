/**
 * LayerEngine — pure (framework-agnostic) state manager for INVENTORY map layers.
 *
 * Responsibilities
 * ────────────────
 * • Holds the runtime visibility state for the 7 semantic map layers
 *   (deployed, transit, flagged, hangar, heat, history, turbines).
 * • Provides immutable state snapshots — every mutation produces a new
 *   state object so reference equality is sufficient to detect changes.
 * • Exposes a minimal pub/sub interface compatible with React's
 *   `useSyncExternalStore` for zero-overhead React integration.
 * • Has zero React, Convex, or browser dependencies — safe for SSR and tests.
 *
 * Design decisions
 * ────────────────
 * • State is a plain `Record<SemanticLayerId, boolean>` — easy to serialize,
 *   clone, and compare without custom logic.
 * • The registry is consulted only for defaults and validation; it is NOT
 *   stored inside the engine (single source of truth = LAYER_REGISTRY).
 * • Listeners receive the full new state snapshot; diff computation is cheap
 *   because the state is a small fixed-key record.
 *
 * Usage
 * ─────
 *   const engine = new LayerEngine();
 *
 *   // Subscribe
 *   const unsub = engine.subscribe(state => {
 *     console.log("deployed visible:", state.deployed);
 *   });
 *
 *   // Toggle a layer
 *   engine.toggle("deployed");   // off → on or on → off
 *
 *   // Explicitly set visibility
 *   engine.setVisible("heat", true);
 *
 *   // Read current state
 *   const { deployed, transit } = engine.getState();
 *
 *   // Cleanup
 *   unsub();
 *
 * React integration
 * ─────────────────
 * Use the companion `useLayerEngine` hook (src/hooks/use-layer-engine.ts)
 * rather than calling `new LayerEngine()` directly in components.
 */

import type {
  LayerEngineState,
  LayerEngineListener,
  LayerEngineChangeEvent,
  LayerEngineChangeListener,
  SemanticLayerId,
} from "@/types/layer-engine";
import {
  DEFAULT_LAYER_ENGINE_STATE,
  SEMANTIC_LAYER_IDS,
} from "@/types/layer-engine";

// ─── LayerEngine class ────────────────────────────────────────────────────────

/**
 * Pure state manager for the 7 semantic INVENTORY map layers.
 *
 * Create one per "scope" — typically once per inventory page mount via the
 * `useLayerEngine` hook (which uses `useMemo` or `useRef` to ensure a stable
 * instance across re-renders).
 */
export class LayerEngine {
  private _state: LayerEngineState;
  private _listeners = new Set<LayerEngineListener>();
  private _changeListeners = new Set<LayerEngineChangeListener>();

  /**
   * Create a new engine.
   *
   * @param initialState  Optional override for the initial visibility state.
   *   Any key omitted from `initialState` falls back to `DEFAULT_LAYER_ENGINE_STATE`.
   *   Useful when restoring persisted state (URL params, localStorage).
   */
  constructor(initialState?: Partial<LayerEngineState>) {
    this._state = Object.freeze({
      ...DEFAULT_LAYER_ENGINE_STATE,
      ...(initialState ?? {}),
    });
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  /**
   * Returns the current visibility state snapshot.
   *
   * The returned object is frozen and shared with all subscribers — do NOT
   * mutate it.  Each state change produces a new object.
   */
  getState(): LayerEngineState {
    return this._state;
  }

  /**
   * Returns whether a specific layer is currently visible.
   *
   * @example
   * if (engine.isVisible("deployed")) { /* render deployed pins *\/ }
   */
  isVisible(id: SemanticLayerId): boolean {
    return this._state[id];
  }

  /**
   * Returns the set of currently active (visible) layer IDs.
   */
  getActiveLayers(): SemanticLayerId[] {
    return SEMANTIC_LAYER_IDS.filter(
      (id) => this._state[id]
    ) as SemanticLayerId[];
  }

  /**
   * Returns the set of currently inactive (hidden) layer IDs.
   */
  getInactiveLayers(): SemanticLayerId[] {
    return SEMANTIC_LAYER_IDS.filter(
      (id) => !this._state[id]
    ) as SemanticLayerId[];
  }

  // ─── Write ────────────────────────────────────────────────────────────────

  /**
   * Toggle a single layer on or off.
   *
   * If the layer is currently visible it becomes hidden; if hidden it becomes
   * visible.  Emits to subscribers only when the state actually changes
   * (i.e., always — toggle always changes state by definition).
   *
   * @example engine.toggle("heat"); // flip heat map on/off
   */
  toggle(id: SemanticLayerId): void {
    const current = this._state[id];
    this._applyPatch({ [id]: !current } as Partial<LayerEngineState>);
  }

  /**
   * Explicitly set the visibility of a single layer.
   *
   * No-op when the layer is already in the requested state.
   *
   * @example
   * engine.setVisible("turbines", true);   // ensure turbines are shown
   * engine.setVisible("history", false);   // ensure history is hidden
   */
  setVisible(id: SemanticLayerId, visible: boolean): void {
    if (this._state[id] === visible) return; // no-op
    this._applyPatch({ [id]: visible } as Partial<LayerEngineState>);
  }

  /**
   * Enable (make visible) a single layer.
   *
   * Convenience alias for `setVisible(id, true)`.
   * No-op when the layer is already visible.
   *
   * @example engine.enable("heat"); // turn heat map on
   */
  enable(id: SemanticLayerId): void {
    this.setVisible(id, true);
  }

  /**
   * Disable (hide) a single layer.
   *
   * Convenience alias for `setVisible(id, false)`.
   * No-op when the layer is already hidden.
   *
   * @example engine.disable("history"); // hide history overlay
   */
  disable(id: SemanticLayerId): void {
    this.setVisible(id, false);
  }

  /**
   * Replace the entire visibility state atomically.
   *
   * Only emits when at least one layer visibility actually changed.
   *
   * @param state  Full state.  Every SemanticLayerId key must be present.
   *   Use `setPartial` for partial updates.
   */
  setState(state: LayerEngineState): void {
    const diff = this._diff(this._state, state);
    if (Object.keys(diff).length === 0) return; // nothing changed
    this._state = Object.freeze({ ...state });
    this._emit(diff);
  }

  /**
   * Partially update the visibility state.
   *
   * Only the provided keys are changed; others are preserved.
   * No-op when all provided values equal the current values.
   *
   * @example
   * engine.setPartial({ heat: true, history: true }); // enable two layers
   */
  setPartial(patch: Partial<LayerEngineState>): void {
    this._applyPatch(patch);
  }

  /**
   * Make all 7 layers visible.
   *
   * No-op when all layers are already active.
   */
  activateAll(): void {
    const allActive: LayerEngineState = Object.fromEntries(
      SEMANTIC_LAYER_IDS.map((id) => [id, true])
    ) as LayerEngineState;
    this.setState(allActive);
  }

  /**
   * Hide all 7 layers.
   *
   * No-op when all layers are already hidden.
   */
  deactivateAll(): void {
    const allHidden: LayerEngineState = Object.fromEntries(
      SEMANTIC_LAYER_IDS.map((id) => [id, false])
    ) as LayerEngineState;
    this.setState(allHidden);
  }

  /**
   * Reset to the default visibility state defined in `DEFAULT_LAYER_ENGINE_STATE`.
   *
   * No-op when the current state already equals the defaults.
   */
  reset(): void {
    this.setState({ ...DEFAULT_LAYER_ENGINE_STATE });
  }

  // ─── Subscriptions ────────────────────────────────────────────────────────

  /**
   * Subscribe to state changes.
   *
   * The listener is called with the full new state snapshot after every
   * change.  Returns an unsubscribe function.
   *
   * Compatible with React's `useSyncExternalStore` subscription signature:
   *
   * @example
   * const state = useSyncExternalStore(
   *   engine.subscribe.bind(engine),
   *   engine.getState.bind(engine),
   *   () => DEFAULT_LAYER_ENGINE_STATE
   * );
   */
  subscribe(listener: LayerEngineListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Subscribe with richer change metadata (diff of changed layers).
   * Returns an unsubscribe function.
   *
   * @example
   * engine.onchange(({ diff }) => {
   *   for (const [id, visible] of Object.entries(diff)) {
   *     console.log(`Layer "${id}" is now ${visible ? "on" : "off"}`);
   *   }
   * });
   */
  onchange(listener: LayerEngineChangeListener): () => void {
    this._changeListeners.add(listener);
    return () => {
      this._changeListeners.delete(listener);
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /**
   * Apply a partial patch and emit if any field changed.
   */
  private _applyPatch(patch: Partial<LayerEngineState>): void {
    const next = { ...this._state, ...patch };
    const diff = this._diff(this._state, next);
    if (Object.keys(diff).length === 0) return; // nothing changed
    this._state = Object.freeze(next);
    this._emit(diff);
  }

  /**
   * Compute the diff between two states.
   * Returns only keys whose values changed.
   */
  private _diff(
    prev: LayerEngineState,
    next: LayerEngineState
  ): Partial<LayerEngineState> {
    // Use a mutable intermediate record to accumulate the diff, then cast
    // to `Partial<LayerEngineState>` for the return type.  This avoids
    // TypeScript's "cannot assign to read-only property" error that arises
    // when iterating over a `Partial<Readonly<Record<…>>>`.
    const diff: Record<string, boolean> = {};
    for (const id of SEMANTIC_LAYER_IDS) {
      if (prev[id] !== next[id]) {
        diff[id] = next[id];
      }
    }
    return diff as Partial<LayerEngineState>;
  }

  /**
   * Notify all subscribers with the current state and diff.
   */
  private _emit(diff: Partial<LayerEngineState>): void {
    const state = this._state;
    const event: LayerEngineChangeEvent = { state, diff };
    this._listeners.forEach((l) => l(state));
    this._changeListeners.forEach((l) => l(event));
  }
}
