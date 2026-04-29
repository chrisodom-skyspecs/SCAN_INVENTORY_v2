/**
 * MapManifestHoverProvider — React context for the map ↔ manifest hover binding.
 *
 * Provides a shared `hoveredCaseId` string that bridges map markers and manifest
 * panel items so hovering either side highlights the counterpart:
 *
 *   Map marker hover   → hoveredCaseId = pin.caseId
 *                        → ManifestPanel with matching caseId highlights
 *
 *   Manifest item hover → hoveredCaseId = manifest.caseId
 *                        → Map pin with matching caseId highlights
 *
 * Design decisions
 * ────────────────
 * • Standalone context — does NOT depend on MapStateContext or any other
 *   provider, so it can be used in isolation for testing or embedded contexts.
 * • Null-safe defaults — useMapManifestHover() returns a no-op setter when
 *   called outside a <MapManifestHoverProvider>, so components can use the
 *   hook without requiring the provider to be present.
 * • Single-render footprint — the context value only re-renders consumers
 *   when `hoveredCaseId` changes (not on every parent render).
 *
 * Usage
 * ─────
 * Wrap the layout that contains both the map and the manifest panel:
 *
 *   // In InventoryMapClient.tsx
 *   <MapManifestHoverProvider>
 *     <MapArea />
 *     <ManifestPanel caseId={selectedCaseId} />
 *   </MapManifestHoverProvider>
 *
 * Then in each consumer:
 *
 *   // In a map pin component
 *   const { hoveredCaseId, setHoveredCaseId } = useMapManifestHover();
 *   <li
 *     onMouseEnter={() => setHoveredCaseId(pin.caseId)}
 *     onMouseLeave={() => setHoveredCaseId(null)}
 *     data-map-hover={hoveredCaseId === pin.caseId ? "highlighted" : undefined}
 *   />
 *
 *   // In ManifestPanel
 *   const { hoveredCaseId, setHoveredCaseId } = useMapManifestHover();
 *   <section
 *     onMouseEnter={() => caseId && setHoveredCaseId(caseId)}
 *     onMouseLeave={() => setHoveredCaseId(null)}
 *     data-map-hover={hoveredCaseId === caseId ? "highlighted" : undefined}
 *   />
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// ─── Context types ────────────────────────────────────────────────────────────

export interface MapManifestHoverContextValue {
  /**
   * The caseId of the currently hovered element (map marker or manifest panel),
   * or `null` when nothing is hovered.
   */
  hoveredCaseId: string | null;

  /**
   * Set the currently hovered caseId.
   * Pass `null` to clear the hover state (on mouse-leave).
   *
   * Stable reference — will not change between renders, safe to use in
   * dependency arrays without causing re-runs.
   */
  setHoveredCaseId: (id: string | null) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const MapManifestHoverContext =
  createContext<MapManifestHoverContextValue | null>(null);

MapManifestHoverContext.displayName = "MapManifestHoverContext";

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface MapManifestHoverProviderProps {
  children: ReactNode;
}

/**
 * MapManifestHoverProvider
 *
 * Manages the shared hover state for the map ↔ manifest binding.
 *
 * Place this around any layout that contains both a map component
 * (M1–M5 with case pins) and a manifest panel (ManifestPanel or similar)
 * that you want linked by hover.
 *
 * The provider is deliberately thin:
 *   - One `useState` for hoveredCaseId
 *   - One stable `useCallback` for the setter
 *   - The context value is memoised to prevent unnecessary re-renders
 */
export function MapManifestHoverProvider({
  children,
}: MapManifestHoverProviderProps) {
  const [hoveredCaseId, setHoveredCaseIdState] = useState<string | null>(null);

  // Stable setter — created once, never re-created on re-render.
  // Consumers can safely include this in useCallback/useMemo deps.
  const setHoveredCaseId = useCallback((id: string | null) => {
    setHoveredCaseIdState(id);
  }, []);

  // Memoised context value — only a new object reference when hoveredCaseId
  // changes, preventing consumers from re-rendering on unrelated parent updates.
  const value = useMemo<MapManifestHoverContextValue>(
    () => ({ hoveredCaseId, setHoveredCaseId }),
    [hoveredCaseId, setHoveredCaseId]
  );

  return (
    <MapManifestHoverContext.Provider value={value}>
      {children}
    </MapManifestHoverContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * NO_OP_SETTER — used as the fallback setter when the hook is called outside
 * a <MapManifestHoverProvider>.  Being a module-level constant guarantees a
 * stable reference across all invocations in that scenario.
 */
const NO_OP_SETTER = (_id: string | null): void => {};

/**
 * useMapManifestHover
 *
 * Returns the shared hover state and setter from the nearest
 * <MapManifestHoverProvider>.
 *
 * Null-safe: when called outside a provider (or in tests without a provider),
 * returns `{ hoveredCaseId: null, setHoveredCaseId: () => {} }` so components
 * don't need to guard against a missing context.
 *
 * @example
 * const { hoveredCaseId, setHoveredCaseId } = useMapManifestHover();
 *
 * // In a map pin li element:
 * onMouseEnter={() => setHoveredCaseId(pin.caseId)}
 * onMouseLeave={() => setHoveredCaseId(null)}
 * data-map-hover={hoveredCaseId === pin.caseId ? "highlighted" : undefined}
 *
 * // In ManifestPanel:
 * onMouseEnter={() => caseId && setHoveredCaseId(caseId)}
 * onMouseLeave={() => setHoveredCaseId(null)}
 * data-map-hover={hoveredCaseId === caseId ? "highlighted" : undefined}
 */
export function useMapManifestHover(): MapManifestHoverContextValue {
  const ctx = useContext(MapManifestHoverContext);
  if (ctx === null) {
    // Null-safe fallback — no throw, no warning in production.
    // Allows the hook to be used without a provider for simpler embedding.
    return { hoveredCaseId: null, setHoveredCaseId: NO_OP_SETTER };
  }
  return ctx;
}

export default MapManifestHoverProvider;
