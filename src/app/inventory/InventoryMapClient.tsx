/**
 * InventoryMapClient — client component that renders the active map mode
 * and the case detail panel.
 *
 * Reads the active `view` param from useMapParams (URL) and renders the
 * matching map mode component.  As the user switches modes via the toolbar
 * tabs inside each component, useMapParams updates the URL and this
 * component re-renders with the new view.
 *
 * Case detail panel wiring:
 *   The case detail panel is visible when `activeCaseId` is non-null (i.e.,
 *   a case is selected in the URL via the `case` param).  The panel's open
 *   state and the selected case ID are both derived exclusively from the URL
 *   via useMapParams — no local state is used for either.
 *
 *   The active T-layout (T1–T5) inside the panel is driven by the `window`
 *   URL param, read as `caseWindow` from useMapParams.  Switching tabs calls
 *   `setCaseWindow(tab)` which updates the URL.
 *
 *   Closing the panel calls `setActiveCaseId(null)` which removes the `case`
 *   param from the URL.
 *
 * Data wiring:
 *   orgs   → useMissions() — each mission is an operational deployment group;
 *             the "org" URL param filters cases by missionId on the map.
 *   kits   → useCaseTemplates() — case templates define kit types (packing
 *             lists); the "kit" URL param filters cases by templateId.
 *
 * Both subscriptions are reactive Convex queries that push updates within
 * ~100–300 ms of any server-side change, satisfying the ≤ 2-second
 * real-time fidelity requirement between the SCAN app and the dashboard.
 *
 * Map mode registry:
 *   M1 → M1FleetOverview   (wired — Convex data via hooks)
 *   M2 → M2SiteDetail      (wired — Convex data via hooks)
 *   M3 → M3TransitTracker  (wired — Convex data via hooks)
 *   M4 → M4Deployment      (wired — Convex data via hooks)
 *   M5 → M5MissionControl   (wired — useMapParams: view, org, kit, at)
 *                             Gated behind FF_MAP_MISSION feature flag.
 */

"use client";

import { useCallback, useEffect, useRef } from "react";
import { M1FleetOverview } from "@/components/Map/M1FleetOverview";
import { M2SiteDetail } from "@/components/Map/M2SiteDetail";
import { M3TransitTracker } from "@/components/Map/M3TransitTracker";
import { M4Deployment } from "@/components/Map/M4Deployment";
import { M5MissionControl } from "@/components/Map/M5MissionControl";
import { CaseDetailPanel } from "@/components/CaseDetail";
import { useMapParams } from "@/hooks/use-map-params";
import { useMissions } from "@/hooks/use-missions";
import { useCaseTemplates } from "@/hooks/use-case-templates";
import { useKindeUser } from "@/hooks/use-kinde-user";
import { useDefaultLayoutOnCaseChange } from "@/hooks/use-default-layout-on-case-change";
import { LayerEngineProvider } from "@/providers/layer-engine-provider";
import { MapManifestHoverProvider } from "@/providers/map-manifest-hover-provider";
import { trackEvent } from "@/lib/telemetry.lib";
import { TelemetryEventName } from "@/types/telemetry.types";
import type { LayerId, MapUrlState, MapView } from "@/types/map";
import { MAP_URL_STATE_DEFAULTS } from "@/types/map";
import styles from "./InventoryMapClient.module.css";

// ─── Feature flags ────────────────────────────────────────────────────────────

/**
 * FF_MAP_MISSION — gates the M5 Mission Control map mode.
 *
 * Set NEXT_PUBLIC_FF_MAP_MISSION=1 in your environment to enable.
 * When disabled, navigating to ?view=M5 shows a locked placeholder stub
 * rather than the full M5MissionControl component.
 */
const FF_MAP_MISSION =
  process.env.NEXT_PUBLIC_FF_MAP_MISSION === "1" ||
  process.env.NEXT_PUBLIC_FF_MAP_MISSION === "true";

/**
 * FF_AUDIT_HASH_CHAIN — gates the T5 Audit tab in the case detail panel.
 *
 * Set NEXT_PUBLIC_FF_AUDIT_HASH_CHAIN=1 in your environment to enable.
 * When disabled, the T5 tab is visible but disabled with a neutral badge.
 */
const FF_AUDIT_HASH_CHAIN =
  process.env.NEXT_PUBLIC_FF_AUDIT_HASH_CHAIN === "1" ||
  process.env.NEXT_PUBLIC_FF_AUDIT_HASH_CHAIN === "true";

// ─── Props ────────────────────────────────────────────────────────────────────

interface InventoryMapClientProps {
  /**
   * Full MapUrlState decoded server-side from URL search params by the codec
   * (sanitizeMapDeepLink).
   *
   * Passed from the Server Component (page.tsx) so that all 8 URL params are
   * available to initialize map state on the client's very first render —
   * before useSearchParams() is called and before React hydration completes.
   *
   * Every field falls back to MAP_URL_STATE_DEFAULTS when the corresponding
   * URL param is absent or invalid (sanitized by the codec before arriving here).
   *
   * After hydration, useMapParams() provides the live/reactive URL state and
   * takes over as the authoritative source; initialState is used only for the
   * pre-hydration initial render.
   */
  initialState?: MapUrlState;
}

// ─── M5 locked stub ───────────────────────────────────────────────────────────

/**
 * Shown when FF_MAP_MISSION is disabled and the user navigates to ?view=M5.
 * Uses only design tokens — no hex literals.
 */
function M5LockedStub() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-sunken)",
        color: "var(--ink-secondary)",
        fontFamily: "'Inter Tight', sans-serif",
        fontSize: "1rem",
        gap: "0.5rem",
      }}
      data-map-mode="M5"
      aria-label="Mission Control map mode — feature not enabled"
    >
      <span
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.875rem",
          padding: "0.25rem 0.625rem",
          borderRadius: "0.375rem",
          background: "var(--surface-active)",
          color: "var(--ink-brand)",
          fontWeight: 600,
        }}
      >
        M5
      </span>
      <span>Mission Control</span>
      <p
        style={{
          fontSize: "0.8125rem",
          color: "var(--ink-tertiary)",
          fontFamily: "'IBM Plex Mono', monospace",
          margin: "0.25rem 0 0",
        }}
      >
        Enable{" "}
        <code
          style={{
            background: "var(--surface-active)",
            padding: "0.125rem 0.25rem",
            borderRadius: "0.25rem",
          }}
        >
          FF_MAP_MISSION
        </code>{" "}
        to activate
      </p>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders the active INVENTORY map mode alongside the case detail panel.
 *
 * Layout:
 *   - The map fills the full width when no case is selected.
 *   - When a case is selected (`activeCaseId !== null`), the map shrinks and
 *     the case detail panel slides in from the right.
 *   - On narrow viewports (≤ 768 px) the panel overlays the map instead.
 *
 * State ownership:
 *   - `activeCaseId` — derived from the `case` URL param via useMapParams.
 *     Setting to null closes the panel.
 *   - `caseWindow` — derived from the `window` URL param via useMapParams.
 *     Controls which T-layout tab (T1–T5) is visible inside the panel.
 *   - No useState() is used for the panel's open state or case selection —
 *     the URL is the single source of truth.
 *
 * orgs and kits are fetched from Convex via reactive subscriptions:
 *   • orgs  → missions (each mission = one operational deployment group)
 *   • kits  → case templates (predefined packing lists / kit types)
 *
 * When loading (subscriptions not yet resolved), empty arrays are passed
 * so dropdowns render without options until data arrives — no skeleton
 * required since the map canvas loads independently.
 */
export function InventoryMapClient({
  initialState,
}: InventoryMapClientProps) {
  // ── URL state ────────────────────────────────────────────────────────────────
  //
  // All map params are derived exclusively from the URL via useMapParams().
  // No local state is used for activeCaseId, caseWindow, panelOpen, or view.
  //
  // useMapParams() calls useSearchParams() internally and decodes the full
  // MapUrlState from the URL on every render.  It is the live/reactive source
  // of truth after React hydration.
  //
  // initialState (decoded server-side before this component first renders)
  // provides fallback values for the pre-hydration render — ensuring that
  // all 8 URL params initialize correctly even before useSearchParams() fires
  // on the client.  After hydration, useMapParams() values take precedence.
  const {
    view,
    activeCaseId,
    caseWindow,
    panelOpen,
    org,
    kit,
    layers,
    setActiveCaseId,
    setCaseWindow,
    setPanelOpen,
    setParams,
  } = useMapParams();

  // Resolve active map view:
  //   1. `view` from useMapParams() — the live URL-derived value (post-hydration)
  //   2. `initialState.view` — the server-decoded value (pre-hydration seed)
  //   3. MAP_URL_STATE_DEFAULTS.view ("M1") — absolute fallback
  //
  // In practice (1) is always a valid MapView after React hydration, but
  // (2) ensures the first SSR render uses the full codec-decoded URL state
  // (all 8 params) rather than a hardcoded "M1" fallback.
  const activeView: MapView =
    view ?? initialState?.view ?? MAP_URL_STATE_DEFAULTS.view;

  // ── Kinde user identity ───────────────────────────────────────────────────────
  //
  // userId is passed to useDefaultLayoutOnCaseChange to scope localStorage reads.
  // Empty string ("") is passed while Kinde is still loading — the hook handles
  // this gracefully (treats it as "no preference stored").
  const { id: userId } = useKindeUser({ fallbackName: "Operator" });

  // ── Default layout on case selection / status change ─────────────────────────
  //
  // When a case is selected (or its Convex status changes in real time), and
  // the user has no explicit map mode / case layout stored in localStorage,
  // automatically switch the dashboard to the recommended view derived from
  // getDefaultLayout(caseStatus).
  //
  // Examples:
  //   transit_out case selected → switches to M3 (Transit Tracker) + T4 (Shipping)
  //   deployed case selected    → switches to M2 (Site Detail) + T3 (Inspection)
  //   hangar case selected      → keeps M1 (Fleet Overview) + T1 (Summary)
  //
  // The auto-switch is suppressed when the user has previously called setMapMode
  // or setCaseLayout (which writes to localStorage via useLayoutPreferences).
  useDefaultLayoutOnCaseChange({
    activeCaseId,
    userId,
    setParams,
  });

  // ── Map mode telemetry ────────────────────────────────────────────────────────
  //
  // Fire INV_NAV_MAP_VIEW_CHANGED every time the active map mode changes.
  // previousViewRef tracks the last-emitted view so we can populate
  // `previousMapView` in the event payload (null on first render = initial load).
  //
  // The effect fires synchronously after each render where `activeView` changed,
  // which covers:
  //   • Initial page load (previousMapView = null)
  //   • User clicking a mode tab (M1 → M2, etc.)
  //   • URL-driven deep-link navigation (browser back/forward)
  const previousViewRef = useRef<MapView | null>(null);

  useEffect(() => {
    const previousView = previousViewRef.current;

    // Guard: skip if the view did not change (e.g., re-renders without a mode switch).
    if (previousView === activeView) return;

    trackEvent({
      eventCategory: "navigation",
      eventName: TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED,
      app: "inventory",
      mapView: activeView,
      previousMapView: previousView,
    });

    previousViewRef.current = activeView;
  }, [activeView]);

  // ── Page load telemetry ───────────────────────────────────────────────────────
  //
  // Fire INV_NAV_PAGE_LOADED once on mount.  `performance.now()` gives a
  // rough "time since navigation start → interactive" approximation that is
  // accurate enough for dashboard load-time trending.
  //
  // `hydratedFromUrl` is true when any meaningful URL params were present on
  // load (org, kit, case, view ≠ M1), indicating a deep-link entry.
  useEffect(() => {
    const loadDurationMs =
      typeof performance !== "undefined" ? Math.round(performance.now()) : 0;

    // Determine if the page was loaded from a deep-link with meaningful state.
    const hasDeepLinkState =
      typeof window !== "undefined" &&
      window.location.search.length > 1;

    trackEvent({
      eventCategory: "navigation",
      eventName: TelemetryEventName.INV_NAV_PAGE_LOADED,
      app: "inventory",
      loadDurationMs,
      hydratedFromUrl: hasDeepLinkState,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — fires exactly once on mount

  // ── Case selection/deselection telemetry ──────────────────────────────────────
  //
  // Fire INV_NAV_CASE_SELECTED when activeCaseId becomes non-null.
  // Fire INV_NAV_CASE_DESELECTED when activeCaseId becomes null (was non-null).
  //
  // previousCaseIdRef tracks the prior value so we can populate `previousCaseId`
  // in the deselected event.  The ref is initialized to a sentinel `false` to
  // distinguish "first render" (skip) from "case was null" (deselection).
  const previousCaseIdRef = useRef<string | null | false>(false);

  useEffect(() => {
    const previousCaseId = previousCaseIdRef.current;

    // Skip the very first render — we don't want to fire a spurious deselection
    // event when the page loads with no case selected.
    if (previousCaseId === false) {
      previousCaseIdRef.current = activeCaseId;
      return;
    }

    // No change — skip.
    if (previousCaseId === activeCaseId) return;

    if (activeCaseId !== null) {
      // A case was selected.
      trackEvent({
        eventCategory: "navigation",
        eventName: TelemetryEventName.INV_NAV_CASE_SELECTED,
        app: "inventory",
        caseId: activeCaseId,
        mapView: activeView,
        // Default source: list item (could be overridden per click site in future)
        selectionSource: "list_item",
      });
    } else if (previousCaseId !== null) {
      // Case was deselected (panel closed or case cleared).
      trackEvent({
        eventCategory: "navigation",
        eventName: TelemetryEventName.INV_NAV_CASE_DESELECTED,
        app: "inventory",
        caseId: previousCaseId,
        previousCaseId,
      });
    }

    previousCaseIdRef.current = activeCaseId;
  }, [activeCaseId, activeView]);

  // ── Org filter telemetry ──────────────────────────────────────────────────────
  //
  // Fire INV_ACTION_FILTER_ORG_CHANGED whenever the org URL param changes.
  // previousOrgRef tracks the previous value so we can populate `previousOrgId`.
  // Initialized to `false` so the initial render is skipped (not a user action).
  const previousOrgRef = useRef<string | null | false>(false);

  useEffect(() => {
    const previousOrg = previousOrgRef.current;

    // Skip initial render — reading org from the URL on mount is not a user action.
    if (previousOrg === false) {
      previousOrgRef.current = org;
      return;
    }

    // No change — skip.
    if (previousOrg === org) return;

    trackEvent({
      eventCategory: "user_action",
      eventName: TelemetryEventName.INV_ACTION_FILTER_ORG_CHANGED,
      app: "inventory",
      orgId: org,
      previousOrgId: previousOrg,
    });

    previousOrgRef.current = org;
  }, [org]);

  // ── Kit filter telemetry ──────────────────────────────────────────────────────
  //
  // Fire INV_ACTION_FILTER_KIT_CHANGED whenever the kit URL param changes.
  // Same skip-initial-render pattern as the org filter above.
  const previousKitRef = useRef<string | null | false>(false);

  useEffect(() => {
    const previousKit = previousKitRef.current;

    // Skip initial render.
    if (previousKit === false) {
      previousKitRef.current = kit;
      return;
    }

    // No change — skip.
    if (previousKit === kit) return;

    trackEvent({
      eventCategory: "user_action",
      eventName: TelemetryEventName.INV_ACTION_FILTER_KIT_CHANGED,
      app: "inventory",
      kitId: kit,
      previousKitId: previousKit,
    });

    previousKitRef.current = kit;
  }, [kit]);

  // ── Layer toggle telemetry ────────────────────────────────────────────────────
  //
  // Fire INV_ACTION_LAYER_TOGGLED whenever the layers URL param changes.
  // By diffing the previous and next layer arrays we can determine:
  //   • which layerId changed (added or removed)
  //   • whether it was enabled (added) or disabled (removed)
  //   • the full set of active layers after the toggle
  //
  // Only a single layer should change at a time (the toggleLayer() setter adds
  // or removes exactly one ID).  If multiple layers change simultaneously (e.g.,
  // from a setLayers() call), we fire one event per changed layer so each toggle
  // has its own telemetry record.
  //
  // Initialized to a sentinel `null` to detect the first render.
  const previousLayersRef = useRef<LayerId[] | null>(null);

  useEffect(() => {
    const previousLayers = previousLayersRef.current;

    // Skip initial render — layers read from URL on mount is not a user action.
    if (previousLayers === null) {
      previousLayersRef.current = layers;
      return;
    }

    // Determine which layers were added and which were removed.
    const added = layers.filter((l) => !previousLayers.includes(l));
    const removed = previousLayers.filter((l) => !layers.includes(l));

    // Fire one event per changed layer.
    // LayerId from @/types/map is the same union as InvActionLayerToggledEvent.layerId,
    // so the cast is safe — both are the same 8-member string union.
    for (const layerId of added) {
      trackEvent({
        eventCategory: "user_action",
        eventName: TelemetryEventName.INV_ACTION_LAYER_TOGGLED,
        app: "inventory",
        layerId: layerId as "cases" | "clusters" | "transit" | "sites" | "heat" | "labels" | "satellite" | "terrain",
        enabled: true,
        activeLayers: layers,
      });
    }
    for (const layerId of removed) {
      trackEvent({
        eventCategory: "user_action",
        eventName: TelemetryEventName.INV_ACTION_LAYER_TOGGLED,
        app: "inventory",
        layerId: layerId as "cases" | "clusters" | "transit" | "sites" | "heat" | "labels" | "satellite" | "terrain",
        enabled: false,
        activeLayers: layers,
      });
    }

    previousLayersRef.current = layers;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers]);

  // ── Mapbox token ─────────────────────────────────────────────────────────────
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // ── Convex data subscriptions ─────────────────────────────────────────────────
  //
  // orgs → useMissions(): each mission is a field deployment group.
  //   The "org" URL filter param selects a missionId to scope the map view.
  //   Uses the `by_updated` index — full scan ordered by most-recently-updated.
  //   Convex re-evaluates within ~100–300 ms of any mission row change.
  //
  // kits → useCaseTemplates(): case templates define equipment packing lists.
  //   The "kit" URL filter param selects a templateId to scope the map view.
  //   Uses the `by_active` index — only active templates are returned.
  //   Convex re-evaluates within ~100–300 ms of any template activation.
  //
  // Both hooks return empty arrays while loading (subscriptions pending),
  // which renders the dropdowns with only the "All" option until data arrives.
  const { orgs } = useMissions();
  const { kits } = useCaseTemplates();

  // ── Handlers ─────────────────────────────────────────────────────────────────

  /**
   * Close the case detail panel.
   *
   * Sets `panelOpen: false` in the URL, hiding the panel while preserving
   * the `activeCaseId` (case selection) so context is not lost.  The user
   * can re-open the panel later without re-selecting the case.
   *
   * Note: this does NOT clear `activeCaseId`.  Call `setActiveCaseId(null)`
   * separately if you want to deselect the case entirely.
   */
  const handleClosePanel = useCallback(() => {
    setPanelOpen(false);
  }, [setPanelOpen]);

  // ── Panel open state ─────────────────────────────────────────────────────────
  // Driven exclusively by the `panel` URL param via useMapParams.
  // Panel is open when `panelOpen === true` (URL: ?panel=1).
  // This is restored on page refresh and shareable via deep link.
  const isPanelOpen = panelOpen;

  // ── Mode rendering ───────────────────────────────────────────────────────────

  function renderMapMode() {
    switch (activeView) {
      case "M1":
        return (
          <M1FleetOverview
            mapboxToken={mapboxToken}
            orgs={orgs}
            kits={kits}
          />
        );

      case "M2":
        return (
          <M2SiteDetail
            mapboxToken={mapboxToken}
            orgs={orgs}
            kits={kits}
          />
        );

      case "M3":
        return (
          <M3TransitTracker
            mapboxToken={mapboxToken}
            orgs={orgs}
            kits={kits}
          />
        );

      case "M4":
        return (
          <M4Deployment
            mapboxToken={mapboxToken}
            orgs={orgs}
            kits={kits}
          />
        );

      case "M5":
        // M5 is gated behind FF_MAP_MISSION.
        // When disabled, show a locked placeholder so users know why the mode
        // is unavailable rather than silently falling back to M1.
        // When enabled, render M5MissionControl which reads all four URL params
        // (view, org, kit, at) via useMapParams on mount, fully restoring state
        // on page load and hard refresh.
        return FF_MAP_MISSION ? (
          <M5MissionControl
            mapboxToken={mapboxToken}
            orgs={orgs}
            kits={kits}
          />
        ) : (
          <M5LockedStub />
        );

      default:
        return (
          <M1FleetOverview
            mapboxToken={mapboxToken}
            orgs={orgs}
            kits={kits}
          />
        );
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <LayerEngineProvider storageKey="inv-layer-visibility">
    <MapManifestHoverProvider>
    <div
      className={styles.root}
      data-panel-open={isPanelOpen ? "true" : "false"}
    >
      {/* Map area — fills full width when panel is closed */}
      <div className={styles.mapArea}>
        {renderMapMode()}
      </div>

      {/* Case detail panel — only rendered when a case is selected in the URL.
          Both the visibility and the caseId are derived from the URL param
          `activeCaseId`; no local state is used. */}
      {isPanelOpen && activeCaseId !== null && (
        <aside
          className={styles.detailPanel}
          aria-label="Case detail"
          data-testid="inventory-case-detail-panel"
        >
          {/* Panel header with close button */}
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Case Detail</span>
            <button
              type="button"
              className={styles.closeButton}
              onClick={handleClosePanel}
              aria-label="Close case detail panel"
              title="Close"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>

          {/* Panel body — CaseDetailPanel derives all state from URL params.
              caseId comes from activeCaseId (URL `case` param).
              window (T-layout) comes from caseWindow (URL `window` param).
              onWindowChange writes back to the URL via setCaseWindow.
              No useState is used for caseId, window, or open state. */}
          <div className={styles.panelBody}>
            <CaseDetailPanel
              caseId={activeCaseId}
              window={caseWindow}
              onWindowChange={setCaseWindow}
              ffAuditHashChain={FF_AUDIT_HASH_CHAIN}
            />
          </div>
        </aside>
      )}
    </div>
    </MapManifestHoverProvider>
    </LayerEngineProvider>
  );
}

export default InventoryMapClient;
