/**
 * state-layout-map.ts — Case status → recommended INVENTORY view mapping
 *
 * Defines the canonical mapping from each case lifecycle status to:
 *   • The recommended INVENTORY dashboard map mode (M1–M5)
 *   • The recommended case detail panel layout (T1–T5)
 *
 * Rationale
 * ─────────
 * When a user selects a case (via QR scan deep-link, search, or map click),
 * the INVENTORY dashboard can suggest the most contextually relevant map mode
 * and case detail layout based on the case's current lifecycle status.  This
 * mapping is the single source of truth for those recommendations.
 *
 * The recommendations follow operational intent:
 *
 *   hangar      → M1 + T1  Fleet overview + summary: case is idle at base.
 *   assembled   → M1 + T2  Fleet overview + manifest: verify packing list
 *                           before the case leaves the hangar.
 *   transit_out → M3 + T4  Transit tracker + shipping: live FedEx tracking
 *                           for the outbound leg.
 *   deployed    → M2 + T3  Site detail + inspection: case is active at a
 *                           field site; inspection view is most relevant.
 *   flagged     → M2 + T3  Site detail + inspection: same as deployed but
 *                           flagged for damage/missing items; inspection is
 *                           critical context.
 *   transit_in  → M3 + T4  Transit tracker + shipping: live FedEx tracking
 *                           for the inbound return leg.
 *   received    → M1 + T1  Fleet overview + summary: case has returned to
 *                           base; summary confirms receipt.
 *   archived    → M1 + T1  Fleet overview + summary: decommissioned case;
 *                           summary-only view is most appropriate.
 *
 * Map modes (M1–M5)
 * ─────────────────
 *   M1 = Fleet Overview   — all cases on a world/region map with status pins
 *   M2 = Site Detail      — zoomed view of a single deployment site
 *   M3 = Transit Tracker  — cases in transit with FedEx route overlays
 *   M4 = Heat Map         — status density / damage heat map
 *   M5 = Mission Control  — time-scrubbing replay (FF_MAP_MISSION)
 *
 * Case detail layouts (T1–T5)
 * ───────────────────────────
 *   T1 = Summary panel
 *   T2 = Manifest / packing list
 *   T3 = Inspection history
 *   T4 = Shipping & custody chain
 *   T5 = Audit hash chain (FF_AUDIT_HASH_CHAIN)
 *
 * Usage
 * ─────
 *   import { STATE_LAYOUT_MAP, getRecommendedLayout } from "@/lib/state-layout-map";
 *
 *   // Direct lookup
 *   const { mapMode, caseLayout } = STATE_LAYOUT_MAP["transit_out"];
 *   // → { mapMode: "M3", caseLayout: "T4" }
 *
 *   // Helper function (includes fallback)
 *   const rec = getRecommendedLayout("deployed");
 *   // → { mapMode: "M2", caseLayout: "T3", reason: "..." }
 *
 * @module
 */

import type { CaseStatus } from "@/types/case-status";
import type { MapView, CaseWindow } from "@/types/map";

// ─── Entry type ───────────────────────────────────────────────────────────────

/**
 * A single entry in the state-to-layout mapping.
 *
 * Contains the recommended map mode and case detail layout for a given
 * case lifecycle status, plus a human-readable rationale string that
 * explains why this combination was chosen.  The rationale is useful for
 * developer tooling, tooltips, and future AI-driven recommendations.
 */
export interface StateLayoutEntry {
  /**
   * Recommended INVENTORY dashboard map mode for this case status.
   *
   * "M1" | "M2" | "M3" | "M4" | "M5"
   */
  readonly mapMode: MapView;

  /**
   * Recommended case detail panel layout for this case status.
   *
   * "T1" | "T2" | "T3" | "T4" | "T5"
   */
  readonly caseLayout: CaseWindow;

  /**
   * Human-readable rationale for this recommendation.
   *
   * One or two sentences explaining why this map mode + layout combination
   * is the best match for the case's current lifecycle stage.  Suitable for
   * use in tooltips, help text, or audit trails.
   */
  readonly reason: string;
}

// ─── Mapping table ────────────────────────────────────────────────────────────

/**
 * STATE_LAYOUT_MAP — canonical mapping from CaseStatus to recommended view.
 *
 * Every valid `CaseStatus` value is covered.  The mapping is intentionally
 * conservative — it always falls back to Fleet Overview (M1) + Summary (T1)
 * rather than guessing at a more specific layout when context is unclear
 * (e.g., `archived`, `received`).
 *
 * This object is `Readonly` so that tree-shaking and bundlers can inline
 * individual entries.  Never mutate this object at runtime.
 *
 * @example
 * const entry = STATE_LAYOUT_MAP["deployed"];
 * // entry.mapMode   → "M2"
 * // entry.caseLayout → "T3"
 * // entry.reason    → "Case is active at a field site..."
 */
export const STATE_LAYOUT_MAP: Readonly<Record<CaseStatus, StateLayoutEntry>> =
  {
    /**
     * hangar — case is idle in the hangar, not yet assembled.
     * Fleet overview + summary is the right default: no inspection or shipping
     * context is needed until the case enters the assembly workflow.
     */
    hangar: {
      mapMode: "M1",
      caseLayout: "T1",
      reason:
        "Case is stored in the hangar. Fleet Overview (M1) shows its position " +
        "among all cases; Summary (T1) provides a quick status snapshot before " +
        "the assembly workflow begins.",
    },

    /**
     * assembled — case is fully packed and ready to deploy.
     * Manifest view (T2) is most useful here: the operator can verify the
     * packing list before the case leaves the hangar.  M1 keeps the full
     * fleet in view so the deployment can be planned in context.
     */
    assembled: {
      mapMode: "M1",
      caseLayout: "T2",
      reason:
        "Case is fully packed and ready to deploy. Fleet Overview (M1) supports " +
        "deployment planning across all sites; Manifest (T2) lets the operator " +
        "verify the packing list before the case is shipped out.",
    },

    /**
     * transit_out — case is in transit from base to a field site.
     * Transit Tracker (M3) shows live FedEx route overlays and ETA for the
     * outbound leg.  Shipping (T4) surfaces the custody chain, tracking number,
     * and carrier status directly in the detail panel.
     */
    transit_out: {
      mapMode: "M3",
      caseLayout: "T4",
      reason:
        "Case is in transit to a field site. Transit Tracker (M3) shows the " +
        "active FedEx route and ETA; Shipping (T4) surfaces the custody chain " +
        "and live carrier status for the outbound leg.",
    },

    /**
     * deployed — case is actively in use at a field site.
     * Site Detail (M2) zooms to the deployment site for per-case spatial
     * context.  Inspection (T3) is the primary operational view: field
     * technicians log findings here and the dashboard mirrors them in real time.
     */
    deployed: {
      mapMode: "M2",
      caseLayout: "T3",
      reason:
        "Case is actively deployed at a field site. Site Detail (M2) zooms to " +
        "the deployment location for spatial context; Inspection (T3) surfaces " +
        "real-time field findings logged by the SCAN app.",
    },

    /**
     * flagged — case has outstanding issues (damage / missing items).
     * Same as deployed: Site Detail (M2) + Inspection (T3).  The inspection
     * view is even more important here because it shows the specific items
     * that have been flagged and any annotated damage photos.
     */
    flagged: {
      mapMode: "M2",
      caseLayout: "T3",
      reason:
        "Case is flagged for outstanding issues. Site Detail (M2) keeps the " +
        "field location in view; Inspection (T3) surfaces the flagged items, " +
        "damage reports, and annotated photos that need review.",
    },

    /**
     * transit_in — case is in transit from a field site back to base.
     * Mirrors transit_out: Transit Tracker (M3) + Shipping (T4) for live
     * return-leg tracking and inbound custody chain visibility.
     */
    transit_in: {
      mapMode: "M3",
      caseLayout: "T4",
      reason:
        "Case is in transit returning to base. Transit Tracker (M3) shows the " +
        "inbound FedEx route and ETA; Shipping (T4) surfaces the return-leg " +
        "custody chain and carrier status.",
    },

    /**
     * received — case has been received back at base.
     * Fleet overview + summary confirms receipt and positions the case in
     * the overall fleet.  No shipping or inspection context is immediately
     * needed; the next step is re-assembly or archiving.
     */
    received: {
      mapMode: "M1",
      caseLayout: "T1",
      reason:
        "Case has been received back at base. Fleet Overview (M1) confirms " +
        "its return among all fleet assets; Summary (T1) shows the receipt " +
        "status and any next-step actions before re-assembly or archiving.",
    },

    /**
     * archived — case is decommissioned; no longer in active rotation.
     * Summary (T1) is the only meaningful view for an archived case.
     * Fleet Overview (M1) is chosen so the case can still be located
     * in historical reports without implying active operational context.
     */
    archived: {
      mapMode: "M1",
      caseLayout: "T1",
      reason:
        "Case is archived and no longer in active rotation. Fleet Overview (M1) " +
        "allows historical lookup; Summary (T1) is the appropriate read-only " +
        "view for a decommissioned asset.",
    },
  } as const;

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * getRecommendedLayout — look up the recommended map mode and case layout
 * for a given case status.
 *
 * This is the primary consumption point for the state-layout mapping.
 * It wraps a direct `STATE_LAYOUT_MAP` lookup but provides:
 *   - A clear call-site signature that names the intent
 *   - A typed return value consumers can destructure
 *   - A fallback to `{ mapMode: "M1", caseLayout: "T1" }` for any
 *     unexpected/future status value (defensive programming)
 *
 * @param status  The current lifecycle status of the case.
 * @returns       The recommended `StateLayoutEntry` for that status.
 *
 * @example
 * const { mapMode, caseLayout, reason } = getRecommendedLayout("transit_out");
 * // → { mapMode: "M3", caseLayout: "T4", reason: "..." }
 *
 * // Apply to URL state:
 * setMapState({ view: mapMode, window: caseLayout });
 */
export function getRecommendedLayout(status: CaseStatus): StateLayoutEntry {
  return (
    STATE_LAYOUT_MAP[status] ?? {
      mapMode: "M1" as MapView,
      caseLayout: "T1" as CaseWindow,
      reason:
        "Unknown status — falling back to Fleet Overview (M1) and Summary (T1).",
    }
  );
}

/**
 * getRecommendedMapMode — return only the recommended map mode for a status.
 *
 * Convenience wrapper around `getRecommendedLayout` for callers that only need
 * the `MapView` value and not the full entry.
 *
 * @param status  The current lifecycle status of the case.
 * @returns       The recommended `MapView` ("M1"–"M5").
 *
 * @example
 * const mode = getRecommendedMapMode("deployed");
 * // → "M2"
 */
export function getRecommendedMapMode(status: CaseStatus): MapView {
  return getRecommendedLayout(status).mapMode;
}

/**
 * getRecommendedCaseLayout — return only the recommended case layout for a status.
 *
 * Convenience wrapper around `getRecommendedLayout` for callers that only need
 * the `CaseWindow` value and not the full entry.
 *
 * @param status  The current lifecycle status of the case.
 * @returns       The recommended `CaseWindow` ("T1"–"T5").
 *
 * @example
 * const layout = getRecommendedCaseLayout("assembled");
 * // → "T2"
 */
export function getRecommendedCaseLayout(status: CaseStatus): CaseWindow {
  return getRecommendedLayout(status).caseLayout;
}

// ─── getDefaultLayout ─────────────────────────────────────────────────────────

/**
 * DefaultLayout — the return shape of `getDefaultLayout`.
 *
 * Uses `detailLayout` (not `caseLayout`) to align with the INVENTORY URL state
 * terminology where the case detail panel position is called `window` in
 * URL params but "detailLayout" in component props and the spec's AC language.
 */
export interface DefaultLayout {
  /**
   * Recommended INVENTORY dashboard map mode for the given case status.
   *
   * "M1" | "M2" | "M3" | "M4" | "M5"
   */
  readonly mapMode: MapView;

  /**
   * Recommended case detail panel layout for the given case status.
   *
   * "T1" | "T2" | "T3" | "T4" | "T5"
   */
  readonly detailLayout: CaseWindow;
}

/**
 * FALLBACK_DEFAULT_LAYOUT — the value returned by `getDefaultLayout` for any
 * status that is not present in `STATE_LAYOUT_MAP`.
 *
 * Fleet Overview (M1) + Summary (T1) is the safest / most neutral combination:
 * it shows the full fleet without implying any specific operational context.
 *
 * Exported so that callers can reference the fallback value in tests and
 * documentation without duplicating the literal.
 */
export const FALLBACK_DEFAULT_LAYOUT: DefaultLayout = {
  mapMode: "M1" as MapView,
  detailLayout: "T1" as CaseWindow,
} as const;

/**
 * getDefaultLayout — pure utility that returns the recommended
 * `{ mapMode, detailLayout }` pair for a given case state.
 *
 * This is the primary consumption point when the caller:
 *   (a) may receive a raw / unvalidated status string from an external source
 *       (URL param, Convex document field, API response, deep-link), OR
 *   (b) only needs `{ mapMode, detailLayout }` without the full `StateLayoutEntry`
 *       (reason string is not required).
 *
 * Behaviour
 * ─────────
 *   - For a known `CaseStatus` value: looks up `STATE_LAYOUT_MAP` and returns
 *     the recommended `{ mapMode, detailLayout }` pair.
 *   - For any unknown / future status string: returns `FALLBACK_DEFAULT_LAYOUT`
 *     `{ mapMode: "M1", detailLayout: "T1" }` — never throws.
 *
 * The input is typed as `string` (not `CaseStatus`) so that callers working
 * with raw data do not need to validate before calling.  The function performs
 * the validation internally via `STATE_LAYOUT_MAP` lookup.
 *
 * This is a **pure function** — it has no side effects, does not read from
 * external state, and always returns the same output for the same input.
 *
 * @param caseState  The current lifecycle status of a case (raw string).
 * @returns          `{ mapMode, detailLayout }` for the status, or the fallback
 *                   if the status is not in the registry.
 *
 * @example
 * // Known status
 * getDefaultLayout("transit_out");
 * // → { mapMode: "M3", detailLayout: "T4" }
 *
 * // Known status
 * getDefaultLayout("deployed");
 * // → { mapMode: "M2", detailLayout: "T3" }
 *
 * // Unknown / future status — safe fallback
 * getDefaultLayout("some_future_status");
 * // → { mapMode: "M1", detailLayout: "T1" }
 *
 * // Apply to INVENTORY map state:
 * const { mapMode, detailLayout } = getDefaultLayout(caseDoc.status);
 * setMapState({ view: mapMode, window: detailLayout });
 */
export function getDefaultLayout(caseState: string): DefaultLayout {
  const entry = STATE_LAYOUT_MAP[caseState as CaseStatus];
  if (!entry) {
    return FALLBACK_DEFAULT_LAYOUT;
  }
  return {
    mapMode: entry.mapMode,
    detailLayout: entry.caseLayout,
  };
}

/**
 * ALL_STATE_LAYOUT_ENTRIES — ordered array of all status→layout mapping entries.
 *
 * Preserves the lifecycle order defined in `CASE_STATUSES` (from
 * `@/types/case-status`) for use in debug tables, admin UI, and exports.
 *
 * Each entry includes the `status` key alongside the `StateLayoutEntry` fields
 * so consumers don't need to re-derive it.
 *
 * @example
 * ALL_STATE_LAYOUT_ENTRIES.forEach(({ status, mapMode, caseLayout }) => {
 *   console.log(`${status}: ${mapMode} / ${caseLayout}`);
 * });
 */
export const ALL_STATE_LAYOUT_ENTRIES: ReadonlyArray<
  { readonly status: CaseStatus } & StateLayoutEntry
> = (
  [
    "hangar",
    "assembled",
    "transit_out",
    "deployed",
    "flagged",
    "transit_in",
    "received",
    "archived",
  ] as const satisfies readonly CaseStatus[]
).map((status) => ({
  status,
  ...STATE_LAYOUT_MAP[status],
}));
