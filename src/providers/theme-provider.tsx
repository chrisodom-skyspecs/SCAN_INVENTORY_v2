/**
 * ThemeProvider — shared dark-mode context for INVENTORY and SCAN apps
 *
 * Provides the current theme state (`theme`, `isDark`) and mutation functions
 * (`toggleTheme`, `setTheme`) to any descendant component via `useThemeContext`.
 *
 * Architecture
 * ────────────
 * The provider is mounted inside `Providers` (src/app/providers.tsx), which is
 * the root client boundary shared by both /inventory/* and /scan/* routes.
 * This means a single theme preference and toggle function are shared across
 * both apps — switching to dark mode in the INVENTORY dashboard persists
 * and applies immediately if the user navigates to SCAN.
 *
 * CSS wiring
 * ──────────
 * The actual CSS change is handled by `useTheme` (src/hooks/use-theme.ts),
 * which adds/removes the `theme-dark` class on `document.documentElement`.
 * The `.theme-dark` block in base.css §3 re-maps all semantic tokens;
 * components that consume CSS custom properties only (no JS branching) do
 * not need to subscribe to this context at all.
 *
 * Context default
 * ───────────────
 * The context default is `theme: "light", isDark: false` with no-op setters
 * so components rendered outside ThemeProvider (e.g. unit tests, Storybook)
 * get a safe fallback without throwing.
 *
 * Usage
 * ─────
 * • Read-only:  `const { isDark } = useThemeContext()`
 * • Toggle:     `const { toggleTheme } = useThemeContext()`
 * • Set explicit: `const { setTheme } = useThemeContext(); setTheme("dark")`
 *
 * For components that only need the boolean value, prefer the convenience
 * hook `useIsDark()` which avoids re-rendering on unrelated context changes.
 *
 * @module
 */

"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { useTheme } from "@/hooks/use-theme";
import type { Theme, UseThemeReturn } from "@/hooks/use-theme";

// Re-export Theme type so consumers don't need to import from the hook directly.
export type { Theme };

// ─── Context shape ────────────────────────────────────────────────────────────

export type ThemeContextValue = UseThemeReturn;

// ─── Context ──────────────────────────────────────────────────────────────────

/**
 * ThemeContext — holds the current theme state and setters.
 *
 * Default value provides a safe no-op fallback for components rendered outside
 * ThemeProvider (unit tests, Storybook, static renders).
 */
export const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  isDark: false,
  toggleTheme: () => {
    // Default no-op; replaced by ThemeProvider's real implementation.
  },
  setTheme: (_next: Theme) => {
    // Default no-op; replaced by ThemeProvider's real implementation.
  },
});

// ─── Provider component ───────────────────────────────────────────────────────

/**
 * ThemeProvider — mount at the root of both INVENTORY and SCAN app trees.
 *
 * Internally calls `useTheme()` to manage the dark-mode state and CSS class.
 * All descendant components can call `useThemeContext()` to read or update
 * the theme without prop drilling.
 *
 * Placement in provider tree:
 *   It is intentionally placed *outside* Kinde and Convex providers so that
 *   the theme is available before auth resolves — the loading state and login
 *   pages can also render in dark mode.
 *
 * @param props.children  App tree that needs access to theme state.
 *
 * @example
 * ```tsx
 * // In src/app/providers.tsx:
 * export function Providers({ children }: { children: React.ReactNode }) {
 *   return (
 *     <ThemeProvider>
 *       <KindeProvider>
 *         {children}
 *       </KindeProvider>
 *     </ThemeProvider>
 *   );
 * }
 * ```
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // useTheme manages all side effects (localStorage, DOM class mutation).
  const themeState = useTheme();

  return (
    <ThemeContext.Provider value={themeState}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─── Consumer hooks ───────────────────────────────────────────────────────────

/**
 * useThemeContext — read and update the shared theme state.
 *
 * Returns the full `{ theme, isDark, toggleTheme, setTheme }` shape.
 * Safe to call outside ThemeProvider — returns the context default
 * (`theme: "light"`, no-op setters) rather than throwing.
 *
 * @example
 * ```tsx
 * import { useThemeContext } from "@/providers/theme-provider";
 *
 * function ThemeToggleButton() {
 *   const { isDark, toggleTheme } = useThemeContext();
 *   return (
 *     <button
 *       type="button"
 *       onClick={toggleTheme}
 *       aria-pressed={isDark}
 *       aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
 *     >
 *       {isDark ? "☀ Light" : "☾ Dark"}
 *     </button>
 *   );
 * }
 * ```
 */
export function useThemeContext(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * useIsDark — lightweight boolean hook for components that only need to know
 * whether dark mode is active (e.g. to conditionally render a moon/sun icon).
 *
 * Re-renders only when `isDark` changes, not on unrelated context updates.
 *
 * @example
 * ```tsx
 * import { useIsDark } from "@/providers/theme-provider";
 *
 * function StatusIndicator() {
 *   const isDark = useIsDark();
 *   // Pick the correct Mapbox style URL for the current theme
 *   const mapStyle = isDark
 *     ? "mapbox://styles/mapbox/dark-v11"
 *     : "mapbox://styles/mapbox/light-v11";
 *   return <MapView style={mapStyle} />;
 * }
 * ```
 */
export function useIsDark(): boolean {
  const { isDark } = useContext(ThemeContext);
  return isDark;
}
