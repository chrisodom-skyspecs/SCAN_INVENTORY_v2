/**
 * FieldError — inline form field error message component
 *
 * Renders a validation error message directly below a form field.
 * Only renders when `error` is a non-empty string; nothing is rendered when
 * `error` is null/undefined/empty so callers can unconditionally include it.
 *
 * Accessibility
 * ─────────────
 * • `role="alert"` + `aria-live="polite"` — screen readers announce the error
 *   when it appears without requiring keyboard focus to move to the element.
 * • The parent `<input>` must link to this element via `aria-describedby`:
 *     <input aria-describedby={error ? `${id}-error` : undefined} />
 *     <FieldError id={`${id}-error`} error={error} />
 *
 * Design system
 * ─────────────
 * • All colors via CSS custom properties — no hex literals.
 * • Uses `--ink-critical` for error text (maps to `--_r-600` in light theme,
 *   `--_r-300` in dark theme via the `.theme-dark` override in base.css).
 * • Icon uses `currentColor` so it adapts automatically.
 * • Inter Tight font family, 0.75rem, consistent with `fieldHint` style.
 *
 * Usage
 * ─────
 * ```tsx
 * const errorId = `${fieldId}-error`;
 *
 * <input
 *   id={fieldId}
 *   aria-invalid={!!error || undefined}
 *   aria-describedby={error ? errorId : undefined}
 * />
 * <FieldError id={errorId} error={error} />
 * ```
 */

import styles from "./FieldError.module.css";

interface FieldErrorProps {
  /** Unique DOM id so the input can reference it via aria-describedby. */
  id: string;
  /** The error message to display, or null/undefined/empty to render nothing. */
  error?: string | null;
  /** Additional CSS class names for the error container. */
  className?: string;
}

export function FieldError({ id, error, className }: FieldErrorProps) {
  if (!error) return null;

  return (
    <span
      id={id}
      role="alert"
      aria-live="polite"
      className={[styles.fieldError, className].filter(Boolean).join(" ")}
      data-testid="field-error"
    >
      {/* Warning icon — aria-hidden so screen reader reads only the text */}
      <svg
        className={styles.icon}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="7" />
        <line x1="8" y1="5" x2="8" y2="8.5" />
        <line x1="8" y1="10.5" x2="8.01" y2="10.5" />
      </svg>
      {error}
    </span>
  );
}
