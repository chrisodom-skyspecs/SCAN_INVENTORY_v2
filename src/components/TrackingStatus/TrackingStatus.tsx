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

import { useFedExTracking, type ShipmentRecord, type LiveTrackingResult, type TrackingEvent } from "../../hooks/use-fedex-tracking";
import { getTrackingUrl } from "../../hooks/use-shipment-status";
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

/** External link icon (decorative) — used by the "View on FedEx" link */
function ExternalLinkIcon({ className }: { className?: string }) {
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
      <path d="M11 7v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5" />
      <polyline points="9 1 13 1 13 5" />
      <line x1="6" y1="8" x2="13" y2="1" />
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

// ─── Last Scan row ────────────────────────────────────────────────────────────
//
// Surfaces the most recent FedEx scan event in the case detail UI as a
// dedicated "Last Scan" section so operators can see the latest carrier
// activity (description, timestamp, location) without having to dig into
// the events timeline or trigger a live refresh.
//
// Source-priority for the displayed event:
//   1. liveTracking.events[0] — freshly fetched from FedEx via the action.
//   2. shipment.lastEvent      — persisted on the shipment row by the most
//                                recent updateShipmentStatus tracking poll.
//
// When neither source has an event (e.g., the shipment was just created and
// the label has not been scanned yet), this section renders nothing.

interface LastScanRowProps {
  event: TrackingEvent;
}

function LastScanRow({ event }: LastScanRowProps) {
  const loc = formatLocation(event.location);
  const desc = event.description || event.eventType || "";

  return (
    <section
      aria-label="Last FedEx tracking scan"
      data-testid="tracking-status-last-scan"
    >
      <div className={styles.eventsHeader}>
        <h4 className={styles.eventsTitle}>Last Scan</h4>
      </div>

      <div className={styles.timelineRow}>
        {desc && <span className={styles.timelineDesc}>{desc}</span>}
        {event.timestamp && (
          <time
            className={styles.timelineTime}
            dateTime={event.timestamp}
            aria-label={`Last scan time: ${formatEventTimestamp(event.timestamp)}`}
          >
            {formatEventTimestamp(event.timestamp)}
          </time>
        )}
      </div>
      {loc && (
        <span
          className={styles.timelineLoc}
          aria-label={`Last scan location: ${loc}`}
        >
          <LocationIcon className={styles.locationIcon} />
          {loc}
        </span>
      )}
    </section>
  );
}

// ─── View-on-FedEx external link ──────────────────────────────────────────────
//
// Provides operators with a deep-link to the public FedEx tracking page for
// the active tracking number.  Opens in a new tab/window with rel="noopener
// noreferrer" so the FedEx site cannot manipulate the dashboard window.
//
// The URL is built via `getTrackingUrl(trackingNumber)` from
// hooks/use-shipment-status.ts — a single source of truth ensuring the URL
// format stays consistent across compact (T1) and full (T4) variants.

interface FedExExternalLinkProps {
  trackingNumber: string;
}

function FedExExternalLink({ trackingNumber }: FedExExternalLinkProps) {
  const href = getTrackingUrl(trackingNumber);
  return (
    <a
      className={styles.viewLink}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View tracking number ${trackingNumber} on fedex.com (opens in new tab)`}
      data-testid="tracking-status-fedex-link"
    >
      View on FedEx
      <ExternalLinkIcon />
    </a>
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

  // Derive the latest FedEx scan event from (in priority order):
  //   1. liveTracking.events[0]  — freshly fetched from FedEx via refresh
  //   2. shipment.lastEvent      — persisted from the most recent tracking
  //                                poll by `updateShipmentStatus`
  // The persisted fallback ensures the "last scan" is visible even when no
  // live refresh has been triggered in the current session.
  const latestEvent: TrackingEvent | undefined =
    liveTracking?.events?.[0] ?? shipment.lastEvent;
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

      {/* Last Scan — most recent FedEx event (live or persisted) */}
      {latestEvent && <LastScanRow event={latestEvent} />}

      {/* Error banner */}
      {refreshError && (
        <div className={styles.errorBanner} role="alert">
          <WarningIcon className={styles.errorIcon} />
          <span>{refreshError}</span>
        </div>
      )}

      {/* Action row: "View on FedEx" external link + optional "View full tracking →" */}
      <div className={styles.actionRow}>
        <FedExExternalLink trackingNumber={shipment.trackingNumber} />
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

  // Derive the latest FedEx scan event from (in priority order):
  //   1. liveTracking.events[0]  — freshly fetched from FedEx via refresh
  //   2. shipment.lastEvent      — persisted from the most recent tracking
  //                                poll by `updateShipmentStatus`
  // The persisted fallback ensures the "last scan" is visible even when no
  // live refresh has been triggered in the current session.
  const latestEvent: TrackingEvent | undefined = events[0] ?? shipment.lastEvent;
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

      {/*
        ── Last Scan section (Sub-AC 4) ─────────────────────────────────
        Renders the most recent FedEx scan event from the persisted
        shipment.lastEvent fallback ONLY when no live events timeline is
        available below (i.e. the operator hasn't hit Refresh yet, or the
        FedEx Track API is currently unavailable).

        When `events.length > 0` the "Tracking Events" timeline below
        already shows the latest event as its top entry with proper labels
        and the "Live" badge — duplicating the same scan in a Last Scan
        row above it would be redundant noise.
      */}
      {events.length === 0 && latestEvent && (
        <>
          <hr className={styles.divider} />
          <LastScanRow event={latestEvent} />
        </>
      )}

      {/*
        ── View on FedEx external link (Sub-AC 4) ──────────────────────
        Deep-link to the public FedEx tracking page for this shipment.
        Opens in a new tab — operators can hand off to the carrier portal
        for label re-prints, delivery instruction edits, and other
        carrier-side workflows that are out of scope for this dashboard.
      */}
      <hr className={styles.divider} />
      <div className={styles.actionRow}>
        <FedExExternalLink trackingNumber={shipment.trackingNumber} />
      </div>

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
