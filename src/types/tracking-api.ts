/**
 * src/types/tracking-api.ts
 *
 * Public TypeScript contract for the GET /api/tracking/[trackingNumber] endpoint.
 *
 * This file defines the request and response shapes consumed by:
 *   • src/app/api/tracking/[trackingNumber]/route.ts          (server)
 *   • src/lib/tracking-client.ts                              (client wrapper)
 *
 * Sub-AC 3 of AC 380003: Implement read-only tracking endpoint integration with
 * request/response typing and error handling.
 *
 * The endpoint is a thin same-origin proxy in front of the Convex action
 * `api.shipping.trackShipment`.  It exists so:
 *
 *   1. The browser can request tracking data without making a cross-origin
 *      Convex call.  This avoids CORS preflight latency and keeps the
 *      existing Kinde JWT cookie/header auth boundary identical to other
 *      Next.js API routes (e.g. /api/cases/map, /api/telemetry).
 *
 *   2. Server-side renderers and other Next.js routes (RSC, Route Handlers)
 *      can fetch tracking data without re-implementing the FedEx action
 *      contract.
 *
 *   3. Errors are mapped from the bracketed `[CODE] message` Convex
 *      convention to clean HTTP status codes the browser fetch API can
 *      branch on without parsing free-form messages.
 *
 * The endpoint is GET / read-only — calling it never writes to Convex,
 * does not call `createShipment`, and does not refresh a persisted
 * shipment row.  Downstream consumers that need to persist tracking data
 * should use the existing Convex mutations directly.
 */

import {
  type FedExTrackingErrorCode,
} from "@/lib/fedex-tracking-errors";

// ─── Status enums (shared with Convex action contract) ───────────────────────

/**
 * Normalised tracking status returned by the endpoint.
 *
 * Mirrors `ShipmentStatus` in `convex/actions/trackShipment.ts` and
 * `convex/fedex/trackShipment.ts`.  "unknown" appears when FedEx returns a
 * status code that is not in the project's STATUS_CODE_MAP — clients should
 * render this as "Unknown" rather than crashing.
 */
export type TrackingApiStatus =
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception"
  | "unknown";

// ─── Response shapes ──────────────────────────────────────────────────────────

/**
 * A single FedEx scan event returned in the tracking response.
 *
 * Field semantics:
 *   timestamp  — ISO-8601 timestamp string from FedEx.  May be the empty
 *                string when FedEx omits the value on a particular event.
 *   eventType  — Two-letter FedEx event code (e.g. "PU", "OD", "DL").
 *                Empty string when absent.
 *   description — Human-readable description (e.g. "Picked up", "Delivered").
 *   location   — City / state / country triplet.  Each field is optional
 *                because FedEx omits city/state on international scans and
 *                country on intra-state scans.
 */
export interface TrackingApiEvent {
  /** ISO-8601 timestamp string from FedEx (may be empty when omitted). */
  timestamp: string;
  /** Two-letter FedEx event code (may be empty when omitted). */
  eventType: string;
  /** Human-readable event description. */
  description: string;
  /** Where this scan happened.  Each subfield is optional. */
  location: {
    city?: string;
    state?: string;
    country?: string;
  };
}

/**
 * Successful response body from GET /api/tracking/[trackingNumber].
 *
 * Always returned with HTTP 200.  All fields are populated even when the
 * shipment is pre-pickup (`events` will be an empty array, `lastLocation`
 * and `estimatedDelivery` will be undefined).
 */
export interface TrackingApiResult {
  /** FedEx tracking number as returned by FedEx (may differ in formatting from input). */
  trackingNumber: string;
  /** Normalised status — see {@link TrackingApiStatus}. */
  status: TrackingApiStatus;
  /** Raw two-letter FedEx status code (e.g. "IT", "DL").  Empty string when absent. */
  statusCode: string;
  /** Human-readable status description (e.g. "In transit"). */
  statusDescription: string;
  /** ISO-8601 estimated delivery, or undefined when FedEx hasn't computed one. */
  estimatedDelivery?: string;
  /** Most recent scan location, or undefined when no scans yet. */
  lastLocation?: {
    city?: string;
    state?: string;
    country?: string;
  };
  /** All scan events, most-recent-first.  Empty when pre-pickup. */
  events: TrackingApiEvent[];
}

/**
 * Successful response wrapper.
 *
 * Wrapping the result in `{ ok: true, data }` keeps the discriminated union
 * pattern symmetric with {@link TrackingApiErrorBody} so clients can use a
 * single union narrowing branch:
 *
 *   const body = await res.json() as TrackingApiResponseBody;
 *   if (body.ok) { … body.data … } else { … body.error … }
 */
export interface TrackingApiSuccessBody {
  ok: true;
  data: TrackingApiResult;
}

// ─── Error shapes ─────────────────────────────────────────────────────────────

/**
 * Machine-readable error codes returned by the endpoint.
 *
 * These are a strict subset of the Convex action `FedExTrackingErrorCode`
 * values plus two endpoint-specific codes:
 *
 *   AUTH_REQUIRED — caller did not provide a Kinde access token
 *   SERVICE_UNAVAILABLE — server is missing NEXT_PUBLIC_CONVEX_URL
 *
 * The mapping from Convex action codes to HTTP status is tabulated in
 * {@link TRACKING_API_STATUS_MAP} below.
 */
export type TrackingApiErrorCode =
  | "AUTH_REQUIRED"
  | "INVALID_TRACKING_NUMBER"
  | "NOT_FOUND"
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "PARSE_ERROR"
  | "CONFIGURATION_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "UNKNOWN_ERROR";

/**
 * Error response body returned for any non-2xx status.
 *
 * Wrapping in `{ ok: false }` mirrors {@link TrackingApiSuccessBody}.
 *
 *   • `code`     is the machine-readable error code clients should branch on.
 *   • `message`  is a human-readable description safe to log; it may include
 *                the input tracking number for "not found" errors but never
 *                contains sensitive credentials.
 */
export interface TrackingApiErrorBody {
  ok: false;
  code: TrackingApiErrorCode;
  message: string;
  /** HTTP status code as a numeric literal — duplicates the response status for convenience. */
  status: 400 | 401 | 404 | 408 | 429 | 500 | 502 | 503;
}

/**
 * Discriminated union of every possible response body shape.
 *
 * Use the `ok` boolean as the discriminator:
 *
 *   const body: TrackingApiResponseBody = await res.json();
 *   if (body.ok) {
 *     // body is TrackingApiSuccessBody — body.data is the tracking result
 *   } else {
 *     // body is TrackingApiErrorBody — body.code / body.message
 *   }
 */
export type TrackingApiResponseBody =
  | TrackingApiSuccessBody
  | TrackingApiErrorBody;

// ─── Status code mapping ──────────────────────────────────────────────────────

/**
 * Mapping from Convex action error code → HTTP status code returned by this
 * endpoint.
 *
 * Rationale:
 *   • 400 — input was malformed (callers can fix it).
 *   • 401 — missing / invalid Kinde JWT.
 *   • 404 — tracking number not in FedEx system.
 *   • 429 — FedEx 429 (rate-limited).  Surface to the browser so it can
 *           back off rather than retrying immediately.
 *   • 502 — FedEx upstream returned a non-2xx (we are a gateway).
 *   • 503 — server configuration error or transient unavailability.
 *   • 500 — catch-all for unexpected failure modes.
 */
export const TRACKING_API_STATUS_MAP: Record<
  TrackingApiErrorCode,
  TrackingApiErrorBody["status"]
> = {
  AUTH_REQUIRED: 401,
  INVALID_TRACKING_NUMBER: 400,
  NOT_FOUND: 404,
  AUTH_ERROR: 502,           // upstream FedEx auth failure — we are the gateway
  RATE_LIMITED: 429,
  SERVER_ERROR: 502,         // upstream FedEx 5xx
  NETWORK_ERROR: 502,        // upstream FedEx unreachable
  PARSE_ERROR: 502,          // upstream FedEx returned bad JSON
  CONFIGURATION_ERROR: 503,
  SERVICE_UNAVAILABLE: 503,
  UNKNOWN_ERROR: 500,
} as const;

// ─── Error message defaults ───────────────────────────────────────────────────

/**
 * Default human-readable messages keyed by error code.
 *
 * The route handler may override these with a more specific message (e.g.
 * including the bad tracking number for INVALID_TRACKING_NUMBER), but these
 * provide a safe fallback when the underlying Convex error message is empty
 * or contains internal details that should not be surfaced.
 */
export const TRACKING_API_ERROR_MESSAGES: Record<TrackingApiErrorCode, string> = {
  AUTH_REQUIRED:
    "Authentication required. Provide a valid Kinde access token via the Authorization header.",
  INVALID_TRACKING_NUMBER:
    "The tracking number is not in a valid FedEx format.",
  NOT_FOUND:
    "Tracking number was not found in the FedEx system.",
  AUTH_ERROR:
    "Upstream tracking provider rejected its credentials.",
  RATE_LIMITED:
    "Too many tracking requests. Retry after a short delay.",
  SERVER_ERROR:
    "Upstream tracking provider returned a server error. Try again later.",
  NETWORK_ERROR:
    "Unable to reach the upstream tracking provider.",
  PARSE_ERROR:
    "Upstream tracking provider returned an unexpected response.",
  CONFIGURATION_ERROR:
    "Tracking integration is not configured. Contact your administrator.",
  SERVICE_UNAVAILABLE:
    "Tracking service is temporarily unavailable. Try again later.",
  UNKNOWN_ERROR:
    "An unexpected error occurred while looking up tracking.",
};

// ─── Mapping from Convex bracketed code → endpoint code ───────────────────────

/**
 * Project-internal mapping from the bracketed code thrown by the Convex
 * `api.shipping.trackShipment` action to the endpoint's
 * {@link TrackingApiErrorCode}.
 *
 * The Convex codes already match 1:1 for most cases; this table exists so
 * the endpoint can layer on its own codes (AUTH_REQUIRED, SERVICE_UNAVAILABLE)
 * and so future additions to either side don't accidentally drift.
 *
 * Codes not in this map are treated as UNKNOWN_ERROR, which produces HTTP 500.
 */
export const CONVEX_ERROR_CODE_TO_API_CODE: Record<
  FedExTrackingErrorCode,
  TrackingApiErrorCode
> = {
  INVALID_TRACKING_NUMBER: "INVALID_TRACKING_NUMBER",
  NOT_FOUND: "NOT_FOUND",
  AUTH_ERROR: "AUTH_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  SERVER_ERROR: "SERVER_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  PARSE_ERROR: "PARSE_ERROR",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
};

/**
 * The full set of {@link TrackingApiErrorCode} values, ordered for stable
 * iteration in tests.  Keep in sync with the union above.
 */
export const TRACKING_API_ERROR_CODES: TrackingApiErrorCode[] = [
  "AUTH_REQUIRED",
  "INVALID_TRACKING_NUMBER",
  "NOT_FOUND",
  "AUTH_ERROR",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "NETWORK_ERROR",
  "PARSE_ERROR",
  "CONFIGURATION_ERROR",
  "SERVICE_UNAVAILABLE",
  "UNKNOWN_ERROR",
];
