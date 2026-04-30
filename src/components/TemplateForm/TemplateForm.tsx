/**
 * TemplateForm — Standalone create/edit form for kit template (packing list)
 * definitions.
 *
 * Renders a controlled form with:
 *   - Template name field (required)
 *   - Description textarea (optional)
 *   - Active toggle checkbox
 *   - Inline item definition list with add-item UI and remove-item actions
 *   - Save and Cancel action buttons wired to Convex mutations
 *
 * Operates in two modes driven by the `editing` prop:
 *   - Create mode  (editing = null)  — calls api.caseTemplates.createTemplate
 *   - Edit mode    (editing = CaseTemplateSummary) — calls api.caseTemplates.updateTemplate
 *                                                  + api.caseTemplates.setTemplateItems
 *
 * Item state management:
 *   Items are tracked as a separate `items: TemplateItem[]` state slice inside
 *   the component, independent of the `form` (name/description/isActive) state.
 *
 *   In edit mode, items are pre-populated by subscribing to
 *   useCaseTemplateById(editing._id) — the subscription fires once on mount
 *   and populates the item list.  A ref-based initialised flag prevents the
 *   subscription from overwriting user edits after the first populate.
 *
 *   The add-item input is controlled via `itemInput` state.  Pressing Enter or
 *   clicking "Add" appends a new TemplateItem (auto-generated UUID id, required
 *   defaults to true).  Each item row has a "×" remove button.
 *
 * This component is intentionally a plain form element (no modal wrapper) so
 * it can be composed inside a dialog, a drawer, or a full-page editor without
 * layout coupling.  See TemplateList for the modal composition.
 *
 * Design system compliance:
 *   - No hex literals — all colors via CSS custom properties
 *   - Inter Tight for all UI typography
 *   - IBM Plex Mono for monospace metadata
 *   - WCAG AA contrast in both light and dark themes
 *
 * Form state management:
 *   Controlled state via React.useState.  A plain controlled approach was chosen
 *   over react-hook-form because:
 *     a) react-hook-form is not a project dependency (see package.json)
 *     b) The form is intentionally small — the overhead is negligible
 *     c) Convex optimistic updates already handle derived state
 *
 * Usage:
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

"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useId,
  type FormEvent,
  type ChangeEvent,
  type KeyboardEvent,
  type DragEvent,
} from "react";
import {
  useCreateTemplate,
  useUpdateTemplate,
  useSetTemplateItems,
  useCaseTemplateById,
  type CaseTemplateSummary,
  type TemplateItem,
} from "@/hooks/use-case-templates";
import type { Id } from "../../../convex/_generated/dataModel";
import styles from "./TemplateForm.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The controlled state shape for the template form's scalar fields.
 * Exported so parent components and tests can reference it without coupling
 * to the internal useState generics.
 *
 * Note: the items array is managed as a separate state slice (`items`) within
 * the component rather than nested inside this object, to keep shallow-equality
 * updates predictable and avoid unnecessary re-renders of the item list.
 */
export interface TemplateFormValues {
  /** Human-readable kit template name (required, min length 1). */
  name: string;
  /** Optional description shown in the admin UI template list. */
  description: string;
  /** When false the template is hidden from dropdowns and SCAN app. */
  isActive: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a stable, unique string ID for a new template item.
 * Uses crypto.randomUUID() when available (all modern browsers + Node ≥14.17).
 * Falls back to a timestamp+random string for environments that lack it.
 */
function generateItemId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random suffix
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Props accepted by TemplateForm.
 */
export interface TemplateFormProps {
  /**
   * null    → create mode  (calls createTemplate mutation on submit)
   * object  → edit mode    (calls updateTemplate mutation on submit, prefills form)
   */
  editing: CaseTemplateSummary | null;

  /**
   * Called when the mutation succeeds.  Receives a human-readable confirmation
   * message suitable for a toast or status banner.
   */
  onSuccess: (message: string) => void;

  /**
   * Called when the mutation throws.  Receives a human-readable error message.
   */
  onError: (message: string) => void;

  /**
   * Called when the user clicks "Cancel" or when the mutation completes
   * successfully (to allow the parent to close the modal / navigate away).
   */
  onCancel: () => void;

  /**
   * Additional CSS class applied to the <form> root element.
   * Use to adapt the form's appearance to different container contexts.
   */
  className?: string;
}

// ─── Default form values ───────────────────────────────────────────────────────

const DEFAULT_FORM: TemplateFormValues = {
  name: "",
  description: "",
  isActive: true,
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * TemplateForm — controlled create/edit form for a kit template.
 *
 * Self-contained: no props required beyond editing/onSuccess/onError/onCancel.
 * Uses Convex mutation hooks internally; does NOT receive mutation functions
 * as props so that the caller doesn't need to know which mutation to call.
 */
export function TemplateForm({
  editing,
  onSuccess,
  onError,
  onCancel,
  className,
}: TemplateFormProps) {
  // ── Accessibility IDs ────────────────────────────────────────────────────
  const nameId       = useId();
  const descId       = useId();
  const activeId     = useId();
  const itemInputId  = useId();
  const itemsLabelId = useId();
  const nameLabelId  = `${nameId}-label`;
  const descLabelId  = `${descId}-label`;

  // ── Derived mode ─────────────────────────────────────────────────────────
  const isEditMode = editing !== null;

  // ── Form state (controlled scalar fields) ────────────────────────────────
  const [form, setForm] = useState<TemplateFormValues>(
    editing
      ? {
          name:        editing.name,
          description: editing.description ?? "",
          isActive:    editing.isActive,
        }
      : DEFAULT_FORM
  );

  const [submitting, setSubmitting] = useState(false);

  // ── Item list state ───────────────────────────────────────────────────────
  // Separate from scalar form state to avoid deep-equality issues.
  const [items, setItems] = useState<TemplateItem[]>([]);

  // Add-item input value (controlled)
  const [itemInput, setItemInput] = useState("");

  // ── Load existing items in edit mode ──────────────────────────────────────
  // Subscribe to the full template detail so we can pre-populate the items
  // list.  The subscription is skipped (no Convex traffic) when editing=null.
  const templateDetail = useCaseTemplateById(editing?._id ?? null);

  // Flag: have we already initialised items from the Convex subscription?
  // Using a ref so changes to it never trigger a re-render.
  const itemsInitialisedRef = useRef(false);

  useEffect(() => {
    if (
      isEditMode &&
      !itemsInitialisedRef.current &&
      templateDetail !== undefined // undefined = still loading; null = not found
    ) {
      if (templateDetail !== null) {
        setItems(templateDetail.items ?? []);
      }
      itemsInitialisedRef.current = true;
    }
  }, [isEditMode, templateDetail]);

  // Whether the item detail subscription is still pending (edit mode only)
  const itemsLoading = isEditMode && !itemsInitialisedRef.current && templateDetail === undefined;

  // ── Validation ───────────────────────────────────────────────────────────
  const isNameValid = form.name.trim().length > 0;
  const canSubmit   = isNameValid && !submitting && !itemsLoading;

  // ── Convex mutations ──────────────────────────────────────────────────────
  const createTemplate  = useCreateTemplate();
  const updateTemplate  = useUpdateTemplate();
  const setTemplateItems = useSetTemplateItems();

  // ── Scalar field change handlers ──────────────────────────────────────────

  const handleNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, name: e.target.value }));
  }, []);

  const handleDescChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, description: e.target.value }));
    },
    []
  );

  const handleActiveChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, isActive: e.target.checked }));
    },
    []
  );

  // ── Item change handlers ───────────────────────────────────────────────────

  const handleItemInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setItemInput(e.target.value);
    },
    []
  );

  /**
   * Append a new item to the list.
   * Trims the input value; ignores empty strings.
   */
  const handleAddItem = useCallback(() => {
    const trimmed = itemInput.trim();
    if (!trimmed) return;

    const newItem: TemplateItem = {
      id:       generateItemId(),
      name:     trimmed,
      required: true,
    };

    setItems((prev) => [...prev, newItem]);
    setItemInput("");
  }, [itemInput]);

  /**
   * Allow pressing Enter in the add-item input to trigger add.
   * Does not submit the outer form.
   */
  const handleItemInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault(); // Prevent outer form submission
        handleAddItem();
      }
    },
    [handleAddItem]
  );

  /**
   * Remove the item identified by `itemId` from the list.
   */
  const handleRemoveItem = useCallback((itemId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== itemId));
  }, []);

  // ── Item reordering (up/down arrows) ──────────────────────────────────────

  /**
   * Move an item one position up or down in the list.
   * No-ops when the item is already at the boundary in the requested direction.
   */
  const handleMoveItem = useCallback(
    (itemId: string, direction: "up" | "down") => {
      setItems((prev) => {
        const idx = prev.findIndex((item) => item.id === itemId);
        if (idx === -1) return prev;
        if (direction === "up" && idx === 0) return prev;
        if (direction === "down" && idx === prev.length - 1) return prev;

        const next = [...prev];
        const targetIdx = direction === "up" ? idx - 1 : idx + 1;
        // Swap the item with its neighbour
        [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
        return next;
      });
    },
    []
  );

  // ── Item reordering (HTML5 drag-and-drop) ─────────────────────────────────

  /**
   * Index of the item row currently being dragged.
   * null when no drag is in progress.
   */
  const [dragSourceIdx, setDragSourceIdx] = useState<number | null>(null);

  /**
   * Index of the item row currently being dragged over (drop target candidate).
   * null when no drag is in progress or cursor is not over a valid row.
   */
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLLIElement>, idx: number) => {
      // Store the source index; use plain text for cross-browser compatibility
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(idx));
      setDragSourceIdx(idx);
    },
    []
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLLIElement>, idx: number) => {
      e.preventDefault(); // Allow drop
      e.dataTransfer.dropEffect = "move";
      setDragOverIdx(idx);
    },
    []
  );

  const handleDragLeave = useCallback(() => {
    setDragOverIdx(null);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLLIElement>, targetIdx: number) => {
      e.preventDefault();
      const sourceIdx = dragSourceIdx;
      setDragSourceIdx(null);
      setDragOverIdx(null);

      if (sourceIdx === null || sourceIdx === targetIdx) return;

      setItems((prev) => {
        const next = [...prev];
        const [dragged] = next.splice(sourceIdx, 1);
        next.splice(targetIdx, 0, dragged);
        return next;
      });
    },
    [dragSourceIdx]
  );

  const handleDragEnd = useCallback(() => {
    // Clean up drag state even if drop was cancelled (e.g. Escape)
    setDragSourceIdx(null);
    setDragOverIdx(null);
  }, []);

  // ── Submit handler ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!canSubmit) return;

      setSubmitting(true);
      try {
        const trimmedName        = form.name.trim();
        const trimmedDescription = form.description.trim() || undefined;

        // Assign stable sortOrder values by array position
        const orderedItems = items.map((item, idx) => ({
          ...item,
          sortOrder: idx,
        }));

        if (isEditMode) {
          // ── Edit mode ──────────────────────────────────────────────────
          // Update scalar fields first, then atomically replace items list.
          await updateTemplate({
            templateId:  editing!._id as Id<"caseTemplates">,
            name:        trimmedName,
            description: trimmedDescription,
            isActive:    form.isActive,
          });
          await setTemplateItems({
            templateId: editing!._id as Id<"caseTemplates">,
            items:      orderedItems,
          });
          onSuccess(`"${trimmedName}" updated.`);
        } else {
          // ── Create mode ────────────────────────────────────────────────
          await createTemplate({
            name:        trimmedName,
            description: trimmedDescription,
            isActive:    form.isActive,
            items:       orderedItems,
          });
          onSuccess(`"${trimmedName}" created.`);
        }

        // Close the form after a successful mutation
        onCancel();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        onError(
          isEditMode
            ? `Update failed: ${message}`
            : `Create failed: ${message}`
        );
      } finally {
        setSubmitting(false);
      }
    },
    [
      canSubmit,
      form,
      items,
      isEditMode,
      editing,
      createTemplate,
      updateTemplate,
      setTemplateItems,
      onSuccess,
      onError,
      onCancel,
    ]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <form
      className={`${styles.form}${className ? ` ${className}` : ""}`}
      onSubmit={handleSubmit}
      noValidate
      aria-label={isEditMode ? "Edit kit template" : "Create kit template"}
    >
      {/* ── Template name ──────────────────────────────────────────── */}
      <div className={styles.fieldGroup}>
        <label
          id={nameLabelId}
          htmlFor={nameId}
          className={styles.label}
        >
          Template name{" "}
          <span className={styles.required} aria-label="required">
            *
          </span>
        </label>

        <input
          id={nameId}
          type="text"
          className={styles.input}
          value={form.name}
          onChange={handleNameChange}
          required
          aria-required="true"
          aria-labelledby={nameLabelId}
          placeholder="e.g. Field Inspection Kit"
          autoComplete="off"
          autoFocus
          disabled={submitting}
          data-testid="template-form-name"
        />

        {/* Inline validation hint — only shown when name is empty after touch */}
        {form.name !== "" && !isNameValid && (
          <p className={styles.fieldError} role="alert">
            Template name is required.
          </p>
        )}
      </div>

      {/* ── Description ────────────────────────────────────────────── */}
      <div className={styles.fieldGroup}>
        <label
          id={descLabelId}
          htmlFor={descId}
          className={styles.label}
        >
          Description{" "}
          <span className={styles.labelOptional}>(optional)</span>
        </label>

        <textarea
          id={descId}
          className={styles.textarea}
          value={form.description}
          onChange={handleDescChange}
          rows={3}
          aria-labelledby={descLabelId}
          placeholder="Describe when to use this template…"
          disabled={submitting}
          data-testid="template-form-description"
        />
      </div>

      {/* ── Item definition list ───────────────────────────────────── */}
      <div className={styles.itemsSection} role="group" aria-labelledby={itemsLabelId}>
        <div className={styles.itemsSectionHeader}>
          <span id={itemsLabelId} className={styles.label}>
            Packing list items
          </span>
          <span className={styles.itemsCount}>
            {items.length === 0
              ? "No items"
              : `${items.length} item${items.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* ── Add-item row ──────────────────────────────────────── */}
        <div className={styles.itemsAddRow}>
          <input
            id={itemInputId}
            type="text"
            className={`${styles.input} ${styles.itemsAddInput}`}
            value={itemInput}
            onChange={handleItemInputChange}
            onKeyDown={handleItemInputKeyDown}
            placeholder="Item name…"
            aria-label="New item name"
            disabled={submitting || itemsLoading}
            autoComplete="off"
            data-testid="template-form-item-input"
          />
          <button
            type="button"
            className={`${styles.btn} ${styles.btnAddItem}`}
            onClick={handleAddItem}
            disabled={itemInput.trim().length === 0 || submitting || itemsLoading}
            aria-label="Add item to packing list"
            data-testid="template-form-item-add"
          >
            Add
          </button>
        </div>

        {/* ── Items list ────────────────────────────────────────── */}
        {itemsLoading ? (
          <p className={styles.itemsLoadingHint} aria-live="polite">
            Loading items…
          </p>
        ) : items.length === 0 ? (
          <p className={styles.itemsEmptyHint}>
            No items yet — add the first item above.
          </p>
        ) : (
          <ul
            className={styles.itemList}
            aria-label="Packing list items"
            data-testid="template-form-item-list"
          >
            {items.map((item, idx) => (
              <li
                key={item.id}
                className={[
                  styles.itemRow,
                  dragSourceIdx === idx ? styles.itemRowDragging : "",
                  dragOverIdx === idx && dragSourceIdx !== idx
                    ? styles.itemRowDragOver
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                draggable={!submitting && !itemsLoading}
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                data-testid={`template-form-item-${idx}`}
              >
                {/* ── Drag handle ─────────────────────────────── */}
                <span
                  className={styles.itemDragHandle}
                  aria-hidden="true"
                  title="Drag to reorder"
                >
                  ⠿
                </span>

                {/* ── Position badge ──────────────────────────── */}
                <span className={styles.itemOrderBadge} aria-hidden="true">
                  {idx + 1}
                </span>

                {/* ── Item name ───────────────────────────────── */}
                <span className={styles.itemName}>{item.name}</span>

                {/* ── Up / down reorder buttons ────────────────── */}
                <button
                  type="button"
                  className={`${styles.itemMoveBtn}`}
                  onClick={() => handleMoveItem(item.id, "up")}
                  disabled={idx === 0 || submitting}
                  aria-label={`Move "${item.name}" up`}
                  data-testid={`template-form-item-move-up-${idx}`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={`${styles.itemMoveBtn}`}
                  onClick={() => handleMoveItem(item.id, "down")}
                  disabled={idx === items.length - 1 || submitting}
                  aria-label={`Move "${item.name}" down`}
                  data-testid={`template-form-item-move-down-${idx}`}
                >
                  ↓
                </button>

                {/* ── Remove button ────────────────────────────── */}
                <button
                  type="button"
                  className={styles.itemRemoveBtn}
                  onClick={() => handleRemoveItem(item.id)}
                  aria-label={`Remove item "${item.name}"`}
                  disabled={submitting}
                  data-testid={`template-form-item-remove-${idx}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Active toggle ───────────────────────────────────────────── */}
      <div className={styles.checkboxGroup}>
        <input
          id={activeId}
          type="checkbox"
          className={styles.checkbox}
          checked={form.isActive}
          onChange={handleActiveChange}
          disabled={submitting}
          data-testid="template-form-active"
        />
        <label htmlFor={activeId} className={styles.checkboxLabel}>
          <span className={styles.checkboxLabelMain}>Active</span>
          <span className={styles.checkboxLabelSub}>
            Available in kit filter dropdowns and the SCAN app
          </span>
        </label>
      </div>

      {/* ── Actions ────────────────────────────────────────────────── */}
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnCancel}`}
          onClick={onCancel}
          disabled={submitting}
          data-testid="template-form-cancel"
        >
          Cancel
        </button>

        <button
          type="submit"
          className={`${styles.btn} ${styles.btnSave}`}
          disabled={!canSubmit}
          aria-disabled={!canSubmit}
          data-testid="template-form-submit"
        >
          {submitting
            ? isEditMode
              ? "Saving…"
              : "Creating…"
            : isEditMode
            ? "Save changes"
            : "Create template"}
        </button>
      </div>
    </form>
  );
}
