/**
 * UserInviteEditModal — Admin UI for inviting new users and editing existing ones.
 *
 * Handles two distinct modes driven by the `mode` prop:
 *
 *   "invite"  — Creates a new user record via `api.users.createUser`.
 *               All fields are editable; kindeId is required (admin must invite
 *               the user in the Kinde dashboard first to obtain their Kinde ID).
 *               New records are created with status "pending".
 *
 *   "edit"    — Updates an existing user via `api.users.updateUser`.
 *               Name and role fields are editable. Email and kindeId are locked
 *               (these are managed by Kinde; email updates are reflected
 *               automatically on next login via the upsertUser sync).
 *
 * Form fields:
 *   Given name  — optional; contributes to the display name
 *   Family name — optional; combined with given name for display
 *   Email       — required for invite; read-only in edit mode
 *   Kinde ID    — required for invite; hidden in edit mode
 *   Role        — required; Admin | Operator | Technician | Pilot
 *
 * Design system compliance:
 *   - All colors via CSS custom properties (no hex literals)
 *   - Inter Tight for all UI text
 *   - IBM Plex Mono for the Kinde ID field (monospaced identifier)
 *   - WCAG AA contrast in both light and dark themes
 *   - Focus-visible ring via --elevation-focus token
 *   - Reduced-motion safe (no CSS animations in this component)
 *
 * Authorization:
 *   Rendered only for admin callers — the parent (UserListTable) gates visibility.
 *   Both Convex mutations also enforce `requireAdmin` server-side.
 */

"use client";

import { useState, useId, useRef, useEffect } from "react";
import { useCreateUser, useUpdateUser, type UserRole, type UserSummary } from "@/hooks/use-users";
import styles from "./UserInviteEditModal.module.css";

// ─── Constants ─────────────────────────────────────────────────────────────────

const ALL_ROLES: UserRole[] = ["admin", "operator", "technician", "pilot"];

const ROLE_LABELS: Record<UserRole, string> = {
  admin:      "Admin",
  operator:   "Operator",
  technician: "Technician",
  pilot:      "Pilot",
};

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ModalMode = "invite" | "edit";

export interface UserInviteEditModalProps {
  /** Operational mode — drives which fields are shown and which mutation fires. */
  mode: ModalMode;
  /**
   * Existing user to edit.
   * Required when `mode === "edit"`, ignored when `mode === "invite"`.
   */
  user?: UserSummary;
  /** Kinde ID of the currently logged-in admin performing the action. */
  adminId: string;
  /** Called when the modal should be dismissed (cancel or after successful save). */
  onClose: () => void;
  /** Called with a success message after a successful mutation. */
  onSuccess: (message: string) => void;
  /** Called with an error message when a mutation fails. */
  onError: (message: string) => void;
}

// ─── Field validation ──────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  givenName?: string;
  familyName?: string;
  email?: string;
  kindeId?: string;
  role?: string;
}

function validateInvite(fields: {
  givenName: string;
  familyName: string;
  email: string;
  kindeId: string;
  role: string;
}): FieldErrors {
  const errors: FieldErrors = {};

  if (!fields.email.trim()) {
    errors.email = "Email is required.";
  } else if (!EMAIL_RE.test(fields.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (!fields.kindeId.trim()) {
    errors.kindeId = "Kinde ID is required. Invite the user in the Kinde dashboard first.";
  }

  if (!fields.role) {
    errors.role = "Select a role.";
  }

  return errors;
}

function validateEdit(fields: { role: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (!fields.role) {
    errors.role = "Select a role.";
  }
  return errors;
}

function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

// ─── Inline form error ─────────────────────────────────────────────────────────

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <span className={styles.fieldError} role="alert" aria-live="polite">
      {message}
    </span>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function InfoIcon({ className }: { className?: string }) {
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
        d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM8.75 5a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm-.75 2.25a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0V8a.75.75 0 0 0-.75-.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

/**
 * UserInviteEditModal — invite a new user or edit an existing user's profile.
 *
 * @example
 * // Invite mode (no user prop needed):
 * <UserInviteEditModal
 *   mode="invite"
 *   adminId={currentUser.id}
 *   onClose={() => setShowInvite(false)}
 *   onSuccess={pushSuccess}
 *   onError={pushError}
 * />
 *
 * // Edit mode:
 * <UserInviteEditModal
 *   mode="edit"
 *   user={selectedUser}
 *   adminId={currentUser.id}
 *   onClose={() => setEditTarget(null)}
 *   onSuccess={pushSuccess}
 *   onError={pushError}
 * />
 */
export function UserInviteEditModal({
  mode,
  user,
  adminId,
  onClose,
  onSuccess,
  onError,
}: UserInviteEditModalProps) {
  // ── Unique IDs for accessible label associations ─────────────────────────
  const titleId      = useId();
  const givenNameId  = useId();
  const familyNameId = useId();
  const emailId      = useId();
  const kindeIdId    = useId();
  const roleId       = useId();

  // ── Form state ────────────────────────────────────────────────────────────
  const [givenName,  setGivenName]  = useState(user?.givenName  ?? "");
  const [familyName, setFamilyName] = useState(user?.familyName ?? "");
  const [email,      setEmail]      = useState(user?.email      ?? "");
  const [kindeId,    setKindeId]    = useState("");
  const [role,       setRole]       = useState<UserRole>(user?.role ?? "operator");

  // ── Submission state ──────────────────────────────────────────────────────
  const [saving,       setSaving]       = useState(false);
  const [fieldErrors,  setFieldErrors]  = useState<FieldErrors>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // ── Convex mutations ──────────────────────────────────────────────────────
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  // ── Focus first field on mount ────────────────────────────────────────────
  const firstFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Delay slightly so the backdrop transition doesn't interfere with focus
    const id = window.setTimeout(() => firstFieldRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, []);

  // ── Re-validate on input change when user has already attempted submit ────
  useEffect(() => {
    if (!submitAttempted) return;
    if (mode === "invite") {
      setFieldErrors(validateInvite({ givenName, familyName, email, kindeId, role }));
    } else {
      setFieldErrors(validateEdit({ role }));
    }
  }, [givenName, familyName, email, kindeId, role, mode, submitAttempted]);

  // ── Submit handler ────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);

    // Client-side validation
    const errors =
      mode === "invite"
        ? validateInvite({ givenName, familyName, email, kindeId, role })
        : validateEdit({ role });

    setFieldErrors(errors);
    if (hasErrors(errors)) return;

    setSaving(true);

    try {
      if (mode === "invite") {
        await createUser({
          adminId,
          kindeId:    kindeId.trim(),
          email:      email.trim(),
          role,
          givenName:  givenName.trim() || undefined,
          familyName: familyName.trim() || undefined,
        });

        const displayName =
          givenName.trim() && familyName.trim()
            ? `${givenName.trim()} ${familyName.trim()}`
            : givenName.trim() || email.trim();

        onSuccess(`${displayName} has been invited with role "${ROLE_LABELS[role]}".`);
      } else {
        // Edit mode — only update the fields that may have changed
        await updateUser({
          adminId,
          kindeId:    user!.kindeId,
          givenName:  givenName.trim() || undefined,
          familyName: familyName.trim() || undefined,
          role,
        });

        onSuccess(`${user!.name}'s profile has been updated.`);
      }

      onClose();
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "Unknown error";

      // Surface friendly versions of known server-side error codes
      let friendlyMessage = rawMessage;
      if (rawMessage.includes("[CONFLICT]")) {
        if (rawMessage.toLowerCase().includes("kindeid")) {
          friendlyMessage = "A user with this Kinde ID is already registered.";
        } else {
          friendlyMessage = "A user with this email address is already registered.";
        }
      } else if (rawMessage.includes("[ACCESS_DENIED]")) {
        friendlyMessage = "You don't have permission to perform this action.";
      } else if (rawMessage.includes("[SELF_DEMOTE]")) {
        friendlyMessage = "An admin cannot change their own role away from Admin.";
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

  const isInvite = mode === "invite";
  const titleText = isInvite ? "Invite user" : "Edit user";
  const submitLabel = saving
    ? isInvite ? "Inviting…" : "Saving…"
    : isInvite ? "Send invite" : "Save changes";

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
          {/* ── Name row ── */}
          <div className={styles.formRow}>
            <div className={styles.formField}>
              <label htmlFor={givenNameId} className={styles.formLabel}>
                Given name
                <span className={styles.optionalTag} aria-label="optional">
                  Optional
                </span>
              </label>
              <input
                ref={firstFieldRef}
                id={givenNameId}
                type="text"
                className={`${styles.formInput} ${fieldErrors.givenName ? styles.formInputError : ""}`}
                value={givenName}
                onChange={(e) => setGivenName(e.target.value)}
                placeholder="Jane"
                autoComplete="given-name"
                disabled={saving}
                aria-describedby={fieldErrors.givenName ? `${givenNameId}-error` : undefined}
                aria-invalid={!!fieldErrors.givenName}
              />
              <FieldError message={fieldErrors.givenName} />
            </div>

            <div className={styles.formField}>
              <label htmlFor={familyNameId} className={styles.formLabel}>
                Family name
                <span className={styles.optionalTag} aria-label="optional">
                  Optional
                </span>
              </label>
              <input
                id={familyNameId}
                type="text"
                className={`${styles.formInput} ${fieldErrors.familyName ? styles.formInputError : ""}`}
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                placeholder="Smith"
                autoComplete="family-name"
                disabled={saving}
                aria-describedby={fieldErrors.familyName ? `${familyNameId}-error` : undefined}
                aria-invalid={!!fieldErrors.familyName}
              />
              <FieldError message={fieldErrors.familyName} />
            </div>
          </div>

          {/* ── Email ── */}
          <div className={styles.formField}>
            <label htmlFor={emailId} className={styles.formLabel}>
              Email address
              {isInvite && (
                <span className={styles.requiredMark} aria-label="required">
                  *
                </span>
              )}
            </label>
            <input
              id={emailId}
              type="email"
              className={`${styles.formInput} ${fieldErrors.email ? styles.formInputError : ""} ${!isInvite ? styles.formInputReadonly : ""}`}
              value={email}
              onChange={(e) => isInvite && setEmail(e.target.value)}
              placeholder={isInvite ? "jane.smith@skyspecs.com" : undefined}
              autoComplete="email"
              disabled={saving || !isInvite}
              readOnly={!isInvite}
              aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
              aria-invalid={!!fieldErrors.email}
              aria-readonly={!isInvite}
            />
            {!isInvite && (
              <p className={styles.fieldHint}>
                Email is managed by Kinde and updated automatically on login.
              </p>
            )}
            <FieldError message={fieldErrors.email} />
          </div>

          {/* ── Kinde ID (invite-only) ── */}
          {isInvite && (
            <div className={styles.formField}>
              <label htmlFor={kindeIdId} className={styles.formLabel}>
                Kinde ID
                <span className={styles.requiredMark} aria-label="required">
                  *
                </span>
              </label>
              <input
                id={kindeIdId}
                type="text"
                className={`${styles.formInputMono} ${fieldErrors.kindeId ? styles.formInputError : ""}`}
                value={kindeId}
                onChange={(e) => setKindeId(e.target.value)}
                placeholder="kp_01abc…"
                autoComplete="off"
                spellCheck={false}
                disabled={saving}
                aria-describedby={`${kindeIdId}-hint${fieldErrors.kindeId ? ` ${kindeIdId}-error` : ""}`}
                aria-invalid={!!fieldErrors.kindeId}
              />
              <p id={`${kindeIdId}-hint`} className={styles.fieldHint}>
                <InfoIcon className={styles.hintIcon} />
                Invite the user in the Kinde dashboard first. Copy their Kinde user
                ID (starts with{" "}
                <code className={styles.inlineCode}>kp_</code>) from{" "}
                <em>Kinde → Users → [user] → Details</em>.
              </p>
              <FieldError message={fieldErrors.kindeId} />
            </div>
          )}

          {/* ── Role selector ── */}
          <div className={styles.formField}>
            <label htmlFor={roleId} className={styles.formLabel}>
              Role
              <span className={styles.requiredMark} aria-label="required">
                *
              </span>
            </label>
            <select
              id={roleId}
              className={`${styles.formSelect} ${fieldErrors.role ? styles.formInputError : ""}`}
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              disabled={saving}
              aria-describedby={fieldErrors.role ? `${roleId}-error` : `${roleId}-desc`}
              aria-invalid={!!fieldErrors.role}
            >
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <p id={`${roleId}-desc`} className={styles.fieldHint}>
              Determines what this user can view and do in INVENTORY and SCAN.
            </p>
            <FieldError message={fieldErrors.role} />
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
              disabled={saving}
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

// ─── Close icon ────────────────────────────────────────────────────────────────

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
