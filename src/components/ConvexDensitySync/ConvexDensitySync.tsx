/**
 * ConvexDensitySync — bridge between density hooks and the Convex user profile.
 *
 * This component is a pure side-effect component (renders null) that lives
 * INSIDE `ConvexProviderWithAuth` and `KindeProvider` so it has access to
 * both Convex queries/mutations and the authenticated user identity.
 *
 * What it does
 * ────────────
 * 1. READ on auth resolution:
 *    Subscribes to `api.users.getMyDensityPreferences`.  When the query
 *    resolves to a non-null value (i.e. the user has persisted preferences),
 *    it broadcasts the Convex values to the density hooks via the
 *    `density-sync` module:
 *      • `applyConvexInvDensity(invDensity)`  → received by `useDensity`
 *      • `applyConvexScanDensity(scanDensity)` → received by `useScanDensity`
 *    This runs at most once per session (guarded by the `synced` ref).
 *
 * 2. WRITE on user change:
 *    After the initial sync, listens for density changes reported by each hook
 *    via the `density-sync` event bus:
 *      • `onConvexInvDensityChange`  — fires when INVENTORY density changes
 *      • `onConvexScanDensityChange` — fires when SCAN density changes
 *    When either fires, calls `setMyDensityPreference` mutation to persist the
 *    new preference to the Convex user profile.  The mutation is fire-and-forget
 *    — failures are caught and logged silently (localStorage has already
 *    persisted the preference locally via the hook).
 *
 * Priority order for the resolved density on a fresh session:
 *   1. Convex user profile (highest — cross-device sync)
 *   2. localStorage cache (fallback while Convex is loading)
 *   3. Default ("comfy")  (when neither source has a stored value)
 *
 * Placement in the provider tree (see src/app/providers.tsx):
 *
 *   ThemeProvider
 *     KindeProvider
 *       ConvexProviderWithAuth
 *         ConvexThemeSync    ← theme preference sync
 *         ConvexDensitySync  ← THIS COMPONENT (density preference sync)
 *         ...rest of app
 *
 * Both `ConvexThemeSync` and `ConvexDensitySync` follow the same pattern.
 * They are siblings inside `ConvexProviderWithAuth` and operate independently.
 *
 * @module
 */

"use client";

import { useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  applyConvexInvDensity,
  applyConvexScanDensity,
  onConvexInvDensityChange,
  onConvexScanDensityChange,
} from "@/lib/density-sync";
import type { Density } from "@/hooks/use-density";

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ConvexDensitySync — mounts inside ConvexProviderWithAuth to sync density
 * preferences between the density hooks (localStorage) and the Convex user
 * profile.
 *
 * Renders nothing; all work happens in useEffect hooks.
 *
 * Mount this component as a sibling of ConvexThemeSync in providers.tsx:
 *
 * ```tsx
 * <ConvexProviderWithAuth client={convex} useAuth={useAuthFromKinde}>
 *   <ConvexThemeSync />
 *   <ConvexDensitySync />
 *   ...
 * </ConvexProviderWithAuth>
 * ```
 */
export function ConvexDensitySync(): null {
  // ── Convex bindings ────────────────────────────────────────────────────────
  //
  // getMyDensityPreferences returns:
  //   undefined                              — query loading (auth not resolved)
  //   null                                   — unauthenticated
  //   { invDensity: null, scanDensity: null } — authenticated, no stored pref
  //   { invDensity: "comfy"|"compact", ... } — authenticated, stored preference
  const convexPrefs = useQuery(api.users.getMyDensityPreferences);
  const persistDensity = useMutation(api.users.setMyDensityPreference);

  // ── Sync guard ─────────────────────────────────────────────────────────────
  //
  // `synced` tracks whether we have already applied the Convex preferences to
  // the density hooks.  It is a ref (not state) so it doesn't trigger
  // re-renders.
  //
  // Before synced = true  → ignore density changes (they come from localStorage
  //                          / default, not from the user's explicit toggle)
  // After  synced = true  → every density change should be written to Convex
  const synced = useRef(false);

  // ── Effect 1: Apply Convex preferences on first resolution ─────────────────
  //
  // When the Convex query resolves from `undefined` to any value (null or an
  // object), broadcast the stored preferences to the density hooks via the
  // density-sync event bus.  Only runs once per session thanks to the `synced`
  // guard.
  //
  // We do NOT want to re-apply on every subsequent render — the user may have
  // changed density since, and we don't want to fight their explicit choice.
  useEffect(() => {
    // convexPrefs === undefined means the query is still loading.
    // Wait until we have a definite value (null or preference object).
    if (convexPrefs === undefined) return;

    // Guard: only apply the Convex values once per session.
    if (synced.current) return;

    // Mark as synced regardless of whether preferences are null, so that
    // subsequent density changes (user toggles) are persisted to Convex.
    synced.current = true;

    // Apply the INVENTORY density preference if present.
    // When null (no stored preference), keep whatever localStorage / default chose.
    if (convexPrefs !== null && convexPrefs.invDensity !== null) {
      applyConvexInvDensity(convexPrefs.invDensity);
    }

    // Apply the SCAN density preference if present.
    if (convexPrefs !== null && convexPrefs.scanDensity !== null) {
      applyConvexScanDensity(convexPrefs.scanDensity);
    }
  }, [convexPrefs]);

  // ── Effect 2: Register write-back handlers ─────────────────────────────────
  //
  // After the initial sync (synced.current = true), every density change
  // reported by the hooks via the density-sync event bus is persisted to
  // the Convex user profile.
  //
  // The handlers are registered in this useEffect (which has `persistDensity`
  // as a dependency) so that if the Convex client reconnects and provides a
  // new mutation function, we re-register with the latest version.
  //
  // prevInvDensity and prevScanDensity refs prevent redundant writes when
  // Convex applies a preference and the hook notifies back (circular echo).
  const prevInvDensity  = useRef<Density | null>(null);
  const prevScanDensity = useRef<Density | null>(null);

  useEffect(() => {
    // Register the INVENTORY density write-back handler.
    onConvexInvDensityChange((density) => {
      // Guard: don't write before the first Convex read (avoid persisting the
      // localStorage/default value as if it were a user-initiated change).
      if (!synced.current) return;

      // Deduplicate: skip if the density hasn't changed.
      if (density === prevInvDensity.current) return;
      prevInvDensity.current = density;

      // Persist to Convex — fire-and-forget.
      // localStorage is already updated by useDensity.setDensity, so a
      // Convex write failure is non-fatal.
      persistDensity({ app: "inv", density }).catch((err: unknown) => {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            "[ConvexDensitySync] Failed to persist INVENTORY density:",
            err,
          );
        }
      });
    });

    // Register the SCAN density write-back handler.
    onConvexScanDensityChange((density) => {
      if (!synced.current) return;

      if (density === prevScanDensity.current) return;
      prevScanDensity.current = density;

      persistDensity({ app: "scan", density }).catch((err: unknown) => {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            "[ConvexDensitySync] Failed to persist SCAN density:",
            err,
          );
        }
      });
    });

    // Cleanup: unregister handlers when the component unmounts or when
    // persistDensity changes (Convex client reconnect).
    return () => {
      onConvexInvDensityChange(null);
      onConvexScanDensityChange(null);
    };
  }, [persistDensity]);

  return null;
}
