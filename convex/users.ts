/**
 * convex/users.ts
 *
 * User management functions for the SkySpecs INVENTORY + SCAN system.
 *
 * Users are created / updated on first login via the Kinde JWT sync flow:
 *   1. Client authenticates with Kinde and receives an access token.
 *   2. Client calls POST /api/auth/sync (HTTP action in convex/http.ts).
 *   3. The HTTP action verifies the JWT and calls `upsertUser` here.
 *   4. The verified user record is returned to the client.
 *
 * Public queries (used by dashboard / SCAN client components):
 *   getMe             — current user record by kindeId
 *   getUserByKindeId  — look up any user by their Kinde sub claim
 *
 * Internal mutations (called only from HTTP action / other server functions):
 *   upsertUser        — create or update a user record from verified JWT claims
 */

import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Auth, UserIdentity } from "convex/server";
import { ALL_ROLES, assertKindeIdProvided, requireAdmin } from "./rbac";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token."
    );
  }
  return identity;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the single effective role from a raw Kinde roles array.
 *
 * Priority order matches ALL_ROLES (highest privilege first):
 *   admin > operator > technician > pilot.
 *
 * Returns undefined when the array is empty or contains no recognised roles.
 */
function resolveEffectiveRole(
  roles: string[] | undefined,
): (typeof ALL_ROLES)[number] | undefined {
  if (!roles || roles.length === 0) return undefined;
  for (const r of ALL_ROLES) {
    if (roles.includes(r)) return r;
  }
  return undefined;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The subset of JWT claims extracted from a verified Kinde access token.
 * All fields are optional except `sub` (kindeId) and `email`.
 */
export interface KindeClaims {
  sub: string;           // Kinde user ID (stable)
  email: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  org_code?: string;     // Kinde organization code
  roles?: Array<{ id: string; key: string; name: string }>;
  iat?: number;
  exp?: number;
}

// ─── Internal: upsertUser ────────────────────────────────────────────────────

/**
 * Create or update a user record from verified Kinde JWT claims.
 *
 * Called exclusively by the `/api/auth/sync` HTTP action after the JWT
 * signature has been verified.  Must NOT be called with unverified data.
 *
 * On first login — inserts a new row.
 * On subsequent logins — patches the existing row with fresh claims so that
 * profile changes in Kinde (name, email, role) are picked up automatically.
 *
 * @returns The Convex document ID of the upserted user row.
 */
export const upsertUser = internalMutation({
  args: {
    kindeId:    v.string(),
    email:      v.string(),
    givenName:  v.optional(v.string()),
    familyName: v.optional(v.string()),
    picture:    v.optional(v.string()),
    orgCode:    v.optional(v.string()),
    roles:      v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Build display name — resolution order:
    //   "Given Family" > "Given" > email > kindeId
    const name =
      args.givenName && args.familyName
        ? `${args.givenName} ${args.familyName}`.trim()
        : args.givenName ?? args.email ?? args.kindeId;

    // Check if user already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_kinde_id", (q) => q.eq("kindeId", args.kindeId))
      .first();

    // Resolve effective role from the raw Kinde roles array
    const role = resolveEffectiveRole(args.roles);

    if (existing) {
      // Update profile fields + bump lastLoginAt / updatedAt.
      // Preserve status if already set (admin may have set inactive/pending);
      // only default-activate on first login (handled in the insert branch below).
      await ctx.db.patch(existing._id, {
        email:       args.email,
        givenName:   args.givenName,
        familyName:  args.familyName,
        name,
        picture:     args.picture,
        orgCode:     args.orgCode,
        roles:       args.roles,
        role,
        lastLoginAt: now,
        updatedAt:   now,
      });
      return existing._id;
    }

    // First login — create the user record with default status "active"
    const userId = await ctx.db.insert("users", {
      kindeId:     args.kindeId,
      email:       args.email,
      givenName:   args.givenName,
      familyName:  args.familyName,
      name,
      picture:     args.picture,
      orgCode:     args.orgCode,
      roles:       args.roles,
      role,
      status:      "active",
      lastLoginAt: now,
      createdAt:   now,
      updatedAt:   now,
    });

    return userId;
  },
});

// ─── Internal: getUserByKindeIdInternal ──────────────────────────────────────

/**
 * Internal query — look up a user by their Kinde sub claim.
 * Used by HTTP actions that need to cross-check an identity.
 */
export const getUserByKindeIdInternal = internalQuery({
  args: { kindeId: v.string() },
  handler: async (ctx, { kindeId }) => {
    return ctx.db
      .query("users")
      .withIndex("by_kinde_id", (q) => q.eq("kindeId", kindeId))
      .first();
  },
});

// ─── Public: getUserByKindeId ─────────────────────────────────────────────────

/**
 * Public query — look up a user by their Kinde sub claim.
 *
 * Used by client components that need to resolve a userId stored in cases,
 * events, custody records, etc. back to a display name or email.
 *
 * Returns null when the kindeId is not yet registered (pre-first-login).
 */
export const getUserByKindeId = query({
  args: { kindeId: v.string() },
  handler: async (ctx, { kindeId }) => {
    await requireAuth(ctx);
    return ctx.db
      .query("users")
      .withIndex("by_kinde_id", (q) => q.eq("kindeId", kindeId))
      .first();
  },
});

// ─── Public: getMe ────────────────────────────────────────────────────────────

/**
 * Public query — returns the user record for the given Kinde user ID.
 *
 * Intended for use as a "profile" query:
 *   const me = useQuery(api.users.getMe, { kindeId: session.user.id });
 *
 * Returns null if the user has never completed a login sync.
 */
export const getMe = query({
  args: { kindeId: v.string() },
  handler: async (ctx, { kindeId }) => {
    await requireAuth(ctx);
    return ctx.db
      .query("users")
      .withIndex("by_kinde_id", (q) => q.eq("kindeId", kindeId))
      .first();
  },
});

// ─── Public: getUser ──────────────────────────────────────────────────────────

/**
 * Public query — look up a user by their Convex document ID (`_id`).
 *
 * Used by admin UI components and server-side lookups that already hold a
 * Convex `Id<"users">` reference (e.g., custody records, inspection events).
 *
 * Returns null when no user with that ID exists in the database.
 *
 * Authorization: any authenticated user (USER_READ — all roles).
 *
 * @param userId  Convex document ID of the user row (`_id` field).
 *
 * Errors:
 *   [AUTH_REQUIRED] — called without a valid Kinde access token.
 */
export const getUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireAuth(ctx);
    return ctx.db.get(userId);
  },
});

// ─── Public: listUsers ────────────────────────────────────────────────────────

/**
 * Public query — returns registered users, optionally filtered by role and/or
 * account status.
 *
 * Used by the INVENTORY admin UI for user management and custody handoff
 * recipient selection.  Returns users sorted by name ascending.
 *
 * This is safe to expose publicly within the single-tenant architecture —
 * all callers are already authenticated via Kinde session middleware.
 *
 * Filters (all optional — omit for unfiltered results):
 *   role   — return only users whose resolved `role` scalar matches.
 *   status — return only users whose `status` field matches.
 *
 * Both filters are applied together (AND semantics) when both are provided.
 * In-memory filtering is used because the user collection is expected to be
 * small (tens to low hundreds of records) and there is no compound index.
 *
 * @param role    One of "admin" | "operator" | "technician" | "pilot".
 * @param status  One of "active" | "inactive" | "pending".
 */
export const listUsers = query({
  args: {
    role: v.optional(
      v.union(
        v.literal("admin"),
        v.literal("operator"),
        v.literal("technician"),
        v.literal("pilot"),
      )
    ),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("inactive"),
        v.literal("pending"),
      )
    ),
  },
  handler: async (ctx, { role, status }) => {
    await requireAuth(ctx);
    let users = await ctx.db.query("users").collect();

    // Apply role filter (match against the resolved `role` scalar)
    if (role !== undefined) {
      users = users.filter((u) => u.role === role);
    }

    // Apply status filter
    if (status !== undefined) {
      users = users.filter((u) => u.status === status);
    }

    return users.sort((a, b) => a.name.localeCompare(b.name));
  },
});

// ─── Public: getMyThemePreference ─────────────────────────────────────────────

/**
 * Public query — returns the authenticated user's persisted theme preference.
 *
 * Called by `ConvexThemeSync` (src/components/ConvexThemeSync) after Kinde
 * auth resolves.  The return value is used to restore the user's last-saved
 * dark/light preference across sessions and devices.
 *
 * Return values:
 *   "light" | "dark"  — explicit preference saved by setMyThemePreference
 *   null              — no preference stored yet (first visit / cleared profile)
 *   (query undefined) — auth not yet resolved (loading state)
 *
 * The client (ConvexThemeSync) interprets null / undefined as "use localStorage
 * or OS preference" — it does NOT overwrite localStorage with null.
 *
 * Authentication: unauthenticated callers receive null (no throw) so that the
 * login page can render without triggering auth errors before the session loads.
 */
export const getMyThemePreference = query({
  args: {},
  handler: async (ctx): Promise<"light" | "dark" | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_kinde_id", (q) => q.eq("kindeId", identity.subject))
      .first();

    return user?.themePreference ?? null;
  },
});

// ─── Public: getMyDensityPreferences ──────────────────────────────────────────

/**
 * Public query — returns the authenticated user's persisted density preferences
 * for both the INVENTORY dashboard and the SCAN mobile app.
 *
 * Called by `ConvexDensitySync` (src/components/ConvexDensitySync) after Kinde
 * auth resolves.  The return value is used to restore the user's density choice
 * across sessions and devices.
 *
 * Return values:
 *   { invDensity: "comfy"|"compact"|null, scanDensity: "comfy"|"compact"|null }
 *     — preferences for each app (null = no preference stored yet)
 *   null
 *     — user is not authenticated (no JWT)
 *   undefined
 *     — query loading (Convex client not yet connected)
 *
 * Priority strategy on the client:
 *   1. Convex (this query) — authoritative when authenticated (cross-device sync)
 *   2. localStorage            — fast startup fallback while Convex is loading
 *   3. Default ("comfy")      — when neither source has a stored preference
 *
 * Authentication: unauthenticated callers receive null (no throw) so that the
 * login page can render without triggering auth errors before the session loads.
 */
export const getMyDensityPreferences = query({
  args: {},
  handler: async (ctx): Promise<{
    invDensity: "comfy" | "compact" | null;
    scanDensity: "comfy" | "compact" | null;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_kinde_id", (q) => q.eq("kindeId", identity.subject))
      .first();

    if (!user) return null;

    return {
      invDensity:  user.invDensityPreference  ?? null,
      scanDensity: user.scanDensityPreference ?? null,
    };
  },
});

// ─── Public: setMyDensityPreference ───────────────────────────────────────────

/**
 * Public mutation — persists the authenticated user's density preference for
 * the specified app ("inv" = INVENTORY dashboard, "scan" = SCAN mobile app).
 *
 * Called by `ConvexDensitySync` whenever the user explicitly changes the
 * density mode in either app.  The preference is stored on the user's profile
 * row so that the next call to `getMyDensityPreferences` (on any device /
 * session) returns the same value.
 *
 * This mutation only patches the relevant density field and `updatedAt` —
 * it does NOT reset any other profile field set by `upsertUser`.
 *
 * @param app     - "inv" for INVENTORY, "scan" for SCAN
 * @param density - "comfy" or "compact"
 *
 * Errors:
 *   [AUTH_REQUIRED]  — called without a valid Kinde access token.
 *   [NOT_FOUND]      — user profile not yet created (pre-first-login sync).
 *                      Transient edge-case; ConvexDensitySync silently ignores.
 */
export const setMyDensityPreference = mutation({
  args: {
    app:     v.union(v.literal("inv"), v.literal("scan")),
    density: v.union(v.literal("comfy"), v.literal("compact")),
  },
  handler: async (ctx, { app, density }) => {
    const identity = await requireAuth(ctx);

    const user = await ctx.db
      .query("users")
      .withIndex("by_kinde_id", (q) => q.eq("kindeId", identity.subject))
      .first();

    if (!user) {
      throw new Error(
        "[NOT_FOUND] User profile not yet created. Complete login sync first."
      );
    }

    const field = app === "inv" ? "invDensityPreference" : "scanDensityPreference";

    await ctx.db.patch(user._id, {
      [field]:   density,
      updatedAt: Date.now(),
    });
  },
});

// ─── Public: setMyThemePreference ─────────────────────────────────────────────

/**
 * Public mutation — persists the authenticated user's theme preference.
 *
 * Called by `ConvexThemeSync` whenever the user explicitly toggles dark/light
 * mode.  The preference is stored on the user's profile row so that the next
 * call to `getMyThemePreference` (on any device / session) returns the same
 * value.
 *
 * This mutation only patches `themePreference` and `updatedAt` — it does NOT
 * reset any other profile field set by `upsertUser`.
 *
 * Errors:
 *   [AUTH_REQUIRED]  — called without a valid Kinde access token.
 *   [NOT_FOUND]      — the user has not completed first-login sync yet
 *                      (upsertUser has never been called for this Kinde ID).
 *                      This is a transient edge-case; the ConvexThemeSync
 *                      component retries automatically on reconnect.
 */
export const setMyThemePreference = mutation({
  args: {
    theme: v.union(v.literal("light"), v.literal("dark")),
  },
  handler: async (ctx, { theme }) => {
    const identity = await requireAuth(ctx);

    const user = await ctx.db
      .query("users")
      .withIndex("by_kinde_id", (q) => q.eq("kindeId", identity.subject))
      .first();

    if (!user) {
      // The user's first-login sync (upsertUser) hasn't completed yet.
      // Throwing here is intentional — ConvexThemeSync catches this and
      // will retry once the user record is created.
      throw new Error(
        "[NOT_FOUND] User profile not yet created. Complete login sync first."
      );
    }

    await ctx.db.patch(user._id, {
      themePreference: theme,
      updatedAt: Date.now(),
    });
  },
});

// ─── Public: updateUser ───────────────────────────────────────────────────────

/**
 * Public mutation — admin-initiated user profile update and role reassignment.
 *
 * Allows an admin to:
 *   • Update profile fields (givenName, familyName, picture, orgCode)
 *   • Reassign the user's system-wide role (admin / operator / technician / pilot)
 *   • Change the user's account status (active / inactive / pending)
 *
 * Only the fields explicitly included in the call are updated — omitted optional
 * args leave the existing values untouched.
 *
 * Authorization: admin only (USER_MANAGE permission).
 *
 * Guards:
 *   - An admin cannot demote their own role away from "admin" (prevents lockout).
 *   - The target user must exist in the `users` table.
 *
 * @param adminId    Kinde user ID of the calling admin.
 * @param kindeId    Kinde user ID of the user to update.
 * @param givenName  Optional new first name.
 * @param familyName Optional new last name.
 * @param picture    Optional new avatar URL.
 * @param orgCode    Optional new Kinde organization code.
 * @param role       Optional new system-wide role.
 * @param status     Optional new account lifecycle status.
 *
 * @returns The Convex document ID of the updated user record.
 *
 * Errors:
 *   [AUTH_REQUIRED]    — adminId is missing or empty.
 *   [VALIDATION_ERROR] — kindeId is missing or empty.
 *   [ACCESS_DENIED]    — caller is not an admin (lacks USER_MANAGE).
 *   [SELF_DEMOTE]      — admin attempted to reassign their own role away from admin.
 *   [NOT_FOUND]        — target user does not exist in the database.
 */
export const updateUser = mutation({
  args: {
    adminId:    v.string(),
    kindeId:    v.string(),
    // Optional profile fields — only provided fields are updated
    givenName:  v.optional(v.string()),
    familyName: v.optional(v.string()),
    picture:    v.optional(v.string()),
    orgCode:    v.optional(v.string()),
    // Optional role reassignment
    role: v.optional(
      v.union(
        v.literal("admin"),
        v.literal("operator"),
        v.literal("technician"),
        v.literal("pilot"),
      )
    ),
    // Optional status change
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("inactive"),
        v.literal("pending"),
      )
    ),
  },
  handler: async (ctx, args) => {
    // 1. Validate adminId is provided
    assertKindeIdProvided(args.adminId);

    // 2. Validate kindeId is non-empty
    if (!args.kindeId || args.kindeId.trim().length === 0) {
      throw new Error(
        "[VALIDATION_ERROR] kindeId is required and must be non-empty."
      );
    }

    // 3. Authorization — must be admin (USER_MANAGE is admin-only)
    await requireAdmin(ctx.db, args.adminId);

    // 4. Guard: admin cannot demote their own role away from "admin".
    //    This prevents an admin from accidentally locking themselves out of
    //    admin access with no way to undo the action.
    if (
      args.adminId === args.kindeId &&
      args.role !== undefined &&
      args.role !== "admin"
    ) {
      throw new Error(
        "[SELF_DEMOTE] An admin cannot reassign their own role away from admin. " +
        "Ask another admin to perform this action if required."
      );
    }

    // 5. Look up the target user
    const user = await ctx.db
      .query("users")
      .withIndex("by_kinde_id", (q) => q.eq("kindeId", args.kindeId))
      .first();

    if (!user) {
      throw new Error(
        `[NOT_FOUND] User "${args.kindeId}" is not registered in the database.`
      );
    }

    // 6. Build the partial patch — only include fields that were explicitly provided
    const now = Date.now();
    // Use a typed partial to avoid stray undefined values reaching ctx.db.patch
    const patch: {
      updatedAt: number;
      givenName?: string;
      familyName?: string;
      name?: string;
      picture?: string;
      orgCode?: string;
      role?: "admin" | "operator" | "technician" | "pilot";
      roles?: string[];
      status?: "active" | "inactive" | "pending";
    } = { updatedAt: now };

    // Profile fields
    if (args.givenName !== undefined)  patch.givenName  = args.givenName;
    if (args.familyName !== undefined) patch.familyName = args.familyName;
    if (args.picture !== undefined)    patch.picture    = args.picture;
    if (args.orgCode !== undefined)    patch.orgCode    = args.orgCode;

    // Rebuild display name when any name-related field changes.
    // Resolution order: "Given Family" > "Given" > email > kindeId
    if (args.givenName !== undefined || args.familyName !== undefined) {
      const givenName  = args.givenName  ?? user.givenName;
      const familyName = args.familyName ?? user.familyName;
      patch.name =
        givenName && familyName
          ? `${givenName} ${familyName}`.trim()
          : givenName ?? user.email ?? user.kindeId;
    }

    // Role reassignment — keep both the `role` scalar and the `roles` array in
    // sync.  The `roles` array is stored as a single-element array containing
    // the new role, matching the shape written by `upsertUser` and `createUser`.
    if (args.role !== undefined) {
      patch.role  = args.role;
      patch.roles = [args.role];
    }

    // Status change
    if (args.status !== undefined) {
      patch.status = args.status;
    }

    await ctx.db.patch(user._id, patch);

    return user._id;
  },
});

// ─── Public: createUser ───────────────────────────────────────────────────────

/**
 * Public mutation — admin-initiated user creation.
 *
 * Creates a new user record with status "pending" (the user has not yet
 * completed their first Kinde login).  The user becomes "active" automatically
 * when they first authenticate via Kinde and `upsertUser` is called.
 *
 * Authorization: admin only (USER_MANAGE permission).
 *
 * Input validation:
 *   - `adminId` must be non-empty
 *   - `kindeId` must be non-empty and not already registered
 *   - `email` must pass basic format validation and not already be in use
 *   - `role` must be one of the recognised SkySpecs role keys
 *
 * @param adminId    Kinde user ID of the calling admin.
 * @param kindeId    Kinde user ID for the new user (obtained after inviting
 *                   them in the Kinde dashboard).
 * @param email      Email address for the new user.
 * @param role       System-wide role to assign (admin | operator | technician | pilot).
 * @param givenName  Optional first name.
 * @param familyName Optional last name.
 * @param orgCode    Optional Kinde organization code.
 *
 * @returns The Convex document ID of the newly created user record.
 *
 * Errors:
 *   [AUTH_REQUIRED]    — adminId is missing or empty.
 *   [ACCESS_DENIED]    — caller is not an admin (lacks USER_MANAGE).
 *   [VALIDATION_ERROR] — kindeId/email/role failed validation.
 *   [CONFLICT]         — kindeId or email already registered.
 */
export const createUser = mutation({
  args: {
    adminId:    v.string(),
    kindeId:    v.string(),
    email:      v.string(),
    role:       v.union(
      v.literal("admin"),
      v.literal("operator"),
      v.literal("technician"),
      v.literal("pilot"),
    ),
    givenName:  v.optional(v.string()),
    familyName: v.optional(v.string()),
    orgCode:    v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Validate adminId is provided
    assertKindeIdProvided(args.adminId);

    // 2. Validate kindeId is non-empty
    if (!args.kindeId || args.kindeId.trim().length === 0) {
      throw new Error(
        "[VALIDATION_ERROR] kindeId is required and must be non-empty. " +
        "Obtain the Kinde user ID after inviting the user in the Kinde dashboard."
      );
    }

    // 3. Validate email format (basic RFC 5322-compatible surface check)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(args.email.trim())) {
      throw new Error(
        `[VALIDATION_ERROR] "${args.email}" is not a valid email address.`
      );
    }

    // 4. Authorization — must be admin (USER_MANAGE is admin-only)
    await requireAdmin(ctx.db, args.adminId);

    // 5. Duplicate check: kindeId
    const existingByKindeId = await ctx.db
      .query("users")
      .withIndex("by_kinde_id", (q) => q.eq("kindeId", args.kindeId))
      .first();

    if (existingByKindeId) {
      throw new Error(
        `[CONFLICT] A user with kindeId "${args.kindeId}" is already registered. ` +
        `Use upsertUser to sync profile updates from Kinde.`
      );
    }

    // 6. Duplicate check: email
    const normalizedEmail = args.email.trim().toLowerCase();
    const existingByEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();

    if (!existingByEmail) {
      // also check with original casing in case stored differently
      const existingByEmailOriginal = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", args.email.trim()))
        .first();

      if (existingByEmailOriginal) {
        throw new Error(
          `[CONFLICT] A user with email "${args.email}" is already registered.`
        );
      }
    } else {
      throw new Error(
        `[CONFLICT] A user with email "${args.email}" is already registered.`
      );
    }

    // 7. Build display name — resolution order: "Given Family" > "Given" > email
    const name =
      args.givenName && args.familyName
        ? `${args.givenName} ${args.familyName}`.trim()
        : args.givenName ?? args.email.trim();

    const now = Date.now();

    // 8. Insert user with "pending" status and explicit role assignment.
    //    "pending" = invited but has not yet completed first Kinde login.
    //    When the user authenticates for the first time, `upsertUser` will
    //    update the record (including setting status → "active").
    const userId = await ctx.db.insert("users", {
      kindeId:     args.kindeId,
      email:       args.email.trim(),
      givenName:   args.givenName,
      familyName:  args.familyName,
      name,
      orgCode:     args.orgCode,
      // Store the role both as the string array (for RBAC helpers) and the
      // resolved `role` scalar (highest-privilege field used by UI components).
      roles:       [args.role],
      role:        args.role,
      status:      "pending",
      lastLoginAt: now,
      createdAt:   now,
      updatedAt:   now,
    });

    return userId;
  },
});

// ─── Public: deactivateUser ───────────────────────────────────────────────────

/**
 * Public mutation — admin-initiated user deactivation.
 *
 * Sets a user's `status` to "inactive", which is checked by the Kinde auth
 * middleware to block further access.  The user record is preserved for audit
 * and custody/event history purposes — it is NOT deleted.
 *
 * The operation is idempotent: deactivating an already-inactive user returns
 * their document ID without patching the record.
 *
 * Authorization: admin only (USER_MANAGE permission).
 *
 * Guards:
 *   - An admin cannot deactivate their own account (prevents accidental lockout).
 *   - The target user must exist in the `users` table.
 *
 * @param adminId  Kinde user ID of the calling admin.
 * @param kindeId  Kinde user ID of the user to deactivate.
 *
 * @returns The Convex document ID of the deactivated user record.
 *
 * Errors:
 *   [AUTH_REQUIRED]    — adminId is missing or empty.
 *   [ACCESS_DENIED]    — caller is not an admin (lacks USER_MANAGE).
 *   [VALIDATION_ERROR] — kindeId is missing or empty.
 *   [SELF_DEACTIVATE]  — admin attempted to deactivate their own account.
 *   [NOT_FOUND]        — target user does not exist in the database.
 */
export const deactivateUser = mutation({
  args: {
    adminId: v.string(),
    kindeId: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Validate adminId is provided
    assertKindeIdProvided(args.adminId);

    // 2. Validate kindeId is non-empty
    if (!args.kindeId || args.kindeId.trim().length === 0) {
      throw new Error(
        "[VALIDATION_ERROR] kindeId is required and must be non-empty."
      );
    }

    // 3. Authorization — must be admin (USER_MANAGE is admin-only)
    await requireAdmin(ctx.db, args.adminId);

    // 4. Guard: admin cannot deactivate their own account.
    //    This prevents an admin from accidentally locking themselves out of the
    //    system with no way to undo the action.
    if (args.adminId === args.kindeId) {
      throw new Error(
        "[SELF_DEACTIVATE] An admin cannot deactivate their own account. " +
        "Ask another admin to perform this action if required."
      );
    }

    // 5. Look up the target user
    const user = await ctx.db
      .query("users")
      .withIndex("by_kinde_id", (q) => q.eq("kindeId", args.kindeId))
      .first();

    if (!user) {
      throw new Error(
        `[NOT_FOUND] User "${args.kindeId}" is not registered in the database.`
      );
    }

    // 6. Idempotent: already inactive — return without patching
    if (user.status === "inactive") {
      return user._id;
    }

    // 7. Set status to "inactive" and stamp updatedAt
    await ctx.db.patch(user._id, {
      status:    "inactive",
      updatedAt: Date.now(),
    });

    return user._id;
  },
});
