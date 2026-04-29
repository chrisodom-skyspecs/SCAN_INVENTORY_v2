/**
 * useDensity — INVENTORY dashboard data-density toggle hook
 *
 * Manages the current density mode ("comfy" | "compact") for the INVENTORY
 * dashboard. The hook:
 *   1. Reads the persisted value from localStorage on mount.
 *   2. Sets `data-density` on `document.documentElement` so that all
 *      density-scoped CSS custom properties from §9 of base.css resolve
 *      correctly (both [data-density="comfy"] and [data-density="compact"]
 *      selectors target the document root).
 *   3. Persists every change back to localStorage so the preference
 *      survives page refreshes and new sessions.
 *
 * Storage key:  `inv_density`
 * Default:      `"comfy"`
 * Allowed values: `"comfy"` | `"compact"`
 *
 * SSR safety:
 *   localStorage and document are only accessed inside useEffect and
 *   event handlers — never during the initial render — so this hook is
 *   safe to use in Server-Component trees that hydrate on the client.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  subscribeToConvexInvDensity,
  notifyInvDensityChanged,
} from "@/lib/density-sync";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Density = "comfy" | "compact";

/** localStorage key used to persist the density preference. */
export const DENSITY_STORAGE_KEY = "inv_density";

const DEFAULT_DENSITY: Density = "comfy";
const VALID_DENSITIES: readonly Density[] = ["comfy", "compact"];

function isValidDensity(value: unknown): value is Density {
  return (
    typeof value === "string" &&
    (VALID_DENSITIES as readonly string[]).includes(value)
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseDensityReturn {
  /** Current density mode. Defaults to "comfy" before localStorage hydrates. */
  density: Density;
  /**
   * Update the density mode.
   *
   * Immediately:
   *   1. Updates local React state → triggers re-render of consuming components.
   *   2. Sets `data-density="{next}"` on `document.documentElement` → activates
   *      the corresponding §9 density CSS custom property block in base.css.
   *   3. Persists `next` to `localStorage["inv_density"]` → survives refresh.
   *
   * Calling with an invalid value is a no-op.
   */
  setDensity: (next: Density) => void;
}

/**
 * useDensity — read and write the INVENTORY data-density preference.
 *
 * @example
 * ```tsx
 * function DensityToggle() {
 *   const { density, setDensity } = useDensity();
 *   return (
 *     <button onClick={() => setDensity(density === "comfy" ? "compact" : "comfy")}>
 *       {density === "comfy" ? "Switch to compact" : "Switch to comfy"}
 *     </button>
 *   );
 * }
 * ```
 */
export function useDensity(): UseDensityReturn {
  // ── Initial state ─────────────────────────────────────────────────────────
  //
  // Start with the compile-time default so that the server render and the
  // first client render produce identical markup (no hydration mismatch).
  // The persisted localStorage value is applied in the effect below.
  const [density, setDensityState] = useState<Density>(DEFAULT_DENSITY);

  // ── Hydrate from localStorage on mount ─────────────────────────────────────
  //
  // On the client, read the user's stored preference and apply it both to
  // React state and to the DOM attribute.  This effect runs exactly once
  // (empty deps array) so there is no polling overhead.
  //
  // Priority order for the resolved density value:
  //   1. Convex user profile  — applied later by the subscribeToConvexInvDensity
  //                             effect once the Convex query resolves (see below).
  //   2. localStorage cache   — applied here immediately on mount so the UI
  //                             shows the correct density before Convex loads.
  //   3. Default ("comfy")    — used when neither source has a stored value.
  useEffect(() => {
    let stored: string | null = null;

    try {
      stored = localStorage.getItem(DENSITY_STORAGE_KEY);
    } catch {
      // localStorage blocked (private browsing mode, storage quota exceeded,
      // or security policy).  Fall through to apply the default.
    }

    const resolved: Density = isValidDensity(stored) ? stored : DEFAULT_DENSITY;

    setDensityState(resolved);
    document.documentElement.setAttribute("data-density", resolved);
  }, []); // intentionally empty — runs once on mount

  // ── Apply Convex preference when authenticated ──────────────────────────────
  //
  // `ConvexDensitySync` (src/components/ConvexDensitySync) broadcasts the
  // authenticated user's Convex-stored density preference via
  // `applyConvexInvDensity` once the Convex query resolves.  This effect
  // registers a subscriber that receives that broadcast and overrides the
  // localStorage-hydrated value.
  //
  // Priority: Convex > localStorage > default (comfy).
  //
  // localStorage is also updated so the next cold-start reads the Convex
  // value before Convex has a chance to respond — keeping the two caches
  // in sync.
  //
  // In tests that do not render ConvexDensitySync, this subscriber is
  // registered but `applyConvexInvDensity` is never called, so it is a
  // complete no-op and does not affect existing test assertions.
  useEffect(() => {
    const unsubscribe = subscribeToConvexInvDensity((convexDensity) => {
      // 1. Update React state → re-renders consuming components
      setDensityState(convexDensity);

      // 2. Apply to DOM attribute → activates CSS density token cascade
      document.documentElement.setAttribute("data-density", convexDensity);

      // 3. Update localStorage cache so next cold-start is consistent
      try {
        localStorage.setItem(DENSITY_STORAGE_KEY, convexDensity);
      } catch {
        // Persistence failure is non-fatal — in-memory state is already correct.
      }
    });

    return unsubscribe; // clean up on unmount (e.g. HMR, test teardown)
  }, []); // intentionally empty — subscribes once per hook instance

  // ── Setter ──────────────────────────────────────────────────────────────────
  //
  // useCallback so referential identity is stable across renders.
  // The consumer (DensityToggle button onClick) can be memoized safely.
  const setDensity = useCallback((next: Density) => {
    if (!isValidDensity(next)) {
      return; // guard — silently ignore invalid values
    }

    // 1. React state → re-render consumers
    setDensityState(next);

    // 2. DOM attribute → activates CSS custom-property cascade (§9 base.css)
    document.documentElement.setAttribute("data-density", next);

    // 3. Persist preference to localStorage
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
      // Persistence failure is non-fatal — UI still updates correctly.
    }

    // 4. Notify ConvexDensitySync so it can persist the change to the Convex
    //    user profile (cross-device sync).  No-op when ConvexDensitySync has
    //    not yet registered a handler (pre-auth or in unit tests).
    notifyInvDensityChanged(next);
  }, []);

  return { density, setDensity };
}
