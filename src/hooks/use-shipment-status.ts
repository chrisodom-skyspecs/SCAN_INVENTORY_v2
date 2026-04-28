/**
 * use-shipment-status.ts
 *
 * Focused Convex useQuery hooks for shipment status, FedEx tracking state,
 * label URLs, and carrier events. Designed to be imported by any T1-T5 case
 * detail layout component that needs real-time shipment visibility.
 *
 * Hook catalogue
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  useShipmentsByCase(caseId)
 *    Subscribe to all shipments for a case, most-recent-first.
 *    Re-evaluates within ~100–300 ms whenever the SCAN app calls shipCase or
 *    updateShipmentStatus, satisfying the ≤ 2-second real-time fidelity SLA.
 *
 *  useShipmentSummary(caseId)
 *    Subscribe to per-case aggregate stats (total, active, delivered, exception
 *    counts, latestShipment, latestShippedAt, latestDeliveredAt).
 *    Backed by api.shipping.getShipmentSummaryForCase — re-evaluates reactively
 *    whenever any shipments row for the case is created or updated.
 *
 *  useCaseShippingLayout(caseId)
 *    Subscribe to the comprehensive T3 layout data for a case.
 *    Returns both denormalized case-level tracking fields (trackingNumber,
 *    carrier, shippedAt, destinationName) AND the latest full shipment record
 *    — all in a single reactive subscription.
 *    Used by T1 compact badge, T3 shipping context, T4 shipping panel.
 *
 *  useShipmentByTrackingNumber(trackingNumber)
 *    Subscribe to a single shipment record by its FedEx tracking number.
 *    Returns undefined while loading, null when not found.
 *
 *  useShipmentsByStatus(status, limit?)
 *    Subscribe to all shipments with a specific FedEx tracking status.
 *    Used by the M4 logistics map mode to watch "in_transit" or
 *    "out_for_delivery" buckets in real-time.
 *
 *  useActiveShipments(limitPerStatus?)
 *    Subscribe to all non-terminal shipments across all active status buckets
 *    (label_created | picked_up | in_transit | out_for_delivery).
 *    Used by the M4 logistics map mode to maintain a live list of cases
 *    currently in transit.
 *
 *  useLatestShipment(caseId)
 *    Derived hook: returns only the single most-recently-created shipment
 *    for a case (or null). Shorthand for useShipmentsByCase + [0].
 *
 * Pure helpers (non-hook)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  getTrackingUrl(trackingNumber)
 *    Returns the public FedEx package tracking URL for a given tracking number.
 *    Safe to use as an <a href="..."> target.
 *
 *  getLabelPreviewUrl(trackingNumber)
 *    Returns the FedEx label preview URL. Currently the same as the tracking
 *    URL since FedEx does not expose a direct label download without API
 *    credentials — the tracking URL provides carrier-side label access.
 *
 * Re-exported types (from convex/shippingHelpers)
 * ─────────────────────────────────────────────────────────────────────────────
 *  ShipmentStatus, ShipmentRecord, ShipmentSummary
 *  SHIPMENT_STATUSES, ACTIVE_STATUSES, TERMINAL_STATUSES
 *  isTerminalStatus, isActiveShipment
 *
 * Usage examples
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  // T2 Manifest — compact shipping status chip
 *  const { latestShipment } = useLatestShipment(caseId);
 *  if (latestShipment?.trackingNumber) {
 *    return <ShipmentStatusChip shipment={latestShipment} />;
 *  }
 *
 *  // T3 Inspection — shipping context banner
 *  const layout = useCaseShippingLayout(caseId);
 *  if (layout?.trackingNumber) {
 *    return <ShippingContextBanner layout={layout} />;
 *  }
 *
 *  // T4 Shipping — full tracking panel (uses useFedExTracking instead)
 *  // See: hooks/use-fedex-tracking.ts
 *
 *  // M4 logistics map — watch all in-transit cases
 *  const { shipments: inTransit } = useShipmentsByStatus("in_transit");
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

// Re-export types and helpers from shippingHelpers so consumers get everything
// from a single import — no need to reach into convex/ directly.
export type {
  ShipmentStatus,
  ShipmentRecord,
  ShipmentSummary,
  RawShipmentRow,
} from "../../convex/shippingHelpers";

export {
  SHIPMENT_STATUSES,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  isTerminalStatus,
  isActiveShipment,
  sortShipmentsDescending,
  sortShipmentsAscending,
  pickLatestShipment,
  filterByStatus,
  filterActiveShipments,
  computeShipmentSummary,
} from "../../convex/shippingHelpers";

// Re-export CaseShippingLayout type from Convex shipping module
export type { CaseShippingLayout } from "../../convex/shipping";

import type { ShipmentStatus, ShipmentRecord } from "../../convex/shippingHelpers";
import type { CaseShippingLayout } from "../../convex/shipping";

// ─── Pure URL helpers ─────────────────────────────────────────────────────────

/**
 * Returns the public FedEx package tracking URL for a given tracking number.
 *
 * This URL opens the FedEx tracking page in the carrier portal — the safest
 * "label URL" available without FedEx API credentials (FedEx does not expose
 * a direct label image download endpoint to third parties).
 *
 * Safe to use as an `<a href="...">` target with `target="_blank"`.
 *
 * @param trackingNumber  FedEx tracking number (whitespace will be trimmed).
 * @returns               Absolute FedEx tracking URL.
 */
export function getTrackingUrl(trackingNumber: string): string {
  const tn = trackingNumber.trim();
  return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tn)}`;
}

/**
 * Returns a FedEx label / package details URL for a given tracking number.
 *
 * FedEx does not offer a direct label image URL endpoint without API
 * credentials. This function returns the standard tracking URL which
 * provides carrier-side label and package detail access.
 *
 * @param trackingNumber  FedEx tracking number.
 * @returns               FedEx package detail URL (same as tracking URL).
 */
export function getLabelPreviewUrl(trackingNumber: string): string {
  return getTrackingUrl(trackingNumber);
}

// ─── useShipmentsByCase ───────────────────────────────────────────────────────

/**
 * Subscribe to all shipment records for a case, ordered most-recent-first.
 *
 * Convex re-evaluates this query and pushes an update to all connected clients
 * within ~100–300 ms whenever:
 *   • The SCAN app calls `shipCase` (new shipments row inserted)
 *   • `updateShipmentStatus` runs after a FedEx tracking poll (status changed)
 *
 * This satisfies the ≤ 2-second real-time fidelity requirement between a
 * SCAN app action and visibility on the INVENTORY dashboard.
 *
 * @param caseId  Convex document ID of the case to watch.
 * @returns       `undefined` while loading, `ShipmentRecord[]` once data arrives.
 *                Empty array when no shipments exist for this case.
 */
export function useShipmentsByCase(
  caseId: string
): ShipmentRecord[] | undefined {
  return useQuery(
    api.shipping.listShipmentsByCase,
    { caseId }
  ) as ShipmentRecord[] | undefined;
}

// ─── useShipmentSummary ───────────────────────────────────────────────────────

/**
 * Aggregate shipment statistics type returned by useShipmentSummary.
 * Mirrors the server-side CaseShippingLayout + ShipmentSummary merged shape.
 */
export interface UseShipmentSummaryResult {
  /** Convex document ID of the case. */
  caseId: string;
  /** Total number of shipments ever recorded for this case. */
  totalShipments: number;
  /** Currently active (non-terminal) shipments. Should be 0 or 1 in practice. */
  activeCount: number;
  /** Delivered shipments. */
  deliveredCount: number;
  /** Shipments with "exception" status. */
  exceptionCount: number;
  /**
   * Most recently created shipment for this case.
   * null when no shipments exist.
   */
  latestShipment: ShipmentRecord | null;
  /** Epoch ms of the most recent ship event, or null. */
  latestShippedAt: number | null;
  /** Epoch ms of the most recent delivery event, or null. */
  latestDeliveredAt: number | null;
}

/**
 * Subscribe to per-case aggregate shipment statistics.
 *
 * Returns a summary with aggregate counts and the most recently created
 * shipment record. Convex re-evaluates and pushes updates within
 * ~100–300 ms of any shipments row change for this case.
 *
 * Returns undefined while loading, or a UseShipmentSummaryResult once data
 * arrives. The summary always includes a zero-count object (never null) when
 * no shipments exist.
 *
 * Client usage (T4 panel header):
 *   const summary = useShipmentSummary(caseId);
 *   // summary.totalShipments → total count for display
 *   // summary.latestShipment → full row for the tracking header
 *
 * @param caseId  Convex document ID of the case to watch.
 */
export function useShipmentSummary(
  caseId: string
): UseShipmentSummaryResult | undefined {
  return useQuery(
    api.shipping.getShipmentSummaryForCase,
    { caseId }
  ) as UseShipmentSummaryResult | undefined;
}

// ─── useCaseShippingLayout ────────────────────────────────────────────────────

/**
 * Subscribe to the comprehensive T3/T4 shipping layout data for a case.
 *
 * This is the single most data-rich shipment query — it combines:
 *   • Denormalized case-level tracking summary (trackingNumber, carrier,
 *     shippedAt, destinationName, destinationLat/Lng) read from the cases table
 *     in a single O(1) ctx.db.get(caseId) call.
 *   • The full latest shipment record from the shipments table, providing
 *     origin/destination coordinates, currentLat/currentLng (live position),
 *     estimatedDelivery, and shipment status badge.
 *
 * Real-time behavior:
 *   Convex re-evaluates and pushes within ~100–300 ms of:
 *     • SCAN app `shipCase` call (cases table + shipments insert)
 *     • `updateShipmentStatus` tracking poll result (shipments update)
 *   Both table reads are within a single reactive subscription.
 *
 * Use this hook in:
 *   T1Overview  — compact FedEx tracking badge
 *   T3Inspection — shipping context banner (case is in transit)
 *   T4Shipping  — full tracking detail panel
 *
 * @param caseId  Convex document ID of the case to watch.
 * @returns `undefined` while loading, `null` when case not found,
 *          or `CaseShippingLayout` data when loaded.
 */
export function useCaseShippingLayout(
  caseId: string
): CaseShippingLayout | null | undefined {
  return useQuery(
    api.shipping.getCaseShippingLayout,
    { caseId }
  ) as CaseShippingLayout | null | undefined;
}

// ─── useShipmentByTrackingNumber ──────────────────────────────────────────────

/**
 * Subscribe to a single shipment record by FedEx tracking number.
 *
 * Uses the `by_tracking` index for O(log n) lookup. Returns undefined while
 * loading, null when no shipment with that tracking number exists.
 *
 * Convex re-evaluates when any shipments row with this tracking number changes.
 *
 * @param trackingNumber  FedEx tracking number to look up (whitespace-trimmed
 *                        on the server before the index query).
 * @returns `undefined` while loading, `null` if not found, or `ShipmentRecord`.
 */
export function useShipmentByTrackingNumber(
  trackingNumber: string
): ShipmentRecord | null | undefined {
  return useQuery(
    api.shipping.getShipmentByTrackingNumber,
    { trackingNumber }
  ) as ShipmentRecord | null | undefined;
}

// ─── useShipmentsByStatus ─────────────────────────────────────────────────────

/**
 * Subscribe to all shipments with a specific FedEx tracking status.
 *
 * Uses the `by_status` index for O(log n + |results|) performance.
 * Results are ordered by `updatedAt` descending on the server.
 *
 * This is the real-time watcher used by the M4 logistics map mode:
 *   • status="in_transit"       → all cases actively in transit
 *   • status="out_for_delivery" → imminent deliveries
 *   • status="exception"        → cases that need operator attention
 *
 * Convex re-evaluates and pushes within ~100–300 ms of any
 * `updateShipmentStatus` call for the given status bucket.
 *
 * @param status  ShipmentStatus to filter by.
 * @param limit   Optional maximum number of records (default 200, max 500).
 * @returns `undefined` while loading, `ShipmentRecord[]` once data arrives.
 */
export function useShipmentsByStatus(
  status: ShipmentStatus,
  limit?: number
): ShipmentRecord[] | undefined {
  return useQuery(
    api.shipping.listShipmentsByStatus,
    { status, limit }
  ) as ShipmentRecord[] | undefined;
}

// ─── useActiveShipments ───────────────────────────────────────────────────────

/**
 * Subscribe to all non-terminal shipments across all active status buckets.
 *
 * "Active" statuses: label_created | picked_up | in_transit | out_for_delivery
 *
 * The server merges four separate index reads (one per active status bucket)
 * and sorts by shippedAt descending — most recently shipped first. With a
 * typical fleet of < 500 cases in transit, this is fast and fits in memory.
 *
 * Convex re-evaluates and pushes an update when any shipments row transitions
 * to or from an active status — covering both new shipments (shipCase creates
 * a label_created row) and deliveries (updateShipmentStatus sets "delivered").
 *
 * Used by the M4 Logistics map mode to maintain a live view of all in-transit
 * cases without polling.
 *
 * @param limitPerStatus  Optional per-status max records (default 200, max 500).
 *                        Total result count ≤ 4 × limitPerStatus.
 * @returns `undefined` while loading, `ShipmentRecord[]` once data arrives.
 *          Empty array when no cases are currently in transit.
 */
export function useActiveShipments(
  limitPerStatus?: number
): ShipmentRecord[] | undefined {
  return useQuery(
    api.shipping.listActiveShipments,
    { limitPerStatus }
  ) as ShipmentRecord[] | undefined;
}

// ─── useLatestShipment ────────────────────────────────────────────────────────

/**
 * Subscribe to the single most-recently-created shipment for a case.
 *
 * Derived shorthand: subscribes to `listShipmentsByCase` (the same reactive
 * subscription as `useShipmentsByCase`) and returns only the first element.
 *
 * Returns:
 *   `undefined`       — while the Convex query is loading
 *   `null`            — when no shipments exist for this case
 *   `ShipmentRecord`  — the most recently created shipment
 *
 * This is the hook to use in T1/T2/T3 compact tracking chips where only the
 * current shipment is needed, not the full history.
 *
 * Convex re-evaluates within ~100–300 ms of any SCAN app ship action,
 * satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * @param caseId  Convex document ID of the case to watch.
 */
export function useLatestShipment(
  caseId: string
): ShipmentRecord | null | undefined {
  const shipments = useShipmentsByCase(caseId);
  if (shipments === undefined) return undefined;
  return shipments.length > 0 ? (shipments[0] as ShipmentRecord) : null;
}

// ─── Carrier event type ───────────────────────────────────────────────────────

/**
 * A single FedEx carrier scan event as stored in the live tracking response.
 * Mirrors the `TrackingEvent` shape from use-fedex-tracking.ts.
 *
 * These events come from the on-demand FedEx Track API call
 * (`api.shipping.trackShipment`) and are NOT persisted to the database.
 * For real-time persisted status, use `useShipmentsByCase` or `useLatestShipment`.
 */
export interface CarrierEvent {
  /** ISO 8601 timestamp of the scan event. */
  timestamp: string;
  /** FedEx event type code (e.g., "OD" = Out for Delivery). */
  eventType: string;
  /** Human-readable description of the event. */
  description: string;
  /** Location of the scan event. */
  location: {
    city?: string;
    state?: string;
    country?: string;
  };
}

/**
 * Return type for a complete live FedEx tracking response.
 * Combines persisted status from the database with live carrier events.
 *
 * Note: `events` are only populated after calling `refreshTracking()` via
 * `useFedExTracking`. For reactive database-only status, use `useLatestShipment`
 * or `useShipmentsByCase` — those do NOT call the FedEx API.
 */
export interface ShipmentTrackingState {
  /** The persisted shipment record from the Convex database. */
  shipment: ShipmentRecord;
  /** FedEx tracking URL for the tracking number. */
  trackingUrl: string;
  /** FedEx label/package detail URL. */
  labelUrl: string;
  /**
   * Live carrier scan events from the FedEx Track API.
   * Empty until `refreshTracking()` is called via `useFedExTracking`.
   */
  events: CarrierEvent[];
  /**
   * True when the shipment status is not in a terminal state (delivered /
   * exception) — i.e., the package is still moving.
   */
  isActive: boolean;
}

/**
 * Build a ShipmentTrackingState from a persisted shipment record.
 *
 * Pure function — safe to call during render. The `events` array is always
 * empty here since live events require an async FedEx API call; use
 * `useFedExTracking` when live carrier events are needed.
 *
 * @param shipment  Persisted ShipmentRecord from useShipmentsByCase.
 * @param liveEvents Optional live carrier events from a useFedExTracking refresh.
 * @returns ShipmentTrackingState for display in T-layout components.
 */
export function buildShipmentTrackingState(
  shipment: ShipmentRecord,
  liveEvents: CarrierEvent[] = []
): ShipmentTrackingState {
  return {
    shipment,
    trackingUrl:  getTrackingUrl(shipment.trackingNumber),
    labelUrl:     getLabelPreviewUrl(shipment.trackingNumber),
    events:       liveEvents,
    isActive:     !["delivered", "exception"].includes(shipment.status),
  };
}
