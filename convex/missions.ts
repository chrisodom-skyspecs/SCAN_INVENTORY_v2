/**
 * convex/missions.ts
 *
 * Public query functions for mission subscriptions.
 *
 * Missions group equipment cases into field deployments.  They map to the M2
 * (Mission Mode) and M5 (Mission Control) map views on the INVENTORY dashboard.
 * This module exposes public queries so client-side components can subscribe to
 * mission data without importing server-only Convex internals.
 *
 * NOTE: The internal map queries (getM2MissionMode, getM5MissionControl) in
 * convex/maps.ts perform their own mission table reads as part of the unified
 * map data aggregation.  The public queries here serve a different purpose:
 * they provide reactive subscriptions for UI elements like filter dropdowns
 * and the M2 mission detail side panel.
 *
 * Query functions:
 *   listMissions       — all missions; used for org/mission filter dropdowns
 *                        in M1/M2 map toolbar and filter panels
 *   getMissionById     — single mission document by Convex ID
 *
 * Index usage:
 *   listMissions       → by_status index (when filtered) or by_updated (all)
 *   getMissionById     → O(1) primary-key lookup
 *
 * Client usage example:
 *   const missions = useQuery(api.missions.listMissions, {});
 *   // Map to dropdown: missions.map(m => ({ id: m._id, name: m.name }))
 */

import { query } from "./_generated/server";
import { v } from "convex/values";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Valid mission status values — mirrors missionStatus in schema.ts. */
export type MissionStatus = "planning" | "active" | "completed" | "cancelled";

/**
 * Lightweight mission projection returned by listMissions.
 * Provides the name, status, and location — sufficient for filter dropdowns,
 * map sidebar lists, and the M2 mission panel header.
 */
export interface MissionSummary {
  /** Convex document ID — used as the value in mission filter dropdowns. */
  _id: string;
  /** Human-readable mission name — used as the label in filter dropdowns. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Lifecycle status of the mission. */
  status: MissionStatus;
  /** Primary site latitude (for map centering). */
  lat?: number;
  /** Primary site longitude (for map centering). */
  lng?: number;
  /** Human-readable site name. */
  locationName?: string;
  /** ISO date string for the planned mission start, or null. */
  startDate?: number;
  /** ISO date string for the planned mission end, or null. */
  endDate?: number;
  /** Display name of the mission lead. */
  leadName?: string;
  /** Creation timestamp. */
  createdAt: number;
  /** Last-modified timestamp. */
  updatedAt: number;
}

// ─── listMissions ─────────────────────────────────────────────────────────────

/**
 * Subscribe to all missions with an optional status filter.
 *
 * Returns missions ordered by `updatedAt` descending when unfiltered, or by
 * the `by_status` index when a status filter is applied.  Used by:
 *   • M1/M2 map toolbar mission / "org" filter dropdown (INVENTORY dashboard)
 *   • M2 side panel mission list
 *   • SCAN app mission assignment (when assigning a case to a mission)
 *
 * Convex will re-run this query and push updates within ~100–300 ms whenever
 * a mission row changes (status update, name change, etc.).
 *
 * Pass `status` to narrow results to a specific lifecycle stage — useful for
 * showing only active missions in dropdowns.
 *
 * Client usage:
 *   // All missions for dropdown
 *   const missions = useQuery(api.missions.listMissions, {});
 *
 *   // Active missions only
 *   const active = useQuery(api.missions.listMissions, { status: "active" });
 */
export const listMissions = query({
  args: {
    /**
     * Optional status filter.  When provided, uses the by_status index for
     * an efficient filtered scan instead of a full table scan.
     */
    status: v.optional(
      v.union(
        v.literal("planning"),
        v.literal("active"),
        v.literal("completed"),
        v.literal("cancelled"),
      )
    ),
  },
  handler: async (ctx, args): Promise<MissionSummary[]> => {
    let rows;

    if (args.status !== undefined) {
      // Use by_status index for efficient filtered query
      rows = await ctx.db
        .query("missions")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      // No filter: full scan ordered by updatedAt desc (most recently updated first)
      rows = await ctx.db
        .query("missions")
        .withIndex("by_updated")
        .order("desc")
        .collect();
    }

    return rows.map((m) => ({
      _id:          m._id.toString(),
      name:         m.name,
      description:  m.description,
      status:       m.status as MissionStatus,
      lat:          m.lat,
      lng:          m.lng,
      locationName: m.locationName,
      startDate:    m.startDate,
      endDate:      m.endDate,
      leadName:     m.leadName,
      createdAt:    m.createdAt,
      updatedAt:    m.updatedAt,
    }));
  },
});

// ─── getMissionById ───────────────────────────────────────────────────────────

/**
 * Subscribe to a single mission by its Convex ID.
 *
 * Returns the full mission document.  Used when:
 *   • Drilling into a mission from the M2 sidebar
 *   • Displaying mission metadata in the case detail panel (T1/T2)
 *   • Editing a mission in the admin UI
 *
 * Returns `null` when the mission does not exist.
 *
 * Client usage:
 *   const mission = useQuery(api.missions.getMissionById, { missionId });
 *   if (mission === null) return <MissionNotFound />;
 *   return <MissionDetail mission={mission} />;
 */
export const getMissionById = query({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args): Promise<MissionSummary | null> => {
    const m = await ctx.db.get(args.missionId);
    if (!m) return null;

    return {
      _id:          m._id.toString(),
      name:         m.name,
      description:  m.description,
      status:       m.status as MissionStatus,
      lat:          m.lat,
      lng:          m.lng,
      locationName: m.locationName,
      startDate:    m.startDate,
      endDate:      m.endDate,
      leadName:     m.leadName,
      createdAt:    m.createdAt,
      updatedAt:    m.updatedAt,
    };
  },
});
