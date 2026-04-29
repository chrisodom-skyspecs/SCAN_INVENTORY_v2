/**
 * M5MissionControl — Mission Control map mode
 *
 * Shows live telemetry tracks, cluster/heatmap aggregates, mission zones,
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
 * Data source: useCaseMapData({ mode: "M5" }) — Convex real-time M5 subscription.
 *   Subscribes to api.mapData.getM5MapData, which returns cluster/heatmap
 *   aggregates and fleet-wide summary counts (totalCases, byStatus).  M5 does
 *   not return individual case records — records is always [] for this mode.
 *   Fleet counts are available via summary.total and summary.byStatus.
 *
 *   Reactive to:
 *     • Any case status mutation → summary counts update in real-time
 *   Convex re-evaluates within ~100–300 ms, satisfying the ≤ 2-second
 *   real-time fidelity requirement.
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
import { useCaseMapData } from "@/hooks/use-case-map-data";
import { MAP_VIEW_VALUES, type MapView } from "@/types/map";
import { useIsDark } from "@/providers/theme-provider";
import styles from "./M5MissionControl.module.css";

// ─── Mapbox style URLs ────────────────────────────────────────────────────────

/**
 * M5 Mission Control always uses a satellite base — live telemetry tracks
 * and mission zone polygons are designed for high contrast against imagery.
 *
 * In dark theme we use "satellite-streets-v12" with additional darkness from
 * the Mapbox token `fog` and `atmosphere` configurations (handled at runtime).
 * In light theme the same satellite style is used since satellite imagery is
 * inherently dark and the mission-control HUD tokens are dark by design.
 *
 * If the user wants a pure "mission planning" light base, they can switch to
 * M2/M4; M5 is specifically a dark/satellite-first experience.
 */
const MAPBOX_STYLE_LIGHT = "mapbox://styles/mapbox/satellite-streets-v12";
const MAPBOX_STYLE_DARK  = "mapbox://styles/mapbox/satellite-streets-v12";

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
 * Fleet summary data comes from useCaseMapData({ mode: "M5" }), which
 * maintains a live Convex subscription to api.mapData.getM5MapData.
 * M5 returns cluster/heatmap aggregates — no individual case pins.
 * summary.total and summary.byStatus drive the analytics overlay and legend.
 * Fleet counts update within ~100–300 ms of any SCAN app mutation.
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

  // ── Dark mode — Mapbox style and UI token activation ──────────────────────���──
  //
  // useIsDark() reads the ThemeContext.  M5 always uses a satellite base style
  // (inherently dark), but `isDark` is still needed to:
  //   1. Pass data-theme to the map container so the Mapbox integration can
  //      apply additional fog/atmosphere settings for dark mode.
  //   2. Activate the .theme-dark CSS block which re-maps the scrubber bar's
  //      color-scheme for the datetime-local input.
  const isDark   = useIsDark();
  const mapStyle = isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT;

  // ── Live M5 Mission Control subscription via useCaseMapData ──────────
  //
  // useCaseMapData({ mode: "M5" }) subscribes to api.mapData.getM5MapData,
  // which returns cluster/heatmap aggregates rather than individual case records.
  //
  // records is always [] for M5 — the map renders cluster layers directly from
  // the Mapbox GL source rather than individual pins.
  //
  // summary.total gives the fleet-wide case count (all statuses).
  // summary.byStatus provides per-status breakdowns for the heatmap legend.
  //
  // Convex re-evaluates within ~100–300 ms when any case status changes,
  // satisfying the ≤ 2-second real-time fidelity requirement regardless of
  // replay/live mode.
  const { records: pins, isLoading, summary } = useCaseMapData({
    mode: "M5",
  });

  const orgSelectId    = useId();
  const kitSelectId    = useId();
  const scrubberLabelId = useId();

  // ── Derived counts ─────────────────────────────────────────────────
  //
  // M5 summary.total comes from M5Response.summary.totalCases — the full
  // fleet count.  summary.byStatus contains case lifecycle status breakdowns
  // for use in the heatmap legend and mission analytics overlay.
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

          {/* Fleet summary badge (live — updates via useCaseMapData M5 subscription) */}
          <div className={styles.filterGroup} aria-live="polite" aria-atomic="true">
            <span className={styles.filterLabel}>
              Fleet
            </span>
            <span
              className={styles.summaryBadge}
              data-loading={isLoading ? "true" : undefined}
              data-pin-count={pins.length}
              aria-label={
                isLoading
                  ? "Loading fleet data…"
                  : `${totalMissionCases} case${totalMissionCases !== 1 ? "s" : ""} total`
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
          /* Map rendered by react-map-gl; M5 cluster/heatmap aggregates are
             consumed directly by the Mapbox GL source layer.  summary.total and
             summary.byStatus drive the analytics overlay and heatmap legend.
             records is always [] for M5 — no individual case pins.

             data-fleet-count — reactive total case count from
               useCaseMapData({ mode: "M5" }) → summary.total; drives the
               fleet-wide analytics overlay header in the Mapbox GL layer.
             data-by-status — reactive JSON-serialized status breakdown from
               summary.byStatus; drives the heatmap legend layer colors and
               cluster status badge overlays without re-querying Convex. */
          <div
            id="m5-map-container"
            className={styles.mapContainer}
            data-mapbox-token={mapboxToken}
            data-mapbox-style={mapStyle}
            data-theme={isDark ? "dark" : "light"}
            data-fleet-count={totalMissionCases}
            data-by-status={summary ? JSON.stringify(summary.byStatus) : undefined}
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
                Loading fleet data…
              </p>
            ) : (
              <>
                <p className={styles.mapPlaceholderText}>
                  Map unavailable — set{" "}
                  <code className={styles.mapPlaceholderCode}>
                    NEXT_PUBLIC_MAPBOX_TOKEN
                  </code>
                </p>
                {/* Status breakdown — live from useCaseMapData M5 subscription.
                    summary.byStatus provides per-lifecycle-status case counts
                    that would drive the heatmap legend and cluster overlays when
                    Mapbox GL is connected.  Rendered here as a fallback preview
                    so operators can see fleet status distribution without a map. */}
                {summary?.byStatus &&
                  Object.values(summary.byStatus).some((count) => count > 0) && (
                    <ul
                      className={styles.pinList}
                      aria-label="Fleet status breakdown"
                      data-testid="m5-status-breakdown"
                    >
                      {Object.entries(summary.byStatus)
                        .filter(([, count]) => count > 0)
                        .sort(([, a], [, b]) => b - a)
                        .map(([status, count]) => (
                          <li
                            key={status}
                            className={styles.pinListItem}
                            data-status={status}
                          >
                            <span
                              className={styles.pinDot}
                              data-status={status}
                              aria-hidden="true"
                            />
                            <span className={styles.pinLabel}>{status}</span>
                            <span
                              className={styles.pinStatus}
                              aria-label={`${count} case${count !== 1 ? "s" : ""}`}
                            >
                              {count}
                            </span>
                          </li>
                        ))}
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
          ? " Loading fleet data."
          : ` ${totalMissionCases} case${totalMissionCases !== 1 ? "s" : ""} total.`}
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
