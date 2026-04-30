/**
 * Browser-safe RBAC constants and helpers.
 *
 * Keep these values aligned with `convex/rbac.ts`, but do not import the Convex
 * module here. Convex warns when files under `convex/` are bundled for browsers.
 */

export const ROLES = {
  ADMIN: "admin",
  OPERATOR: "operator",
  TECHNICIAN: "technician",
  PILOT: "pilot",
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

export const ALL_ROLES: readonly Role[] = [
  ROLES.ADMIN,
  ROLES.OPERATOR,
  ROLES.TECHNICIAN,
  ROLES.PILOT,
] as const;

export const OPERATIONS = {
  CASE_READ: "case:read",
  CASE_LIST: "case:list",
  CASE_CREATE: "case:create",
  CASE_DELETE: "case:delete",
  CASE_STATUS_CHANGE: "case:status:change",
  INSPECTION_START: "case:inspection:start",
  INSPECTION_UPDATE_ITEM: "case:inspection:update",
  INSPECTION_COMPLETE: "case:inspection:complete",
  DAMAGE_REPORT: "case:damage:report",
  CASE_SHIP: "case:ship",
  SHIPPING_READ: "shipping:read",
  CUSTODY_TRANSFER: "case:custody:transfer",
  CUSTODY_READ: "custody:read",
  TEMPLATE_READ: "template:read",
  TEMPLATE_CREATE: "template:create",
  TEMPLATE_UPDATE: "template:update",
  TEMPLATE_DELETE: "template:delete",
  TEMPLATE_APPLY: "template:apply",
  MISSION_READ: "mission:read",
  MISSION_CREATE: "mission:create",
  MISSION_UPDATE: "mission:update",
  MISSION_DELETE: "mission:delete",
  USER_READ: "user:read",
  USER_LIST: "user:list",
  USER_MANAGE: "user:manage",
  NOTIFICATION_READ: "notification:read",
  NOTIFICATION_WRITE: "notification:write",
  FEATURE_FLAG_READ: "featureFlag:read",
  FEATURE_FLAG_MANAGE: "featureFlag:manage",
  TELEMETRY_WRITE: "telemetry:write",
  TELEMETRY_READ: "telemetry:read",
  MAP_READ: "map:read",
  QR_CODE_GENERATE: "qrCode:generate",
  QR_CODE_READ: "qrCode:read",
  QR_CODE_REASSIGN: "qrCode:reassign",
  QR_CODE_INVALIDATE: "qrCode:invalidate",
} as const;

export type Operation = typeof OPERATIONS[keyof typeof OPERATIONS];

const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Operation>>> = {
  [ROLES.ADMIN]: new Set<Operation>(Object.values(OPERATIONS)),
  [ROLES.OPERATOR]: new Set<Operation>([
    OPERATIONS.CASE_READ,
    OPERATIONS.CASE_LIST,
    OPERATIONS.CASE_CREATE,
    OPERATIONS.CASE_STATUS_CHANGE,
    OPERATIONS.INSPECTION_START,
    OPERATIONS.INSPECTION_COMPLETE,
    OPERATIONS.DAMAGE_REPORT,
    OPERATIONS.CASE_SHIP,
    OPERATIONS.SHIPPING_READ,
    OPERATIONS.CUSTODY_TRANSFER,
    OPERATIONS.CUSTODY_READ,
    OPERATIONS.TEMPLATE_READ,
    OPERATIONS.TEMPLATE_CREATE,
    OPERATIONS.TEMPLATE_UPDATE,
    OPERATIONS.TEMPLATE_APPLY,
    OPERATIONS.MISSION_READ,
    OPERATIONS.MISSION_CREATE,
    OPERATIONS.MISSION_UPDATE,
    OPERATIONS.USER_READ,
    OPERATIONS.USER_LIST,
    OPERATIONS.NOTIFICATION_READ,
    OPERATIONS.NOTIFICATION_WRITE,
    OPERATIONS.FEATURE_FLAG_READ,
    OPERATIONS.TELEMETRY_WRITE,
    OPERATIONS.TELEMETRY_READ,
    OPERATIONS.MAP_READ,
    OPERATIONS.QR_CODE_GENERATE,
    OPERATIONS.QR_CODE_READ,
    OPERATIONS.QR_CODE_REASSIGN,
    OPERATIONS.QR_CODE_INVALIDATE,
  ]),
  [ROLES.TECHNICIAN]: new Set<Operation>([
    OPERATIONS.CASE_READ,
    OPERATIONS.CASE_LIST,
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
    OPERATIONS.TEMPLATE_APPLY,
    OPERATIONS.MISSION_READ,
    OPERATIONS.USER_READ,
    OPERATIONS.USER_LIST,
    OPERATIONS.NOTIFICATION_READ,
    OPERATIONS.NOTIFICATION_WRITE,
    OPERATIONS.TELEMETRY_WRITE,
    OPERATIONS.MAP_READ,
    OPERATIONS.QR_CODE_GENERATE,
    OPERATIONS.QR_CODE_READ,
    OPERATIONS.QR_CODE_REASSIGN,
    OPERATIONS.QR_CODE_INVALIDATE,
  ]),
  [ROLES.PILOT]: new Set<Operation>([
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
  ]),
};

export function isValidRole(value: string): value is Role {
  return (Object.values(ROLES) as string[]).includes(value);
}

export function roleHasPermission(role: Role, operation: Operation): boolean {
  return ROLE_PERMISSIONS[role]?.has(operation) ?? false;
}

export function rolesHavePermission(roles: string[], operation: Operation): boolean {
  return roles
    .filter(isValidRole)
    .some((role) => roleHasPermission(role, operation));
}

export function getAllowedRolesForOperation(operation: Operation): Role[] {
  return ALL_ROLES.filter((role) => roleHasPermission(role, operation));
}

export function getPermissionMatrix(): Readonly<Record<Role, readonly Operation[]>> {
  const result = {} as Record<Role, readonly Operation[]>;
  for (const role of ALL_ROLES) {
    result[role] = [...ROLE_PERMISSIONS[role]];
  }
  return result;
}

export function assertKindeIdProvided(kindeId: string): void {
  if (!kindeId || kindeId.trim().length === 0) {
    throw new Error(
      "[AUTH_REQUIRED] userId is required. Pass the authenticated Kinde user ID " +
        "(the 'sub' claim from the Kinde access token)."
    );
  }
}
