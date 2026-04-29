/**
 * InlineHolderEditor — click-to-edit case holder (assignee) field.
 *
 * Provides a click-to-edit inline field for a case's "Assigned to" holder name
 * in the INVENTORY dashboard (T1 Summary, Dossier Overview Panel).
 *
 * States:
 *   idle     — Shows the current holder name (or "Unassigned" placeholder)
 *              plus a pencil icon button (visible on hover or keyboard focus)
 *              that activates edit mode.
 *   editing  — Shows a text input with the current holder name, plus Save and
 *              Cancel action buttons.  Escape cancels.
 *   saving   — Optimistic update applied immediately; spinner shown while the
 *              Convex mutation round-trip completes.
 *   error    — Server rejected the mutation; shows an error message with Retry
 *              and Cancel options.
 *
 * Optimistic update:
 *   Uses `useMutation(api.cases.updateCaseHolder).withOptimisticUpdate()` to
 *   patch the local `getCaseById` query result immediately on Save, so the
 *   displayed name reflects the new value before the server confirms.  Convex
 *   automatically rolls back if the mutation fails.
 *
 * Design system compliance:
 *   - No hex literals — CSS custom properties via InlineHolderEditor.module.css
 *   - Inter Tight for all UI labels and buttons
 *   - WCAG AA: proper aria-labels, keyboard navigation, focus management
 */

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useKindeUser } from "../../hooks/use-kinde-user";
import styles from "./InlineHolderEditor.module.css";

// ─── Edit state machine ────────────────────────────────────────────────────────

type EditState = "idle" | "editing" | "saving" | "error";

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface InlineHolderEditorProps {
  /** Convex document ID of the case whose holder is being edited. */
  caseId: string;
  /** Currently persisted holder name (assigneeName on the case document). */
  currentHolder: string | null | undefined;
  /** Optional additional class for the root element. */
  className?: string;
}

// ─── Pencil icon ─────────────────────────────────────────────────────────────

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.5 2.5a1.41 1.41 0 0 1 2 2L5 13H2v-3L11.5 2.5z" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * InlineHolderEditor — click-to-edit holder (assignee) field for the INVENTORY
 * dashboard.
 *
 * Renders as the holder name + edit icon in idle mode.  Clicking the pencil
 * icon (or pressing Enter/Space while focused) opens a text input + Save/Cancel
 * pair.  The Convex mutation applies an optimistic update immediately so the
 * displayed name reflects the change without waiting for the server round-trip.
 */
export function InlineHolderEditor({
  caseId,
  currentHolder,
  className,
}: InlineHolderEditorProps) {
  // Normalise undefined → null so the rest of the component works with a stable type
  const normalisedHolder = currentHolder ?? null;

  const [editState, setEditState] = useState<EditState>("idle");
  const [inputValue, setInputValue] = useState<string>(normalisedHolder ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ref for the text input — focused automatically when edit mode opens.
  const inputRef = useRef<HTMLInputElement>(null);

  // Current Kinde user identity for mutation attribution.
  const { id: userId, name: userName } = useKindeUser({ fallbackName: "Operator" });

  // ── Convex mutation with optimistic update ─────────────────────────────────
  //
  // withOptimisticUpdate patches the local getCaseById result immediately,
  // so the parent T1Overview (which subscribes to getCaseById) re-renders with
  // the new holder before the server round-trip completes.  Convex automatically
  // rolls back the optimistic patch if the mutation throws.
  const updateCaseHolder = useMutation(api.cases.updateCaseHolder)
    .withOptimisticUpdate((localStore, args) => {
      const caseDoc = localStore.getQuery(api.cases.getCaseById, {
        caseId: args.caseId as Id<"cases">,
      });
      if (caseDoc != null) {
        const trimmed = args.newHolderName.trim();
        localStore.setQuery(
          api.cases.getCaseById,
          { caseId: args.caseId as Id<"cases"> },
          {
            ...caseDoc,
            assigneeName: trimmed.length > 0 ? trimmed : undefined,
            updatedAt: Date.now(),
          }
        );
      }
    });

  // ── Sync input value when external value changes ───────────────────────────
  //
  // If Convex pushes an update while the editor is in idle mode (e.g., a SCAN
  // app mutation changed the assignee), reset the input to the new value.
  // When editing, preserve the in-progress input to avoid disrupting the user.
  useEffect(() => {
    if (editState === "idle") {
      setInputValue(normalisedHolder ?? "");
    }
  }, [normalisedHolder, editState]);

  // ── Auto-focus input when entering edit mode ───────────────────────────────
  useEffect(() => {
    if (editState === "editing") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editState]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleEditClick = useCallback(() => {
    setInputValue(normalisedHolder ?? "");
    setErrorMessage(null);
    setEditState("editing");
  }, [normalisedHolder]);

  const handleCancel = useCallback(() => {
    setInputValue(normalisedHolder ?? "");
    setErrorMessage(null);
    setEditState("idle");
  }, [normalisedHolder]);

  const handleSave = useCallback(async () => {
    const trimmed = inputValue.trim();
    const resolvedNewHolder = trimmed.length > 0 ? trimmed : null;

    // No-op if the holder hasn't changed.
    if (resolvedNewHolder === normalisedHolder) {
      setEditState("idle");
      return;
    }

    setEditState("saving");
    try {
      await updateCaseHolder({
        caseId:        caseId as Id<"cases">,
        newHolderName: trimmed,
        userId,
        userName,
      });
      setEditState("idle");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message.replace(/^\[.*?\]\s*/, "") // strip [AUTH_REQUIRED] prefix
          : "Failed to update holder. Please try again.";
      setErrorMessage(msg);
      setEditState("error");
    }
  }, [inputValue, normalisedHolder, caseId, userId, userName, updateCaseHolder]);

  const handleRetry = useCallback(() => {
    setErrorMessage(null);
    setEditState("editing");
  }, []);

  // Keyboard: Escape cancels; Enter saves (if changed).
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        void handleSave();
      }
    },
    [handleCancel, handleSave]
  );

  // ── Render: error state ────────────────────────────────────────────────────

  if (editState === "error") {
    return (
      <div
        className={[styles.errorRow, className].filter(Boolean).join(" ")}
        role="alert"
        data-testid="inline-holder-error"
      >
        <span className={styles.holderName}>
          {normalisedHolder ?? (
            <span className={styles.holderNameEmpty}>Unassigned</span>
          )}
        </span>
        <span className={styles.errorText} title={errorMessage ?? undefined}>
          {errorMessage ?? "Error saving holder"}
        </span>
        <button
          className={styles.retryButton}
          onClick={handleRetry}
          type="button"
          aria-label="Retry holder update"
        >
          Retry
        </button>
        <button
          className={[styles.cancelButtonSmall, styles.actionButton]
            .filter(Boolean)
            .join(" ")}
          onClick={handleCancel}
          type="button"
          aria-label="Cancel holder edit"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ── Render: saving state ───────────────────────────────────────────────────
  //
  // Optimistic update is already in effect — the parent sees the new name.
  // Show the (optimistically updated) name + spinner.

  if (editState === "saving") {
    return (
      <div
        className={[styles.idleRow, className].filter(Boolean).join(" ")}
        data-testid="inline-holder-saving"
        aria-busy="true"
        aria-label="Saving holder…"
      >
        {normalisedHolder ? (
          <span className={styles.holderName}>{normalisedHolder}</span>
        ) : (
          <span className={styles.holderNameEmpty}>Unassigned</span>
        )}
        <span className={styles.savingSpinner} aria-label="Saving…" />
      </div>
    );
  }

  // ── Render: idle state ─────────────────────────────────────────────────────

  if (editState === "idle") {
    return (
      <div
        className={[styles.idleRow, className].filter(Boolean).join(" ")}
        data-testid="inline-holder-idle"
      >
        {normalisedHolder ? (
          <span className={styles.holderName}>{normalisedHolder}</span>
        ) : (
          <span className={styles.holderNameEmpty}>Unassigned</span>
        )}
        <button
          className={styles.editButton}
          onClick={handleEditClick}
          type="button"
          aria-label="Edit case holder"
          title="Click to edit holder"
          data-testid="inline-holder-edit-btn"
        >
          <PencilIcon />
        </button>
      </div>
    );
  }

  // ── Render: editing state ──────────────────────────────────────────────────

  return (
    <div
      className={[styles.editRow, className].filter(Boolean).join(" ")}
      role="group"
      aria-label="Edit case holder"
      onKeyDown={handleKeyDown}
      data-testid="inline-holder-editing"
    >
      <label
        className={styles.inputLabel}
        htmlFor={`case-holder-input-${caseId}`}
      >
        Holder
      </label>

      <input
        id={`case-holder-input-${caseId}`}
        ref={inputRef}
        type="text"
        className={styles.input}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="Enter holder name…"
        aria-label="Holder name"
        data-testid="inline-holder-input"
        autoComplete="off"
        maxLength={120}
      />

      <div className={styles.actionButtons}>
        <button
          className={[styles.saveButton, styles.actionButton]
            .filter(Boolean)
            .join(" ")}
          onClick={() => void handleSave()}
          type="button"
          aria-label="Save holder change"
          disabled={inputValue.trim() === (normalisedHolder ?? "")}
          data-testid="inline-holder-save-btn"
        >
          Save
        </button>
        <button
          className={[styles.cancelButton, styles.actionButton]
            .filter(Boolean)
            .join(" ")}
          onClick={handleCancel}
          type="button"
          aria-label="Cancel holder edit"
          data-testid="inline-holder-cancel-btn"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default InlineHolderEditor;
