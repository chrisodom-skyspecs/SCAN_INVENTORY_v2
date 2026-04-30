/**
 * convex/caseTemplates.ts
 *
 * Queries and mutations for case template (kit type) management.
 *
 * Case templates define the predefined packing lists (manifests) for equipment
 * cases.  They are managed via the admin UI and applied to cases to generate
 * the manifest items that field technicians inspect via the SCAN mobile app.
 *
 * Each template item carries:
 *   id          — stable string identifier within the template
 *   name        — human-readable item name
 *   quantity    — expected count in the case
 *   unit        — unit of measure (e.g., "each", "pair", "set")
 *   required    — whether the item is mandatory for QC sign-off
 *   notes       — packing / handling notes for technicians
 *   category    — optional grouping (e.g., "Sensors", "Cables")
 *   sortOrder   — display order within the packing list
 *   description — legacy long-form description (kept for backward compat)
 *
 * Query functions (real-time reactive via useQuery):
 *   listCaseTemplates    — all active templates for kit filter dropdowns
 *   getCaseTemplateById  — full template including items; for template application
 *   getAllTemplates       — admin view: all templates including inactive
 *
 * Mutation functions (write operations for admin UI):
 *   createTemplate       — create a new kit template with item list
 *   updateTemplate       — rename, change description, toggle active state
 *   deleteTemplate       — soft-delete (deactivate) a template
 *   hardDeleteTemplate   — permanent deletion (admin only, no active cases)
 *   setTemplateItems     — replace the entire item list of a template
 *   addTemplateItem      — append one item to a template
 *   updateTemplateItem   — update a single item's fields
 *   removeTemplateItem   — delete one item from a template
 *   reorderTemplateItems — rewrite sortOrder for a new item sequence
 *
 * Index usage:
 *   listCaseTemplates → by_active index O(log n + |active templates|)
 *   getAllTemplates    → by_updated index for recency sort
 *   getCaseTemplateById → O(1) primary-key lookup
 *
 * Client usage example:
 *   const templates = useQuery(api.caseTemplates.listCaseTemplates, {});
 *   // → [{ _id: "...", name: "Field Inspection Kit", itemCount: 12 }, ...]
 *
 *   const t = useQuery(api.caseTemplates.getCaseTemplateById, { templateId });
 *   // → { _id, name, items: [{ id, name, quantity, unit, required, notes }, ...] }
 */

import { mutation, query } from "./_generated/server";
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

// ─── Shared item validator ────────────────────────────────────────────────────

/**
 * Convex validator for a single kit template item.
 * Used in both createTemplate / setTemplateItems args.
 */
const templateItemValidator = v.object({
  /** Stable identifier within the template — caller-supplied UUID/slug. */
  id: v.string(),
  /** Human-readable item name shown in packing lists and inspection checklists. */
  name: v.string(),
  /**
   * Expected count of this item in the case.
   * Defaults to 1 when omitted.
   */
  quantity: v.optional(v.number()),
  /**
   * Unit of measure for the quantity (e.g., "each", "pair", "box").
   * Defaults to "each" when omitted.
   */
  unit: v.optional(v.string()),
  /**
   * Whether this item is mandatory for QC sign-off.
   * Missing required items block case assembly completion.
   */
  required: v.boolean(),
  /**
   * Packing / handling notes shown to field technicians during inspection.
   * E.g., "Ensure foam insert is replaced after each use."
   */
  notes: v.optional(v.string()),
  /** Optional grouping label (e.g., "Sensors", "Cables", "Tools"). */
  category: v.optional(v.string()),
  /** Display position within the packing list. Lower numbers appear first. */
  sortOrder: v.optional(v.number()),
  /**
   * Legacy long-form description (preserved for backward compatibility
   * with rows created before the quantity/unit/notes fields were added).
   */
  description: v.optional(v.string()),
});

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single item within a kit template.
 *
 * All quantity/unit/notes fields are optional at the DB level (backward
 * compatibility) but consumers should treat quantity=1 and unit="each"
 * as sensible defaults when the fields are absent.
 */
export interface TemplateItem {
  id: string;
  name: string;
  quantity?: number;
  unit?: string;
  required: boolean;
  notes?: string;
  category?: string;
  sortOrder?: number;
  description?: string;
}

/**
 * Lightweight template summary returned by listCaseTemplates / getAllTemplates.
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
  /** Whether the template is available for selection. */
  isActive: boolean;
  /** Creation timestamp. */
  createdAt: number;
  /** Last-modified timestamp. */
  updatedAt: number;
}

/**
 * Full template document including the items array.
 * Returned by getCaseTemplateById for template application and admin editing.
 */
export interface CaseTemplateDetail {
  _id: string;
  name: string;
  description?: string;
  isActive: boolean;
  items: TemplateItem[];
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
 * Pass `includeInactive: true` to include inactive (archived) templates.
 * Defaults to active-only to keep dropdown lists lean.
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

// ─── getAllTemplates ──────────────────────────────────────────────────────────

/**
 * Subscribe to all templates (active + inactive) ordered by most-recently-updated.
 *
 * Intended for the admin template management table which needs to show all
 * templates including archived ones.  Returns summaries only — use
 * getCaseTemplateById for full item lists.
 */
export const getAllTemplates = query({
  args: {},
  handler: async (ctx): Promise<CaseTemplateSummary[]> => {
    await requireAuth(ctx);

    const rows = await ctx.db
      .query("caseTemplates")
      .withIndex("by_updated")
      .order("desc")
      .collect();

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
 * Returns the full template document including the complete items array with
 * all item fields (name, quantity, unit, required, notes, category, sortOrder).
 *
 * Used when:
 *   - Applying a template to a case to create the initial manifest items
 *   - Rendering the template detail / edit view in the admin UI
 *   - SCAN app loading the expected item list for an inspection
 *
 * Returns `null` when the template does not exist (deleted or invalid ID).
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
      items:       t.items as TemplateItem[],
      createdAt:   t.createdAt,
      updatedAt:   t.updatedAt,
    };
  },
});

// ─── createTemplate ───────────────────────────────────────────────────────────

/**
 * Create a new kit template with an initial item list.
 *
 * Each item requires at minimum an `id` (caller-supplied stable identifier),
 * `name`, and `required` flag.  The optional `quantity`, `unit`, and `notes`
 * fields default to 1, "each", and undefined respectively when omitted.
 *
 * Returns the Convex ID of the newly-created template.
 *
 * Admin UI usage:
 *   const id = await createTemplate({ name: "Field Inspection Kit", items: [...] });
 */
export const createTemplate = mutation({
  args: {
    /** Human-readable template name shown in dropdowns and the admin UI. */
    name: v.string(),
    /** Optional long-form description of when to use this template. */
    description: v.optional(v.string()),
    /**
     * Whether the template is immediately available for selection.
     * Defaults to true if omitted — new templates are active by default.
     */
    isActive: v.optional(v.boolean()),
    /**
     * Initial item list.  Can be empty (admin can add items later).
     * Each item requires id, name, and required; other fields are optional.
     */
    items: v.array(templateItemValidator),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const now = Date.now();

    // Normalise items: assign default sortOrder if not provided
    const items = args.items.map((item, idx) => ({
      ...item,
      sortOrder: item.sortOrder ?? idx,
    }));

    const templateId = await ctx.db.insert("caseTemplates", {
      name:        args.name,
      description: args.description,
      isActive:    args.isActive ?? true,
      items,
      createdAt:   now,
      updatedAt:   now,
    });

    return { templateId: templateId.toString() };
  },
});

// ─── updateTemplate ───────────────────────────────────────────────────────────

/**
 * Update top-level template fields (name, description, isActive).
 *
 * Does NOT replace the item list — use setTemplateItems for that.
 * Only the provided fields are updated; undefined fields are left unchanged.
 *
 * Returns the updated template's Convex ID.
 */
export const updateTemplate = mutation({
  args: {
    templateId:  v.id("caseTemplates"),
    name:        v.optional(v.string()),
    description: v.optional(v.string()),
    isActive:    v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new Error(`[NOT_FOUND] Template ${args.templateId} does not exist.`);
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name        !== undefined) patch.name        = args.name;
    if (args.description !== undefined) patch.description = args.description;
    if (args.isActive    !== undefined) patch.isActive    = args.isActive;

    await ctx.db.patch(args.templateId, patch);

    return { templateId: args.templateId.toString() };
  },
});

// ─── deleteTemplate (soft delete) ─────────────────────────────────────────────

/**
 * Soft-delete a template by marking it inactive.
 *
 * Inactive templates are hidden from kit filter dropdowns and the SCAN app's
 * template selector, but are preserved in the database so existing cases that
 * reference the template retain a valid templateId foreign key.
 *
 * Use hardDeleteTemplate for permanent deletion when you are certain no cases
 * reference the template.
 */
export const deleteTemplate = mutation({
  args: { templateId: v.id("caseTemplates") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new Error(`[NOT_FOUND] Template ${args.templateId} does not exist.`);
    }

    await ctx.db.patch(args.templateId, {
      isActive:  false,
      updatedAt: Date.now(),
    });

    return { templateId: args.templateId.toString(), deleted: true };
  },
});

// ─── hardDeleteTemplate ───────────────────────────────────────────────────────

/**
 * Permanently delete a template row from the database.
 *
 * Should only be used on templates that are not referenced by any cases.
 * If any cases reference this templateId, those cases will have a dangling
 * templateId — caller is responsible for verifying no active case references
 * before calling this mutation.
 *
 * Returns { deleted: true } on success.
 */
export const hardDeleteTemplate = mutation({
  args: { templateId: v.id("caseTemplates") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new Error(`[NOT_FOUND] Template ${args.templateId} does not exist.`);
    }

    await ctx.db.delete(args.templateId);

    return { templateId: args.templateId.toString(), deleted: true };
  },
});

// ─── setTemplateItems ─────────────────────────────────────────────────────────

/**
 * Replace the entire item list of a template.
 *
 * This is the primary bulk-edit operation for the admin template editor.
 * The caller sends the complete desired item array; the existing list is
 * atomically replaced.
 *
 * The `id` field of each item must be unique within the array.  If duplicate
 * item IDs are detected, the mutation throws before writing to the database.
 *
 * Items without explicit sortOrder values are assigned sortOrder based on
 * their position in the input array.
 */
export const setTemplateItems = mutation({
  args: {
    templateId: v.id("caseTemplates"),
    /** New item list — replaces the existing list entirely. */
    items: v.array(templateItemValidator),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new Error(`[NOT_FOUND] Template ${args.templateId} does not exist.`);
    }

    // Validate uniqueness of item IDs
    const ids = args.items.map((i) => i.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new Error(
        "[VALIDATION] Duplicate item IDs detected. Each item must have a unique id within the template."
      );
    }

    // Normalise sortOrder
    const items = args.items.map((item, idx) => ({
      ...item,
      sortOrder: item.sortOrder ?? idx,
    }));

    await ctx.db.patch(args.templateId, {
      items,
      updatedAt: Date.now(),
    });

    return {
      templateId: args.templateId.toString(),
      itemCount:  items.length,
    };
  },
});

// ─── addTemplateItem ──────────────────────────────────────────────────────────

/**
 * Append a single item to an existing template.
 *
 * The item is appended to the end of the items array unless sortOrder is
 * specified (in which case the client should call reorderTemplateItems after
 * to rebalance sort positions).
 *
 * Throws if an item with the same `id` already exists in the template.
 *
 * Returns the updated itemCount.
 */
export const addTemplateItem = mutation({
  args: {
    templateId: v.id("caseTemplates"),
    item: templateItemValidator,
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new Error(`[NOT_FOUND] Template ${args.templateId} does not exist.`);
    }

    // Ensure no duplicate item ID
    if (template.items.some((i) => i.id === args.item.id)) {
      throw new Error(
        `[VALIDATION] Item id "${args.item.id}" already exists in template ${args.templateId}.`
      );
    }

    const newItem = {
      ...args.item,
      sortOrder: args.item.sortOrder ?? template.items.length,
    };

    const updatedItems = [...template.items, newItem];

    await ctx.db.patch(args.templateId, {
      items:     updatedItems,
      updatedAt: Date.now(),
    });

    return {
      templateId: args.templateId.toString(),
      itemCount:  updatedItems.length,
    };
  },
});

// ─── updateTemplateItem ───────────────────────────────────────────────────────

/**
 * Update one item within a template by its `id`.
 *
 * Only the supplied fields are overwritten; other item fields are preserved.
 * Throws if no item with the given `itemId` exists in the template.
 *
 * Returns the updated itemCount (unchanged — this never adds or removes).
 */
export const updateTemplateItem = mutation({
  args: {
    templateId: v.id("caseTemplates"),
    /** The stable `id` of the item to update (not a Convex document ID). */
    itemId: v.string(),
    /** Partial item fields to merge into the existing item. */
    patch: v.object({
      name:        v.optional(v.string()),
      quantity:    v.optional(v.number()),
      unit:        v.optional(v.string()),
      required:    v.optional(v.boolean()),
      notes:       v.optional(v.string()),
      category:    v.optional(v.string()),
      sortOrder:   v.optional(v.number()),
      description: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new Error(`[NOT_FOUND] Template ${args.templateId} does not exist.`);
    }

    const idx = template.items.findIndex((i) => i.id === args.itemId);
    if (idx === -1) {
      throw new Error(
        `[NOT_FOUND] Item "${args.itemId}" not found in template ${args.templateId}.`
      );
    }

    // Merge the patch into the existing item
    const updated = { ...template.items[idx], ...args.patch };
    const updatedItems = [...template.items];
    updatedItems[idx] = updated;

    await ctx.db.patch(args.templateId, {
      items:     updatedItems,
      updatedAt: Date.now(),
    });

    return {
      templateId: args.templateId.toString(),
      itemId:     args.itemId,
    };
  },
});

// ─── removeTemplateItem ───────────────────────────────────────────────────────

/**
 * Remove a single item from a template by its `id`.
 *
 * Throws if no item with the given `itemId` exists in the template.
 * Returns the updated itemCount after removal.
 */
export const removeTemplateItem = mutation({
  args: {
    templateId: v.id("caseTemplates"),
    /** The stable `id` of the item to remove. */
    itemId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new Error(`[NOT_FOUND] Template ${args.templateId} does not exist.`);
    }

    const updatedItems = template.items.filter((i) => i.id !== args.itemId);
    if (updatedItems.length === template.items.length) {
      throw new Error(
        `[NOT_FOUND] Item "${args.itemId}" not found in template ${args.templateId}.`
      );
    }

    await ctx.db.patch(args.templateId, {
      items:     updatedItems,
      updatedAt: Date.now(),
    });

    return {
      templateId: args.templateId.toString(),
      itemCount:  updatedItems.length,
    };
  },
});

// ─── reorderTemplateItems ─────────────────────────────────────────────────────

/**
 * Reorder items in a template by providing a new sequence of item IDs.
 *
 * Assigns sortOrder 0, 1, 2, ... to items in the order provided.
 * All item IDs in the template must be present in the orderedIds array.
 * Throws if any IDs are missing or extra IDs are provided.
 *
 * Returns the updated itemCount (unchanged).
 */
export const reorderTemplateItems = mutation({
  args: {
    templateId: v.id("caseTemplates"),
    /**
     * Complete ordered list of all item IDs in the desired display order.
     * Every item currently in the template must appear exactly once.
     */
    orderedIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new Error(`[NOT_FOUND] Template ${args.templateId} does not exist.`);
    }

    const existingIds = new Set(template.items.map((i) => i.id));
    const incomingIds = new Set(args.orderedIds);

    // Validate that orderedIds is a complete permutation of existing IDs
    if (existingIds.size !== incomingIds.size) {
      throw new Error(
        "[VALIDATION] orderedIds must contain exactly the same item IDs as the template."
      );
    }
    for (const id of existingIds) {
      if (!incomingIds.has(id)) {
        throw new Error(
          `[VALIDATION] Item "${id}" is missing from orderedIds.`
        );
      }
    }

    // Build a lookup from item.id → item
    const itemById = new Map(template.items.map((i) => [i.id, i]));

    // Rebuild in the specified order with updated sortOrder values
    const reordered = args.orderedIds.map((id, idx) => ({
      ...itemById.get(id)!,
      sortOrder: idx,
    }));

    await ctx.db.patch(args.templateId, {
      items:     reordered,
      updatedAt: Date.now(),
    });

    return {
      templateId: args.templateId.toString(),
      itemCount:  reordered.length,
    };
  },
});

// ─── duplicateTemplate ────────────────────────────────────────────────────────

/**
 * Create a copy of an existing template under a new name.
 *
 * All items (with their quantity, unit, required, notes, etc.) are copied.
 * The duplicate starts as active (can be overridden via `isActive`).
 * Useful when an admin wants to create a variant of an existing kit type.
 *
 * Returns the Convex ID of the newly-created duplicate template.
 */
export const duplicateTemplate = mutation({
  args: {
    templateId:  v.id("caseTemplates"),
    /** Name for the duplicate. Defaults to "Copy of <original name>". */
    name:        v.optional(v.string()),
    /** Whether the duplicate should be active immediately. Defaults to true. */
    isActive:    v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const source = await ctx.db.get(args.templateId);
    if (!source) {
      throw new Error(`[NOT_FOUND] Template ${args.templateId} does not exist.`);
    }

    const now  = Date.now();
    const name = args.name ?? `Copy of ${source.name}`;

    const newId = await ctx.db.insert("caseTemplates", {
      name,
      description: source.description,
      isActive:    args.isActive ?? true,
      items:       source.items,          // deep copy (Convex values are immutable)
      createdAt:   now,
      updatedAt:   now,
    });

    return { templateId: newId.toString() };
  },
});
