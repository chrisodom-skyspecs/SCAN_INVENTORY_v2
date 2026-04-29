/**
 * convex/auth.ts
 *
 * Kinde JWT verification utilities for Convex HTTP actions.
 *
 * Implements RS256 (RSASSA-PKCS1-v1_5 / SHA-256) JWT verification using the
 * Web Crypto API (available in the Convex V8 runtime).  No external JWT library
 * is required.
 *
 * Flow
 * ────
 *   1. Client obtains a Kinde access token (via @kinde-oss/kinde-auth-nextjs).
 *   2. Client POSTs to /api/auth/sync with Authorization: Bearer <token>.
 *   3. verifyKindeJwt() fetches the JWKS from Kinde, finds the matching key,
 *      imports it via crypto.subtle, and verifies the RS256 signature.
 *   4. Claims (sub, email, name, org_code, roles, exp) are extracted and
 *      validated (expiry, issuer).
 *   5. The HTTP action calls upsertUser() to create / update the user record.
 *   6. The verified user record (Convex doc) is returned to the client.
 *
 * Security
 * ────────
 * - Signature verified via RS256 against Kinde-published JWKS.
 * - `exp` claim enforced — expired tokens are rejected.
 * - `iss` claim enforced — tokens from wrong issuers are rejected.
 * - JWKS fetched fresh for every token (simple approach; no cache — Convex
 *   actions are short-lived so there is no persistent memory to cache into).
 *   For high-traffic deployments a distributed cache (e.g. fedexTokenCache
 *   pattern) can be added without changing the public API.
 */

import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface JwtHeader {
  alg: string;
  typ?: string;
  kid?: string;
}

interface KindeClaims {
  sub: string;
  email: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  /** Kinde organization code */
  org_code?: string;
  /** Kinde roles array */
  roles?: Array<{ id: string; key: string; name: string }>;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nbf?: number;
}

interface JwkKey {
  kty: string;
  use?: string;
  alg?: string;
  kid?: string;
  n: string;    // RSA modulus (base64url)
  e: string;    // RSA exponent (base64url)
}

interface JwksResponse {
  keys: JwkKey[];
}

// ─── Base64url helpers ────────────────────────────────────────────────────────

/**
 * Decode a base64url string to a Uint8Array.
 * Handles the +/ → -_ and missing = padding differences.
 */
function base64urlDecode(input: string): Uint8Array {
  // Normalize base64url → base64
  const base64 = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decode a base64url string to a UTF-8 string (for JSON parsing).
 */
function base64urlDecodeString(input: string): string {
  return new TextDecoder().decode(base64urlDecode(input));
}

// ─── JWKS fetcher ─────────────────────────────────────────────────────────────

/**
 * Fetch the Kinde JWKS for the configured issuer URL.
 *
 * The JWKS endpoint is always at: {KINDE_ISSUER_URL}/.well-known/jwks.json
 * This endpoint is public and unauthenticated.
 *
 * @throws Error if KINDE_ISSUER_URL is not configured or the fetch fails.
 */
async function fetchKindeJwks(): Promise<JwksResponse> {
  const issuerUrl = (process.env.KINDE_ISSUER_URL ?? "").replace(/\/$/, "");
  if (!issuerUrl) {
    throw new Error(
      "KINDE_ISSUER_URL environment variable is not set. " +
      "Configure it in the Convex dashboard under Settings → Environment Variables."
    );
  }

  const jwksUrl = `${issuerUrl}/.well-known/jwks.json`;

  let response: Response;
  try {
    response = await fetch(jwksUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new Error(`Failed to fetch Kinde JWKS from ${jwksUrl}: ${String(err)}`);
  }

  if (!response.ok) {
    throw new Error(
      `Kinde JWKS fetch failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json() as Promise<JwksResponse>;
}

// ─── JWT verification ─────────────────────────────────────────────────────────

/**
 * Verify a Kinde JWT access token using RS256 + JWKS.
 *
 * Returns the verified claim set if the token is valid.
 * Throws a descriptive error if verification fails for any reason.
 *
 * @param token  Raw JWT string from the Authorization header.
 */
export async function verifyKindeJwt(token: string): Promise<KindeClaims> {
  // ── 1. Split and decode header ──────────────────────────────────────────────
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed JWT: expected three dot-separated parts");
  }
  const [rawHeader, rawPayload, rawSignature] = parts;

  let header: JwtHeader;
  try {
    header = JSON.parse(base64urlDecodeString(rawHeader)) as JwtHeader;
  } catch {
    throw new Error("Malformed JWT: could not parse header");
  }

  if (!header.alg) {
    throw new Error("Malformed JWT: missing alg in header");
  }

  // We only support RS256 — Kinde's default algorithm
  if (header.alg !== "RS256") {
    throw new Error(
      `Unsupported JWT algorithm: ${header.alg}. Only RS256 is supported.`
    );
  }

  // ── 2. Fetch JWKS and locate the matching key ───────────────────────────────
  const jwks = await fetchKindeJwks();

  let jwk: JwkKey | undefined;
  if (header.kid) {
    // Prefer exact kid match
    jwk = jwks.keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) {
    // Fall back to first RSA signing key
    jwk = jwks.keys.find((k) => k.kty === "RSA" && (!k.use || k.use === "sig"));
  }
  if (!jwk) {
    throw new Error(
      `No suitable JWK found for kid="${header.kid ?? "none"}". ` +
      `Available kids: ${jwks.keys.map((k) => k.kid ?? "?").join(", ")}`
    );
  }

  // ── 3. Import the public key ────────────────────────────────────────────────
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk as JsonWebKey,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: { name: "SHA-256" },
      },
      false,         // not extractable
      ["verify"]
    );
  } catch (err) {
    throw new Error(`Failed to import JWK: ${String(err)}`);
  }

  // ── 4. Verify the RS256 signature ───────────────────────────────────────────
  const signingInput = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  const signatureDecoded = base64urlDecode(rawSignature);
  // Copy into a fresh ArrayBuffer to satisfy TypeScript 5.7 strict generic
  // typing — crypto.subtle.verify expects ArrayBuffer | ArrayBufferView<ArrayBuffer>,
  // but Uint8Array<ArrayBufferLike> (returned by our decode helper) doesn't
  // directly satisfy ArrayBufferView<ArrayBuffer>.  Slicing the underlying
  // buffer produces a plain ArrayBuffer with the correct type.
  // Runtime: base64urlDecode always uses `new Uint8Array(n)` which allocates a
  // plain ArrayBuffer — never a SharedArrayBuffer — so this cast is safe.
  const signatureBuffer = signatureDecoded.buffer.slice(
    signatureDecoded.byteOffset,
    signatureDecoded.byteOffset + signatureDecoded.byteLength
  ) as ArrayBuffer;

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signatureBuffer,
      signingInput
    );
  } catch (err) {
    throw new Error(`Signature verification error: ${String(err)}`);
  }

  if (!valid) {
    throw new Error("JWT signature verification failed");
  }

  // ── 5. Decode and parse the payload ─────────────────────────────────────────
  let claims: KindeClaims;
  try {
    claims = JSON.parse(base64urlDecodeString(rawPayload)) as KindeClaims;
  } catch {
    throw new Error("Malformed JWT: could not parse payload");
  }

  // ── 6. Validate standard claims ─────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);

  // Expiry
  if (claims.exp !== undefined && claims.exp < now) {
    throw new Error(
      `JWT expired at ${new Date(claims.exp * 1000).toISOString()} ` +
      `(current time: ${new Date(now * 1000).toISOString()})`
    );
  }

  // Not-before
  if (claims.nbf !== undefined && claims.nbf > now + 30) {
    throw new Error(
      `JWT not yet valid (nbf=${claims.nbf}, now=${now})`
    );
  }

  // Issuer — must match KINDE_ISSUER_URL
  const expectedIssuer = (process.env.KINDE_ISSUER_URL ?? "").replace(/\/$/, "");
  if (expectedIssuer && claims.iss && claims.iss.replace(/\/$/, "") !== expectedIssuer) {
    throw new Error(
      `JWT issuer mismatch: expected "${expectedIssuer}", got "${claims.iss}"`
    );
  }

  // Subject must be present
  if (!claims.sub) {
    throw new Error("JWT missing required 'sub' claim");
  }

  // Email must be present (Kinde always includes it in access tokens)
  if (!claims.email) {
    throw new Error("JWT missing required 'email' claim");
  }

  return claims;
}

// ─── HTTP action: POST /api/auth/sync ─────────────────────────────────────────

/**
 * POST /api/auth/sync
 *
 * Validates the Kinde JWT in the Authorization header, extracts user identity
 * claims, and upserts a verified user record in the Convex `users` table.
 *
 * Called by the Next.js client (both INVENTORY and SCAN apps) immediately
 * after a successful Kinde login to ensure the Convex user record is current.
 *
 * Request
 * ───────
 *   Authorization: Bearer <kinde_access_token>
 *   Content-Type: application/json (optional, body is ignored)
 *
 * Response 200
 * ────────────
 * {
 *   success: true,
 *   user: {
 *     _id: string,           // Convex document ID
 *     kindeId: string,       // Kinde sub claim
 *     email: string,
 *     name: string,          // display name
 *     givenName?: string,
 *     familyName?: string,
 *     picture?: string,
 *     orgCode?: string,
 *     roles?: string[],
 *     lastLoginAt: number,
 *     createdAt: number,
 *     updatedAt: number,
 *   }
 * }
 *
 * Response 401
 * ────────────
 * { error: string, status: 401 }
 *
 * Response 500
 * ────────────
 * { error: string, status: 500 }
 */
export const authSyncHandler = httpAction(async (ctx, request) => {
  const origin = request.headers.get("origin");

  // CORS headers helper (reuse pattern from http.ts)
  const ALLOWED_ORIGINS = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SCAN_URL,
    "http://localhost:3000",
    "http://localhost:3001",
  ].filter(Boolean) as string[];

  function corsHeaders(): Record<string, string> {
    const allowed =
      origin && ALLOWED_ORIGINS.includes(origin)
        ? origin
        : (ALLOWED_ORIGINS[0] ?? "*");
    return {
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };
  }

  function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...corsHeaders(),
      },
    });
  }

  function errorResponse(message: string, status = 400): Response {
    return jsonResponse({ error: message, status }, status);
  }

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method !== "POST") {
    return errorResponse("Method not allowed — use POST", 405);
  }

  // ── Extract Bearer token ───────────────────────────────────────────────────
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return errorResponse(
      "Missing Authorization header. Expected: Authorization: Bearer <token>",
      401
    );
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return errorResponse("Empty Bearer token", 401);
  }

  // ── Verify JWT ────────────────────────────────────────────────────────────
  let claims: Awaited<ReturnType<typeof verifyKindeJwt>>;
  try {
    claims = await verifyKindeJwt(token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/auth/sync] JWT verification failed:", message);
    return errorResponse(`Token verification failed: ${message}`, 401);
  }

  // ── Extract identity claims ───────────────────────────────────────────────
  const kindeId   = claims.sub;
  const email     = claims.email;
  const givenName = claims.given_name;
  const familyName = claims.family_name;
  const picture   = claims.picture;
  const orgCode   = claims.org_code;
  // Flatten role objects to key strings for storage
  const roles     = claims.roles?.map((r) => r.key) ?? undefined;

  // ── Upsert user record ────────────────────────────────────────────────────
  let convexUserId: string;
  try {
    convexUserId = await ctx.runMutation(internal.users.upsertUser, {
      kindeId,
      email,
      givenName,
      familyName,
      picture,
      orgCode,
      roles,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/auth/sync] upsertUser failed:", message);
    return errorResponse("Failed to create user record", 500);
  }

  // ── Fetch the upserted record to return to client ─────────────────────────
  let user: Record<string, unknown> | null = null;
  try {
    user = await ctx.runQuery(internal.users.getUserByKindeIdInternal, { kindeId });
  } catch {
    // Non-fatal — return minimal success response
  }

  return jsonResponse({
    success: true,
    user: user ?? {
      _id: convexUserId,
      kindeId,
      email,
      name:
        givenName && familyName
          ? `${givenName} ${familyName}`.trim()
          : givenName ?? email,
      givenName,
      familyName,
      picture,
      orgCode,
      roles,
    },
  });
});
