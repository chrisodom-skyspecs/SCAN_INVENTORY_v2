/**
 * src/services/fedex.ts
 *
 * Shared FedEx Track API service module.
 *
 * This is the **canonical import path** for all FedEx tracking functionality
 * in the Next.js app (both INVENTORY dashboard and SCAN mobile app server-side
 * code).  It provides:
 *
 *   1. A typed configuration interface (`FedExClientConfig`) that maps to
 *      the required environment variables.
 *   2. A `FedExHttpClient` class with base URL resolution, OAuth token
 *      management, and typed auth-header construction.
 *   3. A `createFedExClient()` factory that reads all env vars, validates
 *      them, and returns a ready-to-use client instance.
 *   4. Re-exports of the high-level tracking functions and error utilities
 *      from `src/lib/fedex.ts` and `src/lib/fedex-tracking-errors.ts`.
 *
 * ## Environment variables (server-side only — never prefix with NEXT_PUBLIC_)
 *
 * | Variable             | Required | Description                                      |
 * |----------------------|----------|--------------------------------------------------|
 * | FEDEX_CLIENT_ID      | yes      | OAuth 2.0 client ID from FedEx Developer Portal  |
 * | FEDEX_CLIENT_SECRET  | yes      | OAuth 2.0 client secret                          |
 * | FEDEX_ACCOUNT_NUMBER | no       | Account number for enhanced tracking detail      |
 * | FEDEX_API_BASE_URL   | no       | Override base URL (defaults to production API)   |
 *
 * ## Usage
 *
 * ### High-level tracking (recommended for most callers)
 * ```typescript
 * import { getTrackingStatus } from "@/services/fedex";
 *
 * const result = await getTrackingStatus("794644823741");
 * // result.status      → "in_transit"
 * // result.description → "In transit"
 * ```
 *
 * ### Configuration validation at startup / health checks
 * ```typescript
 * import { getFedExConfig, FedExConfigError } from "@/services/fedex";
 *
 * try {
 *   const config = getFedExConfig();
 *   console.log("FedEx base URL:", config.baseUrl);
 * } catch (err) {
 *   if (err instanceof FedExConfigError) {
 *     console.error("FedEx is not configured:", err.message);
 *   }
 * }
 * ```
 *
 * ### Low-level HTTP client (custom API calls)
 * ```typescript
 * import { createFedExClient } from "@/services/fedex";
 *
 * const client  = createFedExClient();
 * const token   = await client.getBearerToken();
 * const headers = client.buildAuthHeaders(token);
 * const response = await fetch(client.buildUrl("/track/v1/trackingnumbers"), {
 *   method:  "POST",
 *   headers,
 *   body:    JSON.stringify({ ... }),
 * });
 * ```
 *
 * ## Architecture note
 * Convex action files (`convex/`) cannot import from `src/` because Convex
 * bundles them separately.  The Convex-side equivalents live in:
 *   - `convex/fedexClient.ts`          — simple Convex action client
 *   - `convex/lib/fedexAuth.ts`        — two-layer cached OAuth for Convex actions
 *   - `convex/fedex/trackShipment.ts`  — public Convex action
 *
 * Both sides share the same env var names and status normalisation logic.
 */

import {
  FedExError,
  type FedExErrorCode,
  type FedExShipmentStatus,
  type FedExTrackingEvent,
  type FedExTrackingResult,
  trackPackage,
  isValidTrackingNumber,
  toConvexShipmentStatus,
  getFedExBaseUrl,
  isSandboxMode,
  areFedExCredentialsConfigured,
  FEDEX_PRODUCTION_BASE,
  FEDEX_SANDBOX_BASE,
} from "@/lib/fedex";

import {
  type FedExTrackingErrorCode,
  FEDEX_TRACKING_ERROR_CODES,
  FEDEX_ERROR_MESSAGES,
  parseFedExErrorCode,
  getFedExUserErrorMessage,
  isFedExTransientError,
} from "@/lib/fedex-tracking-errors";

// ─── Public base URL constants ────────────────────────────────────────────────

/** FedEx production API base URL (default). */
export const FEDEX_PRODUCTION_BASE_URL = FEDEX_PRODUCTION_BASE;

/** FedEx sandbox API base URL — set FEDEX_API_BASE_URL to this for testing. */
export const FEDEX_SANDBOX_BASE_URL = FEDEX_SANDBOX_BASE;

// ─── Configuration interface ──────────────────────────────────────────────────

/**
 * Typed representation of the FedEx client configuration.
 *
 * Populated from environment variables by `getFedExConfig()`.
 * All required fields are validated before the config object is returned.
 */
export interface FedExClientConfig {
  /** OAuth 2.0 client ID (from `FEDEX_CLIENT_ID` env var). */
  clientId: string;

  /** OAuth 2.0 client secret (from `FEDEX_CLIENT_SECRET` env var). */
  clientSecret: string;

  /**
   * Resolved API base URL — production by default, sandbox when
   * `FEDEX_API_BASE_URL` is set to the sandbox endpoint.
   * Trailing slashes are stripped automatically.
   */
  baseUrl: string;

  /**
   * Optional FedEx account number for enhanced tracking detail.
   * Populated from `FEDEX_ACCOUNT_NUMBER`; `undefined` when absent.
   */
  accountNumber?: string;

  /**
   * Whether the client is operating in sandbox mode.
   * `true` when `baseUrl` matches `FEDEX_SANDBOX_BASE_URL`.
   */
  isSandbox: boolean;
}

// ─── Configuration error ──────────────────────────────────────────────────────

/**
 * Thrown by `getFedExConfig()` when required environment variables are absent
 * or contain only whitespace.
 *
 * Distinct from `FedExError` (thrown during API calls) so callers can
 * distinguish startup misconfiguration from runtime failures.
 */
export class FedExConfigError extends Error {
  /** The environment variable name(s) that are missing or invalid. */
  readonly missingVars: string[];

  constructor(missingVars: string[]) {
    super(
      `FedEx credentials are not configured. ` +
        `Set ${missingVars.join(", ")} as server-side environment variables. ` +
        `See .env.local.example for details.`
    );
    this.name = "FedExConfigError";
    this.missingVars = missingVars;
  }
}

// ─── Configuration factory ────────────────────────────────────────────────────

/**
 * Read and validate FedEx client configuration from environment variables.
 *
 * Validates that all required env vars (`FEDEX_CLIENT_ID` and
 * `FEDEX_CLIENT_SECRET`) are present and non-empty.  Resolves the base URL
 * from `FEDEX_API_BASE_URL` (production default when absent).
 *
 * @throws {FedExConfigError} when required env vars are absent or blank.
 *
 * @returns Typed `FedExClientConfig` ready for use by `FedExHttpClient`.
 *
 * @example
 * const config = getFedExConfig();
 * console.log(config.baseUrl);    // "https://apis.fedex.com"
 * console.log(config.isSandbox);  // false
 */
export function getFedExConfig(): FedExClientConfig {
  const clientId     = process.env.FEDEX_CLIENT_ID?.trim()     ?? "";
  const clientSecret = process.env.FEDEX_CLIENT_SECRET?.trim() ?? "";

  const missingVars: string[] = [];
  if (!clientId)     missingVars.push("FEDEX_CLIENT_ID");
  if (!clientSecret) missingVars.push("FEDEX_CLIENT_SECRET");

  if (missingVars.length > 0) {
    throw new FedExConfigError(missingVars);
  }

  // Strip trailing slash for consistent URL construction.
  const rawBaseUrl = process.env.FEDEX_API_BASE_URL?.trim() ?? "";
  const baseUrl    = rawBaseUrl
    ? rawBaseUrl.replace(/\/$/, "")
    : FEDEX_PRODUCTION_BASE_URL;

  const accountNumber = process.env.FEDEX_ACCOUNT_NUMBER?.trim() || undefined;
  const isSandbox     = baseUrl === FEDEX_SANDBOX_BASE_URL;

  return { clientId, clientSecret, baseUrl, accountNumber, isSandbox };
}

/**
 * Return whether FedEx credentials are present in the current environment.
 *
 * Unlike `getFedExConfig()`, this does NOT throw — it returns a boolean.
 * Use it for conditional feature display (e.g., show/hide FedEx tracking UI
 * based on whether credentials are set).
 *
 * @example
 * if (!isFedExConfigured()) {
 *   return <div>FedEx tracking is not configured. Contact your admin.</div>;
 * }
 */
export function isFedExConfigured(): boolean {
  return areFedExCredentialsConfigured();
}

// ─── HTTP client class ────────────────────────────────────────────────────────

/**
 * Typed FedEx HTTP client providing OAuth token management and request
 * construction helpers.
 *
 * Instances are created via `createFedExClient()` rather than calling the
 * constructor directly, so the factory handles env var reading and validation.
 *
 * ## Token caching
 * Maintains an in-process token cache.  The cached token is considered valid
 * until `EXPIRY_BUFFER_MS` (60 s) before its stated expiry to ensure requests
 * always have time to complete before the token actually expires.
 *
 * On a 401 response from FedEx, call `invalidateToken()` before retrying so
 * the next call to `getBearerToken()` performs a fresh OAuth exchange.
 *
 * **Convex note**: Convex actions use `convex/lib/fedexAuth.ts` which adds a
 * second persistence layer via the Convex database.  This class is for
 * Next.js server-side code only.
 *
 * @example
 * const client = createFedExClient();
 * const token  = await client.getBearerToken();
 * const res    = await fetch(client.buildUrl("/track/v1/trackingnumbers"), {
 *   method:  "POST",
 *   headers: client.buildAuthHeaders(token),
 *   body:    JSON.stringify({ ... }),
 * });
 */
export class FedExHttpClient {
  /** Resolved API base URL (production or sandbox). */
  readonly baseUrl: string;

  /** FedEx account number for enhanced tracking, or `undefined`. */
  readonly accountNumber: string | undefined;

  /** Whether the client targets the sandbox API. */
  readonly isSandbox: boolean;

  /** OAuth client credentials (unexported after construction). */
  private readonly _clientId: string;
  private readonly _clientSecret: string;

  /** In-process token cache (process lifetime). */
  private _tokenCache: { accessToken: string; expiresAt: number } | null = null;

  /**
   * A token within this many milliseconds of expiry is treated as expired
   * so in-flight requests always have time to complete.
   */
  private static readonly EXPIRY_BUFFER_MS = 60_000; // 60 seconds

  constructor(config: FedExClientConfig) {
    this.baseUrl        = config.baseUrl;
    this.accountNumber  = config.accountNumber;
    this.isSandbox      = config.isSandbox;
    this._clientId      = config.clientId;
    this._clientSecret  = config.clientSecret;
  }

  // ── OAuth token management ─────────────────────────────────────────────────

  /**
   * Return a valid OAuth 2.0 bearer token, refreshing from FedEx when needed.
   *
   * Resolution order:
   *   1. In-process cache (fast path — when token is not near expiry)
   *   2. Fresh FedEx OAuth exchange (slow path — on cache miss or near-expiry)
   *
   * @throws {FedExError} with code `"AUTH_ERROR"` or `"NETWORK_ERROR"` on failure.
   *
   * @example
   * const token = await client.getBearerToken();
   * // Use token in buildAuthHeaders()
   */
  async getBearerToken(): Promise<string> {
    const now = Date.now();

    if (
      this._tokenCache &&
      now < this._tokenCache.expiresAt - FedExHttpClient.EXPIRY_BUFFER_MS
    ) {
      return this._tokenCache.accessToken;
    }

    return this._fetchFreshToken();
  }

  /**
   * Invalidate the cached bearer token.
   *
   * Call when the FedEx API returns 401 Unauthorized, so the next call to
   * `getBearerToken()` performs a fresh OAuth exchange instead of reusing a
   * revoked or expired token.
   *
   * @example
   * const token = await client.getBearerToken();
   * const res   = await fetch(client.buildUrl("/track/v1/trackingnumbers"), {
   *   headers: client.buildAuthHeaders(token), ...
   * });
   * if (res.status === 401) {
   *   client.invalidateToken();         // clear bad token
   *   const freshToken = await client.getBearerToken(); // re-authenticate
   * }
   */
  invalidateToken(): void {
    this._tokenCache = null;
  }

  // ── Request construction ───────────────────────────────────────────────────

  /**
   * Build the standard HTTP headers for an authenticated FedEx API request.
   *
   * Produces:
   *   - `Authorization: Bearer <token>`
   *   - `Content-Type: application/json`
   *   - `Accept: application/json`
   *   - `X-locale: en_US`
   *   - `x-customer-transaction-id: <accountNumber>` (when configured)
   *
   * @param bearerToken  Token returned by `getBearerToken()`.
   * @returns Plain `Record<string, string>` safe to pass to `fetch()`.
   *
   * @example
   * const headers = client.buildAuthHeaders(await client.getBearerToken());
   * // headers["Authorization"] → "Bearer eyJhbGci..."
   * // headers["Content-Type"]  → "application/json"
   */
  buildAuthHeaders(bearerToken: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept:         "application/json",
      Authorization:  `Bearer ${bearerToken}`,
      "X-locale":     "en_US",
    };

    if (this.accountNumber) {
      headers["x-customer-transaction-id"] = this.accountNumber;
    }

    return headers;
  }

  /**
   * Build the headers for the FedEx OAuth token endpoint.
   * The OAuth call requires `application/x-www-form-urlencoded`.
   *
   * @internal — used internally by `_fetchFreshToken`.
   */
  buildOAuthHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept:         "application/json",
    };
  }

  /**
   * Build the URL-encoded request body for a `client_credentials` OAuth grant.
   *
   * @internal — used internally by `_fetchFreshToken`.
   */
  buildOAuthBody(): string {
    return new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     this._clientId,
      client_secret: this._clientSecret,
    }).toString();
  }

  // ── URL helpers ────────────────────────────────────────────────────────────

  /**
   * Build a full FedEx API URL from an absolute path.
   *
   * @param path  Path starting with "/" (e.g. `"/track/v1/trackingnumbers"`).
   *
   * @example
   * client.buildUrl("/oauth/token")
   * // → "https://apis.fedex.com/oauth/token"
   *
   * client.buildUrl("/track/v1/trackingnumbers")
   * // → "https://apis.fedex.com/track/v1/trackingnumbers"
   */
  buildUrl(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  // ── Private methods ────────────────────────────────────────────────────────

  private async _fetchFreshToken(): Promise<string> {
    const url = this.buildUrl("/oauth/token");

    let response: Response;
    try {
      response = await fetch(url, {
        method:  "POST",
        headers: this.buildOAuthHeaders(),
        body:    this.buildOAuthBody(),
      });
    } catch (err) {
      throw new FedExError(
        "NETWORK_ERROR",
        "Unable to reach the FedEx OAuth endpoint. Check network connectivity.",
        { raw: err }
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "(unreadable)");
      throw new FedExError(
        "AUTH_ERROR",
        `FedEx OAuth token exchange failed with HTTP ${response.status}. ` +
          "Verify FEDEX_CLIENT_ID and FEDEX_CLIENT_SECRET are correct.",
        { statusCode: response.status, raw: body }
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new FedExError(
        "PARSE_ERROR",
        "FedEx OAuth response is not valid JSON."
      );
    }

    const data         = json as Record<string, unknown>;
    const accessToken  = data["access_token"];
    const expiresIn    = data["expires_in"];

    if (typeof accessToken !== "string" || !accessToken) {
      throw new FedExError(
        "PARSE_ERROR",
        'FedEx OAuth response is missing a valid "access_token" field.',
        { raw: json }
      );
    }

    // Default to 3600 s (1 h) when FedEx omits or provides an invalid value.
    const expiresInSeconds =
      typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 3600;

    this._tokenCache = {
      accessToken,
      expiresAt: Date.now() + expiresInSeconds * 1_000,
    };

    return accessToken;
  }
}

// ─── Client factory ───────────────────────────────────────────────────────────

/**
 * Create a `FedExHttpClient` instance pre-configured from environment variables.
 *
 * This is the primary way to obtain a FedEx HTTP client in Next.js Route
 * Handlers, Server Actions, and other server-side code.
 *
 * @throws {FedExConfigError} when required env vars are absent or blank.
 *
 * @example
 * // In a Next.js Route Handler:
 * import { createFedExClient } from "@/services/fedex";
 *
 * export async function POST(req: Request) {
 *   const client  = createFedExClient();
 *   const token   = await client.getBearerToken();
 *   const res     = await fetch(client.buildUrl("/track/v1/trackingnumbers"), {
 *     method:  "POST",
 *     headers: client.buildAuthHeaders(token),
 *     body:    JSON.stringify({ ... }),
 *   });
 *   return Response.json(await res.json());
 * }
 */
export function createFedExClient(): FedExHttpClient {
  const config = getFedExConfig();
  return new FedExHttpClient(config);
}

// ─── Re-exports (unified public API surface) ──────────────────────────────────
//
// Callers should import everything FedEx-related from "@/services/fedex".
// They should not need to import from "@/lib/fedex" or
// "@/lib/fedex-tracking-errors" directly.

// ── From src/lib/fedex.ts ─────────────────────────────────────────────────────

/** High-level FedEx tracking functions */
export {
  trackPackage,
  isValidTrackingNumber,
  toConvexShipmentStatus,
  getFedExBaseUrl,
  isSandboxMode,
  areFedExCredentialsConfigured,
  FedExError,
};

/** High-level alias (preferred entry point for status-centric callers) */
export { trackPackage as getTrackingStatus };

/** FedEx types */
export type {
  FedExErrorCode,
  FedExShipmentStatus,
  FedExTrackingEvent,
  FedExTrackingResult,
};

// ── From src/lib/fedex-tracking-errors.ts ────────────────────────────────────

/** Error code constants and utilities */
export {
  FEDEX_TRACKING_ERROR_CODES,
  FEDEX_ERROR_MESSAGES,
  parseFedExErrorCode,
  getFedExUserErrorMessage,
  isFedExTransientError,
};

/** Error code type */
export type { FedExTrackingErrorCode };
