/**
 * INVENTORY route layout
 *
 * Provides:
 *   • MapStateProvider — URL ↔ React map state sync for all /inventory children
 *   • Suspense boundary — required by Next.js App Router for components
 *     that call useSearchParams() (MapStateProvider, useMapUrlState, useMapParams)
 *
 * All child components inside /app/inventory may safely call:
 *   useMapState, useMapView, useOrgFilter, useKitFilter, etc.
 *   useMapParams (does NOT require the Provider, but benefits from it)
 */

import { Suspense, type ReactNode } from "react";
import { MapStateProvider } from "@/providers/map-state-provider";

// Simple full-height spinner shown while search params are being read
function MapLoadingFallback() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100dvh",
        background: "var(--surface-base)",
        color: "var(--ink-secondary)",
        fontFamily: "'Inter Tight', sans-serif",
        fontSize: "0.875rem",
      }}
      aria-live="polite"
      aria-label="Loading INVENTORY map"
    >
      Loading…
    </div>
  );
}

export default function InventoryLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<MapLoadingFallback />}>
      <MapStateProvider defaultPathname="/inventory">
        {children}
      </MapStateProvider>
    </Suspense>
  );
}
