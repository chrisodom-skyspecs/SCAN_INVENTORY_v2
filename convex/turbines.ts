/**
 * convex/turbines.ts
 *
 * Public query functions for the INVENTORY map turbines overlay layer.
 *
 * The turbines layer renders wind turbine site markers — the primary deployment
 * targets for SkySpecs inspection cases.  Turbine locations are stored in the
 * `turbines` table (added in schema.ts) and served as a GeoJSON-compatible
 * payload that the TurbineLayer component converts to Mapbox GL markers.
 *
 * Architecture
 * ────────────
 * 1. `getTurbineLocations` — primary subscribed query.
 *      Returns all turbine records, optionally filtered by missionId or status.
 *      Each record includes lat, lng, name, status, and optional metadata
 *      (hubHeight, rotorDiameter, siteCode, notes) for map tooltip rendering.
 *
 * 2. `getTurbineById` — single-turbine lookup.
 *      Returns one turbine record by its Convex document ID.
 *      Used by detail tooltips or admin views.
 *
 * Reactive dependency chain
 * ─────────────────────────
 * Both queries read the `turbines` table.  Any mutation that inserts, updates,
 * or soft-deletes a turbine record will invalidate active subscriptions and push
 * updated marker data to connected INVENTORY dashboard clients within ~100–300 ms,
 * satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Client usage
 * ────────────
 *   // Fleet-wide turbine markers
 *   const data = useQuery(api.turbines.getTurbineLocations, {});
 *
 *   // Scoped to a mission (org filter)
 *   const data = useQuery(api.turbines.getTurbineLocations, {
 *     missionId: "mission_id_here",
 *   });
 *
 * Use the companion hook in src/hooks/use-turbine-layer.ts:
 *   const { turbinesGeoJSON, isActive } = useTurbineLayer();
 */

import { query } from "./_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token."
    );
  }
  return identity;
}

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * A single turbine location record returned by getTurbineLocations.
 *
 * Contains all fields needed to render a turbine marker on the map and
 * populate the hover tooltip.
 */
export interface TurbineLocation {
  /** Convex document ID (string form). */
  turbineId: string;
  /** Turbine/pad display name, e.g. "T-042" or "Row 3 North". */
  name: string;
  /** WGS-84 latitude. */
  lat: number;
  /** WGS-84 longitude. */
  lng: number;
  /**
   * Operational status:
   *   "active"         — in active inspection rotation (lime marker)
   *   "inactive"       — temporarily out of rotation (muted marker)
   *   "decommissioned" — permanently retired (gray marker)
   */
  status: "active" | "inactive" | "decommissioned";
  /** Optional short site code (e.g. "SITE-A") for grouping. */
  siteCode?: string;
  /** Optional Convex mission document ID linking this turbine to a deployment. */
  missionId?: string;
  /** Hub height in meters (shown in tooltip). */
  hubHeight?: number;
  /** Rotor diameter in meters (shown in tooltip). */
  rotorDiameter?: number;
  /** Optional operator notes (shown in tooltip). */
  notes?: string;
  /** Epoch ms when the record was created. */
  createdAt: number;
  /** Epoch ms when the record was last updated. */
  updatedAt: number;
}

/**
 * Response shape from getTurbineLocations.
 */
export interface TurbineLocationsResponse {
  /** All turbine location records matching the filter criteria. */
  turbines: TurbineLocation[];
  /** Total number of turbines in the result set. */
  turbineCount: number;
  /** Number of active turbines (status = "active"). */
  activeCount: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of turbine records to return in a single query.
 * Wind farms rarely exceed 300 turbines; this cap prevents runaway payloads.
 */
const MAX_TURBINES = 2000;

// ─── getTurbineLocations — Fleet-wide turbine overlay ─────────────────────────

/**
 * Subscribe to turbine location data for the INVENTORY map turbines overlay.
 *
 * Returns all turbines matching the given filter criteria, sorted by name
 * ascending for consistent ordering in fallback list views.
 *
 * Filters
 * ───────
 * • missionId — limit to turbines linked to a specific mission (org filter).
 *               Omit for a fleet-wide view (all turbines regardless of mission).
 * • status    — limit to turbines with a specific operational status.
 *               Omit to return turbines of all statuses.
 * • limit     — max records to return (default MAX_TURBINES = 2000).
 *
 * Reactive to:
 *   • Any mutation that inserts, patches, or deletes a turbines document.
 *   • Convex re-evaluates within ~100–300 ms, satisfying the ≤ 2-second
 *     real-time fidelity requirement.
 *
 * Client usage:
 *   const data = useQuery(api.turbines.getTurbineLocations, {});
 *   const data = useQuery(api.turbines.getTurbineLocations, {
 *     missionId: "abc123",
 *     status: "active",
 *   });
 */
export const getTurbineLocations = query({
  args: {
    /**
     * Filter turbines to those linked to a specific mission.
     * Omit for a fleet-wide turbine overlay (all missions).
     */
    missionId: v.optional(v.string()),
    /**
     * Filter turbines by operational status.
     * Omit to return turbines of all statuses (active + inactive + decommissioned).
     */
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("inactive"),
        v.literal("decommissioned"),
      )
    ),
    /**
     * Maximum number of turbine records to return.
     * @default 2000
     */
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<TurbineLocationsResponse> => {
    await requireAuth(ctx);

    const maxTurbines = Math.min(args.limit ?? MAX_TURBINES, MAX_TURBINES);

    // ── Query strategy ────────────────────────────────────────────────────────
    //
    // We have three filter axes: missionId, status, and the implicit "all".
    // Convex doesn't support multi-field inequality indexes, so we use the most
    // selective available index and apply in-memory filtering for secondary axes.
    //
    // Priority:
    //   1. missionId filter → use by_mission index (most selective: scopes to one mission)
    //   2. status filter only → use by_status index
    //   3. No filter → full table scan via by_updated (avoids unindexed scan warning)

    let turbineDocs;

    if (args.missionId !== undefined) {
      // Use by_mission index to scope to the mission, then filter status in-memory.
      // The by_mission index requires a valid v.id("missions") value, but since
      // missionId comes from user-provided string (URL param), we cast through
      // string comparison.  We use a full table scan with in-memory filter here
      // to avoid Convex v.id type coercion issues with string missionId args.
      turbineDocs = await ctx.db
        .query("turbines")
        .withIndex("by_updated")
        .collect();

      // Apply in-memory missionId filter (string comparison)
      turbineDocs = turbineDocs.filter(
        (t) => t.missionId?.toString() === args.missionId
      );
    } else if (args.status !== undefined) {
      // Use by_status index for status-only filtering.
      turbineDocs = await ctx.db
        .query("turbines")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      // No filter — return all turbines ordered by updatedAt.
      turbineDocs = await ctx.db
        .query("turbines")
        .withIndex("by_updated")
        .collect();
    }

    // ── Apply secondary filters in-memory ─────────────────────────────────────
    //
    // If missionId was specified, we already filtered above.
    // Apply status filter if missionId was the primary index.
    if (args.missionId !== undefined && args.status !== undefined) {
      turbineDocs = turbineDocs.filter((t) => t.status === args.status);
    }

    // ── Sort by name ascending (stable ordering for fallback list) ─────────────
    turbineDocs = turbineDocs
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, maxTurbines);

    // ── Map to TurbineLocation response shape ─────────────────────────────────
    const turbines: TurbineLocation[] = turbineDocs.map((t) => ({
      turbineId:     t._id.toString(),
      name:          t.name,
      lat:           t.lat,
      lng:           t.lng,
      status:        t.status,
      siteCode:      t.siteCode,
      missionId:     t.missionId?.toString(),
      hubHeight:     t.hubHeight,
      rotorDiameter: t.rotorDiameter,
      notes:         t.notes,
      createdAt:     t.createdAt,
      updatedAt:     t.updatedAt,
    }));

    const activeCount = turbines.filter((t) => t.status === "active").length;

    return {
      turbines,
      turbineCount: turbines.length,
      activeCount,
    };
  },
});

// ─── getTurbineById — Single turbine lookup ───────────────────────────────────

/**
 * Look up a single turbine record by its Convex document ID.
 *
 * Used by:
 *   • Map marker hover/click tooltip (to load full turbine metadata on demand)
 *   • Admin UI (detail view for editing a turbine record)
 *
 * Returns null when the turbine ID is not found.
 *
 * Reactive to:
 *   • Any patch/delete mutation on this specific turbines document.
 *
 * Client usage:
 *   const turbine = useQuery(api.turbines.getTurbineById, {
 *     turbineId: "turbine_doc_id_here",
 *   });
 */
export const getTurbineById = query({
  args: {
    /** Convex turbines document ID. */
    turbineId: v.id("turbines"),
  },
  handler: async (ctx, args): Promise<TurbineLocation | null> => {
    await requireAuth(ctx);

    const t = await ctx.db.get(args.turbineId);
    if (!t) return null;

    return {
      turbineId:     t._id.toString(),
      name:          t.name,
      lat:           t.lat,
      lng:           t.lng,
      status:        t.status,
      siteCode:      t.siteCode,
      missionId:     t.missionId?.toString(),
      hubHeight:     t.hubHeight,
      rotorDiameter: t.rotorDiameter,
      notes:         t.notes,
      createdAt:     t.createdAt,
      updatedAt:     t.updatedAt,
    };
  },
});
