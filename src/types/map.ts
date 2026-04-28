/**
 * Map state types for INVENTORY dashboard
 *
 * URL params: view, case, window, panel, layers, org, kit, at
 */

// ─── Map view modes ───────────────────────────────────────────────────────────

/**
 * M1 = Fleet Overview   – all cases on a world/region map
 * M2 = Site Detail      – single deployment site zoom
 * M3 = Transit Tracker  – cases in-transit with FedEx overlays
 * M4 = Heat Map         – status density / damage heat map
 * M5 = Mission Control  – time-scrubbing replay (FF_MAP_MISSION)
 */
export type MapView = "M1" | "M2" | "M3" | "M4" | "M5";

export const MAP_VIEW_VALUES: MapView[] = ["M1", "M2", "M3", "M4", "M5"];

export function isMapView(value: unknown): value is MapView {
  return typeof value === "string" && MAP_VIEW_VALUES.includes(value as MapView);
}

// ─── Case detail window layouts ───────────────────────────────────────────────

/**
 * T1 = Summary panel
 * T2 = Manifest / packing list
 * T3 = Inspection history
 * T4 = Shipping & custody chain
 * T5 = Audit hash chain (FF_AUDIT_HASH_CHAIN)
 */
export type CaseWindow = "T1" | "T2" | "T3" | "T4" | "T5";

export const CASE_WINDOW_VALUES: CaseWindow[] = ["T1", "T2", "T3", "T4", "T5"];

export function isCaseWindow(value: unknown): value is CaseWindow {
  return (
    typeof value === "string" && CASE_WINDOW_VALUES.includes(value as CaseWindow)
  );
}

// ─── Layer identifiers ────────────────────────────────────────────────────────

export type LayerId =
  | "cases"
  | "clusters"
  | "transit"
  | "sites"
  | "heat"
  | "labels"
  | "satellite"
  | "terrain";

export const LAYER_IDS: LayerId[] = [
  "cases",
  "clusters",
  "transit",
  "sites",
  "heat",
  "labels",
  "satellite",
  "terrain",
];

export const DEFAULT_LAYERS: LayerId[] = ["cases", "clusters", "labels"];

export function isLayerId(value: unknown): value is LayerId {
  return typeof value === "string" && LAYER_IDS.includes(value as LayerId);
}

// ─── Serialised map state (maps 1:1 to URL search params) ────────────────────

/**
 * Complete serialised map state carried in the URL.
 *
 * All fields are optional – missing fields fall back to their defaults.
 */
export interface MapUrlState {
  /** Active map mode (default: "M1") */
  view: MapView;
  /** Selected case Convex ID (default: null) */
  case: string | null;
  /** Open detail panel layout (default: "T1") */
  window: CaseWindow;
  /**
   * Whether the case detail panel is explicitly open (default: false).
   *
   * Serialised as the `panel` URL search param ("1" when true, omitted when
   * false).  Panel visibility is driven by this field rather than being
   * implicitly derived from `case !== null` — this lets the panel be closed
   * while a case stays selected, and lets the open state survive a refresh.
   *
   * Invariant: `panelOpen === true` only makes UI sense when `case !== null`.
   * Setting `case` to a non-null value via `setActiveCaseId` also sets
   * `panelOpen: true` atomically.
   */
  panelOpen: boolean;
  /** Active layer set (default: DEFAULT_LAYERS) */
  layers: LayerId[];
  /** Organisation filter (Convex ID, default: null) */
  org: string | null;
  /** Kit / case template filter (Convex ID, default: null) */
  kit: string | null;
  /**
   * Mission-replay wall-clock timestamp (ISO-8601, default: null).
   * Only meaningful when view === "M5" and FF_MAP_MISSION is enabled.
   */
  at: Date | null;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const MAP_URL_STATE_DEFAULTS: MapUrlState = {
  view: "M1",
  case: null,
  window: "T1",
  panelOpen: false,
  layers: [...DEFAULT_LAYERS],
  org: null,
  kit: null,
  at: null,
};
