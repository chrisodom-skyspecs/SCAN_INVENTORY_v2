/**
 * src/lib/rbac.ts
 *
 * Shared client-side RBAC utilities for the SkySpecs INVENTORY dashboard and
 * SCAN mobile app.
 *
 * This module is the single import point for all RBAC symbols in client-side
 * code.  It re-exports the canonical constants and pure helpers from the
 * `convex/rbac` module (the server-side source of truth) and augments them with
 * a small set of client-oriented convenience utilities.
 *
 * Why this module exists
 * ──────────────────────
 * Both the INVENTORY dashboard and the SCAN mobile app need to:
 *   1. Check permissions in React components before rendering gated UI.
 *   2. Validate roles in server-side Next.js API route handlers.
 *   3. Construct user-facing error messages with `getAllowedRolesForOperation`.
 *   4. Pass ROLES / OPERATIONS constants to Convex mutation args.
 *
 * Rather than importing directly from `"../../convex/rbac"` (a relative path
 * that breaks if files are moved), both apps import from `"@/lib/rbac"`.  That
 * alias resolves via tsconfig `paths` to this file, which in turn imports from
 * the Convex module.  If the Convex module path changes, only this one file
 * needs updating.
 *
 * Usage
 * ─────
 *   // In any INVENTORY or SCAN component / route handler:
 *   import { ROLES, OPERATIONS, hasPermission } from "@/lib/rbac";
 *
 *   // Permission-gate a React button:
 *   const show = hasPermission(userRoles, OPERATIONS.QR_CODE_GENERATE);
 *
 *   // Role-guard a Next.js API route:
 *   if (!hasPermission(claims.roles, OPERATIONS.CASE_SHIP)) {
 *     return new Response("Forbidden", { status: 403 });
 *   }
 *
 *   // In Convex mutation args (no DB):
 *   if (!rolesHavePermission(user.roles, OPERATIONS.TEMPLATE_APPLY)) {
 *     throw new Error("[ACCESS_DENIED]");
 *   }
 *
 * Relationship to other modules
 * ─────────────────────────────
 *   convex/rbac.ts                 — canonical RBAC source of truth;
 *                                    contains async DB helpers (assertPermission,
 *                                    requireRole, etc.) that need a DatabaseReader.
 *                                    Import that file directly from Convex handlers.
 *
 *   src/lib/rbac.ts (this file)    — re-exports pure functions + convenience API
 *                                    for client/server Next.js code (no DB required).
 *
 *   src/hooks/use-current-user.ts  — React hook that wraps this module for
 *                                    components; exposes `can(operation)` and
 *                                    role boolean helpers (isAdmin, isTechnician…).
 *
 *   src/providers/user-identity-provider.tsx — React context provider that reads
 *                                    Kinde JWT and exposes roles via `useUserIdentity`.
 *
 * Note on Convex DB helpers
 * ─────────────────────────
 * The async DB helpers (`getUserRoles`, `checkPermission`, `assertPermission`,
 * `requireRole`, `requireAdmin`, `getAuthenticatedUser`) are NOT re-exported
 * here because they require a Convex `DatabaseReader` context.  They are only
 * meaningful inside Convex query/mutation handlers and would fail at runtime in
 * a Next.js route handler or React component.  Import them directly from
 * `"../../convex/rbac"` in Convex handler files.
 */

// ─── Re-export canonical RBAC constants and types ─────────────────────────────
//
// These are the exact same values defined in convex/rbac.ts — this module is a
// thin re-export layer, not a fork.  There is one source of truth.

export {
  // Role constants
  ROLES,
  ALL_ROLES,

  // Operation constants
  OPERATIONS,

  // Validation
  isValidRole,

  // Pure permission helpers (no DB)
  roleHasPermission,
  rolesHavePermission,
  getAllowedRolesForOperation,

  // Kinde ID guard (pure, no DB)
  assertKindeIdProvided,

  // Permission matrix snapshot (for admin UI / docs)
  getPermissionMatrix,
} from "../../convex/rbac";

export type {
  Role,
  Operation,
} from "../../convex/rbac";

// ─── Client-side convenience utilities ───────────────────────────────────────
//
// Thin wrappers over the re-exported Convex helpers with client-friendly names.
// These add no logic — they exist purely for call-site readability.

import {
  rolesHavePermission,
  roleHasPermission,
  ROLES,
  ALL_ROLES,
  isValidRole,
  getAllowedRolesForOperation,
} from "../../convex/rbac";

import type { Role, Operation } from "../../convex/rbac";

/**
 * Returns `true` if any of the provided `roles` is permitted to perform
 * `operation`.
 *
 * This is the primary permission-check API for client-side code (React
 * components, Next.js API routes, middleware).  It is a thin alias for
 * `rolesHavePermission` with a more intuitive name at the call site.
 *
 * Unknown / invalid role strings are silently ignored — only recognized
 * SkySpecs role keys (admin, operator, technician, pilot) contribute.
 *
 * Returns `false` for empty arrays, unknown roles, or operations not in
 * `OPERATIONS`.
 *
 * Pure function — no async, no DB access.
 *
 * @param roles      Array of role strings from the Kinde JWT / Convex users row.
 * @param operation  A value from the `OPERATIONS` constant.
 *
 * @example
 *   // React component gate:
 *   const { roles } = useUserIdentity();
 *   {hasPermission(roles, OPERATIONS.QR_CODE_GENERATE) && <AssociateQRCard />}
 *
 * @example
 *   // Next.js API route guard:
 *   if (!hasPermission(claims.roles, OPERATIONS.CASE_SHIP)) {
 *     return new Response("Forbidden", { status: 403 });
 *   }
 */
export function hasPermission(roles: string[], operation: Operation): boolean {
  return rolesHavePermission(roles, operation);
}

/**
 * Returns `true` if a single `role` is permitted to perform `operation`.
 *
 * Use `hasPermission` when you have a roles array (the common case from Kinde
 * JWT).  Use `roleCanPerform` when you have a single validated role and want
 * a clear, explicit predicate at the call site.
 *
 * Pure function — no async, no DB access.
 *
 * @param role       A single validated SkySpecs role key.
 * @param operation  A value from the `OPERATIONS` constant.
 *
 * @example
 *   roleCanPerform(ROLES.TECHNICIAN, OPERATIONS.INSPECTION_START) // true
 *   roleCanPerform(ROLES.PILOT,      OPERATIONS.INSPECTION_START) // false
 */
export function roleCanPerform(role: Role, operation: Operation): boolean {
  return roleHasPermission(role, operation);
}

/**
 * Resolve the single highest-privilege role from a roles array.
 *
 * Resolution order (descending privilege): admin → operator → technician → pilot
 *
 * Returns `null` when the array is empty or contains only unrecognized roles.
 *
 * Use this for role-labelled UI (e.g. a "Technician" badge or "Role" column in
 * a user list).  For permission-based gating, prefer `hasPermission()` which
 * correctly handles multi-role users.
 *
 * Pure function — no async, no DB access.
 *
 * @param roles  Array of role strings (may include unknown entries).
 *
 * @example
 *   resolvePrimaryRole(["pilot", "technician"])  // → "technician"
 *   resolvePrimaryRole(["admin", "pilot"])        // → "admin"
 *   resolvePrimaryRole(["ghost"])                 // → null
 *   resolvePrimaryRole([])                        // → null
 */
export function resolvePrimaryRole(roles: string[]): Role | null {
  // ALL_ROLES is ordered admin → operator → technician → pilot
  for (const role of ALL_ROLES) {
    if (roles.includes(role)) return role;
  }
  return null;
}

/**
 * Filter a raw roles array (e.g. from a Kinde JWT) to only recognized
 * SkySpecs role strings.
 *
 * Use this before storing roles or passing them to permission checks to guard
 * against stale or unexpected values from the JWT.
 *
 * Pure function — no async, no DB access.
 *
 * @param rawRoles  Any array of strings (may include unknown role keys).
 *
 * @example
 *   filterValidRoles(["technician", "superadmin"])  // → ["technician"]
 *   filterValidRoles(["admin", "ghost"])             // → ["admin"]
 *   filterValidRoles([])                             // → []
 */
export function filterValidRoles(rawRoles: string[]): Role[] {
  return rawRoles.filter(isValidRole);
}

/**
 * Build a human-readable description of which roles may perform `operation`.
 *
 * Returns a comma-separated string of role names, ordered from highest to
 * lowest privilege, for use in error messages, tooltips, and audit logs.
 *
 * Pure function — no async, no DB access.
 *
 * @param operation  A value from the `OPERATIONS` constant.
 *
 * @example
 *   describeAllowedRoles(OPERATIONS.CASE_CREATE)
 *   // → "admin, operator"
 *
 *   describeAllowedRoles(OPERATIONS.CASE_READ)
 *   // → "admin, operator, technician, pilot"
 *
 *   describeAllowedRoles(OPERATIONS.CASE_DELETE)
 *   // → "admin"
 */
export function describeAllowedRoles(operation: Operation): string {
  return getAllowedRolesForOperation(operation).join(", ");
}

// ─── Role display labels ───────────────────────────────────────────────────────

/**
 * Human-readable display labels for each SkySpecs role.
 *
 * Use these in admin UI tables, user profile headers, and audit log displays
 * instead of the raw role key strings.
 *
 * @example
 *   ROLE_LABELS[ROLES.ADMIN]       // → "Admin"
 *   ROLE_LABELS[ROLES.OPERATOR]    // → "Operator"
 *   ROLE_LABELS[ROLES.TECHNICIAN]  // → "Technician"
 *   ROLE_LABELS[ROLES.PILOT]       // → "Pilot"
 */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  [ROLES.ADMIN]:      "Admin",
  [ROLES.OPERATOR]:   "Operator",
  [ROLES.TECHNICIAN]: "Technician",
  [ROLES.PILOT]:      "Pilot",
} as const;

/**
 * Short one-line descriptions of each SkySpecs role for use in admin UI
 * tooltips, onboarding flows, and role assignment confirmation dialogs.
 *
 * @example
 *   ROLE_DESCRIPTIONS[ROLES.TECHNICIAN]
 *   // → "Full field operations: inspection, QR generation, FedEx shipments,
 *   //    custody handoffs. Cannot create cases or manage admin resources."
 */
export const ROLE_DESCRIPTIONS: Readonly<Record<Role, string>> = {
  [ROLES.ADMIN]:
    "Full system access: case/template/mission management, user management, feature flags, telemetry.",
  [ROLES.OPERATOR]:
    "Operations team: create and manage cases, missions, and templates. Read-only feature flags and telemetry. No deletion.",
  [ROLES.TECHNICIAN]:
    "Full field operations: inspection, QR generation, FedEx shipments, custody handoffs. Cannot create cases or manage admin resources.",
  [ROLES.PILOT]:
    "Basic field operations: check-ins, damage reports, FedEx shipments, custody handoffs. Cannot run inspections or generate QR codes.",
} as const;
