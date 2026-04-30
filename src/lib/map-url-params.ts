/**
 * URL parameter read/write utilities for INVENTORY map state.
 *
 * Parameters
 * ──────────
 *   view    MapView enum          "M1" | "M2" | "M3" | "M4" | "M5"
 *   case    Convex record ID      opaque string (URL-safe)
 *   window  CaseWindow enum       "T1" | "T2" | "T3" | "T4" | "T5"
 *   layers  LayerId[]             comma-separated list
 *   org     Convex record ID      opaque string (URL-safe)
 *   kit     Convex record ID      opaque string (URL-safe)
 *   at      ISO-8601 timestamp    e.g. "2025-06-01T14:30:00.000Z"
 *
 * Design decisions
 * ────────────────
 * • All functions are pure — they receive/return plain objects, never
 *   mutate the browser location directly.  Call-sites (hooks, route
 *   handlers) decide when to push / replace history.
 * • Missing or invalid params fall back to MAP_URL_STATE_DEFAULTS so
 *   URLs are minimal (only divergences from defaults need to appear).
 * • Encoding is intentionally human-readable (no base64 blobs).
 * • ID fields (case, org, kit) are treated as opaque strings; we only
 *   validate that they are non-empty after trimming.
 */

import {
  type CaseWindow,
  type LayerId,
  type MapUrlState,
  type MapView,
  LAYER_IDS,
  MAP_URL_STATE_DEFAULTS,
  isCaseWindow,
  isLayerId,
  isMapView,
} from "@/types/map";
import {
  type SemanticLayerId,
  SEMANTIC_LAYER_IDS,
  isSemanticLayerId,
} from "@/types/layer-engine";

// ─── ID sanitization constants ────────────────────────────────────────────────

/**
 * Maximum allowed length for Convex ID fields (`case`, `org`, `kit`).
 *
 * Values longer than this are silently truncated to prevent unbounded URL
 * lengths and potential DoS via extremely large state objects.
 *
 * Convex IDs are typically ≤ 32 chars; 128 gives generous room for future
 * growth while still bounding the attack surface.
 */
export const MAX_ID_LENGTH = 128;

/**
 * Regex that matches ASCII control characters (0x00–0x1F and DEL 0x7F).
 *
 * These are never valid in a Convex ID and must be stripped before the
 * value is used in any query or state comparison.
 */
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/g;

// ─── Param key names ──────────────────────────────────────────────────────────

export const PARAM = {
  VIEW: "view",
  CASE: "case",
  WINDOW: "window",
  PANEL: "panel",
  LAYERS: "layers",
  /**
   * Semantic data layers — comma-separated SemanticLayerIds.
   * Distinct from the `layers` param (which holds map *overlay* LayerIds
   * such as cases / clusters / satellite); `slayers` holds the toggle state
   * of the LayerTogglePanel's 7 semantic data layers.
   */
  SLAYERS: "slayers",
  ORG: "org",
  KIT: "kit",
  AT: "at",
} as const;

export type ParamKey = (typeof PARAM)[keyof typeof PARAM];

// ─── Primitive helpers ────────────────────────────────────────────────────────

/**
 * Parse a single `view` param.
 * Returns the default when the param is absent or invalid.
 */
export function parseView(raw: string | null | undefined): MapView {
  if (!raw) return MAP_URL_STATE_DEFAULTS.view;
  const trimmed = raw.trim().toUpperCase();
  return isMapView(trimmed) ? trimmed : MAP_URL_STATE_DEFAULTS.view;
}

/**
 * Serialize `view` for use in a URLSearchParams.
 * Returns undefined when the value equals the default (omit from URL).
 */
export function serializeView(view: MapView): string | undefined {
  return view === MAP_URL_STATE_DEFAULTS.view ? undefined : view;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse and sanitize a case (or org / kit) Convex ID param.
 *
 * Sanitization pipeline (applied in order):
 *   1. Reject `null` / `undefined` → `null`.
 *   2. Reject empty string `""` → `null`.
 *   3. Strip ASCII control characters (NUL bytes, tab, CR/LF, etc.)
 *      to prevent injection through URL-encoded control sequences.
 *   4. Trim leading / trailing whitespace.
 *   5. Reject blank-after-strip value → `null`.
 *   6. Clamp to `MAX_ID_LENGTH` to bound URL length and prevent DoS.
 *
 * Returns `null` when the value is absent or reduces to empty after
 * sanitization; returns the sanitized string otherwise.
 */
export function parseId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Strip control characters, then whitespace
  const stripped = raw.replace(CONTROL_CHAR_RE, "").trim();
  if (stripped.length === 0) return null;
  // Clamp to prevent abuse
  return stripped.length <= MAX_ID_LENGTH
    ? stripped
    : stripped.slice(0, MAX_ID_LENGTH);
}

/**
 * Serialize an ID param.
 * Returns undefined when null (omit from URL).
 */
export function serializeId(id: string | null): string | undefined {
  return id ?? undefined;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a `window` (case detail layout) param.
 * Returns the default when absent or invalid.
 */
export function parseWindow(raw: string | null | undefined): CaseWindow {
  if (!raw) return MAP_URL_STATE_DEFAULTS.window;
  const trimmed = raw.trim().toUpperCase();
  return isCaseWindow(trimmed) ? trimmed : MAP_URL_STATE_DEFAULTS.window;
}

/**
 * Serialize `window`.
 * Returns undefined when equal to default.
 */
export function serializeWindow(window: CaseWindow): string | undefined {
  return window === MAP_URL_STATE_DEFAULTS.window ? undefined : window;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the `panel` (case detail panel open state) param.
 *
 * The param is treated as a boolean flag:
 *   "1" | "true"  → true  (panel is open)
 *   anything else → false (panel is closed / param absent)
 *
 * Returns the default (false) when the param is absent or has any value
 * other than "1" or "true".
 */
export function parsePanelOpen(raw: string | null | undefined): boolean {
  if (!raw) return MAP_URL_STATE_DEFAULTS.panelOpen;
  const trimmed = raw.trim().toLowerCase();
  return trimmed === "1" || trimmed === "true";
}

/**
 * Serialize `panelOpen`.
 * Returns "1" when true; undefined when false (omit from URL).
 */
export function serializePanelOpen(open: boolean): string | undefined {
  return open ? "1" : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Layer list separator used in the URL (comma, no space). */
const LAYERS_SEPARATOR = ",";

/**
 * Parse a comma-separated `layers` param.
 *
 * Rules:
 *   • Unknown layer IDs are silently dropped.
 *   • Duplicate IDs are de-duplicated (first occurrence wins).
 *   • Empty string / null → default layers.
 */
export function parseLayers(raw: string | null | undefined): LayerId[] {
  if (!raw || raw.trim().length === 0) {
    return [...MAP_URL_STATE_DEFAULTS.layers];
  }

  const seen = new Set<LayerId>();
  const result: LayerId[] = [];

  for (const token of raw.split(LAYERS_SEPARATOR)) {
    const id = token.trim().toLowerCase();
    if (isLayerId(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  return result.length > 0 ? result : [...MAP_URL_STATE_DEFAULTS.layers];
}

/**
 * Serialize a layer list.
 * Returns undefined when the list equals the default (order-insensitive).
 */
export function serializeLayers(layers: LayerId[]): string | undefined {
  const defaults = MAP_URL_STATE_DEFAULTS.layers;
  const sorted = [...layers].sort();
  const defaultSorted = [...defaults].sort();

  if (
    sorted.length === defaultSorted.length &&
    sorted.every((l, i) => l === defaultSorted[i])
  ) {
    return undefined; // no need to encode
  }

  return layers.join(LAYERS_SEPARATOR);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a comma-separated `slayers` (semantic-layers) URL param.
 *
 * The `slayers` param holds the 7-layer toggle visibility set used by the
 * LayerTogglePanel — distinct from `layers`, which holds the 8-layer map
 * overlay set.
 *
 * Rules:
 *   • Unknown SemanticLayerIds are silently dropped.
 *   • Duplicates are de-duplicated (first occurrence wins).
 *   • Empty / null / all-invalid → MAP_URL_STATE_DEFAULTS.slayers.
 *
 * @example parseSlayers("deployed,flagged") → ["deployed","flagged"]
 * @example parseSlayers("bogus")            → MAP_URL_STATE_DEFAULTS.slayers
 */
export function parseSlayers(
  raw: string | null | undefined
): SemanticLayerId[] {
  if (!raw || raw.trim().length === 0) {
    return [...MAP_URL_STATE_DEFAULTS.slayers];
  }

  const seen = new Set<SemanticLayerId>();
  const result: SemanticLayerId[] = [];

  for (const token of raw.split(LAYERS_SEPARATOR)) {
    const id = token.trim().toLowerCase();
    if (isSemanticLayerId(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  return result.length > 0 ? result : [...MAP_URL_STATE_DEFAULTS.slayers];
}

/**
 * Serialize a semantic-layer list to a URL param string.
 * Returns undefined when the list equals the default (order-insensitive),
 * keeping the URL minimal.
 *
 * @example serializeSlayers(DEFAULT_SLAYERS)               → undefined
 * @example serializeSlayers(["deployed","flagged"])         → "deployed,flagged"
 */
export function serializeSlayers(
  slayers: SemanticLayerId[]
): string | undefined {
  const defaults = MAP_URL_STATE_DEFAULTS.slayers;
  const sorted = [...slayers].sort();
  const defaultSorted = [...defaults].sort();

  if (
    sorted.length === defaultSorted.length &&
    sorted.every((l, i) => l === defaultSorted[i])
  ) {
    return undefined; // no need to encode
  }

  return slayers.join(LAYERS_SEPARATOR);
}

// ─────────────────────────────────────────────────────────────────────────────

/** ISO-8601 regexp (basic check – full validation deferred to Date constructor). */
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Parse a `at` (mission-replay timestamp) param.
 * Returns null when absent, non-ISO, or resulting in an invalid Date.
 */
export function parseAt(raw: string | null | undefined): Date | null {
  if (!raw || raw.trim().length === 0) return null;
  const trimmed = raw.trim();
  if (!ISO_RE.test(trimmed)) return null;
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Serialize an `at` timestamp to its ISO-8601 string.
 * Returns undefined when null.
 */
export function serializeAt(at: Date | null): string | undefined {
  return at ? at.toISOString() : undefined;
}

// ─── Aggregate encode / decode ────────────────────────────────────────────────

/**
 * Decode the full MapUrlState from a URLSearchParams (or any object
 * with a `.get(key)` method, including Next.js `ReadonlyURLSearchParams`).
 *
 * Every param defaults gracefully – an empty search string yields
 * MAP_URL_STATE_DEFAULTS exactly.
 *
 * @example
 * const params = new URLSearchParams(window.location.search);
 * const state = decodeMapUrlState(params);
 */
export function decodeMapUrlState(
  params: { get(key: string): string | null }
): MapUrlState {
  return {
    view: parseView(params.get(PARAM.VIEW)),
    case: parseId(params.get(PARAM.CASE)),
    window: parseWindow(params.get(PARAM.WINDOW)),
    panelOpen: parsePanelOpen(params.get(PARAM.PANEL)),
    layers: parseLayers(params.get(PARAM.LAYERS)),
    slayers: parseSlayers(params.get(PARAM.SLAYERS)),
    org: parseId(params.get(PARAM.ORG)),
    kit: parseId(params.get(PARAM.KIT)),
    at: parseAt(params.get(PARAM.AT)),
  };
}

/**
 * Encode a (partial) MapUrlState into a URLSearchParams.
 *
 * Only params that differ from their defaults are included, keeping
 * URLs minimal and shareable.
 *
 * @example
 * const params = encodeMapUrlState({ view: "M2", case: "abc123" });
 * router.push(`/inventory?${params.toString()}`);
 */
export function encodeMapUrlState(
  state: Partial<MapUrlState>
): URLSearchParams {
  const params = new URLSearchParams();

  const view = state.view ?? MAP_URL_STATE_DEFAULTS.view;
  const serializedView = serializeView(view);
  if (serializedView !== undefined) params.set(PARAM.VIEW, serializedView);

  const caseId = state.case ?? MAP_URL_STATE_DEFAULTS.case;
  const serializedCase = serializeId(caseId);
  if (serializedCase !== undefined) params.set(PARAM.CASE, serializedCase);

  const win = state.window ?? MAP_URL_STATE_DEFAULTS.window;
  const serializedWindow = serializeWindow(win);
  if (serializedWindow !== undefined) params.set(PARAM.WINDOW, serializedWindow);

  const panelOpen = state.panelOpen ?? MAP_URL_STATE_DEFAULTS.panelOpen;
  const serializedPanel = serializePanelOpen(panelOpen);
  if (serializedPanel !== undefined) params.set(PARAM.PANEL, serializedPanel);

  const layers = state.layers ?? MAP_URL_STATE_DEFAULTS.layers;
  const serializedLayers = serializeLayers(layers);
  if (serializedLayers !== undefined) params.set(PARAM.LAYERS, serializedLayers);

  const slayers = state.slayers ?? MAP_URL_STATE_DEFAULTS.slayers;
  const serializedSlayers = serializeSlayers(slayers);
  if (serializedSlayers !== undefined)
    params.set(PARAM.SLAYERS, serializedSlayers);

  const org = state.org ?? MAP_URL_STATE_DEFAULTS.org;
  const serializedOrg = serializeId(org);
  if (serializedOrg !== undefined) params.set(PARAM.ORG, serializedOrg);

  const kit = state.kit ?? MAP_URL_STATE_DEFAULTS.kit;
  const serializedKit = serializeId(kit);
  if (serializedKit !== undefined) params.set(PARAM.KIT, serializedKit);

  const at = state.at ?? MAP_URL_STATE_DEFAULTS.at;
  const serializedAt = serializeAt(at);
  if (serializedAt !== undefined) params.set(PARAM.AT, serializedAt);

  return params;
}

/**
 * Merge a partial state patch into an existing state and re-encode.
 *
 * Useful for updating a single param while preserving the rest.
 *
 * @example
 * // User clicked to switch to M3 view
 * const params = mergeMapUrlState(currentState, { view: "M3" });
 * router.push(`/inventory?${params.toString()}`);
 */
export function mergeMapUrlState(
  current: MapUrlState,
  patch: Partial<MapUrlState>
): URLSearchParams {
  return encodeMapUrlState({ ...current, ...patch });
}

/**
 * Build a plain-object diff between two MapUrlState values.
 * Returns only the keys that changed — useful for analytics / debugging.
 */
export function diffMapUrlState(
  prev: MapUrlState,
  next: MapUrlState
): Partial<MapUrlState> {
  const diff: Partial<MapUrlState> = {};

  if (prev.view !== next.view) diff.view = next.view;
  if (prev.case !== next.case) diff.case = next.case;
  if (prev.window !== next.window) diff.window = next.window;
  if (prev.panelOpen !== next.panelOpen) diff.panelOpen = next.panelOpen;
  if (prev.org !== next.org) diff.org = next.org;
  if (prev.kit !== next.kit) diff.kit = next.kit;

  // Layers: compare as sorted strings
  const prevLayers = [...prev.layers].sort().join(",");
  const nextLayers = [...next.layers].sort().join(",");
  if (prevLayers !== nextLayers) diff.layers = next.layers;

  // Semantic layers (slayers): compare as sorted strings
  const prevSlayers = [...prev.slayers].sort().join(",");
  const nextSlayers = [...next.slayers].sort().join(",");
  if (prevSlayers !== nextSlayers) diff.slayers = next.slayers;

  // at: compare timestamps numerically
  const prevAt = prev.at?.getTime() ?? null;
  const nextAt = next.at?.getTime() ?? null;
  if (prevAt !== nextAt) diff.at = next.at;

  return diff;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Validate a MapUrlState and return any validation errors.
 * Returns an empty array when the state is valid.
 *
 * Useful for logging or surfacing URL-tampering issues.
 */
export function validateMapUrlState(state: MapUrlState): string[] {
  const errors: string[] = [];

  if (!isMapView(state.view)) {
    errors.push(`Invalid view "${state.view}". Must be one of M1-M5.`);
  }

  if (!isCaseWindow(state.window)) {
    errors.push(`Invalid window "${state.window}". Must be one of T1-T5.`);
  }

  if (typeof state.panelOpen !== "boolean") {
    errors.push(`Invalid panelOpen "${String(state.panelOpen)}". Must be a boolean.`);
  }

  const invalidLayers = state.layers.filter((l) => !isLayerId(l));
  if (invalidLayers.length > 0) {
    errors.push(
      `Invalid layer IDs: ${invalidLayers.join(", ")}. Valid: ${LAYER_IDS.join(", ")}.`
    );
  }

  const invalidSlayers = state.slayers.filter((l) => !isSemanticLayerId(l));
  if (invalidSlayers.length > 0) {
    errors.push(
      `Invalid semantic layer IDs: ${invalidSlayers.join(", ")}. Valid: ${SEMANTIC_LAYER_IDS.join(", ")}.`
    );
  }

  if (state.at !== null && !(state.at instanceof Date)) {
    errors.push("Field 'at' must be a Date object or null.");
  }

  if (state.at !== null && state.at instanceof Date && isNaN(state.at.getTime())) {
    errors.push("Field 'at' contains an invalid Date.");
  }

  return errors;
}

/**
 * Type-safe guard for checking whether a MapUrlState is fully valid.
 */
export function isValidMapUrlState(state: MapUrlState): boolean {
  return validateMapUrlState(state).length === 0;
}

// ─── Deep-link sanitization ───────────────────────────────────────────────────

/**
 * Result returned by `sanitizeMapDeepLink`.
 */
export interface DeepLinkSanitizeResult {
  /**
   * Fully validated, sanitized `MapUrlState` ready for hydration.
   *
   * Every field is guaranteed to be a valid value (or its default).
   * No field will contain control characters, over-long strings, unknown
   * enum values, or malformed timestamps.
   */
  state: MapUrlState;

  /**
   * Human-readable descriptions of every param that was sanitized or
   * defaulted because the raw URL value was absent or invalid.
   *
   * Empty when the URL was fully clean — useful for dev-mode logging and
   * analytics to detect URL-tampering or stale bookmarks.
   */
  warnings: string[];
}

/**
 * Internal helper — determine whether a raw ID string was changed by
 * `parseId` in a non-trivial way (control char stripping or truncation),
 * versus simple whitespace trimming which is always silent.
 */
function idWasSanitized(raw: string): boolean {
  // Control characters were present
  if (CONTROL_CHAR_RE.test(raw)) return true;
  // Value exceeded the length limit after trimming
  const trimmed = raw.trim();
  if (trimmed.length > MAX_ID_LENGTH) return true;
  return false;
}

/**
 * Sanitize and validate every map URL parameter before hydrating state.
 *
 * This is the **authoritative entry point** for converting raw URL search
 * params into a typed `MapUrlState`.  It wraps the individual `parse*`
 * helpers and additionally:
 *
 *   • Detects per-param sanitization events and collects human-readable
 *     `warnings` (useful for dev-mode logging or analytics).
 *   • Guarantees that the returned `state` passes `isValidMapUrlState`.
 *   • Never throws — all failures result in the affected param's default.
 *
 * Call this function instead of `decodeMapUrlState` when you need
 * observability into what was sanitized (e.g., in the Provider during
 * initial hydration).
 *
 * @param params  Any object with a `.get(key)` method — compatible with
 *                `URLSearchParams`, Next.js `ReadonlyURLSearchParams`, and
 *                the test adapters used in unit tests.
 *
 * @example
 * const { state, warnings } = sanitizeMapDeepLink(searchParams);
 * if (warnings.length && process.env.NODE_ENV === "development") {
 *   warnings.forEach((w) => console.warn("[MapStateProvider]", w));
 * }
 * return state; // safe to hydrate
 */
export function sanitizeMapDeepLink(
  params: { get(key: string): string | null }
): DeepLinkSanitizeResult {
  const warnings: string[] = [];

  // ── view ────────────────────────────────────────────────────────────
  const rawView = params.get(PARAM.VIEW);
  const view = parseView(rawView);
  if (rawView !== null) {
    const normalised = rawView.trim().toUpperCase();
    if (!isMapView(normalised)) {
      warnings.push(
        `Deep-link param "view": "${rawView}" is not a valid map view — defaulted to "${view}".`
      );
    }
  }

  // ── case ────────────────────────────────────────────────────────────
  const rawCase = params.get(PARAM.CASE);
  const caseId = parseId(rawCase);
  if (rawCase !== null && rawCase.length > 0) {
    if (caseId === null) {
      warnings.push(
        `Deep-link param "case": "${rawCase.slice(0, 60)}" resolved to null after sanitization (whitespace-only or only control characters).`
      );
    } else if (idWasSanitized(rawCase)) {
      warnings.push(
        `Deep-link param "case": value was sanitized (control characters stripped${
          rawCase.trim().length > MAX_ID_LENGTH
            ? ` and truncated from ${rawCase.trim().length} to ${MAX_ID_LENGTH} chars`
            : ""
        }).`
      );
    }
  }

  // ── window ──────────────────────────────────────────────────────────
  const rawWindow = params.get(PARAM.WINDOW);
  const win = parseWindow(rawWindow);
  if (rawWindow !== null) {
    const normalised = rawWindow.trim().toUpperCase();
    if (!isCaseWindow(normalised)) {
      warnings.push(
        `Deep-link param "window": "${rawWindow}" is not a valid case window — defaulted to "${win}".`
      );
    }
  }

  // ── panel ───────────────────────────────────────────────────────────
  const rawPanel = params.get(PARAM.PANEL);
  const panelOpen = parsePanelOpen(rawPanel);
  // No warning needed for panel — any unrecognised value safely falls
  // back to false (closed), which is always a valid UI state.

  // ── layers ──────────────────────────────────────────────────────────
  const rawLayers = params.get(PARAM.LAYERS);
  const layers = parseLayers(rawLayers);
  if (rawLayers !== null && rawLayers.trim().length > 0) {
    const tokens = rawLayers
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const unknown = tokens.filter((t) => !isLayerId(t));
    if (unknown.length > 0) {
      warnings.push(
        `Deep-link param "layers": unknown layer ID(s) ignored — ${unknown.join(", ")}.`
      );
    }

    // Detect duplicates
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const t of tokens) {
      if (isLayerId(t)) {
        if (seen.has(t)) dupes.push(t);
        else seen.add(t);
      }
    }
    if (dupes.length > 0) {
      warnings.push(
        `Deep-link param "layers": duplicate layer ID(s) removed — ${dupes.join(", ")}.`
      );
    }

    // Warn if all tokens were unknown → fell back to defaults
    const knownTokens = tokens.filter((t) => isLayerId(t));
    if (knownTokens.length === 0 && tokens.length > 0) {
      warnings.push(
        `Deep-link param "layers": all provided IDs were invalid — defaulted to ${MAP_URL_STATE_DEFAULTS.layers.join(",")}.`
      );
    }
  }

  // ── slayers (semantic layers) ───────────────────────────────────────
  const rawSlayers = params.get(PARAM.SLAYERS);
  const slayers = parseSlayers(rawSlayers);
  if (rawSlayers !== null && rawSlayers.trim().length > 0) {
    const tokens = rawSlayers
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const unknown = tokens.filter((t) => !isSemanticLayerId(t));
    if (unknown.length > 0) {
      warnings.push(
        `Deep-link param "slayers": unknown semantic layer ID(s) ignored — ${unknown.join(", ")}.`
      );
    }

    // Detect duplicates
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const t of tokens) {
      if (isSemanticLayerId(t)) {
        if (seen.has(t)) dupes.push(t);
        else seen.add(t);
      }
    }
    if (dupes.length > 0) {
      warnings.push(
        `Deep-link param "slayers": duplicate semantic layer ID(s) removed — ${dupes.join(", ")}.`
      );
    }

    // Warn if all tokens were unknown → fell back to defaults
    const knownTokens = tokens.filter((t) => isSemanticLayerId(t));
    if (knownTokens.length === 0 && tokens.length > 0) {
      warnings.push(
        `Deep-link param "slayers": all provided IDs were invalid — defaulted to ${MAP_URL_STATE_DEFAULTS.slayers.join(",")}.`
      );
    }
  }

  // ── org ─────────────────────────────────────────────────────────────
  const rawOrg = params.get(PARAM.ORG);
  const org = parseId(rawOrg);
  if (rawOrg !== null && rawOrg.length > 0) {
    if (org === null) {
      warnings.push(
        `Deep-link param "org": "${rawOrg.slice(0, 60)}" resolved to null after sanitization.`
      );
    } else if (idWasSanitized(rawOrg)) {
      warnings.push(
        `Deep-link param "org": value was sanitized (control characters stripped${
          rawOrg.trim().length > MAX_ID_LENGTH
            ? ` and truncated from ${rawOrg.trim().length} to ${MAX_ID_LENGTH} chars`
            : ""
        }).`
      );
    }
  }

  // ── kit ─────────────────────────────────────────────────────────────
  const rawKit = params.get(PARAM.KIT);
  const kit = parseId(rawKit);
  if (rawKit !== null && rawKit.length > 0) {
    if (kit === null) {
      warnings.push(
        `Deep-link param "kit": "${rawKit.slice(0, 60)}" resolved to null after sanitization.`
      );
    } else if (idWasSanitized(rawKit)) {
      warnings.push(
        `Deep-link param "kit": value was sanitized (control characters stripped${
          rawKit.trim().length > MAX_ID_LENGTH
            ? ` and truncated from ${rawKit.trim().length} to ${MAX_ID_LENGTH} chars`
            : ""
        }).`
      );
    }
  }

  // ── at ──────────────────────────────────────────────────────────────
  const rawAt = params.get(PARAM.AT);
  const at = parseAt(rawAt);
  if (rawAt !== null && rawAt.trim().length > 0 && at === null) {
    warnings.push(
      `Deep-link param "at": "${rawAt.slice(0, 60)}" is not a valid ISO-8601 timestamp — nullified.`
    );
  }

  const state: MapUrlState = {
    view,
    case: caseId,
    window: win,
    panelOpen,
    layers,
    slayers,
    org,
    kit,
    at,
  };

  return { state, warnings };
}
