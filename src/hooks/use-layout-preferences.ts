/**
 * src/hooks/use-layout-preferences.ts
 *
 * useLayoutPreferences — INVENTORY dashboard layout preference hook.
 *
 * Manages the user's persisted layout preferences for the INVENTORY dashboard:
 *   • activeMapMode      ("M1"–"M5") — which map view is currently active
 *   • activeCaseLayout   ("T1"–"T5") — which case detail panel is active
 *   • layerToggles       — which map overlay layers are enabled
 *   • sidebarCollapsed   — whether the side navigation panel is collapsed
 *   • lastViewedCaseId   — Convex ID of the last-viewed case
 *
 * Sync strategy (three-tier, Convex wins)
 * ─────────────────────────────────────────
 * 1. On mount:
 *      Read `readMapMode(userId)` and `readCaseLayout(userId)` from localStorage
 *      for immediate, synchronous hydration — no network round-trip required.
 *      The UI shows the user's last preference before Convex loads.
 *
 * 2. When `getLayoutPreferences` resolves (via ConvexLayoutSync):
 *      The Convex value is broadcast through the layout-sync event bus.
 *      If it contains `activeMapMode` or `activeCaseLayout`, overwrite the
 *      current hook state AND update localStorage so the two caches remain
 *      consistent.  Convex wins because it represents cross-device truth.
 *
 * 3. On user change:
 *      Write to localStorage immediately (instant feedback, no spinner).
 *      Then call `notifyLayoutPrefsChanged` so ConvexLayoutSync can call
 *      `upsertLayoutPreferences` — persisting the preference across devices.
 *
 * SSR safety
 * ──────────
 * All `localStorage` access is guarded inside `useEffect` or inside the setter
 * (which is only ever called client-side).  The initial state is always the
 * hard-coded default so that server and client renders match exactly (no
 * hydration mismatch).
 *
 * Usage
 * ─────
 * ```tsx
 * // Inside an INVENTORY client component:
 * function InventoryMapModeSelector() {
 *   const { id: userId } = useKindeUser();
 *   const { activeMapMode, setMapMode } = useLayoutPreferences(userId);
 *
 *   return (
 *     <select
 *       value={activeMapMode}
 *       onChange={(e) => setMapMode(e.target.value as MapMode)}
 *     >
 *       <option value="M1">Fleet Overview</option>
 *       <option value="M2">Site Detail</option>
 *       <option value="M3">Transit Tracker</option>
 *       <option value="M4">Heat Map</option>
 *     </select>
 *   );
 * }
 * ```
 *
 * Caller must supply `userId` so localStorage keys are scoped per user (prevents
 * preferences bleeding between accounts sharing a browser).  Pass an empty
 * string or `null` / `undefined` when the user is not yet authenticated —
 * the hook will use defaults and skip localStorage writes until a valid userId
 * is available.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  readMapMode,
  writeMapMode,
  readCaseLayout,
  writeCaseLayout,
  isMapMode,
  isCaseLayout,
  type MapMode,
  type CaseLayout,
} from "@/lib/layout-storage";
import {
  subscribeToConvexLayoutPrefs,
  notifyLayoutPrefsChanged,
  type LayoutPrefs,
} from "@/lib/layout-sync";

// ─── Defaults ─────────────────────────────────────────────────────────────────

/** Default map mode: Fleet Overview shows all cases at a glance. */
export const DEFAULT_MAP_MODE: MapMode = "M1";

/** Default case layout: Summary panel is the most general view. */
export const DEFAULT_CASE_LAYOUT: CaseLayout = "T1";

// ─── Return type ──────────────────────────────────────────────────────────────

export interface UseLayoutPreferencesReturn {
  /**
   * The currently active map view identifier ("M1"–"M5").
   *
   * Starts as `"M1"` on both server and initial client render to prevent
   * hydration mismatches.  Updates to the persisted preference after mount,
   * and again after the Convex query resolves (Convex wins).
   */
  activeMapMode: MapMode;

  /**
   * The currently active case detail panel layout ("T1"–"T5").
   *
   * Starts as `"T1"` on both server and initial client render.
   * Updates to the persisted preference after mount.
   */
  activeCaseLayout: CaseLayout;

  /**
   * Update the active map mode.
   *
   * Immediately:
   *   1. Updates local React state → re-renders consuming components.
   *   2. Writes to localStorage via `writeMapMode(userId, mode)`.
   *   3. Notifies ConvexLayoutSync via `notifyLayoutPrefsChanged` so the new
   *      preference is persisted to Convex (`upsertLayoutPreferences`).
   *
   * Calling with an invalid mode string is a no-op (guarded by `isMapMode`).
   * No-op when `userId` is empty (not yet authenticated).
   */
  setMapMode: (mode: MapMode) => void;

  /**
   * Update the active case detail panel layout.
   *
   * Immediately:
   *   1. Updates local React state.
   *   2. Writes to localStorage via `writeCaseLayout(userId, layout)`.
   *   3. Notifies ConvexLayoutSync via `notifyLayoutPrefsChanged`.
   *
   * Calling with an invalid layout string is a no-op.
   * No-op when `userId` is empty.
   */
  setCaseLayout: (layout: CaseLayout) => void;

  /**
   * `true` while the initial localStorage hydration is still pending (server
   * render → first client render gap).  Components that need the stored value
   * before rendering can use this to show a skeleton.
   *
   * In practice this is false within the first `useEffect` tick, so it is
   * rarely observed.
   */
  isHydrated: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useLayoutPreferences — read and write INVENTORY layout preferences.
 *
 * @param userId  The authenticated user's Kinde ID (`user.id`), used to scope
 *                localStorage keys.  Pass `""` (empty string) when not yet
 *                authenticated — the hook uses defaults and skips persistence.
 *
 * @returns {UseLayoutPreferencesReturn}  Layout preference state and setters.
 */
export function useLayoutPreferences(userId: string): UseLayoutPreferencesReturn {
  // ── Initial state ──────────────────────────────────────────────────────────
  //
  // Start with compile-time defaults so server render and first client render
  // produce identical markup (no React hydration mismatch).
  // The persisted localStorage values are applied in the effect below.
  const [activeMapMode, setActiveMapMode] = useState<MapMode>(DEFAULT_MAP_MODE);
  const [activeCaseLayout, setActiveCaseLayout] = useState<CaseLayout>(DEFAULT_CASE_LAYOUT);
  const [isHydrated, setIsHydrated] = useState(false);

  // ── userId ref ─────────────────────────────────────────────────────────────
  //
  // Store userId in a ref so that callbacks (setMapMode / setCaseLayout) can
  // always access the current userId without the callbacks needing to be
  // recreated when userId changes (e.g., delayed auth resolution).
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  // ── Effect 1: Hydrate from localStorage on mount ───────────────────────────
  //
  // Run once on mount (empty deps).  Reads the persisted preferences from
  // localStorage and applies them to React state.  After this effect:
  //   • isHydrated → true
  //   • activeMapMode → stored value or DEFAULT_MAP_MODE
  //   • activeCaseLayout → stored value or DEFAULT_CASE_LAYOUT
  //
  // Priority order for resolved values:
  //   1. Convex user profile — applied later via subscribeToConvexLayoutPrefs
  //                            (Effect 2 below) once auth resolves.
  //   2. localStorage cache  — applied here for fast startup.
  //   3. Hard-coded defaults — used when neither source has a stored value.
  //
  // Note: This effect uses `userIdRef.current` so that it runs exactly once
  // on mount.  If userId changes after mount (e.g., slow auth), Effect 3
  // handles re-reading localStorage with the new userId.
  useEffect(() => {
    const uid = userIdRef.current;

    // Read from localStorage (returns null when absent / invalid / SSR)
    const storedMode = uid ? readMapMode(uid) : null;
    const storedLayout = uid ? readCaseLayout(uid) : null;

    // Apply stored values (or keep defaults if null)
    if (storedMode !== null) {
      setActiveMapMode(storedMode);
    }
    if (storedLayout !== null) {
      setActiveCaseLayout(storedLayout);
    }

    setIsHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — runs once on mount

  // ── Effect 2: Re-hydrate from localStorage when userId becomes available ───
  //
  // When the user authenticates after mount (userId changes from "" to a real
  // ID), re-read localStorage with the scoped key.  This handles the case where
  // the component mounts before Kinde resolves the user session.
  //
  // Guard: skip the initial mount (userId was already read in Effect 1).
  const prevUserIdRef = useRef<string>("");
  useEffect(() => {
    // Skip if userId hasn't changed or is still empty
    if (!userId || userId === prevUserIdRef.current) return;
    prevUserIdRef.current = userId;

    // On the very first mount, Effect 1 already handled this.
    // This effect only fires on subsequent userId changes.
    if (!isHydrated) return;

    const storedMode = readMapMode(userId);
    const storedLayout = readCaseLayout(userId);

    if (storedMode !== null) {
      setActiveMapMode(storedMode);
    }
    if (storedLayout !== null) {
      setActiveCaseLayout(storedLayout);
    }
  }, [userId, isHydrated]);

  // ── Effect 3: Subscribe to Convex-sourced preferences ─────────────────────
  //
  // `ConvexLayoutSync` broadcasts the authenticated user's Convex-stored layout
  // preferences via `applyConvexLayoutPrefs` once the Convex query resolves.
  // This subscriber receives that broadcast and overrides the localStorage-
  // hydrated values.  Convex always wins (cross-device sync authority).
  //
  // localStorage is also updated so the next cold-start reads the Convex
  // value before Convex has a chance to respond — keeping the two caches
  // in sync (Reconciliation strategy step 2 from the schema comment).
  useEffect(() => {
    const unsubscribe = subscribeToConvexLayoutPrefs((prefs: LayoutPrefs) => {
      const uid = userIdRef.current;

      // Apply activeMapMode if present and valid
      if (prefs.activeMapMode !== undefined && isMapMode(prefs.activeMapMode)) {
        // 1. React state → re-renders consuming components
        setActiveMapMode(prefs.activeMapMode);
        // 2. Update localStorage cache so next cold-start is consistent
        if (uid) {
          writeMapMode(uid, prefs.activeMapMode);
        }
      }

      // Apply activeCaseLayout if present and valid
      if (
        prefs.activeCaseLayout !== undefined &&
        isCaseLayout(prefs.activeCaseLayout)
      ) {
        setActiveCaseLayout(prefs.activeCaseLayout);
        if (uid) {
          writeCaseLayout(uid, prefs.activeCaseLayout);
        }
      }
      // Note: layerToggles, sidebarCollapsed, and lastViewedCaseId are managed
      // by their own hooks (useLayerToggles, etc.) and are not stored in the
      // layout-storage localStorage helpers.  They are broadcast here to allow
      // future expansion but are not acted upon in this hook.
    });

    return unsubscribe; // clean up on unmount (HMR, test teardown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — subscribes once per hook instance

  // ── setMapMode ─────────────────────────────────────────────────────────────
  //
  // Stable reference via useCallback (no deps — all values via refs).
  const setMapMode = useCallback((mode: MapMode): void => {
    // Guard: reject invalid values
    if (!isMapMode(mode)) return;

    const uid = userIdRef.current;

    // 1. React state → re-render consumers
    setActiveMapMode(mode);

    // 2. Persist to localStorage (scoped by userId)
    if (uid) {
      writeMapMode(uid, mode);
    }

    // 3. Notify ConvexLayoutSync to persist to Convex (fire-and-forget).
    //    No-op when ConvexLayoutSync has not yet registered a handler
    //    (pre-auth or in unit tests that don't mount the sync component).
    notifyLayoutPrefsChanged({ activeMapMode: mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable — relies on userIdRef, not userId directly

  // ── setCaseLayout ──────────────────────────────────────────────────────────
  const setCaseLayout = useCallback((layout: CaseLayout): void => {
    if (!isCaseLayout(layout)) return;

    const uid = userIdRef.current;

    setActiveCaseLayout(layout);

    if (uid) {
      writeCaseLayout(uid, layout);
    }

    notifyLayoutPrefsChanged({ activeCaseLayout: layout });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable

  return {
    activeMapMode,
    activeCaseLayout,
    setMapMode,
    setCaseLayout,
    isHydrated,
  };
}
