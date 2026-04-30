/**
 * src/lib/kinde.ts — Kinde server-side session utilities
 *
 * Provides typed helpers that wrap `getKindeServerSession` for use in:
 *   • Next.js Server Components
 *   • Route Handlers (app/api/*)
 *   • Server Actions
 *
 * All exports are server-only.  Never import this module from a "use client"
 * component — the build will throw a "server-only" error at compile time.
 *
 * Quick reference
 * ───────────────
 *   getAuthUser()          — current user or null (unauthenticated)
 *   requireAuthUser()      — current user or throws; use in protected routes
 *   isAuthenticated()      — boolean session check
 *   getUserOrg()           — Kinde organization for the current user
 *   getUserPermission(key) — single permission check
 *   getKindeSession()      — raw session object (full SDK surface)
 *
 * Configuration (environment variables)
 * ──────────────────────────────────────
 * The Kinde SDK reads the following variables automatically.  They must be
 * set before the server starts — see .env.local for development values and
 * Vercel project settings for production:
 *
 *   KINDE_CLIENT_ID                  Kinde application client ID
 *   KINDE_CLIENT_SECRET              Kinde application client secret
 *   KINDE_ISSUER_URL                 https://<subdomain>.kinde.com
 *   KINDE_SITE_URL                   Base URL of this deployment
 *   KINDE_POST_LOGOUT_REDIRECT_URL   Post-logout destination
 *   KINDE_POST_LOGIN_REDIRECT_URL    Default post-login destination (INVENTORY)
 *   KINDE_POST_LOGIN_ALLOWED_URL_REGEX  Open-redirect guard regex
 *   KINDE_SCAN_POST_LOGIN_REDIRECT_URL  SCAN-specific post-login redirect
 *
 * Route handler
 * ─────────────
 * The SDK's `handleAuth()` catch-all is mounted at:
 *   src/app/api/auth/[kindeAuth]/route.ts
 *
 * It handles:  /api/auth/login, /api/auth/logout, /api/auth/register,
 *              /api/auth/kinde_callback
 *
 * Middleware
 * ──────────
 * The `withAuth` middleware in src/middleware.ts protects /inventory/* and
 * /scan/* routes.  Unauthenticated requests are redirected to the Kinde
 * hosted login page.
 *
 * Provider
 * ────────
 * The `KindeProvider` client component in src/app/providers.tsx wraps the
 * entire app tree and makes the Kinde session available to client components
 * via the `useKindeAuth()` hook from @kinde-oss/kinde-auth-nextjs.
 *
 * @see https://kinde.com/docs/developer-tools/nextjs-sdk/
 */

// server-only — do NOT import this module in "use client" components.
// This module uses `getKindeServerSession` which requires a Node.js / Edge
// request context.  Importing it client-side will cause a build error.

import { getKindeServerSession } from "@kinde-oss/kinde-auth-nextjs/server";
import type {
  KindeUser,
  KindeOrganization,
  KindePermission,
  KindeRoles,
} from "@kinde-oss/kinde-auth-nextjs/types";
import { isValidRole, type Role } from "../../convex/rbac";

// ─── Re-export token helpers ──────────────────────────────────────────────────
//
// The token-level utilities live in auth-token.ts to keep this module focused
// on session-level operations.  Re-exporting them here provides a single
// import path for server code that needs both session and token utilities.
//
//   import { getAuthUser, getKindeToken, extractUserFromToken } from "@/lib/kinde";
//
export {
  getKindeToken,
  requireKindeToken,
  verifyKindeJwt,
  extractUserFromToken,
  buildDisplayName,
  parseTokenClaims,
  type KindeTokenClaims,
  type ExtractedUser,
} from "./auth-token";

// ─── Re-export Kinde types used by callers ────────────────────────────────────

export type { KindeUser, KindeOrganization, KindePermission, KindeRoles };

// ─── getKindeSession ──────────────────────────────────────────────────────────

/**
 * Returns the raw Kinde server session object.
 *
 * Use this when you need access to the full Kinde SDK surface (flags, tokens,
 * claims, etc.).  For common operations prefer the typed helpers below.
 *
 * @example
 * const session = getKindeSession();
 * const token = await session.getAccessTokenRaw();
 */
export function getKindeSession() {
  return getKindeServerSession();
}

// ─── getAuthUser ──────────────────────────────────────────────────────────────

/**
 * Returns the currently authenticated Kinde user, or null if not authenticated.
 *
 * Safe to call in any Server Component or Route Handler.  Does NOT redirect —
 * use `requireAuthUser()` in strictly protected contexts.
 *
 * @example
 * const user = await getAuthUser();
 * if (!user) return <SignInPrompt />;
 * return <Dashboard user={user} />;
 */
export async function getAuthUser(): Promise<KindeUser<Record<string, unknown>> | null> {
  const session = getKindeServerSession();
  return session.getUser();
}

// ─── requireAuthUser ─────────────────────────────────────────────────────────

/**
 * Returns the currently authenticated Kinde user.
 * Throws an error if the user is not authenticated.
 *
 * Use in Route Handlers and Server Actions where the middleware should have
 * already enforced authentication.  Throwing here acts as a safety net for
 * direct function calls that bypass the middleware chain.
 *
 * @throws {Error} "Unauthenticated" when no valid Kinde session exists.
 *
 * @example
 * // In a protected route handler:
 * const user = await requireAuthUser();
 * const { id, email, given_name, family_name } = user;
 */
export async function requireAuthUser(): Promise<KindeUser<Record<string, unknown>>> {
  const user = await getAuthUser();
  if (!user) {
    throw new Error("Unauthenticated");
  }
  return user;
}

// ─── isAuthenticated ─────────────────────────────────────────────────────────

/**
 * Returns true when the current request has a valid Kinde session.
 *
 * @example
 * if (!(await isAuthenticated())) {
 *   return NextResponse.redirect(new URL("/api/auth/login", req.url));
 * }
 */
export async function isAuthenticated(): Promise<boolean> {
  const session = getKindeServerSession();
  return (await session.isAuthenticated()) ?? false;
}

// ─── getUserOrg ──────────────────────────────────────────────────────────────

/**
 * Returns the Kinde organization associated with the current user's session,
 * or null if not part of an organization.
 *
 * In the SkySpecs system, organizations represent groups of staff or contractors
 * within the single-tenant architecture.  This is used to scope access to cases,
 * missions, and reports to the correct operational group.
 *
 * @example
 * const org = await getUserOrg();
 * if (org) {
 *   console.log(org.orgCode); // e.g. "org_skyspecs_ops"
 * }
 */
export async function getUserOrg(): Promise<KindeOrganization | null> {
  const session = getKindeServerSession();
  return session.getOrganization();
}

// ─── getUserPermission ────────────────────────────────────────────────────────

/**
 * Returns the Kinde permission object for the given key.
 *
 * Kinde permissions are defined in the Kinde dashboard under
 * "Permissions" and assigned to roles.  Common permission keys for this app:
 *
 *   "inventory:read"     — view INVENTORY dashboard map and case details
 *   "inventory:write"    — create / update / delete cases and missions
 *   "scan:read"          — view SCAN mobile app (case details, checklists)
 *   "scan:write"         — perform SCAN actions (check-in, inspect, ship, handoff)
 *   "admin:manage"       — access admin settings and case template management
 *
 * @param permissionKey  The Kinde permission key to check.
 *
 * @example
 * const perm = await getUserPermission("scan:write");
 * if (!perm?.isGranted) {
 *   return new Response("Forbidden", { status: 403 });
 * }
 */
export async function getUserPermission(
  permissionKey: string
): Promise<KindePermission | null> {
  const session = getKindeServerSession();
  return session.getPermission(permissionKey);
}

// ─── getUserId ───────────────────────────────────────────────────────────────

/**
 * Returns the Kinde user ID string for the current session, or null if
 * unauthenticated.
 *
 * This ID is stable across sessions and is the canonical identifier used in:
 *   • cases.assigneeId / cases.createdBy
 *   • custodyRecords.fromUserId / .toUserId
 *   • inspections.startedById / .completedById
 *   • manifestItems.checkedById
 *   • notifications.userId
 *
 * @example
 * const userId = await getUserId();
 * if (!userId) return null;
 * const myCases = await db
 *   .query("cases")
 *   .withIndex("by_assignee", q => q.eq("assigneeId", userId))
 *   .collect();
 */
export async function getUserId(): Promise<string | null> {
  const user = await getAuthUser();
  return user?.id ?? null;
}

// ─── getUserDisplayName ───────────────────────────────────────────────────────

/**
 * Returns a display-friendly name for the current user.
 *
 * Resolution order:
 *   1. Full name (given_name + family_name), if both are set
 *   2. given_name only, if set
 *   3. email, if set
 *   4. "Unknown User" as final fallback
 *
 * Used when populating assigneeName, technicianName, or pilotName fields in
 * Convex mutations that record who performed an action.
 *
 * @example
 * const name = await getUserDisplayName();
 * await checkIn({ technicianName: name, ... });
 */
export async function getUserDisplayName(): Promise<string> {
  const user = await getAuthUser();
  if (!user) return "Unknown User";

  const { given_name, family_name, email } = user;

  if (given_name && family_name) return `${given_name} ${family_name}`.trim();
  if (given_name) return given_name;
  if (email) return email;
  return "Unknown User";
}

// ─── getServerUserRoles ───────────────────────────────────────────────────────

/**
 * Returns the validated SkySpecs role keys for the current session user.
 *
 * Reads the `roles` claim from the Kinde access token via `getRoles()` and
 * filters to only recognized SkySpecs role keys (admin, operator, technician,
 * pilot).  Unknown roles from Kinde are silently dropped.
 *
 * Returns an empty array when:
 *   • The user is not authenticated
 *   • The access token has no `roles` claim
 *   • All roles in the token are unrecognized strings
 *
 * Use in Server Components and Route Handlers (server-side only).
 *
 * @example
 * // In a protected server layout:
 * const roles = await getServerUserRoles();
 * const canAccessAdmin = roles.includes("admin") || roles.includes("operator");
 * if (!canAccessAdmin) {
 *   redirect("/inventory");
 * }
 *
 * @example
 * // In a protected route handler:
 * const roles = await getServerUserRoles();
 * if (!roles.includes("admin")) {
 *   return new Response("Forbidden", { status: 403 });
 * }
 */
export async function getServerUserRoles(): Promise<Role[]> {
  const session = getKindeServerSession();
  const kindeRoles: KindeRoles | null = await session.getRoles();

  if (!kindeRoles || kindeRoles.length === 0) return [];

  // Filter to only recognized SkySpecs role keys (admin, operator, technician, pilot).
  // Unknown role keys from Kinde (e.g. stale roles from a previous configuration)
  // are silently dropped to prevent privilege escalation via stale tokens.
  return kindeRoles
    .map((r) => r.key)
    .filter(isValidRole) as Role[];
}
