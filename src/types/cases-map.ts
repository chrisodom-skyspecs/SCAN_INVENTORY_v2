/**
 * cases-map.ts — public TypeScript types for the GET /api/cases/map endpoint.
 *
 * These types are imported from convex/maps.ts (which contains the actual
 * assembler logic) so that both the Next.js route handler and client-side
 * code can consume them without importing Convex server internals.
 *
 * Map modes:
 *   M1 — Fleet Overview    : all cases on a world/region map
 *   M2 — Mission Mode      : cases grouped by mission site
 *   M3 — Field Mode        : cases in active field inspection with progress
 *   M4 — Logistics Mode    : cases in transit with FedEx shipment data
 *   M5 — Mission Control   : density clusters + heatmap (FF_MAP_MISSION)
 *
 * ─── Schema summary ───────────────────────────────────────────────────────────
 *
 * All mode responses share:
 *   mode  — discriminant string ("M1"–"M5")
 *   ts    — epoch ms server assembly timestamp
 *
 * M1CasePin fields (coordinates, status, assignment, timestamps):
 *   _id, label, status: CaseStatusLiteral,
 *   lat?, lng?, locationName?,
 *   assigneeName?, missionId?,
 *   updatedAt,
 *   currentCustodianId?, currentCustodianName?, custodyTransferredAt?
 *
 * M2MissionGroup fields (mission site grouping):
 *   _id, name, status: MissionStatusLiteral,
 *   lat?, lng?, locationName?, leadName?,
 *   caseCount, byStatus (sparse),
 *   cases: M2MissionCase[]    ← includes custody fields
 *
 * M2UnassignedCase / M3CasePin fields extend M1CasePin with:
 *   M3 adds: inspectionId?, inspectionStatus?, inspectorName?,
 *            checkedItems, totalItems, damagedItems, missingItems,
 *            inspectionProgress (0–100)
 *
 * M4ShipmentPin fields (logistics, FedEx tracking):
 *   _id, caseId, caseLabel, trackingNumber, carrier,
 *   status: ShipmentStatusLiteral,
 *   origin { lat?, lng?, name? }, destination { lat?, lng?, name? },
 *   currentLat?, currentLng?, estimatedDelivery?, shippedAt?, updatedAt
 *
 * M5Cluster fields (density clusters):
 *   lat, lng, count, radius, byStatus (sparse), missionIds
 *
 * M5HeatmapPoint fields:  lat, lng, weight (0–1)
 *
 * M5TimelineSnapshot fields:
 *   ts, hangar, assembled, transit_out, deployed, flagged, transit_in,
 *   received, archived, total
 */

// ─── Import types locally so they are available to the mode type guards ───────
// Using `import type` keeps these as pure type-level imports; they are erased
// at compile time and do not pull Convex server binaries into client bundles.

import type {
  // Shared helpers
  MapBounds,
  ParsedFilters,
  MapQueryArgs,

  // Domain-specific status literal types
  CaseStatusLiteral,
  MissionStatusLiteral,
  InspectionStatusLiteral,
  ShipmentStatusLiteral,

  // Custody state
  CustodySnapshot,

  // Discriminated union of all mode responses (still assembled server-side
  // from Convex types; structurally compatible with the map.ts envelopes)
  MapDataResponse,

  // Unified denormalized payload types (Sub-AC 2)
  CaseModeFlags,
  CaseInspectionSummary,
  CaseMapPayload,
  CasesMapPayloadResponse,
} from "../../convex/maps";

// M1–M5 response shapes are defined in src/types/map.ts (standalone,
// framework-agnostic — using CaseStatus rather than CaseStatusLiteral).
// Imported here for use in the is*Response type-guard functions below.
import type {
  M1CasePin,
  M1Response,
  M2MissionCase,
  M2UnassignedCase,
  M2MissionGroup,
  M2Response,
  // M3–M5 response types (Sub-AC 2): now defined in src/types/map.ts
  M3CasePin,
  M3Response,
  M4ShipmentPin,
  M4Response,
  M5Cluster,
  M5HeatmapPoint,
  M5TimelineSnapshot,
  M5Response,
} from "./map";

// ─── Re-export all types ──────────────────────────────────────────────────────

export type {
  // Shared helpers (Convex-internal; no map.ts equivalent)
  MapBounds,
  ParsedFilters,
  MapQueryArgs,

  // Domain-specific status literal types (Convex-internal; map.ts exposes
  // the framework-agnostic aliases: CaseStatus, MissionStatus,
  // InspectionStatus, ShipmentStatus)
  CaseStatusLiteral,
  MissionStatusLiteral,
  InspectionStatusLiteral,
  ShipmentStatusLiteral,

  // Custody state
  CustodySnapshot,

  // Discriminated union of all mode responses (server-assembled type;
  // structurally compatible with the map.ts per-mode envelopes)
  MapDataResponse,

  // Unified denormalized payload types (Sub-AC 2)
  CaseModeFlags,
  CaseInspectionSummary,
  CaseMapPayload,
  CasesMapPayloadResponse,

  // M1–M5 case/shipment pin shapes and response envelopes are defined in
  // src/types/map.ts and exported from src/types/index.ts via `export * from
  // "./map"`.  Re-exporting them here would create duplicate named exports in
  // the index barrel — so they are intentionally omitted from this list.
  // (Imported above solely for use in the is*Response type-guard functions.)
};

// ─── Request parameter types (Next.js route / fetch client) ──────────────────

/** Valid map mode values for the `mode` query param. */
export type MapMode = "M1" | "M2" | "M3" | "M4" | "M5";

/** All recognised `mode` values as a runtime array for validation. */
export const VALID_MAP_MODES: MapMode[] = ["M1", "M2", "M3", "M4", "M5"];

/**
 * Typed query parameters accepted by GET /api/cases/map.
 *
 * All fields are optional; the handler applies the following defaults:
 *   mode    → "M1"
 *   bounds  → null  (no spatial filter)
 *   filters → {}    (no field filter)
 */
export interface CasesMapRequestParams {
  /**
   * Map mode selector.
   * @default "M1"
   */
  mode?: MapMode;

  /**
   * South-west corner latitude of the viewport bounding box.
   * Must be provided together with swLng, neLat, and neLng, or not at all.
   */
  swLat?: string;

  /**
   * South-west corner longitude of the viewport bounding box.
   */
  swLng?: string;

  /**
   * North-east corner latitude of the viewport bounding box.
   */
  neLat?: string;

  /**
   * North-east corner longitude of the viewport bounding box.
   */
  neLng?: string;

  /**
   * JSON-encoded filter object.
   * Shape: { status?: string[]; assigneeId?: string; missionId?: string;
   *          hasInspection?: boolean; hasDamage?: boolean }
   */
  filters?: string;
}

// ─── Error response type ──────────────────────────────────────────────────────

/**
 * Error envelope returned by the route handler for 4xx / 5xx responses.
 */
export interface CasesMapErrorResponse {
  /** Human-readable error description. */
  error: string;
  /** HTTP status code mirrored in the body for convenience. */
  status: number;
}

// ─── Discriminated success / error response union ────────────────────────────

/**
 * Full response type from GET /api/cases/map — either a mode-specific data
 * payload on 200, or an error envelope on 4xx/5xx.
 */
export type CasesMapApiResponse =
  | { ok: true; status: 200; data: MapDataResponse }
  | { ok: false; status: 400 | 503 | 500; error: string };

// ─── Mode type guards ─────────────────────────────────────────────────────────
// Provide type-safe narrowing from the MapDataResponse discriminated union to
// a specific mode response.  Use these in map components that need access to
// mode-specific fields.
//
// @example
//   const result = await fetchCasesMap({ mode: "M3" });
//   if (result.ok && isM3Response(result.data)) {
//     // TypeScript knows result.data.cases is M3CasePin[]
//   }

/**
 * Narrows a MapDataResponse to M1Response (Fleet Overview).
 *
 * Use when you need access to M1-specific fields:
 *   `data.cases`          — M1CasePin[] (all cases with lat/lng/status/custody)
 *   `data.summary.withLocation` — count of located cases
 */
export function isM1Response(r: MapDataResponse): r is M1Response {
  return r.mode === "M1";
}

/**
 * Narrows a MapDataResponse to M2Response (Mission Mode).
 *
 * Use when you need access to M2-specific fields:
 *   `data.missions`    — M2MissionGroup[] (cases grouped by mission)
 *   `data.unassigned`  — M2UnassignedCase[] (mission-less cases)
 */
export function isM2Response(r: MapDataResponse): r is M2Response {
  return r.mode === "M2";
}

/**
 * Narrows a MapDataResponse to M3Response (Field Mode).
 *
 * Use when you need access to M3-specific fields:
 *   `data.cases`                 — M3CasePin[] (deployed/flagged only)
 *   `data.summary.totalDamaged`  — fleet-wide damaged item count
 *   `data.summary.totalMissing`  — fleet-wide missing item count
 */
export function isM3Response(r: MapDataResponse): r is M3Response {
  return r.mode === "M3";
}

/**
 * Narrows a MapDataResponse to M4Response (Logistics Mode).
 *
 * Use when you need access to M4-specific fields:
 *   `data.shipments`           — M4ShipmentPin[] (active FedEx shipments)
 *   `data.summary.inTransit`   — count of actively moving shipments
 */
export function isM4Response(r: MapDataResponse): r is M4Response {
  return r.mode === "M4";
}

/**
 * Narrows a MapDataResponse to M5Response (Mission Control).
 *
 * Use when you need access to M5-specific fields:
 *   `data.featureEnabled`  — false when FF_MAP_MISSION is disabled
 *   `data.clusters`        — M5Cluster[] (geographic density clusters)
 *   `data.heatmap`         — M5HeatmapPoint[] (Mapbox heatmap source)
 *   `data.timeline`        — replay scrubber data (startTs, endTs, snapshots)
 */
export function isM5Response(r: MapDataResponse): r is M5Response {
  return r.mode === "M5";
}
