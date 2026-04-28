/**
 * useMapUrlState — React hook for reading and writing INVENTORY map state
 * from / to the browser URL using Next.js App Router primitives.
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
 *   setMapState({ view: "M3" }, { replace: false }); // push
 */

"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { MapUrlState } from "@/types/map";
import {
  decodeMapUrlState,
  mergeMapUrlState,
  sanitizeMapDeepLink,
} from "@/lib/map-url-params";

// ─── Hook options ─────────────────────────────────────────────────────────────

export interface SetMapStateOptions {
  /**
   * When true (default) the current history entry is replaced.
   * Set to false to push a new entry (enables back-button navigation).
   */
  replace?: boolean;
  /**
   * Optional path prefix.  Defaults to the current pathname so the
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
 * Must be used inside a component tree that is wrapped by Next.js
 * `<Suspense>` (required for `useSearchParams` in Server Components).
 *
 * @param defaultPathname  Fallback pathname when `window` is not available
 *                         (e.g. during SSR).  Defaults to "/inventory".
 */
export function useMapUrlState(
  defaultPathname = "/inventory"
): UseMapUrlStateReturn {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Decode current URL state (memoised by searchParams reference)
  const mapState = decodeMapUrlState(searchParams);

  const setMapState: SetMapState = useCallback(
    (patch, options = {}) => {
      const { replace = true, pathname } = options;

      const next = mergeMapUrlState(mapState, patch);

      // Resolve pathname: prefer caller override → browser location → default
      const resolvedPathname =
        pathname ??
        (typeof window !== "undefined" ? window.location.pathname : defaultPathname);

      const url = `${resolvedPathname}?${next.toString()}`;

      if (replace) {
        router.replace(url);
      } else {
        router.push(url);
      }
    },
    [mapState, router, defaultPathname]
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
