/**
 * POST /api/telemetry — Next.js App Router route handler
 *
 * Receives batched telemetry events from the INVENTORY dashboard and SCAN
 * mobile app, validates the payload, and persists the events to the Convex
 * `telemetryEvents` table via the `recordTelemetryBatch` mutation.
 *
 * Architecture
 * ────────────
 * Browser TelemetryClient (telemetry.lib.ts)
 *   → batches events in-memory (up to MAX_BATCH_SIZE = 20)
 *   → POST /api/telemetry  { events: TelemetryEvent[] }
 *     → this route: validates + calls ConvexHttpClient
 *       → convex/telemetry.ts: recordTelemetryBatch mutation
 *         → inserts into telemetryEvents table
 *
 * Why a Next.js proxy instead of calling Convex directly from the client?
 * ────────────────────────────────────────────────────────────────────────
 * 1. Same-origin request — clients hit the same origin as the app; no
 *    CORS preflight for the browser's fetch with keepalive:true.
 * 2. Rate-limiting and auth boundary — this route can be wrapped with
 *    middleware for per-user rate limiting in future.
 * 3. Separation of concerns — transport validation is in Next.js; Convex
 *    handles persistence.
 *
 * Request body (JSON):
 *   { events: TelemetryEvent[] }  — array of 1–MAX_BATCH_SIZE events
 *
 * Successful response:
 *   200  { accepted: number }      — number of events persisted
 *
 * Error responses:
 *   400  { error: string }         — missing or malformed events array
 *   503  { error: string }         — Convex URL not configured
 *   500  { error: string }         — upstream / internal error
 *
 * Telemetry is fire-and-forget from the client perspective; all error
 * responses are intentionally non-retryable from the route itself — the
 * retry logic lives in the transport layer (buildEndpointTransport).
 */

import { type NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of events accepted in a single POST — mirrors convex/telemetry.ts */
const MAX_BATCH_SIZE = 100;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonError(message: string, status: 400 | 503 | 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Lazily initialise a ConvexHttpClient.
 *
 * The client is created per-request (not module-level) so that the route
 * handler works correctly in both edge and Node.js runtimes, and so that
 * the NEXT_PUBLIC_CONVEX_URL env var is read at request time (not build time).
 */
function getConvexClient(): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return new ConvexHttpClient(url);
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * POST /api/telemetry
 *
 * Accepts a JSON body of the form `{ events: TelemetryEvent[] }`, validates
 * that the events array is present and within size limits, then delegates to
 * the `recordTelemetryBatch` Convex mutation for persistence.
 *
 * This handler is intentionally lenient about the shape of individual events —
 * strict typing lives in the Convex mutation and TypeScript layer.  The only
 * hard requirement here is that `events` is a non-empty array.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Parse request body ──────────────────────────────────────────────────

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  // ── 2. Validate payload shape ──────────────────────────────────────────────

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("Request body must be a JSON object", 400);
  }

  const payload = body as Record<string, unknown>;

  if (!Array.isArray(payload.events)) {
    return jsonError(
      'Missing required field "events" (must be an array)',
      400
    );
  }

  const events = payload.events as unknown[];

  if (events.length === 0) {
    // Empty batch is valid but a no-op
    return NextResponse.json({ accepted: 0 }, { status: 200 });
  }

  if (events.length > MAX_BATCH_SIZE) {
    return jsonError(
      `Batch too large: ${events.length} events (maximum: ${MAX_BATCH_SIZE})`,
      400
    );
  }

  // ── 3. Resolve Convex client ───────────────────────────────────────────────

  const convex = getConvexClient();
  if (!convex) {
    console.warn(
      "[POST /api/telemetry] NEXT_PUBLIC_CONVEX_URL is not configured — " +
        "telemetry events will be dropped."
    );
    return jsonError(
      "Service not configured: NEXT_PUBLIC_CONVEX_URL is missing",
      503
    );
  }

  // ── 4. Persist via Convex mutation ─────────────────────────────────────────

  try {
    const result = await convex.mutation(
      api.telemetry.recordTelemetryBatch,
      { events }
    );

    return NextResponse.json({ accepted: result.accepted }, { status: 200 });
  } catch (err) {
    console.warn(
      "[POST /api/telemetry] Dropping telemetry batch after Convex mutation failure:",
      err
    );
    return NextResponse.json(
      { accepted: 0, dropped: events.length },
      { status: 202 }
    );
  }
}
