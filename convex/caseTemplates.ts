/**
 * convex/caseTemplates.ts
 *
 * Public query functions for case template (kit type) subscriptions.
 *
 * Case templates define the predefined packing lists (manifests) for equipment
 * cases.  They are managed via the admin UI and applied to cases to generate
 * the manifest items that field technicians inspect via the SCAN mobile app.
 *
 * These queries are callable from the client via `useQuery` (convex/react) and
 * provide real-time reactive updates to the INVENTORY dashboard and the SCAN
 * mobile app.  Convex re-runs any subscribed query automatically whenever the
 * underlying `caseTemplates` rows change — no polling required.
 *
 * Query functions:
 *   listCaseTemplates    — all active templates; used for kit filter dropdowns
 *                          in M1/M2 map toolbar and SCAN app case creation
 *   getCaseTemplateById  — full template document including item list; used
 *                          when applying a template to a case
 *
 * Index usage:
 *   listCaseTemplates    → by_active index O(log n + |active templates|)
 *   getCaseTemplateById  → O(1) primary-key lookup
 *
 * Client usage example:
 *   const templates = useQuery(api.caseTemplates.listCaseTemplates, {});
 *   // → [{ _id: "...", name: "Field Inspection Kit", itemCount: 12 }, ...]
 */

import { query } from "./_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";

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
 * Lightweight template projection returned by listCaseTemplates.
 * Omits the full item list for bandwidth efficiency in dropdown scenarios.
 */
export interface CaseTemplateSummary {
  /** Convex document ID — used as the value in kit filter dropdowns. */
  _id: string;
  /** Human-readable template name — used as the label in kit filter dropdowns. */
  name: string;
  /** Optional description shown in the admin UI template list. */
  description?: string;
  /** Number of items in the packing list. */
  itemCount: number;
  /** Whether the template is available for selection (always true from this query). */
  isActive: boolean;
  /** Creation timestamp. */
  createdAt: number;
  /** Last-modified timestamp. */
  updatedAt: number;
}

/**
 * Full template document including the items array.
 * Returned by getCaseTemplateById for template application workflows.
 */
export interface CaseTemplateDetail {
  _id: string;
  name: string;
  description?: string;
  isActive: boolean;
  items: Array<{
    id: string;
    name: string;
    description?: string;
    required: boolean;
    category?: string;
    sortOrder?: number;
  }>;
  createdAt: number;
  updatedAt: number;
}

// ─── listCaseTemplates ────────────────────────────────────────────────────────

/**
 * Subscribe to all active case templates.
 *
 * Returns a lightweight summary (name + itemCount) for each active template,
 * ordered alphabetically by name.  Used by:
 *   • M1/M2 map toolbar kit filter dropdown (INVENTORY dashboard)
 *   • SCAN app case creation — select a packing template to apply
 *   • Admin UI template management list
 *
 * Convex will re-run this query and push updates to all subscribers within
 * ~100–300 ms whenever a template is activated, deactivated, or renamed.
 *
 * Pass `includeInactive: true` to include inactive (archived) templates.
 * Defaults to active-only to keep dropdown lists lean.
 *
 * Client usage:
 *   const templates = useQuery(api.caseTemplates.listCaseTemplates, {});
 *   // Dropdown: templates.map(t => ({ id: t._id, name: t.name }))
 */
export const listCaseTemplates = query({
  args: {
    /**
     * When true, include inactive (archived) templates in the result.
     * Defaults to false — only active templates are returned.
     */
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CaseTemplateSummary[]> => {
    await requireAuth(ctx);
    let rows;

    if (args.includeInactive) {
      // No index filter — full scan ordered by name
      rows = await ctx.db.query("caseTemplates").collect();
    } else {
      // Use the by_active index for an efficient active-only query
      rows = await ctx.db
        .query("caseTemplates")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .collect();
    }

    // Sort alphabetically by name for stable dropdown ordering.
    rows.sort((a, b) => a.name.localeCompare(b.name));

    return rows.map((t) => ({
      _id:         t._id.toString(),
      name:        t.name,
      description: t.description,
      itemCount:   t.items.length,
      isActive:    t.isActive,
      createdAt:   t.createdAt,
      updatedAt:   t.updatedAt,
    }));
  },
});

// ─── getCaseTemplateById ──────────────────────────────────────────────────────

/**
 * Subscribe to a single case template by its Convex ID.
 *
 * Returns the full template document including the complete items array.
 * Used when applying a template to a case to create the initial manifest items,
 * or when rendering the template detail view in the admin UI.
 *
 * Returns `null` when the template does not exist (deleted or invalid ID).
 *
 * Client usage:
 *   const template = useQuery(api.caseTemplates.getCaseTemplateById, {
 *     templateId: selectedTemplateId,
 *   });
 *   if (template === null) return <TemplateNotFound />;
 *   return <TemplateDetail template={template} />;
 */
export const getCaseTemplateById = query({
  args: { templateId: v.id("caseTemplates") },
  handler: async (ctx, args): Promise<CaseTemplateDetail | null> => {
    await requireAuth(ctx);
    const t = await ctx.db.get(args.templateId);
    if (!t) return null;

    return {
      _id:         t._id.toString(),
      name:        t.name,
      description: t.description,
      isActive:    t.isActive,
      items:       t.items,
      createdAt:   t.createdAt,
      updatedAt:   t.updatedAt,
    };
  },
});
