/**
 * layout-sync.ts
 *
 * Lightweight pub/sub bridge connecting the `useLayoutPreferences` hook with
 * the Convex preference sync layer (`ConvexLayoutSync`).
 *
 * Why a module-level event bus instead of React context?
 * ──────────────────────────────────────────────────────
 * `useLayoutPreferences` is called inside the INVENTORY shell, which sits
 * somewhere in the component tree below `ConvexProviderWithAuth`.
 * `ConvexLayoutSync` renders at the provider level (sibling of ConvexThemeSync
 * and ConvexDensitySync), so it cannot directly reach layout state via React
 * context downwards.
 *
 * This module provides a bidirectional channel:
 *   • Convex → Hook  (apply Convex preferences on startup / after auth)
 *   • Hook → Convex  (persist user-changed preferences back to Convex)
 *
 * Priority contract
 * ─────────────────
 *   1. On mount:  localStorage value is applied immediately (fast startup, no
 *                 network round-trip required).
 *   2. After auth resolves:  ConvexLayoutSync reads the user's Convex preferences
 *      and calls `applyConvexLayoutPrefs`.  The hook subscriber overrides the
 *      current state with the Convex value and updates localStorage to match
 *      (cache consistency).  Convex wins for cross-device sync.
 *   3. On user change:  The hook calls `notifyLayoutPrefsChanged` so
 *      ConvexLayoutSync can persist the new preference back to Convex.
 *
 * SSR safety
 * ──────────
 * This module contains no `document` / `localStorage` / `window` references
 * and is safe to import on the server.  Its side-effects (publishing /
 * subscribing) only occur during client-side component lifecycle methods.
 *
 * Test isolation
 * ──────────────
 * Unit tests for `useLayoutPreferences` never call `applyConvexLayoutPrefs`,
 * so the Convex override path is a no-op.  `ConvexLayoutSync` is never rendered
 * in unit tests, so no write-back handlers are registered.  Both sides are
 * clean no-ops in isolation.
 *
 * @module
 */

import type { MapMode, CaseLayout } from "@/lib/layout-storage";

// ─── Preference type ──────────────────────────────────────────────────────────

/**
 * The subset of layout preferences managed by this sync channel.
 *
 * Matches the shape returned by `api.userPreferences.getLayoutPreferences`
 * and accepted by `api.userPreferences.upsertLayoutPreferences`.
 *
 * All fields are optional — callers only need to include the fields they
 * are updating.  On the Convex side, absent fields are left unchanged (partial
 * deep-merge semantics).
 */
export interface LayoutPrefs {
  /** Active INVENTORY map view: "M1"–"M5". */
  activeMapMode?: MapMode;
  /** Active case detail panel layout: "T1"–"T5". */
  activeCaseLayout?: CaseLayout;
  /** Partial layer toggle state — only keys provided are written. */
  layerToggles?: {
    deployed?: boolean;
    transit?: boolean;
    fleet?: boolean;
    damage?: boolean;
    turbines?: boolean;
    heatmap?: boolean;
    missions?: boolean;
  };
  /** Whether the INVENTORY side navigation panel is collapsed. */
  sidebarCollapsed?: boolean;
  /** Convex document ID of the last-viewed case (as plain string). */
  lastViewedCaseId?: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type LayoutPrefsHandler = (prefs: LayoutPrefs) => void;
type UnsubscribeFn = () => void;

// ─── Convex → Hook channel ────────────────────────────────────────────────────
//
// `useLayoutPreferences` subscribes here to receive the Convex-sourced
// preferences once they resolve.  Multiple hook instances are supported
// (e.g., hot-reload).  Arrays use functional immutable-update style so
// closures over old references are not affected by future (un)subscribe calls.

let _applyHandlers: LayoutPrefsHandler[] = [];

/**
 * Subscribe to Convex-sourced layout preference overrides.
 *
 * Called by `useLayoutPreferences` on mount.  The returned cleanup function
 * must be called on unmount (in the effect cleanup) to prevent memory leaks.
 *
 * @param fn  Callback that will receive the Convex layout preferences.
 * @returns   Unsubscribe function for use in useEffect cleanup.
 */
export function subscribeToConvexLayoutPrefs(
  fn: LayoutPrefsHandler,
): UnsubscribeFn {
  _applyHandlers = [..._applyHandlers, fn];
  return () => {
    _applyHandlers = _applyHandlers.filter((h) => h !== fn);
  };
}

/**
 * Broadcast Convex-sourced layout preferences to all subscribed hooks.
 *
 * Called by `ConvexLayoutSync` after the Convex `getLayoutPreferences` query
 * resolves.  Each subscribed `useLayoutPreferences` instance receives the
 * value, updates its local state and localStorage.
 *
 * @param prefs  Convex-sourced layout preferences to apply.
 */
export function applyConvexLayoutPrefs(prefs: LayoutPrefs): void {
  _applyHandlers.forEach((fn) => fn(prefs));
}

// ─── Hook → Convex channel ────────────────────────────────────────────────────
//
// `ConvexLayoutSync` registers a single handler.  Only the most-recently-
// registered handler is kept (one sync component per session).  The handler
// is called whenever the user changes any layout preference so the new value
// can be persisted to Convex.

let _onChanged: LayoutPrefsHandler | null = null;

/**
 * Register a callback to be notified when layout preferences change.
 *
 * Called by `ConvexLayoutSync` (via useEffect) to receive write-back signals
 * from `useLayoutPreferences` whenever the user changes a preference.
 *
 * Pass `null` to unregister (used in effect cleanup).
 *
 * @param fn  Handler that receives the changed preference patch, or null to
 *            unregister.
 */
export function onConvexLayoutPrefsChange(
  fn: LayoutPrefsHandler | null,
): void {
  _onChanged = fn;
}

/**
 * Notify ConvexLayoutSync that layout preferences have changed.
 *
 * Called by `useLayoutPreferences` after every user-initiated preference
 * change so the new preference can be persisted to the Convex `userPreferences`
 * table.
 *
 * This is a no-op when ConvexLayoutSync has not yet registered a handler
 * (e.g. before auth resolves, or in unit tests that don't mount the sync
 * component).
 *
 * @param prefs  The preference patch just applied by the hook.
 */
export function notifyLayoutPrefsChanged(prefs: LayoutPrefs): void {
  _onChanged?.(prefs);
}

// ─── Test utilities ───────────────────────────────────────────────────────────

/**
 * Reset all internal state to the initial empty condition.
 *
 * Exported for use in unit tests that need clean isolation between test cases.
 * Should NOT be called in production code.
 *
 * @internal
 */
export function _resetLayoutSyncForTests(): void {
  _applyHandlers = [];
  _onChanged = null;
}
