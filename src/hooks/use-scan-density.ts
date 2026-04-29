/**
 * useScanDensity — SCAN mobile app data-density preference hook
 *
 * Manages the current density mode ("comfy" | "compact") for the SCAN mobile
 * app.  The density attribute is applied directly to the SCAN shell root
 * element (not to document.documentElement — which is owned by the INVENTORY
 * useDensity hook) so that the two apps maintain independent preferences.
 *
 * Density modes:
 *   "comfy"   — comfortable / spacious; generous touch targets (default for mobile)
 *   "compact" — compact / dense; maximises visible content on small screens
 *
 * These values map directly to the `[data-density="comfy"]` and
 * `[data-density="compact"]` CSS attribute selectors in §9 of base.css,
 * activating the corresponding density token cascade for all descendant elements.
 *
 * Storage key:  `scan_density`
 * Default:      `"comfy"`  (comfortable — respects WCAG 2.5.5 touch target size)
 * Allowed values: `"comfy"` | `"compact"`
 *
 * Usage:
 *   This hook is consumed by ScanShell to apply the attribute to the root div,
 *   and by useScanDensityContext() for React-tree consumers that need the value
 *   without touching the DOM directly.
 *
 * SSR safety:
 *   localStorage and any DOM access only occur inside useEffect — never during
 *   the initial render — preventing hydration mismatches in Next.js App Router.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import type { Density } from "./use-density";
import {
  subscribeToConvexScanDensity,
  notifyScanDensityChanged,
} from "@/lib/density-sync";

// ─── Constants ────────────────────────────────────────────────────────────────

/** localStorage key for the SCAN app density preference. */
export const SCAN_DENSITY_STORAGE_KEY = "scan_density";

/**
 * Default density for the SCAN mobile app.
 *
 * "comfy" is used rather than "compact" because mobile users need generous
 * touch targets (WCAG 2.5.5: 44 × 44 CSS px minimum).  The comfy density
 * tokens set --density-row-height-md to 3rem (48px), which comfortably
 * exceeds the WCAG threshold.
 */
const DEFAULT_SCAN_DENSITY: Density = "comfy";

const VALID_DENSITIES: readonly Density[] = ["comfy", "compact"];

function isValidScanDensity(value: unknown): value is Density {
  return (
    typeof value === "string" &&
    (VALID_DENSITIES as readonly string[]).includes(value)
  );
}

// ─── Return type ──────────────────────────────────────────────────────────────

export interface UseScanDensityReturn {
  /**
   * Current density mode.
   *
   * Starts as `"comfy"` on both server and initial client render to prevent
   * hydration mismatches.  Updates to the persisted preference after mount.
   */
  density: Density;

  /**
   * Update the SCAN density mode.
   *
   * Immediately:
   *   1. Updates local React state → triggers re-render of consuming components.
   *   2. Persists `next` to `localStorage["scan_density"]`.
   *
   * Note: The caller (ScanShell) is responsible for applying the
   * `data-density` attribute to the DOM root element.  This hook only
   * manages state and persistence.
   *
   * Calling with an invalid value is a no-op.
   */
  setDensity: (next: Density) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useScanDensity — read and write the SCAN mobile app data-density preference.
 *
 * @example
 * ```tsx
 * // Inside ScanShell (client component):
 * const { density, setDensity } = useScanDensity();
 * return (
 *   <div data-density={density} data-app="scan">
 *     {children}
 *   </div>
 * );
 * ```
 */
export function useScanDensity(): UseScanDensityReturn {
  // ── Initial state ─────────────────────────────────────────────────────────
  //
  // Matches the compile-time default so server render and first client render
  // produce identical markup (no React hydration mismatch).
  // The persisted localStorage value is applied in the effect below.
  const [density, setDensityState] = useState<Density>(DEFAULT_SCAN_DENSITY);

  // ── Hydrate from localStorage on mount ─────────────────────────────────────
  //
  // Read the persisted preference and apply it to React state.
  // Empty deps: runs once on mount.
  //
  // Priority order for the resolved density:
  //   1. Convex user profile — applied later via subscribeToConvexScanDensity
  //                            once the Convex query resolves (see below).
  //   2. localStorage cache  — applied here immediately on mount for fast startup.
  //   3. Default ("comfy")   — used when neither source has a stored value.
  useEffect(() => {
    let stored: string | null = null;

    try {
      stored = localStorage.getItem(SCAN_DENSITY_STORAGE_KEY);
    } catch {
      // localStorage blocked (private browsing, storage quota, security policy).
      // Fall through to apply the default density.
    }

    const resolved: Density = isValidScanDensity(stored)
      ? stored
      : DEFAULT_SCAN_DENSITY;

    setDensityState(resolved);
  }, []); // intentionally empty — runs once on mount

  // ── Apply Convex preference when authenticated ──────────────────────────────
  //
  // `ConvexDensitySync` broadcasts the authenticated user's Convex-stored
  // SCAN density preference via `applyConvexScanDensity` once the Convex query
  // resolves.  This subscriber receives that broadcast and overrides the
  // localStorage-hydrated value.
  //
  // Priority: Convex > localStorage > default.
  //
  // localStorage is also updated so the next cold-start reads the Convex
  // value before Convex has a chance to respond — keeping the two caches
  // in sync.
  //
  // In tests that do not render ConvexDensitySync, the subscriber is registered
  // but `applyConvexScanDensity` is never called — a complete no-op.
  useEffect(() => {
    const unsubscribe = subscribeToConvexScanDensity((convexDensity) => {
      // 1. React state → re-renders ScanShell → updates data-density on root div
      setDensityState(convexDensity);

      // 2. Update localStorage cache so next cold-start is consistent
      try {
        localStorage.setItem(SCAN_DENSITY_STORAGE_KEY, convexDensity);
      } catch {
        // Persistence failure is non-fatal — in-memory state is already correct.
      }
    });

    return unsubscribe; // clean up on unmount
  }, []); // intentionally empty — subscribes once per hook instance

  // ── Setter ──────────────────────────────────────────────────────────────────
  //
  // Stable reference via useCallback.
  const setDensity = useCallback((next: Density) => {
    if (!isValidScanDensity(next)) {
      return; // guard — silently ignore invalid values
    }

    // 1. React state → re-renders ScanShell → updates data-density on root div
    setDensityState(next);

    // 2. Persist preference to localStorage
    try {
      localStorage.setItem(SCAN_DENSITY_STORAGE_KEY, next);
    } catch {
      // Persistence failure is non-fatal — UI still updates correctly.
    }

    // 3. Notify ConvexDensitySync so it can persist the change to the Convex
    //    user profile (cross-device sync).  No-op when ConvexDensitySync has
    //    not yet registered a handler (pre-auth or in unit tests).
    notifyScanDensityChanged(next);
  }, []);

  return { density, setDensity };
}
