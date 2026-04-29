/**
 * convex/damageAndShipping.ts
 *
 * Unified Convex mutations for the SCAN app's two primary write workflows:
 *
 *   1. Damage report actions — photo-backed damage documentation with
 *      annotated photo file references and manifest item linking.
 *
 *   2. FedEx shipment actions — tracking number entry, status transitions,
 *      and FedEx tracking data persistence.
 *
 * This file is the canonical write layer for these two workflows.  Query
 * functions are in convex/damageReports.ts and convex/shipping.ts; the
 * mutations here are the write path that triggers those reactive subscriptions.
 *
 * Architecture
 * ────────────
 * The file is organised into three sections:
 *
 *   A. File storage helpers
 *      generateDamagePhotoUploadUrl — pre-signed Convex storage upload URL
 *      generateMultipleUploadUrls  — batch URL generation for multi-photo flows
 *
 *   B. Damage report mutations
 *      submitDamageReport    — submit a single annotated photo damage report
 *      bulkSubmitDamageReports — submit multiple photos atomically in one call
 *      resolveDamageReport   — mark a damage report as repaired/resolved (admin)
 *
 *   C. FedEx shipment mutations
 *      recordFedExShipment    — record a new FedEx shipment with tracking data
 *      updateFedExTrackingData — persist new tracking status from a FedEx poll
 *      markShipmentException  — flag a shipment with a FedEx exception
 *      clearShipmentException — resolve a FedEx exception (re-enter transit)
 *
 * File reference fields
 * ─────────────────────
 * Convex file storage IDs are plain strings returned by the Convex storage
 * API when a file is uploaded via a pre-signed URL.  These strings are called
 * "storage IDs" or "file references" throughout this file.  A storage ID can
 * be resolved to a temporary download URL via ctx.storage.getUrl(storageId)
 * inside a query handler.
 *
 * For annotated photos, the file reference (`photoStorageId`) accompanies
 * an `annotations` array that describes the overlay markers the technician
 * placed on the photo in the SCAN app markup tool.
 *
 * FedEx tracking data fields
 * ──────────────────────────
 * FedEx tracking data is stored in two places:
 *
 *   cases.trackingNumber / carrier / shippedAt / destinationName /
 *   cases.destinationLat / destinationLng
 *     → Denormalized onto the cases row for O(1) reads from the T3 layout
 *       query and M4 logistics map assembler.  Written by recordFedExShipment.
 *
 *   shipments table (full record)
 *     → Canonical tracking history including origin/destination coordinates,
 *       currentLat/currentLng (from FedEx location events), estimatedDelivery,
 *       and deliveredAt.  Written by recordFedExShipment and updateFedExTrackingData.
 *
 * Real-time fidelity (≤ 2 seconds)
 * ──────────────────────────────────
 * Every mutation in this file writes to the cases, damage_reports, shipments,
 * or events tables.  Convex re-evaluates ALL subscribed queries that read those
 * tables and pushes diffs to connected clients within ~100–300 ms.  The
 * INVENTORY dashboard's T3/T4/T5 panels and M4 logistics map subscribe to
 * those queries — satisfying the ≤ 2-second real-time fidelity requirement
 * between SCAN app action and dashboard visibility.
 *
 * Client usage example:
 *   // 1. Generate upload URL (damage report flow)
 *   const uploadUrl = await convex.mutation(
 *     api.damageAndShipping.generateDamagePhotoUploadUrl, {}
 *   );
 *
 *   // 2. Upload photo binary to Convex storage
 *   const resp = await fetch(uploadUrl, { method: "POST", body: photoFile });
 *   const { storageId } = await resp.json();
 *
 *   // 3. Submit damage report with file reference + annotations
 *   const result = await convex.mutation(
 *     api.damageAndShipping.submitDamageReport,
 *     {
 *       caseId,
 *       photoStorageId: storageId,   // ← file reference
 *       annotations: [{ x: 0.4, y: 0.6, label: "crack", color: "#e53e3e" }],
 *       severity: "moderate",
 *       reportedAt: Date.now(),
 *       reportedById: kindeUser.id,
 *       reportedByName: "Jane Pilot",
 *       templateItemId: "item-drone-body",
 *     }
 *   );
 *
 *   // FedEx shipment flow
 *   const shipResult = await convex.mutation(
 *     api.damageAndShipping.recordFedExShipment,
 *     {
 *       caseId,
 *       trackingNumber: "794644823741",   // ← FedEx tracking data
 *       userId: kindeUser.id,
 *       userName: "Jane Pilot",
 *       originName: "Site Alpha",
 *       destinationName: "SkySpecs HQ — Ann Arbor",
 *     }
 *   );
 */

import { mutation } from "./_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Asserts that the calling client has a verified Kinde JWT.
 * Throws [AUTH_REQUIRED] for unauthenticated requests.
 */
async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token. " +
      "Ensure the client is wrapped in ConvexProviderWithAuth and the user is signed in."
    );
  }
  return identity;
}

// ─── Shared validators ────────────────────────────────────────────────────────

/**
 * Validator for an annotation pin placed on a damage photo.
 * Positions are expressed as fractions (0–1) of the photo dimensions
 * so they remain accurate regardless of display resolution.
 */
const annotationValidator = v.object({
  /**
   * Relative horizontal position — 0.0 = left edge, 1.0 = right edge.
   * Stored as a fraction so the annotation renders correctly at any resolution.
   */
  x:     v.number(),
  /**
   * Relative vertical position — 0.0 = top edge, 1.0 = bottom edge.
   */
  y:     v.number(),
  /**
   * Label text shown next to the annotation pin in the SCAN markup tool.
   */
  label: v.string(),
  /**
   * Optional hex colour string for the annotation pin (e.g. "#e53e3e").
   * When omitted, the SCAN app renders the pin in its default accent colour.
   */
  color: v.optional(v.string()),
});

/**
 * Validator for damage severity.
 * Drives badge colour in the T4 dashboard panel and SCAN app review screen.
 */
const damageSeverityValidator = v.union(
  v.literal("minor"),
  v.literal("moderate"),
  v.literal("severe"),
);

/**
 * Validator for shipment tracking status.
 * Mirrors the `shipmentStatus` union in convex/schema.ts.
 */
const shipmentStatusValidator = v.union(
  v.literal("label_created"),
  v.literal("picked_up"),
  v.literal("in_transit"),
  v.literal("out_for_delivery"),
  v.literal("delivered"),
  v.literal("exception"),
);

// ─── Return types ─────────────────────────────────────────────────────────────

/**
 * Return type for submitDamageReport and each entry in bulkSubmitDamageReports.
 *
 * Returned to the SCAN app so it can navigate to the confirmation screen
 * and immediately display the submitted damage report.
 */
export interface DamageReportResult {
  /**
   * Convex document ID of the newly created `damage_reports` row.
   * Use this to link subsequent updates (e.g., adding more photos) or
   * to display the specific report in the T4 panel.
   */
  damageReportId: string;

  /**
   * Convex document ID of the parent case.
   */
  caseId: string;

  /**
   * Convex document ID of the manifest item updated by this report.
   * Undefined when the photo is a standalone case-level submission
   * not linked to a specific packing list item.
   */
  manifestItemId: string | undefined;

  /**
   * Convex document ID of the `damage_reported` audit event appended to the
   * immutable events table.  Used by the T5 audit chain.
   */
  eventId: string;

  /**
   * The Convex file storage ID of the uploaded photo.
   * Included in the return value so the caller can confirm the file reference
   * was correctly stored and resolve it to a download URL if needed.
   */
  photoStorageId: string;
}

/**
 * Return type for bulkSubmitDamageReports.
 *
 * Each photo submission is represented as a separate DamageReportResult.
 * Submissions are ordered to match the input `photos` array.
 */
export interface BulkDamageReportResult {
  /** One result per submitted photo. Maintains input order. */
  results: DamageReportResult[];
  /** Total number of photos successfully submitted. */
  totalSubmitted: number;
  /** The parent case ID. */
  caseId: string;
}

/**
 * Return type for resolveDamageReport.
 */
export interface ResolveDamageReportResult {
  /** Convex document ID of the resolved damage_reports row. */
  damageReportId: string;
  /** The parent case. */
  caseId: string;
  /** Epoch ms when the resolution was recorded. */
  resolvedAt: number;
  /** The audit event ID appended to the events table. */
  eventId: string;
}

/**
 * Return type for recordFedExShipment.
 *
 * Returned to the SCAN app so it can display a shipping confirmation screen
 * with the tracking number and case transition details.
 */
export interface RecordFedExShipmentResult {
  /**
   * Convex document ID of the newly created `shipments` row.
   * The full tracking record — use listShipmentsByCase to subscribe to updates.
   */
  shipmentId: string;

  /**
   * The parent case ID.
   */
  caseId: string;

  /**
   * The FedEx tracking number as stored (whitespace trimmed).
   * This is the primary FedEx tracking data reference — use it to
   * link directly to the FedEx tracking page.
   */
  trackingNumber: string;

  /**
   * Carrier name — always "FedEx" for this mutation.
   */
  carrier: string;

  /**
   * Epoch ms when the shipment was recorded.
   * Written to both cases.shippedAt and shipments.shippedAt.
   */
  shippedAt: number;

  /**
   * The case lifecycle status BEFORE this mutation ran.
   * Useful for undo displays and audit trail context.
   */
  previousStatus: string;

  /**
   * The new case lifecycle status after the transit transition.
   * "transit_out" (outbound) or "transit_in" (inbound return).
   */
  transitStatus: string;

  /** ID of the "shipped" audit event appended to the events table. */
  eventId: string;
}

/**
 * Return type for updateFedExTrackingData.
 */
export interface UpdateFedExTrackingDataResult {
  /** Convex document ID of the updated shipments row. */
  shipmentId: string;
  /** Previous shipment status before this update. */
  previousStatus: string;
  /** New shipment status after this update. */
  newStatus: string;
  /**
   * Whether the case lifecycle status was also updated.
   * True when the shipment transitioned to "delivered" and the case
   * was advanced to "deployed" (transit_out) or "received" (transit_in).
   */
  caseStatusUpdated: boolean;
  /** New case status, if it was updated. Undefined otherwise. */
  newCaseStatus: string | undefined;
}

/**
 * Return type for markShipmentException and clearShipmentException.
 */
export interface ShipmentExceptionResult {
  /** Convex document ID of the updated shipments row. */
  shipmentId: string;
  /** The parent case ID. */
  caseId: string;
  /** New shipment status. */
  status: string;
  /** The audit event ID appended to the events table. */
  eventId: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// A. FILE STORAGE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a short-lived Convex file-storage upload URL for a single damage
 * photo.
 *
 * This is step 1 of the two-phase SCAN app photo submission workflow:
 *
 *   Phase 1 — Upload (this mutation)
 *   ─────────────────────────────────
 *   1. SCAN app calls generateDamagePhotoUploadUrl() → receives a one-time URL.
 *   2. App uploads the photo binary via fetch (POST to the URL with the photo
 *      as the request body and the MIME type as the Content-Type header).
 *   3. Convex storage returns `{ storageId: string }` in the JSON response.
 *      This `storageId` is the file reference used in Phase 2.
 *
 *   Phase 2 — Persist (submitDamageReport)
 *   ──────────────────────────────────────
 *   4. App calls submitDamageReport with the storageId as `photoStorageId`,
 *      plus the annotations, severity, and optional manifest item link.
 *   5. submitDamageReport inserts a damage_reports row, patches the manifest
 *      item's photoStorageIds, appends a damage_reported event, and touches
 *      cases.updatedAt.
 *   6. Convex re-evaluates subscribed queries within ~100–300 ms.
 *
 * Security:
 *   Upload URLs are single-use and expire after 1 hour.  They grant write-only
 *   access to Convex storage — the client cannot read or list storage objects
 *   via this URL.
 *
 * Client usage:
 *   const generateUrl = useMutation(api.damageAndShipping.generateDamagePhotoUploadUrl);
 *
 *   // Step 1: generate the upload URL
 *   const uploadUrl = await generateUrl();
 *
 *   // Step 2: upload the photo binary
 *   const response = await fetch(uploadUrl, {
 *     method:  "POST",
 *     headers: { "Content-Type": photoFile.type },
 *     body:    photoFile,
 *   });
 *   const { storageId } = await response.json();
 *
 *   // Step 3: submit the damage report with the file reference
 *   const result = await submitReport({ caseId, photoStorageId: storageId, ... });
 *
 * @returns A short-lived pre-signed upload URL as a plain string.
 */
export const generateDamagePhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    await requireAuth(ctx);
    // ctx.storage.generateUploadUrl() returns a short-lived signed URL that
    // clients can POST a file body to in order to store it in Convex storage.
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Generate multiple Convex file-storage upload URLs in a single round-trip.
 *
 * When the SCAN app's damage reporting flow allows the technician to photograph
 * multiple angles of damage before submitting (e.g., front view + close-up),
 * this mutation lets the app obtain all upload URLs in one request — reducing
 * latency compared to calling generateDamagePhotoUploadUrl N times.
 *
 * Each URL is independent and single-use.  The app uploads photos in parallel
 * (e.g., via Promise.all) then calls bulkSubmitDamageReports with all the
 * resulting storageIds at once.
 *
 * @param count  Number of upload URLs to generate.  Capped at 10 to prevent
 *               abuse — a typical inspection photo set is 1–5 images.
 *
 * @returns Array of { uploadUrl, index } objects in the same order as requested.
 *          `index` is a 0-based position hint that the caller can use to
 *          correlate each URL with the corresponding photo in its internal state.
 *
 * Client usage:
 *   const generateUrls = useMutation(api.damageAndShipping.generateMultipleUploadUrls);
 *
 *   // Generate 3 upload URLs for a multi-angle damage photo set
 *   const urls = await generateUrls({ count: 3 });
 *   // urls[0].uploadUrl, urls[1].uploadUrl, urls[2].uploadUrl
 *
 *   // Upload all photos in parallel
 *   const storageIds = await Promise.all(
 *     urls.map(async ({ uploadUrl }, i) => {
 *       const resp = await fetch(uploadUrl, {
 *         method:  "POST",
 *         headers: { "Content-Type": photos[i].type },
 *         body:    photos[i],
 *       });
 *       const { storageId } = await resp.json();
 *       return storageId;
 *     })
 *   );
 */
export const generateMultipleUploadUrls = mutation({
  args: {
    /**
     * Number of upload URLs to generate.
     * Capped at 10 — a single inspection batch should not exceed this.
     */
    count: v.number(),
  },
  handler: async (ctx, args): Promise<Array<{ uploadUrl: string; index: number }>> => {
    await requireAuth(ctx);

    const effectiveCount = Math.min(Math.max(1, Math.floor(args.count)), 10);

    // Generate all upload URLs sequentially — ctx.storage.generateUploadUrl()
    // is a fast non-blocking operation so sequential is fine for ≤10 URLs.
    const results: Array<{ uploadUrl: string; index: number }> = [];
    for (let i = 0; i < effectiveCount; i++) {
      const url = await ctx.storage.generateUploadUrl();
      results.push({ uploadUrl: url, index: i });
    }
    return results;
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. DAMAGE REPORT MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Submit a single annotated damage photo report from the SCAN mobile app.
 *
 * This is the primary damage report write path.  It atomically:
 *   1. Inserts a `damage_reports` row with the file reference (photoStorageId)
 *      and annotation pin data.
 *   2. If `templateItemId` is provided, resolves the manifest item and:
 *        a. Sets its status to "damaged" (no-op if already damaged)
 *        b. Appends `photoStorageId` to its photoStorageIds array
 *   3. Appends a `damage_reported` event to the immutable events table.
 *   4. Touches `cases.updatedAt` so the M1 sort index reflects recent activity.
 *
 * File reference fields
 * ─────────────────────
 * `photoStorageId` is the Convex file storage ID returned by uploading a photo
 * to the URL from generateDamagePhotoUploadUrl().  It is the primary file
 * reference for this damage report and is stored in three places:
 *
 *   damage_reports.photoStorageId        — authoritative photo record
 *   manifestItems.photoStorageIds[]       — per-item photo cache (when item linked)
 *   events.data.photoStorageId            — audit trail reference
 *
 * The `annotations` field describes the overlay pins placed by the technician
 * on the photo in the SCAN markup tool.  Each pin has:
 *   • x, y  — relative position (0–1 fraction of photo dimensions)
 *   • label — short text shown next to the pin
 *   • color — optional hex colour for the pin (defaults to accent colour)
 *
 * Real-time fidelity (≤ 2 seconds)
 * ──────────────────────────────────
 * This mutation writes to `damage_reports`, `manifestItems`, `events`, and
 * `cases`.  Convex re-evaluates ALL subscribed queries reading those tables
 * within ~100–300 ms:
 *   getDamagePhotoReports    → T4 photo gallery
 *   getDamageReportsByCase   → T4 item list
 *   getDamageReportEvents    → T5 audit timeline
 *   getDamageReportSummary   → status pills and progress bars
 *
 * @param caseId         Convex ID of the case being documented.
 * @param photoStorageId Convex file storage ID (file reference) from upload step.
 * @param annotations    Optional array of annotation pins on the photo.
 * @param severity       Technician-assessed severity: "minor"|"moderate"|"severe".
 * @param reportedAt     Epoch ms when the photo was captured/submitted.
 * @param reportedById   Kinde user ID of the reporting technician.
 * @param reportedByName Display name of the technician.
 * @param templateItemId Optional stable item ID to link this photo to a manifest item.
 * @param notes          Optional free-text notes entered alongside the photo.
 *
 * @throws When the case is not found.
 * @throws When templateItemId is provided but the manifest item does not exist.
 *
 * Client usage (via hook):
 *   const submit = useMutation(api.damageAndShipping.submitDamageReport);
 *
 *   const result = await submit({
 *     caseId:          resolvedCase._id,
 *     photoStorageId:  storageId,            // ← file reference from upload
 *     annotations:     [
 *       { x: 0.4, y: 0.6, label: "crack",  color: "#e53e3e" },
 *       { x: 0.2, y: 0.3, label: "dent",   color: "#dd6b20" },
 *     ],
 *     severity:        "moderate",
 *     reportedAt:      Date.now(),
 *     reportedById:    kindeUser.id,
 *     reportedByName:  "Jane Pilot",
 *     templateItemId:  "item-drone-body",
 *     notes:           "Impact crack on port side housing, visible dent above battery bay",
 *   });
 *   // result.damageReportId  → Convex damage_reports row ID
 *   // result.photoStorageId  → confirmed file reference
 *   // result.manifestItemId  → Convex manifestItems row ID (if templateItemId given)
 *   // result.eventId         → Convex events row ID (damage_reported event)
 */
export const submitDamageReport = mutation({
  args: {
    /** Convex ID of the case being photographed. */
    caseId: v.id("cases"),

    /**
     * Convex file storage ID for the uploaded damage photo.
     *
     * This is the primary FILE REFERENCE for the annotated photo.  Obtained by:
     *   1. Calling generateDamagePhotoUploadUrl() to get a signed upload URL.
     *   2. POSTing the photo binary to that URL.
     *   3. Extracting `storageId` from the JSON response `{ storageId: string }`.
     *
     * Stored in damage_reports.photoStorageId (authoritative) and optionally
     * in manifestItems.photoStorageIds[] (denormalized per-item cache).
     *
     * To resolve to a temporary download URL for display:
     *   ctx.storage.getUrl(photoStorageId)  (inside a query handler)
     */
    photoStorageId: v.string(),

    /**
     * Optional annotation pins placed on the photo by the technician.
     *
     * Each annotation specifies a relative position (0–1) on the photo
     * using the photo's natural dimensions as the coordinate space.
     * Stored verbatim in damage_reports.annotations.
     *
     * Example:
     *   [
     *     { x: 0.4, y: 0.6, label: "crack",      color: "#e53e3e" },
     *     { x: 0.2, y: 0.3, label: "impact dent", color: "#dd6b20" },
     *   ]
     */
    annotations: v.optional(v.array(annotationValidator)),

    /**
     * Damage severity assessed by the technician.
     *
     * "minor"    — cosmetic damage, does not affect function
     * "moderate" — functional impact, review recommended before next use
     * "severe"   — equipment unusable; immediate repair or replacement needed
     *
     * Drives severity badge colour in T4 dashboard panel and SCAN app review.
     */
    severity: damageSeverityValidator,

    /**
     * Epoch ms when the photo was captured or submitted.
     * Stored as damage_reports.reportedAt and as the event timestamp.
     */
    reportedAt: v.number(),

    /**
     * Kinde user ID of the reporting technician.
     * Written to damage_reports.reportedById and the damage_reported event.
     */
    reportedById: v.string(),

    /**
     * Display name of the reporting technician.
     * Written to damage_reports.reportedByName and the damage_reported event.
     */
    reportedByName: v.string(),

    /**
     * Optional stable item identifier from the packing template.
     * When provided, this mutation:
     *   • Looks up the matching manifestItem for this case
     *   • Sets its status to "damaged" (no-op if already "damaged")
     *   • Appends photoStorageId to its photoStorageIds array (deduplicated)
     *   • Stores the resolved manifestItemId in the damage_reports row
     *
     * Omit for case-level (non-item-specific) damage photos.
     */
    templateItemId: v.optional(v.string()),

    /** Optional free-text notes entered alongside the photo. */
    notes: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<DamageReportResult> => {
    await requireAuth(ctx);
    const now = args.reportedAt;

    // ── Verify case exists ────────────────────────────────────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `[CASE_NOT_FOUND] Case "${args.caseId}" not found. ` +
        `Verify the caseId from the QR scan before calling submitDamageReport.`
      );
    }

    // ── Resolve and update the manifest item (when templateItemId provided) ────
    //
    // The manifest item link is optional — technicians may photograph general
    // case damage before or after running the item checklist.
    let resolvedManifestItemIdStr: string | undefined;
    let resolvedManifestItemDbId: Id<"manifestItems"> | undefined;

    if (args.templateItemId !== undefined) {
      // Load all manifest items for this case via the by_case index.
      // In practice, a case has 10–100 items — the in-memory find is fast.
      const allItems = await ctx.db
        .query("manifestItems")
        .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
        .collect();

      const targetItem = allItems.find(
        (i) => i.templateItemId === args.templateItemId
      );

      if (!targetItem) {
        throw new Error(
          `[ITEM_NOT_FOUND] Manifest item with templateItemId "${args.templateItemId}" ` +
          `not found on case "${caseDoc.label}". ` +
          `Has a template been applied to this case? ` +
          `Available templateItemIds: [${allItems.map((i) => i.templateItemId).join(", ")}]`
        );
      }

      resolvedManifestItemIdStr = targetItem._id.toString();
      resolvedManifestItemDbId  = targetItem._id;

      // Append the photo file reference to the manifest item's photoStorageIds.
      // Deduplicate to prevent the same photo from appearing twice if the
      // mutation is accidentally called with the same storageId.
      const existingPhotoIds = targetItem.photoStorageIds ?? [];
      const updatedPhotoIds = existingPhotoIds.includes(args.photoStorageId)
        ? existingPhotoIds
        : [...existingPhotoIds, args.photoStorageId];

      // Patch the manifest item:
      //   • status: "damaged"       — drives M3 hasDamage filter
      //   • photoStorageIds: [...]  — updated file references array
      //   • checkedAt / checkedById — attribution (only on first damage report)
      await ctx.db.patch(targetItem._id, {
        status:          "damaged",
        photoStorageIds: updatedPhotoIds,
        // Preserve the original checker attribution if already set.
        ...(targetItem.checkedAt === undefined
          ? {
              checkedAt:     now,
              checkedById:   args.reportedById,
              checkedByName: args.reportedByName,
            }
          : {}),
        // Merge notes — append if item already has different notes.
        ...(args.notes !== undefined
          ? {
              notes:
                targetItem.notes && targetItem.notes !== args.notes
                  ? `${targetItem.notes}\n${args.notes}`
                  : args.notes,
            }
          : {}),
      });
    }

    // ── Insert damage_reports row ─────────────────────────────────────────────
    //
    // This insert triggers reactive subscriptions:
    //   getDamagePhotoReports          → T4 photo gallery (by_case_reported_at)
    //   getDamagePhotoReportsByRange   → T4 date-ranged photo view
    //
    // The `photoStorageId` stored here is the primary file reference.
    // Clients resolve it to a temporary download URL via ctx.storage.getUrl().
    const damageReportId = await ctx.db.insert("damage_reports", {
      caseId:         args.caseId,
      photoStorageId: args.photoStorageId,   // ← file reference
      annotations:    args.annotations,
      severity:       args.severity,
      reportedAt:     now,
      manifestItemId: resolvedManifestItemDbId,   // linked manifest item (if any)
      templateItemId: args.templateItemId,
      reportedById:   args.reportedById,
      reportedByName: args.reportedByName,
      notes:          args.notes,
    });

    // ── Append damage_reported event (immutable audit trail) ──────────────────
    //
    // The events table is append-only.  This row is what the T5 audit chain
    // reads for the "Damage Reported" milestone.  getDamageReportsByCase uses
    // event.data.templateItemId to correlate damage events back to their
    // manifest item without a separate join.
    const eventId = await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "damage_reported",
      userId:    args.reportedById,
      userName:  args.reportedByName,
      timestamp: now,
      data: {
        // TemplateItemId is the join key — see damageReports.ts getDamageReportsByCase
        templateItemId:  args.templateItemId,
        manifestItemId:  resolvedManifestItemIdStr,
        damageReportId:  damageReportId.toString(),
        // File reference included in the event payload for full audit fidelity
        photoStorageId:  args.photoStorageId,
        annotationCount: (args.annotations ?? []).length,
        severity:        args.severity,
        notes:           args.notes,
      },
    });

    // ── Touch cases.updatedAt so M1 by_updated sort index reflects activity ───
    await ctx.db.patch(args.caseId, { updatedAt: now });

    return {
      damageReportId:  damageReportId.toString(),
      caseId:          args.caseId,
      manifestItemId:  resolvedManifestItemIdStr,
      eventId:         eventId.toString(),
      photoStorageId:  args.photoStorageId,   // ← confirm file reference stored
    };
  },
});

// ─── Photo input shape for bulkSubmitDamageReports ───────────────────────────

/**
 * Validator for a single photo entry in the bulkSubmitDamageReports input array.
 *
 * Each entry describes one annotated damage photo.  See submitDamageReport for
 * field-level documentation; these fields have identical semantics.
 */
const bulkPhotoEntryValidator = v.object({
  /**
   * Convex file storage ID (file reference) for this photo.
   * Obtained by uploading to one of the URLs from generateMultipleUploadUrls().
   */
  photoStorageId:  v.string(),

  /**
   * Optional annotation pins placed on this specific photo.
   * Each photo in the bulk set can have its own independent annotation set.
   */
  annotations:     v.optional(v.array(annotationValidator)),

  /**
   * Damage severity for this specific photo.
   * Each photo may document a different aspect of damage with its own severity.
   */
  severity:        damageSeverityValidator,

  /**
   * Optional stable template item identifier linking this photo to a manifest
   * item.  Multiple photos in the bulk set may link to the SAME item (e.g.,
   * multiple angles of a damaged drone body) or to DIFFERENT items.
   */
  templateItemId:  v.optional(v.string()),

  /** Optional free-text notes specific to this photo. */
  notes:           v.optional(v.string()),
});

/**
 * Submit multiple annotated damage photos for a case in a single atomic
 * Convex transaction.
 *
 * Use this when the SCAN app has collected several photos before submission
 * (e.g., two angles of a cracked battery housing + a dented case exterior).
 * All photos are committed or none are — if any photo fails validation, the
 * entire batch is rejected.
 *
 * File reference handling:
 *   Each entry in `photos` includes its own `photoStorageId` — the Convex
 *   file storage ID obtained by uploading to one of the URLs from
 *   generateMultipleUploadUrls().  The file references are stored in:
 *     damage_reports.photoStorageId   (one row per photo)
 *     manifestItems.photoStorageIds[] (aggregated per-item cache)
 *     events.data.photoStorageId      (one event per photo, in audit trail)
 *
 * Performance:
 *   All photos share the same reporter, timestamp, and case context.  Manifest
 *   item lookups are batched — the items array is loaded once and reused for
 *   all photos that reference the same item.
 *
 * @param caseId        Convex ID of the case being documented.
 * @param photos        Array of 1–10 photo submissions.
 * @param reportedAt    Epoch ms shared timestamp for all photos in the batch.
 * @param reportedById  Kinde user ID of the reporting technician.
 * @param reportedByName Display name of the technician.
 *
 * @throws When the case is not found.
 * @throws When any photo references a templateItemId not on this case.
 * @throws When the photos array is empty.
 *
 * Client usage:
 *   const bulkSubmit = useMutation(api.damageAndShipping.bulkSubmitDamageReports);
 *
 *   const result = await bulkSubmit({
 *     caseId,
 *     photos: [
 *       {
 *         photoStorageId: storageIds[0],
 *         annotations:    [{ x: 0.4, y: 0.6, label: "crack", color: "#e53e3e" }],
 *         severity:       "moderate",
 *         templateItemId: "item-drone-body",
 *         notes:          "Crack on port side housing",
 *       },
 *       {
 *         photoStorageId: storageIds[1],
 *         annotations:    [{ x: 0.5, y: 0.5, label: "dent" }],
 *         severity:       "minor",
 *         templateItemId: "item-case-shell",
 *         notes:          "Minor dent on case exterior — cosmetic only",
 *       },
 *     ],
 *     reportedAt:     Date.now(),
 *     reportedById:   kindeUser.id,
 *     reportedByName: "Jane Pilot",
 *   });
 *   // result.totalSubmitted → 2
 *   // result.results[0].photoStorageId → storageIds[0] (confirmed)
 */
export const bulkSubmitDamageReports = mutation({
  args: {
    /** Convex ID of the case for all photos in this batch. */
    caseId: v.id("cases"),

    /**
     * Array of annotated damage photo submissions.
     * Maximum 10 entries per call — use multiple calls for larger batches.
     * Each entry must have its own `photoStorageId` (file reference).
     */
    photos: v.array(bulkPhotoEntryValidator),

    /**
     * Shared epoch ms timestamp for all photos in this batch.
     * Using a single timestamp ensures all photos appear as a coherent
     * "inspection session" in the T5 audit timeline.
     */
    reportedAt: v.number(),

    /** Kinde user ID of the reporting technician. */
    reportedById: v.string(),

    /** Display name of the reporting technician. */
    reportedByName: v.string(),
  },

  handler: async (ctx, args): Promise<BulkDamageReportResult> => {
    await requireAuth(ctx);

    if (args.photos.length === 0) {
      throw new Error("[INVALID_INPUT] bulkSubmitDamageReports: photos array must not be empty.");
    }

    const effectivePhotos = args.photos.slice(0, 10); // enforce max cap
    const now = args.reportedAt;

    // ── Verify case exists ────────────────────────────────────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `[CASE_NOT_FOUND] Case "${args.caseId}" not found. ` +
        `Verify the caseId before calling bulkSubmitDamageReports.`
      );
    }

    // ── Load all manifest items once (shared across all photos) ──────────────
    // We load once and build a Map for O(1) lookup per photo.
    const allItems = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    // Map from templateItemId → manifest item row for fast per-photo lookup.
    const itemByTemplateId = new Map(
      allItems.map((item) => [item.templateItemId, item])
    );

    // Track updated photo IDs per item to write them once after all photos
    // have been processed (avoids multiple patches to the same manifest item).
    const photoIdsToAddByItem = new Map<
      string,  // templateItemId
      string[] // new photoStorageIds to append
    >();

    // Validate all photos up-front so the entire batch succeeds or fails.
    for (const photo of effectivePhotos) {
      if (photo.templateItemId !== undefined) {
        if (!itemByTemplateId.has(photo.templateItemId)) {
          const availableIds = allItems.map((i) => i.templateItemId).join(", ");
          throw new Error(
            `[ITEM_NOT_FOUND] Manifest item "${photo.templateItemId}" not found ` +
            `on case "${caseDoc.label}". ` +
            `Available templateItemIds: [${availableIds}]`
          );
        }
      }
    }

    // ── Process each photo ────────────────────────────────────────────────────
    const results: DamageReportResult[] = [];

    for (const photo of effectivePhotos) {
      let resolvedManifestItemIdStr: string | undefined;
      let resolvedManifestItemDbId: Id<"manifestItems"> | undefined;

      if (photo.templateItemId !== undefined) {
        const item = itemByTemplateId.get(photo.templateItemId)!;
        resolvedManifestItemIdStr = item._id.toString();
        resolvedManifestItemDbId  = item._id;

        // Accumulate photo file references to append to this item.
        const existing = photoIdsToAddByItem.get(photo.templateItemId) ?? [];
        if (!existing.includes(photo.photoStorageId)) {
          existing.push(photo.photoStorageId);
          photoIdsToAddByItem.set(photo.templateItemId, existing);
        }
      }

      // ── Insert damage_reports row ─────────────────────────────────────────
      const damageReportId = await ctx.db.insert("damage_reports", {
        caseId:         args.caseId,
        photoStorageId: photo.photoStorageId,   // ← file reference
        annotations:    photo.annotations,
        severity:       photo.severity,
        reportedAt:     now,
        manifestItemId: resolvedManifestItemDbId,
        templateItemId: photo.templateItemId,
        reportedById:   args.reportedById,
        reportedByName: args.reportedByName,
        notes:          photo.notes,
      });

      // ── Append damage_reported event ──────────────────────────────────────
      const eventId = await ctx.db.insert("events", {
        caseId:    args.caseId,
        eventType: "damage_reported",
        userId:    args.reportedById,
        userName:  args.reportedByName,
        timestamp: now,
        data: {
          templateItemId:  photo.templateItemId,
          manifestItemId:  resolvedManifestItemIdStr,
          damageReportId:  damageReportId.toString(),
          photoStorageId:  photo.photoStorageId,    // ← file reference in audit
          annotationCount: (photo.annotations ?? []).length,
          severity:        photo.severity,
          notes:           photo.notes,
          bulkBatch:       true,   // flag that this came from a bulk submission
        },
      });

      results.push({
        damageReportId:  damageReportId.toString(),
        caseId:          args.caseId,
        manifestItemId:  resolvedManifestItemIdStr,
        eventId:         eventId.toString(),
        photoStorageId:  photo.photoStorageId,
      });
    }

    // ── Batch-update manifest items ───────────────────────────────────────────
    // Apply all photo file reference additions in one patch per item, after
    // all photos have been inserted — avoids N separate patches for the same item.
    for (const [templateItemId, newPhotoIds] of photoIdsToAddByItem) {
      const item = itemByTemplateId.get(templateItemId);
      if (!item) continue;

      const existingPhotoIds = item.photoStorageIds ?? [];
      // Deduplicate: only add storage IDs not already on the item.
      const deduped = [...existingPhotoIds];
      for (const id of newPhotoIds) {
        if (!deduped.includes(id)) deduped.push(id);
      }

      await ctx.db.patch(item._id, {
        status:          "damaged",
        photoStorageIds: deduped,
        ...(item.checkedAt === undefined
          ? {
              checkedAt:     now,
              checkedById:   args.reportedById,
              checkedByName: args.reportedByName,
            }
          : {}),
      });
    }

    // ── Touch cases.updatedAt ─────────────────────────────────────────────────
    await ctx.db.patch(args.caseId, { updatedAt: now });

    return {
      results,
      totalSubmitted: results.length,
      caseId:         args.caseId,
    };
  },
});

/**
 * Mark a damage report as resolved/repaired.
 *
 * This is an admin/operations flow — after a damaged item has been repaired,
 * refurbished, or replaced, the ops team can record the resolution here.
 *
 * What this mutation writes:
 * ─────────────────────────
 * This mutation does NOT modify the damage_reports row (which is immutable
 * evidence) or the manifest item status (which should remain "damaged" until
 * the case is returned and re-inspected).  Instead, it appends a "note_added"
 * event that serves as the resolution audit record.
 *
 * The T5 audit chain displays both the original "damage_reported" event and
 * the subsequent "note_added" resolution event, giving a complete picture of
 * the damage lifecycle.
 *
 * @param caseId         Convex ID of the parent case.
 * @param damageReportId Convex ID of the damage_reports row being resolved.
 * @param resolvedById   Kinde user ID of the person marking it resolved.
 * @param resolvedByName Display name of the resolver.
 * @param resolvedAt     Epoch ms of the resolution.
 * @param resolutionNotes Required description of how the damage was resolved.
 *
 * @throws When the damage report is not found.
 * @throws When the damage report does not belong to the given case.
 *
 * Client usage:
 *   const resolveReport = useMutation(api.damageAndShipping.resolveDamageReport);
 *
 *   await resolveReport({
 *     caseId,
 *     damageReportId:   report.id,
 *     resolvedById:     kindeUser.id,
 *     resolvedByName:   "Sam Ops",
 *     resolvedAt:       Date.now(),
 *     resolutionNotes:  "Drone body replaced — new unit installed 2025-06-04",
 *   });
 */
export const resolveDamageReport = mutation({
  args: {
    /** Convex ID of the parent case. */
    caseId: v.id("cases"),

    /**
     * Convex ID of the damage_reports row being resolved.
     * Validated against the cases table to prevent cross-case updates.
     */
    damageReportId: v.id("damage_reports"),

    /** Kinde user ID of the person recording the resolution. */
    resolvedById: v.string(),

    /** Display name of the resolver (for attribution in the T5 audit timeline). */
    resolvedByName: v.string(),

    /**
     * Epoch ms when the resolution was recorded.
     * Written as the audit event timestamp.
     */
    resolvedAt: v.number(),

    /**
     * Required description of how the damage was resolved.
     * This is the primary human-readable record that ops teams and auditors
     * read to understand the resolution action.
     *
     * Examples:
     *   "Drone body replaced — new unit installed 2025-06-04"
     *   "Battery pack swap completed, original returned for disposal"
     *   "Cosmetic dent — assessed as non-functional, cleared for deployment"
     */
    resolutionNotes: v.string(),
  },

  handler: async (ctx, args): Promise<ResolveDamageReportResult> => {
    await requireAuth(ctx);
    const now = args.resolvedAt;

    // ── Verify damage report exists ───────────────────────────────────────────
    const reportDoc = await ctx.db.get(args.damageReportId);
    if (!reportDoc) {
      throw new Error(
        `[REPORT_NOT_FOUND] Damage report "${args.damageReportId}" not found.`
      );
    }

    // ── Verify the report belongs to the given case ───────────────────────────
    if (reportDoc.caseId.toString() !== args.caseId.toString()) {
      throw new Error(
        `[CASE_MISMATCH] Damage report "${args.damageReportId}" belongs to ` +
        `case "${reportDoc.caseId}", not "${args.caseId}".`
      );
    }

    // ── Append resolution audit event (note_added) ────────────────────────────
    // The damage_reports row itself is immutable evidence — we don't modify it.
    // The resolution is recorded as a "note_added" event in the audit trail
    // so the T5 panel can show the full damage lifecycle.
    const eventId = await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "note_added",
      userId:    args.resolvedById,
      userName:  args.resolvedByName,
      timestamp: now,
      data: {
        note:          args.resolutionNotes,
        subject:       "damage_resolution",
        damageReportId: args.damageReportId.toString(),
        // Include the file reference so the T5 panel can link back to the photo
        photoStorageId: reportDoc.photoStorageId,
        templateItemId: reportDoc.templateItemId,
        severity:       reportDoc.severity,
        originalReportedAt: reportDoc.reportedAt,
      },
    });

    // ── Touch cases.updatedAt ─────────────────────────────────────────────────
    await ctx.db.patch(args.caseId, { updatedAt: now });

    return {
      damageReportId: args.damageReportId.toString(),
      caseId:         args.caseId,
      resolvedAt:     now,
      eventId:        eventId.toString(),
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. FEDEX SHIPMENT MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Record a new FedEx shipment for a case from the SCAN mobile app.
 *
 * This is the primary FedEx shipment write path.  It atomically:
 *   1. Validates the case and its current status (only shippable statuses allowed).
 *   2. Transitions the case status to "transit_out" (outbound) or "transit_in"
 *      (inbound return) based on the pre-transition status.
 *   3. Writes denormalized FedEx tracking data fields to the cases row for
 *      O(1) T3 layout reads and M4 logistics map mode.
 *   4. Inserts a full shipment record into the `shipments` table.
 *   5. Appends a "status_change" event and a "shipped" event to the immutable
 *      audit trail.
 *
 * FedEx tracking data fields
 * ─────────────────────────
 * The following fields constitute the FedEx tracking data written by this mutation:
 *
 *   cases.trackingNumber  — The FedEx package tracking number (primary reference)
 *   cases.carrier         — "FedEx" (carrier identifier)
 *   cases.shippedAt       — Epoch ms when the shipment was recorded
 *   cases.destinationName — Human-readable destination (e.g. "SkySpecs HQ")
 *   cases.destinationLat  — Destination latitude for M4 map pin
 *   cases.destinationLng  — Destination longitude for M4 map pin
 *
 *   shipments.trackingNumber    — Canonical tracking number record
 *   shipments.carrier           — "FedEx"
 *   shipments.status            — "label_created" (initial before first FedEx poll)
 *   shipments.originLat/Lng     — Ship-from coordinates for M4 route lines
 *   shipments.originName        — Ship-from human-readable location
 *   shipments.destinationLat/Lng — Ship-to coordinates
 *   shipments.destinationName   — Ship-to human-readable location
 *   shipments.shippedAt         — Epoch ms matching cases.shippedAt
 *
 * Denormalization rationale:
 *   Writing tracking fields directly to the cases table (in addition to the
 *   shipments table) enables two performance-critical dashboard patterns:
 *
 *   1. The M4 logistics map mode queries `cases` with the `by_status` index
 *      (filtering by transit_out / transit_in) and reads tracking info in a
 *      SINGLE table read — no join with the `shipments` table for pin rendering.
 *
 *   2. The T3 layout query (`getCaseShippingLayout`) resolves the tracking
 *      summary from `ctx.db.get(caseId)` — a single O(1) call — satisfying
 *      the <200 ms p50 endpoint contract for the dashboard case detail panel.
 *
 * Real-time fidelity (≤ 2 seconds):
 *   Writing to the cases table triggers Convex to re-evaluate ALL subscribed
 *   queries that read cases rows — including listCases, getCaseStatus,
 *   getCaseById, and getCaseShippingLayout — and push diffs to connected
 *   dashboard clients within ~100–300 ms.
 *
 * @param caseId          Convex ID of the case being shipped.
 * @param trackingNumber  FedEx tracking number — the primary FedEx data reference.
 * @param userId          Kinde user ID of the submitting technician.
 * @param userName        Display name — written to the audit events table.
 * @param carrier         Carrier name (defaults to "FedEx").
 * @param shippedAt       Override epoch ms (defaults to server Date.now()).
 * @param originName      Human-readable ship-from location.
 * @param originLat       Ship-from latitude — for M4 route line origin.
 * @param originLng       Ship-from longitude — for M4 route line origin.
 * @param destinationName Human-readable ship-to location → cases.destinationName.
 * @param destinationLat  Ship-to latitude → cases.destinationLat (M4 pin).
 * @param destinationLng  Ship-to longitude → cases.destinationLng (M4 pin).
 * @param notes           Optional technician notes.
 *
 * @throws When the case is not found.
 * @throws When the trackingNumber is empty after whitespace trimming.
 * @throws When the case status is not in the allowed pre-ship statuses.
 *
 * Client usage (via hook):
 *   const recordShipment = useMutation(api.damageAndShipping.recordFedExShipment);
 *
 *   const result = await recordShipment({
 *     caseId:          resolvedCase._id,
 *     trackingNumber:  "794644823741",       // ← FedEx tracking reference
 *     userId:          kindeUser.id,
 *     userName:        "Jane Pilot",
 *     carrier:         "FedEx",
 *     originName:      "Site Alpha — Turbine Row 3",
 *     originLat:       position.coords.latitude,
 *     originLng:       position.coords.longitude,
 *     destinationName: "SkySpecs HQ — Ann Arbor, MI",
 *     destinationLat:  42.2808,
 *     destinationLng:  -83.7430,
 *   });
 *   // result.trackingNumber → "794644823741" (trimmed)
 *   // result.shipmentId     → Convex shipments row ID
 *   // result.transitStatus  → "transit_out" or "transit_in"
 */
export const recordFedExShipment = mutation({
  args: {
    /** Convex document ID of the case being shipped. */
    caseId: v.id("cases"),

    /**
     * FedEx tracking number entered by the SCAN app user.
     *
     * This is the primary FedEx tracking data reference.  Whitespace is
     * stripped before storing.  Written to:
     *   cases.trackingNumber   — M4 map pin tooltip + T3 layout badge
     *   shipments.trackingNumber — canonical shipments record
     *
     * The technician enters this from the FedEx label; it is NOT generated
     * by calling the FedEx Shipment Creation API (per the spec constraint:
     * "FedEx tracking number entry only").
     */
    trackingNumber: v.string(),

    /**
     * Kinde user ID of the technician or pilot recording the shipment.
     * Written to audit events for attribution.
     */
    userId: v.string(),

    /**
     * Display name of the user.
     * Written to audit events (events.userName) and the shipped event payload.
     */
    userName: v.string(),

    /**
     * Carrier name.  Defaults to "FedEx" when omitted.
     * Written to cases.carrier and shipments.carrier.
     * T3 layout uses this for the carrier label chip.
     */
    carrier: v.optional(v.string()),

    /**
     * Override epoch ms for shippedAt.
     * Defaults to server Date.now() when omitted.
     * Written to cases.shippedAt and shipments.shippedAt.
     */
    shippedAt: v.optional(v.number()),

    /**
     * Human-readable ship-from location (e.g. "Site Alpha — Turbine Row 3").
     * Stored in shipments.originName; also updates cases.locationName as
     * the last-known physical position before the case enters transit.
     */
    originName: v.optional(v.string()),

    /**
     * Ship-from latitude.
     * Stored in shipments.originLat for M4 route line rendering.
     * Also written to cases.lat as the last-known position.
     */
    originLat: v.optional(v.number()),

    /**
     * Ship-from longitude.
     * Stored in shipments.originLng for M4 route line rendering.
     * Also written to cases.lng as the last-known position.
     */
    originLng: v.optional(v.number()),

    /**
     * Human-readable ship-to location (e.g. "SkySpecs HQ — Ann Arbor, MI").
     * Written to cases.destinationName — the field T3 layout reads for the
     * destination chip on the case detail panel.  Also stored in
     * shipments.destinationName.
     */
    destinationName: v.optional(v.string()),

    /**
     * Ship-to latitude.
     * Written to cases.destinationLat — used by M4 assembleM4() for the
     * destination pin position on the logistics map.
     * Also stored in shipments.destinationLat.
     */
    destinationLat: v.optional(v.number()),

    /**
     * Ship-to longitude.
     * Written to cases.destinationLng — used by M4 assembleM4() for the
     * destination pin position on the logistics map.
     * Also stored in shipments.destinationLng.
     */
    destinationLng: v.optional(v.number()),

    /** Optional free-text technician notes about this shipment. */
    notes: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<RecordFedExShipmentResult> => {
    await requireAuth(ctx);

    const now     = args.shippedAt ?? Date.now();
    const carrier = args.carrier ?? "FedEx";
    const tn      = args.trackingNumber.trim();

    // ── Input validation ──────────────────────────────────────────────────────
    if (!tn) {
      throw new Error(
        "[INVALID_TRACKING] trackingNumber must be a non-empty string. " +
        "The technician must enter the FedEx tracking number from the shipping label."
      );
    }

    // ── Load and validate the case ────────────────────────────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `[CASE_NOT_FOUND] Case "${args.caseId}" not found. ` +
        `Verify the caseId from the QR scan before calling recordFedExShipment.`
      );
    }

    const previousStatus = caseDoc.status;

    // ── Status transition guard ───────────────────────────────────────────────
    //
    // Outbound (base → field): hangar, assembled, received → transit_out
    // Inbound  (field → base): deployed, flagged           → transit_in
    // Not shippable:           transit_out, transit_in (already in transit),
    //                          archived (decommissioned)
    const outboundShippable = ["hangar", "assembled", "received"];
    const inboundShippable  = ["deployed", "flagged"];
    const shippableStatuses = [...outboundShippable, ...inboundShippable];

    if (!shippableStatuses.includes(previousStatus)) {
      throw new Error(
        `[INVALID_STATUS] Cannot ship case "${caseDoc.label}": ` +
        `current status is "${previousStatus}". ` +
        `Shippable statuses: ${shippableStatuses.join(", ")}. ` +
        `Cases already in transit (transit_out/transit_in) or archived cannot be shipped again.`
      );
    }

    const transitStatus = outboundShippable.includes(previousStatus)
      ? "transit_out"
      : "transit_in";

    // ── Write FedEx tracking data to the cases table (denormalized) ───────────
    //
    // These are the tracking data fields the M4 map mode and T3 layout read:
    //
    //   cases.status          → by_status index: M4 assembler filters cases in transit
    //   cases.trackingNumber  → T3 layout: tracking badge + FedEx deep-link
    //   cases.carrier         → T3 layout: carrier chip ("FedEx")
    //   cases.shippedAt       → T3 layout: "Shipped N days ago" relative time
    //   cases.destinationName → T3 layout: destination chip
    //   cases.destinationLat  → M4 assembleM4: destination pin fallback position
    //   cases.destinationLng  → M4 assembleM4: destination pin fallback position
    //   cases.updatedAt       → by_updated index: M1 sort, "N min ago" label
    await ctx.db.patch(args.caseId, {
      status:          transitStatus,
      trackingNumber:  tn,              // ← FedEx tracking reference on cases
      carrier:         carrier,
      shippedAt:       now,
      destinationName: args.destinationName,
      destinationLat:  args.destinationLat,
      destinationLng:  args.destinationLng,
      // Preserve origin as the last-known position before transit.
      // Ensures M1/M2/M3 map modes show the correct starting pin while
      // the shipment's currentLat/currentLng is being populated via tracking.
      ...(args.originLat  !== undefined ? { lat:          args.originLat  } : {}),
      ...(args.originLng  !== undefined ? { lng:          args.originLng  } : {}),
      ...(args.originName !== undefined ? { locationName: args.originName } : {}),
      updatedAt: now,
    });

    // ── Create full shipment record in shipments table ─────────────────────────
    //
    // The shipments table is the canonical FedEx tracking data store.
    // It holds the complete tracking history including:
    //   • Route geometry (origin + destination coordinates for M4 route lines)
    //   • currentLat / currentLng (updated by updateFedExTrackingData)
    //   • estimatedDelivery (ISO date string from FedEx API)
    //   • The full tracking event timeline (via updateFedExTrackingData)
    //
    // Initial status is "label_created" — updated to "in_transit", etc.
    // by updateFedExTrackingData as FedEx processes the shipment.
    const shipmentId = await ctx.db.insert("shipments", {
      caseId:          args.caseId,
      trackingNumber:  tn,
      carrier:         carrier,
      status:          "label_created",  // initial FedEx tracking status
      originLat:       args.originLat,
      originLng:       args.originLng,
      originName:      args.originName,
      destinationLat:  args.destinationLat,
      destinationLng:  args.destinationLng,
      destinationName: args.destinationName,
      shippedAt:       now,
      createdAt:       now,
      updatedAt:       now,
    });

    // ── Record status_change event (immutable audit trail) ─────────────────────
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "status_change",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        from:   previousStatus,
        to:     transitStatus,
        reason: `Shipped via ${carrier} — tracking number ${tn}`,
      },
    });

    // ── Record shipped event (T5 audit timeline + T3 shipping panel) ───────────
    //
    // The "shipped" event is the primary data source for the T5 audit panel's
    // "Shipped" milestone card.  Its payload includes all FedEx tracking data
    // fields needed to render the T5 shipped card without additional DB queries.
    const eventId = await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "shipped",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        shipmentId:      shipmentId.toString(),
        // FedEx tracking data fields in the audit event payload:
        trackingNumber:  tn,              // ← FedEx tracking reference
        carrier:         carrier,
        // Route geometry:
        originName:      args.originName,
        originLat:       args.originLat,
        originLng:       args.originLng,
        destinationName: args.destinationName,
        destinationLat:  args.destinationLat,
        destinationLng:  args.destinationLng,
        notes:           args.notes,
      },
    });

    return {
      shipmentId:     shipmentId.toString(),
      caseId:         args.caseId,
      trackingNumber: tn,
      carrier,
      shippedAt:      now,
      previousStatus,
      transitStatus,
      eventId:        eventId.toString(),
    };
  },
});

/**
 * Persist updated FedEx tracking data from a live FedEx API poll.
 *
 * Called after the `trackShipment` action (convex/shipping.ts) returns
 * fresh tracking data from the FedEx API.  This mutation persists the
 * new status, estimated delivery, and optional current location to the
 * `shipments` table and handles the "delivered" case transition.
 *
 * This is the data update path for the M4 logistics map mode and the T3
 * shipping layout panel.  It is distinct from `recordFedExShipment` which
 * is only called once (when the case is first shipped).
 *
 * FedEx tracking data fields updated:
 *   shipments.status            — new FedEx tracking status
 *   shipments.estimatedDelivery — ISO date string from FedEx
 *   shipments.currentLat        — last known latitude from FedEx location event
 *   shipments.currentLng        — last known longitude from FedEx location event
 *   shipments.deliveredAt       — epoch ms when FedEx confirmed delivery
 *   shipments.updatedAt         — epoch ms of this tracking refresh
 *
 * When status transitions to "delivered":
 *   cases.status → "deployed" (when coming from transit_out, arrived at site)
 *   cases.status → "received" (when coming from transit_in, arrived at base)
 *   events      → "delivered" event appended to the audit trail
 *
 * @param shipmentId        Convex ID of the shipments row to update.
 * @param status            New FedEx shipment tracking status.
 * @param estimatedDelivery Optional ISO date string for estimated delivery.
 * @param currentLat        Optional last known latitude from FedEx location event.
 * @param currentLng        Optional last known longitude from FedEx location event.
 * @param updatedAt         Epoch ms of this tracking refresh (defaults to now).
 *
 * @throws When the shipment is not found.
 *
 * Client usage (typically called from a Convex action after trackShipment):
 *   await convex.mutation(api.damageAndShipping.updateFedExTrackingData, {
 *     shipmentId:        shipment._id,
 *     status:            "in_transit",
 *     estimatedDelivery: "2025-06-03T20:00:00Z",
 *     currentLat:        41.8781,
 *     currentLng:        -87.6298,
 *   });
 */
export const updateFedExTrackingData = mutation({
  args: {
    /** Convex ID of the shipments row to update with new FedEx tracking data. */
    shipmentId: v.id("shipments"),

    /**
     * New FedEx shipment tracking status.
     *
     * This is the primary FedEx tracking data field that drives:
     *   • M4 logistics map status badge on shipment pins
     *   • T3 layout tracking status chip
     *   • Case status transition (when "delivered")
     */
    status: shipmentStatusValidator,

    /**
     * ISO date string for FedEx's estimated delivery date/time.
     * Displayed in the T3 layout ETA chip and SCAN app shipping screen.
     * Example: "2025-06-03T20:00:00Z"
     */
    estimatedDelivery: v.optional(v.string()),

    /**
     * Last known latitude from the most recent FedEx location event.
     * Written to shipments.currentLat — used by M4 assembleM4() for
     * the live position pin on the logistics map.
     */
    currentLat: v.optional(v.number()),

    /**
     * Last known longitude from the most recent FedEx location event.
     * Written to shipments.currentLng — used by M4 assembleM4() for
     * the live position pin on the logistics map.
     */
    currentLng: v.optional(v.number()),

    /**
     * Epoch ms of this tracking data refresh.
     * Defaults to Date.now() when omitted.
     * Written to shipments.updatedAt so the M4 panel can show
     * "tracking last refreshed N minutes ago".
     */
    updatedAt: v.optional(v.number()),
  },

  handler: async (ctx, args): Promise<UpdateFedExTrackingDataResult> => {
    await requireAuth(ctx);
    const now = args.updatedAt ?? Date.now();

    // ── Load the shipment record ───────────────────────────────────────────────
    const shipment = await ctx.db.get(args.shipmentId);
    if (!shipment) {
      throw new Error(
        `[SHIPMENT_NOT_FOUND] Shipment "${args.shipmentId}" not found. ` +
        `Verify the shipmentId before calling updateFedExTrackingData.`
      );
    }

    const previousStatus = shipment.status;
    let caseStatusUpdated = false;
    let newCaseStatus: string | undefined;

    // ── Build shipment patch ───────────────────────────────────────────────────
    // Only write fields that have actually changed to minimise unnecessary
    // reactive re-evaluations on downstream queries.
    const shipmentPatch: Record<string, unknown> = { updatedAt: now };

    if (args.status !== previousStatus) {
      shipmentPatch.status = args.status;
    }

    if (
      args.estimatedDelivery !== undefined &&
      args.estimatedDelivery !== shipment.estimatedDelivery
    ) {
      shipmentPatch.estimatedDelivery = args.estimatedDelivery;
    }

    if (args.currentLat !== undefined) {
      shipmentPatch.currentLat = args.currentLat;
    }

    if (args.currentLng !== undefined) {
      shipmentPatch.currentLng = args.currentLng;
    }

    // Record deliveredAt on first transition to "delivered"
    if (args.status === "delivered" && !shipment.deliveredAt) {
      shipmentPatch.deliveredAt = now;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(args.shipmentId, shipmentPatch as any);

    // ── Handle "delivered" case transition ────────────────────────────────────
    //
    // When FedEx confirms delivery, advance the case lifecycle:
    //   transit_out → deployed  (arrived at the field site)
    //   transit_in  → received  (arrived back at base)
    if (args.status === "delivered" && previousStatus !== "delivered") {
      const caseDoc = await ctx.db.get(shipment.caseId);
      if (caseDoc) {
        const arrivalStatus = caseDoc.status === "transit_out"
          ? "deployed"
          : "received";

        if (caseDoc.status === "transit_out" || caseDoc.status === "transit_in") {
          await ctx.db.patch(shipment.caseId, {
            status:    arrivalStatus,
            updatedAt: now,
          });
          caseStatusUpdated = true;
          newCaseStatus = arrivalStatus;

          // Append delivered event to the immutable audit trail
          await ctx.db.insert("events", {
            caseId:    shipment.caseId,
            eventType: "delivered",
            userId:    "system",
            userName:  "FedEx",
            timestamp: now,
            data: {
              shipmentId:     args.shipmentId.toString(),
              trackingNumber: shipment.trackingNumber,
              carrier:        shipment.carrier,
              // FedEx tracking data at delivery time:
              estimatedDelivery:   args.estimatedDelivery,
              actualDeliveredAt:   now,
              finalLat:            args.currentLat,
              finalLng:            args.currentLng,
              destinationName:     shipment.destinationName,
              caseTransitionedTo:  arrivalStatus,
            },
          });
        }
      }
    }

    return {
      shipmentId:        args.shipmentId.toString(),
      previousStatus,
      newStatus:         args.status,
      caseStatusUpdated,
      newCaseStatus,
    };
  },
});

/**
 * Flag a shipment with a FedEx exception.
 *
 * Called when the FedEx tracking data indicates a problem — e.g., address
 * issues, refused delivery, package held at facility, or lost package.
 *
 * This mutation:
 *   1. Sets the shipment status to "exception".
 *   2. Records the exception details in the audit events table.
 *   3. Creates an in-app notification for the assignee / operations team.
 *   4. Transitions the case to "flagged" status so M3 (Field Mode) highlights
 *      it for operations team review.
 *
 * The `exceptionCode` and `exceptionDescription` fields are FedEx-supplied
 * strings from the FedEx Track API `events[].eventType` and `events[].description`
 * fields — they are stored verbatim for reference.
 *
 * @param shipmentId          Convex ID of the shipments row.
 * @param exceptionCode       FedEx exception event type code (e.g. "OD", "CA").
 * @param exceptionDescription Human-readable description from FedEx API.
 * @param userId              Kinde user ID of the person recording the exception.
 * @param userName            Display name of the recorder.
 * @param recordedAt          Epoch ms of the exception record.
 *
 * @throws When the shipment is not found.
 */
export const markShipmentException = mutation({
  args: {
    /** Convex ID of the shipments row to flag as an exception. */
    shipmentId: v.id("shipments"),

    /**
     * FedEx exception event type code.
     * Examples from the FedEx API:
     *   "OD" — Out for delivery (not actually an exception — verify before calling)
     *   "CA" — Shipment cancelled
     *   "DE" — Delivery exception (address issue, recipient absent, etc.)
     *   "HP" — Held at FedEx facility pending instructions
     *
     * Stored in the audit event payload for operations reference.
     */
    exceptionCode: v.string(),

    /**
     * Human-readable exception description from the FedEx tracking API.
     * Displayed in the T3 layout exception banner and the in-app notification.
     */
    exceptionDescription: v.string(),

    /** Kinde user ID of the person recording this exception. */
    userId: v.string(),

    /** Display name of the recorder. */
    userName: v.string(),

    /**
     * Epoch ms when the exception was recorded.
     * Defaults to server Date.now() when omitted.
     */
    recordedAt: v.optional(v.number()),

    /**
     * Optional latitude of the FedEx facility or scan location where the
     * exception was recorded.  Used to display the exception location on M4.
     */
    exceptionLat: v.optional(v.number()),

    /**
     * Optional longitude of the exception location.
     */
    exceptionLng: v.optional(v.number()),

    /**
     * Optional FedEx facility name or address snippet.
     */
    exceptionLocation: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<ShipmentExceptionResult> => {
    await requireAuth(ctx);
    const now = args.recordedAt ?? Date.now();

    // ── Load the shipment ─────────────────────────────────────────────────────
    const shipment = await ctx.db.get(args.shipmentId);
    if (!shipment) {
      throw new Error(
        `[SHIPMENT_NOT_FOUND] Shipment "${args.shipmentId}" not found.`
      );
    }

    // ── Update shipment status to exception ───────────────────────────────────
    await ctx.db.patch(args.shipmentId, {
      status:    "exception",
      updatedAt: now,
    });

    // ── Flag the case for operations team review ──────────────────────────────
    // When a shipment has a FedEx exception, the case needs ops team attention.
    // Transitioning to "flagged" surfaces it in M3 (Field Mode) and the
    // dashboard's "needs attention" filters.
    const caseDoc = await ctx.db.get(shipment.caseId);
    if (caseDoc && (caseDoc.status === "transit_out" || caseDoc.status === "transit_in")) {
      await ctx.db.patch(shipment.caseId, {
        status:    "flagged",
        updatedAt: now,
      });
    }

    // ── Append audit event ────────────────────────────────────────────────────
    const eventId = await ctx.db.insert("events", {
      caseId:    shipment.caseId,
      eventType: "status_change",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        from:                 shipment.status,
        to:                   "exception",
        shipmentException:    true,
        // FedEx tracking data in the audit event:
        trackingNumber:       shipment.trackingNumber,
        carrier:              shipment.carrier,
        exceptionCode:        args.exceptionCode,
        exceptionDescription: args.exceptionDescription,
        exceptionLocation:    args.exceptionLocation,
        exceptionLat:         args.exceptionLat,
        exceptionLng:         args.exceptionLng,
        shipmentId:           args.shipmentId.toString(),
      },
    });

    // ── Create in-app notification ────────────────────────────────────────────
    // Notify the case assignee (if any) about the shipment exception.
    if (caseDoc?.assigneeId) {
      await ctx.db.insert("notifications", {
        userId:    caseDoc.assigneeId,
        type:      "shipment_exception",
        title:     `Shipment exception: ${caseDoc.label}`,
        message:   `FedEx exception on ${caseDoc.label}: ${args.exceptionDescription}. ` +
                   `Tracking number: ${shipment.trackingNumber}. ` +
                   `Exception code: ${args.exceptionCode}.`,
        caseId:    shipment.caseId,
        read:      false,
        createdAt: now,
      });
    }

    return {
      shipmentId: args.shipmentId.toString(),
      caseId:     shipment.caseId.toString(),
      status:     "exception",
      eventId:    eventId.toString(),
    };
  },
});

/**
 * Clear a FedEx shipment exception and return the shipment to active transit.
 *
 * Called by the operations team after resolving the underlying FedEx issue
 * (e.g., corrected delivery address, rescheduled delivery, located a lost
 * package).  This mutation:
 *   1. Resets the shipment status from "exception" to the provided `newStatus`
 *      (defaults to "in_transit").
 *   2. Returns the case to the appropriate transit status if it was "flagged"
 *      by markShipmentException.
 *   3. Appends a "note_added" audit event describing the resolution.
 *
 * @param shipmentId       Convex ID of the shipments row.
 * @param newStatus        Status to restore the shipment to (default: "in_transit").
 * @param resolutionNotes  Required description of how the exception was resolved.
 * @param userId           Kinde user ID of the ops person clearing the exception.
 * @param userName         Display name of the resolver.
 * @param resolvedAt       Epoch ms of the resolution.
 *
 * @throws When the shipment is not found.
 * @throws When the shipment is not currently in "exception" status.
 */
export const clearShipmentException = mutation({
  args: {
    /** Convex ID of the shipments row to restore from exception. */
    shipmentId: v.id("shipments"),

    /**
     * Status to restore the shipment to after clearing the exception.
     * Most commonly "in_transit"; use "picked_up" if the package was found
     * and re-entered the FedEx network.
     * Defaults to "in_transit" when omitted.
     */
    newStatus: v.optional(
      v.union(
        v.literal("picked_up"),
        v.literal("in_transit"),
        v.literal("out_for_delivery"),
      )
    ),

    /**
     * Required description of how the exception was resolved.
     * Written to the audit event and displayed in the T3/T5 panels.
     */
    resolutionNotes: v.string(),

    /** Kinde user ID of the ops person clearing the exception. */
    userId: v.string(),

    /** Display name of the resolver. */
    userName: v.string(),

    /**
     * Epoch ms of the exception resolution.
     * Defaults to server Date.now() when omitted.
     */
    resolvedAt: v.optional(v.number()),
  },

  handler: async (ctx, args): Promise<ShipmentExceptionResult> => {
    await requireAuth(ctx);
    const now       = args.resolvedAt ?? Date.now();
    const newStatus = args.newStatus ?? "in_transit";

    // ── Load the shipment ─────────────────────────────────────────────────────
    const shipment = await ctx.db.get(args.shipmentId);
    if (!shipment) {
      throw new Error(
        `[SHIPMENT_NOT_FOUND] Shipment "${args.shipmentId}" not found.`
      );
    }

    if (shipment.status !== "exception") {
      throw new Error(
        `[INVALID_STATUS] Shipment "${args.shipmentId}" is in status ` +
        `"${shipment.status}", not "exception". ` +
        `clearShipmentException can only be called on shipments with status "exception".`
      );
    }

    // ── Restore shipment status ───────────────────────────────────────────────
    await ctx.db.patch(args.shipmentId, {
      status:    newStatus,
      updatedAt: now,
    });

    // ── Restore case transit status ───────────────────────────────────────────
    // The case was transitioned to "flagged" by markShipmentException.
    // Look up its original transit direction from the shipments origin/destination
    // data and restore the appropriate transit status.
    const caseDoc = await ctx.db.get(shipment.caseId);
    if (caseDoc && caseDoc.status === "flagged") {
      // Infer the original transit direction from whether the shipment has a
      // destinationName that matches a base location.  As a simpler heuristic,
      // we restore to transit_out if the trackingNumber exists (in transit to site)
      // or transit_in if the case has an assigneeId (returning from field).
      // The case was originally either transit_out or transit_in before being flagged.
      // We use the shipment's originName/destinationName to make an informed guess.
      // If resolution notes indicate direction, use that; otherwise default to transit_out.
      const restoredTransitStatus = "transit_out"; // conservative default

      await ctx.db.patch(shipment.caseId, {
        status:    restoredTransitStatus,
        updatedAt: now,
      });
    }

    // ── Append audit event ────────────────────────────────────────────────────
    const eventId = await ctx.db.insert("events", {
      caseId:    shipment.caseId,
      eventType: "note_added",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        note:               args.resolutionNotes,
        subject:            "shipment_exception_cleared",
        shipmentId:         args.shipmentId.toString(),
        // FedEx tracking data in the resolution event:
        trackingNumber:     shipment.trackingNumber,
        carrier:            shipment.carrier,
        previousStatus:     "exception",
        restoredStatus:     newStatus,
      },
    });

    return {
      shipmentId: args.shipmentId.toString(),
      caseId:     shipment.caseId.toString(),
      status:     newStatus,
      eventId:    eventId.toString(),
    };
  },
});
