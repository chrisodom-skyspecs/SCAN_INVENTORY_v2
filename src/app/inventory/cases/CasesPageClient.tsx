/**
 * CasesPageClient — Client Component host for the /inventory/cases route.
 *
 * This component owns the case-selection interaction: when the user clicks a
 * row in CaseStatusTable, it navigates to /inventory?case=<id>&panel=1 so
 * the map view opens with the case detail panel (T1–T5) rendered.
 *
 * Why navigate instead of showing an inline panel?
 *   The case detail panel (CaseDetailPanel / T1–T5) is rendered inside
 *   InventoryMapClient at /inventory, where it sits alongside the Mapbox map
 *   and benefits from the map's layout context (viewport, layer engine, etc.).
 *   Duplicating the panel on this page would create divergent state and
 *   increase bundle weight.  Navigation is the correct seam.
 *
 * URL format used on case selection:
 *   /inventory?case=<convexId>&panel=1
 *   • `case`  — Convex document ID of the selected case  (MapUrlState.case)
 *   • `panel` — "1" tells InventoryMapClient to open the detail drawer
 *               (MapUrlState.panelOpen serialisation convention)
 *
 * Design system compliance:
 *   CasesPageClient is a layout host only — all visual rendering happens
 *   inside CaseStatusTable, which uses CSS custom properties and StatusPill
 *   throughout.  This file introduces no styles of its own.
 *
 * Accessibility:
 *   - CaseStatusTable renders a <table> with full keyboard navigation (tabIndex,
 *     role="row", aria-selected, aria-label, aria-busy, aria-live).
 *   - Page-level focus management after navigation is handled by the browser's
 *     native document focus reset on route change.
 */

"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { CaseStatusTable } from "@/components/CaseStatusTable";
import styles from "./CasesPageClient.module.css";

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * CasesPageClient — wraps CaseStatusTable with navigation-on-select behaviour.
 *
 * Tracks `selectedCaseId` in local state so the selected row gets highlighted
 * while the navigation transition is in flight.  Once the browser navigates
 * to /inventory, this component unmounts and the selection state is discarded.
 */
export function CasesPageClient() {
  const router = useRouter();

  // Track which case is "selected" locally so the row stays highlighted
  // during the navigation transition.  This avoids a flash of deselected state
  // if the router transition takes a few frames.
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  /**
   * handleSelectCase — called by CaseStatusTable when the user clicks a row.
   *
   * Highlights the row locally (setSelectedCaseId) and navigates to the map
   * view with the case detail panel pre-opened via URL params.
   *
   * URL: /inventory?case=<caseId>&panel=1
   *   case  → MapUrlState.case  (activeCaseId in useMapParams)
   *   panel → MapUrlState.panelOpen serialised as "1" by the codec
   */
  const handleSelectCase = useCallback(
    (caseId: string) => {
      setSelectedCaseId(caseId);
      // Navigate to the map with the case detail panel open.
      // The MapStateProvider + sanitizeMapDeepLink codec in /inventory/page.tsx
      // will decode `case` and `panel` params on the server side and pass
      // initialState to InventoryMapClient, so the panel opens immediately on
      // first render without a client-side hydration bounce.
      router.push(`/inventory?case=${encodeURIComponent(caseId)}&panel=1`);
    },
    [router]
  );

  return (
    <main className={styles.root} aria-label="Case fleet registry">
      <CaseStatusTable
        onSelectCase={handleSelectCase}
        selectedCaseId={selectedCaseId}
      />
    </main>
  );
}
