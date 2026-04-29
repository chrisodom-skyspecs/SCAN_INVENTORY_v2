/**
 * src/lib/__tests__/convex-auth-guards.test.ts
 *
 * Unit tests for convex/lib/auth.ts — the server-side auth guards used by
 * every protected query and mutation in the INVENTORY + SCAN Convex backend.
 *
 * Sub-AC 3 requirement
 * ────────────────────
 * "Confirm at least one protected query and one protected mutation succeed
 * when authenticated and are rejected when unauthenticated."
 *
 * These tests directly exercise the auth guard logic that ALL protected Convex
 * handlers call:
 *
 *   Protected query (e.g. cases.getCaseStatus, cases.listCases):
 *     → requireAuth(ctx) via requireAuthIdentity(ctx)
 *     → throws [AUTH_REQUIRED] when ctx.auth.getUserIdentity() returns null
 *     → returns UserIdentity when ctx.auth.getUserIdentity() returns a valid identity
 *
 *   Protected mutation (e.g. scan.scanCheckIn, scan.updateChecklistItem):
 *     → requireAuth(ctx) via requireAuthIdentity(ctx)
 *     → throws [AUTH_REQUIRED] when ctx.auth.getUserIdentity() returns null
 *     → calls DB to resolve user record for attribution fields
 *
 * The full lifecycle (including DB calls) is tested via requireCurrentUser(),
 * which is the standard guard used by write-path mutation handlers that need
 * user roles and display name.
 *
 * Mocking strategy
 * ────────────────
 * All tests use mock `ctx` objects that implement the minimal interface
 * required by the auth helpers:
 *   ctx.auth.getUserIdentity() → Promise<UserIdentity | null>
 *   ctx.db.query(table).withIndex(name, fn).first() → Promise<user | null>
 *
 * No Convex SDK dependencies are exercised — the functions under test are pure
 * logic functions that call well-defined async methods on their context.
 *
 * Run: npx vitest run src/lib/__tests__/convex-auth-guards.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  requireAuthIdentity,
  getAuthIdentity,
  extractKindeId,
  getCurrentUser,
  requireCurrentUser,
  assertCurrentUser,
} from "../../../convex/lib/auth";

// ─── Type alias for mock contexts ─────────────────────────────────────────────

/**
 * The parameter type expected by all convex/lib/auth.ts helpers.
 * Using `Parameters<typeof requireAuthIdentity>[0]` gives us the exact shape
 * without relying on the private `AuthCtx` interface in the source.
 */
type AuthCtxParam = Parameters<typeof requireAuthIdentity>[0];

// ─── Mock identity fixture ─────────────────────────────────────────────────────

/**
 * A fully-populated mock UserIdentity — the shape returned by
 * ctx.auth.getUserIdentity() after successful Convex JWT verification.
 *
 * `subject` === Kinde `sub` claim === `kindeId` in the users table.
 */
const MOCK_IDENTITY = {
  subject: "kinde_user_abc123",
  tokenIdentifier: "kinde_user_abc123|https://skyspecs.kinde.com",
  issuer: "https://skyspecs.kinde.com",
  name: "Jane Technician",
  email: "jane@skyspecs.com",
  givenName: "Jane",
  familyName: "Technician",
  pictureUrl: undefined,
};

/**
 * A fully-populated mock user document — the shape returned by ctx.db when the
 * users table row is found for the authenticated Kinde user.
 */
const MOCK_USER_DOC = {
  _id: "conv_user_id_abc123",
  kindeId: "kinde_user_abc123",
  email: "jane@skyspecs.com",
  name: "Jane Technician",
  givenName: "Jane",
  familyName: "Technician",
  picture: undefined,
  orgCode: "org_skyspecs",
  roles: ["technician"],
  lastLoginAt: 1700000000000,
  createdAt: 1699000000000,
  updatedAt: 1700000000000,
};

// ─── Mock context builders ─────────────────────────────────────────────────────

/**
 * Build a mock Convex context where the user is NOT authenticated.
 * ctx.auth.getUserIdentity() returns null.
 *
 * Cast to `AuthCtxParam` to satisfy the strict Convex SDK types —
 * the runtime behavior only uses the two async methods we provide.
 */
function makeUnauthCtx(): AuthCtxParam {
  return {
    auth: {
      getUserIdentity: async () => null,
    },
    db: {
      query: (_table: string) => ({
        withIndex: (_idx: string, _fn: unknown) => ({
          first: async () => null,
        }),
      }),
    },
  } as unknown as AuthCtxParam;
}

/**
 * Build a mock Convex context where the user IS authenticated.
 * ctx.auth.getUserIdentity() returns MOCK_IDENTITY.
 * ctx.db.query("users").withIndex(...).first() returns the given user doc
 * (or null when userDoc is explicitly passed as null to simulate "no record").
 *
 * Cast to `AuthCtxParam` to satisfy the strict Convex SDK types —
 * the runtime behavior only uses the two async methods we provide.
 */
function makeAuthCtx(
  userDoc: typeof MOCK_USER_DOC | null = MOCK_USER_DOC
): AuthCtxParam {
  return {
    auth: {
      getUserIdentity: async () => MOCK_IDENTITY,
    },
    db: {
      query: (_table: string) => ({
        withIndex: (_idx: string, _fn: unknown) => ({
          first: async () => userDoc,
        }),
      }),
    },
  } as unknown as AuthCtxParam;
}

// ─── requireAuthIdentity ──────────────────────────────────────────────────────

describe("requireAuthIdentity — unauthenticated (no JWT sent)", () => {
  /**
   * This is the error path exercised by any protected Convex query/mutation
   * when the client is NOT wrapped in ConvexProviderWithAuth, or when the user
   * is signed out and Convex sends no Authorization header.
   *
   * In the INVENTORY dashboard, this path would be hit if:
   *   - The browser loads /inventory without a Kinde session
   *   - The session expires and getToken() returns null
   *   - The ConvexProviderWithAuth is misconfigured
   */
  it("throws an error when ctx.auth.getUserIdentity() returns null", async () => {
    const ctx = makeUnauthCtx();
    await expect(requireAuthIdentity(ctx)).rejects.toThrow();
  });

  it("error message contains [AUTH_REQUIRED] tag for structured log filtering", async () => {
    const ctx = makeUnauthCtx();
    let caughtError: Error | undefined;
    try {
      await requireAuthIdentity(ctx);
    } catch (err) {
      caughtError = err as Error;
    }
    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toContain("[AUTH_REQUIRED]");
  });

  it("error message mentions 'Unauthenticated' for clarity in logs", async () => {
    const ctx = makeUnauthCtx();
    await expect(requireAuthIdentity(ctx)).rejects.toThrow(/Unauthenticated/i);
  });

  it("error message mentions 'ConvexProviderWithAuth' so engineers know the fix", async () => {
    const ctx = makeUnauthCtx();
    await expect(requireAuthIdentity(ctx)).rejects.toThrow(/ConvexProviderWithAuth/);
  });
});

describe("requireAuthIdentity — authenticated (valid Kinde JWT verified by Convex)", () => {
  /**
   * This is the success path exercised by protected queries/mutations when:
   *   - The INVENTORY dashboard is loaded by an authenticated user
   *   - ConvexProviderWithAuth sent the Kinde token in the Authorization header
   *   - Convex verified the JWT signature against the Kinde JWKS endpoint
   *   - ctx.auth.getUserIdentity() returns the verified identity
   *
   * Corresponds to: protected query (e.g., cases.getCaseStatus, cases.listCases)
   * succeeding when authenticated.
   */
  it("returns the UserIdentity when ctx.auth.getUserIdentity() returns a valid identity", async () => {
    const ctx = makeAuthCtx();
    const identity = await requireAuthIdentity(ctx);
    expect(identity).toEqual(MOCK_IDENTITY);
  });

  it("returned identity has the expected subject (Kinde user ID)", async () => {
    const ctx = makeAuthCtx();
    const identity = await requireAuthIdentity(ctx);
    expect(identity.subject).toBe("kinde_user_abc123");
  });

  it("returned identity has the expected email", async () => {
    const ctx = makeAuthCtx();
    const identity = await requireAuthIdentity(ctx);
    expect(identity.email).toBe("jane@skyspecs.com");
  });

  it("does NOT throw when authenticated", async () => {
    const ctx = makeAuthCtx();
    await expect(requireAuthIdentity(ctx)).resolves.not.toThrow();
  });
});

// ─── getAuthIdentity ──────────────────────────────────────────────────────────

describe("getAuthIdentity — non-throwing variant", () => {
  it("returns null when unauthenticated (no throw)", async () => {
    const ctx = makeUnauthCtx();
    const identity = await getAuthIdentity(ctx);
    expect(identity).toBeNull();
  });

  it("returns the UserIdentity when authenticated", async () => {
    const ctx = makeAuthCtx();
    const identity = await getAuthIdentity(ctx);
    expect(identity).toEqual(MOCK_IDENTITY);
  });

  it("never throws for any auth state", async () => {
    const unauth = makeUnauthCtx();
    const auth = makeAuthCtx();
    await expect(getAuthIdentity(unauth)).resolves.not.toThrow();
    await expect(getAuthIdentity(auth)).resolves.not.toThrow();
  });
});

// ─── extractKindeId ───────────────────────────────────────────────────────────

describe("extractKindeId", () => {
  it("extracts the Kinde user ID (subject) from a UserIdentity", () => {
    const kindeId = extractKindeId(MOCK_IDENTITY);
    expect(kindeId).toBe("kinde_user_abc123");
  });

  it("returns the same value as identity.subject", () => {
    expect(extractKindeId(MOCK_IDENTITY)).toBe(MOCK_IDENTITY.subject);
  });

  it("works with a minimal identity containing only subject", () => {
    const minimalIdentity = {
      subject: "kinde_minimal_user",
      tokenIdentifier: "kinde_minimal_user|https://test.kinde.com",
      issuer: "https://test.kinde.com",
      name: undefined,
      email: undefined,
      givenName: undefined,
      familyName: undefined,
      pictureUrl: undefined,
    };
    expect(extractKindeId(minimalIdentity)).toBe("kinde_minimal_user");
  });
});

// ─── getCurrentUser ───────────────────────────────────────────────────────────

describe("getCurrentUser — unauthenticated path", () => {
  it("returns null when ctx.auth.getUserIdentity() returns null (unauthenticated)", async () => {
    const ctx = makeUnauthCtx();
    const user = await getCurrentUser(ctx);
    expect(user).toBeNull();
  });

  it("does NOT throw when unauthenticated", async () => {
    const ctx = makeUnauthCtx();
    await expect(getCurrentUser(ctx)).resolves.not.toThrow();
  });
});

describe("getCurrentUser — authenticated but no user record (pre-sync state)", () => {
  /**
   * This edge case occurs when:
   *   - The user successfully authenticated via Kinde
   *   - But POST /api/auth/sync has NOT been called yet
   *   - So no `users` table row exists for the Kinde ID
   *
   * getCurrentUser returns null (non-throwing) to let callers handle this
   * gracefully — e.g., showing a "syncing account..." state.
   */
  it("returns null when authenticated but users table has no matching row", async () => {
    const ctx = makeAuthCtx(null); // authenticated, but no user doc found
    const user = await getCurrentUser(ctx);
    expect(user).toBeNull();
  });

  it("does NOT throw when authenticated but user record is missing", async () => {
    const ctx = makeAuthCtx(null);
    await expect(getCurrentUser(ctx)).resolves.not.toThrow();
  });
});

describe("getCurrentUser — fully authenticated with user record", () => {
  /**
   * This is the normal production state:
   *   - User is authenticated (valid Kinde JWT)
   *   - POST /api/auth/sync has been called → users row exists
   *   - getCurrentUser returns the full user document
   *
   * Corresponds to: queries using getCurrentUser() (optional auth pattern)
   * succeeding when authenticated.
   */
  it("returns the user document when authenticated and user record exists", async () => {
    const ctx = makeAuthCtx(MOCK_USER_DOC);
    const user = await getCurrentUser(ctx);
    expect(user).toEqual(MOCK_USER_DOC);
  });

  it("returned user has the correct kindeId matching the JWT subject", async () => {
    const ctx = makeAuthCtx(MOCK_USER_DOC);
    const user = await getCurrentUser(ctx);
    expect(user?.kindeId).toBe("kinde_user_abc123");
  });

  it("returned user has the expected roles for RBAC checks", async () => {
    const ctx = makeAuthCtx(MOCK_USER_DOC);
    const user = await getCurrentUser(ctx);
    expect(user?.roles).toContain("technician");
  });
});

// ─── requireCurrentUser ───────────────────────────────────────────────────────

describe("requireCurrentUser — unauthenticated (protected mutation path)", () => {
  /**
   * requireCurrentUser() is the standard guard for write-path mutation handlers:
   *   scanCheckIn, updateChecklistItem, startInspection, completeInspection,
   *   handoffCustody, shipCase, etc.
   *
   * When unauthenticated, ALL of these mutations throw [AUTH_REQUIRED].
   * This mirrors the rejection that a caller without a valid Kinde session would
   * receive from the INVENTORY dashboard or SCAN app.
   */
  it("throws [AUTH_REQUIRED] when ctx.auth.getUserIdentity() returns null", async () => {
    const ctx = makeUnauthCtx();
    await expect(requireCurrentUser(ctx)).rejects.toThrow("[AUTH_REQUIRED]");
  });

  it("error message indicates the client must be wrapped in ConvexProviderWithAuth", async () => {
    const ctx = makeUnauthCtx();
    await expect(requireCurrentUser(ctx)).rejects.toThrow(/ConvexProviderWithAuth/);
  });
});

describe("requireCurrentUser — authenticated but missing user record", () => {
  /**
   * Edge case: the Kinde JWT is valid but the users table has no matching row.
   * This means POST /api/auth/sync was never called after login.
   *
   * requireCurrentUser() throws [USER_NOT_FOUND] so the calling mutation can
   * surface a meaningful error to the client ("Please log in again").
   */
  it("throws [USER_NOT_FOUND] when authenticated but no user record exists", async () => {
    const ctx = makeAuthCtx(null);
    await expect(requireCurrentUser(ctx)).rejects.toThrow("[USER_NOT_FOUND]");
  });

  it("error message mentions POST /api/auth/sync to guide engineers", async () => {
    const ctx = makeAuthCtx(null);
    await expect(requireCurrentUser(ctx)).rejects.toThrow(/\/api\/auth\/sync/);
  });
});

describe("requireCurrentUser — fully authenticated (protected mutation success path)", () => {
  /**
   * Normal production path: user is authenticated AND has a users table row.
   *
   * This is the success path for ALL protected mutations:
   *   - scanCheckIn: uses user.kindeId as technicianId, user.name as technicianName
   *   - handoffCustody: uses user.kindeId as fromUserId
   *   - damageReports: uses user.kindeId as reportedById
   *   etc.
   *
   * Corresponds to: protected mutation succeeding when authenticated.
   */
  it("returns the full user document when authenticated and record exists", async () => {
    const ctx = makeAuthCtx(MOCK_USER_DOC);
    const user = await requireCurrentUser(ctx);
    expect(user).toEqual(MOCK_USER_DOC);
  });

  it("returned user._id can be used as a Convex attribution field", async () => {
    const ctx = makeAuthCtx(MOCK_USER_DOC);
    const user = await requireCurrentUser(ctx);
    expect(user._id).toBe("conv_user_id_abc123");
  });

  it("returned user.kindeId can be used as technicianId in scan mutations", async () => {
    const ctx = makeAuthCtx(MOCK_USER_DOC);
    const user = await requireCurrentUser(ctx);
    expect(user.kindeId).toBe("kinde_user_abc123");
  });

  it("returned user.name can be used as technicianName in scan mutations", async () => {
    const ctx = makeAuthCtx(MOCK_USER_DOC);
    const user = await requireCurrentUser(ctx);
    expect(user.name).toBe("Jane Technician");
  });

  it("returned user.roles supports RBAC permission checks", async () => {
    const ctx = makeAuthCtx(MOCK_USER_DOC);
    const user = await requireCurrentUser(ctx);
    expect(Array.isArray(user.roles)).toBe(true);
    expect(user.roles).toContain("technician");
  });

  it("does NOT throw when fully authenticated with a user record", async () => {
    const ctx = makeAuthCtx(MOCK_USER_DOC);
    await expect(requireCurrentUser(ctx)).resolves.not.toThrow();
  });
});

// ─── assertCurrentUser (alias) ────────────────────────────────────────────────

describe("assertCurrentUser — alias for requireCurrentUser", () => {
  it("is the same function reference as requireCurrentUser", () => {
    expect(assertCurrentUser).toBe(requireCurrentUser);
  });

  it("throws [AUTH_REQUIRED] when unauthenticated (same as requireCurrentUser)", async () => {
    const ctx = makeUnauthCtx();
    await expect(assertCurrentUser(ctx)).rejects.toThrow("[AUTH_REQUIRED]");
  });

  it("returns user when authenticated and record exists (same as requireCurrentUser)", async () => {
    const ctx = makeAuthCtx(MOCK_USER_DOC);
    const user = await assertCurrentUser(ctx);
    expect(user.kindeId).toBe("kinde_user_abc123");
  });
});

// ─── Protected query simulation ───────────────────────────────────────────────

describe("Protected query simulation — cases.getCaseStatus pattern", () => {
  /**
   * Simulates the auth guard pattern used by all protected Convex query handlers:
   *
   *   export const getCaseStatus = query({
   *     handler: async (ctx, args) => {
   *       await requireAuth(ctx);  // ← throws [AUTH_REQUIRED] if not authed
   *       const c = await ctx.db.get(args.caseId);
   *       return c ? { status: c.status, ... } : null;
   *     },
   *   });
   *
   * The requireAuthIdentity helper IS that requireAuth pattern.
   *
   * When unauthenticated: the query handler throws before touching the DB.
   * When authenticated: the query handler proceeds to the DB read.
   */
  it("protected query REJECTS when called without a Kinde session", async () => {
    const ctx = makeUnauthCtx();

    // Simulate: const identity = await requireAuth(ctx);
    await expect(requireAuthIdentity(ctx)).rejects.toThrow("[AUTH_REQUIRED]");
  });

  it("protected query SUCCEEDS (auth guard passes) when called with a valid Kinde session", async () => {
    const ctx = makeAuthCtx();

    // Simulate: const identity = await requireAuth(ctx);
    const identity = await requireAuthIdentity(ctx);

    // Identity is valid — handler would proceed to DB read
    expect(identity.subject).toBe("kinde_user_abc123");
    expect(identity.email).toBe("jane@skyspecs.com");
  });
});

// ─── Protected mutation simulation ───────────────────────────────────────────

describe("Protected mutation simulation — scan.scanCheckIn pattern", () => {
  /**
   * Simulates the auth guard pattern used by all protected Convex mutation handlers:
   *
   *   export const scanCheckIn = mutation({
   *     handler: async (ctx, args) => {
   *       await requireAuth(ctx);  // ← throws [AUTH_REQUIRED] if not authed
   *       const caseDoc = await ctx.db.get(args.caseId);
   *       // ... write to DB
   *     },
   *   });
   *
   * This test simulates both the rejected (unauthenticated) and accepted
   * (authenticated) paths through the guard.
   */
  it("protected mutation REJECTS when called without a Kinde session", async () => {
    const ctx = makeUnauthCtx();

    // Simulate: await requireAuth(ctx); inside the mutation handler
    await expect(requireAuthIdentity(ctx)).rejects.toThrow("[AUTH_REQUIRED]");
  });

  it("protected mutation REJECTS with [AUTH_REQUIRED] prefix (structured error)", async () => {
    const ctx = makeUnauthCtx();
    let caught: Error | undefined;
    try {
      await requireAuthIdentity(ctx);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message.startsWith("[AUTH_REQUIRED]")).toBe(true);
  });

  it("protected mutation SUCCEEDS (auth guard passes) when called with valid Kinde session", async () => {
    const ctx = makeAuthCtx();

    // Simulate: await requireAuth(ctx); inside the mutation handler
    const identity = await requireAuthIdentity(ctx);

    // Guard passed — mutation would proceed to write the DB
    expect(identity.subject).toBe("kinde_user_abc123");
  });

  it("full guard chain: requireCurrentUser succeeds for authenticated mutation caller", async () => {
    const ctx = makeAuthCtx(MOCK_USER_DOC);

    // Simulate the full guard chain used by write mutations:
    //   1. requireAuthIdentity (JWT check)
    //   2. DB lookup for user record (for attribution fields)
    const user = await requireCurrentUser(ctx);

    // Both steps passed — mutation has access to user.kindeId, user.name, user.roles
    expect(user.kindeId).toBe("kinde_user_abc123");
    expect(user.name).toBe("Jane Technician");
    expect(user.roles).toContain("technician");
  });

  it("full guard chain: requireCurrentUser REJECTS unauthenticated mutation caller", async () => {
    const ctx = makeUnauthCtx();

    // Unauthenticated — full guard chain throws before touching write paths
    await expect(requireCurrentUser(ctx)).rejects.toThrow("[AUTH_REQUIRED]");
  });
});
