/**
 * cases-map.ts — public TypeScript types for the GET /api/cases/map endpoint.
 *
 * These types are re-exported from convex/maps.ts (which contains the actual
 * assembler logic) so that both the Next.js route handler and client-side
 * code can consume them without importing Convex server internals.
 *
 * Map modes:
 *   M1 — Fleet Overview    : all cases on a world/region map
 *   M2 — Mission Mode      : cases grouped by mission site
 *   M3 — Field Mode        : cases in active field inspection with progress
 *   M4 — Logistics Mode    : cases in transit with FedEx shipment data
 *   M5 — Mission Control   : density clusters + heatmap (FF_MAP_MISSION)
 */

// ─── Re-export response types from the Convex layer ─────────────────────────
// Using `export type` so these are pure type-level exports; they are erased at
// compile time and do not pull Convex server binaries into client bundles.

export type {
  // Shared helpers
  MapBounds,
  ParsedFilters,
  MapQueryArgs,

  // Per-mode case / shipment pin shapes
  M1CasePin,
  M2MissionGroup,
  M3CasePin,
  M4ShipmentPin,
  M5Cluster,
  M5HeatmapPoint,
  M5TimelineSnapshot,

  // Per-mode response envelopes
  M1Response,
  M2Response,
  M3Response,
  M4Response,
  M5Response,

  // Discriminated union of all mode responses
  MapDataResponse,
} from "../../convex/maps";

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
  | { ok: true; status: 200; data: import("../../convex/maps").MapDataResponse }
  | { ok: false; status: 400 | 503 | 500; error: string };
