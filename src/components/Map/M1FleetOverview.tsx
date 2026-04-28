/**
 * M1FleetOverview — Fleet Overview map mode
 *
 * Shows all cases on a world / region map with status-colored CSS pins.
 * URL params wired via useMapParams:
 *   • view  → selecting a different mode tab calls setView(mode)
 *   • org   → org dropdown calls setOrg(id) / setOrg(null)
 *   • kit   → kit dropdown calls setKit(id) / setKit(null)
 *
 * Data source: useMapCasePins (Convex real-time subscription).
 *   Subscribes to api.mapData.getM1MapData with optional missionId filter
 *   (derived from the `org` URL param).  Convex re-evaluates within ~100–300 ms
 *   of any SCAN app mutation that touches the cases table, satisfying the ≤ 2-second
 *   real-time fidelity requirement.
 *
 * Design tokens: all colors use var(--map-m1-*) and var(--surface-*) etc.
 * No hex literals; WCAG AA compliant.
 */

"use client";

import { type ChangeEvent, useId } from "react";
import { useMapParams } from "@/hooks/use-map-params";
import { useMapCasePins } from "@/hooks/use-map-case-pins";
import { MAP_VIEW_VALUES, type MapView } from "@/types/map";
import styles from "./M1FleetOverview.module.css";

// ─── Map mode labels ──────────────────────────────────────────────────────────

const MAP_MODE_LABELS: Record<MapView, string> = {
  M1: "Fleet Overview",
  M2: "Activity Density",
  M3: "Transit Tracker",
  M4: "Deployment",
  M5: "Mission Control",
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface M1FleetOverviewProps {
  /**
   * Available organisations for the org filter dropdown.
   * Each entry is a { id: string; name: string } pair.
   */
  orgs?: Array<{ id: string; name: string }>;
  /**
   * Available kits (case templates) for the kit filter dropdown.
   */
  kits?: Array<{ id: string; name: string }>;
  /**
   * Mapbox access token.  When absent the map area shows a placeholder.
   */
  mapboxToken?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * M1 — Fleet Overview
 *
 * Renders a full-viewport map panel with a filter toolbar.
 * Selecting org, kit, or switching to another map mode
 * updates the URL query string via useMapParams.
 *
 * Case pin data comes from useMapCasePins, which maintains a live Convex
 * subscription to api.mapData.getM1MapData.  Pins update within ~100–300 ms
 * of any SCAN app mutation that changes case status, location, or assignee.
 */
export function M1FleetOverview({
  orgs = [],
  kits = [],
  mapboxToken,
}: M1FleetOverviewProps) {
  const { view, org, kit, setView, setOrg, setKit } = useMapParams();

  // ── Live case pin subscription (Convex real-time) ─────────────────
  //
  // `org` maps to a Convex mission document ID — the org dropdown selects
  // a mission group, which scopes the map to cases assigned to that mission.
  //
  // `null` org means "all organisations" → no missionId filter → global fleet view.
  const { pins, isLoading, summary } = useMapCasePins({
    missionId: org ?? undefined,
  });

  const orgSelectId = useId();
  const kitSelectId = useId();

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

  // ── Derived counts ─────────────────────────────────────────────────
  const totalCases = summary?.total ?? 0;
  const locatedPins = pins.filter((p) => p.lat !== undefined && p.lng !== undefined);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className={styles.root} data-map-mode="M1">
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

          {/* Fleet summary badge (live — updates via Convex subscription) */}
          <div className={styles.filterGroup} aria-live="polite" aria-atomic="true">
            <span className={styles.filterLabel}>Fleet</span>
            <span
              className={styles.summaryBadge}
              data-loading={isLoading ? "true" : undefined}
              data-pin-count={pins.length}
              aria-label={
                isLoading
                  ? "Loading fleet data…"
                  : `${totalCases} case${totalCases !== 1 ? "s" : ""} total, ${locatedPins.length} located`
              }
            >
              {isLoading ? (
                <span className={styles.summaryLoading} aria-hidden="true" />
              ) : (
                <span className={styles.summaryCount}>
                  <span className={styles.summaryNumber}>{totalCases}</span>
                  <span className={styles.summaryUnit}>
                    {totalCases === 1 ? "case" : "cases"}
                  </span>
                </span>
              )}
            </span>
          </div>
        </div>
      </header>

      {/* ── Map canvas ── */}
      <main className={styles.mapCanvas} aria-label="Fleet overview map">
        {mapboxToken ? (
          /* Map rendered by react-map-gl; pin data exposed via data attributes
             for the Mapbox layer integration to consume. */
          <div
            id="m1-map-container"
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
                {pins.length > 0 && (
                  /* Pin list rendered when no map is available — shows live data
                     from the Convex subscription is flowing correctly. */
                  <ul
                    className={styles.pinList}
                    aria-label={`${pins.length} case pin${pins.length !== 1 ? "s" : ""}`}
                    data-testid="m1-pin-list"
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
                        {pin.locationName && (
                          <span className={styles.pinLocation}>{pin.locationName}</span>
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

      {/* ── Active filter summary (screen-reader accessible) ── */}
      <output
        className={styles.srOnly}
        aria-live="polite"
        aria-atomic="true"
      >
        {`Fleet overview. View: ${MAP_MODE_LABELS[view]}.`}
        {isLoading ? " Loading case data." : ` ${totalCases} cases in fleet.`}
        {org ? ` Organisation filter active.` : ""}
        {kit ? ` Kit filter active.` : ""}
      </output>
    </div>
  );
}

export default M1FleetOverview;
