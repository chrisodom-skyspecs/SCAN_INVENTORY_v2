/**
 * Unit tests for src/lib/rbac.ts
 *
 * Tests cover the client-side convenience API added on top of the convex/rbac.ts
 * re-exports:
 *   - hasPermission()
 *   - roleCanPerform()
 *   - resolvePrimaryRole()
 *   - filterValidRoles()
 *   - describeAllowedRoles()
 *   - ROLE_LABELS
 *   - ROLE_DESCRIPTIONS
 *
 * The pure functions re-exported from convex/rbac.ts (isValidRole, roleHasPermission,
 * rolesHavePermission, etc.) are already tested exhaustively in rbac.test.ts.
 * These tests focus on the new surface in src/lib/rbac.ts.
 *
 * Run: npx vitest run src/lib/__tests__/rbac-client.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  ROLES,
  OPERATIONS,
  ALL_ROLES,
  hasPermission,
  roleCanPerform,
  resolvePrimaryRole,
  filterValidRoles,
  describeAllowedRoles,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  // Re-exported symbols — smoke-test that they are actually present
  isValidRole,
  roleHasPermission,
  rolesHavePermission,
  getAllowedRolesForOperation,
  assertKindeIdProvided,
  getPermissionMatrix,
  type Role,
  type Operation,
} from "../rbac";

// ─── Smoke-test: re-exported symbols are present ──────────────────────────────

describe("re-exported symbols from convex/rbac are available", () => {
  it("ROLES is an object with the four role keys", () => {
    expect(ROLES.ADMIN).toBe("admin");
    expect(ROLES.OPERATOR).toBe("operator");
    expect(ROLES.TECHNICIAN).toBe("technician");
    expect(ROLES.PILOT).toBe("pilot");
  });

  it("OPERATIONS is an object with operation string values", () => {
    expect(typeof OPERATIONS.CASE_READ).toBe("string");
    expect(OPERATIONS.CASE_READ).toBe("case:read");
  });

  it("ALL_ROLES is a readonly array of 4 roles", () => {
    expect(ALL_ROLES).toHaveLength(4);
    expect(ALL_ROLES[0]).toBe(ROLES.ADMIN);
  });

  it("isValidRole is a callable function", () => {
    expect(typeof isValidRole).toBe("function");
    expect(isValidRole("admin")).toBe(true);
    expect(isValidRole("unknown")).toBe(false);
  });

  it("roleHasPermission is a callable function", () => {
    expect(typeof roleHasPermission).toBe("function");
    expect(roleHasPermission(ROLES.ADMIN, OPERATIONS.CASE_CREATE)).toBe(true);
  });

  it("rolesHavePermission is a callable function", () => {
    expect(typeof rolesHavePermission).toBe("function");
    expect(rolesHavePermission(["admin"], OPERATIONS.CASE_DELETE)).toBe(true);
  });

  it("getAllowedRolesForOperation is a callable function", () => {
    expect(typeof getAllowedRolesForOperation).toBe("function");
    const allowed = getAllowedRolesForOperation(OPERATIONS.CASE_DELETE);
    expect(allowed).toEqual(["admin"]);
  });

  it("assertKindeIdProvided is a callable function", () => {
    expect(typeof assertKindeIdProvided).toBe("function");
    expect(() => assertKindeIdProvided("kinde_123")).not.toThrow();
  });

  it("getPermissionMatrix is a callable function", () => {
    expect(typeof getPermissionMatrix).toBe("function");
    const matrix = getPermissionMatrix();
    expect(typeof matrix).toBe("object");
    expect(Array.isArray(matrix[ROLES.ADMIN])).toBe(true);
  });
});

// ─── hasPermission ────────────────────────────────────────────────────────────

describe("hasPermission", () => {
  it("returns true when a role in the array has the permission", () => {
    expect(hasPermission(["technician"], OPERATIONS.INSPECTION_START)).toBe(true);
  });

  it("returns false when no role in the array has the permission", () => {
    expect(hasPermission(["pilot"], OPERATIONS.INSPECTION_START)).toBe(false);
  });

  it("returns true for the union of roles (any match)", () => {
    expect(
      hasPermission(["pilot", "admin"], OPERATIONS.FEATURE_FLAG_MANAGE)
    ).toBe(true);
  });

  it("returns false for an empty roles array", () => {
    expect(hasPermission([], OPERATIONS.CASE_READ)).toBe(false);
  });

  it("filters unknown roles and proceeds with valid ones", () => {
    expect(
      hasPermission(["ghost", "technician"], OPERATIONS.INSPECTION_START)
    ).toBe(true);
  });

  it("returns false for an array containing only unknown roles", () => {
    expect(hasPermission(["ghost", "wizard"], OPERATIONS.CASE_READ)).toBe(false);
  });

  it("admin can perform every operation", () => {
    for (const op of Object.values(OPERATIONS) as Operation[]) {
      expect(hasPermission(["admin"], op)).toBe(true);
    }
  });

  it("pilot cannot perform inspection start (technician-only)", () => {
    expect(hasPermission(["pilot"], OPERATIONS.INSPECTION_START)).toBe(false);
  });

  it("pilot can perform CASE_SHIP (universal)", () => {
    expect(hasPermission(["pilot"], OPERATIONS.CASE_SHIP)).toBe(true);
  });

  it("operator can perform CASE_CREATE (not technician or pilot)", () => {
    expect(hasPermission(["operator"], OPERATIONS.CASE_CREATE)).toBe(true);
    expect(hasPermission(["technician"], OPERATIONS.CASE_CREATE)).toBe(false);
    expect(hasPermission(["pilot"], OPERATIONS.CASE_CREATE)).toBe(false);
  });

  it("is behaviorally identical to rolesHavePermission (alias test)", () => {
    const roles = ["technician"];
    for (const op of Object.values(OPERATIONS) as Operation[]) {
      expect(hasPermission(roles, op)).toBe(rolesHavePermission(roles, op));
    }
  });
});

// ─── roleCanPerform ───────────────────────────────────────────────────────────

describe("roleCanPerform", () => {
  it("returns true for admin on any operation", () => {
    expect(roleCanPerform(ROLES.ADMIN, OPERATIONS.CASE_DELETE)).toBe(true);
    expect(roleCanPerform(ROLES.ADMIN, OPERATIONS.FEATURE_FLAG_MANAGE)).toBe(true);
  });

  it("returns true for technician on field operations", () => {
    expect(roleCanPerform(ROLES.TECHNICIAN, OPERATIONS.INSPECTION_START)).toBe(true);
    expect(roleCanPerform(ROLES.TECHNICIAN, OPERATIONS.CASE_SHIP)).toBe(true);
  });

  it("returns false for technician on admin-only operations", () => {
    expect(roleCanPerform(ROLES.TECHNICIAN, OPERATIONS.CASE_DELETE)).toBe(false);
    expect(roleCanPerform(ROLES.TECHNICIAN, OPERATIONS.FEATURE_FLAG_MANAGE)).toBe(false);
  });

  it("returns true for pilot on CASE_SHIP and CUSTODY_TRANSFER", () => {
    expect(roleCanPerform(ROLES.PILOT, OPERATIONS.CASE_SHIP)).toBe(true);
    expect(roleCanPerform(ROLES.PILOT, OPERATIONS.CUSTODY_TRANSFER)).toBe(true);
  });

  it("returns false for pilot on INSPECTION_START", () => {
    expect(roleCanPerform(ROLES.PILOT, OPERATIONS.INSPECTION_START)).toBe(false);
  });

  it("is behaviorally identical to roleHasPermission (alias test)", () => {
    for (const role of ALL_ROLES) {
      for (const op of Object.values(OPERATIONS) as Operation[]) {
        expect(roleCanPerform(role, op)).toBe(roleHasPermission(role, op));
      }
    }
  });
});

// ─── resolvePrimaryRole ───────────────────────────────────────────────────────

describe("resolvePrimaryRole", () => {
  it("returns 'admin' for an admin user", () => {
    expect(resolvePrimaryRole(["admin"])).toBe(ROLES.ADMIN);
  });

  it("returns 'operator' for an operator user", () => {
    expect(resolvePrimaryRole(["operator"])).toBe(ROLES.OPERATOR);
  });

  it("returns 'technician' for a technician user", () => {
    expect(resolvePrimaryRole(["technician"])).toBe(ROLES.TECHNICIAN);
  });

  it("returns 'pilot' for a pilot user", () => {
    expect(resolvePrimaryRole(["pilot"])).toBe(ROLES.PILOT);
  });

  it("returns null for an empty array", () => {
    expect(resolvePrimaryRole([])).toBeNull();
  });

  it("returns null for an array of only unknown roles", () => {
    expect(resolvePrimaryRole(["ghost", "wizard"])).toBeNull();
  });

  it("admin wins over technician when both are present", () => {
    expect(resolvePrimaryRole(["technician", "admin"])).toBe(ROLES.ADMIN);
  });

  it("admin wins over operator, technician, and pilot when all are present", () => {
    expect(
      resolvePrimaryRole(["pilot", "technician", "operator", "admin"])
    ).toBe(ROLES.ADMIN);
  });

  it("operator wins over technician when both are present", () => {
    expect(resolvePrimaryRole(["technician", "operator"])).toBe(ROLES.OPERATOR);
  });

  it("technician wins over pilot when both are present", () => {
    expect(resolvePrimaryRole(["pilot", "technician"])).toBe(ROLES.TECHNICIAN);
  });

  it("filters unknown roles silently and resolves from valid ones", () => {
    expect(resolvePrimaryRole(["ghost", "pilot"])).toBe(ROLES.PILOT);
  });

  it("returns null when only unknown roles are in the array", () => {
    expect(resolvePrimaryRole(["superadmin", "manager"])).toBeNull();
  });

  it("follows ALL_ROLES priority order (admin → operator → technician → pilot)", () => {
    expect(ALL_ROLES[0]).toBe(ROLES.ADMIN);
    expect(ALL_ROLES[1]).toBe(ROLES.OPERATOR);
    expect(ALL_ROLES[2]).toBe(ROLES.TECHNICIAN);
    expect(ALL_ROLES[3]).toBe(ROLES.PILOT);
  });
});

// ─── filterValidRoles ─────────────────────────────────────────────────────────

describe("filterValidRoles", () => {
  it("returns the input unchanged when all roles are valid", () => {
    const input = ["admin", "technician"];
    const result = filterValidRoles(input);
    expect(result).toEqual(expect.arrayContaining(["admin", "technician"]));
    expect(result).toHaveLength(2);
  });

  it("removes unknown roles from the array", () => {
    const result = filterValidRoles(["superadmin", "technician"]);
    expect(result).toContain("technician");
    expect(result).not.toContain("superadmin");
  });

  it("returns empty array for an empty input", () => {
    expect(filterValidRoles([])).toHaveLength(0);
  });

  it("returns empty array when all roles are unknown", () => {
    expect(filterValidRoles(["ghost", "wizard"])).toHaveLength(0);
  });

  it("preserves all four valid roles when all four are in the input", () => {
    const result = filterValidRoles(["admin", "operator", "technician", "pilot"]);
    expect(result).toHaveLength(4);
  });

  it("is case-sensitive (removes 'Admin' and 'ADMIN')", () => {
    expect(filterValidRoles(["Admin", "ADMIN", "admin"])).toEqual(["admin"]);
  });

  it("returns Role[] type (only valid role strings)", () => {
    const result: Role[] = filterValidRoles(["technician", "unknown"]);
    expect(result).toContain("technician");
  });
});

// ─── describeAllowedRoles ─────────────────────────────────────────────────────

describe("describeAllowedRoles", () => {
  it("returns a non-empty string", () => {
    expect(typeof describeAllowedRoles(OPERATIONS.CASE_READ)).toBe("string");
    expect(describeAllowedRoles(OPERATIONS.CASE_READ).length).toBeGreaterThan(0);
  });

  it("includes 'admin' for case:delete (admin-only)", () => {
    expect(describeAllowedRoles(OPERATIONS.CASE_DELETE)).toContain("admin");
  });

  it("returns only 'admin' for case:delete (admin-only)", () => {
    expect(describeAllowedRoles(OPERATIONS.CASE_DELETE)).toBe("admin");
  });

  it("includes all four roles for case:read (universal)", () => {
    const desc = describeAllowedRoles(OPERATIONS.CASE_READ);
    expect(desc).toContain("admin");
    expect(desc).toContain("operator");
    expect(desc).toContain("technician");
    expect(desc).toContain("pilot");
  });

  it("includes admin and operator for case:create (not technician or pilot)", () => {
    const desc = describeAllowedRoles(OPERATIONS.CASE_CREATE);
    expect(desc).toContain("admin");
    expect(desc).toContain("operator");
    expect(desc).not.toContain("technician");
    expect(desc).not.toContain("pilot");
  });

  it("roles are comma-separated", () => {
    const desc = describeAllowedRoles(OPERATIONS.CASE_READ);
    expect(desc).toContain(",");
  });

  it("returns consistent results across multiple calls (no side effects)", () => {
    const a = describeAllowedRoles(OPERATIONS.CASE_SHIP);
    const b = describeAllowedRoles(OPERATIONS.CASE_SHIP);
    expect(a).toBe(b);
  });
});

// ─── ROLE_LABELS ──────────────────────────────────────────────────────────────

describe("ROLE_LABELS", () => {
  it("contains an entry for every role in ROLES", () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_LABELS[role]).toBeDefined();
    }
  });

  it("admin label is 'Admin'", () => {
    expect(ROLE_LABELS[ROLES.ADMIN]).toBe("Admin");
  });

  it("operator label is 'Operator'", () => {
    expect(ROLE_LABELS[ROLES.OPERATOR]).toBe("Operator");
  });

  it("technician label is 'Technician'", () => {
    expect(ROLE_LABELS[ROLES.TECHNICIAN]).toBe("Technician");
  });

  it("pilot label is 'Pilot'", () => {
    expect(ROLE_LABELS[ROLES.PILOT]).toBe("Pilot");
  });

  it("all labels are non-empty strings", () => {
    for (const role of ALL_ROLES) {
      expect(typeof ROLE_LABELS[role]).toBe("string");
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
    }
  });

  it("has exactly 4 entries (one per role)", () => {
    expect(Object.keys(ROLE_LABELS)).toHaveLength(4);
  });
});

// ─── ROLE_DESCRIPTIONS ────────────────────────────────────────────────────────

describe("ROLE_DESCRIPTIONS", () => {
  it("contains an entry for every role in ROLES", () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_DESCRIPTIONS[role]).toBeDefined();
    }
  });

  it("all descriptions are non-empty strings", () => {
    for (const role of ALL_ROLES) {
      expect(typeof ROLE_DESCRIPTIONS[role]).toBe("string");
      expect(ROLE_DESCRIPTIONS[role].length).toBeGreaterThan(0);
    }
  });

  it("has exactly 4 entries (one per role)", () => {
    expect(Object.keys(ROLE_DESCRIPTIONS)).toHaveLength(4);
  });

  it("descriptions are all distinct", () => {
    const descs = Object.values(ROLE_DESCRIPTIONS);
    expect(new Set(descs).size).toBe(descs.length);
  });
});

// ─── Integration: src/lib/index.ts re-exports RBAC symbols ────────────────────

describe("RBAC symbols exported from src/lib/index.ts", () => {
  it("ROLES, OPERATIONS, hasPermission are importable from @/lib (index)", async () => {
    const lib = await import("../index");
    expect(lib.ROLES).toBeDefined();
    expect(lib.OPERATIONS).toBeDefined();
    expect(typeof lib.hasPermission).toBe("function");
    expect(typeof lib.rolesHavePermission).toBe("function");
    expect(typeof lib.filterValidRoles).toBe("function");
    expect(typeof lib.resolvePrimaryRole).toBe("function");
    expect(typeof lib.describeAllowedRoles).toBe("function");
    expect(lib.ROLE_LABELS).toBeDefined();
    expect(lib.ROLE_DESCRIPTIONS).toBeDefined();
  });
});
