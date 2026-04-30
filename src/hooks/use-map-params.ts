/**
 * useMapParams — focused hook for the URL params that filter / drive
 * the INVENTORY map views (M1-M5).
 *
 * Wraps useMapUrlState to provide:
 *   - Per-param readers  (view, org, kit, at, activeCaseId, caseWindow, layers)
 *   - Per-param setters  (setView, setOrg, setKit, setAt, setActiveCaseId, setCaseWindow,
 *                         setLayers, toggleLayer)
 *   - Bulk setter        (setParams) for atomic multi-param updates
 *
 * Every setter writes back to the URL via router.replace() by default,
 * keeping the URL as the single source of truth.  Pass { replace: false }
 * to push a new history entry instead (enables back-button navigation).
 *
 * Usage
 * ─────
 *   "use client";
 *   import { useMapParams } from "@/hooks/use-map-params";
 *
 *   function OrgDropdown() {
 *     const { org, setOrg } = useMapParams();
 *     return (
 *       <select value={org ?? ""} onChange={(e) => setOrg(e.target.value || null)}>
 *         ...
 *       </select>
 *     );
 *   }
 *
 *   function CasePin({ caseId }: { caseId: string }) {
 *     const { activeCaseId, setActiveCaseId } = useMapParams();
 *     return (
 *       <button
 *         aria-pressed={activeCaseId === caseId}
 *         onClick={() => setActiveCaseId(caseId)}
 *       >
 *         Open case
 *       </button>
 *     );
 *   }
 *
 * Notes
 * ─────
 * • Must be used inside a Next.js <Suspense> boundary (requirement of
 *   useSearchParams under the App Router).
 * • Does NOT require MapStateProvider — it reads/writes the URL directly
 *   via useMapUrlState, making it portable across route segments.
 * • activeCaseId maps to the `case` URL param (MapUrlState.case).
 * • caseWindow maps to the `window` URL param (MapUrlState.window).
 */

"use client";

import { useCallback } from "react";
import { useMapUrlState, type SetMapStateOptions } from "@/hooks/use-map-url-state";
import type { MapView, CaseWindow, LayerId } from "@/types/map";
import type { SemanticLayerId } from "@/types/layer-engine";

// ─── Public types ─────────────────────────────────────────────────────────────

/** A subset of MapUrlState containing the filter/control params. */
export interface MapParams {
  /** Active map mode ("M1" | "M2" | "M3" | "M4" | "M5"). Default: "M1". */
  view: MapView;
  /**
   * Convex ID of the currently selected / active case, or null when no case
   * is selected.  Serialized as the `case` URL search param.
   *
   * Setting this opens the case detail panel and updates the URL so the
   * selection is preserved across page refreshes and can be shared as a
   * deep link.
   *
   * @example activeCaseId = "jx7abc000xyz"
   */
  activeCaseId: string | null;
  /** Organisation filter (Convex ID) or null when unfiltered. */
  org: string | null;
  /** Kit / case-template filter (Convex ID) or null when unfiltered. */
  kit: string | null;
  /**
   * Mission-replay wall-clock timestamp (ISO-8601 → Date) or null.
   * Only meaningful in M5 when FF_MAP_MISSION is enabled.
   */
  at: Date | null;

  /**
   * Active case-detail T-layout ("T1" | "T2" | "T3" | "T4" | "T5").
   * Default: "T1".
   *
   * Serialized as the `window` URL search param.  Controls which T-layout
   * is rendered inside the CaseDetailPanel when a case is selected.
   */
  caseWindow: CaseWindow;

  /**
   * Whether the case detail panel is explicitly open.
   * Serialized as the `panel` URL search param ("1" when true, omitted
   * when false).
   *
   * This field controls panel visibility independently of `activeCaseId`,
   * allowing the panel to be closed while a case remains selected (e.g.,
   * for a "hide panel" UX) and to be restored to the correct open/closed
   * state on page refresh or deep link.
   *
   * Invariant: the panel is only meaningful when `activeCaseId !== null`.
   * `setActiveCaseId(id)` atomically sets `panelOpen: true` alongside the
   * case selection.  `setPanelOpen(false)` closes the panel without
   * clearing the case selection.
   *
   * @example panelOpen = true  // panel visible
   * @example panelOpen = false // panel hidden
   */
  panelOpen: boolean;

  /**
   * Currently active map overlay layers.
   * Serialized as the `layers` URL search param (comma-separated layer IDs).
   * Defaults to `DEFAULT_LAYERS` when absent from the URL.
   *
   * Read on mount from the URL so deep links restore the exact layer set.
   * Any toggle writes back to the URL so the layer state is shareable.
   *
   * @example layers = ["cases", "clusters", "labels"]  // default
   * @example layers = ["cases", "heat", "satellite"]   // custom set
   */
  layers: LayerId[];

  /**
   * Currently active semantic data layers (LayerTogglePanel toggle state).
   * Serialized as the `slayers` URL search param (comma-separated
   * SemanticLayerIds).  Defaults to `DEFAULT_SLAYERS` when absent.
   *
   * Distinct from `layers` (map overlay layers).  This holds the on/off
   * state of the 7 LayerTogglePanel toggles (deployed, transit, flagged,
   * hangar, heat, history, turbines).
   *
   * Persisted to URL via shallow routing (window.history.replaceState) so
   * toggle state survives refresh and is shareable as a deep link without
   * triggering a full navigation.
   *
   * @example slayers = ["deployed", "flagged"]   // only deployed + flagged active
   * @example slayers = SEMANTIC_LAYER_IDS         // all 7 layers active
   */
  slayers: SemanticLayerId[];
}

/** Options shared by all setters. */
export type SetParamOptions = SetMapStateOptions;

/** Return type of useMapParams. */
export interface UseMapParamsReturn extends MapParams {
  /**
   * Switch to a different map mode.
   * Updates the `view` param in the URL.
   *
   * @example setView("M2")
   */
  setView: (view: MapView, options?: SetParamOptions) => void;

  /**
   * Select or deselect a case.
   * Updates the `case` URL param and opens the case detail panel.
   *
   * Pass `null` to deselect the current case and close the detail panel.
   *
   * @example setActiveCaseId("jx7abc000xyz")   // select a case
   * @example setActiveCaseId(null)              // deselect / close panel
   */
  setActiveCaseId: (caseId: string | null, options?: SetParamOptions) => void;

  /**
   * Apply or clear the organisation filter.
   * Updates the `org` param in the URL.
   *
   * @example setOrg("orgId123")   // filter to one org
   * @example setOrg(null)          // clear filter
   */
  setOrg: (org: string | null, options?: SetParamOptions) => void;

  /**
   * Apply or clear the kit (case-template) filter.
   * Updates the `kit` param in the URL.
   *
   * @example setKit("kitId456")
   * @example setKit(null)
   */
  setKit: (kit: string | null, options?: SetParamOptions) => void;

  /**
   * Set the mission-replay timestamp.
   * Updates the `at` param in the URL as an ISO-8601 string.
   *
   * @example setAt(new Date("2025-06-01T14:00:00Z"))
   * @example setAt(null)   // exit replay mode
   */
  setAt: (at: Date | null, options?: SetParamOptions) => void;

  /**
   * Switch to a different case-detail T-layout.
   * Updates the `window` URL param.
   *
   * Only meaningful when a case is selected (activeCaseId !== null).
   * Setting this while no case is selected has no visible effect but
   * the value is preserved in the URL for when a case is opened.
   *
   * @example setCaseWindow("T2")   // switch to Manifest tab
   * @example setCaseWindow("T1")   // return to Summary tab
   */
  setCaseWindow: (window: CaseWindow, options?: SetParamOptions) => void;

  /**
   * Open or close the case detail panel.
   * Updates the `panel` URL param.
   *
   * Use `true` to show the panel and `false` to hide it.  Unlike clearing
   * `activeCaseId`, this preserves the case selection so the panel can
   * be toggled without losing context.
   *
   * Typically called by the panel's close button (`setPanelOpen(false)`)
   * or by a "Show details" affordance that wants to reveal the panel for
   * an already-selected case (`setPanelOpen(true)`).
   *
   * @example setPanelOpen(true)   // reveal the case detail panel
   * @example setPanelOpen(false)  // hide the panel (case stays selected)
   */
  setPanelOpen: (open: boolean, options?: SetParamOptions) => void;

  /**
   * Replace the full active layer set.
   * Updates the `layers` URL param with the provided array.
   *
   * Use `toggleLayer` for single-layer on/off toggling.  Use this setter
   * when you need to replace the entire layer set at once (e.g., applying
   * a preset).
   *
   * @example setLayers(["cases", "heat"])           // activate two layers
   * @example setLayers(DEFAULT_LAYERS)              // reset to defaults
   */
  setLayers: (layers: LayerId[], options?: SetParamOptions) => void;

  /**
   * Toggle a single overlay layer on or off.
   * If the layer is currently active, it is removed; if absent, it is added.
   * Updates the `layers` URL param.
   *
   * This is the primary entry point for layer-picker checkboxes / toggle
   * buttons — each one calls `toggleLayer(id)` on click.
   *
   * @example toggleLayer("heat")      // add "heat" if absent, remove if present
   * @example toggleLayer("satellite") // toggle satellite base layer
   */
  toggleLayer: (layerId: LayerId, options?: SetParamOptions) => void;

  /**
   * Replace the full active semantic-layer set.
   * Updates the `slayers` URL param via shallow routing
   * (window.history.replaceState — no full reload).
   *
   * Use `toggleSemanticLayer` for single-layer on/off toggling.  Use this
   * setter when you need to replace the entire toggle set at once (e.g.,
   * applying a "Show all" / "Hide all" preset, or syncing from an engine
   * snapshot).
   *
   * @example setSlayers(["deployed", "flagged"])
   * @example setSlayers(DEFAULT_SLAYERS)              // reset to defaults
   * @example setSlayers([...SEMANTIC_LAYER_IDS])      // activate every layer
   */
  setSlayers: (
    slayers: SemanticLayerId[],
    options?: SetParamOptions
  ) => void;

  /**
   * Toggle a single semantic data layer on or off.
   * If the layer is currently active, it is removed; if absent, it is added.
   * Updates the `slayers` URL param via shallow routing
   * (window.history.replaceState — no full page reload).
   *
   * This is the primary entry point for the LayerTogglePanel — each toggle
   * row's `onToggleLayer` callback calls `toggleSemanticLayer(id)`.
   *
   * @example toggleSemanticLayer("flagged")  // add if absent, remove if present
   * @example toggleSemanticLayer("heat")     // toggle the heat overlay layer
   */
  toggleSemanticLayer: (
    layerId: SemanticLayerId,
    options?: SetParamOptions
  ) => void;

  /**
   * Atomically update multiple params at once.
   * Merges all provided fields into the current URL state in a single
   * history entry — use this instead of chaining individual setters.
   *
   * @example
   * setParams({ view: "M2", org: "orgId123" })
   * setParams({ activeCaseId: "jx7abc000xyz", view: "M2" })
   * setParams({ activeCaseId: "jx7abc000xyz", caseWindow: "T3" })
   * setParams({ panelOpen: false })                              // close panel
   * setParams({ activeCaseId: "jx7abc000xyz", panelOpen: true }) // open panel
   * setParams({ layers: ["cases", "heat"] })                    // set layers
   */
  setParams: (patch: Partial<MapParams>, options?: SetParamOptions) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Read and write the INVENTORY map URL params
 * (view, activeCaseId, caseWindow, org, kit, at, layers).
 *
 * Must be used inside a <Suspense> boundary.
 */
export function useMapParams(): UseMapParamsReturn {
  const [mapState, setMapUrlState] = useMapUrlState();

  // ── Per-param setters ──────────────────────────────────────────────

  const setView = useCallback(
    (view: MapView, options?: SetParamOptions): void => {
      setMapUrlState({ view }, options);
    },
    [setMapUrlState]
  );

  const setActiveCaseId = useCallback(
    (caseId: string | null, options?: SetParamOptions): void => {
      // MapUrlState uses `case` as the key; MapParams exposes it as `activeCaseId`.
      // When selecting a case, atomically open the panel.
      // When clearing the case (null), atomically close the panel.
      setMapUrlState({ case: caseId, panelOpen: caseId !== null }, options);
    },
    [setMapUrlState]
  );

  // ── Org / Kit selector setters (AC 110202 Sub-AC 2) ────────────────
  //
  // setOrg / setKit delegate to setMapUrlState which writes to the URL via
  // window.history.replaceState (shallow routing — no full page reload, no
  // Next.js router navigation event).
  //
  // This is the wiring that satisfies AC 110202 Sub-AC 2: the org and kit
  // selector controls (rendered as <select> dropdowns inside each map mode
  // component — M1FleetOverview, M2SiteDetail, M3TransitTracker, M4Deployment,
  // M5MissionControl) call these setters from their onChange handlers, so
  // selection changes update the `org` / `kit` URL params via shallow routing
  // without triggering a full reload.
  //
  // Pass { replace: false } to push a new history entry instead — useful when
  // the change should be reachable via the browser Back button.

  const setOrg = useCallback(
    (org: string | null, options?: SetParamOptions): void => {
      // Writes ?org=<id> via window.history.replaceState by default — no
      // navigation event is fired, so React state stays in sync without a
      // full route reload.
      setMapUrlState({ org }, options);
    },
    [setMapUrlState]
  );

  const setKit = useCallback(
    (kit: string | null, options?: SetParamOptions): void => {
      // Writes ?kit=<id> via window.history.replaceState by default — no
      // navigation event is fired, so React state stays in sync without a
      // full route reload.
      setMapUrlState({ kit }, options);
    },
    [setMapUrlState]
  );

  const setAt = useCallback(
    (at: Date | null, options?: SetParamOptions): void => {
      setMapUrlState({ at }, options);
    },
    [setMapUrlState]
  );

  const setCaseWindow = useCallback(
    (window: CaseWindow, options?: SetParamOptions): void => {
      // MapUrlState uses `window` as the key; MapParams exposes it as `caseWindow`
      setMapUrlState({ window }, options);
    },
    [setMapUrlState]
  );

  const setPanelOpen = useCallback(
    (open: boolean, options?: SetParamOptions): void => {
      // MapUrlState uses `panelOpen` as the key; same name in MapParams.
      setMapUrlState({ panelOpen: open }, options);
    },
    [setMapUrlState]
  );

  const setLayers = useCallback(
    (layers: LayerId[], options?: SetParamOptions): void => {
      setMapUrlState({ layers }, options);
    },
    [setMapUrlState]
  );

  const toggleLayer = useCallback(
    (layerId: LayerId, options?: SetParamOptions): void => {
      // Read the current layer set from URL state and compute the next set.
      // The toggled layer is removed if present, added if absent.
      // The current `mapState` is captured in this closure — it reflects the
      // URL at the time the user interacts, which is the correct behaviour.
      const currentLayers = mapState.layers;
      const isActive = currentLayers.includes(layerId);
      const nextLayers = isActive
        ? currentLayers.filter((l) => l !== layerId)
        : [...currentLayers, layerId];
      setMapUrlState({ layers: nextLayers }, options);
    },
    [mapState.layers, setMapUrlState]
  );

  // ── Semantic-layer setters (slayers URL param) ──────────────────────
  //
  // Both setters delegate to setMapUrlState which writes to URL via
  // window.history.replaceState (shallow routing — no full reload, no
  // Next.js navigation event).  This is the wiring that satisfies
  // AC 110201 Sub-AC 1: layer toggle controls drive URL state updates
  // via shallow routing without full page reloads.

  const setSlayers = useCallback(
    (slayers: SemanticLayerId[], options?: SetParamOptions): void => {
      setMapUrlState({ slayers }, options);
    },
    [setMapUrlState]
  );

  const toggleSemanticLayer = useCallback(
    (layerId: SemanticLayerId, options?: SetParamOptions): void => {
      // Read the current semantic-layer set from URL state.  The closure
      // captures `mapState.slayers` at render time — always reflects the
      // URL value the user is interacting with.
      const current = mapState.slayers;
      const isActive = current.includes(layerId);
      const next = isActive
        ? current.filter((l) => l !== layerId)
        : [...current, layerId];
      setMapUrlState({ slayers: next }, options);
    },
    [mapState.slayers, setMapUrlState]
  );

  // ── Bulk setter ────────────────────────────────────────────────────

  const setParams = useCallback(
    (patch: Partial<MapParams>, options?: SetParamOptions): void => {
      // `activeCaseId` in MapParams maps to `case` in MapUrlState.
      // `caseWindow` in MapParams maps to `window` in MapUrlState.
      // `panelOpen` maps directly (same name in both interfaces).
      // `layers` maps directly (same name in both interfaces).
      // `slayers` maps directly (same name in both interfaces).
      // Extract renamed fields explicitly and rebuild a MapUrlState-compatible patch.
      const { activeCaseId, caseWindow, panelOpen, ...rest } = patch;
      const urlPatch: Parameters<typeof setMapUrlState>[0] = { ...rest };
      if ("activeCaseId" in patch) {
        // Include `case` in the patch (even when null, to allow clearing it).
        urlPatch.case = activeCaseId;
        // When setParams provides activeCaseId but not panelOpen, auto-derive
        // panelOpen from whether a case is being selected (mirrors setActiveCaseId).
        if (!("panelOpen" in patch)) {
          urlPatch.panelOpen = activeCaseId !== null;
        }
      }
      if ("caseWindow" in patch) {
        urlPatch.window = caseWindow;
      }
      if ("panelOpen" in patch) {
        urlPatch.panelOpen = panelOpen;
      }
      setMapUrlState(urlPatch, options);
    },
    [setMapUrlState]
  );

  return {
    // Readers
    view: mapState.view,
    activeCaseId: mapState.case,
    org: mapState.org,
    kit: mapState.kit,
    at: mapState.at,
    caseWindow: mapState.window,
    panelOpen: mapState.panelOpen,
    layers: mapState.layers,
    // Writers
    setView,
    setActiveCaseId,
    setOrg,
    setKit,
    setAt,
    setCaseWindow,
    setPanelOpen,
    setLayers,
    toggleLayer,
    setParams,
  };
}
