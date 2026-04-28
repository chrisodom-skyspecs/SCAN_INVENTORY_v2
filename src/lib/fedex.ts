/**
 * FedEx Tracking Client — server-side module.
 *
 * Provides a thin, reusable wrapper around the FedEx Track API v1.
 * Responsibilities:
 *   • OAuth 2.0 token acquisition and in-process caching (token refresh
 *     handled automatically on expiry).
 *   • Structured tracking data fetch for a single tracking number.
 *   • Normalised error handling — every failure path throws a `FedExError`
 *     with a machine-readable `code` and a human-readable `message`.
 *
 * Constraints (per project spec)
 * ────────────────────────────────
 *   • Tracking number entry only — no shipment creation.
 *   • All calls are server-side (Route Handlers / Server Actions / Convex
 *     actions).  Credentials are never exposed to the browser.
 *
 * Environment variables (required unless using sandbox defaults)
 * ──────────────────────────────────────────────────────────────
 *   FEDEX_CLIENT_ID        OAuth2 client ID from FedEx Developer Portal
 *   FEDEX_CLIENT_SECRET    OAuth2 client secret from FedEx Developer Portal
 *   FEDEX_API_BASE_URL     (optional) Override base URL; defaults to
 *                          production https://apis.fedex.com.
 *                          Set to https://apis-sandbox.fedex.com for sandbox.
 *   FEDEX_ACCOUNT_NUMBER   (optional) FedEx account number; some endpoints
 *                          require this for enhanced tracking detail.
 *
 * Usage
 * ─────
 *   import { trackPackage } from "@/lib/fedex";
 *
 *   const result = await trackPackage("794644823741");
 *   // result.status      → "in_transit"
 *   // result.description → "In transit"
 *   // result.events      → [{ timestamp, location, description }, ...]
 */

import { z } from "zod";

// ─── Configuration ─────────────────────────────────────────────────────────────

const FEDEX_PRODUCTION_BASE = "https://apis.fedex.com";
const FEDEX_SANDBOX_BASE    = "https://apis-sandbox.fedex.com";

/** Resolved base URL (production unless overridden via env). */
function getBaseUrl(): string {
  const override = process.env.FEDEX_API_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, ""); // strip trailing slash
  return FEDEX_PRODUCTION_BASE;
}

/** Client credentials pulled from environment. */
function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId     = process.env.FEDEX_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.FEDEX_CLIENT_SECRET?.trim() ?? "";

  if (!clientId || !clientSecret) {
    throw new FedExError(
      "CONFIGURATION_ERROR",
      "FedEx credentials are not configured. " +
        "Set FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET environment variables."
    );
  }

  return { clientId, clientSecret };
}

/** Optional account number for enhanced tracking. */
function getAccountNumber(): string | undefined {
  return process.env.FEDEX_ACCOUNT_NUMBER?.trim() || undefined;
}

// ─── Errors ────────────────────────────────────────────────────────────────────

/** Machine-readable error codes returned by this module. */
export type FedExErrorCode =
  | "CONFIGURATION_ERROR"   // Missing / invalid env vars
  | "AUTH_ERROR"            // Failed to obtain OAuth token
  | "NOT_FOUND"             // Tracking number not found
  | "RATE_LIMITED"          // FedEx 429 response
  | "SERVER_ERROR"          // FedEx 5xx response
  | "PARSE_ERROR"           // Unexpected response shape
  | "NETWORK_ERROR"         // fetch() threw (DNS, timeout, etc.)
  | "UNKNOWN_ERROR";        // Catch-all

/**
 * Structured error thrown by all functions in this module.
 * Callers should narrow on `error.code` to decide how to handle failures.
 *
 * @example
 * try {
 *   await trackPackage(trackingNumber);
 * } catch (err) {
 *   if (err instanceof FedExError) {
 *     if (err.code === "NOT_FOUND") return { status: "unknown" };
 *     if (err.code === "RATE_LIMITED") // retry after delay
 *   }
 *   throw err;
 * }
 */
export class FedExError extends Error {
  readonly code: FedExErrorCode;
  readonly statusCode?: number;   // HTTP status when applicable
  readonly raw?: unknown;         // Original error / response body for debugging

  constructor(
    code: FedExErrorCode,
    message: string,
    options?: { statusCode?: number; raw?: unknown }
  ) {
    super(message);
    this.name = "FedExError";
    this.code = code;
    this.statusCode = options?.statusCode;
    this.raw = options?.raw;
  }
}

// ─── OAuth token cache ─────────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string;
  /** Epoch ms when the token expires (conservative — expires 60 s early). */
  expiresAt: number;
}

/** In-process token cache — reused across requests within the same process. */
let _tokenCache: CachedToken | null = null;

const oauthTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type:   z.string(),
  expires_in:   z.number(), // seconds
});

/**
 * Fetch a new OAuth 2.0 access token from FedEx.
 * Tokens are cached in-process and reused until 60 s before expiry.
 *
 * @internal — use via `getBearerToken()` rather than calling directly.
 */
async function fetchOAuthToken(): Promise<string> {
  const { clientId, clientSecret } = getCredentials();
  const url = `${getBaseUrl()}/oauth/token`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept":        "application/json",
      },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     clientId,
        client_secret: clientSecret,
      }).toString(),
    });
  } catch (err) {
    throw new FedExError(
      "NETWORK_ERROR",
      "Unable to reach FedEx OAuth endpoint. Check network connectivity.",
      { raw: err }
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new FedExError(
      "AUTH_ERROR",
      `FedEx OAuth failed with status ${response.status}.`,
      { statusCode: response.status, raw: body }
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new FedExError("PARSE_ERROR", "FedEx OAuth response is not valid JSON.");
  }

  const parsed = oauthTokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new FedExError(
      "PARSE_ERROR",
      "FedEx OAuth response did not match expected shape.",
      { raw: json }
    );
  }

  const { access_token, expires_in } = parsed.data;
  // Cache with 60 s safety margin
  _tokenCache = {
    accessToken: access_token,
    expiresAt:   Date.now() + (expires_in - 60) * 1_000,
  };

  return access_token;
}

/**
 * Return a valid bearer token, refreshing if necessary.
 * Handles the in-process token cache transparently.
 */
async function getBearerToken(): Promise<string> {
  if (_tokenCache && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.accessToken;
  }
  return fetchOAuthToken();
}

/**
 * Invalidate the token cache (e.g., after a 401 response so the next
 * call re-authenticates rather than retrying with a stale token).
 */
function invalidateTokenCache(): void {
  _tokenCache = null;
}

// ─── Zod schemas for Track API response ───────────────────────────────────────

const fedExTrackingEventSchema = z.object({
  timestamp:         z.string().optional(),
  eventType:         z.string().optional(),
  eventDescription:  z.string().optional(),
  address: z.object({
    city:        z.string().optional(),
    stateOrProvinceCode: z.string().optional(),
    countryCode: z.string().optional(),
  }).optional(),
}).passthrough();

const fedExTrackResultSchema = z.object({
  trackingNumber: z.string(),
  latestStatusDetail: z.object({
    code:        z.string().optional(),
    description: z.string().optional(),
    statusByLocale: z.string().optional(),
  }).optional(),
  dateAndTimes: z.array(
    z.object({
      type:     z.string().optional(),
      dateTime: z.string().optional(),
    })
  ).optional(),
  estimatedDeliveryTimeWindow: z.object({
    window: z.object({
      ends: z.string().optional(),
    }).optional(),
  }).optional(),
  scanEvents: z.array(fedExTrackingEventSchema).optional(),
  packageDetails: z.object({
    packagingDescription: z.object({
      description: z.string().optional(),
    }).optional(),
    weightAndDimensions: z.object({
      weight: z.array(z.object({
        unit:  z.string().optional(),
        value: z.string().optional(),
      })).optional(),
    }).optional(),
  }).optional(),
}).passthrough();

const fedExTrackResponseSchema = z.object({
  output: z.object({
    completeTrackResults: z.array(
      z.object({
        trackingInfo: z.array(fedExTrackResultSchema).optional(),
      })
    ).optional(),
  }).optional(),
  errors: z.array(
    z.object({
      code:    z.string().optional(),
      message: z.string().optional(),
    })
  ).optional(),
}).passthrough();

// ─── Normalised output types ──────────────────────────────────────────────────

/** Normalised shipment status mapped from FedEx status codes. */
export type FedExShipmentStatus =
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception"
  | "unknown";

/** A single scan event from the FedEx tracking timeline. */
export interface FedExTrackingEvent {
  /** ISO-8601 timestamp string (as returned by FedEx). */
  timestamp:   string;
  /** Short event type code (e.g. "PU", "OD", "DL"). */
  eventType:   string;
  /** Human-readable event description. */
  description: string;
  /** Location where the event occurred. */
  location: {
    city?:    string;
    state?:   string;
    country?: string;
  };
}

/** Normalised result from a successful tracking lookup. */
export interface FedExTrackingResult {
  trackingNumber: string;
  /** Normalised status mapped from FedEx status code. */
  status:         FedExShipmentStatus;
  /** Raw status description from FedEx (e.g. "In transit", "Delivered"). */
  description:    string;
  /** Estimated delivery date (ISO-8601 string), if available. */
  estimatedDelivery?: string;
  /** Chronological array of scan events (most recent first, as FedEx returns). */
  events:         FedExTrackingEvent[];
}

// ─── Status code normalisation ────────────────────────────────────────────────

/**
 * FedEx status code → normalised `FedExShipmentStatus`.
 *
 * Reference: FedEx Track API "Status Codes" documentation.
 * Codes not listed here fall through to "unknown".
 */
const STATUS_CODE_MAP: Record<string, FedExShipmentStatus> = {
  // Label / pre-shipment
  OC: "label_created",
  PX: "label_created",

  // Picked up / at FedEx facility
  PU: "picked_up",
  AR: "in_transit",

  // In transit
  IT: "in_transit",
  DP: "in_transit",
  AO: "in_transit",
  CC: "in_transit",
  CD: "in_transit",
  CP: "in_transit",
  EA: "in_transit",
  EN: "in_transit",
  HL: "in_transit",
  LP: "in_transit",
  OD: "out_for_delivery",

  // Delivered
  DL: "delivered",

  // Exception / problem
  SE: "exception",
  DE: "exception",
  CA: "exception",
  RS: "exception",
};

function normaliseStatus(code?: string): FedExShipmentStatus {
  if (!code) return "unknown";
  return STATUS_CODE_MAP[code.toUpperCase()] ?? "unknown";
}

// ─── Core API call helper ─────────────────────────────────────────────────────

/**
 * Execute an authenticated POST request to the FedEx API.
 *
 * Handles:
 *   • Bearer token injection
 *   • Automatic one-time token refresh on 401 response
 *   • HTTP error mapping to `FedExError` codes
 *
 * @internal
 */
async function fedexPost<T>(
  path: string,
  body: unknown,
  retrying = false
): Promise<T> {
  const token = await getBearerToken();
  const url   = `${getBaseUrl()}${path}`;

  const requestHeaders: Record<string, string> = {
    "Content-Type":  "application/json",
    "Accept":        "application/json",
    "Authorization": `Bearer ${token}`,
    "X-locale":      "en_US",
  };

  const accountNumber = getAccountNumber();
  if (accountNumber) {
    requestHeaders["x-customer-transaction-id"] = accountNumber;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method:  "POST",
      headers: requestHeaders,
      body:    JSON.stringify(body),
    });
  } catch (err) {
    throw new FedExError(
      "NETWORK_ERROR",
      "Unable to reach FedEx API. Check network connectivity.",
      { raw: err }
    );
  }

  // Token expired — refresh once and retry
  if (response.status === 401 && !retrying) {
    invalidateTokenCache();
    return fedexPost<T>(path, body, true);
  }

  if (response.status === 404) {
    throw new FedExError("NOT_FOUND", "Tracking number not found.", {
      statusCode: 404,
    });
  }

  if (response.status === 429) {
    throw new FedExError(
      "RATE_LIMITED",
      "FedEx API rate limit exceeded. Retry after a short delay.",
      { statusCode: 429 }
    );
  }

  if (response.status >= 500) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new FedExError(
      "SERVER_ERROR",
      `FedEx API returned server error ${response.status}.`,
      { statusCode: response.status, raw: body }
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new FedExError(
      "UNKNOWN_ERROR",
      `FedEx API returned unexpected status ${response.status}.`,
      { statusCode: response.status, raw: body }
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new FedExError("PARSE_ERROR", "FedEx API response is not valid JSON.");
  }

  return json as T;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up a FedEx tracking number and return normalised shipment status.
 *
 * This is the primary entry point for the SCAN / INVENTORY shipping workflow.
 * It calls the FedEx Track v1 API and normalises the response into a
 * `FedExTrackingResult` that maps cleanly to the `shipmentStatus` enum in the
 * Convex schema.
 *
 * @param trackingNumber  The FedEx tracking number entered by the user.
 *                        Leading/trailing whitespace is stripped automatically.
 *
 * @throws {FedExError} with an appropriate `code` on any failure.
 *
 * @example
 * const tracking = await trackPackage("794644823741");
 * console.log(tracking.status);      // "in_transit"
 * console.log(tracking.events[0]);   // most recent event
 */
export async function trackPackage(
  trackingNumber: string
): Promise<FedExTrackingResult> {
  const tn = trackingNumber.trim();
  if (!tn) {
    throw new FedExError(
      "UNKNOWN_ERROR",
      "trackingNumber must be a non-empty string."
    );
  }

  const requestBody = {
    includeDetailedScans: true,
    trackingInfo: [
      {
        trackingNumberInfo: {
          trackingNumber: tn,
        },
      },
    ],
  };

  const raw = await fedexPost<unknown>("/track/v1/trackingnumbers", requestBody);

  // Parse and validate response shape
  const parsed = fedExTrackResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FedExError(
      "PARSE_ERROR",
      "FedEx Track API response did not match expected schema.",
      { raw }
    );
  }

  // Check for API-level errors
  if (parsed.data.errors && parsed.data.errors.length > 0) {
    const firstError = parsed.data.errors[0];
    if (firstError?.code === "TRACKING.TRACKINGNUMBER.NOTFOUND") {
      throw new FedExError("NOT_FOUND", "Tracking number not found in FedEx system.", {
        raw: firstError,
      });
    }
    throw new FedExError(
      "UNKNOWN_ERROR",
      firstError?.message ?? "FedEx returned an error.",
      { raw: firstError }
    );
  }

  // Navigate to the first track result
  const trackResult =
    parsed.data.output?.completeTrackResults?.[0]?.trackingInfo?.[0];

  if (!trackResult) {
    throw new FedExError(
      "NOT_FOUND",
      `No tracking information found for tracking number "${tn}".`
    );
  }

  // Normalise status
  const statusCode  = trackResult.latestStatusDetail?.code;
  const status      = normaliseStatus(statusCode);
  const description =
    trackResult.latestStatusDetail?.statusByLocale ??
    trackResult.latestStatusDetail?.description ??
    "Unknown";

  // Normalise estimated delivery
  const estimatedDelivery =
    trackResult.estimatedDeliveryTimeWindow?.window?.ends ??
    trackResult.dateAndTimes?.find((d) => d.type === "ESTIMATED_DELIVERY")?.dateTime;

  // Normalise scan events
  const events: FedExTrackingEvent[] = (trackResult.scanEvents ?? []).map((event) => ({
    timestamp:   event.timestamp   ?? "",
    eventType:   event.eventType   ?? "",
    description: event.eventDescription ?? "",
    location: {
      city:    event.address?.city,
      state:   event.address?.stateOrProvinceCode,
      country: event.address?.countryCode,
    },
  }));

  return {
    trackingNumber: trackResult.trackingNumber,
    status,
    description,
    estimatedDelivery,
    events,
  };
}

// ─── Utility exports ──────────────────────────────────────────────────────────

/**
 * Validate that a string looks like a plausible FedEx tracking number.
 *
 * This is a client-safe, offline heuristic check — it does NOT call the API.
 * FedEx tracking numbers vary by service type:
 *
 *   • Express / Ground : 12 digits
 *   • Ground 96 series : 15, 20, or 22 digits starting with 96
 *   • SmartPost        : 20–22 digits starting with 92
 *   • Door Tag         : starts with DT, 15 chars total
 *
 * Numbers that don't match any known pattern still pass validation here
 * because FedEx occasionally introduces new formats.  The function only
 * rejects obviously invalid input (empty, too short, contains letters
 * when digits are expected).
 *
 * @example
 * isValidTrackingNumber("794644823741")  // → true
 * isValidTrackingNumber("")              // → false
 * isValidTrackingNumber("abc")           // → false
 */
export function isValidTrackingNumber(value: string): boolean {
  const tn = value.trim();
  if (!tn) return false;

  // Door tag format
  if (/^DT\d{12,}$/i.test(tn)) return true;

  // Numeric-only formats: at least 10 digits
  if (/^\d{10,}$/.test(tn)) return true;

  return false;
}

/**
 * Map a normalised `FedExShipmentStatus` to the Convex `shipmentStatus`
 * literal strings used in the database schema.
 *
 * The Convex schema uses snake_case literals; this function provides a
 * zero-allocation lookup rather than depending on the values being identical.
 */
export function toConvexShipmentStatus(
  status: FedExShipmentStatus
): "label_created" | "picked_up" | "in_transit" | "out_for_delivery" | "delivered" | "exception" {
  const map: Record<FedExShipmentStatus, ReturnType<typeof toConvexShipmentStatus>> = {
    label_created:     "label_created",
    picked_up:         "picked_up",
    in_transit:        "in_transit",
    out_for_delivery:  "out_for_delivery",
    delivered:         "delivered",
    exception:         "exception",
    unknown:           "in_transit", // fallback — treat unknown as in_transit
  };
  return map[status];
}

// ─── Configuration helpers (exported for testing / admin UI) ──────────────────

/** Return the currently configured FedEx base URL (production or sandbox). */
export function getFedExBaseUrl(): string {
  return getBaseUrl();
}

/** Return whether the client is configured for sandbox mode. */
export function isSandboxMode(): boolean {
  return getBaseUrl() === FEDEX_SANDBOX_BASE;
}

/** Return whether FedEx credentials are present in the environment. */
export function areFedExCredentialsConfigured(): boolean {
  return Boolean(
    process.env.FEDEX_CLIENT_ID?.trim() &&
    process.env.FEDEX_CLIENT_SECRET?.trim()
  );
}

export { FEDEX_PRODUCTION_BASE, FEDEX_SANDBOX_BASE };
