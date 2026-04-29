/**
 * src/hooks/use-kinde-user.ts
 *
 * Centralised hook for reading the current Kinde user identity in client
 * components across the INVENTORY dashboard and SCAN mobile app.
 *
 * Returns the Kinde user ID (`sub` claim, stored as `kindeId` in the users
 * table) and a human-readable display name.  These values are passed to
 * Convex mutations as `technicianId` / `technicianName` (or equivalent).
 *
 * Display name resolution order:
 *   1. "Given Family" — when both given_name and family_name are available
 *   2. "Given"        — when only given_name is available
 *   3. email          — when neither name part is available
 *   4. Fallback       — customisable via the `fallbackName` option (default:
 *                       "Field Technician" for SCAN, "Operator" for INVENTORY)
 *
 * Loading state
 * ─────────────
 * While Kinde is initialising (session fetch in flight), `isLoading` is true.
 * `id` is an empty string and `name` is the fallback name in this state.
 * Callers that need the ID before submitting a mutation should gate on
 * `!isLoading && isAuthenticated`.
 *
 * Usage
 * ─────
 *   const { id, name, isLoading, isAuthenticated } = useKindeUser();
 *
 *   // In a mutation call:
 *   await checkIn({
 *     technicianId:   id,
 *     technicianName: name,
 *     ...
 *   });
 *
 *   // With a custom fallback name:
 *   const { id, name } = useKindeUser({ fallbackName: "Pilot" });
 */

"use client";

import { useKindeBrowserClient } from "@kinde-oss/kinde-auth-nextjs";

// ─── Return type ─────────────────────────────────────────────────────────────

export interface KindeUserState {
  /** Kinde user ID (sub claim) — written to kindeId, assigneeId, technicianId, etc. */
  id: string;
  /** Human-readable display name — written to technicianName, assigneeName, etc. */
  name: string;
  /** True while the Kinde session is being fetched from the server. */
  isLoading: boolean;
  /** True when the user has a valid Kinde session. */
  isAuthenticated: boolean;
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface UseKindeUserOptions {
  /**
   * Display name to use while loading or when the user has no profile data.
   * @default "Field Technician"
   */
  fallbackName?: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the current Kinde user identity for use in Convex mutation args.
 *
 * This hook wraps `useKindeBrowserClient()` with a consistent, typed API
 * that works across all SCAN and INVENTORY client components.
 *
 * @param options  Optional configuration — see {@link UseKindeUserOptions}.
 * @returns The current user's ID, display name, and auth state.
 */
export function useKindeUser(
  options: UseKindeUserOptions = {}
): KindeUserState {
  const { fallbackName = "Field Technician" } = options;

  const {
    user,
    isAuthenticated,
    isLoading,
  } = useKindeBrowserClient();

  // Resolve display name with fallback chain
  const name: string =
    user?.given_name && user.family_name
      ? `${user.given_name} ${user.family_name}`.trim()
      : user?.given_name
      ? user.given_name
      : user?.email ?? fallbackName;

  return {
    id: user?.id ?? "",
    name,
    isLoading: isLoading ?? true,
    isAuthenticated: isAuthenticated ?? false,
  };
}
