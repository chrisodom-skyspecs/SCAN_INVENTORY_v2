/**
 * AuditLedgerFilterPanel — Filter controls for the T5 Audit Ledger
 *
 * Provides a filter bar with four control slots:
 *   1. Date range pickers  — "From" and "To" date inputs (epoch-ms range)
 *   2. Actor dropdown      — filter by the user who performed the action
 *   3. Action dropdown     — filter by event type (Status Changed, Shipped, etc.)
 *   4. Case ID search      — substring search on Convex document IDs
 *
 * Sub-AC 1 introduced the layout shell (design-token CSS, responsive flex wrap).
 *
 * Sub-AC 2 adds local state management for the date range picker and case ID
 * search input controls:
 *   • `dateFrom`, `dateTo`, and `caseIdSearch` are owned by local useState
 *     hooks inside this component — they are NOT lifted to the parent.
 *   • The parent receives filter changes via `onFilterChange` callback.
 *   • Case ID search is debounced (CASE_ID_DEBOUNCE_MS) so the parent is
 *     notified only after the user pauses typing — avoids thrashing Convex
 *     queries on every keystroke.
 *   • Date range inputs fire immediately on change (no debounce needed — the
 *     native date picker only fires on date commit, not on intermediate input).
 *   • The actor and action dropdowns are controlled from the outside via the
 *     `filters.actor` / `filters.action` props so the parent can drive these
 *     from external data (e.g. derived knownActors list).
 *
 * Design system compliance:
 *   - No hex literals — CSS custom properties only.
 *   - Inter Tight for all labels and control text.
 *   - IBM Plex Mono for the Case ID search input (data entry field).
 *   - WCAG AA contrast via design-token cascade.
 *   - Dark-mode overrides via :global(.theme-dark) in the CSS module.
 */

"use client";

import { useState, useCallback, useEffect, useRef, useId } from "react";
import styles from "./AuditLedgerFilterPanel.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Debounce delay (ms) for the Case ID search input. */
export const CASE_ID_DEBOUNCE_MS = 300;

// ─── Filter state types ───────────────────────────────────────────────────────

/**
 * Complete filter state for the T5 Audit Ledger.
 *
 * All fields are optional strings — empty string means "no filter applied".
 * Timestamp filters use ISO date strings (YYYY-MM-DD) so they pair naturally
 * with <input type="date"> elements; the parent converts to epoch ms before
 * passing to Convex queries.
 */
export interface AuditFilterState {
  /** ISO date string (YYYY-MM-DD) for the start of the date range, or "". */
  dateFrom: string;
  /** ISO date string (YYYY-MM-DD) for the end of the date range, or "". */
  dateTo: string;
  /** Actor display-name filter, or "" for all actors. */
  actor: string;
  /** Event type key filter (e.g. "status_change", "shipped"), or "" for all. */
  action: string;
  /** Substring search on Convex case document IDs, or "". */
  caseIdSearch: string;
}

/** Initial / reset state — no filters applied. */
export const EMPTY_AUDIT_FILTER: AuditFilterState = {
  dateFrom: "",
  dateTo: "",
  actor: "",
  action: "",
  caseIdSearch: "",
};

// ─── Event type options for the Action dropdown ───────────────────────────────

/**
 * All known event type keys (matches `EVENT_LABELS` in T5Audit.tsx).
 * These are the values stored in `events.eventType` in the Convex database.
 */
const ACTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "",                      label: "All actions" },
  { value: "status_change",         label: "Status Changed" },
  { value: "inspection_started",    label: "Inspection Started" },
  { value: "inspection_completed",  label: "Inspection Completed" },
  { value: "item_checked",          label: "Item Checked" },
  { value: "damage_reported",       label: "Damage Reported" },
  { value: "shipped",               label: "Shipped" },
  { value: "delivered",             label: "Delivered" },
  { value: "custody_handoff",       label: "Custody Handoff" },
  { value: "note_added",            label: "Note Added" },
  { value: "photo_added",           label: "Photo Added" },
  { value: "mission_assigned",      label: "Mission Assigned" },
  { value: "template_applied",      label: "Template Applied" },
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AuditLedgerFilterPanelProps {
  /**
   * Initial values for the actor and action dropdowns.
   * These two fields are externally driven (actor list comes from loaded data).
   * dateFrom, dateTo, caseIdSearch are managed locally and their initial
   * values are read from this prop only on first mount.
   */
  filters?: Partial<AuditFilterState>;

  /**
   * Called whenever any filter value settles (date change fires immediately;
   * case ID fires after CASE_ID_DEBOUNCE_MS debounce).
   * Receives the full current filter state.
   */
  onFilterChange: (next: AuditFilterState) => void;

  /**
   * Actors known for this case — drives the Actor dropdown options.
   * When undefined (still loading), the Actor dropdown shows a loading state.
   * When an empty array, only the "All actors" option is shown.
   */
  knownActors?: string[];

  /**
   * When true, the panel and all controls are disabled.
   * @default false
   */
  disabled?: boolean;

  /** Additional CSS class for the root element. */
  className?: string;

  /** data-testid passthrough for testing. */
  "data-testid"?: string;
}

// ─── Active filter count ──────────────────────────────────────────────────────

/**
 * Returns the number of filters currently active (non-empty fields).
 * Used to render the active-filter badge on the clear button.
 */
export function countActiveFilters(filters: AuditFilterState): number {
  return [
    filters.dateFrom,
    filters.dateTo,
    filters.actor,
    filters.action,
    filters.caseIdSearch,
  ].filter(Boolean).length;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditLedgerFilterPanel({
  filters,
  onFilterChange,
  knownActors,
  disabled = false,
  className,
  "data-testid": testId = "audit-filter-panel",
}: AuditLedgerFilterPanelProps) {
  // ── Local state for date range and case ID search ─────────────────────────
  //
  // Sub-AC 2: these fields are owned locally in the filter panel, not lifted
  // to the parent. The parent is notified via onFilterChange when they settle.
  //
  // Initialization: read the initial values from the `filters` prop on first
  // mount only (the empty dependency array in the effect below handles resets).
  const [dateFrom, setDateFrom] = useState<string>(
    filters?.dateFrom ?? ""
  );
  const [dateTo, setDateTo] = useState<string>(
    filters?.dateTo ?? ""
  );
  const [caseIdSearch, setCaseIdSearch] = useState<string>(
    filters?.caseIdSearch ?? ""
  );

  // ── Externally-driven actor / action state ────────────────────────────────
  //
  // These fields are controlled by the parent because:
  //   • `actor` options depend on loaded event data (knownActors).
  //   • `action` is static but the parent may need to programmatically reset it.
  //
  // When the parent does not provide `filters`, these default to "".
  const [actor, setActorState] = useState<string>(filters?.actor ?? "");
  const [action, setActionState] = useState<string>(filters?.action ?? "");

  // Sync actor/action from prop if the parent drives a reset (e.g. "Clear all"
  // from an external button). Only run when the incoming prop values change.
  const prevActorRef  = useRef<string>(filters?.actor  ?? "");
  const prevActionRef = useRef<string>(filters?.action ?? "");

  useEffect(() => {
    const newActor  = filters?.actor  ?? "";
    const newAction = filters?.action ?? "";
    if (newActor !== prevActorRef.current) {
      setActorState(newActor);
      prevActorRef.current = newActor;
    }
    if (newAction !== prevActionRef.current) {
      setActionState(newAction);
      prevActionRef.current = newAction;
    }
  }, [filters?.actor, filters?.action]);

  // ── Ref to track if this is the first render (skip initial effect call) ───
  const isMountedRef = useRef(false);

  // ── Debounced case ID search notification ─────────────────────────────────
  //
  // When caseIdSearch changes, we wait CASE_ID_DEBOUNCE_MS before notifying
  // the parent. This prevents unnecessary Convex query re-evaluations on every
  // keystroke. We flush immediately on clear (empty string) for responsiveness.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build the full committed filter state from all current fields.
  const buildFilterState = useCallback(
    (
      overrides: Partial<AuditFilterState> = {}
    ): AuditFilterState => ({
      dateFrom,
      dateTo,
      actor,
      action,
      caseIdSearch,
      ...overrides,
    }),
    [dateFrom, dateTo, actor, action, caseIdSearch]
  );

  // ── Immediate change handlers (date range, actor, action) ─────────────────
  //
  // Date inputs fire after the user selects/clears a date in the picker —
  // no intermediate states, so no debounce is needed.

  const handleDateFromChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setDateFrom(value);
      onFilterChange(buildFilterState({ dateFrom: value }));
    },
    [buildFilterState, onFilterChange]
  );

  const handleDateToChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setDateTo(value);
      onFilterChange(buildFilterState({ dateTo: value }));
    },
    [buildFilterState, onFilterChange]
  );

  const handleActorChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      setActorState(value);
      onFilterChange(buildFilterState({ actor: value }));
    },
    [buildFilterState, onFilterChange]
  );

  const handleActionChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      setActionState(value);
      onFilterChange(buildFilterState({ action: value }));
    },
    [buildFilterState, onFilterChange]
  );

  // ── Debounced case ID change handler ──────────────────────────────────────
  //
  // Updates local state immediately (for controlled input display) but delays
  // the onFilterChange notification.

  const handleCaseIdChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setCaseIdSearch(value);

      // Clear immediately (no debounce) for responsive UX
      if (value === "") {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        onFilterChange(buildFilterState({ caseIdSearch: "" }));
        return;
      }

      // Debounce for non-empty values
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        onFilterChange(buildFilterState({ caseIdSearch: value }));
        debounceTimerRef.current = null;
      }, CASE_ID_DEBOUNCE_MS);
    },
    [buildFilterState, onFilterChange]
  );

  // Flush any pending debounce timer on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // ── Clear all handler ─────────────────────────────────────────────────────

  const handleClearAll = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setDateFrom("");
    setDateTo("");
    setCaseIdSearch("");
    setActorState("");
    setActionState("");
    onFilterChange(EMPTY_AUDIT_FILTER);
  }, [onFilterChange]);

  // ── Inline case ID clear ──────────────────────────────────────────────────

  const handleCaseIdClear = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setCaseIdSearch("");
    onFilterChange(buildFilterState({ caseIdSearch: "" }));
  }, [buildFilterState, onFilterChange]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const currentFilters: AuditFilterState = {
    dateFrom,
    dateTo,
    actor,
    action,
    caseIdSearch,
  };

  const activeCount   = countActiveFilters(currentFilters);
  const hasFilters    = activeCount > 0;
  const actorsLoading = knownActors === undefined;

  // Build actor options: always starts with "All actors", then known actors.
  const actorOptions: Array<{ value: string; label: string }> = [
    { value: "", label: actorsLoading ? "Loading…" : "All actors" },
    ...(knownActors ?? []).map((name) => ({ value: name, label: name })),
  ];

  // ── Generate unique IDs for label–input associations ─────────────────────
  const uid = useId();
  const idDateFrom     = `${uid}-date-from`;
  const idDateTo       = `${uid}-date-to`;
  const idActorFilter  = `${uid}-actor-filter`;
  const idActionFilter = `${uid}-action-filter`;
  const idCaseIdSearch = `${uid}-case-id-search`;

  return (
    <div
      className={[styles.filterPanel, className].filter(Boolean).join(" ")}
      role="search"
      aria-label="Filter audit ledger events"
      data-testid={testId}
      data-has-filters={hasFilters || undefined}
    >
      {/* ── Date range picker row ───────────────────────────────────────── */}
      {/*
        Sub-AC 2: date range state (dateFrom, dateTo) is managed locally via
        useState above. The parent is notified on each date commit via
        onFilterChange. The `max` / `min` constraints keep the range valid.
      */}
      <fieldset className={styles.fieldset} disabled={disabled}>
        <legend className={styles.fieldsetLegend}>Date range</legend>

        <div className={styles.dateRangeRow}>
          {/* From date */}
          <div className={styles.fieldGroup}>
            <label htmlFor={idDateFrom} className={styles.fieldLabel}>
              From
            </label>
            <input
              id={idDateFrom}
              type="date"
              className={styles.dateInput}
              value={dateFrom}
              onChange={handleDateFromChange}
              max={dateTo || undefined}
              aria-label="Filter from date"
              data-testid="filter-date-from"
            />
          </div>

          {/* Separator */}
          <span className={styles.dateRangeSeparator} aria-hidden="true">—</span>

          {/* To date */}
          <div className={styles.fieldGroup}>
            <label htmlFor={idDateTo} className={styles.fieldLabel}>
              To
            </label>
            <input
              id={idDateTo}
              type="date"
              className={styles.dateInput}
              value={dateTo}
              onChange={handleDateToChange}
              min={dateFrom || undefined}
              aria-label="Filter to date"
              data-testid="filter-date-to"
            />
          </div>
        </div>
      </fieldset>

      {/* ── Dropdowns + case ID search row ────────────────────────────── */}
      <div className={styles.controlsRow}>
        {/* Actor dropdown */}
        <div className={styles.fieldGroup}>
          <label htmlFor={idActorFilter} className={styles.fieldLabel}>
            Actor
          </label>
          <div className={styles.selectWrapper}>
            <select
              id={idActorFilter}
              className={styles.select}
              value={actor}
              onChange={handleActorChange}
              disabled={disabled || actorsLoading}
              aria-label="Filter by actor"
              aria-busy={actorsLoading}
              data-testid="filter-actor"
            >
              {actorOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {/* Chevron icon */}
            <span className={styles.selectChevron} aria-hidden="true">
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="2,3.5 5,6.5 8,3.5" />
              </svg>
            </span>
          </div>
        </div>

        {/* Action dropdown */}
        <div className={styles.fieldGroup}>
          <label htmlFor={idActionFilter} className={styles.fieldLabel}>
            Action
          </label>
          <div className={styles.selectWrapper}>
            <select
              id={idActionFilter}
              className={styles.select}
              value={action}
              onChange={handleActionChange}
              disabled={disabled}
              aria-label="Filter by action type"
              data-testid="filter-action"
            >
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className={styles.selectChevron} aria-hidden="true">
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="2,3.5 5,6.5 8,3.5" />
              </svg>
            </span>
          </div>
        </div>

        {/* Case ID search — Sub-AC 2: local state + debounce */}
        <div className={[styles.fieldGroup, styles.fieldGroupSearch].join(" ")}>
          <label htmlFor={idCaseIdSearch} className={styles.fieldLabel}>
            Case ID
          </label>
          <div className={styles.searchWrapper}>
            {/* Search icon */}
            <span className={styles.searchIcon} aria-hidden="true">
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="5" cy="5" r="3.5" />
                <line x1="7.75" y1="7.75" x2="10.5" y2="10.5" />
              </svg>
            </span>
            <input
              id={idCaseIdSearch}
              type="search"
              role="searchbox"
              className={styles.searchInput}
              value={caseIdSearch}
              onChange={handleCaseIdChange}
              placeholder="Search by case ID…"
              disabled={disabled}
              aria-label="Search by case ID"
              spellCheck={false}
              autoComplete="off"
              data-testid="filter-case-id"
            />
            {/* Inline clear button — only shown when search has a value */}
            {caseIdSearch && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={handleCaseIdClear}
                aria-label="Clear case ID search"
                data-testid="filter-case-id-clear"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                >
                  <line x1="2" y1="2" x2="8" y2="8" />
                  <line x1="8" y1="2" x2="2" y2="8" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Actions row — clear button + active count badge ────────────── */}
      {hasFilters && (
        <div className={styles.actionsRow}>
          <span
            className={styles.activeBadge}
            aria-live="polite"
            aria-atomic="true"
            data-testid="filter-active-count"
          >
            {activeCount} filter{activeCount !== 1 ? "s" : ""} active
          </span>
          <button
            type="button"
            className={styles.clearBtn}
            onClick={handleClearAll}
            aria-label="Clear all active filters"
            data-testid="filter-clear-all"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
