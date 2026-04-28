/**
 * src/hooks/use-case-status.ts
 *
 * Convex `useQuery` hooks for real-time case status subscriptions.
 *
 * Architecture
 * ────────────
 * Each hook is a thin wrapper around `useQuery` (from convex/react) that
 * subscribes to the corresponding public query function in convex/cases.ts.
 * Convex's reactive transport layer pushes updates from the server to all
 * active subscriptions within ~100–300 ms of a mutation, satisfying the
 * ≤ 2-second real-time fidelity requirement.
 *
 * Loading / error states
 * ──────────────────────
 * `useQuery` returns:
 *   • `undefined`  — query is loading (initial fetch or reconnect)
 *   • `null`       — query returned null (document not found)
 *   • `T`          — successful result
 *
 * All hooks propagate this convention unchanged.  Components should guard
 * against `undefined` (show skeleton) and `null` (show not-found state).
 *
 * Skip pattern
 * ────────────
 * Passing `"skip"` as the second argument to `useQuery` suppresses the
 * subscription entirely.  All hooks accept a nullable ID / code and use
 * `"skip"` when the value is null, avoiding unnecessary Convex traffic
 * while a case is not yet selected.
 *
 * Available hooks:
 *   useCaseStatus(caseId)          — single case status + display fields
 *   useCaseById(caseId)            — full case document for T1–T5 panels
 *   useCaseByQrCode(qrCode)        — case lookup by QR payload (SCAN app)
 *   useAllCases()                  — all cases unfiltered (Fleet Overview)
 *   useCasesByStatus(status)       — cases filtered by lifecycle status
 *   useCasesByMission(missionId)   — cases assigned to a mission
 *   useCasesByBounds(bounds)       — cases within a geographic bounding box
 *   useCasesInBounds(bounds,status)— viewport-aware location query
 *   useCaseStatusCounts()          — aggregate counts for dashboard header
 */

"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { CaseStatus, BoundsFilter } from "../../convex/cases";

// Re-export so consumers can import these types from the hook module too
export type { CaseStatus, BoundsFilter } from "../../convex/cases";

// ─── useCaseStatus ────────────────────────────────────────────────────────────

/**
 * Subscribe to real-time status and display fields for a single case.
 *
 * Returns a lightweight projection (not the full document) sufficient for
 * map pins, status badges, and the case-detail panel header.
 *
 * Pass `null` as `caseId` to skip the subscription (no case selected).
 *
 * Return values:
 *   `undefined`         — loading
 *   `null`              — case not found
 *   `CaseStatusResult`  — live case status data
 *
 * @example
 * function CaseStatusBadge({ caseId }: { caseId: string | null }) {
 *   const caseStatus = useCaseStatus(caseId);
 *   if (caseStatus === undefined) return <Skeleton />;
 *   if (caseStatus === null) return null;
 *   return <StatusPill kind={caseStatus.status} />;
 * }
 */
export function useCaseStatus(caseId: string | null) {
  return useQuery(
    api.cases.getCaseStatus,
    caseId !== null ? { caseId } : "skip",
  );
}

// ─── useCaseById ──────────────────────────────────────────────────────────────

/**
 * Subscribe to the full case document for T1–T5 detail panel rendering.
 *
 * Returns the complete `Doc<"cases">` row including all optional fields
 * (notes, templateId, etc.).  Use this when the detail panel needs data
 * beyond the lightweight getCaseStatus projection.
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`       — loading
 *   `null`            — case not found
 *   `Doc<"cases">`    — full live case document
 *
 * @example
 * function CaseDetailPanel({ caseId }: { caseId: string | null }) {
 *   const caseDoc = useCaseById(caseId);
 *   if (caseDoc === undefined) return <PanelSkeleton />;
 *   if (caseDoc === null) return <CaseNotFound />;
 *   return <T1Summary case={caseDoc} />;
 * }
 */
export function useCaseById(caseId: string | null) {
  return useQuery(
    api.cases.getCaseById,
    caseId !== null ? { caseId } : "skip",
  );
}

// ─── useCaseByQrCode ──────────────────────────────────────────────────────────

/**
 * Subscribe to a case by its QR code payload.
 *
 * Primary hook for the SCAN mobile app.  After the camera decodes a QR code,
 * the app calls this hook with the decoded string.  Convex subscribes to the
 * query and updates the component whenever the case changes — ensuring the
 * technician always sees the current state.
 *
 * Pass `null` as `qrCode` to skip the subscription (pre-scan state).
 *
 * Return values:
 *   `undefined`       — loading / scanning in progress
 *   `null`            — QR code not found in system
 *   `Doc<"cases">`    — matched case document
 *
 * @example
 * function ScanResult({ scannedCode }: { scannedCode: string | null }) {
 *   const caseDoc = useCaseByQrCode(scannedCode);
 *   if (scannedCode === null) return <ScanPrompt />;
 *   if (caseDoc === undefined) return <Looking />;
 *   if (caseDoc === null) return <QrNotFound code={scannedCode} />;
 *   return <CaseInspectionView case={caseDoc} />;
 * }
 */
export function useCaseByQrCode(qrCode: string | null) {
  return useQuery(
    api.cases.getCaseByQrCode,
    qrCode !== null ? { qrCode } : "skip",
  );
}

// ─── useAllCases ──────────────────────────────────────────────────────────────

/**
 * Subscribe to all cases, unfiltered, ordered by updatedAt descending.
 *
 * Used by the M1 (Fleet Overview) and M2 (Mission Mode) map views to
 * maintain a live list of all case pins.  Any SCAN app mutation — status
 * change, inspection update, custody handoff — triggers a push update to
 * all components subscribed to this hook.
 *
 * Return values:
 *   `undefined`           — loading
 *   `Doc<"cases">[]`      — live case list (may be empty array)
 *
 * @example
 * function FleetOverviewMap() {
 *   const cases = useAllCases();
 *   if (cases === undefined) return <MapSkeleton />;
 *   return <CasePins cases={cases} />;
 * }
 */
export function useAllCases() {
  return useQuery(api.cases.listCases, {});
}

// ─── useCasesByStatus ─────────────────────────────────────────────────────────

/**
 * Subscribe to cases filtered by a specific lifecycle status.
 *
 * Uses the Convex `by_status` index for efficient server-side filtering.
 * Useful for status-specific views like "all cases currently in field"
 * or "all cases in transit".
 *
 * Pass `null` as `status` to skip the subscription.
 *
 * Return values:
 *   `undefined`           — loading
 *   `Doc<"cases">[]`      — live filtered case list
 *
 * @example
 * function InFieldCounter() {
 *   const fieldCases = useCasesByStatus("in_field");
 *   return <span>{fieldCases?.length ?? "—"} in field</span>;
 * }
 */
export function useCasesByStatus(status: CaseStatus | null) {
  return useQuery(
    api.cases.listCases,
    status !== null ? { status } : "skip",
  );
}

// ─── useCasesByMission ────────────────────────────────────────────────────────

/**
 * Subscribe to all cases assigned to a specific mission.
 *
 * Uses the Convex `by_mission` index for efficient server-side filtering.
 * Used by M2 (Mission Mode) when the user drills into a specific mission.
 *
 * Pass `null` as `missionId` to skip the subscription.
 *
 * Return values:
 *   `undefined`           — loading
 *   `Doc<"cases">[]`      — live cases for the given mission
 *
 * @example
 * function MissionCaseList({ missionId }: { missionId: string | null }) {
 *   const cases = useCasesByMission(missionId);
 *   if (cases === undefined) return <Skeleton />;
 *   return <CaseList cases={cases} />;
 * }
 */
export function useCasesByMission(missionId: string | null) {
  return useQuery(
    api.cases.listCases,
    missionId !== null ? { missionId } : "skip",
  );
}

// ─── useCasesByBounds ─────────────────────────────────────────────────────────

/**
 * Subscribe to cases filtered by both a lifecycle status AND a geographic
 * bounding box.  This is the composite filter hook used by map views that
 * want to show only a specific status within the current viewport.
 *
 * Pass `null` as either argument to skip the subscription.  Both arguments
 * must be non-null for the subscription to be active.
 *
 * Internally, this hooks into `listCases` with both `status` and bounds args.
 * Convex re-runs the query whenever any case row changes, so viewport panning
 * (new args object) re-subscribes automatically.
 *
 * Return values:
 *   `undefined`           — loading
 *   `Doc<"cases">[]`      — live case list within the bounds and status
 *
 * @example
 * function InFieldMapPins({ bounds }: { bounds: BoundsFilter | null }) {
 *   const cases = useCasesByBounds("in_field", bounds);
 *   if (cases === undefined) return <MapSkeleton />;
 *   return <CasePins cases={cases} />;
 * }
 */
export function useCasesByBounds(
  status: CaseStatus | null,
  bounds: BoundsFilter | null,
) {
  return useQuery(
    api.cases.listCases,
    status !== null && bounds !== null
      ? { status, ...bounds }
      : "skip",
  );
}

// ─── useCasesInBounds ─────────────────────────────────────────────────────────

/**
 * Subscribe to all cases whose last-known location falls within a geographic
 * bounding box.  An optional `status` further narrows results.
 *
 * This is the primary real-time table watcher for viewport-constrained map
 * views.  It delegates to the dedicated `getCasesInBounds` query which is
 * optimised for this access pattern.
 *
 * Pass `null` as `bounds` to skip the subscription entirely (e.g., before
 * the map has initialised and reported its viewport).
 *
 * Return values:
 *   `undefined`           — loading
 *   `Doc<"cases">[]`      — live cases within the viewport
 *
 * @example
 * function FleetMapViewport({ bounds }: { bounds: BoundsFilter | null }) {
 *   const cases = useCasesInBounds(bounds);
 *   if (cases === undefined) return <MapSkeleton />;
 *   return <CasePins cases={cases} />;
 * }
 *
 * @example
 * // Only show in_field cases in the current viewport
 * function FieldModeMap({ bounds }: { bounds: BoundsFilter | null }) {
 *   const cases = useCasesInBounds(bounds, "in_field");
 *   ...
 * }
 */
export function useCasesInBounds(
  bounds: BoundsFilter | null,
  status?: CaseStatus,
) {
  return useQuery(
    api.cases.getCasesInBounds,
    bounds !== null
      ? { ...bounds, ...(status !== undefined ? { status } : {}) }
      : "skip",
  );
}

// ─── useCaseStatusCounts ──────────────────────────────────────────────────────

/**
 * Subscribe to aggregate case status counts for the dashboard summary bar.
 *
 * Provides `total` and a `byStatus` breakdown used to render the global
 * status filter pills at the top of the INVENTORY dashboard.
 *
 * This hook always subscribes (no skip pattern) because the summary bar
 * is always visible when the dashboard is mounted.
 *
 * Return values:
 *   `undefined`           — loading
 *   `CaseStatusCounts`    — live aggregate counts
 *
 * @example
 * function DashboardStatusBar() {
 *   const counts = useCaseStatusCounts();
 *   if (!counts) return <StatusBarSkeleton />;
 *   return (
 *     <div>
 *       <StatusPill kind="in_field" count={counts.byStatus.in_field} />
 *       <StatusPill kind="shipping" count={counts.byStatus.shipping} />
 *       <span>Total: {counts.total}</span>
 *     </div>
 *   );
 * }
 */
export function useCaseStatusCounts() {
  return useQuery(api.cases.getCaseStatusCounts, {});
}
