"use node";

/**
 * convex/actions/trackShipment.ts
 *
 * Convex action: look up a FedEx shipment by tracking number.
 *
 * ## Responsibilities
 * This file is the orchestration layer for FedEx tracking lookups. It wires
 * together three concerns, each handled by a dedicated module:
 *
 *   1. Auth          — `lib/fedexAuth.ts`  (getBearerToken, invalidateBearerTokenCache)
 *   2. HTTP call     — `lib/fedexTrack.ts` (fetchTrackingInfo, FedExTrackError)
 *   3. Normalisation — inline below        (normalizeTrackingResponse)
 *
 * The action is read-only: it never writes to the Convex database. To persist
 * tracking data, use the mutations in `convex/shipping.ts`.
 *
 * ## Token caching
 * `getBearerToken(ctx)` provides a two-layer cache:
 *   Layer 1 — process-level module variable (~0 ms, warm Convex workers)
 *   Layer 2 — Convex DB cache via `fedexTokenCache` table (~1–5 ms)
 *   Layer 3 — fresh FedEx OAuth exchange (~200–500 ms, cold path only)
 *
 * On a 401 response from `fetchTrackingInfo`, both cache layers are
 * invalidated via `invalidateBearerTokenCache(ctx)` so the next call will
 * re-authenticate. The error is then re-thrown as a plain bracketed Error
 * rather than retrying to avoid unbounded recursion in Convex actions.
 *
 * ## Registered as
 *   api.actions.trackShipment
 *
 * ## Client usage
 * ```typescript
 * const result = await convex.action(api.actions.trackShipment, {
 *   trackingNumber: "794644823741",
 * });
 * // result.trackingNumber     → "794644823741"
 * // result.status             → "in_transit"
 * // result.statusCode         → "IT"
 * // result.statusDescription  → "In transit"
 * // result.estimatedDelivery  → "2025-06-03T20:00:00Z" (or undefined)
 * // result.lastLocation       → { city: "Memphis", state: "TN", country: "US" }
 * // result.events             → [{ timestamp, eventType, description, location }, ...]
 * ```
 *
 * ## Error codes (thrown as `Error` with bracketed prefix)
 *   [AUTH_REQUIRED]            — caller is not authenticated
 *   [INVALID_TRACKING_NUMBER]  — input failed format validation
 *   [AUTH_ERROR]               — FedEx rejected the bearer token (401)
 *   [NOT_FOUND]                — tracking number not in FedEx system
 *   [RATE_LIMITED]             — FedEx returned 429
 *   [SERVER_ERROR]             — FedEx returned 5xx
 *   [PARSE_ERROR]              — FedEx response was not valid JSON, or had
 *                                unexpected shape
 *   [NETWORK_ERROR]            — fetch() threw (DNS failure, timeout, etc.)
 *   [UNKNOWN_ERROR]            — any other non-2xx response
 *
 * Clients can parse the prefix to show user-friendly messages:
 * ```typescript
 * try {
 *   const result = await convex.action(api.actions.trackShipment, { trackingNumber });
 * } catch (err) {
 *   const msg = err instanceof Error ? err.message : String(err);
 *   if (msg.startsWith("[NOT_FOUND]"))   { /* show not-found message *\/ }
 *   if (msg.startsWith("[RATE_LIMITED]")) { /* prompt to retry later *\/ }
 * }
 * ```
 *
 * ## Environment variables (set in Convex dashboard)
 *   FEDEX_CLIENT_ID        OAuth2 client ID from FedEx Developer Portal
 *   FEDEX_CLIENT_SECRET    OAuth2 client secret
 *   FEDEX_API_BASE_URL     Optional override (defaults to https://apis.fedex.com)
 *                          Set to https://apis-sandbox.fedex.com for sandbox
 *   FEDEX_ACCOUNT_NUMBER   Optional account number for enhanced tracking detail
 */

import { action } from "../_generated/server";
import { v } from "convex/values";
import type { GenericActionCtx } from "convex/server";
import {
  getBearerToken,
  invalidateBearerTokenCache,
} from "../lib/fedexAuth";
import {
  fetchTrackingInfo,
  FedExTrackError,
} from "../lib/fedexTrack";

// ─── Action context type ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActionCtx = GenericActionCtx<any>;

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Assert that the calling client has a verified Kinde JWT.
 * Throws `[AUTH_REQUIRED]` for unauthenticated requests so the caller can
 * distinguish auth failures from FedEx API errors.
 */
async function requireAuth(ctx: ActionCtx): Promise<void> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token. " +
      "Ensure the client is wrapped in ConvexProviderWithAuth and the user is signed in."
    );
  }
}

// ─── Tracking number validation ───────────────────────────────────────────────

/**
 * Validate that a string is a plausible FedEx tracking number.
 *
 * This is a fast, offline heuristic — it rejects obviously invalid input so
 * we don't burn an API call on garbage data. FedEx occasionally introduces
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
  if (/^\d{10,}$/.test(tn)) return true;

  return false;
}

// ─── Normalised status type ───────────────────────────────────────────────────

/**
 * Normalised shipment status mapped from raw FedEx status codes.
 *
 * Matches the `shipmentStatus` union in `convex/schema.ts`, plus `"unknown"`
 * for unrecognised or absent codes.
 *
 * Kept in sync with:
 *   • convex/fedex/trackShipment.ts  ShipmentStatus
 *   • convex/fedexClient.ts          FedExShipmentStatus
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
  /** Tracking number as returned by FedEx (may differ from input by formatting). */
  trackingNumber: string;
  /** Normalised status; "unknown" when the raw FedEx code is not recognised. */
  status: ShipmentStatus;
  /** Raw two-letter FedEx status code (e.g. "IT", "DL", "OD"). Empty string when absent. */
  statusCode: string;
  /** Human-readable status description from FedEx (statusByLocale preferred). */
  statusDescription: string;
  /** ISO-8601 estimated delivery date string from FedEx; undefined when not provided. */
  estimatedDelivery?: string;
  /**
   * Location of the most recent scan event (events[0]).
   * undefined when FedEx returns no scan events (e.g. pre-pickup).
   */
  lastLocation?: {
    city?: string;
    state?: string;
    country?: string;
  };
  /** All scan events, most-recent-first. Empty array when no events are available. */
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
 *   • convex/fedex/trackShipment.ts  STATUS_CODE_MAP
 *   • convex/fedexClient.ts          STATUS_CODE_MAP
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

// ─── Response normalisation ───────────────────────────────────────────────────

/**
 * Map the raw FedEx Track v1 JSON response to a normalised `TrackShipmentResult`.
 *
 * FedEx response envelope shape (abridged):
 * ```json
 * {
 *   "output": {
 *     "completeTrackResults": [
 *       {
 *         "trackingInfo": [
 *           {
 *             "trackingNumber": "794644823741",
 *             "latestStatusDetail": {
 *               "code": "IT",
 *               "description": "In transit",
 *               "statusByLocale": "In transit"
 *             },
 *             "estimatedDeliveryTimeWindow": {
 *               "window": { "ends": "2025-06-03T20:00:00Z" }
 *             },
 *             "dateAndTimes": [
 *               { "type": "ESTIMATED_DELIVERY", "dateTime": "2025-06-03T20:00:00Z" }
 *             ],
 *             "scanEvents": [
 *               {
 *                 "timestamp": "2025-06-02T14:30:00Z",
 *                 "eventType": "AR",
 *                 "eventDescription": "Arrived at FedEx location",
 *                 "address": {
 *                   "city": "Memphis",
 *                   "stateOrProvinceCode": "TN",
 *                   "countryCode": "US"
 *                 }
 *               }
 *             ]
 *           }
 *         ]
 *       }
 *     ]
 *   },
 *   "errors": []
 * }
 * ```
 *
 * @param raw                     Raw parsed JSON from the FedEx Track v1 API.
 * @param originalTrackingNumber  The tracking number supplied by the caller;
 *                                used in error messages and as a fallback when
 *                                FedEx does not echo back the tracking number.
 *
 * @throws Error with bracketed prefix on any structural parse failure.
 */
function normalizeTrackingResponse(
  raw: unknown,
  originalTrackingNumber: string
): TrackShipmentResult {
  const data = raw as Record<string, unknown>;

  // ── Check for API-level errors ─────────────────────────────────────────────
  // FedEx sometimes returns HTTP 200 with an `errors` array instead of a
  // non-2xx status code. Translate these into typed bracketed errors.
  const errors = data["errors"] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(errors) && errors.length > 0) {
    const firstError = errors[0];
    if (firstError?.["code"] === "TRACKING.TRACKINGNUMBER.NOTFOUND") {
      throw new Error(
        `[NOT_FOUND] Tracking number "${originalTrackingNumber}" was not found ` +
        "in the FedEx system. Verify the number and try again."
      );
    }
    throw new Error(
      `[UNKNOWN_ERROR] FedEx returned an API error: ` +
      `${String(firstError?.["message"] ?? "unknown error")} ` +
      `(code: ${String(firstError?.["code"] ?? "n/a")})`
    );
  }

  // ── Navigate to the first track result ────────────────────────────────────
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

  const trackResult = trackingInfoArr?.[0] as
    | Record<string, unknown>
    | undefined;
  if (!trackResult) {
    throw new Error(
      `[NOT_FOUND] No trackingInfo entry found for "${originalTrackingNumber}". ` +
      "The FedEx response was missing the expected trackingInfo array."
    );
  }

  // ── Status code + description ─────────────────────────────────────────────
  const latestStatusDetail = trackResult["latestStatusDetail"] as
    | Record<string, unknown>
    | undefined;

  const rawStatusCode = String(latestStatusDetail?.["code"] ?? "").trim();
  const statusCode = rawStatusCode; // preserve raw value; empty string when absent
  const status = normalizeStatus(rawStatusCode);

  // Prefer the locale-specific description when available (e.g. "In transit")
  // over the short description field (e.g. "IT").
  const statusDescription = String(
    latestStatusDetail?.["statusByLocale"] ??
    latestStatusDetail?.["description"] ??
    "Unknown"
  );

  // ── Estimated delivery ────────────────────────────────────────────────────
  // Primary: estimatedDeliveryTimeWindow.window.ends
  // Fallback: dateAndTimes entry with type === "ESTIMATED_DELIVERY"
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

  const events: TrackShipmentEvent[] = rawScanEvents.map(
    (event): TrackShipmentEvent => {
      const address = event["address"] as
        | Record<string, unknown>
        | undefined;
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
    }
  );

  // ── Last location ─────────────────────────────────────────────────────────
  // Derived from the most recent scan event (events[0]).
  // undefined when no events exist (e.g. label created but not yet picked up).
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

// ─── Error translation ────────────────────────────────────────────────────────

/**
 * Translate a `FedExTrackError` (from `lib/fedexTrack.ts`) into a plain Error
 * with a bracketed error code prefix that clients can parse.
 *
 * The bracketed prefix scheme (`[CODE] message`) allows clients to extract a
 * machine-readable code without needing to import Convex-internal error classes.
 *
 * On `AUTH_ERROR`, the token cache is invalidated via `invalidateBearerTokenCache`
 * so the next call will re-authenticate. The error is then re-thrown rather than
 * retried to prevent unbounded recursion inside a Convex action.
 *
 * @param err  The `FedExTrackError` to translate.
 * @param ctx  Convex action context; required to invalidate the token cache on AUTH_ERROR.
 * @returns    A plain `Error` with a `[CODE]` prefix — never returns normally.
 */
async function translateTrackError(
  err: FedExTrackError,
  ctx: ActionCtx
): Promise<never> {
  if (err.code === "AUTH_ERROR") {
    // Token was rejected by FedEx — clear both cache layers so the next
    // invocation will perform a fresh OAuth exchange.
    await invalidateBearerTokenCache(ctx);
    throw new Error(
      "[AUTH_ERROR] FedEx API rejected the bearer token (401 Unauthorized). " +
      "Token cache has been cleared — the next call will re-authenticate. " +
      "Verify FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET are correct."
    );
  }

  // Map remaining FedExTrackError codes to bracketed prefixes.
  // The error codes in lib/fedexTrack.ts match the bracketed prefix names
  // used throughout the SCAN app error handling conventions.
  const prefix = `[${err.code}]`;
  throw new Error(`${prefix} ${err.message}`);
}

// ─── Convex action ────────────────────────────────────────────────────────────

/**
 * Public Convex action: look up a FedEx tracking number and return a
 * normalised tracking status object.
 *
 * Registered as: `api.actions.trackShipment`
 *
 * ## What this action does
 * 1. Asserts the caller is authenticated (Kinde JWT via Convex auth).
 * 2. Validates the tracking number format (offline heuristic — no API call).
 * 3. Obtains a FedEx bearer token via the two-layer cache in `lib/fedexAuth.ts`.
 * 4. Calls the FedEx Track v1 API via `lib/fedexTrack.ts`.
 * 5. Maps the raw response to a normalised `TrackShipmentResult`.
 * 6. Returns the typed result to the caller.
 *
 * ## What this action does NOT do
 * This action does NOT write to the Convex database. To persist tracking data:
 *   • Use `api.shipping.shipCase`           — create a new shipment record
 *   • Use `internal.shipping.refreshShipmentTracking` — refresh an existing record
 *
 * ## Auth requirement
 * The caller must provide a valid Kinde access token via the Convex client's
 * `ConvexProviderWithAuth` wrapper. Unauthenticated calls throw `[AUTH_REQUIRED]`.
 *
 * @param trackingNumber  FedEx tracking number entered by the user. Whitespace
 *                        is stripped before validation and API call.
 *
 * @returns `TrackShipmentResult` on success.
 * @throws  Plain Error with `[CODE] message` prefix on any failure.
 */
export const trackShipment = action({
  args: {
    /** FedEx tracking number entered by the user. Whitespace is stripped. */
    trackingNumber: v.string(),
  },

  handler: async (ctx, args): Promise<TrackShipmentResult> => {
    // ── Step 1: Auth check ──────────────────────────────────────────────────
    await requireAuth(ctx);

    const tn = args.trackingNumber.trim();

    // ── Step 2: Input validation ────────────────────────────────────────────
    if (!tn) {
      throw new Error(
        "[INVALID_TRACKING_NUMBER] trackingNumber must be a non-empty string."
      );
    }

    if (!isValidFedExTrackingNumber(tn)) {
      throw new Error(
        `[INVALID_TRACKING_NUMBER] "${tn}" does not look like a valid FedEx tracking number. ` +
        "FedEx tracking numbers are numeric and at least 10 digits long " +
        "(or start with 'DT' followed by 12+ digits for door tags)."
      );
    }

    // ── Step 3: Acquire bearer token ────────────────────────────────────────
    // getBearerToken uses the two-layer cache (process + DB) so a fresh OAuth
    // exchange only happens on cold starts or when the cached token is within
    // 60 s of expiry. This keeps p50 latency well under the <200 ms budget.
    let token: string;
    try {
      token = await getBearerToken(ctx);
    } catch (err) {
      // Auth configuration errors (missing credentials, network failure during
      // OAuth) are thrown as FedExAuthError from lib/fedexAuth. Re-throw with
      // the appropriate bracketed prefix so clients can parse them.
      const message = err instanceof Error ? err.message : String(err);
      // FedExAuthError messages already contain the error type in their message.
      // Wrap with a consistent prefix if not already present.
      if (message.startsWith("[")) {
        throw new Error(message);
      }
      throw new Error(`[CONFIGURATION_ERROR] ${message}`);
    }

    // ── Step 4: Call FedEx Track API ────────────────────────────────────────
    let raw: unknown;
    try {
      raw = await fetchTrackingInfo(tn, token);
    } catch (err) {
      if (err instanceof FedExTrackError) {
        // translateTrackError handles token cache invalidation on AUTH_ERROR
        // and always throws — it never returns normally.
        await translateTrackError(err, ctx);
      }
      // Non-FedExTrackError (should not normally occur, but guard defensively)
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[UNKNOWN_ERROR] Unexpected error calling FedEx Track API: ${message}`);
    }

    // ── Step 5: Normalise response ──────────────────────────────────────────
    // normalizeTrackingResponse navigates the FedEx response envelope and
    // extracts: statusCode, statusDescription, estimatedDelivery, lastLocation,
    // and the full events array. Throws [NOT_FOUND] / [PARSE_ERROR] on
    // structural issues.
    return normalizeTrackingResponse(raw, tn);
  },
});
