/**
 * GET /api/tracking/[trackingNumber] — Next.js App Router route handler
 *
 * Sub-AC 3 of AC 380003: Implement read-only tracking endpoint integration with
 * request/response typing and error handling.
 *
 * ## Why this endpoint exists
 * The SCAN mobile app and INVENTORY dashboard both consume FedEx tracking via
 * the existing Convex action `api.shipping.trackShipment`.  This Next.js route
 * is a thin same-origin proxy that adds:
 *
 *   1. **Stable HTTP contract** — typed request/response shapes
 *      ({@link TrackingApiResponseBody}) that callers can import without
 *      pulling in Convex internals.
 *   2. **HTTP status semantics** — Convex actions throw bracketed `[CODE]`
 *      strings; this route maps them to proper HTTP status codes
 *      (400 / 401 / 404 / 429 / 500 / 502 / 503) so consumers can branch on
 *      `res.status` without parsing free-form messages.
 *   3. **Same-origin auth** — clients hit the same origin as the Next.js app,
 *      reusing the existing Kinde JWT cookie/Authorization header forwarded
 *      to Convex via `ConvexHttpClient.setAuth()`.  No CORS preflight.
 *   4. **Read-only by construction** — only the GET method is implemented.
 *      The route never persists data, never calls `createShipment`, and
 *      never refreshes a stored shipment row.  Mutations remain in their
 *      dedicated SCAN-app paths.
 *
 * ## URL contract
 *   GET /api/tracking/{trackingNumber}
 *   → trackingNumber path param: FedEx tracking number entered by the user.
 *     Whitespace is stripped before validation and the upstream call.
 *
 * ## Authentication
 * The Convex action `api.shipping.trackShipment` requires a valid Kinde JWT.
 * Browsers should send `Authorization: Bearer <accessToken>`; the route
 * forwards the token to ConvexHttpClient via `setAuth()`.  Missing or
 * malformed Authorization headers produce HTTP 401 with code `AUTH_REQUIRED`.
 *
 * ## Response shapes
 * Both success and error responses use the discriminated union
 * {@link TrackingApiResponseBody} keyed by `ok: boolean`.
 *
 *   200 → { ok: true, data: TrackingApiResult }
 *   4xx/5xx → { ok: false, code, message, status }
 *
 * ## Error mapping
 * Every Convex error code maps to a single HTTP status; see
 * {@link TRACKING_API_STATUS_MAP} in `@/types/tracking-api`.  The complete
 * matrix is enumerated and tested in
 * `src/app/api/tracking/[trackingNumber]/__tests__/route.test.ts`.
 *
 * ## Cache headers
 * Tracking data is real-time (FedEx updates land in Convex within seconds),
 * so all responses include `Cache-Control: no-store` to prevent any
 * intermediary from serving stale tracking state to the browser.
 */

import { type NextRequest, NextResponse } from "next/server";

import { api } from "../../../../../convex/_generated/api";
import {
  type TrackingApiResult,
  type TrackingApiStatus,
} from "@/types/tracking-api";
import {
  fail,
  getConvexClient,
  isValidFedExTrackingNumber,
  ok,
  translateConvexError,
} from "./tracking-route-helpers";

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * Route param shape.  The Next.js App Router passes a `params` Promise as
 * the second argument; we await it inside the handler before reading
 * `trackingNumber`.
 */
type RouteContext = {
  params: Promise<{ trackingNumber: string }>;
};

/**
 * GET /api/tracking/[trackingNumber]
 *
 * Read-only FedEx tracking lookup.  Validates the tracking number, forwards
 * the Kinde access token to Convex, calls
 * `api.shipping.trackShipment`, and translates the Convex action's bracketed
 * error codes to HTTP status codes.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  // ── 1. Resolve and validate path param ─────────────────────────────────────
  const { trackingNumber: rawTrackingNumber } = await context.params;
  const trackingNumber = decodeURIComponent(rawTrackingNumber ?? "").trim();

  if (!trackingNumber) {
    return fail(
      "INVALID_TRACKING_NUMBER",
      "Tracking number path parameter is required.",
    );
  }

  if (!isValidFedExTrackingNumber(trackingNumber)) {
    return fail(
      "INVALID_TRACKING_NUMBER",
      `"${trackingNumber}" is not a valid FedEx tracking number. ` +
        "FedEx numbers are at least 10 digits long " +
        "(or 'DT' followed by 12+ digits for door tags).",
    );
  }

  // ── 2. Resolve Kinde access token ──────────────────────────────────────────
  // The browser-side Convex client typically attaches the Kinde JWT via
  // `ConvexProviderWithAuth`.  When calling this route directly (e.g. SSR or
  // server actions), the caller is expected to pass the token through the
  // standard Authorization header.  Anything else produces 401.
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return fail("AUTH_REQUIRED");
  }
  const accessToken = authHeader.slice("Bearer ".length).trim();
  if (!accessToken) {
    return fail("AUTH_REQUIRED");
  }

  // ── 3. Build the Convex client ─────────────────────────────────────────────
  const convexClient = getConvexClient();
  if (!convexClient) {
    return fail(
      "SERVICE_UNAVAILABLE",
      "Service not configured: NEXT_PUBLIC_CONVEX_URL is missing.",
    );
  }

  // Attach the user's Kinde token so the Convex action's `requireAuth` guard
  // sees an authenticated identity.  ConvexHttpClient.setAuth expects the
  // raw token (no "Bearer " prefix).
  convexClient.setAuth(accessToken);

  // ── 4. Invoke the read-only Convex action ──────────────────────────────────
  // `api.shipping.trackShipment` performs the FedEx API call and normalises
  // the response.  It is read-only — calling it never writes to the database.
  let result: Awaited<
    ReturnType<typeof convexClient.action<typeof api.shipping.trackShipment>>
  >;
  try {
    result = await convexClient.action(api.shipping.trackShipment, {
      trackingNumber,
    });
  } catch (err) {
    // Translate bracketed Convex errors to typed HTTP responses.  This is
    // the single error-handling boundary for the route — every failure path
    // funnels through `translateConvexError`.
    return translateConvexError(err);
  }

  // ── 5. Reshape the Convex result to the public TrackingApiResult shape ────
  // The Convex action returns `FedExTrackingResult` (from convex/fedexClient.ts).
  // Our public contract uses `TrackingApiResult` with slightly more explicit
  // optional fields (lastLocation derived from events[0]).  Mapping here keeps
  // the public type stable even if the internal Convex shape evolves.
  const events = (result.events ?? []).map((event) => ({
    timestamp: event.timestamp ?? "",
    eventType: event.eventType ?? "",
    description: event.description ?? "",
    location: {
      city: event.location?.city,
      state: event.location?.state,
      country: event.location?.country,
    },
  }));

  const lastLocation: TrackingApiResult["lastLocation"] =
    events.length > 0
      ? {
          city: events[0].location.city,
          state: events[0].location.state,
          country: events[0].location.country,
        }
      : undefined;

  // The Convex action's `description` doubles as both the localised status
  // description and the raw status name.  We expose both fields explicitly:
  //   • statusDescription — what the UI renders
  //   • statusCode        — preserved for clients that want the raw FedEx code
  //
  // The Convex `FedExTrackingResult` already includes the normalised `status`
  // union; we re-export it here verbatim because both unions are aligned.
  const status: TrackingApiStatus =
    (result.status as TrackingApiStatus | undefined) ?? "unknown";

  const data: TrackingApiResult = {
    trackingNumber: result.trackingNumber,
    status,
    statusCode: "", // Convex action's public type doesn't expose the raw FedEx code; clients read description for now.
    statusDescription: result.description,
    estimatedDelivery: result.estimatedDelivery,
    lastLocation,
    events,
  };

  return ok(data);
}
