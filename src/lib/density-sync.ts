/**
 * density-sync.ts
 *
 * Lightweight pub/sub bridge connecting the standalone density hooks
 * (`useDensity`, `useScanDensity`) with the Convex preference sync layer
 * (`ConvexDensitySync`).
 *
 * Why a module-level event bus instead of React context?
 * ──────────────────────────────────────────────────────
 * The density preferences for INVENTORY and SCAN are managed by two different
 * hooks (`useDensity`, `useScanDensity`) that live at different points in the
 * component tree:
 *
 *   - `useDensity` is called by `DensityToggle` (inside InventoryNavbar)
 *   - `useScanDensity` is called by `ScanShell`
 *
 * `ConvexDensitySync` renders at the root provider level (inside
 * ConvexProviderWithAuth) — far above both shells — so it cannot reach the
 * density state via React context downwards.
 *
 * This module provides a bidirectional channel:
 *   • Convex → Hook (apply Convex preference on startup / after auth)
 *   • Hook   → Convex (persist user-changed preference to Convex)
 *
 * Priority contract:
 * ─────────────────
 *   1. On mount:  localStorage value is applied immediately (fast startup).
 *   2. After auth resolves:  ConvexDensitySync reads the user's Convex preference
 *      and calls `applyConvexInvDensity` / `applyConvexScanDensity`.  The hook
 *      subscriber overrides the current state with the Convex value and updates
 *      localStorage to match (cache consistency).
 *   3. On user change:  The hook calls `notifyInvDensityChanged` /
 *      `notifyScanDensityChanged` so ConvexDensitySync can persist the new
 *      preference back to Convex.
 *
 * SSR safety:
 * ──────────
 * This module contains no `document` / `localStorage` / `window` references
 * and is safe to import on the server.  Its side-effects (publishing /
 * subscribing) only occur during client-side component lifecycle methods.
 *
 * Test isolation:
 * ───────────────
 * Unit tests for `useDensity` and `useScanDensity` never call
 * `applyConvexInvDensity` / `applyConvexScanDensity`, so the Convex override
 * path is never triggered.  `ConvexDensitySync` is never rendered in unit
 * tests, so no write-back handlers are registered.  Both sides are clean no-ops
 * in isolation.
 *
 * @module
 */

import type { Density } from "@/hooks/use-density";

// ─── Types ────────────────────────────────────────────────────────────────────

type DensityHandler = (density: Density) => void;
type UnsubscribeFn  = () => void;

// ─── Convex → Hook channels ───────────────────────────────────────────────────
//
// Each density hook subscribes here to receive the Convex-sourced preference
// once it resolves.  Multiple hook instances are supported (e.g. hot-reload).
// Arrays use functional immutable-update style so closures over old references
// are not affected by future (un)subscribe calls.

let _invApplyHandlers:  DensityHandler[] = [];
let _scanApplyHandlers: DensityHandler[] = [];

/**
 * Subscribe to Convex-sourced INVENTORY density overrides.
 *
 * Called by `useDensity` on mount.  The returned cleanup function must be
 * called on unmount (in the effect cleanup) to prevent memory leaks.
 *
 * @param fn - Callback that will receive the Convex density value.
 * @returns Unsubscribe function for use in useEffect cleanup.
 */
export function subscribeToConvexInvDensity(fn: DensityHandler): UnsubscribeFn {
  _invApplyHandlers = [..._invApplyHandlers, fn];
  return () => {
    _invApplyHandlers = _invApplyHandlers.filter((h) => h !== fn);
  };
}

/**
 * Subscribe to Convex-sourced SCAN density overrides.
 *
 * Called by `useScanDensity` on mount.
 *
 * @param fn - Callback that will receive the Convex density value.
 * @returns Unsubscribe function for use in useEffect cleanup.
 */
export function subscribeToConvexScanDensity(fn: DensityHandler): UnsubscribeFn {
  _scanApplyHandlers = [..._scanApplyHandlers, fn];
  return () => {
    _scanApplyHandlers = _scanApplyHandlers.filter((h) => h !== fn);
  };
}

/**
 * Broadcast the Convex INVENTORY density preference to all subscribed hooks.
 *
 * Called by `ConvexDensitySync` after the Convex `getMyDensityPreferences`
 * query resolves.  Each subscribed `useDensity` instance receives the value,
 * updates its local state, DOM attribute, and localStorage.
 *
 * @param density - Convex-sourced density preference to apply.
 */
export function applyConvexInvDensity(density: Density): void {
  _invApplyHandlers.forEach((fn) => fn(density));
}

/**
 * Broadcast the Convex SCAN density preference to all subscribed hooks.
 *
 * Called by `ConvexDensitySync` after the Convex `getMyDensityPreferences`
 * query resolves.  Each subscribed `useScanDensity` instance receives the
 * value and updates its local state and localStorage.
 *
 * @param density - Convex-sourced density preference to apply.
 */
export function applyConvexScanDensity(density: Density): void {
  _scanApplyHandlers.forEach((fn) => fn(density));
}

// ─── Hook → Convex channels ───────────────────────────────────────────────────
//
// `ConvexDensitySync` registers a single handler for each app direction.
// Only the most-recently-registered handler is kept (one sync component per
// app session).  The handlers are called whenever the user changes density
// so that the new preference can be persisted to Convex.

let _onInvChanged:  DensityHandler | null = null;
let _onScanChanged: DensityHandler | null = null;

/**
 * Register a callback to be notified when the INVENTORY density changes.
 *
 * Called by `ConvexDensitySync` (via useEffect) to receive write-back signals
 * from `useDensity` whenever the user changes the density in the INVENTORY app.
 *
 * Pass `null` to unregister (used in effect cleanup).
 *
 * @param fn - Handler that receives the new density, or null to unregister.
 */
export function onConvexInvDensityChange(fn: DensityHandler | null): void {
  _onInvChanged = fn;
}

/**
 * Register a callback to be notified when the SCAN density changes.
 *
 * Called by `ConvexDensitySync` (via useEffect) to receive write-back signals
 * from `useScanDensity` whenever the user changes the density in the SCAN app.
 *
 * Pass `null` to unregister (used in effect cleanup).
 *
 * @param fn - Handler that receives the new density, or null to unregister.
 */
export function onConvexScanDensityChange(fn: DensityHandler | null): void {
  _onScanChanged = fn;
}

/**
 * Notify ConvexDensitySync that the INVENTORY density has changed.
 *
 * Called by `useDensity.setDensity` after every user-initiated density change
 * so the new preference can be persisted to the Convex user profile.
 *
 * This is a no-op when ConvexDensitySync has not yet registered a handler
 * (e.g. before auth resolves, or in unit tests that don't mount the sync
 * component).
 *
 * @param density - The new density value just applied by the hook.
 */
export function notifyInvDensityChanged(density: Density): void {
  _onInvChanged?.(density);
}

/**
 * Notify ConvexDensitySync that the SCAN density has changed.
 *
 * Called by `useScanDensity.setDensity` after every user-initiated density
 * change so the new preference can be persisted to the Convex user profile.
 *
 * @param density - The new density value just applied by the hook.
 */
export function notifyScanDensityChanged(density: Density): void {
  _onScanChanged?.(density);
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
export function _resetDensitySyncForTests(): void {
  _invApplyHandlers  = [];
  _scanApplyHandlers = [];
  _onInvChanged      = null;
  _onScanChanged     = null;
}
