"use client";

import { memo, useCallback } from "react";
import { Marker } from "react-map-gl";

import type { CaseMapRecord } from "@/hooks/use-case-map-data";
import type { LayerToggleKey } from "@/types/map";
import styles from "./InventoryCaseMarkers.module.css";

export type InventoryMarkerRecord = CaseMapRecord & {
  layerKey?: LayerToggleKey | null;
};

export interface InventoryCaseMarkersProps {
  records: readonly InventoryMarkerRecord[];
  selectedCaseId?: string | null;
  hoveredCaseId?: string | null;
  onSelectCase?: (caseId: string) => void;
  onHoverCase?: (caseId: string | null) => void;
  getMeta?: (record: InventoryMarkerRecord) => string | undefined;
}

export const InventoryCaseMarkers = memo(function InventoryCaseMarkers({
  records,
  selectedCaseId,
  hoveredCaseId,
  onSelectCase,
  onHoverCase,
  getMeta,
}: InventoryCaseMarkersProps) {
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, caseId: string) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelectCase?.(caseId);
      }
    },
    [onSelectCase]
  );

  return (
    <>
      {records.map((record) => {
        if (record.lat === undefined || record.lng === undefined) return null;

        const meta = getMeta?.(record) ?? record.locationName ?? record.status;
        const selected = selectedCaseId === record.caseId;
        const hovered = hoveredCaseId === record.caseId;

        return (
          <Marker
            key={record.caseId}
            longitude={record.lng}
            latitude={record.lat}
            anchor="bottom"
          >
            <div
              className={styles.marker}
              data-case-id={record.caseId}
              data-status={record.status}
              data-layer={record.layerKey ?? undefined}
            >
              <button
                type="button"
                className={styles.button}
                aria-label={`${record.label}: ${meta}`}
                aria-pressed={selected}
                data-hovered={hovered ? "true" : undefined}
                onClick={() => onSelectCase?.(record.caseId)}
                onKeyDown={(event) => handleKeyDown(event, record.caseId)}
                onMouseEnter={() => onHoverCase?.(record.caseId)}
                onMouseLeave={() => onHoverCase?.(null)}
              >
                <span
                  className={styles.dot}
                  data-status={record.status}
                  data-layer={record.layerKey ?? undefined}
                  aria-hidden="true"
                />
                <span className={styles.label}>{record.label}</span>
                {meta ? <span className={styles.meta}>{meta}</span> : null}
              </button>
            </div>
          </Marker>
        );
      })}
    </>
  );
});

InventoryCaseMarkers.displayName = "InventoryCaseMarkers";

export default InventoryCaseMarkers;
