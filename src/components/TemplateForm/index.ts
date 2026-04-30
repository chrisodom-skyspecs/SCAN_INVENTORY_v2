/**
 * TemplateForm barrel export.
 *
 * Standalone create/edit form component for kit template (packing list)
 * definitions.  Uses controlled state and Convex mutations; no modal coupling.
 *
 * Exports:
 *   TemplateForm         — the form component itself
 *   TemplateFormValues   — controlled state shape for scalar fields
 *                          (name, description, isActive; items are separate state)
 *   TemplateFormProps    — prop types for the form component
 *
 * The form includes an inline item definition list with:
 *   - Add-item input + "Add" button (Enter key also triggers add)
 *   - Ordered list of current items with "×" remove buttons
 *   - Pre-populated from Convex in edit mode via useCaseTemplateById
 *
 * Usage:
 *   import { TemplateForm } from "@/components/TemplateForm";
 *
 *   // Create mode
 *   <TemplateForm
 *     editing={null}
 *     onSuccess={(msg) => showToast(msg)}
 *     onError={(msg) => showError(msg)}
 *     onCancel={() => setOpen(false)}
 *   />
 *
 *   // Edit mode
 *   <TemplateForm
 *     editing={selectedTemplate}
 *     onSuccess={(msg) => showToast(msg)}
 *     onError={(msg) => showError(msg)}
 *     onCancel={() => setEditTarget(null)}
 *   />
 */

export { TemplateForm } from "./TemplateForm";
export type { TemplateFormValues, TemplateFormProps } from "./TemplateForm";
