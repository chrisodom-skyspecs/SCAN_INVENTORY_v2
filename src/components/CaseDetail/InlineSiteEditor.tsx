/**
 * InlineSiteEditor — click-to-edit case site (locationName) field.
 *
 * Provides a click-to-edit inline field for a case's deployment site name in
 * the INVENTORY dashboard (T1 Summary, Dossier Overview Panel).
 *
 * States:
 *   idle     — Shows the current site name (or "No site" placeholder)
 *              plus a pencil icon button (visible on hover or keyboard focus)
 *              that activates edit mode.
 *   editing  — Shows a text input with the current site name, plus Save and
 *              Cancel action buttons.  Escape cancels; Enter saves if changed.
 *   saving   — Optimistic update applied immediately; spinner shown while the
 *              Convex mutation round-trip completes.
 *   error    — Server rejected the mutation; shows an error message with Retry
 *              and Cancel options.
 *
 * Optimistic update:
 *   Uses `useMutation(api.cases.updateCaseSite).withOptimisticUpdate()` to
 *   patch the local `getCaseById` query result immediately on Save, so the
 *   displayed name reflects the new value before the server confirms.  Convex
 *   automatically rolls back if the mutation fails.
 *
 * Design system compliance:
 *   - No hex literals — CSS custom properties via InlineSiteEditor.module.css
 *   - Inter Tight for all UI labels and buttons
 *   - WCAG AA: proper aria-labels, keyboard navigation, focus management
 */

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useKindeUser } from "../../hooks/use-kinde-user";
import styles from "./InlineSiteEditor.module.css";

// ─── Edit state machine ────────────────────────────────────────────────────────

type EditState = "idle" | "editing" | "saving" | "error";

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface InlineSiteEditorProps {
  /** Convex document ID of the case whose site is being edited. */
  caseId: string;
  /** Currently persisted site name (locationName on the case document). */
  currentSite: string | null | undefined;
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
 * InlineSiteEditor — click-to-edit site (location) field for the INVENTORY
 * dashboard.
 *
 * Renders as the site name + edit icon in idle mode.  Clicking the pencil
 * icon (or pressing Enter/Space while focused) opens a text input + Save/Cancel
 * pair.  The Convex mutation applies an optimistic update immediately so the
 * displayed name reflects the change without waiting for the server round-trip.
 */
export function InlineSiteEditor({
  caseId,
  currentSite,
  className,
}: InlineSiteEditorProps) {
  // Normalise undefined → null so the rest of the component works with a stable type
  const normalisedSite = currentSite ?? null;

  const [editState, setEditState] = useState<EditState>("idle");
  const [inputValue, setInputValue] = useState<string>(normalisedSite ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ref for the text input — focused automatically when edit mode opens.
  const inputRef = useRef<HTMLInputElement>(null);

  // Current Kinde user identity for mutation attribution.
  const { id: userId, name: userName } = useKindeUser({ fallbackName: "Operator" });

  // ── Convex mutation with optimistic update ─────────────────────────────────
  //
  // withOptimisticUpdate patches the local getCaseById result immediately,
  // so the parent panel (which subscribes to getCaseById) re-renders with
  // the new site name before the server round-trip completes.  Convex
  // automatically rolls back the optimistic patch if the mutation throws.
  const updateCaseSite = useMutation(api.cases.updateCaseSite)
    .withOptimisticUpdate((localStore, args) => {
      const caseDoc = localStore.getQuery(api.cases.getCaseById, {
        caseId: args.caseId as Id<"cases">,
      });
      if (caseDoc != null) {
        const trimmed = args.newSiteName.trim();
        localStore.setQuery(
          api.cases.getCaseById,
          { caseId: args.caseId as Id<"cases"> },
          {
            ...caseDoc,
            locationName: trimmed.length > 0 ? trimmed : undefined,
            updatedAt: Date.now(),
          }
        );
      }
    });

  // ── Sync input value when external value changes ───────────────────────────
  //
  // If Convex pushes an update while the editor is in idle mode (e.g., a SCAN
  // app mutation changed the location), reset the input to the new value.
  // When editing, preserve the in-progress input to avoid disrupting the user.
  useEffect(() => {
    if (editState === "idle") {
      setInputValue(normalisedSite ?? "");
    }
  }, [normalisedSite, editState]);

  // ── Auto-focus input when entering edit mode ───────────────────────────────
  useEffect(() => {
    if (editState === "editing") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editState]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleEditClick = useCallback(() => {
    setInputValue(normalisedSite ?? "");
    setErrorMessage(null);
    setEditState("editing");
  }, [normalisedSite]);

  const handleCancel = useCallback(() => {
    setInputValue(normalisedSite ?? "");
    setErrorMessage(null);
    setEditState("idle");
  }, [normalisedSite]);

  const handleSave = useCallback(async () => {
    const trimmed = inputValue.trim();
    const resolvedNewSite = trimmed.length > 0 ? trimmed : null;

    // No-op if the site name hasn't changed.
    if (resolvedNewSite === normalisedSite) {
      setEditState("idle");
      return;
    }

    setEditState("saving");
    try {
      await updateCaseSite({
        caseId:      caseId as Id<"cases">,
        newSiteName: trimmed,
        userId,
        userName,
      });
      setEditState("idle");
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message.replace(/^\[.*?\]\s*/, "") // strip [AUTH_REQUIRED] prefix
          : "Failed to update site. Please try again.";
      setErrorMessage(msg);
      setEditState("error");
    }
  }, [inputValue, normalisedSite, caseId, userId, userName, updateCaseSite]);

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
        data-testid="inline-site-error"
      >
        <span className={styles.siteName}>
          {normalisedSite ?? (
            <span className={styles.siteNameEmpty}>No site</span>
          )}
        </span>
        <span className={styles.errorText} title={errorMessage ?? undefined}>
          {errorMessage ?? "Error saving site"}
        </span>
        <button
          className={styles.retryButton}
          onClick={handleRetry}
          type="button"
          aria-label="Retry site update"
        >
          Retry
        </button>
        <button
          className={[styles.cancelButtonSmall, styles.actionButton]
            .filter(Boolean)
            .join(" ")}
          onClick={handleCancel}
          type="button"
          aria-label="Cancel site edit"
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
        data-testid="inline-site-saving"
        aria-busy="true"
        aria-label="Saving site…"
      >
        {normalisedSite ? (
          <span className={styles.siteName}>{normalisedSite}</span>
        ) : (
          <span className={styles.siteNameEmpty}>No site</span>
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
        data-testid="inline-site-idle"
      >
        {normalisedSite ? (
          <span className={styles.siteName}>{normalisedSite}</span>
        ) : (
          <span className={styles.siteNameEmpty}>No site</span>
        )}
        <button
          className={styles.editButton}
          onClick={handleEditClick}
          type="button"
          aria-label="Edit case site"
          title="Click to edit site"
          data-testid="inline-site-edit-btn"
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
      aria-label="Edit case site"
      onKeyDown={handleKeyDown}
      data-testid="inline-site-editing"
    >
      <label
        className={styles.inputLabel}
        htmlFor={`case-site-input-${caseId}`}
      >
        Site
      </label>

      <input
        id={`case-site-input-${caseId}`}
        ref={inputRef}
        type="text"
        className={styles.input}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="Enter site name…"
        aria-label="Site name"
        data-testid="inline-site-input"
        autoComplete="off"
        maxLength={200}
      />

      <div className={styles.actionButtons}>
        <button
          className={[styles.saveButton, styles.actionButton]
            .filter(Boolean)
            .join(" ")}
          onClick={() => void handleSave()}
          type="button"
          aria-label="Save site change"
          disabled={inputValue.trim() === (normalisedSite ?? "")}
          data-testid="inline-site-save-btn"
        >
          Save
        </button>
        <button
          className={[styles.cancelButton, styles.actionButton]
            .filter(Boolean)
            .join(" ")}
          onClick={handleCancel}
          type="button"
          aria-label="Cancel site edit"
          data-testid="inline-site-cancel-btn"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default InlineSiteEditor;
