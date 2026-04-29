/**
 * src/hooks/use-current-user.ts
 *
 * Unified current-user hook for the SCAN mobile app (and INVENTORY dashboard).
 *
 * Extends the base `useKindeUser` hook with role and permission information
 * derived from the Kinde JWT access token.  The access token's `roles` claim
 * is the same data written to the Convex `users` table on every login sync
 * (via `/api/auth/sync`), so the two sources stay in sync automatically.
 *
 * Role hierarchy (descending privilege):
 *   admin       — full system access
 *   technician  — full field operations (inspection, QR generation, etc.)
 *   pilot       — basic field operations (check-in, damage, ship, custody)
 *
 * Usage
 * ─────
 *   const { id, name, primaryRole, isTechnician, isPilot, can } = useCurrentUser();
 *
 *   // Conditionally render technician-only UI:
 *   {isTechnician && <InspectActionCard caseId={caseId} />}
 *
 *   // Guard a specific RBAC operation:
 *   {can(OPERATIONS.QR_CODE_GENERATE) && <AssociateQRCard caseId={caseId} />}
 *
 *   // Show a role badge:
 *   <span>{primaryRole ?? "unknown"}</span>
 *
 * Loading state
 * ─────────────
 * While Kinde is initialising, `isLoading` is true and all permission helpers
 * return false.  `roles` is an empty array and `primaryRole` is null.  Callers
 * should render a loading skeleton or defer action buttons until `!isLoading`.
 *
 * Relationship to useKindeUser
 * ─────────────────────────────
 * `useKindeUser` exposes identity fields (id, name, isLoading, isAuthenticated).
 * `useCurrentUser` composes those fields and adds role / permission context.
 * SCAN client components that need role gating should use `useCurrentUser`;
 * components that only need identity for mutation args should use `useKindeUser`.
 */

"use client";

import { useKindeBrowserClient } from "@kinde-oss/kinde-auth-nextjs";
import { useKindeUser } from "./use-kinde-user";
import {
  isValidRole,
  rolesHavePermission,
  ROLES,
  type Role,
  type Operation,
} from "../../convex/rbac";

// ─── Return type ─────────────────────────────────────────────────────────────

export interface CurrentUserState {
  /** Kinde user ID (sub claim) — written to technicianId, assigneeId, etc. */
  id: string;
  /** Human-readable display name — written to technicianName, assigneeName, etc. */
  name: string;

  /**
   * All SkySpecs roles the current user holds.
   * Derived from the Kinde JWT access token `roles` claim.
   * Empty array while loading or when the user has no recognised roles.
   */
  roles: Role[];

  /**
   * The single highest-privilege role held by the user.
   *
   * Resolution order: admin → technician → pilot → null
   *
   * Use this for role-labelled UI (e.g. a "Technician" badge or role header).
   * For permission-based gating, prefer `can(operation)` or the boolean helpers
   * (`isTechnician`, `isPilot`, `isAdmin`) which correctly handle multi-role users.
   */
  primaryRole: Role | null;

  // ─── Role boolean helpers ────────────────────────────────────────────────

  /** True when the user holds the `admin` role. */
  isAdmin: boolean;
  /**
   * True when the user holds the `technician` role (or `admin`, which is a
   * superset of technician permissions).
   */
  isTechnician: boolean;
  /**
   * True when the user holds the `pilot` role.
   * Note: `isTechnician` and `isPilot` can both be true if the user holds
   * both roles simultaneously.  Use `can()` for precise permission checks.
   */
  isPilot: boolean;

  // ─── Auth state ──────────────────────────────────────────────────────────

  /** True while the Kinde session is being fetched from the server. */
  isLoading: boolean;
  /** True when the user has a valid Kinde session. */
  isAuthenticated: boolean;

  // ─── Permission helper ───────────────────────────────────────────────────

  /**
   * Check whether the current user is permitted to perform `operation`.
   *
   * Returns `false` while loading or when the user holds no valid roles.
   * Handles multi-role users by checking the union of all roles.
   *
   * @param operation  A value from the `OPERATIONS` constant (convex/rbac.ts).
   *
   * @example
   *   {can(OPERATIONS.QR_CODE_GENERATE) && <AssociateQRCard caseId={caseId} />}
   *   {can(OPERATIONS.INSPECTION_START) && <InspectActionCard caseId={caseId} />}
   */
  can: (operation: Operation) => boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the current Kinde user identity **plus** their SkySpecs RBAC roles
 * and a `can()` permission helper.
 *
 * This is the primary hook for SCAN client components that need to gate UI
 * based on role (technician vs pilot vs admin).
 *
 * @returns Full user state including roles, primaryRole, boolean helpers, and can().
 */
export function useCurrentUser(): CurrentUserState {
  // ── Identity (id, name, auth state) ────────────────────────────────────
  const { id, name, isLoading, isAuthenticated } = useKindeUser({
    fallbackName: "Field Technician",
  });

  // ── Roles from Kinde JWT access token ────────────────────────────────────
  // `accessToken.roles` is populated by Kinde from the roles configured in
  // the Kinde dashboard (Settings → Roles).  These are the same values that
  // get written to the Convex `users` table on login sync — the two are
  // always in sync after the first /api/auth/sync call completes.
  const { accessToken } = useKindeBrowserClient();
  const rawRoles = accessToken?.roles ?? [];
  // Filter to only recognised SkySpecs role keys (admin, technician, pilot)
  const roles: Role[] = rawRoles
    .map((r) => r.key)
    .filter(isValidRole) as Role[];

  // ── Primary role (highest privilege) ──────────────────────────────────────
  // admin supersedes technician which supersedes pilot.
  const primaryRole: Role | null = roles.includes(ROLES.ADMIN)
    ? ROLES.ADMIN
    : roles.includes(ROLES.TECHNICIAN)
    ? ROLES.TECHNICIAN
    : roles.includes(ROLES.PILOT)
    ? ROLES.PILOT
    : null;

  // ── Boolean helpers ───────────────────────────────────────────────────────
  const isAdmin      = roles.includes(ROLES.ADMIN);
  // Admins have a strict superset of technician permissions, so treat them as
  // technicians too for `isTechnician`-gated UI.
  const isTechnician = roles.includes(ROLES.TECHNICIAN) || isAdmin;
  const isPilot      = roles.includes(ROLES.PILOT);

  // ── Permission helper ─────────────────────────────────────────────────────
  const can = (operation: Operation): boolean => {
    if (isLoading || roles.length === 0) return false;
    return rolesHavePermission(roles, operation);
  };

  return {
    id,
    name,
    roles,
    primaryRole,
    isAdmin,
    isTechnician,
    isPilot,
    isLoading,
    isAuthenticated,
    can,
  };
}
