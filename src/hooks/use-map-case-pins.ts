/**
 * src/hooks/use-map-case-pins.ts
 *
 * useMapCasePins — shared hook for case-pin map data.
 *
 * Wraps Convex `useQuery(api.mapData.getM1MapData, …)` with typed filter
 * arguments and normalises the raw M1CasePin response into a flat array of
 * MapCasePin objects ready for map-layer consumption.
 *
 * Normalisation
 * ─────────────
 * M1CasePin uses `_id` (the Convex document ID string) as its primary key.
 * MapCasePin renames this to `caseId` so map components have a stable,
 * semantically named identifier that doesn't leak Convex internals.
 *
 * Real-time fidelity
 * ──────────────────
 * Convex re-evaluates the underlying getM1MapData query within ~100–300 ms
 * whenever any row in the `cases` table is mutated by the SCAN app, satisfying
 * the ≤ 2-second real-time fidelity requirement.
 *
 * Skip semantics
 * ──────────────
 * Passing `skip: true` in args suspends the Convex subscription until the map
 * has initialised.  While skipped, `isLoading` is false and `pins` is [].
 *
 * Return shape
 * ─────────────
 *   pins      — normalised array of MapCasePin objects ([] when loading/skipped)
 *   isLoading — true while the initial Convex fetch is in flight
 *   summary   — fleet-wide summary counts (undefined when loading/skipped)
 *
 * Usage
 * ─────
 * @example
 * // All cases globally
 * const { pins, isLoading } = useMapCasePins();
 *
 * @example
 * // Filtered to viewport + status
 * const { pins, summary } = useMapCasePins({
 *   bounds: { swLat: 40.0, swLng: -74.0, neLat: 41.0, neLng: -73.0 },
 *   status: ["in_field", "deployed"],
 * });
 *
 * @example
 * // Suspend until map is ready
 * const { pins } = useMapCasePins({ skip: !mapReady });
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { M1Response } from "../../convex/maps";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Case lifecycle statuses. Mirrors the schema's caseStatus union.
 *
 * Re-exported from the canonical definition in src/types/case-status.ts
 * for convenience — import CaseStatus from either location.
 */
export type CaseStatus =
  | "hangar"
  | "assembled"
  | "transit_out"
  | "deployed"
  | "flagged"
  | "recalled"
  | "transit_in"
  | "received"
  | "archived";

/**
 * A map-pin-ready case record.
 *
 * Derived from M1CasePin but with:
 *   - `caseId`  instead of `_id` (semantic rename, no Convex internals exposed)
 *   - `lat` / `lng` explicit (undefined when the case has no recorded location)
 *   - `status` typed as CaseStatus (not raw string)
 */
export interface MapCasePin {
  /** Convex document ID of the case (string form). */
  caseId: string;
  /** Human-readable case label (e.g. "CASE-0042"). */
  label: string;
  /** Case lifecycle status. */
  status: CaseStatus;
  /** WGS-84 latitude. `undefined` when the case has no recorded location. */
  lat: number | undefined;
  /** WGS-84 longitude. `undefined` when the case has no recorded location. */
  lng: number | undefined;
  /** Human-readable location name (warehouse, site, city). */
  locationName: string | undefined;
  /** Display name of the assigned technician / pilot. */
  assigneeName: string | undefined;
  /** Convex document ID of the associated mission, if any. */
  missionId: string | undefined;
  /** Epoch ms timestamp of the last update to this case record. */
  updatedAt: number;
}

/**
 * Geographic viewport bounds for spatial filtering.
 * All four coordinates must be provided together.
 */
export interface MapCasePinBounds {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

/**
 * Arguments for useMapCasePins.
 * All fields are optional — omit entirely for a global, unfiltered fleet view.
 */
export interface UseMapCasePinsArgs {
  /**
   * Viewport bounding box.
   * When provided, only cases within this box are returned as pins.
   * The summary counts still reflect the full fleet regardless of bounds.
   */
  bounds?: MapCasePinBounds | null;

  /**
   * Filter by one or more case lifecycle statuses.
   * Omit to show all statuses.
   */
  status?: CaseStatus[];

  /**
   * Filter to cases assigned to a specific technician or pilot (Kinde user ID).
   */
  assigneeId?: string | null;

  /**
   * Filter to cases on a specific mission (Convex mission document ID).
   */
  missionId?: string | null;

  /**
   * When `true`, the Convex subscription is suspended and the hook immediately
   * returns `{ pins: [], isLoading: false, summary: undefined }`.
   *
   * Use this to defer the query until the map viewport is ready.
   * @default false
   */
  skip?: boolean;
}

/**
 * Fleet-wide summary counts returned alongside the pins array.
 * Mirrors M1Response.summary — totals cover ALL cases, not just the
 * viewport-filtered subset returned in `pins`.
 */
export interface MapCasePinSummary {
  /** Total number of cases in the fleet (unfiltered). */
  total: number;
  /** Cases that have a recorded lat/lng position. */
  withLocation: number;
  /** Case count keyed by status string. */
  byStatus: Record<string, number>;
}

/**
 * Return value of useMapCasePins.
 */
export interface UseMapCasePinsResult {
  /**
   * Normalised case pins, ready for map rendering.
   * Empty array while loading or when `skip` is true.
   */
  pins: MapCasePin[];

  /**
   * `true` while the initial Convex fetch has not yet returned a result.
   * Becomes `false` once data (even an empty array) is available.
   * Always `false` when `skip` is true.
   */
  isLoading: boolean;

  /**
   * Fleet-wide summary counts.
   * `undefined` while loading or when `skip` is true.
   */
  summary: MapCasePinSummary | undefined;
}

// ─── Normaliser (pure function — testable without React) ──────────────────────

/**
 * Normalise a raw M1CasePin array from the Convex query response into the
 * map-pin-ready MapCasePin shape consumed by map layer components.
 *
 * Extracted as a pure function so it can be unit-tested independently of
 * the Convex subscription machinery.
 *
 * @param cases - Raw M1CasePin array from M1Response.cases.
 * @returns Normalised MapCasePin array.
 */
export function normaliseM1Pins(
  cases: M1Response["cases"]
): MapCasePin[] {
  return cases.map((pin) => ({
    caseId:       pin._id,
    label:        pin.label,
    status:       pin.status as CaseStatus,
    lat:          pin.lat,
    lng:          pin.lng,
    locationName: pin.locationName,
    assigneeName: pin.assigneeName,
    missionId:    pin.missionId,
    updatedAt:    pin.updatedAt,
  }));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to real-time case pin data for map rendering.
 *
 * Wraps `useQuery(api.mapData.getM1MapData, …)` with typed filter arguments
 * and normalises the raw M1CasePin array into MapCasePin objects.
 *
 * The Convex subscription is active as long as the component is mounted and
 * `skip` is not `true`.  Any SCAN app mutation that writes to the `cases`
 * table triggers a re-evaluation within ~100–300 ms.
 *
 * @param args - Optional filter and skip arguments.
 * @returns `{ pins, isLoading, summary }`.
 */
export function useMapCasePins(
  args: UseMapCasePinsArgs = {}
): UseMapCasePinsResult {
  const { bounds, status, assigneeId, missionId, skip = false } = args;

  // Build the flat query args object that Convex expects.
  // Convex validators don't accept `undefined` keys for optional fields — we
  // spread only the keys that have values so the serialised args object stays
  // minimal and cache-friendly.
  const queryArgs = {
    ...(bounds       ? bounds                 : {}),
    ...(status?.length ? { status }           : {}),
    ...(assigneeId   ? { assigneeId }         : {}),
    ...(missionId    ? { missionId }          : {}),
  } as {
    swLat?: number;
    swLng?: number;
    neLat?: number;
    neLng?: number;
    status?: CaseStatus[];
    assigneeId?: string;
    missionId?: string;
  };

  // Call useQuery; pass "skip" sentinel when the consumer wants to defer the
  // subscription (e.g. while the map viewport hasn't initialised yet).
  // `useQuery` returns `undefined` while the initial fetch is in flight.
  const result = useQuery(
    api.mapData.getM1MapData,
    skip ? "skip" : queryArgs
  );

  // While skipped, return immediately — no loading, no data.
  if (skip) {
    return { pins: [], isLoading: false, summary: undefined };
  }

  // `result === undefined` means the initial Convex fetch is still in flight.
  const isLoading = result === undefined;

  const pins: MapCasePin[] = result ? normaliseM1Pins(result.cases) : [];

  const summary: MapCasePinSummary | undefined = result
    ? {
        total:        result.summary.total,
        withLocation: result.summary.withLocation,
        byStatus:     result.summary.byStatus,
      }
    : undefined;

  return { pins, isLoading, summary };
}
