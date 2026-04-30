/**
 * src/types/user.ts
 *
 * TypeScript types for User, UserRole, and UserStatus.
 *
 * These types mirror the Convex schema definitions in convex/schema.ts and the
 * ROLES constant in convex/rbac.ts.  All three files must be kept in sync:
 *   - convex/schema.ts         userRole / userStatus validators
 *   - convex/rbac.ts           ROLES constant + Role type
 *   - src/types/user.ts        UserRole / UserStatus / User (this file)
 */

// ─── Role ─────────────────────────────────────────────────────────────────────

/**
 * System-wide user role enum values.
 *
 * Ordered from highest to lowest privilege:
 *   admin       — full system access; manages cases, templates, missions,
 *                 feature flags, and users; the only role that can delete
 *                 resources or toggle feature flags.
 *   operator    — operations team / back-office; creates and manages cases,
 *                 missions, and templates; reads feature flags and telemetry;
 *                 cannot delete resources, manage users, or toggle feature flags.
 *   technician  — primary field operator; inspects cases, reports damage,
 *                 ships via FedEx, performs custody handoffs, generates QR codes;
 *                 cannot create/delete cases or manage admin resources.
 *   pilot       — on-site pilot / secondary field role; check-ins, shipments,
 *                 custody handoffs, and damage reports; cannot run deep
 *                 inspections or generate QR codes.
 */
export const UserRoleValues = {
  ADMIN:      "admin",
  OPERATOR:   "operator",
  TECHNICIAN: "technician",
  PILOT:      "pilot",
} as const;

/** Union type of all valid user role strings. */
export type UserRole = (typeof UserRoleValues)[keyof typeof UserRoleValues];

/** Ordered list of all roles from highest to lowest privilege. */
export const ALL_USER_ROLES: readonly UserRole[] = [
  UserRoleValues.ADMIN,
  UserRoleValues.OPERATOR,
  UserRoleValues.TECHNICIAN,
  UserRoleValues.PILOT,
] as const;

/** Human-readable labels for each role (for display in admin UI). */
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin:      "Admin",
  operator:   "Operator",
  technician: "Technician",
  pilot:      "Pilot",
};

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * User account lifecycle status enum values.
 *
 *   active   — fully onboarded; can authenticate and perform role-permitted
 *              actions.  All users created via a successful Kinde login sync
 *              start as active.
 *   inactive — suspended or deactivated by an admin; login is blocked by auth
 *              middleware.  The record is preserved for audit history.
 *   pending  — invited but has not yet completed first Kinde login / onboarding.
 *              Transitions to "active" automatically on first successful login
 *              sync.
 */
export const UserStatusValues = {
  ACTIVE:   "active",
  INACTIVE: "inactive",
  PENDING:  "pending",
} as const;

/** Union type of all valid user status strings. */
export type UserStatus = (typeof UserStatusValues)[keyof typeof UserStatusValues];

/** Human-readable labels for each status (for display in admin UI). */
export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  active:   "Active",
  inactive: "Inactive",
  pending:  "Pending",
};

// ─── User ─────────────────────────────────────────────────────────────────────

/**
 * TypeScript representation of a user record from the Convex `users` table.
 *
 * Fields map 1:1 to the Convex schema.  Optional fields may be absent on
 * legacy records or for users who have not completed first-login sync.
 *
 * Note: `_id` and `_creationTime` are Convex system fields present on every
 * document but are not included here since they are injected by the Convex
 * runtime, not defined in the schema.  Use `Doc<"users">` from Convex's
 * generated types when you need the full document shape.
 */
export interface User {
  /** Stable Kinde `sub` claim — canonical user identifier across the system. */
  kindeId:     string;

  /** User email address from the Kinde JWT `email` claim. */
  email:       string;

  /** First name from the Kinde JWT `given_name` claim. */
  givenName?:  string;

  /** Last name from the Kinde JWT `family_name` claim. */
  familyName?: string;

  /** Display name: "Given Family", or "Given", or email fallback. */
  name:        string;

  /** Avatar URL from the Kinde JWT `picture` claim. */
  picture?:    string;

  /** Kinde organization code the user belongs to. */
  orgCode?:    string;

  /**
   * Raw Kinde role key strings from the JWT `roles` claim.
   * Retained for audit / multi-role edge-cases.
   * Prefer `role` for single effective-role access decisions.
   */
  roles?:      string[];

  /**
   * Resolved system-wide effective role for this user.
   * Derived from `roles` on each login sync (highest-privilege role wins).
   */
  role?:       UserRole;

  /**
   * Account lifecycle status.
   * Defaults to "active" on first successful login sync.
   */
  status?:     UserStatus;

  /** Epoch ms of the most recent successful login / auth sync. */
  lastLoginAt: number;

  /** Epoch ms when the user record was first created. */
  createdAt:   number;

  /** Epoch ms when the user record was last updated. */
  updatedAt:   number;

  /** Persisted dark/light theme preference. */
  themePreference?:    "light" | "dark";

  /** Persisted density preference for the INVENTORY dashboard. */
  invDensityPreference?:  "comfy" | "compact";

  /** Persisted density preference for the SCAN mobile app. */
  scanDensityPreference?: "comfy" | "compact";
}

// ─── Guards ───────────────────────────────────────────────────────────────────

/** Type guard — returns true if `value` is a valid UserRole string. */
export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === "string" &&
    (ALL_USER_ROLES as readonly string[]).includes(value)
  );
}

/** Type guard — returns true if `value` is a valid UserStatus string. */
export function isUserStatus(value: unknown): value is UserStatus {
  return (
    typeof value === "string" &&
    Object.values(UserStatusValues).includes(value as UserStatus)
  );
}

/**
 * Resolve the single effective role from a raw Kinde roles array.
 *
 * Priority order (highest wins): admin > operator > technician > pilot.
 * Returns undefined when the array is empty or contains no recognised roles.
 */
export function resolveEffectiveRole(roles: string[] | undefined): UserRole | undefined {
  if (!roles || roles.length === 0) return undefined;
  for (const r of ALL_USER_ROLES) {
    if (roles.includes(r)) return r;
  }
  return undefined;
}
