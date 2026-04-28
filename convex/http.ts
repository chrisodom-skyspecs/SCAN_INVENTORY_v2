/**
 * convex/http.ts
 *
 * Convex HTTP router — exposes REST endpoints consumed by the INVENTORY
 * dashboard and SCAN mobile app.
 *
 * Routes:
 *   GET  /api/cases/map          — multi-mode map data (M1–M5)
 *   GET  /api/health             — health check
 *
 * Authentication:
 *   All /api/cases/* routes require a valid Kinde JWT passed as
 *   Authorization: Bearer <token>. The JWT is verified via Kinde's
 *   JWKS endpoint. Public /api/health is unauthenticated.
 *
 * CORS:
 *   All routes allow the configured NEXT_PUBLIC_APP_URL origin plus
 *   localhost variants for local development.
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// ─── CORS helper ─────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.NEXT_PUBLIC_SCAN_URL,
  "http://localhost:3000",
  "http://localhost:3001",
].filter(Boolean) as string[];

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(
  data: unknown,
  status = 200,
  origin: string | null = null
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

function errorResponse(
  message: string,
  status = 400,
  origin: string | null = null
): Response {
  return jsonResponse({ error: message, status }, status, origin);
}

// ─── Map mode validator ───────────────────────────────────────────────────────

type MapMode = "M1" | "M2" | "M3" | "M4" | "M5";
const VALID_MODES: MapMode[] = ["M1", "M2", "M3", "M4", "M5"];

function isValidMode(value: string | null): value is MapMode {
  return VALID_MODES.includes(value as MapMode);
}

// ─── /api/cases/map handler ──────────────────────────────────────────────────

/**
 * GET /api/cases/map
 *
 * Query parameters:
 *   mode    — "M1" | "M2" | "M3" | "M4" | "M5"  (default: "M1")
 *   swLat   — south-west latitude  (bounds filter, optional)
 *   swLng   — south-west longitude (bounds filter, optional)
 *   neLat   — north-east latitude  (bounds filter, optional)
 *   neLng   — north-east longitude (bounds filter, optional)
 *   filters — JSON-encoded filter object (optional)
 *             {
 *               status?: string[],      // case statuses to include
 *               assigneeId?: string,    // Kinde user ID
 *               missionId?: string,     // Convex mission _id
 *               hasInspection?: boolean,
 *               hasDamage?: boolean,
 *             }
 *
 * Response:
 *   Mode-specific JSON — see M1Response, M2Response, M3Response,
 *   M4Response, M5Response interfaces in convex/maps.ts
 *
 * Error responses:
 *   400  { error: string, status: 400 }  — invalid query params
 *   405  { error: string, status: 405 }  — method not allowed
 *   500  { error: string, status: 500 }  — internal error
 */
const casesMapHandler = httpAction(async (ctx, request) => {
  const origin = request.headers.get("origin");

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  if (request.method !== "GET") {
    return errorResponse("Method not allowed", 405, origin);
  }

  const url = new URL(request.url);
  const params = url.searchParams;

  // Parse and validate mode
  const rawMode = params.get("mode") ?? "M1";
  if (!isValidMode(rawMode)) {
    return errorResponse(
      `Invalid mode "${rawMode}". Must be one of: ${VALID_MODES.join(", ")}`,
      400,
      origin
    );
  }
  const mode: MapMode = rawMode;

  // Extract shared query params
  const queryArgs = {
    swLat: params.get("swLat") ?? undefined,
    swLng: params.get("swLng") ?? undefined,
    neLat: params.get("neLat") ?? undefined,
    neLng: params.get("neLng") ?? undefined,
    filters: params.get("filters") ?? undefined,
  };

  // Validate filters JSON if provided
  if (queryArgs.filters) {
    try {
      JSON.parse(queryArgs.filters);
    } catch {
      return errorResponse(
        'Invalid "filters" parameter — must be valid JSON',
        400,
        origin
      );
    }
  }

  // Validate bounds consistency — all four or none
  const boundParams = [
    queryArgs.swLat,
    queryArgs.swLng,
    queryArgs.neLat,
    queryArgs.neLng,
  ];
  const providedBounds = boundParams.filter(Boolean).length;
  if (providedBounds > 0 && providedBounds < 4) {
    return errorResponse(
      "Bounds require all four params: swLat, swLng, neLat, neLng",
      400,
      origin
    );
  }

  try {
    // Single unified query — parallel DB load, no N+1 queries
    const data = await ctx.runQuery(internal.maps.getMapData, {
      mode,
      ...queryArgs,
    });

    return jsonResponse(data, 200, origin);
  } catch (err) {
    console.error("[/api/cases/map] Internal error:", err);
    return errorResponse("Internal server error", 500, origin);
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────

const healthHandler = httpAction(async (_ctx, request) => {
  const origin = request.headers.get("origin");
  return jsonResponse(
    {
      status: "ok",
      service: "skyspecs-inventory-convex",
      ts: Date.now(),
    },
    200,
    origin
  );
});

// ─── Router setup ─────────────────────────────────────────────────────────────

const http = httpRouter();

http.route({
  path: "/api/cases/map",
  method: "GET",
  handler: casesMapHandler,
});

// CORS preflight for /api/cases/map
http.route({
  path: "/api/cases/map",
  method: "OPTIONS",
  handler: casesMapHandler,
});

http.route({
  path: "/api/health",
  method: "GET",
  handler: healthHandler,
});

export default http;
