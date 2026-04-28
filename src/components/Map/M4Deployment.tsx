/**
 * M4Deployment — Deployment / Field Inspection map mode
 *
 * Shows cases actively deployed in the field under inspection.
 * URL params wired via useMapParams:
 *   • view  → mode tab click calls setView(mode)
 *   • org   → org dropdown calls setOrg(id) / setOrg(null)
 *   • kit   → kit dropdown calls setKit(id) / setKit(null)
 *   • at    → time picker calls setAt(date) / setAt(null)
 *
 * The `at` param enables historical snapshot: viewing which cases were
 * in the field at a given point in time.
 *
 * Data source: useMapCasePins (Convex real-time subscription).
 *   Subscribes to api.mapData.getM1MapData filtered to status: ["in_field"].
 *   Convex re-evaluates within ~100–300 ms of any SCAN app mutation that
 *   transitions a case into or out of the "in_field" status, satisfying
 *   the ≤ 2-second real-time fidelity requirement.
 *
 * Design tokens: all colors via var(--map-m4-*) and var(--surface-*).
 * No hex literals; WCAG AA compliant.
 */

"use client";

import { type ChangeEvent, useId } from "react";
import { useMapParams } from "@/hooks/use-map-params";
import { useMapCasePins, type CaseStatus } from "@/hooks/use-map-case-pins";
import { MAP_VIEW_VALUES, type MapView } from "@/types/map";
import styles from "./M4Deployment.module.css";

// ── Field inspection status filter ────────────────────────────────────────────
//
// M4 shows cases that are currently in the field being inspected.
// Typed explicitly as CaseStatus[] for stable array identity — same reference
// across renders avoids redundant Convex re-subscriptions.
const FIELD_INSPECTION_STATUSES: CaseStatus[] = ["in_field"];

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

export interface M4DeploymentProps {
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
 * M4 — Deployment / Field Inspection
 *
 * Renders a field inspection map panel with filter + time controls.
 * Subscribes to live case pin data via useMapCasePins filtered to
 * ["in_field"] status — the active field inspection subset.
 * All filter changes write to the URL via useMapParams.
 */
export function M4Deployment({
  orgs = [],
  kits = [],
  mapboxToken,
  minAt,
  maxAt,
}: M4DeploymentProps) {
  const { view, org, kit, at, setView, setOrg, setKit, setAt } = useMapParams();

  // ── Live field-inspection pin subscription (Convex real-time) ─────
  //
  // Filtered to ["in_field"] — cases currently deployed in the field.
  // `org` maps to a Convex mission document ID for per-mission scoping.
  //
  // The stable `FIELD_INSPECTION_STATUSES` constant is defined at module
  // scope to prevent re-subscription on every render (array identity stable).
  //
  // Convex re-evaluates within ~100–300 ms when:
  //   • scan.scanCheckIn transitions a case to "in_field"
  //   • shipping.shipCase transitions a case OUT of "in_field" to "shipping"
  //   • Any custody transfer changes the assigneeId on an in_field case
  const { pins, isLoading, summary } = useMapCasePins({
    status: FIELD_INSPECTION_STATUSES,
    missionId: org ?? undefined,
  });

  const orgSelectId  = useId();
  const kitSelectId  = useId();
  const timePickerId = useId();

  // ── Derived counts ─────────────────────────────────────────────────
  const inFieldCount = summary?.byStatus?.["in_field"] ?? 0;

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
    <div className={styles.root} data-map-mode="M4">
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

          {/* Time picker (at) — deployment snapshot */}
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
                aria-label="Snapshot timestamp — view historical field inspection state"
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

          {/* Field inspection summary badge (live — updates via Convex) */}
          <div className={styles.filterGroup} aria-live="polite" aria-atomic="true">
            <span className={styles.filterLabel}>In field</span>
            <span
              className={styles.summaryBadge}
              data-loading={isLoading ? "true" : undefined}
              data-pin-count={pins.length}
              aria-label={
                isLoading
                  ? "Loading field data…"
                  : `${inFieldCount} case${inFieldCount !== 1 ? "s" : ""} in field`
              }
            >
              {isLoading ? (
                <span className={styles.summaryLoading} aria-hidden="true" />
              ) : (
                <span className={styles.summaryCount}>
                  <span className={styles.summaryNumber}>{inFieldCount}</span>
                  <span className={styles.summaryUnit}>
                    {inFieldCount === 1 ? "case" : "cases"}
                  </span>
                </span>
              )}
            </span>
          </div>
        </div>
      </header>

      {/* ── Map canvas ── */}
      <main className={styles.mapCanvas} aria-label="Deployment map">
        {mapboxToken ? (
          /* Map rendered by react-map-gl; field inspection pin data exposed
             via data attributes for the Mapbox layer integration to consume. */
          <div
            id="m4-map-container"
            className={styles.mapContainer}
            data-mapbox-token={mapboxToken}
            data-pin-count={pins.length}
            data-loading={isLoading ? "true" : undefined}
          />
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
                  /* Field inspection list — live data from the Convex subscription */
                  <ul
                    className={styles.pinList}
                    aria-label={`${pins.length} case${pins.length !== 1 ? "s" : ""} in field`}
                    data-testid="m4-pin-list"
                  >
                    {pins.slice(0, 20).map((pin) => (
                      <li
                        key={pin.caseId}
                        className={styles.pinListItem}
                        data-status={pin.status}
                        data-case-id={pin.caseId}
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
        {`Deployment. View: ${MAP_MODE_LABELS[view]}.`}
        {isLoading
          ? " Loading field data."
          : ` ${inFieldCount} case${inFieldCount !== 1 ? "s" : ""} in field.`}
        {org ? ` Organisation filter active.` : ""}
        {kit ? ` Kit filter active.` : ""}
        {at ? ` Showing snapshot at ${at.toLocaleString()}.` : " Live view."}
      </output>
    </div>
  );
}

export default M4Deployment;
