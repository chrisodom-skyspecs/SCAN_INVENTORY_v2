/**
 * useMapUrlHydration — initialize a MapStateStore from URL search params at mount.
 *
 * Architecture
 * ────────────
 * This module provides three hooks that cover the "URL → store" hydration path
 * described in Sub-AC 12b:
 *
 *   1. useInitialMapUrlState  — pure read: validate URL params, return MapUrlState
 *   2. useMapUrlHydration     — call store.hydrate() with parsed URL params at mount
 *   3. useMapUrlHydratedStore — create a MapStateStore pre-initialized from URL params
 *
 * Design decisions
 * ────────────────
 * • "At mount" means we read the URL params once, during the first render, so
 *   the initial store state is ready before any child component reads it.
 *   Subsequent URL changes (back/forward navigation) are out of scope for these
 *   hooks — use MapStateProvider for continuous URL sync.
 *
 * • Synchronous first-render parse (ref pattern, not useMemo) avoids the
 *   double-invocation issue in React StrictMode and guarantees the parsed state
 *   is stable for the entire component lifetime.
 *
 * • The hydrate() call in useMapUrlHydration is deferred to a useEffect so that
 *   store mutations do not occur inside the React render phase.
 *
 * • Invalid / missing URL params fall back to MAP_URL_STATE_DEFAULTS via
 *   sanitizeMapDeepLink.  All fallbacks are logged in development as console
 *   warnings so URL-tampering or stale bookmarks surface immediately.
 *
 * Requirements
 * ────────────
 * All three hooks require a <Suspense> boundary ancestor because they call
 * useSearchParams() — a Next.js App Router requirement.
 *
 * Usage
 * ─────
 * // 1. Read-only: just get the parsed initial URL state
 * const { state, warnings } = useInitialMapUrlState();
 *
 * // 2. Hydrate an externally managed store at mount
 * const store = useMemo(() => new MapStateStore(), []);
 * useMapUrlHydration(store);
 *
 * // 3. Create a store pre-initialized with URL params (most common)
 * const store = useMapUrlHydratedStore();
 */

"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";

import { sanitizeMapDeepLink } from "@/lib/map-url-params";
import { MapStateStore } from "@/stores/map-state-store";
import type { MapUrlState } from "@/types/map";

// ─── Re-export for consumers ──────────────────────────────────────────────────

export type { MapUrlState };

// ─── Internal type ────────────────────────────────────────────────────────────

/** Return value of useInitialMapUrlState. */
export interface InitialMapUrlStateResult {
  /**
   * Fully validated MapUrlState derived from the URL search params at mount.
   *
   * Every field is guaranteed to be a valid value — missing or invalid params
   * are replaced with their defaults from MAP_URL_STATE_DEFAULTS.
   */
  state: MapUrlState;

  /**
   * Human-readable descriptions of every param that was sanitized or
   * defaulted because the raw URL value was absent or invalid.
   *
   * Empty when all URL params were clean.  Populated when the URL contained
   * unknown enum values, malformed timestamps, or overly-long ID strings.
   */
  warnings: string[];
}

// ─── useInitialMapUrlState ────────────────────────────────────────────────────

/**
 * Read and validate URL search params at the initial render.
 *
 * Returns a `MapUrlState` parsed from the current `useSearchParams()` value,
 * with each param validated against its schema.  Invalid or missing params
 * fall back to their defaults from `MAP_URL_STATE_DEFAULTS`.
 *
 * Behaviour
 * ─────────
 * • Runs synchronously during the first render using the ref pattern, not
 *   useMemo, so the result is stable for the component's lifetime even in
 *   React StrictMode.
 * • Subsequent calls (re-renders) return the same cached result — this hook
 *   is intentionally read-once.  For continuous URL tracking use
 *   MapStateProvider or useMapUrlState.
 * • In development, a console.warn is emitted for every sanitized param
 *   so stale bookmarks or URL tampering surface immediately.
 *
 * Must be called inside a <Suspense> boundary (Next.js requirement for
 * useSearchParams in App Router).
 *
 * @returns `{ state: MapUrlState, warnings: string[] }`
 */
export function useInitialMapUrlState(): InitialMapUrlStateResult {
  const searchParams = useSearchParams();

  // Parse once — the ref pattern guarantees a single execution regardless of
  // React StrictMode double-invocations or subsequent re-renders.
  const resultRef = useRef<InitialMapUrlStateResult | null>(null);

  if (!resultRef.current) {
    const { state, warnings } = sanitizeMapDeepLink(searchParams);
    resultRef.current = { state, warnings };

    // Surface sanitization events immediately in development.
    // Logging here (during render) rather than in a useEffect ensures the
    // warnings appear before any child components that might read the store.
    if (process.env.NODE_ENV === "development" && warnings.length > 0) {
      warnings.forEach((w) =>
        console.warn("[useInitialMapUrlState] Deep-link sanitization:", w)
      );
    }
  }

  return resultRef.current;
}

// ─── useMapUrlHydration ───────────────────────────────────────────────────────

/**
 * Hydrate a MapStateStore from URL search params at mount.
 *
 * On the initial render, reads and validates the current URL search params
 * via `useInitialMapUrlState` (using `sanitizeMapDeepLink` under the hood),
 * then calls `store.hydrate(parsedState)` inside a `useEffect` to initialize
 * the store without mutating it during the React render phase.
 *
 * Falls back to `MAP_URL_STATE_DEFAULTS` for every missing or invalid param.
 *
 * Subsequent renders and URL changes are ignored — this hook is exclusively
 * for one-time initial-load hydration.  For continuous URL ↔ store sync (e.g.,
 * on browser back/forward navigation), use MapStateProvider instead.
 *
 * The `hydrate()` call is skipped if the store's URL state is already identical
 * to the parsed state (the store's own diff check prevents spurious emissions).
 *
 * Must be called inside a <Suspense> boundary (Next.js requirement for
 * useSearchParams in App Router).
 *
 * @param store — the MapStateStore instance to hydrate on mount
 *
 * @example
 * // In a component or provider that manages the store:
 * const store = useMemo(() => new MapStateStore(), []);
 * useMapUrlHydration(store);
 */
export function useMapUrlHydration(store: MapStateStore): void {
  const { state } = useInitialMapUrlState();

  // Track whether hydration has run — prevents repeat calls if the parent
  // re-renders the component (e.g., StrictMode) before the cleanup fires.
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;

    // store.hydrate() is a no-op when the URL state hasn't changed, so
    // we can call it unconditionally without worrying about spurious updates.
    store.hydrate(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — fires exactly once at mount
}

// ─── useMapUrlHydratedStore ───────────────────────────────────────────────────

/**
 * Create a MapStateStore pre-initialized from URL search params.
 *
 * Combines store creation with URL hydration in a single hook:
 *
 *   1. Reads URL search params synchronously during the first render via
 *      `useInitialMapUrlState` (calls `sanitizeMapDeepLink` internally).
 *   2. Creates a `MapStateStore` instance with the parsed URL state passed
 *      directly to the constructor — the store is ready for subscribers
 *      from the very first render without any additional `hydrate()` call.
 *   3. Returns the stable store reference — the same instance for the full
 *      component lifetime.
 *
 * Invariants
 * ──────────
 * • The store instance is created exactly once per component mount.
 * • The store reference is stable — it never changes across re-renders.
 * • Invalid / missing URL params default to MAP_URL_STATE_DEFAULTS values.
 * • Dev-mode warnings are emitted for every sanitized param.
 *
 * Must be called inside a <Suspense> boundary (Next.js requirement for
 * useSearchParams in App Router).
 *
 * @returns a stable `MapStateStore` instance pre-initialized with the URL's
 *          validated search params (or defaults where params are absent/invalid)
 *
 * @example
 * function MapProvider({ children }) {
 *   const store = useMapUrlHydratedStore();
 *   // store is ready: store.getUrlState() reflects the URL params from page load
 *   return (
 *     <MapStoreContext.Provider value={store}>
 *       {children}
 *     </MapStoreContext.Provider>
 *   );
 * }
 */
export function useMapUrlHydratedStore(): MapStateStore {
  const { state: initialState } = useInitialMapUrlState();

  // Create the store once with the parsed URL state as the initial value.
  // The ref pattern ensures the constructor is called only on the first render.
  // Passing `initialState` to the constructor means subscribers see the correct
  // URL-derived state from the very first read — no hydration effect needed.
  const storeRef = useRef<MapStateStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new MapStateStore(initialState);
  }

  return storeRef.current;
}
