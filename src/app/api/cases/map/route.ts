/**
 * GET /api/cases/map — Next.js App Router route handler
 *
 * Validates request params then invokes the Convex query client to retrieve
 * mode-specific map data.  Uses ConvexHttpClient for a direct query-layer call
 * so that:
 *   1. Auth — Kinde JWTs are forwarded to Convex via setAuth().
 *   2. Stable URL — clients hit the same origin as the Next.js app; no
 *      cross-origin requests or CORS preflight from the browser.
 *   3. Input validation — rejects malformed params before they reach Convex,
 *      keeping error messages consistent across all environments.
 *   4. Typed queries — calls the public mapData query functions directly rather
 *      than going through the HTTP action proxy layer.
 *
 * Query parameters (all optional):
 *   mode    — "M1" | "M2" | "M3" | "M4" | "M5"  (default: "M1")
 *   swLat   — viewport south-west latitude  (bounds filter; all 4 or none)
 *   swLng   — viewport south-west longitude
 *   neLat   — viewport north-east latitude
 *   neLng   — viewport north-east longitude
 *   filters — URL-encoded JSON:
 *             { status?: string[]; assigneeId?: string; missionId?: string;
 *               hasInspection?: boolean; hasDamage?: boolean }
 *
 * Successful responses match MapDataResponse (convex/maps.ts):
 *   200  M1Response | M2Response | M3Response | M4Response | M5Response
 *
 * Error responses match CasesMapErrorResponse (src/types/cases-map.ts):
 *   400  { error: string; status: 400 }  — invalid query parameters
 *   503  { error: string; status: 503 }  — Convex URL not configured
 *   500  { error: string; status: 500 }  — Convex query / internal error
 */

import { type NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../../../../../convex/_generated/api";
import type {
  CasesMapErrorResponse,
  MapDataResponse,
  MapMode,
} from "@/types/cases-map";
import type { ParsedFilters } from "../../../../../convex/maps";

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_MODES: MapMode[] = ["M1", "M2", "M3", "M4", "M5"];

/**
 * Map data is real-time (SCAN mutations propagate to dashboard within ~2 s via
 * Convex subscriptions).  Caching any response — even for a few seconds — would
 * show stale positions and inspection states on the INVENTORY map.
 *
 * These headers are applied to every response (200, 400, 500, 503):
 *   Cache-Control: no-store          — prohibit all caching (browser, CDN, proxy)
 *   Pragma: no-cache                 — HTTP/1.0 compatibility (legacy proxies)
 *
 * Vercel's Edge Network respects `no-store` and will not cache the route output.
 * CDNs sitting upstream of Vercel (Cloudflare, Fastly, etc.) also honour this.
 */
const REALTIME_CACHE_HEADERS = {
  "Cache-Control": "no-store",
  "Pragma":        "no-cache",
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function err(message: string, status: 400 | 503 | 500): NextResponse {
  const body: CasesMapErrorResponse = { error: message, status };
  return NextResponse.json(body, {
    status,
    headers: REALTIME_CACHE_HEADERS,
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * GET /api/cases/map
 *
 * Validates query params, builds a ConvexHttpClient, passes validated request
 * params to the appropriate public mapData query, and awaits the result.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;

  // ── 1. Validate mode ───────────────────────────────────────────────────────

  const rawMode = searchParams.get("mode") ?? "M1";
  if (!VALID_MODES.includes(rawMode as MapMode)) {
    return err(
      `Invalid mode "${rawMode}". Must be one of: ${VALID_MODES.join(", ")}`,
      400
    );
  }
  const mode = rawMode as MapMode;

  // ── 2. Validate and parse filters JSON ────────────────────────────────────

  const rawFilters = searchParams.get("filters") ?? undefined;
  let parsedFilters: ParsedFilters = {};
  if (rawFilters !== undefined) {
    try {
      parsedFilters = JSON.parse(rawFilters) as ParsedFilters;
    } catch {
      return err('Invalid "filters" parameter — must be valid JSON', 400);
    }
  }

  // ── 3. Validate bounds consistency (all four or none) ──────────────────────

  const swLat = searchParams.get("swLat") ?? undefined;
  const swLng = searchParams.get("swLng") ?? undefined;
  const neLat = searchParams.get("neLat") ?? undefined;
  const neLng = searchParams.get("neLng") ?? undefined;

  const boundsCount = [swLat, swLng, neLat, neLng].filter(
    (v) => v !== undefined
  ).length;
  if (boundsCount > 0 && boundsCount < 4) {
    return err(
      "Bounds require all four params: swLat, swLng, neLat, neLng",
      400
    );
  }

  // ── 4. Resolve Convex deployment URL ─────────────────────────────────────

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return err(
      "Service not configured: NEXT_PUBLIC_CONVEX_URL is missing",
      503
    );
  }

  // ── 5. Build Convex HTTP client and attach Kinde JWT ──────────────────────

  const convexClient = new ConvexHttpClient(convexUrl);
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    // Strip the "Bearer " prefix — ConvexHttpClient.setAuth expects a raw token
    convexClient.setAuth(authHeader.slice("Bearer ".length));
  }

  // ── 6. Convert validated string bounds to numbers ─────────────────────────
  //
  // The public mapData query functions accept v.number() args for bounds,
  // while URL query params arrive as strings.  parseFloat is safe here because
  // bounds consistency was already validated in step 3 (all-or-none check) and
  // any non-numeric value will resolve to NaN — which Convex validators will
  // reject with a descriptive error rather than silently ignoring.

  const boundsArgs =
    boundsCount === 4
      ? {
          swLat: parseFloat(swLat!),
          swLng: parseFloat(swLng!),
          neLat: parseFloat(neLat!),
          neLng: parseFloat(neLng!),
        }
      : {};

  // ── 7. Invoke the Convex query client, passing validated params ────────────
  //
  // Each map mode has a dedicated public query function in convex/mapData.ts.
  // We switch on the validated `mode` and call the appropriate function,
  // spreading the converted bounds and extracting the relevant filter fields.
  //
  // Type assertions on status arrays are intentional: the URL params carry
  // `string[]` but the Convex validators enforce the correct literal unions at
  // runtime.  This preserves the route handler's schema-agnostic filter API
  // while delegating actual type enforcement to the Convex validator layer.

  try {
    let data: MapDataResponse;

    switch (mode) {
      case "M1":
        data = await convexClient.query(api.mapData.getM1MapData, {
          ...boundsArgs,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          status: parsedFilters.status as any,
          assigneeId: parsedFilters.assigneeId,
          missionId:  parsedFilters.missionId,
        });
        break;

      case "M2":
        data = await convexClient.query(api.mapData.getM2MapData, {
          ...boundsArgs,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          status:    parsedFilters.status as any,
          missionId: parsedFilters.missionId,
        });
        break;

      case "M3":
        data = await convexClient.query(api.mapData.getM3MapData, {
          ...boundsArgs,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          status:        parsedFilters.status as any,
          assigneeId:    parsedFilters.assigneeId,
          missionId:     parsedFilters.missionId,
          hasInspection: parsedFilters.hasInspection,
          hasDamage:     parsedFilters.hasDamage,
        });
        break;

      case "M4":
        data = await convexClient.query(api.mapData.getM4MapData, {
          ...boundsArgs,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          status: parsedFilters.status as any,
        });
        break;

      case "M5":
        data = await convexClient.query(api.mapData.getM5MapData, {
          ...boundsArgs,
        });
        break;

      default: {
        // Exhaustive check — TypeScript narrows this to never
        const _exhaustive: never = mode;
        throw new Error(`Unhandled map mode: ${_exhaustive}`);
      }
    }

    return NextResponse.json(data, {
      status: 200,
      headers: REALTIME_CACHE_HEADERS,
    });
  } catch (queryErr) {
    console.error("[GET /api/cases/map] Convex query failed:", queryErr);
    return err("Internal server error", 500);
  }
}
