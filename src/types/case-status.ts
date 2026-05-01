/**
 * src/types/case-status.ts
 *
 * Canonical TypeScript definition for the CaseStatus type.
 *
 * This is the single source of truth for case lifecycle status values used by:
 *   - The INVENTORY dashboard (map modes M1–M5, case detail panels T1–T5)
 *   - The SCAN mobile app (QR check-in, inspection, shipping, handoff flows)
 *   - Convex schema & query validators (convex/schema.ts, convex/cases.ts,
 *     convex/scan.ts)
 *
 * Lifecycle overview
 * ──────────────────
 *
 *   hangar ──▶ assembled ──▶ transit_out ──▶ deployed ──▶ transit_in ──▶ received ──▶ archived
 *                  │               │              │                           │
 *                  │         (redirected)      flagged ────────────────▶ transit_in
 *                  │                              │
 *                  │                           recalled ───────────────▶ transit_in
 *                  │                              │
 *                  └──────────────────────────────┘ (re-assemble at site)
 *
 * Status definitions
 * ──────────────────
 *   hangar       — Equipment stored in the hangar; not yet assembled for deployment.
 *   assembled    — Fully packed and ready to deploy; packing list complete.
 *   transit_out  — In transit from base to a field site via carrier.
 *   deployed     — Actively in use at a field site; may be under inspection.
 *   flagged      — Has outstanding issues (damage / missing items) requiring review.
 *   recalled     — Current holder has been notified to return the case to the hangar.
 *   transit_in   — In transit from a field site back to base.
 *   received     — Received back at base after return from field.
 *   archived     — Decommissioned; no longer in active rotation.
 */

// ─── Type ─────────────────────────────────────────────────────────────────────

/**
 * Valid lifecycle statuses for an equipment case.
 *
 * Mirrors the `caseStatus` union in convex/schema.ts — both definitions
 * must be kept in sync whenever a new status is added.
 */
export type CaseStatus =
  | "hangar"
  | "assembled"
  | "transit_out"
  | "deployed"
  | "flagged"
  | "recalled"
  | "transit_in"
  | "received"
  | "archived";

// ─── Runtime constant array ───────────────────────────────────────────────────

/**
 * Ordered array of all valid `CaseStatus` values.
 *
 * The order reflects the typical lifecycle progression:
 * hangar → assembled → transit_out → deployed → (flagged) → transit_in → received → archived
 *
 * Used for:
 *   • Validation / exhaustive-switch guards in application code
 *   • `getCaseStatusCounts` aggregate initialisation (zero-count baseline)
 *   • Filter dropdowns in the INVENTORY dashboard
 */
export const CASE_STATUSES: CaseStatus[] = [
  "hangar",
  "assembled",
  "transit_out",
  "deployed",
  "flagged",
  "recalled",
  "transit_in",
  "received",
  "archived",
];

// ─── Enum-like object (for code that prefers property access) ─────────────────

/**
 * Named constant bag for case status values.
 *
 * Provides a usage pattern similar to a TypeScript `enum` without the
 * runtime overhead or the bidirectional mapping that string enums produce.
 *
 * @example
 * // Prefer the type union in new code; use this object for legacy code or
 * // when you need a property-access pattern:
 * case.status === CaseStatusValues.deployed
 */
export const CaseStatusValues = {
  hangar:      "hangar"      as const,
  assembled:   "assembled"   as const,
  transit_out: "transit_out" as const,
  deployed:    "deployed"    as const,
  flagged:     "flagged"     as const,
  recalled:    "recalled"    as const,
  transit_in:  "transit_in"  as const,
  received:    "received"    as const,
  archived:    "archived"    as const,
} satisfies Record<CaseStatus, CaseStatus>;

// ─── Display metadata ─────────────────────────────────────────────────────────

/**
 * Human-readable label for each case status.
 * Used by UI components when they cannot reference StatusPill directly.
 */
export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  hangar:      "In Hangar",
  assembled:   "Assembled",
  transit_out: "Transit Out",
  deployed:    "Deployed",
  flagged:     "Flagged",
  recalled:    "Recalled",
  transit_in:  "Transit In",
  received:    "Received",
  archived:    "Archived",
};

/**
 * Short descriptive hint for each status (used in SCAN app UI and tooltips).
 */
export const CASE_STATUS_HINTS: Record<CaseStatus, string> = {
  hangar:      "Stored in hangar; not yet assembled",
  assembled:   "Fully packed and ready to deploy",
  transit_out: "In transit to field site",
  deployed:    "Actively in use at a field site",
  flagged:     "Has outstanding issues requiring review",
  recalled:    "Recalled to hangar; current holder should return it",
  transit_in:  "In transit returning to base",
  received:    "Received back at base",
  archived:    "Decommissioned; no longer in active rotation",
};

// ─── Sort order ───────────────────────────────────────────────────────────────

/**
 * Explicit numeric sort order for each `CaseStatus`.
 *
 * Lower values sort first. The order mirrors the typical lifecycle progression:
 *
 *   hangar (0) → assembled (1) → transit_out (2) → deployed (3)
 *             → flagged/recalled (4/5) → transit_in (6) → received (7) → archived (8)
 *
 * Useful when sorting case lists, tables, or dropdowns by lifecycle stage
 * rather than by string value or display label.
 *
 * @example
 * cases.sort((a, b) => CASE_STATUS_SORT_ORDER[a.status] - CASE_STATUS_SORT_ORDER[b.status])
 */
export const CASE_STATUS_SORT_ORDER: Readonly<Record<CaseStatus, number>> = {
  hangar:      0,
  assembled:   1,
  transit_out: 2,
  deployed:    3,
  flagged:     4,
  recalled:    5,
  transit_in:  6,
  received:    7,
  archived:    8,
};

// ─── Valid status transitions ─────────────────────────────────────────────────

/**
 * Allowed outbound transitions per source status.
 *
 * Used by:
 *   • convex/scan.ts — server-side guard in `scanCheckIn` mutation
 *   • SCAN app check-in screen — determines which statuses to offer the user
 *
 * A "no-op" (same status) is always allowed — it records a check-in event
 * without changing the status value.
 *
 * Transition rationale
 * ────────────────────
 *   hangar      → assembled            (case packed for deployment)
 *   assembled   → transit_out          (shipped out to site)
 *               → deployed             (direct delivery to nearby site)
 *               → hangar               (returned to storage before deploy)
 *   transit_out → deployed             (arrived at field site)
 *               → received             (redirected back to base)
 *   deployed    → flagged              (issues discovered on-site)
 *               → transit_in           (shipping back to base)
 *               → assembled            (re-packed at site for reuse)
 *   flagged     → deployed             (issues resolved on-site)
 *               → transit_in           (shipping back despite issues)
 *               → assembled            (returned to base for repair/repack)
 *   recalled    → transit_in           (return shipment started)
 *               → received             (returned directly to hangar)
 *   transit_in  → received             (arrived back at base)
 *   received    → assembled            (repackaged for next mission)
 *               → archived             (decommissioned)
 *               → hangar               (stored for later use)
 *   archived    → (terminal — no valid outbound transitions)
 */
export const CASE_STATUS_TRANSITIONS: Readonly<
  Record<CaseStatus, readonly CaseStatus[]>
> = {
  hangar:      ["assembled"],
  assembled:   ["transit_out", "deployed", "hangar"],
  transit_out: ["deployed", "received"],
  deployed:    ["flagged", "recalled", "transit_in", "assembled"],
  flagged:     ["deployed", "recalled", "transit_in", "assembled"],
  recalled:    ["transit_in", "received"],
  transit_in:  ["received"],
  received:    ["assembled", "archived", "hangar"],
  archived:    [],
};

// ─── Type guards ──────────────────────────────────────────────────────────────

/**
 * Type guard — returns true if `value` is a valid `CaseStatus` string.
 *
 * @example
 * if (isCaseStatus(rawString)) {
 *   // rawString is narrowed to CaseStatus here
 *   setStatus(rawString);
 * }
 */
export function isCaseStatus(value: unknown): value is CaseStatus {
  return typeof value === "string" && CASE_STATUSES.includes(value as CaseStatus);
}
