/**
 * UserSelector — searchable user picker for the SCAN app and INVENTORY dashboard.
 *
 * A combobox-style control that queries the full user list from Convex
 * (`api.users.listUsers`) and filters in-browser as the user types, rendering
 * a dropdown of matching results.  Selecting a result calls `onChange` with
 * both the `userId` (Kinde ID) and `userName` (display name).
 *
 * Design
 * ──────
 * Pattern: ARIA Combobox 1.2 (combobox + listbox roles)
 *   • input with role="combobox", aria-expanded, aria-controls, aria-activedescendant
 *   • listbox with role="listbox"
 *   • each option with role="option" and aria-selected
 *
 * Keyboard navigation:
 *   ArrowDown  — advance highlighted option (opens list if closed)
 *   ArrowUp    — retreat highlighted option
 *   Enter      — confirm highlighted option (or first result if none highlighted)
 *   Escape     — close dropdown without selection
 *   Tab        — close dropdown, move focus away
 *
 * Filtering:
 *   Case-insensitive substring match on `name` and `email`.
 *   Results capped at MAX_RESULTS (10) to keep the list manageable on mobile.
 *   Empty query → list closed (no noise when the field is first focused).
 *   Query with no matches → "No users match" empty state.
 *
 * Real-time data:
 *   The Convex `listUsers` subscription pushes updates within ~100–300 ms
 *   of any upsertUser mutation, so newly registered users appear without
 *   a page reload.
 *
 * Design system compliance:
 *   • No hex literals — CSS custom properties only.
 *   • Inter Tight for all text.
 *   • IBM Plex Mono for the email secondary line.
 *   • Touch targets ≥ 44 × 44 px (WCAG 2.5.5) for each option row.
 *   • WCAG AA contrast in both light and dark themes.
 *   • prefers-reduced-motion guards on transitions.
 */

"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useId,
} from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import styles from "./UserSelector.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RESULTS = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserSelectorValue {
  /** Kinde user ID (the `kindeId` field from the users table). */
  userId: string;
  /** Display name resolved from the users table. */
  userName: string;
}

export interface UserSelectorProps {
  /**
   * Currently selected user (controlled).
   * `null` means no user is selected.
   */
  value: UserSelectorValue | null;

  /**
   * Fired when the selection changes.
   * `null` means the selection was cleared (user typed after selecting).
   */
  onChange: (user: UserSelectorValue | null) => void;

  /** Disables the input and dropdown when true. */
  disabled?: boolean;

  /**
   * Placeholder for the text input.
   * @default "Search by name or email…"
   */
  placeholder?: string;

  /**
   * `id` for the underlying `<input>` element.
   * Required when an external `<label>` uses `htmlFor`.
   */
  id?: string;

  /**
   * `aria-describedby` forwarded to the `<input>` element.
   * Use to associate hint / error text with the combobox for screen readers.
   */
  "aria-describedby"?: string;

  /**
   * Optional accessible label for the combobox when there is no
   * visible `<label>` element associated via `id` / `htmlFor`.
   */
  "aria-label"?: string;

  /** Additional CSS class applied to the container `<div>`. */
  className?: string;
}

// ─── Internal: user row type (from Convex query) ──────────────────────────────

interface ConvexUser {
  _id: string;
  kindeId: string;
  name: string;
  email: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
}

// ─── Filter helper ────────────────────────────────────────────────────────────

/**
 * Filter `users` by `query` (case-insensitive substring on name + email).
 * Returns at most MAX_RESULTS entries.
 */
function filterUsers(users: ConvexUser[], query: string): ConvexUser[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  return users
    .filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    )
    .slice(0, MAX_RESULTS);
}

// ─── Search icon ──────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg
      className={styles.searchIcon}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="9" cy="9" r="5.5" />
      <line x1="13.5" y1="13.5" x2="17" y2="17" />
    </svg>
  );
}

// ─── Clear icon ───────────────────────────────────────────────────────────────

function ClearIcon() {
  return (
    <svg
      className={styles.clearIconSvg}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  );
}

// ─── Person icon (option avatar) ──────────────────────────────────────────────

function PersonIcon() {
  return (
    <svg
      className={styles.personIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

// ─── Option row ───────────────────────────────────────────────────────────────

interface OptionRowProps {
  user: ConvexUser;
  optionId: string;
  isHighlighted: boolean;
  onSelect: (user: ConvexUser) => void;
  onMouseEnter: () => void;
}

function OptionRow({
  user,
  optionId,
  isHighlighted,
  onSelect,
  onMouseEnter,
}: OptionRowProps) {
  return (
    <li
      id={optionId}
      role="option"
      aria-selected={isHighlighted}
      className={[
        styles.option,
        isHighlighted ? styles.optionHighlighted : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseDown={(e) => {
        // Use mousedown (not click) so we can call onSelect before the input
        // loses focus and triggers the blur-close logic.
        e.preventDefault();
        onSelect(user);
      }}
      onMouseEnter={onMouseEnter}
      data-testid={`user-option-${user.kindeId}`}
    >
      <PersonIcon />
      <div className={styles.optionBody}>
        <span className={styles.optionName}>{user.name}</span>
        <span className={styles.optionEmail}>{user.email}</span>
      </div>
    </li>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * UserSelector — searchable user combobox.
 *
 * Queries `api.users.listUsers`, filters in-browser, renders a dropdown.
 * Calls `onChange({ userId, userName })` on selection; `onChange(null)` on clear.
 */
export function UserSelector({
  value,
  onChange,
  disabled = false,
  placeholder = "Search by name or email…",
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
  className,
}: UserSelectorProps) {
  // ── Unique IDs for ARIA wiring ────────────────────────────────────────────
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const inputId = id ?? `${uid}-input`;

  // ── Convex data ───────────────────────────────────────────────────────────
  // listUsers is a real-time subscription — newly registered users appear
  // automatically within ~100–300 ms of the upsertUser mutation.
  const users = useQuery(api.users.listUsers) as ConvexUser[] | undefined;

  // ── Component state ───────────────────────────────────────────────────────

  /**
   * Text currently shown in the input.
   * - Before selection: the search query
   * - After selection: the selected user's display name
   */
  const [inputText, setInputText] = useState<string>(value?.userName ?? "");

  /**
   * Whether the dropdown listbox is visible.
   */
  const [isOpen, setIsOpen] = useState(false);

  /**
   * 0-based index of the currently highlighted option.
   * -1 means no option is highlighted (keyboard hasn't navigated yet).
   */
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  /**
   * `justSelectedRef` — synchronously set to `true` in `handleSelect` and
   * `handleClear` immediately before calling `inputRef.current?.focus()`.
   *
   * This guards `handleFocus` against a batching race:
   * When `focus()` is called inside an event handler, React hasn't yet flushed
   * the queued state updates (`setIsOpen(false)`, etc.).  `handleFocus` would
   * see the old (stale) `isSelectionActive=false` and `inputText` values,
   * causing it to call `setIsOpen(true)` and win over the `setIsOpen(false)` in
   * the same batch — keeping the dropdown open after selection.
   *
   * Using a ref (synchronously readable, not subject to batching) lets
   * `handleFocus` detect the "just selected" condition immediately.
   */
  const justSelectedRef = useRef(false);

  /**
   * Whether the current `inputText` matches the selected value's userName.
   * Used to detect when the user has started typing after a selection (which
   * should clear the selection).
   */
  const isSelectionActive = value !== null && inputText === value.userName;

  // ── Derived: filtered results ─────────────────────────────────────────────
  const results: ConvexUser[] = users
    ? filterUsers(users, inputText)
    : [];

  // ── Sync inputText when value changes externally ──────────────────────────
  //
  // If the parent clears `value` (e.g., a form reset), reset our input too.
  // Guard: only sync when the dropdown is not open (avoid disrupting the user
  // mid-search).
  useEffect(() => {
    if (!isOpen) {
      setInputText(value?.userName ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // ── Scroll highlighted option into view ───────────────────────────────────
  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) return;
    const list = listboxRef.current;
    if (!list) return;
    const item = list.children[highlightedIndex] as HTMLElement | undefined;
    // Guard: scrollIntoView may not exist in SSR or test environments.
    if (item && typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex, isOpen]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Handle text input changes.
   * - Clears the selection if the user types after selecting a user.
   * - Opens the dropdown.
   * - Resets highlighted index.
   */
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newText = e.target.value;
      setInputText(newText);
      setHighlightedIndex(-1);
      setIsOpen(true);

      // If a user was selected and the text no longer matches, clear selection.
      if (value !== null) {
        onChange(null);
      }
    },
    [value, onChange]
  );

  /**
   * Select a user from the dropdown.
   * Sets the input to the user's name, closes the dropdown, and fires onChange.
   *
   * `justSelectedRef` is set synchronously before calling `focus()` so that
   * `handleFocus` (which fires during `focus()`) can skip the re-open logic.
   * See the comment on `justSelectedRef` for the batching race explanation.
   */
  const handleSelect = useCallback(
    (user: ConvexUser) => {
      setInputText(user.name);
      setIsOpen(false);
      setHighlightedIndex(-1);
      onChange({ userId: user.kindeId, userName: user.name });
      // Return focus to the input so the user can Tab to the next field.
      // Guard the re-open race by setting justSelectedRef first.
      justSelectedRef.current = true;
      inputRef.current?.focus();
      // Clear the guard after the focus event has been processed.
      justSelectedRef.current = false;
    },
    [onChange]
  );

  /**
   * Clear the current value and reset the input.
   */
  const handleClear = useCallback(() => {
    setInputText("");
    setIsOpen(false);
    setHighlightedIndex(-1);
    onChange(null);
    // Focus the input so the user can immediately type a new search.
    // Guard: justSelectedRef prevents handleFocus from re-opening the listbox
    // when the stale inputText is still non-empty at the time focus fires.
    justSelectedRef.current = true;
    inputRef.current?.focus();
    justSelectedRef.current = false;
  }, [onChange]);

  /**
   * Keyboard handler on the input.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          if (!isOpen && results.length > 0) {
            setIsOpen(true);
            setHighlightedIndex(0);
          } else if (results.length > 0) {
            setHighlightedIndex((prev) =>
              prev < results.length - 1 ? prev + 1 : prev
            );
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (!isOpen) break;
          const candidate =
            highlightedIndex >= 0
              ? results[highlightedIndex]
              : results[0] ?? null;
          if (candidate) {
            handleSelect(candidate);
          }
          break;
        }
        case "Escape": {
          e.preventDefault();
          setIsOpen(false);
          setHighlightedIndex(-1);
          break;
        }
        case "Tab": {
          // Close the dropdown on Tab without preventing focus movement.
          setIsOpen(false);
          setHighlightedIndex(-1);
          break;
        }
      }
    },
    [isOpen, results, highlightedIndex, handleSelect]
  );

  /**
   * Focus handler: open the dropdown when the user focuses the input
   * and there is already text (re-focus after blur).
   *
   * Skips re-opening if `justSelectedRef.current` is true — this happens
   * when `handleSelect` or `handleClear` programmatically calls `focus()`.
   * Without the guard, `handleFocus` would see stale (pre-batch-flush) state
   * and incorrectly call `setIsOpen(true)`, undoing the `setIsOpen(false)`.
   */
  const handleFocus = useCallback(() => {
    if (justSelectedRef.current) return;
    if (inputText.trim().length > 0 && !isSelectionActive) {
      setIsOpen(true);
    }
  }, [inputText, isSelectionActive]);

  /**
   * Blur handler: close the dropdown when focus leaves the component.
   * We use a setTimeout(0) to allow the mousedown on an option to fire
   * first (option mousedown prevents the blur from firing immediately via
   * e.preventDefault(), but blur still fires after).
   */
  const handleBlur = useCallback(() => {
    // Delay close to allow option mousedown to call handleSelect first.
    setTimeout(() => {
      // Check if focus is still inside the container.
      if (
        containerRef.current &&
        containerRef.current.contains(document.activeElement)
      ) {
        return; // Focus is still inside; do not close.
      }
      setIsOpen(false);
      setHighlightedIndex(-1);
    }, 150);
  }, []);

  // ── Derived ARIA active-descendant ────────────────────────────────────────
  const activeDescendant =
    isOpen && highlightedIndex >= 0 && results[highlightedIndex]
      ? `${uid}-option-${results[highlightedIndex].kindeId}`
      : undefined;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className={[styles.container, className].filter(Boolean).join(" ")}
      data-testid="user-selector"
    >
      {/* ── Input row ──────────────────────────────────────────────────── */}
      <div className={styles.inputWrap}>
        {/* Search icon (decorative) */}
        <SearchIcon />

        {/* Combobox input */}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={isOpen && results.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          className={[
            styles.input,
            isSelectionActive ? styles.inputSelected : "",
          ]
            .filter(Boolean)
            .join(" ")}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-testid="user-selector-input"
        />

        {/* Loading indicator while Convex is loading users */}
        {users === undefined && (
          <span
            className={styles.loadingSpinner}
            aria-label="Loading users…"
            data-testid="user-selector-loading"
          />
        )}

        {/* Clear button — visible only when there is text */}
        {inputText.length > 0 && !disabled && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={handleClear}
            aria-label="Clear selected user"
            tabIndex={-1}
            data-testid="user-selector-clear"
          >
            <ClearIcon />
          </button>
        )}
      </div>

      {/* ── Dropdown listbox ───────────────────────────────────────────── */}
      {isOpen && (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label="Matching users"
          className={styles.listbox}
          data-testid="user-selector-listbox"
        >
          {results.length === 0 ? (
            /* No-match state */
            <li
              className={styles.noResults}
              role="option"
              aria-selected={false}
              aria-disabled="true"
              data-testid="user-selector-no-results"
            >
              <span className={styles.noResultsText}>
                No users match &ldquo;{inputText}&rdquo;
              </span>
            </li>
          ) : (
            results.map((user, index) => (
              <OptionRow
                key={user.kindeId}
                user={user}
                optionId={`${uid}-option-${user.kindeId}`}
                isHighlighted={index === highlightedIndex}
                onSelect={handleSelect}
                onMouseEnter={() => setHighlightedIndex(index)}
              />
            ))
          )}
        </ul>
      )}

      {/* ── Selected user confirmation chip ────────────────────────────── */}
      {isSelectionActive && value && (
        <div
          className={styles.selectionChip}
          aria-live="polite"
          data-testid="user-selector-chip"
        >
          <PersonIcon />
          <span className={styles.chipName}>{value.userName}</span>
          <span className={styles.chipId}>{value.userId}</span>
        </div>
      )}
    </div>
  );
}

export default UserSelector;
