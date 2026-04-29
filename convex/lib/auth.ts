/**
 * convex/lib/auth.ts
 *
 * Identity resolution utilities for Convex query and mutation handlers.
 *
 * These helpers bridge the gap between Convex's native JWT authentication
 * (configured in auth.config.ts, accessible via ctx.auth.getUserIdentity())
 * and the internal `users` table that stores the full verified user record.
 *
 * The Convex native auth flow
 * ───────────────────────────
 *   1. Client sends the Kinde access token with every WebSocket request via
 *      ConvexProviderWithAuth (configured in src/app/providers.tsx).
 *   2. Convex verifies the JWT signature against the Kinde JWKS (per auth.config.ts).
 *   3. ctx.auth.getUserIdentity() returns the verified JWT claims as a UserIdentity.
 *   4. identity.subject === Kinde `sub` claim === users.kindeId in our schema.
 *   5. getCurrentUser() uses that subject to resolve the full user document.
 *
 * Why a separate mapping step?
 * ─────────────────────────────
 * ctx.auth.getUserIdentity() exposes raw JWT claims: name, email, subject.
 * The internal `users` table additionally stores:
 *   • Kinde roles array (for RBAC decisions via convex/rbac.ts)
 *   • Normalized display name (given + family, or email fallback)
 *   • Profile picture, orgCode, lastLoginAt timestamps
 *
 * Queries and mutations that write attribution data (userName, userId on events,
 * custodyRecords, damageReports, etc.) or perform role checks MUST load the
 * full `users` document — not just the raw identity.  requireCurrentUser() and
 * getCurrentUser() do this in a single helper call.
 *
 * Function overview
 * ─────────────────
 *   requireAuthIdentity(ctx)  — get verified UserIdentity or throw [AUTH_REQUIRED]
 *   getAuthIdentity(ctx)      — get verified UserIdentity or return null (no throw)
 *   extractKindeId(identity)  — pull the `sub` claim from a UserIdentity
 *   getCurrentUser(ctx)       — resolve to full user doc, null if not found
 *   requireCurrentUser(ctx)   — resolve to full user doc, throw if missing
 *   assertCurrentUser(ctx)    — alias for requireCurrentUser (readable guard form)
 *
 * Usage in a mutation handler
 * ────────────────────────────
 *   import { requireCurrentUser } from "./lib/auth";
 *
 *   export const handoffCustody = mutation({
 *     args: { caseId: v.id("cases"), toUserId: v.string() },
 *     handler: async (ctx, args) => {
 *       const user = await requireCurrentUser(ctx);
 *       // user.kindeId   — for DB attribution fields
 *       // user.name      — for display name fields
 *       // user.roles     — for RBAC via rolesHavePermission()
 *       await ctx.db.insert("custodyRecords", {
 *         caseId: args.caseId,
 *         fromUserId: user.kindeId,
 *         fromUserName: user.name,
 *         // ...
 *       });
 *     },
 *   });
 *
 * Usage in a query handler
 * ─────────────────────────
 *   export const myQuery = query({
 *     handler: async (ctx) => {
 *       const user = await getCurrentUser(ctx);
 *       if (!user) return null; // unauthenticated or pre-sync
 *       // proceed with user...
 *     },
 *   });
 *
 * Error codes
 * ───────────
 *   [AUTH_REQUIRED]  — no valid JWT (unauthenticated)
 *   [USER_NOT_FOUND] — authenticated but no user record (call POST /api/auth/sync)
 */

import type { Auth, UserIdentity } from "convex/server";
import type { DatabaseReader } from "../_generated/server";

// ─── Minimal context shape ────────────────────────────────────────────────────

/**
 * Minimal context interface required by all auth helpers.
 *
 * Both `GenericQueryCtx<DataModel>` (from queries) and
 * `GenericMutationCtx<DataModel>` (from mutations) satisfy this shape, so all
 * helpers work identically in both handler types without overloads.
 */
interface AuthCtx {
  auth: Auth;
  db: DatabaseReader;
}

// ─── Raw identity extraction ──────────────────────────────────────────────────

/**
 * Extract the verified Kinde user identity from the Convex auth context.
 *
 * Wraps `ctx.auth.getUserIdentity()` with a descriptive error on failure.
 * Returns the raw `UserIdentity` without performing a DB lookup — use this
 * when you only need the Kinde `sub` claim and do not need the full user doc.
 *
 * @param ctx  Convex query or mutation context.
 * @returns    Verified `UserIdentity` populated from the Kinde JWT.
 * @throws     `[AUTH_REQUIRED]` when the caller is not authenticated.
 */
export async function requireAuthIdentity(ctx: AuthCtx): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated — no valid Kinde access token was " +
      "provided. Ensure the Convex client is initialized with " +
      "ConvexProviderWithAuth and the Kinde session is active before " +
      "calling this function."
    );
  }
  return identity;
}

/**
 * Return the verified Kinde user identity, or null if the caller is not
 * authenticated.
 *
 * Non-throwing variant of `requireAuthIdentity`.  Use in handlers that
 * gracefully support optional authentication (e.g., public queries with
 * additional data for logged-in users).
 *
 * @param ctx  Convex query or mutation context.
 * @returns    `UserIdentity` or `null` when unauthenticated.
 */
export async function getAuthIdentity(
  ctx: AuthCtx
): Promise<UserIdentity | null> {
  return ctx.auth.getUserIdentity();
}

// ─── Kinde ID extraction ──────────────────────────────────────────────────────

/**
 * Extract the Kinde user ID (`sub` claim) from a verified `UserIdentity`.
 *
 * Convex populates `UserIdentity.subject` directly from the JWT `sub` claim.
 * This equals the `kindeId` field stored in the `users` table — making it the
 * canonical key for all user lookups in this system.
 *
 * Note: `tokenIdentifier` is `"${subject}|${issuer}"`.  We always use
 * `subject` (not `tokenIdentifier`) for DB lookups because the `users` table
 * is indexed by `kindeId` which is the raw `sub` value.
 *
 * @param identity  A verified `UserIdentity` from `ctx.auth.getUserIdentity()`.
 * @returns         The Kinde `sub` claim — the stable user identifier.
 */
export function extractKindeId(identity: UserIdentity): string {
  // `subject` is populated directly from the Kinde JWT `sub` claim.
  // It is always a non-empty string on a valid Convex UserIdentity.
  return identity.subject;
}

// ─── Full user record resolution ──────────────────────────────────────────────

/**
 * Resolve the authenticated caller to their full internal user document.
 *
 * Executes two steps atomically within the Convex transaction:
 *   1. Calls `ctx.auth.getUserIdentity()` to obtain the verified Kinde identity.
 *   2. Uses `identity.subject` (the Kinde `sub` claim) to look up the `users`
 *      row via the `by_kinde_id` index.
 *
 * Returns `null` in two scenarios:
 *   • The caller is not authenticated (no valid JWT in the request).
 *   • The caller is authenticated but has not yet completed a login sync
 *     (POST /api/auth/sync has never been called, so no `users` row exists).
 *
 * This null-returning variant is appropriate for queries that need to support
 * pre-sync or unauthenticated callers without throwing.  For strict enforcement
 * use `requireCurrentUser()`.
 *
 * @param ctx  Convex query or mutation context.
 * @returns    Full `users` document, or `null` if unauthenticated / no record.
 */
export async function getCurrentUser(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const kindeId = extractKindeId(identity);

  return ctx.db
    .query("users")
    .withIndex("by_kinde_id", (q) => q.eq("kindeId", kindeId))
    .first();
}

/**
 * Resolve the authenticated caller to their full internal user document.
 * Throws descriptive structured errors if authentication or user record is absent.
 *
 * This is the standard guard for any handler that:
 *   • Requires the caller to be authenticated
 *   • Needs the user's name / roles for attribution or RBAC
 *   • Should fail fast rather than silently return null
 *
 * The returned user document gives you everything needed for handler logic:
 *   • `user.kindeId`  — stable ID for DB attribution fields
 *   • `user.name`     — pre-built display name (given + family or email)
 *   • `user.email`    — email address
 *   • `user.roles`    — Kinde role keys for RBAC (see convex/rbac.ts)
 *   • `user.picture`  — avatar URL
 *   • `user.orgCode`  — Kinde organization code
 *
 * Thrown errors use machine-readable prefixes for log filtering:
 *   `[AUTH_REQUIRED]`  — unauthenticated (no valid JWT)
 *   `[USER_NOT_FOUND]` — authenticated but no `users` row (needs login sync)
 *
 * @param ctx  Convex query or mutation context.
 * @returns    Full `users` document.
 * @throws     `[AUTH_REQUIRED]`  when unauthenticated.
 * @throws     `[USER_NOT_FOUND]` when no user record exists for the Kinde ID.
 *
 * @example
 *   export const submitDamagePhoto = mutation({
 *     args: { caseId: v.id("cases"), photoStorageId: v.string() },
 *     handler: async (ctx, args) => {
 *       const user = await requireCurrentUser(ctx);
 *       await ctx.db.insert("damage_reports", {
 *         caseId: args.caseId,
 *         reportedById: user.kindeId,
 *         reportedByName: user.name,
 *         // ...
 *       });
 *     },
 *   });
 */
export async function requireCurrentUser(ctx: AuthCtx) {
  const identity = await requireAuthIdentity(ctx);
  const kindeId = extractKindeId(identity);

  const user = await ctx.db
    .query("users")
    .withIndex("by_kinde_id", (q) => q.eq("kindeId", kindeId))
    .first();

  if (!user) {
    throw new Error(
      `[USER_NOT_FOUND] Authenticated Kinde user "${kindeId}" has no registered ` +
      `account in the users table. This means POST /api/auth/sync has not been ` +
      `called after login. The client must call /api/auth/sync immediately after ` +
      `a successful Kinde authentication to initialize the user record. ` +
      `See convex/auth.ts → authSyncHandler for the sync endpoint implementation.`
    );
  }

  return user;
}

/**
 * Alias for `requireCurrentUser` — readable guard form for handler preambles.
 *
 * Both names are equivalent; choose whichever reads more naturally at the call site:
 *   `const user = await requireCurrentUser(ctx);`  — explicit "require" semantics
 *   `const user = await assertCurrentUser(ctx);`   — guard / assertion style
 *
 * @example
 *   export const listCases = query({
 *     handler: async (ctx) => {
 *       await assertCurrentUser(ctx); // just guard, discard result
 *       return ctx.db.query("cases").collect();
 *     },
 *   });
 */
export const assertCurrentUser = requireCurrentUser;
