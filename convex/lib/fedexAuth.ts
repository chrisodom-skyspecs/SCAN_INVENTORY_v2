/**
 * convex/lib/fedexAuth.ts
 *
 * FedEx OAuth 2.0 token service for use inside Convex actions.
 *
 * ## Purpose
 * Provides a single `getBearerToken(ctx)` function that returns a valid
 * FedEx OAuth bearer token, caching it to avoid redundant auth calls.
 *
 * ## Caching strategy
 * FedEx OAuth tokens are valid for ~3600 seconds (1 hour). Re-authenticating
 * on every action invocation wastes latency and risks hitting OAuth rate limits.
 * This module uses a two-layer cache:
 *
 *   Layer 1 — Process-level cache (module variable, ~0 ms)
 *     Reused across warm Convex worker invocations within the same process.
 *     Not reliable across cold starts, but very fast when it hits.
 *
 *   Layer 2 — Convex database cache (fedexTokenCache table, ~1-5 ms)
 *     Survives process restarts and is shared across all Convex workers.
 *     This is the primary persistence layer.  The `getCachedToken` internal
 *     query reads the cached token; `setCachedToken` internal mutation writes
 *     it after a fresh OAuth exchange.
 *
 *   Layer 3 — Fresh OAuth exchange (FedEx API call, ~200-500 ms)
 *     Only executed when both caches are cold (first call) or the stored
 *     token is within EXPIRY_BUFFER_MS of expiry.
 *
 * ## Usage
 * ```typescript
 * // Inside a Convex action handler:
 * import { getBearerToken } from "./lib/fedexAuth";
 *
 * export const myAction = action({
 *   handler: async (ctx, args) => {
 *     const token = await getBearerToken(ctx);
 *     // use token in FedEx API call...
 *   },
 * });
 * ```
 *
 * ## Environment variables (set in Convex dashboard)
 *   FEDEX_CLIENT_ID        OAuth2 client ID from FedEx Developer Portal
 *   FEDEX_CLIENT_SECRET    OAuth2 client secret from FedEx Developer Portal
 *   FEDEX_API_BASE_URL     (optional) Override base URL; defaults to
 *                          https://apis.fedex.com.
 *                          Set to https://apis-sandbox.fedex.com for sandbox.
 *
 * ## Internal Convex functions
 * This module also exports two registered Convex functions:
 *   getCachedToken   — internal query: read the cached token from DB
 *   setCachedToken   — internal mutation: write a fresh token to DB
 *
 * These are registered under the path `internal.lib.fedexAuth.*` once
 * Convex processes this directory.
 */

import { internalQuery, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { GenericActionCtx } from "convex/server";

// Action context type — bound to this project's DataModel.
// `any` matches the generated stub (overwritten by `npx convex dev`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActionCtx = GenericActionCtx<any>;

// ─── Constants ────────────────────────────────────────────────────────────────

/** FedEx production OAuth + API base URL. */
const FEDEX_PRODUCTION_BASE = "https://apis.fedex.com";

/**
 * Safety margin applied when checking token validity.
 * A cached token that expires within this window is treated as expired so
 * there is always sufficient time to complete an in-flight API request before
 * the token actually expires mid-request.
 */
const EXPIRY_BUFFER_MS = 60_000; // 60 seconds

// ─── Error types ──────────────────────────────────────────────────────────────

/** Machine-readable error codes produced by this module. */
export type FedExAuthErrorCode =
  | "CONFIGURATION_ERROR" // Missing / invalid FEDEX_CLIENT_ID or _SECRET
  | "AUTH_ERROR"          // FedEx OAuth endpoint returned a non-2xx response
  | "PARSE_ERROR"         // OAuth response body was malformed / missing fields
  | "NETWORK_ERROR";      // fetch() threw (DNS failure, timeout, etc.)

/**
 * Structured error thrown by `getBearerToken` and `fetchFreshToken`.
 *
 * Callers should narrow on `err.code` to decide how to surface failures:
 *   CONFIGURATION_ERROR → admin misconfiguration; log and surface to ops team
 *   AUTH_ERROR          → invalid credentials; do not retry automatically
 *   PARSE_ERROR         → unexpected FedEx API change; log for investigation
 *   NETWORK_ERROR       → transient; safe to retry with back-off
 *
 * @example
 * try {
 *   const token = await getBearerToken(ctx);
 * } catch (err) {
 *   if (err instanceof FedExAuthError && err.code === "NETWORK_ERROR") {
 *     // schedule a retry
 *   }
 *   throw err;
 * }
 */
export class FedExAuthError extends Error {
  readonly code: FedExAuthErrorCode;
  /** HTTP status code when the error originated from an HTTP response. */
  readonly statusCode?: number;
  /** Raw response body or original error for debugging. */
  readonly raw?: unknown;

  constructor(
    code: FedExAuthErrorCode,
    message: string,
    options?: { statusCode?: number; raw?: unknown }
  ) {
    super(message);
    this.name = "FedExAuthError";
    this.code = code;
    this.statusCode = options?.statusCode;
    this.raw = options?.raw;
  }
}

// ─── Process-level cache (Layer 1) ───────────────────────────────────────────

/** Shape of a cached bearer token (shared by both cache layers). */
interface CachedToken {
  /** The OAuth 2.0 bearer token string. */
  accessToken: string;
  /** Epoch ms when the token expires (as reported by FedEx, no buffer applied). */
  expiresAt: number;
}

/**
 * Module-level in-process cache.
 * Populated on the first successful token fetch and reused for the lifetime
 * of the worker process.  Survives across multiple action invocations when
 * Convex reuses the same worker (warm starts).
 *
 * This is intentionally module-scoped (not a `let` inside a function) so that
 * it persists as long as the JavaScript module remains loaded in the process.
 */
let _processCache: CachedToken | null = null;

// ─── Configuration helpers ────────────────────────────────────────────────────

/** Resolved FedEx API base URL (production unless FEDEX_API_BASE_URL overrides). */
function getBaseUrl(): string {
  const override = process.env.FEDEX_API_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, ""); // strip trailing slash
  return FEDEX_PRODUCTION_BASE;
}

/**
 * Read and validate FedEx client credentials from Convex environment variables.
 *
 * @throws {FedExAuthError} with code CONFIGURATION_ERROR when either variable
 *         is absent or blank.
 */
function getCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.FEDEX_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.FEDEX_CLIENT_SECRET?.trim() ?? "";

  if (!clientId || !clientSecret) {
    throw new FedExAuthError(
      "CONFIGURATION_ERROR",
      "FedEx credentials are not configured. " +
        "Set FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET in the Convex dashboard " +
        "under Settings → Environment Variables."
    );
  }

  return { clientId, clientSecret };
}

// ─── DB cache: internal Convex functions (Layer 2) ────────────────────────────
//
// These are registered as Convex functions under the path:
//   internal.lib.fedexAuth.getCachedToken
//   internal.lib.fedexAuth.setCachedToken
//
// They are INTERNAL — not callable from client-side code — to prevent
// leaking OAuth tokens to the browser.

/**
 * Internal query: read the current cached token from the `fedexTokenCache` table.
 *
 * Returns null when:
 *   • No record exists for service="fedex"
 *   • The stored token is within EXPIRY_BUFFER_MS of expiry (treated as expired)
 *
 * Called by `getBearerToken` as Layer 2 of the token cache.
 */
export const getCachedToken = internalQuery({
  args: {},
  handler: async (ctx): Promise<CachedToken | null> => {
    const row = await ctx.db
      .query("fedexTokenCache")
      .withIndex("by_service", (q) => q.eq("service", "fedex"))
      .first();

    if (!row) return null;

    // Treat tokens expiring within the buffer window as already expired so
    // we always have margin to complete an in-flight request.
    if (Date.now() >= row.expiresAt - EXPIRY_BUFFER_MS) return null;

    return { accessToken: row.accessToken, expiresAt: row.expiresAt };
  },
});

/**
 * Internal mutation: upsert a fresh bearer token into the `fedexTokenCache` table.
 *
 * Uses a read-then-patch/insert pattern to avoid duplicate rows:
 *   • If a row for service="fedex" already exists → patch it in place.
 *   • Otherwise → insert a new row.
 *
 * Called by `getBearerToken` after a successful FedEx OAuth exchange.
 */
export const setCachedToken = internalMutation({
  args: {
    /** The OAuth 2.0 bearer token to cache. */
    accessToken: v.string(),
    /** Epoch ms when this token expires (from FedEx `expires_in` field). */
    expiresAt: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const now = Date.now();

    const existing = await ctx.db
      .query("fedexTokenCache")
      .withIndex("by_service", (q) => q.eq("service", "fedex"))
      .first();

    if (existing) {
      // Update the existing row — preserves the original createdAt timestamp.
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        expiresAt: args.expiresAt,
        updatedAt: now,
      });
    } else {
      // First-time insert.
      await ctx.db.insert("fedexTokenCache", {
        service: "fedex",
        accessToken: args.accessToken,
        expiresAt: args.expiresAt,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// ─── Fresh token fetch (Layer 3) ─────────────────────────────────────────────

/**
 * Exchange FedEx client credentials for a fresh OAuth 2.0 bearer token.
 *
 * This is the "cold path" — called only when both the process-level cache
 * and the database cache are empty or expired.  Sends a `client_credentials`
 * grant to the FedEx OAuth endpoint and returns the parsed token + expiry.
 *
 * @throws {FedExAuthError} on any failure (configuration, network, or parse).
 *
 * @internal — Exposed for testing only; production code should call
 *             `getBearerToken(ctx)` which manages caching automatically.
 */
export async function fetchFreshToken(): Promise<CachedToken> {
  const { clientId, clientSecret } = getCredentials();
  const url = `${getBaseUrl()}/oauth/token`;

  // ── HTTP request ────────────────────────────────────────────────────────────
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
  } catch (err) {
    throw new FedExAuthError(
      "NETWORK_ERROR",
      "Unable to reach FedEx OAuth endpoint. " +
        "Check network connectivity from the Convex runtime.",
      { raw: err }
    );
  }

  // ── Response validation ─────────────────────────────────────────────────────
  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new FedExAuthError(
      "AUTH_ERROR",
      `FedEx OAuth token exchange failed with HTTP ${response.status}. ` +
        "Verify FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET are correct.",
      { statusCode: response.status, raw: body }
    );
  }

  // ── JSON parsing ────────────────────────────────────────────────────────────
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new FedExAuthError(
      "PARSE_ERROR",
      "FedEx OAuth response is not valid JSON."
    );
  }

  const data = json as Record<string, unknown>;

  const access_token = data["access_token"];
  const expires_in = data["expires_in"];

  if (typeof access_token !== "string" || !access_token) {
    throw new FedExAuthError(
      "PARSE_ERROR",
      'FedEx OAuth response is missing or has an invalid "access_token" field.',
      { raw: json }
    );
  }

  // `expires_in` is in seconds; fall back to 3600 s (1 h) if absent/invalid.
  const expiresInSeconds =
    typeof expires_in === "number" && expires_in > 0 ? expires_in : 3600;

  return {
    accessToken: access_token,
    expiresAt: Date.now() + expiresInSeconds * 1_000,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a valid FedEx OAuth 2.0 bearer token with two-layer caching.
 *
 * Resolution order:
 *   1. **Process cache** — module-level variable; ~0 ms when warm.
 *   2. **DB cache** — `fedexTokenCache` table; ~1-5 ms; survives cold starts.
 *   3. **Fresh fetch** — FedEx OAuth endpoint; ~200-500 ms; only on cache miss.
 *
 * The token is considered usable until `EXPIRY_BUFFER_MS` (60 s) before its
 * actual expiry timestamp to ensure there is always time to complete an
 * in-flight FedEx API call before the token expires.
 *
 * After a fresh fetch, the token is stored in both the DB cache and the
 * process-level cache so subsequent calls in the same process are fast.
 *
 * @param ctx   Convex `ActionCtx` — provides access to `runQuery` and
 *              `runMutation` for DB cache interaction.  Must be called from
 *              within a Convex action handler, not a query or mutation.
 *
 * @returns The bearer token string, ready for use as `Authorization: Bearer <token>`.
 *
 * @throws {FedExAuthError} on configuration, network, or parse failure.
 *
 * @example
 * export const myFedExAction = action({
 *   handler: async (ctx, args) => {
 *     const token = await getBearerToken(ctx);
 *     const response = await fetch("https://apis.fedex.com/track/v1/trackingnumbers", {
 *       method: "POST",
 *       headers: {
 *         Authorization: `Bearer ${token}`,
 *         "Content-Type": "application/json",
 *       },
 *       body: JSON.stringify({ ... }),
 *     });
 *     // ...
 *   },
 * });
 */
export async function getBearerToken(ctx: ActionCtx): Promise<string> {
  const now = Date.now();

  // ── Layer 1: Process cache ──────────────────────────────────────────────────
  if (_processCache && now < _processCache.expiresAt - EXPIRY_BUFFER_MS) {
    return _processCache.accessToken;
  }

  // ── Layer 2: Database cache ─────────────────────────────────────────────────
  // Run as an internal query so the token is never exposed to client consumers.
  const dbCached = await ctx.runQuery(
    internal.lib.fedexAuth.getCachedToken,
    {}
  );
  if (dbCached) {
    // Populate the process cache from the DB value so the next call in this
    // process is served from Layer 1 without a DB round-trip.
    _processCache = dbCached;
    return dbCached.accessToken;
  }

  // ── Layer 3: Fresh OAuth exchange ───────────────────────────────────────────
  const fresh = await fetchFreshToken();

  // Persist to DB cache (Layer 2) so other workers and future cold starts
  // benefit from the newly issued token.
  await ctx.runMutation(internal.lib.fedexAuth.setCachedToken, {
    accessToken: fresh.accessToken,
    expiresAt: fresh.expiresAt,
  });

  // Populate process cache (Layer 1) for subsequent calls within this process.
  _processCache = fresh;

  return fresh.accessToken;
}

/**
 * Invalidate all cached tokens.
 *
 * Call this when a FedEx API call returns a 401 "Unauthorized" response,
 * indicating the cached token has been revoked or expired early.  The next
 * call to `getBearerToken` will skip both caches and perform a fresh OAuth
 * exchange.
 *
 * Note: This invalidates the process-level cache immediately.  The DB cache
 * row is left in place but the expiry check in `getCachedToken` (which reads
 * fresh from DB) ensures it won't be served again once the action that called
 * `invalidateBearerTokenCache` has run.  If you want to guarantee the DB row
 * is also cleared synchronously, pass the `ctx` parameter.
 *
 * @param ctx  Optional Convex `ActionCtx`.  When provided, also clears the
 *             database cache row by setting its `expiresAt` to 0 so it fails
 *             the freshness check on the next read.
 *
 * @example
 * // On receiving a 401 from FedEx, force re-auth:
 * invalidateBearerTokenCache();           // fast path — clear process cache
 * const token = await getBearerToken(ctx); // will re-fetch from FedEx
 */
export async function invalidateBearerTokenCache(
  ctx?: ActionCtx
): Promise<void> {
  // Always clear the process cache.
  _processCache = null;

  // Optionally clear the DB cache too (expire the row immediately).
  if (ctx) {
    await ctx.runMutation(internal.lib.fedexAuth.setCachedToken, {
      accessToken: "", // sentinel — expired token is never served
      expiresAt: 0,    // always fails the freshness check
    });
  }
}

// ─── Utility exports ──────────────────────────────────────────────────────────

/** Return true if FedEx credentials are present in the Convex environment. */
export function isFedExConfigured(): boolean {
  return Boolean(
    process.env.FEDEX_CLIENT_ID?.trim() &&
      process.env.FEDEX_CLIENT_SECRET?.trim()
  );
}

/** Return the resolved FedEx API base URL (production or sandbox). */
export function getFedExBaseUrl(): string {
  return getBaseUrl();
}
