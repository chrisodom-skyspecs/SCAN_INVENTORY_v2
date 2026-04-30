/**
 * src/hooks/use-organizations.ts
 *
 * Convex query and mutation hooks for organization data.
 *
 * Provides real-time subscriptions to organization lists and member data,
 * wired to the queries defined in convex/queries/organizations.ts.
 * Also provides mutation hooks for creating and updating organizations,
 * wired to the mutations in convex/organizations.ts.
 *
 * Available query hooks
 * ─────────────────────
 *   useOrgsWithMemberCount  — list of orgs + active member count (admin table)
 *   useOrgList              — list of active orgs (dropdowns / pickers)
 *   useOrgMembers           — active members of a specific org
 *   useUserOrgs             — orgs the current user belongs to
 *
 * Available mutation hooks
 * ────────────────────────
 *   useCreateOrganization   — admin: create a new org group
 *   useUpdateOrganization   — admin: update an existing org group
 *
 * Access control
 * ──────────────
 * All hooks pass `userId` to the underlying Convex query.  The query layer
 * determines which fields to expose based on the user's system role (admin /
 * operator vs. standard field user).
 *
 * Skip pattern
 * ────────────
 * Hooks that accept nullable IDs use `"skip"` when the value is null to
 * suppress the subscription entirely.
 */

"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Safe dynamic accessor for the queries/organizations sub-module.
// The Convex FilterApi type strips slash-keyed namespaces from the inferred
// type of `api`, so we cast through unknown to access the runtime API shape
// (which does include "queries/organizations" at the object level).
// This pattern matches how T1TimelinePanel, use-scan-queries, and
// use-shipment-status access other sub-module namespaces.
const orgsApi = (api as unknown as Record<string, Record<string, unknown>>)[
  "queries/organizations"
];

// Dynamic accessor for the organizations mutations module.
// `api.organizations` is not exposed through the FilterApi type alias because
// Convex's generated types only surface modules that have public functions — if
// the generated api.d.ts doesn't include organizations, we cast through
// unknown to reach the runtime object, mirroring the pattern above.
const orgsMutationsApi = (
  api as unknown as Record<string, Record<string, unknown>>
)["organizations"];

// Re-export shared types for component use.
export type {
  OrgPublic,
  OrgElevated,
  OrgRecord,
  OrgMemberPublic,
  OrgMemberElevated,
  OrgMemberRecord,
  UserOrgMembership,
} from "../../convex/queries/organizations";

// ─── OrgWithCount ─────────────────────────────────────────────────────────────

/** Shape returned by listOrgsWithMemberCount. */
export interface OrgWithCount {
  _id: string;
  name: string;
  orgType: "internal" | "contractor";
  description?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  memberCount: number;
  // Elevated fields (only present for admin/operator callers)
  contactName?: string;
  contactEmail?: string;
  kindeOrgCode?: string;
}

// ─── useOrgsWithMemberCount ───────────────────────────────────────────────────

/**
 * Real-time subscription to the org groups list with active member counts.
 *
 * Used by the admin Org Groups management table.
 *
 * @param userId          Kinde user ID of the requesting user.
 * @param orgType         Optional type filter ("internal" | "contractor").
 * @param includeInactive Include inactive orgs (admin/operator only).
 *
 * @returns
 *   - `orgs`      — array of orgs with memberCount (undefined while loading)
 *   - `isLoading` — true while the initial subscription payload is pending
 */
export function useOrgsWithMemberCount(
  userId: string,
  orgType?: "internal" | "contractor",
  includeInactive?: boolean
): {
  orgs: OrgWithCount[] | undefined;
  isLoading: boolean;
} {
  const skip = !userId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = useQuery(
    orgsApi.listOrgsWithMemberCount as any,
    skip
      ? "skip"
      : {
          userId,
          orgType,
          includeInactive,
        }
  );

  return {
    orgs: result as OrgWithCount[] | undefined,
    isLoading: result === undefined,
  };
}

// ─── useOrgList ───────────────────────────────────────────────────────────────

/**
 * Real-time subscription to the list of active organizations.
 *
 * Used by dropdowns (M1 org filter, custody handoff picker, case assignment).
 *
 * @param userId  Kinde user ID of the requesting user.
 * @param orgType Optional type filter.
 */
export function useOrgList(
  userId: string,
  orgType?: "internal" | "contractor"
) {
  const skip = !userId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = useQuery(
    orgsApi.listOrgs as any,
    skip ? "skip" : { userId, orgType }
  );

  return {
    orgs: result,
    isLoading: result === undefined,
  };
}

// ─── useOrgMembers ────────────────────────────────────────────────────────────

/**
 * Real-time subscription to the active members of a specific org.
 *
 * @param orgId   Convex document ID of the org (null to skip).
 * @param userId  Kinde user ID of the requesting user.
 */
export function useOrgMembers(
  orgId: Id<"organizations"> | null,
  userId: string
) {
  const skip = !orgId || !userId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = useQuery(
    orgsApi.getOrgMembers as any,
    skip ? "skip" : { orgId: orgId!, userId }
  );

  return {
    members: result,
    isLoading: result === undefined,
  };
}

// ─── useUserOrgs ──────────────────────────────────────────────────────────────

/**
 * Real-time subscription to org memberships for a specific user.
 *
 * Non-elevated callers may only query their own kindeId.
 *
 * @param kindeId  Kinde user ID of the user to query.
 * @param userId   Kinde user ID of the requesting user (access-tier check).
 */
export function useUserOrgs(kindeId: string, userId: string) {
  const skip = !kindeId || !userId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = useQuery(
    orgsApi.getUserOrgs as any,
    skip ? "skip" : { kindeId, userId }
  );

  return {
    memberships: result,
    isLoading: result === undefined,
  };
}

// ─── useCreateOrganization ────────────────────────────────────────────────────

/**
 * Admin-initiated creation of a new organization group.
 *
 * Wraps `organizations.createOrganization`.  Validates for duplicate active
 * organizations with the same name + type server-side and throws descriptive
 * errors on conflict.
 *
 * Required args: adminId, name, orgType
 * Optional args: description, contactName, contactEmail, kindeOrgCode
 *
 * @returns the Convex document ID of the created org on success.
 *
 * @example
 * const createOrg = useCreateOrganization();
 * const orgId = await createOrg({
 *   adminId: currentUser.id,
 *   name: "Field Operations West",
 *   orgType: "internal",
 *   description: "Western region field ops team",
 * });
 */
export function useCreateOrganization() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useMutation(orgsMutationsApi.createOrganization as any);
}

// ─── useUpdateOrganization ────────────────────────────────────────────────────

/**
 * Admin-initiated update of an existing organization group.
 *
 * Wraps `organizations.updateOrganization`.  Patches only the fields provided
 * — unspecified fields are left unchanged.  Note: orgType cannot be changed
 * after creation to preserve historical membership integrity.
 *
 * Required args: adminId, orgId
 * Optional args: name, description, contactName, contactEmail, kindeOrgCode
 *
 * @example
 * const updateOrg = useUpdateOrganization();
 * await updateOrg({
 *   adminId: currentUser.id,
 *   orgId,
 *   name: "Field Operations West (Updated)",
 *   description: "Updated description",
 * });
 */
export function useUpdateOrganization() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useMutation(orgsMutationsApi.updateOrganization as any);
}

// ─── useAssignUserToOrg ───────────────────────────────────────────────────────

/**
 * Admin-initiated assignment of a user to an organization group.
 *
 * Wraps `organizations.assignUserToOrg`.  Validates contractor role constraints
 * server-side and creates/reactivates the membership row.
 *
 * Required args: adminId, orgId, kindeId, role
 * Optional args: notes, startedAt
 *
 * @example
 * const assignUser = useAssignUserToOrg();
 * await assignUser({
 *   adminId: currentUser.id,
 *   orgId,
 *   kindeId: targetUser.kindeId,
 *   role: "member",
 * });
 */
export function useAssignUserToOrg() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useMutation(orgsMutationsApi.assignUserToOrg as any);
}

// ─── useRemoveUserFromOrg ─────────────────────────────────────────────────────

/**
 * Admin-initiated soft-removal of a user from an organization group.
 *
 * Wraps `organizations.removeUserFromOrg`.  Sets the membership to inactive
 * while preserving the audit trail.
 *
 * Required args: adminId, orgId, kindeId
 * Optional args: notes
 *
 * @example
 * const removeUser = useRemoveUserFromOrg();
 * await removeUser({
 *   adminId: currentUser.id,
 *   orgId,
 *   kindeId: targetUser.kindeId,
 * });
 */
export function useRemoveUserFromOrg() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useMutation(orgsMutationsApi.removeUserFromOrg as any);
}

// ─── useUpdateOrgMemberRole ───────────────────────────────────────────────────

/**
 * Admin-initiated update of a member's org-scoped role.
 *
 * Wraps `organizations.updateOrgMemberRole`.  Changes "member" ↔ "org_admin"
 * for an existing active membership.
 *
 * Required args: adminId, membershipId, role
 *
 * @example
 * const updateRole = useUpdateOrgMemberRole();
 * await updateRole({
 *   adminId: currentUser.id,
 *   membershipId,
 *   role: "org_admin",
 * });
 */
export function useUpdateOrgMemberRole() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useMutation(orgsMutationsApi.updateOrgMemberRole as any);
}
