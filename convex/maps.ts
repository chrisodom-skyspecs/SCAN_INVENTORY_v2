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

// ─── Domain-specific status literal types ─────────────────────────────────────
// These mirror the Convex schema validators in convex/schema.ts and must be
// kept in sync with both the schema and src/types/case-status.ts.

/**
 * Valid case lifecycle status values.
 *
 * Source of truth: `caseStatus` validator in convex/schema.ts.
 * Also mirrors: `CaseStatus` in src/types/case-status.ts (application-level alias).
 *
 * Lifecycle order:
 *   hangar → assembled → transit_out → deployed → (flagged/recalled) → transit_in → received → archived
 */
export type CaseStatusLiteral =
  | "hangar"        // stored in hangar; not yet assembled
  | "assembled"     // fully packed, ready to deploy
  | "transit_out"   // in transit to field site
  | "deployed"      // actively in use at a field site
  | "flagged"       // has outstanding issues requiring review
  | "recalled"      // recalled to hangar by operations
  | "transit_in"    // in transit returning to base
  | "received"      // received back at base
  | "archived";     // decommissioned; no longer in active rotation

/**
 * Valid mission lifecycle status values.
 * Mirrors the `missionStatus` validator in convex/schema.ts.
 */
export type MissionStatusLiteral =
  | "planning"
  | "active"
  | "completed"
  | "cancelled";

/**
 * Valid inspection lifecycle status values.
 * Mirrors the `inspectionStatus` validator in convex/schema.ts.
 */
export type InspectionStatusLiteral =
  | "pending"
  | "in_progress"
  | "completed"
  | "flagged";

/**
 * Valid FedEx/carrier shipment tracking status values.
 * Mirrors the `shipmentStatus` validator in convex/schema.ts.
 */
export type ShipmentStatusLiteral =
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";

// ─── Shared custody snapshot type ────────────────────────────────────────────

/**
 * Lightweight custody state extracted from the most recent custodyRecord for
 * a case.  Used by map assembler functions (assembleM1, assembleM2, assembleM3)
 * to attach custody state to map pin shapes without N+1 DB queries.
 *
 * Built by the calling query handler (getM1MapData, etc.) from a full scan of
 * the `custodyRecords` table, then passed as `latestCustodyByCase` map to the
 * assembler.  The assembler performs an O(1) lookup per case.
 */
export interface CustodySnapshot {
  /** Kinde user ID of the current physical custodian (toUserId). */
  toUserId: string;
  /** Display name of the current physical custodian (toUserName). */
  toUserName: string;
  /** Kinde user ID of the previous holder who transferred the case. */
  fromUserId: string;
  /** Display name of the previous holder. */
  fromUserName: string;
  /** Epoch ms when the most recent transfer occurred. */
  transferredAt: number;
}

// ─── M1 types ─────────────────────────────────────────────────────────────────

/**
 * Map pin for a single equipment case in M1 (Fleet Overview) mode.
 *
 * All coordinate fields are optional — cases not yet assigned to a field site
 * have no lat/lng and are excluded from the viewport bounds filter.
 */
export interface M1CasePin {
  /** Convex document ID (string form). */
  _id: string;
  /** Human-readable case label, e.g. "CASE-0042". */
  label: string;
  /** Current lifecycle status of the case. */
  status: CaseStatusLiteral;
  /** WGS-84 latitude of the case's current location, if known. */
  lat?: number;
  /** WGS-84 longitude of the case's current location, if known. */
  lng?: number;
  /** Human-readable location name, e.g. "Seattle, WA". */
  locationName?: string;
  /** Display name of the assigned technician/pilot, if any. */
  assigneeName?: string;
  /** Convex ID string of the mission this case belongs to, if any. */
  missionId?: string;
  /** Epoch ms timestamp of the most recent status change or update. */
  updatedAt: number;
  /**
   * Kinde user ID of the current physical custodian.
   * Resolved from the most recent custodyRecord.toUserId.
   * Falls back to cases.assigneeId when no handoff has been recorded.
   * Populated by getM1MapData when custody records are loaded.
   */
  currentCustodianId?: string;
  /** Display name of the current physical custodian. */
  currentCustodianName?: string;
  /** Epoch ms of the most recent custody transfer.  Undefined if no handoff. */
  custodyTransferredAt?: number;
}

/**
 * M1 Fleet Overview response envelope.
 *
 * Contains all cases passing the current viewport bounds + filter parameters,
 * plus a summary with global counts (un-filtered) for the status legend.
 */
export interface M1Response {
  /** Discriminant — always "M1". */
  mode: "M1";
  /** Server-side epoch ms when this response was assembled. */
  ts: number;
  /** Case pins within the requested viewport bounds. */
  cases: M1CasePin[];
  summary: {
    /** Total case count across ALL statuses (no filter applied). */
    total: number;
    /** Count of cases that have a lat/lng coordinate. */
    withLocation: number;
    /**
     * Case counts keyed by CaseStatusLiteral.
     * Only statuses with at least one case appear as keys (sparse map).
     * Missing keys imply a count of zero.
     */
    byStatus: Partial<Record<CaseStatusLiteral, number>>;
  };
}

// ─── M2 types ─────────────────────────────────────────────────────────────────

/**
 * A single case nested inside an M2MissionGroup.
 * Contains the same coordinate + assignment fields as M1CasePin, plus custody state.
 */
export interface M2MissionCase {
  /** Convex document ID (string form). */
  _id: string;
  /** Human-readable case label, e.g. "CASE-0042". */
  label: string;
  /** Current lifecycle status of the case. */
  status: CaseStatusLiteral;
  /** WGS-84 latitude of the case's current location, if known. */
  lat?: number;
  /** WGS-84 longitude of the case's current location, if known. */
  lng?: number;
  /** Display name of the assigned technician/pilot, if any. */
  assigneeName?: string;
  /** Epoch ms timestamp of the most recent status change or update. */
  updatedAt: number;
  /** Current custodian Kinde user ID resolved from custodyRecords. */
  currentCustodianId?: string;
  /** Current custodian display name resolved from custodyRecords. */
  currentCustodianName?: string;
  /** Epoch ms of the most recent custody transfer. */
  custodyTransferredAt?: number;
}

/**
 * A case that is not assigned to any mission, returned in M2Response.unassigned.
 * Includes the same base fields as M2MissionCase.
 */
export interface M2UnassignedCase {
  /** Convex document ID (string form). */
  _id: string;
  /** Human-readable case label, e.g. "CASE-0042". */
  label: string;
  /** Current lifecycle status of the case. */
  status: CaseStatusLiteral;
  /** WGS-84 latitude of the case's current location, if known. */
  lat?: number;
  /** WGS-84 longitude of the case's current location, if known. */
  lng?: number;
  /** Display name of the assigned technician/pilot, if any. */
  assigneeName?: string;
  /** Epoch ms timestamp of the most recent status change or update. */
  updatedAt: number;
  /** Current custodian Kinde user ID resolved from custodyRecords. */
  currentCustodianId?: string;
  /** Current custodian display name resolved from custodyRecords. */
  currentCustodianName?: string;
  /** Epoch ms of the most recent custody transfer. */
  custodyTransferredAt?: number;
}

/**
 * A mission group in M2 (Mission Mode), containing aggregated case counts
 * and individual case pins for cases assigned to this mission.
 */
export interface M2MissionGroup {
  /** Convex document ID of the mission (string form). */
  _id: string;
  /** Mission display name. */
  name: string;
  /** Current mission lifecycle status. */
  status: MissionStatusLiteral;
  /** WGS-84 latitude of the mission site's coordinates, if known. */
  lat?: number;
  /** WGS-84 longitude of the mission site's coordinates, if known. */
  lng?: number;
  /** Human-readable location name, e.g. "Seattle, WA". */
  locationName?: string;
  /** Display name of the mission lead, if any. */
  leadName?: string;
  /** Total number of cases assigned to this mission. */
  caseCount: number;
  /**
   * Case counts keyed by CaseStatusLiteral for the status breakdown legend.
   * Only statuses with at least one case appear as keys (sparse map).
   */
  byStatus: Partial<Record<CaseStatusLiteral, number>>;
  /** Individual case pins for cases assigned to this mission. */
  cases: M2MissionCase[];
}

/**
 * M2 Mission Mode response envelope.
 *
 * Groups cases by mission site for the site-detail map view.
 * Cases with no mission assignment appear in the `unassigned` array.
 */
export interface M2Response {
  /** Discriminant — always "M2". */
  mode: "M2";
  /** Server-side epoch ms when this response was assembled. */
  ts: number;
  /** Mission groups within the requested viewport bounds. */
  missions: M2MissionGroup[];
  /** Cases that are not assigned to any mission. */
  unassigned: M2UnassignedCase[];
  summary: {
    /** Total case count across all missions and unassigned. */
    total: number;
    /** Total mission count (regardless of status filter). */
    totalMissions: number;
    /**
     * Mission counts keyed by MissionStatusLiteral.
     * Only mission statuses with at least one mission appear as keys.
     */
    byMissionStatus: Partial<Record<MissionStatusLiteral, number>>;
  };
}

// ─── M3 types ─────────────────────────────────────────────────────────────────

/**
 * Map pin for a single equipment case in M3 (Field Mode).
 *
 * Only cases with status "deployed" or "flagged" appear in M3 results.
 * Inspection progress fields are always present (defaulting to 0 when no
 * inspection record exists for the case).
 */
export interface M3CasePin {
  /** Convex document ID (string form). */
  _id: string;
  /** Human-readable case label, e.g. "CASE-0042". */
  label: string;
  /**
   * Current lifecycle status — always "deployed" or "flagged" in M3 results.
   * M3 filtering restricts to these two active field statuses.
   */
  status: "deployed" | "flagged";
  /** WGS-84 latitude of the case's current location, if known. */
  lat?: number;
  /** WGS-84 longitude of the case's current location, if known. */
  lng?: number;
  /** Human-readable location name, e.g. "Seattle, WA". */
  locationName?: string;
  /** Display name of the assigned technician/pilot, if any. */
  assigneeName?: string;
  /** Convex ID string of the mission this case belongs to, if any. */
  missionId?: string;
  /** Epoch ms timestamp of the most recent status change or update. */
  updatedAt: number;
  // ── Inspection data ────────────────────────────────────────────────────────
  /** Convex ID of the latest inspection record for this case, if any. */
  inspectionId?: string;
  /** Lifecycle status of the latest inspection, if any. */
  inspectionStatus?: InspectionStatusLiteral;
  /** Display name of the technician who started the inspection. */
  inspectorName?: string;
  /** Number of checklist items that have been reviewed (ok, damaged, or missing). */
  checkedItems: number;
  /** Total number of checklist items in the case's packing list. */
  totalItems: number;
  /** Count of items marked as damaged in the latest inspection. */
  damagedItems: number;
  /** Count of items marked as missing in the latest inspection. */
  missingItems: number;
  /**
   * Inspection completion percentage: Math.round(checkedItems / totalItems * 100).
   * Range: 0–100. Equals 0 when totalItems is 0 or no inspection exists.
   */
  inspectionProgress: number;
  // ── Custody state ──────────────────────────────────────────────────────────
  /** Current custodian Kinde user ID (M3 field mode tooltip "Held by…"). */
  currentCustodianId?: string;
  /** Current custodian display name resolved from custodyRecords. */
  currentCustodianName?: string;
  /** Epoch ms of the most recent custody transfer. */
  custodyTransferredAt?: number;
}

/**
 * M3 Field Mode response envelope.
 *
 * Contains only deployed/flagged cases with inspection progress overlays.
 * Used by the field inspection map view to show real-time inspection status.
 */
export interface M3Response {
  /** Discriminant — always "M3". */
  mode: "M3";
  /** Server-side epoch ms when this response was assembled. */
  ts: number;
  /** Field case pins (deployed + flagged status only). */
  cases: M3CasePin[];
  summary: {
    /** Total count of field cases (deployed + flagged) before bounds filter. */
    total: number;
    /**
     * Case counts keyed by inspection status plus "none" for un-inspected cases.
     * Only statuses with at least one case appear as keys.
     */
    byInspectionStatus: Partial<Record<InspectionStatusLiteral | "none", number>>;
    /** Sum of damagedItems across all field cases. */
    totalDamaged: number;
    /** Sum of missingItems across all field cases. */
    totalMissing: number;
  };
}

// ─── M4 types ─────────────────────────────────────────────────────────────────

/**
 * Map pin for a single active shipment in M4 (Logistics Mode).
 *
 * Destination coordinates use a three-tier fallback:
 *   1. shipment.destinationLat/Lng  (set after FedEx tracking refresh)
 *   2. case.destinationLat/Lng      (denormalized from shipCase mutation)
 *   3. undefined                    (new shipment before any geocoding)
 */
export interface M4ShipmentPin {
  /** Convex document ID of the shipment record (string form). */
  _id: string;
  /** Convex document ID of the associated case (string form). */
  caseId: string;
  /** Human-readable case label resolved from the cases table. */
  caseLabel: string;
  /** FedEx (or other carrier) tracking number. */
  trackingNumber: string;
  /** Carrier name, e.g. "FedEx". */
  carrier: string;
  /** Current FedEx shipment tracking status. */
  status: ShipmentStatusLiteral;
  /** Origin location (where the shipment was dispatched from). */
  origin: {
    /** WGS-84 latitude of the origin facility, if known. */
    lat?: number;
    /** WGS-84 longitude of the origin facility, if known. */
    lng?: number;
    /** Human-readable origin name, e.g. "Denver Base". */
    name?: string;
  };
  /** Destination location (where the shipment is headed). */
  destination: {
    /** WGS-84 latitude of the destination, if known. */
    lat?: number;
    /** WGS-84 longitude of the destination, if known. */
    lng?: number;
    /** Human-readable destination name, e.g. "Seattle Field Site". */
    name?: string;
  };
  /** Current WGS-84 latitude from live FedEx tracking, if available. */
  currentLat?: number;
  /** Current WGS-84 longitude from live FedEx tracking, if available. */
  currentLng?: number;
  /**
   * Estimated delivery date as an ISO-8601 date string (YYYY-MM-DD), if known.
   * Populated by the FedEx tracking API after the shipment is in transit.
   */
  estimatedDelivery?: string;
  /**
   * Epoch ms when the case was shipped (handed to carrier).
   * Uses shipment.shippedAt when available; falls back to case.shippedAt
   * (written by the `shipCase` mutation) for newly-created shipments.
   */
  shippedAt?: number;
  /** Epoch ms timestamp of the most recent tracking refresh or update. */
  updatedAt: number;
}

/**
 * M4 Logistics Mode response envelope.
 *
 * Contains active shipments with origin/destination/current position overlays.
 * Used by the logistics map view for FedEx tracking and transit monitoring.
 */
export interface M4Response {
  /** Discriminant — always "M4". */
  mode: "M4";
  /** Server-side epoch ms when this response was assembled. */
  ts: number;
  /** Active shipment pins within the requested viewport bounds. */
  shipments: M4ShipmentPin[];
  summary: {
    /** Total shipment count across all statuses (no bounds filter applied). */
    total: number;
    /**
     * Shipment counts keyed by ShipmentStatusLiteral.
     * Only statuses with at least one shipment appear as keys.
     */
    byStatus: Partial<Record<ShipmentStatusLiteral, number>>;
    /**
     * Count of shipments actively moving ("in_transit" + "out_for_delivery").
     * Convenience field for the logistics HUD badge.
     */
    inTransit: number;
  };
}

// ─── M5 types ─────────────────────────────────────────────────────────────────

/**
 * A geographic density cluster in M5 (Mission Control) mode.
 *
 * Each cluster represents one mission site and its associated cases.
 * The radius is the visual rendering radius in Mapbox pixels.
 */
export interface M5Cluster {
  /** WGS-84 latitude of the cluster centroid (mission site). */
  lat: number;
  /** WGS-84 longitude of the cluster centroid (mission site). */
  lng: number;
  /** Total number of cases represented by this cluster. */
  count: number;
  /** Visual rendering radius in Mapbox GL pixels (default: 50). */
  radius: number;
  /**
   * Case counts keyed by CaseStatusLiteral for the cluster legend.
   * Only statuses present in this cluster appear as keys.
   */
  byStatus: Partial<Record<CaseStatusLiteral, number>>;
  /** Convex mission IDs included in this cluster (string form). */
  missionIds: string[];
}

/**
 * A single point on the M5 density heatmap layer.
 *
 * Weight is normalized 0–1:
 *   1.0 = deployed (highest operational signal)
 *   0.9 = flagged
 *   0.5 = transit_out / transit_in
 *   0.3 = assembled
 *   0.1 = hangar / received
 *   0.0 = archived
 */
export interface M5HeatmapPoint {
  /** WGS-84 latitude of the case position. */
  lat: number;
  /** WGS-84 longitude of the case position. */
  lng: number;
  /**
   * Normalized intensity weight for the Mapbox heatmap layer.
   * Range: 0.0 (low signal) – 1.0 (high signal).
   */
  weight: number;
}

/**
 * A single snapshot of the fleet status distribution at a point in time.
 * Used by the M5 timeline replay scrubber.
 */
export interface M5TimelineSnapshot {
  /** Epoch ms of this snapshot. */
  ts: number;
  /** Count of cases in "hangar" status at this timestamp. */
  hangar: number;
  /** Count of cases in "assembled" status at this timestamp. */
  assembled: number;
  /** Count of cases in "transit_out" status at this timestamp. */
  transit_out: number;
  /** Count of cases in "deployed" status at this timestamp. */
  deployed: number;
  /** Count of cases in "flagged" status at this timestamp. */
  flagged: number;
  /** Count of cases in "transit_in" status at this timestamp. */
  transit_in: number;
  /** Count of cases in "received" status at this timestamp. */
  received: number;
  /** Count of cases in "archived" status at this timestamp. */
  archived: number;
  /** Total case count across all statuses at this timestamp. */
  total: number;
}

/**
 * M5 Mission Control response envelope (requires FF_MAP_MISSION feature flag).
 *
 * When `featureEnabled` is false, clusters/heatmap/timeline.snapshots are
 * empty and only the summary counts are populated — callers should show a
 * feature-gated empty state rather than trying to render the map layers.
 */
export interface M5Response {
  /** Discriminant — always "M5". */
  mode: "M5";
  /** Server-side epoch ms when this response was assembled. */
  ts: number;
  /**
   * Whether the FF_MAP_MISSION feature flag is currently enabled.
   * When false, clusters/heatmap/snapshots are empty arrays.
   */
  featureEnabled: boolean;
  /** Geographic density clusters (one per mission site with coordinates). */
  clusters: M5Cluster[];
  /** Heatmap points derived from all cases with coordinates. */
  heatmap: M5HeatmapPoint[];
  /**
   * Timeline data for the replay scrubber.
   * `startTs`/`endTs` define the scrubber range (default: last 30 days).
   */
  timeline: {
    /** Epoch ms start of the timeline window. */
    startTs: number;
    /** Epoch ms end of the timeline window (typically "now"). */
    endTs: number;
    /** Status distribution snapshots ordered by ascending ts. */
    snapshots: M5TimelineSnapshot[];
  };
  summary: {
    /** Total case count in the fleet (no bounds filter). */
    totalCases: number;
    /** Total mission count in the system. */
    totalMissions: number;
    /** Count of missions with status "active". */
    activeMissions: number;
    /**
     * Count of clusters with at least one deployed or flagged case.
     * Represents regions with active operational presence.
     */
    activeRegions: number;
    /**
     * Case counts keyed by CaseStatusLiteral for the fleet status legend.
     * Only statuses with at least one case appear as keys.
     */
    byStatus: Partial<Record<CaseStatusLiteral, number>>;
  };
}

/**
 * Discriminated union of all possible GET /api/cases/map response payloads.
 *
 * Narrow to a specific mode using the `mode` discriminant:
 * @example
 * if (data.mode === "M1") { // data is M1Response }
 * if (data.mode === "M4") { // data is M4Response — shipments field available }
 *
 * Use the mode type guards from src/types/cases-map.ts for a functional narrowing
 * pattern: `isM1Response(data)`, `isM4Response(data)`, etc.
 */
export type MapDataResponse =
  | M1Response
  | M2Response
  | M3Response
  | M4Response
  | M5Response;

// ─── Unified denormalized payload types (Sub-AC 2) ────────────────────────────

/**
 * Mode flags computed server-side for each case to identify which INVENTORY
 * map modes the case is relevant to.
 *
 * Pre-computed so clients can perform O(1) mode filtering without re-deriving
 * these boolean conditions from the status field on every render.
 *
 * Used by: getCasesMapPayload, CaseMapPayload, useCasesMapPayload
 */
export interface CaseModeFlags {
  /**
   * M1 Fleet Overview: always `true`.
   * Every case — regardless of status or position — appears in the fleet map.
   */
  isFleetVisible: boolean;
  /**
   * M2 Mission Mode: `true` when `cases.missionId` is set.
   * Mission-assigned cases participate in M2 mission-group cluster pins.
   */
  isMissionAssigned: boolean;
  /**
   * M3 Field Mode: `true` when `status` is "deployed" or "flagged".
   * Field-active cases appear in the M3 inspection progress overlay.
   */
  isFieldActive: boolean;
  /**
   * M4 Logistics Mode: `true` when the case has a tracking number OR
   * its status is "transit_out" or "transit_in".
   * Transit cases appear in the M4 shipment-route overlay.
   */
  isInTransit: boolean;
  /**
   * M5 Mission Control heatmap: `true` when the case has both lat and lng.
   * Cases without coordinates are excluded from the M5 heatmap layer.
   */
  hasCoordinates: boolean;
}

/**
 * Inspection summary denormalized into the case map payload.
 *
 * Derived from the latest `inspections` table row for a given case.
 * Populated when the case has at least one inspection record.
 * `undefined` when no inspection has been started for the case.
 *
 * Used by M3 Field Mode map pins (progress bars, damage/missing badges).
 */
export interface CaseInspectionSummary {
  /** Convex document ID of the latest inspection record (string form). */
  inspectionId: string;
  /** Current lifecycle status of the latest inspection. */
  status: InspectionStatusLiteral;
  /** Display name of the technician who started the inspection. */
  inspectorName: string;
  /**
   * Number of checklist items that have been reviewed.
   * Counts items in "ok", "damaged", or "missing" states.
   */
  checkedItems: number;
  /** Total number of checklist items in the case's packing list. */
  totalItems: number;
  /** Count of items marked as "damaged" in the latest inspection. */
  damagedItems: number;
  /** Count of items marked as "missing" in the latest inspection. */
  missingItems: number;
  /**
   * Inspection completion percentage.
   * Computed as: Math.round(checkedItems / totalItems * 100).
   * Range: 0–100. Equals 0 when totalItems is 0 (no template applied).
   */
  progress: number;
}

/**
 * Single case entry in the unified CasesMapPayloadResponse.
 *
 * All fields needed by any of the 5 map modes (M1–M5) are pre-joined and
 * denormalized into this shape so the client subscribes to ONE query instead
 * of five separate per-mode queries.
 *
 * Field sections:
 *   Identity      — id, label, qrCode
 *   Status        — status (CaseStatusLiteral)
 *   Coordinates   — lat, lng, locationName
 *   Mode flags    — modeFlags (pre-computed booleans, O(1) client filtering)
 *   Assignment    — assigneeId, assigneeName, missionId
 *   Custody       — currentCustodianId, currentCustodianName, custodyTransferredAt
 *   Inspection    — inspection (CaseInspectionSummary | undefined)
 *   Shipping      — trackingNumber, carrier, shippedAt, destinationName/Lat/Lng
 *   Timestamps    — updatedAt, createdAt
 */
export interface CaseMapPayload {
  // ── Identity ─────────────────────────────────────────────────────────────
  /** Convex document ID (string form). */
  id: string;
  /** Human-readable case label, e.g. "CASE-0042". */
  label: string;
  /**
   * Raw QR code payload stored in `cases.qrCode`.
   * Included here so the INVENTORY dashboard can deep-link to the SCAN app
   * `/scan/<qrCode>` route from a map pin popup without a secondary lookup.
   */
  qrCode: string;

  // ── Status ───────────────────────────────────────────────────────────────
  /** Current lifecycle status of the case. */
  status: CaseStatusLiteral;

  // ── Coordinates ──────────────────────────────────────────────────────────
  /** WGS-84 latitude of the case's current location, if known. */
  lat?: number;
  /** WGS-84 longitude of the case's current location, if known. */
  lng?: number;
  /** Human-readable location name (e.g. "Seattle Field Site"). */
  locationName?: string;

  // ── Mode flags ───────────────────────────────────────────────────────────
  /**
   * Pre-computed boolean flags indicating which map modes this case is
   * relevant to.  Enables O(1) client-side mode filtering without re-deriving
   * conditions from the status field.
   */
  modeFlags: CaseModeFlags;

  // ── Assignment ───────────────────────────────────────────────────────────
  /** Kinde user ID of the assigned technician/pilot, if any. */
  assigneeId?: string;
  /** Display name of the assigned technician/pilot, if any. */
  assigneeName?: string;
  /**
   * Convex document ID string of the mission this case belongs to, if any.
   * String (not typed v.id) so it can be stored in a plain JS object without
   * Convex ID opaque type complexity on the client side.
   */
  missionId?: string;

  // ── Custody state (denormalized from custodyRecords table) ────────────────
  /**
   * Kinde user ID of the current physical custodian.
   * Resolved from the most recent custodyRecord.toUserId.
   * Falls back to cases.assigneeId when no handoff has been recorded.
   */
  currentCustodianId?: string;
  /** Display name of the current physical custodian. */
  currentCustodianName?: string;
  /** Epoch ms when the most recent custody transfer occurred. */
  custodyTransferredAt?: number;

  // ── Inspection data (denormalized from inspections table) ─────────────────
  /**
   * Latest inspection summary for this case.
   * `undefined` when no inspection has been started for this case.
   * Populated for M3 Field Mode map pins (progress bars, damage indicators).
   */
  inspection?: CaseInspectionSummary;

  // ── Shipping / tracking fields (already denormalized on cases table) ──────
  // Written by the `shipCase` mutation (convex/shipping.ts) directly onto
  // the `cases` row.  These fields are passed through as-is — no join needed.
  /** FedEx (or other carrier) tracking number. */
  trackingNumber?: string;
  /** Carrier name (always "FedEx" currently). */
  carrier?: string;
  /** Epoch ms when the case was handed to the carrier. */
  shippedAt?: number;
  /** Human-readable destination name (e.g. "SkySpecs HQ — Ann Arbor"). */
  destinationName?: string;
  /** WGS-84 latitude of the shipment destination. */
  destinationLat?: number;
  /** WGS-84 longitude of the shipment destination. */
  destinationLng?: number;

  // ── Timestamps ───────────────────────────────────────────────────────────
  /** Epoch ms when this case record was last updated. */
  updatedAt: number;
  /** Epoch ms when this case record was created. */
  createdAt: number;
}

/**
 * Response envelope for `getCasesMapPayload` — the unified map data query.
 *
 * Returns ALL cases with pre-joined, denormalized fields covering every map
 * mode (M1–M5).  The `modeFlags` on each CaseMapPayload entry enable O(1)
 * client-side mode filtering without re-deriving logic from the status field.
 *
 * Summary counts cover the full fleet before any bounds or filter is applied,
 * providing accurate global statistics for the INVENTORY dashboard status legend
 * and mode-selector badges.
 *
 * Real-time fidelity:
 *   Convex re-evaluates all active getCasesMapPayload subscriptions within
 *   ~100–300 ms whenever any row in cases, inspections, or custodyRecords is
 *   mutated by the SCAN app — satisfying the ≤ 2-second fidelity requirement.
 */
export interface CasesMapPayloadResponse {
  /** Server-side epoch ms when this response was assembled. */
  ts: number;
  /**
   * Denormalized case entries.
   * Filtered by status/assignee/mission args and (optionally) viewport bounds.
   * Each entry carries all data needed by all five map modes.
   */
  cases: CaseMapPayload[];
  /** Fleet-wide aggregate counts (applied BEFORE any filter or bounds). */
  summary: {
    /** Total case count across all statuses (unfiltered). */
    total: number;
    /** Count of cases with a recorded lat/lng position. */
    withLocation: number;
    /**
     * Case counts keyed by CaseStatusLiteral.
     * Only statuses with at least one case appear as keys (sparse map).
     */
    byStatus: Partial<Record<CaseStatusLiteral, number>>;
    /**
     * Count of cases with status "deployed" or "flagged" (M3 field cases).
     * Convenience field for the M3 mode-selector badge count.
     */
    fieldActive: number;
    /**
     * Count of cases with active transit status or a tracking number.
     * Convenience field for the M4 mode-selector badge count.
     */
    inTransit: number;
    /**
     * Count of cases assigned to at least one mission.
     * Convenience field for the M2 mode-selector badge count.
     */
    missionAssigned: number;
  };
}

// ─── Pure assembler functions (no DB calls) ───────────────────────────────────

/**
 * M1 — Fleet Overview
 * All cases with status/position pins.
 *
 * @param latestCustodyByCase  Optional O(1) lookup map of custody snapshots
 *   keyed by case _id string.  When provided (by getM1MapData which loads
 *   custodyRecords), each pin receives custody state fields.  When omitted
 *   (legacy internalQuery callers) the pins are returned without custody state
 *   — backward-compatible because the fields are all optional on M1CasePin.
 */
export function assembleM1(
  allCases: Doc<"cases">[],
  bounds: MapBounds | null,
  filters: ParsedFilters,
  latestCustodyByCase?: Map<string, CustodySnapshot>
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

  const pins: M1CasePin[] = inBounds.map((c) => {
    // O(1) custody lookup — undefined when no custody map was provided or
    // when the case has no custody record.
    const custody = latestCustodyByCase?.get(c._id.toString());
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
      // Custody state — populated when latestCustodyByCase is provided.
      // Falls back to cases.assigneeId/assigneeName when no custody record exists.
      currentCustodianId:   custody?.toUserId   ?? c.assigneeId,
      currentCustodianName: custody?.toUserName ?? c.assigneeName,
      custodyTransferredAt: custody?.transferredAt,
    };
  });

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
 *
 * @param latestCustodyByCase  Optional O(1) lookup map of custody snapshots.
 *   When provided, each case in mission groups and unassigned receives
 *   custody state fields.  Backward-compatible when omitted.
 */
export function assembleM2(
  allCases: Doc<"cases">[],
  allMissions: Doc<"missions">[],
  bounds: MapBounds | null,
  filters: ParsedFilters,
  latestCustodyByCase?: Map<string, CustodySnapshot>
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
      cases: missionCases.map((c) => {
        const custody = latestCustodyByCase?.get(c._id.toString());
        return {
          _id: c._id.toString(),
          label: c.label,
          status: c.status,
          lat: c.lat,
          lng: c.lng,
          assigneeName: c.assigneeName,
          updatedAt: c.updatedAt,
          currentCustodianId:   custody?.toUserId   ?? c.assigneeId,
          currentCustodianName: custody?.toUserName ?? c.assigneeName,
          custodyTransferredAt: custody?.transferredAt,
        };
      }),
    });
  }

  const unassignedInBounds = unassignedCases
    .filter((c) => withinBounds(c.lat, c.lng, bounds))
    .map((c) => {
      const custody = latestCustodyByCase?.get(c._id.toString());
      return {
        _id: c._id.toString(),
        label: c.label,
        status: c.status,
        lat: c.lat,
        lng: c.lng,
        assigneeName: c.assigneeName,
        updatedAt: c.updatedAt,
        currentCustodianId:   custody?.toUserId   ?? c.assigneeId,
        currentCustodianName: custody?.toUserName ?? c.assigneeName,
        custodyTransferredAt: custody?.transferredAt,
      };
    });

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
 *
 * @param latestCustodyByCase  Optional O(1) lookup map of custody snapshots.
 *   When provided, each M3CasePin receives custody state fields so the field
 *   mode tooltip can show "Held by <name>".  Backward-compatible when omitted.
 */
export function assembleM3(
  allCases: Doc<"cases">[],
  latestInspectionByCase: Map<string, Doc<"inspections">>,
  bounds: MapBounds | null,
  filters: ParsedFilters,
  latestCustodyByCase?: Map<string, CustodySnapshot>
): M3Response {
  // Filter to field-relevant statuses
  // "deployed" = at site, actively in use (includes what was "in_field")
  // "flagged"  = has outstanding issues, still on-site
  let fieldCases = allCases.filter(
    (c) => c.status === "deployed" || c.status === "flagged"
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

    // O(1) custody lookup — undefined when latestCustodyByCase not provided
    const custody = latestCustodyByCase?.get(c._id.toString());

    return {
      _id: c._id.toString(),
      label: c.label,
      // TypeScript does not narrow c.status through .filter(), but the preceding
      // fieldCases filter guarantees only "deployed" | "flagged" reach this point.
      status: c.status as "deployed" | "flagged",
      lat: c.lat,
      lng: c.lng,
      locationName: c.locationName,
      assigneeName: c.assigneeName,
      missionId: c.missionId?.toString(),
      updatedAt: c.updatedAt,
      inspectionId: inspection?._id.toString(),
      inspectionStatus: inspection?.status as InspectionStatusLiteral | undefined,
      inspectorName: inspection?.inspectorName,
      checkedItems,
      totalItems,
      damagedItems: inspection?.damagedItems ?? 0,
      missingItems: inspection?.missingItems ?? 0,
      inspectionProgress: progress,
      // Custody state — populated when latestCustodyByCase is provided
      currentCustodianId:   custody?.toUserId   ?? c.assigneeId,
      currentCustodianName: custody?.toUserName ?? c.assigneeName,
      custodyTransferredAt: custody?.transferredAt,
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
    deployed:    1.0,   // actively in use at site — highest signal
    flagged:     0.9,   // issues on-site — high signal
    transit_out: 0.5,   // in transit outbound
    transit_in:  0.5,   // in transit inbound
    assembled:   0.3,   // ready to deploy
    hangar:      0.1,   // stored, not active
    received:    0.1,   // returned to base
    archived:    0.0,   // decommissioned — no signal
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
    ts:          now,
    hangar:      byStatus["hangar"]      ?? 0,
    assembled:   byStatus["assembled"]   ?? 0,
    transit_out: byStatus["transit_out"] ?? 0,
    deployed:    byStatus["deployed"]    ?? 0,
    flagged:     byStatus["flagged"]     ?? 0,
    transit_in:  byStatus["transit_in"]  ?? 0,
    received:    byStatus["received"]    ?? 0,
    archived:    byStatus["archived"]    ?? 0,
    total:       allCases.length,
  };

  const activeRegions = clusters.filter((c) =>
    Object.keys(c.byStatus).some((s) => ["deployed", "flagged"].includes(s))
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

// ─── Unified payload assembler (Sub-AC 2) ─────────────────────────────────────

/**
 * assembleCasesMapPayload — pure assembler for the unified denormalized map payload.
 *
 * Converts pre-loaded Convex document arrays and in-memory lookup maps into the
 * `CasesMapPayloadResponse` shape consumed by `getCasesMapPayload`.
 *
 * Design pattern:
 *   Follows the same pure-assembler approach as assembleM1–assembleM5.
 *   No database calls — all inputs are pre-fetched by the calling query handler
 *   using a single `Promise.all`.
 *
 * N+1 elimination:
 *   `latestInspectionByCase` and `latestCustodyByCase` are O(1) lookup maps
 *   keyed by case _id string.  Per-case enrichment uses Map.get() — no N+1 DB
 *   queries.  Both maps must be built from a full-table scan of the respective
 *   tables (done once, in the caller) before calling this function.
 *
 * @param allCases           — full cases table scan (ordered desc by updatedAt)
 * @param latestInspectionByCase — O(1) lookup: caseId → latest inspections row
 * @param latestCustodyByCase   — O(1) lookup: caseId → latest custodyRecords row
 * @param filters            — optional status/assigneeId/missionId filter
 * @param bounds             — optional viewport bounding box filter
 * @returns                  — CasesMapPayloadResponse ready for client consumption
 */
export function assembleCasesMapPayload(
  allCases: Doc<"cases">[],
  latestInspectionByCase: Map<string, Doc<"inspections">>,
  latestCustodyByCase: Map<string, CustodySnapshot>,
  filters: ParsedFilters = {},
  bounds: MapBounds | null = null,
): CasesMapPayloadResponse {
  // ── Build global summary over ALL cases (before any filter) ────────────────
  //
  // Summary counts reflect the full fleet so the INVENTORY dashboard status
  // legend and mode-selector badges show accurate totals regardless of the
  // active viewport bounds or status filter.

  const byStatus: Partial<Record<CaseStatusLiteral, number>> = {};
  let withLocation = 0;
  let fieldActive = 0;
  let inTransit = 0;
  let missionAssigned = 0;

  for (const c of allCases) {
    byStatus[c.status] = ((byStatus[c.status] ?? 0) as number) + 1;
    if (c.lat !== undefined && c.lng !== undefined) withLocation++;
    if (c.status === "deployed" || c.status === "flagged") fieldActive++;
    if (
      c.status === "transit_out" ||
      c.status === "transit_in" ||
      c.trackingNumber !== undefined
    ) {
      inTransit++;
    }
    if (c.missionId !== undefined) missionAssigned++;
  }

  // ── Apply optional filters ──────────────────────────────────────────────────

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

  // Apply viewport bounds filter when bounds are provided
  if (bounds) {
    filtered = filtered.filter((c) => withinBounds(c.lat, c.lng, bounds));
  }

  // ── Build denormalized case payloads ────────────────────────────────────────

  const cases: CaseMapPayload[] = filtered.map((c) => {
    const id = c._id.toString();
    const inspection = latestInspectionByCase.get(id);
    const custody = latestCustodyByCase.get(id);

    // ── Compute mode flags (O(1) per case) ──────────────────────────────────
    const caseIsInTransit =
      c.status === "transit_out" ||
      c.status === "transit_in" ||
      c.trackingNumber !== undefined;

    const modeFlags: CaseModeFlags = {
      // M1: all cases are always fleet-visible
      isFleetVisible:    true,
      // M2: case participates in a named mission group
      isMissionAssigned: c.missionId !== undefined,
      // M3: case is actively deployed or flagged at a field site
      isFieldActive:     c.status === "deployed" || c.status === "flagged",
      // M4: case is in transit (status or tracking number present)
      isInTransit:       caseIsInTransit,
      // M5: case can contribute a heatmap point (has GPS fix)
      hasCoordinates:    c.lat !== undefined && c.lng !== undefined,
    };

    // ── Denormalize latest inspection summary ────────────────────────────────
    let inspectionSummary: CaseInspectionSummary | undefined;
    if (inspection) {
      const totalItems   = inspection.totalItems   ?? 0;
      const checkedItems = inspection.checkedItems ?? 0;
      inspectionSummary = {
        inspectionId:  inspection._id.toString(),
        status:        inspection.status as InspectionStatusLiteral,
        inspectorName: inspection.inspectorName,
        checkedItems,
        totalItems,
        damagedItems:  inspection.damagedItems ?? 0,
        missingItems:  inspection.missingItems  ?? 0,
        progress:
          totalItems > 0
            ? Math.round((checkedItems / totalItems) * 100)
            : 0,
      };
    }

    return {
      // Identity
      id,
      label:   c.label,
      qrCode:  c.qrCode,

      // Status
      status: c.status,

      // Coordinates
      lat:          c.lat,
      lng:          c.lng,
      locationName: c.locationName,

      // Mode flags
      modeFlags,

      // Assignment
      assigneeId:   c.assigneeId,
      assigneeName: c.assigneeName,
      missionId:    c.missionId?.toString(),

      // Custody state — resolved from latest custody record.
      // Falls back to cases.assigneeId/assigneeName when no handoff exists.
      currentCustodianId:   custody?.toUserId   ?? c.assigneeId,
      currentCustodianName: custody?.toUserName ?? c.assigneeName,
      custodyTransferredAt: custody?.transferredAt,

      // Inspection data (undefined when no inspection exists)
      inspection: inspectionSummary,

      // Shipping / tracking — already denormalized on the cases table
      trackingNumber:  c.trackingNumber,
      carrier:         c.carrier,
      shippedAt:       c.shippedAt,
      destinationName: c.destinationName,
      destinationLat:  c.destinationLat,
      destinationLng:  c.destinationLng,

      // Timestamps
      updatedAt: c.updatedAt,
      createdAt: c.createdAt,
    };
  });

  return {
    ts: Date.now(),
    cases,
    summary: {
      total: allCases.length,
      withLocation,
      byStatus,
      fieldActive,
      inTransit,
      missionAssigned,
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
