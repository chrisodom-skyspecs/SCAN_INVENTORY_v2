/**
 * src/providers/user-identity-provider.tsx
 *
 * UserIdentityProvider — centralized authenticated user identity context
 * for the INVENTORY dashboard and SCAN mobile app.
 *
 * Purpose
 * ───────
 * Reads from `useKindeBrowserClient()` once at the top of the provider tree,
 * so downstream components can consume user identity via `useUserIdentity()`
 * without making redundant Kinde hook calls or prop-drilling identity data.
 *
 * Exposed shape (UserIdentity):
 *   id              — Kinde user ID (sub claim); passed as kindeId /
 *                     technicianId / assigneeId to Convex mutations
 *   email           — User's email address (null when unavailable)
 *   name            — Resolved display name:
 *                     "Given Family" → "Given" → email local-part → fallback
 *   roles           — Role keys extracted from the Kinde access token's
 *                     `roles` claim (e.g. ["admin"], ["technician", "pilot"])
 *                     — matches the ROLES constants in convex/rbac.ts
 *   isLoading       — True while the Kinde session is being fetched
 *   isAuthenticated — True when the user has a valid Kinde session
 *
 * Mounting
 * ────────
 * Mount inside `KindeProvider` (which is set up in src/app/providers.tsx).
 * The provider is placed at the root `Providers` level so both the INVENTORY
 * dashboard (/inventory/*) and the SCAN mobile app (/scan/*) can consume it.
 *
 * Usage
 * ─────
 *   // In any client component under the provider:
 *   import { useUserIdentity } from "@/providers/user-identity-provider";
 *
 *   function MyComponent() {
 *     const { id, email, name, roles, isLoading } = useUserIdentity();
 *
 *     if (isLoading) return <Spinner />;
 *
 *     return <div>Hello, {name}</div>;
 *   }
 *
 *   // Role-based gate:
 *   const { roles } = useUserIdentity();
 *   const isAdmin = roles.includes("admin");
 *
 * Notes
 * ─────
 * • Roles come from `accessToken.roles` in the Kinde JWT, not from Convex.
 *   They are populated by Kinde based on the roles assigned in the Kinde
 *   dashboard.  The same roles are also stored in the Convex `users` table
 *   after the /api/auth/sync flow for server-side RBAC checks.
 *
 * • If the Kinde session has not yet loaded (isLoading=true), `id` is an
 *   empty string, `email` is null, `name` is the fallback "Operator", and
 *   `roles` is an empty array.  Gate mutations on `!isLoading && id !== ""`.
 *
 * • The context never throws — `useUserIdentity()` throws only when called
 *   outside a `UserIdentityProvider` tree (developer error).
 */

"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useKindeBrowserClient } from "@kinde-oss/kinde-auth-nextjs";
import { ALL_ROLES, type Role } from "@/lib/rbac-client";

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * The authenticated user identity exposed via context.
 *
 * All fields are derived from the Kinde session on the client.
 * The `id` field matches `kindeId` in the Convex `users` table.
 */
export interface UserIdentity {
  /**
   * Kinde user ID — the `sub` claim from the JWT.
   *
   * Used as `kindeId`, `technicianId`, `assigneeId`, `userId`, etc. in
   * Convex mutation args.  Empty string while isLoading=true or when the
   * user is not authenticated.
   */
  id: string;

  /**
   * User's email address.
   *
   * Null while loading or when the Kinde user object has no email.
   */
  email: string | null;

  /**
   * Resolved display name.
   *
   * Resolution order:
   *   1. "Given Family"  — both names available
   *   2. "Given"         — given name only
   *   3. email local-part — no name but email available
   *   4. "Operator"      — fallback when nothing is available
   */
  name: string;

  /**
   * Role keys extracted from the Kinde access token's `roles` claim.
   *
   * Each value is a valid `Role` string ("admin" | "technician" | "pilot").
   * Unknown roles in the JWT are filtered out for type safety.
   *
   * Empty array while loading, unauthenticated, or when the user has no roles.
   */
  roles: Role[];

  /**
   * True while the Kinde session is being fetched from the server.
   *
   * Gate Convex mutations on `!isLoading && id !== ""` to avoid sending
   * empty kindeId values that would fail RBAC checks on the backend.
   */
  isLoading: boolean;

  /**
   * True when the user has a valid Kinde session.
   *
   * May remain false briefly during the session resolution phase.
   * Always false when isLoading is true.
   */
  isAuthenticated: boolean;
}

// ─── Context ───────────────────────────────────────────────────────────────────

const UserIdentityContext = createContext<UserIdentity | null>(null);
UserIdentityContext.displayName = "UserIdentityContext";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a display name from Kinde user profile fields.
 *
 * @param givenName   - User's given (first) name, or null.
 * @param familyName  - User's family (last) name, or null.
 * @param email       - User's email address, or null.
 * @returns           A human-readable display name.
 */
function resolveDisplayName(
  givenName: string | null | undefined,
  familyName: string | null | undefined,
  email: string | null | undefined,
): string {
  const first = givenName?.trim() ?? "";
  const last = familyName?.trim() ?? "";

  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (email) return email.split("@")[0];
  return "Operator";
}

/**
 * Extract valid Role[] from the Kinde access token's `roles` claim.
 *
 * Each role in the JWT has shape `{ id, key, name }`.  We extract only the
 * `key` field and filter to known roles to guarantee type safety.
 *
 * @param accessTokenRoles - The `roles` array from the decoded access token.
 * @returns                  An array of valid `Role` strings.
 */
function extractRoles(
  accessTokenRoles: Array<{ id: string; key: string; name: string }> | undefined | null,
): Role[] {
  if (!Array.isArray(accessTokenRoles) || accessTokenRoles.length === 0) return [];

  // Cast to readonly for the `includes` check
  const validRoleSet: ReadonlyArray<string> = ALL_ROLES;

  return accessTokenRoles
    .map((r) => r.key)
    .filter((key): key is Role => validRoleSet.includes(key));
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface UserIdentityProviderProps {
  /** Content that can consume the UserIdentity context. */
  children: ReactNode;
}

/**
 * UserIdentityProvider — reads the Kinde session once and exposes user
 * identity data (id, email, name, roles) to all descendant components.
 *
 * Place this inside `KindeProvider` (and optionally inside
 * `ConvexProviderWithAuth`) so the Kinde browser client is available.
 *
 * @example
 * // src/app/providers.tsx
 * <KindeProvider>
 *   <ConvexProviderWithAuth ...>
 *     <UserIdentityProvider>
 *       {children}
 *     </UserIdentityProvider>
 *   </ConvexProviderWithAuth>
 * </KindeProvider>
 */
export function UserIdentityProvider({ children }: UserIdentityProviderProps) {
  const {
    user,
    accessToken,
    isAuthenticated,
    isLoading,
  } = useKindeBrowserClient();

  const value = useMemo<UserIdentity>(() => {
    const id = user?.id ?? "";
    const email = user?.email ?? null;
    const name = resolveDisplayName(user?.given_name, user?.family_name, user?.email);
    const roles = extractRoles(accessToken?.roles);
    const loading = isLoading ?? true;
    const authenticated = isAuthenticated ?? false;

    return {
      id,
      email,
      name,
      roles,
      isLoading: loading,
      isAuthenticated: authenticated,
    };
  }, [
    user?.id,
    user?.email,
    user?.given_name,
    user?.family_name,
    accessToken?.roles,
    isLoading,
    isAuthenticated,
  ]);

  return (
    <UserIdentityContext.Provider value={value}>
      {children}
    </UserIdentityContext.Provider>
  );
}

// ─── Consumer hook ─────────────────────────────────────────────────────────────

/**
 * useUserIdentity — consume the authenticated user identity context.
 *
 * Returns the current user's id, email, name, roles, and auth state.
 * Must be called inside a `UserIdentityProvider` tree.
 *
 * @throws {Error} When called outside a UserIdentityProvider — a developer
 *   error that should be caught during development, not at runtime.
 *
 * @example
 * const { id, name, roles, isLoading } = useUserIdentity();
 * const isAdmin = roles.includes("admin");
 *
 * @example
 * // Safely gate Convex mutations:
 * const { id, isLoading, isAuthenticated } = useUserIdentity();
 * if (!isLoading && isAuthenticated) {
 *   await checkIn({ technicianId: id, ... });
 * }
 */
export function useUserIdentity(): UserIdentity {
  const ctx = useContext(UserIdentityContext);
  if (ctx === null) {
    throw new Error(
      "[UserIdentityContext] useUserIdentity() must be used inside a <UserIdentityProvider>. " +
        "Ensure UserIdentityProvider wraps the component tree that uses this hook."
    );
  }
  return ctx;
}

// Re-export Role for consumer convenience
export type { Role };
