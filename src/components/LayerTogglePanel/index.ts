/**
 * LayerTogglePanel — public exports
 *
 * Two operating modes are exported:
 *
 * 1. `LayerTogglePanel` — base panel component.
 *    Sub-AC 2: semi-uncontrolled (local state, `activeLayers` initializes it).
 *    Sub-AC 3: fully controlled when `layerState` prop is provided.
 *
 * 2. `LayerTogglePanelConnected` — engine-wired variant (Sub-AC 3).
 *    Reads from LayerEngine context via useSharedLayerEngine and dispatches
 *    toggle actions back to the engine.  Must be rendered inside a
 *    <LayerEngineProvider>.
 */

export {
  LayerTogglePanel,
  type LayerTogglePanelProps,
  type LayerSlotId,
  LAYER_SLOT_IDS,
} from "./LayerTogglePanel";

export {
  LayerTogglePanelConnected,
  type LayerTogglePanelConnectedProps,
} from "./LayerTogglePanelConnected";
