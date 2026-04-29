/**
 * useMapPopstateHydration — wire a popstate listener so browser back/forward
 * button presses re-hydrate the MapStateStore from the updated URL.
 *
 * Sub-AC 12d: "Handle browser navigation events — wire popstate listener so
 * back/forward button presses re-hydrate map state from the updated URL,
 * enabling full deep-link and history support."
 *
 * Architecture
 * ────────────
 * This hook completes the full URL ↔ store round-trip for the MapStateStore
 * pattern used alongside useMapStoreSyncToUrl and useMapUrlHydratedStore:
 *
 *   URL → store  (mount-time)  useMapUrlHydration / useMapUrlHydratedStore
 *   store → URL  (mutations)   useMapStoreSyncToUrl → window.history.replaceState()
 *   popstate → store           THIS HOOK ← Sub-AC 12d
 *
 * Problem it solves
 * ─────────────────
 * useMapStoreSyncToUrl writes to the browser address bar via
 * window.history.replaceState(), intentionally bypassing the Next.js router
 * to avoid re-renders for every map interaction (hover, filter, etc.).
 *
 * This bypass has a consequence: when the user presses Back or Forward, the
 * browser fires a popstate event and updates window.location.search, but
 * Next.js's useSearchParams() is NOT notified because the history entries
 * were created outside the router.
 *
 * Without this hook, pressing Back after useMapStoreSyncToUrl updates would
 * visually revert the address bar URL, but the MapStateStore — and therefore
 * the rendered map — would remain frozen at the "forward" state.
 *
 * Solution
 * ────────
 * On each popstate event:
 *   1. Read window.location.search to obtain the newly-active URL params.
 *   2. Parse and validate them through sanitizeMapDeepLink (full validation
 *      + graceful defaults for missing / invalid params).
 *   3. Call store.hydrate(newState) to atomically update all URL fields.
 *
 * store.hydrate() performs an internal diff and is a no-op when the URL
 * state hasn't actually changed, so duplicate or spurious popstate events
 * (e.g., browsers that fire popstate on hashchange) are handled gracefully.
 *
 * Lifecycle
 * ─────────
 * The event listener is attached inside a useEffect (fires once at mount)
 * and removed in the cleanup function (fires at unmount or when the store
 * instance changes).  The hook never leaks listeners.
 *
 * Usage
 * ─────
 * Pair with useMapUrlHydratedStore and useMapStoreSyncToUrl for the full
 * URL ↔ store bidirectional sync with history support:
 *
 *   "use client";
 *   function MapProvider({ children }) {
 *     // URL → store: initialize store from URL params at mount
 *     const store = useMapUrlHydratedStore();
 *
 *     // store → URL: keep address bar in sync when store changes
 *     useMapStoreSyncToUrl(store);
 *
 *     // popstate → store: re-hydrate on browser back/forward
 *     useMapPopstateHydration(store);
 *
 *     return (
 *       <MapStoreContext.Provider value={store}>
 *         {children}
 *       </MapStoreContext.Provider>
 *     );
 *   }
 *
 * Does NOT require a <Suspense> boundary — this hook does not call
 * useSearchParams() or any other Next.js App Router hook.
 */

"use client";

import { useEffect, useRef } from "react";

import { MapStateStore } from "@/stores/map-state-store";
import { sanitizeMapDeepLink } from "@/lib/map-url-params";

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Register a popstate event listener that re-hydrates a MapStateStore
 * whenever the browser back or forward buttons are pressed.
 *
 * Reads window.location.search after each popstate event, parses it through
 * sanitizeMapDeepLink (full validation + defaults), and calls
 * store.hydrate(newState) to atomically update all URL-serialisable fields.
 *
 * @param store  The MapStateStore instance to hydrate on popstate events.
 *
 * @example
 * const store = useMapUrlHydratedStore();
 * useMapStoreSyncToUrl(store);
 * useMapPopstateHydration(store);
 */
export function useMapPopstateHydration(store: MapStateStore): void {
  // Keep the store reference current in the popstate handler without
  // requiring a teardown/re-attach of the listener when `store` changes.
  // (If `store` changes — uncommon — the useEffect dependency will trigger
  //  a listener swap, and the ref ensures the new store is always used.)
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    // Guard: skip in non-browser environments (SSR / test-runner without DOM).
    if (typeof window === "undefined") return;

    /**
     * Handle a browser popstate event.
     *
     * At this point window.location.search already reflects the URL of the
     * history entry the browser navigated to, so we parse it directly.
     */
    function handlePopstate(): void {
      // Build a URLSearchParams from the new URL's query string.
      // URLSearchParams implements the `.get()` interface required by
      // sanitizeMapDeepLink — no wrapper needed.
      const params = new URLSearchParams(window.location.search);

      // Parse + validate all params, defaulting any missing / invalid values.
      // In development, sanitizeMapDeepLink emits console.warn for each
      // sanitized param — useful for diagnosing stale bookmarks or corrupted
      // history entries.
      const { state, warnings } = sanitizeMapDeepLink(params);

      if (process.env.NODE_ENV === "development" && warnings.length > 0) {
        warnings.forEach((w) =>
          console.warn("[useMapPopstateHydration] Deep-link sanitization:", w)
        );
      }

      // store.hydrate() performs a diff internally; if the URL state is
      // identical to the current store state it is a no-op and emits nothing.
      storeRef.current.hydrate(state);
    }

    window.addEventListener("popstate", handlePopstate);

    // Cleanup: remove the listener when the component unmounts or when the
    // `store` prop changes (the effect re-runs with the new store).
    return () => {
      window.removeEventListener("popstate", handlePopstate);
    };

    // Re-subscribe only when the store instance changes (uncommon but safe).
    // storeRef.current is always up-to-date, so it does not need to be a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
}
