/**
 * convex/sites.ts
 *
 * Public query functions for the site selector combobox.
 *
 * "Sites" in the SkySpecs INVENTORY + SCAN system are deployment locations
 * represented by missions.  Each mission corresponds to a physical wind-farm
 * site where inspection cases are deployed.
 *
 * This module provides a dedicated `listSites` query that returns a lightweight
 * site projection suitable for the searchable SiteSelector combobox.  Using a
 * separate query (rather than re-using `listMissions` directly) gives us:
 *   1. A semantic API surface that callers understand as "site selection"
 *   2. A narrower projection — only the fields the combobox needs
 *   3. A stable subscription target independent of future mission table changes
 *
 * Query functions:
 *   listSites  — all deployment sites (missions), optionally filtered by status
 *
 * Index usage:
 *   listSites  → by_updated index (no filter) or by_status index (filtered)
 *
 * Client usage:
 *   const sites = useQuery(api.sites.listSites, {});
 *   // Passes to SiteSelector as the data source
 *
 * Reactive:
 *   Any mutation that writes to the `missions` table invalidates active
 *   `listSites` subscriptions within ~100–300 ms, satisfying the ≤ 2-second
 *   real-time fidelity requirement.
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

// ─── Types ────────────────────────────────────────────────────────────────────

/** Valid site/mission status values — mirrors missionStatus in schema.ts. */
export type SiteStatus = "planning" | "active" | "completed" | "cancelled";

/**
 * Lightweight site projection returned by listSites.
 *
 * Contains only the fields needed by the SiteSelector combobox:
 *   - siteId / name / locationName for display and selection
 *   - status for visual indicator (active sites highlighted)
 *   - lat/lng for future map-centering behavior
 *   - caseCount is left out (requires a join — not needed for the selector)
 *
 * The `siteId` field uses the string form of the Convex missions document ID.
 * This is the stable identifier passed to `onSelect` callbacks and used as the
 * `missionId` filter argument in map queries.
 */
export interface SiteSummary {
  /** Convex missions document ID (string form) — value for filter dropdowns. */
  siteId: string;
  /** Human-readable site name — label shown in the combobox. */
  name: string;
  /** Optional free-text description. */
  description?: string;
  /** Deployment lifecycle status. */
  status: SiteStatus;
  /** Primary site latitude (for future map-centering). */
  lat?: number;
  /** Primary site longitude (for future map-centering). */
  lng?: number;
  /** Human-readable location name, e.g. "Seattle Wind Farm — Block B". */
  locationName?: string;
  /** Display name of the mission/site lead. */
  leadName?: string;
  /** Epoch ms of the last modification. */
  updatedAt: number;
}

// ─── listSites ────────────────────────────────────────────────────────────────

/**
 * Subscribe to all deployment sites for the SiteSelector combobox.
 *
 * Returns sites ordered by `updatedAt` descending (most recently updated first)
 * when unfiltered, or by the `by_status` index when a status filter is applied.
 *
 * Used by:
 *   • SiteSelector combobox (src/components/SiteSelector)
 *   • M2 map toolbar org filter (as an alternative to listMissions)
 *   • SCAN app "select site" screens (case assignment, check-in location)
 *
 * Convex re-evaluates this query and pushes updates within ~100–300 ms whenever
 * any mission row changes, satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * @param status  Optional status filter.  Omit to return sites of all statuses.
 *                Use `"active"` to show only sites with in-progress deployments.
 *
 * Client usage:
 *   const sites = useQuery(api.sites.listSites, {});
 *   const activeSites = useQuery(api.sites.listSites, { status: "active" });
 */
export const listSites = query({
  args: {
    /**
     * Optional status filter.
     * When provided, uses the missions by_status index for an efficient scan.
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
  handler: async (ctx, args): Promise<SiteSummary[]> => {
    await requireAuth(ctx);

    let rows;

    if (args.status !== undefined) {
      // Use by_status index for efficient filtered query
      rows = await ctx.db
        .query("missions")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      // No filter: full scan ordered by updatedAt desc (most recently active first)
      rows = await ctx.db
        .query("missions")
        .withIndex("by_updated")
        .order("desc")
        .collect();
    }

    return rows.map((m) => ({
      siteId:       m._id.toString(),
      name:         m.name,
      description:  m.description,
      status:       m.status as SiteStatus,
      lat:          m.lat,
      lng:          m.lng,
      locationName: m.locationName,
      leadName:     m.leadName,
      updatedAt:    m.updatedAt,
    }));
  },
});
