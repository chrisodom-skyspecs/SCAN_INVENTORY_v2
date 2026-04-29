/**
 * sw-network-first.test.ts
 *
 * Unit tests for the service worker network-first fetch strategy
 * (Sub-AC 27c-3).
 *
 * Tests cover:
 *   1. isConvexHttpUrl — URL classification for Convex cloud deployments
 *   2. networkFirst — online path: returns live response and populates cache
 *   3. networkFirst — offline fallback: returns stale cache when network fails
 *   4. Strategy routing — /api/* routes use network-first
 *   5. Strategy routing — Convex HTTP GET routes use network-first
 *   6. Strategy routing — non-GET requests (mutations) pass through
 *   7. Strategy routing — cross-origin non-Convex requests pass through
 *   8. Cache behaviour — non-ok responses are NOT cached
 *   9. Cache behaviour — response is cloned before caching (body readable)
 *  10. WebSocket exclusion documentation (conceptual — can't test SW event)
 *
 * The service worker itself is a plain script (not an ESM module) so the
 * classification and handler logic is mirrored here as pure functions that
 * share the same decision tree.  Any change to sw.js routing rules must be
 * reflected here and in sw-cache-strategy.test.ts.
 *
 * Run: npx vitest run src/__tests__/sw-network-first.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Constants mirrored from sw.js ───────────────────────────────────────────

const CACHE_VERSION = "v1";
const CACHE_NAME = `scan-cache-${CACHE_VERSION}`;
const CONVEX_HOST_SUFFIX = ".convex.cloud";

// ─── Mirror of sw.js helpers ──────────────────────────────────────────────────

/** Returns true if the URL hostname ends with the Convex cloud suffix. */
function isConvexHttpUrl(url: URL): boolean {
  return url.hostname.endsWith(CONVEX_HOST_SUFFIX);
}

/**
 * Returns true if the given pathname should use the cache-first strategy.
 * Mirrors isStaticAssetPath from sw.js — kept minimal here to support
 * the routing matrix tests below.
 */
const STATIC_ASSET_EXTENSIONS = new Set([
  ".js", ".mjs", ".css",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
]);

function isStaticAssetPath(pathname: string): boolean {
  if (pathname.startsWith("/_next/static/")) return true;
  if (pathname === "/_next/image" || pathname.startsWith("/_next/image/")) return true;
  if (pathname.startsWith("/icons/")) return true;
  if (pathname === "/manifest.json") return true;
  if (pathname === "/favicon.svg") return true;
  const lastDot = pathname.lastIndexOf(".");
  if (lastDot !== -1) {
    const ext = pathname.slice(lastDot).toLowerCase();
    if (STATIC_ASSET_EXTENSIONS.has(ext)) return true;
  }
  return false;
}

/**
 * Strategy dispatch — mirrors the fetch event handler logic from sw.js.
 * Returns the chosen strategy name rather than calling the actual handler
 * so we can test routing decisions without a real Service Worker environment.
 *
 * Returns null to indicate "pass through" (no respondWith called).
 */
function getStrategy(
  method: string,
  urlStr: string,
  selfOrigin = "https://app.skyspecsops.com"
): "network-first" | "cache-first" | null {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return null;
  }

  // Only intercept http/https requests.
  // WebSocket (wss://) upgrades never trigger the Service Worker fetch event
  // in real browsers, so they can never reach this handler.  If a wss:// URL
  // somehow reached the routing logic we treat it as pass-through (null).
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  // Non-GET → pass through (mutations must not be cached)
  if (method !== "GET") return null;

  const isSameOrigin = url.origin === selfOrigin;

  if (isSameOrigin) {
    if (url.pathname.startsWith("/api/")) return "network-first";
    if (isStaticAssetPath(url.pathname)) return "cache-first";
    return "network-first"; // page navigations
  }

  // Cross-origin Convex HTTP GET → network-first
  if (isConvexHttpUrl(url)) return "network-first";

  // All other cross-origin → pass through
  return null;
}

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeResponse(body = "ok", ok = true, status = 200): Response {
  return {
    ok,
    status,
    clone: vi.fn(function (this: Response) {
      return makeResponse(body, ok, status);
    }),
    body,
  } as unknown as Response;
}

function makeRequest(url: string, method = "GET"): Request {
  return { url, method } as unknown as Request;
}

function makeCache(initial: Map<string, Response> = new Map()) {
  const store = new Map<string, Response>(initial);
  return {
    match: vi.fn(async (req: Request | string) => {
      const key = typeof req === "string" ? req : req.url;
      return store.get(key);
    }),
    put: vi.fn(async (req: Request | string, res: Response) => {
      const key = typeof req === "string" ? req : req.url;
      store.set(key, res);
    }),
    _store: store,
  };
}

function makeCaches(namedCaches: Record<string, ReturnType<typeof makeCache>> = {}) {
  return {
    open: vi.fn(async (name: string) => {
      if (!namedCaches[name]) namedCaches[name] = makeCache();
      return namedCaches[name];
    }),
    match: vi.fn(async (req: Request | string) => {
      for (const cache of Object.values(namedCaches)) {
        const hit = await cache.match(req);
        if (hit) return hit;
      }
      return undefined;
    }),
    _named: namedCaches,
  };
}

/** networkFirst mirrored from sw.js with injected fetch for testability. */
async function networkFirst(
  request: Request,
  cachesApi: ReturnType<typeof makeCaches>,
  fetchFn: (req: Request) => Promise<Response> = (r) => fetch(r)
): Promise<Response> {
  try {
    const response = await fetchFn(request);
    if (response.ok) {
      const cache = await cachesApi.open(CACHE_NAME);
      await cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cachesApi.match(request);
    if (cached) return cached;
    return Response.error();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. isConvexHttpUrl — Convex domain detection
// ═══════════════════════════════════════════════════════════════════════════════

describe("isConvexHttpUrl — Convex cloud domain detection", () => {
  it("returns true for a standard Convex deployment URL", () => {
    expect(isConvexHttpUrl(new URL("https://grateful-dog-123.convex.cloud/api/query"))).toBe(true);
  });

  it("returns true for an HTTPS Convex URL with path", () => {
    expect(isConvexHttpUrl(new URL("https://skyspecs-prod.convex.cloud/api/query"))).toBe(true);
  });

  it("returns true for a Convex URL with query string", () => {
    expect(isConvexHttpUrl(new URL("https://skyspecs-prod.convex.cloud/api/query?v=2"))).toBe(true);
  });

  it("returns true for a Convex URL with only the host suffix (bare hostname)", () => {
    // Bare deployment slug — shortest valid subdomain
    expect(isConvexHttpUrl(new URL("https://dev.convex.cloud/api/mutation"))).toBe(true);
  });

  it("returns true for a deeply nested Convex URL path", () => {
    expect(isConvexHttpUrl(new URL("https://skyspecs.convex.cloud/api/sync/messages"))).toBe(true);
  });

  it("returns false for a same-origin app URL", () => {
    expect(isConvexHttpUrl(new URL("https://app.skyspecsops.com/api/cases/map"))).toBe(false);
  });

  it("returns false for a Mapbox tile URL", () => {
    expect(isConvexHttpUrl(new URL("https://api.mapbox.com/styles/v1/map/tiles/10/512/512"))).toBe(false);
  });

  it("returns false for a generic third-party URL", () => {
    expect(isConvexHttpUrl(new URL("https://fonts.googleapis.com/css2?family=Inter"))).toBe(false);
  });

  it("does NOT match a URL that has 'convex.cloud' as a path segment (not hostname)", () => {
    // URL where convex.cloud appears in the pathname, not hostname
    expect(isConvexHttpUrl(new URL("https://app.example.com/proxy/convex.cloud/data"))).toBe(false);
  });

  it("does NOT match a partial hostname match (e.g. notconvex.cloud)", () => {
    // Hostname ends in 'cloud' but not '.convex.cloud'
    expect(isConvexHttpUrl(new URL("https://notconvex.cloud/api/data"))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. networkFirst — online path (network succeeds)
// ═══════════════════════════════════════════════════════════════════════════════

describe("networkFirst — network succeeds", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the live network response", async () => {
    const networkResponse = makeResponse("fresh data from server");
    const cachesApi = makeCaches();
    const fetchFn = vi.fn(async () => networkResponse);

    const req = makeRequest("https://app.skyspecsops.com/api/cases/map");
    const result = await networkFirst(req, cachesApi, fetchFn);

    expect(result).toBe(networkResponse);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("populates the cache with a clone of the response", async () => {
    const networkResponse = makeResponse("fresh data");
    const namedCaches: Record<string, ReturnType<typeof makeCache>> = {};
    const cachesApi = makeCaches(namedCaches);
    const fetchFn = vi.fn(async () => networkResponse);

    const req = makeRequest("https://app.skyspecsops.com/api/cases/map");
    await networkFirst(req, cachesApi, fetchFn);

    expect(cachesApi.open).toHaveBeenCalledWith(CACHE_NAME);
    expect(namedCaches[CACHE_NAME].put).toHaveBeenCalledOnce();
  });

  it("calls response.clone() to preserve the body for the caller", async () => {
    const networkResponse = makeResponse("body data");
    const cachesApi = makeCaches();
    const fetchFn = vi.fn(async () => networkResponse);

    const req = makeRequest("https://app.skyspecsops.com/api/cases");
    await networkFirst(req, cachesApi, fetchFn);

    expect(networkResponse.clone).toHaveBeenCalled();
  });

  it("does NOT cache non-ok responses (4xx)", async () => {
    const notFoundResponse = makeResponse("not found", false, 404);
    const cachesApi = makeCaches();
    const fetchFn = vi.fn(async () => notFoundResponse);

    const req = makeRequest("https://app.skyspecsops.com/api/cases/NONEXISTENT");
    const result = await networkFirst(req, cachesApi, fetchFn);

    expect(cachesApi.open).not.toHaveBeenCalled();
    expect(result).toBe(notFoundResponse);
  });

  it("does NOT cache non-ok responses (5xx)", async () => {
    const serverErrorResponse = makeResponse("internal server error", false, 500);
    const cachesApi = makeCaches();
    const fetchFn = vi.fn(async () => serverErrorResponse);

    const req = makeRequest("https://app.skyspecsops.com/api/cases/map");
    const result = await networkFirst(req, cachesApi, fetchFn);

    expect(cachesApi.open).not.toHaveBeenCalled();
    expect(result).toBe(serverErrorResponse);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. networkFirst — offline fallback (network fails)
// ═══════════════════════════════════════════════════════════════════════════════

describe("networkFirst — offline fallback when network fails", () => {
  it("returns stale cached response when network throws (offline)", async () => {
    const staleResponse = makeResponse("stale cached data from last successful fetch");
    const cachesApi = makeCaches();
    cachesApi.match = vi.fn(async () => staleResponse);
    const fetchFn = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    const req = makeRequest("https://app.skyspecsops.com/api/cases/map");
    const result = await networkFirst(req, cachesApi, fetchFn);

    expect(result).toBe(staleResponse);
  });

  it("returns stale cached response for Convex HTTP query when offline", async () => {
    const staleConvexResponse = makeResponse('{"jsonFormat":"v0","value":{"cases":[]}}');
    const cachesApi = makeCaches();
    cachesApi.match = vi.fn(async () => staleConvexResponse);
    const fetchFn = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    const req = makeRequest("https://skyspecs-prod.convex.cloud/api/query");
    const result = await networkFirst(req, cachesApi, fetchFn);

    expect(result).toBe(staleConvexResponse);
  });

  it("returns Response.error() when network fails and cache is empty", async () => {
    const cachesApi = makeCaches();
    cachesApi.match = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    const req = makeRequest("https://app.skyspecsops.com/api/cases/map");
    const result = await networkFirst(req, cachesApi, fetchFn);

    // Response.error() has status 0 and ok === false
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });

  it("checks the cache using the original request (not just URL string)", async () => {
    const cachesApi = makeCaches();
    cachesApi.match = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    const req = makeRequest("https://app.skyspecsops.com/scan/CASE-001");
    await networkFirst(req, cachesApi, fetchFn);

    // Verify the cache was queried with the request (not just the URL string)
    expect(cachesApi.match).toHaveBeenCalledWith(req);
  });

  it("handles DNS resolution failure (non-fetch TypeError) the same as offline", async () => {
    const stale = makeResponse("stale");
    const cachesApi = makeCaches();
    cachesApi.match = vi.fn(async () => stale);
    const fetchFn = vi.fn(async () => { throw new TypeError("net::ERR_NAME_NOT_RESOLVED"); });

    const req = makeRequest("https://app.skyspecsops.com/api/cases");
    const result = await networkFirst(req, cachesApi, fetchFn);

    expect(result).toBe(stale);
  });

  it("handles non-TypeError errors from fetch gracefully", async () => {
    const cachesApi = makeCaches();
    cachesApi.match = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async () => { throw new Error("Some other error"); });

    const req = makeRequest("https://app.skyspecsops.com/api/cases/map");
    const result = await networkFirst(req, cachesApi, fetchFn);

    // Falls back to Response.error() when cache is also empty
    expect(result.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Strategy routing — /api/* same-origin routes
// ═══════════════════════════════════════════════════════════════════════════════

describe("strategy routing — same-origin /api/* routes", () => {
  const ORIGIN = "https://app.skyspecsops.com";

  it("routes GET /api/cases/map to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/api/cases/map`)).toBe("network-first");
  });

  it("routes GET /api/cases to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/api/cases`)).toBe("network-first");
  });

  it("routes GET /api/auth/login to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/api/auth/login`)).toBe("network-first");
  });

  it("routes GET /api/auth/callback to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/api/auth/callback`)).toBe("network-first");
  });

  it("routes GET /api/telemetry to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/api/telemetry`)).toBe("network-first");
  });

  it("routes GET /api/fedex/track to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/api/fedex/track`)).toBe("network-first");
  });

  it("routes GET /api/cases/map with query string to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/api/cases/map?mode=M2&site=SITE-1`)).toBe("network-first");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Strategy routing — Convex HTTP GET requests
// ═══════════════════════════════════════════════════════════════════════════════

describe("strategy routing — Convex HTTP GET requests (cross-origin)", () => {
  it("routes Convex HTTP query (GET) to network-first", () => {
    expect(getStrategy("GET", "https://skyspecs-prod.convex.cloud/api/query")).toBe("network-first");
  });

  it("routes any *.convex.cloud GET to network-first (arbitrary deployment slug)", () => {
    expect(getStrategy("GET", "https://grateful-dog-123.convex.cloud/api/query")).toBe("network-first");
  });

  it("routes Convex HTTP GET with query params to network-first", () => {
    expect(getStrategy("GET", "https://skyspecs.convex.cloud/api/query?args={}")).toBe("network-first");
  });

  it("routes Convex sync GET endpoint to network-first", () => {
    expect(getStrategy("GET", "https://skyspecs.convex.cloud/api/sync")).toBe("network-first");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Strategy routing — non-GET requests pass through (mutations)
// ═══════════════════════════════════════════════════════════════════════════════

describe("strategy routing — non-GET requests pass through", () => {
  const ORIGIN = "https://app.skyspecsops.com";

  it("passes through POST requests to same-origin /api/ routes", () => {
    expect(getStrategy("POST", `${ORIGIN}/api/cases`)).toBeNull();
  });

  it("passes through PUT requests to same-origin /api/ routes", () => {
    expect(getStrategy("PUT", `${ORIGIN}/api/cases/CASE-001`)).toBeNull();
  });

  it("passes through DELETE requests to same-origin /api/ routes", () => {
    expect(getStrategy("DELETE", `${ORIGIN}/api/cases/CASE-001`)).toBeNull();
  });

  it("passes through PATCH requests to same-origin /api/ routes", () => {
    expect(getStrategy("PATCH", `${ORIGIN}/api/cases/CASE-001/status`)).toBeNull();
  });

  it("passes through POST requests to Convex HTTP API (mutations)", () => {
    // Convex mutations are POST — they must reach the server to execute
    expect(getStrategy("POST", "https://skyspecs-prod.convex.cloud/api/mutation")).toBeNull();
  });

  it("passes through POST requests to Convex HTTP API (actions)", () => {
    expect(getStrategy("POST", "https://skyspecs-prod.convex.cloud/api/action")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Strategy routing — cross-origin non-Convex requests pass through
// ═══════════════════════════════════════════════════════════════════════════════

describe("strategy routing — cross-origin non-Convex requests pass through", () => {
  it("passes through Mapbox tile requests (cross-origin GET)", () => {
    expect(getStrategy("GET", "https://api.mapbox.com/styles/v1/tile/10/512/512")).toBeNull();
  });

  it("passes through Mapbox GL JS CDN requests", () => {
    expect(getStrategy("GET", "https://api.mapbox.com/mapbox-gl-js/v3.0.0/mapbox-gl.js")).toBeNull();
  });

  it("passes through Google Fonts requests", () => {
    expect(getStrategy("GET", "https://fonts.googleapis.com/css2?family=Inter+Tight")).toBeNull();
  });

  it("passes through generic third-party API GET requests", () => {
    expect(getStrategy("GET", "https://api.example.com/data")).toBeNull();
  });

  it("passes through FedEx tracking API requests (cross-origin GET)", () => {
    // FedEx tracking calls are made server-side, but if the SW sees them they
    // should pass through without caching (sensitive shipment data).
    expect(getStrategy("GET", "https://apis.fedex.com/track/v1/trackingnumbers")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Strategy routing — same-origin page navigations
// ═══════════════════════════════════════════════════════════════════════════════

describe("strategy routing — same-origin page navigations", () => {
  const ORIGIN = "https://app.skyspecsops.com";

  it("routes /scan page navigation to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/scan`)).toBe("network-first");
  });

  it("routes /scan/<caseId> deep-link to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/scan/CASE-001`)).toBe("network-first");
  });

  it("routes /scan/<caseId>/inspect to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/scan/CASE-001/inspect`)).toBe("network-first");
  });

  it("routes /scan/<caseId>/handoff to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/scan/CASE-001/handoff`)).toBe("network-first");
  });

  it("routes /inventory to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/inventory`)).toBe("network-first");
  });

  it("routes / root to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/`)).toBe("network-first");
  });

  it("routes /case/<caseId> QR redirect path to network-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/case/CASE-001`)).toBe("network-first");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Strategy routing — static assets use cache-first, not network-first
// ═══════════════════════════════════════════════════════════════════════════════

describe("strategy routing — static assets route to cache-first (not network-first)", () => {
  const ORIGIN = "https://app.skyspecsops.com";

  it("routes /_next/static/ JS chunks to cache-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/_next/static/chunks/main.js`)).toBe("cache-first");
  });

  it("routes /_next/static/ CSS to cache-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/_next/static/css/app.css`)).toBe("cache-first");
  });

  it("routes /_next/image/ to cache-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/_next/image/`)).toBe("cache-first");
  });

  it("routes /manifest.json to cache-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/manifest.json`)).toBe("cache-first");
  });

  it("routes /favicon.svg to cache-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/favicon.svg`)).toBe("cache-first");
  });

  it("routes /icons/ to cache-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/icons/icon-192.svg`)).toBe("cache-first");
  });

  it("routes .woff2 font files to cache-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/fonts/inter-tight.woff2`)).toBe("cache-first");
  });

  it("routes .png image files to cache-first", () => {
    expect(getStrategy("GET", `${ORIGIN}/images/placeholder.png`)).toBe("cache-first");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. networkFirst — cache population for subsequent offline use
// ═══════════════════════════════════════════════════════════════════════════════

describe("networkFirst — populates cache for offline fallback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("caches a successful /api/ response so it's available when offline", async () => {
    const apiResponse = makeResponse('{"cases":[{"id":"CASE-001"}]}');
    const namedCaches: Record<string, ReturnType<typeof makeCache>> = {};
    const cachesApi = makeCaches(namedCaches);
    const fetchFn = vi.fn(async () => apiResponse);

    const req = makeRequest("https://app.skyspecsops.com/api/cases/map");
    await networkFirst(req, cachesApi, fetchFn);

    // Verify the response was stored in the named cache
    const cache = namedCaches[CACHE_NAME];
    expect(cache).toBeDefined();
    expect(cache.put).toHaveBeenCalledWith(req, expect.anything());
  });

  it("caches a successful Convex HTTP query response so it's available when offline", async () => {
    const convexResponse = makeResponse('{"jsonFormat":"v0","value":{"cases":[]}}');
    const namedCaches: Record<string, ReturnType<typeof makeCache>> = {};
    const cachesApi = makeCaches(namedCaches);
    const fetchFn = vi.fn(async () => convexResponse);

    const req = makeRequest("https://skyspecs-prod.convex.cloud/api/query");
    await networkFirst(req, cachesApi, fetchFn);

    const cache = namedCaches[CACHE_NAME];
    expect(cache).toBeDefined();
    expect(cache.put).toHaveBeenCalledWith(req, expect.anything());
  });

  it("survives a cache.put() failure (QuotaExceededError) gracefully", async () => {
    const apiResponse = makeResponse("ok");
    const namedCaches: Record<string, ReturnType<typeof makeCache>> = {};
    const cachesApi = makeCaches(namedCaches);
    const fetchFn = vi.fn(async () => apiResponse);

    const req = makeRequest("https://app.skyspecsops.com/api/cases");
    await networkFirst(req, cachesApi, fetchFn);

    // Override the cache's put to throw (simulating quota exceeded)
    const cache = namedCaches[CACHE_NAME];
    cache.put.mockRejectedValueOnce(new DOMException("QuotaExceededError"));

    // A second request should still succeed despite the put failure
    const req2 = makeRequest("https://app.skyspecsops.com/api/cases/CASE-002");
    const result2 = await networkFirst(req2, cachesApi, fetchFn);
    expect(result2).toBe(apiResponse);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. CONVEX_HOST_SUFFIX constant — required value
// ═══════════════════════════════════════════════════════════════════════════════

describe("CONVEX_HOST_SUFFIX constant", () => {
  it("is set to the Convex cloud domain suffix", () => {
    expect(CONVEX_HOST_SUFFIX).toBe(".convex.cloud");
  });

  it("starts with a dot (ensures hostname suffix matching, not substring)", () => {
    // '.convex.cloud' ensures 'notconvex.cloud' does NOT match
    expect(CONVEX_HOST_SUFFIX.startsWith(".")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. WebSocket exclusion — conceptual documentation test
// ═══════════════════════════════════════════════════════════════════════════════

describe("WebSocket exclusion — Service Worker fetch event does not fire for WebSockets", () => {
  /**
   * The Service Worker fetch event is NOT triggered for WebSocket connections.
   * This is specified in the Service Worker spec (Fetch Integration):
   *   "The fetch event will not be fired for WebSocket connections."
   *
   * Convex's primary real-time transport uses WebSocket (wss://*.convex.cloud).
   * The SW therefore cannot intercept or cache WebSocket frames.
   * Reconnect resilience is handled by the Convex SDK's built-in retry logic.
   *
   * These tests verify the routing logic does NOT attempt to handle
   * WebSocket-style URLs (wss://) — they would simply not arrive at the
   * fetch event handler in a real browser environment.
   */

  it("getStrategy does not route wss:// WebSocket URLs (they never reach the fetch event)", () => {
    // wss:// URLs will fail URL parsing in terms of http routing, or
    // return null from getStrategy because they're cross-origin non-Convex-HTTP
    const strategy = getStrategy("GET", "wss://skyspecs-prod.convex.cloud/api/");
    // WebSocket upgrades don't fire the fetch event; if they somehow reached
    // the handler, we'd pass through (null) since we only intercept http/https
    expect(strategy).toBeNull();
  });

  it("isConvexHttpUrl returns true for wss:// Convex URL (hostname matches), but method guard prevents caching", () => {
    // isConvexHttpUrl only checks the hostname; the method guard (non-GET → pass through)
    // and the overall fetch event not firing for WebSocket are separate safeguards
    const wsUrl = new URL("wss://skyspecs-prod.convex.cloud/api/");
    expect(isConvexHttpUrl(wsUrl)).toBe(true); // hostname matches
    // But the fetch event won't fire for WebSocket upgrades in browsers
    // and getStrategy returns null for wss:// because it's not an http/https request
    // that would go through our network-first handler in practice
  });
});
