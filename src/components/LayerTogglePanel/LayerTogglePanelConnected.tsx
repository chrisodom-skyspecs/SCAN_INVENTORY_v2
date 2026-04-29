/**
 * LayerTogglePanelConnected — Engine-wired variant of LayerTogglePanel.
 *
 * Sub-AC 3: Wires the toggle panel controls to the LayerEngine state.
 *
 * This component:
 *   1. Reads the current layer visibility snapshot from the shared LayerEngine
 *      via `useSharedLayerEngine()` (backed by `useSyncExternalStore` so React
 *      re-renders automatically on every engine state change).
 *   2. Passes the snapshot as the `layerState` prop to `LayerTogglePanel`,
 *      switching it into fully-controlled mode — no local state is used.
 *   3. Passes `engine.toggle` as the `onToggleLayer` callback so each toggle
 *      click dispatches directly to the engine.
 *
 * This creates a tight, symmetric wiring:
 *   User click → onToggleLayer(layerId) → engine.toggle(layerId)
 *             → LayerEngineState changes → useSyncExternalStore notifies React
 *             → layerState prop updates → toggle renders as on/off
 *
 * This also means that external state changes (keyboard shortcut, URL restore,
 * engine.activateAll(), engine.reset(), etc.) are reflected in the panel within
 * a single React render cycle — no extra synchronization required.
 *
 * Usage
 * ─────
 *   // Wrap the map area with LayerEngineProvider (once, at the layout level):
 *   import { LayerEngineProvider } from "@/providers/layer-engine-provider";
 *   import { LayerTogglePanelConnected } from "@/components/LayerTogglePanel";
 *
 *   <LayerEngineProvider>
 *     <InventoryMap />
 *     <LayerTogglePanelConnected position="top-right" onClose={handleClose} />
 *   </LayerEngineProvider>
 *
 * Requirements
 * ────────────
 * • Must be rendered inside a `<LayerEngineProvider>`.
 *   `useSharedLayerEngine()` throws a descriptive error when no provider is
 *   found — this is intentional and surfaces misconfiguration immediately.
 * • "use client" — this component uses React hooks and must run in the browser.
 */

"use client";

import { useCallback } from "react";
import { LayerTogglePanel, type LayerTogglePanelProps, type LayerSlotId } from "./LayerTogglePanel";
import { useSharedLayerEngine } from "@/providers/layer-engine-provider";

// ─── Props ────────────────────────────────────────────────────────────────────

/**
 * Props for `LayerTogglePanelConnected`.
 *
 * Excludes the props that are owned by the engine wiring:
 *   • `activeLayers` — replaced by engine state
 *   • `layerState`   — derived from engine, not a prop
 *   • `onToggleLayer`— dispatched to engine internally
 *
 * All other `LayerTogglePanelProps` are forwarded unchanged.
 */
export type LayerTogglePanelConnectedProps = Omit<
  LayerTogglePanelProps,
  "activeLayers" | "layerState" | "onToggleLayer"
>;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Engine-wired map layer toggle panel.
 *
 * Reads layer visibility from the shared `LayerEngine` via context and
 * dispatches toggle actions back to the engine when the user clicks a toggle.
 *
 * Must be rendered inside a `<LayerEngineProvider>`.
 */
export function LayerTogglePanelConnected(
  props: LayerTogglePanelConnectedProps
) {
  // ── Engine subscription ───────────────────────────────────────────────────
  //
  // `state`  — current LayerEngineState snapshot (Record<SemanticLayerId, boolean>)
  //   Backed by useSyncExternalStore → React re-renders automatically when any
  //   layer visibility changes, whether triggered by this panel or an external
  //   call (keyboard shortcut, URL hydration, engine.reset(), etc.).
  //
  // `toggle` — stable callback that calls engine.toggle(id)
  //   Memoised against the engine instance; does not change across re-renders.
  const { state, toggle } = useSharedLayerEngine();

  // ── Adapter: SemanticLayerId → LayerSlotId ────────────────────────────────
  //
  // `SemanticLayerId` (src/types/layer-engine.ts) and `LayerSlotId`
  // (LayerTogglePanel.tsx) are the same 7-member string union defined in two
  // places.  The cast below is safe because both unions are identical.
  //
  // Using `as` rather than a runtime transform avoids any per-render allocation.
  const layerState = state as Record<LayerSlotId, boolean>;

  // ── Engine dispatch adapter ───────────────────────────────────────────────
  //
  // `toggle` from `useSharedLayerEngine` accepts `SemanticLayerId`.
  // `onToggleLayer` in `LayerTogglePanelProps` accepts `LayerSlotId`.
  // The cast is safe (same union).
  //
  // Wrapped in useCallback to produce a stable reference so `LayerTogglePanel`
  // does not re-render due to identity changes on this callback.
  const handleToggleLayer = useCallback(
    (layerId: LayerSlotId) => {
      toggle(layerId);
    },
    [toggle]
  );

  // ── Render ────────────────────────────────────────────────────────────────
  //
  // Pass `layerState` to switch `LayerTogglePanel` into controlled mode.
  // The panel will read visibility from `layerState` on every render instead
  // of maintaining its own local state.
  return (
    <LayerTogglePanel
      {...props}
      layerState={layerState}
      onToggleLayer={handleToggleLayer}
    />
  );
}

export default LayerTogglePanelConnected;
