"use client";

import { memo, useCallback, useEffect, type ReactNode } from "react";
import { Map as MapboxMap, NavigationControl } from "react-map-gl";
import type { ViewState } from "react-map-gl";

import styles from "./InventoryMapCanvas.module.css";

export const DEFAULT_INVENTORY_VIEW_STATE: Partial<ViewState> = {
  longitude: -98.5795,
  latitude: 39.8283,
  zoom: 3,
};

export interface InventoryMapCanvasProps {
  mapboxToken: string;
  mapStyle: string;
  children?: ReactNode;
  className?: string;
  initialViewState?: Partial<ViewState>;
  emptyMessage?: string;
  showEmptyMessage?: boolean;
  "aria-label"?: string;
}

export const InventoryMapCanvas = memo(function InventoryMapCanvas({
  mapboxToken,
  mapStyle,
  children,
  className,
  initialViewState = DEFAULT_INVENTORY_VIEW_STATE,
  emptyMessage,
  showEmptyMessage = false,
  "aria-label": ariaLabel = "Inventory map",
}: InventoryMapCanvasProps) {
  useEffect(() => {
    function handleUnhandledRejection(event: PromiseRejectionEvent): void {
      if (event.reason instanceof Event) {
        event.preventDefault();

        if (process.env.NODE_ENV === "development") {
          console.debug("[InventoryMapCanvas] Suppressed map load event rejection", {
            type: event.reason.type,
          });
        }
      }
    }

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  const handleMapError = useCallback((event: { error?: unknown }) => {
    if (process.env.NODE_ENV === "development" && event.error) {
      console.warn("[InventoryMapCanvas] Mapbox error", event.error);
    }
  }, []);

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(" ")}
      role="region"
      aria-label={ariaLabel}
      data-testid="inventory-map-canvas"
    >
      <MapboxMap
        mapboxAccessToken={mapboxToken}
        initialViewState={initialViewState}
        style={{ width: "100%", height: "100%" }}
        mapStyle={mapStyle}
        attributionControl={false}
        reuseMaps={true}
        onError={handleMapError}
      >
        <NavigationControl position="top-left" />
        {children}
      </MapboxMap>

      {showEmptyMessage && emptyMessage ? (
        <div className={styles.emptyOverlay} role="status" aria-live="polite">
          {emptyMessage}
        </div>
      ) : null}
    </div>
  );
});

InventoryMapCanvas.displayName = "InventoryMapCanvas";

export default InventoryMapCanvas;
