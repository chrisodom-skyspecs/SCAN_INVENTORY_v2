/**
 * M1FleetOverview — Fleet Overview map mode
 *
 * Shows all cases on a world / region map with status-colored CSS pins.
 * URL params wired via useMapParams:
 *   • view  → selecting a different mode tab calls setView(mode)
 *   • org   → org dropdown calls setOrg(id) / setOrg(null)
 *   • kit   → kit dropdown calls setKit(id) / setKit(null)
 *
 * Data source: useCaseMapData (Convex real-time M1 subscription + LayerEngine filter).
 *   Subscribes to api.mapData.getM1MapData with optional missionId filter
 *   (derived from the `org` URL param) via the unified useCaseMapData hook.
 *   The full record set is filtered client-side by the shared LayerEngine state,
 *   so toggling a layer on/off immediately removes or adds its pins without a
 *   new Convex request.
 *
 * Layer filtering:
 *   Records are filtered by the active LayerEngine state:
 *     deployed → status "deployed"
 *     transit  → status "transit_out" or "transit_in"
 *     flagged  → status "flagged"
 *     hangar   → status "hangar", "assembled", "received", "archived"
 *   Each visible pin receives a `data-layer` attribute matching its layer key
 *   so CSS custom property tokens (--layer-{key}-bg etc.) apply the correct
 *   layer-specific visual styling.
 *
 * Design tokens: all colors use var(--layer-*) and var(--surface-*) etc.
 * No hex literals; WCAG AA compliant.
 *
 * Real-time fidelity: useCaseMapData maintains a live Convex subscription that
 * re-evaluates within ~100–300 ms of any SCAN app mutation, satisfying the
 * ≤ 2-second real-time fidelity requirement.
 */

"use client";

import { type ChangeEvent, useId, useMemo, useState, useCallback } from "react";
import { useMapParams } from "@/hooks/use-map-params";
import { useCaseMapData, type CaseMapRecord } from "@/hooks/use-case-map-data";
import { useSharedLayerEngine } from "@/providers/layer-engine-provider";
import { deriveLayerToggles } from "@/hooks/use-filtered-case-pins";
import { getToggleKeyForStatus } from "@/lib/case-status-filter";
import { getMarkerStyle } from "@/lib/marker-style-config";
import { MAP_VIEW_VALUES, type MapView, type LayerToggleKey } from "@/types/map";
import type { CaseStatus } from "@/types/case-status";
import { SEMANTIC_LAYER_IDS } from "@/types/layer-engine";
import { LayerTogglePanelConnected } from "@/components/LayerTogglePanel";
import { useIsDark } from "@/providers/theme-provider";
import { useMapManifestHover } from "@/providers/map-manifest-hover-provider";
import { HistoryTrailLayer } from "./HistoryTrailLayer";
import { TurbineLayer } from "./TurbineLayer";
import styles from "./M1FleetOverview.module.css";

// ─── Mapbox style URLs ────────────────────────────────────────────────────────

/**
 * M1 uses the "streets" base style — shows roads and place names for
 * case location context.  Switches between light and dark variants based
 * on the active theme so the map chrome matches the UI shell.
 */
const MAPBOX_STYLE_LIGHT = "mapbox://styles/mapbox/streets-v12";
const MAPBOX_STYLE_DARK  = "mapbox://styles/mapbox/dark-v11";

// ─── Local types ──────────────────────────────────────────────────────────────

/**
 * A case map record enriched with its semantic layer key and marker style.
 * The `layerKey` governs visibility based on the LayerEngine state and
 * provides the data-layer attribute value for CSS token styling.
 * The `shape` and `icon` fields provide distinct per-status visual styling.
 */
type M1Pin = CaseMapRecord & {
  /** The LayerToggleKey that controls this pin's visibility. null for unknown statuses. */
  layerKey: LayerToggleKey | null;
  /** Pin geometric shape for non-color visual differentiation (WCAG 1.4.1). */
  shape: string;
  /** Pin icon identifier for sprite/SVG lookup. */
  icon: string;
  /** z-index priority for overlapping pins (flagged > deployed > transit > hangar). */
  zPriority: number;
};

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
 * Case pin data comes from useCaseMapData({ mode: "M1" }), which maintains a
 * live Convex subscription to api.mapData.getM1MapData and applies client-side
 * layer filtering from the shared LayerEngine via useSharedLayerEngine.
 * Records update within ~100–300 ms of any SCAN app mutation that changes
 * case status, location, or assignee.
 *
 * Each visible pin receives a `data-layer` attribute so it inherits
 * layer-specific visual styling from the --layer-{key}-* CSS tokens:
 *   deployed → --layer-deployed-bg (green)
 *   transit  → --layer-transit-bg  (blue)
 *   flagged  → --layer-flagged-bg  (orange)
 *   hangar   → --layer-hangar-bg   (indigo)
 *
 * Requires a <LayerEngineProvider> ancestor in the component tree.
 */
export function M1FleetOverview({
  orgs = [],
  kits = [],
  mapboxToken,
}: M1FleetOverviewProps) {
  const { view, org, kit, setView, setOrg, setKit } = useMapParams();

  // ── Dark mode — Mapbox style switching ───────────────────────────────────────
  //
  // useIsDark() reads the ThemeContext (set by ThemeProvider via useTheme()).
  // When isDark is true, we use the Mapbox "dark-v11" style so the map base
  // layer matches the overall dark UI theme.
  // The resolved style URL is passed as a data attribute on the map container
  // so that the react-map-gl integration (or any future consumer) can read the
  // correct style without prop-drilling theme state through unrelated layers.
  const isDark   = useIsDark();
  const mapStyle = isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT;

  // ── Map ↔ Manifest hover binding ─────────────────────────────────────────────
  //
  // Shared hover state between the map pin list and any ManifestPanel rendered
  // alongside this map.  When the user hovers a pin list item, setHoveredCaseId
  // broadcasts the caseId so the ManifestPanel (if it has the same caseId) can
  // highlight itself.  Conversely, when the ManifestPanel sets hoveredCaseId,
  // the pin list item with the matching caseId highlights.
  //
  // Null-safe: returns { hoveredCaseId: null, setHoveredCaseId: noop } when
  // called outside a <MapManifestHoverProvider>.
  const { hoveredCaseId, setHoveredCaseId } = useMapManifestHover();

  // ── Layer panel open/close state ─────────────────────────────────────────────
  //
  // Tracks whether the floating LayerTogglePanelConnected is visible.
  // Ephemeral local state — not serialised to the URL (the layer visibility
  // state IS persisted via the engine, but the panel's open/closed state is not).
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);

  const handleLayerPanelToggle = useCallback(() => {
    setLayerPanelOpen((prev) => !prev);
  }, []);

  const handleLayerPanelClose = useCallback(() => {
    setLayerPanelOpen(false);
  }, []);

  // ── Live M1 Fleet Overview subscription via useCaseMapData ────────────────
  //
  // useCaseMapData({ mode: "M1" }) maintains a live Convex subscription to
  // api.mapData.getM1MapData.  Only the M1 query is active; the other four
  // mode queries (M2–M5) receive the "skip" sentinel and incur no network cost.
  //
  // `org` maps to a Convex mission document ID — the org dropdown selects
  // a mission group, scoping the map to cases on that mission.
  // `null` org means "all organisations" → no missionId filter → global fleet.
  //
  // Convex re-evaluates within ~100–300 ms of any SCAN app mutation that
  // touches the `cases` or `custodyRecords` tables, satisfying the ≤ 2-second
  // real-time fidelity requirement.
  const { records, isLoading, summary } = useCaseMapData({
    mode: "M1",
    missionId: org ?? undefined,
  });

  // ── LayerEngine state — pin visibility filtering ───────────────────────────
  //
  // useSharedLayerEngine reads the nearest LayerEngineProvider via React context.
  // The four case-pin-relevant booleans (deployed, transit, flagged, hangar)
  // control which status-groups are rendered.  Changes are synchronous (same
  // event cycle as the toggle click) so pin visibility updates instantly.
  const { state } = useSharedLayerEngine();

  // ── Active layer count for toolbar badge ─────────────────────────────────────
  //
  // Count the number of layers currently active (visible) in the engine state.
  // Drives the badge on the "Layers" toolbar button so users can see how many
  // of the 7 layers are shown at a glance without opening the panel.
  // Computed from `state` (already subscribed above), so it updates on every
  // engine state change without additional subscriptions.
  const activeLayerCount = SEMANTIC_LAYER_IDS.filter((id) => state[id]).length;

  // Derive a stable LayerToggles snapshot from engine state primitives.
  // useMemo ensures no new object is created unless one of the four relevant
  // layers actually changes.
  const layerToggles = useMemo(
    () => deriveLayerToggles(state.deployed, state.transit, state.flagged, state.hangar),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.deployed, state.transit, state.flagged, state.hangar]
  );

  // Enrich each CaseMapRecord with its semantic layer key, shape, icon, and
  // z-priority.  Runs once per records identity change (i.e., per Convex update).
  // O(1) per pin via the lookup in getToggleKeyForStatus + getMarkerStyle.
  const allPins = useMemo<M1Pin[]>(
    () => records.map((r) => {
      const layerKey = getToggleKeyForStatus(r.status);
      const markerStyle = getMarkerStyle(r.status as CaseStatus);
      return {
        ...r,
        layerKey,
        shape:     markerStyle.shape,
        icon:      markerStyle.icon,
        zPriority: markerStyle.zPriority,
      };
    }),
    [records]
  );

  // Apply layer filter: keep only pins whose layerKey is actively visible.
  // Runs when either allPins or layerToggles changes.  O(n) — safe for
  // per-render use for typical fleet sizes (≤ 5,000 cases).
  //
  // After filtering, pins are sorted by zPriority descending so that
  // higher-priority layers (flagged=100 > deployed=60 > transit=60 > hangar=20)
  // render on top of lower-priority layers in the DOM and in CSS stacking
  // context.  In the Mapbox GL JS path, this order is consumed by the
  // marker source as symbol-sort-key so the map engine also respects z-order.
  const pins = useMemo<M1Pin[]>(
    () => {
      const filtered = allPins.filter((p) => {
        if (p.layerKey === null) return false;
        return layerToggles[p.layerKey];
      });
      // Sort descending by zPriority — highest-priority pins come first.
      // Stable sort (Array.sort in modern engines preserves insertion order
      // for equal priorities) so pins within the same layer keep their
      // original order from the Convex subscription.
      return [...filtered].sort((a, b) => b.zPriority - a.zPriority);
    },
    [allPins, layerToggles]
  );

  const hiddenCount = allPins.length - pins.length;

  const orgSelectId = useId();
  const kitSelectId = useId();

  // ── Handlers ──────────────────────────────────────────────────────────────

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

  // ── Derived counts ────────────────────────────────────────────────────────
  const totalCases  = summary?.total ?? 0;
  const visiblePins = pins.filter((p) => p.lat !== undefined && p.lng !== undefined);

  // ── Render ────────────────────────────────────────────────────────────────

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
              data-hidden-count={hiddenCount}
              aria-label={
                isLoading
                  ? "Loading fleet data…"
                  : hiddenCount > 0
                    ? `${pins.length} of ${allPins.length} cases visible (${hiddenCount} hidden by layer filter)`
                    : `${totalCases} case${totalCases !== 1 ? "s" : ""} total, ${visiblePins.length} located`
              }
            >
              {isLoading ? (
                <span className={styles.summaryLoading} aria-hidden="true" />
              ) : (
                <span className={styles.summaryCount}>
                  <span className={styles.summaryNumber}>{pins.length}</span>
                  <span className={styles.summaryUnit}>
                    {pins.length === 1 ? "case" : "cases"}
                  </span>
                  {hiddenCount > 0 && (
                    <span className={styles.summaryHidden} aria-hidden="true">
                      /{allPins.length}
                    </span>
                  )}
                </span>
              )}
            </span>
          </div>

          {/* Layers toggle button ──────────────────────────────────────────────
              Opens / closes the LayerTogglePanelConnected floating overlay.
              Reads active layer count from engine state to display the badge.
              aria-expanded communicates panel state to screen readers.
              aria-controls references the panel id for ARIA ownership.
          */}
          <div className={styles.filterDivider} aria-hidden="true" />
          <button
            type="button"
            className={[
              styles.layerButton,
              layerPanelOpen ? styles.layerButtonActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={handleLayerPanelToggle}
            aria-expanded={layerPanelOpen}
            aria-controls="m1-layer-panel"
            aria-label={`${layerPanelOpen ? "Close" : "Open"} map layer controls — ${activeLayerCount} of ${SEMANTIC_LAYER_IDS.length} layers visible`}
            data-testid="m1-layers-button"
          >
            {/* CSS stack-of-layers icon — matches LayerTogglePanel header icon */}
            <span className={styles.layerButtonIcon} aria-hidden="true" />
            <span className={styles.layerButtonLabel}>Layers</span>
            {/* Badge: active count / total */}
            <span
              className={[
                styles.layerButtonBadge,
                activeLayerCount < SEMANTIC_LAYER_IDS.length
                  ? styles.layerButtonBadgeFiltered
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-hidden="true"
            >
              {activeLayerCount}/{SEMANTIC_LAYER_IDS.length}
            </span>
          </button>
        </div>
      </header>

      {/* ── Map canvas ── */}
      <main className={styles.mapCanvas} aria-label="Fleet overview map">
        {/* Layer toggle panel overlay — rendered inside mapCanvas so the
            position:absolute panel is scoped to the map area, not the full page.
            The panel reads layer visibility from the shared LayerEngine via
            LayerTogglePanelConnected (which calls useSharedLayerEngine internally).
            onClose hides the panel; the engine state persists so toggled layers
            remain off when the user re-opens the panel. */}
        {layerPanelOpen && (
          <LayerTogglePanelConnected
            id="m1-layer-panel"
            position="top-right"
            onClose={handleLayerPanelClose}
            aria-label="Map layer controls"
          />
        )}

        {mapboxToken ? (
          /* Map rendered by react-map-gl; pin data exposed via data attributes
             for the Mapbox layer integration to consume.
             HistoryTrailLayer with showToggle=true renders an in-map toggle button
             for the history trails overlay. When isActive the component renders
             Mapbox GL Source+Layer pairs as children of the react-map-gl Map. */
          <div
            id="m1-map-container"
            className={styles.mapContainer}
            data-mapbox-token={mapboxToken}
            data-mapbox-style={mapStyle}
            data-theme={isDark ? "dark" : "light"}
            data-pin-count={pins.length}
            data-all-pin-count={allPins.length}
            data-hidden-count={hiddenCount}
            data-loading={isLoading ? "true" : undefined}
          >
            {/* Turbine site markers overlay.
                Reads `state.turbines` from LayerEngine via useTurbineLayer.
                showToggle renders an in-map toggle button at top-right.
                showLegend renders a floating legend at bottom-left.
                The Source+Layer children activate only when the toggle is ON.
                missionId scopes markers to the selected org (mission). */}
            <TurbineLayer
              missionId={org ?? null}
              showToggle={true}
              showLegend={true}
            />

            {/* History trails toggle + overlay.
                Reads `state.history` from LayerEngine via useHistoryTrail.
                showToggle renders an in-map button; showLegend shows the legend.
                The Source+Layer children activate only when the toggle is ON. */}
            <HistoryTrailLayer
              missionId={org ?? null}
              showToggle={true}
              showLegend={true}
            />
          </div>
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
                     from the Convex subscription and layer filtering in action. */
                  <ul
                    className={styles.pinList}
                    aria-label={`${pins.length} case pin${pins.length !== 1 ? "s" : ""} (${allPins.length} total, ${hiddenCount} hidden by layer filter)`}
                    data-testid="m1-pin-list"
                  >
                    {pins.slice(0, 20).map((pin) => (
                      <li
                        key={pin.caseId}
                        className={styles.pinListItem}
                        data-status={pin.status}
                        data-layer={pin.layerKey ?? undefined}
                        data-shape={pin.shape}
                        data-case-id={pin.caseId}
                        data-map-hover={hoveredCaseId === pin.caseId ? "highlighted" : undefined}
                        onMouseEnter={() => setHoveredCaseId(pin.caseId)}
                        onMouseLeave={() => setHoveredCaseId(null)}
                      >
                        {/* Layer-colored dot — gets its background color from
                            --layer-{layerKey}-bg via data-layer attribute styling.
                            data-shape provides non-color shape differentiation
                            (WCAG 1.4.1 Use of Color). */}
                        <span
                          className={styles.pinDot}
                          data-status={pin.status}
                          data-layer={pin.layerKey ?? undefined}
                          data-shape={pin.shape}
                          data-icon={pin.icon}
                          aria-hidden="true"
                          title={pin.status}
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
                {hiddenCount > 0 && (
                  <p className={styles.layerFilterHint}>
                    {hiddenCount} case{hiddenCount !== 1 ? "s" : ""} hidden by layer filter
                  </p>
                )}

                {/* Turbine sites fallback — shows turbine list when no Mapbox token.
                    Reads `state.turbines` from LayerEngine; renders only when ON. */}
                <TurbineLayer
                  missionId={org ?? null}
                  fallbackMode={true}
                  showLegend={false}
                  showToggle={true}
                />

                {/* History trails fallback — shows trail list when no Mapbox token.
                    Reads `state.history` from LayerEngine; renders only when ON. */}
                <HistoryTrailLayer
                  missionId={org ?? null}
                  fallbackMode={true}
                  showLegend={false}
                  showToggle={true}
                />
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
        {isLoading
          ? " Loading case data."
          : ` ${pins.length} of ${allPins.length} cases visible.`}
        {hiddenCount > 0 ? ` ${hiddenCount} cases hidden by layer filter.` : ""}
        {org ? ` Organisation filter active.` : ""}
        {kit ? ` Kit filter active.` : ""}
      </output>
    </div>
  );
}

export default M1FleetOverview;
