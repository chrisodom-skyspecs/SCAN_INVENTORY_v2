/**
 * FedExTrackingStatus — public exports.
 *
 * A pure presentation component for displaying FedEx carrier tracking status.
 * Accepts carrier status, estimated delivery, and last event as props.
 * No Convex dependencies — safe to use in any rendering context.
 */
export { FedExTrackingStatus } from "./FedExTrackingStatus";
export type {
  FedExTrackingStatusProps,
  CarrierStatus,
  FedExTrackingEvent,
  TrackingEventLocation,
} from "./FedExTrackingStatus";
