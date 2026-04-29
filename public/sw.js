/**
 * sw.js — SkySpecs SCAN Service Worker
 *
 * Provides PWA installation support for the SCAN mobile app.
 * Handles install and activate lifecycle events with versioned
 * cache management and stale cache cleanup.
 *
 * Scope: /scan/ (configured at registration time via ServiceWorkerRegistration component)
 *
 * Cache strategy:
 *   - App shell assets pre-cached on install for reliable PWA launch
 *   - Network-first for API and Convex requests (online-only app)
 *   - Cache-first for static assets (JS, CSS, images, fonts) with network
 *     fallback and cache population on miss
 *   - Stale caches from previous versions deleted on activate
 *
 * Network-first strategy (Sub-AC 27c-3):
 *   Applied to all dynamic/data requests so fresh content is always served
 *   when online.  On network failure the handler falls back to a cached copy
 *   so the shell can still render stale data rather than a hard crash.
 *
 *   Covered request types:
 *     1. Same-origin API routes:  /api/**
 *     2. Convex HTTP API calls:   GET *.convex.cloud/**
 *
 *   Not covered (by design):
 *     - WebSocket connections: The Service Worker fetch event is NOT fired
 *       for WebSocket upgrades (RFC 6455 / Upgrade: websocket).  Convex's
 *       primary real-time channel (wss://*.convex.cloud) therefore bypasses
 *       the SW entirely — this is expected and correct.  Reconnect resilience
 *       is handled by the Convex client SDK's built-in retry logic.
 *     - Non-GET cross-origin requests: POST/PUT/DELETE mutations to the Convex
 *       HTTP API are passed through without caching — caching mutation requests
 *       would cause correctness issues (re-executing side effects on cache hit).
 *
 * Cache versioning:
 *   Bump CACHE_VERSION to force a cache refresh on the next deployment.
 *   The activate handler deletes all "scan-cache-*" entries that don't
 *   match the current CACHE_NAME, so users are never served stale assets.
 */

/* ─── Cache versioning ───────────────────────────────────────────────────── */

const CACHE_VERSION = "v1";
const CACHE_NAME = `scan-cache-${CACHE_VERSION}`;

/**
 * Hostname suffix that identifies the Convex cloud deployment.
 *
 * Convex HTTP API endpoints follow the pattern:
 *   https://<deployment-name>.convex.cloud/api/query   (GET — queries)
 *   https://<deployment-name>.convex.cloud/api/mutation (POST — mutations)
 *   wss://<deployment-name>.convex.cloud/api/           (WebSocket — subscriptions)
 *
 * Only GET requests to this origin are routed through the network-first
 * handler; POST/other methods are passed through unchanged.
 */
const CONVEX_HOST_SUFFIX = ".convex.cloud";

/**
 * File extensions that identify static assets eligible for the
 * cache-first strategy.  These never change once deployed (content-
 * hashed filenames ensure freshness), so serving from cache is safe.
 *
 * Groups:
 *   JS    — .js, .mjs
 *   CSS   — .css
 *   Image — .png, .jpg, .jpeg, .webp, .gif, .avif, .ico, .svg
 *   Font  — .woff, .woff2, .ttf, .otf, .eot
 */
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

/**
 * Static assets to pre-cache on install.
 *
 * Kept minimal — the SCAN app is online-only (no offline mode required).
 * These are the bare minimum needed so the home screen icon launches
 * into a meaningful shell even before the main JS bundle is available.
 */
const PRECACHE_URLS = [
  "/manifest.json",
  "/favicon.svg",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

/* ─── URL classification ─────────────────────────────────────────────────── */

/**
 * Returns true if the given pathname should be served with the
 * cache-first strategy.
 *
 * Matches by path prefix for well-known Next.js locations, and by
 * file extension for fonts and image types that can appear anywhere
 * in the public path.
 *
 * @param {string} pathname - URL pathname (e.g. "/_next/static/chunks/main.js")
 * @returns {boolean}
 */
function isStaticAssetPath(pathname) {
  // /_next/static/ — all Next.js compiled assets (JS chunks, CSS, fonts, media)
  if (pathname.startsWith("/_next/static/")) return true;

  // /_next/image — optimized image responses from the <Image> component
  // Matches both /_next/image (bare) and /_next/image/... (nested)
  if (pathname === "/_next/image" || pathname.startsWith("/_next/image/")) return true;

  // /icons/ — PWA app icons
  if (pathname.startsWith("/icons/")) return true;

  // Well-known single files
  if (pathname === "/manifest.json") return true;
  if (pathname === "/favicon.svg") return true;

  // Extension-based matching — covers fonts and images served from any
  // public path (e.g. /fonts/inter-tight.woff2, /images/placeholder.png)
  const lastDot = pathname.lastIndexOf(".");
  if (lastDot !== -1) {
    const ext = pathname.slice(lastDot).toLowerCase();
    if (STATIC_ASSET_EXTENSIONS.has(ext)) return true;
  }

  return false;
}

/**
 * Returns true if the request URL targets the Convex HTTP API.
 *
 * Convex uses `*.convex.cloud` for all deployment endpoints.
 * This function matches any subdomain of that suffix so it works
 * across all deployment names (dev, staging, production slugs).
 *
 * Only GET requests to this origin will be routed through the
 * network-first handler — the caller is responsible for checking
 * request.method before calling this.
 *
 * Note: WebSocket upgrades (wss://*.convex.cloud) are NOT matched by
 * the fetch event and therefore never reach this function.
 *
 * @param {URL} url - Parsed URL object for the request
 * @returns {boolean}
 */
function isConvexHttpUrl(url) {
  return url.hostname.endsWith(CONVEX_HOST_SUFFIX);
}

/* ─── Install ────────────────────────────────────────────────────────────── */

/**
 * Install event — fired when this service worker version is first registered.
 *
 * 1. Opens (or creates) the versioned cache.
 * 2. Pre-caches the minimal app shell assets.
 * 3. Calls skipWaiting() so the new worker activates immediately
 *    without waiting for existing clients to close.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(PRECACHE_URLS).catch((err) => {
          // Pre-cache failures are non-fatal for an online-only app.
          // Log the error so it's visible in DevTools but let install succeed.
          console.warn("[SW] Pre-cache partial failure:", err);
        })
      )
      .then(() => self.skipWaiting())
  );
});

/* ─── Activate ───────────────────────────────────────────────────────────── */

/**
 * Activate event — fired after install, once the old service worker has
 * finished handling any in-flight requests.
 *
 * 1. Enumerates all cache storage keys.
 * 2. Deletes any "scan-cache-*" entry that does NOT match CACHE_NAME
 *    (i.e., caches from previous CACHE_VERSION values).
 * 3. Calls clients.claim() so the new worker takes control of all open
 *    /scan/* tabs immediately — without a page reload.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (name) =>
                name.startsWith("scan-cache-") && name !== CACHE_NAME
            )
            .map((staleName) => {
              console.log("[SW] Deleting stale cache:", staleName);
              return caches.delete(staleName);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ─── Fetch ──────────────────────────────────────────────────────────────── */

/**
 * Cache-first handler for static assets.
 *
 * 1. Look up the request in CacheStorage.
 * 2. Return the cached response immediately on a hit (fast path).
 * 3. On a miss: fetch from network, populate the cache with a clone,
 *    and return the live response.
 * 4. Cache writes are fire-and-forget; failures are swallowed so a
 *    QuotaExceededError or similar never breaks the response.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;

    return fetch(request).then((response) => {
      // Only cache successful, non-opaque responses.
      if (response.ok) {
        const clone = response.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(request, clone))
          .catch(() => {
            // Cache write failure is non-fatal — serve the live response.
          });
      }
      return response;
    });
  });
}

/**
 * Network-first handler with stale cache fallback (Sub-AC 27c-3).
 *
 * Strategy:
 *   1. Attempt the network request.
 *   2. On success: cache a clone of the response (for future offline use),
 *      then return the live response to the caller.
 *   3. On network error (TypeError — offline, DNS failure, timeout):
 *      check the cache for a stale copy and return it if available.
 *   4. If both network and cache fail: return Response.error() so the
 *      caller receives a proper network-error response.
 *
 * Only successful (response.ok === true) responses are cached.
 * Non-2xx responses (4xx, 5xx) are returned to the caller but not
 * stored — stale-while-revalidate semantics are not appropriate for
 * error responses.
 *
 * Used for:
 *   - Same-origin API routes (/api/**)
 *   - Convex HTTP API GET requests (*.convex.cloud)
 *   - Same-origin page navigations (HTML documents)
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(request, clone))
          .catch(() => {});
      }
      return response;
    })
    .catch(() =>
      caches
        .match(request)
        .then((cached) => cached ?? Response.error())
    );
}

/**
 * Fetch event — intercepts network requests from /scan/* pages.
 *
 * Strategy matrix:
 *
 *   Request type                         Strategy
 *   ─────────────────────────────────────────────────────────────────────
 *   Non-GET (POST/PUT/DELETE/etc.)       Pass through — mutations must
 *                                        not be cached or replayed
 *
 *   Same-origin /api/** (GET)            Network-first with cache fallback
 *                                        Fresh API data is always preferred;
 *                                        stale cache serves as offline safety
 *
 *   Convex HTTP GET (*.convex.cloud)     Network-first with cache fallback
 *                                        Covers HTTP query transport when the
 *                                        WebSocket channel is unavailable
 *
 *   Same-origin static assets (GET)      Cache-first, populate on miss
 *   /_next/static/**, /_next/image/**,   Content-hashed assets never change;
 *   /icons/**, font/image extensions     cache-first gives fast load times
 *
 *   Same-origin page navigations (GET)   Network-first with cache fallback
 *   /scan/*, /inventory, etc.            HTML documents should always be fresh
 *
 *   Cross-origin, non-Convex (GET)       Pass through — third-party resources
 *                                        (maps tiles, analytics) are not cached
 *
 * WebSocket note:
 *   The Service Worker fetch event is NOT fired for WebSocket connections
 *   (wss://*.convex.cloud).  Convex real-time subscriptions therefore
 *   bypass the SW entirely — the Convex SDK's built-in reconnect logic
 *   handles transient connectivity loss.
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // ── Parse URL ────────────────────────────────────────────────────────────
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // ── Guard: pass through all non-GET requests ─────────────────────────────
  // POST/PUT/DELETE mutations must never be cached or replayed from cache.
  // This applies to both same-origin API mutations and Convex mutations.
  if (request.method !== "GET") {
    return;
  }

  const isSameOrigin = url.origin === self.location.origin;

  // ── Same-origin routing ──────────────────────────────────────────────────
  if (isSameOrigin) {
    // API routes — network-first (fresh data required, fallback to stale cache)
    if (url.pathname.startsWith("/api/")) {
      event.respondWith(networkFirst(request));
      return;
    }

    // Static assets (JS, CSS, images, fonts) — cache-first for fast loads
    if (isStaticAssetPath(url.pathname)) {
      event.respondWith(cacheFirst(request));
      return;
    }

    // Page navigations and all other same-origin routes — network-first
    event.respondWith(networkFirst(request));
    return;
  }

  // ── Cross-origin routing ─────────────────────────────────────────────────

  // Convex HTTP API (*.convex.cloud) — network-first with cache fallback.
  //
  // Convex uses HTTP as a transport for queries when the WebSocket channel
  // is not yet established or falls back from WebSocket.  GET requests to
  // the Convex deployment are safe to cache because they are read-only
  // (queries).  A stale cache copy allows the UI to show the last known
  // state when the device temporarily loses connectivity.
  //
  // POST requests to Convex (mutations, actions) are excluded above by the
  // non-GET guard — they must reach the server to execute side effects.
  if (isConvexHttpUrl(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // All other cross-origin requests (Mapbox tiles, third-party fonts,
  // analytics, etc.) pass through without interception.
});
