/**
 * convex/lib/fedexTrack.ts
 *
 * Low-level FedEx Track API HTTP client for use inside Convex actions.
 *
 * ## Purpose
 * Provides a single `fetchTrackingInfo(trackingNumber, accessToken)` function
 * that calls the FedEx Track v1 API and returns the raw parsed JSON response.
 *
 * This module is intentionally low-level — it accepts a pre-acquired bearer
 * token and returns the unprocessed response body without normalisation.
 * Callers are responsible for:
 *   • Obtaining the bearer token (use `getBearerToken` from `./fedexAuth`)
 *   • Normalising / validating the returned response shape
 *
 * ## Why a separate module
 * Separating the HTTP transport from token acquisition and response
 * normalisation makes each layer independently testable.  The higher-level
 * `convex/fedex/trackShipment.ts` action wires these layers together.
 *
 * ## Usage
 * ```typescript
 * import { getBearerToken } from "./fedexAuth";
 * import { fetchTrackingInfo } from "./fedexTrack";
 *
 * // Inside a Convex action:
 * const token = await getBearerToken(ctx);
 * const raw   = await fetchTrackingInfo("794644823741", token);
 * // raw is the parsed FedEx Track v1 response envelope
 * ```
 *
 * ## Environment variables (set in Convex dashboard)
 *   FEDEX_API_BASE_URL     Optional override for the FedEx base URL.
 *                          Defaults to https://apis.fedex.com (production).
 *                          Set to https://apis-sandbox.fedex.com for sandbox.
 *   FEDEX_ACCOUNT_NUMBER   Optional FedEx account number.  When present, it is
 *                          sent as the `x-customer-transaction-id` request header
 *                          to unlock enhanced tracking detail on some endpoints.
 */

// ─── Error types ──────────────────────────────────────────────────────────────

/**
 * Machine-readable error codes produced by the FedEx Track HTTP client.
 *
 * Callers should narrow on `err.code` to decide how to surface failures:
 *   INVALID_TRACKING_NUMBER — input was blank or obviously malformed
 *   INVALID_ACCESS_TOKEN    — accessToken argument was blank
 *   AUTH_ERROR              — FedEx rejected the token (HTTP 401)
 *   NOT_FOUND               — tracking number not in FedEx system (HTTP 404 or
 *                             200 with errors.code === "TRACKING.TRACKINGNUMBER.NOTFOUND")
 *   RATE_LIMITED            — FedEx returned HTTP 429
 *   SERVER_ERROR            — FedEx returned HTTP 5xx
 *   PARSE_ERROR             — response body was not valid JSON
 *   NETWORK_ERROR           — fetch() threw (DNS failure, timeout, etc.)
 *   UNKNOWN_ERROR           — any other non-2xx response
 */
export type FedExTrackErrorCode =
  | "INVALID_TRACKING_NUMBER"
  | "INVALID_ACCESS_TOKEN"
  | "AUTH_ERROR"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "PARSE_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

/**
 * Structured error thrown by `fetchTrackingInfo` on any failure path.
 *
 * @example
 * try {
 *   const raw = await fetchTrackingInfo(tn, token);
 * } catch (err) {
 *   if (err instanceof FedExTrackError) {
 *     switch (err.code) {
 *       case "AUTH_ERROR":    // token revoked — re-acquire and retry
 *       case "NOT_FOUND":     // user entered a wrong tracking number
 *       case "RATE_LIMITED":  // back off and retry later
 *       case "NETWORK_ERROR": // transient — safe to retry
 *     }
 *   }
 * }
 */
export class FedExTrackError extends Error {
  readonly code: FedExTrackErrorCode;
  /** HTTP status code when the error originated from an HTTP response. */
  readonly statusCode?: number;
  /** Raw response body or original thrown value, for debugging. */
  readonly raw?: unknown;

  constructor(
    code: FedExTrackErrorCode,
    message: string,
    options?: { statusCode?: number; raw?: unknown }
  ) {
    super(message);
    this.name = "FedExTrackError";
    this.code = code;
    this.statusCode = options?.statusCode;
    this.raw = options?.raw;
  }
}

// ─── Configuration helpers ────────────────────────────────────────────────────

/**
 * Resolve the FedEx API base URL.
 *
 * Returns the value of `FEDEX_API_BASE_URL` (stripped of trailing slash) when
 * that environment variable is set, otherwise falls back to the production URL.
 */
function getBaseUrl(): string {
  const override = process.env.FEDEX_API_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  return "https://apis.fedex.com";
}

/**
 * Read the optional FedEx account number from the Convex environment.
 *
 * Returns the value if set and non-empty, otherwise `undefined`.
 */
function getAccountNumber(): string | undefined {
  return process.env.FEDEX_ACCOUNT_NUMBER?.trim() || undefined;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call the FedEx Track v1 API for a single tracking number.
 *
 * This is a pure HTTP client function.  It does **not**:
 *   • Acquire or cache OAuth tokens (use `getBearerToken` from `./fedexAuth`)
 *   • Normalise the response (the raw parsed JSON is returned as-is)
 *   • Write to the Convex database
 *
 * The FedEx Track v1 endpoint always returns HTTP 200 for successful API calls,
 * even when the tracking number is not found — in that case the response body
 * contains an `errors` array.  This function returns the raw response in that
 * scenario and leaves it to the caller to inspect `response.errors`.
 *
 * Error semantics:
 *   • HTTP 401  → throws `FedExTrackError` with code `AUTH_ERROR`
 *   • HTTP 404  → throws `FedExTrackError` with code `NOT_FOUND`
 *   • HTTP 429  → throws `FedExTrackError` with code `RATE_LIMITED`
 *   • HTTP 5xx  → throws `FedExTrackError` with code `SERVER_ERROR`
 *   • Other non-2xx → throws `FedExTrackError` with code `UNKNOWN_ERROR`
 *   • Non-JSON body on 2xx → throws `FedExTrackError` with code `PARSE_ERROR`
 *   • Network failure → throws `FedExTrackError` with code `NETWORK_ERROR`
 *   • Blank trackingNumber → throws `FedExTrackError` with code `INVALID_TRACKING_NUMBER`
 *   • Blank accessToken    → throws `FedExTrackError` with code `INVALID_ACCESS_TOKEN`
 *
 * @param trackingNumber  The FedEx tracking number to look up.
 *                        Leading/trailing whitespace is stripped.
 *                        Must be non-empty after trimming.
 *
 * @param accessToken     A valid FedEx OAuth 2.0 bearer token.
 *                        Must be non-empty.  Obtain via `getBearerToken(ctx)`
 *                        from `./fedexAuth`.
 *
 * @returns               The raw parsed JSON response from the FedEx Track v1
 *                        API.  Shape (abridged):
 *                        ```
 *                        {
 *                          output?: {
 *                            completeTrackResults?: Array<{
 *                              trackingInfo?: Array<{
 *                                trackingNumber?: string;
 *                                latestStatusDetail?: { code, description, statusByLocale };
 *                                estimatedDeliveryTimeWindow?: { window: { ends } };
 *                                dateAndTimes?: Array<{ type, dateTime }>;
 *                                scanEvents?: Array<{ timestamp, eventType, eventDescription, address }>;
 *                              }>;
 *                            }>;
 *                          };
 *                          errors?: Array<{ code: string; message: string }>;
 *                        }
 *                        ```
 *
 * @throws {FedExTrackError} on every failure path — see error semantics above.
 */
export async function fetchTrackingInfo(
  trackingNumber: string,
  accessToken: string
): Promise<unknown> {
  // ── Input validation ──────────────────────────────────────────────────────
  const tn = trackingNumber.trim();
  if (!tn) {
    throw new FedExTrackError(
      "INVALID_TRACKING_NUMBER",
      "trackingNumber must be a non-empty string."
    );
  }

  const token = accessToken.trim();
  if (!token) {
    throw new FedExTrackError(
      "INVALID_ACCESS_TOKEN",
      "accessToken must be a non-empty string."
    );
  }

  // ── Build request ─────────────────────────────────────────────────────────
  const url = `${getBaseUrl()}/track/v1/trackingnumbers`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-locale": "en_US",
  };

  // Include account number when configured.
  // The FedEx Track API can return additional scan detail when this header is
  // present for accounts that have enhanced tracking enabled.
  const accountNumber = getAccountNumber();
  if (accountNumber) {
    headers["x-customer-transaction-id"] = accountNumber;
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

  // ── Send request ──────────────────────────────────────────────────────────
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    throw new FedExTrackError(
      "NETWORK_ERROR",
      "Unable to reach the FedEx Track API. " +
        "Check network connectivity from the Convex runtime.",
      { raw: err }
    );
  }

  // ── HTTP error handling ───────────────────────────────────────────────────

  if (response.status === 401) {
    throw new FedExTrackError(
      "AUTH_ERROR",
      "FedEx Track API rejected the bearer token (HTTP 401 Unauthorized). " +
        "The token may be expired or revoked. Re-acquire a fresh token and retry.",
      { statusCode: 401 }
    );
  }

  if (response.status === 404) {
    throw new FedExTrackError(
      "NOT_FOUND",
      "FedEx Track API returned 404 Not Found. " +
        "Verify the tracking endpoint URL is correct.",
      { statusCode: 404 }
    );
  }

  if (response.status === 429) {
    throw new FedExTrackError(
      "RATE_LIMITED",
      "FedEx Track API rate limit exceeded (HTTP 429). " +
        "Retry after a short delay.",
      { statusCode: 429 }
    );
  }

  if (response.status >= 500) {
    const errBody = await response.text().catch(() => "(unreadable)");
    throw new FedExTrackError(
      "SERVER_ERROR",
      `FedEx Track API returned a server error (HTTP ${response.status}).`,
      { statusCode: response.status, raw: errBody }
    );
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => "(unreadable)");
    throw new FedExTrackError(
      "UNKNOWN_ERROR",
      `FedEx Track API returned an unexpected status code (HTTP ${response.status}).`,
      { statusCode: response.status, raw: errBody }
    );
  }

  // ── Parse response body ───────────────────────────────────────────────────
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new FedExTrackError(
      "PARSE_ERROR",
      "FedEx Track API returned a response body that is not valid JSON."
    );
  }

  // Return raw parsed JSON — normalisation is the caller's responsibility.
  // Note: FedEx may return HTTP 200 with an `errors` array when the tracking
  // number is not found.  We do NOT inspect that here; callers must check
  // `(response as any).errors` if they care about those application-level errors.
  return json;
}

// ─── Request builder (exported for testing) ───────────────────────────────────

/**
 * Build the JSON request body for the FedEx Track v1 API.
 *
 * Exported to allow unit tests to verify the request shape without making a
 * real HTTP call.
 *
 * @param trackingNumber  The tracking number to include in the request.
 *                        Should already be trimmed.
 */
export function buildTrackRequestBody(trackingNumber: string): {
  includeDetailedScans: boolean;
  trackingInfo: Array<{
    trackingNumberInfo: { trackingNumber: string };
  }>;
} {
  return {
    includeDetailedScans: true,
    trackingInfo: [
      {
        trackingNumberInfo: {
          trackingNumber,
        },
      },
    ],
  };
}

// ─── URL helper (exported for testing) ───────────────────────────────────────

/**
 * Return the fully-qualified FedEx Track v1 endpoint URL.
 *
 * Exported to allow tests to assert the correct URL is used without coupling
 * tests to `process.env`.
 */
export function getTrackApiUrl(): string {
  return `${getBaseUrl()}/track/v1/trackingnumbers`;
}
