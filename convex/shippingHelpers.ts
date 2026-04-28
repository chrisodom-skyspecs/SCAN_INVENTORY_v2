/**
 * convex/shippingHelpers.ts
 *
 * Pure, Convex-runtime-free helper functions for the shipments module.
 *
 * These functions are extracted from convex/shipping.ts so they can be
 * imported and unit-tested without a live Convex environment.  The Convex
 * query functions in shipping.ts import from this module; unit tests also
 * import directly from here.
 *
 * No imports from convex/server, convex/values, or _generated/* — this file
 * must remain safe to import in any JavaScript environment (Node test env,
 * browser, or Convex runtime).
 *
 * Exported symbols:
 *   Types:
 *     ShipmentStatus         — union of all valid shipment tracking statuses
 *     ShipmentRecord         — normalised client-safe projection of a shipments row
 *     ShipmentSummary        — per-case aggregate summary of tracking activity
 *     RawShipmentRow         — raw DB row shape (Convex IDs not yet toString'd)
 *
 *   Constants:
 *     SHIPMENT_STATUSES      — ordered array of all valid ShipmentStatus values
 *     ACTIVE_STATUSES        — statuses that indicate an in-progress shipment
 *     TERMINAL_STATUSES      — statuses that indicate a final shipment state
 *
 *   Pure functions:
 *     projectShipment        — RawShipmentRow → ShipmentRecord
 *     isActiveShipment       — true when status is NOT a terminal status
 *     isTerminalStatus       — true for "delivered" | "exception"
 *     sortShipmentsDescending — most-recently-created first (createdAt desc)
 *     sortShipmentsAscending  — oldest first (createdAt asc)
 *     pickLatestShipment     — O(n) max createdAt selection
 *     filterByStatus         — keep only shipments matching a given status
 *     filterActiveShipments  — keep only non-terminal shipments
 *     computeShipmentSummary — aggregate counts/fields for a case's shipments
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * All valid tracking statuses for a shipment record.
 * Mirrors the `shipmentStatus` union in convex/schema.ts.
 */
export type ShipmentStatus =
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";

/**
 * A normalised projection of a single shipment record.
 * All Convex ID fields are coerced to plain strings so this type is safe to
 * return from queries, serialize across the network, and use in client components
 * without pulling in Convex runtime types.
 */
export interface ShipmentRecord {
  /** Convex document ID of the shipment row. */
  _id: string;
  /** Convex creation timestamp (epoch ms). */
  _creationTime: number;
  /** Convex document ID of the parent case. */
  caseId: string;
  /** FedEx tracking number. */
  trackingNumber: string;
  /** Carrier name — always "FedEx" currently. */
  carrier: string;
  /** Current tracking status. */
  status: ShipmentStatus;

  // ── Route geometry ────────────────────────────────────────────────────────
  /** Latitude of the ship-from location. */
  originLat?: number;
  /** Longitude of the ship-from location. */
  originLng?: number;
  /** Human-readable name of the ship-from location. */
  originName?: string;
  /** Latitude of the ship-to location. */
  destinationLat?: number;
  /** Longitude of the ship-to location. */
  destinationLng?: number;
  /** Human-readable name of the ship-to location. */
  destinationName?: string;

  // ── Live position (from tracking refreshes) ───────────────────────────────
  /** Last known latitude from FedEx tracking events. */
  currentLat?: number;
  /** Last known longitude from FedEx tracking events. */
  currentLng?: number;

  // ── Timestamps ────────────────────────────────────────────────────────────
  /** ISO date string for the FedEx estimated delivery date. */
  estimatedDelivery?: string;
  /** Epoch ms when the shipment was recorded by the SCAN app operator. */
  shippedAt?: number;
  /** Epoch ms when FedEx confirmed delivery. Populated by updateShipmentStatus. */
  deliveredAt?: number;
  /** Epoch ms when this row was created. */
  createdAt: number;
  /** Epoch ms when this row was last updated. */
  updatedAt: number;
}

/**
 * Raw DB row shape as returned by Convex database operations.
 * Convex ID fields (_id, caseId) have a toString() method but are NOT plain
 * strings — they must be coerced via projectShipment before returning to clients.
 */
export interface RawShipmentRow {
  _id: { toString(): string };
  _creationTime: number;
  caseId: { toString(): string };
  trackingNumber: string;
  carrier: string;
  status: string;
  originLat?: number;
  originLng?: number;
  originName?: string;
  destinationLat?: number;
  destinationLng?: number;
  destinationName?: string;
  currentLat?: number;
  currentLng?: number;
  estimatedDelivery?: string;
  shippedAt?: number;
  deliveredAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Per-case aggregate summary of shipment activity.
 * Returned by computeShipmentSummary; used by T4 panel headers and
 * M4 logistics map pin tooltip overlays.
 */
export interface ShipmentSummary {
  /** Convex document ID of the case this summary belongs to. */
  caseId: string;
  /** Total number of shipment records for this case (all time). */
  totalShipments: number;
  /**
   * Number of currently active shipments (status not in TERMINAL_STATUSES).
   * Should always be 0 or 1 in normal operation.
   */
  activeCount: number;
  /** Number of delivered shipments for this case. */
  deliveredCount: number;
  /** Number of shipments with "exception" status. */
  exceptionCount: number;
  /**
   * The most recently created shipment for this case, or null when no
   * shipments exist.
   */
  latestShipment: ShipmentRecord | null;
  /**
   * Epoch ms of the most recent shipment's createdAt.
   * null when no shipments exist.
   */
  latestShippedAt: number | null;
  /**
   * Epoch ms of the most recent delivery (deliveredAt on a "delivered" row).
   * null when no delivered shipments exist.
   */
  latestDeliveredAt: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Ordered array of all valid ShipmentStatus values.
 * Ordered from earliest to latest in a typical shipment lifecycle:
 *   label_created → picked_up → in_transit → out_for_delivery → delivered
 *   (exception can occur at any stage)
 */
export const SHIPMENT_STATUSES: ShipmentStatus[] = [
  "label_created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
];

/**
 * Statuses that indicate a shipment is actively in progress.
 * An "active" shipment is one that has not yet reached a terminal state.
 *
 * Used by:
 *   filterActiveShipments — narrow a list to in-progress records
 *   isActiveShipment      — guard for "Refresh Tracking" button visibility
 *   listActiveShipments   — Convex query watching non-terminal rows
 */
export const ACTIVE_STATUSES: ShipmentStatus[] = [
  "label_created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
];

/**
 * Terminal shipment statuses — the shipment will not transition further.
 *
 * "delivered"  — FedEx confirmed delivery; case transitions to "returned".
 * "exception"  — FedEx reported a problem (lost, refused, held, etc.).
 *                The SCAN app operator must manually resolve exception cases.
 *
 * Used by:
 *   isTerminalStatus         — guard before scheduling next tracking refresh
 *   refreshShipmentTracking  — skips polling for delivered rows
 */
export const TERMINAL_STATUSES: ShipmentStatus[] = [
  "delivered",
  "exception",
];

// ─── Pure helper functions ────────────────────────────────────────────────────

/**
 * Project a raw Convex database row to a plain, JSON-serializable ShipmentRecord.
 *
 * Converts Convex ID objects (_id, caseId) to plain strings via .toString().
 * All other fields are passed through as-is.
 *
 * @param row  Raw shipment row from ctx.db.get() or ctx.db.query().collect().
 * @returns    Plain ShipmentRecord safe for network serialization and client use.
 */
export function projectShipment(row: RawShipmentRow): ShipmentRecord {
  return {
    _id:              row._id.toString(),
    _creationTime:    row._creationTime,
    caseId:           row.caseId.toString(),
    trackingNumber:   row.trackingNumber,
    carrier:          row.carrier,
    status:           row.status as ShipmentStatus,
    originLat:        row.originLat,
    originLng:        row.originLng,
    originName:       row.originName,
    destinationLat:   row.destinationLat,
    destinationLng:   row.destinationLng,
    destinationName:  row.destinationName,
    currentLat:       row.currentLat,
    currentLng:       row.currentLng,
    estimatedDelivery: row.estimatedDelivery,
    shippedAt:        row.shippedAt,
    deliveredAt:      row.deliveredAt,
    createdAt:        row.createdAt,
    updatedAt:        row.updatedAt,
  };
}

/**
 * Return true when the given shipment status is a terminal state.
 *
 * Terminal statuses ("delivered" | "exception") indicate that no further
 * FedEx tracking refreshes are needed.  The `refreshShipmentTracking` action
 * uses this to skip polling for rows that are already in a final state.
 *
 * @param status  ShipmentStatus to evaluate.
 * @returns       true if the status is "delivered" or "exception".
 */
export function isTerminalStatus(status: ShipmentStatus | string): boolean {
  return TERMINAL_STATUSES.includes(status as ShipmentStatus);
}

/**
 * Return true when the given shipment is still in progress (not terminal).
 *
 * "Active" means the shipment has not reached "delivered" or "exception".
 * Use this to conditionally render the "Refresh Tracking" button in the T4
 * and SCAN shipping panels — only active shipments should show the button.
 *
 * @param shipment  ShipmentRecord to evaluate.
 * @returns         true when `shipment.status` is in ACTIVE_STATUSES.
 */
export function isActiveShipment(shipment: Pick<ShipmentRecord, "status">): boolean {
  return !isTerminalStatus(shipment.status);
}

/**
 * Sort shipments by createdAt descending — most recently created first.
 *
 * This matches the order returned by Convex's `.order("desc")` on the
 * `by_case` index (which orders by _creationTime desc, approximating createdAt).
 * Use this for display in shipping history panels (T3/T4/T5).
 *
 * Does NOT mutate the input array.
 *
 * @param shipments  Array of ShipmentRecord objects.
 * @returns          New array sorted by createdAt descending.
 */
export function sortShipmentsDescending(shipments: ShipmentRecord[]): ShipmentRecord[] {
  return [...shipments].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Sort shipments by createdAt ascending — oldest first.
 *
 * Use for chronological timeline displays (T5 audit panel).
 *
 * Does NOT mutate the input array.
 *
 * @param shipments  Array of ShipmentRecord objects.
 * @returns          New array sorted by createdAt ascending.
 */
export function sortShipmentsAscending(shipments: ShipmentRecord[]): ShipmentRecord[] {
  return [...shipments].sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Pick the most recently created shipment from an array.
 *
 * Performs an O(n) linear scan rather than sorting — use this when only the
 * single most recent record is needed (e.g., T3 tracking panel header).
 *
 * Returns null for empty arrays.
 *
 * Does NOT mutate the input array.
 *
 * @param shipments  Array of ShipmentRecord objects.
 * @returns          The ShipmentRecord with the highest createdAt, or null.
 */
export function pickLatestShipment(shipments: ShipmentRecord[]): ShipmentRecord | null {
  if (shipments.length === 0) return null;

  let latest = shipments[0];
  for (let i = 1; i < shipments.length; i++) {
    if (shipments[i].createdAt > latest.createdAt) {
      latest = shipments[i];
    }
  }
  return latest;
}

/**
 * Filter a shipments array to only those with a specific status.
 *
 * Mirrors the server-side `.withIndex("by_status", q => q.eq("status", status))`
 * Convex query, but operates on an already-fetched array for client-side
 * filtering and unit testing.
 *
 * Does NOT mutate the input array.
 *
 * @param shipments  Array of ShipmentRecord objects.
 * @param status     The ShipmentStatus to keep.
 * @returns          New array containing only records with the given status.
 */
export function filterByStatus(
  shipments: ShipmentRecord[],
  status: ShipmentStatus
): ShipmentRecord[] {
  return shipments.filter((s) => s.status === status);
}

/**
 * Filter a shipments array to only active (non-terminal) shipments.
 *
 * "Active" = status is in ACTIVE_STATUSES (not "delivered" or "exception").
 * Use for M4 logistics map mode which should only show in-transit cases.
 *
 * Does NOT mutate the input array.
 *
 * @param shipments  Array of ShipmentRecord objects.
 * @returns          New array containing only active shipments.
 */
export function filterActiveShipments(shipments: ShipmentRecord[]): ShipmentRecord[] {
  return shipments.filter((s) => isActiveShipment(s));
}

/**
 * Compute aggregate shipment statistics for a case.
 *
 * Processes the full shipment history for a case to produce display-ready
 * aggregate counts and the most recent shipment record.  Used by the T4 panel
 * header and M4 logistics map pin tooltip.
 *
 * Input records do not need to be pre-sorted.
 *
 * @param caseId    Convex document ID of the parent case.
 * @param shipments All ShipmentRecord objects for this case (any order).
 * @returns         ShipmentSummary aggregate for the case.
 */
export function computeShipmentSummary(
  caseId: string,
  shipments: ShipmentRecord[]
): ShipmentSummary {
  if (shipments.length === 0) {
    return {
      caseId,
      totalShipments:   0,
      activeCount:      0,
      deliveredCount:   0,
      exceptionCount:   0,
      latestShipment:   null,
      latestShippedAt:  null,
      latestDeliveredAt: null,
    };
  }

  let activeCount     = 0;
  let deliveredCount  = 0;
  let exceptionCount  = 0;
  let latestShippedAt: number | null  = null;
  let latestDeliveredAt: number | null = null;

  for (const s of shipments) {
    // Count by terminal/active status
    if (s.status === "delivered") {
      deliveredCount++;
      // Track the most recent delivery time
      if (s.deliveredAt !== undefined) {
        if (latestDeliveredAt === null || s.deliveredAt > latestDeliveredAt) {
          latestDeliveredAt = s.deliveredAt;
        }
      }
    } else if (s.status === "exception") {
      exceptionCount++;
    } else {
      activeCount++;
    }

    // Track the most recent ship time
    if (s.shippedAt !== undefined) {
      if (latestShippedAt === null || s.shippedAt > latestShippedAt) {
        latestShippedAt = s.shippedAt;
      }
    }
  }

  const latestShipment = pickLatestShipment(shipments);

  return {
    caseId,
    totalShipments:   shipments.length,
    activeCount,
    deliveredCount,
    exceptionCount,
    latestShipment,
    latestShippedAt,
    latestDeliveredAt,
  };
}
