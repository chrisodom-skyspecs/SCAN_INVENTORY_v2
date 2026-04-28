/**
 * GET /api/cases/map — Next.js App Router route handler
 *
 * Validates and proxies map-data requests to the Convex HTTP action
 * (`convex/http.ts`) which runs the unified `getMapData` internalQuery.
 *
 * Why a Next.js proxy?
 *   1. Auth boundary — strips / validates Kinde JWTs before forwarding.
 *   2. Stable URL — clients hit the same origin as the Next.js app; no
 *      cross-origin requests or CORS preflight from the browser.
 *   3. Input validation — rejects malformed params before they reach Convex,
 *      keeping error messages consistent across all environments.
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
 *   500  { error: string; status: 500 }  — upstream / internal error
 */

import { type NextRequest, NextResponse } from "next/server";

import type {
  CasesMapErrorResponse,
  MapDataResponse,
  MapMode,
} from "@/types/cases-map";

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_MODES: MapMode[] = ["M1", "M2", "M3", "M4", "M5"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function err(message: string, status: 400 | 503 | 500): NextResponse {
  const body: CasesMapErrorResponse = { error: message, status };
  return NextResponse.json(body, { status });
}

/**
 * Derive the Convex HTTP site URL from the Convex deployment URL.
 *
 * Convex exposes two URL shapes per deployment:
 *   Reactive WS endpoint  — https://<name>.convex.cloud  (NEXT_PUBLIC_CONVEX_URL)
 *   HTTP actions endpoint — https://<name>.convex.site   (CONVEX_SITE_URL)
 *
 * If CONVEX_SITE_URL is set explicitly, it takes precedence; otherwise we
 * derive it from NEXT_PUBLIC_CONVEX_URL by swapping the TLD suffix.
 */
function resolveConvexSiteUrl(): string | null {
  if (process.env.CONVEX_SITE_URL) return process.env.CONVEX_SITE_URL;
  const base = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!base) return null;
  // e.g. "https://happy-animal-123.convex.cloud" → "https://happy-animal-123.convex.site"
  return base.replace(/\.convex\.cloud(\/.*)?$/, ".convex.site$1");
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * GET /api/cases/map
 *
 * Validates query params then proxies the request to the Convex HTTP action.
 * The raw Convex response is forwarded as-is so that the shape remains
 * identical to what is documented in convex/maps.ts.
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

  // ── 2. Validate filters JSON ───────────────────────────────────────────────

  const rawFilters = searchParams.get("filters") ?? undefined;
  if (rawFilters !== undefined) {
    try {
      JSON.parse(rawFilters);
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

  // ── 4. Build upstream URL ──────────────────────────────────────────────────

  const convexSiteUrl = resolveConvexSiteUrl();
  if (!convexSiteUrl) {
    return err(
      "Service not configured: NEXT_PUBLIC_CONVEX_URL or CONVEX_SITE_URL is missing",
      503
    );
  }

  const upstream = new URL("/api/cases/map", convexSiteUrl);
  upstream.searchParams.set("mode", mode);
  if (swLat !== undefined) upstream.searchParams.set("swLat", swLat);
  if (swLng !== undefined) upstream.searchParams.set("swLng", swLng);
  if (neLat !== undefined) upstream.searchParams.set("neLat", neLat);
  if (neLng !== undefined) upstream.searchParams.set("neLng", neLng);
  if (rawFilters !== undefined)
    upstream.searchParams.set("filters", rawFilters);

  // ── 5. Forward to Convex — pass Authorization header for Kinde JWT ─────────

  const authHeader = request.headers.get("authorization");

  try {
    const response = await fetch(upstream.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      // Disable Next.js data cache — map data is real-time
      cache: "no-store",
    });

    const payload = (await response.json()) as
      | MapDataResponse
      | CasesMapErrorResponse;

    return NextResponse.json(payload, { status: response.status });
  } catch (fetchErr) {
    console.error("[GET /api/cases/map] Upstream fetch failed:", fetchErr);
    return err("Internal server error", 500);
  }
}
