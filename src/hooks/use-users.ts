/**
 * src/hooks/use-users.ts
 *
 * Convex query and mutation hooks for user management.
 *
 * Used by the INVENTORY admin user management page (UserListTable component)
 * to fetch the full user list and perform role / status changes.
 *
 * All hooks wrap Convex's `useQuery` / `useMutation` from "convex/react" and
 * delegate to the corresponding functions in convex/users.ts.  Convex re-pushes
 * updates within ~100–300 ms of any user mutation.
 *
 * Available query hooks:
 *   useListUsers(filters?)    — all users, optionally filtered by role + status
 *
 * Available mutation hooks:
 *   useUpdateUser()           — admin role + status reassignment
 *   useDeactivateUser()       — set user status to "inactive"
 *   useCreateUser()           — admin-initiated pre-invite user creation
 *
 * Usage:
 *   const { users, isLoading } = useListUsers();
 *   const updateUser = useUpdateUser();
 *   await updateUser({ adminId, kindeId, role: "operator" });
 */

"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** User role union matching the Convex schema. */
export type UserRole = "admin" | "operator" | "technician" | "pilot";

/** User account lifecycle status matching the Convex schema. */
export type UserStatus = "active" | "inactive" | "pending";

/**
 * Summary row returned by `api.users.listUsers`.
 *
 * Matches the Convex `users` document shape projected to the fields needed
 * by the UserListTable component.
 */
export interface UserSummary {
  /** Convex document ID */
  _id: string;
  /** Kinde user ID (stable across email changes) */
  kindeId: string;
  /** Display name — "Given Family" or email fallback */
  name: string;
  /** Email address */
  email: string;
  /** Optional first name (used for avatar initials) */
  givenName?: string;
  /** Optional last name (used for avatar initials) */
  familyName?: string;
  /** Optional avatar URL from Kinde */
  picture?: string;
  /** Resolved highest-privilege role scalar */
  role?: UserRole;
  /** Raw Kinde roles array */
  roles?: string[];
  /** Account lifecycle status */
  status: UserStatus;
  /** Epoch ms of last successful login */
  lastLoginAt?: number;
  /** Epoch ms of record creation */
  createdAt: number;
  /** Epoch ms of last update */
  updatedAt: number;
}

/** Optional filters for useListUsers. */
export interface UseListUsersFilters {
  role?: UserRole;
  status?: UserStatus;
}

// ─── useListUsers ──────────────────────────────────────────────────────────────

/**
 * Subscribe to all registered users, optionally filtered by role and/or status.
 *
 * Returns users sorted by name ascending. Convex re-pushes updates whenever
 * any user record is created, updated, or deactivated.
 *
 * Return values:
 *   `users`     — `undefined` while loading; `UserSummary[]` when ready
 *   `isLoading` — true while users is undefined (initial subscription load)
 *
 * @param filters  Optional { role?, status? } filter pair.
 *
 * @example
 * function UserAdminPage() {
 *   const { users, isLoading } = useListUsers();
 *   if (isLoading) return <Skeleton />;
 *   return <UserListTable users={users ?? []} />;
 * }
 */
export function useListUsers(filters: UseListUsersFilters = {}) {
  const users = useQuery(api.users.listUsers, {
    role:   filters.role,
    status: filters.status,
  }) as UserSummary[] | undefined;

  return {
    users,
    isLoading: users === undefined,
  };
}

// ─── Optimistic update helpers ────────────────────────────────────────────────

/**
 * All role values that `listUsers` may be filtered by, including `undefined`
 * (the unfiltered case).  Used to iterate over every cached query variant.
 */
const ALL_ROLE_FILTERS = [
  undefined,
  "admin",
  "operator",
  "technician",
  "pilot",
] as const satisfies ReadonlyArray<UserRole | undefined>;

/**
 * All status values that `listUsers` may be filtered by, including `undefined`
 * (the unfiltered case).  Used to iterate over every cached query variant.
 */
const ALL_STATUS_FILTERS = [
  undefined,
  "active",
  "inactive",
  "pending",
] as const satisfies ReadonlyArray<UserStatus | undefined>;

/**
 * Scan every cached `listUsers` filter variant and return the first full user
 * record matching `kindeId`, or `undefined` if not found in any variant.
 *
 * Iterates over all role × status combinations (20 total) so the user's
 * current data is available regardless of which filtered list the component
 * is currently subscribed to.
 */
function findCachedUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localStore: any,
  kindeId: string,
): UserSummary | undefined {
  for (const role of ALL_ROLE_FILTERS) {
    for (const status of ALL_STATUS_FILTERS) {
      const cached = localStore.getQuery(api.users.listUsers, {
        role,
        status,
      }) as UserSummary[] | undefined;
      if (!cached) continue;
      const found = cached.find((u: UserSummary) => u.kindeId === kindeId);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Apply an optimistic update to every cached `api.users.listUsers` variant.
 *
 * Iterates over all role × status filter combinations (20 total) that might
 * be cached in the Convex local store and applies the appropriate operation:
 *   "update"     — patch matching user's fields, re-sort by name, and handle
 *                  filter transitions (user may enter/leave a filtered list
 *                  when their role or status changes)
 *   "deactivate" — set status → "inactive" (removes from active/pending lists)
 *   "create"     — insert the new user into every filter variant it matches
 *
 * Convex automatically rolls back all optimistic changes if the server
 * mutation fails — no cleanup code is required in the calling components.
 *
 * @param localStore  Convex OptimisticLocalStore (typed as `any` — type-safety
 *                    is enforced at the `withOptimisticUpdate` callback boundary).
 * @param kindeId     Kinde user ID of the user being modified.
 * @param patch       Partial UserSummary fields to merge onto the existing record.
 * @param mode        How to apply the change: "update" | "deactivate" | "create"
 * @param fullRecord  The complete optimistic record — required for "create";
 *                    also used as a fallback base when the user isn't cached yet.
 */
function patchAllUserLists(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localStore: any,
  kindeId: string,
  patch: Partial<UserSummary>,
  mode: "update" | "deactivate" | "create",
  fullRecord?: UserSummary,
): void {
  for (const role of ALL_ROLE_FILTERS) {
    for (const status of ALL_STATUS_FILTERS) {
      const args = { role, status };
      const cached = localStore.getQuery(api.users.listUsers, args) as
        | UserSummary[]
        | undefined;

      // Not subscribed to this filter combination — skip
      if (cached === undefined) continue;

      // ── create: insert into every matching filter variant ────────────────────
      if (mode === "create" && fullRecord) {
        const roleMatches = role === undefined || fullRecord.role === role;
        const statusMatches = status === undefined || fullRecord.status === status;
        if (!roleMatches || !statusMatches) continue;

        const updated = [...cached, fullRecord].sort(
          (a: UserSummary, b: UserSummary) => a.name.localeCompare(b.name),
        );
        localStore.setQuery(api.users.listUsers, args, updated);
        continue;
      }

      // ── update / deactivate ──────────────────────────────────────────────────
      const existingIdx = cached.findIndex(
        (u: UserSummary) => u.kindeId === kindeId,
      );

      // No base data available — can't compute the merged user
      if (existingIdx < 0 && !fullRecord) continue;

      // Build the fully merged record (existing cached data + new patch fields)
      const baseUser = existingIdx >= 0 ? cached[existingIdx] : fullRecord!;
      const mergedUser: UserSummary = { ...baseUser, ...patch };

      // Check whether the merged user still matches this filter combination
      const roleMatches = role === undefined || mergedUser.role === role;
      const statusMatches = status === undefined || mergedUser.status === status;
      const stillMatches = roleMatches && statusMatches;

      if (existingIdx >= 0 && stillMatches) {
        // In-place update and re-sort (display name may have changed)
        const updated = [...cached];
        updated[existingIdx] = mergedUser;
        localStore.setQuery(
          api.users.listUsers,
          args,
          updated.sort((a: UserSummary, b: UserSummary) =>
            a.name.localeCompare(b.name),
          ),
        );
      } else if (existingIdx >= 0 && !stillMatches) {
        // User no longer matches this filter — remove from the list
        localStore.setQuery(
          api.users.listUsers,
          args,
          cached.filter((_: UserSummary, i: number) => i !== existingIdx),
        );
      } else if (existingIdx < 0 && stillMatches && fullRecord) {
        // User now matches this filter (e.g. reactivation while on "active" view)
        const updated = [...cached, mergedUser].sort(
          (a: UserSummary, b: UserSummary) => a.name.localeCompare(b.name),
        );
        localStore.setQuery(api.users.listUsers, args, updated);
      }
      // else: not in list and doesn't match filter — nothing to do
    }
  }
}

// ─── useUpdateUser ─────────────────────────────────────────────────────────────

/**
 * Admin-initiated user profile and role update.
 *
 * Wraps `api.users.updateUser` with an optimistic update (Sub-AC 200301) that
 * immediately reflects the change in every cached `listUsers` filter variant
 * before the server confirms the write.  Convex rolls back automatically on
 * failure.
 *
 * The calling admin's Kinde ID must be passed as `adminId`; callers obtain it
 * from `useCurrentUser().id`.
 *
 * @example
 * const updateUser = useUpdateUser();
 * await updateUser({
 *   adminId: currentUser.id,
 *   kindeId: targetUser.kindeId,
 *   role: "operator",
 * });
 */
export function useUpdateUser() {
  return useMutation(api.users.updateUser).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();

      // Locate the existing user record in any cached list variant
      const existing = findCachedUser(localStore, args.kindeId);

      // Build the optimistic patch — only merge fields that were explicitly provided
      const patch: Partial<UserSummary> = { updatedAt: now };

      if (args.role !== undefined) {
        patch.role  = args.role as UserRole;
        // Keep roles array in sync with the scalar (mirrors server behaviour)
        patch.roles = [args.role];
      }
      if (args.status   !== undefined) patch.status    = args.status   as UserStatus;
      if (args.givenName  !== undefined) patch.givenName  = args.givenName;
      if (args.familyName !== undefined) patch.familyName = args.familyName;
      if (args.picture    !== undefined) patch.picture    = args.picture;

      // Recompute the display name whenever a name-related field changes.
      // Resolution order mirrors the server: "Given Family" > "Given" > email > kindeId.
      if (args.givenName !== undefined || args.familyName !== undefined) {
        const givenName  = args.givenName  ?? existing?.givenName;
        const familyName = args.familyName ?? existing?.familyName;
        patch.name =
          givenName && familyName
            ? `${givenName} ${familyName}`.trim()
            : givenName ?? existing?.email ?? args.kindeId;
      }

      patchAllUserLists(localStore, args.kindeId, patch, "update", existing);
    },
  );
}

// ─── useDeactivateUser ────────────────────────────────────────────────────────

/**
 * Admin-initiated user deactivation (status → "inactive").
 *
 * Wraps `api.users.deactivateUser` with an optimistic update (Sub-AC 200301)
 * that immediately removes the user from "active" / "pending" filter lists and
 * moves them to the "inactive" filter list before the server confirms.
 * Convex rolls back automatically on failure.
 *
 * Idempotent — deactivating an already-inactive user is a no-op.
 *
 * @example
 * const deactivateUser = useDeactivateUser();
 * await deactivateUser({ adminId: currentUser.id, kindeId: targetUser.kindeId });
 */
export function useDeactivateUser() {
  return useMutation(api.users.deactivateUser).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();
      const existing = findCachedUser(localStore, args.kindeId);
      patchAllUserLists(
        localStore,
        args.kindeId,
        { status: "inactive", updatedAt: now },
        "deactivate",
        existing,
      );
    },
  );
}

// ─── useReactivateUser ────────────────────────────────────────────────────────

/**
 * Admin-initiated user reactivation (status → "active").
 *
 * Implemented as a call to `api.users.updateUser` with status="active" —
 * there is no separate reactivate mutation in the Convex backend.
 *
 * Adds an optimistic update (Sub-AC 200301) that immediately moves the user
 * into "active" filter lists and removes them from "inactive" / "pending"
 * lists before the server confirms.  Convex rolls back automatically on
 * failure.
 *
 * @example
 * const reactivateUser = useReactivateUser();
 * await reactivateUser({ adminId: currentUser.id, kindeId: targetUser.kindeId });
 */
export function useReactivateUser() {
  // `withOptimisticUpdate` is chained on the underlying mutation so that the
  // wrapper closure can inject `status: "active"` before the call dispatches.
  const updateUser = useMutation(api.users.updateUser).withOptimisticUpdate(
    (localStore, args) => {
      // Guard: only apply when this specific hook is calling with "active".
      if (args.status !== "active") return;

      const now = Date.now();
      const existing = findCachedUser(localStore, args.kindeId);
      patchAllUserLists(
        localStore,
        args.kindeId,
        { status: "active", updatedAt: now },
        "update",
        existing,
      );
    },
  );

  return (args: { adminId: string; kindeId: string }) =>
    updateUser({ ...args, status: "active" });
}

// ─── useCreateUser ────────────────────────────────────────────────────────────

/**
 * Admin-initiated pre-invite user creation (status starts as "pending").
 *
 * Wraps `api.users.createUser` with an optimistic update (Sub-AC 200301) that
 * immediately inserts the new user (with a temporary `_id`) into every cached
 * `listUsers` filter variant that matches the new user's role and "pending"
 * status.  The temporary ID is replaced by the authoritative Convex ID once
 * the mutation is confirmed (~100–300 ms).
 *
 * Validates kindeId uniqueness and email format server-side; throws with
 * descriptive error messages on conflict.
 *
 * @example
 * const createUser = useCreateUser();
 * await createUser({
 *   adminId: currentUser.id,
 *   kindeId: "kp_01abc",
 *   email: "new.user@skyspecs.com",
 *   role: "technician",
 *   givenName: "Jane",
 *   familyName: "Smith",
 * });
 */
export function useCreateUser() {
  return useMutation(api.users.createUser).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();

      // Build the display name using the same resolution order as the server:
      //   "Given Family" > "Given" > email
      const name =
        args.givenName && args.familyName
          ? `${args.givenName} ${args.familyName}`.trim()
          : args.givenName ?? args.email;

      const optimisticUser: UserSummary = {
        // Temporary ID — replaced by the authoritative Convex ID on confirmation
        _id:        `optimistic_user_${now}`,
        kindeId:    args.kindeId,
        name,
        email:      args.email,
        givenName:  args.givenName,
        familyName: args.familyName,
        role:       args.role as UserRole,
        roles:      [args.role],
        // New users start as "pending" until they complete their first Kinde login
        status:     "pending",
        createdAt:  now,
        updatedAt:  now,
      };

      patchAllUserLists(localStore, args.kindeId, {}, "create", optimisticUser);
    },
  );
}
