/**
 * M3TransitTracker — Field Mode map view
 *
 * Shows cases in active field inspection with inspection progress data.
 * Provides a field operations view for technicians and ops staff, showing
 * deployed and flagged cases with checklist completion progress.
 * URL params wired via useMapParams:
 *   • view  → mode tab click calls setView(mode)
 *   • org   → org dropdown calls setOrg(id) / setOrg(null)  (maps to missionId)
 *   • kit   → kit dropdown calls setKit(id) / setKit(null)
 *   • at    → time picker calls setAt(date) / setAt(null)
 *
 * The `at` param enables time-scrubbing: navigating back to a past
 * timestamp shows a historical snapshot of field positions and inspection state.
 *
 * Data source: useCaseMapData({ mode: "M3" }) — Convex real-time M3 subscription.
 *   Subscribes to api.mapData.getM3MapData, which returns deployed and flagged
 *   cases with inspection progress data (checkedItems, totalItems,
 *   inspectionProgress, damagedItems, missingItems) and custody state.
 *
 *   Reactive to:
 *     • scan.scanCheckIn         → transitions case to deployed, creates inspection
 *     • scan.updateChecklistItem → updates inspection counters (immediate M3 update)
 *     • scan.startInspection     → creates new inspection row
 *     • scan.completeInspection  → inspection status to completed/flagged
 *     • custody.transferCustody  → updates custodian on field case pins
 *   Convex re-evaluates within ~100–300 ms, satisfying the ≤ 2-second real-time
 *   fidelity requirement.
 *
 * Design tokens: all colors via var(--map-m3-*) and var(--surface-*).
 * No hex literals; WCAG AA compliant.
 */

"use client";

import { type ChangeEvent, useId } from "react";
import { useMapParams } from "@/hooks/use-map-params";
import { useCaseMapData } from "@/hooks/use-case-map-data";
import { MAP_VIEW_VALUES, type MapView } from "@/types/map";
import { useIsDark } from "@/providers/theme-provider";
import { InventoryMapCanvas } from "./InventoryMapCanvas";
import { InventoryCaseMarkers } from "./InventoryCaseMarkers";
import styles from "./M3TransitTracker.module.css";

// ─── Mapbox style URLs ────────────────────────────────────────────────────────

/**
 * M3 uses the "streets" base style — roads are essential context for
 * in-transit shipment routes.  Switches between light and dark variants
 * based on the active theme so shipping routes render with appropriate contrast.
 */
const MAPBOX_STYLE_LIGHT = "mapbox://styles/mapbox/streets-v12";
const MAPBOX_STYLE_DARK  = "mapbox://styles/mapbox/dark-v11";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAP_MODE_LABELS: Record<MapView, string> = {
  M1: "Fleet Overview",
  M2: "Activity Density",
  M3: "Transit Tracker",
  M4: "Deployment",
  M5: "Mission Control",
};

/**
 * Format a Date for the datetime-local input element (YYYY-MM-DDTHH:MM).
 * Returns empty string when date is null.
 */
function toDatetimeLocalValue(date: Date | null): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const year  = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day   = pad(date.getDate());
  const hours = pad(date.getHours());
  const mins  = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

/**
 * Parse a datetime-local input string to a Date.
 * Returns null for empty / invalid values.
 */
function parseDatetimeLocal(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface M3TransitTrackerProps {
  /** Available organisations for the org filter dropdown. */
  orgs?: Array<{ id: string; name: string }>;
  /** Available kits (case templates) for the kit filter dropdown. */
  kits?: Array<{ id: string; name: string }>;
  /** Mapbox access token.  When absent the map area shows a placeholder. */
  mapboxToken?: string;
  /** Minimum selectable date for the time picker. */
  minAt?: Date;
  /** Maximum selectable date for the time picker (defaults to now). */
  maxAt?: Date;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * M3 — Field Mode
 *
 * Renders a field-inspection map panel with filter + time controls.
 * Subscribes to live field-case data via useCaseMapData({ mode: "M3" }),
 * which queries api.mapData.getM3MapData — deployed and flagged cases with
 * inspection progress data (checklist completion, damage, missing items).
 * All filter changes write to the URL via useMapParams.
 */
export function M3TransitTracker({
  orgs = [],
  kits = [],
  mapboxToken,
  minAt,
  maxAt,
}: M3TransitTrackerProps) {
  const { view, org, kit, at, setView, setOrg, setKit, setAt } = useMapParams();

  // ── Dark mode — Mapbox style switching ───────────────────────────────────────
  //
  // useIsDark() reads the ThemeContext.  In dark mode the "dark-v11" Mapbox
  // style is used so transit routes (orange overlays) render with high contrast
  // against the dark base map.
  const isDark   = useIsDark();
  const mapStyle = isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT;

  // ── Live M3 Field Mode subscription via useCaseMapData ────────────
  //
  // useCaseMapData({ mode: "M3" }) subscribes to api.mapData.getM3MapData,
  // returning deployed and flagged cases with full inspection progress data:
  //   • inspectionProgress  — 0–100 completion percentage
  //   • checkedItems        — items checked in the packing list
  //   • totalItems          — total packing list items
  //   • damagedItems        — items marked as damaged
  //   • missingItems        — items reported missing
  //   • currentCustodianId/Name — who physically holds the case
  //
  // `org` maps to a Convex mission document ID for per-mission scoping.
  //
  // Convex re-evaluates within ~100–300 ms when:
  //   • scan.updateChecklistItem updates inspection counters
  //   • scan.startInspection creates a new inspection row
  //   • scan.completeInspection transitions inspection status
  //   • scan.scanCheckIn transitions a case to deployed
  const { records: pins, isLoading, summary } = useCaseMapData({
    mode: "M3",
    missionId: org ?? undefined,
  });

  const orgSelectId  = useId();
  const kitSelectId  = useId();
  const timePickerId = useId();

  // ── Derived counts ─────────────────────────────────────────────────
  //
  // M3 (Field Mode) returns deployed and flagged cases.  summary.byStatus
  // contains inspection-status breakdowns ("in_progress", "completed",
  // "flagged", "none"), not case lifecycle statuses.  We compute field case
  // counts directly from summary.total (total deployed+flagged field cases)
  // and from the records array for individual status breakdowns.
  const fieldCaseCount   = summary?.total ?? pins.length;
  const deployedCount    = pins.filter((p) => p.status === "deployed").length;
  const flaggedCount     = pins.filter((p) => p.status === "flagged").length;
  const inProgressCount  = summary?.byStatus?.["in_progress"] ?? 0;
  // Legacy alias kept for the badge aria-label and SR output below
  const inTransitCount   = fieldCaseCount;

  // ── Handlers ──────────────────────────────────────────────────────

  function handleViewChange(next: MapView) {
    if (next !== view) {
      setView(next);
    }
  }

  function handleOrgChange(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setOrg(value === "" ? null : value);
  }

  function handleKitChange(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setKit(value === "" ? null : value);
  }

  function handleAtChange(e: ChangeEvent<HTMLInputElement>) {
    const parsed = parseDatetimeLocal(e.target.value);
    setAt(parsed);
  }

  function handleClearAt() {
    setAt(null);
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className={styles.root} data-map-mode="M3">
      {/* ── Toolbar ── */}
      <header className={styles.toolbar} role="toolbar" aria-label="Map controls">
        {/* Mode switcher */}
        <nav className={styles.modeTabs} aria-label="Map modes">
          {MAP_VIEW_VALUES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={mode === view}
              aria-label={`Switch to ${MAP_MODE_LABELS[mode]}`}
              className={styles.modeTab}
              data-active={mode === view ? "true" : undefined}
              onClick={() => handleViewChange(mode)}
            >
              <span className={styles.modeTabCode}>{mode}</span>
              <span className={styles.modeTabLabel}>{MAP_MODE_LABELS[mode]}</span>
            </button>
          ))}
        </nav>

        {/* Filters */}
        <div className={styles.filters}>
          {/* Org filter */}
          <div className={styles.filterGroup}>
            <label htmlFor={orgSelectId} className={styles.filterLabel}>
              Organisation
            </label>
            <select
              id={orgSelectId}
              className={styles.filterSelect}
              value={org ?? ""}
              onChange={handleOrgChange}
              aria-label="Filter by organisation"
            >
              <option value="">All organisations</option>
              {orgs.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {/* Kit filter */}
          <div className={styles.filterGroup}>
            <label htmlFor={kitSelectId} className={styles.filterLabel}>
              Kit type
            </label>
            <select
              id={kitSelectId}
              className={styles.filterSelect}
              value={kit ?? ""}
              onChange={handleKitChange}
              aria-label="Filter by kit type"
            >
              <option value="">All kits</option>
              {kits.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {/* Time picker (at) — field position snapshot */}
          <div className={styles.filterGroup}>
            <label htmlFor={timePickerId} className={styles.filterLabel}>
              Field snapshot
            </label>
            <div className={styles.timePickerRow}>
              <input
                id={timePickerId}
                type="datetime-local"
                className={styles.timePicker}
                value={toDatetimeLocalValue(at)}
                min={minAt ? toDatetimeLocalValue(minAt) : undefined}
                max={
                  maxAt
                    ? toDatetimeLocalValue(maxAt)
                    : toDatetimeLocalValue(new Date())
                }
                onChange={handleAtChange}
                aria-label="Snapshot timestamp — view historical field positions and inspection state"
              />
              {at !== null && (
                <button
                  type="button"
                  className={styles.clearAtButton}
                  onClick={handleClearAt}
                  aria-label="Clear time snapshot — return to live field view"
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </div>
            {at !== null && (
              <p className={styles.atHint} role="status" aria-live="polite">
                Showing snapshot:{" "}
                <time dateTime={at.toISOString()} className={styles.atValue}>
                  {at.toLocaleString()}
                </time>
              </p>
            )}
          </div>

          {/* Field case summary badge (live — updates via useCaseMapData M3 subscription) */}
          <div className={styles.filterGroup} aria-live="polite" aria-atomic="true">
            <span className={styles.filterLabel}>In field</span>
            <span
              className={styles.summaryBadge}
              data-loading={isLoading ? "true" : undefined}
              data-pin-count={pins.length}
              aria-label={
                isLoading
                  ? "Loading field data…"
                  : `${fieldCaseCount} case${fieldCaseCount !== 1 ? "s" : ""} in field (${deployedCount} deployed, ${flaggedCount} flagged, ${inProgressCount} inspecting)`
              }
            >
              {isLoading ? (
                <span className={styles.summaryLoading} aria-hidden="true" />
              ) : (
                <span className={styles.summaryCount}>
                  <span className={styles.summaryNumber}>{fieldCaseCount}</span>
                  <span className={styles.summaryUnit}>
                    {fieldCaseCount === 1 ? "case" : "cases"}
                  </span>
                </span>
              )}
            </span>
          </div>
        </div>
      </header>

      {/* ── Map canvas ── */}
      <main className={styles.mapCanvas} aria-label="Field mode map">
        {mapboxToken ? (
          <div
            id="m3-map-container"
            className={styles.mapContainer}
            data-mapbox-token={mapboxToken}
            data-mapbox-style={mapStyle}
            data-theme={isDark ? "dark" : "light"}
            data-pin-count={pins.length}
            data-loading={isLoading ? "true" : undefined}
          >
            <InventoryMapCanvas
              mapboxToken={mapboxToken}
              mapStyle={mapStyle}
              aria-label="Field mode map"
              showEmptyMessage={!isLoading && pins.length === 0}
              emptyMessage="No field case locations to display yet."
            >
              <InventoryCaseMarkers
                records={pins}
                getMeta={(pin) =>
                  pin.inspectionProgress !== undefined
                    ? `${pin.inspectionProgress}%`
                    : pin.locationName ?? pin.status
                }
              />
            </InventoryMapCanvas>
          </div>
        ) : (
          <div
            className={styles.mapPlaceholder}
            role="img"
            aria-label="Map placeholder — Mapbox token not configured"
          >
            {isLoading ? (
              <p className={styles.mapPlaceholderText}>
                Loading field data…
              </p>
            ) : (
              <>
                <p className={styles.mapPlaceholderText}>
                  Map unavailable — set{" "}
                  <code className={styles.mapPlaceholderCode}>
                    NEXT_PUBLIC_MAPBOX_TOKEN
                  </code>
                </p>
                {pins.length > 0 && (
                  /* Field case list — live data from useCaseMapData M3 subscription.
                     Each record includes inspection progress for tooltip rendering. */
                  <ul
                    className={styles.pinList}
                    aria-label={`${pins.length} case${pins.length !== 1 ? "s" : ""} in field`}
                    data-testid="m3-pin-list"
                  >
                    {pins.slice(0, 20).map((pin) => (
                      <li
                        key={pin.caseId}
                        className={styles.pinListItem}
                        data-status={pin.status}
                        data-case-id={pin.caseId}
                        data-inspection-progress={pin.inspectionProgress}
                      >
                        <span
                          className={styles.pinDot}
                          data-status={pin.status}
                          aria-hidden="true"
                        />
                        <span className={styles.pinLabel}>{pin.label}</span>
                        <span className={styles.pinStatus}>{pin.status}</span>
                        {pin.assigneeName && (
                          <span className={styles.pinAssignee}>
                            {pin.assigneeName}
                          </span>
                        )}
                        {pin.locationName && (
                          <span className={styles.pinLocation}>
                            {pin.locationName}
                          </span>
                        )}
                        {/* Inspection progress overlay — available on M3 CaseMapRecord */}
                        {pin.inspectionProgress !== undefined && (
                          <span
                            className={styles.pinInspectionProgress}
                            aria-label={`Inspection: ${pin.inspectionProgress}% complete`}
                          >
                            {pin.inspectionProgress}%
                          </span>
                        )}
                      </li>
                    ))}
                    {pins.length > 20 && (
                      <li className={styles.pinListMore}>
                        +{pins.length - 20} more
                      </li>
                    )}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* ── Active state summary (screen-reader) ── */}
      <output
        className={styles.srOnly}
        aria-live="polite"
        aria-atomic="true"
      >
        {`Field mode. View: ${MAP_MODE_LABELS[view]}.`}
        {isLoading
          ? " Loading field data."
          : ` ${fieldCaseCount} case${fieldCaseCount !== 1 ? "s" : ""} in field (${deployedCount} deployed, ${flaggedCount} flagged).`}
        {org ? ` Organisation filter active.` : ""}
        {kit ? ` Kit filter active.` : ""}
        {at ? ` Showing snapshot at ${at.toLocaleString()}.` : " Live view."}
      </output>
    </div>
  );
}

export default M3TransitTracker;
