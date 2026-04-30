/**
 * Map state types for INVENTORY dashboard
 *
 * URL params: view, case, window, panel, layers, org, kit, at
 *
 * Response data shapes (M1–M5):
 *   All five map mode response envelopes are defined in this file as
 *   standalone TypeScript interfaces.  They use `CaseStatus` (from
 *   ./case-status) rather than the Convex-internal `CaseStatusLiteral` so
 *   they are fully framework-agnostic and importable by any client code
 *   without pulling in Convex server binaries.
 *
 *   M1 (Fleet Overview)   — all cases with status/position pins
 *   M2 (Mission Mode)     — cases grouped by mission site
 *   M3 (Field Mode)       — deployed/flagged cases with inspection progress
 *   M4 (Logistics Mode)   — active shipments with FedEx tracking overlays
 *   M5 (Mission Control)  — density clusters, heatmap, timeline replay
 *                           (requires FF_MAP_MISSION feature flag)
 *
 * Extension hierarchy (Sub-AC 2):
 *   M1CasePin is the shared base for case map-pin shapes.  M3CasePin extends
 *   it (via Omit<M1CasePin, "status">) with a narrowed status union and adds
 *   inspection progress fields.  M4ShipmentPin and the M5 aggregate types are
 *   standalone shapes — they represent shipments / cluster aggregates, not
 *   individual case pins.
 *
 * Structural note:
 *   These interfaces are structurally compatible with the corresponding types
 *   in convex/maps.ts (M1Response, M2Response, …).  TypeScript's structural
 *   type system ensures full assignability — the server assemblers return
 *   values that satisfy these client interfaces without any casting.
 *
 * When to use which file:
 *   @/types/map      → import any M1–M5 response shapes for UI components,
 *                      hooks, and client-side utilities.
 *   convex/maps.ts   → assembler function signatures; Convex internalQuery
 *                      handlers; server-side route handlers.
 *   @/types/cases-map → API request params, API response wrapper types,
 *                       mode type-guard functions (isM1Response, …).
 */

import type { CaseStatus } from "./case-status";
import type { SemanticLayerId } from "./layer-engine";
import { SEMANTIC_LAYER_IDS, DEFAULT_LAYER_ENGINE_STATE } from "./layer-engine";

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

// ─── Map mode registry types ──────────────────────────────────────────────────

/**
 * Functional grouping for map view modes.
 *
 *   core    — always available modes (M1–M4); no feature flag required
 *   mission — gated modes (M5); requires the FF_MAP_MISSION feature flag
 */
export type MapModeGroup = "core" | "mission";

/** All valid MapModeGroup values for exhaustive checks / iteration. */
export const MAP_MODE_GROUPS: readonly MapModeGroup[] = [
  "core",
  "mission",
] as const;

/**
 * Static metadata for a single map view mode.
 *
 * Stored in MAP_MODE_REGISTRY (src/lib/map-mode-registry.ts).  This record
 * is immutable — it describes the mode but does NOT hold runtime selection
 * state (that lives in MapUrlState.view, serialised in the URL).
 */
export interface MapModeDef {
  /**
   * Stable mode identifier (M1–M5).
   * Matches the `MapView` type and the `view` URL param value.
   */
  id: MapView;

  /**
   * Short human-readable display label (≤ 20 chars) for the mode picker.
   *
   * @example "Fleet Overview", "Mission Control"
   */
  label: string;

  /**
   * One-sentence description used in tooltips and help text.
   */
  description: string;

  /**
   * Functional group that controls display categorization and access rules.
   *
   *   "core"    — modes M1–M4, always accessible to all authenticated users
   *   "mission" — mode M5, requires the `FF_MAP_MISSION` feature flag
   */
  group: MapModeGroup;

  /**
   * Whether this mode is accessible by default — i.e., without any
   * feature flag being explicitly enabled.
   *
   * - `true`  → mode is always visible in the mode picker (M1–M4)
   * - `false` → mode is hidden unless the associated `featureFlag` is active (M5)
   *
   * Note: this is NOT the "currently selected mode" — that is MapUrlState.view.
   * The default *selected* mode is always "M1" (MAP_URL_STATE_DEFAULTS.view).
   */
  defaultActive: boolean;

  /**
   * Feature flag identifier required to enable this mode.
   *
   * When present, the mode picker MUST check this flag before displaying the
   * mode.  `undefined` means the mode is always available (no flag check needed).
   *
   * @example "FF_MAP_MISSION"
   */
  featureFlag?: string;

  /**
   * Display order in the mode picker (ascending, 0-first).
   * Registry entries are pre-sorted by this field.
   */
  order: number;
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
  /**
   * Active semantic data layers — toggle-controllable subset of the 7
   * SemanticLayerIds (deployed, transit, flagged, hangar, heat, history,
   * turbines).  Serialised as the `slayers` URL search param so toggle state
   * survives refresh / deep-link sharing without requiring localStorage.
   *
   * Persists in the URL via shallow routing (window.history.replaceState)
   * whenever the user clicks a toggle in the LayerTogglePanel — see
   * `LayerTogglePanelConnected` and `useMapParams.toggleSemanticLayer`.
   *
   * Default: DEFAULT_SLAYERS — the same active set as DEFAULT_LAYER_ENGINE_STATE.
   *
   * @example slayers = ["deployed", "flagged"]   // only show deployed + flagged pins
   * @example slayers = SEMANTIC_LAYER_IDS         // show every semantic layer
   */
  slayers: SemanticLayerId[];
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

/**
 * Default `slayers` URL param value — the SemanticLayerIds whose default
 * visibility is `true` in DEFAULT_LAYER_ENGINE_STATE.
 *
 * This list is the canonical "all-active" toggle set for a fresh load.
 * When the URL `slayers` param is absent or empty, callers should fall
 * back to this list so the LayerTogglePanel renders with all default
 * layers visible.
 */
export const DEFAULT_SLAYERS: SemanticLayerId[] = SEMANTIC_LAYER_IDS.filter(
  (id) => DEFAULT_LAYER_ENGINE_STATE[id]
);

export const MAP_URL_STATE_DEFAULTS: MapUrlState = {
  view: "M1",
  case: null,
  window: "T1",
  panelOpen: false,
  layers: [...DEFAULT_LAYERS],
  slayers: [...DEFAULT_SLAYERS],
  org: null,
  kit: null,
  at: null,
};

// ─── Layer toggle state ───────────────────────────────────────────────────────

/**
 * Ephemeral visibility toggles for case-status map layers.
 *
 * Each boolean controls whether cases in that status category are rendered
 * on the map.  These are independent of the `layers: LayerId[]` URL param
 * (which controls map overlay layers like clusters, heat, satellite).
 *
 * - deployed  — cases currently deployed to a field site
 * - transit   — cases in active transit / shipping
 * - flagged   — cases with open damage reports or inspection failures
 * - hangar    — cases in assembly, ready state, or hangar storage
 */
export interface LayerToggles {
  deployed: boolean;
  transit: boolean;
  flagged: boolean;
  hangar: boolean;
}

/** The four toggle keys as a const array for iteration. */
export const LAYER_TOGGLE_KEYS = [
  "deployed",
  "transit",
  "flagged",
  "hangar",
] as const satisfies ReadonlyArray<keyof LayerToggles>;

/** Union of valid toggle key names. */
export type LayerToggleKey = (typeof LAYER_TOGGLE_KEYS)[number];

/** Default toggle state: all layers visible. */
export const DEFAULT_LAYER_TOGGLES: LayerToggles = {
  deployed: true,
  transit: true,
  flagged: true,
  hangar: true,
};

// ─── Status layer type enum ───────────────────────────────────────────────────

/**
 * Named constant bag for the four case-status map layer identifiers.
 *
 * Provides an enum-like property-access pattern without the TypeScript `enum`
 * keyword overhead.  Values are identical to the keys of `LayerToggles` and
 * the members of `LayerToggleKey`.
 *
 * The four layers and their semantics:
 *   DEPLOYED — cases currently active at a field inspection site
 *   TRANSIT  — cases in active transit (FedEx tracking live)
 *   FLAGGED  — cases with open damage reports or inspection failures
 *   HANGAR   — cases in assembly, ready-state, hangar storage, or archived
 *
 * Usage:
 * @example
 *   import { STATUS_LAYER_TYPE } from "@/types/map";
 *
 *   // Property access instead of string literals
 *   engine.toggle(STATUS_LAYER_TYPE.DEPLOYED);      // "deployed"
 *   toggleLayer(STATUS_LAYER_TYPE.TRANSIT);         // "transit"
 *
 *   // Comparison
 *   if (pin.layerKey === STATUS_LAYER_TYPE.FLAGGED) { ... }
 *
 *   // Iteration — use LAYER_TOGGLE_KEYS for the ordered array
 *   LAYER_TOGGLE_KEYS.forEach(key => console.log(key));
 */
export const STATUS_LAYER_TYPE = {
  /** Cases currently deployed at a field inspection site. */
  DEPLOYED: "deployed" as const,
  /** Cases in active transit with FedEx tracking. */
  TRANSIT: "transit" as const,
  /** Cases with open damage reports or inspection failures. */
  FLAGGED: "flagged" as const,
  /** Cases in hangar storage, assembly, received, or archived. */
  HANGAR: "hangar" as const,
} satisfies Record<string, LayerToggleKey>;

/**
 * Derive the `LayerToggleKey` union from `STATUS_LAYER_TYPE` values.
 *
 * This mirrors `LayerToggleKey` exactly — both are interchangeable.
 * The type is provided as a convenience so code that imports from
 * `@/types/map` can use one import for both the enum-like const and the type.
 *
 * @example
 *   function highlightLayer(layer: StatusLayerTypeValue) { ... }
 *   highlightLayer(STATUS_LAYER_TYPE.DEPLOYED);
 */
export type StatusLayerTypeValue =
  (typeof STATUS_LAYER_TYPE)[keyof typeof STATUS_LAYER_TYPE];

// ─── M1 and M2 map mode response data shapes ─────────────────────────────────
//
// Standalone TypeScript interfaces for the M1 (Fleet Overview) and M2 (Mission
// Mode) map API response envelopes.
//
// These definitions are framework-agnostic: they use `CaseStatus` (defined in
// ./case-status) rather than the Convex-internal `CaseStatusLiteral` so they
// can be safely imported by any client-side code — browser components, server
// components, and tests — without pulling in Convex server binaries.
//
// Structural compatibility note:
//   These interfaces are structurally identical to the corresponding types in
//   convex/maps.ts (M1Response, M2Response, etc.).  TypeScript's structural
//   type system ensures full compatibility between them and the server-side
//   assembler return values.
//
// When to use which file:
//   @/types/map     → import M1/M2 response shapes for UI components, hooks,
//                     and client-side utilities that consume map API results.
//   convex/maps.ts  → assembler function signatures; Convex internalQuery
//                     handlers; server-side route handlers.
//   @/types/cases-map → M3–M5 shapes, request params, API response wrappers,
//                       and mode type-guard functions (isM1Response, …).

// ── M2 mission lifecycle status ───────────────────────────────────────────────

/**
 * Valid lifecycle statuses for a mission entity.
 *
 * Mirrors `MissionStatusLiteral` in convex/maps.ts and the `missionStatus`
 * validator in convex/schema.ts.  Defined here to keep M2 response shapes
 * self-contained in this file.
 */
export type MissionStatus = "planning" | "active" | "completed" | "cancelled";

/** All valid `MissionStatus` values as a runtime array for validation. */
export const MISSION_STATUSES: MissionStatus[] = [
  "planning",
  "active",
  "completed",
  "cancelled",
];

// ── M1 types ──────────────────────────────────────────────────────────────────

/**
 * Map pin for a single equipment case in M1 (Fleet Overview) mode.
 *
 * All coordinate fields are optional — cases not yet assigned to a field site
 * have no lat/lng and are excluded from the viewport bounds filter.
 *
 * Custody state fields (currentCustodianId, currentCustodianName,
 * custodyTransferredAt) are populated from the most recent custody handoff
 * record.  They are omitted when no custody transfer has been recorded.
 *
 * @see M1Response — envelope that carries an array of these pins.
 */
export interface M1CasePin {
  /** Convex document ID (string form). */
  _id: string;
  /** Human-readable case label, e.g. "CASE-0042". */
  label: string;
  /** Current lifecycle status of the case. */
  status: CaseStatus;
  /** WGS-84 latitude of the case's current location, if known. */
  lat?: number;
  /** WGS-84 longitude of the case's current location, if known. */
  lng?: number;
  /** Human-readable location name, e.g. "Seattle, WA". */
  locationName?: string;
  /** Display name of the assigned technician/pilot, if any. */
  assigneeName?: string;
  /** Convex ID string of the mission this case belongs to, if any. */
  missionId?: string;
  /** Epoch ms timestamp of the most recent status change or update. */
  updatedAt: number;
  /**
   * Kinde user ID of the current physical custodian.
   * Resolved from the most recent custody record's `toUserId`.
   * Falls back to `cases.assigneeId` when no handoff has been recorded.
   */
  currentCustodianId?: string;
  /** Display name of the current physical custodian. */
  currentCustodianName?: string;
  /** Epoch ms of the most recent custody transfer.  Undefined if no handoff. */
  custodyTransferredAt?: number;
}

/**
 * M1 Fleet Overview API response envelope.
 *
 * Returned by GET /api/cases/map?mode=M1.
 *
 * Contains all cases passing the current viewport bounds + filter parameters,
 * plus a summary with global counts (un-filtered) for the status legend and
 * mode-selector badge.
 *
 * Discriminant: `mode === "M1"` — use this field to narrow a `MapDataResponse`
 * to M1Response in a type-safe switch or conditional.
 *
 * @example
 * const result = await fetchCasesMap({ mode: "M1" });
 * if (result.ok && result.data.mode === "M1") {
 *   const pins: M1CasePin[] = result.data.cases;
 * }
 */
export interface M1Response {
  /** Discriminant — always "M1". */
  mode: "M1";
  /** Server-side epoch ms when this response was assembled. */
  ts: number;
  /** Case pins within the requested viewport bounds. */
  cases: M1CasePin[];
  summary: {
    /** Total case count across ALL statuses (no filter applied). */
    total: number;
    /** Count of cases that have a lat/lng coordinate. */
    withLocation: number;
    /**
     * Case counts keyed by CaseStatus.
     * Only statuses with at least one case appear as keys (sparse map).
     * Missing keys imply a count of zero.
     */
    byStatus: Partial<Record<CaseStatus, number>>;
  };
}

// ── M2 types ──────────────────────────────────────────────────────────────────

/**
 * A single case nested inside an M2MissionGroup.
 *
 * Contains the same coordinate + assignment fields as M1CasePin, plus optional
 * custody state resolved from the latest custody handoff record.
 *
 * @see M2MissionGroup — the parent group that contains an array of these.
 */
export interface M2MissionCase {
  /** Convex document ID (string form). */
  _id: string;
  /** Human-readable case label, e.g. "CASE-0042". */
  label: string;
  /** Current lifecycle status of the case. */
  status: CaseStatus;
  /** WGS-84 latitude of the case's current location, if known. */
  lat?: number;
  /** WGS-84 longitude of the case's current location, if known. */
  lng?: number;
  /** Display name of the assigned technician/pilot, if any. */
  assigneeName?: string;
  /** Epoch ms timestamp of the most recent status change or update. */
  updatedAt: number;
  /** Current custodian Kinde user ID resolved from custody records. */
  currentCustodianId?: string;
  /** Current custodian display name resolved from custody records. */
  currentCustodianName?: string;
  /** Epoch ms of the most recent custody transfer. */
  custodyTransferredAt?: number;
}

/**
 * A case that is not assigned to any mission in M2 (Mission Mode).
 *
 * Includes the same base fields as M2MissionCase and appears in the
 * `M2Response.unassigned` array — rendered as ungrouped pins on the M2 map.
 */
export interface M2UnassignedCase {
  /** Convex document ID (string form). */
  _id: string;
  /** Human-readable case label, e.g. "CASE-0042". */
  label: string;
  /** Current lifecycle status of the case. */
  status: CaseStatus;
  /** WGS-84 latitude of the case's current location, if known. */
  lat?: number;
  /** WGS-84 longitude of the case's current location, if known. */
  lng?: number;
  /** Display name of the assigned technician/pilot, if any. */
  assigneeName?: string;
  /** Epoch ms timestamp of the most recent status change or update. */
  updatedAt: number;
  /** Current custodian Kinde user ID resolved from custody records. */
  currentCustodianId?: string;
  /** Current custodian display name resolved from custody records. */
  currentCustodianName?: string;
  /** Epoch ms of the most recent custody transfer. */
  custodyTransferredAt?: number;
}

/**
 * A mission group in M2 (Mission Mode).
 *
 * Groups all cases assigned to a single mission for the site-detail map view,
 * with aggregated status counts for the cluster badge and status legend.
 */
export interface M2MissionGroup {
  /** Convex document ID of the mission (string form). */
  _id: string;
  /** Mission display name. */
  name: string;
  /** Current mission lifecycle status. */
  status: MissionStatus;
  /** WGS-84 latitude of the mission site's coordinates, if known. */
  lat?: number;
  /** WGS-84 longitude of the mission site's coordinates, if known. */
  lng?: number;
  /** Human-readable location name, e.g. "Seattle, WA". */
  locationName?: string;
  /** Display name of the mission lead, if any. */
  leadName?: string;
  /** Total number of cases assigned to this mission. */
  caseCount: number;
  /**
   * Case counts keyed by CaseStatus for the status breakdown legend.
   * Only statuses with at least one case appear as keys (sparse map).
   */
  byStatus: Partial<Record<CaseStatus, number>>;
  /** Individual case pins for cases assigned to this mission. */
  cases: M2MissionCase[];
}

/**
 * M2 Mission Mode API response envelope.
 *
 * Returned by GET /api/cases/map?mode=M2.
 *
 * Groups cases by mission site for the site-detail map view.
 * Cases with no mission assignment appear in the `unassigned` array.
 *
 * Discriminant: `mode === "M2"` — use this field to narrow a `MapDataResponse`
 * to M2Response in a type-safe switch or conditional.
 *
 * @example
 * const result = await fetchCasesMap({ mode: "M2" });
 * if (result.ok && result.data.mode === "M2") {
 *   const groups: M2MissionGroup[] = result.data.missions;
 *   const unassigned: M2UnassignedCase[] = result.data.unassigned;
 * }
 */
export interface M2Response {
  /** Discriminant — always "M2". */
  mode: "M2";
  /** Server-side epoch ms when this response was assembled. */
  ts: number;
  /** Mission groups within the requested viewport bounds. */
  missions: M2MissionGroup[];
  /** Cases that are not assigned to any mission. */
  unassigned: M2UnassignedCase[];
  summary: {
    /** Total case count across all missions and unassigned. */
    total: number;
    /** Total mission count (regardless of status filter). */
    totalMissions: number;
    /**
     * Mission counts keyed by MissionStatus.
     * Only mission statuses with at least one mission appear as keys.
     */
    byMissionStatus: Partial<Record<MissionStatus, number>>;
  };
}

// ─── M3 types ─────────────────────────────────────────────────────────────────
//
// M3 (Field Mode) shows cases currently at field sites with real-time
// inspection progress overlays.  Only "deployed" and "flagged" cases appear.
//
// Shared base: M3CasePin extends M1CasePin (via Omit) with:
//   • A narrowed status union — only "deployed" | "flagged" are valid in M3
//   • Inspection progress fields — derived from the latest inspections record
//   • Custody state fields — inherited from M1CasePin without modification

// ── Inspection lifecycle status ───────────────────────────────────────────────

/**
 * Valid lifecycle statuses for a field inspection entity.
 *
 * Mirrors `InspectionStatusLiteral` in convex/maps.ts and the
 * `inspectionStatus` validator in convex/schema.ts.  Defined here to keep
 * M3 response shapes self-contained in this file.
 */
export type InspectionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "flagged";

/** All valid `InspectionStatus` values as a runtime array for validation. */
export const INSPECTION_STATUSES: InspectionStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "flagged",
];

// ── M3 map pin ────────────────────────────────────────────────────────────────

/**
 * Map pin for a single equipment case in M3 (Field Mode).
 *
 * Extends M1CasePin with a narrowed `status` union and inspection progress
 * fields.  Only "deployed" and "flagged" cases are emitted by the M3
 * assembler; the status type reflects this constraint at the type level.
 *
 * Custody state (`currentCustodianId`, `currentCustodianName`,
 * `custodyTransferredAt`) is inherited from M1CasePin and populated from
 * the latest custody handoff record — used in the M3 tooltip "Held by…".
 *
 * Inspection fields default to zero/undefined when no inspection record
 * exists for the case (field is present on-site but not yet inspected).
 *
 * @see M1CasePin — the base case pin shape this extends.
 * @see M3Response — the response envelope that carries an array of these pins.
 */
export interface M3CasePin extends Omit<M1CasePin, "status"> {
  /**
   * Current lifecycle status — always "deployed" or "flagged" in M3 results.
   * M3 filtering restricts to these two active field statuses; the union is
   * narrowed here so callers do not need to re-filter.
   */
  status: "deployed" | "flagged";

  // ── Inspection data ────────────────────────────────────────────────────────
  /** Convex ID of the latest inspection record for this case, if any. */
  inspectionId?: string;
  /** Lifecycle status of the latest inspection, if any. */
  inspectionStatus?: InspectionStatus;
  /** Display name of the technician who started the inspection. */
  inspectorName?: string;
  /** Number of checklist items reviewed (ok, damaged, or missing). */
  checkedItems: number;
  /** Total checklist items in the case's packing list. */
  totalItems: number;
  /** Count of items marked as damaged in the latest inspection. */
  damagedItems: number;
  /** Count of items marked as missing in the latest inspection. */
  missingItems: number;
  /**
   * Inspection completion percentage.
   * Computed as: Math.round(checkedItems / totalItems * 100).
   * Range: 0–100.  Equals 0 when totalItems is 0 or no inspection exists.
   */
  inspectionProgress: number;
}

/**
 * M3 Field Mode API response envelope.
 *
 * Returned by GET /api/cases/map?mode=M3.
 *
 * Contains only deployed/flagged cases with inspection progress overlays.
 * Used by the field inspection map view to show real-time inspection status.
 *
 * Discriminant: `mode === "M3"` — use this field to narrow a `MapDataResponse`
 * to M3Response in a type-safe switch or conditional.
 *
 * @example
 * const result = await fetchCasesMap({ mode: "M3" });
 * if (result.ok && result.data.mode === "M3") {
 *   const pins: M3CasePin[] = result.data.cases;
 *   const { totalDamaged, totalMissing } = result.data.summary;
 * }
 */
export interface M3Response {
  /** Discriminant — always "M3". */
  mode: "M3";
  /** Server-side epoch ms when this response was assembled. */
  ts: number;
  /** Field case pins (deployed + flagged status only). */
  cases: M3CasePin[];
  summary: {
    /** Total count of field cases (deployed + flagged) before bounds filter. */
    total: number;
    /**
     * Case counts keyed by InspectionStatus plus "none" for un-inspected cases.
     * Only statuses with at least one case appear as keys.
     */
    byInspectionStatus: Partial<Record<InspectionStatus | "none", number>>;
    /** Sum of damagedItems across all field cases. */
    totalDamaged: number;
    /** Sum of missingItems across all field cases. */
    totalMissing: number;
  };
}

// ─── M4 types ─────────────────────────────────────────────────────────────────
//
// M4 (Logistics Mode) shows active shipments with origin/destination/current
// position overlays.  Pins represent shipment records, not individual cases,
// so M4ShipmentPin is a standalone shape rather than an extension of M1CasePin.

// ── Shipment tracking status ──────────────────────────────────────────────────

/**
 * Valid FedEx/carrier shipment tracking status values.
 *
 * Mirrors `ShipmentStatusLiteral` in convex/maps.ts and the `shipmentStatus`
 * validator in convex/schema.ts.  Defined here to keep M4 response shapes
 * self-contained in this file.
 */
export type ShipmentStatus =
  | "label_created"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";

/** All valid `ShipmentStatus` values as a runtime array for validation. */
export const SHIPMENT_STATUSES: ShipmentStatus[] = [
  "label_created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
];

// ── M4 map pin ────────────────────────────────────────────────────────────────

/**
 * Map pin for a single active shipment in M4 (Logistics Mode).
 *
 * Represents a shipment record, not a case directly — the associated case is
 * referenced via `caseId` and `caseLabel` (denormalized).  This is a
 * standalone shape (not extending M1CasePin) because its primary entity is a
 * shipment rather than an equipment case.
 *
 * Destination coordinate fallback order:
 *   1. shipment.destinationLat/Lng  (updated by FedEx tracking refresh)
 *   2. case.destinationLat/Lng      (written by the `shipCase` mutation)
 *   3. undefined                    (new shipment, not yet geocoded)
 *
 * @see M4Response — the response envelope that carries an array of these pins.
 */
export interface M4ShipmentPin {
  /** Convex document ID of the shipment record (string form). */
  _id: string;
  /** Convex document ID of the associated case (string form). */
  caseId: string;
  /** Human-readable case label resolved from the cases table. */
  caseLabel: string;
  /** FedEx (or other carrier) tracking number. */
  trackingNumber: string;
  /** Carrier name, e.g. "FedEx". */
  carrier: string;
  /** Current FedEx shipment tracking status. */
  status: ShipmentStatus;
  /** Origin location (where the shipment was dispatched from). */
  origin: {
    /** WGS-84 latitude of the origin facility, if known. */
    lat?: number;
    /** WGS-84 longitude of the origin facility, if known. */
    lng?: number;
    /** Human-readable origin name, e.g. "Denver Base". */
    name?: string;
  };
  /** Destination location (where the shipment is headed). */
  destination: {
    /** WGS-84 latitude of the destination, if known. */
    lat?: number;
    /** WGS-84 longitude of the destination, if known. */
    lng?: number;
    /** Human-readable destination name, e.g. "Seattle Field Site". */
    name?: string;
  };
  /** Current WGS-84 latitude from live FedEx tracking, if available. */
  currentLat?: number;
  /** Current WGS-84 longitude from live FedEx tracking, if available. */
  currentLng?: number;
  /**
   * Estimated delivery date as an ISO-8601 date string (YYYY-MM-DD), if known.
   * Populated by the FedEx tracking API after the shipment is in transit.
   */
  estimatedDelivery?: string;
  /**
   * Epoch ms when the case was shipped (handed to carrier).
   * Uses shipment.shippedAt when available; falls back to case.shippedAt
   * (written by the `shipCase` mutation) for newly-created shipments before
   * the first FedEx tracking refresh.
   */
  shippedAt?: number;
  /** Epoch ms timestamp of the most recent tracking refresh or update. */
  updatedAt: number;
}

/**
 * M4 Logistics Mode API response envelope.
 *
 * Returned by GET /api/cases/map?mode=M4.
 *
 * Contains active shipments with origin/destination/current position overlays.
 * Used by the logistics map view for FedEx tracking and transit monitoring.
 *
 * Discriminant: `mode === "M4"` — use this field to narrow a `MapDataResponse`
 * to M4Response in a type-safe switch or conditional.
 *
 * @example
 * const result = await fetchCasesMap({ mode: "M4" });
 * if (result.ok && result.data.mode === "M4") {
 *   const pins: M4ShipmentPin[] = result.data.shipments;
 *   const { inTransit } = result.data.summary;
 * }
 */
export interface M4Response {
  /** Discriminant — always "M4". */
  mode: "M4";
  /** Server-side epoch ms when this response was assembled. */
  ts: number;
  /** Active shipment pins within the requested viewport bounds. */
  shipments: M4ShipmentPin[];
  summary: {
    /** Total shipment count across all statuses (no bounds filter applied). */
    total: number;
    /**
     * Shipment counts keyed by ShipmentStatus.
     * Only statuses with at least one shipment appear as keys.
     */
    byStatus: Partial<Record<ShipmentStatus, number>>;
    /**
     * Count of shipments actively moving ("in_transit" + "out_for_delivery").
     * Convenience field for the M4 logistics HUD badge.
     */
    inTransit: number;
  };
}

// ─── M5 types ─────────────────────────────────────────────────────────────────
//
// M5 (Mission Control) provides a density/heat view of the entire fleet plus a
// timeline replay scrubber.  Requires the FF_MAP_MISSION feature flag.
//
// All three M5 sub-types are standalone shapes — they represent geographic
// density clusters, heatmap weight points, and timeline snapshots rather than
// individual case or shipment pins.

/**
 * A geographic density cluster in M5 (Mission Control) mode.
 *
 * Each cluster represents one mission site and its associated cases.
 * The radius drives the visual rendering size in Mapbox GL pixels.
 *
 * @see M5Response — the response envelope that carries an array of these clusters.
 */
export interface M5Cluster {
  /** WGS-84 latitude of the cluster centroid (mission site). */
  lat: number;
  /** WGS-84 longitude of the cluster centroid (mission site). */
  lng: number;
  /** Total number of cases represented by this cluster. */
  count: number;
  /** Visual rendering radius in Mapbox GL pixels (default: 50). */
  radius: number;
  /**
   * Case counts keyed by CaseStatus for the cluster breakdown legend.
   * Only statuses present in this cluster appear as keys (sparse map).
   */
  byStatus: Partial<Record<CaseStatus, number>>;
  /** Convex mission IDs included in this cluster (string form). */
  missionIds: string[];
}

/**
 * A single point on the M5 density heatmap layer.
 *
 * Weight is normalized 0–1, derived from the case's operational status:
 *   1.0 = deployed     (actively in use — highest signal)
 *   0.9 = flagged      (on-site issues — high signal)
 *   0.5 = transit_out / transit_in
 *   0.3 = assembled
 *   0.1 = hangar / received
 *   0.0 = archived     (decommissioned — no signal)
 *
 * Only cases with both lat and lng contribute heatmap points.
 *
 * @see M5Response — the response envelope that carries an array of these points.
 */
export interface M5HeatmapPoint {
  /** WGS-84 latitude of the case position. */
  lat: number;
  /** WGS-84 longitude of the case position. */
  lng: number;
  /**
   * Normalized intensity weight for the Mapbox heatmap layer.
   * Range: 0.0 (low signal) – 1.0 (high signal).
   */
  weight: number;
}

/**
 * A single snapshot of the fleet status distribution at a point in time.
 *
 * Used by the M5 timeline replay scrubber to animate the historical fleet
 * status changes across the `startTs`–`endTs` window.  Snapshots are ordered
 * ascending by `ts`.
 *
 * Each numeric field is a case count for the named status at that moment.
 * A `total` convenience field carries the sum across all statuses.
 *
 * @see M5Response — the response envelope whose `timeline.snapshots` carries
 *   an ordered array of these.
 */
export interface M5TimelineSnapshot {
  /** Epoch ms of this snapshot. */
  ts: number;
  /** Count of cases in "hangar" status at this timestamp. */
  hangar: number;
  /** Count of cases in "assembled" status at this timestamp. */
  assembled: number;
  /** Count of cases in "transit_out" status at this timestamp. */
  transit_out: number;
  /** Count of cases in "deployed" status at this timestamp. */
  deployed: number;
  /** Count of cases in "flagged" status at this timestamp. */
  flagged: number;
  /** Count of cases in "transit_in" status at this timestamp. */
  transit_in: number;
  /** Count of cases in "received" status at this timestamp. */
  received: number;
  /** Count of cases in "archived" status at this timestamp. */
  archived: number;
  /** Total case count across all statuses at this timestamp. */
  total: number;
}

/**
 * M5 Mission Control API response envelope (requires FF_MAP_MISSION).
 *
 * Returned by GET /api/cases/map?mode=M5.
 *
 * When `featureEnabled` is false, `clusters`, `heatmap`, and
 * `timeline.snapshots` are empty arrays — callers should render a
 * feature-gated empty state rather than trying to render the map layers.
 *
 * Discriminant: `mode === "M5"` — use this field to narrow a `MapDataResponse`
 * to M5Response in a type-safe switch or conditional.
 *
 * @example
 * const result = await fetchCasesMap({ mode: "M5" });
 * if (result.ok && result.data.mode === "M5") {
 *   if (!result.data.featureEnabled) return <FeatureGate />;
 *   const { clusters, heatmap, timeline } = result.data;
 * }
 */
export interface M5Response {
  /** Discriminant — always "M5". */
  mode: "M5";
  /** Server-side epoch ms when this response was assembled. */
  ts: number;
  /**
   * Whether the FF_MAP_MISSION feature flag is currently enabled.
   * When false, clusters/heatmap/snapshots are empty arrays.
   */
  featureEnabled: boolean;
  /** Geographic density clusters (one per mission site with coordinates). */
  clusters: M5Cluster[];
  /** Heatmap points derived from all cases with coordinates. */
  heatmap: M5HeatmapPoint[];
  /**
   * Timeline data for the replay scrubber.
   * `startTs`/`endTs` define the scrubber range (default: last 30 days).
   */
  timeline: {
    /** Epoch ms start of the timeline window. */
    startTs: number;
    /** Epoch ms end of the timeline window (typically "now"). */
    endTs: number;
    /** Status distribution snapshots ordered by ascending ts. */
    snapshots: M5TimelineSnapshot[];
  };
  summary: {
    /** Total case count in the fleet (no bounds filter). */
    totalCases: number;
    /** Total mission count in the system. */
    totalMissions: number;
    /** Count of missions with status "active". */
    activeMissions: number;
    /**
     * Count of clusters with at least one deployed or flagged case.
     * Represents regions with active operational presence.
     */
    activeRegions: number;
    /**
     * Case counts keyed by CaseStatus for the fleet status legend.
     * Only statuses with at least one case appear as keys.
     */
    byStatus: Partial<Record<CaseStatus, number>>;
  };
}
