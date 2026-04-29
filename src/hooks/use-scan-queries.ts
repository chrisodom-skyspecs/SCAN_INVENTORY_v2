/**
 * src/hooks/use-scan-queries.ts
 *
 * SCAN app query layer — Convex `useQuery` subscriptions for the SCAN mobile app.
 *
 * Sub-AC 2a: Define and wire useQuery hooks for core SCAN data subscriptions
 * (case detail, item checklist, case status) in the SCAN app query layer.
 *
 * Architecture
 * ────────────
 * This module is the canonical query surface for the SCAN mobile app.  It
 * composes the lower-level hooks from use-case-status.ts and use-checklist.ts
 * into semantically-named SCAN-specific hooks.
 *
 * Using a dedicated SCAN query layer provides:
 *   1. A single import point for SCAN page components — one import instead of
 *      two separate imports from use-case-status and use-checklist.
 *   2. Semantic names aligned with the SCAN app workflows — `useScanCaseDetail`
 *      reads clearer in a SCAN component than `useCaseById`.
 *   3. A stable refactoring boundary — if the underlying Convex query names
 *      change, only this file needs updating (not every SCAN page component).
 *   4. Consistent documentation explaining SCAN-specific usage patterns,
 *      loading state contracts, and skip semantics.
 *
 * Query categories
 * ────────────────
 * Case detail subscriptions (backed by convex/cases.ts queries):
 *   useScanCaseDetail(caseId)      — full case document for case detail pages
 *   useScanCaseStatus(caseId)      — lightweight status projection for badges
 *   useScanCaseByQrCode(qrCode)    — case lookup by QR payload (post-scan flow)
 *
 * Checklist subscriptions (backed by convex/checklists.ts queries):
 *   useScanChecklist(caseId)                — full item list for the checklist view
 *   useScanChecklistSummary(caseId)         — aggregate progress counts (header bar)
 *   useScanChecklistWithInspection(caseId)  — combined items + inspection (inspect page)
 *   useScanChecklistItemsByStatus(caseId, status) — status-filtered item list
 *   useScanUncheckedItems(caseId)           — remaining unchecked items only
 *
 * Real-time fidelity
 * ──────────────────
 * All hooks delegate to Convex `useQuery` which subscribes to the server-side
 * query function.  Convex re-evaluates any subscribed query within ~100–300 ms
 * whenever the underlying database rows change — satisfying the ≤ 2-second
 * real-time fidelity requirement between SCAN app mutations and INVENTORY
 * dashboard visibility.
 *
 * Loading / error states
 * ──────────────────────
 * All hooks propagate the `useQuery` convention unchanged:
 *   `undefined`  — query is loading (initial fetch or reconnect)
 *   `null`       — query returned null (document not found / no records)
 *   `T`          — successful result
 *
 * Components should guard against `undefined` (show skeleton) and `null`
 * (show not-found or empty state).
 *
 * Skip pattern
 * ────────────
 * Passing `"skip"` as the second argument to `useQuery` suppresses the
 * subscription entirely.  All hooks accept nullable caseId / qrCode and use
 * `"skip"` when the value is null, avoiding Convex traffic when no case is
 * selected (e.g., before a QR code has been scanned).
 *
 * Usage example — case detail page:
 *   import { useScanCaseDetail } from "@/hooks/use-scan-queries";
 *
 *   function ScanCaseDetailClient({ caseId }: { caseId: string }) {
 *     const caseDoc = useScanCaseDetail(caseId);
 *     if (caseDoc === undefined) return <CaseSkeleton />;
 *     if (caseDoc === null) return <CaseNotFound />;
 *     return <CaseDetailView case={caseDoc} />;
 *   }
 *
 * Usage example — inspection page:
 *   import { useScanChecklistWithInspection } from "@/hooks/use-scan-queries";
 *
 *   function ScanInspectClient({ caseId }: { caseId: string }) {
 *     const state = useScanChecklistWithInspection(caseId);
 *     if (state === undefined) return <InspectionSkeleton />;
 *     const { items, inspection, summary } = state;
 *     return <InspectionView items={items} summary={summary} />;
 *   }
 */

"use client";

// ─── Re-export underlying hooks (delegation layer) ────────────────────────────
// The SCAN query layer wraps but does not duplicate the implementation.
// Each SCAN hook delegates to its counterpart in the generic hook modules.

import {
  useCaseById,
  useCaseStatus,
  useCaseByQrCode,
  useCaseByQrIdentifier,
} from "./use-case-status";

import {
  useChecklistByCase,
  useChecklistSummary,
  useChecklistWithInspection,
  useChecklistItemsByStatus,
  useUncheckedItems,
} from "./use-checklist";

// ─── Re-export types ──────────────────────────────────────────────────────────
// SCAN components can import their types from this single module.

export type {
  CaseStatus,
  BoundsFilter,
} from "./use-case-status";

// CaseStatusResult is defined in convex/cases but not re-exported from use-case-status;
// import directly so SCAN consumers can access the lightweight status projection type.
export type { CaseStatusResult } from "../../convex/cases";

export type {
  ManifestItemStatus,
  ChecklistItem,
  ChecklistSummary,
  ChecklistWithInspection,
  MANIFEST_ITEM_STATUSES,
} from "./use-checklist";

// ─── Case Detail Hooks ────────────────────────────────────────────────────────

/**
 * Subscribe to the full case document for SCAN app case detail pages.
 *
 * This is the primary hook for `/scan/[caseId]` (ScanCaseDetailClient).
 * Returns the complete `Doc<"cases">` row including all optional fields
 * (qrCode, notes, templateId, shipping fields, etc.).
 *
 * Convex re-evaluates and pushes the updated document whenever the case row
 * changes — e.g., after an `associateQRCodeToCase`, `scanCheckIn`, or `shipCase`
 * mutation.  This means the QR code card, status pill, and metadata shown on
 * the case detail page update within ~100–300 ms of any mutation, satisfying
 * the ≤ 2-second real-time fidelity requirement.
 *
 * Pass `null` as `caseId` to skip the subscription (no case selected).
 *
 * Return values:
 *   `undefined`       — loading (initial fetch or reconnect)
 *   `null`            — case not found (deleted or invalid ID)
 *   `Doc<"cases">`    — live full case document
 *
 * @param caseId  Convex case document ID string, or `null` to skip.
 *
 * @example
 * function ScanCaseDetailClient({ caseId }: { caseId: string }) {
 *   const caseDoc = useScanCaseDetail(caseId);
 *   if (caseDoc === undefined) return <CaseSkeleton />;
 *   if (caseDoc === null) return <CaseNotFound />;
 *   return (
 *     <div>
 *       <h1>{caseDoc.label}</h1>
 *       <StatusPill kind={caseDoc.status} />
 *     </div>
 *   );
 * }
 */
export function useScanCaseDetail(caseId: string | null) {
  return useCaseById(caseId);
}

/**
 * Subscribe to the lightweight status projection for a case.
 *
 * Returns only the fields needed for status badges, map pin labels, and the
 * check-in confirmation screen — avoids transferring the full document when
 * only status info is needed.
 *
 * Used by:
 *   • `/scan/[caseId]/check-in` — current status display and transition UI
 *   • Status pill rendering in SCAN app headers
 *   • Any SCAN view that needs status without the full case document
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`         — loading
 *   `null`              — case not found
 *   `CaseStatusResult`  — live status + key display fields
 *
 * @param caseId  Convex case document ID string, or `null` to skip.
 *
 * @example
 * function CheckInStatusHeader({ caseId }: { caseId: string }) {
 *   const status = useScanCaseStatus(caseId);
 *   if (status === undefined) return <StatusSkeleton />;
 *   if (status === null) return null;
 *   return <StatusPill kind={status.status} />;
 * }
 */
export function useScanCaseStatus(caseId: string | null) {
  return useCaseStatus(caseId);
}

/**
 * Subscribe to a case by its QR code payload.
 *
 * This is the SCAN app post-scan hook — called after the camera decodes a
 * QR code and the app needs to resolve which case it belongs to.  Convex
 * subscribes to the query and updates the component whenever the matched
 * case changes.
 *
 * The subscription is active as long as `qrCode` is non-null, allowing the
 * SCAN app to show live case state for the scanned case without re-scanning.
 *
 * Pass `null` as `qrCode` to skip the subscription (camera not yet scanned).
 *
 * Return values:
 *   `undefined`       — loading / resolving
 *   `null`            — QR code not found in system (unregistered label)
 *   `Doc<"cases">`    — matched case document
 *
 * @param qrCode  Decoded QR code payload string, or `null` to skip.
 *
 * @example
 * function ScanResultView({ scannedCode }: { scannedCode: string | null }) {
 *   const caseDoc = useScanCaseByQrCode(scannedCode);
 *   if (scannedCode === null) return <ScanPrompt />;
 *   if (caseDoc === undefined) return <ResolvingSpinner />;
 *   if (caseDoc === null) return <QrNotFoundError code={scannedCode} />;
 *   return <CaseFoundView case={caseDoc} />;
 * }
 */
export function useScanCaseByQrCode(qrCode: string | null) {
  return useCaseByQrCode(qrCode);
}

/**
 * Subscribe to a case by any recognized QR identifier (multi-strategy lookup).
 *
 * This is the preferred SCAN app hook for the scanner flow because it handles
 * all recognized QR payload formats and falls back gracefully to label matching
 * for manual entry.  Internally delegates to `getCaseByQrIdentifier` which
 * tries three strategies in order:
 *   A. Exact `cases.qrCode` index match (generated and external QR URLs)
 *   B. Embedded Convex case-ID extraction from generated URL patterns
 *   C. Plain case-label match (e.g., "CASE-001" from manual entry)
 *
 * Pass `null` as `identifier` to skip the subscription (camera not yet scanned).
 *
 * Return values:
 *   `undefined`       — query loading / resolving
 *   `null`            — identifier not recognized (all strategies missed)
 *   `Doc<"cases">`    — matched case document; use `caseDoc._id` for navigation
 *
 * @param identifier  Raw QR payload, case URL, or plain label; `null` to skip.
 *
 * @example
 * // Post-scan resolver in the QR scanner component:
 * const caseDoc = useScanCaseByQrIdentifier(scannedRawValue);
 * if (caseDoc === undefined) return <ResolvingSpinner />;
 * if (caseDoc === null) return <QrNotFoundError />;
 * // Auto-navigate via useEffect watching caseDoc
 */
export function useScanCaseByQrIdentifier(identifier: string | null) {
  return useCaseByQrIdentifier(identifier);
}

// ─── Checklist / Inspection Hooks ─────────────────────────────────────────────

/**
 * Subscribe to all manifest items (checklist) for a case.
 *
 * Returns the full list of manifest items sorted by name, with each item's
 * inspection status, notes, and photo storage IDs.
 *
 * Used by:
 *   • SCAN app checklist view — technician works through each packing item
 *   • Damage report flow — show items to select when reporting damage
 *
 * For the inspect page, prefer `useScanChecklistWithInspection` which bundles
 * the item list with the inspection record and summary in one subscription.
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`          — loading
 *   `ChecklistItem[]`    — live item list (empty array when no template applied)
 *
 * @param caseId  Convex case document ID string, or `null` to skip.
 *
 * @example
 * function ScanItemList({ caseId }: { caseId: string | null }) {
 *   const items = useScanChecklist(caseId);
 *   if (items === undefined) return <ChecklistSkeleton />;
 *   if (items.length === 0) return <NoItemsNotice />;
 *   return (
 *     <ul>
 *       {items.map((item) => <ChecklistRow key={item._id} item={item} />)}
 *     </ul>
 *   );
 * }
 */
export function useScanChecklist(caseId: string | null) {
  return useChecklistByCase(caseId);
}

/**
 * Subscribe to the aggregate checklist progress summary for a case.
 *
 * Returns total item count, a breakdown by status (ok / damaged / missing /
 * unchecked), a `progressPct` (0–100), and an `isComplete` flag.
 *
 * This is a lighter-weight alternative to `useScanChecklist` when only the
 * summary numbers are needed — e.g., for a progress bar in the SCAN app
 * header or to gate the "Complete Inspection" CTA.
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`          — loading
 *   `ChecklistSummary`   — live aggregate counts
 *
 * @param caseId  Convex case document ID string, or `null` to skip.
 *
 * @example
 * function ScanProgressBar({ caseId }: { caseId: string | null }) {
 *   const summary = useScanChecklistSummary(caseId);
 *   if (!summary) return <ProgressBarSkeleton />;
 *   return (
 *     <div>
 *       <progress value={summary.progressPct} max={100} />
 *       <span>{summary.progressPct}% reviewed</span>
 *     </div>
 *   );
 * }
 */
export function useScanChecklistSummary(caseId: string | null) {
  return useChecklistSummary(caseId);
}

/**
 * Subscribe to the combined checklist items + inspection state for a case.
 *
 * This is the primary hook for the SCAN app inspection view
 * (`/scan/[caseId]/inspect`).  It bundles:
 *   • `items`      — all manifest items, sorted by name
 *   • `inspection` — the latest inspection record (status, inspector, counters)
 *                    or `null` if no inspection has been started yet
 *   • `summary`    — aggregate progress counts (progressPct, isComplete, etc.)
 *
 * Using a single subscription avoids "two-query flicker" — Convex evaluates
 * both table reads at the same logical timestamp so the client always receives
 * a consistent snapshot.
 *
 * When `updateChecklistItem` writes to `manifestItems` and `inspections`,
 * Convex re-evaluates this query and pushes the diff to all subscribers within
 * ~100–300 ms — so the checklist and progress bar update live as the technician
 * works through items.
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`                  — loading
 *   `ChecklistWithInspection`    — live combined checklist + inspection state
 *
 * @param caseId  Convex case document ID string, or `null` to skip.
 *
 * @example
 * function ScanInspectClient({ caseId }: { caseId: string }) {
 *   const state = useScanChecklistWithInspection(caseId);
 *
 *   if (state === undefined) return <InspectionSkeleton />;
 *
 *   const { items, inspection, summary } = state;
 *   return (
 *     <div>
 *       <InspectionHeader inspection={inspection} summary={summary} />
 *       <ChecklistItemList items={items} />
 *       <CompleteButton disabled={!summary.isComplete} />
 *     </div>
 *   );
 * }
 */
export function useScanChecklistWithInspection(caseId: string | null) {
  return useChecklistWithInspection(caseId);
}

/**
 * Subscribe to manifest items filtered by a specific completion status.
 *
 * Uses the `by_case_status` compound index for O(log n) server-side filtering.
 * This is the primary hook for status-scoped views in the SCAN app:
 *   • "Show me only the damaged items" (damaged items list)
 *   • "How many items still need review" (unchecked items count)
 *   • "Review only the items marked missing" (focused re-inspection)
 *
 * Convex re-evaluates this query automatically whenever a manifest item in
 * the case changes status — e.g., when the technician marks an item "ok",
 * the "unchecked" list shrinks in real-time.
 *
 * Pass `null` for either argument to skip the subscription.
 *
 * Status values:
 *   "unchecked" — not yet reviewed (default after template apply)
 *   "ok"        — confirmed present and undamaged
 *   "damaged"   — present but with documented damage
 *   "missing"   — not found during inspection
 *
 * Return values:
 *   `undefined`          — loading
 *   `ChecklistItem[]`    — live filtered item list (may be empty array)
 *
 * @param caseId  Convex case document ID string, or `null` to skip.
 * @param status  Completion status to filter by, or `null` to skip.
 *
 * @example
 * // Dashboard T4 panel equivalent in SCAN: show only damaged items
 * function ScanDamagedItemsSection({ caseId }: { caseId: string | null }) {
 *   const damaged = useScanChecklistItemsByStatus(caseId, "damaged");
 *   if (damaged === undefined) return <Spinner />;
 *   if (damaged.length === 0) return <p>No damaged items.</p>;
 *   return (
 *     <ul>
 *       {damaged.map((item) => <DamageReportRow key={item._id} item={item} />)}
 *     </ul>
 *   );
 * }
 */
export function useScanChecklistItemsByStatus(
  caseId: string | null,
  status: "unchecked" | "ok" | "damaged" | "missing" | null,
) {
  return useChecklistItemsByStatus(caseId, status);
}

/**
 * Subscribe to all unchecked (not-yet-reviewed) manifest items for a case.
 *
 * Convenience hook for the SCAN app inspection workflow — returns only items
 * still in "unchecked" state (the technician's remaining work list).  The list
 * shrinks in real-time as the technician marks items ok/damaged/missing.
 *
 * This hook is equivalent to `useScanChecklistItemsByStatus(caseId, "unchecked")`
 * but with a more descriptive name at the call site — use it when only the
 * remaining items matter, not all items.
 *
 * When the returned array is empty (and not `undefined`), all items have been
 * reviewed and the "Complete Inspection" CTA should be enabled.  This is the
 * reactive indicator that drives the `summary.isComplete` flag.
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`          — loading
 *   `ChecklistItem[]`    — live list of unchecked items (empty when all done)
 *
 * @param caseId  Convex case document ID string, or `null` to skip.
 *
 * @example
 * function ScanRemainingWorkWidget({ caseId }: { caseId: string | null }) {
 *   const remaining = useScanUncheckedItems(caseId);
 *
 *   if (remaining === undefined) return <Spinner />;
 *
 *   if (remaining.length === 0) {
 *     return <p>All items reviewed — tap Complete to finish.</p>;
 *   }
 *
 *   return <p>{remaining.length} items still to review.</p>;
 * }
 */
export function useScanUncheckedItems(caseId: string | null) {
  return useUncheckedItems(caseId);
}
