/**
 * src/lib/case-status-filter.ts
 *
 * Pure utility/selector for filtering a case list by active layer toggles.
 *
 * The INVENTORY map groups cases into four semantic "layer" categories that
 * can each be independently toggled on or off via LayerToggles:
 *
 *   ┌──────────────┬────────────────────────────────────────────────────────┐
 *   │ Toggle key   │ Covered CaseStatus values                              │
 *   ├──────────────┼────────────────────────────────────────────────────────┤
 *   │ deployed     │ "deployed"                                             │
 *   │ transit      │ "transit_out", "transit_in"                           │
 *   │ flagged      │ "flagged"                                              │
 *   │ hangar       │ "hangar", "assembled", "received", "archived"         │
 *   └──────────────┴────────────────────────────────────────────────────────┘
 *
 * Rationale for hangar bucket
 * ───────────────────────────
 * The `hangar` layer encompasses all statuses where a case is physically at
 * (or returning to) base and not actively deployed or in transit:
 *   • "hangar"    — idle in storage
 *   • "assembled" — packed and ready to ship; still at base
 *   • "received"  — recently returned; awaiting inspection/repack
 *   • "archived"  — decommissioned; no longer in active rotation
 *
 * When ALL toggles are active (the default), this selector returns the full
 * case list unchanged — equivalent to "no filter".  When ALL toggles are
 * inactive, it returns an empty array.
 *
 * Design
 * ──────
 * • Zero framework dependencies — safe for server components, SSR, and tests.
 * • Generic over any record type that has a `status` field typed as CaseStatus.
 *   Callers can pass MapCasePin[], M1CasePin[], Doc<"cases">[], etc.
 * • Accepts CaseStatus directly on the item to avoid stringly-typed lookups;
 *   unknown status values are excluded (defensive default).
 *
 * Usage
 * ─────
 * @example
 * // In a component or hook:
 * import { filterCasesByLayerToggles } from "@/lib/case-status-filter";
 *
 * const visiblePins = filterCasesByLayerToggles(layerToggles, allPins);
 *
 * @example
 * // Partial filter — hide transit layer only:
 * const toggles = { deployed: true, transit: false, flagged: true, hangar: true };
 * const filtered = filterCasesByLayerToggles(toggles, cases);
 * // → returns deployed, flagged, and hangar-bucket cases only
 */

import type { CaseStatus } from "@/types/case-status";
import type { LayerToggles, LayerToggleKey } from "@/types/map";
import { LAYER_TOGGLE_KEYS } from "@/types/map";

// ─── Status mapping ───────────────────────────────────────────────────────────

/**
 * Maps each `LayerToggleKey` to the `CaseStatus` values it governs.
 *
 * This is the single source of truth for the toggle → status mapping.
 * Update this record whenever a new CaseStatus is added to the lifecycle.
 */
export const LAYER_TOGGLE_STATUS_MAP: Readonly<
  Record<LayerToggleKey, readonly CaseStatus[]>
> = {
  deployed: ["deployed"],
  transit:  ["transit_out", "transit_in"],
  flagged:  ["flagged"],
  hangar:   ["hangar", "assembled", "received", "archived"],
} as const;

// ─── Selector ─────────────────────────────────────────────────────────────────

/**
 * Derive the set of `CaseStatus` values that should be visible given the
 * current `LayerToggles` state.
 *
 * - If all toggles are active, returns all 8 CaseStatus values.
 * - If all toggles are inactive, returns an empty Set.
 *
 * @param toggles - Active/inactive state for each of the four layer categories.
 * @returns A `Set<CaseStatus>` of all statuses that should be rendered.
 */
export function getVisibleStatuses(toggles: LayerToggles): Set<CaseStatus> {
  const visible = new Set<CaseStatus>();
  for (const key of LAYER_TOGGLE_KEYS) {
    if (toggles[key]) {
      for (const status of LAYER_TOGGLE_STATUS_MAP[key]) {
        visible.add(status);
      }
    }
  }
  return visible;
}

// ─── Filter function ──────────────────────────────────────────────────────────

/**
 * Filter a case list by the active layer toggle state.
 *
 * Returns a new array containing only cases whose `status` field maps to at
 * least one active layer toggle.  The original array is never mutated.
 *
 * Generic over `T` so this works with any case-shaped object that includes
 * a `status: CaseStatus` field — MapCasePin, M1CasePin, Convex Doc<"cases">,
 * custom projection types, etc.
 *
 * **Performance note**: The visible-status Set is computed once per call
 * (O(4) construction) and each subsequent membership test is O(1), giving
 * an overall O(n) pass over the cases array.  For typical fleet sizes
 * (≤5,000 cases) this is negligible; the function is safe to call on every
 * render inside a `useMemo` without a separate memoised `visibleStatuses` arg.
 *
 * @param toggles - The active layer toggle state from `useLayerToggles`.
 * @param cases   - The full, unfiltered case list.
 * @returns A new array of cases whose status is covered by an active toggle.
 *
 * @example
 * // All layers on — returns all cases unchanged (new array, same contents)
 * filterCasesByLayerToggles(DEFAULT_LAYER_TOGGLES, allCases);
 *
 * @example
 * // Only flagged layer on
 * filterCasesByLayerToggles({ deployed: false, transit: false, flagged: true, hangar: false }, cases);
 * // → only cases with status "flagged"
 *
 * @example
 * // All layers off — returns empty array
 * filterCasesByLayerToggles({ deployed: false, transit: false, flagged: false, hangar: false }, cases);
 * // → []
 */
export function filterCasesByLayerToggles<T extends { status: CaseStatus | string }>(
  toggles: LayerToggles,
  cases: readonly T[]
): T[] {
  const visible = getVisibleStatuses(toggles);
  // Fast path — if all statuses are visible (default state), return a shallow
  // copy of the full array rather than filtering (avoids a complete O(n) scan
  // for the common case where no layer is hidden).
  if (visible.size === 8) {
    return [...cases];
  }
  // All-hidden fast path — no cases can match.
  if (visible.size === 0) {
    return [];
  }
  return cases.filter((c) => visible.has(c.status as CaseStatus));
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Returns the `LayerToggleKey` that governs the given `CaseStatus`, or
 * `null` if the status is not covered by any toggle (defensive for unknown
 * values not yet added to the mapping).
 *
 * Useful for UI components that need to know which toggle controls a given
 * status pill or map pin.
 *
 * @example
 * getToggleKeyForStatus("transit_out") // → "transit"
 * getToggleKeyForStatus("assembled")   // → "hangar"
 * getToggleKeyForStatus("deployed")    // → "deployed"
 */
export function getToggleKeyForStatus(
  status: CaseStatus | string
): LayerToggleKey | null {
  for (const key of LAYER_TOGGLE_KEYS) {
    if ((LAYER_TOGGLE_STATUS_MAP[key] as readonly string[]).includes(status)) {
      return key;
    }
  }
  return null;
}

/**
 * Returns `true` if the given `CaseStatus` would be visible under the
 * provided `LayerToggles`.
 *
 * A convenience predicate that avoids constructing the full visible-status Set
 * when you only need to check a single case.  Use `filterCasesByLayerToggles`
 * when filtering a collection.
 *
 * @example
 * isCaseVisibleUnderToggles("deployed", layerToggles) // → true/false
 */
export function isCaseVisibleUnderToggles(
  status: CaseStatus | string,
  toggles: LayerToggles
): boolean {
  const key = getToggleKeyForStatus(status);
  if (key === null) return false; // unknown status → not visible
  return toggles[key];
}
