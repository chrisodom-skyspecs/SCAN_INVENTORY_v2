/**
 * ConvexLayoutSync — bridge between useLayoutPreferences and the Convex
 * userPreferences table.
 *
 * This component is a pure side-effect component (renders null) that lives
 * INSIDE `ConvexProviderWithAuth` and `KindeProvider` so it has access to
 * both Convex queries/mutations and the authenticated user identity.
 *
 * What it does
 * ────────────
 * 1. READ on auth resolution:
 *    Subscribes to `api.userPreferences.getLayoutPreferences`.  When the query
 *    resolves to a non-null value (the user has persisted preferences), it
 *    broadcasts the Convex values to the layout hooks via the layout-sync
 *    event bus:
 *      • `applyConvexLayoutPrefs(prefs)` → received by `useLayoutPreferences`
 *    This runs at most once per session (guarded by the `synced` ref) to avoid
 *    fighting user changes made after initial load.
 *
 * 2. WRITE on user change:
 *    After the initial sync, listens for preference changes reported by the
 *    hook via the `layout-sync` event bus:
 *      • `onConvexLayoutPrefsChange` — fires when any preference changes
 *    When it fires, calls `upsertLayoutPreferences` mutation to persist the
 *    new preference to the Convex `userPreferences` table.  The mutation is
 *    fire-and-forget — failures are caught and logged silently (localStorage
 *    has already persisted the preference locally via the hook).
 *
 * Priority order for the resolved preferences on a fresh session:
 *   1. Convex userPreferences row (highest — cross-device sync)
 *   2. localStorage cache (fallback while Convex is loading)
 *   3. Hard-coded defaults ("M1" / "T1")
 *
 * Note on Convex API types
 * ────────────────────────
 * `convex/userPreferences.ts` may not yet appear in the generated
 * `convex/_generated/api.d.ts` if `npx convex dev` has not been run since the
 * file was added.  The generated `api.js` uses `anyApi` (a JS Proxy) so all
 * function references are valid at RUNTIME regardless of the TypeScript types.
 * We cast to `Record<string, any>` to satisfy the type checker; update the
 * imports to `api.userPreferences.*` once types regenerate.
 *
 * Placement in the provider tree (see src/app/providers.tsx):
 *
 *   ThemeProvider
 *     KindeProvider
 *       ConvexProviderWithAuth
 *         ConvexThemeSync    ← theme preference sync
 *         ConvexDensitySync  ← density preference sync
 *         ConvexLayoutSync   ← THIS COMPONENT (layout preference sync)
 *         TelemetryInitializer
 *         UserIdentityProvider
 *           {children}
 *
 * @module
 */

"use client";

import { useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
  applyConvexLayoutPrefs,
  onConvexLayoutPrefsChange,
  type LayoutPrefs,
} from "@/lib/layout-sync";

// ─── Runtime-safe Convex function references ──────────────────────────────────
//
// `anyApi` (the generated api.js export) is a JS Proxy that resolves any
// property path to a valid FunctionReference at runtime, even when the
// TypeScript types are stale.  We cast through `any` to access the functions.
//
// These references are computed at module load (not inside the component) so
// that the hooks below always receive stable, non-null function references.
// This satisfies React's Rules of Hooks — hooks are never called conditionally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const apiAny = api as unknown as Record<string, any>;

/**
 * Runtime reference to `userPreferences.getLayoutPreferences` query.
 * Always defined via the anyApi proxy; TypeScript type is intentionally broad.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getLayoutPreferencesRef: any =
  apiAny["userPreferences"]["getLayoutPreferences"];

/**
 * Runtime reference to `userPreferences.upsertLayoutPreferences` mutation.
 * Always defined via the anyApi proxy.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const upsertLayoutPreferencesRef: any =
  apiAny["userPreferences"]["upsertLayoutPreferences"];

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ConvexLayoutSync — mounts inside ConvexProviderWithAuth to sync layout
 * preferences between the useLayoutPreferences hook (localStorage) and the
 * Convex userPreferences table.
 *
 * Renders nothing; all work happens in useEffect hooks.
 *
 * Mount this component as a sibling of ConvexThemeSync and ConvexDensitySync
 * in providers.tsx:
 *
 * ```tsx
 * <ConvexProviderWithAuth client={convex} useAuth={useAuthFromKinde}>
 *   <ConvexThemeSync />
 *   <ConvexDensitySync />
 *   <ConvexLayoutSync />
 *   ...
 * </ConvexProviderWithAuth>
 * ```
 */
export function ConvexLayoutSync(): null {
  // ── Convex bindings ────────────────────────────────────────────────────────
  //
  // Both hooks are called UNCONDITIONALLY (Rules of Hooks compliance).
  // The function references are resolved from anyApi at module scope (above),
  // so they are always defined — no conditional calls, no skips.
  //
  // getLayoutPreferences returns:
  //   undefined   — query loading (auth not yet resolved)
  //   null        — unauthenticated OR no preferences stored yet (first visit)
  //   { activeMapMode?, activeCaseLayout?, ..., updatedAt: number }
  //             — authenticated user's stored preferences
  const convexPrefs = useQuery(getLayoutPreferencesRef);
  const upsertPrefs = useMutation(upsertLayoutPreferencesRef);

  // ── Sync guard ─────────────────────────────────────────────────────────────
  //
  // `synced` tracks whether we have already applied the Convex preferences to
  // the layout hook.  It is a ref (not state) so it does not trigger
  // re-renders.
  //
  // Before synced = true:  ignore preference change notifications (they come
  //   from localStorage / default, not from user-initiated actions)
  // After  synced = true:  every preference change should be written to Convex
  const synced = useRef(false);

  // ── Effect 1: Apply Convex preferences on first resolution ─────────────────
  //
  // When the Convex query resolves from `undefined` to any value (null or an
  // object), broadcast the stored preferences to the layout hook via the
  // layout-sync event bus.  Only runs once per session thanks to the `synced`
  // guard.
  //
  // We do NOT re-apply on every subsequent render — the user may have changed
  // a preference since the initial load, and we don't want to overwrite their
  // explicit choice with the Convex-stored value.
  useEffect(() => {
    // convexPrefs === undefined means the query is still loading.
    // Wait until we have a definite value (null or a preferences object).
    if (convexPrefs === undefined) return;

    // Guard: only apply the Convex values once per session.
    if (synced.current) return;

    // Mark as synced regardless of whether preferences exist, so that
    // subsequent preference changes (user actions) are persisted to Convex.
    synced.current = true;

    // When null: no preferences stored yet (first visit) — keep whatever
    // localStorage / default chose.  No broadcast needed.
    if (convexPrefs === null) return;

    // Build the LayoutPrefs patch from the Convex response.
    // Only include fields that have defined (non-null) values so we don't
    // accidentally override localStorage with null/undefined.
    const prefs: LayoutPrefs = {};
    const raw = convexPrefs as Record<string, unknown>;

    if (raw["activeMapMode"] != null) {
      prefs.activeMapMode = raw["activeMapMode"] as LayoutPrefs["activeMapMode"];
    }
    if (raw["activeCaseLayout"] != null) {
      prefs.activeCaseLayout = raw["activeCaseLayout"] as LayoutPrefs["activeCaseLayout"];
    }
    if (raw["layerToggles"] != null) {
      prefs.layerToggles = raw["layerToggles"] as LayoutPrefs["layerToggles"];
    }
    if (raw["sidebarCollapsed"] != null) {
      prefs.sidebarCollapsed = raw["sidebarCollapsed"] as boolean;
    }
    if (raw["lastViewedCaseId"] != null) {
      prefs.lastViewedCaseId = raw["lastViewedCaseId"] as string;
    }

    // Only broadcast if there are any preferences to apply.
    if (Object.keys(prefs).length > 0) {
      applyConvexLayoutPrefs(prefs);
    }
  }, [convexPrefs]);

  // ── Effect 2: Register write-back handler ──────────────────────────────────
  //
  // After the initial sync (synced.current = true), every preference change
  // reported by the hook via the layout-sync event bus is persisted to the
  // Convex userPreferences table.
  //
  // The handler is registered in this useEffect (which has `upsertPrefs` as a
  // dependency) so that if the Convex client reconnects and provides a new
  // mutation function, we re-register with the latest version.
  //
  // `prevPatchKeyRef` deduplicates echoes: if ConvexLayoutSync applies a
  // Convex preference and the hook notifies back (because it wrote to
  // localStorage), we skip the redundant Convex write.
  const prevPatchKeyRef = useRef<string>("");

  useEffect(() => {
    onConvexLayoutPrefsChange((prefs: LayoutPrefs) => {
      // Guard: don't write before the first Convex read (avoid persisting the
      // localStorage/default value as if it were a user-initiated change).
      if (!synced.current) return;

      // Deduplicate: skip if the patch hasn't changed since the last write.
      const patchKey = JSON.stringify(prefs);
      if (patchKey === prevPatchKeyRef.current) return;
      prevPatchKeyRef.current = patchKey;

      // Persist to Convex — fire-and-forget.
      // localStorage is already updated by the hook setter, so a Convex write
      // failure is non-fatal: the preference is safe locally.
      (upsertPrefs as (args: LayoutPrefs) => Promise<unknown>)(prefs).catch(
        (err: unknown) => {
          if (process.env.NODE_ENV === "development") {
            console.warn(
              "[ConvexLayoutSync] Failed to persist layout preferences:",
              err,
            );
          }
        },
      );
    });

    // Cleanup: unregister handler when the component unmounts or when
    // upsertPrefs changes (Convex client reconnect).
    return () => {
      onConvexLayoutPrefsChange(null);
    };
  }, [upsertPrefs]);

  return null;
}
