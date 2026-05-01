/**
 * src/hooks/use-cases-map-payload.ts
 *
 * useCasesMapPayload — React hook for the unified INVENTORY map payload query.
 *
 * Wraps `api.mapData.getCasesMapPayload` (Sub-AC 2) which aggregates all five
 * map modes' (M1–M5) case data into a single Convex subscription.  The hook
 * returns pre-joined, denormalized `CaseMapPayload` entries ready for map layer
 * rendering without any further data fetching.
 *
 * When to use this hook vs useCaseMapData
 * ─────────────────────────────────────────
 * • `useCasesMapPayload` — use when you need to switch between M1–M5 without
 *   re-subscribing (e.g. the map mode toggle in the INVENTORY header).  A single
 *   subscription covers all modes; the client filters by `modeFlags` client-side.
 *
 * • `useCaseMapData` (per-mode queries) — use when you only ever need one specific
 *   map mode and want to minimise the data volume transferred per subscription.
 *
 * Real-time fidelity
 * ──────────────────
 * Convex re-evaluates this subscription within ~100–300 ms of any SCAN app
 * mutation that writes to `cases`, `inspections`, or `custodyRecords`, satisfying
 * the ≤ 2-second real-time fidelity requirement.
 *
 * Performance
 * ───────────
 * The backend query (`getCasesMapPayload`) issues all DB reads in a single
 * `Promise.all`, builds O(1) in-memory lookup maps to eliminate N+1 joins,
 * and uses the `by_updated` index on the `cases` table.  Total backend latency
 * is bounded by max(cases, inspections, custodyRecords) read times.
 *
 * @example
 * // Subscribe to all fleet cases for the fleet overview (M1)
 * const { data, isLoading } = useCasesMapPayload({});
 * const fleetCases = data?.cases.filter(c => c.modeFlags.isFleetVisible) ?? [];
 *
 * @example
 * // Subscribe with status filter (only deployed + flagged)
 * const { data, isLoading } = useCasesMapPayload({
 *   status: ["deployed", "flagged"],
 * });
 *
 * @example
 * // Subscribe within a viewport bounding box
 * const { data, isLoading } = useCasesMapPayload({
 *   bounds: { swLat: 40, swLng: -80, neLat: 50, neLng: -70 },
 * });
 *
 * @example
 * // Defer until map is ready
 * const { data, isLoading } = useCasesMapPayload({ skip: !mapReady });
 *
 * @example
 * // Client-side mode filtering (no re-subscribe needed on mode change)
 * const { data } = useCasesMapPayload({});
 * const fieldCases  = data?.cases.filter(c => c.modeFlags.isFieldActive);
 * const transitCases = data?.cases.filter(c => c.modeFlags.isInTransit);
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type {
  CasesMapPayloadResponse,
  CaseMapPayload,
} from "../../convex/maps";

// ─── Public types ─────────────────────────────────────────────────────────────

/** Valid case lifecycle status values (mirrors schema caseStatus validator). */
export type CaseStatusFilter =
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
 * Geographic bounding box for spatial filtering.
 * All four coordinates must be provided together.
 */
export interface PayloadBounds {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

/** Arguments for useCasesMapPayload. */
export interface UseCasesMapPayloadArgs {
  /**
   * Filter by one or more case lifecycle statuses.
   * Applied server-side before the payload is sent.
   * Omit to include all statuses.
   */
  status?: CaseStatusFilter[];

  /**
   * Filter to cases assigned to a specific technician (Kinde user ID).
   * Omit or pass null/undefined for all assignees.
   */
  assigneeId?: string | null;

  /**
   * Filter to cases on a specific mission (Convex mission document ID as string).
   * Omit or pass null/undefined for all missions.
   */
  missionId?: string | null;

  /**
   * Geographic viewport bounding box.
   * When provided, only cases within this box are returned in `data.cases`.
   * Summary counts in `data.summary` cover the full fleet regardless of bounds.
   * Pass null or omit for a global (unbounded) view.
   */
  bounds?: PayloadBounds | null;

  /**
   * When true, the Convex subscription is suspended and the hook returns
   * `{ data: undefined, isLoading: false }` immediately.
   * Use to defer the subscription until prerequisites are met (e.g. auth ready).
   * @default false
   */
  skip?: boolean;
}

/** Return value of useCasesMapPayload. */
export interface UseCasesMapPayloadResult {
  /**
   * The full unified map payload from `getCasesMapPayload`.
   * `undefined` while the initial Convex fetch is in flight or when `skip` is true.
   * Once defined, stays defined and updates reactively on every SCAN mutation.
   */
  data: CasesMapPayloadResponse | undefined;

  /**
   * true while the initial Convex fetch is in flight.
   * Becomes false once data (even an empty payload) is available.
   * Always false when `skip` is true.
   */
  isLoading: boolean;

  /**
   * Convenience accessor: cases array from `data.cases`.
   * Empty array while loading, when `skip` is true, or when the fleet is empty.
   */
  cases: CaseMapPayload[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to the unified denormalized INVENTORY map payload.
 *
 * Returns all case data pre-joined with inspection progress and custody state,
 * covering all five map modes (M1–M5) in a single Convex subscription.
 *
 * Filter by `modeFlags` client-side for O(1) mode switching:
 *   - M1 Fleet: all cases (`c.modeFlags.isFleetVisible === true` for every case)
 *   - M2 Mission: `c.modeFlags.isMissionAssigned`
 *   - M3 Field:   `c.modeFlags.isFieldActive`
 *   - M4 Transit: `c.modeFlags.isInTransit`
 *   - M5 Heatmap: `c.modeFlags.hasCoordinates`
 *
 * @param args - Optional filter, bounds, and skip arguments.
 * @returns `{ data, isLoading, cases }`.
 */
export function useCasesMapPayload(
  args: UseCasesMapPayloadArgs = {}
): UseCasesMapPayloadResult {
  const {
    status,
    assigneeId,
    missionId,
    bounds,
    skip = false,
  } = args;

  // ── Build flat bounds args (Convex validators expect individual number fields)
  const boundsFields = bounds
    ? {
        swLat: bounds.swLat,
        swLng: bounds.swLng,
        neLat: bounds.neLat,
        neLng: bounds.neLng,
      }
    : {};

  // ── Subscribe to the unified payload query ─────────────────────────────────
  //
  // When `skip` is true, pass "skip" to suppress the subscription entirely.
  // This prevents unnecessary Convex connections before auth or map viewport
  // are ready.  Convex's "skip" sentinel is the canonical way to conditionally
  // disable a useQuery subscription without violating rules-of-hooks.
  const result = useQuery(
    api.mapData.getCasesMapPayload,
    skip
      ? "skip"
      : {
          ...boundsFields,
          ...(status?.length   ? { status }    : {}),
          ...(assigneeId       ? { assigneeId } : {}),
          ...(missionId        ? { missionId }  : {}),
        }
  );

  // ── Derive and return ──────────────────────────────────────────────────────

  if (skip) {
    return { data: undefined, isLoading: false, cases: [] };
  }

  const isLoading = result === undefined;

  return {
    data:     result,
    isLoading,
    cases:    result?.cases ?? [],
  };
}
