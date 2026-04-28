/**
 * convex/mapData.ts
 *
 * Public query functions for the INVENTORY dashboard map modes (M1–M5).
 *
 * These are PUBLIC `query` functions (not `internalQuery`) — they are
 * subscribable from client components via `useQuery(api.mapData.getM1MapData, …)`.
 * Convex re-evaluates every active subscription automatically within ~100–300 ms
 * whenever a touched table row changes, satisfying the ≤ 2-second real-time
 * fidelity requirement between SCAN app mutations and dashboard visibility.
 *
 * Architecture
 * ────────────
 * Each function:
 *   1. Loads only the tables required for that mode (single Promise.all).
 *   2. Builds O(1) in-memory lookup maps to eliminate N+1 queries.
 *   3. Delegates to the pure assembler functions in convex/maps.ts — no
 *      duplicate business logic here, just a DB-loading wrapper.
 *
 * Reactive dependency chain (why SCAN mutations trigger dashboard updates)
 * ─────────────────────────────────────────────────────────────────────────
 * Convex tracks which table rows each query reads.  Any mutation that writes
 * to one of those rows invalidates all active subscriptions for that query
 * and pushes a re-evaluated result to connected clients.
 *
 * Mutation → Tables written → Queries invalidated
 * ───────────────────────────────────────────────────────────────────────
 * scan.scanCheckIn           cases, inspections, events   → M1, M2, M3, M5
 * scan.updateChecklistItem   manifestItems, inspections   → M3
 * scan.startInspection       inspections, events          → M3
 * scan.completeInspection    inspections, cases, events   → M1, M3
 * shipping.shipCase          cases, shipments, events     → M1, M2, M4
 * shipping.createShipment    shipments, cases, events     → M1, M2, M4
 * shipping.updateShipmentStatus shipments, cases          → M1, M4
 * custody.transferCustody    custodyRecords, cases, events→ M1, M2
 *
 * Map mode ↔ query ↔ tables read
 * ───────────────────────────────
 *   M1  getM1MapData   cases
 *   M2  getM2MapData   cases + missions
 *   M3  getM3MapData   cases + inspections
 *   M4  getM4MapData   cases + shipments
 *   M5  getM5MapData   cases + missions + featureFlags
 *
 * Query functions
 * ───────────────
 *   getM1MapData  — Fleet Overview: all case pins with status/position
 *   getM2MapData  — Mission Mode: cases grouped by mission
 *   getM3MapData  — Field Mode: in_field/deployed cases + inspection progress
 *   getM4MapData  — Logistics Mode: active shipments + case labels
 *   getM5MapData  — Mission Control: clusters + heatmap (FF_MAP_MISSION gated)
 *
 * Client usage
 * ────────────
 * Use the companion hooks in src/hooks/use-map-data.ts:
 *   const m1Data = useM1MapData();
 *   const m2Data = useM2MapData({ missionId: selectedMissionId });
 *   const m3Data = useM3MapData({ bounds, assigneeId: myId });
 *   const m4Data = useM4MapData({ bounds });
 *   const m5Data = useM5MapData({ bounds });
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import {
  assembleM1,
  assembleM2,
  assembleM3,
  assembleM4,
  assembleM5,
  type M1Response,
  type M2Response,
  type M3Response,
  type M4Response,
  type M5Response,
  type MapBounds,
  type ParsedFilters,
} from "./maps";

// ─── Shared bound-building helper ─────────────────────────────────────────────

/**
 * Build a MapBounds object from optional individual number args.
 * Returns null when any bound is missing (incompletely specified viewport).
 */
function buildBounds(
  swLat?: number,
  swLng?: number,
  neLat?: number,
  neLng?: number
): MapBounds | null {
  if (
    swLat === undefined ||
    swLng === undefined ||
    neLat === undefined ||
    neLng === undefined
  ) {
    return null;
  }
  return { swLat, swLng, neLat, neLng };
}

// ─── Shared arg validators ────────────────────────────────────────────────────

/**
 * Geographic bounding box args shared by all map mode queries.
 * All four must be provided together; omit all to get a global (unbounded) view.
 */
const boundsArgs = {
  /** South-West latitude of the viewport. */
  swLat: v.optional(v.number()),
  /** South-West longitude of the viewport. */
  swLng: v.optional(v.number()),
  /** North-East latitude of the viewport. */
  neLat: v.optional(v.number()),
  /** North-East longitude of the viewport. */
  neLng: v.optional(v.number()),
};

/**
 * Common filter args for M1–M3 map modes.
 * Passed through to the assembler's ParsedFilters shape.
 */
const commonFilterArgs = {
  /** Filter by one or more case lifecycle statuses. */
  status: v.optional(
    v.array(
      v.union(
        v.literal("assembled"),
        v.literal("deployed"),
        v.literal("in_field"),
        v.literal("shipping"),
        v.literal("returned")
      )
    )
  ),
  /** Filter to cases assigned to a specific technician (Kinde user ID). */
  assigneeId: v.optional(v.string()),
  /** Filter to cases on a specific mission. */
  missionId: v.optional(v.string()),
};

// ─── getM1MapData — Fleet Overview ────────────────────────────────────────────

/**
 * Subscribe to M1 (Fleet Overview) map data.
 *
 * Returns all cases with their location coordinates and status, optionally
 * filtered by status, assignee, or mission.  When viewport bounds are provided,
 * only cases within those bounds are returned as pins; the summary counts
 * cover the full fleet regardless of viewport.
 *
 * Reactive to:
 *   • scan.scanCheckIn — updates cases.status, cases.lat/lng, cases.assigneeId
 *   • shipping.shipCase / createShipment — updates cases.status to "shipping"
 *   • scan.completeInspection — updates cases.updatedAt
 *   • custody.transferCustody — updates cases.assigneeId
 *
 * Client usage:
 *   const data = useQuery(api.mapData.getM1MapData, {});
 *   const data = useQuery(api.mapData.getM1MapData, {
 *     status: ["in_field", "deployed"],
 *     swLat: bounds.swLat, swLng: bounds.swLng,
 *     neLat: bounds.neLat, neLng: bounds.neLng,
 *   });
 */
export const getM1MapData = query({
  args: {
    ...boundsArgs,
    ...commonFilterArgs,
  },
  handler: async (ctx, args): Promise<M1Response> => {
    // Load all cases — the single table read that makes M1 reactive to any
    // case mutation.  Convex tracks this query's dependency on the cases table
    // and invalidates subscriptions when any row changes.
    const allCases = await ctx.db
      .query("cases")
      .withIndex("by_updated")
      .order("desc")
      .collect();

    const bounds = buildBounds(args.swLat, args.swLng, args.neLat, args.neLng);

    const filters: ParsedFilters = {
      status:     args.status,
      assigneeId: args.assigneeId,
      missionId:  args.missionId,
    };

    return assembleM1(allCases, bounds, filters);
  },
});

// ─── getM2MapData — Mission Mode ──────────────────────────────────────────────

/**
 * Subscribe to M2 (Mission Mode) map data.
 *
 * Returns missions with their grouped cases, plus unassigned cases.  Each
 * mission group includes a per-status breakdown of its cases and the mission's
 * location coordinates for the map cluster pin.
 *
 * Reactive to:
 *   • scan.scanCheckIn — updates case status (changes mission group pins)
 *   • Any mission mutation — updates mission metadata, re-groups cases
 *   • Any case mutation that changes missionId — re-routes the case between groups
 *
 * Client usage:
 *   const data = useQuery(api.mapData.getM2MapData, {});
 *   const data = useQuery(api.mapData.getM2MapData, {
 *     missionId: "active-mission-id",  // single-mission drill-down
 *     swLat: bounds.swLat, ...
 *   });
 */
export const getM2MapData = query({
  args: {
    ...boundsArgs,
    /** Optional status filter — applied to cases within each mission group. */
    status:    v.optional(
      v.array(
        v.union(
          v.literal("assembled"),
          v.literal("deployed"),
          v.literal("in_field"),
          v.literal("shipping"),
          v.literal("returned")
        )
      )
    ),
    /** Drill into a specific mission — only that mission's group is returned. */
    missionId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<M2Response> => {
    // Load cases and missions in a single parallel pass.
    // Convex tracks dependencies on BOTH tables — any case or mission mutation
    // invalidates M2 subscriptions and triggers a fresh push to clients.
    const [allCases, allMissions] = await Promise.all([
      ctx.db.query("cases").withIndex("by_updated").order("desc").collect(),
      ctx.db.query("missions").withIndex("by_updated").order("desc").collect(),
    ]);

    const bounds = buildBounds(args.swLat, args.swLng, args.neLat, args.neLng);

    const filters: ParsedFilters = {
      status:    args.status,
      missionId: args.missionId,
    };

    return assembleM2(allCases, allMissions, bounds, filters);
  },
});

// ─── getM3MapData — Field Mode ────────────────────────────────────────────────

/**
 * Subscribe to M3 (Field Mode) map data.
 *
 * Returns cases in "in_field" or "deployed" status with their current
 * inspection progress data (checkedItems / totalItems / damagedItems /
 * missingItems / inspectionProgress percentage).
 *
 * This is the primary real-time data source for the field inspection progress
 * map view.  Inspection progress updates pushed by SCAN app technicians
 * appear on the dashboard within ~2 seconds.
 *
 * Reactive to:
 *   • scan.scanCheckIn — transitions case to in_field, creates inspection row
 *   • scan.updateChecklistItem — writes inspection counters (immediate M3 update)
 *   • scan.startInspection — creates new inspection row
 *   • scan.completeInspection — transitions inspection status to completed/flagged
 *
 * Client usage:
 *   const data = useQuery(api.mapData.getM3MapData, {});
 *   const data = useQuery(api.mapData.getM3MapData, {
 *     assigneeId: technicianId,   // "my cases" field mode
 *     hasInspection: true,
 *   });
 */
export const getM3MapData = query({
  args: {
    ...boundsArgs,
    ...commonFilterArgs,
    /**
     * Filter by inspection presence.
     * true  → only cases with an active inspection
     * false → only cases WITHOUT an inspection (not yet started)
     */
    hasInspection: v.optional(v.boolean()),
    /**
     * Filter to cases with at least one damaged item.
     * Requires a post-inspection scan of inspectionRows; applied in the
     * assembler after the in-memory map is built.
     */
    hasDamage: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<M3Response> => {
    // Load cases and ALL inspection rows in parallel.
    //
    // We load all inspections (not just for in-viewport cases) because:
    //   1. We need to build latestInspectionByCase for all field cases.
    //   2. Convex tracks the inspections table as a dependency — any
    //      updateChecklistItem or startInspection mutation invalidates this
    //      query and pushes the updated progress to dashboard clients.
    const [allCases, allInspections] = await Promise.all([
      ctx.db.query("cases").withIndex("by_updated").order("desc").collect(),
      ctx.db.query("inspections").collect(),
    ]);

    // Build latest-inspection-per-case map (O(n) linear pass — no N+1 queries).
    // Uses _creationTime (auto-set monotonically by Convex) to find the latest
    // inspection for each case without a sort — same strategy as getM3FieldMode.
    const latestInspectionByCase = new Map<string, Doc<"inspections">>();
    for (const ins of allInspections) {
      const key = ins.caseId.toString();
      const existing = latestInspectionByCase.get(key);
      if (!existing || ins._creationTime > existing._creationTime) {
        latestInspectionByCase.set(key, ins);
      }
    }

    const bounds = buildBounds(args.swLat, args.swLng, args.neLat, args.neLng);

    const filters: ParsedFilters = {
      status:        args.status,
      assigneeId:    args.assigneeId,
      missionId:     args.missionId,
      hasInspection: args.hasInspection,
      hasDamage:     args.hasDamage,
    };

    return assembleM3(allCases, latestInspectionByCase, bounds, filters);
  },
});

// ─── getM4MapData — Logistics Mode ───────────────────────────────────────────

/**
 * Subscribe to M4 (Logistics Mode) map data.
 *
 * Returns active shipments with their route coordinates (origin → destination →
 * current position) and case labels.  Cases are pre-built into an O(1) lookup
 * map so shipment pins can resolve their case label without N+1 queries.
 *
 * Reactive to:
 *   • shipping.shipCase — creates shipment row + updates case status to "shipping"
 *   • shipping.createShipment — creates shipment row, optionally advances case
 *   • shipping.updateShipmentStatus — updates shipment tracking status
 *   • shipping.refreshShipmentTracking — updates currentLat/currentLng on shipment
 *
 * The denormalized case fields (destinationLat, destinationLng) written by
 * `shipCase` ensure M4 pins appear immediately in the correct map region even
 * before the first FedEx tracking poll populates shipment.destinationLat.
 *
 * Client usage:
 *   const data = useQuery(api.mapData.getM4MapData, {});
 *   const data = useQuery(api.mapData.getM4MapData, {
 *     status: ["in_transit", "out_for_delivery"],
 *     swLat: bounds.swLat, ...
 *   });
 */
export const getM4MapData = query({
  args: {
    ...boundsArgs,
    /**
     * Optional shipment status filter.
     * Accepts shipmentStatus values: "label_created" | "picked_up" |
     * "in_transit" | "out_for_delivery" | "delivered" | "exception".
     * Passed as the filters.status array to assembleM4.
     */
    status: v.optional(
      v.array(
        v.union(
          v.literal("label_created"),
          v.literal("picked_up"),
          v.literal("in_transit"),
          v.literal("out_for_delivery"),
          v.literal("delivered"),
          v.literal("exception")
        )
      )
    ),
  },
  handler: async (ctx, args): Promise<M4Response> => {
    // Load cases and shipments in a single parallel pass.
    //
    // Convex tracks dependencies on BOTH tables:
    //   • cases dependency: shipCase writes cases.status + denormalized fields
    //   • shipments dependency: updateShipmentStatus writes shipment tracking data
    // Any write to either table invalidates M4 subscriptions immediately.
    const [allCases, allShipments] = await Promise.all([
      ctx.db.query("cases").withIndex("by_updated").order("desc").collect(),
      ctx.db.query("shipments").collect(),
    ]);

    // Build O(1) case label lookup map — eliminates N+1 per shipment.
    const casesById = new Map<string, Doc<"cases">>();
    for (const c of allCases) {
      casesById.set(c._id.toString(), c);
    }

    const bounds = buildBounds(args.swLat, args.swLng, args.neLat, args.neLng);

    // The assembleM4 ParsedFilters.status field accepts ANY string array,
    // so we can pass shipment status values here directly.
    const filters: ParsedFilters = {
      status: args.status,
    };

    return assembleM4(allShipments, casesById, bounds, filters);
  },
});

// ─── getM5MapData — Mission Control ──────────────────────────────────────────

/**
 * Subscribe to M5 (Mission Control) map data.
 *
 * Returns geographic density clusters, a heatmap of case activity, and a
 * timeline snapshot of current status distribution.  This map mode is gated
 * behind the FF_MAP_MISSION feature flag — when disabled, the response
 * includes featureEnabled: false and empty data arrays so the UI can render
 * the "feature disabled" placeholder.
 *
 * Reactive to:
 *   • Any case mutation — status weights update heatmap intensity
 *   • Any mission mutation — cluster positions and sizes update
 *   • Feature flag toggle — featureEnabled flips, clusters/heatmap populate
 *
 * Client usage:
 *   const data = useQuery(api.mapData.getM5MapData, {});
 *   // data.featureEnabled → false when FF_MAP_MISSION is off
 *   // data.clusters       → [] when feature disabled
 *   // data.heatmap        → [] when feature disabled
 */
export const getM5MapData = query({
  args: {
    ...boundsArgs,
  },
  handler: async (ctx, args): Promise<M5Response> => {
    // Load cases, missions, and the FF_MAP_MISSION feature flag in parallel.
    //
    // Convex tracks all three table reads as dependencies:
    //   • cases: status changes affect heatmap weights and cluster sizes
    //   • missions: mission position/status changes affect cluster positions
    //   • featureFlags: flag enable/disable immediately re-evaluates the query
    const [allCases, allMissions, ffRecord] = await Promise.all([
      ctx.db.query("cases").withIndex("by_updated").order("desc").collect(),
      ctx.db.query("missions").withIndex("by_updated").order("desc").collect(),
      ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", "FF_MAP_MISSION"))
        .first(),
    ]);

    const featureEnabled = ffRecord?.enabled ?? false;
    const bounds = buildBounds(args.swLat, args.swLng, args.neLat, args.neLng);

    return assembleM5(allCases, allMissions, featureEnabled, bounds);
  },
});

// ─── Re-export types for client-side consumption ──────────────────────────────

/**
 * Re-export all map mode response types so client components can import them
 * from the mapData module without needing to reach into maps.ts directly.
 * This keeps the client-facing type surface clean and avoids importing
 * server-only internals from maps.ts.
 */
export type {
  M1Response,
  M2Response,
  M3Response,
  M4Response,
  M5Response,
  MapBounds,
  ParsedFilters,
  M1CasePin,
  M2MissionGroup,
  M3CasePin,
  M4ShipmentPin,
  M5Cluster,
  M5HeatmapPoint,
  M5TimelineSnapshot,
  MapDataResponse,
} from "./maps";
