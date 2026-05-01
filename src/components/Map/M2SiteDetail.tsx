/**
 * M2SiteDetail — Mission Mode map view
 *
 * Shows cases organised by mission on a map, providing a Mission Mode
 * view for operations staff.  Each case record carries its missionId so
 * the map can render mission-group clusters and individual case pins.
 * URL params wired via useMapParams:
 *   • view  → mode tab click calls setView(mode)
 *   • org   → org dropdown calls setOrg(id) / setOrg(null)  (maps to missionId filter)
 *   • kit   → kit dropdown calls setKit(id) / setKit(null)
 *   • at    → time picker calls setAt(date) / setAt(null)
 *
 * The `at` param enables time-scrubbing: navigating back to a past
 * timestamp shows a historical snapshot of mission activity.
 *
 * Data source: useCaseMapData({ mode: "M2" }) — Convex real-time M2 subscription.
 *   Subscribes to api.mapData.getM2MapData, which returns cases grouped by
 *   mission (flattened to a CaseMapRecord[] for map rendering).  Each record
 *   includes the missionId, custody state, and all core case fields.
 *
 *   Reactive to:
 *     • scan.scanCheckIn       → case status changes in mission groups
 *     • Any mission mutation   → mission metadata, re-grouping of cases
 *     • custody.transferCustody → custodian info on per-mission case pins
 *   Convex re-evaluates within ~100–300 ms, satisfying the ≤ 2-second real-time
 *   fidelity requirement.
 *
 * Stop data integration (Sub-AC 3)
 * ──────────────────────────────────
 * When the user selects a case pin (in fallback mode: click; in Mapbox mode:
 * the map dispatches a case selection event), the component subscribes to the
 * case's journey stops via useM2JourneyStops and passes the stop data to:
 *
 *   • JourneyPathLine  — path line renderer connecting geo-referenced stops.
 *                        Receives a PathStop[] derived from the selected journey.
 *   • StopMarker       — numbered circle badge overlays at each geo stop.
 *                        Receives individual stop props from the selected journey.
 *   • JourneyStopLayer — fallback HTML list (no-map mode), renders stop timeline
 *                        when fallbackMode=true for the selected caseId.
 *
 * Real-time fidelity:
 *   useM2JourneyStops subscribes to api["queries/journeyStops"].getM2JourneyStops
 *   after a case is selected. When a SCAN mutation appends a new event, Convex
 *   re-evaluates that selected-case subscription within ~100–300 ms.
 *
 * Design tokens: all colors via var(--map-m2-*) and var(--surface-*).
 * No hex literals; WCAG AA compliant.
 */

"use client";

import { type ChangeEvent, useId, useState, useMemo, useCallback } from "react";
import { useMapParams } from "@/hooks/use-map-params";
import { useCaseMapData } from "@/hooks/use-case-map-data";
import { useM2JourneyStops } from "@/hooks/use-m2-journey-stops";
import { MAP_VIEW_VALUES, type MapView } from "@/types/map";
import { useIsDark } from "@/providers/theme-provider";
import { JourneyStopLayer } from "./JourneyStopLayer";
import { ReplayScrubber } from "./ReplayScrubber";
import { M2StopSidebar } from "./M2StopSidebar";
import { JourneyPathLine } from "./JourneyPathLine";
import { StopMarker } from "./StopMarker";
import { InventoryMapCanvas } from "./InventoryMapCanvas";
import { InventoryCaseMarkers } from "./InventoryCaseMarkers";
import styles from "./M2SiteDetail.module.css";

// ─── Mapbox style URLs ────────────────────────────────────────────────────────

/**
 * M2 uses the "outdoors" base style — shows terrain and topography suitable
 * for activity-density heat overlays.  Switches between light and dark variants
 * based on the active theme so the map chrome matches the UI shell.
 */
const MAPBOX_STYLE_LIGHT = "mapbox://styles/mapbox/outdoors-v12";
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
  // Use local time offset so the picker shows the user's local time
  const pad = (n: number) => String(n).padStart(2, "0");
  const year  = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day   = pad(date.getDate());
  const hours = pad(date.getHours());
  const mins  = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

/**
 * Parse a datetime-local input string to a Date in UTC.
 * Returns null for empty / invalid values.
 */
function parseDatetimeLocal(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface M2SiteDetailProps {
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
 * M2 — Mission Mode
 *
 * Renders a mission-mode map panel with filter + time controls.
 * Subscribes to live case data via useCaseMapData({ mode: "M2" }) which
 * queries api.mapData.getM2MapData — cases grouped by mission and flattened
 * to a CaseMapRecord array for map rendering.
 *
 * Stop data integration:
 *   useM2JourneyStops subscribes to journey stops only for the selected case.
 *   When a case pin is selected (selectedCaseId), the component derives:
 *     • pathStops  → passed to JourneyPathLine (path line renderer)
 *     • geoStops   → each stop passed to StopMarker (marker components)
 *   In fallback mode (no mapboxToken), the selected case's journey timeline is
 *   rendered via JourneyStopLayer with fallbackMode=true.
 *
 * All filter changes write to the URL via useMapParams.
 */
export function M2SiteDetail({
  orgs = [],
  kits = [],
  mapboxToken,
  minAt,
  maxAt,
}: M2SiteDetailProps) {
  const { view, org, kit, at, setView, setOrg, setKit, setAt } = useMapParams();

  // ── Dark mode — Mapbox style switching ───────────────────────────────────────
  //
  // useIsDark() reads the ThemeContext.  When isDark is true, the "dark-v11"
  // Mapbox style is used so heat overlays render against a dark base map that
  // matches the overall dark UI theme.
  const isDark   = useIsDark();
  const mapStyle = isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT;

  // ── Live M2 Mission Mode subscription via useCaseMapData ──────────
  //
  // useCaseMapData({ mode: "M2" }) subscribes to api.mapData.getM2MapData,
  // returning all cases grouped by mission and flattened into CaseMapRecord[].
  // Each record includes missionId, custody state, and all core case fields.
  //
  // `org` maps to a Convex mission document ID for per-mission scoping:
  //   • non-null org → filters to cases for that specific mission
  //   • null org     → all missions + unassigned cases (global fleet view)
  //
  // Convex re-evaluates within ~100–300 ms when:
  //   • scan.scanCheckIn transitions a case to in_field / deployed
  //   • Any mission mutation updates mission metadata or re-groups cases
  //   • custody.transferCustody updates the custodian on a mission case
  const { records: pins, isLoading, summary } = useCaseMapData({
    mode: "M2",
    missionId: org ?? undefined,
  });

  // ── Selected case + stop state ──────────────────────────────────────────────
  //
  // selectedCaseId — which case pin the user has clicked to view journey stops.
  //   null = no case selected (no journey overlay shown).
  //   Set via handlePinClick in the fallback pin list, or via the data attribute
  //   on the map container in Mapbox mode (external integrations can write to it).
  //
  // selectedStopIndex — which stop badge in the selected journey is highlighted.
  //   null = no stop selected (all stops shown without selection ring).
  //   Set via handleStopClick when the user clicks a StopMarker badge.
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedStopIndex, setSelectedStopIndex] = useState<number | null>(null);

  // ── Selected journey stop subscription ─────────────────────────────────────
  //
  // Subscribe only after a case is selected. Keeping this out of the initial M2
  // render avoids a broad events-table subscription for every visible case.
  const selectedJourney = useM2JourneyStops(selectedCaseId);

  // ── Total stop count for the selected case ──────────────────────────────────
  const selectedStopCount = selectedJourney?.stopCount ?? 0;

  const allGeoStops = selectedJourney?.stops.filter((stop) => stop.hasCoordinates) ?? [];
  const geoStops =
    selectedStopIndex === null
      ? allGeoStops
      : allGeoStops.filter((stop) => stop.stopIndex <= selectedStopIndex);
  const pathStops = geoStops.map((stop) => ({
    stopIndex: stop.stopIndex,
    lat: stop.location.lat!,
    lng: stop.location.lng!,
  }));

  // ── Handlers ──────────────────────────────────────────────────────
  //
  // handlePinClick: called when a case pin is clicked in the fallback list.
  //   Toggles selection — clicking the already-selected case deselects it.
  //   Clears selectedStopIndex when switching to a new case.
  const handlePinClick = useCallback((caseId: string) => {
    setSelectedCaseId((prev) => (prev === caseId ? null : caseId));
    setSelectedStopIndex(null);
  }, []);

  // handleStopClick: called when a StopMarker badge is clicked.
  //   Toggles selection — clicking the already-selected stop deselects it.
  const handleStopClick = useCallback((stopIndex: number) => {
    setSelectedStopIndex((prev) => (prev === stopIndex ? null : stopIndex));
  }, []);

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

  // ── Derived counts ─────────────────────────────────────────────────
  //
  // M2 records are cases from mission groups + unassigned cases.
  // summary.byStatus for M2 contains mission statuses (e.g., "active",
  // "completed"), not case lifecycle statuses.  We compute deployed/flagged
  // counts directly from the records array for the active deployments badge.
  const deployedCount = pins.filter((p) => p.status === "deployed").length;
  const flaggedCount  = pins.filter((p) => p.status === "flagged").length;
  const activeTotal   = deployedCount + flaggedCount;

  // IDs for form elements
  const orgSelectId  = useId();
  const kitSelectId  = useId();
  const timePickerId = useId();

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className={styles.root} data-map-mode="M2">
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

          {/* Time picker (at) */}
          <div className={styles.filterGroup}>
            <label htmlFor={timePickerId} className={styles.filterLabel}>
              Time snapshot
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
                aria-label="Snapshot timestamp — view historical activity density"
              />
              {at !== null && (
                <button
                  type="button"
                  className={styles.clearAtButton}
                  onClick={handleClearAt}
                  aria-label="Clear time snapshot — return to live view"
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

          {/* Active deployment summary badge (live — updates via Convex) */}
          <div className={styles.filterGroup} aria-live="polite" aria-atomic="true">
            <span className={styles.filterLabel}>Active</span>
            <span
              className={styles.summaryBadge}
              data-loading={isLoading ? "true" : undefined}
              data-pin-count={pins.length}
              aria-label={
                isLoading
                  ? "Loading deployment data…"
                  : `${activeTotal} active deployment${activeTotal !== 1 ? "s" : ""} (${deployedCount} deployed, ${flaggedCount} flagged)`
              }
            >
              {isLoading ? (
                <span className={styles.summaryLoading} aria-hidden="true" />
              ) : (
                <span className={styles.summaryCount}>
                  <span className={styles.summaryNumber}>{activeTotal}</span>
                  <span className={styles.summaryUnit}>
                    {activeTotal === 1 ? "active" : "active"}
                  </span>
                </span>
              )}
            </span>
          </div>
        </div>
      </header>

      {/* ── Replay scrubber bar ── */}
      {/*
       * ReplayScrubber renders play/pause, step-forward, step-back, speed
       * selector (0.5×/1×/2×/4×), and a range slider.
       *
       * The `at` URL param drives the timeline position:
       *   • at = null   → live mode (no time filter, showing current state)
       *   • at = Date   → snapshot / replay mode (historical activity density)
       *
       * onAtChange is wired to useMapParams.setAt so position changes are
       * reflected in the URL (deep-link safe, back-navigation safe).
       *
       * minAt / maxAt from the component props clamp step + slider range.
       * When not provided, the slider is disabled (no range to navigate).
       */}
      <ReplayScrubber
        at={at}
        minAt={minAt}
        maxAt={maxAt}
        onAtChange={setAt}
        className={styles.scrubberBar}
      />

      {/* ── Map canvas ── */}
      <main className={styles.mapCanvas} aria-label="Mission mode map">
        {mapboxToken ? (
          <>
            <div
              id="m2-map-container"
              className={styles.mapContainer}
              data-mapbox-token={mapboxToken}
              data-mapbox-style={mapStyle}
              data-theme={isDark ? "dark" : "light"}
              data-pin-count={pins.length}
              data-loading={isLoading ? "true" : undefined}
              data-selected-case={selectedCaseId ?? undefined}
              data-stop-count={selectedStopCount}
              data-selected-journey-loaded={selectedJourney ? "true" : undefined}
              data-active-stop-index={
                selectedStopIndex !== null
                  ? String(selectedStopIndex)
                  : undefined
              }
            >
              <InventoryMapCanvas
                mapboxToken={mapboxToken}
                mapStyle={mapStyle}
                aria-label="Mission mode map"
                showEmptyMessage={!isLoading && pins.length === 0}
                emptyMessage="No mission case locations to display yet."
              >
                <InventoryCaseMarkers
                  records={pins}
                  selectedCaseId={selectedCaseId}
                  onSelectCase={handlePinClick}
                  getMeta={(pin) => pin.assigneeName ?? pin.locationName ?? pin.status}
                />
                <JourneyPathLine
                  stops={pathStops}
                  sourceId="m2-journey-path-source"
                  layerId="m2-journey-path-layer"
                />
                {geoStops.map((stop, index) => (
                  <StopMarker
                    key={stop.eventId}
                    stopIndex={stop.stopIndex}
                    longitude={stop.location.lng!}
                    latitude={stop.location.lat!}
                    isFirst={index === 0}
                    isLast={index === geoStops.length - 1}
                    isSelected={selectedStopIndex === stop.stopIndex}
                    eventType={stop.eventType}
                    locationName={stop.location.locationName}
                    actorName={stop.actorName}
                    onClick={handleStopClick}
                  />
                ))}
              </InventoryMapCanvas>
            </div>

            {/*
             * M2StopSidebar — StopCard list overlay (Sub-AC 2)
             *
             * Rendered as an absolute-positioned overlay on the right side of
             * the map canvas when a case is selected (selectedJourney != null).
             *
             * Data flow:
             *   selectedJourney.stops → all stops to display as StopCards
             *   at (URL param)        → replay cursor → active stop highlight
             *   selectedStopIndex     → explicit stop selection (aria-pressed)
             *   handleStopClick       → updates selectedStopIndex → map filters
             *   setSelectedCaseId(null) → dismissed via × close button
             *
             * The sidebar uses position:absolute within .mapCanvas
             * (position:relative; overflow:hidden), anchored to the right edge.
             * On narrow screens it becomes a bottom drawer (see M2StopSidebar.module.css).
             *
             * Real-time fidelity:
             *   selectedJourney updates via Convex WebSocket subscription within
             *   ~100–300 ms when SCAN mutations append new events, satisfying
             *   the ≤ 2-second real-time fidelity requirement for the selected case.
             */}
            {selectedJourney != null && (
              <M2StopSidebar
                stops={selectedJourney.stops}
                caseLabel={selectedJourney.caseLabel}
                stopCount={selectedJourney.stopCount}
                at={at}
                selectedStopIndex={selectedStopIndex}
                onStopClick={handleStopClick}
                onClose={() => setSelectedCaseId(null)}
                className={styles.stopSidebar}
                data-testid="m2-stop-sidebar"
              />
            )}
          </>
        ) : (
          /*
           * Fallback — no Mapbox token
           *
           * Renders an accessible HTML interface showing live data from the
           * Convex subscriptions without a map background.
           *
           * Pin list items are interactive buttons:
           *   • Click (or Enter/Space keydown) → toggles selectedCaseId
           *   • aria-pressed reflects current selection state
           *   • Selected item highlighted via styles.pinListItemSelected
           *
           * When a case is selected, the journey timeline is rendered below
           * the pin list via JourneyStopLayer in fallbackMode=true.
           * The JourneyStopLayer fallback renders an accessible ordered list of
           * journey stops with event type, timestamp, actor, and location.
           */
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
                  /*
                   * Mission case list — live data from useCaseMapData M2 subscription.
                   * Each item is keyboard-accessible and clickable for journey selection.
                   * aria-pressed communicates selection state to screen readers.
                   */
                  <ul
                    className={styles.pinList}
                    aria-label={`${pins.length} case${pins.length !== 1 ? "s" : ""} across missions`}
                    data-testid="m2-pin-list"
                  >
                    {pins.slice(0, 20).map((pin) => (
                      <li
                        key={pin.caseId}
                        className={[
                          styles.pinListItem,
                          pin.caseId === selectedCaseId
                            ? styles.pinListItemSelected
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        data-status={pin.status}
                        data-case-id={pin.caseId}
                        data-selected={
                          pin.caseId === selectedCaseId ? "true" : undefined
                        }
                        role="button"
                        tabIndex={0}
                        aria-pressed={pin.caseId === selectedCaseId}
                        aria-label={`${pin.label} — ${pin.status}${
                          pin.caseId === selectedCaseId
                            ? " (selected — showing journey)"
                            : ""
                        }`}
                        onClick={() => handlePinClick(pin.caseId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handlePinClick(pin.caseId);
                          }
                        }}
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
                        {/* Journey stop count badge — loaded only for the selected case */}
                        {pin.caseId === selectedCaseId &&
                          selectedJourney &&
                          selectedJourney.stopCount > 0 ? (
                            <span
                              className={styles.pinStopCount}
                              aria-label={`${selectedJourney.stopCount} journey stop${selectedJourney.stopCount !== 1 ? "s" : ""}`}
                              title={`${selectedJourney.stopCount} journey stop${selectedJourney.stopCount !== 1 ? "s" : ""}`}
                            >
                              {selectedJourney.stopCount}
                            </span>
                          ) : null}
                      </li>
                    ))}
                    {pins.length > 20 && (
                      <li className={styles.pinListMore}>
                        +{pins.length - 20} more
                      </li>
                    )}
                  </ul>
                )}

                {/*
                 * Journey stop timeline — rendered below the pin list when a
                 * case is selected.
                 *
                 * JourneyStopLayer in fallbackMode=true renders an accessible
                 * ordered list of journey stops with:
                 *   • Stop index badge
                 *   • Event type label (e.g. "Status Change")
                 *   • Timestamp + actor name
                 *   • Location name or coordinates
                 *
                 * The caseId prop establishes a Convex subscription via
                 * useJourneyStopLayer → useM2JourneyStops, providing real-time
                 * updates as new stops are appended.
                 *
                 * showLegend=false — legend is omitted in fallback mode since
                 * the color legend describes map symbols that are not visible.
                 */}
                {selectedCaseId && (
                  <div
                    className={styles.journeyPanel}
                    data-testid="m2-journey-panel"
                  >
                    <JourneyStopLayer
                      caseId={selectedCaseId}
                      fallbackMode
                      showLegend={false}
                    />
                  </div>
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
        {`Mission mode. View: ${MAP_MODE_LABELS[view]}.`}
        {isLoading
          ? " Loading mission data."
          : ` ${pins.length} case${pins.length !== 1 ? "s" : ""} across missions (${activeTotal} actively deployed or flagged).`}
        {org ? ` Organisation filter active.` : ""}
        {kit ? ` Kit filter active.` : ""}
        {at ? ` Showing snapshot at ${at.toLocaleString()}.` : " Live view."}
        {selectedCaseId
          ? ` Case journey selected: ${selectedStopCount} stop${selectedStopCount !== 1 ? "s" : ""}.`
          : ""}
      </output>
    </div>
  );
}

export default M2SiteDetail;
