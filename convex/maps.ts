/**
 * convex/maps.ts
 *
 * Map query functions for INVENTORY dashboard (M1–M5).
 *
 * Architecture:
 *   - `getMapData` — unified query; single parallel DB pass, no N+1 queries.
 *     Used by the HTTP route handler in convex/http.ts.
 *   - Per-mode assembler functions (assembleM1–assembleM5) — pure functions
 *     that operate on pre-loaded data; no additional DB calls.
 *   - Legacy `getM1–getM5` internalQuerys kept for direct call-site compat;
 *     they delegate to the same assemblers.
 *
 * Map Modes:
 *   M1 — Fleet Overview   : all cases with status/position
 *   M2 — Mission Mode     : cases grouped by mission
 *   M3 — Field Mode       : cases in active field inspection
 *   M4 — Logistics Mode   : cases in transit with shipment data
 *   M5 — Mission Control  : density/heat map aggregates (FF_MAP_MISSION)
 *
 * Performance contract: <200ms p50 end-to-end
 *   Achieved by loading all needed tables in a single Promise.all at the
 *   start of each query, then joining entirely in-memory.
 */

import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";

// ─── Internal types ───────────────────────────────────────────────────────────

type MapMode = "M1" | "M2" | "M3" | "M4" | "M5";

/** Pre-loaded row collections passed to assembler functions */
interface LoadedData {
  cases: Doc<"cases">[];
  missions: Doc<"missions">[];
  /** Latest inspection per case — built from a full inspections scan */
  latestInspectionByCase: Map<string, Doc<"inspections">>;
  shipments: Doc<"shipments">[];
  /** All cases keyed by _id string — for O(1) label lookup in M4 */
  casesById: Map<string, Doc<"cases">>;
  featureEnabled: boolean;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Bounding box filter — returns true if point is within bounds */
export function withinBounds(
  lat: number | undefined,
  lng: number | undefined,
  bounds: MapBounds | null
): boolean {
  if (!bounds || lat === undefined || lng === undefined) return true;
  return (
    lat >= bounds.swLat &&
    lat <= bounds.neLat &&
    lng >= bounds.swLng &&
    lng <= bounds.neLng
  );
}

/** Parse a JSON filters string into a typed object */
export function parseFilters(raw: string | undefined): ParsedFilters {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ParsedFilters;
  } catch {
    return {};
  }
}

/** Parse bounds from individual query params */
export function parseBounds(
  swLat: string | undefined,
  swLng: string | undefined,
  neLat: string | undefined,
  neLng: string | undefined
): MapBounds | null {
  const vals = [swLat, swLng, neLat, neLng].map(Number);
  if (vals.some((v) => Number.isNaN(v))) return null;
  return { swLat: vals[0], swLng: vals[1], neLat: vals[2], neLng: vals[3] };
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface MapBounds {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

export interface ParsedFilters {
  status?: string[];
  assigneeId?: string;
  missionId?: string;
  hasInspection?: boolean;
  hasDamage?: boolean;
}

export interface MapQueryArgs {
  swLat?: string;
  swLng?: string;
  neLat?: string;
  neLng?: string;
  filters?: string;
}

// ─── M1 types ─────────────────────────────────────────────────────────────────

export interface M1CasePin {
  _id: string;
  label: string;
  status: string;
  lat?: number;
  lng?: number;
  locationName?: string;
  assigneeName?: string;
  missionId?: string;
  updatedAt: number;
}

export interface M1Response {
  mode: "M1";
  ts: number;
  cases: M1CasePin[];
  summary: {
    total: number;
    withLocation: number;
    byStatus: Record<string, number>;
  };
}

// ─── M2 types ─────────────────────────────────────────────────────────────────

export interface M2MissionGroup {
  _id: string;
  name: string;
  status: string;
  lat?: number;
  lng?: number;
  locationName?: string;
  leadName?: string;
  caseCount: number;
  byStatus: Record<string, number>;
  cases: {
    _id: string;
    label: string;
    status: string;
    lat?: number;
    lng?: number;
    assigneeName?: string;
    updatedAt: number;
  }[];
}

export interface M2Response {
  mode: "M2";
  ts: number;
  missions: M2MissionGroup[];
  unassigned: {
    _id: string;
    label: string;
    status: string;
    lat?: number;
    lng?: number;
    assigneeName?: string;
    updatedAt: number;
  }[];
  summary: {
    total: number;
    totalMissions: number;
    byMissionStatus: Record<string, number>;
  };
}

// ─── M3 types ─────────────────────────────────────────────────────────────────

export interface M3CasePin {
  _id: string;
  label: string;
  status: string;
  lat?: number;
  lng?: number;
  locationName?: string;
  assigneeName?: string;
  missionId?: string;
  updatedAt: number;
  // Inspection data
  inspectionId?: string;
  inspectionStatus?: string;
  inspectorName?: string;
  checkedItems: number;
  totalItems: number;
  damagedItems: number;
  missingItems: number;
  inspectionProgress: number; // 0–100
}

export interface M3Response {
  mode: "M3";
  ts: number;
  cases: M3CasePin[];
  summary: {
    total: number;
    byInspectionStatus: Record<string, number>;
    totalDamaged: number;
    totalMissing: number;
  };
}

// ─── M4 types ─────────────────────────────────────────────────────────────────

export interface M4ShipmentPin {
  _id: string;
  caseId: string;
  caseLabel: string;
  trackingNumber: string;
  carrier: string;
  status: string;
  origin: {
    lat?: number;
    lng?: number;
    name?: string;
  };
  destination: {
    lat?: number;
    lng?: number;
    name?: string;
  };
  currentLat?: number;
  currentLng?: number;
  estimatedDelivery?: string;
  shippedAt?: number;
  updatedAt: number;
}

export interface M4Response {
  mode: "M4";
  ts: number;
  shipments: M4ShipmentPin[];
  summary: {
    total: number;
    byStatus: Record<string, number>;
    inTransit: number;
  };
}

// ─── M5 types ─────────────────────────────────────────────────────────────────

export interface M5Cluster {
  lat: number;
  lng: number;
  count: number;
  radius: number;
  byStatus: Record<string, number>;
  missionIds: string[];
}

export interface M5HeatmapPoint {
  lat: number;
  lng: number;
  weight: number; // 0–1 normalized intensity
}

export interface M5TimelineSnapshot {
  ts: number;
  assembled: number;
  deployed: number;
  in_field: number;
  shipping: number;
  returned: number;
  total: number;
}

export interface M5Response {
  mode: "M5";
  ts: number;
  featureEnabled: boolean;
  clusters: M5Cluster[];
  heatmap: M5HeatmapPoint[];
  timeline: {
    startTs: number;
    endTs: number;
    snapshots: M5TimelineSnapshot[];
  };
  summary: {
    totalCases: number;
    totalMissions: number;
    activeMissions: number;
    activeRegions: number;
    byStatus: Record<string, number>;
  };
}

export type MapDataResponse =
  | M1Response
  | M2Response
  | M3Response
  | M4Response
  | M5Response;

// ─── Pure assembler functions (no DB calls) ───────────────────────────────────

/**
 * M1 — Fleet Overview
 * All cases with status/position pins.
 */
export function assembleM1(
  allCases: Doc<"cases">[],
  bounds: MapBounds | null,
  filters: ParsedFilters
): M1Response {
  // Build status summary over ALL cases (before bounds/filter)
  const byStatus: Record<string, number> = {};
  for (const c of allCases) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  }

  let filtered = allCases;
  if (filters.status?.length) {
    filtered = filtered.filter((c) => filters.status!.includes(c.status));
  }
  if (filters.assigneeId) {
    filtered = filtered.filter((c) => c.assigneeId === filters.assigneeId);
  }
  if (filters.missionId) {
    filtered = filtered.filter(
      (c) => c.missionId?.toString() === filters.missionId
    );
  }

  const inBounds = filtered.filter((c) => withinBounds(c.lat, c.lng, bounds));

  const pins: M1CasePin[] = inBounds.map((c) => ({
    _id: c._id.toString(),
    label: c.label,
    status: c.status,
    lat: c.lat,
    lng: c.lng,
    locationName: c.locationName,
    assigneeName: c.assigneeName,
    missionId: c.missionId?.toString(),
    updatedAt: c.updatedAt,
  }));

  return {
    mode: "M1",
    ts: Date.now(),
    cases: pins,
    summary: {
      total: allCases.length,
      withLocation: allCases.filter((c) => c.lat !== undefined).length,
      byStatus,
    },
  };
}

/**
 * M2 — Mission Mode
 * Cases grouped by mission with per-mission status breakdowns.
 */
export function assembleM2(
  allCases: Doc<"cases">[],
  allMissions: Doc<"missions">[],
  bounds: MapBounds | null,
  filters: ParsedFilters
): M2Response {
  let filteredCases = allCases;
  if (filters.status?.length) {
    filteredCases = filteredCases.filter((c) =>
      filters.status!.includes(c.status)
    );
  }

  // Group cases by mission in a single pass
  const casesByMission = new Map<string, Doc<"cases">[]>();
  const unassignedCases: Doc<"cases">[] = [];

  for (const c of filteredCases) {
    if (c.missionId) {
      const key = c.missionId.toString();
      if (!casesByMission.has(key)) casesByMission.set(key, []);
      casesByMission.get(key)!.push(c);
    } else {
      unassignedCases.push(c);
    }
  }

  const byMissionStatus: Record<string, number> = {};
  const missionGroups: M2MissionGroup[] = [];

  for (const mission of allMissions) {
    byMissionStatus[mission.status] =
      (byMissionStatus[mission.status] ?? 0) + 1;

    if (!withinBounds(mission.lat, mission.lng, bounds)) continue;
    if (filters.missionId && mission._id.toString() !== filters.missionId) {
      continue;
    }

    const missionCases = casesByMission.get(mission._id.toString()) ?? [];
    const missionByStatus: Record<string, number> = {};
    for (const c of missionCases) {
      missionByStatus[c.status] = (missionByStatus[c.status] ?? 0) + 1;
    }

    missionGroups.push({
      _id: mission._id.toString(),
      name: mission.name,
      status: mission.status,
      lat: mission.lat,
      lng: mission.lng,
      locationName: mission.locationName,
      leadName: mission.leadName,
      caseCount: missionCases.length,
      byStatus: missionByStatus,
      cases: missionCases.map((c) => ({
        _id: c._id.toString(),
        label: c.label,
        status: c.status,
        lat: c.lat,
        lng: c.lng,
        assigneeName: c.assigneeName,
        updatedAt: c.updatedAt,
      })),
    });
  }

  const unassignedInBounds = unassignedCases
    .filter((c) => withinBounds(c.lat, c.lng, bounds))
    .map((c) => ({
      _id: c._id.toString(),
      label: c.label,
      status: c.status,
      lat: c.lat,
      lng: c.lng,
      assigneeName: c.assigneeName,
      updatedAt: c.updatedAt,
    }));

  return {
    mode: "M2",
    ts: Date.now(),
    missions: missionGroups,
    unassigned: unassignedInBounds,
    summary: {
      total: allCases.length,
      totalMissions: allMissions.length,
      byMissionStatus,
    },
  };
}

/**
 * M3 — Field Mode
 * Cases in active field inspection with progress/damage data.
 *
 * N+1 elimination: `latestInspectionByCase` is pre-built from a full
 * inspections scan — no per-case DB lookup here.
 */
export function assembleM3(
  allCases: Doc<"cases">[],
  latestInspectionByCase: Map<string, Doc<"inspections">>,
  bounds: MapBounds | null,
  filters: ParsedFilters
): M3Response {
  // Filter to field-relevant statuses
  let fieldCases = allCases.filter(
    (c) => c.status === "in_field" || c.status === "deployed"
  );

  if (filters.status?.length) {
    fieldCases = fieldCases.filter((c) => filters.status!.includes(c.status));
  }
  if (filters.assigneeId) {
    fieldCases = fieldCases.filter(
      (c) => c.assigneeId === filters.assigneeId
    );
  }
  if (filters.missionId) {
    fieldCases = fieldCases.filter(
      (c) => c.missionId?.toString() === filters.missionId
    );
  }

  const inBounds = fieldCases.filter((c) => withinBounds(c.lat, c.lng, bounds));

  // Apply hasInspection filter using the pre-built map (O(1) per case)
  let filteredCases = inBounds;
  if (filters.hasInspection !== undefined) {
    filteredCases = filteredCases.filter((c) => {
      const hasInspection =
        latestInspectionByCase.get(c._id.toString()) !== undefined;
      return filters.hasInspection ? hasInspection : !hasInspection;
    });
  }

  const byInspectionStatus: Record<string, number> = { none: 0 };
  let totalDamaged = 0;
  let totalMissing = 0;

  const pins: M3CasePin[] = filteredCases.map((c) => {
    // O(1) lookup — no DB call
    const inspection = latestInspectionByCase.get(c._id.toString());

    if (inspection) {
      byInspectionStatus[inspection.status] =
        (byInspectionStatus[inspection.status] ?? 0) + 1;
      totalDamaged += inspection.damagedItems;
      totalMissing += inspection.missingItems;
    } else {
      byInspectionStatus["none"] = (byInspectionStatus["none"] ?? 0) + 1;
    }

    const totalItems = inspection?.totalItems ?? 0;
    const checkedItems = inspection?.checkedItems ?? 0;
    const progress =
      totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

    return {
      _id: c._id.toString(),
      label: c.label,
      status: c.status,
      lat: c.lat,
      lng: c.lng,
      locationName: c.locationName,
      assigneeName: c.assigneeName,
      missionId: c.missionId?.toString(),
      updatedAt: c.updatedAt,
      inspectionId: inspection?._id.toString(),
      inspectionStatus: inspection?.status,
      inspectorName: inspection?.inspectorName,
      checkedItems,
      totalItems,
      damagedItems: inspection?.damagedItems ?? 0,
      missingItems: inspection?.missingItems ?? 0,
      inspectionProgress: progress,
    };
  });

  return {
    mode: "M3",
    ts: Date.now(),
    cases: pins,
    summary: {
      total: fieldCases.length,
      byInspectionStatus,
      totalDamaged,
      totalMissing,
    },
  };
}

/**
 * M4 — Logistics Mode (in-transit map mode)
 * Shipments in transit with case label lookups.
 *
 * N+1 elimination: `casesById` is pre-built from a full cases scan —
 * no per-shipment DB lookup here.
 *
 * Denormalized case tracking fields:
 *   The `shipCase` mutation (convex/shipping.ts) writes trackingNumber,
 *   carrier, shippedAt, destinationName, destinationLat, and destinationLng
 *   directly to the cases table as a denormalized summary.  assembleM4 now
 *   uses these case-level destination coordinates as a fallback for
 *   withinBounds() when the shipment row's destinationLat/destinationLng
 *   are not set — ensuring newly-shipped cases (where tracking has not yet
 *   been refreshed by refreshShipmentTracking) still appear in the correct
 *   viewport region on the logistics map.
 *
 *   The M4ShipmentPin shape is extended with `caseShippedAt` and
 *   `caseDestinationName` (resolved from the cases table) so the M4 map
 *   tooltip can display the timestamp and destination even before the FedEx
 *   tracking API has been polled.
 */
export function assembleM4(
  allShipments: Doc<"shipments">[],
  casesById: Map<string, Doc<"cases">>,
  bounds: MapBounds | null,
  filters: ParsedFilters
): M4Response {
  // Global summary over ALL shipments
  const byStatus: Record<string, number> = {};
  for (const s of allShipments) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  }
  const inTransit =
    (byStatus["in_transit"] ?? 0) + (byStatus["out_for_delivery"] ?? 0);

  let filtered = allShipments;
  if (filters.status?.length) {
    filtered = filtered.filter((s) => filters.status!.includes(s.status));
  }

  const inBounds = filtered.filter((s) => {
    // Primary position: live tracking position if available.
    // Fallback 1: shipment destination (set when the shipment is created).
    // Fallback 2: denormalized case destination (written by `shipCase` mutation
    //             to the cases table; available even before the first FedEx
    //             tracking refresh populates shipment.destinationLat).
    const caseRecord = casesById.get(s.caseId.toString());
    const checkLat =
      s.currentLat ??
      s.destinationLat ??
      caseRecord?.destinationLat;
    const checkLng =
      s.currentLng ??
      s.destinationLng ??
      caseRecord?.destinationLng;
    return withinBounds(checkLat, checkLng, bounds);
  });

  const pins: M4ShipmentPin[] = inBounds.map((s) => {
    // O(1) lookup — no DB call.
    // The cases table now carries denormalized tracking fields written by
    // the `shipCase` mutation: destinationName, destinationLat, destinationLng,
    // shippedAt, carrier, trackingNumber.  We use these as fallbacks below
    // so M4 pins are informative even before the FedEx tracking API is polled.
    const caseRecord = casesById.get(s.caseId.toString());

    return {
      _id: s._id.toString(),
      caseId: s.caseId.toString(),
      caseLabel: caseRecord?.label ?? "Unknown",
      trackingNumber: s.trackingNumber,
      carrier: s.carrier,
      status: s.status,
      origin: {
        lat: s.originLat,
        lng: s.originLng,
        name: s.originName,
      },
      destination: {
        // Prefer shipment destination; fall back to case-level denormalized fields
        // written by `shipCase` — ensures M4 pin shows a destination even when
        // the shipment was just created and hasn't been geocoded yet.
        lat:  s.destinationLat  ?? caseRecord?.destinationLat,
        lng:  s.destinationLng  ?? caseRecord?.destinationLng,
        name: s.destinationName ?? caseRecord?.destinationName,
      },
      currentLat: s.currentLat,
      currentLng: s.currentLng,
      estimatedDelivery: s.estimatedDelivery,
      // Prefer shipment-level shippedAt; fall back to case-level shippedAt
      // (written by `shipCase` for the "shipped N days ago" T3 tooltip).
      shippedAt: s.shippedAt ?? caseRecord?.shippedAt,
      updatedAt: s.updatedAt,
    };
  });

  return {
    mode: "M4",
    ts: Date.now(),
    shipments: pins,
    summary: {
      total: allShipments.length,
      byStatus,
      inTransit,
    },
  };
}

/**
 * M5 — Mission Control (FF_MAP_MISSION)
 * Geographic clusters, heatmap, and timeline replay.
 */
export function assembleM5(
  allCases: Doc<"cases">[],
  allMissions: Doc<"missions">[],
  featureEnabled: boolean,
  bounds: MapBounds | null
): M5Response {
  const byStatus: Record<string, number> = {};
  for (const c of allCases) {
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  }

  const activeMissions = allMissions.filter(
    (m) => m.status === "active"
  ).length;

  if (!featureEnabled) {
    return {
      mode: "M5",
      ts: Date.now(),
      featureEnabled: false,
      clusters: [],
      heatmap: [],
      timeline: { startTs: 0, endTs: 0, snapshots: [] },
      summary: {
        totalCases: allCases.length,
        totalMissions: allMissions.length,
        activeMissions,
        activeRegions: 0,
        byStatus,
      },
    };
  }

  const missionsWithLocation = allMissions.filter(
    (m) => m.lat !== undefined && m.lng !== undefined
  );
  const missionsInBounds = missionsWithLocation.filter((m) =>
    withinBounds(m.lat, m.lng, bounds)
  );

  // Group cases by mission in a single pass
  const casesByMission = new Map<string, Doc<"cases">[]>();
  for (const c of allCases) {
    if (c.missionId) {
      const key = c.missionId.toString();
      if (!casesByMission.has(key)) casesByMission.set(key, []);
      casesByMission.get(key)!.push(c);
    }
  }

  const clusters: M5Cluster[] = missionsInBounds.map((m) => {
    const mCases = casesByMission.get(m._id.toString()) ?? [];
    const clusterByStatus: Record<string, number> = {};
    for (const c of mCases) {
      clusterByStatus[c.status] = (clusterByStatus[c.status] ?? 0) + 1;
    }
    return {
      lat: m.lat!,
      lng: m.lng!,
      count: mCases.length,
      radius: 50,
      byStatus: clusterByStatus,
      missionIds: [m._id.toString()],
    };
  });

  const statusWeights: Record<string, number> = {
    in_field: 1.0,
    deployed: 0.7,
    shipping: 0.5,
    assembled: 0.3,
    returned: 0.1,
  };

  const heatmap: M5HeatmapPoint[] = allCases
    .filter(
      (c) =>
        c.lat !== undefined &&
        c.lng !== undefined &&
        withinBounds(c.lat, c.lng, bounds)
    )
    .map((c) => ({
      lat: c.lat!,
      lng: c.lng!,
      weight: statusWeights[c.status] ?? 0.5,
    }));

  const now = Date.now();
  const timelineStart = now - 30 * 24 * 60 * 60 * 1000;

  const currentSnapshot: M5TimelineSnapshot = {
    ts: now,
    assembled: byStatus["assembled"] ?? 0,
    deployed: byStatus["deployed"] ?? 0,
    in_field: byStatus["in_field"] ?? 0,
    shipping: byStatus["shipping"] ?? 0,
    returned: byStatus["returned"] ?? 0,
    total: allCases.length,
  };

  const activeRegions = clusters.filter((c) =>
    Object.keys(c.byStatus).some((s) => ["in_field", "deployed"].includes(s))
  ).length;

  return {
    mode: "M5",
    ts: Date.now(),
    featureEnabled: true,
    clusters,
    heatmap,
    timeline: {
      startTs: timelineStart,
      endTs: now,
      snapshots: [currentSnapshot],
    },
    summary: {
      totalCases: allCases.length,
      totalMissions: allMissions.length,
      activeMissions,
      activeRegions,
      byStatus,
    },
  };
}

// ─── Unified aggregate query (primary entry point) ────────────────────────────

/**
 * getMapData — single-pass aggregate query for all map modes.
 *
 * Performance design:
 *   1. Determine which tables are needed for the requested mode.
 *   2. Issue ALL needed queries in a single Promise.all — no sequential
 *      awaits, no per-row sub-queries (N+1 free).
 *   3. Build O(1) in-memory lookup maps from the raw rows.
 *   4. Call the pure assembler function for the requested mode.
 *
 * Tables loaded per mode:
 *   M1  cases
 *   M2  cases + missions
 *   M3  cases + inspections        (latestInspectionByCase map eliminates N+1)
 *   M4  cases + shipments          (casesById map eliminates N+1)
 *   M5  cases + missions + featureFlags
 */
export const getMapData = internalQuery({
  args: {
    mode: v.string(),
    swLat: v.optional(v.string()),
    swLng: v.optional(v.string()),
    neLat: v.optional(v.string()),
    neLng: v.optional(v.string()),
    filters: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<MapDataResponse> => {
    const mode = args.mode as MapMode;
    const bounds = parseBounds(args.swLat, args.swLng, args.neLat, args.neLng);
    const filters = parseFilters(args.filters);

    // ── Decide which tables we need ────────────────────────────────────────
    const needsMissions = mode === "M2" || mode === "M5";
    const needsInspections = mode === "M3";
    const needsShipments = mode === "M4";
    const needsFeatureFlag = mode === "M5";

    // ── Single parallel database pass — no sequential awaits ──────────────
    // All queries are issued concurrently; unused tables resolve immediately
    // as empty arrays / null so the assemblers have a uniform interface.
    const [
      allCases,
      missionsResult,
      inspectionsResult,
      shipmentsResult,
      ffRecord,
    ] = await Promise.all([
      // cases: always needed
      ctx.db.query("cases").collect(),

      // missions: M2, M5
      needsMissions
        ? ctx.db.query("missions").collect()
        : (Promise.resolve([]) as Promise<Doc<"missions">[]>),

      // inspections: M3 — load ALL rows once; N+1 eliminated below
      needsInspections
        ? ctx.db.query("inspections").collect()
        : (Promise.resolve([]) as Promise<Doc<"inspections">[]>),

      // shipments: M4
      needsShipments
        ? ctx.db.query("shipments").collect()
        : (Promise.resolve([]) as Promise<Doc<"shipments">[]>),

      // feature flag: M5
      needsFeatureFlag
        ? ctx.db
            .query("featureFlags")
            .withIndex("by_key", (q) => q.eq("key", "FF_MAP_MISSION"))
            .first()
        : (Promise.resolve(null) as Promise<Doc<"featureFlags"> | null>),
    ]);

    // ── Build O(1) lookup maps — single linear pass each ──────────────────

    /**
     * casesById — used by M4 to resolve case labels without N+1 queries.
     * Built from the cases scan already performed above; no extra DB call.
     */
    const casesById = new Map<string, Doc<"cases">>();
    for (const c of allCases) {
      casesById.set(c._id.toString(), c);
    }

    /**
     * latestInspectionByCase — used by M3.
     *
     * We loaded ALL inspection rows in one query (needsInspections path).
     * Here we reduce to a single "latest" entry per case using _creationTime
     * (Convex auto-field, monotonically increasing), which mirrors what
     * `.order("desc").first()` would return per-case in the old N+1 approach.
     */
    const latestInspectionByCase = new Map<string, Doc<"inspections">>();
    for (const ins of inspectionsResult) {
      const key = ins.caseId.toString();
      const existing = latestInspectionByCase.get(key);
      // _creationTime is a number (ms epoch) auto-set by Convex on insert
      if (!existing || ins._creationTime > existing._creationTime) {
        latestInspectionByCase.set(key, ins);
      }
    }

    // ── Feature flag resolution for M5 ────────────────────────────────────
    const featureEnabled = ffRecord?.enabled ?? false;

    // ── Delegate to pure assembler (no further DB calls) ──────────────────
    switch (mode) {
      case "M1":
        return assembleM1(allCases, bounds, filters);

      case "M2":
        return assembleM2(allCases, missionsResult, bounds, filters);

      case "M3":
        return assembleM3(allCases, latestInspectionByCase, bounds, filters);

      case "M4":
        return assembleM4(shipmentsResult, casesById, bounds, filters);

      case "M5":
        return assembleM5(allCases, missionsResult, featureEnabled, bounds);

      default: {
        // Exhaustive check — TypeScript narrows this to never
        const _exhaustive: never = mode;
        throw new Error(`Unhandled map mode: ${_exhaustive}`);
      }
    }
  },
});

// ─── Legacy per-mode internalQuerys ──────────────────────────────────────────
// Kept for backward compatibility; each now delegates to the shared assemblers
// via the same parallel-load pattern — no N+1 queries.

const modeArgs = {
  swLat: v.optional(v.string()),
  swLng: v.optional(v.string()),
  neLat: v.optional(v.string()),
  neLng: v.optional(v.string()),
  filters: v.optional(v.string()),
};

export const getM1FleetOverview = internalQuery({
  args: modeArgs,
  handler: async (ctx, args): Promise<M1Response> => {
    const [allCases] = await Promise.all([ctx.db.query("cases").collect()]);
    return assembleM1(
      allCases,
      parseBounds(args.swLat, args.swLng, args.neLat, args.neLng),
      parseFilters(args.filters)
    );
  },
});

export const getM2MissionMode = internalQuery({
  args: modeArgs,
  handler: async (ctx, args): Promise<M2Response> => {
    const [allCases, allMissions] = await Promise.all([
      ctx.db.query("cases").collect(),
      ctx.db.query("missions").collect(),
    ]);
    return assembleM2(
      allCases,
      allMissions,
      parseBounds(args.swLat, args.swLng, args.neLat, args.neLng),
      parseFilters(args.filters)
    );
  },
});

export const getM3FieldMode = internalQuery({
  args: modeArgs,
  handler: async (ctx, args): Promise<M3Response> => {
    // Load cases and ALL inspections in parallel — eliminates the N+1
    // that the original implementation had (one query per case in inBounds).
    const [allCases, allInspections] = await Promise.all([
      ctx.db.query("cases").collect(),
      ctx.db.query("inspections").collect(),
    ]);

    // Build latest-inspection-per-case map in a single linear pass
    const latestInspectionByCase = new Map<string, Doc<"inspections">>();
    for (const ins of allInspections) {
      const key = ins.caseId.toString();
      const existing = latestInspectionByCase.get(key);
      if (!existing || ins._creationTime > existing._creationTime) {
        latestInspectionByCase.set(key, ins);
      }
    }

    return assembleM3(
      allCases,
      latestInspectionByCase,
      parseBounds(args.swLat, args.swLng, args.neLat, args.neLng),
      parseFilters(args.filters)
    );
  },
});

export const getM4LogisticsMode = internalQuery({
  args: modeArgs,
  handler: async (ctx, args): Promise<M4Response> => {
    // Load cases and shipments in parallel — eliminates the N+1 that the
    // original implementation had (one ctx.db.get per unique caseId).
    const [allCases, allShipments] = await Promise.all([
      ctx.db.query("cases").collect(),
      ctx.db.query("shipments").collect(),
    ]);

    const casesById = new Map<string, Doc<"cases">>();
    for (const c of allCases) {
      casesById.set(c._id.toString(), c);
    }

    return assembleM4(
      allShipments,
      casesById,
      parseBounds(args.swLat, args.swLng, args.neLat, args.neLng),
      parseFilters(args.filters)
    );
  },
});

export const getM5MissionControl = internalQuery({
  args: modeArgs,
  handler: async (ctx, args): Promise<M5Response> => {
    const [allCases, allMissions, ffRecord] = await Promise.all([
      ctx.db.query("cases").collect(),
      ctx.db.query("missions").collect(),
      ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", "FF_MAP_MISSION"))
        .first(),
    ]);
    return assembleM5(
      allCases,
      allMissions,
      ffRecord?.enabled ?? false,
      parseBounds(args.swLat, args.swLng, args.neLat, args.neLng)
    );
  },
});
