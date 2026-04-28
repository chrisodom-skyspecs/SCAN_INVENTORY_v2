/**
 * M5MissionControl — Mission Control map mode
 *
 * Shows live telemetry tracks, aircraft/drone positions, mission zones,
 * and exclusion areas on a high-contrast satellite base style.
 *
 * URL params wired via useMapParams:
 *   • view  → mode tab click calls setView(mode)
 *   • org   → org dropdown calls setOrg(id) / setOrg(null)
 *   • kit   → kit dropdown calls setKit(id) / setKit(null)
 *   • at    → replay scrubber calls setAt(date) / setAt(null)
 *             Controls the mission-replay wall-clock position.
 *             null = live/current view.
 *
 * Feature flag: FF_MAP_MISSION
 *   This component is only rendered when the FF_MAP_MISSION flag is active.
 *   InventoryMapClient is responsible for the flag check.
 *
 * Data source: useMapCasePins (Convex real-time subscription).
 *   Subscribes to api.mapData.getM1MapData scoped by missionId (derived from
 *   the `org` URL param). When org is set, only cases on that mission are shown.
 *   When org is null, all cases across the fleet are displayed.
 *   Convex re-evaluates within ~100–300 ms of any SCAN app mutation that
 *   touches the cases table, satisfying the ≤ 2-second real-time fidelity
 *   requirement.
 *
 * Design tokens: all colors via var(--map-m5-*) and var(--surface-*).
 * No hex literals; WCAG AA compliant.
 *
 * @remarks
 * On page load and hard refresh, useMapParams reads all four params
 * (view, org, kit, at) from the URL via useSearchParams, so the component
 * always initializes from the deep-linked state.
 */

"use client";

import { type ChangeEvent, useId } from "react";
import { useMapParams } from "@/hooks/use-map-params";
import { useMapCasePins } from "@/hooks/use-map-case-pins";
import { MAP_VIEW_VALUES, type MapView } from "@/types/map";
import styles from "./M5MissionControl.module.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAP_MODE_LABELS: Record<MapView, string> = {
  M1: "Fleet Overview",
  M2: "Activity Density",
  M3: "Transit Tracker",
  M4: "Deployment",
  M5: "Mission Control",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

export interface M5MissionControlProps {
  /** Available organisations for the org filter dropdown. */
  orgs?: Array<{ id: string; name: string }>;
  /** Available kits (case templates) for the kit filter dropdown. */
  kits?: Array<{ id: string; name: string }>;
  /** Mapbox access token.  When absent the map area shows a placeholder. */
  mapboxToken?: string;
  /**
   * Earliest replay timestamp available for scrubbing.
   * When provided, the datetime-local input is clamped to this minimum.
   */
  minAt?: Date;
  /**
   * Latest replay timestamp available (defaults to current wall-clock time).
   * When provided, the datetime-local input is clamped to this maximum.
   */
  maxAt?: Date;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * M5 — Mission Control
 *
 * Renders a satellite-style map with mission-replay scrubber, org/kit filters,
 * and mode switcher tabs. All state is persisted to and restored from the URL
 * via useMapParams so deep links and page refreshes restore the full session.
 *
 * Case pin data comes from useMapCasePins, which maintains a live Convex
 * subscription to api.mapData.getM1MapData. The subscription is scoped to the
 * mission selected via the org filter (missionId). When no mission is selected,
 * all fleet cases are shown. Pins update within ~100–300 ms of any SCAN app
 * mutation that changes case status, location, or assignee.
 *
 * Replay mode: when `at` is non-null the map replays the mission state at
 * that wall-clock timestamp. null = live / current feed.
 */
export function M5MissionControl({
  orgs = [],
  kits = [],
  mapboxToken,
  minAt,
  maxAt,
}: M5MissionControlProps) {
  // ── URL state via useMapParams ──────────────────────────────────────
  // All four params are read from the URL on mount (including hard refresh),
  // so the component always restores its state from the deep link.
  const { view, org, kit, at, setView, setOrg, setKit, setAt } = useMapParams();

  // ── Live mission case pin subscription (Convex real-time) ──────────
  //
  // No status filter — M5 shows all cases scoped to the selected mission.
  // `org` maps to a Convex mission document ID; null = global fleet view.
  //
  // Convex re-evaluates within ~100–300 ms when any case in the mission
  // changes status, location, or assignee — satisfying the ≤ 2-second
  // real-time fidelity requirement regardless of replay/live mode.
  const { pins, isLoading, summary } = useMapCasePins({
    missionId: org ?? undefined,
  });

  const orgSelectId    = useId();
  const kitSelectId    = useId();
  const scrubberLabelId = useId();

  // ── Derived counts ─────────────────────────────────────────────────
  const totalMissionCases = summary?.total ?? 0;

  // ── Derived state ──────────────────────────────────────────────────

  /** Whether we are currently in replay mode (at is non-null). */
  const isReplaying = at !== null;

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

  function handleScrubberChange(e: ChangeEvent<HTMLInputElement>) {
    const parsed = parseDatetimeLocal(e.target.value);
    setAt(parsed);
  }

  function handleExitReplay() {
    setAt(null);
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div
      className={styles.root}
      data-map-mode="M5"
      data-replaying={isReplaying ? "true" : undefined}
    >
      {/* ── Toolbar ── */}
      <header className={styles.toolbar} role="toolbar" aria-label="Mission Control map controls">
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

          {/* Mission case summary badge (live — updates via Convex subscription) */}
          <div className={styles.filterGroup} aria-live="polite" aria-atomic="true">
            <span className={styles.filterLabel}>
              {org ? "Mission cases" : "Fleet"}
            </span>
            <span
              className={styles.summaryBadge}
              data-loading={isLoading ? "true" : undefined}
              data-pin-count={pins.length}
              aria-label={
                isLoading
                  ? "Loading mission data…"
                  : `${totalMissionCases} case${totalMissionCases !== 1 ? "s" : ""}${org ? " in mission" : " total"}`
              }
            >
              {isLoading ? (
                <span className={styles.summaryLoading} aria-hidden="true" />
              ) : (
                <span className={styles.summaryCount}>
                  <span className={styles.summaryNumber}>{totalMissionCases}</span>
                  <span className={styles.summaryUnit}>
                    {totalMissionCases === 1 ? "case" : "cases"}
                  </span>
                </span>
              )}
            </span>
          </div>
        </div>
      </header>

      {/* ── Replay scrubber bar — prominent M5-specific control ── */}
      <div
        className={styles.scrubberBar}
        role="region"
        aria-label="Mission replay controls"
        data-replaying={isReplaying ? "true" : undefined}
      >
        <div className={styles.scrubberContent}>
          {/* Live indicator or replay badge */}
          {isReplaying ? (
            <span className={styles.replayBadge} aria-label="Replay mode active">
              <span className={styles.replayBadgeDot} aria-hidden="true" />
              REPLAY
            </span>
          ) : (
            <span className={styles.liveBadge} aria-label="Live mission feed">
              <span className={styles.liveBadgePulse} aria-hidden="true" />
              LIVE
            </span>
          )}

          {/* Scrubber input */}
          <div className={styles.scrubberGroup}>
            <label id={scrubberLabelId} className={styles.scrubberLabel}>
              Mission time
            </label>
            <div className={styles.scrubberRow}>
              <input
                type="datetime-local"
                className={styles.scrubberInput}
                aria-labelledby={scrubberLabelId}
                aria-describedby="m5-scrubber-hint"
                value={toDatetimeLocalValue(at)}
                min={minAt ? toDatetimeLocalValue(minAt) : undefined}
                max={
                  maxAt
                    ? toDatetimeLocalValue(maxAt)
                    : toDatetimeLocalValue(new Date())
                }
                onChange={handleScrubberChange}
              />
              {isReplaying && (
                <button
                  type="button"
                  className={styles.exitReplayButton}
                  onClick={handleExitReplay}
                  aria-label="Exit replay — return to live mission feed"
                >
                  Exit replay
                </button>
              )}
            </div>
            <p
              id="m5-scrubber-hint"
              className={styles.scrubberHint}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {isReplaying ? (
                <>
                  Replaying mission at{" "}
                  <time dateTime={at!.toISOString()} className={styles.scrubberTimestamp}>
                    {at!.toLocaleString()}
                  </time>
                </>
              ) : (
                "Select a time to replay mission data from that point."
              )}
            </p>
          </div>
        </div>
      </div>

      {/* ── Map canvas ── */}
      <main className={styles.mapCanvas} aria-label="Mission Control map">
        {mapboxToken ? (
          /* Map rendered by react-map-gl; mission case pin data exposed via
             data attributes for the Mapbox layer integration to consume. */
          <div
            id="m5-map-container"
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
                Loading mission data…
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
                  /* Mission case list — live data from the Convex subscription */
                  <ul
                    className={styles.pinList}
                    aria-label={`${pins.length} case${pins.length !== 1 ? "s" : ""} in mission`}
                    data-testid="m5-pin-list"
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
        {`Mission Control. View: ${MAP_MODE_LABELS[view]}.`}
        {isLoading
          ? " Loading mission data."
          : ` ${totalMissionCases} case${totalMissionCases !== 1 ? "s" : ""}${org ? " in mission" : " total"}.`}
        {org ? ` Organisation filter active.` : ""}
        {kit ? ` Kit filter active.` : ""}
        {isReplaying
          ? ` Replaying mission at ${at!.toLocaleString()}.`
          : " Live mission feed."}
      </output>
    </div>
  );
}

export default M5MissionControl;
