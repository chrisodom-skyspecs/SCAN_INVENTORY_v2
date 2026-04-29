/**
 * src/hooks/use-default-layout-on-case-change.ts
 *
 * useDefaultLayoutOnCaseChange — auto-apply recommended INVENTORY layout
 * when a case is selected and no explicit user preference is stored.
 *
 * Rationale
 * ─────────
 * The INVENTORY dashboard has five map modes (M1–M5) and five case detail
 * layouts (T1–T5).  Each case lifecycle status has a canonical "best view"
 * pair defined in `getDefaultLayout` (from state-layout-map.ts):
 *
 *   hangar      → M1 + T1  (fleet overview + summary)
 *   assembled   → M1 + T2  (fleet overview + manifest)
 *   transit_out → M3 + T4  (transit tracker + shipping)
 *   deployed    → M2 + T3  (site detail + inspection)
 *   flagged     → M2 + T3  (site detail + inspection)
 *   transit_in  → M3 + T4  (transit tracker + shipping)
 *   received    → M1 + T1  (fleet overview + summary)
 *   archived    → M1 + T1  (fleet overview + summary)
 *
 * This hook bridges `getDefaultLayout` and the INVENTORY dashboard rendering
 * logic.  It subscribes to the selected case's real-time Convex status and
 * updates the URL-driven map view + case window whenever:
 *
 *   a) The component mounts with a case already selected (deep link restore)
 *   b) The active case changes (user selects a different case)
 *   c) The selected case's lifecycle status changes via a Convex push update
 *      (e.g., a SCAN app action transitions the case from `deployed` to
 *      `transit_in` — the dashboard automatically switches to Transit Tracker)
 *
 * Explicit-preference guard
 * ─────────────────────────
 * The defaults are only applied when NO explicit user preference exists in
 * localStorage:
 *
 *   • `readMapMode(userId) === null`   → no stored map mode preference
 *   • `readCaseLayout(userId) === null` → no stored case layout preference
 *
 * If both preferences are stored, the user's explicit choices take precedence
 * and this hook is a no-op.  If only one is stored, only the absent preference
 * is filled in from `getDefaultLayout`.
 *
 * SSR safety
 * ──────────
 * The `readMapMode` / `readCaseLayout` calls are inside `useEffect`, which
 * only runs on the client.  No `window` / `localStorage` access occurs during
 * server rendering.
 *
 * Idempotency
 * ───────────
 * `setParams` writes to the URL (replaces the current history entry).
 * If the URL already has the same values, Next.js router.replace() is a
 * no-op.  The effect therefore does not cause infinite re-renders.
 *
 * @module
 */

"use client";

import { useEffect } from "react";
import { useCaseStatus } from "@/hooks/use-case-status";
import { readMapMode, readCaseLayout } from "@/lib/layout-storage";
import { getDefaultLayout } from "@/lib/state-layout-map";
import type { MapView, CaseWindow } from "@/types/map";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal patch shape accepted by the INVENTORY URL state setter.
 * Matches the `Partial<MapParams>` subset used by `useMapParams.setParams`.
 */
export interface DefaultLayoutPatch {
  /** Active map view to apply ("M1"–"M5"). */
  view?: MapView;
  /** Active case detail window to apply ("T1"–"T5"). */
  caseWindow?: CaseWindow;
}

/**
 * Options for `useDefaultLayoutOnCaseChange`.
 */
export interface UseDefaultLayoutOnCaseChangeOptions {
  /**
   * Convex document ID of the currently selected case, or `null` when no
   * case is selected.  Drives the `useCaseStatus` subscription.
   *
   * @example "jx7d2abc000xyz"
   */
  activeCaseId: string | null;

  /**
   * Kinde user ID used to scope the localStorage preference keys.
   *
   * Pass an empty string `""` when the user is not yet authenticated — the
   * localStorage checks will return `null` and defaults will be applied as if
   * no preference exists, which is the correct behavior for unauthenticated
   * sessions (e.g. public deep links before the Kinde session resolves).
   *
   * @example "kp_abc123def456"
   */
  userId: string;

  /**
   * Callback that atomically updates the active map mode and/or case detail
   * window in the URL.  Pass `setParams` from `useMapParams`.
   *
   * Must be a stable reference (i.e. wrapped in `useCallback` upstream) to
   * prevent unnecessary effect re-runs.
   *
   * @example
   * const { setParams } = useMapParams();
   * // pass setParams directly — it is already stable from useMapParams
   */
  setParams: (patch: DefaultLayoutPatch) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useDefaultLayoutOnCaseChange
 *
 * Automatically applies the recommended INVENTORY map mode and case detail
 * layout when a case is selected or its lifecycle status changes via a real-
 * time Convex push update, provided no explicit user preference is stored.
 *
 * Call this hook inside `InventoryMapClient` alongside `useMapParams` and
 * `useKindeUser`.  The hook is a pure side-effect — it does not return any
 * values.
 *
 * @param options.activeCaseId  Selected case Convex ID, or null.
 * @param options.userId        Kinde user ID for localStorage scoping.
 * @param options.setParams     URL state setter from `useMapParams`.
 *
 * @example
 * // Inside InventoryMapClient:
 * const { activeCaseId, caseWindow, view, setParams } = useMapParams();
 * const { id: userId } = useKindeUser();
 *
 * useDefaultLayoutOnCaseChange({ activeCaseId, userId, setParams });
 */
export function useDefaultLayoutOnCaseChange({
  activeCaseId,
  userId,
  setParams,
}: UseDefaultLayoutOnCaseChangeOptions): void {
  // ── Real-time case status subscription ────────────────────────────────────
  //
  // `useCaseStatus` returns:
  //   undefined  — Convex subscription loading (initial fetch / reconnect)
  //   null       — case not found in the database
  //   CaseStatusResult — live case document (includes `.status`)
  //
  // The subscription is automatically skipped when `activeCaseId` is null
  // (the `"skip"` pattern in useCaseStatus).
  const caseStatus = useCaseStatus(activeCaseId);

  // ── Effect: apply defaults when case or status changes ───────────────────
  useEffect(() => {
    // ── Guard 1: No case selected ─────────────────────────────────────────
    //
    // When no case is selected, there is no status context from which to
    // derive defaults.  Skip without resetting any URL state — the current
    // map view was either set by the user or is the initial default.
    if (activeCaseId === null) return;

    // ── Guard 2: Case status not yet available ────────────────────────────
    //
    // `undefined` means the Convex subscription is still loading.
    // `null` means the case was not found (should not happen in normal flow
    // — caseId comes from a valid map pin or deep link).
    // In either case, skip and wait for the next update.
    if (caseStatus === undefined || caseStatus === null) return;

    // ── Guard 3: Check for explicit stored preferences ────────────────────
    //
    // `readMapMode` / `readCaseLayout` return:
    //   - The stored value ("M1"–"M5" / "T1"–"T5") when present and valid
    //   - null when: absent, invalid, SSR, userId empty, or localStorage blocked
    //
    // A non-null return value means the user has explicitly set a preference
    // via `setMapMode` / `setCaseLayout` (in `useLayoutPreferences`) and that
    // preference has been persisted to localStorage.  We MUST respect it.
    const hasStoredMapMode = userId ? readMapMode(userId) !== null : false;
    const hasStoredCaseLayout = userId ? readCaseLayout(userId) !== null : false;

    // Both preferences are stored — nothing to do.  The user's explicit
    // choices take precedence over status-derived defaults.
    if (hasStoredMapMode && hasStoredCaseLayout) return;

    // ── Derive defaults from the case's current lifecycle status ──────────
    //
    // `getDefaultLayout` is a pure function that maps a case status string to
    // a `{ mapMode, detailLayout }` pair.  It never throws and falls back to
    // `{ mapMode: "M1", detailLayout: "T1" }` for unknown / future statuses.
    const { mapMode, detailLayout } = getDefaultLayout(caseStatus.status);

    // ── Build the URL patch ───────────────────────────────────────────────
    //
    // Only include fields that do NOT have an explicit stored preference.
    // This ensures we never override a partial explicit preference (e.g., the
    // user has a stored map mode but not a stored case layout — in that case
    // only the case layout is updated from the recommendation).
    const patch: DefaultLayoutPatch = {};
    if (!hasStoredMapMode) {
      patch.view = mapMode;
    }
    if (!hasStoredCaseLayout) {
      patch.caseWindow = detailLayout;
    }

    // ── Apply the defaults to the URL ────────────────────────────────────
    //
    // `setParams` calls `router.replace()` which is idempotent — if the URL
    // already contains the same values, the call is a no-op from the browser's
    // perspective (Next.js does not push a duplicate history entry).
    if (Object.keys(patch).length > 0) {
      setParams(patch);
    }
  }, [activeCaseId, caseStatus, userId, setParams]);
}
