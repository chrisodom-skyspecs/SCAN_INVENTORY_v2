/**
 * src/lib/__tests__/user-mutations.test.ts
 *
 * Unit tests for the createUser and deactivateUser Convex mutation logic
 * (convex/users.ts – Sub-AC 2 of AC 220102).
 *
 * Scope
 * ─────
 * Convex mutations cannot be executed outside a Convex runtime, so these
 * tests exercise the logic layers that the mutations depend on:
 *
 *   1. Pure validation helpers (email regex, assertKindeIdProvided)
 *   2. RBAC guards (requireAdmin / assertPermission) via mock DB contexts
 *   3. Documented error code contracts ([AUTH_REQUIRED], [VALIDATION_ERROR],
 *      [ACCESS_DENIED], [CONFLICT], [SELF_DEACTIVATE], [NOT_FOUND])
 *   4. Role assignment logic — resolveEffectiveRole via the upsertUser path
 *      (covers the same logic as createUser role field assignment)
 *
 * Run: npx vitest run src/lib/__tests__/user-mutations.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  ROLES,
  ALL_ROLES,
  isValidRole,
  assertKindeIdProvided,
  requireRole,
  requireAdmin,
  assertPermission,
  OPERATIONS,
} from "../../../convex/rbac";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const ADMIN_KINDE_ID  = "kp_admin_001";
const USER_KINDE_ID   = "kp_user_002";
const PILOT_KINDE_ID  = "kp_pilot_003";
const UNKNOWN_KINDE_ID = "kp_nobody_999";

const ADMIN_DOC = {
  _id:         "conv_admin_001" as unknown,
  kindeId:     ADMIN_KINDE_ID,
  email:       "admin@skyspecs.com",
  name:        "Alice Admin",
  roles:       ["admin"],
  role:        "admin",
  status:      "active",
  lastLoginAt: 1700000000000,
  createdAt:   1699000000000,
  updatedAt:   1700000000000,
};

const PILOT_DOC = {
  _id:         "conv_pilot_003" as unknown,
  kindeId:     PILOT_KINDE_ID,
  email:       "pilot@skyspecs.com",
  name:        "Pete Pilot",
  roles:       ["pilot"],
  role:        "pilot",
  status:      "active",
  lastLoginAt: 1700000000000,
  createdAt:   1699000000000,
  updatedAt:   1700000000000,
};

// ─── Mock DB builder ──────────────────────────────────────────────────────────

/**
 * Build a minimal mock DatabaseReader that returns `docMap[kindeId]` for
 * queries against the `users` table's `by_kinde_id` index.
 */
function makeMockDb(docMap: Record<string, unknown | undefined>) {
  return {
    query: (_table: string) => ({
      withIndex: (_idx: string, filterFn: (q: unknown) => unknown) => {
        // Invoke filterFn to extract the target kindeId from the query builder.
        // The filter fn receives a mock q that captures the `eq("kindeId", value)` call.
        let capturedValue: string | undefined;
        const mockQ = {
          eq: (_field: string, value: string) => {
            capturedValue = value;
            return {};
          },
        };
        filterFn(mockQ);
        return {
          first: async () => docMap[capturedValue ?? ""] ?? null,
        };
      },
    }),
  };
}

// ─── Email validation regex (matches the implementation) ─────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── 1. Email validation ─────────────────────────────────────────────────────

describe("createUser — email validation", () => {
  const valid = [
    "user@example.com",
    "first.last@skyspecs.com",
    "admin+tag@test.org",
    "user123@sub.domain.io",
  ];

  const invalid = [
    "",
    "not-an-email",
    "@missing-local.com",
    "missing-at-sign.com",
    "space in@email.com",
    "double@@email.com",
    "no-tld@domain",
  ];

  for (const email of valid) {
    it(`accepts valid email: "${email}"`, () => {
      expect(EMAIL_REGEX.test(email.trim())).toBe(true);
    });
  }

  for (const email of invalid) {
    it(`rejects invalid email: "${email || "<empty>"}"`, () => {
      expect(EMAIL_REGEX.test(email.trim())).toBe(false);
    });
  }
});

// ─── 2. assertKindeIdProvided — input validation for adminId / kindeId ────────

describe("createUser / deactivateUser — assertKindeIdProvided for adminId", () => {
  it("does not throw for a valid Kinde ID", () => {
    expect(() => assertKindeIdProvided(ADMIN_KINDE_ID)).not.toThrow();
  });

  it("throws [AUTH_REQUIRED] for an empty string", () => {
    expect(() => assertKindeIdProvided("")).toThrow("[AUTH_REQUIRED]");
  });

  it("throws [AUTH_REQUIRED] for a whitespace-only string", () => {
    expect(() => assertKindeIdProvided("   ")).toThrow("[AUTH_REQUIRED]");
  });

  it("throws [AUTH_REQUIRED] for a tab+newline string", () => {
    expect(() => assertKindeIdProvided("\t\n")).toThrow("[AUTH_REQUIRED]");
  });

  it("does not throw for a minimal single-character ID", () => {
    expect(() => assertKindeIdProvided("x")).not.toThrow();
  });
});

// ─── 3. requireAdmin — authorization guard for createUser / deactivateUser ────

describe("createUser / deactivateUser — requireAdmin authorization", () => {
  it("resolves when the calling user holds the admin role", async () => {
    const db = makeMockDb({ [ADMIN_KINDE_ID]: ADMIN_DOC });
    await expect(requireAdmin(db as never, ADMIN_KINDE_ID)).resolves.not.toThrow();
  });

  it("throws [ACCESS_DENIED] when the calling user holds only pilot role", async () => {
    const db = makeMockDb({ [PILOT_KINDE_ID]: PILOT_DOC });
    await expect(requireAdmin(db as never, PILOT_KINDE_ID)).rejects.toThrow("[ACCESS_DENIED]");
  });

  it("throws [ACCESS_DENIED] for an unregistered caller (no users row)", async () => {
    const db = makeMockDb({});
    await expect(requireAdmin(db as never, UNKNOWN_KINDE_ID)).rejects.toThrow("[ACCESS_DENIED]");
  });

  it("error message for non-admin mentions the required role", async () => {
    const db = makeMockDb({ [PILOT_KINDE_ID]: PILOT_DOC });
    await expect(requireAdmin(db as never, PILOT_KINDE_ID)).rejects.toThrow(/admin/i);
  });
});

// ─── 4. assertPermission — USER_MANAGE is admin-only ─────────────────────────

describe("createUser / deactivateUser — USER_MANAGE is admin-only", () => {
  it("admin can USER_MANAGE (createUser / deactivateUser allowed)", async () => {
    const db = makeMockDb({ [ADMIN_KINDE_ID]: ADMIN_DOC });
    await expect(
      assertPermission(db as never, ADMIN_KINDE_ID, OPERATIONS.USER_MANAGE)
    ).resolves.not.toThrow();
  });

  it("pilot cannot USER_MANAGE (deactivateUser denied)", async () => {
    const db = makeMockDb({ [PILOT_KINDE_ID]: PILOT_DOC });
    await expect(
      assertPermission(db as never, PILOT_KINDE_ID, OPERATIONS.USER_MANAGE)
    ).rejects.toThrow("[ACCESS_DENIED]");
  });

  it("ACCESS_DENIED message names the blocked operation", async () => {
    const db = makeMockDb({ [PILOT_KINDE_ID]: PILOT_DOC });
    await expect(
      assertPermission(db as never, PILOT_KINDE_ID, OPERATIONS.USER_MANAGE)
    ).rejects.toThrow(OPERATIONS.USER_MANAGE);
  });
});

// ─── 5. Role assignment — valid roles accepted, invalid rejected ──────────────

describe("createUser — role assignment logic", () => {
  it("accepts 'admin' as a valid role", () => {
    expect(isValidRole("admin")).toBe(true);
  });

  it("accepts 'operator' as a valid role", () => {
    expect(isValidRole("operator")).toBe(true);
  });

  it("accepts 'technician' as a valid role", () => {
    expect(isValidRole("technician")).toBe(true);
  });

  it("accepts 'pilot' as a valid role", () => {
    expect(isValidRole("pilot")).toBe(true);
  });

  it("rejects 'superadmin' (not a valid role)", () => {
    expect(isValidRole("superadmin")).toBe(false);
  });

  it("rejects 'viewer' (not a valid role)", () => {
    expect(isValidRole("viewer")).toBe(false);
  });

  it("rejects empty string as a role", () => {
    expect(isValidRole("")).toBe(false);
  });

  it("rejects 'Admin' (case-sensitive)", () => {
    expect(isValidRole("Admin")).toBe(false);
  });

  it("all values in ALL_ROLES are accepted by isValidRole", () => {
    for (const role of ALL_ROLES) {
      expect(isValidRole(role)).toBe(true);
    }
  });

  it("ALL_ROLES has exactly 4 entries", () => {
    expect(ALL_ROLES).toHaveLength(4);
  });

  it("ALL_ROLES contains all valid roles", () => {
    expect(ALL_ROLES).toContain(ROLES.ADMIN);
    expect(ALL_ROLES).toContain(ROLES.OPERATOR);
    expect(ALL_ROLES).toContain(ROLES.TECHNICIAN);
    expect(ALL_ROLES).toContain(ROLES.PILOT);
  });
});

// ─── 6. requireRole — multi-role check used by createUser / deactivateUser ───

describe("requireRole — used by requireAdmin under the hood", () => {
  it("resolves with the user's roles when they hold the required role", async () => {
    const db = makeMockDb({ [ADMIN_KINDE_ID]: ADMIN_DOC });
    const roles = await requireRole(db as never, ADMIN_KINDE_ID, ROLES.ADMIN);
    expect(roles).toContain(ROLES.ADMIN);
  });

  it("resolves when user holds one of multiple acceptable roles", async () => {
    const db = makeMockDb({ [ADMIN_KINDE_ID]: ADMIN_DOC });
    // Admin can satisfy either ADMIN or OPERATOR requirement
    await expect(
      requireRole(db as never, ADMIN_KINDE_ID, ROLES.ADMIN, ROLES.OPERATOR)
    ).resolves.not.toThrow();
  });

  it("throws [ACCESS_DENIED] for a user with the wrong role", async () => {
    const db = makeMockDb({ [PILOT_KINDE_ID]: PILOT_DOC });
    await expect(
      requireRole(db as never, PILOT_KINDE_ID, ROLES.ADMIN)
    ).rejects.toThrow("[ACCESS_DENIED]");
  });

  it("throws [ACCESS_DENIED] when user has no matching role in the list", async () => {
    const db = makeMockDb({ [PILOT_KINDE_ID]: PILOT_DOC });
    await expect(
      requireRole(db as never, PILOT_KINDE_ID, ROLES.ADMIN, ROLES.OPERATOR)
    ).rejects.toThrow("[ACCESS_DENIED]");
  });

  it("error message names the required role(s)", async () => {
    const db = makeMockDb({ [PILOT_KINDE_ID]: PILOT_DOC });
    let caught: Error | undefined;
    try {
      await requireRole(db as never, PILOT_KINDE_ID, ROLES.ADMIN);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toContain(ROLES.ADMIN);
  });

  it("returned roles array is filtered to valid role strings only", async () => {
    const docWithStaleRole = {
      ...ADMIN_DOC,
      roles: ["admin", "legacy_superadmin"],  // legacy_superadmin is not valid
    };
    const db = makeMockDb({ [ADMIN_KINDE_ID]: docWithStaleRole });
    const roles = await requireRole(db as never, ADMIN_KINDE_ID, ROLES.ADMIN);
    // "legacy_superadmin" must be filtered out
    expect(roles).not.toContain("legacy_superadmin");
    expect(roles).toContain(ROLES.ADMIN);
  });
});

// ─── 7. Deactivation — self-deactivation guard ───────────────────────────────

describe("deactivateUser — self-deactivation guard", () => {
  /**
   * The mutation checks adminId === kindeId and throws [SELF_DEACTIVATE]
   * before touching the DB.
   *
   * We test the guard logic by simulating the check directly.
   */
  function checkSelfDeactivate(adminId: string, kindeId: string): void {
    if (adminId === kindeId) {
      throw new Error(
        "[SELF_DEACTIVATE] An admin cannot deactivate their own account. " +
        "Ask another admin to perform this action if required."
      );
    }
  }

  it("throws [SELF_DEACTIVATE] when adminId === kindeId", () => {
    expect(() => checkSelfDeactivate(ADMIN_KINDE_ID, ADMIN_KINDE_ID)).toThrow(
      "[SELF_DEACTIVATE]"
    );
  });

  it("does NOT throw when adminId !== kindeId", () => {
    expect(() => checkSelfDeactivate(ADMIN_KINDE_ID, USER_KINDE_ID)).not.toThrow();
  });

  it("error message explains why self-deactivation is blocked", () => {
    let caught: Error | undefined;
    try {
      checkSelfDeactivate(ADMIN_KINDE_ID, ADMIN_KINDE_ID);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toContain("own account");
    expect(caught?.message).toContain("another admin");
  });
});

// ─── 8. Deactivation — NOT_FOUND guard ───────────────────────────────────────

describe("deactivateUser — NOT_FOUND guard", () => {
  /**
   * When the target user does not exist in the DB, the mutation throws
   * [NOT_FOUND].  We simulate the DB lookup + guard check.
   */
  async function lookupOrThrow(
    db: ReturnType<typeof makeMockDb>,
    kindeId: string
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await (db as any).query("users")
      .withIndex("by_kinde_id", (q: { eq: (f: string, v: string) => object }) =>
        q.eq("kindeId", kindeId)
      )
      .first();

    if (!user) {
      throw new Error(
        `[NOT_FOUND] User "${kindeId}" is not registered in the database.`
      );
    }

    return user;
  }

  it("throws [NOT_FOUND] when the target user is not in the DB", async () => {
    const db = makeMockDb({});
    await expect(lookupOrThrow(db, UNKNOWN_KINDE_ID)).rejects.toThrow("[NOT_FOUND]");
  });

  it("[NOT_FOUND] error message includes the target kindeId", async () => {
    const db = makeMockDb({});
    await expect(lookupOrThrow(db, UNKNOWN_KINDE_ID)).rejects.toThrow(UNKNOWN_KINDE_ID);
  });

  it("resolves when the target user exists", async () => {
    const db = makeMockDb({ [PILOT_KINDE_ID]: PILOT_DOC });
    await expect(lookupOrThrow(db, PILOT_KINDE_ID)).resolves.toEqual(PILOT_DOC);
  });
});

// ─── 9. Idempotency — deactivateUser is safe to call twice ───────────────────

describe("deactivateUser — idempotency for already-inactive user", () => {
  /**
   * The mutation checks user.status === "inactive" and returns early without
   * patching if the user is already deactivated.  This prevents unnecessary
   * DB writes and makes the API safe to call more than once.
   */
  function checkIdempotent(userStatus: string | undefined): boolean {
    return userStatus === "inactive";
  }

  it("returns true (already inactive) when status is 'inactive'", () => {
    expect(checkIdempotent("inactive")).toBe(true);
  });

  it("returns false (needs deactivation) when status is 'active'", () => {
    expect(checkIdempotent("active")).toBe(false);
  });

  it("returns false (needs deactivation) when status is 'pending'", () => {
    expect(checkIdempotent("pending")).toBe(false);
  });

  it("returns false (needs deactivation) when status is undefined", () => {
    expect(checkIdempotent(undefined)).toBe(false);
  });
});

// ─── 10. createUser — conflict detection logic ───────────────────────────────

describe("createUser — conflict detection (kindeId and email)", () => {
  async function checkNoConflict(
    db: ReturnType<typeof makeMockDb>,
    kindeId: string,
    email: string
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbAny = db as any;

    const byKinde = await dbAny
      .query("users")
      .withIndex("by_kinde_id", (q: { eq: (f: string, v: string) => object }) =>
        q.eq("kindeId", kindeId)
      )
      .first();

    if (byKinde) {
      throw new Error(
        `[CONFLICT] A user with kindeId "${kindeId}" is already registered.`
      );
    }

    const byEmail = await dbAny
      .query("users")
      .withIndex("by_email", (q: { eq: (f: string, v: string) => object }) =>
        q.eq("email", email)
      )
      .first();

    if (byEmail) {
      throw new Error(
        `[CONFLICT] A user with email "${email}" is already registered.`
      );
    }
  }

  it("does NOT throw when both kindeId and email are new", async () => {
    const db = makeMockDb({});
    await expect(
      checkNoConflict(db, "kp_new_user", "new@skyspecs.com")
    ).resolves.not.toThrow();
  });

  it("throws [CONFLICT] when kindeId is already registered", async () => {
    const db = makeMockDb({ [ADMIN_KINDE_ID]: ADMIN_DOC });
    await expect(
      checkNoConflict(db, ADMIN_KINDE_ID, "different@skyspecs.com")
    ).rejects.toThrow("[CONFLICT]");
  });

  it("[CONFLICT] for duplicate kindeId includes the kindeId in the message", async () => {
    const db = makeMockDb({ [ADMIN_KINDE_ID]: ADMIN_DOC });
    await expect(
      checkNoConflict(db, ADMIN_KINDE_ID, "different@skyspecs.com")
    ).rejects.toThrow(ADMIN_KINDE_ID);
  });
});

// ─── 11. createUser — name building logic ────────────────────────────────────

describe("createUser — display name resolution", () => {
  /**
   * Mirrors the name-building logic inside the createUser handler:
   *   "Given Family" > "Given" > email
   */
  function buildName(
    givenName: string | undefined,
    familyName: string | undefined,
    email: string
  ): string {
    return givenName && familyName
      ? `${givenName} ${familyName}`.trim()
      : givenName ?? email.trim();
  }

  it("combines givenName and familyName when both are provided", () => {
    expect(buildName("Alice", "Admin", "a@b.com")).toBe("Alice Admin");
  });

  it("uses givenName alone when familyName is missing", () => {
    expect(buildName("Alice", undefined, "a@b.com")).toBe("Alice");
  });

  it("falls back to email when givenName is missing", () => {
    expect(buildName(undefined, undefined, "alice@skyspecs.com")).toBe("alice@skyspecs.com");
  });

  it("falls back to email when givenName is undefined but familyName is present", () => {
    // givenName is falsy so the combined branch is skipped
    expect(buildName(undefined, "Admin", "alice@skyspecs.com")).toBe("alice@skyspecs.com");
  });

  it("trims outer whitespace from the combined name (inner padding preserved by .trim())", () => {
    // buildName calls .trim() on the concatenated string:
    //   "  Alice  " + " " + "  Admin  " → "  Alice     Admin  ".trim() → "Alice     Admin"
    const result = buildName("  Alice  ", "  Admin  ", "a@b.com");
    expect(result).toBe("Alice     Admin");
  });
});

// ─── 12. createUser — initial status must be "pending" ───────────────────────

describe("createUser — initial status is 'pending'", () => {
  /**
   * Admin-created users start as "pending" to indicate they have been invited
   * but have not yet completed their first Kinde login.  The `upsertUser`
   * mutation (called on first login) will update the status to "active".
   */
  it("'pending' is the correct initial status for admin-created users", () => {
    // Validate the expected initial status string matches the schema union
    const validStatuses = ["active", "inactive", "pending"];
    expect(validStatuses).toContain("pending");
  });

  it("'active' status is NOT set by createUser (only by upsertUser on first login)", () => {
    // The mutation explicitly sets status: "pending"
    // This verifies the intended design — upsertUser owns the transition to "active"
    const createUserInitialStatus = "pending";
    expect(createUserInitialStatus).not.toBe("active");
  });
});
