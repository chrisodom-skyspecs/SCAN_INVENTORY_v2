/**
 * sw-cache-strategy.test.ts
 *
 * Unit tests for the service worker cache-first fetch strategy
 * (Sub-AC 27c-2).
 *
 * Tests cover:
 *   1. isStaticAssetPath — URL classification for JS, CSS, images, fonts
 *   2. cacheFirst — cache hit returns cached response; cache miss fetches
 *      from network and populates the cache
 *   3. networkFirst — network success wins; falls back to cache on failure
 *
 * The service worker itself is a plain script (not an ESM module) so the
 * classification and handler logic is mirrored here as pure functions that
 * share the same decision tree.  Any change to sw.js routing rules must be
 * reflected here.
 *
 * Run: npx vitest run
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mirror of sw.js URL classification logic ─────────────────────────────────
//
// Must stay in sync with STATIC_ASSET_EXTENSIONS and isStaticAssetPath in
// public/sw.js.  If you add a new extension or path rule there, add it here.

const STATIC_ASSET_EXTENSIONS = new Set([
  // JavaScript
  ".js",
  ".mjs",
  // Styles
  ".css",
  // Images
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".avif",
  ".ico",
  ".svg",
  // Fonts
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
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

// ─── Mock CacheStorage helpers ────────────────────────────────────────────────

/** Minimal mock for a Cache object. */
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

/** Minimal mock for CacheStorage. */
function makeCaches(namedCaches: Record<string, ReturnType<typeof makeCache>> = {}) {
  return {
    open: vi.fn(async (name: string) => {
      if (!namedCaches[name]) {
        namedCaches[name] = makeCache();
      }
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

/** Build a minimal fake Response. */
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

/** Build a minimal fake Request. */
function makeRequest(url: string): Request {
  return { url, method: "GET" } as unknown as Request;
}

// ─── Cache-first handler (mirrored from sw.js) ────────────────────────────────

const CACHE_NAME = "scan-cache-v1";

async function cacheFirst(
  request: Request,
  cachesApi: ReturnType<typeof makeCaches>
): Promise<Response> {
  const cached = await cachesApi.match(request);
  if (cached) return cached;

  const response = await fetch(request.url);
  if (response.ok) {
    const cache = await cachesApi.open(CACHE_NAME);
    await cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

// ─── Network-first handler (mirrored from sw.js) ──────────────────────────────

async function networkFirst(
  request: Request,
  cachesApi: ReturnType<typeof makeCaches>,
  fetchFn: (url: string) => Promise<Response>
): Promise<Response> {
  try {
    const response = await fetchFn(request.url);
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
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. isStaticAssetPath — URL classification ────────────────────────────────

describe("isStaticAssetPath — Next.js path prefixes", () => {
  it("matches /_next/static/ (JS chunk)", () => {
    expect(isStaticAssetPath("/_next/static/chunks/main.js")).toBe(true);
  });

  it("matches /_next/static/ (CSS chunk)", () => {
    expect(isStaticAssetPath("/_next/static/css/app-hash.css")).toBe(true);
  });

  it("matches /_next/static/ (font file)", () => {
    expect(isStaticAssetPath("/_next/static/media/inter-tight.woff2")).toBe(true);
  });

  it("matches /_next/static/ (image media)", () => {
    expect(isStaticAssetPath("/_next/static/media/logo.png")).toBe(true);
  });

  it("matches /_next/image/ (optimized image path with trailing slash)", () => {
    // In the service worker, isStaticAssetPath receives url.pathname only —
    // never the full URL string with query parameters.
    // url.pathname for https://example.com/_next/image/?url=... is "/_next/image/"
    expect(isStaticAssetPath("/_next/image/")).toBe(true);
  });

  it("matches /_next/image path prefix (bare, no trailing slash)", () => {
    expect(isStaticAssetPath("/_next/image")).toBe(true);
  });
});

describe("isStaticAssetPath — /icons/ prefix", () => {
  it("matches /icons/icon-192.svg", () => {
    expect(isStaticAssetPath("/icons/icon-192.svg")).toBe(true);
  });

  it("matches /icons/icon-512.svg", () => {
    expect(isStaticAssetPath("/icons/icon-512.svg")).toBe(true);
  });

  it("matches /icons/icon-72.svg", () => {
    expect(isStaticAssetPath("/icons/icon-72.svg")).toBe(true);
  });
});

describe("isStaticAssetPath — specific well-known files", () => {
  it("matches /manifest.json", () => {
    expect(isStaticAssetPath("/manifest.json")).toBe(true);
  });

  it("matches /favicon.svg", () => {
    expect(isStaticAssetPath("/favicon.svg")).toBe(true);
  });

  it("does NOT match /manifest.json.map (similar but not exact)", () => {
    // Extension-based rule kicks in — .map is not in the set
    expect(isStaticAssetPath("/manifest.json.map")).toBe(false);
  });
});

describe("isStaticAssetPath — JavaScript files", () => {
  it("matches .js files at arbitrary paths", () => {
    expect(isStaticAssetPath("/scripts/analytics.js")).toBe(true);
  });

  it("matches .mjs (ES module) files", () => {
    expect(isStaticAssetPath("/lib/utils.mjs")).toBe(true);
  });

  it("matches uppercase .JS extension (case-insensitive)", () => {
    expect(isStaticAssetPath("/bundle.JS")).toBe(true);
  });
});

describe("isStaticAssetPath — CSS files", () => {
  it("matches .css files at arbitrary paths", () => {
    expect(isStaticAssetPath("/styles/tokens.css")).toBe(true);
  });

  it("matches .CSS (case-insensitive)", () => {
    expect(isStaticAssetPath("/styles/global.CSS")).toBe(true);
  });
});

describe("isStaticAssetPath — image files", () => {
  const imageExts = [
    [".png", "/images/photo.png"],
    [".jpg", "/images/photo.jpg"],
    [".jpeg", "/images/photo.jpeg"],
    [".webp", "/images/photo.webp"],
    [".gif", "/images/animation.gif"],
    [".avif", "/images/photo.avif"],
    [".ico", "/favicon.ico"],
    [".svg", "/images/logo.svg"],
  ] as const;

  for (const [ext, path] of imageExts) {
    it(`matches ${ext} image files`, () => {
      expect(isStaticAssetPath(path)).toBe(true);
    });
  }

  it("matches uppercase image extensions (case-insensitive)", () => {
    expect(isStaticAssetPath("/images/photo.PNG")).toBe(true);
    expect(isStaticAssetPath("/images/photo.WEBP")).toBe(true);
  });
});

describe("isStaticAssetPath — font files", () => {
  const fontExts = [
    [".woff", "/fonts/inter.woff"],
    [".woff2", "/fonts/inter-tight.woff2"],
    [".ttf", "/fonts/inter.ttf"],
    [".otf", "/fonts/inter.otf"],
    [".eot", "/fonts/inter.eot"],
  ] as const;

  for (const [ext, path] of fontExts) {
    it(`matches ${ext} font files`, () => {
      expect(isStaticAssetPath(path)).toBe(true);
    });
  }

  it("matches uppercase font extensions (case-insensitive)", () => {
    expect(isStaticAssetPath("/fonts/inter.WOFF2")).toBe(true);
  });
});

describe("isStaticAssetPath — paths that must NOT be cached statically", () => {
  it("does NOT match /api/cases/map (API route)", () => {
    expect(isStaticAssetPath("/api/cases/map")).toBe(false);
  });

  it("does NOT match /api/auth/login (auth route)", () => {
    expect(isStaticAssetPath("/api/auth/login")).toBe(false);
  });

  it("does NOT match /scan/CASE-001 (page navigation)", () => {
    expect(isStaticAssetPath("/scan/CASE-001")).toBe(false);
  });

  it("does NOT match /inventory (page navigation)", () => {
    expect(isStaticAssetPath("/inventory")).toBe(false);
  });

  it("does NOT match / (root page)", () => {
    expect(isStaticAssetPath("/")).toBe(false);
  });

  it("does NOT match /scan (SCAN landing page)", () => {
    expect(isStaticAssetPath("/scan")).toBe(false);
  });

  it("does NOT match /case/CASE-001 (QR deep-link redirect)", () => {
    expect(isStaticAssetPath("/case/CASE-001")).toBe(false);
  });

  it("does NOT match paths with no extension that aren't known prefixes", () => {
    expect(isStaticAssetPath("/some/random/path")).toBe(false);
  });

  it("does NOT match .json files generically (only /manifest.json explicitly)", () => {
    // .json is not in STATIC_ASSET_EXTENSIONS
    expect(isStaticAssetPath("/data/config.json")).toBe(false);
  });

  it("does NOT match .map source map files", () => {
    expect(isStaticAssetPath("/scripts/bundle.js.map")).toBe(false);
  });

  it("does NOT match .ts TypeScript source files", () => {
    expect(isStaticAssetPath("/src/app/page.ts")).toBe(false);
  });
});

// ─── 2. Cache-first handler ───────────────────────────────────────────────────

describe("cacheFirst — cache hit", () => {
  it("returns the cached response without calling fetch", async () => {
    const cachedResponse = makeResponse("cached content");
    const globalMatch = vi.fn(async () => cachedResponse);
    const cachesApi = makeCaches();
    cachesApi.match = globalMatch;

    const req = makeRequest("https://example.com/_next/static/chunks/main.js");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(makeResponse("network content"));

    const result = await cacheFirst(req, cachesApi);

    expect(result).toBe(cachedResponse);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("cacheFirst — cache miss", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches from network when cache misses", async () => {
    const networkResponse = makeResponse("network content");
    const cachesApi = makeCaches();
    cachesApi.match = vi.fn(async () => undefined);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(networkResponse);

    const req = makeRequest("https://example.com/_next/static/chunks/app.js");
    const result = await cacheFirst(req, cachesApi);

    expect(fetch).toHaveBeenCalledOnce();
    expect(result).toBe(networkResponse);
  });

  it("populates the cache after a network fetch on miss", async () => {
    const networkResponse = makeResponse("network content");
    const namedCaches: Record<string, ReturnType<typeof makeCache>> = {};
    const cachesApi = makeCaches(namedCaches);
    cachesApi.match = vi.fn(async () => undefined);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(networkResponse);

    const req = makeRequest("https://example.com/_next/static/css/app.css");
    await cacheFirst(req, cachesApi);

    expect(cachesApi.open).toHaveBeenCalledWith(CACHE_NAME);
    const cache = namedCaches[CACHE_NAME];
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it("does NOT populate the cache when network response is not ok", async () => {
    const errorResponse = makeResponse("not found", false, 404);
    const cachesApi = makeCaches();
    cachesApi.match = vi.fn(async () => undefined);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(errorResponse);

    const req = makeRequest("https://example.com/_next/static/chunks/missing.js");
    const result = await cacheFirst(req, cachesApi);

    // Cache should not be opened for writing on non-ok responses
    expect(cachesApi.open).not.toHaveBeenCalled();
    expect(result).toBe(errorResponse);
  });

  it("clones the response before caching (response body remains readable)", async () => {
    const networkResponse = makeResponse("body content");
    const cachesApi = makeCaches();
    cachesApi.match = vi.fn(async () => undefined);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(networkResponse);

    const req = makeRequest("https://example.com/_next/static/media/font.woff2");
    await cacheFirst(req, cachesApi);

    // clone() must be called so the original response body can be consumed
    expect(networkResponse.clone).toHaveBeenCalled();
  });
});

// ─── 3. Network-first handler ─────────────────────────────────────────────────

describe("networkFirst — network success", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the network response when fetch succeeds", async () => {
    const networkResponse = makeResponse("fresh data");
    const cachesApi = makeCaches();
    const fetchFn = vi.fn(async () => networkResponse);

    const req = makeRequest("https://example.com/api/cases/map");
    const result = await networkFirst(req, cachesApi, fetchFn);

    expect(result).toBe(networkResponse);
  });

  it("populates cache after successful network response", async () => {
    const networkResponse = makeResponse("fresh data");
    const namedCaches: Record<string, ReturnType<typeof makeCache>> = {};
    const cachesApi = makeCaches(namedCaches);
    const fetchFn = vi.fn(async () => networkResponse);

    const req = makeRequest("https://example.com/api/cases/map");
    await networkFirst(req, cachesApi, fetchFn);

    expect(cachesApi.open).toHaveBeenCalledWith(CACHE_NAME);
    const cache = namedCaches[CACHE_NAME];
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it("does NOT cache non-ok responses", async () => {
    const errorResponse = makeResponse("server error", false, 500);
    const cachesApi = makeCaches();
    const fetchFn = vi.fn(async () => errorResponse);

    const req = makeRequest("https://example.com/api/cases/map");
    const result = await networkFirst(req, cachesApi, fetchFn);

    expect(cachesApi.open).not.toHaveBeenCalled();
    expect(result).toBe(errorResponse);
  });
});

describe("networkFirst — network failure fallback", () => {
  it("returns cached response when network fails and cache has entry", async () => {
    const cachedResponse = makeResponse("stale cached data");
    const cachesApi = makeCaches();
    cachesApi.match = vi.fn(async () => cachedResponse);
    const fetchFn = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    const req = makeRequest("https://example.com/scan/CASE-001");
    const result = await networkFirst(req, cachesApi, fetchFn);

    expect(result).toBe(cachedResponse);
  });

  it("returns Response.error() when network fails and cache is empty", async () => {
    const cachesApi = makeCaches();
    cachesApi.match = vi.fn(async () => undefined);
    const fetchFn = vi.fn(async () => { throw new TypeError("Failed to fetch"); });

    const req = makeRequest("https://example.com/scan/CASE-001");
    const result = await networkFirst(req, cachesApi, fetchFn);

    // Response.error() creates a 0-status network error response
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });
});

// ─── 4. Routing integration — strategy dispatch ───────────────────────────────

describe("fetch strategy routing", () => {
  /**
   * Simulate the strategy dispatch logic from sw.js fetch handler:
   * Determines which strategy to apply based on the request URL pathname.
   */
  function getStrategyForPath(pathname: string): "cache-first" | "network-first" {
    if (pathname.startsWith("/api/")) return "network-first";
    if (isStaticAssetPath(pathname)) return "cache-first";
    return "network-first";
  }

  it("routes /_next/static/ paths to cache-first", () => {
    expect(getStrategyForPath("/_next/static/chunks/main.js")).toBe("cache-first");
    expect(getStrategyForPath("/_next/static/css/app.css")).toBe("cache-first");
    expect(getStrategyForPath("/_next/static/media/font.woff2")).toBe("cache-first");
  });

  it("routes /_next/image/ paths to cache-first", () => {
    expect(getStrategyForPath("/_next/image/")).toBe("cache-first");
  });

  it("routes /icons/ paths to cache-first", () => {
    expect(getStrategyForPath("/icons/icon-192.svg")).toBe("cache-first");
  });

  it("routes /manifest.json to cache-first", () => {
    expect(getStrategyForPath("/manifest.json")).toBe("cache-first");
  });

  it("routes /favicon.svg to cache-first", () => {
    expect(getStrategyForPath("/favicon.svg")).toBe("cache-first");
  });

  it("routes font file extensions to cache-first", () => {
    expect(getStrategyForPath("/fonts/inter-tight.woff2")).toBe("cache-first");
    expect(getStrategyForPath("/fonts/icon-font.woff")).toBe("cache-first");
    expect(getStrategyForPath("/fonts/mono.ttf")).toBe("cache-first");
  });

  it("routes image file extensions to cache-first", () => {
    expect(getStrategyForPath("/images/hero.png")).toBe("cache-first");
    expect(getStrategyForPath("/images/photo.jpg")).toBe("cache-first");
    expect(getStrategyForPath("/images/animation.gif")).toBe("cache-first");
    expect(getStrategyForPath("/images/modern.webp")).toBe("cache-first");
    expect(getStrategyForPath("/images/next-gen.avif")).toBe("cache-first");
  });

  it("routes /api/ paths to network-first", () => {
    expect(getStrategyForPath("/api/cases/map")).toBe("network-first");
    expect(getStrategyForPath("/api/auth/login")).toBe("network-first");
    expect(getStrategyForPath("/api/telemetry")).toBe("network-first");
  });

  it("routes page navigations to network-first", () => {
    expect(getStrategyForPath("/")).toBe("network-first");
    expect(getStrategyForPath("/scan")).toBe("network-first");
    expect(getStrategyForPath("/scan/CASE-001")).toBe("network-first");
    expect(getStrategyForPath("/inventory")).toBe("network-first");
  });

  it("routes /case/ deep-link redirects to network-first", () => {
    expect(getStrategyForPath("/case/CASE-001")).toBe("network-first");
  });
});

// ─── 5. STATIC_ASSET_EXTENSIONS completeness ──────────────────────────────────

describe("STATIC_ASSET_EXTENSIONS — required file types", () => {
  const requiredGroups = {
    JavaScript: [".js", ".mjs"],
    CSS: [".css"],
    "Image (raster)": [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".ico"],
    "Image (vector)": [".svg"],
    "Font (variable/modern)": [".woff", ".woff2"],
    "Font (legacy)": [".ttf", ".otf", ".eot"],
  } as const;

  for (const [group, extensions] of Object.entries(requiredGroups)) {
    for (const ext of extensions) {
      it(`includes ${ext} (${group})`, () => {
        expect(STATIC_ASSET_EXTENSIONS.has(ext)).toBe(true);
      });
    }
  }
});
