/**
 * cases-map-api.ts — typed client for GET /api/cases/map
 *
 * Provides:
 *   buildCasesMapUrl        — constructs the endpoint URL from typed params
 *   serializeSuccessResponse — wraps a 200 body into CasesMapApiResponse
 *   serializeErrorResponse   — wraps a 4xx/5xx body into CasesMapApiResponse
 *   fetchCasesMap            — full fetch + response deserialization
 *
 * All public symbols are pure / framework-agnostic and can be used in both
 * browser and Node.js (server components, route handlers, tests).
 *
 * Response contract:
 *   HTTP 200 → { ok: true;  status: 200;       data:  MapDataResponse }
 *   HTTP 4xx → { ok: false; status: 400|503;   error: string }
 *   HTTP 5xx → { ok: false; status: 500;       error: string }
 *   Network  → { ok: false; status: 500;       error: "Network error: …" }
 *   Bad JSON → { ok: false; status: 500;       error: "Invalid response: …" }
 */

import type {
  CasesMapApiResponse,
  CasesMapErrorResponse,
  CasesMapRequestParams,
  MapDataResponse,
} from "@/types/cases-map";

// ─── URL builder ──────────────────────────────────────────────────────────────

/**
 * Build the full URL string for GET /api/cases/map from typed request params.
 *
 * When `base` is an empty string (the default) the function returns a
 * relative URL (`/api/cases/map?…`) suitable for same-origin fetch calls.
 * Pass an explicit origin string (e.g. `"https://app.example.com"`) to get
 * an absolute URL for server-side or cross-origin requests.
 *
 * @example
 * // Relative URL (browser, same-origin fetch)
 * buildCasesMapUrl({ mode: "M3", filters: '{"hasDamage":true}' })
 * // → "/api/cases/map?mode=M3&filters=%7B%22hasDamage%22%3Atrue%7D"
 *
 * @example
 * // Absolute URL (server-side, cross-origin)
 * buildCasesMapUrl({ mode: "M1" }, "https://app.example.com")
 * // → "https://app.example.com/api/cases/map?mode=M1"
 */
export function buildCasesMapUrl(
  params: CasesMapRequestParams = {},
  base = ""
): string {
  // Use a placeholder origin when building a relative URL so the URL
  // constructor has a valid base. We strip it back off at the end.
  const placeholder = "http://localhost";
  const url = new URL("/api/cases/map", base || placeholder);

  if (params.mode !== undefined) url.searchParams.set("mode", params.mode);
  if (params.swLat !== undefined) url.searchParams.set("swLat", params.swLat);
  if (params.swLng !== undefined) url.searchParams.set("swLng", params.swLng);
  if (params.neLat !== undefined) url.searchParams.set("neLat", params.neLat);
  if (params.neLng !== undefined) url.searchParams.set("neLng", params.neLng);
  if (params.filters !== undefined)
    url.searchParams.set("filters", params.filters);

  // Strip the placeholder origin for relative URLs
  if (!base) return url.pathname + url.search;

  return url.toString();
}

// ─── Response serializers ─────────────────────────────────────────────────────

/**
 * Serialize a 200 HTTP response body into the typed success branch of
 * CasesMapApiResponse.
 *
 * Performs no runtime shape-validation — the route handler and Convex layer
 * are the canonical source of truth for the `MapDataResponse` shape.
 *
 * @param body  Parsed JSON body from a 200 response.
 */
export function serializeSuccessResponse(body: unknown): CasesMapApiResponse {
  return {
    ok: true,
    status: 200,
    data: body as MapDataResponse,
  };
}

/**
 * Serialize a 4xx/5xx HTTP response body into the typed error branch of
 * CasesMapApiResponse.
 *
 * Extracts the `error` field from a `CasesMapErrorResponse`-shaped body
 * when available, and falls back to a generic message otherwise.
 *
 * HTTP status codes are normalised to one of the three documented values
 * (400, 503, 500) — any unexpected code maps to 500 so callers only need
 * to handle the three documented states.
 *
 * @param httpStatus  The raw HTTP status code from the response.
 * @param body        Parsed JSON body (may be any shape on unexpected errors).
 */
export function serializeErrorResponse(
  httpStatus: number,
  body: unknown
): CasesMapApiResponse {
  // Normalise to one of the three documented error statuses
  const status: 400 | 503 | 500 =
    httpStatus === 400 ? 400 : httpStatus === 503 ? 503 : 500;

  // Try to extract a human-readable error message from the body
  const errorMsg =
    isErrorResponseBody(body)
      ? body.error
      : `Request failed with status ${httpStatus}`;

  return { ok: false, status, error: errorMsg };
}

/** Type guard for the CasesMapErrorResponse body shape. */
function isErrorResponseBody(
  value: unknown
): value is Pick<CasesMapErrorResponse, "error"> {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as Record<string, unknown>).error === "string"
  );
}

// ─── Full fetch + deserialize ─────────────────────────────────────────────────

/**
 * Fetch map data from GET /api/cases/map and return a fully typed
 * CasesMapApiResponse discriminated union.
 *
 * Handles:
 *   • Network failures  → { ok: false, status: 500, error: "Network error: …" }
 *   • Non-JSON bodies   → { ok: false, status: 500, error: "Invalid response: …" }
 *   • 200 success       → { ok: true,  status: 200, data: MapDataResponse }
 *   • 400 / 503 / 5xx   → { ok: false, status: …,   error: string }
 *
 * @param params    Typed query parameters for the route handler.
 * @param options   Optional fetch options (signal, headers, etc.).
 *                  The Accept and cache headers are set automatically and
 *                  will be overridden by anything in `options.headers`.
 *
 * @example
 * const result = await fetchCasesMap({ mode: "M3" });
 * if (result.ok) {
 *   // TypeScript knows result.data is MapDataResponse
 *   const mode = (result.data as M3Response).mode; // "M3"
 * } else {
 *   // TypeScript knows result.error is string, result.status is 400|503|500
 *   console.error(`[${result.status}] ${result.error}`);
 * }
 */
export async function fetchCasesMap(
  params: CasesMapRequestParams = {},
  options?: RequestInit
): Promise<CasesMapApiResponse> {
  const path = buildCasesMapUrl(params);

  // ── 1. Network fetch ───────────────────────────────────────────────────────

  let response: Response;
  try {
    response = await fetch(path, {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Spread caller headers last so they can override if needed
        ...((options?.headers as Record<string, string> | undefined) ?? {}),
      },
      cache: "no-store",
      // Spread remaining options (signal, credentials, etc.)
      ...options,
      // Re-assert our headers override after spreading options —
      // options.headers may overwrite the spread above if options has headers
    });
  } catch {
    return {
      ok: false,
      status: 500,
      error: "Network error: failed to reach the server",
    };
  }

  // ── 2. Parse JSON body ─────────────────────────────────────────────────────

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return {
      ok: false,
      status: 500,
      error: "Invalid response: server did not return valid JSON",
    };
  }

  // ── 3. Serialize into typed discriminated union ───────────────────────────

  if (response.ok) {
    return serializeSuccessResponse(json);
  }

  return serializeErrorResponse(response.status, json);
}
