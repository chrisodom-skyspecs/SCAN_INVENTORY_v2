/**
 * useMapStoreSyncToUrl — keeps the browser address bar in sync with a
 * MapStateStore by calling window.history.replaceState() whenever URL
 * state changes inside the store.
 *
 * Sub-AC 12c: "Sync map state changes back to URL — reactively write all
 * 7 params to the URL via replaceState whenever map store state changes,
 * keeping URL as the single source of truth."
 *
 * Architecture
 * ────────────
 * The hook completes the URL ↔ store round-trip:
 *
 *   URL → store  (hydration, handled by useMapUrlHydratedStore / useMapUrlHydration)
 *   store → URL  (this hook)
 *
 * On every store change event where at least one URL field changed (i.e.,
 * `event.urlDiff` is non-empty), the hook:
 *   1. Encodes the full URL state via encodeMapUrlState() — only non-default
 *      params are emitted, keeping URLs clean and minimal.
 *   2. Builds the new URL string (pathname + "?" + query string).
 *   3. Calls window.history.replaceState() so the address bar reflects the
 *      current store state without triggering a navigation event or causing
 *      React to re-render.
 *
 * Ephemeral-only changes (hoveredCaseId, isMapLoading, layerToggles, etc.)
 * produce an empty `urlDiff` and are completely skipped — they never write
 * to the URL.
 *
 * Deduplication
 * ─────────────
 * replaceState is called only when `event.urlDiff` contains at least one key.
 * This means a rapid sequence of ephemeral mutations (e.g., hover in/out at
 * 60 fps) never touches the browser history.
 *
 * Pathname resolution
 * ───────────────────
 * By default the hook reads window.location.pathname lazily inside the
 * callback so it always picks up the live pathname even if the component
 * has navigated since mount.  Pass `options.pathname` to pin the pathname
 * for tests or controlled environments.
 *
 * Lifecycle
 * ─────────
 * The store subscription is established in a useEffect (runs once at mount)
 * and torn down in the cleanup function (runs at unmount or when the store
 * instance changes).  The hook never leaks subscriptions.
 *
 * Usage
 * ─────
 * // Typical usage: pair with useMapUrlHydratedStore for a full URL↔store sync:
 *
 *   "use client";
 *   function MapProvider({ children }) {
 *     // 1. URL → store: initialize store from URL params at mount
 *     const store = useMapUrlHydratedStore();
 *
 *     // 2. store → URL: keep address bar in sync when store changes
 *     useMapStoreSyncToUrl(store);
 *
 *     return (
 *       <MapStoreContext.Provider value={store}>
 *         {children}
 *       </MapStoreContext.Provider>
 *     );
 *   }
 *
 * Must be rendered inside a React component tree (client component).
 * Does NOT require a <Suspense> boundary.
 */

"use client";

import { useEffect, useRef } from "react";

import { MapStateStore } from "@/stores/map-state-store";
import { encodeMapUrlState } from "@/lib/map-url-params";

// ─── Options ──────────────────────────────────────────────────────────────────

/**
 * Optional configuration for useMapStoreSyncToUrl.
 */
export interface UseMapStoreSyncToUrlOptions {
  /**
   * Override the pathname portion of the URL written by replaceState.
   *
   * When provided, this pathname is used for every replaceState call,
   * regardless of window.location.pathname.
   *
   * Useful in tests (where window.location.pathname may be "/") and in
   * controlled environments where the pathname is known ahead of time.
   *
   * When omitted, window.location.pathname is read lazily inside the
   * change callback so the hook adapts to navigations that occur after mount.
   *
   * @default window.location.pathname (evaluated at each change event)
   */
  pathname?: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to a MapStateStore and reactively write all URL params to the
 * browser address bar via window.history.replaceState() whenever the
 * URL-serialisable portion of the store state changes.
 *
 * Serialised URL params (all 8 fields):
 *   view    — map mode (M1–M5)
 *   case    — selected case Convex ID (or absent when null)
 *   window  — case detail layout (T1–T5)
 *   panel   — panel open flag ("1" when true, absent when false)
 *   layers  — comma-separated overlay layer IDs
 *   org     — organisation filter Convex ID (or absent when null)
 *   kit     — kit/template filter Convex ID (or absent when null)
 *   at      — mission-replay ISO-8601 timestamp (or absent when null)
 *
 * @param store    The MapStateStore instance to subscribe to.
 * @param options  Optional configuration (see UseMapStoreSyncToUrlOptions).
 *
 * @example
 * const store = useMapUrlHydratedStore();
 * useMapStoreSyncToUrl(store);
 *
 * @example
 * // Pin pathname in tests
 * useMapStoreSyncToUrl(store, { pathname: "/inventory" });
 */
export function useMapStoreSyncToUrl(
  store: MapStateStore,
  options: UseMapStoreSyncToUrlOptions = {}
): void {
  const { pathname } = options;

  // Keep the pathname override stable across re-renders using a ref so the
  // subscription callback always reads the latest value without requiring a
  // re-subscribe when the option changes.
  const pathnameRef = useRef<string | undefined>(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    // Subscribe to change events from the store.  The callback fires
    // synchronously within the store's _emit() — no async gap between the
    // store mutation and the URL update.
    const unsub = store.onchange((event) => {
      // ── Guard: skip ephemeral-only changes ─────────────────────────────
      // urlDiff is {} when only ephemeral state changed (hover, panel open,
      // layer toggles, etc.).  These must never write to the URL.
      if (Object.keys(event.urlDiff).length === 0) return;

      // ── Extract URL state from the full state object ────────────────────
      // MapState = MapUrlState + { ephemeral }.  We strip the ephemeral
      // field so encodeMapUrlState receives a clean MapUrlState object.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { ephemeral: _eph, ...urlState } = event.state;

      // ── Encode to URLSearchParams ───────────────────────────────────────
      // encodeMapUrlState() omits params whose values equal their defaults
      // (MAP_URL_STATE_DEFAULTS), keeping the URL clean and shareable.
      const params = encodeMapUrlState(urlState);
      const qs = params.toString();

      // ── Resolve pathname ────────────────────────────────────────────────
      // Prefer explicit override (useful in tests); fall back to the live
      // browser pathname at call time.
      const resolvedPathname =
        pathnameRef.current ??
        (typeof window !== "undefined"
          ? window.location.pathname
          : "/inventory");

      // Build the final URL.  When qs is empty (all params equal defaults)
      // the URL reduces to just the pathname — no trailing "?".
      const url = qs ? `${resolvedPathname}?${qs}` : resolvedPathname;

      // ── Write to browser history ────────────────────────────────────────
      // replaceState updates the address bar without triggering a navigation
      // event, keeping React and Next.js router state untouched.
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", url);
      }
    });

    // Tear down the subscription when the component unmounts or when the
    // store instance changes.  This prevents memory leaks and stale closures.
    return unsub;
    // Intentionally depends only on `store` so the subscription is
    // re-established if the store instance ever changes (uncommon but safe).
    // `pathnameRef` is read via a ref — no dep needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
}
