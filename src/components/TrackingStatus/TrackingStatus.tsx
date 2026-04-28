/**
 * TrackingStatus — Standalone FedEx tracking status display component.
 *
 * Displays the current FedEx tracking status for a case, including:
 *   • Current status badge (via StatusPill)
 *   • Carrier label
 *   • Tracking number
 *   • Current location (from the most recent tracking event)
 *   • Estimated delivery date/time
 *   • Live status description from FedEx API
 *   • On-demand refresh (wired to api.shipping.trackShipment Convex action)
 *   • Full tracking event timeline (full variant only)
 *
 * Variants:
 *   "compact"  — Card-style summary for T1 Overview panel.
 *                Shows: carrier, status pill, tracking #, current location,
 *                ETA, and a "View full tracking →" link.
 *
 *   "full"     — Detailed view for T4 Shipping panel.
 *                All compact fields plus: live description, refresh button,
 *                complete events timeline, live badge.
 *
 * Data wiring:
 *   The component calls useFedExTracking(caseId) internally, which:
 *     1. Subscribes to api.shipping.listShipmentsByCase — a reactive Convex
 *        query that delivers updates within ~100–300 ms of any SCAN app
 *        createShipment/shipCase mutation.
 *     2. Provides refreshTracking() which calls api.shipping.trackShipment —
 *        a Convex action that reaches the FedEx Track API for live data.
 *
 * Usage:
 *   // T1 compact banner
 *   <TrackingStatus caseId={caseId} variant="compact" onViewDetails={goToT4} />
 *
 *   // T4 full tracking panel
 *   <TrackingStatus caseId={caseId} variant="full" />
 *
 *   // Controlled — parent already has tracking data
 *   <TrackingStatus
 *     caseId={caseId}
 *     variant="compact"
 *     shipment={latestShipment}
 *     liveTracking={liveTracking}
 *     isRefreshing={isRefreshing}
 *     onRefresh={refreshTracking}
 *   />
 */

"use client";

import { useFedExTracking, type ShipmentRecord, type LiveTrackingResult } from "../../hooks/use-fedex-tracking";
import { StatusPill } from "../StatusPill";
import type { StatusKind } from "../StatusPill";
import styles from "./TrackingStatus.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TrackingStatusVariant = "compact" | "full";

/**
 * Props when driving the component via caseId (auto mode).
 * The component handles its own Convex subscriptions internally.
 */
export interface TrackingStatusAutoProps {
  /** Convex document ID of the case to display tracking for. */
  caseId: string;
  /** Display variant. Defaults to "compact". */
  variant?: TrackingStatusVariant;
  /**
   * Called when the user clicks "View full tracking →" (compact variant).
   * Typically switches the CaseDetailPanel to T4.
   */
  onViewDetails?: () => void;
  /** Additional CSS class for the root element. */
  className?: string;
}

/**
 * Props when driving the component with pre-fetched data (controlled mode).
 * Used when a parent component already subscribes to the Convex queries and
 * wants to avoid duplicate subscriptions.
 */
export interface TrackingStatusControlledProps
  extends Omit<TrackingStatusAutoProps, "caseId"> {
  caseId: string;
  /** Pre-fetched shipment record from the parent's useFedExTracking call. */
  shipment: ShipmentRecord | null;
  /** Live tracking data from the parent's refreshTracking call, or null. */
  liveTracking?: LiveTrackingResult | null;
  /** Whether a live refresh is in progress. */
  isRefreshing?: boolean;
  /** Whether the latest shipment is active (not delivered). */
  isActiveShipment?: boolean;
  /** Callback to trigger a live FedEx tracking refresh. */
  onRefresh?: () => void;
  /** Error message from the most recent failed refresh. */
  refreshError?: string | null;
}

export type TrackingStatusProps =
  | TrackingStatusAutoProps
  | TrackingStatusControlledProps;

// ─── Type guard ───────────────────────────────────────────────────────────────

function isControlled(
  props: TrackingStatusProps
): props is TrackingStatusControlledProps {
  return "shipment" in props;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_STATUS_KINDS: ReadonlySet<string> = new Set<string>([
  "label_created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
]);

function toStatusKind(status: string): StatusKind {
  return VALID_STATUS_KINDS.has(status)
    ? (status as StatusKind)
    : "in_transit";
}

function formatShortDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

function formatEventTimestamp(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function formatLocation(loc: {
  city?: string;
  state?: string;
  country?: string;
}): string {
  return [loc.city, loc.state, loc.country].filter(Boolean).join(", ");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Shipping box icon (decorative) */
function ShippingIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 10.5V5.5L8 2L2 5.5V10.5L8 14L14 10.5Z" />
      <polyline points="2.18 5.03 8 8.51 13.82 5.03" />
      <line x1="8" y1="14.08" x2="8" y2="8.5" />
    </svg>
  );
}

/** Location pin icon (decorative) */
function LocationIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 1a3.5 3.5 0 0 1 3.5 3.5C9.5 7.25 6 11 6 11S2.5 7.25 2.5 4.5A3.5 3.5 0 0 1 6 1Z" />
      <circle cx="6" cy="4.5" r="1" />
    </svg>
  );
}

/** Refresh icon (decorative) */
function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ width: "0.75rem", height: "0.75rem" }}
    >
      <polyline points="1 4 1 1 4 1" />
      <path d="M1 1C3 1 7 1 9 3s3 4 3 4" />
      <polyline points="13 10 13 13 10 13" />
      <path d="M13 13C11 13 7 13 5 11S2 7 2 7" />
    </svg>
  );
}

/** Warning icon (decorative) */
function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ width: "0.875rem", height: "0.875rem" }}
    >
      <path d="M8 2L1.5 13h13L8 2Z" />
      <line x1="8" y1="7" x2="8" y2="9.5" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

// ─── Core display: status + carrier header ────────────────────────────────────

interface StatusHeaderProps {
  carrier: string;
  status: string;
  liveTracking: LiveTrackingResult | null;
  isActiveShipment: boolean;
  isRefreshing: boolean;
  onRefresh?: () => void;
  showRefresh?: boolean;
}

function StatusHeader({
  carrier,
  status,
  liveTracking,
  isActiveShipment,
  isRefreshing,
  onRefresh,
  showRefresh = false,
}: StatusHeaderProps) {
  return (
    <div className={styles.statusHeader}>
      <div className={styles.statusLeft}>
        <span className={styles.carrierBadge} aria-label={`Carrier: ${carrier}`}>
          {carrier}
        </span>
        <StatusPill kind={toStatusKind(status)} filled />
        {liveTracking && (
          <span className={styles.liveBadge} aria-label="Live data from FedEx">
            Live
          </span>
        )}
      </div>

      {showRefresh && isActiveShipment && onRefresh && (
        <button
          className={styles.refreshBtn}
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label={isRefreshing ? "Refreshing FedEx tracking data…" : "Refresh live FedEx tracking data"}
          type="button"
        >
          {isRefreshing ? (
            <>
              <span className={styles.loadingSpinner} aria-hidden="true" />
              Refreshing…
            </>
          ) : (
            <>
              <RefreshIcon />
              Refresh
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ─── Key info rows (tracking #, location, ETA) ────────────────────────────────

interface TrackingInfoProps {
  trackingNumber: string;
  currentLocation?: string;
  estimatedDelivery?: string;
}

function TrackingInfo({
  trackingNumber,
  currentLocation,
  estimatedDelivery,
}: TrackingInfoProps) {
  return (
    <div className={styles.infoGrid} aria-label="Tracking details">
      {/* Tracking number */}
      <div className={styles.infoRow}>
        <span className={styles.infoLabel}>Tracking No.</span>
        <span
          className={styles.infoValueMono}
          aria-label={`Tracking number: ${trackingNumber}`}
        >
          {trackingNumber}
        </span>
      </div>

      {/* Current location */}
      {currentLocation && (
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Location</span>
          <span className={styles.locationChip} aria-label={`Current location: ${currentLocation}`}>
            <LocationIcon className={styles.locationIcon} />
            {currentLocation}
          </span>
        </div>
      )}

      {/* Estimated delivery */}
      {estimatedDelivery && (
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>Est. Delivery</span>
          <span
            className={styles.etaValue}
            aria-label={`Estimated delivery: ${formatShortDate(estimatedDelivery)}`}
          >
            {formatShortDate(estimatedDelivery)}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Events timeline ──────────────────────────────────────────────────────────

interface TrackingEventsProps {
  events: LiveTrackingResult["events"];
  isLive: boolean;
}

function TrackingEvents({ events, isLive }: TrackingEventsProps) {
  if (events.length === 0) return null;

  return (
    <section aria-label="FedEx tracking events">
      <div className={styles.eventsHeader}>
        <h4 className={styles.eventsTitle}>Tracking Events</h4>
        {isLive && (
          <span className={styles.liveBadge} aria-label="Live events from FedEx">
            Live
          </span>
        )}
      </div>

      <ol
        className={styles.timeline}
        aria-label="Shipment scan events, most recent first"
      >
        {events.map((event, idx) => {
          const loc = formatLocation(event.location);
          return (
            <li
              key={`${event.timestamp}-${idx}`}
              className={styles.timelineItem}
            >
              <div className={styles.timelineDot} aria-hidden="true" />
              <div className={styles.timelineBody}>
                <div className={styles.timelineRow}>
                  <span className={styles.timelineDesc}>
                    {event.description || event.eventType}
                  </span>
                  {event.timestamp && (
                    <time
                      className={styles.timelineTime}
                      dateTime={event.timestamp}
                    >
                      {formatEventTimestamp(event.timestamp)}
                    </time>
                  )}
                </div>
                {loc && (
                  <span className={styles.timelineLoc} aria-label={`Location: ${loc}`}>
                    {loc}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ─── No-tracking empty state ──────────────────────────────────────────────────

function NoTracking() {
  return (
    <div className={styles.empty} role="status" aria-label="No tracking information available">
      <ShippingIcon className={styles.locationIcon} />
      <p className={styles.emptyTitle}>No shipment recorded</p>
      <p className={styles.emptyText}>
        No FedEx tracking number has been entered for this case yet.
      </p>
    </div>
  );
}

// ─── Inner render: compact ────────────────────────────────────────────────────

interface CompactViewProps {
  shipment: ShipmentRecord;
  liveTracking: LiveTrackingResult | null;
  isActiveShipment: boolean;
  isRefreshing: boolean;
  refreshError: string | null;
  onRefresh?: () => void;
  onViewDetails?: () => void;
}

function CompactView({
  shipment,
  liveTracking,
  isActiveShipment,
  isRefreshing,
  refreshError,
  onRefresh,
  onViewDetails,
}: CompactViewProps) {
  const effectiveStatus = liveTracking?.status ?? shipment.status;
  const effectiveEta = liveTracking?.estimatedDelivery ?? shipment.estimatedDelivery;

  // Derive current location from most recent tracking event
  const latestEvent = liveTracking?.events?.[0];
  const currentLocation = latestEvent
    ? formatLocation(latestEvent.location)
    : undefined;

  return (
    <div className={styles.compactCard} data-testid="tracking-status-compact">
      {/* Status header: carrier + pill */}
      <StatusHeader
        carrier={shipment.carrier}
        status={effectiveStatus}
        liveTracking={liveTracking}
        isActiveShipment={isActiveShipment}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
        showRefresh={false}
      />

      {/* Live status description */}
      {liveTracking?.description && (
        <p className={styles.statusDescription}>{liveTracking.description}</p>
      )}

      {/* Key tracking info */}
      <TrackingInfo
        trackingNumber={shipment.trackingNumber}
        currentLocation={currentLocation}
        estimatedDelivery={effectiveEta}
      />

      {/* Error banner */}
      {refreshError && (
        <div className={styles.errorBanner} role="alert">
          <WarningIcon className={styles.errorIcon} />
          <span>{refreshError}</span>
        </div>
      )}

      {/* "View full tracking →" link */}
      {onViewDetails && (
        <button
          className={styles.viewLink}
          onClick={onViewDetails}
          type="button"
          aria-label="View full shipping details in Shipping panel"
        >
          View full tracking →
        </button>
      )}
    </div>
  );
}

// ─── Inner render: full ───────────────────────────────────────────────────────

interface FullViewProps {
  shipment: ShipmentRecord;
  liveTracking: LiveTrackingResult | null;
  isActiveShipment: boolean;
  isRefreshing: boolean;
  refreshError: string | null;
  onRefresh?: () => void;
}

function FullView({
  shipment,
  liveTracking,
  isActiveShipment,
  isRefreshing,
  refreshError,
  onRefresh,
}: FullViewProps) {
  const effectiveStatus = liveTracking?.status ?? shipment.status;
  const effectiveEta = liveTracking?.estimatedDelivery ?? shipment.estimatedDelivery;
  const events = liveTracking?.events ?? [];

  // Derive current location from most recent tracking event
  const latestEvent = events[0];
  const currentLocation = latestEvent
    ? formatLocation(latestEvent.location)
    : undefined;

  return (
    <div className={styles.full} data-testid="tracking-status-full">
      {/* Status header: carrier + pill + refresh button */}
      <StatusHeader
        carrier={shipment.carrier}
        status={effectiveStatus}
        liveTracking={liveTracking}
        isActiveShipment={isActiveShipment}
        isRefreshing={isRefreshing}
        onRefresh={onRefresh}
        showRefresh
      />

      {/* Live status description */}
      {liveTracking?.description && (
        <p className={styles.statusDescription} style={{ marginTop: "0.5rem" }}>
          {liveTracking.description}
        </p>
      )}

      {/* Error banner */}
      {refreshError && (
        <div className={styles.errorBanner} role="alert" style={{ marginTop: "0.5rem" }}>
          <WarningIcon className={styles.errorIcon} />
          <span>{refreshError}</span>
        </div>
      )}

      {/* Key tracking info */}
      <hr className={styles.divider} />
      <TrackingInfo
        trackingNumber={shipment.trackingNumber}
        currentLocation={currentLocation}
        estimatedDelivery={effectiveEta}
      />

      {/* Events timeline (only when live data available) */}
      {events.length > 0 && (
        <>
          <hr className={styles.divider} />
          <TrackingEvents
            events={events}
            isLive={liveTracking !== null}
          />
        </>
      )}
    </div>
  );
}

// ─── Auto-wired wrapper ───────────────────────────────────────────────────────
/**
 * Wraps the inner views and injects tracking data via useFedExTracking(caseId).
 * This is the default operating mode — pass `caseId` and the component
 * subscribes to all relevant Convex queries automatically.
 */
function AutoTrackingStatus({
  caseId,
  variant = "compact",
  onViewDetails,
  className,
}: TrackingStatusAutoProps) {
  const {
    latestShipment,
    hasTracking,
    liveTracking,
    isRefreshing,
    isActiveShipment,
    refreshError,
    refreshTracking,
    shipments,
  } = useFedExTracking(caseId);

  // Loading state: subscriptions not yet resolved
  if (shipments === undefined) {
    return (
      <div className={[styles.root, className].filter(Boolean).join(" ")} aria-busy="true">
        <div className={styles.loadingRow}>
          <span className={styles.loadingSpinner} aria-hidden="true" />
          <span>Loading tracking…</span>
        </div>
      </div>
    );
  }

  // No tracking data yet
  if (!hasTracking || !latestShipment) {
    return (
      <div className={[styles.root, className].filter(Boolean).join(" ")}>
        <NoTracking />
      </div>
    );
  }

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      {variant === "full" ? (
        <FullView
          shipment={latestShipment}
          liveTracking={liveTracking}
          isActiveShipment={isActiveShipment}
          isRefreshing={isRefreshing}
          refreshError={refreshError}
          onRefresh={refreshTracking}
        />
      ) : (
        <CompactView
          shipment={latestShipment}
          liveTracking={liveTracking}
          isActiveShipment={isActiveShipment}
          isRefreshing={isRefreshing}
          refreshError={refreshError}
          onRefresh={refreshTracking}
          onViewDetails={onViewDetails}
        />
      )}
    </div>
  );
}

// ─── Controlled-mode wrapper ──────────────────────────────────────────────────
/**
 * Controlled mode: parent passes pre-fetched tracking data.
 * Avoids duplicate Convex subscriptions when the parent already calls
 * useFedExTracking for other reasons.
 */
function ControlledTrackingStatus({
  shipment,
  liveTracking = null,
  isRefreshing = false,
  isActiveShipment = false,
  onRefresh,
  refreshError = null,
  variant = "compact",
  onViewDetails,
  className,
}: TrackingStatusControlledProps) {
  if (!shipment) {
    return (
      <div className={[styles.root, className].filter(Boolean).join(" ")}>
        <NoTracking />
      </div>
    );
  }

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      {variant === "full" ? (
        <FullView
          shipment={shipment}
          liveTracking={liveTracking}
          isActiveShipment={isActiveShipment}
          isRefreshing={isRefreshing}
          refreshError={refreshError}
          onRefresh={onRefresh}
        />
      ) : (
        <CompactView
          shipment={shipment}
          liveTracking={liveTracking}
          isActiveShipment={isActiveShipment}
          isRefreshing={isRefreshing}
          refreshError={refreshError}
          onRefresh={onRefresh}
          onViewDetails={onViewDetails}
        />
      )}
    </div>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

/**
 * TrackingStatus — unified FedEx tracking status display component.
 *
 * Automatically selects auto vs. controlled mode based on whether the
 * caller passes raw Convex data (controlled) or just a caseId (auto).
 *
 * @example Auto mode (self-contained, subscribes to Convex internally):
 *   <TrackingStatus caseId={caseId} />
 *   <TrackingStatus caseId={caseId} variant="full" />
 *   <TrackingStatus caseId={caseId} variant="compact" onViewDetails={goToT4} />
 *
 * @example Controlled mode (parent already subscribes to Convex):
 *   const { latestShipment, liveTracking, isRefreshing, refreshTracking, isActiveShipment, refreshError } =
 *     useFedExTracking(caseId);
 *   <TrackingStatus
 *     caseId={caseId}
 *     shipment={latestShipment}
 *     liveTracking={liveTracking}
 *     isRefreshing={isRefreshing}
 *     isActiveShipment={isActiveShipment}
 *     onRefresh={refreshTracking}
 *     refreshError={refreshError}
 *     variant="compact"
 *     onViewDetails={goToT4}
 *   />
 */
export function TrackingStatus(props: TrackingStatusProps) {
  if (isControlled(props)) {
    return <ControlledTrackingStatus {...props} />;
  }
  return <AutoTrackingStatus {...props} />;
}

export default TrackingStatus;
