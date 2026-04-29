/**
 * convex/userPreferences.ts
 *
 * Layout preference persistence for the SkySpecs INVENTORY dashboard.
 *
 * This module owns the `userPreferences` table — a one-row-per-user store that
 * persists structured layout state across sessions and devices.  Unlike the
 * simple scalar preference fields on the `users` table (themePreference,
 * invDensityPreference, scanDensityPreference), this table holds the richer
 * layout objects that would be awkward to flatten into scalar columns.
 *
 * Public API
 * ──────────
 *   getLayoutPreferences      — query:    return the caller's layout preferences
 *   upsertLayoutPreferences   — mutation: create-or-update the caller's layout prefs
 *
 * Reconciliation strategy with localStorage
 * ─────────────────────────────────────────
 *   1. On page load: read from localStorage (layout-storage.ts helpers) for
 *      immediate, synchronous hydration — no network round-trip required.
 *   2. When `getLayoutPreferences` resolves: if the Convex value differs from
 *      localStorage, overwrite localStorage with the Convex value (Convex wins
 *      for cross-device sync; localStorage is a device-local cache only).
 *   3. On user change: write to BOTH localStorage AND call `upsertLayoutPreferences`
 *      so the preference is persisted cross-device.
 *
 * Upsert semantics
 * ────────────────
 * `upsertLayoutPreferences` accepts a PARTIAL `layoutPreferences` object.  Only
 * the fields present in the argument are written; all other stored fields are
 * preserved.  The merge is deep for the `layerToggles` sub-object: providing
 * `{ layerToggles: { deployed: true } }` only updates the `deployed` key and
 * leaves the other layer toggles unchanged.
 *
 * Authentication
 * ──────────────
 * Both functions enforce Kinde authentication via `ctx.auth.getUserIdentity()`.
 *   • `upsertLayoutPreferences` — throws [AUTH_REQUIRED] when unauthenticated.
 *   • `getLayoutPreferences`    — returns `null` when unauthenticated (no throw)
 *     so that public/login pages can call this query without triggering errors
 *     before the Kinde session has been established.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ─── Shared value validators ──────────────────────────────────────────────────

/**
 * Map mode validator — matches the `activeMapMode` field in the schema.
 * "M1" Fleet Overview · "M2" Site Detail · "M3" Transit Tracker ·
 * "M4" Heat Map · "M5" Mission Control (FF_MAP_MISSION)
 */
const mapModeValidator = v.union(
  v.literal("M1"),
  v.literal("M2"),
  v.literal("M3"),
  v.literal("M4"),
  v.literal("M5"),
);

/**
 * Case layout validator — matches the `activeCaseLayout` field in the schema.
 * "T1" Summary · "T2" Manifest · "T3" Inspection History ·
 * "T4" Shipping & Custody · "T5" Audit Hash Chain (FF_AUDIT_HASH_CHAIN)
 */
const caseLayoutValidator = v.union(
  v.literal("T1"),
  v.literal("T2"),
  v.literal("T3"),
  v.literal("T4"),
  v.literal("T5"),
);

/**
 * Layer toggles validator — matches the `layerToggles` sub-object in the schema.
 * All keys are optional so partial updates are valid.
 */
const layerTogglesValidator = v.object({
  /** Cases currently deployed at field sites. */
  deployed:  v.optional(v.boolean()),
  /** Cases in transit (inbound or outbound). */
  transit:   v.optional(v.boolean()),
  /** Full fleet overview (all case pins). */
  fleet:     v.optional(v.boolean()),
  /** Damage / flagged case indicators. */
  damage:    v.optional(v.boolean()),
  /** Wind turbine / inspection site markers. */
  turbines:  v.optional(v.boolean()),
  /** Status density heat map overlay. */
  heatmap:   v.optional(v.boolean()),
  /** Mission zone polygons (M5 / FF_MAP_MISSION). */
  missions:  v.optional(v.boolean()),
});

// ─── Query: getLayoutPreferences ─────────────────────────────────────────────

/**
 * Public query — return the authenticated user's persisted layout preferences.
 *
 * Called by the `useLayoutPreferences` client hook during INVENTORY dashboard
 * initialization.  When the query resolves with a non-null value, the client
 * should overwrite its local state (and localStorage) so that cross-device
 * changes are picked up.
 *
 * Return shape
 * ─────────────
 *   {
 *     activeMapMode?: "M1" | "M2" | "M3" | "M4" | "M5"
 *     activeCaseLayout?: "T1" | "T2" | "T3" | "T4" | "T5"
 *     layerToggles?: { deployed?, transit?, fleet?, damage?, turbines?, heatmap?, missions? }
 *     sidebarCollapsed?: boolean
 *     lastViewedCaseId?: string
 *     updatedAt: number     — epoch ms when preferences were last saved
 *   }
 *   | null    — unauthenticated, or no preferences stored yet (first visit)
 *   | undefined — Convex client loading (standard Convex query loading state)
 *
 * The caller should treat `null` and `undefined` the same way:
 *   "fall back to localStorage, then to hard-coded defaults."
 *
 * Authentication: unauthenticated callers receive `null` — no error thrown —
 * so the login page can render without triggering auth errors before the Kinde
 * session resolves.
 */
export const getLayoutPreferences = query({
  args: {},
  handler: async (ctx) => {
    // Soft auth — return null instead of throwing so unauthenticated pages render
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const kindeId = identity.subject;

    const row = await ctx.db
      .query("userPreferences")
      .withIndex("by_user_id", (q) => q.eq("userId", kindeId))
      .first();

    if (!row) return null;

    // Return the flattened preference bag with the updatedAt timestamp so the
    // client can detect stale localStorage values.
    return {
      ...row.layoutPreferences,
      updatedAt: row.updatedAt,
    };
  },
});

// ─── Mutation: upsertLayoutPreferences ───────────────────────────────────────

/**
 * Public mutation — create or deep-merge the authenticated user's layout
 * preferences into the `userPreferences` table.
 *
 * Semantics
 * ─────────
 * • First call — inserts a new `userPreferences` row with the provided fields.
 * • Subsequent calls — patches only the fields present in the argument object;
 *   all other stored fields are preserved.
 * • `layerToggles` — deep-merged: providing `{ layerToggles: { deployed: true } }`
 *   only updates the `deployed` key and leaves the remaining layer toggles intact.
 *
 * This partial-update design means callers can issue a focused mutation when only
 * one preference changes without having to read-then-write the full object:
 *
 *   // Only update the active map mode — leave everything else unchanged
 *   useMutation(api.userPreferences.upsertLayoutPreferences)({
 *     activeMapMode: "M3",
 *   });
 *
 *   // Only collapse the sidebar
 *   useMutation(api.userPreferences.upsertLayoutPreferences)({
 *     sidebarCollapsed: true,
 *   });
 *
 *   // Update the active case layout and remember the last-viewed case
 *   useMutation(api.userPreferences.upsertLayoutPreferences)({
 *     activeCaseLayout: "T4",
 *     lastViewedCaseId: "j57abc...",
 *   });
 *
 * Arguments (all optional — at least one should be provided)
 * ───────────────────────────────────────────────────────────
 *   activeMapMode      — "M1" | "M2" | "M3" | "M4" | "M5"
 *   activeCaseLayout   — "T1" | "T2" | "T3" | "T4" | "T5"
 *   layerToggles       — partial layer toggle state (deep-merged with existing)
 *   sidebarCollapsed   — boolean sidebar visibility toggle
 *   lastViewedCaseId   — Convex document ID string of last-viewed case
 *
 * Returns
 * ────────
 * The Convex document ID of the upserted `userPreferences` row.
 *
 * Errors
 * ──────
 *   [AUTH_REQUIRED]  — caller is not authenticated (no valid Kinde JWT).
 */
export const upsertLayoutPreferences = mutation({
  args: {
    /** Which INVENTORY map mode to activate. */
    activeMapMode:    v.optional(mapModeValidator),
    /** Which case detail panel layout to activate. */
    activeCaseLayout: v.optional(caseLayoutValidator),
    /** Partial layer toggle state — deep-merged with the stored value. */
    layerToggles:     v.optional(layerTogglesValidator),
    /** Whether the INVENTORY side navigation panel should be collapsed. */
    sidebarCollapsed: v.optional(v.boolean()),
    /**
     * Convex document ID (as plain string) of the case most recently open in
     * the INVENTORY detail panel.  Stored as a string — not a typed v.id —
     * so that stale IDs (deleted cases) do not cause schema validation errors.
     */
    lastViewedCaseId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Hard auth — mutations must always be authenticated
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error(
        "[AUTH_REQUIRED] Unauthenticated — no valid Kinde access token was " +
        "provided. Ensure the Convex client is initialized with " +
        "ConvexProviderWithAuth and the Kinde session is active before " +
        "calling upsertLayoutPreferences."
      );
    }

    const kindeId = identity.subject;
    const now = Date.now();

    // Look up the existing preferences row for this user
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_user_id", (q) => q.eq("userId", kindeId))
      .first();

    if (existing) {
      // ── Patch path: deep-merge provided fields into the stored preferences ──

      // Build the updated layoutPreferences by merging:
      //   existing stored fields  ← base
      //   new top-level fields    ← overwrite scalars
      //   new layerToggles        ← deep-merge into existing layerToggles
      const existingPrefs = existing.layoutPreferences;

      const updatedLayerToggles =
        args.layerToggles !== undefined
          ? {
              // Spread existing toggles first, then overwrite with new values
              ...(existingPrefs.layerToggles ?? {}),
              ...args.layerToggles,
            }
          : existingPrefs.layerToggles;

      const updatedPrefs = {
        // Preserve existing values
        ...existingPrefs,
        // Overwrite only the scalar fields that were provided
        ...(args.activeMapMode    !== undefined && { activeMapMode:    args.activeMapMode }),
        ...(args.activeCaseLayout !== undefined && { activeCaseLayout: args.activeCaseLayout }),
        ...(args.sidebarCollapsed !== undefined && { sidebarCollapsed: args.sidebarCollapsed }),
        ...(args.lastViewedCaseId !== undefined && { lastViewedCaseId: args.lastViewedCaseId }),
        // Apply the deep-merged layer toggles
        ...(updatedLayerToggles   !== undefined && { layerToggles:     updatedLayerToggles }),
      };

      await ctx.db.patch(existing._id, {
        layoutPreferences: updatedPrefs,
        updatedAt: now,
      });

      return existing._id;
    }

    // ── Insert path: create a fresh row for this user ──────────────────────

    // Build the initial layoutPreferences from the provided args.
    // Only include keys that were explicitly supplied; absent keys are omitted
    // (not written as `undefined`) so the Convex schema validators are satisfied.
    const initialPrefs: {
      activeMapMode?:    "M1" | "M2" | "M3" | "M4" | "M5";
      activeCaseLayout?: "T1" | "T2" | "T3" | "T4" | "T5";
      layerToggles?:     {
        deployed?: boolean;
        transit?:  boolean;
        fleet?:    boolean;
        damage?:   boolean;
        turbines?: boolean;
        heatmap?:  boolean;
        missions?: boolean;
      };
      sidebarCollapsed?: boolean;
      lastViewedCaseId?: string;
    } = {};

    if (args.activeMapMode    !== undefined) initialPrefs.activeMapMode    = args.activeMapMode;
    if (args.activeCaseLayout !== undefined) initialPrefs.activeCaseLayout = args.activeCaseLayout;
    if (args.layerToggles     !== undefined) initialPrefs.layerToggles     = args.layerToggles;
    if (args.sidebarCollapsed !== undefined) initialPrefs.sidebarCollapsed = args.sidebarCollapsed;
    if (args.lastViewedCaseId !== undefined) initialPrefs.lastViewedCaseId = args.lastViewedCaseId;

    const docId = await ctx.db.insert("userPreferences", {
      userId:            kindeId,
      layoutPreferences: initialPrefs,
      updatedAt:         now,
    });

    return docId;
  },
});
