/**
 * theme-storage.ts — localStorage helpers for dark mode preference
 *
 * Provides standalone, SSR-safe read/write utilities for persisting the
 * user's theme preference across sessions.  These helpers are the single
 * source of truth for the storage key and validation logic used by:
 *   - `useTheme` hook (src/hooks/use-theme.ts)
 *   - Any future script or service worker that needs to pre-set the preference
 *
 * Design goals:
 *   1. SSR safety — `window` / `localStorage` are never accessed at module
 *      scope.  All access is guarded by `typeof window === "undefined"`.
 *   2. Fail-silent — errors (private browsing, quota exceeded, security
 *      policy) are caught and swallowed.  The UI renders correctly in memory
 *      even when persistence is unavailable.
 *   3. Validation — only "light" and "dark" are considered valid stored values.
 *      Corrupt or stale values are treated as absent (returns null).
 *   4. Testability — pure functions with no global side effects; easy to unit-
 *      test by mocking `window.localStorage`.
 *
 * @module
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * ThemePreference — the two valid stored theme values.
 *
 * Kept as a separate type from the hook's `Theme` alias so this module has
 * no dependency on the hook file, avoiding circular imports.
 */
export type ThemePreference = "light" | "dark";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * THEME_STORAGE_KEY — the localStorage key used to persist the preference.
 *
 * This is the single source of truth for the key name.  Importing it here
 * (rather than duplicating the string) ensures the hook and any future
 * consumers always read from and write to the same key.
 *
 * @example
 * ```ts
 * localStorage.getItem(THEME_STORAGE_KEY); // "light" | "dark" | null
 * ```
 */
export const THEME_STORAGE_KEY = "theme_preference";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * readThemePreference — read the persisted theme preference from localStorage.
 *
 * Returns `null` in any of the following cases:
 *   - Server-side rendering (`window` is not defined).
 *   - No value has been stored yet (first visit, or cleared storage).
 *   - The stored value is not a valid theme (`"light"` | `"dark"`).
 *   - localStorage is unavailable (private browsing, security policy, quota).
 *
 * The caller is responsible for choosing a fallback value when `null` is
 * returned.  `useTheme` falls back to the OS `prefers-color-scheme` media
 * query; other consumers may choose a static default.
 *
 * @returns The stored `"light"` or `"dark"` string, or `null` when absent.
 *
 * @example
 * ```ts
 * const stored = readThemePreference();
 * const theme = stored ?? getSystemTheme();
 * ```
 */
export function readThemePreference(): ThemePreference | null {
  // Guard: no localStorage access during SSR.
  if (typeof window === "undefined") return null;

  let stored: string | null = null;

  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // localStorage blocked by: private browsing mode (Safari), security
    // policy (some embedded contexts), or storage quota exceeded.
    return null;
  }

  // Validate — only accept the two known-good values.
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  // null (not set) or any unexpected/corrupted value → treat as absent.
  return null;
}

/**
 * writeThemePreference — persist the theme preference to localStorage.
 *
 * The write is fire-and-forget: errors are caught silently so that a storage
 * failure (private browsing, quota exceeded, security policy) never disrupts
 * the in-memory UI state.  The visual theme has already been applied before
 * this function is called; persistence is a best-effort enhancement.
 *
 * No-op during SSR (`window` is not defined).
 *
 * @param theme  `"light"` or `"dark"` — the preference to persist.
 *
 * @example
 * ```ts
 * writeThemePreference("dark");
 * // localStorage["theme_preference"] → "dark"
 * ```
 */
export function writeThemePreference(theme: ThemePreference): void {
  // Guard: no localStorage access during SSR.
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Non-fatal: the in-memory theme state is correct regardless of whether
    // the value was persisted.  The preference will simply revert to the
    // OS default on the next page load.
  }
}
