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

    if (existing) {
      // Update profile fields + bump lastLoginAt / updatedAt
      await ctx.db.patch(existing._id, {
        email:       args.email,
        givenName:   args.givenName,
        familyName:  args.familyName,
        name,
        picture:     args.picture,
        orgCode:     args.orgCode,
        roles:       args.roles,
        lastLoginAt: now,
        updatedAt:   now,
      });
      return existing._id;
    }

    // First login — create the user record
    const userId = await ctx.db.insert("users", {
      kindeId:     args.kindeId,
      email:       args.email,
      givenName:   args.givenName,
      familyName:  args.familyName,
      name,
      picture:     args.picture,
      orgCode:     args.orgCode,
      roles:       args.roles,
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

// ─── Public: listUsers ────────────────────────────────────────────────────────

/**
 * Public query — returns all registered users.
 *
 * Used by the INVENTORY admin UI for user management and custody handoff
 * recipient selection.  Returns users sorted by name ascending.
 *
 * This is safe to expose publicly within the single-tenant architecture —
 * all callers are already authenticated via Kinde session middleware.
 */
export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAuth(ctx);
    const users = await ctx.db.query("users").collect();
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
