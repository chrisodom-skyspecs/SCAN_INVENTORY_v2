/**
 * TrackingStatusByNumber — SCAN app FedEx tracking status display.
 *
 * Accepts a FedEx tracking number directly and auto-fetches live tracking data
 * from the FedEx Track API via the Convex `api.shipping.trackShipment` action.
 *
 * This component is designed for the SCAN mobile app's shipping workflow, where
 * the technician has already entered a tracking number and wants to see its
 * current status without needing a full case subscription.
 *
 * Key behaviours:
 *   • Calls api.shipping.trackShipment on mount and whenever `trackingNumber`
 *     changes (via useEffect dependency), giving instant feedback after entry.
 *   • Manages its own loading / error / data state — no parent hook required.
 *   • Provides a manual "Refresh" button so technicians can re-poll FedEx.
 *   • Uses StatusPill for the status badge (spec-compliant, WCAG AA).
 *   • Parsing error codes into user-friendly messages via fedex-tracking-errors.
 *
 * Props:
 *   trackingNumber — FedEx tracking number string (whitespace is stripped).
 *   className      — Optional extra CSS class for the root element.
 *   onRefresh      — Optional callback fired after each successful fetch.
 *
 * Internal state (not exposed to parent):
 *   isLoading — true while the Convex action is in flight.
 *   error     — user-friendly error string from the most recent failed call.
 *   data      — FedExTrackingResult from the most recent successful call.
 *
 * Convex action wiring:
 *   Uses useAction(api.shipping.trackShipment) — a Convex action (not a query)
 *   that makes an outbound HTTP request to the FedEx Track API.  Unlike
 *   useQuery, actions are called imperatively; the useEffect below triggers the
 *   call on mount and on every trackingNumber prop change, cancelling the
 *   in-flight call (via a `cancelled` flag) if the prop changes before the
 *   response arrives.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { StatusPill } from "../../../../components/StatusPill";
import type { StatusKind } from "../../../../components/StatusPill";
import {
  parseFedExErrorCode,
  getFedExUserErrorMessage,
  isFedExTransientError,
  type FedExTrackingErrorCode,
} from "../../../../lib/fedex-tracking-errors";
import styles from "./TrackingStatusByNumber.module.css";

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Normalised FedEx tracking event (subset of FedExTrackingEvent from
 * convex/fedexClient.ts — re-typed here so the component has no server-side
 * import dependency).
 */
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

/**
 * Normalised FedEx tracking result as returned by api.shipping.trackShipment.
 * Matches FedExTrackingResult from convex/fedexClient.ts.
 */
export interface TrackingData {
  trackingNumber: string;
  status: string;
  description: string;
  estimatedDelivery?: string;
  events: TrackingEvent[];
}

// ─── Props interface ───────────────────────────────────────────────────────────

export interface TrackingStatusByNumberProps {
  /**
   * FedEx tracking number to display status for.
   * Leading/trailing whitespace is stripped before the API call.
   *
   * The component auto-fetches tracking data when this prop mounts or changes.
   * An empty or whitespace-only string skips the fetch and renders nothing.
   */
  trackingNumber: string;

  /**
   * Optional extra CSS class applied to the root element.
   * Use for layout adjustments from the parent — the component manages its
   * own internal styles.
   */
  className?: string;

  /**
   * Optional callback fired after each successful tracking fetch.
   * Receives the fresh TrackingData so the parent can synchronise state
   * if needed (e.g. updating a persisted shipment record).
   */
  onRefresh?: (data: TrackingData) => void;
}

// ─── Internal state type ───────────────────────────────────────────────────────

interface TrackingStatusState {
  /** True while the Convex action call is in flight. */
  isLoading: boolean;
  /**
   * User-friendly error message from the most recent failed action call.
   * null when there is no error or before the first call.
   */
  error: string | null;
  /**
   * Machine-readable error code parsed from the error message.
   * Allows rendering contextual error UI (e.g. "check your number" vs. "try again later").
   */
  errorCode: FedExTrackingErrorCode | null;
  /**
   * Tracking data from the most recent successful action call.
   * null before the first successful call or after an error.
   */
  data: TrackingData | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Valid status kinds supported by the StatusPill component. */
const VALID_STATUS_KINDS: ReadonlySet<string> = new Set<string>([
  "label_created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
]);

/**
 * Map a raw FedEx status string to a StatusPill-compatible StatusKind.
 * Falls back to "in_transit" for unrecognised values.
 */
function toStatusKind(status: string): StatusKind {
  return VALID_STATUS_KINDS.has(status)
    ? (status as StatusKind)
    : "in_transit";
}

/** Format a location object into a single readable string. */
function formatLocation(loc: {
  city?: string;
  state?: string;
  country?: string;
}): string {
  return [loc.city, loc.state, loc.country].filter(Boolean).join(", ");
}

/** Format an ISO timestamp into a short human-readable date/time string. */
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

/** Format an ISO date string into a short delivery date. */
function formatDeliveryDate(isoString: string): string {
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

// ─── StatusAndLocationSection ──────────────────────────────────────────────────

/**
 * Sub-AC 2: Dedicated status and location display section.
 *
 * Renders the current shipment status badge and last-known location directly
 * from the Convex action response (api.shipping.trackShipment).  This is the
 * PRIMARY visual anchor of TrackingStatusByNumber — the technician should be
 * able to assess shipment status and last-known location at a glance without
 * scrolling past header chrome or a generic details grid.
 *
 * Data contract (all props derived from TrackingData returned by the action):
 *   status          — raw status string from TrackingData.status
 *                     (mapped to StatusKind via toStatusKind)
 *   description     — human-readable status copy from TrackingData.description
 *   currentLocation — formatted "City, State, Country" string built from
 *                     TrackingData.events[0].location (the most recent scan event)
 *                     undefined when no events exist in the action response
 *   isLiveData      — true when this section is rendering fresh Convex action
 *                     response data (not a loading or error state)
 */
interface StatusAndLocationSectionProps {
  /** Raw FedEx status string from the Convex action response. */
  status: string;
  /** Human-readable status description from the Convex action response. */
  description?: string;
  /**
   * Formatted location string derived from the most recent tracking event
   * in the Convex action response: events[0].location → "City, State, Country".
   * undefined when the action returned an empty events array.
   */
  currentLocation?: string;
  /**
   * true when rendering fresh data from the Convex action.
   * Controls display of the "Live" badge.
   */
  isLiveData?: boolean;
}

function StatusAndLocationSection({
  status,
  description,
  currentLocation,
  isLiveData = false,
}: StatusAndLocationSectionProps) {
  const statusKind = toStatusKind(status);

  return (
    <div
      className={styles.statusLocationSection}
      aria-label="Current shipment status and location"
      data-testid="status-location-section"
    >
      {/* ── Status badge + live indicator ────────────────────── */}
      <div className={styles.statusLocationHeader}>
        <StatusPill kind={statusKind} filled />
        {isLiveData && (
          <span
            className={styles.statusLocationLiveBadge}
            aria-label="Live tracking data from FedEx API"
          >
            Live
          </span>
        )}
      </div>

      {/* ── Human-readable status description ────────────────── */}
      {description && (
        <p
          className={styles.statusLocationDesc}
          aria-label={`Status: ${description}`}
        >
          {description}
        </p>
      )}

      {/* ── Last-known location (from most recent scan event) ─── */}
      {currentLocation && (
        <div
          className={styles.statusLocationRow}
          aria-label={`Last known location: ${currentLocation}`}
        >
          {/* Location pin icon */}
          <svg
            className={styles.statusLocationPin}
            viewBox="0 0 12 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 1a5 5 0 0 1 5 5c0 3.5-5 9-5 9S1 9.5 1 6a5 5 0 0 1 5-5Z" />
            <circle cx="6" cy="6" r="1.5" />
          </svg>
          <span className={styles.statusLocationText}>{currentLocation}</span>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

/** Loading skeleton — shown while the action is in flight. */
function LoadingState() {
  return (
    <div
      className={styles.loadingState}
      aria-busy="true"
      aria-label="Looking up tracking information…"
    >
      <span className={styles.loadingSpinner} aria-hidden="true" />
      <span className={styles.loadingText}>Looking up tracking…</span>
    </div>
  );
}

/** Error state — shown when the action fails. */
function ErrorState({
  error,
  errorCode,
  onRetry,
}: {
  error: string;
  errorCode: FedExTrackingErrorCode | null;
  onRetry: () => void;
}) {
  const isTransient = errorCode !== null && isFedExTransientError(errorCode);

  return (
    <div className={styles.errorState} role="alert">
      <svg
        className={styles.errorIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <circle cx="12" cy="16" r="0.5" fill="currentColor" />
      </svg>
      <p className={styles.errorMessage}>{error}</p>
      {isTransient && (
        <button
          type="button"
          className={styles.retryButton}
          onClick={onRetry}
          aria-label="Retry tracking lookup"
        >
          Try Again
        </button>
      )}
    </div>
  );
}

/** Tracking events timeline sub-component. */
function EventsTimeline({ events }: { events: TrackingEvent[] }) {
  if (events.length === 0) return null;

  return (
    <section
      className={styles.eventsSection}
      aria-label="FedEx tracking events"
    >
      <h3 className={styles.eventsTitle}>Scan Events</h3>
      <ol
        className={styles.eventsList}
        aria-label="Shipment scan events, most recent first"
      >
        {events.map((event, idx) => {
          const location = formatLocation(event.location);
          return (
            <li
              key={`${event.timestamp}-${idx}`}
              className={styles.eventItem}
            >
              <div className={styles.eventDot} aria-hidden="true" />
              <div className={styles.eventBody}>
                <div className={styles.eventRow}>
                  <span className={styles.eventDescription}>
                    {event.description || event.eventType}
                  </span>
                  {event.timestamp && (
                    <time
                      className={styles.eventTime}
                      dateTime={event.timestamp}
                    >
                      {formatEventTimestamp(event.timestamp)}
                    </time>
                  )}
                </div>
                {location && (
                  <span className={styles.eventLocation}>{location}</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Data state — shown when tracking data is available. */
function DataState({
  data,
  isRefreshing,
  onRefresh,
}: {
  data: TrackingData;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  // Derive last-known location from the most recent tracking event in the
  // Convex action response.  events[0] is the most recent scan event;
  // location may be absent if FedEx did not scan the package yet.
  const latestEvent = data.events[0];
  const currentLocation = latestEvent
    ? formatLocation(latestEvent.location)
    : undefined;

  return (
    <div
      className={styles.dataState}
      data-testid="tracking-status-by-number"
    >
      {/* ── Carrier header + refresh button ───────────────────── */}
      <div className={styles.statusRow}>
        <span
          className={styles.carrierBadge}
          aria-label="Carrier: FedEx"
        >
          FedEx
        </span>

        <button
          type="button"
          className={styles.refreshButton}
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label={
            isRefreshing
              ? "Refreshing FedEx tracking data…"
              : "Refresh live FedEx tracking data"
          }
          aria-busy={isRefreshing}
        >
          {isRefreshing ? (
            <>
              <span className={styles.loadingSpinner} aria-hidden="true" />
              Refreshing…
            </>
          ) : (
            <>
              <svg
                className={styles.refreshIcon}
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="1 4 1 1 4 1" />
                <path d="M1 1C3 1 7 1 9 3s3 4 3 4" />
                <polyline points="13 10 13 13 10 13" />
                <path d="M13 13C11 13 7 13 5 11S2 7 2 7" />
              </svg>
              Refresh
            </>
          )}
        </button>
      </div>

      {/*
        ── Sub-AC 2: Status and location display section ──────────
        Dedicated hero section rendering the current shipment status badge
        and last-known location directly from the Convex action response
        (api.shipping.trackShipment).

        • status          → TrackingData.status (from action response)
        • description     → TrackingData.description (from action response)
        • currentLocation → events[0].location formatted as "City, State, Country"
        • isLiveData      → always true here; this component only renders
                            when the Convex action has returned successfully
      */}
      <StatusAndLocationSection
        status={data.status}
        description={data.description}
        currentLocation={currentLocation}
        isLiveData
      />

      {/* ── Supplementary tracking details ─────────────────────── */}
      <dl className={styles.detailsGrid}>
        {/* Tracking number */}
        <div className={styles.detailItem}>
          <dt className={styles.detailLabel}>Tracking No.</dt>
          <dd
            className={`${styles.detailValue} ${styles.detailValueMono}`}
            aria-label={`Tracking number: ${data.trackingNumber}`}
          >
            {data.trackingNumber}
          </dd>
        </div>

        {/* Estimated delivery */}
        {data.estimatedDelivery && (
          <div className={styles.detailItem}>
            <dt className={styles.detailLabel}>Est. Delivery</dt>
            <dd className={styles.detailValue}>
              {formatDeliveryDate(data.estimatedDelivery)}
            </dd>
          </div>
        )}
      </dl>

      {/* ── Events timeline ────────────────────────────────────── */}
      <EventsTimeline events={data.events} />
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

/**
 * TrackingStatusByNumber
 *
 * SCAN app component that accepts a FedEx tracking number and auto-fetches
 * live tracking status from the FedEx Track API via the Convex action
 * `api.shipping.trackShipment`.
 *
 * The action is called automatically:
 *   • On component mount (when `trackingNumber` is non-empty)
 *   • Whenever `trackingNumber` changes (useEffect dependency)
 *
 * A "Refresh" button allows technicians to re-poll on demand after the
 * initial auto-fetch.
 *
 * @example
 *   // Basic usage — auto-fetches on mount
 *   <TrackingStatusByNumber trackingNumber="794644823741" />
 *
 *   // With refresh callback to sync parent state
 *   <TrackingStatusByNumber
 *     trackingNumber={shipment.trackingNumber}
 *     onRefresh={(data) => setLiveData(data)}
 *   />
 */
export function TrackingStatusByNumber({
  trackingNumber,
  className,
  onRefresh,
}: TrackingStatusByNumberProps) {
  // ── Convex action ──────────────────────────────────────────────────────────
  // useAction returns an imperative caller — unlike useQuery, it does NOT
  // subscribe reactively. We call it manually inside the useEffect below.
  const trackShipmentAction = useAction(api.shipping.trackShipment);

  // ── Internal state ─────────────────────────────────────────────────────────
  const [state, setState] = useState<TrackingStatusState>({
    isLoading: false,
    error: null,
    errorCode: null,
    data: null,
  });

  // ── Stable ref for the onRefresh callback ──────────────────────────────────
  // Using a ref prevents `fetchTracking` from being recreated (and the
  // useEffect from re-firing) just because the parent re-renders with a new
  // function reference for onRefresh.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  // ── Core fetch function ────────────────────────────────────────────────────
  // Extracted so both the useEffect and the manual refresh button can call it.
  // The `cancelled` parameter prevents stale state updates from orphaned calls
  // when trackingNumber changes before the previous call resolves.
  const fetchTracking = useCallback(
    async (tn: string, opts?: { cancelled?: () => boolean }) => {
      const isCancelled = opts?.cancelled ?? (() => false);

      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
        errorCode: null,
      }));

      try {
        const result = await trackShipmentAction({
          trackingNumber: tn,
        });

        if (isCancelled()) return;

        // Normalise into our local TrackingData shape (avoids server-side imports)
        const normalized: TrackingData = {
          trackingNumber: result.trackingNumber,
          status: result.status,
          description: result.description,
          estimatedDelivery: result.estimatedDelivery,
          events: (result.events ?? []).map((e) => ({
            timestamp: e.timestamp,
            eventType: e.eventType,
            description: e.description,
            location: {
              city: e.location?.city,
              state: e.location?.state,
              country: e.location?.country,
            },
          })),
        };

        setState({
          isLoading: false,
          error: null,
          errorCode: null,
          data: normalized,
        });

        // Call via ref to avoid re-creating fetchTracking when onRefresh changes
        onRefreshRef.current?.(normalized);
      } catch (err) {
        if (isCancelled()) return;

        const userMessage = getFedExUserErrorMessage(err);
        const raw = err instanceof Error ? err.message : String(err);
        const code = parseFedExErrorCode(raw);

        setState({
          isLoading: false,
          error: userMessage,
          errorCode: code,
          data: null,
        });
      }
    },
    [trackShipmentAction] // onRefresh intentionally omitted — accessed via ref
  );

  // ── Auto-fetch on mount / trackingNumber change ────────────────────────────
  // This effect runs whenever trackingNumber changes. A `cancelled` flag
  // prevents stale results from a slow previous call from overwriting the
  // current state if the prop changes before it resolves.
  useEffect(() => {
    const tn = trackingNumber.trim();
    if (!tn) {
      // Empty tracking number — reset to idle state without fetching
      setState({ isLoading: false, error: null, errorCode: null, data: null });
      return;
    }

    let cancelled = false;
    fetchTracking(tn, { cancelled: () => cancelled });

    return () => {
      cancelled = true;
    };
  }, [trackingNumber, fetchTracking]);

  // ── Manual refresh handler ─────────────────────────────────────────────────
  const handleManualRefresh = useCallback(() => {
    const tn = trackingNumber.trim();
    if (!tn || state.isLoading) return;
    fetchTracking(tn);
  }, [trackingNumber, state.isLoading, fetchTracking]);

  // ── Retry after transient error ────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    const tn = trackingNumber.trim();
    if (!tn) return;
    fetchTracking(tn);
  }, [trackingNumber, fetchTracking]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const { isLoading, error, errorCode, data } = state;
  const rootClass = [styles.root, className].filter(Boolean).join(" ");

  // Initial state — no tracking number provided
  if (!trackingNumber.trim()) {
    return null;
  }

  return (
    <div className={rootClass}>
      {isLoading && <LoadingState />}

      {!isLoading && error && (
        <ErrorState
          error={error}
          errorCode={errorCode}
          onRetry={handleRetry}
        />
      )}

      {!isLoading && !error && data && (
        <DataState
          data={data}
          isRefreshing={false}
          onRefresh={handleManualRefresh}
        />
      )}
    </div>
  );
}

export default TrackingStatusByNumber;
