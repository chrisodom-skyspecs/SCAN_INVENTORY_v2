/**
 * MapStateStore — pure (framework-agnostic) state container for INVENTORY map state.
 *
 * Responsibilities
 * ────────────────
 * • Holds the canonical URL-serialisable map state (`MapUrlState`) plus
 *   ephemeral UI state that is NOT pushed to the URL.
 * • Provides a minimal pub/sub interface so React (or any other consumer)
 *   can subscribe to changes.
 * • Stays framework-agnostic: zero React imports.  URL sync is handled
 *   by the React provider (`MapStateProvider`) that wraps this store.
 *
 * Design decisions
 * ────────────────
 * • Immutable updates — every mutation returns a new state object so
 *   reference equality is sufficient to detect changes.
 * • Ephemeral state lives in the same store but is kept in a separate
 *   `ephemeral` sub-object so consumers can cleanly ignore it when
 *   building URL params.
 * • The store is intentionally small: complex derived state (filtered
 *   case lists, cluster calculations) belongs in selectors or Convex
 *   queries, not here.
 */

import type { MapUrlState } from "@/types/map";
import { MAP_URL_STATE_DEFAULTS } from "@/types/map";
import { diffMapUrlState } from "@/lib/map-url-params";

// ─── Ephemeral state ──────────────────────────────────────────────────────────

/**
 * UI-only state that is NOT serialised to the URL.
 *
 * Reset when the page is navigated away from or the component unmounts.
 */
export interface MapEphemeralState {
  /** True while the Mapbox GL instance is loading tiles / sources. */
  isMapLoading: boolean;
  /** Case Convex ID currently under the mouse cursor (hover highlight). */
  hoveredCaseId: string | null;
  /** Whether the layer-picker panel is open. */
  isLayerPanelOpen: boolean;
  /** Whether the filter drawer is open. */
  isFilterDrawerOpen: boolean;
}

export const DEFAULT_EPHEMERAL_STATE: MapEphemeralState = {
  isMapLoading: false,
  hoveredCaseId: null,
  isLayerPanelOpen: false,
  isFilterDrawerOpen: false,
};

// ─── Combined state ───────────────────────────────────────────────────────────

/**
 * Full map state: URL-serialisable fields + ephemeral UI fields.
 */
export interface MapState extends MapUrlState {
  ephemeral: MapEphemeralState;
}

// ─── Listener type ────────────────────────────────────────────────────────────

/**
 * A function called whenever the store state changes.
 * Receives the full new state; consumers should diff against their
 * local copy if they only care about specific fields.
 */
export type MapStateListener = (state: MapState) => void;

// ─── Change event ─────────────────────────────────────────────────────────────

/**
 * Metadata emitted alongside each state change.
 */
export interface MapStateChangeEvent {
  /** The updated state. */
  state: MapState;
  /** Which URL fields changed (if any). */
  urlDiff: Partial<MapUrlState>;
  /** Whether any ephemeral fields changed. */
  ephemeralChanged: boolean;
}

export type MapStateChangeListener = (event: MapStateChangeEvent) => void;

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * Pure map state container.
 *
 * @example
 * const store = new MapStateStore();
 *
 * // Subscribe to changes
 * const unsub = store.subscribe((state) => console.log(state.view));
 *
 * // Update URL state
 * store.setUrlState({ view: "M2", case: "abc123" });
 *
 * // Update ephemeral state
 * store.setEphemeral({ hoveredCaseId: "xyz" });
 *
 * // Clean up
 * unsub();
 */
export class MapStateStore {
  private _state: MapState;
  private _listeners = new Set<MapStateListener>();
  private _changeListeners = new Set<MapStateChangeListener>();

  constructor(initialUrlState: MapUrlState = MAP_URL_STATE_DEFAULTS) {
    this._state = {
      ...initialUrlState,
      ephemeral: { ...DEFAULT_EPHEMERAL_STATE },
    };
  }

  // ─── Getters ───────────────────────────────────────────────────────────────

  /** Returns the full current state (URL + ephemeral). */
  getState(): MapState {
    return this._state;
  }

  /**
   * Returns only the URL-serialisable portion of the state.
   * Equivalent to calling `encodeMapUrlState(store.getUrlState())`.
   */
  getUrlState(): MapUrlState {
    const { ephemeral: _eph, ...urlState } = this._state;
    return urlState;
  }

  /** Returns only the ephemeral state. */
  getEphemeral(): MapEphemeralState {
    return this._state.ephemeral;
  }

  // ─── Setters ───────────────────────────────────────────────────────────────

  /**
   * Apply a partial patch to the URL state fields.
   *
   * Emits to all subscribers only when the resulting state differs from
   * the current state.
   */
  setUrlState(patch: Partial<MapUrlState>): void {
    const prevUrlState = this.getUrlState();
    const nextUrlState: MapUrlState = { ...prevUrlState, ...patch };
    const urlDiff = diffMapUrlState(prevUrlState, nextUrlState);

    if (Object.keys(urlDiff).length === 0) return; // nothing changed

    this._state = { ...nextUrlState, ephemeral: this._state.ephemeral };
    this._emit(urlDiff, false);
  }

  /**
   * Replace the entire URL state (e.g., on browser back/forward navigation).
   *
   * Unlike `setUrlState`, this replaces all URL fields at once.
   */
  hydrate(urlState: MapUrlState): void {
    const prevUrlState = this.getUrlState();
    const urlDiff = diffMapUrlState(prevUrlState, urlState);

    if (Object.keys(urlDiff).length === 0) return; // URL didn't change

    this._state = { ...urlState, ephemeral: this._state.ephemeral };
    this._emit(urlDiff, false);
  }

  /**
   * Apply a partial patch to the ephemeral state fields.
   */
  setEphemeral(patch: Partial<MapEphemeralState>): void {
    const next = { ...this._state.ephemeral, ...patch };

    // Shallow-compare each field to avoid spurious emissions
    const changed = (Object.keys(patch) as (keyof MapEphemeralState)[]).some(
      (k) => this._state.ephemeral[k] !== next[k]
    );
    if (!changed) return;

    this._state = { ...this._state, ephemeral: next };
    this._emit({}, true);
  }

  /**
   * Reset URL state to defaults and clear all ephemeral state.
   */
  reset(): void {
    const prevUrlState = this.getUrlState();
    const urlDiff = diffMapUrlState(prevUrlState, MAP_URL_STATE_DEFAULTS);
    const ephemeralChanged =
      JSON.stringify(this._state.ephemeral) !==
      JSON.stringify(DEFAULT_EPHEMERAL_STATE);

    if (Object.keys(urlDiff).length === 0 && !ephemeralChanged) return;

    this._state = {
      ...MAP_URL_STATE_DEFAULTS,
      ephemeral: { ...DEFAULT_EPHEMERAL_STATE },
    };
    this._emit(urlDiff, ephemeralChanged);
  }

  // ─── Subscriptions ─────────────────────────────────────────────────────────

  /**
   * Subscribe to any state change.
   * Returns an unsubscribe function.
   */
  subscribe(listener: MapStateListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Subscribe with richer change metadata (URL diff + ephemeral flag).
   * Returns an unsubscribe function.
   */
  onchange(listener: MapStateChangeListener): () => void {
    this._changeListeners.add(listener);
    return () => {
      this._changeListeners.delete(listener);
    };
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private _emit(
    urlDiff: Partial<MapUrlState>,
    ephemeralChanged: boolean
  ): void {
    const state = this._state;
    const event: MapStateChangeEvent = { state, urlDiff, ephemeralChanged };

    this._listeners.forEach((l) => l(state));
    this._changeListeners.forEach((l) => l(event));
  }
}
