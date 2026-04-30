/**
 * convex/lib/org_role_policy.ts
 *
 * Pure (no Convex runtime dependency) helpers for organization membership
 * role-policy enforcement.
 *
 * Extracted into a standalone module so that:
 *   1. Unit tests can import and assert the policy without mocking the Convex
 *      DB context or the generated server types.
 *   2. The same constraint logic is usable by both the `assignUserToOrg`
 *      mutation (convex/organizations.ts) and any future bulk-import validator,
 *      CSV upload handler, or API route that needs to pre-validate membership
 *      assignments before sending them to Convex.
 *
 * IMPORTANT: These helpers are synchronous pure functions — they do NOT perform
 * any database reads.  The caller is responsible for loading the relevant user
 * and organization records before invoking them.
 */

/**
 * System roles that may NOT appear inside contractor-type organizations.
 *
 * Design rationale
 * ─────────────────
 * "admin" and "operator" represent SkySpecs internal back-office / management
 * personnel.  These roles carry system-wide permissions (case creation, mission
 * management, feature-flag access, user management) that are only appropriate
 * for direct SkySpecs employees, and must not be accessible via external
 * contractor org membership.
 *
 * Field roles ("technician", "pilot") are explicitly ALLOWED in contractor
 * orgs because external contractors routinely perform the same on-site work
 * (inspection, shipping, custody handoffs) as internal field staff.
 *
 * The set is deliberately declared separately from the ROLES constant in
 * convex/rbac.ts so that the policy can be updated (e.g., to add a future
 * "manager" role) without touching the permission matrix, and vice versa.
 */
export const CONTRACTOR_FORBIDDEN_ROLES: ReadonlySet<string> = new Set([
  "admin",
  "operator",
]);

/**
 * Roles that are permitted in contractor-type organizations.
 *
 * Derived from the full role set minus `CONTRACTOR_FORBIDDEN_ROLES`.
 * Provided here for documentation purposes and for use in error messages /
 * admin UI hints — not used as a hard-coded allow-list in validation (the
 * allow-list is the inverse of CONTRACTOR_FORBIDDEN_ROLES to avoid having to
 * update two constants when a new role is added).
 */
export const CONTRACTOR_ALLOWED_ROLES: ReadonlySet<string> = new Set([
  "technician",
  "pilot",
]);

/**
 * Result returned by `validateContractorOrgAssignment`.
 *
 * `valid: true`  — the assignment is permitted; proceed.
 * `valid: false` — the assignment is blocked; `forbiddenRoles` contains the
 *                  offending role keys found in the user's role array.
 */
export type ContractorValidationResult =
  | { valid: true }
  | { valid: false; forbiddenRoles: string[] };

/**
 * Validate whether a user may be assigned to a contractor-type organization.
 *
 * Returns `{ valid: true }` when the assignment is permitted (either the org
 * is not a contractor org, or the user holds only field roles).
 *
 * Returns `{ valid: false, forbiddenRoles: [...] }` when the org is a
 * contractor org and the user holds one or more internal-only roles.
 *
 * @param orgType      The `orgType` of the target organization ("internal" | "contractor").
 * @param userRoles    The `roles` array from the user's `users` row (may contain
 *                     unknown/stale entries; this function filters safely).
 *
 * @example
 *   // Contractor org, user has "admin" role — BLOCKED
 *   validateContractorOrgAssignment("contractor", ["admin"])
 *   // → { valid: false, forbiddenRoles: ["admin"] }
 *
 *   // Contractor org, user has "technician" role — ALLOWED
 *   validateContractorOrgAssignment("contractor", ["technician"])
 *   // → { valid: true }
 *
 *   // Internal org, user has "admin" role — ALLOWED (no restriction on internal)
 *   validateContractorOrgAssignment("internal", ["admin"])
 *   // → { valid: true }
 *
 *   // Contractor org, user has both "admin" and "technician" — BLOCKED
 *   validateContractorOrgAssignment("contractor", ["admin", "technician"])
 *   // → { valid: false, forbiddenRoles: ["admin"] }
 */
export function validateContractorOrgAssignment(
  orgType: string,
  userRoles: string[]
): ContractorValidationResult {
  // The restriction only applies to contractor-type organizations.
  if (orgType !== "contractor") {
    return { valid: true };
  }

  const forbiddenRoles = userRoles.filter((r) =>
    CONTRACTOR_FORBIDDEN_ROLES.has(r)
  );

  if (forbiddenRoles.length > 0) {
    return { valid: false, forbiddenRoles };
  }

  return { valid: true };
}

/**
 * Build a human-readable error message for a failed contractor assignment.
 *
 * Intended for use in mutation error strings and admin UI "why was this blocked?"
 * tooltips.  Keeps the message format consistent across all call sites.
 *
 * @param userName      Display name of the user (e.g., "Alice Johnson").
 * @param userEmail     Email of the user for disambiguation.
 * @param orgName       Display name of the contractor organization.
 * @param forbiddenRoles Array of role keys that triggered the violation.
 */
export function contractorRoleViolationMessage(
  userName: string,
  userEmail: string,
  orgName: string,
  forbiddenRoles: string[]
): string {
  return (
    `[CONTRACTOR_ROLE_VIOLATION] Cannot assign user "${userName}" ` +
    `(${userEmail}) to contractor organization "${orgName}". ` +
    `User holds internal-only system role(s): [${forbiddenRoles.join(", ")}]. ` +
    `Contractor organizations may only contain users with field roles ` +
    `(technician, pilot). ` +
    `To assign this user, either change their system role to a field role ` +
    `or assign them to an internal organization instead.`
  );
}
