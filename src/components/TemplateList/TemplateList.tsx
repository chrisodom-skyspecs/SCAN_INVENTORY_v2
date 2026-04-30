/**
 * TemplateList — Admin UI for kit template (packing list definition) management.
 *
 * Renders all kit templates (active + inactive) in a responsive card grid with
 * real-time Convex subscriptions and full CRUD actions:
 *
 *   Create  — opens a modal form; submits api.caseTemplates.createTemplate
 *   Edit    — opens the same modal pre-filled; submits api.caseTemplates.updateTemplate
 *   Delete  — soft-delete with a confirmation dialog (api.caseTemplates.deleteTemplate)
 *   Restore — re-activates an archived template (api.caseTemplates.updateTemplate)
 *   Duplicate — clones a template with a "Copy of …" prefix
 *
 * Real-time:
 *   Uses useAllCaseTemplates() which wraps api.caseTemplates.getAllTemplates — a
 *   Convex useQuery subscription that pushes diffs within ~100–300 ms of any
 *   template mutation.
 *
 * Loading state:
 *   Skeleton cards are shown while the initial subscription is pending.
 *
 * Empty state:
 *   A centred call-to-action is shown when no templates exist.
 *
 * Design system compliance:
 *   - No hex literals — all colors via CSS custom properties
 *   - Inter Tight for UI text, IBM Plex Mono for counts / timestamps
 *   - StatusPill is NOT used here (templates don't have lifecycle statuses);
 *     active/inactive badge uses inline .badgeActive / .badgeInactive CSS
 *   - WCAG AA contrast in both light and dark themes
 *
 * Accessibility:
 *   - All action buttons labeled with aria-label
 *   - Confirmation dialog uses role="dialog" + aria-modal + aria-labelledby
 *   - Create/edit form uses proper <label> associations
 *   - Toast area uses aria-live="polite"
 */

"use client";

import { useState, useCallback, useId } from "react";
import { useAllCaseTemplates, useUpdateTemplate, useDeleteTemplate, useDuplicateTemplate } from "@/hooks/use-case-templates";
import type { CaseTemplateSummary } from "@/hooks/use-case-templates";
import type { Id } from "../../../convex/_generated/dataModel";
import { TemplateForm } from "@/components/TemplateForm";
import styles from "./TemplateList.module.css";

// ─── Toast helpers ─────────────────────────────────────────────────────────────

interface Toast {
  id: string;
  message: string;
  variant: "success" | "error";
}

// ─── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className={styles.skeletonCard} aria-hidden="true">
      <div className={`${styles.skeletonBar} ${styles.skeletonBarTitle}`} />
      <div className={`${styles.skeletonBar} ${styles.skeletonBarDesc}`} />
      <div className={`${styles.skeletonBar} ${styles.skeletonBarDesc2}`} />
      <div className={`${styles.skeletonBar} ${styles.skeletonBarMeta}`} />
    </div>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 3.5a.75.75 0 0 1 .75.75v3h3a.75.75 0 0 1 0 1.5h-3v3a.75.75 0 0 1-1.5 0v-3h-3a.75.75 0 0 1 0-1.5h3v-3A.75.75 0 0 1 8 3.5Z" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M11.013 2.513a1.75 1.75 0 0 1 2.475 2.474L6.226 12.25a2.751 2.751 0 0 1-.892.596l-2.047.848a.75.75 0 0 1-.98-.98l.848-2.047a2.75 2.75 0 0 1 .596-.892l7.262-7.262Z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.75 2A1.75 1.75 0 0 0 2 3.75v7.5C2 12.216 2.784 13 3.75 13H5v-1.5H3.75a.25.25 0 0 1-.25-.25v-7.5a.25.25 0 0 1 .25-.25h4.5a.25.25 0 0 1 .25.25V5H10V3.75A1.75 1.75 0 0 0 8.25 2h-4.5Z" />
      <path d="M6.75 6A1.75 1.75 0 0 0 5 7.75v4.5C5 13.216 5.784 14 6.75 14h4.5A1.75 1.75 0 0 0 13 12.25v-4.5A1.75 1.75 0 0 0 11.25 6h-4.5Z" />
    </svg>
  );
}

function BoxesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 6l10-4 10 4-10 4-10-4Z" />
      <path d="M12 20l-8-3.2V9.8L12 13l8-3.2v7L12 20Z" />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 4.75A.75.75 0 0 1 2.75 4h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 3.5A.75.75 0 0 1 2.75 7.5h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8.25Zm0 3.5A.75.75 0 0 1 2.75 11h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 11.75Z" />
    </svg>
  );
}

function ArrowPathIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M8 2.5a5.5 5.5 0 1 0 4.596 2.473.75.75 0 1 1 1.252-.832A7 7 0 1 1 8 1a.75.75 0 0 1 0 1.5Z"
        clipRule="evenodd"
      />
      <path d="M6.88 3.853a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75V1.353a.75.75 0 0 1 1.5 0v2.5Z" />
    </svg>
  );
}

// ─── Template form modal ───────────────────────────────────────────────────────

/**
 * TemplateFormModal — dialog wrapper around the standalone TemplateForm component.
 *
 * Provides the backdrop + dialog chrome (title, role, aria-modal) while
 * delegating all form rendering and Convex mutations to <TemplateForm />.
 */
interface TemplateFormModalProps {
  /** null = create mode; CaseTemplateSummary = edit mode */
  editing: CaseTemplateSummary | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

function TemplateFormModal({
  editing,
  onClose,
  onSuccess,
  onError,
}: TemplateFormModalProps) {
  const titleId    = useId();
  const isEditMode = editing !== null;

  return (
    <div
      className={styles.dialogBackdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className={styles.dialogTitle}>
          {isEditMode ? "Edit Template" : "New Kit Template"}
        </h2>

        {/* Delegate form rendering + Convex mutation calls to TemplateForm */}
        <TemplateForm
          editing={editing}
          onSuccess={onSuccess}
          onError={onError}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}

// ─── Delete confirm dialog ─────────────────────────────────────────────────────

interface DeleteConfirmDialogProps {
  template: CaseTemplateSummary;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

function DeleteConfirmDialog({
  template,
  onClose,
  onSuccess,
  onError,
}: DeleteConfirmDialogProps) {
  const titleId = useId();
  const [deleting, setDeleting] = useState(false);
  const deleteTemplate = useDeleteTemplate();

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteTemplate({
        templateId: template._id as Id<"caseTemplates">,
      });
      onSuccess(`"${template.name}" archived.`);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      onError(`Archive failed: ${msg}`);
      setDeleting(false);
    }
  }

  return (
    <div
      className={styles.dialogBackdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !deleting) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className={styles.dialogTitle}>
          Archive template?
        </h2>
        <p className={styles.dialogBody}>
          <strong>&ldquo;{template.name}&rdquo;</strong> will be archived and
          hidden from kit dropdowns and the SCAN app. Existing cases that
          reference this template are unaffected.{" "}
          {template.itemCount > 0 && (
            <>It currently has {template.itemCount} item{template.itemCount !== 1 ? "s" : ""}.</>
          )}
        </p>
        <p className={styles.dialogBody} style={{ marginTop: "-0.5rem" }}>
          You can restore it later from the admin template list.
        </p>
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnCancel}`}
            onClick={onClose}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnConfirmDelete}`}
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Archiving…" : "Archive template"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Template card ─────────────────────────────────────────────────────────────

interface TemplateCardProps {
  template: CaseTemplateSummary;
  onEdit: (t: CaseTemplateSummary) => void;
  onDelete: (t: CaseTemplateSummary) => void;
  onDuplicate: (t: CaseTemplateSummary) => void;
  onRestore: (t: CaseTemplateSummary) => void;
}

function TemplateCard({
  template,
  onEdit,
  onDelete,
  onDuplicate,
  onRestore,
}: TemplateCardProps) {
  const updatedAgo = formatRelativeTime(template.updatedAt);

  return (
    <li className={styles.card} data-testid={`template-card-${template._id}`}>
      {/* Card header: name + status badge */}
      <div className={styles.cardHeader}>
        <h3 className={styles.cardName}>{template.name}</h3>
        {template.isActive ? (
          <span className={styles.badgeActive}>Active</span>
        ) : (
          <span className={styles.badgeInactive}>Archived</span>
        )}
      </div>

      {/* Card body: description + meta */}
      <div className={styles.cardBody}>
        {template.description ? (
          <p className={styles.cardDescription}>{template.description}</p>
        ) : (
          <p className={styles.cardDescription} style={{ color: "var(--ink-disabled)" }}>
            No description
          </p>
        )}

        <div className={styles.cardMeta}>
          {/* Item count */}
          <span className={styles.cardMetaItem}>
            <ListIcon className={styles.cardMetaIcon} />
            <span className={styles.cardMetaValue}>
              {template.itemCount} item{template.itemCount !== 1 ? "s" : ""}
            </span>
          </span>

          {/* Last updated */}
          <span className={styles.cardMetaItem}>
            <span className={styles.cardMetaValue}>
              Updated {updatedAgo}
            </span>
          </span>
        </div>
      </div>

      {/* Card actions */}
      <div className={styles.cardActions}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnEdit}`}
          onClick={() => onEdit(template)}
          aria-label={`Edit template "${template.name}"`}
        >
          <PencilIcon className={styles.btnIcon} />
          Edit
        </button>

        <button
          type="button"
          className={`${styles.btn} ${styles.btnDuplicate}`}
          onClick={() => onDuplicate(template)}
          aria-label={`Duplicate template "${template.name}"`}
        >
          <CopyIcon className={styles.btnIcon} />
          Duplicate
        </button>

        {template.isActive ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDelete}`}
            onClick={() => onDelete(template)}
            aria-label={`Archive template "${template.name}"`}
          >
            <TrashIcon className={styles.btnIcon} />
            Archive
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnDelete}`}
            onClick={() => onRestore(template)}
            aria-label={`Restore template "${template.name}"`}
            style={{ color: "var(--ink-brand)" }}
          >
            <ArrowPathIcon className={styles.btnIcon} />
            Restore
          </button>
        )}
      </div>
    </li>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  onCreateClick: () => void;
}

function EmptyState({ onCreateClick }: EmptyStateProps) {
  return (
    <div className={styles.emptyState} data-testid="template-list-empty">
      <BoxesIcon className={styles.emptyIcon} />
      <h3 className={styles.emptyTitle}>No kit templates yet</h3>
      <p className={styles.emptyText}>
        Kit templates define the packing lists applied to equipment cases.
        Create your first template to start tracking items in field inspections.
      </p>
      <div className={styles.emptyAction}>
        <button
          type="button"
          className={styles.btnCreate}
          onClick={onCreateClick}
        >
          <PlusIcon className={styles.btnCreateIcon} />
          Create first template
        </button>
      </div>
    </div>
  );
}

// ─── Utility: relative time ───────────────────────────────────────────────────

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const date = new Date(ts);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Main component ────────────────────────────────────────────────────────────

/**
 * TemplateList — the top-level admin template list view.
 *
 * Self-contained: no props required.  Uses Convex hooks internally.
 */
export function TemplateList() {
  const { templates, isLoading } = useAllCaseTemplates();

  // Modal/dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CaseTemplateSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CaseTemplateSummary | null>(null);

  // Toast feedback
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((message: string, variant: Toast["variant"]) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, variant }]);
    // Auto-dismiss after 4 s
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const pushSuccess = useCallback(
    (message: string) => pushToast(message, "success"),
    [pushToast]
  );
  const pushError = useCallback(
    (message: string) => pushToast(message, "error"),
    [pushToast]
  );

  // Mutations
  const duplicateTemplate = useDuplicateTemplate();
  const updateTemplate = useUpdateTemplate();

  const handleCreateClick = useCallback(() => {
    setEditTarget(null);
    setFormOpen(true);
  }, []);

  const handleEditClick = useCallback((t: CaseTemplateSummary) => {
    setEditTarget(t);
    setFormOpen(true);
  }, []);

  const handleDeleteClick = useCallback((t: CaseTemplateSummary) => {
    setDeleteTarget(t);
  }, []);

  const handleDuplicateClick = useCallback(
    async (t: CaseTemplateSummary) => {
      try {
        await duplicateTemplate({ templateId: t._id as Id<"caseTemplates"> });
        pushSuccess(`Duplicated "${t.name}".`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        pushError(`Duplicate failed: ${msg}`);
      }
    },
    [duplicateTemplate, pushError, pushSuccess]
  );

  const handleRestoreClick = useCallback(
    async (t: CaseTemplateSummary) => {
      try {
        await updateTemplate({
          templateId: t._id as Id<"caseTemplates">,
          isActive: true,
        });
        pushSuccess(`"${t.name}" restored.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        pushError(`Restore failed: ${msg}`);
      }
    },
    [updateTemplate, pushError, pushSuccess]
  );

  const closeForm = useCallback(() => setFormOpen(false), []);
  const closeDelete = useCallback(() => setDeleteTarget(null), []);

  // ── Render ────────────────────────────────────────────────────────────────

  const totalCount = templates?.length ?? 0;
  const activeCount = templates?.filter((t) => t.isActive).length ?? 0;

  return (
    <div className={styles.root} data-testid="template-list">

      {/* ── Page header ─────────────────────────────────────────── */}
      <header className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <h1 className={styles.pageTitle}>Kit Templates</h1>
          {!isLoading && (
            <div className={styles.pageTitleSub}>
              {totalCount === 0
                ? "No templates"
                : `${activeCount} active · ${totalCount} total`}
            </div>
          )}
        </div>

        <button
          type="button"
          className={styles.btnCreate}
          onClick={handleCreateClick}
          aria-label="Create new kit template"
        >
          <PlusIcon className={styles.btnCreateIcon} />
          New template
        </button>
      </header>

      {/* ── Scroll area ─────────────────────────────────────────── */}
      <div className={styles.scrollArea}>

        {/* Loading state — skeleton grid */}
        {isLoading && (
          <ul
            className={styles.templateGrid}
            aria-label="Kit templates loading"
            aria-busy="true"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <SkeletonCard key={i} />
            ))}
          </ul>
        )}

        {/* Empty state */}
        {!isLoading && totalCount === 0 && (
          <EmptyState onCreateClick={handleCreateClick} />
        )}

        {/* Template grid */}
        {!isLoading && totalCount > 0 && (
          <ul
            className={styles.templateGrid}
            aria-label="Kit templates"
          >
            {(templates ?? []).map((template) => (
              <TemplateCard
                key={template._id}
                template={template}
                onEdit={handleEditClick}
                onDelete={handleDeleteClick}
                onDuplicate={handleDuplicateClick}
                onRestore={handleRestoreClick}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── Create / edit modal ──────────────────────────────────── */}
      {formOpen && (
        <TemplateFormModal
          editing={editTarget}
          onClose={closeForm}
          onSuccess={pushSuccess}
          onError={pushError}
        />
      )}

      {/* ── Delete confirmation dialog ───────────────────────────── */}
      {deleteTarget && (
        <DeleteConfirmDialog
          template={deleteTarget}
          onClose={closeDelete}
          onSuccess={pushSuccess}
          onError={pushError}
        />
      )}

      {/* ── Toast notification area ──────────────────────────────── */}
      <div className={styles.toastArea} aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`${styles.toast} ${
              t.variant === "success" ? styles.toastSuccess : styles.toastError
            }`}
            role="status"
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
