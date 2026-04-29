/**
 * SiteSelector — searchable site picker for the INVENTORY dashboard and SCAN app.
 *
 * A combobox-style control that subscribes to `api.sites.listSites` from Convex
 * and filters in-browser as the user types, rendering a dropdown of matching
 * deployment sites.  Selecting a site calls `onSelect` with both the `siteId`
 * (Convex mission document ID) and `siteName` (display name).
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
 *   Case-insensitive substring match on `name` and `locationName`.
 *   Results capped at MAX_RESULTS (10) to keep the list manageable on mobile.
 *   Empty query → list closed (no noise when field is first focused).
 *   Query with no matches → "No sites match" empty state.
 *
 * Real-time data:
 *   The Convex `listSites` subscription pushes updates within ~100–300 ms of
 *   any mission mutation, so newly created sites appear without a page reload.
 *
 * Design system compliance:
 *   • No hex literals — CSS custom properties only.
 *   • Inter Tight for all labels and site names.
 *   • IBM Plex Mono for site IDs (tabular data content).
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
import type { SiteSummary, SiteStatus } from "../../../convex/sites";
import styles from "./SiteSelector.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum options shown in the dropdown. */
const MAX_RESULTS = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SiteSelectorValue {
  /** Convex missions document ID (string form) — the `siteId` from SiteSummary. */
  siteId: string;
  /** Display name of the selected site. */
  siteName: string;
}

export interface SiteSelectorProps {
  /**
   * Currently selected site (controlled).
   * `null` means no site is selected.
   */
  value: SiteSelectorValue | null;

  /**
   * Fired when the selection changes.
   * `null` means the selection was cleared.
   */
  onSelect: (site: SiteSelectorValue | null) => void;

  /**
   * Optional status filter applied to the Convex query.
   * Pass `"active"` to show only active deployment sites.
   * Omit to show sites of all statuses.
   */
  statusFilter?: SiteStatus;

  /** Disables the input and dropdown when true. */
  disabled?: boolean;

  /**
   * Placeholder for the text input.
   * @default "Search sites…"
   */
  placeholder?: string;

  /**
   * `id` for the underlying `<input>` element.
   * Required when an external `<label>` uses `htmlFor`.
   */
  id?: string;

  /**
   * `aria-describedby` forwarded to the `<input>` element.
   * Use to associate hint / error text for screen readers.
   */
  "aria-describedby"?: string;

  /**
   * Optional accessible label when there is no visible `<label>` linked via `id`.
   */
  "aria-label"?: string;

  /** Additional CSS class applied to the container `<div>`. */
  className?: string;

  /**
   * Whether to show the selection confirmation chip below the input
   * after a site is selected.
   * @default true
   */
  showChip?: boolean;
}

// ─── Filter helper ────────────────────────────────────────────────────────────

/**
 * Filter `sites` by `query` (case-insensitive substring on name + locationName).
 * Returns at most MAX_RESULTS entries.
 */
function filterSites(sites: SiteSummary[], query: string): SiteSummary[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];
  return sites
    .filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.locationName?.toLowerCase().includes(q) ?? false) ||
        (s.description?.toLowerCase().includes(q) ?? false)
    )
    .slice(0, MAX_RESULTS);
}

// ─── Status badge label map ───────────────────────────────────────────────────

const STATUS_LABELS: Record<SiteStatus, string> = {
  active:    "Active",
  planning:  "Planning",
  completed: "Done",
  cancelled: "Cancelled",
};

const STATUS_BADGE_CLASSES: Record<SiteStatus, string> = {
  active:    styles.badgeActive,
  planning:  styles.badgePlanning,
  completed: styles.badgeCompleted,
  cancelled: styles.badgeCancelled,
};

// ─── Icon components ──────────────────────────────────────────────────────────

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

/** Map marker / location pin icon for site options. */
function SiteIcon() {
  return (
    <svg
      className={styles.siteIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

// ─── Option row ───────────────────────────────────────────────────────────────

interface OptionRowProps {
  site: SiteSummary;
  optionId: string;
  isHighlighted: boolean;
  onSelect: (site: SiteSummary) => void;
  onMouseEnter: () => void;
}

function OptionRow({
  site,
  optionId,
  isHighlighted,
  onSelect,
  onMouseEnter,
}: OptionRowProps) {
  const badgeClass = STATUS_BADGE_CLASSES[site.status] ?? styles.badgePlanning;

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
        // Use mousedown (not click) so we call onSelect before the input
        // loses focus and triggers blur-close logic.
        e.preventDefault();
        onSelect(site);
      }}
      onMouseEnter={onMouseEnter}
      data-testid={`site-option-${site.siteId}`}
    >
      <SiteIcon />
      <div className={styles.optionBody}>
        <span className={styles.optionName}>{site.name}</span>
        {site.locationName && (
          <span className={styles.optionLocation}>{site.locationName}</span>
        )}
      </div>
      <span
        className={[styles.optionBadge, badgeClass].join(" ")}
        aria-label={`Status: ${STATUS_LABELS[site.status]}`}
      >
        {STATUS_LABELS[site.status]}
      </span>
    </li>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * SiteSelector — searchable site combobox.
 *
 * Subscribes to `api.sites.listSites` (Convex real-time query), filters
 * in-browser, renders a keyboard-navigable dropdown.
 *
 * Calls `onSelect({ siteId, siteName })` when a site is chosen.
 * Calls `onSelect(null)` when the selection is cleared.
 */
export function SiteSelector({
  value,
  onSelect,
  statusFilter,
  disabled = false,
  placeholder = "Search sites…",
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
  className,
  showChip = true,
}: SiteSelectorProps) {
  // ── Unique IDs for ARIA wiring ────────────────────────────────────────────
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const inputId = id ?? `${uid}-input`;

  // ── Convex real-time subscription ─────────────────────────────────────────
  //
  // api.sites.listSites is a reactive query backed by the missions table.
  // When any mission row changes, Convex re-evaluates this subscription within
  // ~100–300 ms and pushes the updated list to connected clients.
  //
  // Passing `statusFilter` allows callers to scope the subscription to a
  // specific lifecycle stage (e.g., only "active" sites).
  const sites = useQuery(
    api.sites.listSites,
    statusFilter !== undefined ? { status: statusFilter } : {}
  ) as SiteSummary[] | undefined;

  // ── Component state ───────────────────────────────────────────────────────

  /**
   * Text currently shown in the input.
   * - Before selection: the search query
   * - After selection: the selected site's display name
   */
  const [inputText, setInputText] = useState<string>(value?.siteName ?? "");

  /** Whether the dropdown listbox is visible. */
  const [isOpen, setIsOpen] = useState(false);

  /**
   * 0-based index of the currently highlighted option.
   * -1 means no option is highlighted.
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
   * Guards `handleFocus` against a React batching race where `focus()` is
   * called inside an event handler before state updates have flushed.
   * Without this guard, `handleFocus` would see stale state and incorrectly
   * call `setIsOpen(true)`, undoing the `setIsOpen(false)` from `handleSelect`.
   */
  const justSelectedRef = useRef(false);

  /**
   * Whether the current `inputText` matches the selected value's siteName.
   * Detects when the user has started typing after a selection (clear selection).
   */
  const isSelectionActive = value !== null && inputText === value.siteName;

  // ── Derived: filtered results ─────────────────────────────────────────────
  const results: SiteSummary[] = sites ? filterSites(sites, inputText) : [];

  // ── Sync inputText when value changes externally ──────────────────────────
  //
  // If the parent clears `value` (e.g., a form reset), reset the input too.
  // Guard: only sync when the dropdown is not open.
  useEffect(() => {
    if (!isOpen) {
      setInputText(value?.siteName ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // ── Scroll highlighted option into view ───────────────────────────────────
  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) return;
    const list = listboxRef.current;
    if (!list) return;
    const item = list.children[highlightedIndex] as HTMLElement | undefined;
    if (item && typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex, isOpen]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Handle text input changes.
   * - Opens the dropdown.
   * - Resets highlighted index.
   * - Clears the selection if the user types after selecting a site.
   */
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newText = e.target.value;
      setInputText(newText);
      setHighlightedIndex(-1);
      setIsOpen(true);

      // Clear selection when the text no longer matches.
      if (value !== null) {
        onSelect(null);
      }
    },
    [value, onSelect]
  );

  /**
   * Select a site from the dropdown.
   * Sets the input to the site's name, closes the dropdown, fires onSelect.
   */
  const handleSelect = useCallback(
    (site: SiteSummary) => {
      setInputText(site.name);
      setIsOpen(false);
      setHighlightedIndex(-1);
      onSelect({ siteId: site.siteId, siteName: site.name });
      // Return focus to the input — guard re-open race with justSelectedRef.
      justSelectedRef.current = true;
      inputRef.current?.focus();
      justSelectedRef.current = false;
    },
    [onSelect]
  );

  /**
   * Clear the current selection and reset the input.
   */
  const handleClear = useCallback(() => {
    setInputText("");
    setIsOpen(false);
    setHighlightedIndex(-1);
    onSelect(null);
    // Guard: justSelectedRef prevents handleFocus from re-opening the listbox.
    justSelectedRef.current = true;
    inputRef.current?.focus();
    justSelectedRef.current = false;
  }, [onSelect]);

  /**
   * Keyboard handler on the input.
   *
   * ArrowDown  — advance highlighted option (opens list if closed)
   * ArrowUp    — retreat highlighted option
   * Enter      — confirm highlighted option (or first result if none highlighted)
   * Escape     — close dropdown without selection
   * Tab        — close dropdown, move focus
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
   * Focus handler: reopen the dropdown when the user re-focuses the input
   * and there is already text in it (re-focus after blur).
   *
   * Skips re-opening if `justSelectedRef.current` is true — this prevents
   * the batching race where programmatic `focus()` inside `handleSelect`
   * would cause the dropdown to re-open immediately after closing.
   */
  const handleFocus = useCallback(() => {
    if (justSelectedRef.current) return;
    if (inputText.trim().length > 0 && !isSelectionActive) {
      setIsOpen(true);
    }
  }, [inputText, isSelectionActive]);

  /**
   * Blur handler: close the dropdown when focus leaves the component.
   * Uses setTimeout(0) to allow option mousedown to fire first.
   */
  const handleBlur = useCallback(() => {
    setTimeout(() => {
      if (
        containerRef.current &&
        containerRef.current.contains(document.activeElement)
      ) {
        return; // Focus is still inside the component.
      }
      setIsOpen(false);
      setHighlightedIndex(-1);
    }, 150);
  }, []);

  // ── Derived ARIA active-descendant ────────────────────────────────────────
  const activeDescendant =
    isOpen && highlightedIndex >= 0 && results[highlightedIndex]
      ? `${uid}-option-${results[highlightedIndex].siteId}`
      : undefined;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className={[styles.container, className].filter(Boolean).join(" ")}
      data-testid="site-selector"
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
          data-testid="site-selector-input"
        />

        {/* Loading indicator while Convex is loading sites */}
        {sites === undefined && (
          <span
            className={styles.loadingSpinner}
            aria-label="Loading sites…"
            data-testid="site-selector-loading"
          />
        )}

        {/* Clear button — visible only when there is text */}
        {inputText.length > 0 && !disabled && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={handleClear}
            aria-label="Clear selected site"
            tabIndex={-1}
            data-testid="site-selector-clear"
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
          aria-label="Matching sites"
          className={styles.listbox}
          data-testid="site-selector-listbox"
        >
          {results.length === 0 ? (
            /* No-match state */
            <li
              className={styles.noResults}
              role="option"
              aria-selected={false}
              aria-disabled="true"
              data-testid="site-selector-no-results"
            >
              <span className={styles.noResultsText}>
                No sites match &ldquo;{inputText}&rdquo;
              </span>
            </li>
          ) : (
            results.map((site, index) => (
              <OptionRow
                key={site.siteId}
                site={site}
                optionId={`${uid}-option-${site.siteId}`}
                isHighlighted={index === highlightedIndex}
                onSelect={handleSelect}
                onMouseEnter={() => setHighlightedIndex(index)}
              />
            ))
          )}
        </ul>
      )}

      {/* ── Selected site confirmation chip ────────────────────────────── */}
      {showChip && isSelectionActive && value && (
        <div
          className={styles.selectionChip}
          aria-live="polite"
          data-testid="site-selector-chip"
        >
          <SiteIcon />
          <span className={styles.chipName}>{value.siteName}</span>
          <span className={styles.chipId}>{value.siteId}</span>
        </div>
      )}
    </div>
  );
}

export default SiteSelector;
