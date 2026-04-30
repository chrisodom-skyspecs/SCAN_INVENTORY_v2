/**
 * convex/queries/organizations.ts
 *
 * Short-form organization data-access queries for the INVENTORY dashboard
 * and SCAN mobile app.
 *
 * These four named exports are the canonical client-facing read API for
 * organization data.  They complement the full-featured admin mutations and
 * verbose-named helpers in convex/organizations.ts.
 *
 * Registered in the Convex API as: api["queries/organizations"].*
 *
 * Exported queries
 * ────────────────
 *   getOrg         — fetch a single organization by Convex document ID.
 *   listOrgs       — list organizations, with optional type and active filters.
 *   getOrgMembers  — list active members of an organization, joined with user data.
 *   getUserOrgs    — list active org memberships for a specific user.
 *
 * Access control strategy
 * ───────────────────────
 * Organization data is readable by any authenticated user because it is needed
 * for operational workflows (custody handoff recipient pickers, M1 org filter,
 * mission team composition), but the depth of information returned is tiered by
 * caller role and org type:
 *
 *   PUBLIC — any authenticated user
 *     • Active org:    name, orgType, description, isActive
 *     • Active member: kindeId, user name/email, org-scoped role, startedAt
 *     • Own org list:  getUserOrgs where kindeId matches the caller
 *
 *   ELEVATED — admin or operator role
 *     • All PUBLIC fields, plus:
 *       - Org admin fields:       contactName, contactEmail, kindeOrgCode
 *       - Inactive orgs:          included when includeInactive: true
 *       - Membership audit fields: notes, addedById, endedAt
 *       - Any user's org list:    getUserOrgs for any kindeId
 *
 *   ORG TYPE RULES
 *     • contractor orgs: org members (any authenticated user) can also see their
 *       own org's contactName / contactEmail — they work on-site and need this
 *       for coordination.  Internal-org contact info is admin/operator-only.
 *     • internal orgs: member list is visible to all authenticated users because
 *       internal org members are common custody handoff recipients.
 *     • getUserOrgs: non-admin/operator callers may only query their own kindeId;
 *       admin/operator callers may query any user's org list.
 *
 * Client usage
 * ────────────
 *   // Single org lookup (T-panel header, handoff detail)
 *   const org = useQuery(api["queries/organizations"].getOrg, { orgId, userId });
 *
 *   // All active orgs for M1 org filter dropdown
 *   const orgs = useQuery(api["queries/organizations"].listOrgs, { userId });
 *
 *   // Active contractor orgs only (custody handoff "recipient org" picker)
 *   const contractorOrgs = useQuery(
 *     api["queries/organizations"].listOrgs,
 *     { userId, orgType: "contractor" },
 *   );
 *
 *   // Members of an org for the team roster panel
 *   const members = useQuery(
 *     api["queries/organizations"].getOrgMembers,
 *     { orgId, userId },
 *   );
 *
 *   // Org memberships for the current user (profile / handoff context)
 *   const myOrgs = useQuery(
 *     api["queries/organizations"].getUserOrgs,
 *     { kindeId: currentUser.id, userId: currentUser.id },
 *   );
 */

import { query } from "../_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import type { DatabaseReader } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { ROLES, isValidRole } from "../rbac";

// ─── Auth / role helpers ──────────────────────────────────────────────────────

/**
 * Asserts that the calling client has a verified Kinde JWT.
 * Throws [AUTH_REQUIRED] for unauthenticated requests.
 */
async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token. " +
      "Ensure the client is wrapped in ConvexProviderWithAuth and the user is signed in."
    );
  }
  return identity;
}

/**
 * Determine whether the caller (identified by kindeId) holds an elevated role
 * (admin or operator).  Returns `false` rather than throwing when the user is
 * not found or has no recognized roles — this allows callers to gracefully fall
 * back to the PUBLIC access tier instead of blowing up for unelevated users.
 */
async function isElevatedCaller(
  db: DatabaseReader,
  kindeId: string
): Promise<boolean> {
  const user = await db
    .query("users")
    .withIndex("by_kinde_id", (q) => q.eq("kindeId", kindeId))
    .first();

  if (!user || !user.roles) return false;

  const roles = (user.roles as string[]).filter(isValidRole);
  return roles.includes(ROLES.ADMIN) || roles.includes(ROLES.OPERATOR);
}

/**
 * Check whether a user is an active member of a specific organization.
 * Used to decide whether a contractor-org member may see their own org's contact info.
 */
async function isActiveMemberOfOrg(
  db: DatabaseReader,
  kindeId: string,
  orgId: Id<"organizations">
): Promise<boolean> {
  const membership = await db
    .query("orgMemberships")
    .withIndex("by_org_user", (q) =>
      q.eq("orgId", orgId).eq("kindeId", kindeId)
    )
    .first();

  return membership?.isActive === true;
}

// ─── Shared projection types ──────────────────────────────────────────────────

/**
 * Public org fields visible to any authenticated user.
 */
export interface OrgPublic {
  _id: string;
  name: string;
  orgType: "internal" | "contractor";
  description?: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Extended org fields visible to admin / operator callers (and contractor org
 * members for their own org's contact info — see ORG TYPE RULES above).
 */
export interface OrgElevated extends OrgPublic {
  contactName?: string;
  contactEmail?: string;
  kindeOrgCode?: string;
}

/** Union returned by getOrg / listOrgs based on caller role. */
export type OrgRecord = OrgPublic | OrgElevated;

/**
 * Public member fields visible to any authenticated user.
 */
export interface OrgMemberPublic {
  /** Convex document ID of the membership row. */
  membershipId: string;
  kindeId: string;
  orgId: string;
  role: "org_admin" | "member";
  startedAt: number;
  /** User profile fields joined from the users table. */
  user: {
    name: string;
    email: string;
    picture?: string;
    /** System-wide role(s) for display context (e.g. "technician"). */
    roles: string[];
  } | null;
}

/**
 * Extended member fields visible to admin / operator callers.
 */
export interface OrgMemberElevated extends OrgMemberPublic {
  notes?: string;
  addedById?: string;
  endedAt?: number;
}

/** Union returned by getOrgMembers based on caller role. */
export type OrgMemberRecord = OrgMemberPublic | OrgMemberElevated;

/**
 * User-org membership entry returned by getUserOrgs.
 * Always includes the full org record (depth gated per caller role).
 */
export interface UserOrgMembership {
  /** Convex document ID of the membership row. */
  membershipId: string;
  orgId: string;
  role: "org_admin" | "member";
  startedAt: number;
  notes?: string;            // included when caller is admin/operator or querying own data
  org: OrgRecord | null;     // org details, null when org was hard-deleted
}

// ─── Shared row projectors ────────────────────────────────────────────────────

function projectOrgPublic(row: Record<string, unknown>): OrgPublic {
  return {
    _id:         String(row._id),
    name:        row.name as string,
    orgType:     row.orgType as "internal" | "contractor",
    description: row.description as string | undefined,
    isActive:    row.isActive as boolean,
    createdAt:   row.createdAt as number,
    updatedAt:   row.updatedAt as number,
  };
}

function projectOrgElevated(row: Record<string, unknown>): OrgElevated {
  return {
    ...projectOrgPublic(row),
    contactName:  row.contactName as string | undefined,
    contactEmail: row.contactEmail as string | undefined,
    kindeOrgCode: row.kindeOrgCode as string | undefined,
  };
}

function projectMemberPublic(
  membership: Record<string, unknown>,
  user: Record<string, unknown> | null
): OrgMemberPublic {
  return {
    membershipId: String(membership._id),
    kindeId:      membership.kindeId as string,
    orgId:        String(membership.orgId),
    role:         membership.role as "org_admin" | "member",
    startedAt:    membership.startedAt as number,
    user: user
      ? {
          name:    user.name    as string,
          email:   user.email   as string,
          picture: user.picture as string | undefined,
          roles:   ((user.roles ?? []) as string[]).filter(isValidRole),
        }
      : null,
  };
}

function projectMemberElevated(
  membership: Record<string, unknown>,
  user: Record<string, unknown> | null
): OrgMemberElevated {
  return {
    ...projectMemberPublic(membership, user),
    notes:     membership.notes     as string | undefined,
    addedById: membership.addedById as string | undefined,
    endedAt:   membership.endedAt   as number | undefined,
  };
}

// ─── getOrg ───────────────────────────────────────────────────────────────────

/**
 * Fetch a single organization by its Convex document ID.
 *
 * Returns `null` when no organization matches the provided `orgId`.
 *
 * Access control
 * ──────────────
 *   PUBLIC (any authenticated user):
 *     Returns name, orgType, description, isActive, createdAt, updatedAt.
 *
 *   ELEVATED (admin or operator):
 *     Also returns contactName, contactEmail, kindeOrgCode.
 *
 *   CONTRACTOR ORG MEMBER (active membership in a contractor org):
 *     Also returns that org's contactName and contactEmail (on-site coordination).
 *     Does NOT expose kindeOrgCode (SSO config is admin-only).
 *
 * Used by:
 *   • T-panel org detail header
 *   • Custody handoff "recipient org" confirmation card
 *   • Admin org detail sheet (elevated fields)
 *   • SCAN app org info overlay
 *
 * @param orgId   Convex document ID of the organization to fetch.
 * @param userId  Kinde user ID of the requesting user (for access tier).
 *
 * Client usage:
 *   const org = useQuery(
 *     api["queries/organizations"].getOrg,
 *     { orgId, userId: currentUser.id },
 *   );
 *   if (org === undefined) return <OrgSkeleton />;
 *   if (org === null)      return <NotFound />;
 *   return <OrgHeader org={org} />;
 */
export const getOrg = query({
  args: {
    orgId:  v.id("organizations"),
    userId: v.string(),
  },
  handler: async (ctx, { orgId, userId }): Promise<OrgRecord | null> => {
    await requireAuth(ctx);

    const org = await ctx.db.get(orgId);
    if (!org) return null;

    const elevated = await isElevatedCaller(ctx.db, userId);

    if (elevated) {
      // Admin / operator — return all fields including sensitive config.
      return projectOrgElevated(org as unknown as Record<string, unknown>);
    }

    // For contractor orgs, active members can see the contact info of their
    // own org (they need it for on-site coordination).
    if (org.orgType === "contractor") {
      const isMember = await isActiveMemberOfOrg(ctx.db, userId, orgId);
      if (isMember) {
        const projected = projectOrgElevated(org as unknown as Record<string, unknown>);
        // Strip kindeOrgCode — SSO config is admin-only even for members.
        const { kindeOrgCode: _omit, ...rest } = projected;
        void _omit;
        return rest;
      }
    }

    // Default: public fields only.
    return projectOrgPublic(org as unknown as Record<string, unknown>);
  },
});

// ─── listOrgs ─────────────────────────────────────────────────────────────────

/**
 * List organizations, sorted alphabetically by name.
 *
 * By default returns only active organizations.  Pass `includeInactive: true`
 * to include deactivated organizations — this requires admin or operator role.
 *
 * Access control
 * ──────────────
 *   PUBLIC (any authenticated user):
 *     Returns active orgs with public fields (name, orgType, description, isActive).
 *     Requesting includeInactive: true has no effect — inactive orgs are omitted.
 *
 *   ELEVATED (admin or operator):
 *     Returns public fields plus contactName, contactEmail, kindeOrgCode.
 *     Inactive orgs included when includeInactive: true.
 *
 * Used by:
 *   • M1 org filter dropdown (all active orgs)
 *   • Custody handoff "recipient org" picker (active orgs)
 *   • Admin Organization Management list (all orgs, elevated fields)
 *   • Case assignment "organization" field (active orgs)
 *
 * @param userId         Kinde user ID of the requesting user.
 * @param orgType        Optional filter — return only "internal" or "contractor" orgs.
 * @param includeInactive  If true, include inactive (soft-deleted) orgs.
 *                         Only honoured for admin / operator callers.
 *
 * Client usage:
 *   // All active orgs for M1 filter
 *   const orgs = useQuery(
 *     api["queries/organizations"].listOrgs,
 *     { userId },
 *   );
 *
 *   // Active contractor orgs only (handoff picker)
 *   const contractorOrgs = useQuery(
 *     api["queries/organizations"].listOrgs,
 *     { userId, orgType: "contractor" },
 *   );
 *
 *   // All orgs including inactive (admin management UI)
 *   const allOrgs = useQuery(
 *     api["queries/organizations"].listOrgs,
 *     { userId, includeInactive: true },
 *   );
 */
export const listOrgs = query({
  args: {
    userId:          v.string(),
    orgType:         v.optional(
      v.union(v.literal("internal"), v.literal("contractor"))
    ),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, orgType, includeInactive }): Promise<OrgRecord[]> => {
    await requireAuth(ctx);

    const elevated = await isElevatedCaller(ctx.db, userId);

    // Non-admin/operator callers never see inactive orgs regardless of the arg.
    const shouldIncludeInactive = elevated && (includeInactive ?? false);

    let rows: Array<Record<string, unknown>>;

    if (shouldIncludeInactive) {
      // Elevated caller requesting all orgs (active + inactive).
      if (orgType) {
        rows = (await ctx.db
          .query("organizations")
          .withIndex("by_type", (q) => q.eq("orgType", orgType))
          .collect()) as unknown as Array<Record<string, unknown>>;
      } else {
        rows = (await ctx.db
          .query("organizations")
          .collect()) as unknown as Array<Record<string, unknown>>;
      }
    } else {
      // Active orgs only (the common case for all callers).
      if (orgType) {
        rows = (await ctx.db
          .query("organizations")
          .withIndex("by_type_active", (q) =>
            q.eq("orgType", orgType).eq("isActive", true)
          )
          .collect()) as unknown as Array<Record<string, unknown>>;
      } else {
        rows = (await ctx.db
          .query("organizations")
          .withIndex("by_active", (q) => q.eq("isActive", true))
          .collect()) as unknown as Array<Record<string, unknown>>;
      }
    }

    // Sort alphabetically by name.
    rows.sort((a, b) =>
      String(a.name).localeCompare(String(b.name))
    );

    // Project to the appropriate depth based on caller role.
    if (elevated) {
      return rows.map(projectOrgElevated);
    }
    return rows.map(projectOrgPublic);
  },
});

// ─── getOrgMembers ────────────────────────────────────────────────────────────

/**
 * List active members of an organization, joined with user profile data.
 *
 * Returns active membership rows enriched with the corresponding user record
 * (name, email, picture, system roles).  Results are sorted alphabetically by
 * user display name.
 *
 * Access control
 * ──────────────
 * The fields exposed depend on the caller's role AND the org type:
 *
 *   PUBLIC (any authenticated user):
 *     For BOTH org types:
 *       membershipId, kindeId, orgId, role, startedAt
 *       user: { name, email, picture, roles[] }
 *     This is sufficient for custody handoff recipient lists and mission team
 *     displays — callers need to know who is in the org to pick them.
 *
 *   ELEVATED (admin or operator):
 *     All PUBLIC fields, plus:
 *       notes     — membership context note (e.g. "Primary FedEx contact for west region")
 *       addedById — Kinde ID of the admin who added this member
 *       endedAt   — end date (only relevant when fetching inactive members)
 *
 *   ORG TYPE RULES:
 *     • Internal orgs: all authenticated users see the PUBLIC member list.
 *       Internal org members are frequent custody-handoff recipients and their
 *       identities are not sensitive.
 *     • Contractor orgs: same PUBLIC visibility — all authenticated users may
 *       see contractor org members (needed to pick them as handoff recipients
 *       or mission participants).
 *     • The distinction is that ELEVATED fields (notes, addedById) are only
 *       available to admin/operator regardless of org type.
 *
 * Used by:
 *   • Admin "Org Members" panel in Organization Management
 *   • Mission team composition UI (who is in the org?)
 *   • Custody handoff recipient list scoped to an organization
 *   • SCAN app "Select recipient" screen showing org members
 *
 * @param orgId   Convex document ID of the organization.
 * @param userId  Kinde user ID of the requesting user (for access tier).
 *
 * Client usage:
 *   const members = useQuery(
 *     api["queries/organizations"].getOrgMembers,
 *     { orgId, userId: currentUser.id },
 *   );
 *   if (members === undefined) return <MemberListSkeleton />;
 *   return <OrgMemberList members={members} />;
 */
export const getOrgMembers = query({
  args: {
    orgId:  v.id("organizations"),
    userId: v.string(),
  },
  handler: async (ctx, { orgId, userId }): Promise<OrgMemberRecord[]> => {
    await requireAuth(ctx);

    // Verify the organization exists before querying memberships.
    const org = await ctx.db.get(orgId);
    if (!org) {
      throw new Error(
        `[NOT_FOUND] Organization "${orgId}" does not exist.`
      );
    }

    const elevated = await isElevatedCaller(ctx.db, userId);

    // Load active memberships via the compound index.
    const memberships = (await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_active", (q) =>
        q.eq("orgId", orgId).eq("isActive", true)
      )
      .collect()) as unknown as Array<Record<string, unknown>>;

    // Join each membership with the user record.
    const results = await Promise.all(
      memberships.map(async (membership) => {
        const user = (await ctx.db
          .query("users")
          .withIndex("by_kinde_id", (q) =>
            q.eq("kindeId", membership.kindeId as string)
          )
          .first()) as unknown as Record<string, unknown> | null;

        return { membership, user };
      })
    );

    // Sort by user display name (fall back to kindeId for users without a name).
    results.sort((a, b) => {
      const nameA = (a.user?.name as string | undefined) ?? (a.membership.kindeId as string);
      const nameB = (b.user?.name as string | undefined) ?? (b.membership.kindeId as string);
      return nameA.localeCompare(nameB);
    });

    // Project to the appropriate depth based on caller role.
    //
    // Elevated fields (notes, addedById) are admin/operator-only regardless of
    // org type — they contain internal operational metadata not appropriate for
    // general field users (technician / pilot).
    if (elevated) {
      return results.map(({ membership, user }) =>
        projectMemberElevated(membership, user)
      );
    }

    return results.map(({ membership, user }) =>
      projectMemberPublic(membership, user)
    );
  },
});

// ─── getUserOrgs ──────────────────────────────────────────────────────────────

/**
 * List active org memberships for a specific user.
 *
 * Returns the user's active organization memberships joined with the
 * organization document, sorted alphabetically by organization name.
 *
 * Access control
 * ──────────────
 * This query is gated on the relationship between `userId` (the caller) and
 * `kindeId` (the subject of the query):
 *
 *   SELF-QUERY (userId === kindeId):
 *     Any authenticated user may query their own org list.
 *     Returns membership role, startedAt, notes (own membership context),
 *     and public org fields.
 *
 *   CROSS-USER QUERY (userId !== kindeId):
 *     ELEVATED callers (admin / operator) may query any user's org list.
 *     Non-elevated callers attempting to query another user's orgs receive
 *     an [ACCESS_DENIED] error — this prevents one field user from
 *     enumerating another's org memberships.
 *
 *   ORG TYPE RULES:
 *     • For BOTH org types, elevated callers also see kindeOrgCode,
 *       contactName, and contactEmail on the joined org record.
 *     • Non-elevated callers see public org fields only (name, orgType,
 *       description, isActive) regardless of org type.
 *     • Exception: contractor-org members see their own org's contactName /
 *       contactEmail via the getOrg query (not this one — getUserOrgs returns
 *       a compact view by design).
 *
 * Used by:
 *   • User profile "Organizations" section
 *   • M1 org filter pre-selection (user's own org)
 *   • Custody handoff "from org" context (recipient's org list)
 *   • Admin user detail sheet (elevated caller sees all user's orgs)
 *
 * @param kindeId  Kinde user ID of the user whose org list to fetch.
 * @param userId   Kinde user ID of the requesting user (for access-tier checks).
 *
 * Client usage:
 *   // Own org list (user profile, M1 pre-selection)
 *   const myOrgs = useQuery(
 *     api["queries/organizations"].getUserOrgs,
 *     { kindeId: currentUser.id, userId: currentUser.id },
 *   );
 *
 *   // Admin querying another user's orgs
 *   const userOrgs = useQuery(
 *     api["queries/organizations"].getUserOrgs,
 *     { kindeId: targetUserId, userId: adminUser.id },
 *   );
 */
export const getUserOrgs = query({
  args: {
    kindeId: v.string(),  // user whose orgs to fetch
    userId:  v.string(),  // caller / requesting user
  },
  handler: async (ctx, { kindeId, userId }): Promise<UserOrgMembership[]> => {
    await requireAuth(ctx);

    const isSelf     = userId === kindeId;
    const elevated   = await isElevatedCaller(ctx.db, userId);

    // Non-elevated callers may only query their own org list.
    if (!isSelf && !elevated) {
      throw new Error(
        "[ACCESS_DENIED] You may only query your own organization memberships. " +
        "Admin or operator role is required to query another user's memberships."
      );
    }

    // Load active memberships for the target user.
    const memberships = (await ctx.db
      .query("orgMemberships")
      .withIndex("by_user_active", (q) =>
        q.eq("kindeId", kindeId).eq("isActive", true)
      )
      .collect()) as unknown as Array<Record<string, unknown>>;

    // Join each membership with the organization record.
    // The orgId field is typed as Id<"organizations"> in the schema; we must
    // cast through unknown to satisfy TypeScript when working with the raw row.
    const results = await Promise.all(
      memberships.map(async (membership) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const org = (await ctx.db.get(membership.orgId as any)) as unknown as Record<string, unknown> | null;

        return { membership, org };
      })
    );

    // Filter out memberships whose org was hard-deleted (edge case).
    const valid = results.filter((r) => r.org !== null);

    // Sort alphabetically by org name.
    valid.sort((a, b) =>
      String(a.org?.name ?? "").localeCompare(String(b.org?.name ?? ""))
    );

    // Project based on caller role.
    return valid.map(({ membership, org }) => {
      const projectedOrg: OrgRecord | null = org
        ? elevated
          ? projectOrgElevated(org)
          : projectOrgPublic(org)
        : null;

      const entry: UserOrgMembership = {
        membershipId: String(membership._id),
        orgId:        String(membership.orgId),
        role:         membership.role as "org_admin" | "member",
        startedAt:    membership.startedAt as number,
        org:          projectedOrg,
      };

      // notes: include for self-queries and elevated callers.
      // Callers querying their own membership see their own context notes.
      // Elevated callers (admin/operator) see all notes for management purposes.
      if ((isSelf || elevated) && membership.notes !== undefined) {
        entry.notes = membership.notes as string;
      }

      return entry;
    });
  },
});

// ─── listOrgsWithMemberCount ──────────────────────────────────────────────────

/**
 * List organizations with their active member counts.
 *
 * Intended for the admin Org Groups list view — renders a paginated,
 * searchable table of org groups showing name, orgType, and member count.
 *
 * Access control
 * ──────────────
 * Any authenticated user may list active orgs (PUBLIC tier).
 * Elevated callers (admin/operator) also see inactive orgs when
 * `includeInactive: true` is passed.
 *
 * @param userId          Kinde user ID of the requesting user.
 * @param orgType         Optional type filter ("internal" | "contractor").
 * @param includeInactive Include inactive orgs (admin/operator only).
 *
 * Client usage:
 *   const orgs = useQuery(
 *     api["queries/organizations"].listOrgsWithMemberCount,
 *     { userId },
 *   );
 */
export const listOrgsWithMemberCount = query({
  args: {
    userId:          v.string(),
    orgType:         v.optional(
      v.union(v.literal("internal"), v.literal("contractor"))
    ),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, orgType, includeInactive }): Promise<
    Array<OrgRecord & { memberCount: number }>
  > => {
    await requireAuth(ctx);

    const elevated = await isElevatedCaller(ctx.db, userId);

    // Non-elevated callers never see inactive orgs.
    const shouldIncludeInactive = elevated && (includeInactive ?? false);

    let rows: Array<Record<string, unknown>>;

    if (shouldIncludeInactive) {
      if (orgType) {
        rows = (await ctx.db
          .query("organizations")
          .withIndex("by_type", (q) => q.eq("orgType", orgType))
          .collect()) as unknown as Array<Record<string, unknown>>;
      } else {
        rows = (await ctx.db
          .query("organizations")
          .collect()) as unknown as Array<Record<string, unknown>>;
      }
    } else {
      if (orgType) {
        rows = (await ctx.db
          .query("organizations")
          .withIndex("by_type_active", (q) =>
            q.eq("orgType", orgType).eq("isActive", true)
          )
          .collect()) as unknown as Array<Record<string, unknown>>;
      } else {
        rows = (await ctx.db
          .query("organizations")
          .withIndex("by_active", (q) => q.eq("isActive", true))
          .collect()) as unknown as Array<Record<string, unknown>>;
      }
    }

    // Sort alphabetically by name.
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    // Fetch active member counts in parallel.
    const rowsWithCount = await Promise.all(
      rows.map(async (row) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const orgId = row._id as any;
        const memberships = await ctx.db
          .query("orgMemberships")
          .withIndex("by_org_active", (q) =>
            q.eq("orgId", orgId).eq("isActive", true)
          )
          .collect();
        const memberCount = memberships.length;

        const projected = elevated
          ? projectOrgElevated(row)
          : projectOrgPublic(row);

        return { ...projected, memberCount };
      })
    );

    return rowsWithCount;
  },
});
