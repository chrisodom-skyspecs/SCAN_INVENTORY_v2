/**
 * src/hooks/use-case-templates.ts
 *
 * Convex query and mutation hooks for real-time case template (kit type) management.
 *
 * Architecture
 * ────────────
 * Each hook wraps `useQuery` or `useMutation` (from convex/react) and delegates
 * to the corresponding function in convex/caseTemplates.ts.
 * Convex re-pushes updates within ~100–300 ms of any template change.
 *
 * Case templates are the predefined packing lists managed in the admin UI.
 * They appear in the INVENTORY dashboard map toolbar as the "Kit type" filter
 * dropdown and in the SCAN app when a new case is being set up.
 *
 * Skip pattern
 * ────────────
 * Hooks that accept nullable IDs use `"skip"` when the value is null to
 * suppress the subscription entirely and avoid unnecessary Convex traffic.
 *
 * Available query hooks:
 *   useCaseTemplates()               — all active templates (for dropdowns)
 *   useAllCaseTemplates()            — all templates including inactive, by recency
 *   useCaseTemplateById(templateId)  — single template with full items list
 *
 * Available mutation hooks:
 *   useCreateTemplate()      — create a new kit template
 *   useUpdateTemplate()      — rename / toggle active on an existing template
 *   useDeleteTemplate()      — soft-delete (deactivate) a template
 *   useSetTemplateItems()    — replace entire item list atomically
 *   useAddTemplateItem()     — append one item to a template
 *   useUpdateTemplateItem()  — patch a single item's fields
 *   useRemoveTemplateItem()  — delete one item from a template
 *   useReorderTemplateItems() — reorder items by providing ordered ID array
 *   useDuplicateTemplate()   — create a copy of a template
 *
 * Usage:
 *   // Kit filter dropdown in M1/M2 toolbar:
 *   const { kits } = useCaseTemplates();
 *   // kits: Array<{ id: string; name: string }>
 *
 *   // Admin create form:
 *   const createTemplate = useCreateTemplate();
 *   await createTemplate({ name: "Field Inspection Kit", items: [...] });
 */

"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Re-export types so consumers can import them from the hook module.
export type {
  CaseTemplateSummary,
  CaseTemplateDetail,
  TemplateItem,
} from "../../convex/caseTemplates";

interface UseCaseTemplateQueryOptions {
  enabled?: boolean;
}

// ─── useCaseTemplates ─────────────────────────────────────────────────────────

/**
 * Subscribe to all active case templates.
 *
 * Returns the template list and a derived `kits` array suitable for the
 * M1/M2 map toolbar kit filter dropdown ({ id, name } pairs).
 *
 * Convex re-runs this query and pushes updates whenever a template is
 * created, activated, deactivated, or renamed.
 *
 * Return values:
 *   `templates`  — `undefined` while loading; `CaseTemplateSummary[]` when ready
 *   `kits`       — derived `{ id: string; name: string }[]` for dropdown props
 *   `isLoading`  — true while templates is undefined (initial load)
 *
 * @example
 * function KitFilterDropdown() {
 *   const { kits, isLoading } = useCaseTemplates();
 *   if (isLoading) return <Skeleton />;
 *   return <KitSelect kits={kits} />;
 * }
 */
export function useCaseTemplates(options: UseCaseTemplateQueryOptions = {}) {
  const { enabled = true } = options;
  const templates = useQuery(
    api.caseTemplates.listCaseTemplates,
    enabled ? {} : "skip"
  );

  const kits: Array<{ id: string; name: string }> =
    templates?.map((t: { _id: string; name: string }) => ({ id: t._id, name: t.name })) ?? [];

  return {
    templates,
    kits,
    isLoading: templates === undefined,
  };
}

// ─── useAllCaseTemplates ──────────────────────────────────────────────────────

/**
 * Subscribe to ALL case templates including inactive (archived) ones.
 *
 * Used by the admin UI template management list where archived templates
 * need to be visible (with an "Archived" badge) alongside active ones.
 *
 * Return values:
 *   `templates`  — `undefined` while loading; `CaseTemplateSummary[]` when ready
 *   `isLoading`  — true while templates is undefined
 *
 * @example
 * function AdminTemplateList() {
 *   const { templates, isLoading } = useAllCaseTemplates();
 *   if (isLoading) return <Skeleton />;
 *   return <TemplateList templates={templates ?? []} />;
 * }
 */
export function useAllCaseTemplates(options: UseCaseTemplateQueryOptions = {}) {
  const { enabled = true } = options;
  const templates = useQuery(
    api.caseTemplates.getAllTemplates,
    enabled ? {} : "skip"
  );

  return {
    templates,
    isLoading: templates === undefined,
  };
}

// ─── useCaseTemplateById ──────────────────────────────────────────────────────

/**
 * Subscribe to a single case template by its Convex ID.
 *
 * Returns the full template document including the items array.  Used when
 * applying a template to a case or viewing template details in the admin UI.
 *
 * Pass `null` as `templateId` to skip the subscription (no template selected).
 *
 * Return values:
 *   `undefined`           — loading
 *   `null`                — template not found
 *   `CaseTemplateDetail`  — full template with items array
 *
 * @example
 * function TemplateDetailPanel({ templateId }: { templateId: string | null }) {
 *   const template = useCaseTemplateById(templateId);
 *   if (template === undefined) return <Skeleton />;
 *   if (template === null) return <TemplateNotFound />;
 *   return <ItemList items={template.items} />;
 * }
 */
export function useCaseTemplateById(
  templateId: string | null,
  options: UseCaseTemplateQueryOptions = {}
) {
  const { enabled = true } = options;
  return useQuery(
    api.caseTemplates.getCaseTemplateById,
    enabled && templateId !== null ? { templateId: templateId as Id<"caseTemplates"> } : "skip",
  );
}

// ─── Mutation hooks ───────────────────────────────────────────────────────────

// ─── Optimistic update helpers ────────────────────────────────────────────────

/**
 * Shared type for the subset of CaseTemplateSummary fields we construct
 * optimistically.  Matches the shape returned by getAllTemplates and
 * listCaseTemplates queries.
 */
interface OptimisticTemplateSummary {
  _id: string;
  name: string;
  description?: string;
  itemCount: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Patch `api.caseTemplates.getAllTemplates` (all templates, newest-first) and
 * `api.caseTemplates.listCaseTemplates` (active-only, alpha-sorted) with a new
 * or modified template summary.
 *
 * @param localStore  Convex OptimisticLocalStore passed by withOptimisticUpdate.
 * @param template    The template summary to upsert into the cached lists.
 * @param mode
 *   "prepend"  — add as the newest entry to getAllTemplates (use for create/duplicate)
 *   "update"   — find-and-replace an existing entry by _id (use for update)
 *   "deactivate" — set isActive=false in getAllTemplates; remove from listCaseTemplates
 */
function patchTemplateLists(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localStore: any,
  template: OptimisticTemplateSummary,
  mode: "prepend" | "update" | "deactivate",
): void {
  // ── getAllTemplates (all templates, sorted by updatedAt DESC) ────────────────
  const allTemplates = localStore.getQuery(api.caseTemplates.getAllTemplates, {});
  if (allTemplates !== undefined) {
    let nextAll: OptimisticTemplateSummary[];

    if (mode === "prepend") {
      // New template — put it at the front (newest updatedAt)
      nextAll = [template, ...allTemplates];
    } else if (mode === "update") {
      // Find-and-replace by _id; move to front since updatedAt changed
      const filtered = allTemplates.filter(
        (t: OptimisticTemplateSummary) => t._id !== template._id,
      );
      nextAll = [template, ...filtered];
    } else {
      // deactivate — mark isActive=false in-place
      nextAll = allTemplates.map((t: OptimisticTemplateSummary) =>
        t._id === template._id ? { ...t, isActive: false, updatedAt: template.updatedAt } : t,
      );
    }

    localStore.setQuery(api.caseTemplates.getAllTemplates, {}, nextAll);
  }

  // ── listCaseTemplates (active-only, sorted alphabetically) ──────────────────
  // Also try with `includeInactive: false` since that's an equivalent variant.
  for (const qArgs of [{}, { includeInactive: false }] as const) {
    const activeTemplates = localStore.getQuery(api.caseTemplates.listCaseTemplates, qArgs);
    if (activeTemplates === undefined) continue;

    let nextActive: OptimisticTemplateSummary[];

    if (mode === "prepend" && template.isActive) {
      // Insert and re-sort alphabetically
      const withNew = [...activeTemplates, template];
      withNew.sort((a: OptimisticTemplateSummary, b: OptimisticTemplateSummary) =>
        a.name.localeCompare(b.name),
      );
      nextActive = withNew;
    } else if (mode === "update") {
      if (!template.isActive) {
        // Being deactivated — remove from active list
        nextActive = activeTemplates.filter(
          (t: OptimisticTemplateSummary) => t._id !== template._id,
        );
      } else {
        const exists = activeTemplates.some(
          (t: OptimisticTemplateSummary) => t._id === template._id,
        );
        if (exists) {
          // Update in place and re-sort
          const updated = activeTemplates.map((t: OptimisticTemplateSummary) =>
            t._id === template._id ? template : t,
          );
          updated.sort((a: OptimisticTemplateSummary, b: OptimisticTemplateSummary) =>
            a.name.localeCompare(b.name),
          );
          nextActive = updated;
        } else {
          // Transitioning from inactive → active: add and sort
          const withRestored = [...activeTemplates, template];
          withRestored.sort((a: OptimisticTemplateSummary, b: OptimisticTemplateSummary) =>
            a.name.localeCompare(b.name),
          );
          nextActive = withRestored;
        }
      }
    } else {
      // deactivate — remove from active list
      nextActive = activeTemplates.filter(
        (t: OptimisticTemplateSummary) => t._id !== template._id,
      );
    }

    localStore.setQuery(api.caseTemplates.listCaseTemplates, qArgs, nextActive);
  }
}

/**
 * Create a new kit template.
 *
 * Optimistic update (Sub-AC 200301):
 *   Immediately adds the new template to api.caseTemplates.getAllTemplates
 *   (prepended — newest first) and api.caseTemplates.listCaseTemplates
 *   (inserted alphabetically) before the server confirms the write.
 *   Convex rolls back automatically if the mutation fails.
 *
 * @example
 * const createTemplate = useCreateTemplate();
 * const { templateId } = await createTemplate({
 *   name: "Field Inspection Kit",
 *   items: [{ id: crypto.randomUUID(), name: "Multimeter", quantity: 1, unit: "each", required: true }],
 * });
 */
export function useCreateTemplate() {
  return useMutation(api.caseTemplates.createTemplate).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();
      // Use a temporary ID that Convex replaces with the authoritative server ID
      // once the mutation completes (~100–300 ms).
      const tempId = `optimistic_new_${now}`;

      const optimisticTemplate: OptimisticTemplateSummary = {
        _id:         tempId,
        name:        args.name,
        description: args.description,
        itemCount:   args.items.length,
        isActive:    args.isActive ?? true,
        createdAt:   now,
        updatedAt:   now,
      };

      patchTemplateLists(localStore, optimisticTemplate, "prepend");
    },
  );
}

/**
 * Update top-level template fields (name, description, isActive).
 *
 * Optimistic update (Sub-AC 200301):
 *   Immediately reflects the updated name / description / isActive in
 *   api.caseTemplates.getAllTemplates and api.caseTemplates.listCaseTemplates.
 *   If isActive transitions false→true, the template is re-added to the active
 *   list.  If true→false, it is removed from the active list immediately.
 *   Convex rolls back if the mutation fails.
 *
 * Does NOT replace items — use useSetTemplateItems for that.
 */
export function useUpdateTemplate() {
  return useMutation(api.caseTemplates.updateTemplate).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();

      // Resolve patched fields — we need the current template to fill in fields
      // that weren't provided in args.  Look it up from getAllTemplates first.
      const allTemplates = localStore.getQuery(api.caseTemplates.getAllTemplates, {});
      const existing = allTemplates?.find(
        (t: OptimisticTemplateSummary) => t._id === args.templateId.toString(),
      );

      if (!existing) {
        // If the template isn't in the cache (e.g. initial load race), we can't
        // construct a valid optimistic value — skip and let the subscription catch up.
        return;
      }

      const updatedTemplate: OptimisticTemplateSummary = {
        ...existing,
        ...(args.name        !== undefined ? { name:        args.name        } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.isActive    !== undefined ? { isActive:    args.isActive    } : {}),
        updatedAt: now,
      };

      patchTemplateLists(localStore, updatedTemplate, "update");
    },
  );
}

/**
 * Soft-delete (deactivate) a template.
 *
 * Optimistic update (Sub-AC 200301):
 *   Immediately marks the template as inactive in getAllTemplates and removes it
 *   from listCaseTemplates before the server confirms.  The template remains in
 *   the getAllTemplates list (with isActive: false) so the admin UI can restore it.
 *   Convex rolls back if the mutation fails.
 */
export function useDeleteTemplate() {
  return useMutation(api.caseTemplates.deleteTemplate).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();

      // Resolve the existing template from the cache
      const allTemplates = localStore.getQuery(api.caseTemplates.getAllTemplates, {});
      const existing = allTemplates?.find(
        (t: OptimisticTemplateSummary) => t._id === args.templateId.toString(),
      );

      // We only need the _id to drive deactivation; fall back to a minimal shape
      const template: OptimisticTemplateSummary = existing ?? {
        _id:       args.templateId.toString(),
        name:      "",
        itemCount: 0,
        isActive:  false,
        createdAt: now,
        updatedAt: now,
      };

      patchTemplateLists(localStore, { ...template, isActive: false, updatedAt: now }, "deactivate");
    },
  );
}

/**
 * Permanently delete a template.
 * Only safe when no cases reference the template.
 */
export function useHardDeleteTemplate() {
  return useMutation(api.caseTemplates.hardDeleteTemplate).withOptimisticUpdate(
    (localStore, args) => {
      const templateId = args.templateId.toString();

      // Remove from getAllTemplates entirely
      const allTemplates = localStore.getQuery(api.caseTemplates.getAllTemplates, {});
      if (allTemplates !== undefined) {
        localStore.setQuery(
          api.caseTemplates.getAllTemplates,
          {},
          allTemplates.filter((t: OptimisticTemplateSummary) => t._id !== templateId),
        );
      }

      // Remove from listCaseTemplates (active-only)
      for (const qArgs of [{}, { includeInactive: false }] as const) {
        const activeTemplates = localStore.getQuery(api.caseTemplates.listCaseTemplates, qArgs);
        if (activeTemplates !== undefined) {
          localStore.setQuery(
            api.caseTemplates.listCaseTemplates,
            qArgs,
            activeTemplates.filter((t: OptimisticTemplateSummary) => t._id !== templateId),
          );
        }
      }
    },
  );
}

/**
 * Replace the entire item list of a template atomically.
 *
 * Optimistic update (Sub-AC 200301):
 *   Immediately updates the items array in api.caseTemplates.getCaseTemplateById
 *   (used by the edit form's item list) and the itemCount in getAllTemplates and
 *   listCaseTemplates.  Convex rolls back if the mutation fails.
 */
export function useSetTemplateItems() {
  return useMutation(api.caseTemplates.setTemplateItems).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();
      const templateId = args.templateId.toString();

      // ── Update getCaseTemplateById ─────────────────────────────────────────
      // Primary item list subscription used by TemplateForm in edit mode.
      const detail = localStore.getQuery(api.caseTemplates.getCaseTemplateById, {
        templateId: args.templateId,
      });
      if (detail !== undefined && detail !== null) {
        localStore.setQuery(
          api.caseTemplates.getCaseTemplateById,
          { templateId: args.templateId },
          { ...detail, items: args.items, updatedAt: now },
        );
      }

      // ── Update itemCount in getAllTemplates ────────────────────────────────
      const allTemplates = localStore.getQuery(api.caseTemplates.getAllTemplates, {});
      if (allTemplates !== undefined) {
        localStore.setQuery(
          api.caseTemplates.getAllTemplates,
          {},
          allTemplates.map((t: OptimisticTemplateSummary) =>
            t._id === templateId
              ? { ...t, itemCount: args.items.length, updatedAt: now }
              : t,
          ),
        );
      }

      // ── Update itemCount in listCaseTemplates ─────────────────────────────
      for (const qArgs of [{}, { includeInactive: false }] as const) {
        const activeTemplates = localStore.getQuery(api.caseTemplates.listCaseTemplates, qArgs);
        if (activeTemplates !== undefined) {
          localStore.setQuery(
            api.caseTemplates.listCaseTemplates,
            qArgs,
            activeTemplates.map((t: OptimisticTemplateSummary) =>
              t._id === templateId
                ? { ...t, itemCount: args.items.length, updatedAt: now }
                : t,
            ),
          );
        }
      }
    },
  );
}

/**
 * Append a single item to a template.
 *
 * Optimistic update (Sub-AC 200301):
 *   Immediately appends the new item to api.caseTemplates.getCaseTemplateById
 *   and increments the itemCount in the list caches.
 *   Convex rolls back if an item with the same `id` already exists.
 */
export function useAddTemplateItem() {
  return useMutation(api.caseTemplates.addTemplateItem).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();
      const templateId = args.templateId.toString();

      // Patch getCaseTemplateById — append the new item
      const detail = localStore.getQuery(api.caseTemplates.getCaseTemplateById, {
        templateId: args.templateId,
      });
      if (detail !== undefined && detail !== null) {
        const newItem = {
          ...args.item,
          sortOrder: args.item.sortOrder ?? detail.items.length,
        };
        localStore.setQuery(
          api.caseTemplates.getCaseTemplateById,
          { templateId: args.templateId },
          { ...detail, items: [...detail.items, newItem], updatedAt: now },
        );
      }

      // Increment itemCount in list caches
      const allTemplates = localStore.getQuery(api.caseTemplates.getAllTemplates, {});
      if (allTemplates !== undefined) {
        localStore.setQuery(
          api.caseTemplates.getAllTemplates,
          {},
          allTemplates.map((t: OptimisticTemplateSummary) =>
            t._id === templateId
              ? { ...t, itemCount: t.itemCount + 1, updatedAt: now }
              : t,
          ),
        );
      }
    },
  );
}

/**
 * Update a single item's fields (name, quantity, unit, required, notes, etc.).
 *
 * Optimistic update (Sub-AC 200301):
 *   Immediately reflects the patched item fields in getCaseTemplateById.
 *   Convex rolls back if the item id is not found.
 */
export function useUpdateTemplateItem() {
  return useMutation(api.caseTemplates.updateTemplateItem).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();

      const detail = localStore.getQuery(api.caseTemplates.getCaseTemplateById, {
        templateId: args.templateId,
      });
      if (detail !== undefined && detail !== null) {
        const updatedItems = (detail.items.map((item) =>
          item.id === args.itemId ? { ...item, ...args.patch } : item,
        )) as typeof detail.items;
        localStore.setQuery(
          api.caseTemplates.getCaseTemplateById,
          { templateId: args.templateId },
          { ...detail, items: updatedItems, updatedAt: now },
        );
      }
    },
  );
}

/**
 * Remove a single item from a template by its `id`.
 *
 * Optimistic update (Sub-AC 200301):
 *   Immediately removes the item from getCaseTemplateById and decrements the
 *   itemCount in list caches.  Convex rolls back if the item id is not found.
 */
export function useRemoveTemplateItem() {
  return useMutation(api.caseTemplates.removeTemplateItem).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();
      const templateId = args.templateId.toString();

      // Patch getCaseTemplateById — remove the item
      const detail = localStore.getQuery(api.caseTemplates.getCaseTemplateById, {
        templateId: args.templateId,
      });
      if (detail !== undefined && detail !== null) {
        const updatedItems = detail.items.filter(
          (item: { id: string }) => item.id !== args.itemId,
        );
        localStore.setQuery(
          api.caseTemplates.getCaseTemplateById,
          { templateId: args.templateId },
          { ...detail, items: updatedItems, updatedAt: now },
        );
      }

      // Decrement itemCount in list caches
      const allTemplates = localStore.getQuery(api.caseTemplates.getAllTemplates, {});
      if (allTemplates !== undefined) {
        localStore.setQuery(
          api.caseTemplates.getAllTemplates,
          {},
          allTemplates.map((t: OptimisticTemplateSummary) =>
            t._id === templateId
              ? { ...t, itemCount: Math.max(0, t.itemCount - 1), updatedAt: now }
              : t,
          ),
        );
      }
    },
  );
}

/**
 * Reorder template items by providing a complete ordered list of item IDs.
 *
 * Optimistic update (Sub-AC 200301):
 *   Immediately reorders the items array in getCaseTemplateById according to
 *   the provided orderedIds, assigning new sortOrder values.
 *   Convex rolls back if the orderedIds set doesn't match the current items.
 */
export function useReorderTemplateItems() {
  return useMutation(api.caseTemplates.reorderTemplateItems).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();

      const detail = localStore.getQuery(api.caseTemplates.getCaseTemplateById, {
        templateId: args.templateId,
      });
      if (detail !== undefined && detail !== null) {
        // Build a lookup map from item.id → item
        const itemMap = new Map(
          detail.items.map((item) => [item.id, item] as const),
        );

        // Rebuild in the specified order with updated sortOrder values
        type DetailItem = (typeof detail.items)[number];
        const reordered = args.orderedIds
          .map((id: string, idx: number) => {
            const item = itemMap.get(id);
            return item ? ({ ...item, sortOrder: idx } as DetailItem) : null;
          })
          .filter((item): item is DetailItem => item !== null);

        localStore.setQuery(
          api.caseTemplates.getCaseTemplateById,
          { templateId: args.templateId },
          { ...detail, items: reordered, updatedAt: now },
        );
      }
    },
  );
}

/**
 * Create a copy of an existing template.
 *
 * Optimistic update (Sub-AC 200301):
 *   Immediately adds the duplicate template to getAllTemplates (prepended) and
 *   listCaseTemplates (alphabetically) before the server confirms.  The source
 *   template data (name, itemCount, description) is read from the local store.
 *   Convex rolls back if the source template is not found.
 */
export function useDuplicateTemplate() {
  return useMutation(api.caseTemplates.duplicateTemplate).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();

      // Look up the source template to get name / itemCount / description
      const allTemplates = localStore.getQuery(api.caseTemplates.getAllTemplates, {});
      const source = allTemplates?.find(
        (t: OptimisticTemplateSummary) => t._id === args.templateId.toString(),
      );

      if (!source) {
        // Source not in cache — skip optimistic update; subscription will catch up
        return;
      }

      const duplicateName = args.name ?? `Copy of ${source.name}`;
      const tempId = `optimistic_dup_${now}`;

      const duplicate: OptimisticTemplateSummary = {
        _id:         tempId,
        name:        duplicateName,
        description: source.description,
        itemCount:   source.itemCount,
        isActive:    args.isActive ?? true,
        createdAt:   now,
        updatedAt:   now,
      };

      patchTemplateLists(localStore, duplicate, "prepend");
    },
  );
}
