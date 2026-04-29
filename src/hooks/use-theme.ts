/**
 * useTheme — shared dark mode toggle hook
 *
 * Manages the current theme ("light" | "dark") for both the INVENTORY
 * dashboard and the SCAN mobile app.  The hook:
 *
 *   1. Reads the persisted value from localStorage on mount.
 *   2. Falls back to the OS `prefers-color-scheme` media query when no
 *      explicit preference has been saved.
 *   3. Applies / removes the `theme-dark` CSS class on
 *      `document.documentElement` so that all dark-theme token overrides
 *      from §3 of `src/styles/tokens/base.css` resolve correctly.
 *   4. Persists every change back to localStorage so the preference
 *      survives page refreshes and new sessions.
 *
 * Storage key:  `theme_preference`
 * Default:      OS `prefers-color-scheme` or `"light"` if undetectable
 * Allowed values: `"light"` | `"dark"`
 *
 * SSR safety:
 *   localStorage, window, and document are only accessed inside useEffect and
 *   event handlers — never during the initial render — so this hook is
 *   safe to use in Server-Component trees that hydrate on the client.
 *
 * Design token wiring:
 *   Toggling dark mode sets/removes the `.theme-dark` class on `<html>`.
 *   The `.theme-dark` block in base.css §3 re-maps every semantic token
 *   (--surface-*, --ink-*, --border-*, --elevation-*) to the dark palette,
 *   and the §5h block re-maps all map tokens.  No component-level changes
 *   are needed — the CSS cascade handles propagation automatically.
 *
 * @module
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  readThemePreference,
  writeThemePreference,
  THEME_STORAGE_KEY as _THEME_STORAGE_KEY,
} from "@/lib/theme-storage";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Theme = "light" | "dark";

/**
 * localStorage key used to persist the theme preference.
 *
 * Re-exported from `src/lib/theme-storage.ts` for backward compatibility —
 * existing imports of `THEME_STORAGE_KEY` from this file continue to work.
 */
export const THEME_STORAGE_KEY: string = _THEME_STORAGE_KEY;

/** CSS class applied to `<html>` when dark mode is active (matches base.css §3). */
export const THEME_DARK_CLASS = "theme-dark";

function isValidTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * Detect the OS dark-mode preference at runtime (client-side only).
 * Returns "dark" when `prefers-color-scheme: dark` matches, "light" otherwise.
 * Safe to call during SSR — returns "light" when `window` is undefined.
 */
function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// ─── Hook return type ─────────────────────────────────────────────────────────

export interface UseThemeReturn {
  /** Current theme mode ("light" | "dark"). Defaults to "light" before hydration. */
  theme: Theme;

  /** Whether dark mode is currently active. Convenience alias for `theme === "dark"`. */
  isDark: boolean;

  /**
   * Toggle between light and dark mode.
   *
   * Immediately:
   *   1. Updates local React state → triggers re-render of consuming components.
   *   2. Adds/removes `theme-dark` on `document.documentElement` → activates the
   *      dark token cascade in base.css §3 and §5h.
   *   3. Persists the new value to `localStorage["theme_preference"]` → survives
   *      page refreshes and new sessions.
   */
  toggleTheme: () => void;

  /**
   * Set the theme explicitly.
   *
   * Useful for components that want to set a specific mode (e.g. a select
   * dropdown with "System / Light / Dark" options).
   * Calling with an invalid value is a no-op (guards against typos).
   */
  setTheme: (next: Theme) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useTheme — read and write the shared dark / light theme preference.
 *
 * Wires theme state to both the CSS class on `<html>` and to React context
 * consumers via `ThemeProvider`.  Call this hook directly only when you need
 * the setter; prefer `useThemeContext()` in component code.
 *
 * @example
 * ```tsx
 * function ThemeToggle() {
 *   const { isDark, toggleTheme } = useTheme();
 *   return (
 *     <button
 *       onClick={toggleTheme}
 *       aria-pressed={isDark}
 *       aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
 *     >
 *       {isDark ? "Light mode" : "Dark mode"}
 *     </button>
 *   );
 * }
 * ```
 */
export function useTheme(): UseThemeReturn {
  // ── Initial state ─────────────────────────────────────────────────────────
  //
  // Start with "light" so the server render and the first client render produce
  // identical markup (no hydration mismatch).  The real preference (from
  // localStorage or OS media query) is applied in the effect below.
  const [theme, setThemeState] = useState<Theme>("light");

  // ── Apply theme class to <html> ───────────────────────────────────────────
  //
  // Extracted to a stable helper so we can call it from both the hydration
  // effect and the setter without duplicating logic.
  const applyThemeClass = useCallback((next: Theme) => {
    if (typeof document === "undefined") return;
    if (next === "dark") {
      document.documentElement.classList.add(THEME_DARK_CLASS);
    } else {
      document.documentElement.classList.remove(THEME_DARK_CLASS);
    }
  }, []);

  // ── Hydrate from localStorage / OS preference on mount ───────────────────
  //
  // On the client, read the user's stored preference via the standalone
  // readThemePreference() helper (src/lib/theme-storage.ts).  If no valid
  // preference is stored, fall back to the OS media query.  Apply both to
  // React state and to the DOM class.  Runs exactly once (empty deps array).
  useEffect(() => {
    // readThemePreference() is SSR-safe and returns null when:
    //   • no value has been stored yet
    //   • the stored value is invalid / corrupt
    //   • localStorage is unavailable (private browsing, security policy)
    const stored = readThemePreference();
    const resolved: Theme = stored !== null ? stored : getSystemTheme();

    setThemeState(resolved);
    applyThemeClass(resolved);
  }, [applyThemeClass]); // applyThemeClass is stable (useCallback with no deps)

  // ── Setter ────────────────────────────────────────────────────────────────
  //
  // useCallback so referential identity is stable across renders.
  // The consumer (ThemeToggle button onClick) can be memoized safely.
  const setTheme = useCallback(
    (next: Theme) => {
      if (!isValidTheme(next)) {
        return; // guard — silently ignore invalid values
      }

      // 1. React state → re-render consumers
      setThemeState(next);

      // 2. DOM class → activates CSS custom-property cascade (base.css §3, §5h)
      applyThemeClass(next);

      // 3. Persist preference via standalone helper (src/lib/theme-storage.ts).
      //    writeThemePreference() is fail-silent — storage errors do not
      //    affect the in-memory UI state.
      writeThemePreference(next);
    },
    [applyThemeClass],
  );

  // ── Toggle ────────────────────────────────────────────────────────────────
  //
  // Convenience wrapper over setTheme for the common toggle-button use case.
  // Uses the functional updater form of setState to always read the latest
  // state value without a stale closure.
  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";

      // Side effects must happen here (inside the updater) because we need
      // the latest `prev` value without capturing it in the closure.
      applyThemeClass(next);

      // Persist via the standalone helper — fail-silent on storage errors.
      writeThemePreference(next);

      return next;
    });
  }, [applyThemeClass]);

  return {
    theme,
    isDark: theme === "dark",
    toggleTheme,
    setTheme,
  };
}
