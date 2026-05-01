/**
 * T4DossierShell — Tabbed Dossier Shell for Case Detail
 *
 * A comprehensive, tabbed dossier-style case detail panel providing
 * consolidated visibility across all aspects of a case in a single view.
 *
 * Tab layout (6 tabs):
 *   Overview  — case identity, status, metadata, custody, FedEx badge
 *   Timeline  — vertical spine event timeline (lifecycle history)
 *   Map       — interactive Mapbox GL JS mini-map centred on case location
 *   Manifest  — packing list / checklist with per-item status indicators
 *   Evidence  — damage reports with annotated photo evidence
 *   Activity  — immutable audit log (hash-chain trail)
 *
 * Architecture
 * ────────────
 * The shell is a pure layout container:
 *   • Manages active tab state via useState (local, not URL-driven)
 *   • Renders the horizontal tab navigation bar
 *   • Renders the active tab's content panel (stub or real — per Sub-AC)
 *   • Fires onTabChange callback for optional parent synchronization
 *   • Supports controlled mode via activeTab + onTabChange props
 *
 * Accessibility
 * ─────────────
 * Implements WAI-ARIA tabs pattern (role="tablist", role="tab",
 * role="tabpanel") with full keyboard support:
 *   • Left/Right arrow keys move focus between tabs
 *   • Home/End jump to first/last tab
 *   • Enter/Space activate the focused tab
 *   • Tab key moves focus to the active tabpanel
 *   • aria-selected, aria-controls, aria-labelledby all wired correctly
 *
 * Design system compliance
 * ─────────────────────────
 * • No hex literals — only CSS custom property tokens
 * • Inter Tight for all UI labels and headings
 * • IBM Plex Mono for data / tabular / code content
 * • StatusPill for any status indicators within tab content
 * • Light theme default; dark theme via .theme-dark on html element
 * • WCAG AA contrast in both themes
 *
 * Feature flag
 * ────────────
 * The Activity tab (audit hash chain) is gated by FF_AUDIT_HASH_CHAIN.
 * When disabled, the tab is visible but rendered with a gate notice.
 *
 * Integration
 * ───────────
 * Used as the case detail panel in the FF_INV_REDESIGN code path.
 * Can be rendered standalone or embedded in any scroll container.
 *
 * @example
 *   // Uncontrolled (shell manages its own tab state)
 *   <T4DossierShell caseId={selectedCaseId} />
 *
 * @example
 *   // Controlled (parent manages active tab for URL sync)
 *   <T4DossierShell
 *     caseId={selectedCaseId}
 *     activeTab={dossierTab}
 *     onTabChange={setDossierTab}
 *   />
 *
 * @example
 *   // With feature flag
 *   <T4DossierShell
 *     caseId={selectedCaseId}
 *     ffAuditHashChain={flags.FF_AUDIT_HASH_CHAIN}
 *   />
 */

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { StatusPill } from "../StatusPill";
import { RecallModal, type RecallRerouteData } from "../RecallModal";
import { DossierOverviewPanel } from "./DossierOverviewPanel";
import { DossierActivityPanel } from "./DossierActivityPanel";
import { DossierMapPanel } from "./DossierMapPanel";
import { DossierEvidencePanel } from "./DossierEvidencePanel";
import styles from "./T4DossierShell.module.css";

// ─── Tab type ─────────────────────────────────────────────────────────────────

/**
 * Valid tab identifiers for the T4 Tabbed Dossier.
 *
 * Exported so parent components and tests can reference these without
 * duplicating the union literal.
 */
export type DossierTab =
  | "overview"
  | "timeline"
  | "map"
  | "manifest"
  | "evidence"
  | "activity";

export const DOSSIER_TAB_VALUES: readonly DossierTab[] = [
  "overview",
  "timeline",
  "map",
  "manifest",
  "evidence",
  "activity",
] as const;

export function isDossierTab(value: unknown): value is DossierTab {
  return typeof value === "string" && (DOSSIER_TAB_VALUES as string[]).includes(value);
}

// ─── Tab config ───────────────────────────────────────────────────────────────

interface DossierTabConfig {
  /** Stable identifier matching DossierTab union. */
  id: DossierTab;
  /** Display label in the tab nav bar. */
  label: string;
  /**
   * Optional feature flag name that gates this tab.
   * When the flag is disabled: tab is visible but renders a gate notice.
   */
  ffRequired?: string;
  /**
   * Short description for tooltip / aria-label.
   */
  description: string;
}

const DOSSIER_TABS: DossierTabConfig[] = [
  {
    id: "overview",
    label: "Overview",
    description: "Case identity, status, metadata, and custody summary",
  },
  {
    id: "timeline",
    label: "Timeline",
    description: "Chronological lifecycle event history",
  },
  {
    id: "map",
    label: "Map",
    description: "Case location on an interactive map",
  },
  {
    id: "manifest",
    label: "Manifest",
    description: "Packing list and per-item inspection status",
  },
  {
    id: "evidence",
    label: "Evidence",
    description: "Damage reports with annotated photo evidence",
  },
  {
    id: "activity",
    label: "Activity",
    description: "Immutable audit log and hash-chain trail",
    ffRequired: "FF_AUDIT_HASH_CHAIN",
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface T4DossierShellProps {
  /** Convex document ID of the case to display. */
  caseId: string;

  /**
   * Controlled active tab.
   * When provided, the shell uses this value instead of internal state.
   * Must be paired with `onTabChange` for full controlled mode.
   */
  activeTab?: DossierTab;

  /**
   * Initial tab to display in uncontrolled mode.
   * Ignored when `activeTab` is provided.
   * @default "overview"
   */
  initialTab?: DossierTab;

  /**
   * Callback fired when the user switches tabs.
   * Receives the newly activated tab identifier.
   */
  onTabChange?: (tab: DossierTab) => void;

  /**
   * Whether the FF_AUDIT_HASH_CHAIN feature flag is enabled.
   * Controls Activity tab availability.
   * @default false
   */
  ffAuditHashChain?: boolean;

  /**
   * Override slot — render custom content for a specific tab.
   * When provided for a tab, replaces the built-in stub/placeholder.
   * Used by parent components to inject real data-connected panels.
   *
   * @example
   *   tabContent={{ overview: <T4OverviewPanel caseId={caseId} /> }}
   */
  tabContent?: Partial<Record<DossierTab, ReactNode>>;

  /** Additional CSS class applied to the root element. */
  className?: string;
}

// ─── Feature-gate notice ──────────────────────────────────────────────────────

interface FeatureGateNoticeProps {
  tabLabel: string;
  flagName: string;
}

function FeatureGateNotice({ tabLabel, flagName }: FeatureGateNoticeProps) {
  return (
    <div className={styles.gateNotice} role="status" aria-label={`${tabLabel} requires feature flag ${flagName}`}>
      <svg
        className={styles.gateNoticeIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      <p className={styles.gateNoticeTitle}>{tabLabel} requires {flagName}</p>
      <p className={styles.gateNoticeText}>
        Enable the <code className={styles.gateNoticeCode}>{flagName}</code> feature
        flag to access the {tabLabel} panel.
      </p>
    </div>
  );
}

// ─── Tab placeholder (stub while Sub-ACs implement real content) ──────────────

interface TabPlaceholderProps {
  tab: DossierTab;
  caseId: string;
}

function TabPlaceholder({ tab, caseId: _caseId }: TabPlaceholderProps) {
  const icons: Record<DossierTab, ReactNode> = {
    overview: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
    timeline: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
    map: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
        <line x1="9" y1="3" x2="9" y2="18" />
        <line x1="15" y1="6" x2="15" y2="21" />
      </svg>
    ),
    manifest: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
    evidence: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    ),
    activity: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  };

  const descriptions: Record<DossierTab, string> = {
    overview: "Case identity, status, metadata, custody chain, and FedEx tracking summary.",
    timeline: "Chronological lifecycle events — status changes, inspections, shipments, custody handoffs.",
    map: "Interactive map showing the case's current and historical locations.",
    manifest: "Full packing list with per-item inspection status and damage flags.",
    evidence: "Damage reports with annotated photo evidence from field technicians.",
    activity: "Immutable audit log with hash-chain verification of all case events.",
  };

  return (
    <div className={styles.placeholder} data-testid={`dossier-placeholder-${tab}`}>
      <div className={styles.placeholderIcon}>{icons[tab]}</div>
      <p className={styles.placeholderTitle}>{DOSSIER_TABS.find((t) => t.id === tab)?.label ?? tab}</p>
      <p className={styles.placeholderText}>{descriptions[tab]}</p>
      <span className={styles.placeholderBadge}>
        <StatusPill kind="pending" />
        <span className={styles.placeholderBadgeText}>Content loading</span>
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * T4DossierShell — the tabbed dossier shell for the FF_INV_REDESIGN case detail.
 *
 * Renders a 6-tab navigation bar and the corresponding content panel.
 * Supports both controlled and uncontrolled modes.
 * Full WAI-ARIA tabs pattern with keyboard navigation.
 */
export function T4DossierShell({
  caseId,
  activeTab: controlledTab,
  initialTab = "overview",
  onTabChange,
  ffAuditHashChain = false,
  tabContent,
  className,
}: T4DossierShellProps) {
  // ── Tab state — uncontrolled when `activeTab` is not provided ───────────────
  const [internalTab, setInternalTab] = useState<DossierTab>(initialTab);
  const [isRecallOpen, setIsRecallOpen] = useState(false);
  const [isRecallSubmitting, setIsRecallSubmitting] = useState(false);
  const [recallError, setRecallError] = useState<string | null>(null);

  const caseDoc = useQuery(api.cases.getCaseById, {
    caseId: caseId as Id<"cases">,
  });
  const recallCase = useMutation(api.cases.recallCase);

  // Resolve the effective active tab: controlled > internal
  const activeTab = controlledTab ?? internalTab;

  // ── Tab change handler ───────────────────────────────────────────────────────
  const handleTabActivate = useCallback(
    (tab: DossierTab) => {
      // In uncontrolled mode, update internal state.
      // In controlled mode, the parent is expected to update `activeTab`.
      if (controlledTab === undefined) {
        setInternalTab(tab);
      }
      onTabChange?.(tab);
    },
    [controlledTab, onTabChange]
  );

  // ── Tab bar refs for keyboard navigation ─────────────────────────────────────
  const tabRefs = useRef<Map<DossierTab, HTMLButtonElement | null>>(new Map());

  // Focus a specific tab button (used by keyboard handler)
  const focusTab = useCallback((tab: DossierTab) => {
    tabRefs.current.get(tab)?.focus();
  }, []);

  // ── Keyboard navigation (WAI-ARIA tabs pattern) ───────────────────────────────
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, currentTab: DossierTab) => {
      const tabIds = DOSSIER_TABS.map((t) => t.id);
      const currentIdx = tabIds.indexOf(currentTab);

      switch (event.key) {
        case "ArrowLeft": {
          event.preventDefault();
          const prevIdx = (currentIdx - 1 + tabIds.length) % tabIds.length;
          focusTab(tabIds[prevIdx]);
          break;
        }
        case "ArrowRight": {
          event.preventDefault();
          const nextIdx = (currentIdx + 1) % tabIds.length;
          focusTab(tabIds[nextIdx]);
          break;
        }
        case "Home": {
          event.preventDefault();
          focusTab(tabIds[0]);
          break;
        }
        case "End": {
          event.preventDefault();
          focusTab(tabIds[tabIds.length - 1]);
          break;
        }
        case "Enter":
        case " ": {
          event.preventDefault();
          handleTabActivate(currentTab);
          break;
        }
        default:
          break;
      }
    },
    [focusTab, handleTabActivate]
  );

  // ── Sync internal state when controlled activeTab changes ────────────────────
  useEffect(() => {
    if (controlledTab !== undefined && controlledTab !== internalTab) {
      setInternalTab(controlledTab);
    }
  }, [controlledTab, internalTab]);

  // ── Render content for the active tab ────────────────────────────────────────
  function renderTabContent(tab: DossierTab): ReactNode {
    // 1. Custom override from parent
    if (tabContent?.[tab] !== undefined) {
      return tabContent[tab];
    }

    // 2. Feature-gated tabs
    const tabConfig = DOSSIER_TABS.find((t) => t.id === tab);
    if (tabConfig?.ffRequired === "FF_AUDIT_HASH_CHAIN" && !ffAuditHashChain) {
      return (
        <FeatureGateNotice
          tabLabel={tabConfig.label}
          flagName={tabConfig.ffRequired}
        />
      );
    }

    // 3. Overview tab — real content panel (Sub-AC 1)
    if (tab === "overview") {
      return (
        <DossierOverviewPanel
          caseId={caseId}
          onNavigateToShipping={() => handleTabActivate("manifest")}
        />
      );
    }

    // 4. Activity tab — recent actions feed with user attribution and action
    //    type indicators (Sub-AC 3). Only rendered when the feature flag is
    //    enabled; the gate notice above handles the disabled case.
    if (tab === "activity") {
      return <DossierActivityPanel caseId={caseId} />;
    }

    // 5. Map tab — interactive Mapbox GL JS map centred on the case's
    //    last-known GPS position with a status-colored pin marker and
    //    a GPS data strip below the canvas (Sub-AC 1).
    if (tab === "map") {
      return <DossierMapPanel caseId={caseId} />;
    }

    // 6. Evidence tab — damage photo gallery with annotation overlays,
    //    inspection report summary, and item-level damage cards.
    //    Backed by three real-time Convex subscriptions:
    //      useDamagePhotoReportsWithUrls  → annotated photos with resolved URLs
    //      useDamageReportsByCase         → per-item damage records
    //      useChecklistWithInspection     → inspection header + progress
    //    Sub-AC 3: DossierEvidencePanel.
    if (tab === "evidence") {
      return <DossierEvidencePanel caseId={caseId} />;
    }

    // 7. Default placeholder (replaced by subsequent Sub-ACs)
    return <TabPlaceholder tab={tab} caseId={caseId} />;
  }

  const rootClass = [styles.dossier, className].filter(Boolean).join(" ");
  const canRecall =
    caseDoc !== undefined &&
    caseDoc !== null &&
    ["assembled", "transit_out", "deployed", "flagged"].includes(caseDoc.status);

  async function handleRecallSubmit(data: RecallRerouteData) {
    if (!caseDoc) return;
    setRecallError(null);
    setIsRecallSubmitting(true);
    try {
      await recallCase({
        caseId: caseDoc._id,
        reason: data.reason,
        returnMethod: data.returnMethod,
        notes: data.notes,
      });
      setIsRecallOpen(false);
    } catch (err) {
      setRecallError(err instanceof Error ? err.message : "Unable to recall case.");
    } finally {
      setIsRecallSubmitting(false);
    }
  }

  return (
    <section
      className={rootClass}
      aria-label="Case dossier"
      data-testid="t4-dossier-shell"
      data-case-id={caseId}
      data-active-tab={activeTab}
    >
      {caseDoc && (
        <div className={styles.actionBar}>
          <div>
            <p className={styles.actionEyebrow}>Case dossier</p>
            <div className={styles.actionTitleRow}>
              <strong>{caseDoc.label}</strong>
              <StatusPill kind={caseDoc.status} />
            </div>
            {caseDoc.recallReason && (
              <p className={styles.recallReason}>Recall reason: {caseDoc.recallReason}</p>
            )}
            {recallError && <p className={styles.recallError}>{recallError}</p>}
          </div>
          {canRecall && (
            <button
              type="button"
              className={styles.recallButton}
              onClick={() => setIsRecallOpen(true)}
            >
              Recall
            </button>
          )}
        </div>
      )}

      {/* ── Tab navigation bar ────────────────────────────────────── */}
      <nav
        className={styles.tabBar}
        role="tablist"
        aria-label="Case dossier navigation"
        aria-orientation="horizontal"
      >
        {DOSSIER_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          const isActivityGated =
            tab.ffRequired === "FF_AUDIT_HASH_CHAIN" && !ffAuditHashChain;

          return (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current.set(tab.id, el); }}
              role="tab"
              aria-selected={isActive}
              aria-controls={`dossier-panel-${tab.id}-${caseId}`}
              id={`dossier-tab-${tab.id}-${caseId}`}
              tabIndex={isActive ? 0 : -1}
              className={[
                styles.tab,
                isActive ? styles.tabActive : "",
                isActivityGated ? styles.tabGated : "",
              ]
                .filter(Boolean)
                .join(" ")}
              title={
                isActivityGated
                  ? `${tab.label} requires ${tab.ffRequired}`
                  : tab.description
              }
              onClick={() => handleTabActivate(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, tab.id)}
              data-tab-id={tab.id}
            >
              <span className={styles.tabLabel}>{tab.label}</span>
              {tab.ffRequired && !ffAuditHashChain && (
                <span
                  className={styles.tabFfBadge}
                  aria-label={`Requires ${tab.ffRequired} feature flag`}
                >
                  FF
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Active tab panel ──────────────────────────────────────── */}
      {DOSSIER_TABS.map((tab) => {
        const isActive = tab.id === activeTab;

        return (
          <div
            key={tab.id}
            id={`dossier-panel-${tab.id}-${caseId}`}
            role="tabpanel"
            aria-labelledby={`dossier-tab-${tab.id}-${caseId}`}
            aria-label={`${tab.label} panel`}
            className={[
              styles.tabPanel,
              isActive ? styles.tabPanelActive : styles.tabPanelHidden,
              // Map tab: remove padding + overflow so DossierMapPanel fills edge-to-edge
              tab.id === "map" ? styles.tabPanelMap : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-tab={tab.id}
            // Allow panel to receive focus via Tab key from the tab bar
            tabIndex={isActive ? 0 : -1}
            hidden={!isActive}
          >
            {/*
             * Render content only for the active tab to avoid unnecessary
             * Convex subscriptions and React tree overhead for inactive tabs.
             * The hidden panels use `hidden` attribute + CSS for instant
             * tab switching without layout thrash.
             */}
            {isActive && renderTabContent(tab.id)}
          </div>
        );
      })}
      {caseDoc && (
        <RecallModal
          isOpen={isRecallOpen}
          onClose={() => setIsRecallOpen(false)}
          onConfirm={() => undefined}
          onSubmit={(data) => void handleRecallSubmit(data)}
          caseId={caseDoc._id}
          caseData={{
            label: caseDoc.label,
            status: caseDoc.status,
            locationName: caseDoc.locationName,
            assigneeName: caseDoc.assigneeName,
            updatedAt: caseDoc.updatedAt,
          }}
          isSubmitting={isRecallSubmitting}
        />
      )}
    </section>
  );
}

export default T4DossierShell;
