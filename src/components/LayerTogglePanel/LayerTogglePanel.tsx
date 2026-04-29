/**
 * LayerTogglePanel — Map layer visibility toggle panel.
 *
 * Renders a floating panel (positioned over the map) with a header and
 * 7 individual toggle controls, one per semantic map layer.
 *
 * Operating modes
 * ───────────────
 *
 * Sub-AC 2 — Semi-uncontrolled (local state):
 *   When `layerState` is NOT provided, each toggle maintains its own on/off
 *   state via React.useState, initialized from the `activeLayers` prop.
 *   Toggling updates local state immediately while also notifying the parent
 *   via the `onToggleLayer` callback.
 *
 * Sub-AC 3 — Fully controlled (engine-wired):
 *   When `layerState` is provided (a Record<LayerSlotId, boolean>), the panel
 *   reads visibility exclusively from that record.  No local state is used for
 *   rendering.  Toggle clicks still call `onToggleLayer(layerId)` — the parent
 *   (typically `LayerTogglePanelConnected`) is responsible for dispatching the
 *   action to the `LayerEngine`.  This enables the engine to propagate changes
 *   from other sources (keyboard shortcuts, URL restore, activateAll/reset)
 *   back to the panel through the `layerState` prop change.
 *
 * 7 semantic layer slots (matching design token §7):
 *   1. deployed  — Deployed Cases  (green)
 *   2. transit   — Transit Routes  (brand blue)
 *   3. flagged   — Flagged Cases   (orange)
 *   4. hangar    — In Hangar       (indigo)
 *   5. heat      — Activity Heat   (magenta)
 *   6. history   — Event History   (neutral gray)
 *   7. turbines  — Turbine Sites   (lime)
 *
 * Layout:
 *   - `.root`         — absolute-positioned floating panel (map overlay)
 *   - `.header`       — panel chrome: title + close affordance
 *   - `.body`         — scrollable list of toggle rows
 *   - `.toggleRow`    — one row per layer: swatch + label + accessible toggle
 *
 * Design constraints:
 *   - All colors via CSS custom properties (var(--layer-*) tokens from §7)
 *   - No hex literals in component or CSS module
 *   - Inter Tight for UI text, IBM Plex Mono for the layer ID codes
 *   - WCAG AA contrast in both light and dark themes
 *   - Reduced-motion safe (no keyframe animations)
 *   - WCAG AA: each <input> has an explicit <label> (htmlFor) + aria-label
 */

"use client";

import { useState, useCallback } from "react";
import styles from "./LayerTogglePanel.module.css";

// ─── Layer slot descriptors ───────────────────────────────────────────────────

/**
 * Identifies one of the 7 semantic map data layers.
 * Names match the --layer-{id}-* CSS custom property set in §7 of base.css.
 */
export type LayerSlotId =
  | "deployed"
  | "transit"
  | "flagged"
  | "hangar"
  | "heat"
  | "history"
  | "turbines";

/** Ordered array of the 7 layer slot IDs. */
export const LAYER_SLOT_IDS: LayerSlotId[] = [
  "deployed",
  "transit",
  "flagged",
  "hangar",
  "heat",
  "history",
  "turbines",
];

/** Human-readable labels for each layer slot. */
const LAYER_LABELS: Record<LayerSlotId, string> = {
  deployed: "Deployed Cases",
  transit:  "Transit Routes",
  flagged:  "Flagged Cases",
  hangar:   "In Hangar",
  heat:     "Activity Heat",
  history:  "Event History",
  turbines: "Turbine Sites",
};

/** Short description shown below the label on each toggle row. */
const LAYER_DESCRIPTIONS: Record<LayerSlotId, string> = {
  deployed: "Cases at active deployment sites",
  transit:  "Cases currently in transit (FedEx)",
  flagged:  "Cases with open damage or inspection flags",
  hangar:   "Cases stored at the base facility",
  heat:     "Activity density heat map overlay",
  history:  "Historical case event locations",
  turbines: "Wind turbine site markers",
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LayerTogglePanelProps {
  /**
   * HTML id for the panel's root <aside> element.
   *
   * Required when the panel's visibility is controlled by a toolbar button
   * that uses `aria-controls` to reference this panel by ID.
   *
   * @example
   *   <button aria-controls="m1-layer-panel" aria-expanded={open} />
   *   <LayerTogglePanel id="m1-layer-panel" ... />
   */
  id?: string;

  /**
   * Whether the panel is visible.
   * When false the panel is hidden via CSS (aria-hidden + display:none).
   * Default: true.
   */
  open?: boolean;

  /**
   * Set of currently-active layer slot IDs.
   * Used in Sub-AC 2 (uncontrolled mode) as the initial visibility state.
   * Only applied on first mount — subsequent changes do NOT re-sync the
   * local state (use `layerState` for fully controlled / engine-wired mode).
   * Default: all 7 layers active.
   *
   * Ignored when `layerState` is provided (controlled mode).
   */
  activeLayers?: LayerSlotId[];

  /**
   * Sub-AC 3 — Fully controlled mode.
   *
   * When provided, the panel reads layer visibility exclusively from this
   * record and does NOT maintain its own local state for rendering.
   * Every key in `LayerSlotId` must be present with a boolean value.
   *
   * Toggle clicks still call `onToggleLayer(layerId)` so the parent can
   * dispatch the action to the `LayerEngine`.  The parent is responsible
   * for updating `layerState` in response (typically by the engine emitting
   * a new state snapshot to a `useSyncExternalStore` subscriber).
   *
   * When this prop is provided:
   *   - `activeLayers` is ignored for rendering (only used as the initial
   *     value for internal local state, which itself is not used for display)
   *   - Footer count is derived from `layerState`, not local state
   *   - `aria-label` on each toggle input is derived from `layerState`
   *
   * @example
   *   // Engine-wired usage (see LayerTogglePanelConnected):
   *   const { state, toggle } = useSharedLayerEngine();
   *   <LayerTogglePanel layerState={state} onToggleLayer={toggle} />
   */
  layerState?: Record<LayerSlotId, boolean>;

  /**
   * Called when the user clicks a toggle row.
   * In uncontrolled mode (Sub-AC 2): notification callback fired after
   *   local state has already been updated.
   * In controlled mode (Sub-AC 3, `layerState` provided): the sole
   *   mechanism for communicating toggle intent to the engine — the parent
   *   MUST update `layerState` in response to keep the panel in sync.
   */
  onToggleLayer?: (layerId: LayerSlotId) => void;

  /**
   * Called when the user clicks the panel's close button.
   */
  onClose?: () => void;

  /**
   * Positional variant: where the panel anchors on the map.
   *   "top-right"   (default) — overlays top-right corner of the map
   *   "top-left"    — overlays top-left corner
   *   "bottom-right"— overlays bottom-right corner
   */
  position?: "top-right" | "top-left" | "bottom-right";

  /** Additional class name applied to the root element. */
  className?: string;

  /** Accessible label for the panel (forwarded to aria-label). */
  "aria-label"?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Floating map overlay panel with 7 individual layer toggle controls.
 *
 * Supports two operating modes:
 *
 * Sub-AC 2 — Local component state (uncontrolled / semi-uncontrolled).
 *   When `layerState` prop is NOT provided, each toggle maintains its own
 *   on/off state via useState, initialized from the `activeLayers` prop on
 *   first mount.  Subsequent `activeLayers` prop changes do NOT re-sync local
 *   state (the prop is only the initializer, not an ongoing source of truth).
 *   `onToggleLayer` fires after each flip as a notification callback.
 *
 * Sub-AC 3 — Engine-wired (fully controlled).
 *   When `layerState` prop IS provided, the panel reads visibility from
 *   `layerState[layerId]` for every toggle and does NOT update local state on
 *   click.  Only `onToggleLayer(layerId)` is called on each click — the
 *   parent dispatches to the LayerEngine, which propagates the new state back
 *   through `layerState`, completing the controlled loop.
 *
 * The component works fully standalone (no props required in uncontrolled mode):
 *   - Defaults to all 7 layers active
 *   - Each toggle flip is immediately reflected in the UI
 *   - `onToggleLayer` fires with the layerId after each flip
 */
export function LayerTogglePanel({
  id,
  open = true,
  activeLayers = [...LAYER_SLOT_IDS], // default: all layers active
  layerState,
  onToggleLayer,
  onClose,
  position = "top-right",
  className,
  "aria-label": ariaLabel = "Map layer controls",
}: LayerTogglePanelProps) {
  // ── Local toggle state ────────────────────────────────────────────────────
  //
  // Always initialised from `activeLayers` on first mount (hooks must be
  // called unconditionally).  Only USED for rendering when `layerState` is
  // NOT provided (uncontrolled mode, Sub-AC 2).
  //
  // In controlled mode (`layerState` provided), this state is maintained but
  // never consulted for display — `layerState[layerId]` is used instead.
  const [localActiveLayers, setLocalActiveLayers] = useState<LayerSlotId[]>(
    () => [...activeLayers]
  );

  // ── Visibility resolver ───────────────────────────────────────────────────
  //
  // Returns whether a layer should appear active in the UI.
  //   Controlled mode  (layerState provided) → read from layerState
  //   Uncontrolled mode                      → read from local state
  const isLayerActive = (layerId: LayerSlotId): boolean => {
    if (layerState !== undefined) {
      return layerState[layerId];
    }
    return localActiveLayers.includes(layerId);
  };

  // ── Active-layer count (for footer) ──────────────────────────────────────
  //
  // When controlled, count truthy values in layerState.
  // When uncontrolled, count the local array.
  const displayActiveCount =
    layerState !== undefined
      ? LAYER_SLOT_IDS.filter((id) => layerState[id]).length
      : localActiveLayers.length;

  // ── Toggle handler ────────────────────────────────────────────────────────
  //
  // Controlled mode:  skips local state update, calls onToggleLayer only.
  //   The parent (LayerTogglePanelConnected) dispatches to the LayerEngine,
  //   which emits a new state snapshot back through `layerState`.
  //
  // Uncontrolled mode: flips local state, then calls onToggleLayer.
  //
  // useCallback keeps the reference stable so row-level components don't
  // re-render unnecessarily.
  const handleToggle = useCallback(
    (layerId: LayerSlotId) => {
      if (layerState === undefined) {
        // Uncontrolled: update local state immediately.
        setLocalActiveLayers((prev) => {
          const isCurrentlyActive = prev.includes(layerId);
          if (isCurrentlyActive) {
            // Remove from active list → layer turns OFF
            return prev.filter((id) => id !== layerId);
          } else {
            // Append in canonical order → layer turns ON
            return LAYER_SLOT_IDS.filter(
              (id) => id === layerId || prev.includes(id)
            );
          }
        });
      }
      // Always notify parent (in controlled mode, this is the dispatch path).
      onToggleLayer?.(layerId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layerState, onToggleLayer]
  );

  if (!open) {
    return null;
  }

  const rootClass = [
    styles.root,
    styles[`position-${position}`],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside
      id={id}
      className={rootClass}
      aria-label={ariaLabel}
      data-testid="layer-toggle-panel"
      data-position={position}
    >
      {/* ── Panel header ── */}
      <div className={styles.header} data-testid="layer-toggle-panel-header">
        <span className={styles.headerTitle}>
          <span className={styles.headerIcon} aria-hidden="true">
            {/* Stack-of-layers icon — rendered via CSS (no external dependency) */}
          </span>
          Layers
        </span>

        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close layer controls panel"
          title="Close"
          data-testid="layer-toggle-panel-close"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {/* ── Toggle list ── */}
      <div
        className={styles.body}
        role="group"
        aria-label="Layer visibility toggles"
        data-testid="layer-toggle-panel-body"
      >
        {LAYER_SLOT_IDS.map((layerId) => {
          // In controlled mode, read from layerState.
          // In uncontrolled mode, read from local state.
          const isActive = isLayerActive(layerId);
          const label = LAYER_LABELS[layerId];
          const description = LAYER_DESCRIPTIONS[layerId];
          const toggleId = `layer-toggle-${layerId}`;

          return (
            <div
              key={layerId}
              className={styles.toggleRow}
              data-layer={layerId}
              data-active={isActive ? "true" : "false"}
              data-testid={`layer-toggle-row-${layerId}`}
            >
              {/* Color swatch — consumes --layer-{id}-bg token */}
              <span
                className={styles.swatch}
                data-layer={layerId}
                aria-hidden="true"
              />

              {/* Label + description
                  The <label> wraps the visible text.  htmlFor links it to the
                  <input> for WCAG SC 1.3.1 (Info and Relationships). */}
              <label
                htmlFor={toggleId}
                className={styles.rowLabel}
              >
                <span className={styles.rowLabelText}>{label}</span>
                <span className={styles.rowLabelCode}>{layerId}</span>
                {/* Description is visually hidden but available to screen
                    readers — satisfies WCAG SC 1.3.3 (Sensory Characteristics) */}
                <span className={styles.rowDescription}>{description}</span>
              </label>

              {/* Toggle switch — accessible checkbox with custom visual styling.
                  The native <input> is visually hidden but remains in the
                  tab order and responds to keyboard (Space/Enter).
                  The decorative pill track is aria-hidden; the <input>'s
                  aria-label provides the accessible name. */}
              <div className={styles.toggleSlot} aria-hidden="false">
                <input
                  type="checkbox"
                  id={toggleId}
                  className={styles.toggleInput}
                  checked={isActive}
                  onChange={() => handleToggle(layerId)}
                  aria-label={`${isActive ? "Hide" : "Show"} ${label} layer`}
                  data-testid={`layer-toggle-input-${layerId}`}
                />
                {/* Purely decorative pill — labelled via sibling <input> */}
                <span
                  className={styles.toggleTrack}
                  data-checked={isActive ? "true" : "false"}
                  aria-hidden="true"
                >
                  <span className={styles.toggleThumb} />
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer — active layer count ── */}
      <div
        className={styles.footer}
        data-testid="layer-toggle-panel-footer"
        aria-label="Layer panel footer"
      >
        <span
          className={styles.footerHint}
          aria-live="polite"
          aria-atomic="true"
        >
          {displayActiveCount} of {LAYER_SLOT_IDS.length} layers visible
        </span>
      </div>
    </aside>
  );
}

export default LayerTogglePanel;
