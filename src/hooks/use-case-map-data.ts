/**
 * src/hooks/use-case-map-data.ts
 *
 * useCaseMapData — Unified shared hook for INVENTORY dashboard map data.
 *
 * Wraps all five Convex map-mode query subscriptions (M1–M5) and normalises
 * each mode's raw response into a common CaseMapRecord shape with position,
 * status, and custody state — the minimal interface map layer components need
 * to render case pins regardless of which map mode is active.
 *
 * Architecture
 * ────────────
 * React hooks must be called unconditionally in the same order on every
 * render.  This hook always issues all five `useQuery` calls but passes
 * the Convex "skip" sentinel to every mode that is NOT currently active,
 * preventing unnecessary subscriptions while satisfying the rules-of-hooks.
 *
 * Only the active mode's query maintains a live Convex subscription.
 * Switching modes deactivates the old subscription and activates the new one
 * within a single render cycle.
 *
 * Normalisation per mode
 * ──────────────────────
 *   M1 — Fleet Overview   : M1CasePin[]     → CaseMapRecord[] (position + status + custody)
 *   M2 — Mission Mode     : M2MissionGroup[] cases flattened → CaseMapRecord[]
 *   M3 — Field Mode       : M3CasePin[]     → CaseMapRecord[] (+ inspection progress)
 *   M4 — Logistics Mode   : M4ShipmentPin[] → CaseMapRecord[] (currentLat/Lng as position)
 *   M5 — Mission Control  : cluster aggregates → CaseMapRecord[] = [] (aggregate, no individual cases)
 *
 * Real-time fidelity
 * ──────────────────
 * Convex re-evaluates the active subscription within ~100–300 ms of any
 * SCAN app mutation that touches the queried tables, satisfying the ≤ 2-second
 * real-time fidelity requirement between the SCAN app and the INVENTORY dashboard.
 *
 * @example
 * // Fleet overview — all cases with position and custody
 * const { records, isLoading } = useCaseMapData({ mode: "M1" });
 *
 * @example
 * // Field mode — technician's cases in a viewport, with inspection progress
 * const { records } = useCaseMapData({
 *   mode: "M3",
 *   bounds: { swLat: 40, swLng: -74, neLat: 41, neLng: -73 },
 *   assigneeId: kindeUserId,
 *   hasInspection: true,
 * });
 *
 * @example
 * // Logistics mode — active shipments
 * const { records, summary } = useCaseMapData({
 *   mode: "M4",
 *   shipmentStatus: ["in_transit", "out_for_delivery"],
 * });
 *
 * @example
 * // Defer until map viewport is ready
 * const { records } = useCaseMapData({ mode: "M1", skip: !mapReady });
 */

"use client";

import { useRef, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type {
  M1Response,
  M2Response,
  M3Response,
  M4Response,
} from "../../convex/maps";

// ─── p50 Latency Instrumentation ─────────────────────────────────────────────

/**
 * Number of query-latency samples to retain for the rolling p50 computation.
 * Oldest sample is evicted (FIFO) once the buffer reaches this size.
 */
export const QUERY_LATENCY_WINDOW_SIZE = 100;

/**
 * Convex query latency threshold in milliseconds.
 *
 * When a single measurement exceeds this value the hook emits a
 * `console.warn` instead of the normal `console.debug` message.
 */
export const QUERY_LATENCY_THRESHOLD_MS = 200;

/** Rolling buffer of recent query-latency samples (milliseconds). */
const _latencyBuffer: number[] = [];

/**
 * Compute the p50 (median) of a latency sample array.
 *
 * Uses `Math.floor(n / 2)` to select the index, so for even-length arrays
 * the upper-middle element is returned (e.g. `[10,20,30,40]` → `30`).
 * Returns `undefined` for an empty array.
 *
 * @param samples  Latency measurements in milliseconds.
 *
 * @example
 * computeP50([10, 30, 50])          // → 30  (middle of odd-length array)
 * computeP50([10, 20, 30, 40])      // → 30  (upper-middle, floor(4/2)=2)
 * computeP50([])                     // → undefined
 */
export function computeP50(samples: readonly number[]): number | undefined {
  if (samples.length === 0) return undefined;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Read the current contents of the rolling latency buffer.
 *
 * @internal Exposed for unit tests only — do not rely on in production code.
 *           Call `_clearLatencyBuffer()` between test cases to prevent
 *           cross-test contamination.
 */
export function _getLatencyBuffer(): readonly number[] {
  return _latencyBuffer;
}

/**
 * Empty the rolling latency buffer.
 *
 * @internal Exposed for unit tests only.  Call in `beforeEach` / `afterEach`
 *           to isolate test cases from each other.
 */
export function _clearLatencyBuffer(): void {
  _latencyBuffer.length = 0;
}

/**
 * Push a new latency sample into the rolling buffer and emit a structured
 * log message.
 *
 * Emits `console.warn` when `durationMs > QUERY_LATENCY_THRESHOLD_MS`,
 * `console.debug` otherwise.
 *
 * Log format:
 *   [useCaseMapData] <MODE> query latency: <ms>ms (p50=<p50>ms, n=<count>)
 *   [useCaseMapData] <MODE> query latency: <ms>ms (p50=<p50>ms, n=<count>) — exceeds 200ms threshold
 */
function _logQueryLatency(mode: MapMode, durationMs: number): void {
  // Maintain the rolling window (evict oldest when full)
  _latencyBuffer.push(durationMs);
  if (_latencyBuffer.length > QUERY_LATENCY_WINDOW_SIZE) {
    _latencyBuffer.shift();
  }

  const p50 = computeP50(_latencyBuffer);
  const p50Str = p50 !== undefined ? `${p50}ms` : "n/a";
  const base =
    `[useCaseMapData] ${mode} query latency: ${durationMs}ms` +
    ` (p50=${p50Str}, n=${_latencyBuffer.length})`;

  if (durationMs > QUERY_LATENCY_THRESHOLD_MS) {
    console.warn(`${base} — exceeds ${QUERY_LATENCY_THRESHOLD_MS}ms threshold`);
  } else {
    console.debug(base);
  }
}

// ─── Public types ─────────────────────────────────────────────────────────────

/** Case lifecycle statuses.  Mirrors the schema's caseStatus union. */
export type CaseStatus =
  | "hangar"
  | "assembled"
  | "transit_out"
  | "deployed"
  | "flagged"
  | "transit_in"
  | "received"
  | "archived";

/** Supported map modes. */
export type MapMode = "M1" | "M2" | "M3" | "M4" | "M5";

/**
 * Normalised case record — the common shape for map layer consumption.
 *
 * All map modes (M1–M4) normalise their raw Convex response into this shape.
 * Mode-specific enrichment fields (inspection data for M3, shipment data for
 * M4) are present and typed when they apply; undefined otherwise.  Map
 * components can use this single type regardless of the active mode.
 */
export interface CaseMapRecord {
  // ── Core identity ──────────────────────────────────────────────────────────

  /**
   * Convex document ID of the case (string form).
   * For M4, this is the `caseId` field on the shipment document (not the
   * shipment's own _id).
   */
  caseId: string;

  /** Human-readable case label (e.g. "CASE-0042"). */
  label: string;

  /**
   * Status string.
   *   M1/M2/M3 — case lifecycle status (one of CaseStatus).
   *   M4       — shipment tracking status (e.g. "in_transit").
   * Typed as `string` to accommodate both unions without a discriminated union.
   */
  status: string;

  // ── Position ───────────────────────────────────────────────────────────────

  /**
   * WGS-84 latitude of the case.
   *   M1/M2/M3 — directly from `cases.lat`; `undefined` when not recorded.
   *   M4       — live shipment `currentLat`; falls back to `destination.lat`.
   */
  lat: number | undefined;

  /** WGS-84 longitude.  Same semantics as `lat`. */
  lng: number | undefined;

  /** Human-readable location name (warehouse, site, city, etc.). */
  locationName?: string;

  /** Display name of the assigned technician / pilot. */
  assigneeName?: string;

  /** Convex document ID of the associated mission, if any. */
  missionId?: string;

  /** Epoch ms timestamp of the last update to this record. */
  updatedAt: number;

  // ── Custody state ──────────────────────────────────────────────────────────

  /**
   * Kinde user ID of the current physical custodian.
   * Populated for M1, M2, M3 when custody records exist.
   * Falls back to `cases.assigneeId` when no transfer has been recorded.
   * Not populated for M4 (shipments do not carry custody state).
   */
  currentCustodianId?: string;

  /** Display name of the current physical custodian. */
  currentCustodianName?: string;

  /** Epoch ms of the most recent custody transfer.  Undefined if no handoff. */
  custodyTransferredAt?: number;

  // ── Inspection data (M3 field mode only) ──────────────────────────────────

  /** Convex document ID of the active inspection (M3 only). */
  inspectionId?: string;

  /** Inspection lifecycle status: "in_progress" | "completed" | "flagged" (M3 only). */
  inspectionStatus?: string;

  /** Display name of the inspector (M3 only). */
  inspectorName?: string;

  /** Number of checked packing-list items (M3 only). */
  checkedItems?: number;

  /** Total number of packing-list items (M3 only). */
  totalItems?: number;

  /** Number of damaged items found (M3 only). */
  damagedItems?: number;

  /** Number of missing items found (M3 only). */
  missingItems?: number;

  /** Inspection completion percentage 0–100 (M3 only). */
  inspectionProgress?: number;

  // ── Shipment data (M4 logistics mode only) ────────────────────────────────

  /** Convex document ID of the active shipment (M4 only). */
  shipmentId?: string;

  /** FedEx (or other carrier) tracking number (M4 only). */
  trackingNumber?: string;

  /** Carrier name, e.g. "fedex" (M4 only). */
  carrier?: string;

  /** Shipment origin location (M4 only). */
  origin?: { lat?: number; lng?: number; name?: string };

  /** Shipment destination location (M4 only). */
  destination?: { lat?: number; lng?: number; name?: string };

  /** Estimated delivery date string from the carrier (M4 only). */
  estimatedDelivery?: string;

  /** Epoch ms when the case was handed to the carrier (M4 only). */
  shippedAt?: number;
}

/**
 * Fleet-wide summary counts returned alongside the records array.
 * Summary counts always cover the full fleet, not just the viewport subset.
 */
export interface CaseMapSummary {
  /**
   * Total count.
   *   M1/M3 — total cases (all statuses, unfiltered by bounds).
   *   M2    — total cases across all missions and unassigned.
   *   M4    — total shipments.
   *   M5    — total cases (from M5Response.summary.totalCases).
   */
  total: number;

  /**
   * Count keyed by status string.
   *   M1/M2/M3 — case lifecycle statuses.
   *   M4       — shipment tracking statuses.
   *   M5       — case lifecycle statuses (via M5Response.summary.byStatus).
   */
  byStatus: Record<string, number>;

  /**
   * Cases/shipments with a recorded lat/lng position.
   *   M1 — cases with cases.lat defined.
   *   M3 — same.
   *   M4 — shipments with currentLat or destination.lat defined.
   *   M2, M5 — undefined.
   */
  withLocation?: number;

  /**
   * M4 specific: count of shipments in "in_transit" or "out_for_delivery".
   * Undefined for all other modes.
   */
  inTransit?: number;
}

/**
 * Geographic bounding box for spatial filtering.
 * All four coordinates must be provided together.
 * Pass null or omit to get a global (unbounded) view.
 */
export interface CaseMapBounds {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

/** Shipment tracking statuses for M4 mode filtering. */
export type ShipmentTrackingStatus =
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";

/** Arguments for useCaseMapData. */
export interface UseCaseMapDataArgs {
  /**
   * Active map mode.
   * Determines which Convex subscription is live; all others are skipped.
   * @default "M1"
   */
  mode?: MapMode;

  /**
   * Geographic viewport bounding box.
   * When provided, only records within this box are returned.
   * Summary counts cover the full fleet regardless of bounds.
   * Pass null or omit for a global (unbounded) view.
   */
  bounds?: CaseMapBounds | null;

  /**
   * Filter by one or more case lifecycle statuses.
   * Applies to M1, M2, M3.  Ignored for M4 (use `shipmentStatus` instead).
   * Omit to show all statuses.
   */
  status?: CaseStatus[];

  /**
   * Filter to cases assigned to a specific technician or pilot (Kinde user ID).
   * Applies to M1 and M3.  Omit or pass null for all assignees.
   */
  assigneeId?: string | null;

  /**
   * Filter to cases on a specific mission (Convex mission document ID).
   * Applies to M1, M2, M3.  Omit or pass null for all missions.
   */
  missionId?: string | null;

  /**
   * M3 only — filter by inspection presence.
   *   true  → only cases with an active inspection
   *   false → only cases not yet inspected
   *   omit  → all field cases
   */
  hasInspection?: boolean;

  /**
   * M3 only — filter to cases with at least one damaged item.
   * Useful for "show flagged cases" overlays on the field map.
   */
  hasDamage?: boolean;

  /**
   * M4 only — filter to specific shipment tracking statuses.
   * Omit to show all active shipments.
   */
  shipmentStatus?: ShipmentTrackingStatus[];

  /**
   * When true, all Convex subscriptions are suspended and the hook returns
   * empty state immediately.
   * Use to defer queries until the map viewport is ready.
   * @default false
   */
  skip?: boolean;
}

/** Return value of useCaseMapData. */
export interface UseCaseMapDataResult {
  /**
   * Normalised case records for map layer rendering.
   * Empty array while loading, when `skip` is true, or when mode is M5.
   */
  records: CaseMapRecord[];

  /**
   * true while the initial Convex fetch for the active mode is in flight.
   * Becomes false once data (even an empty array) is available.
   * Always false when `skip` is true.
   */
  isLoading: boolean;

  /**
   * Fleet-wide summary from the active mode's Convex response.
   * Undefined while loading or when `skip` is true.
   */
  summary: CaseMapSummary | undefined;

  /** The active map mode that produced this result. */
  mode: MapMode;
}

// ─── Normaliser functions (pure — testable without React) ─────────────────────

/**
 * Local type that extends M2's unassigned case shape to include the custody
 * fields that the Convex assembler (assembleM2) always populates at runtime.
 *
 * The generated M2Response.unassigned type omits these optional fields because
 * the TypeScript interface in maps.ts predates the custody-state addition.
 * At runtime the data always has these fields; this intersection makes the
 * normaliser type-safe without `as any` casts.
 */
type M2UnassignedCase = M2Response["unassigned"][number] & {
  currentCustodianId?: string;
  currentCustodianName?: string;
  custodyTransferredAt?: number;
};

/**
 * Normalise M1 Fleet Overview pin array → CaseMapRecord[].
 *
 * Renames `_id` → `caseId` and copies custody state fields from M1CasePin.
 *
 * @param cases - Raw M1CasePin array from an M1Response.
 * @returns Normalised CaseMapRecord array.
 */
export function normaliseM1Records(
  cases: M1Response["cases"]
): CaseMapRecord[] {
  return cases.map((pin) => ({
    caseId:               pin._id,
    label:                pin.label,
    status:               pin.status,
    lat:                  pin.lat,
    lng:                  pin.lng,
    locationName:         pin.locationName,
    assigneeName:         pin.assigneeName,
    missionId:            pin.missionId,
    updatedAt:            pin.updatedAt,
    currentCustodianId:   pin.currentCustodianId,
    currentCustodianName: pin.currentCustodianName,
    custodyTransferredAt: pin.custodyTransferredAt,
  }));
}

/**
 * Normalise M2 Mission Mode response → flat CaseMapRecord[].
 *
 * Cases within mission groups are extracted and annotated with their
 * mission ID.  Unassigned cases are appended with `missionId: undefined`.
 *
 * Custody state is included for mission-group cases (typed in M2MissionGroup)
 * and for unassigned cases via the M2UnassignedCase intersection type.
 *
 * @param data - Full M2Response from the Convex getM2MapData query.
 * @returns Flat CaseMapRecord array (missions flattened first, then unassigned).
 */
export function normaliseM2Records(data: M2Response): CaseMapRecord[] {
  const records: CaseMapRecord[] = [];

  // Extract cases from each mission group
  for (const group of data.missions) {
    for (const c of group.cases) {
      records.push({
        caseId:               c._id,
        label:                c.label,
        status:               c.status,
        lat:                  c.lat,
        lng:                  c.lng,
        assigneeName:         c.assigneeName,
        missionId:            group._id,
        updatedAt:            c.updatedAt,
        currentCustodianId:   c.currentCustodianId,
        currentCustodianName: c.currentCustodianName,
        custodyTransferredAt: c.custodyTransferredAt,
      });
    }
  }

  // Append unassigned cases (no mission affiliation)
  for (const raw of data.unassigned) {
    const c = raw as M2UnassignedCase;
    records.push({
      caseId:               c._id,
      label:                c.label,
      status:               c.status,
      lat:                  c.lat,
      lng:                  c.lng,
      assigneeName:         c.assigneeName,
      missionId:            undefined,
      updatedAt:            c.updatedAt,
      currentCustodianId:   c.currentCustodianId,
      currentCustodianName: c.currentCustodianName,
      custodyTransferredAt: c.custodyTransferredAt,
    });
  }

  return records;
}

/**
 * Normalise M3 Field Mode pin array → CaseMapRecord[].
 *
 * Copies all inspection progress fields and custody state from M3CasePin.
 * Cases without an active inspection have inspection fields as `undefined`.
 *
 * @param cases - Raw M3CasePin array from an M3Response.
 * @returns Normalised CaseMapRecord array with inspection progress data.
 */
export function normaliseM3Records(
  cases: M3Response["cases"]
): CaseMapRecord[] {
  return cases.map((pin) => ({
    caseId:               pin._id,
    label:                pin.label,
    status:               pin.status,
    lat:                  pin.lat,
    lng:                  pin.lng,
    locationName:         pin.locationName,
    assigneeName:         pin.assigneeName,
    missionId:            pin.missionId,
    updatedAt:            pin.updatedAt,
    currentCustodianId:   pin.currentCustodianId,
    currentCustodianName: pin.currentCustodianName,
    custodyTransferredAt: pin.custodyTransferredAt,
    // Inspection data — always present in M3CasePin; 0 defaults match empty state
    inspectionId:       pin.inspectionId,
    inspectionStatus:   pin.inspectionStatus,
    inspectorName:      pin.inspectorName,
    checkedItems:       pin.checkedItems,
    totalItems:         pin.totalItems,
    damagedItems:       pin.damagedItems,
    missingItems:       pin.missingItems,
    inspectionProgress: pin.inspectionProgress,
  }));
}

/**
 * Normalise M4 Logistics Mode shipment pin array → CaseMapRecord[].
 *
 * Uses `currentLat` / `currentLng` (live FedEx tracking position) as the
 * map position, falling back to `destination.lat` / `destination.lng` when
 * live tracking is not yet available.
 *
 * The `caseId` is taken from `M4ShipmentPin.caseId` (the case the shipment
 * belongs to), not the shipment's own `_id` (which is exposed as `shipmentId`).
 *
 * Custody state is not populated for M4 — shipments are carrier-held and do
 * not carry an internal custodian.
 *
 * @param shipments - Raw M4ShipmentPin array from an M4Response.
 * @returns Normalised CaseMapRecord array with shipment data.
 */
export function normaliseM4Records(
  shipments: M4Response["shipments"]
): CaseMapRecord[] {
  return shipments.map((pin) => ({
    caseId:   pin.caseId,
    label:    pin.caseLabel,
    status:   pin.status,
    // Primary position: live tracking.  Fallback: destination coordinates.
    lat:      pin.currentLat ?? pin.destination?.lat,
    lng:      pin.currentLng ?? pin.destination?.lng,
    locationName: pin.destination?.name,
    updatedAt:    pin.updatedAt,
    // Shipment-specific fields
    shipmentId:        pin._id,
    trackingNumber:    pin.trackingNumber,
    carrier:           pin.carrier,
    origin:            pin.origin,
    destination:       pin.destination,
    estimatedDelivery: pin.estimatedDelivery,
    shippedAt:         pin.shippedAt,
  }));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to normalised case map data for the active INVENTORY dashboard mode.
 *
 * Returns a CaseMapRecord[] array ready for map layer rendering, along with
 * loading state and fleet-wide summary counts.
 *
 * All five mode queries (M1–M5) are always called to satisfy React's
 * rules-of-hooks.  Only the active mode maintains a live Convex subscription;
 * the others receive the "skip" sentinel and incur no network cost.
 *
 * @param args - Optional filter and mode arguments.
 * @returns `{ records, isLoading, summary, mode }`.
 */
export function useCaseMapData(
  args: UseCaseMapDataArgs = {}
): UseCaseMapDataResult {
  const {
    mode = "M1",
    bounds,
    status,
    assigneeId,
    missionId,
    hasInspection,
    hasDamage,
    shipmentStatus,
    skip = false,
  } = args;

  // ── Shared bounds — flattened to match Convex validator shape ─────────────
  //
  // Convex query validators accept individual number fields (swLat, swLng,
  // neLat, neLng) rather than a nested bounds object.  Spreading `bounds`
  // directly (or an empty object) produces the expected flat shape.
  const boundsFields = bounds ? bounds : {};

  // ── Determine which mode is active ────────────────────────────────────────
  //
  // Each mode is "active" only when both `mode === "Mn"` and `skip` is false.
  // An active mode's query args are passed normally; inactive modes receive
  // "skip" so their Convex subscriptions are suspended.
  const isM1 = mode === "M1" && !skip;
  const isM2 = mode === "M2" && !skip;
  const isM3 = mode === "M3" && !skip;
  const isM4 = mode === "M4" && !skip;
  const isM5 = mode === "M5" && !skip;

  // ── M1: Fleet Overview — all case pins with status/position/custody ────────
  const m1Result = useQuery(
    api.mapData.getM1MapData,
    isM1
      ? {
          ...boundsFields,
          ...(status?.length   ? { status }     : {}),
          ...(assigneeId       ? { assigneeId } : {}),
          ...(missionId        ? { missionId }  : {}),
        }
      : "skip"
  );

  // ── M2: Mission Mode — cases grouped by mission (flattened on return) ─────
  const m2Result = useQuery(
    api.mapData.getM2MapData,
    isM2
      ? {
          ...boundsFields,
          ...(status?.length ? { status }    : {}),
          ...(missionId      ? { missionId } : {}),
        }
      : "skip"
  );

  // ── M3: Field Mode — deployed/flagged cases with inspection progress ───────
  const m3Result = useQuery(
    api.mapData.getM3MapData,
    isM3
      ? {
          ...boundsFields,
          ...(status?.length                  ? { status }         : {}),
          ...(assigneeId                      ? { assigneeId }     : {}),
          ...(missionId                       ? { missionId }      : {}),
          ...(hasInspection !== undefined     ? { hasInspection }  : {}),
          ...(hasDamage     !== undefined     ? { hasDamage }      : {}),
        }
      : "skip"
  );

  // ── M4: Logistics Mode — shipment pins with tracking positions ────────────
  const m4Result = useQuery(
    api.mapData.getM4MapData,
    isM4
      ? {
          ...boundsFields,
          ...(shipmentStatus?.length ? { status: shipmentStatus } : {}),
        }
      : "skip"
  );

  // ── M5: Mission Control — cluster/heatmap aggregates (FF-gated) ───────────
  const m5Result = useQuery(
    api.mapData.getM5MapData,
    isM5 ? { ...boundsFields } : "skip"
  );

  // ── p50 latency instrumentation ────────────────────────────────────────────
  //
  // Measures the wall-clock elapsed time from when a Convex subscription
  // starts (mode becomes active) to when the query delivers its first result
  // (the undefined → defined transition on the result value).
  //
  // Both hooks must be called unconditionally here (before the skip early-
  // return below) to satisfy React's rules-of-hooks.

  /**
   * Timestamp (via `performance.now()`) at which the current active
   * subscription started.  Set/reset whenever `mode` or `skip` changes;
   * null when `skip` is true (subscription paused).
   */
  const _queryStartRef = useRef<number | null>(null);

  /**
   * Loading state on the previous render — seeded as `true` so that a
   * cache hit on the very first render (data immediately available) is also
   * captured as a valid latency measurement.
   */
  const _wasLoadingRef = useRef<boolean>(true);

  // Record the subscription start time whenever the active mode changes or
  // the skip flag toggles.  Using performance.now() for sub-millisecond
  // precision; falls back to Date.now() in environments without the API.
  useEffect(() => {
    if (skip) {
      _queryStartRef.current = null;
      return;
    }
    _queryStartRef.current =
      typeof performance !== "undefined" ? performance.now() : Date.now();
  }, [mode, skip]);

  // True while the currently-active mode's query has not yet returned its
  // first result.  This is a plain boolean derived from the query results —
  // not a hook call — so it is safe to compute here in the render body.
  const _activeIsLoading =
    (mode === "M1" && m1Result === undefined) ||
    (mode === "M2" && m2Result === undefined) ||
    (mode === "M3" && m3Result === undefined) ||
    (mode === "M4" && m4Result === undefined) ||
    (mode === "M5" && m5Result === undefined);

  // Detect the undefined → defined ("first result received") transition and
  // log the measured latency.  The effect only fires when `_activeIsLoading`
  // changes (or when mode/skip changes), keeping overhead negligible.
  useEffect(() => {
    if (
      !skip &&
      _wasLoadingRef.current &&     // was loading on the previous render
      !_activeIsLoading &&          // now has data
      _queryStartRef.current !== null
    ) {
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const durationMs = Math.round(now - _queryStartRef.current);
      _logQueryLatency(mode, durationMs);
    }
    // Update ref so the next render can detect the next transition.
    _wasLoadingRef.current = _activeIsLoading;
  }, [_activeIsLoading, mode, skip]);

  // ── Skip: return empty state immediately ──────────────────────────────────
  if (skip) {
    return { records: [], isLoading: false, summary: undefined, mode };
  }

  // ── Derive and return based on active mode ────────────────────────────────

  switch (mode) {
    case "M1": {
      const isLoading = m1Result === undefined;
      if (!m1Result) {
        return { records: [], isLoading, summary: undefined, mode };
      }
      return {
        records: normaliseM1Records(m1Result.cases),
        isLoading: false,
        summary: {
          total:        m1Result.summary.total,
          byStatus:     m1Result.summary.byStatus,
          withLocation: m1Result.summary.withLocation,
        },
        mode,
      };
    }

    case "M2": {
      const isLoading = m2Result === undefined;
      if (!m2Result) {
        return { records: [], isLoading, summary: undefined, mode };
      }
      // M2 summary.byMissionStatus is missions-by-status, not cases-by-status.
      // We expose it under byStatus for consistency; consumers can check `mode`
      // to interpret the key space correctly.
      return {
        records: normaliseM2Records(m2Result),
        isLoading: false,
        summary: {
          total:    m2Result.summary.total,
          byStatus: m2Result.summary.byMissionStatus,
        },
        mode,
      };
    }

    case "M3": {
      const isLoading = m3Result === undefined;
      if (!m3Result) {
        return { records: [], isLoading, summary: undefined, mode };
      }
      return {
        records: normaliseM3Records(m3Result.cases),
        isLoading: false,
        summary: {
          total:    m3Result.summary.total,
          byStatus: m3Result.summary.byInspectionStatus,
        },
        mode,
      };
    }

    case "M4": {
      const isLoading = m4Result === undefined;
      if (!m4Result) {
        return { records: [], isLoading, summary: undefined, mode };
      }
      return {
        records: normaliseM4Records(m4Result.shipments),
        isLoading: false,
        summary: {
          total:     m4Result.summary.total,
          byStatus:  m4Result.summary.byStatus,
          inTransit: m4Result.summary.inTransit,
        },
        mode,
      };
    }

    case "M5": {
      // M5 returns cluster/heatmap aggregates — no individual CaseMapRecord
      // items are available.  The hook returns an empty records array while
      // still providing a summary with fleet-wide totals and status breakdown.
      const isLoading = m5Result === undefined;
      return {
        records:  [],
        isLoading,
        summary: m5Result
          ? {
              total:    m5Result.summary.totalCases,
              byStatus: m5Result.summary.byStatus,
            }
          : undefined,
        mode,
      };
    }

    default: {
      // Exhaustive check — TypeScript narrows `mode` to `never` here.
      const _exhaustive: never = mode;
      throw new Error(`[useCaseMapData] Unhandled map mode: ${_exhaustive}`);
    }
  }
}
