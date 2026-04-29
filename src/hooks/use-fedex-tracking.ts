/**
 * use-fedex-tracking.ts
 *
 * Custom hook that integrates the Convex shipping queries with the INVENTORY
 * T-layout case detail components.
 *
 * Provides:
 *   - Reactive subscription to persisted shipment records via
 *     `api.shipping.listShipmentsByCase` (updates within ~100–300 ms of
 *      any mutation via Convex real-time subscriptions).
 *   - On-demand live FedEx tracking refresh via `api.shipping.trackShipment`
 *     (calls the FedEx Track API, updates local state only — does not persist).
 *   - Derived booleans for conditional UI rendering:
 *       hasTracking     — true when at least one shipment with a tracking
 *                         number exists for this case.
 *       isActiveShipment — true when the latest shipment is not "delivered".
 *   - Parsed error codes so components can show contextual error messages
 *     based on the specific FedEx API failure mode.
 *
 * Usage (T4 Shipping panel):
 *   const { latestShipment, hasTracking, refreshTracking, isRefreshing } =
 *     useFedExTracking({ caseId });
 *
 *   if (!hasTracking) return <NoShipmentPlaceholder />;
 *   return <TrackingSection shipment={latestShipment} />;
 */

"use client";

import { useQuery, useAction } from "convex/react";
import { useState, useCallback } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  type FedExTrackingErrorCode,
  FEDEX_ERROR_MESSAGES,
  parseFedExErrorCode,
  getFedExUserErrorMessage,
} from "../lib/fedex-tracking-errors";

// Re-export for convenience so consumers can import everything from this hook
export type { FedExTrackingErrorCode };
export {
  FEDEX_ERROR_MESSAGES,
  parseFedExErrorCode,
  getFedExUserErrorMessage,
} from "../lib/fedex-tracking-errors";

// ─── Shipment record type ─────────────────────────────────────────────────────

/** Shipment tracking status values — matches Convex schema `shipmentStatus`. */
export type ShipmentStatus =
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";

/** A persisted shipment record as returned by `listShipmentsByCase`. */
export interface ShipmentRecord {
  _id: string;
  _creationTime: number;
  caseId: string;
  trackingNumber: string;
  carrier: string;
  status: ShipmentStatus;
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

// ─── Live tracking result type ────────────────────────────────────────────────

/** A single scan event from the FedEx tracking timeline. */
export interface TrackingEvent {
  timestamp: string;
  eventType: string;
  description: string;
  location: {
    city?: string;
    state?: string;
    country?: string;
  };
}

/** Normalised live FedEx tracking result from the on-demand action. */
export interface LiveTrackingResult {
  trackingNumber: string;
  status: ShipmentStatus | "unknown";
  description: string;
  estimatedDelivery?: string;
  events: TrackingEvent[];
}

// ─── Hook return type ─────────────────────────────────────────────────────────

export interface UseFedExTrackingReturn {
  /**
   * All shipment records for this case, ordered most-recent-first.
   * `undefined` while the initial Convex query is loading.
   */
  shipments: ShipmentRecord[] | undefined;

  /**
   * The most recently created shipment for this case.
   * `null` when there are no shipments or while loading.
   */
  latestShipment: ShipmentRecord | null;

  /**
   * True when at least one shipment with a non-empty tracking number exists
   * for this case.  Use this to conditionally render tracking UI.
   */
  hasTracking: boolean;

  /**
   * True when the latest shipment status is not "delivered".
   * Useful for showing a "Refresh" button only on active shipments.
   */
  isActiveShipment: boolean;

  /**
   * Live tracking data fetched on-demand via the FedEx Track API.
   * `null` until `refreshTracking()` is called or if no tracking number exists.
   */
  liveTracking: LiveTrackingResult | null;

  /**
   * True while a live tracking refresh action is in flight.
   */
  isRefreshing: boolean;

  /**
   * Raw error message from the most recent failed refresh, or `null`.
   * Contains the full "[CODE] message" string from the Convex action.
   */
  refreshError: string | null;

  /**
   * Machine-readable error code from the most recent failed refresh, or `null`.
   *
   * Parsed from the bracketed prefix in `refreshError`:
   *   "INVALID_TRACKING_NUMBER" — input failed format validation
   *   "NOT_FOUND"               — not found in FedEx system
   *   "RATE_LIMITED"            — 429 from FedEx API
   *   "SERVER_ERROR"            — 5xx from FedEx API
   *   "NETWORK_ERROR"           — network connectivity failure
   *   "AUTH_ERROR"              — FedEx credential problem
   *   "PARSE_ERROR"             — unexpected response shape
   *   "UNKNOWN_ERROR"           — catch-all
   *   null                      — no error or unrecognised format
   *
   * Use this to show contextual UI (e.g. different icon/copy for NOT_FOUND
   * vs NETWORK_ERROR vs RATE_LIMITED).
   */
  refreshErrorCode: FedExTrackingErrorCode | null;

  /**
   * User-friendly error message derived from `refreshErrorCode`.
   * Safe to display directly in the UI without further processing.
   * `null` when there is no error.
   */
  refreshErrorMessage: string | null;

  /**
   * Trigger a live FedEx tracking refresh for the latest shipment.
   * No-op when `hasTracking` is false.
   * Updates `liveTracking` on success, `refreshError` / `refreshErrorCode`
   * on failure.
   */
  refreshTracking: () => Promise<void>;
}

// ─── Hook implementation ──────────────────────────────────────────────────────

/**
 * Integrate FedEx tracking Convex queries into a case detail component.
 *
 * @param caseId  Convex document ID of the case to track.
 */
export function useFedExTracking(caseId: string): UseFedExTrackingReturn {
  // ── Reactive Convex subscription ──────────────────────────────────────────
  // `listShipmentsByCase` is a public query — Convex re-runs it and pushes
  // updates within ~100–300 ms whenever a shipment row changes (e.g., when
  // the SCAN app calls createShipment or the background refresh runs).
  const rawShipments = useQuery(api.shipping.listShipmentsByCase, { caseId: caseId as Id<"cases"> });

  // ── On-demand FedEx action ─────────────────────────────────────────────────
  // `trackShipment` is a public action that calls the FedEx Track API.
  // We use `trackShipment` (accepts a tracking number) rather than
  // `getCaseTrackingStatus` (accepts a caseId) because the tracking number
  // is already available from the persisted shipment record.
  const trackShipmentAction = useAction(api.shipping.trackShipment);

  // ── Local state for on-demand refresh ─────────────────────────────────────
  const [liveTracking, setLiveTracking] = useState<LiveTrackingResult | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshErrorCode, setRefreshErrorCode] =
    useState<FedExTrackingErrorCode | null>(null);

  // ── Derived values ─────────────────────────────────────────────────────────
  const shipments = rawShipments as ShipmentRecord[] | undefined;
  const latestShipment: ShipmentRecord | null =
    shipments && shipments.length > 0 ? (shipments[0] as ShipmentRecord) : null;

  const hasTracking =
    latestShipment !== null && Boolean(latestShipment.trackingNumber?.trim());

  const isActiveShipment =
    hasTracking &&
    latestShipment !== null &&
    latestShipment.status !== "delivered";

  // Derive user-friendly error message from the error code
  const refreshErrorMessage: string | null =
    refreshErrorCode !== null
      ? (FEDEX_ERROR_MESSAGES[refreshErrorCode] ?? refreshError)
      : refreshError
      ? getFedExUserErrorMessage(refreshError)
      : null;

  // ── Refresh callback ───────────────────────────────────────────────────────
  const refreshTracking = useCallback(async () => {
    if (!hasTracking || !latestShipment?.trackingNumber) return;

    setIsRefreshing(true);
    setRefreshError(null);
    setRefreshErrorCode(null);

    try {
      const result = await trackShipmentAction({
        trackingNumber: latestShipment.trackingNumber,
      });

      // Normalise the live result to our LiveTrackingResult shape.
      // The action returns a FedExTrackingResult which has the same structure.
      setLiveTracking({
        trackingNumber: result.trackingNumber,
        status: (result.status as ShipmentStatus | "unknown") ?? "unknown",
        description: result.description,
        estimatedDelivery: result.estimatedDelivery,
        events: (result.events ?? []).map((e: TrackingEvent) => ({
          timestamp: e.timestamp,
          eventType: e.eventType,
          description: e.description,
          location: {
            city: e.location?.city,
            state: e.location?.state,
            country: e.location?.country,
          },
        })),
      });
    } catch (err) {
      const raw =
        err instanceof Error
          ? err.message
          : "Unable to refresh tracking data. Try again.";

      // Parse the bracketed error code for contextual UI messaging
      const code = parseFedExErrorCode(raw);

      setRefreshError(raw);
      setRefreshErrorCode(code);
    } finally {
      setIsRefreshing(false);
    }
  }, [hasTracking, latestShipment, trackShipmentAction]);

  return {
    shipments,
    latestShipment,
    hasTracking,
    isActiveShipment,
    liveTracking,
    isRefreshing,
    refreshError,
    refreshErrorCode,
    refreshErrorMessage,
    refreshTracking,
  };
}
