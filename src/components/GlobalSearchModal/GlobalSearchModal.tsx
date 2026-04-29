/**
 * GlobalSearchModal — INVENTORY dashboard global search overlay
 *
 * A full-screen overlay modal that provides the global case search experience.
 * Triggered by the cmd-K / Ctrl+K keyboard shortcut or by clicking the search
 * affordance in the InventoryNavbar.
 *
 * Features:
 *   - CSS-driven open/close animation: backdrop fade-in + dialog scale-up entry,
 *     scale-down + fade-out exit (using data-state attribute + animation keyframes)
 *   - Backdrop dismiss: click outside the dialog panel to close
 *   - Escape key handler: closes the modal and returns focus to the trigger
 *   - Auto-focus: search input receives focus immediately on open
 *   - ARIA: role="dialog", aria-modal, aria-labelledby, focus trap light variant
 *   - Portal: rendered via ReactDOM.createPortal into document.body to escape
 *     any ancestor overflow/z-index stacking contexts
 *   - Design tokens only — no hex literals
 *   - Inter Tight for UI text, IBM Plex Mono for data/meta content
 *   - WCAG AA contrast in both light and dark themes
 *   - Reduced motion: animations suppressed via @media (prefers-reduced-motion)
 *
 * Usage:
 * ```tsx
 *   const [open, setOpen] = React.useState(false);
 *
 *   <GlobalSearchModal isOpen={open} onClose={() => setOpen(false)} />
 * ```
 *
 * The modal starts with placeholder UI (search input + empty state).
 * Search result wiring and case navigation are handled in subsequent ACs.
 */

"use client";

import * as React from "react";
import * as ReactDOM from "react-dom";
import styles from "./GlobalSearchModal.module.css";

// ─── Icons ────────────────────────────────────────────────────────────────────

/**
 * MagnifyingGlassIcon — search icon rendered inside the modal input.
 * Purely decorative; aria-hidden.
 */
function MagnifyingGlassIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * XMarkIcon — close button icon.
 * Purely decorative; aria-hidden.
 */
function XMarkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GlobalSearchModalProps {
  /**
   * Whether the search modal is visible.
   * When changed from false → true, the modal enters with animation and focuses
   * the search input.  When changed from true → false, the exit animation plays.
   */
  isOpen: boolean;

  /**
   * Called when the user requests to close the modal.
   * Triggers: Escape key, backdrop click, close button click.
   * The parent is responsible for setting isOpen to false.
   */
  onClose: () => void;

  /**
   * Initial query value — pre-fills the search input when the modal opens.
   * Useful when reopening after a previous search.
   * @default ""
   */
  initialQuery?: string;

  /**
   * Callback fired whenever the query value changes (on each keystroke).
   * Provides the current raw query string for real-time result fetching.
   */
  onQueryChange?: (query: string) => void;

  /**
   * Callback fired when the user submits the search (Enter key or button).
   * Provides the final trimmed query string.
   */
  onSubmit?: (query: string) => void;

  /**
   * Additional CSS class names applied to the modal backdrop wrapper.
   */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * GlobalSearchModal — overlay search dialog with animated open/close.
 *
 * Rendered as a portal into document.body.  Uses CSS animations driven by a
 * `data-state` attribute on the wrapper ("open" | "closed") to play enter/exit
 * keyframe sequences without requiring React state transitions or external
 * animation libraries.
 *
 * Backdrop behaviour:
 *   - A full-viewport clickable backdrop sits behind the dialog panel.
 *   - Clicking the backdrop calls onClose().
 *   - The dialog panel itself stops click propagation via stopPropagation().
 *
 * Escape key behaviour:
 *   - A document-level keydown listener on Escape calls onClose() when
 *     the modal is open.  The listener is attached/detached based on isOpen.
 *
 * Focus management:
 *   - On open: the search input is auto-focused via requestAnimationFrame
 *     (after the enter animation frame).
 *   - On close: focus returns to the element that was focused before the modal
 *     opened (stored in a ref on open).
 */
export function GlobalSearchModal({
  isOpen,
  onClose,
  initialQuery = "",
  onQueryChange,
  onSubmit,
  className,
}: GlobalSearchModalProps) {
  // ── SSR guard ─────────────────────────────────────────────────────────────
  const [isMounted, setIsMounted] = React.useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  /**
   * Store the element that had focus before the modal opened so we can
   * restore focus on close for keyboard / screen reader continuity.
   */
  const previousFocusRef = React.useRef<HTMLElement | null>(null);

  // ── Query state ────────────────────────────────────────────────────────────
  const [query, setQuery] = React.useState(initialQuery);

  // ── Animation state ────────────────────────────────────────────────────────
  /**
   * isVisible controls whether the portal DOM tree is present at all.
   * We keep it true briefly after isOpen becomes false so the exit animation
   * can play before the node is removed from the DOM.
   *
   * Lifecycle:
   *   open:  isOpen=true  → set isVisible=true immediately
   *   close: isOpen=false → play exit animation → after 200ms set isVisible=false
   */
  const [isVisible, setIsVisible] = React.useState(false);
  const exitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Mount effect ───────────────────────────────────────────────────────────
  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  // ── Open / close lifecycle ─────────────────────────────────────────────────
  React.useEffect(() => {
    if (isOpen) {
      // Cancel any pending exit timer from a rapid close→open cycle.
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }

      // Record the previously-focused element so we can restore it on close.
      previousFocusRef.current = document.activeElement as HTMLElement | null;

      // Reset query to initialQuery whenever the modal opens.
      setQuery(initialQuery);

      // Make the portal DOM visible so the enter animation can play.
      setIsVisible(true);

      // Auto-focus the search input after the browser has rendered the modal.
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    } else {
      // Start the exit animation (CSS) then remove from DOM after it completes.
      // The exit animation duration is 180ms (matches --gsm-exit-duration in CSS).
      exitTimerRef.current = setTimeout(() => {
        setIsVisible(false);
        exitTimerRef.current = null;
      }, 200);

      // Restore focus to the previously-focused element.
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }

    // Cleanup: clear exit timer on unmount.
    return () => {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Escape key handler ─────────────────────────────────────────────────────
  /**
   * Close the modal on Escape key.
   * The listener is attached only when the modal is open to avoid interfering
   * with Escape key handling in other parts of the app.
   */
  React.useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [isOpen, onClose]);

  // ── Body scroll lock ───────────────────────────────────────────────────────
  /**
   * Prevent the underlying page from scrolling while the modal is open.
   * Stores and restores the original overflow value.
   */
  React.useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  // ── Input change handler ───────────────────────────────────────────────────
  const handleQueryChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      onQueryChange?.(value);
    },
    [onQueryChange]
  );

  // ── Submit handler ─────────────────────────────────────────────────────────
  const handleSubmit = React.useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = query.trim();
      if (trimmed) {
        onSubmit?.(trimmed);
      }
    },
    [query, onSubmit]
  );

  // ── Clear handler ──────────────────────────────────────────────────────────
  const handleClear = React.useCallback(() => {
    setQuery("");
    onQueryChange?.("");
    searchInputRef.current?.focus();
  }, [onQueryChange]);

  // ── Backdrop click handler ─────────────────────────────────────────────────
  /**
   * Click on the backdrop wrapper (outside the dialog panel) → close.
   * The dialog panel stops propagation so clicks inside don't bubble here.
   */
  const handleBackdropClick = React.useCallback(() => {
    onClose();
  }, [onClose]);

  /**
   * Stop clicks inside the dialog panel from bubbling to the backdrop.
   */
  const handleDialogClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
    },
    []
  );

  // ── Portal gate ────────────────────────────────────────────────────────────
  if (!isMounted || !isVisible) return null;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const modal = (
    <div
      className={[styles.backdrop, className].filter(Boolean).join(" ")}
      data-state={isOpen ? "open" : "closed"}
      onClick={handleBackdropClick}
      aria-hidden="false"
      data-testid="global-search-backdrop"
    >
      {/* ── Dialog panel ── */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-search-modal-label"
        className={styles.dialog}
        onClick={handleDialogClick}
        data-state={isOpen ? "open" : "closed"}
        data-testid="global-search-modal"
      >
        {/* ── Search form header ── */}
        <header className={styles.header}>
          {/* Screen-reader label for the dialog */}
          <span
            id="global-search-modal-label"
            className={styles.srOnly}
          >
            Global case search
          </span>

          <form
            role="search"
            aria-label="Search cases"
            className={styles.searchForm}
            onSubmit={handleSubmit}
          >
            {/* Magnifying glass icon — left of input */}
            <MagnifyingGlassIcon className={styles.searchIcon} />

            {/* Main search input — auto-focused on open */}
            <input
              ref={searchInputRef}
              type="search"
              className={styles.searchInput}
              value={query}
              onChange={handleQueryChange}
              placeholder="Search cases, manifests, locations…"
              aria-label="Search cases"
              autoComplete="off"
              spellCheck={false}
              data-testid="global-search-input"
            />

            {/* Clear button — shown only when there is query text */}
            {query.length > 0 && (
              <button
                type="button"
                className={styles.clearButton}
                onClick={handleClear}
                aria-label="Clear search"
                data-testid="global-search-clear"
              >
                <XMarkIcon className={styles.clearIcon} />
              </button>
            )}
          </form>

          {/* Close button */}
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close search"
            data-testid="global-search-close"
          >
            <span className={styles.closeBadge} aria-hidden="true">
              Esc
            </span>
          </button>
        </header>

        {/* ── Divider ── */}
        <div className={styles.divider} aria-hidden="true" />

        {/* ── Body: empty state / future results area ── */}
        <div
          className={styles.body}
          role="region"
          aria-label="Search results"
          aria-live="polite"
          aria-atomic="false"
          data-testid="global-search-body"
        >
          {query.trim().length === 0 ? (
            /* Empty / idle state */
            <div
              className={styles.emptyState}
              data-testid="global-search-empty"
            >
              <MagnifyingGlassIcon className={styles.emptyIcon} />
              <p className={styles.emptyTitle}>Search cases</p>
              <p className={styles.emptySubtitle}>
                Type a case ID, manifest item, location, or assignee name.
              </p>

              {/* Keyboard shortcut reference */}
              <dl className={styles.shortcutList} aria-label="Keyboard shortcuts">
                <div className={styles.shortcutRow}>
                  <dt className={styles.shortcutKey}>
                    <kbd className={styles.kbd}>↑</kbd>
                    <kbd className={styles.kbd}>↓</kbd>
                  </dt>
                  <dd className={styles.shortcutDesc}>Navigate results</dd>
                </div>
                <div className={styles.shortcutRow}>
                  <dt className={styles.shortcutKey}>
                    <kbd className={styles.kbd}>↵ Enter</kbd>
                  </dt>
                  <dd className={styles.shortcutDesc}>Open case</dd>
                </div>
                <div className={styles.shortcutRow}>
                  <dt className={styles.shortcutKey}>
                    <kbd className={styles.kbd}>Esc</kbd>
                  </dt>
                  <dd className={styles.shortcutDesc}>Close</dd>
                </div>
              </dl>
            </div>
          ) : (
            /* Placeholder results area (wired in subsequent AC) */
            <div
              className={styles.resultsPlaceholder}
              aria-label={`Searching for "${query.trim()}"…`}
              data-testid="global-search-results-placeholder"
            >
              <p className={styles.resultsPlaceholderText}>
                Results for{" "}
                <span className={styles.resultsQuery}>{query.trim()}</span>
              </p>
              <p className={styles.resultsPlaceholderSub}>
                Search results will appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}

export default GlobalSearchModal;
