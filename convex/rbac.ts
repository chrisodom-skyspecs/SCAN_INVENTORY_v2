/**
 * convex/rbac.ts
 *
 * Role-Based Access Control (RBAC) for the SkySpecs INVENTORY + SCAN system.
 *
 * Maps Kinde user roles (admin, technician, pilot) to permitted mutations and
 * queries on shared real-time state.  Provides:
 *
 *   Role & operation constants  — typed string-enum objects for roles and
 *                                  operations; import and use in mutation args
 *                                  and guard calls.
 *
 *   Permission matrix           — `ROLE_PERMISSIONS` — which roles may perform
 *                                  which operations; the single source of truth
 *                                  for all access decisions in the system.
 *
 *   Pure helpers (sync)         — `roleHasPermission`, `rolesHavePermission`,
 *                                  `getAllowedRolesForOperation`, `isValidRole`.
 *                                  No DB access — safe for unit testing.
 *
 *   Async DB helpers            — `getUserRoles`, `checkPermission`,
 *                                  `assertPermission`, `requireRole`,
 *                                  `requireAdmin`, `getAuthenticatedUser`.
 *                                  Accept a `DatabaseReader` so they work in
 *                                  both query (read-only) and mutation contexts.
 *
 * Usage pattern in a Convex mutation or query handler
 * ────────────────────────────────────────────────────
 *
 *   // Throw automatically on permission denial:
 *   handler: async (ctx, args) => {
 *     await assertPermission(ctx.db, args.userId, OPERATIONS.CASE_SHIP);
 *     // ... proceed with the mutation
 *   }
 *
 *   // Check without throwing (for conditional branching):
 *   const allowed = await checkPermission(ctx.db, args.userId, OPERATIONS.MAP_READ);
 *   if (!allowed) return { restricted: true, data: null };
 *
 *   // Require admin role specifically:
 *   await requireAdmin(ctx.db, args.adminId);
 *
 * Architecture notes
 * ──────────────────
 * Convex mutations and queries do not carry an authenticated HTTP session the
 * way Next.js API routes do.  The caller is responsible for passing the Kinde
 * user ID (`userId`) in the mutation/query args.  This ID is validated against
 * the `users` table (populated by the /api/auth/sync JWT verification flow in
 * convex/auth.ts) — a user that has never completed a login sync has no record
 * and is denied access.
 *
 * Role data flows:
 *   1. User authenticates via Kinde (in the Next.js app).
 *   2. Client calls POST /api/auth/sync with the Kinde access token.
 *   3. The HTTP action in convex/auth.ts verifies the JWT and calls upsertUser.
 *   4. upsertUser stores `roles` (extracted from the JWT `roles` claim) on the
 *      user document in the `users` table.
 *   5. Every subsequent mutation/query that calls assertPermission reads those
 *      roles from the `users` table via the by_kinde_id index.
 */

import type { DatabaseReader } from "./_generated/server";

// ─── Role constants ───────────────────────────────────────────────────────────

/**
 * Valid Kinde role keys for the SkySpecs system.
 *
 * These strings MUST exactly match the `key` values configured in the Kinde
 * dashboard under Settings → Roles, and they are what Kinde embeds in the JWT
 * `roles` claim array.  They are stored verbatim in `users.roles[]`.
 *
 * Role responsibilities
 * ─────────────────────
 *   admin       — full system access; creates/deletes cases and templates,
 *                 manages missions and feature flags, reads telemetry
 *   technician  — primary field operator; inspects cases, reports damage,
 *                 ships via FedEx, performs custody handoffs, generates QR codes
 *   pilot       — on-site pilot / secondary field role; check-ins, shipments,
 *                 custody handoffs, damage reports; cannot run deep inspections
 *                 (checklist item updates), manage admin resources, or generate
 *                 QR codes
 */
export const ROLES = {
  ADMIN:      "admin",
  TECHNICIAN: "technician",
  PILOT:      "pilot",
} as const;

/** Union type of all valid role strings. */
export type Role = typeof ROLES[keyof typeof ROLES];

/**
 * All valid roles in descending privilege order.
 * Used for validation, display, and `getAllowedRolesForOperation` ordering.
 * Order here does NOT imply any permission inheritance.
 */
export const ALL_ROLES: readonly Role[] = [
  ROLES.ADMIN,
  ROLES.TECHNICIAN,
  ROLES.PILOT,
] as const;

// ─── Operation constants ──────────────────────────────────────────────────────

/**
 * Discrete operation identifiers used in the permission matrix.
 *
 * Naming convention: `<resource>:<verb>` or `<resource>:<sub>:<verb>`
 *
 * Each Convex public mutation/query maps to one or more operations.  See the
 * table below for the mapping:
 *
 * ┌─────────────────────────────────┬─────────────────────────────────────────────┐
 * │ Operation constant              │ Convex function(s) guarded                  │
 * ├─────────────────────────────────┼─────────────────────────────────────────────┤
 * │ CASE_READ                       │ getCaseById, getCaseStatus,                 │
 * │                                 │ getCaseByQrCode                             │
 * │ CASE_LIST                       │ listCases, getCasesInBounds,                │
 * │                                 │ getCaseStatusCounts                         │
 * │ CASE_CREATE                     │ (admin UI case creation — future mutation)  │
 * │ CASE_DELETE                     │ (admin UI case deletion — future mutation)  │
 * │ CASE_STATUS_CHANGE              │ scan.scanCheckIn                            │
 * │ INSPECTION_START                │ scan.startInspection                        │
 * │ INSPECTION_UPDATE_ITEM          │ scan.updateChecklistItem                    │
 * │ INSPECTION_COMPLETE             │ scan.completeInspection                     │
 * │ DAMAGE_REPORT                   │ scan.updateChecklistItem (damaged status)   │
 * │                                 │ damageReports.submitDamagePhoto             │
 * │ CASE_SHIP                       │ shipping.shipCase, shipping.createShipment  │
 * │ SHIPPING_READ                   │ shipping.listShipmentsByCase,               │
 * │                                 │ shipping.getShipmentSummaryForCase,         │
 * │                                 │ shipping.trackShipment,                     │
 * │                                 │ shipping.getCaseTrackingStatus              │
 * │ CUSTODY_TRANSFER                │ custody.handoffCustody                      │
 * │ CUSTODY_READ                    │ custody.getCustodyRecordsByCase,            │
 * │                                 │ custody.getLatestCustodyRecord,             │
 * │                                 │ custody.getCustodyChain,                    │
 * │                                 │ custody.getCustodyRecordsByCustodian,       │
 * │                                 │ custody.listAllCustodyTransfers             │
 * │ TEMPLATE_READ                   │ caseTemplates.listCaseTemplates,            │
 * │                                 │ caseTemplates.getCaseTemplateById           │
 * │ TEMPLATE_CREATE                 │ (admin template management — future)        │
 * │ TEMPLATE_UPDATE                 │ (admin template management — future)        │
 * │ TEMPLATE_DELETE                 │ (admin template management — future)        │
 * │ TEMPLATE_APPLY                  │ checklists.applyTemplateToCase              │
 * │ MISSION_READ                    │ missions.getMissionById,                    │
 * │                                 │ missions.listMissions                       │
 * │ MISSION_CREATE                  │ missions.createMission                      │
 * │ MISSION_UPDATE                  │ missions.updateMission                      │
 * │ MISSION_DELETE                  │ missions.deleteMission                      │
 * │ USER_READ                       │ users.getUserByKindeId, users.getMe         │
 * │ USER_LIST                       │ users.listUsers                             │
 * │ USER_MANAGE                     │ users.upsertUser (admin re-sync)            │
 * │ NOTIFICATION_READ               │ notifications.getNotifications              │
 * │ NOTIFICATION_WRITE              │ notifications.markNotificationRead          │
 * │ FEATURE_FLAG_READ               │ featureFlags.getFeatureFlag                 │
 * │ FEATURE_FLAG_MANAGE             │ featureFlags.setFeatureFlag                 │
 * │ TELEMETRY_WRITE                 │ telemetry.recordTelemetryBatch              │
 * │ TELEMETRY_READ                  │ telemetry admin query (future)              │
 * │ MAP_READ                        │ maps.getM1FleetMode, getM2MissionMode,      │
 * │                                 │ getM3FieldMode, getM4Logistics,             │
 * │                                 │ getM5MissionControl                         │
 * │ QR_CODE_GENERATE                │ qrCodes.generateQrCode                      │
 * │ QR_CODE_READ                    │ qrCodes.getQrCodeByCaseId                   │
 * └─────────────────────────────────┴─────────────────────────────────────────────┘
 */
export const OPERATIONS = {
  // ── Case read / write ──────────────────────────────────────────────────────
  CASE_READ:              "case:read",
  CASE_LIST:              "case:list",
  CASE_CREATE:            "case:create",
  CASE_DELETE:            "case:delete",
  CASE_STATUS_CHANGE:     "case:status:change",

  // ── Inspection operations ──────────────────────────────────────────────────
  INSPECTION_START:       "case:inspection:start",
  INSPECTION_UPDATE_ITEM: "case:inspection:update",
  INSPECTION_COMPLETE:    "case:inspection:complete",

  // ── Damage operations ──────────────────────────────────────────────────────
  DAMAGE_REPORT:          "case:damage:report",

  // ── Shipping operations ────────────────────────────────────────────────────
  CASE_SHIP:              "case:ship",
  SHIPPING_READ:          "shipping:read",

  // ── Custody operations ─────────────────────────────────────────────────────
  CUSTODY_TRANSFER:       "case:custody:transfer",
  CUSTODY_READ:           "custody:read",

  // ── Template operations ────────────────────────────────────────────────────
  TEMPLATE_READ:          "template:read",
  TEMPLATE_CREATE:        "template:create",
  TEMPLATE_UPDATE:        "template:update",
  TEMPLATE_DELETE:        "template:delete",
  TEMPLATE_APPLY:         "template:apply",

  // ── Mission operations ─────────────────────────────────────────────────────
  MISSION_READ:           "mission:read",
  MISSION_CREATE:         "mission:create",
  MISSION_UPDATE:         "mission:update",
  MISSION_DELETE:         "mission:delete",

  // ── User operations ────────────────────────────────────────────────────────
  USER_READ:              "user:read",
  USER_LIST:              "user:list",
  USER_MANAGE:            "user:manage",

  // ── Notification operations ────────────────────────────────────────────────
  NOTIFICATION_READ:      "notification:read",
  NOTIFICATION_WRITE:     "notification:write",

  // ── Feature flag operations ────────────────────────────────────────────────
  FEATURE_FLAG_READ:      "featureFlag:read",
  FEATURE_FLAG_MANAGE:    "featureFlag:manage",

  // ── Telemetry operations ───────────────────────────────────────────────────
  TELEMETRY_WRITE:        "telemetry:write",
  TELEMETRY_READ:         "telemetry:read",

  // ── Map operations ─────────────────────────────────────────────────────────
  MAP_READ:               "map:read",

  // ── QR code operations ─────────────────────────────────────────────────────
  QR_CODE_GENERATE:       "qrCode:generate",
  QR_CODE_READ:           "qrCode:read",
} as const;

/** Union type of all valid operation strings. */
export type Operation = typeof OPERATIONS[keyof typeof OPERATIONS];

// ─── Permission matrix ────────────────────────────────────────────────────────

/**
 * The single source of truth for all RBAC decisions in the system.
 *
 * Maps each role to the `ReadonlySet<Operation>` it is permitted to perform.
 * A user holding multiple roles has the union of all their roles' permissions.
 *
 * Rationale for each role's permission set
 * ─────────────────────────────────────────
 *
 * ADMIN
 *   Full system access.  Can perform every operation including admin-only
 *   actions (template/mission/case CRUD, user management, feature flag
 *   management, telemetry reads).
 *
 * TECHNICIAN
 *   Primary field operator scope.  Full inspection lifecycle (start, update
 *   items, complete), damage reporting, FedEx shipments, custody handoffs, and
 *   QR code generation.  Cannot create/delete cases, manage templates or
 *   missions, manage users, toggle feature flags, or read telemetry analytics.
 *
 * PILOT
 *   On-site pilot / secondary field role.  Scans cases for check-ins, reports
 *   damage, ships cases, and performs custody handoffs.  Cannot run deep
 *   inspection item updates (updateChecklistItem), apply templates, manage any
 *   admin resources, or generate QR codes (only read/scan them).
 */
const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Operation>>> = {
  // ── admin: full access ──────────────────────────────────────────────────────
  [ROLES.ADMIN]: new Set<Operation>([
    OPERATIONS.CASE_READ,
    OPERATIONS.CASE_LIST,
    OPERATIONS.CASE_CREATE,
    OPERATIONS.CASE_DELETE,
    OPERATIONS.CASE_STATUS_CHANGE,
    OPERATIONS.INSPECTION_START,
    OPERATIONS.INSPECTION_UPDATE_ITEM,
    OPERATIONS.INSPECTION_COMPLETE,
    OPERATIONS.DAMAGE_REPORT,
    OPERATIONS.CASE_SHIP,
    OPERATIONS.SHIPPING_READ,
    OPERATIONS.CUSTODY_TRANSFER,
    OPERATIONS.CUSTODY_READ,
    OPERATIONS.TEMPLATE_READ,
    OPERATIONS.TEMPLATE_CREATE,
    OPERATIONS.TEMPLATE_UPDATE,
    OPERATIONS.TEMPLATE_DELETE,
    OPERATIONS.TEMPLATE_APPLY,
    OPERATIONS.MISSION_READ,
    OPERATIONS.MISSION_CREATE,
    OPERATIONS.MISSION_UPDATE,
    OPERATIONS.MISSION_DELETE,
    OPERATIONS.USER_READ,
    OPERATIONS.USER_LIST,
    OPERATIONS.USER_MANAGE,
    OPERATIONS.NOTIFICATION_READ,
    OPERATIONS.NOTIFICATION_WRITE,
    OPERATIONS.FEATURE_FLAG_READ,
    OPERATIONS.FEATURE_FLAG_MANAGE,
    OPERATIONS.TELEMETRY_WRITE,
    OPERATIONS.TELEMETRY_READ,
    OPERATIONS.MAP_READ,
    OPERATIONS.QR_CODE_GENERATE,
    OPERATIONS.QR_CODE_READ,
  ]),

  // ── technician: full field operations, no admin resource management ─────────
  [ROLES.TECHNICIAN]: new Set<Operation>([
    OPERATIONS.CASE_READ,
    OPERATIONS.CASE_LIST,
    // no CASE_CREATE — technicians cannot create new cases; admin only
    // no CASE_DELETE — admin only
    OPERATIONS.CASE_STATUS_CHANGE,
    OPERATIONS.INSPECTION_START,
    OPERATIONS.INSPECTION_UPDATE_ITEM,
    OPERATIONS.INSPECTION_COMPLETE,
    OPERATIONS.DAMAGE_REPORT,
    OPERATIONS.CASE_SHIP,
    OPERATIONS.SHIPPING_READ,
    OPERATIONS.CUSTODY_TRANSFER,
    OPERATIONS.CUSTODY_READ,
    OPERATIONS.TEMPLATE_READ,
    // no TEMPLATE_CREATE / UPDATE / DELETE — admin only
    OPERATIONS.TEMPLATE_APPLY,
    OPERATIONS.MISSION_READ,
    // no MISSION_CREATE / UPDATE / DELETE — admin only
    OPERATIONS.USER_READ,
    OPERATIONS.USER_LIST,
    // no USER_MANAGE — admin only
    OPERATIONS.NOTIFICATION_READ,
    OPERATIONS.NOTIFICATION_WRITE,
    // no FEATURE_FLAG_READ / MANAGE — admin only
    OPERATIONS.TELEMETRY_WRITE,
    // no TELEMETRY_READ — admin only
    OPERATIONS.MAP_READ,
    OPERATIONS.QR_CODE_GENERATE,
    OPERATIONS.QR_CODE_READ,
  ]),

  // ── pilot: field check-ins, shipments, custody, damage — no deep inspection ─
  [ROLES.PILOT]: new Set<Operation>([
    OPERATIONS.CASE_READ,
    OPERATIONS.CASE_LIST,
    // no CASE_CREATE / DELETE
    OPERATIONS.CASE_STATUS_CHANGE,
    // no INSPECTION_START / UPDATE_ITEM / COMPLETE — technician+ only
    OPERATIONS.DAMAGE_REPORT,
    OPERATIONS.CASE_SHIP,
    OPERATIONS.SHIPPING_READ,
    OPERATIONS.CUSTODY_TRANSFER,
    OPERATIONS.CUSTODY_READ,
    OPERATIONS.TEMPLATE_READ,
    // no TEMPLATE_APPLY — technician+ only (pilots don't manage packing lists)
    OPERATIONS.MISSION_READ,
    // no MISSION_CREATE / UPDATE / DELETE
    OPERATIONS.USER_READ,
    OPERATIONS.USER_LIST,
    // no USER_MANAGE
    OPERATIONS.NOTIFICATION_READ,
    OPERATIONS.NOTIFICATION_WRITE,
    // no FEATURE_FLAG_READ / MANAGE
    OPERATIONS.TELEMETRY_WRITE,
    // no TELEMETRY_READ
    OPERATIONS.MAP_READ,
    // no QR_CODE_GENERATE — pilots scan QR codes but don't generate them
    OPERATIONS.QR_CODE_READ,
  ]),
};

// ─── Pure helpers (no DB access) ─────────────────────────────────────────────
//
// These functions perform no async I/O and are safe to unit-test without a
// Convex runtime.

/**
 * Returns `true` if `value` is a recognized SkySpecs role key.
 *
 * Use this to filter unknown/stale roles from a user's roles array before
 * performing permission checks.
 *
 * @example
 *   isValidRole("admin")       // true
 *   isValidRole("superadmin")  // false
 *   isValidRole("")            // false
 */
export function isValidRole(value: string): value is Role {
  return (Object.values(ROLES) as string[]).includes(value);
}

/**
 * Returns `true` if `role` is permitted to perform `operation`.
 *
 * Pure function — no DB access.
 *
 * @param role       A recognized SkySpecs role key (admin | technician | pilot).
 * @param operation  An operation identifier from the `OPERATIONS` constant.
 *
 * @example
 *   roleHasPermission(ROLES.ADMIN, OPERATIONS.CASE_CREATE)     // true
 *   roleHasPermission(ROLES.PILOT, OPERATIONS.INSPECTION_START) // false
 *   roleHasPermission(ROLES.TECHNICIAN, OPERATIONS.CASE_SHIP)   // true
 */
export function roleHasPermission(role: Role, operation: Operation): boolean {
  return ROLE_PERMISSIONS[role]?.has(operation) ?? false;
}

/**
 * Returns `true` if ANY of the provided roles is permitted to perform
 * `operation`.
 *
 * Handles the case where a user holds multiple roles by taking the union of
 * their permissions.  Unknown/invalid role strings are silently filtered out.
 *
 * Pure function — no DB access.
 *
 * @param roles      Array of role strings (may include unrecognized entries).
 * @param operation  An operation identifier from the `OPERATIONS` constant.
 *
 * @example
 *   rolesHavePermission(["technician"], OPERATIONS.CASE_SHIP)     // true
 *   rolesHavePermission(["pilot"], OPERATIONS.INSPECTION_START)   // false
 *   rolesHavePermission(["admin", "pilot"], OPERATIONS.CASE_CREATE) // true
 *   rolesHavePermission([], OPERATIONS.CASE_READ)                 // false
 *   rolesHavePermission(["ghost"], OPERATIONS.CASE_READ)          // false
 */
export function rolesHavePermission(roles: string[], operation: Operation): boolean {
  return roles
    .filter(isValidRole)
    .some((role) => roleHasPermission(role, operation));
}

/**
 * Returns the list of roles that are permitted to perform `operation`.
 *
 * Results are ordered by `ALL_ROLES` (admin → technician → pilot).
 * Useful for building human-readable error messages and documentation.
 *
 * Pure function — no DB access.
 *
 * @param operation  An operation identifier from the `OPERATIONS` constant.
 *
 * @example
 *   getAllowedRolesForOperation(OPERATIONS.CASE_CREATE)
 *   // → ["admin"]
 *
 *   getAllowedRolesForOperation(OPERATIONS.CASE_READ)
 *   // → ["admin", "technician", "pilot"]
 */
export function getAllowedRolesForOperation(operation: Operation): Role[] {
  return ALL_ROLES.filter((role) => roleHasPermission(role, operation));
}

/**
 * Validate that a `userId` argument was provided and is non-empty.
 *
 * Call this at the start of any mutation/query that accepts a `userId` from
 * the client to prevent accidental empty-string bypasses.
 *
 * Pure function — no DB access.
 *
 * @param kindeId  The userId arg value from mutation/query args.
 *
 * @throws Error when `kindeId` is empty or whitespace-only.
 *
 * @example
 *   handler: async (ctx, args) => {
 *     assertKindeIdProvided(args.userId);
 *     await assertPermission(ctx.db, args.userId, OPERATIONS.CASE_SHIP);
 *     // ...
 *   }
 */
export function assertKindeIdProvided(kindeId: string): void {
  if (!kindeId || kindeId.trim().length === 0) {
    throw new Error(
      "[AUTH_REQUIRED] userId is required. Pass the authenticated Kinde user ID " +
      "(the 'sub' claim from the Kinde access token). " +
      "Ensure the client calls POST /api/auth/sync after login."
    );
  }
}

// ─── Async DB helpers ─────────────────────────────────────────────────────────
//
// These functions accept a `DatabaseReader` from a Convex ctx so they work
// in both query (read-only reader) and mutation (writer, which extends reader)
// contexts.

/**
 * Look up a user's validated roles from the Convex `users` table.
 *
 * Returns only recognized SkySpecs role keys (unknown roles are filtered out
 * to guard against stale data if a role is deleted from Kinde).
 *
 * Returns an empty array when:
 *   • The `kindeId` does not match any user (pre-first-login sync)
 *   • The user record exists but `roles` is undefined or empty
 *   • All stored roles are unrecognized strings
 *
 * @param db       `DatabaseReader` from a Convex query or mutation ctx.
 * @param kindeId  The Kinde `sub` claim (user ID).
 *
 * @example
 *   const roles = await getUserRoles(ctx.db, "kinde_01abc");
 *   // → ["technician"]
 */
export async function getUserRoles(
  db: DatabaseReader,
  kindeId: string
): Promise<Role[]> {
  const user = await db
    .query("users")
    .withIndex("by_kinde_id", (q) => q.eq("kindeId", kindeId))
    .first();

  if (!user || !user.roles) return [];

  return (user.roles as string[]).filter(isValidRole);
}

/**
 * Check whether a user has permission to perform `operation`.
 *
 * Returns `true` if the user holds at least one role with the required
 * permission, `false` otherwise (including when the user has no roles or does
 * not exist in the database).
 *
 * This is the non-throwing variant of `assertPermission`.  Use it when you
 * need to branch on the result rather than let a denial propagate as an error.
 *
 * @param db         `DatabaseReader` from a Convex query or mutation ctx.
 * @param kindeId    The Kinde `sub` claim (user ID).
 * @param operation  The operation the caller wants to perform.
 *
 * @example
 *   const canManageFlags = await checkPermission(
 *     ctx.db, args.userId, OPERATIONS.FEATURE_FLAG_MANAGE
 *   );
 *   if (!canManageFlags) return { allowed: false };
 */
export async function checkPermission(
  db: DatabaseReader,
  kindeId: string,
  operation: Operation
): Promise<boolean> {
  const roles = await getUserRoles(db, kindeId);
  return rolesHavePermission(roles, operation);
}

/**
 * Assert that a user has permission to perform `operation`.
 *
 * Throws a descriptive `Error` when:
 *   • The user is not found in the database (missing login sync)
 *   • The user has no recognized roles assigned
 *   • None of the user's roles permit `operation`
 *
 * Resolves with `void` on success — the caller may proceed.
 *
 * Error messages are prefixed with `[ACCESS_DENIED]` for easy log filtering.
 *
 * @param db         `DatabaseReader` from a Convex query or mutation ctx.
 * @param kindeId    The Kinde `sub` claim (user ID).
 * @param operation  The operation the caller wants to perform.
 *
 * @throws Error with `[ACCESS_DENIED]` prefix on denial.
 *
 * @example
 *   export const shipCase = mutation({
 *     args: { caseId: v.id("cases"), userId: v.string(), ... },
 *     handler: async (ctx, args) => {
 *       assertKindeIdProvided(args.userId);
 *       await assertPermission(ctx.db, args.userId, OPERATIONS.CASE_SHIP);
 *       // ... mutation logic
 *     },
 *   });
 */
export async function assertPermission(
  db: DatabaseReader,
  kindeId: string,
  operation: Operation
): Promise<void> {
  // Single DB query — avoid double-fetching the user by loading it once and
  // checking both existence and role membership here.
  const user = await db
    .query("users")
    .withIndex("by_kinde_id", (q) => q.eq("kindeId", kindeId))
    .first();

  if (!user) {
    throw new Error(
      `[ACCESS_DENIED] User "${kindeId}" is not registered. ` +
      `Complete the Kinde login sync at POST /api/auth/sync to initialize your account.`
    );
  }

  const roles = ((user.roles ?? []) as string[]).filter(isValidRole);

  if (roles.length === 0) {
    throw new Error(
      `[ACCESS_DENIED] User "${kindeId}" (${user.email}) has no roles assigned. ` +
      `Contact an administrator to assign a role (admin, technician, or pilot) ` +
      `in the Kinde dashboard under the user's profile.`
    );
  }

  if (!rolesHavePermission(roles, operation)) {
    const allowedRoles = getAllowedRolesForOperation(operation);
    throw new Error(
      `[ACCESS_DENIED] Operation "${operation}" is not permitted for ` +
      `role(s) [${roles.join(", ")}]. ` +
      `Required: one of [${allowedRoles.join(", ")}].`
    );
  }
}

/**
 * Require the calling user to hold at least one of the specified roles.
 *
 * Unlike `assertPermission` (which checks a specific operation), this function
 * checks role membership directly.  Use it for admin-only guards where you want
 * to gate on role identity rather than a per-operation capability.
 *
 * Returns the user's full validated role list so the caller can make further
 * role-specific decisions without an additional DB query.
 *
 * Throws a descriptive `Error` with `[ACCESS_DENIED]` prefix when:
 *   • The user is not found in the database
 *   • The user has no recognized roles
 *   • None of the user's roles appear in `requiredRoles`
 *
 * @param db            `DatabaseReader` from a Convex query or mutation ctx.
 * @param kindeId       The Kinde `sub` claim (user ID).
 * @param requiredRoles One or more roles of which the user must hold at least one.
 *
 * @returns The user's validated role array (filtered to recognized roles).
 *
 * @example
 *   // Require admin for template deletion:
 *   await requireRole(ctx.db, args.userId, ROLES.ADMIN);
 *
 *   // Allow admin or technician to apply templates:
 *   const userRoles = await requireRole(
 *     ctx.db, args.userId, ROLES.ADMIN, ROLES.TECHNICIAN
 *   );
 *   console.log("Caller roles:", userRoles);
 */
export async function requireRole(
  db: DatabaseReader,
  kindeId: string,
  ...requiredRoles: [Role, ...Role[]]
): Promise<Role[]> {
  // Load the user once to get both existence check and roles.
  const user = await db
    .query("users")
    .withIndex("by_kinde_id", (q) => q.eq("kindeId", kindeId))
    .first();

  if (!user) {
    throw new Error(
      `[ACCESS_DENIED] User "${kindeId}" is not registered. ` +
      `Complete the Kinde login sync at POST /api/auth/sync to initialize your account.`
    );
  }

  const userRoles = ((user.roles ?? []) as string[]).filter(isValidRole);

  if (userRoles.length === 0) {
    throw new Error(
      `[ACCESS_DENIED] User "${kindeId}" (${user.email}) has no roles assigned. ` +
      `Contact an administrator to assign a role in the Kinde dashboard.`
    );
  }

  const hasRequiredRole = userRoles.some((r) => requiredRoles.includes(r));
  if (!hasRequiredRole) {
    throw new Error(
      `[ACCESS_DENIED] Required role: one of [${requiredRoles.join(", ")}]. ` +
      `User "${kindeId}" (${user.email}) holds: [${userRoles.join(", ")}].`
    );
  }

  return userRoles;
}

/**
 * Shorthand: require the calling user to hold the `admin` role.
 *
 * Equivalent to `requireRole(db, kindeId, ROLES.ADMIN)` but more readable
 * at the call site for admin-only guards.
 *
 * @param db       `DatabaseReader` from a Convex query or mutation ctx.
 * @param kindeId  The Kinde `sub` claim (user ID).
 *
 * @throws Error with `[ACCESS_DENIED]` prefix when the user is not an admin.
 *
 * @example
 *   export const deleteTemplate = mutation({
 *     args: { templateId: v.id("caseTemplates"), adminId: v.string() },
 *     handler: async (ctx, args) => {
 *       await requireAdmin(ctx.db, args.adminId);
 *       await ctx.db.delete(args.templateId);
 *     },
 *   });
 */
export async function requireAdmin(
  db: DatabaseReader,
  kindeId: string
): Promise<void> {
  await requireRole(db, kindeId, ROLES.ADMIN);
}

/**
 * Load the full authenticated user document from the `users` table.
 *
 * Unlike `getUserRoles` (which returns only the roles array), this function
 * returns the complete user document including `name`, `email`, `picture`, etc.
 * Use it when you need the user's profile fields alongside the authorization
 * check (e.g., for writing `userName` to an audit event).
 *
 * Throws `[AUTH_REQUIRED]` when the user is not found — it does NOT check
 * permissions.  Pair with `assertPermission` or `requireRole` if an access
 * check is also needed.
 *
 * @param db       `DatabaseReader` from a Convex query or mutation ctx.
 * @param kindeId  The Kinde `sub` claim (user ID).
 *
 * @returns The full Convex `users` document.
 *
 * @throws Error with `[AUTH_REQUIRED]` prefix when the user is not found.
 *
 * @example
 *   const user = await getAuthenticatedUser(ctx.db, args.userId);
 *   // use user.name, user.email, user.roles, etc.
 */
export async function getAuthenticatedUser(
  db: DatabaseReader,
  kindeId: string
) {
  const user = await db
    .query("users")
    .withIndex("by_kinde_id", (q) => q.eq("kindeId", kindeId))
    .first();

  if (!user) {
    throw new Error(
      `[AUTH_REQUIRED] User "${kindeId}" not found in database. ` +
      `Please complete the Kinde login sync at POST /api/auth/sync.`
    );
  }

  return user;
}

// ─── Exported RBAC summary (for documentation / admin UI) ────────────────────

/**
 * Returns the complete permission matrix as a plain JSON-serializable object.
 *
 * Useful for:
 *   • Admin UI "Permissions" table showing what each role can do
 *   • Generating API documentation
 *   • Integration tests that assert the matrix hasn't changed unexpectedly
 *
 * @returns An object mapping each role to an array of its permitted operations.
 *
 * @example
 *   const matrix = getPermissionMatrix();
 *   // → { admin: [...all operations], technician: [...], pilot: [...] }
 */
export function getPermissionMatrix(): Readonly<Record<Role, readonly Operation[]>> {
  const result = {} as Record<Role, readonly Operation[]>;
  for (const role of ALL_ROLES) {
    result[role] = [...ROLE_PERMISSIONS[role]];
  }
  return result;
}
