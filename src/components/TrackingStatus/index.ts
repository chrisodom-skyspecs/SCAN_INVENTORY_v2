/**
 * TrackingStatus — standalone FedEx tracking status display component.
 *
 * Renders the current FedEx tracking status for a case:
 *   - Current status badge (StatusPill)
 *   - Carrier label
 *   - Tracking number (IBM Plex Mono)
 *   - Current location (from the most recent tracking event)
 *   - Estimated delivery date
 *   - Live status description from the FedEx Track API
 *   - On-demand refresh button (wired to api.shipping.trackShipment Convex action)
 *   - Full events timeline (full variant only)
 *
 * Two display variants:
 *   "compact" — Card-style summary for T1 Overview / SCAN case detail header.
 *   "full"    — Detailed view for T4 Shipping panel with events timeline.
 *
 * Two operating modes:
 *   Auto       — Pass only `caseId`; component subscribes to Convex internally.
 *   Controlled — Pass `shipment`/`liveTracking` from a parent hook call to
 *                avoid duplicate Convex subscriptions.
 */

export { TrackingStatus } from "./TrackingStatus";
export type {
  TrackingStatusProps,
  TrackingStatusAutoProps,
  TrackingStatusControlledProps,
  TrackingStatusVariant,
} from "./TrackingStatus";
