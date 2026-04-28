/**
 * CaseDetailPanel — T1–T5 case detail layout container.
 *
 * Renders the tab bar for switching between T-layouts and the active layout
 * body. Used in the INVENTORY dashboard's right-side detail panel.
 *
 * T1 = Summary         — case overview, assignee, location, compact FedEx badge
 * T2 = Manifest        — packing list / manifest items with status
 * T3 = Inspection      — inspection history and checklist progress
 * T4 = Shipping        — full FedEx tracking section (primary integration point)
 * T5 = Audit           — immutable event timeline (behind FF_AUDIT_HASH_CHAIN)
 *
 * Feature flags:
 *   FF_AUDIT_HASH_CHAIN  — required to make T5 active (otherwise tab is
 *                          visible but disabled with a neutral badge).
 *   FF_INV_REDESIGN      — no direct effect here; handled at the page level.
 *
 * Props:
 *   caseId       — Convex document ID of the selected case.
 *   window       — currently active T-layout ("T1" | "T2" | "T3" | "T4" | "T5").
 *   onWindowChange — callback fired when the user switches tabs.
 *   ffAuditHashChain — whether FF_AUDIT_HASH_CHAIN is enabled (default: false).
 */

"use client";

import { lazy, Suspense, useEffect, useRef } from "react";
import type { CaseWindow } from "../../types/map";
import { trackEvent } from "@/lib/telemetry.lib";
import { TelemetryEventName } from "@/types/telemetry.types";
import styles from "./CaseDetailPanel.module.css";

// ─── Lazy-loaded T-layout components ─────────────────────────────────────────

const T1Overview   = lazy(() => import("./T1Overview"));
const T2Manifest   = lazy(() => import("./T2Manifest"));
const T3Inspection = lazy(() => import("./T3Inspection"));
const T4Shipping   = lazy(() => import("./T4Shipping"));
const T5Audit      = lazy(() => import("./T5Audit"));

// ─── Tab configuration ────────────────────────────────────────────────────────

interface TabConfig {
  id: CaseWindow;
  code: string;
  label: string;
  ffRequired?: string;
}

const TABS: TabConfig[] = [
  { id: "T1", code: "T1", label: "Summary" },
  { id: "T2", code: "T2", label: "Manifest" },
  { id: "T3", code: "T3", label: "Inspection" },
  { id: "T4", code: "T4", label: "Shipping" },
  { id: "T5", code: "T5", label: "Audit", ffRequired: "FF_AUDIT_HASH_CHAIN" },
];

// ─── Component props ──────────────────────────────────────────────────────────

export interface CaseDetailPanelProps {
  /** Convex document ID of the case to display. */
  caseId: string;
  /** Currently active T-layout. Defaults to "T1". */
  window?: CaseWindow;
  /** Called when the user clicks a different tab. */
  onWindowChange?: (window: CaseWindow) => void;
  /** Whether FF_AUDIT_HASH_CHAIN is enabled. */
  ffAuditHashChain?: boolean;
  /** Additional CSS class for the outer panel element. */
  className?: string;
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function PanelSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Loading case details">
      <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
      <div className={`${styles.skeletonLine} ${styles.skeletonLineMed}`} />
      <div className={`${styles.skeletonLine} ${styles.skeletonLineFull}`} />
      <div className={`${styles.skeletonLine} ${styles.skeletonBlock}`} />
      <div className={`${styles.skeletonLine} ${styles.skeletonLineMed}`} />
      <div className={`${styles.skeletonLine} ${styles.skeletonLineFull}`} />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CaseDetailPanel({
  caseId,
  window: activeWindow = "T1",
  onWindowChange,
  ffAuditHashChain = false,
  className,
}: CaseDetailPanelProps) {
  const panelClass = [styles.panel, className].filter(Boolean).join(" ");

  // ── T-layout tab telemetry ────────────────────────────────────────────────────
  //
  // Fire INV_NAV_DETAIL_TAB_CHANGED on every T1-T5 tab switch (and on initial
  // display of a case, with previousTab = null).
  //
  // previousTabRef tracks the last-emitted tab for the active case.
  // previousCaseIdRef detects when a different case is opened so we can reset
  // previousTabRef — the first tab view on a new case should always have
  // previousTab = null, regardless of what was showing for the previous case.
  //
  // The effect fires after every render where `activeWindow` or `caseId`
  // changed, covering:
  //   • Initial case open (previousTab = null, tab = default "T1")
  //   • User clicking a different tab (T1 → T2, etc.)
  //   • URL-driven deep-link navigation that lands on a specific tab
  //   • Switching to a different case (previousTab resets to null)
  const previousTabRef = useRef<CaseWindow | null>(null);
  const previousCaseIdRef = useRef<string | null>(null);

  useEffect(() => {
    // When a new case is opened, reset the previous-tab tracking so the
    // first tab view on the new case is reported with previousTab = null.
    if (previousCaseIdRef.current !== caseId) {
      previousTabRef.current = null;
      previousCaseIdRef.current = caseId;
    }

    const previousTab = previousTabRef.current;

    // Guard: don't fire if the tab hasn't actually changed.
    if (previousTab === activeWindow) return;

    trackEvent({
      eventCategory: "navigation",
      eventName: TelemetryEventName.INV_NAV_DETAIL_TAB_CHANGED,
      app: "inventory",
      tab: activeWindow,
      previousTab,
      caseId,
    });

    previousTabRef.current = activeWindow;
  }, [activeWindow, caseId]);

  function renderActiveLayout() {
    switch (activeWindow) {
      case "T1":
        return <T1Overview caseId={caseId} />;
      case "T2":
        return <T2Manifest caseId={caseId} />;
      case "T3":
        return <T3Inspection caseId={caseId} />;
      case "T4":
        return <T4Shipping caseId={caseId} />;
      case "T5":
        return ffAuditHashChain ? (
          <T5Audit caseId={caseId} />
        ) : (
          <T5Audit caseId={caseId} ffEnabled={false} />
        );
      default:
        return <T1Overview caseId={caseId} />;
    }
  }

  return (
    <section
      className={panelClass}
      aria-label="Case detail panel"
      data-testid="case-detail-panel"
    >
      {/* Tab bar */}
      <nav className={styles.tabBar} role="tablist" aria-label="Case detail views">
        {TABS.map((tab) => {
          const isActive = tab.id === activeWindow;
          const isDisabled =
            tab.ffRequired === "FF_AUDIT_HASH_CHAIN" && !ffAuditHashChain;

          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`case-panel-${tab.id}`}
              id={`case-tab-${tab.id}`}
              className={[styles.tab, isActive ? styles.active : ""].filter(Boolean).join(" ")}
              onClick={() => !isDisabled && onWindowChange?.(tab.id)}
              disabled={isDisabled}
              title={
                isDisabled
                  ? `${tab.label} requires FF_AUDIT_HASH_CHAIN feature flag`
                  : tab.label
              }
            >
              <span className={styles.tabCode}>{tab.code}</span>
              <span>{tab.label}</span>
              {tab.ffRequired && (
                <span className={styles.tabBadge} aria-label="Feature flag required">
                  FF
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Panel body */}
      <div
        id={`case-panel-${activeWindow}`}
        role="tabpanel"
        aria-labelledby={`case-tab-${activeWindow}`}
        className={styles.body}
        data-window={activeWindow}
      >
        <Suspense fallback={<PanelSkeleton />}>
          {renderActiveLayout()}
        </Suspense>
      </div>
    </section>
  );
}

export default CaseDetailPanel;
