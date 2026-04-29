/**
 * src/hooks/use-case-templates.ts
 *
 * Convex `useQuery` hooks for real-time case template (kit type) subscriptions.
 *
 * Architecture
 * ────────────
 * Each hook wraps `useQuery` (from convex/react) and subscribes to the
 * corresponding public query function in convex/caseTemplates.ts.
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
 * Available hooks:
 *   useCaseTemplates()               — all active templates (for dropdowns)
 *   useAllCaseTemplates()            — all templates including inactive
 *   useCaseTemplateById(templateId)  — single template with full items list
 *
 * Usage:
 *   // Kit filter dropdown in M1/M2 toolbar:
 *   const { kits } = useCaseTemplates();
 *   // kits: Array<{ id: string; name: string }>
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Re-export types so consumers can import them from the hook module.
export type {
  CaseTemplateSummary,
  CaseTemplateDetail,
} from "../../convex/caseTemplates";

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
export function useCaseTemplates() {
  const templates = useQuery(api.caseTemplates.listCaseTemplates, {});

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
export function useAllCaseTemplates() {
  const templates = useQuery(api.caseTemplates.listCaseTemplates, {
    includeInactive: true,
  });

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
export function useCaseTemplateById(templateId: string | null) {
  return useQuery(
    api.caseTemplates.getCaseTemplateById,
    templateId !== null ? { templateId: templateId as Id<"caseTemplates"> } : "skip",
  );
}
