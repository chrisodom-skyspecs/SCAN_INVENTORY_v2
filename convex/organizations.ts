/**
 * convex/organizations.ts
 *
 * Organization and membership management for the SkySpecs INVENTORY + SCAN system.
 *
 * Organizations represent logical groupings of people within the single-tenant
 * SkySpecs environment.  There are two types:
 *
 *   "internal"   — SkySpecs staff teams (Operations, Field Logistics, Engineering)
 *   "contractor" — External companies or independent contractors performing
 *                  field work on behalf of SkySpecs
 *
 * Users belong to organizations via `orgMemberships`.  Organization membership
 * is independent of system-wide Kinde roles (admin / technician / pilot) and
 * controls contextual grouping in the M1 org filter, custody assignments, and
 * mission team composition.
 *
 * Public queries (used by dashboard / SCAN client components):
 *   listOrganizations          — list active organizations (with optional type filter)
 *   listAllOrganizations       — list ALL organizations including inactive (admin UI)
 *   getOrganizationById        — get a single organization by Convex ID
 *   listOrgMembers             — list active members of an organization
 *   listAllOrgMembers          — list all members (active + historical) for audit
 *   getUserOrganizations       — get active org memberships for a user
 *   getMembershipByOrgUser     — point-lookup: is user X in org Y?
 *
 * Public mutations (require appropriate system role via assertPermission):
 *   createOrganization         — create a new organization (admin only)
 *   updateOrganization         — update organization details (admin only)
 *   deactivateOrganization     — soft-delete an organization (admin only)
 *   addOrgMember               — add a user to an organization (admin only)
 *   updateOrgMemberRole        — change a member's org-scoped role (admin only)
 *   removeOrgMember            — soft-remove a user from an organization (admin only)
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Auth } from "convex/server";
import { requireAdmin, assertPermission, OPERATIONS } from "./rbac";
import {
  CONTRACTOR_FORBIDDEN_ROLES as _CONTRACTOR_FORBIDDEN_ROLES,
  validateContractorOrgAssignment,
  contractorRoleViolationMessage,
} from "./lib/org-role-policy";

// ─── Auth guard ────────────────────────────────────────────────────────────────

async function requireAuthIdentity(auth: Auth) {
  const identity = await auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token."
    );
  }
  return identity;
}

// ─── Queries ───────────────────────────────────────────────────────────────────

/**
 * List active organizations, with optional filtering by org type.
 *
 * Returns organizations sorted alphabetically by name.
 * Used by:
 *   - M1 org filter dropdown (filter case pins by organization)
 *   - Custody handoff "recipient organization" picker
 *   - Case assignment "organization" field
 *   - INVENTORY admin → Organization management list view
 *
 * Excludes inactive (soft-deleted) organizations.
 */
export const listOrganizations = query({
  args: {
    orgType: v.optional(
      v.union(v.literal("internal"), v.literal("contractor"))
    ),
  },
  handler: async (ctx, { orgType }) => {
    await requireAuthIdentity(ctx.auth);

    let orgs;
    if (orgType) {
      // Filter by both type and active status using the compound index
      orgs = await ctx.db
        .query("organizations")
        .withIndex("by_type_active", (q) =>
          q.eq("orgType", orgType).eq("isActive", true)
        )
        .collect();
    } else {
      // All active organizations
      orgs = await ctx.db
        .query("organizations")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .collect();
    }

    return orgs.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * List ALL organizations including inactive ones.
 * Used by admin Organization Management UI for full inventory view.
 */
export const listAllOrganizations = query({
  args: {
    orgType: v.optional(
      v.union(v.literal("internal"), v.literal("contractor"))
    ),
  },
  handler: async (ctx, { orgType }) => {
    await requireAuthIdentity(ctx.auth);

    let orgs;
    if (orgType) {
      orgs = await ctx.db
        .query("organizations")
        .withIndex("by_type", (q) => q.eq("orgType", orgType))
        .collect();
    } else {
      orgs = await ctx.db.query("organizations").collect();
    }

    return orgs.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Get a single organization by its Convex document ID.
 * Returns null when the ID does not match any organization.
 */
export const getOrganizationById = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireAuthIdentity(ctx.auth);
    return ctx.db.get(orgId);
  },
});

/**
 * List active members of an organization.
 *
 * Returns membership rows joined with the corresponding user record so the
 * caller can display name, email, avatar, and system role alongside the
 * org-scoped role.
 *
 * Sorted by user display name ascending.
 *
 * Used by:
 *   - Admin "Org Members" panel in Organization Management
 *   - Mission team composition UI (who is in the org?)
 *   - Custody handoff recipient list scoped to an organization
 */
export const listOrgMembers = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireAuthIdentity(ctx.auth);

    // Load active memberships for the org using the compound index
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_active", (q) =>
        q.eq("orgId", orgId).eq("isActive", true)
      )
      .collect();

    // Join each membership with the user record
    const results = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_kinde_id", (q) => q.eq("kindeId", membership.kindeId))
          .first();

        return {
          membership,
          user: user ?? null,
        };
      })
    );

    // Sort by user display name
    return results.sort((a, b) => {
      const nameA = a.user?.name ?? a.membership.kindeId;
      const nameB = b.user?.name ?? b.membership.kindeId;
      return nameA.localeCompare(nameB);
    });
  },
});

/**
 * List ALL members of an organization including historical (inactive) ones.
 * Used by admin audit view and membership history panel.
 */
export const listAllOrgMembers = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireAuthIdentity(ctx.auth);

    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    const results = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db
          .query("users")
          .withIndex("by_kinde_id", (q) => q.eq("kindeId", membership.kindeId))
          .first();

        return {
          membership,
          user: user ?? null,
        };
      })
    );

    // Sort: active members first, then inactive; within each group by name
    return results.sort((a, b) => {
      if (a.membership.isActive !== b.membership.isActive) {
        return a.membership.isActive ? -1 : 1;
      }
      const nameA = a.user?.name ?? a.membership.kindeId;
      const nameB = b.user?.name ?? b.membership.kindeId;
      return nameA.localeCompare(nameB);
    });
  },
});

/**
 * Get active org memberships for a user.
 *
 * Returns organization documents joined with the membership row for each
 * active organization the user belongs to.
 *
 * Used by:
 *   - User profile "Organizations" section
 *   - M1 org filter to pre-select the user's own organization
 *   - Custody handoff to show recipient's organizational context
 */
export const getUserOrganizations = query({
  args: { kindeId: v.string() },
  handler: async (ctx, { kindeId }) => {
    await requireAuthIdentity(ctx.auth);

    // Load active memberships for this user
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user_active", (q) =>
        q.eq("kindeId", kindeId).eq("isActive", true)
      )
      .collect();

    // Join each membership with the organization document
    const results = await Promise.all(
      memberships.map(async (membership) => {
        const org = await ctx.db.get(membership.orgId);
        return {
          membership,
          org: org ?? null,
        };
      })
    );

    // Filter out memberships where the org was hard-deleted (edge case)
    return results
      .filter((r) => r.org !== null)
      .sort((a, b) => {
        const nameA = a.org?.name ?? "";
        const nameB = b.org?.name ?? "";
        return nameA.localeCompare(nameB);
      });
  },
});

/**
 * Point-lookup: get a user's membership row in a specific organization.
 *
 * Returns the membership document (active or inactive) or null when no
 * membership exists.
 *
 * Used by:
 *   - addOrgMember guard (prevent duplicate memberships)
 *   - Admin UI membership status badge ("Active" / "Inactive" / "Not a member")
 */
export const getMembershipByOrgUser = query({
  args: {
    orgId:   v.id("organizations"),
    kindeId: v.string(),
  },
  handler: async (ctx, { orgId, kindeId }) => {
    await requireAuthIdentity(ctx.auth);

    return ctx.db
      .query("orgMemberships")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", orgId).eq("kindeId", kindeId)
      )
      .first();
  },
});

// ─── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Create a new organization.
 *
 * Admin only.  Validates that no active organization with the same name and
 * type already exists before inserting to prevent accidental duplicates.
 *
 * @returns The Convex document ID of the newly created organization.
 */
export const createOrganization = mutation({
  args: {
    adminId:      v.string(),       // Kinde user ID of the acting admin
    name:         v.string(),
    orgType:      v.union(v.literal("internal"), v.literal("contractor")),
    description:  v.optional(v.string()),
    contactName:  v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    kindeOrgCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Require admin system role
    await requireAdmin(ctx.db, args.adminId);

    const trimmedName = args.name.trim();
    if (!trimmedName) {
      throw new Error("[VALIDATION] Organization name cannot be empty.");
    }

    // Guard against duplicate active organizations with the same name + type
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_name", (q) => q.eq("name", trimmedName))
      .filter((q) =>
        q.and(
          q.eq(q.field("orgType"), args.orgType),
          q.eq(q.field("isActive"), true)
        )
      )
      .first();

    if (existing) {
      throw new Error(
        `[CONFLICT] An active ${args.orgType} organization named "${trimmedName}" already exists.`
      );
    }

    const now = Date.now();

    const orgId = await ctx.db.insert("organizations", {
      name:         trimmedName,
      orgType:      args.orgType,
      description:  args.description,
      isActive:     true,
      contactName:  args.contactName,
      contactEmail: args.contactEmail,
      kindeOrgCode: args.kindeOrgCode,
      createdAt:    now,
      updatedAt:    now,
    });

    return orgId;
  },
});

/**
 * Update organization details.
 *
 * Admin only.  Patches only the fields provided — unspecified fields are left
 * unchanged.  The `orgType` cannot be changed after creation to preserve the
 * integrity of historical membership records.
 */
export const updateOrganization = mutation({
  args: {
    adminId:      v.string(),
    orgId:        v.id("organizations"),
    name:         v.optional(v.string()),
    description:  v.optional(v.string()),
    contactName:  v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    kindeOrgCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx.db, args.adminId);

    const org = await ctx.db.get(args.orgId);
    if (!org) {
      throw new Error(`[NOT_FOUND] Organization "${args.orgId}" does not exist.`);
    }

    const patch: Partial<{
      name: string;
      description: string;
      contactName: string;
      contactEmail: string;
      kindeOrgCode: string;
      updatedAt: number;
    }> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const trimmedName = args.name.trim();
      if (!trimmedName) {
        throw new Error("[VALIDATION] Organization name cannot be empty.");
      }
      // Guard: no other active org with the same name + type
      const conflict = await ctx.db
        .query("organizations")
        .withIndex("by_name", (q) => q.eq("name", trimmedName))
        .filter((q) =>
          q.and(
            q.eq(q.field("orgType"), org.orgType),
            q.eq(q.field("isActive"), true),
            q.neq(q.field("_id"), args.orgId)
          )
        )
        .first();

      if (conflict) {
        throw new Error(
          `[CONFLICT] An active ${org.orgType} organization named "${trimmedName}" already exists.`
        );
      }
      patch.name = trimmedName;
    }

    if (args.description !== undefined) patch.description = args.description;
    if (args.contactName  !== undefined) patch.contactName  = args.contactName;
    if (args.contactEmail !== undefined) patch.contactEmail = args.contactEmail;
    if (args.kindeOrgCode !== undefined) patch.kindeOrgCode = args.kindeOrgCode;

    await ctx.db.patch(args.orgId, patch);
  },
});

/**
 * Soft-delete (deactivate) an organization.
 *
 * Admin only.  Sets `isActive = false`; does NOT hard-delete the row so that
 * historical custody records, mission memberships, and audit trails that
 * reference this organization remain consistent.
 *
 * All active memberships in the organization are also soft-removed to prevent
 * orphaned active memberships pointing to an inactive org.
 */
export const deactivateOrganization = mutation({
  args: {
    adminId: v.string(),
    orgId:   v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx.db, args.adminId);

    const org = await ctx.db.get(args.orgId);
    if (!org) {
      throw new Error(`[NOT_FOUND] Organization "${args.orgId}" does not exist.`);
    }
    if (!org.isActive) {
      // Idempotent — already inactive
      return;
    }

    const now = Date.now();

    // Deactivate the organization
    await ctx.db.patch(args.orgId, {
      isActive:  false,
      updatedAt: now,
    });

    // Soft-remove all active memberships
    const activeMemberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_active", (q) =>
        q.eq("orgId", args.orgId).eq("isActive", true)
      )
      .collect();

    await Promise.all(
      activeMemberships.map((m) =>
        ctx.db.patch(m._id, {
          isActive:  false,
          endedAt:   now,
          updatedAt: now,
        })
      )
    );
  },
});

/**
 * Reactivate a previously deactivated organization.
 *
 * Admin only.  Useful when an organization was deactivated by mistake or a
 * contractor returns after a gap.  Does NOT re-activate historical memberships
 * — those must be added individually via `addOrgMember`.
 */
export const reactivateOrganization = mutation({
  args: {
    adminId: v.string(),
    orgId:   v.id("organizations"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx.db, args.adminId);

    const org = await ctx.db.get(args.orgId);
    if (!org) {
      throw new Error(`[NOT_FOUND] Organization "${args.orgId}" does not exist.`);
    }
    if (org.isActive) {
      return; // already active — idempotent
    }

    await ctx.db.patch(args.orgId, {
      isActive:  true,
      updatedAt: Date.now(),
    });
  },
});

// ─── Membership mutations ──────────────────────────────────────────────────────

/**
 * Add a user to an organization.
 *
 * Admin only.  If the user has an inactive membership row for this org,
 * it is reactivated instead of creating a duplicate.  If the user already
 * has an active membership the call is a no-op (idempotent).
 *
 * @returns The Convex document ID of the membership row (new or reactivated).
 */
export const addOrgMember = mutation({
  args: {
    adminId:  v.string(),   // acting admin's Kinde user ID
    orgId:    v.id("organizations"),
    kindeId:  v.string(),   // Kinde user ID of the user to add
    role:     v.union(v.literal("org_admin"), v.literal("member")),
    notes:    v.optional(v.string()),
    startedAt: v.optional(v.number()),  // epoch ms; defaults to now
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx.db, args.adminId);

    // Verify the organization exists and is active
    const org = await ctx.db.get(args.orgId);
    if (!org) {
      throw new Error(`[NOT_FOUND] Organization "${args.orgId}" does not exist.`);
    }
    if (!org.isActive) {
      throw new Error(
        `[VALIDATION] Cannot add member to inactive organization "${org.name}". ` +
        `Reactivate the organization first.`
      );
    }

    // Verify the user exists in the system
    const user = await ctx.db
      .query("users")
      .withIndex("by_kinde_id", (q) => q.eq("kindeId", args.kindeId))
      .first();
    if (!user) {
      throw new Error(
        `[NOT_FOUND] User "${args.kindeId}" is not registered. ` +
        `The user must complete their first login before being added to an organization.`
      );
    }

    const now = Date.now();
    const effectiveStartedAt = args.startedAt ?? now;

    // Check for an existing membership row (active or inactive)
    const existingMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", args.orgId).eq("kindeId", args.kindeId)
      )
      .first();

    if (existingMembership) {
      if (existingMembership.isActive) {
        // Already an active member — idempotent, optionally update role
        if (existingMembership.role !== args.role) {
          await ctx.db.patch(existingMembership._id, {
            role:      args.role,
            notes:     args.notes ?? existingMembership.notes,
            updatedAt: now,
          });
        }
        return existingMembership._id;
      }

      // Reactivate the existing (inactive) membership
      await ctx.db.patch(existingMembership._id, {
        isActive:  true,
        role:      args.role,
        startedAt: effectiveStartedAt,
        endedAt:   undefined,
        notes:     args.notes ?? existingMembership.notes,
        addedById: args.adminId,
        updatedAt: now,
      });

      return existingMembership._id;
    }

    // Create a new membership row
    const membershipId = await ctx.db.insert("orgMemberships", {
      kindeId:   args.kindeId,
      orgId:     args.orgId,
      role:      args.role,
      isActive:  true,
      startedAt: effectiveStartedAt,
      endedAt:   undefined,
      notes:     args.notes,
      addedById: args.adminId,
      createdAt: now,
      updatedAt: now,
    });

    return membershipId;
  },
});

/**
 * Update a member's organization-scoped role.
 *
 * Admin only.  Changes "member" ↔ "org_admin" for an existing active
 * membership.  Does not affect the user's system-wide Kinde role.
 */
export const updateOrgMemberRole = mutation({
  args: {
    adminId:      v.string(),
    membershipId: v.id("orgMemberships"),
    role:         v.union(v.literal("org_admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx.db, args.adminId);

    const membership = await ctx.db.get(args.membershipId);
    if (!membership) {
      throw new Error(`[NOT_FOUND] Membership "${args.membershipId}" does not exist.`);
    }
    if (!membership.isActive) {
      throw new Error(
        `[VALIDATION] Cannot update role on an inactive membership. ` +
        `Reactivate the membership first via addOrgMember.`
      );
    }

    await ctx.db.patch(args.membershipId, {
      role:      args.role,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Soft-remove a user from an organization.
 *
 * Admin only.  Sets `isActive = false` and stamps `endedAt`.
 * The membership row is retained for audit trail purposes.
 *
 * This is idempotent — removing an already-inactive member is a no-op.
 */
export const removeOrgMember = mutation({
  args: {
    adminId:      v.string(),
    membershipId: v.id("orgMemberships"),
    notes:        v.optional(v.string()),  // optional reason for removal
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx.db, args.adminId);

    const membership = await ctx.db.get(args.membershipId);
    if (!membership) {
      throw new Error(`[NOT_FOUND] Membership "${args.membershipId}" does not exist.`);
    }

    if (!membership.isActive) {
      return; // idempotent — already inactive
    }

    const now = Date.now();

    await ctx.db.patch(args.membershipId, {
      isActive:  false,
      endedAt:   now,
      notes:     args.notes ?? membership.notes,
      updatedAt: now,
    });
  },
});

// ─── Contractor-aware membership mutations ─────────────────────────────────────

/**
 * Re-export the contractor forbidden roles constant so callers that import from
 * convex/organizations.ts (e.g., the admin UI) can reference the policy without
 * also importing from convex/lib/org-role-policy.ts.
 *
 * The canonical definition lives in convex/lib/org-role-policy.ts (pure module,
 * unit-testable) and is aliased here for ergonomic re-export.
 */
export const CONTRACTOR_FORBIDDEN_ROLES: ReadonlySet<string> = _CONTRACTOR_FORBIDDEN_ROLES;

/**
 * assignUserToOrg — assign a user to an organization with contractor role validation.
 *
 * Provides a higher-level alternative to `addOrgMember` that enforces the
 * architectural constraint: **contractor-type organizations may NOT contain
 * users who hold internal-only system roles** (admin or operator).
 *
 * These roles represent SkySpecs back-office / management personnel and carry
 * system-wide permissions that are inappropriate for external contractor org
 * membership.  Field roles (technician, pilot) are allowed in contractor orgs.
 *
 * Validation steps (in order):
 *   1. Caller must be an admin.
 *   2. Target organization must exist and be active.
 *   3. Target user must exist in the `users` table.
 *   4. If org.orgType === "contractor", user must NOT hold any role in
 *      CONTRACTOR_FORBIDDEN_ROLES (admin, operator).
 *   5. If the user already has an active membership, update role if needed
 *      (idempotent update — no duplicate created).
 *   6. If the user has an inactive membership, reactivate it.
 *   7. Otherwise, create a new membership row.
 *
 * Error prefixes:
 *   [ACCESS_DENIED]  — caller is not an admin.
 *   [NOT_FOUND]      — org or user does not exist.
 *   [VALIDATION]     — org is inactive.
 *   [CONTRACTOR_ROLE_VIOLATION] — user holds an internal-only role that is
 *                                  incompatible with contractor org membership.
 *
 * @returns The Convex document ID of the membership row (new or reactivated).
 *
 * Admin only.
 */
export const assignUserToOrg = mutation({
  args: {
    adminId:   v.string(),              // Kinde user ID of the acting admin
    orgId:     v.id("organizations"),   // target organization
    kindeId:   v.string(),              // Kinde user ID of the user to assign
    role:      v.union(v.literal("org_admin"), v.literal("member")),
    notes:     v.optional(v.string()),  // optional context for the membership
    startedAt: v.optional(v.number()), // epoch ms; defaults to now
  },
  handler: async (ctx, args) => {
    // ── 1. Require admin system role ────────────────────────────────────────────
    await requireAdmin(ctx.db, args.adminId);

    // ── 2. Validate organization ────────────────────────────────────────────────
    const org = await ctx.db.get(args.orgId);
    if (!org) {
      throw new Error(
        `[NOT_FOUND] Organization "${args.orgId}" does not exist.`
      );
    }
    if (!org.isActive) {
      throw new Error(
        `[VALIDATION] Cannot assign member to inactive organization "${org.name}". ` +
        `Reactivate the organization first.`
      );
    }

    // ── 3. Validate user ────────────────────────────────────────────────────────
    const user = await ctx.db
      .query("users")
      .withIndex("by_kinde_id", (q) => q.eq("kindeId", args.kindeId))
      .first();

    if (!user) {
      throw new Error(
        `[NOT_FOUND] User "${args.kindeId}" is not registered. ` +
        `The user must complete their first login before being assigned to an organization.`
      );
    }

    // ── 4. Contractor role constraint ────────────────────────────────────────────
    //
    // Contractor organizations may only contain users with field roles
    // (technician, pilot).  Internal-only roles (admin, operator) represent
    // SkySpecs back-office personnel and carry permissions that should not
    // be accessible through an external contractor org membership.
    const userSystemRoles: string[] = ((user.roles ?? []) as string[]);
    const contractorCheck = validateContractorOrgAssignment(
      org.orgType,
      userSystemRoles
    );

    if (!contractorCheck.valid) {
      throw new Error(
        contractorRoleViolationMessage(
          user.name,
          user.email,
          org.name,
          contractorCheck.forbiddenRoles
        )
      );
    }

    // ── 5–7. Create, reactivate, or idempotently update membership ─────────────
    const now = Date.now();
    const effectiveStartedAt = args.startedAt ?? now;

    const existingMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", args.orgId).eq("kindeId", args.kindeId)
      )
      .first();

    if (existingMembership) {
      if (existingMembership.isActive) {
        // Already an active member — idempotent; update role/notes if changed
        if (
          existingMembership.role !== args.role ||
          (args.notes !== undefined && existingMembership.notes !== args.notes)
        ) {
          await ctx.db.patch(existingMembership._id, {
            role:      args.role,
            notes:     args.notes ?? existingMembership.notes,
            updatedAt: now,
          });
        }
        return existingMembership._id;
      }

      // Reactivate the existing (inactive) membership
      await ctx.db.patch(existingMembership._id, {
        isActive:  true,
        role:      args.role,
        startedAt: effectiveStartedAt,
        endedAt:   undefined,
        notes:     args.notes ?? existingMembership.notes,
        addedById: args.adminId,
        updatedAt: now,
      });

      return existingMembership._id;
    }

    // No prior membership row — create a new one
    const membershipId = await ctx.db.insert("orgMemberships", {
      kindeId:   args.kindeId,
      orgId:     args.orgId,
      role:      args.role,
      isActive:  true,
      startedAt: effectiveStartedAt,
      endedAt:   undefined,
      notes:     args.notes,
      addedById: args.adminId,
      createdAt: now,
      updatedAt: now,
    });

    return membershipId;
  },
});

/**
 * removeUserFromOrg — soft-remove a user from an organization by kindeId.
 *
 * Higher-level complement to `removeOrgMember` that accepts (orgId, kindeId)
 * rather than (membershipId), making it more natural for callers who know
 * which user they want to remove but not the internal membership row ID.
 *
 * The membership row is retained with `isActive = false` and `endedAt` stamped
 * so that historical audit trails (custody records, mission participation) that
 * reference the membership remain consistent.
 *
 * Validation steps (in order):
 *   1. Caller must be an admin.
 *   2. Target organization must exist.
 *   3. An active membership for (orgId, kindeId) must exist.
 *
 * This mutation is idempotent — if the user is already inactive in the org,
 * the call is a no-op (no error thrown).
 *
 * Error prefixes:
 *   [ACCESS_DENIED]  — caller is not an admin.
 *   [NOT_FOUND]      — org does not exist, or user has no membership in this org.
 *
 * Admin only.
 */
export const removeUserFromOrg = mutation({
  args: {
    adminId: v.string(),             // Kinde user ID of the acting admin
    orgId:   v.id("organizations"),  // organization to remove the user from
    kindeId: v.string(),             // Kinde user ID of the user to remove
    notes:   v.optional(v.string()), // optional reason / context for the removal
  },
  handler: async (ctx, args) => {
    // ── 1. Require admin system role ────────────────────────────────────────────
    await requireAdmin(ctx.db, args.adminId);

    // ── 2. Validate organization exists ─────────────────────────────────────────
    const org = await ctx.db.get(args.orgId);
    if (!org) {
      throw new Error(
        `[NOT_FOUND] Organization "${args.orgId}" does not exist.`
      );
    }

    // ── 3. Locate the membership row ─────────────────────────────────────────────
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org_user", (q) =>
        q.eq("orgId", args.orgId).eq("kindeId", args.kindeId)
      )
      .first();

    if (!membership) {
      throw new Error(
        `[NOT_FOUND] User "${args.kindeId}" is not (and has never been) a member ` +
        `of organization "${org.name}".`
      );
    }

    if (!membership.isActive) {
      // Already inactive — idempotent no-op
      return;
    }

    // ── 4. Soft-remove the membership ────────────────────────────────────────────
    const now = Date.now();

    await ctx.db.patch(membership._id, {
      isActive:  false,
      endedAt:   now,
      notes:     args.notes ?? membership.notes,
      updatedAt: now,
    });
  },
});
