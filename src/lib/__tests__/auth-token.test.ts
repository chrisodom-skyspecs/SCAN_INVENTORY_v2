/**
 * Unit tests for src/lib/auth-token.ts
 *
 * Tests cover the pure (no-network) utility functions:
 *   • buildDisplayName
 *   • parseTokenClaims
 *   • extractUserFromToken
 *
 * And mock-based tests for the async helpers:
 *   • getKindeToken
 *   • requireKindeToken
 *
 * verifyKindeJwt is NOT unit-tested here because it requires a live JWKS
 * endpoint and a real RS256 signature — it is integration-tested via the
 * convex/auth.ts counterpart test suite and end-to-end tests.
 *
 * Run: npx vitest run src/lib/__tests__/auth-token.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildDisplayName,
  parseTokenClaims,
  extractUserFromToken,
  getKindeToken,
  requireKindeToken,
  type KindeTokenClaims,
  type ExtractedUser,
} from "../auth-token";

// ─── Top-level mock for @kinde-oss/kinde-auth-nextjs/server ─────────────────
//
// vi.mock is hoisted to the top of the file by Vitest — the factory runs
// before variable declarations.  Use vi.hoisted() so mockGetAccessTokenRaw
// is created at hoist time and accessible inside the factory closure.
//
// Pattern: configure mockGetAccessTokenRaw in beforeEach / per-test.

const mockGetAccessTokenRaw = vi.hoisted(() =>
  vi.fn<() => Promise<string | null | undefined>>()
);

vi.mock("@kinde-oss/kinde-auth-nextjs/server", () => ({
  getKindeServerSession: () => ({
    getAccessTokenRaw: mockGetAccessTokenRaw,
  }),
}));

// ─── Test JWT helpers ─────────────────────────────────────────────────────────

/**
 * Encode a string to base64url (no padding).
 */
function toBase64url(str: string): string {
  const base64 = btoa(str);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Build a mock JWT string from a JSON payload.
 * The signature segment is NOT cryptographically valid.
 */
function makeMockJwt(payload: object, alg = "RS256"): string {
  const header = toBase64url(JSON.stringify({ alg, typ: "JWT", kid: "test-key-1" }));
  const body   = toBase64url(JSON.stringify(payload));
  const sig    = toBase64url("mock-signature-not-cryptographically-valid");
  return `${header}.${body}.${sig}`;
}

/** Full claims fixture */
const FULL_CLAIMS: KindeTokenClaims = {
  sub:         "kinde_01abc123",
  email:       "jane.doe@example.com",
  given_name:  "Jane",
  family_name: "Doe",
  picture:     "https://example.com/avatar.jpg",
  org_code:    "org_skyspecs",
  roles:       [
    { id: "role_01", key: "technician", name: "Technician" },
  ],
  iss:         "https://skyspecs.kinde.com",
  exp:         Math.floor(Date.now() / 1000) + 3600,
  iat:         Math.floor(Date.now() / 1000),
};

/** Minimal required claims (sub + email only) */
const MINIMAL_CLAIMS: KindeTokenClaims = {
  sub:   "kinde_01min",
  email: "minimal@example.com",
};

// ─── buildDisplayName ─────────────────────────────────────────────────────────

describe("buildDisplayName", () => {
  it("returns 'Given Family' when both given_name and family_name are set", () => {
    expect(buildDisplayName({ given_name: "Jane", family_name: "Doe", email: "j@e.com" }))
      .toBe("Jane Doe");
  });

  it("trims leading/trailing whitespace from the joined name", () => {
    // The function does `${given_name} ${family_name}`.trim() so outer whitespace
    // is stripped; internal spaces (between the two name parts) are preserved.
    const result = buildDisplayName({ given_name: "  Jane  ", family_name: "  Doe  ", email: "j@e.com" });
    // Outer whitespace trimmed; internal spaces between name parts remain.
    expect(result.startsWith(" ")).toBe(false);
    expect(result.endsWith(" ")).toBe(false);
    expect(result).toContain("Jane");
    expect(result).toContain("Doe");
  });

  it("returns given_name when only given_name is set", () => {
    expect(buildDisplayName({ given_name: "Jane", family_name: undefined, email: "j@e.com" }))
      .toBe("Jane");
  });

  it("returns email when neither given_name nor family_name is set", () => {
    expect(buildDisplayName({ given_name: undefined, family_name: undefined, email: "jane@example.com" }))
      .toBe("jane@example.com");
  });

  it("returns email when given_name is an empty string", () => {
    expect(buildDisplayName({ given_name: "", family_name: undefined, email: "jane@example.com" }))
      .toBe("jane@example.com");
  });

  it("returns 'Unknown User' when all fields are absent", () => {
    expect(buildDisplayName({ given_name: undefined, family_name: undefined, email: undefined }))
      .toBe("Unknown User");
  });

  it("returns 'Unknown User' when email is an empty string", () => {
    expect(buildDisplayName({ given_name: "", family_name: "", email: "" }))
      .toBe("Unknown User");
  });

  it("returns email (not 'Unknown User') when only email is present", () => {
    expect(buildDisplayName({ email: "ops@skyspecs.com" }))
      .toBe("ops@skyspecs.com");
  });

  it("uses given_name even when family_name is empty string", () => {
    // given_name truthy, family_name falsy → branch 2 (given_name only)
    expect(buildDisplayName({ given_name: "Jane", family_name: "", email: "j@e.com" }))
      .toBe("Jane");
  });

  it("correctly joins first and last name without extra trimming", () => {
    expect(buildDisplayName({ given_name: "Alice", family_name: "Smith" }))
      .toBe("Alice Smith");
  });
});

// ─── parseTokenClaims ─────────────────────────────────────────────────────────

describe("parseTokenClaims", () => {
  it("returns parsed claims from a valid mock JWT", () => {
    const jwt = makeMockJwt(FULL_CLAIMS);
    const claims = parseTokenClaims(jwt);
    expect(claims.sub).toBe("kinde_01abc123");
    expect(claims.email).toBe("jane.doe@example.com");
    expect(claims.given_name).toBe("Jane");
    expect(claims.family_name).toBe("Doe");
    expect(claims.org_code).toBe("org_skyspecs");
  });

  it("parses minimal claims (sub + email only)", () => {
    const jwt = makeMockJwt(MINIMAL_CLAIMS);
    const claims = parseTokenClaims(jwt);
    expect(claims.sub).toBe("kinde_01min");
    expect(claims.email).toBe("minimal@example.com");
    expect(claims.given_name).toBeUndefined();
    expect(claims.roles).toBeUndefined();
  });

  it("returns roles array from a JWT with roles", () => {
    const jwt = makeMockJwt(FULL_CLAIMS);
    const claims = parseTokenClaims(jwt);
    expect(claims.roles).toHaveLength(1);
    expect(claims.roles![0].key).toBe("technician");
  });

  it("throws when the token has fewer than 3 parts", () => {
    expect(() => parseTokenClaims("only.two")).toThrow(/malformed JWT/i);
  });

  it("throws when the token has more than 3 parts", () => {
    expect(() => parseTokenClaims("a.b.c.d")).toThrow(/malformed JWT/i);
  });

  it("throws when the payload is not valid base64url JSON", () => {
    const badJwt = `${toBase64url("{}")}.!!!.${toBase64url("sig")}`;
    expect(() => parseTokenClaims(badJwt)).toThrow(/not valid JSON/i);
  });

  it("throws for an empty string", () => {
    expect(() => parseTokenClaims("")).toThrow(/malformed JWT/i);
  });

  it("handles a JWT with exp, iat, nbf claims", () => {
    const now = Math.floor(Date.now() / 1000);
    const jwt = makeMockJwt({ ...MINIMAL_CLAIMS, exp: now + 3600, iat: now, nbf: now - 5 });
    const claims = parseTokenClaims(jwt);
    expect(claims.exp).toBe(now + 3600);
    expect(claims.iat).toBe(now);
    expect(claims.nbf).toBe(now - 5);
  });
});

// ─── extractUserFromToken ─────────────────────────────────────────────────────

describe("extractUserFromToken", () => {
  it("returns a fully populated ExtractedUser from a valid JWT", () => {
    const jwt = makeMockJwt(FULL_CLAIMS);
    const user: ExtractedUser = extractUserFromToken(jwt);

    expect(user.kindeId).toBe("kinde_01abc123");
    expect(user.email).toBe("jane.doe@example.com");
    expect(user.givenName).toBe("Jane");
    expect(user.familyName).toBe("Doe");
    expect(user.picture).toBe("https://example.com/avatar.jpg");
    expect(user.orgCode).toBe("org_skyspecs");
    expect(user.roles).toEqual(["technician"]);
    expect(user.displayName).toBe("Jane Doe");
  });

  it("returns empty roles array when roles claim is absent", () => {
    const jwt = makeMockJwt(MINIMAL_CLAIMS);
    const user = extractUserFromToken(jwt);
    expect(user.roles).toEqual([]);
  });

  it("flattens role objects to key strings", () => {
    const claims = {
      ...MINIMAL_CLAIMS,
      roles: [
        { id: "r1", key: "admin", name: "Admin" },
        { id: "r2", key: "technician", name: "Technician" },
      ],
    };
    const jwt = makeMockJwt(claims);
    const user = extractUserFromToken(jwt);
    expect(user.roles).toEqual(["admin", "technician"]);
  });

  it("displayName falls back to email when name parts are absent", () => {
    const jwt = makeMockJwt(MINIMAL_CLAIMS);
    const user = extractUserFromToken(jwt);
    expect(user.displayName).toBe("minimal@example.com");
  });

  it("displayName falls back to 'Unknown User' when email is empty", () => {
    const jwt = makeMockJwt({ sub: "kinde_01noemail", email: "" });
    const user = extractUserFromToken(jwt);
    expect(user.displayName).toBe("Unknown User");
  });

  it("email is empty string (not undefined) when missing from payload", () => {
    const jwt = makeMockJwt({ sub: "kinde_01noemail" });
    const user = extractUserFromToken(jwt);
    expect(user.email).toBe("");
  });

  it("throws when the token is malformed (too few parts)", () => {
    expect(() => extractUserFromToken("bad.token")).toThrow(/malformed JWT/i);
  });

  it("throws when the payload is not valid JSON", () => {
    const badPayload = "!!!not-json!!!";
    const badJwt = `${toBase64url("{}")}.${badPayload}.${toBase64url("sig")}`;
    expect(() => extractUserFromToken(badJwt)).toThrow();
  });

  it("throws when the payload is missing the 'sub' claim", () => {
    const jwt = makeMockJwt({ email: "no-sub@example.com" });
    expect(() => extractUserFromToken(jwt)).toThrow(/sub/i);
  });

  it("orgCode is undefined when org_code is not in the payload", () => {
    const jwt = makeMockJwt(MINIMAL_CLAIMS);
    const user = extractUserFromToken(jwt);
    expect(user.orgCode).toBeUndefined();
  });

  it("orgCode is set when org_code is in the payload", () => {
    const jwt = makeMockJwt({ ...MINIMAL_CLAIMS, org_code: "org_skyspecs" });
    const user = extractUserFromToken(jwt);
    expect(user.orgCode).toBe("org_skyspecs");
  });
});

// ─── getKindeToken ────────────────────────────────────────────────────────────

describe("getKindeToken", () => {
  beforeEach(() => {
    mockGetAccessTokenRaw.mockReset();
  });

  it("returns null when getAccessTokenRaw returns null", async () => {
    mockGetAccessTokenRaw.mockResolvedValue(null);
    const result = await getKindeToken();
    expect(result).toBeNull();
  });

  it("returns null when getAccessTokenRaw returns undefined", async () => {
    mockGetAccessTokenRaw.mockResolvedValue(undefined);
    const result = await getKindeToken();
    expect(result).toBeNull();
  });

  it("returns the token string when the session is active", async () => {
    const mockToken = makeMockJwt(FULL_CLAIMS);
    mockGetAccessTokenRaw.mockResolvedValue(mockToken);
    const result = await getKindeToken();
    expect(result).toBe(mockToken);
  });

  it("returns null when getAccessTokenRaw throws", async () => {
    mockGetAccessTokenRaw.mockRejectedValue(new Error("session error"));
    const result = await getKindeToken();
    expect(result).toBeNull();
  });
});

// ─── requireKindeToken ────────────────────────────────────────────────────────

describe("requireKindeToken", () => {
  beforeEach(() => {
    mockGetAccessTokenRaw.mockReset();
  });

  it("returns the token when the session is active", async () => {
    const mockToken = makeMockJwt(FULL_CLAIMS);
    mockGetAccessTokenRaw.mockResolvedValue(mockToken);
    const result = await requireKindeToken();
    expect(result).toBe(mockToken);
  });

  it("throws when getAccessTokenRaw returns null", async () => {
    mockGetAccessTokenRaw.mockResolvedValue(null);
    await expect(requireKindeToken()).rejects.toThrow(/Unauthenticated/i);
  });

  it("throws when getAccessTokenRaw returns undefined", async () => {
    mockGetAccessTokenRaw.mockResolvedValue(undefined);
    await expect(requireKindeToken()).rejects.toThrow(/Unauthenticated/i);
  });

  it("throws when getAccessTokenRaw throws", async () => {
    mockGetAccessTokenRaw.mockRejectedValue(new Error("no request context"));
    await expect(requireKindeToken()).rejects.toThrow(/Unauthenticated/i);
  });

  it("error message mentions 'no Kinde access token'", async () => {
    mockGetAccessTokenRaw.mockResolvedValue(undefined);
    let thrown: Error | undefined;
    try {
      await requireKindeToken();
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toMatch(/no Kinde access token/i);
  });
});

// ─── Type shape tests ─────────────────────────────────────────────────────────

describe("type shapes — KindeTokenClaims and ExtractedUser", () => {
  it("ExtractedUser always has a roles array (never undefined)", () => {
    const jwt = makeMockJwt({ sub: "kinde_01", email: "a@b.com" });
    const user = extractUserFromToken(jwt);
    expect(Array.isArray(user.roles)).toBe(true);
  });

  it("extractUserFromToken returns the full ExtractedUser shape for a role-bearing token", () => {
    const jwt = makeMockJwt(FULL_CLAIMS);
    const user = extractUserFromToken(jwt);

    expect(typeof user.kindeId).toBe("string");
    expect(typeof user.email).toBe("string");
    expect(typeof user.displayName).toBe("string");
    expect(Array.isArray(user.roles)).toBe(true);
  });

  it("parseTokenClaims returns optional claims as undefined (not null) when absent", () => {
    const jwt = makeMockJwt(MINIMAL_CLAIMS);
    const claims = parseTokenClaims(jwt);
    expect(claims.given_name).toBeUndefined();
    expect(claims.family_name).toBeUndefined();
    expect(claims.picture).toBeUndefined();
    expect(claims.org_code).toBeUndefined();
    expect(claims.roles).toBeUndefined();
  });
});
