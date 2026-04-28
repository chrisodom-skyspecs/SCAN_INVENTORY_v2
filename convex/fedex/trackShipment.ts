/**
 * convex/fedex/trackShipment.ts
 *
 * Convex action: look up a FedEx shipment by tracking number.
 *
 * ## What this does
 * Accepts a FedEx tracking number, acquires a bearer token via the shared
 * two-layer OAuth cache in `lib/fedexAuth.ts`, calls the FedEx Track v1 API,
 * and returns a normalised `TrackShipmentResult`.
 *
 * ## Why this file exists separately from convex/shipping.ts
 * `convex/shipping.ts` contains the full shipping workflow — mutations that
 * write to the database, internal actions that refresh persisted state, and
 * queries that serve the T3/T4 layout panels.  This file is a focused,
 * read-only action whose sole responsibility is "call FedEx and normalise the
 * response."  Keeping it separate makes the unit testable in isolation and
 * keeps the shipping workflow file from growing unbounded.
 *
 * ## Token caching
 * Uses `getBearerToken(ctx)` from `lib/fedexAuth.ts`, which provides:
 *   Layer 1 — process-level cache (~0 ms for warm workers)
 *   Layer 2 — Convex DB cache via `fedexTokenCache` table (~1–5 ms)
 *   Layer 3 — fresh FedEx OAuth exchange (~200–500 ms, cold start only)
 *
 * This avoids a fresh OAuth call on every action invocation, which is
 * important under the <200 ms p50 map endpoint latency budget.
 *
 * ## Registered as
 *   api.fedex.trackShipment
 *
 * ## Client usage
 * ```typescript
 * const result = await convex.action(api.fedex.trackShipment, {
 *   trackingNumber: "794644823741",
 * });
 * // result.trackingNumber  → "794644823741"
 * // result.status          → "in_transit"
 * // result.statusCode      → "IT"
 * // result.estimatedDelivery → "2025-06-03T20:00:00Z" (or undefined)
 * // result.lastLocation    → { city: "Memphis", state: "TN", country: "US" }
 * // result.events          → [{ timestamp, eventType, description, location }, ...]
 * ```
 *
 * ## Environment variables (set in Convex dashboard)
 *   FEDEX_CLIENT_ID        OAuth2 client ID from FedEx Developer Portal
 *   FEDEX_CLIENT_SECRET    OAuth2 client secret
 *   FEDEX_API_BASE_URL     Optional override (defaults to https://apis.fedex.com)
 *                          Set to https://apis-sandbox.fedex.com for sandbox
 *   FEDEX_ACCOUNT_NUMBER   Optional account number for enhanced tracking
 */

import { action } from "../_generated/server";
import { v } from "convex/values";
import { getBearerToken, invalidateBearerTokenCache } from "../lib/fedexAuth";
import type { GenericActionCtx } from "convex/server";

// ─── Tracking number validation ───────────────────────────────────────────────

/**
 * Validate that a string is a plausible FedEx tracking number before sending
 * it to the FedEx API.
 *
 * This is a fast, offline heuristic — it rejects obviously invalid input so
 * we don't burn an API call on garbage data.  FedEx occasionally introduces
 * new formats, so the function only rejects input that is clearly wrong:
 *   • Empty / whitespace-only strings
 *   • Strings shorter than 10 characters after trimming
 *   • Strings with non-alphanumeric characters (except leading "DT" for door tags)
 *
 * Valid formats (reference: FedEx Track API docs):
 *   • Express / Ground  : 12 digits              e.g. 794644823741
 *   • Ground 96 series  : 15, 20, or 22 digits   e.g. 961234567890123
 *   • SmartPost         : 20–22 digits starting with 92
 *   • Door Tag          : "DT" + 12+ digits       e.g. DT000123456789012
 *
 * @param trackingNumber  The tracking number string to validate (will be trimmed).
 * @returns `true` when the number passes basic heuristic checks; `false` otherwise.
 */
export function isValidFedExTrackingNumber(trackingNumber: string): boolean {
  const tn = trackingNumber.trim();
  if (!tn) return false;

  // Door tag format: "DT" prefix followed by at least 12 digits
  if (/^DT\d{12,}$/i.test(tn)) return true;

  // All other FedEx formats are numeric-only and at least 10 digits long.
  // Some integrations add spaces or dashes — reject those as we expect the
  // user to enter the raw number from the label.
  if (/^\d{10,}$/.test(tn)) return true;

  return false;
}

// ─── Action context type ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActionCtx = GenericActionCtx<any>;

// ─── Normalised status type ───────────────────────────────────────────────────

/**
 * Normalised shipment status mapped from raw FedEx status codes.
 * Matches the `shipmentStatus` union in convex/schema.ts, plus "unknown" for
 * unrecognised or absent codes.
 */
export type ShipmentStatus =
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception"
  | "unknown";

// ─── Output types ─────────────────────────────────────────────────────────────

/**
 * A single scan event from the FedEx tracking timeline.
 * Events are ordered most-recent-first (as FedEx returns them).
 */
export interface TrackShipmentEvent {
  /** ISO-8601 timestamp string as returned by FedEx. */
  timestamp: string;
  /** Short FedEx event type code (e.g. "PU" = picked up, "OD" = out for delivery). */
  eventType: string;
  /** Human-readable event description (e.g. "Picked up", "On FedEx vehicle for delivery"). */
  description: string;
  /** Location where this scan event occurred. */
  location: {
    city?: string;
    state?: string;
    country?: string;
  };
}

/**
 * Normalised result returned by the `trackShipment` action.
 *
 * Field contract:
 *   trackingNumber    — tracking number as returned by FedEx (may differ from
 *                       input when FedEx normalises formatting)
 *   status            — normalised status from STATUS_CODE_MAP; "unknown" when
 *                       the code is absent or not in the map
 *   statusCode        — raw FedEx two-letter code (e.g. "DL", "IT", "OD");
 *                       empty string when absent in the API response
 *   statusDescription — human-readable description from the FedEx response
 *                       (statusByLocale preferred, falls back to description)
 *   estimatedDelivery — ISO-8601 string from FedEx ETA window or
 *                       dateAndTimes ESTIMATED_DELIVERY entry; undefined when
 *                       FedEx does not provide an estimate
 *   lastLocation      — city/state/country extracted from events[0] (the most
 *                       recent scan event); undefined when events is empty
 *   events            — all scan events most-recent-first; empty array when
 *                       FedEx returns no scanEvents
 */
export interface TrackShipmentResult {
  trackingNumber: string;
  status: ShipmentStatus;
  statusCode: string;
  statusDescription: string;
  estimatedDelivery?: string;
  lastLocation?: {
    city?: string;
    state?: string;
    country?: string;
  };
  events: TrackShipmentEvent[];
}

// ─── Status code map ──────────────────────────────────────────────────────────

/**
 * FedEx status code → normalised ShipmentStatus.
 *
 * Reference: FedEx Track API "Status Codes" documentation.
 * Codes not present in this map fall through to "unknown".
 *
 * Kept in sync with:
 *   • convex/fedexClient.ts STATUS_CODE_MAP
 *   • src/lib/fedex.ts STATUS_CODE_MAP
 */
const STATUS_CODE_MAP: Record<string, ShipmentStatus> = {
  // Label created / pre-shipment
  OC: "label_created",   // shipment created, not yet picked up
  PX: "label_created",   // pre-shipment info sent to FedEx

  // Picked up
  PU: "picked_up",       // package picked up from shipper

  // In transit
  AR: "in_transit",      // arrived at FedEx facility
  IT: "in_transit",      // in transit to destination
  DP: "in_transit",      // departed FedEx facility
  AO: "in_transit",      // at origin location
  CC: "in_transit",      // clearance in compliance
  CD: "in_transit",      // clearance delay
  CP: "in_transit",      // clearance in progress
  EA: "in_transit",      // enroute to airport
  EN: "in_transit",      // en route
  HL: "in_transit",      // held at location
  LP: "in_transit",      // late package

  // Out for delivery
  OD: "out_for_delivery", // on FedEx vehicle for delivery

  // Delivered
  DL: "delivered",       // delivered to recipient

  // Exception / problem
  SE: "exception",       // return / shipment exception
  DE: "exception",       // delivery exception
  CA: "exception",       // shipment cancelled
  RS: "exception",       // return to sender
};

/**
 * Map a raw FedEx status code to the normalised ShipmentStatus.
 * Case-insensitive; falls back to "unknown" for unrecognised codes.
 */
function normalizeStatus(code?: string): ShipmentStatus {
  if (!code) return "unknown";
  return STATUS_CODE_MAP[code.toUpperCase()] ?? "unknown";
}

// ─── Config helpers ───────────────────────────────────────────────────────────

/** Resolved FedEx API base URL (production unless overridden by env var). */
function getBaseUrl(): string {
  const override = process.env.FEDEX_API_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, ""); // strip trailing slash
  return "https://apis.fedex.com";
}

// ─── API call ─────────────────────────────────────────────────────────────────

/**
 * Call the FedEx Track v1 API for a single tracking number.
 *
 * Uses `getBearerToken(ctx)` to obtain the auth token through the two-layer
 * cache (process + DB), so a fresh OAuth exchange only happens on cold starts
 * or when the cached token is within 60 s of expiry.
 *
 * On 401 "Unauthorized" responses, the token cache is invalidated so the next
 * call to `getBearerToken` will re-authenticate.  The error is then thrown
 * rather than retried to avoid unbounded recursion in Convex actions.
 *
 * @throws Error with a bracketed error code prefix, e.g.:
 *   "[NETWORK_ERROR] ..."
 *   "[AUTH_ERROR] ..."
 *   "[NOT_FOUND] ..."
 *   "[RATE_LIMITED] ..."
 *   "[SERVER_ERROR] ..."
 *   "[PARSE_ERROR] ..."
 *   "[UNKNOWN_ERROR] ..."
 */
async function callFedExTrackApi(
  ctx: ActionCtx,
  trackingNumber: string
): Promise<unknown> {
  const token = await getBearerToken(ctx);
  const url = `${getBaseUrl()}/track/v1/trackingnumbers`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-locale": "en_US",
  };

  // Include account number when configured — some FedEx endpoints return
  // additional detail when this header is present.
  const accountNumber = process.env.FEDEX_ACCOUNT_NUMBER?.trim();
  if (accountNumber) {
    headers["x-customer-transaction-id"] = accountNumber;
  }

  const requestBody = {
    includeDetailedScans: true,
    trackingInfo: [
      {
        trackingNumberInfo: {
          trackingNumber,
        },
      },
    ],
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    throw new Error(
      `[NETWORK_ERROR] Unable to reach FedEx Track API. ` +
      `Check network connectivity from the Convex runtime. (${String(err)})`
    );
  }

  // Token may have been revoked externally — invalidate both cache layers so
  // the next invocation will obtain a fresh token.
  if (response.status === 401) {
    await invalidateBearerTokenCache(ctx);
    throw new Error(
      "[AUTH_ERROR] FedEx API rejected the bearer token (401 Unauthorized). " +
      "Token cache has been cleared — the next call will re-authenticate. " +
      "Verify FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET are correct."
    );
  }

  if (response.status === 404) {
    throw new Error("[NOT_FOUND] FedEx Track API returned 404 Not Found.");
  }

  if (response.status === 429) {
    throw new Error(
      "[RATE_LIMITED] FedEx API rate limit exceeded. " +
      "Retry after a short delay."
    );
  }

  if (response.status >= 500) {
    const errBody = await response.text().catch(() => "(unreadable)");
    throw new Error(
      `[SERVER_ERROR] FedEx API returned server error ${response.status}: ${errBody}`
    );
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => "(unreadable)");
    throw new Error(
      `[UNKNOWN_ERROR] FedEx API returned unexpected status ${response.status}: ${errBody}`
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error(
      "[PARSE_ERROR] FedEx Track API response is not valid JSON."
    );
  }

  return json;
}

// ─── Response normalisation ───────────────────────────────────────────────────

/**
 * Normalise the raw FedEx Track v1 JSON response into a `TrackShipmentResult`.
 *
 * FedEx response envelope structure:
 * ```
 * {
 *   output: {
 *     completeTrackResults: [
 *       {
 *         trackingInfo: [
 *           {
 *             trackingNumber: "...",
 *             latestStatusDetail: { code, description, statusByLocale },
 *             estimatedDeliveryTimeWindow: { window: { ends } },
 *             dateAndTimes: [{ type: "ESTIMATED_DELIVERY", dateTime }],
 *             scanEvents: [{ timestamp, eventType, eventDescription, address }],
 *           }
 *         ]
 *       }
 *     ]
 *   },
 *   errors: [{ code, message }]   // present on 200-with-error responses
 * }
 * ```
 *
 * @param raw                     Raw parsed JSON from the FedEx API.
 * @param originalTrackingNumber  The number supplied by the caller; used in
 *                                error messages and as fallback when FedEx does
 *                                not return a tracking number.
 *
 * @throws Error with a bracketed error code prefix on any parse failure.
 */
function normalizeTrackingResponse(
  raw: unknown,
  originalTrackingNumber: string
): TrackShipmentResult {
  const data = raw as Record<string, unknown>;

  // ── Check for API-level errors ────────────────────────────────────────────
  // FedEx sometimes returns HTTP 200 with an `errors` array instead of a
  // non-2xx status code.  Translate these to typed errors.
  const errors = data["errors"] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(errors) && errors.length > 0) {
    const firstError = errors[0];
    if (firstError?.["code"] === "TRACKING.TRACKINGNUMBER.NOTFOUND") {
      throw new Error(
        `[NOT_FOUND] Tracking number "${originalTrackingNumber}" was not found in the FedEx system.`
      );
    }
    throw new Error(
      `[UNKNOWN_ERROR] FedEx returned an error: ` +
      `${String(firstError?.["message"] ?? "unknown error")} ` +
      `(code: ${String(firstError?.["code"] ?? "n/a")})`
    );
  }

  // ── Navigate to the first track result ───────────────────────────────────
  const output = data["output"] as Record<string, unknown> | undefined;
  const completeTrackResults = output?.["completeTrackResults"] as
    | Array<Record<string, unknown>>
    | undefined;

  const firstResult = completeTrackResults?.[0];
  if (!firstResult) {
    throw new Error(
      `[NOT_FOUND] No tracking result found for "${originalTrackingNumber}". ` +
      "FedEx returned an empty completeTrackResults array."
    );
  }

  const trackingInfoArr = firstResult["trackingInfo"] as
    | Array<Record<string, unknown>>
    | undefined;

  const trackResult = trackingInfoArr?.[0] as Record<string, unknown> | undefined;
  if (!trackResult) {
    throw new Error(
      `[NOT_FOUND] No trackingInfo entry found for "${originalTrackingNumber}".`
    );
  }

  // ── Status ────────────────────────────────────────────────────────────────
  const latestStatusDetail = trackResult["latestStatusDetail"] as
    | Record<string, unknown>
    | undefined;

  const rawStatusCode = String(latestStatusDetail?.["code"] ?? "").trim();
  const statusCode = rawStatusCode || "";
  const status = normalizeStatus(rawStatusCode);
  const statusDescription = String(
    latestStatusDetail?.["statusByLocale"] ??
    latestStatusDetail?.["description"] ??
    "Unknown"
  );

  // ── Estimated delivery ────────────────────────────────────────────────────
  // Primary source: estimatedDeliveryTimeWindow.window.ends
  // Fallback:       dateAndTimes entry with type "ESTIMATED_DELIVERY"
  const estimatedDeliveryTimeWindow = trackResult[
    "estimatedDeliveryTimeWindow"
  ] as Record<string, unknown> | undefined;

  const estWindow = estimatedDeliveryTimeWindow?.["window"] as
    | Record<string, unknown>
    | undefined;

  const dateAndTimes = trackResult["dateAndTimes"] as
    | Array<Record<string, unknown>>
    | undefined;

  const estimatedDelivery: string | undefined =
    (estWindow?.["ends"] as string | undefined) ??
    (dateAndTimes
      ?.find((d) => d["type"] === "ESTIMATED_DELIVERY")
      ?.["dateTime"] as string | undefined);

  // ── Scan events ───────────────────────────────────────────────────────────
  // FedEx returns events most-recent-first; preserve that order.
  const rawScanEvents = (
    trackResult["scanEvents"] as Array<Record<string, unknown>> | undefined
  ) ?? [];

  const events: TrackShipmentEvent[] = rawScanEvents.map((event) => {
    const address = event["address"] as Record<string, unknown> | undefined;
    return {
      timestamp: String(event["timestamp"] ?? ""),
      eventType: String(event["eventType"] ?? ""),
      description: String(event["eventDescription"] ?? ""),
      location: {
        city: address?.["city"] as string | undefined,
        state: address?.["stateOrProvinceCode"] as string | undefined,
        country: address?.["countryCode"] as string | undefined,
      },
    };
  });

  // ── Last location ─────────────────────────────────────────────────────────
  // Derive from the most recent scan event (events[0]).
  // Returns undefined when no scan events are available (e.g. pre-pickup).
  const lastLocation: TrackShipmentResult["lastLocation"] =
    events.length > 0
      ? {
          city: events[0].location.city,
          state: events[0].location.state,
          country: events[0].location.country,
        }
      : undefined;

  // ── Tracking number ───────────────────────────────────────────────────────
  // FedEx may normalise the tracking number format (e.g. strip spaces).
  // Use FedEx's returned value; fall back to the original if absent.
  const returnedTrackingNumber = String(
    trackResult["trackingNumber"] ?? originalTrackingNumber
  );

  return {
    trackingNumber: returnedTrackingNumber,
    status,
    statusCode,
    statusDescription,
    estimatedDelivery,
    lastLocation,
    events,
  };
}

// ─── Convex action ────────────────────────────────────────────────────────────

/**
 * Public Convex action: look up a FedEx tracking number and return a
 * normalised tracking status object.
 *
 * Registered as: `api.fedex.trackShipment`
 *
 * This action does NOT write to the database.  To persist tracking data,
 * use:
 *   • `api.shipping.shipCase`          — create a shipment record
 *   • `internal.shipping.refreshShipmentTracking` — update an existing record
 *
 * Error behaviour:
 *   All FedEx API errors are rethrown as plain `Error` instances with a
 *   bracketed error code prefix so clients can parse them:
 *   ```
 *   try {
 *     const result = await convex.action(api.fedex.trackShipment, { trackingNumber });
 *   } catch (err) {
 *     const msg = err instanceof Error ? err.message : String(err);
 *     if (msg.startsWith("[NOT_FOUND]"))  // ...
 *     if (msg.startsWith("[RATE_LIMITED]")) // ...
 *   }
 *   ```
 *
 * @param trackingNumber  FedEx tracking number (whitespace is stripped).
 *
 * @returns `TrackShipmentResult` on success.
 * @throws  Plain Error with "[CODE] message" prefix on any failure.
 */
export const trackShipment = action({
  args: {
    /** FedEx tracking number entered by the user. Whitespace is stripped. */
    trackingNumber: v.string(),
  },

  handler: async (ctx, args): Promise<TrackShipmentResult> => {
    const tn = args.trackingNumber.trim();

    // ── Input validation ────────────────────────────────────────────────────
    if (!tn) {
      throw new Error(
        "[INVALID_TRACKING_NUMBER] trackingNumber must be a non-empty string."
      );
    }

    // Reject obviously invalid tracking number formats before calling the API.
    // This avoids wasting an FedEx API call on garbage input and returns a
    // descriptive error code the client can parse for user-friendly messaging.
    if (!isValidFedExTrackingNumber(tn)) {
      throw new Error(
        `[INVALID_TRACKING_NUMBER] "${tn}" does not look like a valid FedEx tracking number. ` +
        "FedEx tracking numbers are numeric and at least 10 digits long " +
        "(or start with 'DT' followed by 12+ digits for door tags)."
      );
    }

    const raw = await callFedExTrackApi(ctx, tn);
    return normalizeTrackingResponse(raw, tn);
  },
});
