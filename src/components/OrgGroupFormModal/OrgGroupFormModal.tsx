/**
 * OrgGroupFormModal — Admin UI for creating and editing organization groups.
 *
 * Handles two distinct modes driven by the `mode` prop:
 *
 *   "create"  — Creates a new org group via `organizations.createOrganization`.
 *               All fields are editable. orgType defaults to "internal".
 *
 *   "edit"    — Updates an existing org via `organizations.updateOrganization`.
 *               Name and description fields are editable.
 *               orgType is locked after creation (displayed read-only) because
 *               changing org type would corrupt historical membership records.
 *
 * Form fields:
 *   Group name    — required; trimmed; must be unique within the same type
 *   Type          — required in create mode; read-only (locked) in edit mode
 *   Description   — optional; free-text description of the group's purpose
 *
 * Design system compliance:
 *   - All colors via CSS custom properties (no hex literals)
 *   - Inter Tight for all UI text
 *   - WCAG AA contrast in both light and dark themes
 *   - Focus-visible ring via --elevation-focus token
 *   - Reduced-motion safe (no CSS animations in this component)
 *
 * Authorization:
 *   Rendered only for admin callers — the parent (OrgGroupList) gates
 *   visibility.  Both Convex mutations also enforce `requireAdmin` server-side.
 */

"use client";

import { useState, useId, useRef, useEffect } from "react";
import {
  useCreateOrganization,
  useUpdateOrganization,
  type OrgWithCount,
} from "@/hooks/use-organizations";
import { OrgTypeBadge } from "@/components/OrgTypeBadge";
import styles from "./OrgGroupFormModal.module.css";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type OrgGroupFormMode = "create" | "edit";

export interface OrgGroupFormModalProps {
  /** Operational mode — "create" for new groups, "edit" for existing ones. */
  mode: OrgGroupFormMode;
  /**
   * Existing org group to edit.
   * Required when `mode === "edit"`, ignored when `mode === "create"`.
   */
  org?: OrgWithCount;
  /** Kinde ID of the currently logged-in admin performing the action. */
  adminId: string;
  /** Called when the modal should be dismissed (cancel or after successful save). */
  onClose: () => void;
  /** Called with a success message after a successful mutation. */
  onSuccess: (message: string) => void;
  /** Called with an error message when a mutation fails. */
  onError: (message: string) => void;
}

// ─── Validation ────────────────────────────────────────────────────────────────

interface FieldErrors {
  name?: string;
  orgType?: string;
  description?: string;
}

function validate(fields: {
  name: string;
  orgType: string;
  description: string;
  mode: OrgGroupFormMode;
}): FieldErrors {
  const errors: FieldErrors = {};

  if (!fields.name.trim()) {
    errors.name = "Group name is required.";
  } else if (fields.name.trim().length > 80) {
    errors.name = "Group name must be 80 characters or fewer.";
  }

  if (fields.mode === "create" && !fields.orgType) {
    errors.orgType = "Select a group type.";
  }

  if (fields.description.length > 300) {
    errors.description = "Description must be 300 characters or fewer.";
  }

  return errors;
}

function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

// ─── Inline field error ────────────────────────────────────────────────────────

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <span className={styles.fieldError} role="alert" aria-live="polite">
      {message}
    </span>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
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
        d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7A1.5 1.5 0 0 0 3 8.5v4A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 11 7V4.5A3.5 3.5 0 0 0 8 1Zm2 6V4.5a2 2 0 1 0-4 0V7h4Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

/**
 * OrgGroupFormModal — create a new org group or edit an existing one.
 *
 * @example
 * // Create mode:
 * <OrgGroupFormModal
 *   mode="create"
 *   adminId={currentUser.id}
 *   onClose={() => setShowCreate(false)}
 *   onSuccess={pushSuccess}
 *   onError={pushError}
 * />
 *
 * // Edit mode:
 * <OrgGroupFormModal
 *   mode="edit"
 *   org={selectedOrg}
 *   adminId={currentUser.id}
 *   onClose={() => setEditTarget(null)}
 *   onSuccess={pushSuccess}
 *   onError={pushError}
 * />
 */
export function OrgGroupFormModal({
  mode,
  org,
  adminId,
  onClose,
  onSuccess,
  onError,
}: OrgGroupFormModalProps) {
  // ── Unique IDs for accessible label associations ──────────────────────────
  const titleId       = useId();
  const nameId        = useId();
  const orgTypeId     = useId();
  const descriptionId = useId();

  // ── Form state ────────────────────────────────────────────────────────────
  const [name,        setName]        = useState(org?.name        ?? "");
  const [orgType,     setOrgType]     = useState<"internal" | "contractor">(
    org?.orgType ?? "internal"
  );
  const [description, setDescription] = useState(org?.description ?? "");

  // ── Submission state ──────────────────────────────────────────────────────
  const [saving,           setSaving]           = useState(false);
  const [fieldErrors,      setFieldErrors]      = useState<FieldErrors>({});
  const [submitAttempted,  setSubmitAttempted]  = useState(false);

  // ── Convex mutations ──────────────────────────────────────────────────────
  const createOrg = useCreateOrganization();
  const updateOrg = useUpdateOrganization();

  // ── Focus first field on mount ────────────────────────────────────────────
  const firstFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => firstFieldRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, []);

  // ── Re-validate on input change after first submit attempt ───────────────
  useEffect(() => {
    if (!submitAttempted) return;
    setFieldErrors(validate({ name, orgType, description, mode }));
  }, [name, orgType, description, mode, submitAttempted]);

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);

    const errors = validate({ name, orgType, description, mode });
    setFieldErrors(errors);
    if (hasErrors(errors)) return;

    setSaving(true);

    try {
      if (mode === "create") {
        await createOrg({
          adminId,
          name:        name.trim(),
          orgType,
          description: description.trim() || undefined,
        });

        onSuccess(`Org group "${name.trim()}" has been created.`);
      } else {
        if (!org) throw new Error("Org is required in edit mode.");

        await updateOrg({
          adminId,
          orgId:       org._id as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          name:        name.trim(),
          description: description.trim() || undefined,
        });

        onSuccess(`Org group "${name.trim()}" has been updated.`);
      }

      onClose();
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "Unknown error";

      // Map known server-side error codes to friendly messages
      let friendlyMessage = rawMessage;
      if (rawMessage.includes("[CONFLICT]")) {
        friendlyMessage = `An active ${orgType} organization with that name already exists. Choose a different name.`;
      } else if (rawMessage.includes("[ACCESS_DENIED]")) {
        friendlyMessage = "You don't have permission to perform this action.";
      } else if (rawMessage.includes("[NOT_FOUND]")) {
        friendlyMessage = "The organization was not found. It may have been deleted.";
      } else if (rawMessage.includes("[VALIDATION]")) {
        // Surface the validation message directly
        const match = rawMessage.match(/\[VALIDATION\] (.+)/);
        friendlyMessage = match ? match[1] : rawMessage;
      }

      onError(friendlyMessage);
      setSaving(false);
    }
  }

  // ── Keyboard: close on Escape ─────────────────────────────────────────────
  function handleBackdropKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && !saving) {
      onClose();
    }
  }

  const isCreate   = mode === "create";
  const titleText  = isCreate ? "New org group" : "Edit org group";
  const submitLabel = saving
    ? isCreate ? "Creating…" : "Saving…"
    : isCreate ? "Create group" : "Save changes";

  const charCount     = description.length;
  const charCountMax  = 300;
  const charCountOver = charCount > charCountMax;

  return (
    /* Backdrop */
    <div
      className={styles.dialogBackdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      onKeyDown={handleBackdropKeyDown}
    >
      {/* Dialog */}
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* Header */}
        <div className={styles.dialogHeader}>
          <h2 id={titleId} className={styles.dialogTitle}>
            {titleText}
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Close dialog"
            onClick={onClose}
            disabled={saving}
          >
            <CloseIcon className={styles.closeBtnIcon} />
          </button>
        </div>

        {/* Form */}
        <form
          className={styles.form}
          onSubmit={handleSubmit}
          noValidate
          aria-busy={saving}
        >
          {/* ── Group name ── */}
          <div className={styles.formField}>
            <label htmlFor={nameId} className={styles.formLabel}>
              Group name
              <span className={styles.requiredMark} aria-label="required">
                *
              </span>
            </label>
            <input
              ref={firstFieldRef}
              id={nameId}
              type="text"
              className={`${styles.formInput} ${fieldErrors.name ? styles.formInputError : ""}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Field Operations West"
              autoComplete="off"
              maxLength={80}
              disabled={saving}
              aria-required="true"
              aria-describedby={fieldErrors.name ? `${nameId}-error` : undefined}
              aria-invalid={!!fieldErrors.name}
            />
            <FieldError message={fieldErrors.name} />
          </div>

          {/* ── Type selector / locked display ── */}
          <div className={styles.formField}>
            <label
              htmlFor={isCreate ? orgTypeId : undefined}
              id={isCreate ? undefined : `${orgTypeId}-label`}
              className={styles.formLabel}
            >
              Type
              {isCreate && (
                <span className={styles.requiredMark} aria-label="required">
                  *
                </span>
              )}
              {!isCreate && (
                <LockIcon className={styles.lockIcon} />
              )}
            </label>

            {isCreate ? (
              /* Editable type selector in create mode */
              <select
                id={orgTypeId}
                className={`${styles.formSelect} ${fieldErrors.orgType ? styles.formInputError : ""}`}
                value={orgType}
                onChange={(e) =>
                  setOrgType(e.target.value as "internal" | "contractor")
                }
                disabled={saving}
                aria-required="true"
                aria-describedby={
                  fieldErrors.orgType
                    ? `${orgTypeId}-error`
                    : `${orgTypeId}-desc`
                }
                aria-invalid={!!fieldErrors.orgType}
              >
                <option value="internal">Internal</option>
                <option value="contractor">Contractor</option>
              </select>
            ) : (
              /* Locked display in edit mode — use shared OrgTypeBadge */
              <div
                className={styles.lockedField}
                role="status"
                aria-labelledby={`${orgTypeId}-label`}
                aria-describedby={`${orgTypeId}-locked-desc`}
              >
                <OrgTypeBadge orgType={orgType} size="md" />
              </div>
            )}

            {isCreate && (
              <p id={`${orgTypeId}-desc`} className={styles.fieldHint}>
                <strong>Internal</strong> — SkySpecs staff teams (Operations,
                Field Logistics, Engineering).{" "}
                <strong>Contractor</strong> — External companies or independent
                contractors performing field work.
              </p>
            )}

            {!isCreate && (
              <p
                id={`${orgTypeId}-locked-desc`}
                className={styles.fieldHint}
              >
                <LockIcon className={styles.hintIcon} />
                Group type cannot be changed after creation. This preserves the
                integrity of historical membership and custody records.
              </p>
            )}

            <FieldError message={fieldErrors.orgType} />
          </div>

          {/* ── Description ── */}
          <div className={styles.formField}>
            <label htmlFor={descriptionId} className={styles.formLabel}>
              Description
              <span className={styles.optionalTag} aria-label="optional">
                Optional
              </span>
            </label>
            <textarea
              id={descriptionId}
              className={`${styles.formTextarea} ${
                fieldErrors.description || charCountOver
                  ? styles.formInputError
                  : ""
              }`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this group's purpose or scope…"
              rows={3}
              disabled={saving}
              aria-describedby={
                fieldErrors.description
                  ? `${descriptionId}-error`
                  : `${descriptionId}-count`
              }
              aria-invalid={!!fieldErrors.description || charCountOver}
            />
            <div className={styles.textareaFooter}>
              <FieldError message={fieldErrors.description} />
              <span
                id={`${descriptionId}-count`}
                className={`${styles.charCount} ${
                  charCountOver ? styles.charCountOver : ""
                }`}
                aria-live="polite"
                aria-atomic="true"
              >
                {charCount}/{charCountMax}
              </span>
            </div>
          </div>

          {/* ── Actions ── */}
          <div className={styles.dialogActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnCancel}`}
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.btn} ${styles.btnConfirm}`}
              disabled={saving || charCountOver}
              aria-busy={saving}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
