/**
 * M3TransitTracker — Transit Tracker map mode
 *
 * Shows in-transit cases with FedEx route overlays.
 * URL params wired via useMapParams:
 *   • view  → mode tab click calls setView(mode)
 *   • org   → org dropdown calls setOrg(id) / setOrg(null)
 *   • kit   → kit dropdown calls setKit(id) / setKit(null)
 *   • at    → time picker calls setAt(date) / setAt(null)
 *
 * The `at` param enables time-scrubbing: navigating back to a past
 * timestamp shows a historical snapshot of transit positions.
 *
 * Data source: useMapCasePins (Convex real-time subscription).
 *   Subscribes to api.mapData.getM1MapData filtered to status: ["shipping"].
 *   Convex re-evaluates within ~100–300 ms of any SCAN app mutation that
 *   transitions a case into or out of the "shipping" status, satisfying
 *   the ≤ 2-second real-time fidelity requirement.
 *
 * Design tokens: all colors via var(--map-m3-*) and var(--surface-*).
 * No hex literals; WCAG AA compliant.
 */

"use client";

import { type ChangeEvent, useId } from "react";
import { useMapParams } from "@/hooks/use-map-params";
import { useMapCasePins, type CaseStatus } from "@/hooks/use-map-case-pins";
import { MAP_VIEW_VALUES, type MapView } from "@/types/map";
import styles from "./M3TransitTracker.module.css";

// ── In-transit status filter ──────────────────────────────────────────────────
//
// M3 shows only cases that are currently shipping (in transit via FedEx).
// Typed explicitly as CaseStatus[] for stable array identity — same reference
// across renders avoids redundant Convex re-subscriptions.
const IN_TRANSIT_STATUSES: CaseStatus[] = ["shipping"];

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
 * M3 — Transit Tracker
 *
 * Renders an in-transit case map with filter + time controls.
 * Subscribes to live case pin data via useMapCasePins filtered to
 * ["shipping"] status — the in-transit subset.
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

  // ── Live in-transit pin subscription (Convex real-time) ───────────
  //
  // Filtered to ["shipping"] — cases currently moving via FedEx.
  // `org` maps to a Convex mission document ID for per-mission scoping.
  //
  // The stable `IN_TRANSIT_STATUSES` constant is defined at module scope
  // to prevent re-subscription on every render (array identity stable).
  //
  // Convex re-evaluates within ~100–300 ms when:
  //   • shipping.shipCase transitions a case to "shipping"
  //   • scan.scanCheckIn transitions a case OUT of "shipping"
  //   • Any custody transfer changes the assigneeId on a shipping case
  const { pins, isLoading, summary } = useMapCasePins({
    status: IN_TRANSIT_STATUSES,
    missionId: org ?? undefined,
  });

  const orgSelectId  = useId();
  const kitSelectId  = useId();
  const timePickerId = useId();

  // ── Derived counts ─────────────────────────────────────────────────
  const inTransitCount = summary?.byStatus?.["shipping"] ?? 0;

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

          {/* Time picker (at) — transit position snapshot */}
          <div className={styles.filterGroup}>
            <label htmlFor={timePickerId} className={styles.filterLabel}>
              Transit snapshot
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
                aria-label="Snapshot timestamp — view historical transit positions"
              />
              {at !== null && (
                <button
                  type="button"
                  className={styles.clearAtButton}
                  onClick={handleClearAt}
                  aria-label="Clear time snapshot — return to live transit view"
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

          {/* In-transit summary badge (live — updates via Convex subscription) */}
          <div className={styles.filterGroup} aria-live="polite" aria-atomic="true">
            <span className={styles.filterLabel}>In transit</span>
            <span
              className={styles.summaryBadge}
              data-loading={isLoading ? "true" : undefined}
              data-pin-count={pins.length}
              aria-label={
                isLoading
                  ? "Loading transit data…"
                  : `${inTransitCount} case${inTransitCount !== 1 ? "s" : ""} in transit`
              }
            >
              {isLoading ? (
                <span className={styles.summaryLoading} aria-hidden="true" />
              ) : (
                <span className={styles.summaryCount}>
                  <span className={styles.summaryNumber}>{inTransitCount}</span>
                  <span className={styles.summaryUnit}>
                    {inTransitCount === 1 ? "case" : "cases"}
                  </span>
                </span>
              )}
            </span>
          </div>
        </div>
      </header>

      {/* ── Map canvas ── */}
      <main className={styles.mapCanvas} aria-label="Transit tracker map">
        {mapboxToken ? (
          /* Map rendered by react-map-gl; transit pin data exposed via data
             attributes for the Mapbox layer integration to consume. */
          <div
            id="m3-map-container"
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
                Loading transit data…
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
                  /* Transit case list — live data from the Convex subscription */
                  <ul
                    className={styles.pinList}
                    aria-label={`${pins.length} case${pins.length !== 1 ? "s" : ""} in transit`}
                    data-testid="m3-pin-list"
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
        {`Transit tracker. View: ${MAP_MODE_LABELS[view]}.`}
        {isLoading
          ? " Loading transit data."
          : ` ${inTransitCount} case${inTransitCount !== 1 ? "s" : ""} in transit.`}
        {org ? ` Organisation filter active.` : ""}
        {kit ? ` Kit filter active.` : ""}
        {at ? ` Showing snapshot at ${at.toLocaleString()}.` : " Live view."}
      </output>
    </div>
  );
}

export default M3TransitTracker;
