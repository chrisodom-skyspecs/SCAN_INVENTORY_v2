/**
 * CaseDetail — INVENTORY T-layout case detail panel components.
 *
 * Main export: CaseDetailPanel (container with T1–T5 tab navigation).
 * Individual T-layouts are lazy-loaded inside CaseDetailPanel and not
 * re-exported here to avoid adding them to the main bundle.
 *
 * T2Timeline is also exported directly for embedding in non-panel contexts,
 * such as side-by-side map+timeline layouts.
 *
 * T4DossierShell is exported for the FF_INV_REDESIGN case detail path —
 * a consolidated 6-tab dossier panel (Overview, Timeline, Map, Manifest,
 * Evidence, Activity) that replaces the T1–T5 switcher approach.
 */

export { CaseDetailPanel } from "./CaseDetailPanel";
export type { CaseDetailPanelProps } from "./CaseDetailPanel";
export { InlineStatusEditor } from "./InlineStatusEditor";
export type { InlineStatusEditorProps } from "./InlineStatusEditor";
export { InlineHolderEditor } from "./InlineHolderEditor";
export type { InlineHolderEditorProps } from "./InlineHolderEditor";
export { InlineSiteEditor } from "./InlineSiteEditor";
export type { InlineSiteEditorProps } from "./InlineSiteEditor";
export { JourneyTimeline } from "./JourneyTimeline";
export type { JourneyTimelineProps } from "./JourneyTimeline";
export { T1MapPanel } from "./T1MapPanel";
export type { T1MapPanelProps } from "./T1MapPanel";
export { default as T2Timeline } from "./T2Timeline";
export type { T2TimelineProps } from "./T2Timeline";
export { T4DossierShell, isDossierTab, DOSSIER_TAB_VALUES } from "./T4DossierShell";
export type { T4DossierShellProps, DossierTab } from "./T4DossierShell";
export { DossierOverviewPanel } from "./DossierOverviewPanel";
export type { DossierOverviewPanelProps } from "./DossierOverviewPanel";
export { DossierActivityPanel } from "./DossierActivityPanel";
export type { DossierActivityPanelProps } from "./DossierActivityPanel";
export { DossierMapPanel } from "./DossierMapPanel";
export type { DossierMapPanelProps } from "./DossierMapPanel";
export { DossierEvidencePanel } from "./DossierEvidencePanel";
export type { DossierEvidencePanelProps } from "./DossierEvidencePanel";
