/**
 * src/hooks/use-damage-reports.ts
 *
 * Convex `useQuery` hooks for real-time damage report subscriptions.
 *
 * Architecture
 * ────────────
 * Each hook is a thin wrapper around `useQuery` (from convex/react) that
 * subscribes to the corresponding public query function in
 * convex/damageReports.ts.  Convex's reactive transport layer pushes updates
 * from the server to all active subscriptions within ~100–300 ms of a
 * mutation, satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * When a SCAN app technician marks an item as "damaged", uploads a damage
 * photo, or submits a damage description, the mutation updates the
 * `manifestItems` row and appends a `damage_reported` event.  Convex
 * automatically re-evaluates all subscribed damage report queries that touch
 * those rows and pushes the diff to connected dashboard sessions — no polling,
 * no manual refetching.
 *
 * Loading / error states
 * ──────────────────────
 * `useQuery` returns:
 *   • `undefined`  — query is loading (initial fetch or reconnect)
 *   • `null`       — query returned null (only for nullable return types)
 *   • `T`          — successful result
 *
 * All hooks propagate this convention unchanged.  Components should guard
 * against `undefined` (show skeleton) and null/empty (show empty state).
 *
 * Skip pattern
 * ────────────
 * Passing `"skip"` as the second argument to `useQuery` suppresses the
 * subscription entirely.  All hooks that accept a nullable caseId use `"skip"`
 * when the value is null, avoiding unnecessary Convex traffic while no case
 * is selected on the dashboard.
 *
 * Available hooks:
 *   useDamageReportsByCase(caseId)
 *     All damage reports for a specific case, sorted by reportedAt desc.
 *     Primary hook for the dashboard T4 panel and the SCAN damage review
 *     screen.  Returns a unified DamageReport[] joining damaged manifest
 *     items with their associated audit events.
 *
 *   useDamageReportEvents(caseId)
 *     Raw `damage_reported` audit events for a case, sorted chronologically.
 *     Used by the T5 hash-chain audit panel (FF_AUDIT_HASH_CHAIN) and any
 *     admin view that needs the full immutable event log.
 *
 *   useDamageReportSummary(caseId)
 *     Aggregate damage counts for a case: totalDamaged, withPhotos,
 *     withoutPhotos, withNotes.  Lightweight alternative to the full report
 *     list for status pills, map pin indicators, and progress bars.
 *
 *   useAllDamageReports(caseStatus?)
 *     Fleet-wide damage reports across all cases, with optional case-status
 *     filter.  Used by the dashboard global damage overview panel and the M3
 *     (Field Mode) map view to surface outstanding damage across the fleet.
 *
 *   useDamagePhotoReportsByRange(caseId, fromTimestamp, toTimestamp)
 *     Damage photo submissions from the `damage_reports` table scoped by both
 *     case ID and an inclusive reportedAt timestamp range.  Uses the compound
 *     `by_case_reported_at` index for O(log n + |range|) seeks.  Ideal for
 *     date-filtered photo galleries and export workflows.
 *
 *   useDamageReportEventsByRange(caseId, fromTimestamp, toTimestamp)
 *     Raw `damage_reported` audit events scoped by both case ID and an
 *     inclusive timestamp range.  Uses the compound `by_case_timestamp` index.
 *     Ideal for narrowing the T5 audit timeline to a specific inspection window.
 */

"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { buildSummary } from "@/lib/checklist-summary";

// Re-export types so consumers can import them from the hook module.
export type {
  DamageReport,
  DamageReportSummary,
  DamageReportEvent,
  DamagePhotoReport,
  DamagePhotoAnnotation,
  SubmitDamagePhotoResult,
} from "../../convex/damageReports";

// ─── useDamageReportsByCase ───────────────────────────────────────────────────

/**
 * Subscribe to all damage reports for a specific case.
 *
 * Returns a unified DamageReport array joining each damaged manifest item
 * with its associated `damage_reported` audit event, sorted by reportedAt
 * descending (most recent damage first).
 *
 * This is the primary hook for:
 *   • Dashboard T4 panel — case detail damage report layout
 *   • SCAN app damage review screen — technician verifies reported damage
 *
 * Convex pushes an update to all subscribers within ~100–300 ms whenever the
 * SCAN app marks an item damaged, uploads a photo, or adds a note.
 *
 * Pass `null` as `caseId` to skip the subscription (no case selected).
 *
 * Return values:
 *   `undefined`       — loading (show skeleton)
 *   `DamageReport[]`  — live damage report list (may be empty array)
 *
 * @example
 * function DamageReportPanel({ caseId }: { caseId: string | null }) {
 *   const reports = useDamageReportsByCase(caseId);
 *
 *   if (reports === undefined) return <DamageReportSkeleton />;
 *   if (reports.length === 0) return <NoDamageMessage />;
 *
 *   return (
 *     <ul>
 *       {reports.map((report) => (
 *         <DamageReportRow key={report.manifestItemId} report={report} />
 *       ))}
 *     </ul>
 *   );
 * }
 */
export function useDamageReportsByCase(caseId: string | null) {
  return useQuery(
    api.damageReports.getDamageReportsByCase,
    caseId !== null ? { caseId: caseId as Id<"cases"> } : "skip",
  );
}

// ─── useDamageReportEvents ────────────────────────────────────────────────────

/**
 * Subscribe to raw `damage_reported` audit events for a case.
 *
 * Returns the immutable event records from the append-only events table,
 * ordered by timestamp ascending (chronological audit order).  Useful for:
 *   • T5 hash-chain audit panel (FF_AUDIT_HASH_CHAIN) filtered to damage
 *   • Admin views that need full event fidelity (reporter, timestamp, hash)
 *   • Generating a damage report export or PDF
 *
 * Unlike `useDamageReportsByCase`, this hook does NOT join with manifest items
 * — it surfaces the raw audit trail exactly as recorded.
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`             — loading (show skeleton)
 *   `DamageReportEvent[]`   — chronologically ordered event list (may be empty)
 *
 * @example
 * function DamageAuditTimeline({ caseId }: { caseId: string | null }) {
 *   const events = useDamageReportEvents(caseId);
 *
 *   if (events === undefined) return <TimelineSkeleton />;
 *   if (events.length === 0) return <NoEventsMessage />;
 *
 *   return (
 *     <ol>
 *       {events.map((event) => (
 *         <AuditEventRow key={event.eventId} event={event} />
 *       ))}
 *     </ol>
 *   );
 * }
 */
export function useDamageReportEvents(caseId: string | null) {
  return useQuery(
    api.damageReports.getDamageReportEvents,
    caseId !== null ? { caseId: caseId as Id<"cases"> } : "skip",
  );
}

// ─── useDamageReportSummary ───────────────────────────────────────────────────

/**
 * Subscribe to aggregate damage counts for a case.
 *
 * Returns lightweight counts (totalDamaged, withPhotos, withoutPhotos,
 * withNotes) rather than full report objects.  This is a lighter-weight
 * subscription than `useDamageReportsByCase` — it transfers a single summary
 * object rather than a full array, making it suitable for:
 *   • Dashboard T2 panel header damage counter chip
 *   • M3 (Field Mode) map pin damage indicator
 *   • SCAN app completion screen: "N items with damage reports"
 *   • StatusPill rendering for damage state
 *
 * Convex re-runs this query whenever any manifest item for the case changes.
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`              — loading (show skeleton)
 *   `DamageReportSummary`    — live aggregate counts
 *
 * @example
 * function DamageCountChip({ caseId }: { caseId: string | null }) {
 *   const summary = useDamageReportSummary(caseId);
 *
 *   if (!summary) return null;
 *   if (summary.totalDamaged === 0) return null;
 *
 *   return (
 *     <StatusPill kind="damaged">
 *       {summary.totalDamaged} damaged
 *       {summary.withoutPhotos > 0 && ` · ${summary.withoutPhotos} unphoto'd`}
 *     </StatusPill>
 *   );
 * }
 */
export function useDamageReportSummary(caseId: string | null) {
  return useQuery(
    api.damageReports.getDamageReportSummary,
    caseId !== null ? { caseId: caseId as Id<"cases"> } : "skip",
  );
}

// ─── useAllDamageReports ──────────────────────────────────────────────────────

/**
 * Subscribe to all damage reports across the entire fleet.
 *
 * Returns every damaged manifest item across all cases, enriched with the
 * case label and damage event metadata, sorted by reportedAt descending.
 *
 * Use cases:
 *   • INVENTORY dashboard global damage overview (no case selected)
 *   • M3 (Field Mode) overlay showing all outstanding field damage
 *   • Operations supervisor review of fleet-wide damage status
 *
 * The optional `caseStatus` filter narrows results to cases in a given
 * lifecycle state, enabling views like "all damage on cases currently in
 * the field" or "all damage reported during transit".
 *
 * No skip pattern is applied here — this hook is typically always active
 * when the dashboard is open.  Pass `undefined` as `caseStatus` to get
 * fleet-wide reports regardless of case status.
 *
 * Return values:
 *   `undefined`       — loading (show skeleton)
 *   `DamageReport[]`  — live fleet-wide damage report list (may be empty)
 *
 * @example
 * // All fleet damage
 * function FleetDamagePanel() {
 *   const reports = useAllDamageReports();
 *   if (reports === undefined) return <DamageReportSkeleton />;
 *   return <DamageReportList reports={reports} />;
 * }
 *
 * @example
 * // Only damage from cases currently in the field
 * function FieldDamagePanel() {
 *   const reports = useAllDamageReports("in_field");
 *   if (reports === undefined) return <DamageReportSkeleton />;
 *   return <DamageReportList reports={reports} />;
 * }
 */
export function useAllDamageReports(
  caseStatus?: "hangar" | "assembled" | "transit_out" | "deployed" | "flagged" | "transit_in" | "received" | "archived",
) {
  return useQuery(api.damageReports.listAllDamageReports, {
    caseStatus,
  });
}

// ─── useDamagePhotoReports ────────────────────────────────────────────────────

/**
 * Subscribe to all damage photo submissions for a specific case.
 *
 * Returns every row from the `damage_reports` table for the given case,
 * sorted by reportedAt descending (most recent photo first).  This is the
 * primary data source for:
 *   • Dashboard T4 panel — photo gallery with annotation overlays and severity
 *     badges rendered via the DamagePhotoGallery component
 *   • Dashboard T5 panel — photo submission history in the audit timeline
 *
 * Unlike `useDamageReportsByCase` (which joins manifestItems + events), this
 * hook reads directly from the `damage_reports` table — the authoritative
 * source for photo-backed damage evidence with full annotation data (x/y
 * pin positions, label text, colour).
 *
 * Convex pushes updates within ~100–300 ms whenever `useSubmitDamagePhoto`
 * writes a new row — satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Pass `null` as `caseId` to skip the subscription (no case selected).
 *
 * Return values:
 *   `undefined`           — loading (show skeleton)
 *   `DamagePhotoReport[]` — live photo report list (may be empty)
 *
 * @example
 * function DamagePhotoGallery({ caseId }: { caseId: string | null }) {
 *   const photos = useDamagePhotoReports(caseId);
 *
 *   if (photos === undefined) return <PhotoGallerySkeleton />;
 *   if (photos.length === 0) return <NoDamagePhotosMessage />;
 *
 *   return (
 *     <ul className="photo-gallery">
 *       {photos.map((photo) => (
 *         <DamagePhotoCard key={photo.id} photo={photo} />
 *       ))}
 *     </ul>
 *   );
 * }
 */
export function useDamagePhotoReports(caseId: string | null) {
  return useQuery(
    api.damageReports.getDamagePhotoReports,
    caseId !== null ? { caseId: caseId as Id<"cases"> } : "skip",
  );
}

// ─── useDamagePhotoReportsByRange ─────────────────────────────────────────────

/**
 * Subscribe to damage photo submissions for a specific case within an
 * inclusive reportedAt timestamp range.
 *
 * Returns every `damage_reports` row for the given case whose `reportedAt`
 * falls within [fromTimestamp, toTimestamp] (epoch ms), sorted by reportedAt
 * descending (most recent photo first within the window).
 *
 * This is the timestamp-range companion to `useDamagePhotoReports`.  It is
 * the hook to use when the operator needs date-filtered damage evidence — for
 * example, a per-shift photo review, a per-inspection export, or a T5 audit
 * panel that lets the user dial in a date range.
 *
 * Index path used on the Convex server:
 *   `damage_reports.by_case_reported_at` on ["caseId", "reportedAt"]
 *   → O(log n + |range|) seek — efficient even for cases with many photos.
 *
 * Convex re-runs this query and pushes the diff to all subscribers within
 * ~100–300 ms whenever `useSubmitDamagePhoto` inserts a new row whose
 * `reportedAt` falls inside the subscribed window.
 *
 * Pass `null` as `caseId` to skip the subscription entirely.
 * Pass `fromTimestamp: 0` and `toTimestamp: Number.MAX_SAFE_INTEGER` to
 * retrieve all photos without date filtering (equivalent to
 * `useDamagePhotoReports`).
 *
 * Return values:
 *   `undefined`           — loading (show skeleton)
 *   `DamagePhotoReport[]` — live date-filtered photo list (may be empty)
 *
 * @param caseId        Convex case ID, or `null` to skip the subscription.
 * @param fromTimestamp Inclusive lower bound in epoch ms (use 0 for open start).
 * @param toTimestamp   Inclusive upper bound in epoch ms.
 *
 * @example
 * function ShiftDamageGallery({
 *   caseId,
 *   shiftStart,
 *   shiftEnd,
 * }: {
 *   caseId: string | null;
 *   shiftStart: number;
 *   shiftEnd: number;
 * }) {
 *   const photos = useDamagePhotoReportsByRange(caseId, shiftStart, shiftEnd);
 *
 *   if (photos === undefined) return <PhotoGallerySkeleton />;
 *   if (photos.length === 0) return <NoPhotosInRangeMessage />;
 *
 *   return (
 *     <ul className="photo-gallery">
 *       {photos.map((photo) => (
 *         <DamagePhotoCard key={photo.id} photo={photo} />
 *       ))}
 *     </ul>
 *   );
 * }
 */
export function useDamagePhotoReportsByRange(
  caseId: string | null,
  fromTimestamp: number,
  toTimestamp: number,
) {
  return useQuery(
    api.damageReports.getDamagePhotoReportsByRange,
    caseId !== null
      ? { caseId: caseId as Id<"cases">, fromTimestamp, toTimestamp }
      : "skip",
  );
}

// ─── useDamageReportEventsByRange ─────────────────────────────────────────────

/**
 * Subscribe to raw `damage_reported` audit events for a case within an
 * inclusive timestamp range.
 *
 * Returns matching event rows from the append-only `events` table ordered by
 * timestamp ascending (chronological order within the window).  Useful for:
 *   • T5 hash-chain audit panel (FF_AUDIT_HASH_CHAIN) with date filtering
 *   • Per-inspection event export or PDF generation
 *   • Admin views that need to review damage events for a specific shift/day
 *
 * Unlike `useDamageReportsByCase` (which joins manifest items + events), this
 * hook surfaces the raw audit trail exactly as recorded — every field in the
 * event row including `hash` and `prevHash` for hash-chain verification.
 *
 * Index path used on the Convex server:
 *   `events.by_case_timestamp` on ["caseId", "timestamp"]
 *   → O(log n + |range|) seek — the server evaluates both the equality on
 *   caseId and the gte/lte bounds on timestamp in the index before
 *   materialising result rows.
 *
 * Convex re-runs this query and pushes the diff to all subscribers within
 * ~100–300 ms whenever a new `damage_reported` event lands inside the window.
 *
 * Pass `null` as `caseId` to skip the subscription entirely.
 * Pass `fromTimestamp: 0` and `toTimestamp: Number.MAX_SAFE_INTEGER` to
 * retrieve all events without date filtering (equivalent to
 * `useDamageReportEvents`).
 *
 * Return values:
 *   `undefined`             — loading (show skeleton)
 *   `DamageReportEvent[]`   — chronologically ordered events in range (may be empty)
 *
 * @param caseId        Convex case ID, or `null` to skip the subscription.
 * @param fromTimestamp Inclusive lower bound in epoch ms (use 0 for open start).
 * @param toTimestamp   Inclusive upper bound in epoch ms.
 *
 * @example
 * function InspectionAuditTimeline({
 *   caseId,
 *   inspectionStart,
 *   inspectionEnd,
 * }: {
 *   caseId: string | null;
 *   inspectionStart: number;
 *   inspectionEnd: number;
 * }) {
 *   const events = useDamageReportEventsByRange(
 *     caseId,
 *     inspectionStart,
 *     inspectionEnd,
 *   );
 *
 *   if (events === undefined) return <TimelineSkeleton />;
 *   if (events.length === 0) return <NoEventsInRangeMessage />;
 *
 *   return (
 *     <ol>
 *       {events.map((event) => (
 *         <AuditEventRow key={event.eventId} event={event} />
 *       ))}
 *     </ol>
 *   );
 * }
 */
export function useDamageReportEventsByRange(
  caseId: string | null,
  fromTimestamp: number,
  toTimestamp: number,
) {
  return useQuery(
    api.damageReports.getDamageReportEventsByRange,
    caseId !== null
      ? { caseId: caseId as Id<"cases">, fromTimestamp, toTimestamp }
      : "skip",
  );
}

// ─── useDamagePhotoReportsWithUrls ───────────────────────────────────────────

/**
 * Subscribe to all damage photo reports for a case, with server-resolved URLs.
 *
 * Returns every row from the `damage_reports` table for the given case with
 * `photoUrl` pre-resolved server-side via `ctx.storage.getUrl()`.  Photos are
 * sorted by reportedAt descending (most recent photo first).
 *
 * The resolved `photoUrl` is ready to use directly in `<img src={photoUrl} />`
 * without any additional client-side fetch.  It is a temporary signed URL valid
 * for ~1 hour; Convex re-runs this query subscription automatically whenever
 * `damage_reports` rows change, refreshing URLs alongside data.
 *
 * Use this hook (instead of `useDamagePhotoReports`) wherever actual photo
 * thumbnails or annotation overlays need to be displayed — specifically:
 *   • T3 inspection panel — annotated photo gallery in the Issues section
 *   • T4 shipping panel photo evidence section (if enlarged)
 *
 * Backed by `api.damageReports.getDamagePhotoReportsWithUrls` which resolves
 * storage IDs server-side in a single parallel Promise.all.  This avoids
 * N separate client→server round-trips for URL resolution.
 *
 * Pass `null` as `caseId` to skip the subscription (no case selected).
 *
 * Return values:
 *   `undefined`                       — loading (show skeleton)
 *   `DamagePhotoReportWithUrl[]`      — live photo list with resolved URLs
 *
 * @example
 * function AnnotatedPhotoGallery({ caseId }: { caseId: string | null }) {
 *   const photos = useDamagePhotoReportsWithUrls(caseId);
 *   if (photos === undefined) return <PhotoSkeleton />;
 *   if (photos.length === 0) return null;
 *   return (
 *     <ul>
 *       {photos.map((photo) => (
 *         <li key={photo.id}>
 *           {photo.photoUrl && <img src={photo.photoUrl} alt="Damage evidence" />}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 */
export function useDamagePhotoReportsWithUrls(caseId: string | null) {
  return useQuery(
    api.damageReports.getDamagePhotoReportsWithUrls,
    caseId !== null ? { caseId: caseId as Id<"cases"> } : "skip",
  );
}

// ─── useDamagePhotoReportsByRangeWithUrls ─────────────────────────────────────

/**
 * Subscribe to damage photo reports within a timestamp range, with resolved URLs.
 *
 * Timestamp-range companion to `useDamagePhotoReportsWithUrls`.  Returns
 * `damage_reports` rows whose `reportedAt` falls within [fromTimestamp,
 * toTimestamp] (inclusive epoch ms), each with `photoUrl` resolved server-side.
 * Results are sorted by reportedAt descending.
 *
 * Suitable for:
 *   • Per-inspection or per-shift photo galleries with date filter controls
 *   • Export views that need photo evidence for a specific inspection window
 *
 * Pass `null` as `caseId` to skip the subscription.
 *
 * Return values:
 *   `undefined`                   — loading (show skeleton)
 *   `DamagePhotoReportWithUrl[]`  — live date-filtered photo list (may be empty)
 *
 * @param caseId        Convex case ID, or `null` to skip the subscription.
 * @param fromTimestamp Inclusive lower bound in epoch ms.
 * @param toTimestamp   Inclusive upper bound in epoch ms.
 */
export function useDamagePhotoReportsByRangeWithUrls(
  caseId: string | null,
  fromTimestamp: number,
  toTimestamp: number,
) {
  return useQuery(
    api.damageReports.getDamagePhotoReportsByRangeWithUrls,
    caseId !== null
      ? { caseId: caseId as Id<"cases">, fromTimestamp, toTimestamp }
      : "skip",
  );
}

// Re-export URL-resolved type so consumers don't need a separate import.
export type { DamagePhotoReportWithUrl } from "../../convex/damageReports";

// ─── useGenerateDamagePhotoUploadUrl ─────────────────────────────────────────

/**
 * Returns a mutation function for generating a Convex file-storage upload URL.
 *
 * This is Step 1 of the two-phase damage photo submission workflow.  Call this
 * before uploading a photo to Convex storage.  The returned URL is single-use
 * and expires after 1 hour.
 *
 * Full upload flow:
 *   const generateUploadUrl = useGenerateDamagePhotoUploadUrl();
 *   const submitPhoto        = useSubmitDamagePhoto();
 *
 *   // Step 1: obtain the upload URL
 *   const uploadUrl = await generateUploadUrl();
 *
 *   // Step 2: upload the photo binary (POST — Convex storage accepts POST)
 *   const uploadRes = await fetch(uploadUrl, {
 *     method: "POST",
 *     headers: { "Content-Type": photoFile.type },
 *     body: photoFile,
 *   });
 *   const { storageId } = await uploadRes.json();
 *
 *   // Step 3: persist the damage report — this triggers all subscriptions
 *   const result = await submitPhoto({
 *     caseId,
 *     photoStorageId: storageId,
 *     severity: "moderate",
 *     reportedAt: Date.now(),
 *     reportedById: kindeUser.id,
 *     reportedByName: "Jane Pilot",
 *     annotations: [...],
 *     templateItemId: "item-drone-body",
 *     notes: "Impact crack visible on port side housing",
 *   });
 *
 * Subscription invalidation after submitPhoto completes:
 *   getDamagePhotoReports    → T4 panel photo gallery updates
 *   getDamageReportsByCase   → T4 panel item list updates
 *   getDamageReportEvents    → T5 audit timeline updates
 *   getDamageReportSummary   → status pills and progress bars update
 *   getChecklistByCase       → checklist item status (if item linked)
 *
 * All updates arrive within ~100–300 ms via Convex reactive subscriptions —
 * satisfying the ≤ 2-second real-time fidelity requirement.
 */
export function useGenerateDamagePhotoUploadUrl() {
  return useMutation(api.damageReports.generateDamagePhotoUploadUrl);
}

// ─── useSubmitDamagePhoto ─────────────────────────────────────────────────────

/**
 * Returns a mutation function for submitting a damage photo from the SCAN app.
 *
 * Full workflow:
 *   1. Upload the photo to Convex storage via `generateUploadUrl` action.
 *   2. Receive the `storageId` from the upload response.
 *   3. Call the returned mutation with the `storageId`, annotations,
 *      severity, and optional manifest item link.
 *
 * What the mutation writes (and which dashboard panels update):
 *   damage_reports row   → getDamagePhotoReports → T4 photo gallery
 *   manifestItems.status → getDamageReportsByCase → T4 item list
 *   events row           → getDamageReportEvents → T5 audit timeline
 *   cases.updatedAt      → listCases by_updated → M1 sort order
 *
 * Usage (SCAN app):
 *   const submitPhoto = useSubmitDamagePhoto();
 *
 *   // After uploading the photo to Convex storage:
 *   const result = await submitPhoto({
 *     caseId:          resolvedCase._id,
 *     photoStorageId:  storageId,
 *     annotations:     [
 *       { x: 0.32, y: 0.54, label: "crack", color: "#e53e3e" },
 *     ],
 *     severity:        "moderate",
 *     reportedAt:      Date.now(),
 *     reportedById:    kindeUser.id,
 *     reportedByName:  "Jane Pilot",
 *     templateItemId:  "item-drone-body",   // optional — links to manifest item
 *     notes:           "Impact crack visible on port side housing",
 *   });
 *
 *   console.log("Created damage report:", result.damageReportId);
 *   console.log("Audit event ID:", result.eventId);
 *
 * Returns:
 *   SubmitDamagePhotoResult {
 *     damageReportId,  // Convex ID of the new damage_reports row
 *     caseId,
 *     manifestItemId,  // present when templateItemId was provided
 *     eventId,         // Convex ID of the new events row
 *   }
 */
export function useSubmitDamagePhoto() {
  return useMutation(api.damageReports.submitDamagePhoto).withOptimisticUpdate(
    (localStore, args) => {
      // Only apply optimistic update when the damage report is linked to a
      // specific manifest item.  Without templateItemId, the photo is a
      // case-level attachment and no checklist item needs updating.
      if (!args.templateItemId) return;

      const { caseId, templateItemId, reportedAt, reportedById, reportedByName } = args;

      /**
       * Apply "damaged" status to the matching checklist item.
       * Returns a new array — does not mutate in place.
       */
      const applyDamageUpdate = <T extends {
        templateItemId: string;
        status: string;
        checkedAt?: number;
        checkedById?: string;
        checkedByName?: string;
      }>(items: T[]): T[] =>
        items.map((item) =>
          item.templateItemId === templateItemId
            ? {
                ...item,
                status:        "damaged",
                checkedAt:     reportedAt,
                checkedById:   reportedById,
                checkedByName: reportedByName,
              }
            : item
        );

      // ── Optimistically update getChecklistByCase ───────────────────────────
      // Immediately marks the manifest item as "damaged" in the checklist item
      // list so the status chip and row colour update without waiting for the
      // server round-trip.
      const checklistItems = localStore.getQuery(
        api.checklists.getChecklistByCase,
        { caseId }
      );
      if (checklistItems !== undefined) {
        localStore.setQuery(
          api.checklists.getChecklistByCase,
          { caseId },
          applyDamageUpdate(checklistItems)
        );
      }

      // ── Optimistically update getChecklistWithInspection ──────────────────
      // Combined subscription used by ScanInspectClient.  Re-runs buildSummary
      // on the updated items so the progress bar, damaged count, and
      // "Complete Inspection" gate reflect the new damage status instantly.
      const checklistWithInsp = localStore.getQuery(
        api.checklists.getChecklistWithInspection,
        { caseId }
      );
      if (checklistWithInsp !== undefined) {
        const updatedItems   = applyDamageUpdate(checklistWithInsp.items);
        const updatedSummary = buildSummary(caseId.toString(), updatedItems);
        localStore.setQuery(
          api.checklists.getChecklistWithInspection,
          { caseId },
          {
            ...checklistWithInsp,
            items:   updatedItems,
            summary: updatedSummary,
          }
        );
      }
    }
  );
}
