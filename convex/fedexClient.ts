/**
 * convex/fedexClient.ts
 *
 * FedEx Track API client for use within Convex actions.
 *
 * This module is a Convex-internal helper — it mirrors the logic in
 * src/lib/fedex.ts but is placed inside the convex/ directory so that
 * action files can import it.  (Convex functions cannot import from src/.)
 *
 * Key differences from src/lib/fedex.ts:
 *   • No in-process token cache — Convex actions run in serverless processes
 *     that do not persist between invocations, so caching is not beneficial.
 *   • Errors are plain `Error` instances with a `code` property rather than a
 *     custom class, keeping the module dependency-free.
 *   • Zod is not used — validation is done with plain type guards to avoid
 *     bundling Zod into every Convex action.
 *
 * Environment variables (set in Convex dashboard):
 *   FEDEX_CLIENT_ID        OAuth2 client ID
 *   FEDEX_CLIENT_SECRET    OAuth2 client secret
 *   FEDEX_API_BASE_URL     Optional override (defaults to production)
 *   FEDEX_ACCOUNT_NUMBER   Optional account number for enhanced tracking
 */

// ─── Error ────────────────────────────────────────────────────────────────────

export type FedExErrorCode =
  | "CONFIGURATION_ERROR"
  | "AUTH_ERROR"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "PARSE_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

export class FedExClientError extends Error {
  readonly code: FedExErrorCode;
  readonly statusCode?: number;
  readonly raw?: unknown;

  constructor(
    code: FedExErrorCode,
    message: string,
    options?: { statusCode?: number; raw?: unknown }
  ) {
    super(message);
    this.name = "FedExClientError";
    this.code = code;
    this.statusCode = options?.statusCode;
    this.raw = options?.raw;
  }
}

// ─── Config helpers ───────────────────────────────────────────────────────────

function getBaseUrl(): string {
  const override = process.env.FEDEX_API_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  return "https://apis.fedex.com";
}

function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId     = process.env.FEDEX_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.FEDEX_CLIENT_SECRET?.trim() ?? "";

  if (!clientId || !clientSecret) {
    throw new FedExClientError(
      "CONFIGURATION_ERROR",
      "FedEx credentials are not configured. " +
        "Set FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET in the Convex dashboard."
    );
  }

  return { clientId, clientSecret };
}

function getAccountNumber(): string | undefined {
  return process.env.FEDEX_ACCOUNT_NUMBER?.trim() || undefined;
}

// ─── OAuth token acquisition ──────────────────────────────────────────────────

/**
 * Fetch a fresh OAuth 2.0 bearer token from FedEx.
 *
 * No caching — Convex actions are serverless and do not retain in-memory
 * state between invocations.  Tokens are acquired fresh per action call.
 */
async function fetchBearerToken(): Promise<string> {
  const { clientId, clientSecret } = getCredentials();
  const url = `${getBaseUrl()}/oauth/token`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     clientId,
        client_secret: clientSecret,
      }).toString(),
    });
  } catch (err) {
    throw new FedExClientError(
      "NETWORK_ERROR",
      "Unable to reach FedEx OAuth endpoint. Check network connectivity.",
      { raw: err }
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new FedExClientError(
      "AUTH_ERROR",
      `FedEx OAuth failed with status ${response.status}.`,
      { statusCode: response.status, raw: body }
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new FedExClientError(
      "PARSE_ERROR",
      "FedEx OAuth response is not valid JSON."
    );
  }

  const data = json as Record<string, unknown>;
  const access_token = data["access_token"];
  if (typeof access_token !== "string" || !access_token) {
    throw new FedExClientError(
      "PARSE_ERROR",
      "FedEx OAuth response did not contain a valid access_token.",
      { raw: json }
    );
  }

  return access_token;
}

// ─── Authenticated POST helper ────────────────────────────────────────────────

async function fedexPost<T>(path: string, body: unknown): Promise<T> {
  const token = await fetchBearerToken();
  const url   = `${getBaseUrl()}${path}`;

  const headers: Record<string, string> = {
    "Content-Type":  "application/json",
    Accept:          "application/json",
    Authorization:   `Bearer ${token}`,
    "X-locale":      "en_US",
  };

  const accountNumber = getAccountNumber();
  if (accountNumber) {
    headers["x-customer-transaction-id"] = accountNumber;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method:  "POST",
      headers,
      body:    JSON.stringify(body),
    });
  } catch (err) {
    throw new FedExClientError(
      "NETWORK_ERROR",
      "Unable to reach FedEx API. Check network connectivity.",
      { raw: err }
    );
  }

  if (response.status === 401) {
    throw new FedExClientError(
      "AUTH_ERROR",
      "FedEx API rejected the bearer token (401). Check credentials.",
      { statusCode: 401 }
    );
  }

  if (response.status === 404) {
    throw new FedExClientError("NOT_FOUND", "Tracking number not found.", {
      statusCode: 404,
    });
  }

  if (response.status === 429) {
    throw new FedExClientError(
      "RATE_LIMITED",
      "FedEx API rate limit exceeded. Retry after a short delay.",
      { statusCode: 429 }
    );
  }

  if (response.status >= 500) {
    const errBody = await response.text().catch(() => "(unreadable)");
    throw new FedExClientError(
      "SERVER_ERROR",
      `FedEx API returned server error ${response.status}.`,
      { statusCode: response.status, raw: errBody }
    );
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => "(unreadable)");
    throw new FedExClientError(
      "UNKNOWN_ERROR",
      `FedEx API returned unexpected status ${response.status}.`,
      { statusCode: response.status, raw: errBody }
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new FedExClientError(
      "PARSE_ERROR",
      "FedEx API response is not valid JSON."
    );
  }

  return json as T;
}

// ─── Status normalisation ─────────────────────────────────────────────────────

export type FedExShipmentStatus =
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception"
  | "unknown";

const STATUS_CODE_MAP: Record<string, FedExShipmentStatus> = {
  // Label / pre-shipment
  OC: "label_created",
  PX: "label_created",

  // Picked up
  PU: "picked_up",

  // In transit
  AR: "in_transit",
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

  // Out for delivery
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

// ─── Public types ─────────────────────────────────────────────────────────────

/** A single scan event from the FedEx tracking timeline. */
export interface FedExTrackingEvent {
  /** ISO-8601 timestamp string (as returned by FedEx). */
  timestamp: string;
  /** Short event type code (e.g. "PU", "OD", "DL"). */
  eventType: string;
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
  /** Tracking number as returned by FedEx (may differ by formatting). */
  trackingNumber: string;
  /** Normalised status mapped from FedEx status code. */
  status: FedExShipmentStatus;
  /** Raw status description from FedEx (e.g. "In transit", "Delivered"). */
  description: string;
  /** Estimated delivery date (ISO-8601 string), if available. */
  estimatedDelivery?: string;
  /** Scan events, most recent first (as FedEx returns them). */
  events: FedExTrackingEvent[];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Look up a FedEx tracking number and return normalised shipment status.
 *
 * Intended for use inside Convex actions only — never call from queries or
 * mutations (which cannot make outbound HTTP requests).
 *
 * @param trackingNumber  The FedEx tracking number entered by the user.
 *                        Leading/trailing whitespace is stripped.
 *
 * @throws {FedExClientError} with `code` set on every failure path.
 */
export async function fetchTrackingData(
  trackingNumber: string
): Promise<FedExTrackingResult> {
  const tn = trackingNumber.trim();
  if (!tn) {
    throw new FedExClientError(
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

  // Navigate the FedEx response envelope
  const data = raw as Record<string, unknown>;

  // Check for API-level errors (FedEx returns 200 with errors array on some failures)
  const errors = data["errors"] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(errors) && errors.length > 0) {
    const firstError = errors[0];
    if (firstError?.["code"] === "TRACKING.TRACKINGNUMBER.NOTFOUND") {
      throw new FedExClientError(
        "NOT_FOUND",
        "Tracking number not found in FedEx system.",
        { raw: firstError }
      );
    }
    throw new FedExClientError(
      "UNKNOWN_ERROR",
      String(firstError?.["message"] ?? "FedEx returned an error."),
      { raw: firstError }
    );
  }

  // Navigate nested structure: output.completeTrackResults[0].trackingInfo[0]
  const output = data["output"] as Record<string, unknown> | undefined;
  const completeTrackResults = output?.["completeTrackResults"] as
    | Array<Record<string, unknown>>
    | undefined;

  const firstResult = completeTrackResults?.[0];
  if (!firstResult) {
    throw new FedExClientError(
      "NOT_FOUND",
      `No tracking information found for tracking number "${tn}".`
    );
  }

  const trackingInfoArr = firstResult["trackingInfo"] as
    | Array<Record<string, unknown>>
    | undefined;

  const trackResult = trackingInfoArr?.[0] as Record<string, unknown> | undefined;
  if (!trackResult) {
    throw new FedExClientError(
      "NOT_FOUND",
      `No tracking information found for tracking number "${tn}".`
    );
  }

  // Normalise status
  const latestStatusDetail = trackResult["latestStatusDetail"] as
    | Record<string, unknown>
    | undefined;

  const statusCode  = latestStatusDetail?.["code"] as string | undefined;
  const status      = normaliseStatus(statusCode);
  const description = String(
    latestStatusDetail?.["statusByLocale"] ??
    latestStatusDetail?.["description"] ??
    "Unknown"
  );

  // Normalise estimated delivery
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

  // Normalise scan events
  const rawScanEvents = (
    trackResult["scanEvents"] as Array<Record<string, unknown>> | undefined
  ) ?? [];

  const events: FedExTrackingEvent[] = rawScanEvents.map((event) => {
    const address = event["address"] as Record<string, unknown> | undefined;
    return {
      timestamp:   String(event["timestamp"]        ?? ""),
      eventType:   String(event["eventType"]        ?? ""),
      description: String(event["eventDescription"] ?? ""),
      location: {
        city:    address?.["city"]                as string | undefined,
        state:   address?.["stateOrProvinceCode"] as string | undefined,
        country: address?.["countryCode"]         as string | undefined,
      },
    };
  });

  // The tracking number returned by FedEx may differ from input (normalised)
  const returnedTrackingNumber =
    String(trackResult["trackingNumber"] ?? tn);

  return {
    trackingNumber: returnedTrackingNumber,
    status,
    description,
    estimatedDelivery,
    events,
  };
}

/**
 * Map a normalised FedExShipmentStatus to the Convex shipmentStatus
 * literal strings used in the database schema.
 *
 * The "unknown" status has no direct schema counterpart; it maps to
 * "in_transit" as the safest fallback.
 */
export function toConvexShipmentStatus(
  status: FedExShipmentStatus
):
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception" {
  const map: Record<
    FedExShipmentStatus,
    | "label_created"
    | "picked_up"
    | "in_transit"
    | "out_for_delivery"
    | "delivered"
    | "exception"
  > = {
    label_created:    "label_created",
    picked_up:        "picked_up",
    in_transit:       "in_transit",
    out_for_delivery: "out_for_delivery",
    delivered:        "delivered",
    exception:        "exception",
    unknown:          "in_transit", // fallback — treat unknown as in_transit
  };
  return map[status];
}
