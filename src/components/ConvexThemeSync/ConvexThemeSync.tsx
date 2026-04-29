/**
 * ConvexThemeSync — bridge between ThemeContext and Convex user profile.
 *
 * This component is a pure side-effect component (renders null) that lives
 * INSIDE `ConvexProviderWithAuth` and `KindeProvider` so it has access to
 * both Convex queries/mutations and the authenticated user identity.
 *
 * What it does
 * ────────────
 * 1. READ on auth resolution:
 *    Subscribes to `api.users.getMyThemePreference`.  When the query resolves
 *    to a non-null value (i.e., the user has a persisted preference), it calls
 *    `setTheme()` from `ThemeContext` to override the localStorage / OS default.
 *    This runs at most once per session (guarded by the `synced` ref).
 *
 * 2. WRITE on toggle:
 *    After the initial sync, watches the `theme` value from `ThemeContext`.
 *    When it changes (the user toggled dark/light mode), it calls
 *    `setMyThemePreference` mutation to persist the new preference to Convex.
 *    The mutation is fire-and-forget — failures are caught and logged silently
 *    (localStorage has already persisted the preference locally via `useTheme`).
 *
 * Priority order for the resolved theme on a fresh session:
 *   1. Convex user profile (highest — cross-device sync)
 *   2. localStorage cache (fallback while Convex is loading)
 *   3. OS `prefers-color-scheme` media query (fallback when no stored value)
 *
 * Placement in the provider tree (see src/app/providers.tsx):
 *
 *   ThemeProvider          ← manages localStorage + DOM class
 *     KindeProvider
 *       ConvexProviderWithAuth
 *         ConvexThemeSync  ← THIS COMPONENT (reads Convex, writes Convex)
 *         ...rest of app
 *
 * ThemeProvider is intentionally outermost so the login page and loading states
 * support dark mode before auth resolves.  ConvexThemeSync upgrades the
 * persistence layer to Convex once the Kinde session is available.
 *
 * @module
 */

"use client";

import { useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useThemeContext } from "@/providers/theme-provider";

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * ConvexThemeSync — mounts inside ConvexProviderWithAuth to sync dark mode
 * preference between ThemeContext (localStorage) and the Convex user profile.
 *
 * Renders nothing; all work happens in useEffect hooks.
 *
 * Mount this component as the first child of ConvexProviderWithAuth in
 * src/app/providers.tsx:
 *
 * ```tsx
 * <ConvexProviderWithAuth client={convex} useAuth={useAuthFromKinde}>
 *   <ConvexThemeSync />
 *   ...
 * </ConvexProviderWithAuth>
 * ```
 */
export function ConvexThemeSync(): null {
  const { theme, setTheme } = useThemeContext();

  // ── Convex bindings ────────────────────────────────────────────────────────
  //
  // getMyThemePreference returns:
  //   undefined  — query loading (auth not yet resolved or Convex connecting)
  //   null       — user authenticated but no stored preference
  //   "light" | "dark" — user's persisted preference
  const convexTheme = useQuery(api.users.getMyThemePreference);
  const persistTheme = useMutation(api.users.setMyThemePreference);

  // ── Sync guard ─────────────────────────────────────────────────────────────
  //
  // `synced` tracks whether we have already applied the Convex preference to
  // the ThemeContext.  It is a ref (not state) so it doesn't trigger re-renders.
  //
  // Before synced is true  → ignore theme changes (they come from localStorage
  //                           / OS, not from the user's explicit toggle)
  // After synced is true   → every theme change should be written to Convex
  const synced = useRef(false);

  // ── Effect 1: Apply Convex preference on first resolution ─────────────────
  //
  // When the Convex query resolves from `undefined` to a value, apply the
  // stored preference to the ThemeContext (and therefore to the DOM class and
  // localStorage).  Only runs once thanks to the `synced` guard.
  //
  // We do NOT want to re-run this effect on every subsequent render — the user
  // may have toggled the theme since, and we don't want to fight them.
  useEffect(() => {
    // convexTheme === undefined means the query is still loading.
    // Wait until we have a definite value (null or "light"/"dark").
    if (convexTheme === undefined) return;

    // Guard: only apply the Convex value once per session.
    if (synced.current) return;

    // Mark as synced regardless of whether convexTheme is null, so that
    // subsequent theme changes (user toggles) are persisted to Convex.
    synced.current = true;

    // Apply the Convex preference if it differs from the current theme.
    // When convexTheme is null (no stored preference), keep whatever
    // localStorage / OS chose — don't override with anything.
    if (convexTheme === "light" || convexTheme === "dark") {
      setTheme(convexTheme);
    }
  }, [convexTheme, setTheme]);

  // ── Effect 2: Persist theme changes back to Convex ────────────────────────
  //
  // After the initial sync (synced.current === true), every change to `theme`
  // is persisted to the Convex user profile.
  //
  // prevTheme ref prevents writing the initial value (which would be the
  // localStorage/OS value before the Convex preference is loaded).
  //
  // We track the theme via a separate ref to detect real user-driven changes
  // vs. the programmatic setTheme(convexTheme) call in Effect 1.
  const prevTheme = useRef<typeof theme | null>(null);

  useEffect(() => {
    // Not yet synced with Convex — don't write anything yet.
    if (!synced.current) return;

    // First run after synced: record current theme as baseline without writing.
    if (prevTheme.current === null) {
      prevTheme.current = theme;
      return;
    }

    // No change — nothing to persist.
    if (theme === prevTheme.current) return;

    // Theme changed — update the baseline and persist to Convex.
    prevTheme.current = theme;

    // Fire-and-forget: localStorage has already saved the preference via
    // writeThemePreference() in useTheme.  A Convex write failure is not fatal.
    persistTheme({ theme }).catch((err: unknown) => {
      if (process.env.NODE_ENV === "development") {
        console.warn("[ConvexThemeSync] Failed to persist theme preference:", err);
      }
    });
  }, [theme, persistTheme]);

  return null;
}
