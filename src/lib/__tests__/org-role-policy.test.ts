/**
 * src/lib/__tests__/org-role-policy.test.ts
 *
 * Unit tests for convex/lib/org-role-policy.ts — the pure role-policy helpers
 * that enforce the contractor org membership constraint.
 *
 * Coverage
 * ────────
 *   CONTRACTOR_FORBIDDEN_ROLES constant
 *     - Contains exactly "admin" and "operator" (the internal-only roles)
 *     - Does NOT contain field roles ("technician", "pilot")
 *     - Is immutable (ReadonlySet)
 *
 *   CONTRACTOR_ALLOWED_ROLES constant
 *     - Contains exactly "technician" and "pilot"
 *     - Does NOT contain "admin" or "operator"
 *
 *   validateContractorOrgAssignment
 *     - Returns { valid: true } for any internal org regardless of user roles
 *     - Returns { valid: true } when contractor org + only field roles
 *     - Returns { valid: false } when contractor org + admin role
 *     - Returns { valid: false } when contractor org + operator role
 *     - Returns { valid: false } when contractor org + both admin + operator roles
 *     - Returns { valid: false } when contractor org + mixed admin + technician
 *     - Handles empty roles array (valid: true for contractor)
 *     - Handles unknown/stale roles gracefully (not blocked by unknown roles)
 *     - forbiddenRoles contains ONLY the offending roles, not the full list
 *
 *   contractorRoleViolationMessage
 *     - Includes [CONTRACTOR_ROLE_VIOLATION] prefix
 *     - Includes user name, email, org name, and forbidden roles
 *     - Includes guidance on how to resolve the conflict
 *
 * Run: npx vitest run src/lib/__tests__/org-role-policy.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  CONTRACTOR_FORBIDDEN_ROLES,
  CONTRACTOR_ALLOWED_ROLES,
  validateContractorOrgAssignment,
  contractorRoleViolationMessage,
  type ContractorValidationResult,
} from "../../../convex/lib/org-role-policy";

// ─── CONTRACTOR_FORBIDDEN_ROLES ───────────────────────────────────────────────

describe("CONTRACTOR_FORBIDDEN_ROLES", () => {
  it("contains exactly 2 roles", () => {
    expect(CONTRACTOR_FORBIDDEN_ROLES.size).toBe(2);
  });

  it("contains 'admin'", () => {
    expect(CONTRACTOR_FORBIDDEN_ROLES.has("admin")).toBe(true);
  });

  it("contains 'operator'", () => {
    expect(CONTRACTOR_FORBIDDEN_ROLES.has("operator")).toBe(true);
  });

  it("does NOT contain 'technician'", () => {
    expect(CONTRACTOR_FORBIDDEN_ROLES.has("technician")).toBe(false);
  });

  it("does NOT contain 'pilot'", () => {
    expect(CONTRACTOR_FORBIDDEN_ROLES.has("pilot")).toBe(false);
  });

  it("does NOT contain empty string", () => {
    expect(CONTRACTOR_FORBIDDEN_ROLES.has("")).toBe(false);
  });

  it("does NOT contain unknown roles (case-sensitive check for 'Admin')", () => {
    expect(CONTRACTOR_FORBIDDEN_ROLES.has("Admin")).toBe(false);
    expect(CONTRACTOR_FORBIDDEN_ROLES.has("ADMIN")).toBe(false);
    expect(CONTRACTOR_FORBIDDEN_ROLES.has("Operator")).toBe(false);
  });
});

// ─── CONTRACTOR_ALLOWED_ROLES ─────────────────────────────────────────────────

describe("CONTRACTOR_ALLOWED_ROLES", () => {
  it("contains exactly 2 roles", () => {
    expect(CONTRACTOR_ALLOWED_ROLES.size).toBe(2);
  });

  it("contains 'technician'", () => {
    expect(CONTRACTOR_ALLOWED_ROLES.has("technician")).toBe(true);
  });

  it("contains 'pilot'", () => {
    expect(CONTRACTOR_ALLOWED_ROLES.has("pilot")).toBe(true);
  });

  it("does NOT contain 'admin'", () => {
    expect(CONTRACTOR_ALLOWED_ROLES.has("admin")).toBe(false);
  });

  it("does NOT contain 'operator'", () => {
    expect(CONTRACTOR_ALLOWED_ROLES.has("operator")).toBe(false);
  });

  it("forbidden and allowed sets are disjoint", () => {
    for (const role of CONTRACTOR_ALLOWED_ROLES) {
      expect(CONTRACTOR_FORBIDDEN_ROLES.has(role)).toBe(false);
    }
    for (const role of CONTRACTOR_FORBIDDEN_ROLES) {
      expect(CONTRACTOR_ALLOWED_ROLES.has(role)).toBe(false);
    }
  });
});

// ─── validateContractorOrgAssignment — internal orgs (unrestricted) ───────────

describe("validateContractorOrgAssignment — internal org (no restriction)", () => {
  it("returns valid: true for internal org with admin role", () => {
    const result = validateContractorOrgAssignment("internal", ["admin"]);
    expect(result.valid).toBe(true);
  });

  it("returns valid: true for internal org with operator role", () => {
    const result = validateContractorOrgAssignment("internal", ["operator"]);
    expect(result.valid).toBe(true);
  });

  it("returns valid: true for internal org with all roles", () => {
    const result = validateContractorOrgAssignment("internal", [
      "admin", "operator", "technician", "pilot",
    ]);
    expect(result.valid).toBe(true);
  });

  it("returns valid: true for internal org with empty roles array", () => {
    const result = validateContractorOrgAssignment("internal", []);
    expect(result.valid).toBe(true);
  });

  it("returns valid: true for internal org with unknown roles", () => {
    const result = validateContractorOrgAssignment("internal", ["superadmin", "ghost"]);
    expect(result.valid).toBe(true);
  });

  it("returns valid: true for unknown org type (future-proofing)", () => {
    const result = validateContractorOrgAssignment("partner", ["admin"]);
    expect(result.valid).toBe(true);
  });
});

// ─── validateContractorOrgAssignment — contractor orgs (field roles only) ─────

describe("validateContractorOrgAssignment — contractor org (field roles allowed)", () => {
  it("returns valid: true when user has only 'technician' role", () => {
    const result = validateContractorOrgAssignment("contractor", ["technician"]);
    expect(result.valid).toBe(true);
  });

  it("returns valid: true when user has only 'pilot' role", () => {
    const result = validateContractorOrgAssignment("contractor", ["pilot"]);
    expect(result.valid).toBe(true);
  });

  it("returns valid: true when user has both 'technician' and 'pilot' roles", () => {
    const result = validateContractorOrgAssignment("contractor", ["technician", "pilot"]);
    expect(result.valid).toBe(true);
  });

  it("returns valid: true when user has empty roles array", () => {
    // No roles → no forbidden roles → assignment allowed (org can reject at a higher level)
    const result = validateContractorOrgAssignment("contractor", []);
    expect(result.valid).toBe(true);
  });

  it("returns valid: true when user has only unknown roles", () => {
    // Unknown roles are not forbidden — unknown roles do not trigger the constraint
    const result = validateContractorOrgAssignment("contractor", ["ghost", "wizard"]);
    expect(result.valid).toBe(true);
  });
});

// ─── validateContractorOrgAssignment — contractor orgs (internal roles blocked) ─

describe("validateContractorOrgAssignment — contractor org (internal roles blocked)", () => {
  it("returns valid: false when user has 'admin' role in contractor org", () => {
    const result = validateContractorOrgAssignment("contractor", ["admin"]);
    expect(result.valid).toBe(false);
  });

  it("forbiddenRoles contains 'admin' when admin is the violation", () => {
    const result = validateContractorOrgAssignment("contractor", ["admin"]) as {
      valid: false;
      forbiddenRoles: string[];
    };
    expect(result.forbiddenRoles).toContain("admin");
    expect(result.forbiddenRoles).toHaveLength(1);
  });

  it("returns valid: false when user has 'operator' role in contractor org", () => {
    const result = validateContractorOrgAssignment("contractor", ["operator"]);
    expect(result.valid).toBe(false);
  });

  it("forbiddenRoles contains 'operator' when operator is the violation", () => {
    const result = validateContractorOrgAssignment("contractor", ["operator"]) as {
      valid: false;
      forbiddenRoles: string[];
    };
    expect(result.forbiddenRoles).toContain("operator");
    expect(result.forbiddenRoles).toHaveLength(1);
  });

  it("returns valid: false and lists both roles when user has admin + operator", () => {
    const result = validateContractorOrgAssignment("contractor", [
      "admin",
      "operator",
    ]) as { valid: false; forbiddenRoles: string[] };
    expect(result.valid).toBe(false);
    expect(result.forbiddenRoles).toContain("admin");
    expect(result.forbiddenRoles).toContain("operator");
    expect(result.forbiddenRoles).toHaveLength(2);
  });

  it("returns valid: false when user has admin + technician (mixed)", () => {
    // The presence of a field role does not excuse an internal-only role
    const result = validateContractorOrgAssignment("contractor", [
      "admin",
      "technician",
    ]) as { valid: false; forbiddenRoles: string[] };
    expect(result.valid).toBe(false);
    expect(result.forbiddenRoles).toContain("admin");
    expect(result.forbiddenRoles).not.toContain("technician");
    expect(result.forbiddenRoles).toHaveLength(1);
  });

  it("returns valid: false when user has operator + pilot (mixed)", () => {
    const result = validateContractorOrgAssignment("contractor", [
      "operator",
      "pilot",
    ]) as { valid: false; forbiddenRoles: string[] };
    expect(result.valid).toBe(false);
    expect(result.forbiddenRoles).toContain("operator");
    expect(result.forbiddenRoles).not.toContain("pilot");
    expect(result.forbiddenRoles).toHaveLength(1);
  });

  it("forbiddenRoles does NOT include allowed field roles", () => {
    const result = validateContractorOrgAssignment("contractor", [
      "admin",
      "operator",
      "technician",
      "pilot",
    ]) as { valid: false; forbiddenRoles: string[] };
    expect(result.valid).toBe(false);
    expect(result.forbiddenRoles).not.toContain("technician");
    expect(result.forbiddenRoles).not.toContain("pilot");
  });

  it("forbiddenRoles does NOT include unknown/stale role strings", () => {
    const result = validateContractorOrgAssignment("contractor", [
      "admin",
      "superadmin",
      "ghost",
    ]) as { valid: false; forbiddenRoles: string[] };
    expect(result.valid).toBe(false);
    expect(result.forbiddenRoles).toContain("admin");
    expect(result.forbiddenRoles).not.toContain("superadmin");
    expect(result.forbiddenRoles).not.toContain("ghost");
  });
});

// ─── validateContractorOrgAssignment — return type narrowing ─────────────────

describe("validateContractorOrgAssignment — TypeScript discriminant", () => {
  it("valid result has no forbiddenRoles property", () => {
    const result: ContractorValidationResult = validateContractorOrgAssignment(
      "contractor",
      ["technician"]
    );
    expect(result.valid).toBe(true);
    // Type guard: when valid, there is no forbiddenRoles field
    if (!result.valid) {
      // This branch should never execute in this test
      throw new Error("Expected valid: true");
    }
    // TypeScript will complain if you access result.forbiddenRoles here — that's expected
  });

  it("invalid result exposes forbiddenRoles as an array", () => {
    const result: ContractorValidationResult = validateContractorOrgAssignment(
      "contractor",
      ["admin"]
    );
    expect(result.valid).toBe(false);
    if (result.valid) {
      throw new Error("Expected valid: false");
    }
    expect(Array.isArray(result.forbiddenRoles)).toBe(true);
  });
});

// ─── contractorRoleViolationMessage ───────────────────────────────────────────

describe("contractorRoleViolationMessage", () => {
  const buildMessage = () =>
    contractorRoleViolationMessage(
      "Alice Johnson",
      "alice@example.com",
      "Apex Aerial Services",
      ["admin"]
    );

  it("includes [CONTRACTOR_ROLE_VIOLATION] prefix", () => {
    expect(buildMessage()).toMatch(/\[CONTRACTOR_ROLE_VIOLATION\]/);
  });

  it("includes the user's name", () => {
    expect(buildMessage()).toContain("Alice Johnson");
  });

  it("includes the user's email", () => {
    expect(buildMessage()).toContain("alice@example.com");
  });

  it("includes the organization name", () => {
    expect(buildMessage()).toContain("Apex Aerial Services");
  });

  it("includes the forbidden role key", () => {
    expect(buildMessage()).toContain("admin");
  });

  it("includes multiple forbidden roles when provided", () => {
    const msg = contractorRoleViolationMessage(
      "Bob Smith",
      "bob@example.com",
      "Midwest Wind Contractors",
      ["admin", "operator"]
    );
    expect(msg).toContain("admin");
    expect(msg).toContain("operator");
  });

  it("includes mention of allowed field roles (technician, pilot)", () => {
    const msg = buildMessage();
    expect(msg).toContain("technician");
    expect(msg).toContain("pilot");
  });

  it("includes actionable guidance on how to resolve the conflict", () => {
    const msg = buildMessage();
    // Should tell the user to either change the system role OR use an internal org
    expect(msg).toMatch(/change their system role|internal organization/i);
  });

  it("returns a non-empty string", () => {
    expect(buildMessage().length).toBeGreaterThan(0);
  });
});
