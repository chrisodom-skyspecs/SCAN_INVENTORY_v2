/**
 * MapStateProvider — React integration for MapStateStore with URL sync.
 *
 * Architecture
 * ────────────
 * The URL is the authoritative source of truth for MapUrlState.
 *
 * Hydration (URL → state):
 *   On every render, `useSearchParams()` provides the live URL params.
 *   `decodeMapUrlState` converts them to a typed `MapUrlState` object.
 *   This means browser back/forward navigation automatically reflects
 *   in the map state without any extra subscription.
 *
 * URL push (state → URL):
 *   `setUrlState(patch)` merges the patch into the current URL state,
 *   serialises it, and calls `router.replace()` (or `router.push()` for
 *   history-entry navigation).  Next.js then re-renders with the new
 *   `useSearchParams()` values, completing the loop.
 *
 * Ephemeral state:
 *   Managed via `useReducer` and exposed through the same context.
 *   Never written to the URL.
 *
 * Usage
 * ─────
 * Wrap the inventory route segment (or the whole app layout) in
 * `<MapStateProvider>`.  Consume via `useMapState()` or the more
 * focused selector hooks (`useMapView`, `useSelectedCase`, etc.).
 *
 *   // app/inventory/layout.tsx
 *   import { MapStateProvider } from "@/providers/map-state-provider";
 *   export default function Layout({ children }) {
 *     return (
 *       <Suspense>
 *         <MapStateProvider>{children}</MapStateProvider>
 *       </Suspense>
 *     );
 *   }
 *
 * Note: This component uses `useSearchParams()` which requires a
 * `<Suspense>` boundary ancestor in Next.js App Router.
 */

"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { MapUrlState } from "@/types/map";
import { MAP_URL_STATE_DEFAULTS } from "@/types/map";
import {
  mergeMapUrlState,
  sanitizeMapDeepLink,
} from "@/lib/map-url-params";
import type {
  MapEphemeralState,
  MapState,
} from "@/stores/map-state-store";
import { DEFAULT_EPHEMERAL_STATE } from "@/stores/map-state-store";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface SetUrlStateOptions {
  /**
   * When true (default) the current history entry is replaced.
   * Pass `false` to push a new entry and enable back-button navigation.
   */
  replace?: boolean;
  /**
   * Override the pathname portion of the URL.
   * Defaults to the current Next.js pathname.
   */
  pathname?: string;
}

// ─── Context value ────────────────────────────────────────────────────────────

export interface MapStateContextValue {
  /** Full combined state (URL fields + ephemeral). */
  state: MapState;

  /**
   * Apply a partial patch to URL-serialised state and push it to the URL.
   *
   * @example
   * setUrlState({ view: "M2" });           // replace current history entry
   * setUrlState({ view: "M3" }, { replace: false }); // push new entry
   */
  setUrlState: (
    patch: Partial<MapUrlState>,
    options?: SetUrlStateOptions
  ) => void;

  /**
   * Apply a partial patch to ephemeral (non-URL) state only.
   */
  setEphemeral: (patch: Partial<MapEphemeralState>) => void;

  /**
   * Reset URL state to defaults and navigate to the clean pathname.
   */
  resetUrlState: (options?: Pick<SetUrlStateOptions, "replace">) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const MapStateContext = createContext<MapStateContextValue | null>(null);
MapStateContext.displayName = "MapStateContext";

// ─── Ephemeral reducer ────────────────────────────────────────────────────────

function ephemeralReducer(
  state: MapEphemeralState,
  patch: Partial<MapEphemeralState>
): MapEphemeralState {
  return { ...state, ...patch };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface MapStateProviderProps {
  children: ReactNode;
  /**
   * Override the default pathname used when `options.pathname` is not
   * provided to `setUrlState` / `resetUrlState`.
   *
   * Useful in tests or Storybook where `usePathname()` may return "/".
   */
  defaultPathname?: string;
}

/**
 * MapStateProvider
 *
 * Provides map state to its subtree via React Context.  URL sync is
 * automatic: reading state always reflects the current URL; writing
 * state always pushes a URL change.
 *
 * Must be rendered inside a `<Suspense>` boundary (Next.js requirement
 * for components that call `useSearchParams()`).
 */
export function MapStateProvider({
  children,
  defaultPathname = "/inventory",
}: MapStateProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── URL state: derived from URL on each render ──────────────────────
  // `useSearchParams()` returns a stable reference that only changes when
  // the URL query string changes.  Memoising with it as a dependency means
  // `urlState` is recomputed only when the URL actually changes.
  //
  // `sanitizeMapDeepLink` is used instead of `decodeMapUrlState` so that:
  //   • Invalid / malformed params are sanitized before hydration.
  //   • Dev-mode warnings surface URL-tampering or stale bookmarks.
  const urlState = useMemo(() => {
    const { state, warnings } = sanitizeMapDeepLink(searchParams);
    if (process.env.NODE_ENV === "development" && warnings.length > 0) {
      warnings.forEach((w) =>
        console.warn("[MapStateProvider] Deep-link sanitization:", w)
      );
    }
    return state;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  // ── Ephemeral state ─────────────────────────────────────────────────
  const [ephemeral, dispatchEphemeral] = useReducer(
    ephemeralReducer,
    DEFAULT_EPHEMERAL_STATE
  );

  // ── Stable refs for mutable-but-non-reactive values ────────────────
  // Using refs for router, pathname, and urlState lets all callbacks stay
  // stable across renders.  The values they close over are always current
  // because the ref is updated synchronously on every render.
  const routerRef = useRef(router);
  routerRef.current = router;

  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const defaultPathnameRef = useRef(defaultPathname);
  defaultPathnameRef.current = defaultPathname;

  // urlStateRef lets setUrlState be stable even though it needs the
  // latest URL state for merging.
  const urlStateRef = useRef(urlState);
  urlStateRef.current = urlState;

  // ── setUrlState ─────────────────────────────────────────────────────
  const setUrlState = useCallback(
    (
      patch: Partial<MapUrlState>,
      options: SetUrlStateOptions = {}
    ): void => {
      const { replace = true, pathname: pathnameOverride } = options;

      const merged = mergeMapUrlState(urlStateRef.current, patch);
      const resolvedPathname =
        pathnameOverride ??
        pathnameRef.current ??
        defaultPathnameRef.current;

      const qs = merged.toString();
      const url = qs ? `${resolvedPathname}?${qs}` : resolvedPathname;

      if (replace) {
        routerRef.current.replace(url);
      } else {
        routerRef.current.push(url);
      }
    },
    // No deps: all values are accessed via refs which are always current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── setEphemeral ────────────────────────────────────────────────────
  const setEphemeral = useCallback(
    (patch: Partial<MapEphemeralState>): void => {
      dispatchEphemeral(patch);
    },
    []
  );

  // ── resetUrlState ───────────────────────────────────────────────────
  const resetUrlState = useCallback(
    (options: Pick<SetUrlStateOptions, "replace"> = {}): void => {
      const { replace = true } = options;
      const resolvedPathname =
        pathnameRef.current ?? defaultPathnameRef.current;

      if (replace) {
        routerRef.current.replace(resolvedPathname);
      } else {
        routerRef.current.push(resolvedPathname);
      }
    },
    // No deps: all values accessed via stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── Combined state ──────────────────────────────────────────────────
  const state = useMemo<MapState>(
    () => ({ ...urlState, ephemeral }),
    [urlState, ephemeral]
  );

  // ── Context value ───────────────────────────────────────────────────
  const value = useMemo<MapStateContextValue>(
    () => ({ state, setUrlState, setEphemeral, resetUrlState }),
    [state, setUrlState, setEphemeral, resetUrlState]
  );

  return (
    <MapStateContext.Provider value={value}>
      {children}
    </MapStateContext.Provider>
  );
}

// ─── Consumer hook ────────────────────────────────────────────────────────────

/**
 * Returns the full `MapStateContextValue`.
 * Throws if called outside a `<MapStateProvider>`.
 */
export function useMapState(): MapStateContextValue {
  const ctx = useContext(MapStateContext);
  if (ctx === null) {
    throw new Error(
      "useMapState() must be called inside a <MapStateProvider>. " +
        "Wrap the relevant route segment with <MapStateProvider>."
    );
  }
  return ctx;
}

// ─── Selector hooks ───────────────────────────────────────────────────────────
//
// These hooks are thin wrappers that extract a single field from the state.
// They re-render only when that specific field changes because they pull
// from the memoised `state` object (primitive or stable-ref comparison).

/** Returns the active MapView ("M1" … "M5"). */
export function useMapView() {
  return useMapState().state.view;
}

/** Returns the selected case Convex ID, or null. */
export function useSelectedCase() {
  return useMapState().state.case;
}

/** Returns the active case-detail window ("T1" … "T5"). */
export function useCaseWindow() {
  return useMapState().state.window;
}

/** Returns whether the case detail panel is explicitly open. */
export function usePanelOpen() {
  return useMapState().state.panelOpen;
}

/** Returns the active layer ID array. */
export function useMapLayers() {
  return useMapState().state.layers;
}

/** Returns the active org filter ID, or null. */
export function useOrgFilter() {
  return useMapState().state.org;
}

/** Returns the active kit filter ID, or null. */
export function useKitFilter() {
  return useMapState().state.kit;
}

/** Returns the mission-replay timestamp, or null. */
export function useReplayAt() {
  return useMapState().state.at;
}

/** Returns the ephemeral state object. */
export function useMapEphemeral() {
  return useMapState().state.ephemeral;
}

/** Returns only the `setUrlState` setter (stable reference). */
export function useSetMapUrlState() {
  return useMapState().setUrlState;
}

/** Returns only the `setEphemeral` setter (stable reference). */
export function useSetMapEphemeral() {
  return useMapState().setEphemeral;
}

/** Returns only the `resetUrlState` action (stable reference). */
export function useResetMapUrlState() {
  return useMapState().resetUrlState;
}

// ─── Server-side helper (re-exported for convenience) ────────────────────────

export {
  /**
   * Decode map state from a Next.js Server Component's `searchParams` prop.
   *
   * @example
   * // app/inventory/page.tsx
   * export default async function Page({ searchParams }) {
   *   const initialState = decodeServerMapUrlState(await searchParams);
   *   return <MapStateProvider>{...}</MapStateProvider>
   * }
   */
  decodeServerMapUrlState,
} from "@/hooks/use-map-url-state";

// ─── Default export for lazy-loading ─────────────────────────────────────────

export default MapStateProvider;
