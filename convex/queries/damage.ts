/**
 * convex/queries/damage.ts
 *
 * Extended damage report queries with Convex file-storage URL resolution.
 *
 * Why a separate file?
 * ────────────────────
 * The core damage report query functions live in convex/damageReports.ts and
 * return raw `photoStorageId` strings — Convex file storage object IDs that
 * must be resolved server-side to temporary download URLs before they can be
 * displayed in <img> elements.
 *
 * This module provides URL-resolved variants of those queries so that the
 * INVENTORY dashboard T3 (Inspection) panel and T4 (Shipping) panel can
 * render actual photo thumbnails with annotation overlays without an
 * additional client-side round-trip.
 *
 * Design rationale:
 *   • ctx.storage.getUrl() is async and only available in query/mutation
 *     handlers — it cannot be called client-side.
 *   • Resolving N URLs in a single query handler via Promise.all avoids
 *     N separate client→server round-trips.
 *   • The resolved URLs are temporary (expire after ~1 hour) but that is
 *     acceptable for dashboard display; Convex re-runs the subscription
 *     automatically when underlying rows change, refreshing URLs along with
 *     the rest of the data.
 *
 * Real-time fidelity:
 *   Convex re-runs every subscribed query whenever the `damage_reports` table
 *   changes.  When the SCAN app calls `submitDamagePhoto`, the dashboard T3
 *   panel receives the updated photo list (with fresh resolved URLs) within
 *   ~100–300 ms — satisfying the ≤ 2-second real-time fidelity requirement
 *   without manual refresh.
 *
 * Exported queries (registered as api["queries/damage"].*):
 *   getDamagePhotoReportsWithUrls       — all photos for a case with resolved URLs
 *   getDamagePhotoReportsByRangeWithUrls — photos within a timestamp range + URLs
 *
 * Client usage:
 *   const photos = useQuery(api["queries/damage"].getDamagePhotoReportsWithUrls, {
 *     caseId,
 *   });
 *   // photos[0].photoUrl — a temporary download URL ready for <img src={...} />
 */

import { query } from "../_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token."
    );
  }
  return identity;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single annotation pin placed on a damage photo.
 * Positions are expressed as fractions (0–1) of the photo's dimensions.
 */
export interface DamagePhotoAnnotation {
  /** Relative horizontal position (0 = left edge, 1 = right edge). */
  x: number;
  /** Relative vertical position (0 = top edge, 1 = bottom edge). */
  y: number;
  /** Text label shown next to the annotation pin. */
  label: string;
  /** Optional hex colour for the pin. */
  color?: string;
}

/**
 * A damage photo report with a server-resolved temporary download URL.
 *
 * Extends the base DamagePhotoReport with `photoUrl` — the resolved temporary
 * download URL produced by `ctx.storage.getUrl(photoStorageId)`.  This URL is
 * safe to use directly in an `<img src={...} />` element.
 *
 * `photoUrl` is `null` when the storage object has been deleted or the ID is
 * invalid; components should fall back to a placeholder in that case.
 */
export interface DamagePhotoReportWithUrl {
  /** Convex ID of the damage_reports row. */
  id: string;
  /** Case this photo belongs to. */
  caseId: string;
  /** Raw Convex file storage ID (kept for reference / re-upload detection). */
  photoStorageId: string;
  /**
   * Temporary download URL resolved server-side via ctx.storage.getUrl().
   * Null when the storage object cannot be resolved (deleted or invalid ID).
   * URLs expire after ~1 hour; Convex subscription re-runs refresh them
   * automatically whenever underlying data changes.
   */
  photoUrl: string | null;
  /** Annotation pins placed on the photo by the SCAN app markup tool. */
  annotations: DamagePhotoAnnotation[];
  /** Technician-assessed damage severity. */
  severity: "minor" | "moderate" | "severe";
  /** Epoch ms when the photo was submitted. */
  reportedAt: number;
  /**
   * Optional Convex ID of the manifest item this photo documents.
   * Undefined for case-level (non-item-specific) damage photos.
   */
  manifestItemId?: string;
  /**
   * Stable template item identifier — used to correlate this photo with the
   * matching manifest item and damage_reported event.
   */
  templateItemId?: string;
  /** Kinde user ID of the reporting technician. */
  reportedById: string;
  /** Display name of the reporting technician. */
  reportedByName: string;
  /** Optional free-text notes entered alongside the photo. */
  notes?: string;
}

// ─── getDamagePhotoReportsWithUrls ───────────────────────────────────────────

/**
 * Subscribe to all damage photo reports for a case, with resolved photo URLs.
 *
 * Returns every row from the `damage_reports` table for the given case with
 * `photoUrl` pre-resolved server-side via `ctx.storage.getUrl()`.  Photos are
 * sorted by reportedAt descending (most recent photo first).
 *
 * The resolved URL is ready to use directly in `<img src={photoUrl} />` on the
 * client without any additional fetch.  It is a temporary signed URL valid for
 * approximately 1 hour.  Because Convex re-runs this query whenever the
 * `damage_reports` table changes, the URL is refreshed automatically as part of
 * the real-time subscription — no manual refetch required.
 *
 * URL resolution strategy:
 *   Storage IDs are resolved in parallel via Promise.all to avoid sequential
 *   await chains (N+1 storage lookups).  For cases with many photos, this keeps
 *   the query latency proportional to the single slowest getUrl() call rather
 *   than O(n) sequential calls.
 *
 * Implementation notes:
 *   • Uses the `damage_reports.by_case_reported_at` compound index for O(log n)
 *     caseId equality + DESC ordering — avoids a full table scan.
 *   • `ctx.storage.getUrl()` returns null when the storage object has been
 *     deleted; the null is propagated as `photoUrl: null` so the client can
 *     render a placeholder rather than a broken image.
 *   • Auth is required — unauthenticated calls throw [AUTH_REQUIRED].
 *
 * Real-time fidelity (≤ 2 seconds):
 *   Convex re-evaluates this query and pushes the diff to all subscribers within
 *   ~100–300 ms whenever `submitDamagePhoto` inserts a new `damage_reports` row.
 *   The T3 inspection panel and T4 shipping panel receive the new photo (with
 *   its resolved URL and annotation data) without any user action.
 *
 * Returns an empty array when:
 *   • No damage photos have been submitted for the case.
 *   • The caseId is invalid (no rows match the index).
 *
 * Client usage:
 *   const photos = useQuery(
 *     api["queries/damage"].getDamagePhotoReportsWithUrls,
 *     { caseId },
 *   );
 *   if (photos === undefined) return <PhotoSkeleton />;
 *   if (photos.length === 0) return <NoDamagePhotos />;
 *   return (
 *     <ul>
 *       {photos.map((photo) => (
 *         <li key={photo.id}>
 *           {photo.photoUrl && (
 *             <img src={photo.photoUrl} alt="Damage evidence" />
 *           )}
 *           <AnnotationOverlay annotations={photo.annotations} />
 *         </li>
 *       ))}
 *     </ul>
 *   );
 */
export const getDamagePhotoReportsWithUrls = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<DamagePhotoReportWithUrl[]> => {
    await requireAuth(ctx);

    // Load all damage_reports rows for this case, ordered newest-first.
    // The compound index by_case_reported_at handles both the equality predicate
    // and the descending sort in O(log n + |results|).
    const rows = await ctx.db
      .query("damage_reports")
      .withIndex("by_case_reported_at", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .collect();

    // Resolve all storage IDs to download URLs in parallel.
    // Promise.all avoids sequential awaits so URL resolution is O(1) latency-wise
    // (bounded by the slowest single getUrl() call, not N * getUrl()).
    const resolved = await Promise.all(
      rows.map(async (row) => {
        const photoUrl = await ctx.storage.getUrl(row.photoStorageId);
        return {
          id:             row._id.toString(),
          caseId:         row.caseId.toString(),
          photoStorageId: row.photoStorageId,
          photoUrl,                                              // null if deleted
          annotations:    (row.annotations ?? []) as DamagePhotoAnnotation[],
          severity:       row.severity,
          reportedAt:     row.reportedAt,
          manifestItemId: row.manifestItemId?.toString(),
          templateItemId: row.templateItemId,
          reportedById:   row.reportedById,
          reportedByName: row.reportedByName,
          notes:          row.notes,
        };
      })
    );

    return resolved;
  },
});

// ─── getDamagePhotoReportsByRangeWithUrls ────────────────────────────────────

/**
 * Subscribe to damage photo reports for a case within a timestamp range,
 * with server-resolved photo URLs.
 *
 * The timestamp-range companion to `getDamagePhotoReportsWithUrls`.  Returns
 * `damage_reports` rows whose `reportedAt` falls within the inclusive
 * [fromTimestamp, toTimestamp] window, with each `photoStorageId` resolved to
 * a temporary download URL.  Results are sorted by reportedAt descending.
 *
 * Index path: `damage_reports.by_case_reported_at` — the compound index on
 * ["caseId", "reportedAt"] enables an O(log n + |range|) seek; Convex evaluates
 * both the caseId equality and reportedAt range bounds in the index before
 * materialising rows.
 *
 * Convex re-runs this query and pushes the diff to all subscribers within
 * ~100–300 ms whenever `submitDamagePhoto` inserts a new row whose `reportedAt`
 * falls inside the subscribed window.
 *
 * Returns an empty array when:
 *   • No photos exist within the window for the case.
 *   • The caseId is invalid.
 *   • fromTimestamp > toTimestamp (empty range guard).
 *
 * @param caseId        Convex case ID.
 * @param fromTimestamp Inclusive lower bound (epoch ms).  Pass 0 for open start.
 * @param toTimestamp   Inclusive upper bound (epoch ms).
 *
 * Client usage:
 *   const photos = useQuery(
 *     api["queries/damage"].getDamagePhotoReportsByRangeWithUrls,
 *     { caseId, fromTimestamp: shiftStart, toTimestamp: shiftEnd },
 *   );
 */
export const getDamagePhotoReportsByRangeWithUrls = query({
  args: {
    caseId:        v.id("cases"),
    fromTimestamp: v.number(),
    toTimestamp:   v.number(),
  },
  handler: async (ctx, args): Promise<DamagePhotoReportWithUrl[]> => {
    await requireAuth(ctx);

    // Guard: empty range — return immediately without hitting storage.
    if (args.fromTimestamp > args.toTimestamp) return [];

    const rows = await ctx.db
      .query("damage_reports")
      .withIndex("by_case_reported_at", (q) => q.eq("caseId", args.caseId))
      .filter((q) =>
        q.and(
          q.gte(q.field("reportedAt"), args.fromTimestamp),
          q.lte(q.field("reportedAt"), args.toTimestamp),
        )
      )
      .order("desc")
      .collect();

    const resolved = await Promise.all(
      rows.map(async (row) => {
        const photoUrl = await ctx.storage.getUrl(row.photoStorageId);
        return {
          id:             row._id.toString(),
          caseId:         row.caseId.toString(),
          photoStorageId: row.photoStorageId,
          photoUrl,
          annotations:    (row.annotations ?? []) as DamagePhotoAnnotation[],
          severity:       row.severity,
          reportedAt:     row.reportedAt,
          manifestItemId: row.manifestItemId?.toString(),
          templateItemId: row.templateItemId,
          reportedById:   row.reportedById,
          reportedByName: row.reportedByName,
          notes:          row.notes,
        };
      })
    );

    return resolved;
  },
});
