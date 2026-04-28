/**
 * useMapState and related selector hooks.
 *
 * Re-exported from the provider module for ergonomic import paths.
 *
 * @example
 * // In a client component:
 * import { useMapState, useMapView, useSetMapUrlState } from "@/hooks/use-map-state";
 *
 * function MapToolbar() {
 *   const view = useMapView();
 *   const setUrlState = useSetMapUrlState();
 *
 *   return (
 *     <button onClick={() => setUrlState({ view: "M3" })}>
 *       Switch to Transit Tracker
 *     </button>
 *   );
 * }
 */

"use client";

export {
  useMapState,
  useMapView,
  useSelectedCase,
  useCaseWindow,
  useMapLayers,
  useOrgFilter,
  useKitFilter,
  useReplayAt,
  useMapEphemeral,
  useSetMapUrlState,
  useSetMapEphemeral,
  useResetMapUrlState,
  type MapStateContextValue,
  type SetUrlStateOptions,
} from "@/providers/map-state-provider";
