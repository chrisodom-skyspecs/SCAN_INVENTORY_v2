/**
 * Unit tests for convex/rbac.ts
 *
 * Tests cover all pure (sync, no-DB) helper functions:
 *   - isValidRole
 *   - roleHasPermission
 *   - rolesHavePermission
 *   - getAllowedRolesForOperation
 *   - assertKindeIdProvided
 *   - getPermissionMatrix
 *
 * Also verifies the permission matrix invariants:
 *   - Admin has ALL permissions
 *   - Admin-only operations are not permitted for technician or pilot
 *   - Field operations are permitted for technician and not blocked for pilot
 *   - No role has an empty permission set
 *
 * Run with: npx vitest run src/lib/__tests__/rbac.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  ROLES,
  OPERATIONS,
  ALL_ROLES,
  isValidRole,
  roleHasPermission,
  rolesHavePermission,
  getAllowedRolesForOperation,
  assertKindeIdProvided,
  getPermissionMatrix,
  type Role,
  type Operation,
} from "../../../convex/rbac";

// ─── isValidRole ──────────────────────────────────────────────────────────────

describe("isValidRole", () => {
  it("returns true for 'admin'", () => {
    expect(isValidRole("admin")).toBe(true);
  });

  it("returns true for 'technician'", () => {
    expect(isValidRole("technician")).toBe(true);
  });

  it("returns true for 'pilot'", () => {
    expect(isValidRole("pilot")).toBe(true);
  });

  it("returns true for all values in ROLES", () => {
    for (const role of Object.values(ROLES)) {
      expect(isValidRole(role)).toBe(true);
    }
  });

  it("returns false for empty string", () => {
    expect(isValidRole("")).toBe(false);
  });

  it("returns false for unknown role 'superadmin'", () => {
    expect(isValidRole("superadmin")).toBe(false);
  });

  it("returns false for 'Admin' (case-sensitive)", () => {
    expect(isValidRole("Admin")).toBe(false);
  });

  it("returns false for 'TECHNICIAN' (uppercase)", () => {
    expect(isValidRole("TECHNICIAN")).toBe(false);
  });

  it("returns false for whitespace-only string", () => {
    expect(isValidRole("   ")).toBe(false);
  });

  it("returns false for null-like string 'null'", () => {
    expect(isValidRole("null")).toBe(false);
  });
});

// ─── roleHasPermission ────────────────────────────────────────────────────────

describe("roleHasPermission", () => {
  // Admin: has all permissions
  it("admin can case:read", () => {
    expect(roleHasPermission(ROLES.ADMIN, OPERATIONS.CASE_READ)).toBe(true);
  });

  it("admin can case:create", () => {
    expect(roleHasPermission(ROLES.ADMIN, OPERATIONS.CASE_CREATE)).toBe(true);
  });

  it("admin can case:delete", () => {
    expect(roleHasPermission(ROLES.ADMIN, OPERATIONS.CASE_DELETE)).toBe(true);
  });

  it("admin can template:create", () => {
    expect(roleHasPermission(ROLES.ADMIN, OPERATIONS.TEMPLATE_CREATE)).toBe(true);
  });

  it("admin can featureFlag:manage", () => {
    expect(roleHasPermission(ROLES.ADMIN, OPERATIONS.FEATURE_FLAG_MANAGE)).toBe(true);
  });

  it("admin can telemetry:read", () => {
    expect(roleHasPermission(ROLES.ADMIN, OPERATIONS.TELEMETRY_READ)).toBe(true);
  });

  it("admin can user:manage", () => {
    expect(roleHasPermission(ROLES.ADMIN, OPERATIONS.USER_MANAGE)).toBe(true);
  });

  it("admin can mission:create", () => {
    expect(roleHasPermission(ROLES.ADMIN, OPERATIONS.MISSION_CREATE)).toBe(true);
  });

  // Technician: field operations, no admin resources
  it("technician can case:read", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.CASE_READ)).toBe(true);
  });

  it("technician can case:status:change", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.CASE_STATUS_CHANGE)).toBe(true);
  });

  it("technician can case:inspection:start", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.INSPECTION_START)).toBe(true);
  });

  it("technician can case:inspection:update", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.INSPECTION_UPDATE_ITEM)).toBe(true);
  });

  it("technician can case:inspection:complete", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.INSPECTION_COMPLETE)).toBe(true);
  });

  it("technician can case:ship", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.CASE_SHIP)).toBe(true);
  });

  it("technician can case:custody:transfer", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.CUSTODY_TRANSFER)).toBe(true);
  });

  it("technician can template:apply", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.TEMPLATE_APPLY)).toBe(true);
  });

  it("technician can qrCode:generate", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.QR_CODE_GENERATE)).toBe(true);
  });

  // Technician: denied admin-only operations
  it("technician cannot case:create", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.CASE_CREATE)).toBe(false);
  });

  it("technician cannot case:delete", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.CASE_DELETE)).toBe(false);
  });

  it("technician cannot template:create", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.TEMPLATE_CREATE)).toBe(false);
  });

  it("technician cannot template:update", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.TEMPLATE_UPDATE)).toBe(false);
  });

  it("technician cannot template:delete", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.TEMPLATE_DELETE)).toBe(false);
  });

  it("technician cannot featureFlag:read", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.FEATURE_FLAG_READ)).toBe(false);
  });

  it("technician cannot featureFlag:manage", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.FEATURE_FLAG_MANAGE)).toBe(false);
  });

  it("technician cannot telemetry:read", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.TELEMETRY_READ)).toBe(false);
  });

  it("technician cannot user:manage", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.USER_MANAGE)).toBe(false);
  });

  it("technician cannot mission:create", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.MISSION_CREATE)).toBe(false);
  });

  it("technician cannot mission:update", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.MISSION_UPDATE)).toBe(false);
  });

  it("technician cannot mission:delete", () => {
    expect(roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.MISSION_DELETE)).toBe(false);
  });

  // Pilot: basic field operations
  it("pilot can case:read", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.CASE_READ)).toBe(true);
  });

  it("pilot can case:status:change", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.CASE_STATUS_CHANGE)).toBe(true);
  });

  it("pilot can case:damage:report", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.DAMAGE_REPORT)).toBe(true);
  });

  it("pilot can case:ship", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.CASE_SHIP)).toBe(true);
  });

  it("pilot can case:custody:transfer", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.CUSTODY_TRANSFER)).toBe(true);
  });

  it("pilot can map:read", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.MAP_READ)).toBe(true);
  });

  it("pilot can qrCode:read", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.QR_CODE_READ)).toBe(true);
  });

  // Pilot: denied technician+ operations
  it("pilot cannot case:inspection:start", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.INSPECTION_START)).toBe(false);
  });

  it("pilot cannot case:inspection:update (checklist item updates)", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.INSPECTION_UPDATE_ITEM)).toBe(false);
  });

  it("pilot cannot case:inspection:complete", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.INSPECTION_COMPLETE)).toBe(false);
  });

  it("pilot cannot template:apply", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.TEMPLATE_APPLY)).toBe(false);
  });

  it("pilot cannot qrCode:generate", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.QR_CODE_GENERATE)).toBe(false);
  });

  it("pilot cannot case:create", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.CASE_CREATE)).toBe(false);
  });

  it("pilot cannot case:delete", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.CASE_DELETE)).toBe(false);
  });

  it("pilot cannot featureFlag:manage", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.FEATURE_FLAG_MANAGE)).toBe(false);
  });

  it("pilot cannot telemetry:read", () => {
    expect(roleHasPermission(ROLES.PILOT, OPERATIONS.TELEMETRY_READ)).toBe(false);
  });
});

// ─── rolesHavePermission ──────────────────────────────────────────────────────

describe("rolesHavePermission", () => {
  it("returns true when single matching role is provided", () => {
    expect(rolesHavePermission(["technician"], OPERATIONS.CASE_SHIP)).toBe(true);
  });

  it("returns false when single non-matching role is provided", () => {
    expect(rolesHavePermission(["pilot"], OPERATIONS.INSPECTION_START)).toBe(false);
  });

  it("returns true when one role in an array has permission (union)", () => {
    expect(
      rolesHavePermission(["pilot", "admin"], OPERATIONS.FEATURE_FLAG_MANAGE)
    ).toBe(true);
  });

  it("returns false when no roles have the permission", () => {
    expect(
      rolesHavePermission(["pilot", "technician"], OPERATIONS.CASE_CREATE)
    ).toBe(false);
  });

  it("returns false for an empty roles array", () => {
    expect(rolesHavePermission([], OPERATIONS.CASE_READ)).toBe(false);
  });

  it("filters out unknown/invalid role strings", () => {
    // "superadmin" is not a valid role — only "pilot" is checked
    expect(
      rolesHavePermission(["superadmin", "pilot"], OPERATIONS.INSPECTION_START)
    ).toBe(false);
  });

  it("returns true even when unknown roles are mixed in, if a valid role qualifies", () => {
    expect(
      rolesHavePermission(["ghost", "technician"], OPERATIONS.INSPECTION_START)
    ).toBe(true);
  });

  it("returns false for an array of only unrecognized roles", () => {
    expect(
      rolesHavePermission(["ghost", "wizard"], OPERATIONS.CASE_READ)
    ).toBe(false);
  });

  it("handles duplicate roles correctly (no double-counting side effects)", () => {
    expect(
      rolesHavePermission(["technician", "technician"], OPERATIONS.CASE_SHIP)
    ).toBe(true);
  });
});

// ─── getAllowedRolesForOperation ──────────────────────────────────────────────

describe("getAllowedRolesForOperation", () => {
  it("returns all three roles for case:read (open to all)", () => {
    const allowed = getAllowedRolesForOperation(OPERATIONS.CASE_READ);
    expect(allowed).toContain(ROLES.ADMIN);
    expect(allowed).toContain(ROLES.TECHNICIAN);
    expect(allowed).toContain(ROLES.PILOT);
    expect(allowed).toHaveLength(3);
  });

  it("returns only admin for case:create (admin-only)", () => {
    const allowed = getAllowedRolesForOperation(OPERATIONS.CASE_CREATE);
    expect(allowed).toEqual([ROLES.ADMIN]);
  });

  it("returns only admin for case:delete (admin-only)", () => {
    const allowed = getAllowedRolesForOperation(OPERATIONS.CASE_DELETE);
    expect(allowed).toEqual([ROLES.ADMIN]);
  });

  it("returns only admin for featureFlag:manage (admin-only)", () => {
    const allowed = getAllowedRolesForOperation(OPERATIONS.FEATURE_FLAG_MANAGE);
    expect(allowed).toEqual([ROLES.ADMIN]);
  });

  it("returns only admin for featureFlag:read (admin-only)", () => {
    const allowed = getAllowedRolesForOperation(OPERATIONS.FEATURE_FLAG_READ);
    expect(allowed).toEqual([ROLES.ADMIN]);
  });

  it("returns only admin for user:manage (admin-only)", () => {
    const allowed = getAllowedRolesForOperation(OPERATIONS.USER_MANAGE);
    expect(allowed).toEqual([ROLES.ADMIN]);
  });

  it("returns only admin for telemetry:read (admin-only)", () => {
    const allowed = getAllowedRolesForOperation(OPERATIONS.TELEMETRY_READ);
    expect(allowed).toEqual([ROLES.ADMIN]);
  });

  it("returns admin and technician for case:inspection:start", () => {
    const allowed = getAllowedRolesForOperation(OPERATIONS.INSPECTION_START);
    expect(allowed).toContain(ROLES.ADMIN);
    expect(allowed).toContain(ROLES.TECHNICIAN);
    expect(allowed).not.toContain(ROLES.PILOT);
  });

  it("returns admin and technician for template:apply", () => {
    const allowed = getAllowedRolesForOperation(OPERATIONS.TEMPLATE_APPLY);
    expect(allowed).toContain(ROLES.ADMIN);
    expect(allowed).toContain(ROLES.TECHNICIAN);
    expect(allowed).not.toContain(ROLES.PILOT);
  });

  it("returns admin and technician for qrCode:generate", () => {
    const allowed = getAllowedRolesForOperation(OPERATIONS.QR_CODE_GENERATE);
    expect(allowed).toContain(ROLES.ADMIN);
    expect(allowed).toContain(ROLES.TECHNICIAN);
    expect(allowed).not.toContain(ROLES.PILOT);
  });

  it("returns all roles for case:ship (admin, technician, pilot)", () => {
    const allowed = getAllowedRolesForOperation(OPERATIONS.CASE_SHIP);
    expect(allowed).toContain(ROLES.ADMIN);
    expect(allowed).toContain(ROLES.TECHNICIAN);
    expect(allowed).toContain(ROLES.PILOT);
    expect(allowed).toHaveLength(3);
  });

  it("returns all roles for case:custody:transfer (admin, technician, pilot)", () => {
    const allowed = getAllowedRolesForOperation(OPERATIONS.CUSTODY_TRANSFER);
    expect(allowed).toContain(ROLES.ADMIN);
    expect(allowed).toContain(ROLES.TECHNICIAN);
    expect(allowed).toContain(ROLES.PILOT);
    expect(allowed).toHaveLength(3);
  });

  it("results are ordered with admin first (ALL_ROLES order)", () => {
    const allowed = getAllowedRolesForOperation(OPERATIONS.CASE_READ);
    expect(allowed[0]).toBe(ROLES.ADMIN);
  });

  it("returns a new array each call (not the same reference)", () => {
    const a = getAllowedRolesForOperation(OPERATIONS.CASE_READ);
    const b = getAllowedRolesForOperation(OPERATIONS.CASE_READ);
    expect(a).not.toBe(b);  // different array instances
    expect(a).toEqual(b);   // but same content
  });
});

// ─── assertKindeIdProvided ────────────────────────────────────────────────────

describe("assertKindeIdProvided", () => {
  it("does not throw for a valid kindeId", () => {
    expect(() => assertKindeIdProvided("kinde_01abc123")).not.toThrow();
  });

  it("throws for an empty string", () => {
    expect(() => assertKindeIdProvided("")).toThrow("[AUTH_REQUIRED]");
  });

  it("throws for a whitespace-only string", () => {
    expect(() => assertKindeIdProvided("   ")).toThrow("[AUTH_REQUIRED]");
  });

  it("throws for a string with only tabs and newlines", () => {
    expect(() => assertKindeIdProvided("\t\n")).toThrow("[AUTH_REQUIRED]");
  });

  it("does not throw for a short non-empty id", () => {
    expect(() => assertKindeIdProvided("x")).not.toThrow();
  });

  it("error message includes AUTH_REQUIRED prefix", () => {
    let thrown: Error | undefined;
    try {
      assertKindeIdProvided("");
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toMatch(/\[AUTH_REQUIRED\]/);
  });
});

// ─── getPermissionMatrix ──────────────────────────────────────────────────────

describe("getPermissionMatrix", () => {
  it("returns a non-null object", () => {
    expect(getPermissionMatrix()).toBeDefined();
    expect(typeof getPermissionMatrix()).toBe("object");
  });

  it("contains entries for all three roles", () => {
    const matrix = getPermissionMatrix();
    expect(Object.keys(matrix)).toContain(ROLES.ADMIN);
    expect(Object.keys(matrix)).toContain(ROLES.TECHNICIAN);
    expect(Object.keys(matrix)).toContain(ROLES.PILOT);
  });

  it("each role entry is an array", () => {
    const matrix = getPermissionMatrix();
    for (const role of ALL_ROLES) {
      expect(Array.isArray(matrix[role])).toBe(true);
    }
  });

  it("admin has the most operations of any role", () => {
    const matrix = getPermissionMatrix();
    const adminCount      = matrix[ROLES.ADMIN].length;
    const technicianCount = matrix[ROLES.TECHNICIAN].length;
    const pilotCount      = matrix[ROLES.PILOT].length;
    expect(adminCount).toBeGreaterThan(technicianCount);
    expect(adminCount).toBeGreaterThan(pilotCount);
  });

  it("technician has more operations than pilot", () => {
    const matrix = getPermissionMatrix();
    expect(matrix[ROLES.TECHNICIAN].length).toBeGreaterThan(matrix[ROLES.PILOT].length);
  });

  it("no role has an empty permission set", () => {
    const matrix = getPermissionMatrix();
    for (const role of ALL_ROLES) {
      expect(matrix[role].length).toBeGreaterThan(0);
    }
  });

  it("admin set contains all operations defined in OPERATIONS", () => {
    const matrix = getPermissionMatrix();
    const adminOps = new Set(matrix[ROLES.ADMIN]);
    for (const op of Object.values(OPERATIONS)) {
      expect(adminOps.has(op as Operation)).toBe(true);
    }
  });

  it("returns new arrays each call (no shared mutable state)", () => {
    const m1 = getPermissionMatrix();
    const m2 = getPermissionMatrix();
    expect(m1[ROLES.ADMIN]).not.toBe(m2[ROLES.ADMIN]);
  });
});

// ─── Permission matrix invariants ────────────────────────────────────────────

describe("permission matrix invariants", () => {
  // Admin-only operations — not in technician OR pilot
  const ADMIN_ONLY_OPS: Operation[] = [
    OPERATIONS.CASE_CREATE,
    OPERATIONS.CASE_DELETE,
    OPERATIONS.TEMPLATE_CREATE,
    OPERATIONS.TEMPLATE_UPDATE,
    OPERATIONS.TEMPLATE_DELETE,
    OPERATIONS.MISSION_CREATE,
    OPERATIONS.MISSION_UPDATE,
    OPERATIONS.MISSION_DELETE,
    OPERATIONS.USER_MANAGE,
    OPERATIONS.FEATURE_FLAG_READ,
    OPERATIONS.FEATURE_FLAG_MANAGE,
    OPERATIONS.TELEMETRY_READ,
  ];

  for (const op of ADMIN_ONLY_OPS) {
    it(`"${op}" is admin-only (not permitted for technician or pilot)`, () => {
      expect(roleHasPermission(ROLES.ADMIN, op)).toBe(true);
      expect(roleHasPermission(ROLES.TECHNICIAN, op)).toBe(false);
      expect(roleHasPermission(ROLES.PILOT, op)).toBe(false);
    });
  }

  // Operations that ALL three roles can perform
  const UNIVERSAL_OPS: Operation[] = [
    OPERATIONS.CASE_READ,
    OPERATIONS.CASE_LIST,
    OPERATIONS.CASE_STATUS_CHANGE,
    OPERATIONS.DAMAGE_REPORT,
    OPERATIONS.CASE_SHIP,
    OPERATIONS.SHIPPING_READ,
    OPERATIONS.CUSTODY_TRANSFER,
    OPERATIONS.CUSTODY_READ,
    OPERATIONS.TEMPLATE_READ,
    OPERATIONS.MISSION_READ,
    OPERATIONS.USER_READ,
    OPERATIONS.USER_LIST,
    OPERATIONS.NOTIFICATION_READ,
    OPERATIONS.NOTIFICATION_WRITE,
    OPERATIONS.TELEMETRY_WRITE,
    OPERATIONS.MAP_READ,
    OPERATIONS.QR_CODE_READ,
  ];

  for (const op of UNIVERSAL_OPS) {
    it(`"${op}" is permitted for all three roles`, () => {
      for (const role of ALL_ROLES) {
        expect(roleHasPermission(role, op)).toBe(true);
      }
    });
  }

  // Technician+ operations (admin + technician, NOT pilot)
  const TECHNICIAN_PLUS_OPS: Operation[] = [
    OPERATIONS.INSPECTION_START,
    OPERATIONS.INSPECTION_UPDATE_ITEM,
    OPERATIONS.INSPECTION_COMPLETE,
    OPERATIONS.TEMPLATE_APPLY,
    OPERATIONS.QR_CODE_GENERATE,
  ];

  for (const op of TECHNICIAN_PLUS_OPS) {
    it(`"${op}" is permitted for admin and technician but NOT pilot`, () => {
      expect(roleHasPermission(ROLES.ADMIN, op)).toBe(true);
      expect(roleHasPermission(ROLES.TECHNICIAN, op)).toBe(true);
      expect(roleHasPermission(ROLES.PILOT, op)).toBe(false);
    });
  }

  it("every operation in OPERATIONS is covered by at least one role", () => {
    for (const op of Object.values(OPERATIONS)) {
      const allowed = getAllowedRolesForOperation(op as Operation);
      expect(allowed.length).toBeGreaterThan(0);
    }
  });

  it("admin permission set is a superset of technician permission set", () => {
    const matrix = getPermissionMatrix();
    const adminOps = new Set(matrix[ROLES.ADMIN]);
    for (const op of matrix[ROLES.TECHNICIAN]) {
      expect(adminOps.has(op)).toBe(true);
    }
  });

  it("admin permission set is a superset of pilot permission set", () => {
    const matrix = getPermissionMatrix();
    const adminOps = new Set(matrix[ROLES.ADMIN]);
    for (const op of matrix[ROLES.PILOT]) {
      expect(adminOps.has(op)).toBe(true);
    }
  });
});

// ─── ROLES constant ───────────────────────────────────────────────────────────

describe("ROLES constant", () => {
  it("has exactly 3 entries", () => {
    expect(Object.keys(ROLES)).toHaveLength(3);
  });

  it("contains ADMIN, TECHNICIAN, PILOT keys", () => {
    expect(ROLES.ADMIN).toBe("admin");
    expect(ROLES.TECHNICIAN).toBe("technician");
    expect(ROLES.PILOT).toBe("pilot");
  });
});

// ─── ALL_ROLES constant ───────────────────────────────────────────────────────

describe("ALL_ROLES", () => {
  it("contains all roles defined in ROLES", () => {
    for (const role of Object.values(ROLES)) {
      expect(ALL_ROLES).toContain(role);
    }
  });

  it("admin is listed first (highest privilege)", () => {
    expect(ALL_ROLES[0]).toBe(ROLES.ADMIN);
  });

  it("has the same length as ROLES key count", () => {
    expect(ALL_ROLES).toHaveLength(Object.keys(ROLES).length);
  });

  it("has no duplicates", () => {
    expect(new Set(ALL_ROLES).size).toBe(ALL_ROLES.length);
  });
});

// ─── OPERATIONS constant ──────────────────────────────────────────────────────

describe("OPERATIONS constant", () => {
  it("has no duplicate values", () => {
    const values = Object.values(OPERATIONS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("all values are non-empty strings", () => {
    for (const op of Object.values(OPERATIONS)) {
      expect(typeof op).toBe("string");
      expect(op.length).toBeGreaterThan(0);
    }
  });

  it("all values follow <resource>:<verb> naming convention", () => {
    for (const op of Object.values(OPERATIONS)) {
      expect(op).toMatch(/^[a-zA-Z]+:[a-zA-Z:]+$/);
    }
  });
});
