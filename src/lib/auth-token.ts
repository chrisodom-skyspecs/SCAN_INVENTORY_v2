/**
 * src/lib/auth-token.ts — Shared Kinde token helpers
 *
 * Provides token-level auth utilities that complement the session-level helpers
 * in src/lib/kinde.ts.  Consumed by both the INVENTORY dashboard and the SCAN
 * mobile app (both run in the same Next.js application).
 *
 * Public API
 * ──────────
 *   getKindeToken()             — Get the raw Kinde access token (JWT string)
 *                                 from the current server session, or null if
 *                                 the user is unauthenticated.
 *   requireKindeToken()         — Like getKindeToken() but throws if no token.
 *   verifyKindeJwt(token)       — Full RS256 verification via Kinde JWKS.
 *                                 Returns verified KindeTokenClaims on success.
 *   extractUserFromToken(token) — Decode user identity from a JWT WITHOUT
 *                                 verifying the signature.  Use only with tokens
 *                                 from a trusted server session.
 *   buildDisplayName(claims)    — Derive a human-readable name from token claims.
 *
 * When to use which
 * ─────────────────
 *   getKindeToken / requireKindeToken
 *     Server-only (Route Handler, Server Action, Server Component).
 *     Extracts the raw JWT string from the active Kinde server session so you
 *     can pass it to Convex (POST /api/auth/sync) or another internal service.
 *
 *   verifyKindeJwt
 *     Use when you receive a token from an external caller via an Authorization
 *     header and must independently verify the signature + claims before
 *     trusting the identity (e.g. an internal API accepting SCAN app requests).
 *     Identical algorithm to convex/auth.ts but runs in the Next.js runtime.
 *
 *   extractUserFromToken
 *     Use when you already have a Kinde server session (middleware / SDK have
 *     verified the token) and you want to read token claims (roles, org_code,
 *     etc.) without an additional network round-trip to Kinde.
 *     WARNING: does NOT verify the JWT signature — trust only tokens from your
 *     own server session or from verifyKindeJwt().
 *
 * Runtimes
 * ────────
 *   • Node.js 18+ (Web Crypto API is globalThis.crypto)
 *   • Next.js Edge Runtime (native Web Crypto)
 *   • Convex runtime (native Web Crypto)
 *
 * Server-only — do NOT import this module from a "use client" component.
 *
 * @see src/lib/kinde.ts        — session-level helpers (getAuthUser, etc.)
 * @see convex/auth.ts          — Convex HTTP action JWT verifier (same algo)
 * @see https://kinde.com/docs/developer-tools/nextjs-sdk/
 */

import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Claims extracted from a Kinde access token payload.
 *
 * Kinde access tokens are RS256-signed JWTs.  The exact set of claims
 * depends on your Kinde application configuration; optional fields may be
 * absent if not enabled in your Kinde dashboard.
 */
export interface KindeTokenClaims {
  /** Subject — stable Kinde user ID (the `sub` claim). */
  sub: string;
  /** User email address (always present in Kinde access tokens). */
  email: string;
  /** Given (first) name, if set in the user's Kinde profile. */
  given_name?: string;
  /** Family (last) name, if set in the user's Kinde profile. */
  family_name?: string;
  /** Profile picture URL, if configured. */
  picture?: string;
  /** Kinde organization code for the current session. */
  org_code?: string;
  /**
   * Roles assigned to this user (in the org context).
   * Each role object has a stable `key` string (e.g. "admin", "technician").
   */
  roles?: Array<{ id: string; key: string; name: string }>;
  /** Token issuer (your Kinde domain). */
  iss?: string;
  /** Token audience. */
  aud?: string | string[];
  /** Expiry time (Unix epoch seconds). */
  exp?: number;
  /** Issued-at time (Unix epoch seconds). */
  iat?: number;
  /** Not-before time (Unix epoch seconds). */
  nbf?: number;
}

/**
 * Structured user identity extracted from a Kinde token.
 *
 * Pre-computes derived fields (displayName, role key strings) so callers
 * do not have to re-implement the name resolution logic everywhere.
 */
export interface ExtractedUser {
  /** Kinde user ID (sub claim). Written to kindeId, assigneeId, etc. */
  kindeId: string;
  /** User's email address. */
  email: string;
  /** Given name from the token, if available. */
  givenName?: string;
  /** Family name from the token, if available. */
  familyName?: string;
  /** Profile picture URL, if available. */
  picture?: string;
  /** Kinde organization code, if the user belongs to an org. */
  orgCode?: string;
  /**
   * Flattened role key strings (e.g. ["technician"]).
   * Empty array when the roles claim is absent or the user has no roles.
   */
  roles: string[];
  /**
   * Human-readable display name.
   * Resolution: "Given Family" → "Given" → email → "Unknown User".
   */
  displayName: string;
}

// ─── Internal: JWK / JWKS types ──────────────────────────────────────────────

interface JwtHeader {
  alg: string;
  typ?: string;
  kid?: string;
}

interface JwkKey {
  kty: string;
  use?: string;
  alg?: string;
  kid?: string;
  n: string;   // RSA modulus (base64url)
  e: string;   // RSA exponent (base64url)
}

interface JwksResponse {
  keys: JwkKey[];
}

// ─── Internal: base64url helpers ─────────────────────────────────────────────

/**
 * Decode a base64url-encoded string to a Uint8Array.
 * Handles the -/_ → +/ normalization and missing = padding.
 */
function base64urlToBytes(input: string): Uint8Array {
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
 * Decode a base64url-encoded string to a UTF-8 string (for JSON parsing).
 */
function base64urlToString(input: string): string {
  return new TextDecoder().decode(base64urlToBytes(input));
}

// ─── Internal: JWKS fetcher ───────────────────────────────────────────────────

/**
 * Fetch the Kinde JWKS for RS256 signature verification.
 *
 * The JWKS endpoint is always: {KINDE_ISSUER_URL}/.well-known/jwks.json
 * It is public and requires no authentication.
 *
 * @throws Error if KINDE_ISSUER_URL is not configured or the fetch fails.
 */
async function fetchKindeJwks(): Promise<JwksResponse> {
  const issuerUrl = (process.env.KINDE_ISSUER_URL ?? "").replace(/\/$/, "");
  if (!issuerUrl) {
    throw new Error(
      "KINDE_ISSUER_URL is not set. Configure it in your environment variables."
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
      `Kinde JWKS fetch failed: HTTP ${response.status} ${response.statusText} ` +
      `from ${jwksUrl}`
    );
  }

  return response.json() as Promise<JwksResponse>;
}

// ─── verifyKindeJwt ───────────────────────────────────────────────────────────

/**
 * Verify a Kinde access token using RS256 + JWKS.
 *
 * Steps:
 *   1. Split the JWT into header, payload, and signature parts.
 *   2. Parse the header to locate the correct JWK by `kid`.
 *   3. Fetch the Kinde JWKS and import the matching RSA public key.
 *   4. Verify the RS256 signature via Web Crypto.
 *   5. Parse and validate standard claims (exp, nbf, iss, sub, email).
 *   6. Return the verified KindeTokenClaims on success.
 *
 * This is the Next.js-runtime equivalent of the verifyKindeJwt in convex/auth.ts.
 * Both use the Web Crypto API — no external JWT library required.
 *
 * Runtime compatibility:
 *   • Node.js 18+  — globalThis.crypto (Web Crypto)
 *   • Next.js Edge — native Web Crypto
 *
 * @param token  Raw JWT string (typically from Authorization: Bearer <token>).
 * @returns      Verified KindeTokenClaims.
 * @throws       Descriptive Error on any verification failure.
 *
 * @example
 * const authHeader = request.headers.get("authorization") ?? "";
 * const token = authHeader.replace(/^Bearer\s+/i, "");
 * const claims = await verifyKindeJwt(token);
 * // claims.sub is the verified user ID
 */
export async function verifyKindeJwt(token: string): Promise<KindeTokenClaims> {
  // ── 1. Split and decode header ─────────────────────────────────────────────
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed JWT: expected three dot-separated parts");
  }
  const [rawHeader, rawPayload, rawSignature] = parts;

  let header: JwtHeader;
  try {
    header = JSON.parse(base64urlToString(rawHeader)) as JwtHeader;
  } catch {
    throw new Error("Malformed JWT: could not parse header JSON");
  }

  if (!header.alg) {
    throw new Error("Malformed JWT: missing alg in header");
  }
  if (header.alg !== "RS256") {
    throw new Error(
      `Unsupported JWT algorithm: "${header.alg}". Only RS256 is supported.`
    );
  }

  // ── 2. Fetch JWKS and locate the signing key ───────────────────────────────
  const jwks = await fetchKindeJwks();

  let jwk: JwkKey | undefined;
  if (header.kid) {
    jwk = jwks.keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) {
    // Fallback: first RSA signing key
    jwk = jwks.keys.find((k) => k.kty === "RSA" && (!k.use || k.use === "sig"));
  }
  if (!jwk) {
    throw new Error(
      `No matching JWK found for kid="${header.kid ?? "none"}". ` +
      `Available kids: [${jwks.keys.map((k) => k.kid ?? "?").join(", ")}]`
    );
  }

  // ── 3. Import the RSA public key ───────────────────────────────────────────
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk as JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: { name: "SHA-256" } },
      false,     // not extractable
      ["verify"]
    );
  } catch (err) {
    throw new Error(`Failed to import JWK as CryptoKey: ${String(err)}`);
  }

  // ── 4. Verify RS256 signature ──────────────────────────────────────────────
  const signingInput = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  const signatureBytes = base64urlToBytes(rawSignature);
  // Slice into a plain ArrayBuffer to satisfy TypeScript strict generics
  // (Uint8Array<ArrayBufferLike> is not assignable to ArrayBufferView<ArrayBuffer>).
  const signatureBuffer = signatureBytes.buffer.slice(
    signatureBytes.byteOffset,
    signatureBytes.byteOffset + signatureBytes.byteLength
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
    throw new Error(`Signature verification threw an error: ${String(err)}`);
  }

  if (!valid) {
    throw new Error("JWT signature verification failed — token may be tampered");
  }

  // ── 5. Decode and parse the payload ───────────────────────────────────────
  let claims: KindeTokenClaims;
  try {
    claims = JSON.parse(base64urlToString(rawPayload)) as KindeTokenClaims;
  } catch {
    throw new Error("Malformed JWT: could not parse payload JSON");
  }

  // ── 6. Validate standard claims ───────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);

  if (claims.exp !== undefined && claims.exp < now) {
    throw new Error(
      `JWT expired at ${new Date(claims.exp * 1000).toISOString()} ` +
      `(now: ${new Date(now * 1000).toISOString()})`
    );
  }

  // Allow 30-second clock skew for nbf
  if (claims.nbf !== undefined && claims.nbf > now + 30) {
    throw new Error(`JWT not yet valid (nbf=${claims.nbf}, now=${now})`);
  }

  const expectedIssuer = (process.env.KINDE_ISSUER_URL ?? "").replace(/\/$/, "");
  if (expectedIssuer && claims.iss) {
    const actualIssuer = claims.iss.replace(/\/$/, "");
    if (actualIssuer !== expectedIssuer) {
      throw new Error(
        `JWT issuer mismatch: expected "${expectedIssuer}", got "${actualIssuer}"`
      );
    }
  }

  if (!claims.sub) {
    throw new Error("JWT missing required 'sub' claim");
  }
  if (!claims.email) {
    throw new Error("JWT missing required 'email' claim");
  }

  return claims;
}

// ─── extractUserFromToken ─────────────────────────────────────────────────────

/**
 * Decode and structure user identity from a Kinde JWT **without** verifying
 * the signature.
 *
 * This is a convenience function for server-side contexts where the token has
 * already been verified by:
 *   • The Kinde SDK session (getKindeServerSession / withAuth middleware), OR
 *   • A prior call to verifyKindeJwt()
 *
 * WARNING: This function DOES NOT verify the JWT signature.  Never use it to
 * authorize a request where the token origin is untrusted.  For authorization
 * of incoming bearer tokens use verifyKindeJwt() instead.
 *
 * @param token  Raw JWT string (three dot-separated base64url segments).
 * @returns      Structured ExtractedUser with pre-computed displayName and roles.
 * @throws       Error if the JWT is structurally malformed (not parseable).
 *
 * @example
 * // Server Action or Route Handler — token from your own session:
 * const rawToken = await getKindeToken();
 * if (rawToken) {
 *   const user = extractUserFromToken(rawToken);
 *   console.log(user.displayName, user.roles);
 * }
 */
export function extractUserFromToken(token: string): ExtractedUser {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error(
      "Cannot extract user: malformed JWT (expected three dot-separated parts)"
    );
  }

  let claims: KindeTokenClaims;
  try {
    claims = JSON.parse(base64urlToString(parts[1])) as KindeTokenClaims;
  } catch {
    throw new Error("Cannot extract user: JWT payload is not valid JSON");
  }

  if (!claims.sub) {
    throw new Error("Cannot extract user: JWT payload missing required 'sub' claim");
  }

  return {
    kindeId:     claims.sub,
    email:       claims.email ?? "",
    givenName:   claims.given_name,
    familyName:  claims.family_name,
    picture:     claims.picture,
    orgCode:     claims.org_code,
    roles:       claims.roles?.map((r) => r.key) ?? [],
    displayName: buildDisplayName(claims),
  };
}

// ─── buildDisplayName ─────────────────────────────────────────────────────────

/**
 * Derive a human-readable display name from Kinde token claims.
 *
 * Resolution order:
 *   1. "Given Family"  — when both given_name and family_name are set
 *   2. "Given"         — when only given_name is set
 *   3. email           — when neither name is set
 *   4. "Unknown User"  — final fallback
 *
 * @param claims  Parsed Kinde token claims (or any object with the same shape).
 * @returns       Human-readable display name string.
 *
 * @example
 *   buildDisplayName({ given_name: "Jane", family_name: "Doe", ... })
 *   // → "Jane Doe"
 *
 *   buildDisplayName({ given_name: "Jane", ... })
 *   // → "Jane"
 *
 *   buildDisplayName({ email: "jane@example.com", ... })
 *   // → "jane@example.com"
 */
export function buildDisplayName(
  claims: { given_name?: string; family_name?: string; email?: string }
): string {
  const { given_name, family_name, email } = claims;
  if (given_name && family_name) return `${given_name} ${family_name}`.trim();
  if (given_name) return given_name;
  if (email) return email;
  return "Unknown User";
}

// ─── getKindeToken ────────────────────────────────────────────────────────────

/**
 * Get the raw Kinde access token (JWT string) from the current server session.
 *
 * Returns null when:
 *   • No active Kinde session exists (user is unauthenticated)
 *   • The session exists but the access token is unavailable
 *
 * Use cases:
 *   • Forwarding the user's token to Convex: POST /api/auth/sync with
 *     Authorization: Bearer <token>
 *   • Passing the token to an internal microservice that needs to identify
 *     the caller without sharing session cookies
 *   • Extracting token claims with extractUserFromToken() when you need
 *     fields not returned by getKindeServerSession().getUser()
 *
 * Server-only — requires a Next.js server context (Route Handler, Server
 * Component, Server Action, or middleware).
 *
 * @returns Raw JWT string, or null if unauthenticated.
 *
 * @example
 * const token = await getKindeToken();
 * if (!token) return new Response("Unauthenticated", { status: 401 });
 *
 * await fetch(`${convexSiteUrl}/api/auth/sync`, {
 *   method: "POST",
 *   headers: { Authorization: `Bearer ${token}` },
 * });
 */
export async function getKindeToken(): Promise<string | null> {
  try {
    const session = getKindeServerSession();
    const token = await session.getAccessTokenRaw();
    return token ?? null;
  } catch {
    // getKindeServerSession() may throw outside a request context (e.g. during
    // static generation).  Treat as unauthenticated.
    return null;
  }
}

// ─── requireKindeToken ────────────────────────────────────────────────────────

/**
 * Get the raw Kinde access token, throwing if no token is available.
 *
 * Use this in strictly protected server contexts where an unauthenticated
 * request should never reach the call site (e.g. the middleware already
 * enforces authentication on this route).  The throw acts as a defense-in-depth
 * safety net.
 *
 * @returns Raw JWT string (guaranteed non-empty).
 * @throws  Error("Unauthenticated: no Kinde access token available") when
 *          the session has no token.
 *
 * @example
 * // In a protected Route Handler:
 * const token = await requireKindeToken();
 * const user = extractUserFromToken(token);
 * // proceed with user.kindeId, user.roles, etc.
 */
export async function requireKindeToken(): Promise<string> {
  const token = await getKindeToken();
  if (!token) {
    throw new Error(
      "Unauthenticated: no Kinde access token available. " +
      "Ensure the user is authenticated and the Kinde session is active."
    );
  }
  return token;
}

// ─── parseTokenClaims (internal utility, exported for testing) ───────────────

/**
 * Parse the base64url-encoded payload of a JWT into KindeTokenClaims.
 *
 * This is a low-level helper that performs NO validation — it only decodes
 * the payload JSON.  Exported for unit-testing purposes; prefer
 * extractUserFromToken() in application code.
 *
 * @param token  Raw JWT string.
 * @returns      Parsed payload as KindeTokenClaims.
 * @throws       Error if the token is malformed or the payload is not valid JSON.
 *
 * @internal
 */
export function parseTokenClaims(token: string): KindeTokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error(
      `parseTokenClaims: malformed JWT (expected 3 parts, got ${parts.length})`
    );
  }
  try {
    return JSON.parse(base64urlToString(parts[1])) as KindeTokenClaims;
  } catch {
    throw new Error("parseTokenClaims: JWT payload is not valid JSON");
  }
}
