/**
 * src/hooks/use-map-data.ts
 *
 * Convex `useQuery` hooks for real-time INVENTORY dashboard map mode subscriptions.
 *
 * Architecture
 * ────────────
 * Each hook is a thin wrapper around `useQuery` (from convex/react) that
 * subscribes to the corresponding public query function in convex/mapData.ts.
 *
 * Convex's reactive transport layer re-evaluates any subscribed query within
 * ~100–300 ms whenever an underlying table row is mutated by the SCAN app,
 * satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Real-time fidelity guarantee per map mode
 * ──────────────────────────────────────────
 *   M1 — Fleet Overview:
 *     SCAN scan.scanCheckIn writes cases.status/lat/lng → M1 pins update
 *   M2 — Mission Mode:
 *     SCAN mutations to cases or missions → M2 groups re-render
 *   M3 — Field Mode:
 *     SCAN scan.updateChecklistItem writes inspections → progress bars update
 *   M4 — Logistics Mode:
 *     SCAN shipping.shipCase writes cases+shipments → in-transit pins appear
 *   M5 — Mission Control:
 *     Any case/mission mutation + FF flag toggle → clusters/heatmap update
 *
 * Skip pattern
 * ────────────
 * All hooks use `"skip"` when required args are null, avoiding unnecessary
 * Convex subscriptions before the map has initialised.
 *
 * Available hooks
 * ───────────────
 *   useM1MapData(args)  — Fleet Overview pins + summary
 *   useM2MapData(args)  — Mission Mode groups + unassigned cases
 *   useM3MapData(args)  — Field Mode pins + inspection progress
 *   useM4MapData(args)  — Logistics Mode shipment pins + route data
 *   useM5MapData(args)  — Mission Control clusters + heatmap (FF_MAP_MISSION)
 *
 * Return shape for all hooks:
 *   `undefined`          — loading (initial fetch or reconnect)
 *   `M{n}Response`       — successful live result
 *   (never null — the query always returns a result shape even when empty)
 *
 * @example
 * // In a Client Component:
 * import { useM3MapData } from "@/hooks/use-map-data";
 *
 * function FieldModeMap({ bounds, technicianId }) {
 *   const data = useM3MapData({
 *     bounds,
 *     assigneeId: technicianId,
 *   });
 *   if (!data) return <MapSkeleton />;
 *   return <M3Pins cases={data.cases} />;
 * }
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

// Re-export map response types for consuming components
export type {
  M1Response,
  M2Response,
  M3Response,
  M4Response,
  M5Response,
  MapBounds,
  M1CasePin,
  M2MissionGroup,
  M3CasePin,
  M4ShipmentPin,
  M5Cluster,
  M5HeatmapPoint,
  M5TimelineSnapshot,
  // Unified denormalized payload types (Sub-AC 2)
  CasesMapPayloadResponse,
  CaseMapPayload,
  CaseModeFlags,
  CaseInspectionSummary,
} from "../../convex/maps";

// ─── Shared type for viewport bounds ─────────────────────────────────────────

/**
 * Geographic viewport bounds for map mode subscriptions.
 * All four coordinates must be provided together.
 * Pass `null` to get a global (unbounded) view.
 */
export interface MapViewportBounds {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

// ─── useM1MapData ─────────────────────────────────────────────────────────────

/**
 * Args for useM1MapData.
 * All fields are optional — omit to get a global fleet view.
 */
export interface UseM1MapDataArgs {
  /** Geographic viewport bounds.  Pass null for unbounded global view. */
  bounds?: MapViewportBounds | null;
  /** Filter to one or more case lifecycle statuses. */
  status?: ("hangar" | "assembled" | "transit_out" | "deployed" | "flagged" | "recalled" | "transit_in" | "received" | "archived")[];
  /** Filter to cases assigned to a specific technician (Kinde user ID). */
  assigneeId?: string;
  /** Filter to cases on a specific mission. */
  missionId?: string;
}

/**
 * Subscribe to M1 (Fleet Overview) map data.
 *
 * Returns all case pins with status, lat/lng coordinates, assignee, and mission
 * info.  Summary stats cover the full fleet regardless of viewport bounds.
 *
 * Re-evaluates within ~2 s of any SCAN app mutation that touches the cases table.
 *
 * @example
 * const fleetData = useM1MapData();
 * const filteredData = useM1MapData({
 *   status: ["in_field"],
 *   bounds: mapBounds,
 * });
 */
export function useM1MapData(args: UseM1MapDataArgs = {}) {
  const { bounds, status, assigneeId, missionId } = args;

  return useQuery(api.mapData.getM1MapData, {
    ...(bounds ? bounds : {}),
    ...(status     ? { status }     : {}),
    ...(assigneeId ? { assigneeId } : {}),
    ...(missionId  ? { missionId }  : {}),
  });
}

// ─── useM2MapData ─────────────────────────────────────────────────────────────

/**
 * Args for useM2MapData.
 */
export interface UseM2MapDataArgs {
  /** Geographic viewport bounds.  Pass null for unbounded global view. */
  bounds?: MapViewportBounds | null;
  /**
   * Drill into a specific mission — only that mission's group is returned.
   * Pass null or omit to show all missions.
   */
  missionId?: string | null;
  /** Filter cases within mission groups by one or more lifecycle statuses. */
  status?: ("hangar" | "assembled" | "transit_out" | "deployed" | "flagged" | "recalled" | "transit_in" | "received" | "archived")[];
}

/**
 * Subscribe to M2 (Mission Mode) map data.
 *
 * Returns missions grouped with their cases, plus unassigned cases.  Each
 * mission group has a per-status breakdown useful for rendering mission
 * cluster pins with coloured status rings.
 *
 * Re-evaluates within ~2 s of any SCAN case mutation or mission update.
 *
 * @example
 * const missionData = useM2MapData();
 * const missionDetail = useM2MapData({ missionId: selectedMission });
 */
export function useM2MapData(args: UseM2MapDataArgs = {}) {
  const { bounds, missionId, status } = args;

  return useQuery(api.mapData.getM2MapData, {
    ...(bounds    ? bounds                             : {}),
    ...(missionId ? { missionId }                     : {}),
    ...(status    ? { status }                        : {}),
  });
}

// ─── useM3MapData ─────────────────────────────────────────────────────────────

/**
 * Args for useM3MapData.
 */
export interface UseM3MapDataArgs {
  /** Geographic viewport bounds.  Pass null for unbounded global view. */
  bounds?: MapViewportBounds | null;
  /** Filter to cases assigned to a specific technician (Kinde user ID). */
  assigneeId?: string | null;
  /** Filter to cases on a specific mission. */
  missionId?: string | null;
  /**
   * Filter by inspection presence:
   *   true  → only cases with an active inspection
   *   false → only cases not yet inspected
   *   omit  → show all field cases regardless of inspection status
   */
  hasInspection?: boolean;
  /**
   * Filter to cases with at least one damaged item.
   * Useful for "show flagged cases" overlays on the field map.
   */
  hasDamage?: boolean;
}

/**
 * Subscribe to M3 (Field Mode) map data.
 *
 * Returns deployed/in_field cases enriched with real-time inspection progress
 * data: checkedItems/totalItems ratio, damage/missing counts, and the
 * inspection status (in_progress | completed | flagged).
 *
 * This hook is the primary real-time watcher for field technicians'
 * packing-list progress visible on the operations dashboard.  Any
 * updateChecklistItem call from the SCAN app triggers a push update
 * to all active useM3MapData subscriptions within ~2 seconds.
 *
 * @example
 * // All field cases globally
 * const fieldData = useM3MapData();
 *
 * // My cases only, in viewport
 * const myFieldData = useM3MapData({
 *   bounds: mapBounds,
 *   assigneeId: kindeUser.id,
 * });
 *
 * // Show only flagged (damaged) cases
 * const flaggedData = useM3MapData({ hasDamage: true });
 */
export function useM3MapData(args: UseM3MapDataArgs = {}) {
  const { bounds, assigneeId, missionId, hasInspection, hasDamage } = args;

  return useQuery(api.mapData.getM3MapData, {
    ...(bounds        ? bounds               : {}),
    ...(assigneeId    ? { assigneeId }       : {}),
    ...(missionId     ? { missionId }        : {}),
    ...(hasInspection !== undefined ? { hasInspection } : {}),
    ...(hasDamage     !== undefined ? { hasDamage }     : {}),
  });
}

// ─── useM4MapData ─────────────────────────────────────────────────────────────

/**
 * Args for useM4MapData.
 */
export interface UseM4MapDataArgs {
  /** Geographic viewport bounds.  Pass null for unbounded global view. */
  bounds?: MapViewportBounds | null;
  /**
   * Filter to specific shipment tracking statuses.
   * Omit to show all active shipments.
   * Common values: "in_transit", "out_for_delivery"
   */
  status?: (
    | "label_created"
    | "picked_up"
    | "in_transit"
    | "out_for_delivery"
    | "delivered"
    | "exception"
  )[];
}

/**
 * Subscribe to M4 (Logistics Mode) map data.
 *
 * Returns active shipments with route geometry (origin → current → destination)
 * and case labels for map pin tooltips.  Includes ETA, tracking number, and
 * carrier info.
 *
 * Re-evaluates within ~2 s when:
 *   • SCAN app calls shipCase (new shipment + case status = "shipping")
 *   • FedEx tracking refresh updates currentLat/currentLng
 *   • updateShipmentStatus changes shipment tracking status
 *
 * @example
 * const logisticsData = useM4MapData();
 * const inTransitOnly = useM4MapData({
 *   status: ["in_transit", "out_for_delivery"],
 *   bounds: mapBounds,
 * });
 */
export function useM4MapData(args: UseM4MapDataArgs = {}) {
  const { bounds, status } = args;

  return useQuery(api.mapData.getM4MapData, {
    ...(bounds ? bounds     : {}),
    ...(status ? { status } : {}),
  });
}

// ─── useM5MapData ─────────────────────────────────────────────────────────────

/**
 * Args for useM5MapData.
 */
export interface UseM5MapDataArgs {
  /** Geographic viewport bounds.  Pass null for unbounded global view. */
  bounds?: MapViewportBounds | null;
}

/**
 * Subscribe to M5 (Mission Control) map data.
 *
 * Returns geographic density clusters, a weighted heatmap of case activity,
 * and a timeline snapshot of current status distribution.
 *
 * When the FF_MAP_MISSION feature flag is disabled, returns:
 *   { featureEnabled: false, clusters: [], heatmap: [], ... }
 * Render the "Mission Control unavailable" placeholder in this case.
 *
 * Re-evaluates within ~2 s when:
 *   • Any case status changes (heatmap weight changes)
 *   • Any mission is created/updated (cluster positions/sizes change)
 *   • FF_MAP_MISSION flag is toggled (enable/disable triggers immediate update)
 *
 * @example
 * const missionControl = useM5MapData();
 * if (!missionControl) return <MapSkeleton />;
 * if (!missionControl.featureEnabled) return <FeatureDisabledPlaceholder />;
 * return <M5Clusters clusters={missionControl.clusters} />;
 */
export function useM5MapData(args: UseM5MapDataArgs = {}) {
  const { bounds } = args;

  return useQuery(api.mapData.getM5MapData, {
    ...(bounds ? bounds : {}),
  });
}

// ─── useCasesMapPayload — Unified denormalized payload hook (Sub-AC 2) ─────────

/**
 * Args for useCasesMapPayload.
 * All fields are optional — omit for a global, unfiltered fleet view.
 */
export interface UseCasesMapPayloadArgs {
  /**
   * Geographic viewport bounds for spatial pre-filtering.
   * Pass `null` or omit for an unbounded global view.
   * All four coordinates must be provided together.
   */
  bounds?: MapViewportBounds | null;
  /**
   * Filter to one or more case lifecycle statuses.
   * Omit to return cases in all statuses.
   */
  status?: (
    | "hangar"
    | "assembled"
    | "transit_out"
    | "deployed"
    | "flagged"
    | "transit_in"
    | "received"
    | "archived"
  )[];
  /**
   * Filter to cases assigned to a specific technician (Kinde user ID).
   * Omit to return cases assigned to any technician (or unassigned).
   */
  assigneeId?: string | null;
  /**
   * Filter to cases on a specific mission (Convex mission document ID string).
   * Omit to return cases across all missions.
   */
  missionId?: string | null;
}

/**
 * Subscribe to the unified, denormalized map payload covering all 5 map modes.
 *
 * Returns ALL cases enriched with pre-joined inspection data, custody state,
 * and pre-computed `modeFlags` booleans.  Clients that need to switch between
 * M1–M5 without stale data gaps use this single hook instead of maintaining
 * five separate per-mode subscriptions.
 *
 * The `modeFlags` field on each CaseMapPayload entry enables O(1) client-side
 * mode filtering:
 *   const fieldCases   = data.cases.filter(c => c.modeFlags.isFieldActive);
 *   const transitCases = data.cases.filter(c => c.modeFlags.isInTransit);
 *   const heatPoints   = data.cases.filter(c => c.modeFlags.hasCoordinates);
 *
 * Real-time fidelity:
 *   Convex re-evaluates the underlying getCasesMapPayload query within
 *   ~100–300 ms whenever any SCAN mutation writes to cases, inspections,
 *   or custodyRecords — satisfying the ≤ 2-second fidelity requirement.
 *
 * Return shape:
 *   `undefined`              — loading (initial fetch or reconnect)
 *   `CasesMapPayloadResponse` — live denormalized fleet payload
 *
 * @example
 * // Global fleet view (all cases, all modes)
 * const payload = useCasesMapPayload();
 * if (!payload) return <MapSkeleton />;
 *
 * // Field mode pins only
 * const fieldPins = payload.cases.filter(c => c.modeFlags.isFieldActive);
 *
 * // Viewport-scoped + deployed/flagged only
 * const fieldData = useCasesMapPayload({
 *   bounds: mapBounds,
 *   status: ["deployed", "flagged"],
 * });
 */
export function useCasesMapPayload(args: UseCasesMapPayloadArgs = {}) {
  const { bounds, status, assigneeId, missionId } = args;

  return useQuery(api.mapData.getCasesMapPayload, {
    ...(bounds      ? bounds              : {}),
    ...(status?.length ? { status }       : {}),
    ...(assigneeId  ? { assigneeId }      : {}),
    ...(missionId   ? { missionId }       : {}),
  });
}
