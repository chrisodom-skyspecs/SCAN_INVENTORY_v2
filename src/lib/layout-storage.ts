/**
 * layout-storage.ts — localStorage helpers for layout preference persistence
 *
 * Provides standalone, SSR-safe read/write utilities for persisting two
 * user-level UI preferences across sessions:
 *
 *   • Map mode    (M1–M5) — the active INVENTORY dashboard map view
 *   • Case layout (T1–T5) — the active case detail panel layout
 *
 * Both preferences are keyed by **userId** so that multiple users sharing the
 * same browser (or switching accounts) retain independent settings.
 *
 * Design goals (mirrors theme-storage.ts):
 *   1. SSR safety     — `window` / `localStorage` are never accessed at module
 *                       scope.  All access is guarded by `typeof window`.
 *   2. Fail-silent    — errors (private browsing, quota exceeded, security
 *                       policy) are caught and swallowed; the UI falls back to
 *                       its default without disruption.
 *   3. Validation     — only valid M1–M5 / T1–T5 strings are accepted.
 *                       Corrupt or stale values are treated as absent (→ null).
 *   4. Testability    — pure functions with no global side effects; easy to
 *                       unit-test by mocking `window.localStorage`.
 *   5. Cross-app      — usable from both INVENTORY and SCAN apps; no
 *                       dependency on React, Convex, or the App Router.
 *
 * Storage key format:
 *   `inv_map_mode:{userId}`   — e.g. `inv_map_mode:user_abc123`
 *   `inv_case_layout:{userId}` — e.g. `inv_case_layout:user_abc123`
 *
 * @module
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * MapMode — the five valid map view identifiers for the INVENTORY dashboard.
 *
 *   M1 = Fleet Overview   — all cases on a world/region map with status pins
 *   M2 = Site Detail      — zoomed view of a single deployment site
 *   M3 = Transit Tracker  — cases in transit with FedEx route overlays
 *   M4 = Heat Map         — status density / damage heat map
 *   M5 = Mission Control  — time-scrubbing replay (requires FF_MAP_MISSION)
 *
 * This type mirrors `MapView` from `@/types/map` but is declared independently
 * here so that this storage module has zero imports and no circular-dependency
 * risk with the type tree.
 */
export type MapMode = "M1" | "M2" | "M3" | "M4" | "M5";

/**
 * CaseLayout — the five valid case detail panel layout identifiers.
 *
 *   T1 = Summary panel
 *   T2 = Manifest / packing list
 *   T3 = Inspection history
 *   T4 = Shipping & custody chain
 *   T5 = Audit hash chain (requires FF_AUDIT_HASH_CHAIN)
 *
 * Mirrors `CaseWindow` from `@/types/map` but declared independently to avoid
 * circular imports (see MapMode note above).
 */
export type CaseLayout = "T1" | "T2" | "T3" | "T4" | "T5";

// ─── Valid value sets ─────────────────────────────────────────────────────────

/** All valid MapMode values — used for validation. */
export const MAP_MODE_VALUES: readonly MapMode[] = [
  "M1",
  "M2",
  "M3",
  "M4",
  "M5",
] as const;

/** All valid CaseLayout values — used for validation. */
export const CASE_LAYOUT_VALUES: readonly CaseLayout[] = [
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
] as const;

// ─── Key builders ─────────────────────────────────────────────────────────────

/**
 * MAP_MODE_STORAGE_KEY_PREFIX — the key prefix used for map mode preferences.
 *
 * The full key is `${MAP_MODE_STORAGE_KEY_PREFIX}${userId}`.
 *
 * @example
 * // For userId "user_abc123":
 * `${MAP_MODE_STORAGE_KEY_PREFIX}user_abc123` // "inv_map_mode:user_abc123"
 */
export const MAP_MODE_STORAGE_KEY_PREFIX = "inv_map_mode:";

/**
 * CASE_LAYOUT_STORAGE_KEY_PREFIX — the key prefix used for case layout preferences.
 *
 * The full key is `${CASE_LAYOUT_STORAGE_KEY_PREFIX}${userId}`.
 *
 * @example
 * // For userId "user_abc123":
 * `${CASE_LAYOUT_STORAGE_KEY_PREFIX}user_abc123` // "inv_case_layout:user_abc123"
 */
export const CASE_LAYOUT_STORAGE_KEY_PREFIX = "inv_case_layout:";

/**
 * Build the localStorage key for a user's map mode preference.
 *
 * @param userId  The authenticated user's stable identifier.
 * @returns       The scoped localStorage key string.
 */
export function mapModeStorageKey(userId: string): string {
  return `${MAP_MODE_STORAGE_KEY_PREFIX}${userId}`;
}

/**
 * Build the localStorage key for a user's case layout preference.
 *
 * @param userId  The authenticated user's stable identifier.
 * @returns       The scoped localStorage key string.
 */
export function caseLayoutStorageKey(userId: string): string {
  return `${CASE_LAYOUT_STORAGE_KEY_PREFIX}${userId}`;
}

// ─── Validators ───────────────────────────────────────────────────────────────

/**
 * Returns true when `value` is a valid MapMode string ("M1"–"M5").
 */
export function isMapMode(value: unknown): value is MapMode {
  return (
    typeof value === "string" &&
    (MAP_MODE_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Returns true when `value` is a valid CaseLayout string ("T1"–"T5").
 */
export function isCaseLayout(value: unknown): value is CaseLayout {
  return (
    typeof value === "string" &&
    (CASE_LAYOUT_VALUES as readonly string[]).includes(value)
  );
}

// ─── Map mode helpers ─────────────────────────────────────────────────────────

/**
 * readMapMode — read the persisted map mode preference for a user.
 *
 * Returns `null` in any of the following cases:
 *   - Server-side rendering (`window` is not defined).
 *   - `userId` is empty or blank (cannot scope the key).
 *   - No value has been stored yet (first visit, or cleared storage).
 *   - The stored value is not a valid map mode ("M1"–"M5").
 *   - localStorage is unavailable (private browsing, security policy, quota).
 *
 * The caller is responsible for choosing a fallback value when `null` is
 * returned.  Both INVENTORY and SCAN hooks should default to "M1" (Fleet
 * Overview).
 *
 * @param userId  The authenticated user's stable identifier.
 * @returns       The stored `"M1"` – `"M5"` string, or `null` when absent.
 *
 * @example
 * ```ts
 * const stored = readMapMode("user_abc123");
 * const mode   = stored ?? "M1"; // fall back to Fleet Overview
 * ```
 */
export function readMapMode(userId: string): MapMode | null {
  if (typeof window === "undefined") return null;
  if (!userId || !userId.trim()) return null;

  let stored: string | null = null;

  try {
    stored = localStorage.getItem(mapModeStorageKey(userId));
  } catch {
    // localStorage blocked by: private browsing mode, security policy, or
    // storage quota exceeded.
    return null;
  }

  return isMapMode(stored) ? stored : null;
}

/**
 * writeMapMode — persist the map mode preference for a user.
 *
 * The write is fire-and-forget: errors are caught silently so that a storage
 * failure never disrupts the in-memory UI state.
 *
 * No-op when:
 *   - Executing on the server (`window` is not defined).
 *   - `userId` is empty or blank.
 *
 * @param userId  The authenticated user's stable identifier.
 * @param mode    `"M1"` – `"M5"` — the map mode to persist.
 *
 * @example
 * ```ts
 * writeMapMode("user_abc123", "M3");
 * // localStorage["inv_map_mode:user_abc123"] → "M3"
 * ```
 */
export function writeMapMode(userId: string, mode: MapMode): void {
  if (typeof window === "undefined") return;
  if (!userId || !userId.trim()) return;

  try {
    localStorage.setItem(mapModeStorageKey(userId), mode);
  } catch {
    // Non-fatal: in-memory state is correct regardless of whether the value
    // was persisted.  The preference will revert to the default on next load.
  }
}

// ─── Case layout helpers ──────────────────────────────────────────────────────

/**
 * readCaseLayout — read the persisted case detail layout preference for a user.
 *
 * Returns `null` in any of the following cases:
 *   - Server-side rendering (`window` is not defined).
 *   - `userId` is empty or blank (cannot scope the key).
 *   - No value has been stored yet (first visit, or cleared storage).
 *   - The stored value is not a valid case layout ("T1"–"T5").
 *   - localStorage is unavailable (private browsing, security policy, quota).
 *
 * The caller is responsible for choosing a fallback value when `null` is
 * returned.  Both INVENTORY and SCAN hooks should default to "T1" (Summary
 * panel).
 *
 * @param userId  The authenticated user's stable identifier.
 * @returns       The stored `"T1"` – `"T5"` string, or `null` when absent.
 *
 * @example
 * ```ts
 * const stored = readCaseLayout("user_abc123");
 * const layout = stored ?? "T1"; // fall back to Summary panel
 * ```
 */
export function readCaseLayout(userId: string): CaseLayout | null {
  if (typeof window === "undefined") return null;
  if (!userId || !userId.trim()) return null;

  let stored: string | null = null;

  try {
    stored = localStorage.getItem(caseLayoutStorageKey(userId));
  } catch {
    // localStorage blocked by: private browsing mode, security policy, or
    // storage quota exceeded.
    return null;
  }

  return isCaseLayout(stored) ? stored : null;
}

/**
 * writeCaseLayout — persist the case detail layout preference for a user.
 *
 * The write is fire-and-forget: errors are caught silently so that a storage
 * failure never disrupts the in-memory UI state.
 *
 * No-op when:
 *   - Executing on the server (`window` is not defined).
 *   - `userId` is empty or blank.
 *
 * @param userId  The authenticated user's stable identifier.
 * @param layout  `"T1"` – `"T5"` — the case layout to persist.
 *
 * @example
 * ```ts
 * writeCaseLayout("user_abc123", "T3");
 * // localStorage["inv_case_layout:user_abc123"] → "T3"
 * ```
 */
export function writeCaseLayout(userId: string, layout: CaseLayout): void {
  if (typeof window === "undefined") return;
  if (!userId || !userId.trim()) return;

  try {
    localStorage.setItem(caseLayoutStorageKey(userId), layout);
  } catch {
    // Non-fatal: in-memory state is correct regardless of whether the value
    // was persisted.  The preference will revert to the default on next load.
  }
}
