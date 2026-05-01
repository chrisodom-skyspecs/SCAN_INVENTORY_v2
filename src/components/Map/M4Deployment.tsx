/**
 * M4Deployment — Logistics / Shipment Tracking map mode
 *
 * Shows cases actively in transit with live FedEx tracking positions.
 * URL params wired via useMapParams:
 *   • view  → mode tab click calls setView(mode)
 *   • org   → org dropdown calls setOrg(id) / setOrg(null)
 *   • kit   → kit dropdown calls setKit(id) / setKit(null)
 *   • at    → time picker calls setAt(date) / setAt(null)
 *
 * The `at` param enables historical snapshot: viewing which cases were
 * in transit at a given point in time.
 *
 * Data source: useCaseMapData({ mode: "M4" }) — Convex real-time M4 subscription.
 *   Subscribes to api.mapData.getM4MapData, which returns active shipment pins
 *   with live FedEx tracking positions (currentLat/Lng), carrier info, origin /
 *   destination, and estimated delivery dates.
 *
 *   Reactive to:
 *     • scan.shipCase       → creates a new shipment, transitions case to transit_out
 *     • FedEx webhook       → updates currentLat/Lng for in-transit shipments
 *   Convex re-evaluates within ~100–300 ms, satisfying the ≤ 2-second real-time
 *   fidelity requirement.
 *
 * Layout — split-pane body:
 *   Below the toolbar the component renders a horizontal split:
 *     • LEFT  (.mapPane)      — the Mapbox canvas / shipment pin list.
 *     • RIGHT (.manifestPane) — reserved slot for the case manifest.
 *                               Accepts any React node via the `manifestPanel`
 *                               prop; shows an empty-state prompt when no case
 *                               is selected.
 *   On narrow viewports (≤ 768 px) the panes stack vertically so the manifest
 *   content remains accessible without horizontal scrolling.
 *
 * Design tokens: all colors via var(--map-m4-*) and var(--surface-*).
 * No hex literals; WCAG AA compliant.
 */

"use client";

import { type ChangeEvent, useId, type ReactNode } from "react";
import { useMapParams } from "@/hooks/use-map-params";
import { useCaseMapData } from "@/hooks/use-case-map-data";
import { MAP_VIEW_VALUES, type MapView } from "@/types/map";
import { useIsDark } from "@/providers/theme-provider";
import { useMapManifestHover } from "@/providers/map-manifest-hover-provider";
import { InventoryMapCanvas } from "./InventoryMapCanvas";
import { InventoryCaseMarkers } from "./InventoryCaseMarkers";
import styles from "./M4Deployment.module.css";

// ─── Mapbox style URLs ────────────────────────────────────────────────────────

/**
 * M4 uses the "outdoors" base style — terrain context is useful for
 * visualising deployment staging areas and field zones.  Switches between
 * light and dark variants based on the active theme.
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
  /**
   * Content to render in the right-hand manifest panel slot.
   *
   * Typically a T2Manifest or CaseDetailPanel instance for the currently
   * selected shipment case.  When omitted (no case selected), the panel
   * shows a neutral empty-state prompt.
   *
   * The slot is **always** rendered — the split-pane layout is fixed
   * regardless of whether a case is selected.  This distinguishes M4 from
   * other modes (M1–M3, M5) where the detail panel only appears on selection.
   */
  manifestPanel?: ReactNode;
}

// ─── Manifest panel empty state ───────────────────────────────────────────────

/**
 * Shown in the manifest pane when no case is selected (manifestPanel is absent).
 * Uses only design tokens — no hex literals.
 */
function ManifestPanelEmpty() {
  return (
    <div
      className={styles.manifestEmpty}
      data-manifest-empty="true"
      role="status"
      aria-label="No case selected — select a shipment to view its manifest"
    >
      <span className={styles.manifestEmptyIcon} aria-hidden="true">⬚</span>
      <p className={styles.manifestEmptyTitle}>No shipment selected</p>
      <p className={styles.manifestEmptyHint}>
        Select a shipment on the map to view its packing manifest.
      </p>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * M4 — Logistics / Shipment Tracking
 *
 * Renders a logistics map panel with filter + time controls, plus a
 * permanently visible manifest panel on the right-hand side.
 *
 * Layout (split-pane body below the toolbar):
 *   LEFT  — Mapbox canvas with live FedEx shipment pin layer.
 *   RIGHT — Manifest panel slot (`manifestPanel` prop).  Shows an empty-state
 *           prompt when no case is selected.
 *
 * Subscribes to live shipment pin data via useCaseMapData({ mode: "M4" }),
 * which queries api.mapData.getM4MapData — active shipments with live FedEx
 * tracking positions, origin/destination, and estimated delivery dates.
 * All filter changes write to the URL via useMapParams.
 */
export function M4Deployment({
  orgs = [],
  kits = [],
  mapboxToken,
  minAt,
  maxAt,
  manifestPanel,
}: M4DeploymentProps) {
  const { view, org, kit, at, setView, setOrg, setKit, setAt } = useMapParams();

  // ── Map ↔ Manifest hover binding ────────────────────────────────────────────
  //
  // M4 is a split-pane layout: map pins on the left, manifest panel on the right.
  // Hovering a pin sets hoveredCaseId so the manifest panel (if showing the same
  // case) can highlight itself.  Hovering the manifest panel sets hoveredCaseId
  // so the corresponding pin on the left highlights.
  //
  // Null-safe: returns { hoveredCaseId: null, setHoveredCaseId: noop } when
  // called outside a <MapManifestHoverProvider>.
  const { hoveredCaseId, setHoveredCaseId } = useMapManifestHover();

  // ── Dark mode — Mapbox style switching ────────────────────────────────────────
  //
  // useIsDark() reads the ThemeContext.  In dark mode the "dark-v11" Mapbox
  // style is used so deployment zone polygons and field markers stand out
  // against the dark base map — matching the overall dark UI theme.
  const isDark   = useIsDark();
  const mapStyle = isDark ? MAPBOX_STYLE_DARK : MAPBOX_STYLE_LIGHT;

  // ── Live M4 Logistics Mode subscription via useCaseMapData ────────
  //
  // useCaseMapData({ mode: "M4" }) subscribes to api.mapData.getM4MapData,
  // returning active shipment pins with:
  //   • currentLat/Lng  — live FedEx tracking position
  //   • destination     — delivery destination coordinates and name
  //   • trackingNumber  — FedEx tracking number for each shipment
  //   • carrier         — carrier name (e.g. "fedex")
  //   • estimatedDelivery — carrier-provided estimated delivery date
  //   • shippedAt       — epoch ms when the case was handed to the carrier
  //   • status          — shipment tracking status (in_transit, delivered, etc.)
  //
  // summary.inTransit gives the count of shipments actively in-transit.
  //
  // Convex re-evaluates within ~100–300 ms when:
  //   • scan.shipCase creates a new shipment record
  //   • A FedEx webhook updates currentLat/Lng on an in-transit shipment
  const { records: pins, isLoading, summary } = useCaseMapData({
    mode: "M4",
  });

  const orgSelectId  = useId();
  const kitSelectId  = useId();
  const timePickerId = useId();

  // ── Derived counts ─────────────────────────────────────────────────
  //
  // M4 summary.inTransit contains the count of shipments with status
  // "in_transit" or "out_for_delivery" — the primary metric for this view.
  // summary.total covers all active shipments regardless of status.
  const inTransitCount = summary?.inTransit ?? 0;
  const totalShipments = summary?.total ?? pins.length;

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

          {/* Shipment summary badge (live — updates via useCaseMapData M4 subscription) */}
          <div className={styles.filterGroup} aria-live="polite" aria-atomic="true">
            <span className={styles.filterLabel}>In transit</span>
            <span
              className={styles.summaryBadge}
              data-loading={isLoading ? "true" : undefined}
              data-pin-count={pins.length}
              aria-label={
                isLoading
                  ? "Loading shipment data…"
                  : `${inTransitCount} shipment${inTransitCount !== 1 ? "s" : ""} in transit (${totalShipments} total)`
              }
            >
              {isLoading ? (
                <span className={styles.summaryLoading} aria-hidden="true" />
              ) : (
                <span className={styles.summaryCount}>
                  <span className={styles.summaryNumber}>{inTransitCount}</span>
                  <span className={styles.summaryUnit}>
                    {inTransitCount === 1 ? "transit" : "transit"}
                  </span>
                </span>
              )}
            </span>
          </div>
        </div>
      </header>

      {/* ── Split-pane body ── */}
      {/*
        Horizontal split: map pane (left) + manifest panel (right).
        The manifest pane is always rendered — its content is driven by the
        `manifestPanel` prop, falling back to an empty-state prompt when absent.
        On viewports ≤ 768 px the panes stack vertically (map on top).
      */}
      <div
        className={styles.splitBody}
        data-m4-split="true"
      >
        {/* ── Left pane: map canvas ── */}
        <main
          className={styles.mapPane}
          aria-label="Logistics shipment map"
          data-m4-map-pane="true"
        >
          {mapboxToken ? (
            <div
              id="m4-map-container"
              className={styles.mapContainer}
              data-mapbox-token={mapboxToken}
              data-mapbox-style={mapStyle}
              data-theme={isDark ? "dark" : "light"}
              data-pin-count={pins.length}
              data-in-transit-count={inTransitCount}
              data-loading={isLoading ? "true" : undefined}
            >
              <InventoryMapCanvas
                mapboxToken={mapboxToken}
                mapStyle={mapStyle}
                aria-label="Logistics shipment map"
                showEmptyMessage={!isLoading && pins.length === 0}
                emptyMessage="No shipment locations to display yet."
              >
                <InventoryCaseMarkers
                  records={pins}
                  hoveredCaseId={hoveredCaseId}
                  onHoverCase={setHoveredCaseId}
                  getMeta={(pin) =>
                    pin.trackingNumber ?? pin.locationName ?? pin.status
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
                  Loading shipment data…
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
                    /* Shipment list — live data from useCaseMapData M4 subscription.
                       Each record carries FedEx tracking fields for tooltip rendering. */
                    <ul
                      className={styles.pinList}
                      aria-label={`${pins.length} shipment${pins.length !== 1 ? "s" : ""} in transit`}
                      data-testid="m4-pin-list"
                    >
                      {pins.slice(0, 20).map((pin) => (
                        <li
                          key={pin.caseId}
                          className={styles.pinListItem}
                          data-status={pin.status}
                          data-case-id={pin.caseId}
                          data-tracking-number={pin.trackingNumber}
                          data-map-hover={hoveredCaseId === pin.caseId ? "highlighted" : undefined}
                          onMouseEnter={() => setHoveredCaseId(pin.caseId)}
                          onMouseLeave={() => setHoveredCaseId(null)}
                        >
                          <span
                            className={styles.pinDot}
                            data-status={pin.status}
                            aria-hidden="true"
                          />
                          <span className={styles.pinLabel}>{pin.label}</span>
                          <span className={styles.pinStatus}>{pin.status}</span>
                          {pin.trackingNumber && (
                            <span className={styles.pinAssignee}>
                              {pin.trackingNumber}
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

        {/* ── Right pane: manifest panel slot ── */}
        {/*
          This pane is always rendered. When `manifestPanel` is provided
          (a case has been selected by the parent), its content fills the slot.
          When absent, ManifestPanelEmpty renders a neutral placeholder.

          The parent (InventoryMapClient) is responsible for selecting which
          case's manifest to show and passing the appropriate T2Manifest /
          CaseDetailPanel node here via the `manifestPanel` prop.

          aria-label communicates the pane purpose to assistive technology.
          data-m4-manifest-pane is the testable hook for component tests.
          data-has-content reflects whether a manifest is currently displayed.
        */}
        <aside
          className={styles.manifestPane}
          aria-label="Case manifest panel"
          data-m4-manifest-pane="true"
          data-has-content={manifestPanel != null ? "true" : "false"}
        >
          {manifestPanel != null ? manifestPanel : <ManifestPanelEmpty />}
        </aside>
      </div>

      {/* ── Active state summary (screen-reader) ── */}
      <output
        className={styles.srOnly}
        aria-live="polite"
        aria-atomic="true"
      >
        {`Logistics. View: ${MAP_MODE_LABELS[view]}.`}
        {isLoading
          ? " Loading shipment data."
          : ` ${inTransitCount} shipment${inTransitCount !== 1 ? "s" : ""} in transit (${totalShipments} total).`}
        {org ? ` Organisation filter active.` : ""}
        {kit ? ` Kit filter active.` : ""}
        {at ? ` Showing snapshot at ${at.toLocaleString()}.` : " Live view."}
      </output>
    </div>
  );
}

export default M4Deployment;
