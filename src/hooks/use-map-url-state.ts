/**
 * useMapUrlState — React hook for reading and writing INVENTORY map state
 * from / to the browser URL.
 *
 * Sub-AC 3 (AC 110103): The encode side of the URL codec is wired directly
 * into the write path so that every state update calls
 * window.history.replaceState() (or pushState for explicit pushes), keeping
 * the address bar in sync WITHOUT triggering a Next.js navigation event.
 *
 * Architecture
 * ────────────
 * URL state is owned by a local useState (not derived from useSearchParams on
 * every render) so that history.replaceState — which does not update the
 * Next.js router — can still drive React re-renders.
 *
 * Read path (URL → state):
 *   On mount, the state is initialised from the URL params read through
 *   useSearchParams().  A popstate listener handles subsequent back/forward
 *   navigation by re-parsing window.location.search.
 *
 * Write path (state → URL):
 *   setMapState(patch) merges the patch with the current state via
 *   mergeMapUrlState (encodes only non-default params), then:
 *     replace=true  → window.history.replaceState(null, "", url)
 *     replace=false → window.history.pushState(null, "", url)
 *   After writing to the browser history, setMapState also calls the internal
 *   React state setter so that hook consumers re-render immediately.
 *
 * Usage (in a Client Component inside /app/inventory):
 *
 *   const [mapState, setMapState] = useMapUrlState();
 *
 *   // Read
 *   console.log(mapState.view);  // "M1"
 *
 *   // Write (replace or push history entry)
 *   setMapState({ view: "M2", case: "abc123" });
 *   setMapState({ view: "M3" }, { replace: false }); // push new entry
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { MapUrlState } from "@/types/map";
import {
  decodeMapUrlState,
  mergeMapUrlState,
  sanitizeMapDeepLink,
} from "@/lib/map-url-params";

// ─── Hook options ─────────────────────────────────────────────────────────────

export interface SetMapStateOptions {
  /**
   * When true (default) the current history entry is replaced via
   * window.history.replaceState — no navigation event is fired.
   *
   * Set to false to push a new history entry via window.history.pushState,
   * which still produces no navigation event but does enable Back-button
   * navigation back to the previous URL.
   */
  replace?: boolean;
  /**
   * Optional path prefix.  Defaults to window.location.pathname so the
   * hook can be used without knowing the route.
   */
  pathname?: string;
}

// ─── Hook return type ─────────────────────────────────────────────────────────

export type SetMapState = (
  patch: Partial<MapUrlState>,
  options?: SetMapStateOptions
) => void;

export type UseMapUrlStateReturn = [MapUrlState, SetMapState];

// ─── Hook implementation ──────────────────────────────────────────────────────

/**
 * Read / write INVENTORY map state via URL search params.
 *
 * State is owned locally (useState); the URL is kept in sync via
 * window.history.replaceState / pushState on every write.  A popstate
 * listener re-hydrates state when the user presses Back or Forward.
 *
 * Must be used inside a component tree that is wrapped by Next.js
 * `<Suspense>` (required for `useSearchParams` in App Router).
 *
 * @param defaultPathname  Fallback pathname when `window` is not available
 *                         (e.g. during SSR).  Defaults to "/inventory".
 */
export function useMapUrlState(
  defaultPathname = "/inventory"
): UseMapUrlStateReturn {
  const searchParams = useSearchParams();

  // ── Internal state (source of truth) ────────────────────────────────────
  // Initialise from the URL params available at the first render.
  // After mount, this state is driven by:
  //   • setMapState (write path) — updates on every user interaction
  //   • popstate listener (read path) — updates on browser back/forward
  const [mapState, setMapStateInternal] = useState<MapUrlState>(() =>
    decodeMapUrlState(searchParams)
  );

  // Stable refs so callbacks always access the latest values without
  // needing to be re-created on every render.
  const mapStateRef = useRef(mapState);
  mapStateRef.current = mapState;

  const defaultPathnameRef = useRef(defaultPathname);
  defaultPathnameRef.current = defaultPathname;

  // ── Popstate listener (back/forward navigation) ──────────────────────────
  // When the user presses Back or Forward, the browser fires a popstate event.
  // history.replaceState / pushState entries (written by setMapState below)
  // do NOT go through the Next.js router, so useSearchParams() is not updated.
  // We must re-read window.location.search directly in the popstate handler.
  useEffect(() => {
    if (typeof window === "undefined") return;

    function handlePopstate(): void {
      const params = new URLSearchParams(window.location.search);
      const { state, warnings } = sanitizeMapDeepLink(params);

      if (process.env.NODE_ENV === "development" && warnings.length > 0) {
        warnings.forEach((w) =>
          console.warn("[useMapUrlState] popstate sanitization:", w)
        );
      }

      setMapStateInternal(state);
    }

    window.addEventListener("popstate", handlePopstate);
    return () => window.removeEventListener("popstate", handlePopstate);
  }, []);

  // ── Write: encode → history.replaceState (no navigation side-effects) ───
  const setMapState: SetMapState = useCallback(
    (patch, options = {}) => {
      const { replace = true, pathname } = options;

      // ── Encode ────────────────────────────────────────────────────────────
      // mergeMapUrlState delegates to encodeMapUrlState internally:
      //   merge current state with the patch → URLSearchParams
      // Default-valued params are omitted, keeping the URL minimal.
      const next = mergeMapUrlState(mapStateRef.current, patch);

      // ── Resolve pathname ──────────────────────────────────────────────────
      const resolvedPathname =
        pathname ??
        (typeof window !== "undefined"
          ? window.location.pathname
          : defaultPathnameRef.current);

      // Build the full URL string.
      // When qs is empty (all params are at their defaults) the URL reduces
      // to just the pathname — no trailing "?".
      const qs = next.toString();
      const url = qs ? `${resolvedPathname}?${qs}` : resolvedPathname;

      // ── Write to browser history (no navigation side-effects) ─────────────
      // history.replaceState / pushState update the address bar and the
      // browser's history stack without triggering a Next.js navigation event,
      // preventing unnecessary re-renders of the full page tree.
      if (typeof window !== "undefined") {
        if (replace) {
          window.history.replaceState(null, "", url);
        } else {
          window.history.pushState(null, "", url);
        }
      }

      // ── Update React state ────────────────────────────────────────────────
      // history.replaceState does not update useSearchParams(), so we must
      // propagate the change through local state to trigger re-renders.
      const newState = decodeMapUrlState(next);
      setMapStateInternal(newState);
    },
    // Stable: all mutable values are accessed via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return [mapState, setMapState];
}

// ─── Server-side helper ───────────────────────────────────────────────────────

/**
 * Decode and sanitize map state from a server-side searchParams object
 * (passed as a page prop by Next.js App Router).
 *
 * Uses `sanitizeMapDeepLink` so that invalid / malformed URL params are
 * sanitized with per-param defaults before the state is used server-side.
 *
 * Safe to call in Server Components and Route Handlers.
 *
 * @example
 * // app/inventory/page.tsx (Server Component)
 * export default async function InventoryPage({ searchParams }) {
 *   const mapState = decodeServerMapUrlState(await searchParams);
 *   return <InventoryClient initialState={mapState} />;
 * }
 */
export function decodeServerMapUrlState(
  searchParams: Record<string, string | string[] | undefined>
): MapUrlState {
  // Wrap the plain object so it conforms to the `.get()` interface
  const adapter = {
    get(key: string): string | null {
      const value = searchParams[key];
      if (value === undefined) return null;
      // If multiple values for the same key, take the last one
      return Array.isArray(value) ? (value[value.length - 1] ?? null) : value;
    },
  };
  // Use sanitizeMapDeepLink for full validation + fallback handling
  const { state } = sanitizeMapDeepLink(adapter);
  return state;
}
