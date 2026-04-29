/**
 * src/lib/tracking-client.ts
 *
 * Browser/server typed client for GET /api/tracking/[trackingNumber].
 *
 * Sub-AC 3 of AC 380003: Implement read-only tracking endpoint integration with
 * request/response typing and error handling.
 *
 * ## What this module provides
 * `fetchTracking(trackingNumber, options)` — a typed `fetch` wrapper that:
 *
 *   1. URL-encodes the tracking number into the dynamic segment.
 *   2. Forwards the caller-supplied Kinde access token in the
 *      `Authorization: Bearer <token>` header.
 *   3. Parses the JSON response into the
 *      {@link TrackingApiResponseBody} discriminated union.
 *   4. Throws a {@link TrackingApiError} on non-2xx responses with the
 *      typed code/message/status preserved for callers to branch on.
 *   5. Aborts in-flight requests when the caller's `AbortSignal` fires,
 *      mapping `DOMException("AbortError")` to `TrackingApiError`
 *      with code `UNKNOWN_ERROR` and HTTP 500.
 *
 * ## Why a dedicated client wrapper?
 * Consumers (React hooks, server components, telemetry pipelines) should
 * not have to repeat the URL construction, header injection, or JSON
 * parsing.  A typed client function localises these concerns and lets the
 * call sites focus on UX behaviour.
 *
 * ## Usage
 * ```ts
 * import { fetchTracking, TrackingApiError } from "@/lib/tracking-client";
 *
 * try {
 *   const result = await fetchTracking("794644823741", {
 *     accessToken: kindeAccessToken,
 *     signal: abortController.signal,
 *   });
 *   // result is a TrackingApiResult — see @/types/tracking-api
 * } catch (err) {
 *   if (err instanceof TrackingApiError) {
 *     if (err.code === "RATE_LIMITED") backOff();
 *     if (err.code === "NOT_FOUND")    showNotFoundMessage();
 *   }
 *   throw err;
 * }
 * ```
 */

import {
  type TrackingApiErrorBody,
  type TrackingApiErrorCode,
  type TrackingApiResponseBody,
  type TrackingApiResult,
} from "@/types/tracking-api";

// ─── Public error class ───────────────────────────────────────────────────────

/**
 * Structured error thrown by {@link fetchTracking}.
 *
 * Callers narrow on `.code` to decide how to handle the failure:
 *
 *   if (err instanceof TrackingApiError) {
 *     switch (err.code) {
 *       case "INVALID_TRACKING_NUMBER": showFormError(); break;
 *       case "NOT_FOUND":               showNotFound();  break;
 *       case "RATE_LIMITED":            scheduleRetry(); break;
 *       …
 *     }
 *   }
 */
export class TrackingApiError extends Error {
  readonly code: TrackingApiErrorCode;
  readonly status: number;

  constructor(code: TrackingApiErrorCode, message: string, status: number) {
    super(message);
    this.name = "TrackingApiError";
    this.code = code;
    this.status = status;
  }
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface FetchTrackingOptions {
  /**
   * Kinde access token to forward.  Sent as `Authorization: Bearer <token>`.
   *
   * Required for the route to authenticate against Convex.  Pass `null` or
   * omit only if you intentionally want to receive a 401 AUTH_REQUIRED
   * response (e.g. to verify the auth boundary in tests).
   */
  accessToken?: string | null;

  /**
   * Optional abort signal — typically from the caller's
   * `AbortController`.  When it fires, the in-flight fetch is cancelled
   * and a `TrackingApiError` with code `UNKNOWN_ERROR` and a message
   * indicating cancellation is thrown.
   */
  signal?: AbortSignal;

  /**
   * Override for the fetch implementation.  Defaults to the global
   * `fetch`.  Provided so unit tests can inject a mock without resorting
   * to `vi.stubGlobal`.
   */
  fetchImpl?: typeof fetch;

  /**
   * Override for the base URL.  Defaults to a relative path
   * (`/api/tracking/<trackingNumber>`), which targets the same origin as
   * the caller — appropriate for browsers running the Next.js app.
   *
   * Server-side callers (RSC, scripts, tests) should pass an absolute URL
   * such as `process.env.NEXT_PUBLIC_APP_URL` so `fetch` can resolve it.
   */
  baseUrl?: string;
}

// ─── Public function ──────────────────────────────────────────────────────────

/**
 * Fetch live FedEx tracking data for a tracking number via the read-only
 * Next.js API route.
 *
 * On success returns the {@link TrackingApiResult} payload directly
 * (unwrapped from the `{ ok: true, data }` envelope).  On failure throws
 * a {@link TrackingApiError} with the parsed error code and HTTP status.
 *
 * @param trackingNumber  The FedEx tracking number entered by the user.
 *                        Whitespace is preserved so the server can show a
 *                        precise validation error if the value is malformed.
 * @param options         See {@link FetchTrackingOptions}.
 *
 * @throws {TrackingApiError} on any non-2xx response or network failure.
 */
export async function fetchTracking(
  trackingNumber: string,
  options: FetchTrackingOptions = {},
): Promise<TrackingApiResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TrackingApiError(
      "UNKNOWN_ERROR",
      "fetch is not available in this environment.",
      500,
    );
  }

  const baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
  const url = `${baseUrl}/api/tracking/${encodeURIComponent(trackingNumber)}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: options.signal,
      // Tracking data is real-time — never cache the response.
      cache: "no-store",
    });
  } catch (err) {
    // AbortError → propagate as a typed cancellation error.
    if (
      err instanceof DOMException &&
      err.name === "AbortError"
    ) {
      throw new TrackingApiError(
        "UNKNOWN_ERROR",
        "Tracking request was aborted.",
        500,
      );
    }
    throw new TrackingApiError(
      "NETWORK_ERROR",
      err instanceof Error ? err.message : "Network failure",
      502,
    );
  }

  // Try to parse the body.  Even error responses are JSON, so failures here
  // indicate the server returned something completely unexpected.
  let body: TrackingApiResponseBody;
  try {
    body = (await response.json()) as TrackingApiResponseBody;
  } catch {
    throw new TrackingApiError(
      "PARSE_ERROR",
      `Tracking endpoint returned non-JSON response (status ${response.status}).`,
      502,
    );
  }

  if (response.ok && body.ok === true) {
    return body.data;
  }

  // Reaching this branch means either status was non-2xx or the body shape
  // did not match the success envelope.  Translate to TrackingApiError.
  const errBody = body as TrackingApiErrorBody;
  if (errBody && errBody.ok === false) {
    throw new TrackingApiError(
      errBody.code,
      errBody.message,
      errBody.status ?? response.status,
    );
  }

  // Body was JSON but didn't match either envelope shape.
  throw new TrackingApiError(
    "PARSE_ERROR",
    `Tracking endpoint returned an unexpected payload (status ${response.status}).`,
    502,
  );
}
