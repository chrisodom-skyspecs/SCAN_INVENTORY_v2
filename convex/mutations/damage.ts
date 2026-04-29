/**
 * convex/mutations/damage.ts
 *
 * Canonical mutation functions for SCAN app damage report write operations.
 *
 * This module provides the authoritative, atomic write operations for the SCAN
 * mobile app's damage reporting workflow.  Each mutation writes to ALL relevant
 * tables in a single Convex transaction, ensuring consistency and triggering the
 * correct reactive query invalidations across the INVENTORY dashboard and SCAN app.
 *
 * Mutations exported
 * ──────────────────
 *   generateDamagePhotoUploadUrl  — Phase 1 of damage report: pre-signed Convex
 *                                   storage upload URL for a single photo.
 *
 *   generateMultipleUploadUrls    — Batch pre-signed upload URL generation for
 *                                   multi-photo damage inspection flows.
 *
 *   submitDamageReport            — Phase 2 of damage report: atomically insert a
 *                                   damage_reports row, update the linked manifest
 *                                   item status to "damaged", append an immutable
 *                                   damage_reported audit event, and touch
 *                                   cases.updatedAt.
 *
 *   bulkSubmitDamageReports       — Submit multiple annotated photos in one atomic
 *                                   transaction.  All photos are committed or none.
 *
 *   resolveDamageReport           — Record that a previously reported damage item
 *                                   has been repaired or resolved (appends an audit
 *                                   note_added event; does not mutate the original
 *                                   damage_reports row which is immutable evidence).
 *
 * Tables written per submitDamageReport call
 * ───────────────────────────────────────────
 *   damage_reports    INSERT — primary annotated photo evidence row
 *   manifestItems     PATCH  — status → "damaged", photoStorageIds append
 *   events            INSERT — damage_reported audit event (immutable)
 *   cases             PATCH  — updatedAt touch (M1 by_updated sort index)
 *
 * Reactive query invalidation
 * ───────────────────────────
 * Convex re-evaluates all subscribed queries reading the written tables and
 * pushes diffs to connected clients within ~100–300 ms.  A full submitDamageReport
 * write invalidates:
 *
 *   From damage_reports INSERT:
 *     getDamagePhotoReports          → T4 photo gallery
 *     getDamagePhotoReportsByRange   → T4 date-ranged photo view
 *     getDamagePhotoReportsWithUrls  → T3 panel with resolved photo URLs
 *
 *   From manifestItems PATCH:
 *     getDamageReportsByCase         → T4 item damage list
 *     getChecklistByCase             → SCAN app checklist view
 *     getChecklistSummary            → T2/T3 progress bar
 *     getDamageReportSummary         → status pills and progress bars
 *
 *   From events INSERT:
 *     getDamageReportEvents          → T5 audit timeline
 *     getCaseAuditEvents             → T5 full audit chain
 *
 *   From cases PATCH (updatedAt):
 *     listCases, getCaseById, getCaseStatus  → M1 by_updated sort + freshness label
 *
 * All subscribed clients receive the live update within 2 seconds of the
 * mutation completing — satisfying the real_time_fidelity acceptance criterion.
 *
 * Two-phase upload workflow
 * ─────────────────────────
 * The SCAN app uses a two-phase workflow for damage photos:
 *
 *   Phase 1 — Upload (this module: generateDamagePhotoUploadUrl)
 *   ─────────────────────────────────────────────────────────────
 *   1. SCAN app calls generateDamagePhotoUploadUrl() → receives a one-time URL.
 *   2. App uploads the photo binary via fetch (POST to the URL).
 *   3. Convex storage returns `{ storageId: string }` in the JSON response.
 *
 *   Phase 2 — Persist (this module: submitDamageReport)
 *   ─────────────────────────────────────────────────────
 *   4. App calls submitDamageReport with the storageId as `photoStorageId`,
 *      plus annotations, severity, and optional manifest item link.
 *   5. submitDamageReport writes to damage_reports, manifestItems, events, cases.
 *   6. Convex re-evaluates subscribed queries within ~100–300 ms.
 *
 * Annotation data model
 * ─────────────────────
 * The `annotations` field describes overlay pins placed by the technician on the
 * photo using the SCAN app markup tool.  Each pin specifies:
 *   x, y  — relative position as 0–1 fractions of the photo's pixel dimensions
 *   label — short text shown next to the pin in the UI
 *   color — optional hex colour string (e.g. "#e53e3e" for red)
 *
 * Storing positions as fractions ensures annotations render correctly regardless
 * of display resolution or photo orientation changes.
 *
 * Authentication
 * ──────────────
 * All mutations require a verified Kinde JWT.  Unauthenticated callers receive
 * [AUTH_REQUIRED].
 *
 * Client usage
 * ────────────
 * Prefer calling through typed hook wrappers:
 *
 *   // Phase 1: generate upload URL
 *   const generateUrl = useMutation(api.mutations.damage.generateDamagePhotoUploadUrl);
 *   const uploadUrl = await generateUrl();
 *
 *   // Upload the photo
 *   const resp = await fetch(uploadUrl, {
 *     method: "POST",
 *     headers: { "Content-Type": photoFile.type },
 *     body:    photoFile,
 *   });
 *   const { storageId } = await resp.json();
 *
 *   // Phase 2: submit the report
 *   const submit = useMutation(api.mutations.damage.submitDamageReport);
 *   const result = await submit({
 *     caseId:          resolvedCase._id,
 *     photoStorageId:  storageId,
 *     annotations:     [{ x: 0.4, y: 0.6, label: "crack", color: "#e53e3e" }],
 *     severity:        "moderate",
 *     reportedAt:      Date.now(),
 *     reportedById:    kindeUser.id,
 *     reportedByName:  "Jane Pilot",
 *     templateItemId:  "item-drone-body",
 *     notes:           "Impact crack on port side housing",
 *   });
 *   // result.damageReportId → Convex damage_reports row ID
 *   // result.photoStorageId → confirmed file reference
 *   // result.eventId        → Convex events row ID
 */

import { mutation } from "../_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Asserts that the calling client has a verified Kinde JWT.
 *
 * Throws with "[AUTH_REQUIRED]" prefix when:
 *   • No JWT was provided (unauthenticated request)
 *   • JWT signature failed Convex JWKS verification
 *   • JWT has expired
 *
 * Returns the UserIdentity so callers can access the subject claim (kindeId)
 * without a second getUserIdentity() call.
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
 * Annotation pin validator.
 *
 * An annotation pin is placed by the technician on a damage photo using the
 * SCAN app markup tool.  Positions are expressed as 0–1 fractions of the photo
 * dimensions so annotations remain accurate at any display resolution.
 */
const annotationValidator = v.object({
  /**
   * Relative horizontal position.
   * 0.0 = left edge of photo, 1.0 = right edge.
   */
  x:     v.number(),
  /**
   * Relative vertical position.
   * 0.0 = top edge of photo, 1.0 = bottom edge.
   */
  y:     v.number(),
  /**
   * Label text shown next to the pin in the SCAN markup tool and the T4
   * dashboard panel annotation overlay.
   */
  label: v.string(),
  /**
   * Optional hex colour string for the pin (e.g. "#e53e3e" for red).
   * When omitted, the SCAN app renders the pin in its default accent colour.
   */
  color: v.optional(v.string()),
});

/**
 * Damage severity validator.
 *
 * Drives badge colour in the T4 dashboard panel and SCAN app review screen.
 * Matches the severity union in the damage_reports table schema.
 *
 *   "minor"    — cosmetic damage only; does not affect equipment function
 *   "moderate" — functional impact; ops review recommended before next use
 *   "severe"   — equipment is not usable; immediate repair or replacement needed
 */
const damageSeverityValidator = v.union(
  v.literal("minor"),
  v.literal("moderate"),
  v.literal("severe"),
);

// ─── Return types ─────────────────────────────────────────────────────────────

/**
 * Return value of the `submitDamageReport` mutation and each entry in
 * the `bulkSubmitDamageReports` result array.
 *
 * Returned to the SCAN app so it can navigate to the confirmation screen
 * and immediately display the submitted damage evidence.
 */
export interface DamageReportResult {
  /**
   * Convex document ID of the newly created `damage_reports` row.
   *
   * Use this to:
   *   • Link subsequent additional photos to the same damage instance
   *   • Retrieve the specific report from the T4 panel
   *   • Call resolveDamageReport when the damage is repaired
   */
  damageReportId: string;

  /**
   * Convex document ID of the parent case.
   */
  caseId: string;

  /**
   * Convex document ID of the manifest item whose status was set to "damaged".
   * Undefined when the photo is a standalone case-level submission not linked
   * to a specific packing list item (i.e., templateItemId was not provided).
   */
  manifestItemId: string | undefined;

  /**
   * Convex document ID of the `damage_reported` audit event appended to the
   * immutable events table.  Used by the T5 audit chain panel and compliance
   * chain-of-custody reports.
   */
  eventId: string;

  /**
   * The Convex file storage ID of the uploaded photo.
   *
   * Included in the return value so the SCAN app can confirm the file reference
   * was stored correctly and immediately resolve it to a display URL via
   * ctx.storage.getUrl() (server-side) or the Convex useStorageURL hook
   * (client-side).
   */
  photoStorageId: string;
}

/**
 * Return value of the `bulkSubmitDamageReports` mutation.
 *
 * Contains a DamageReportResult for each submitted photo, maintaining the
 * same ordering as the input `photos` array.
 */
export interface BulkDamageReportResult {
  /**
   * One result per successfully submitted photo.
   * Maintains the ordering of the input `photos` array.
   */
  results: DamageReportResult[];

  /**
   * Total number of photos successfully submitted and persisted.
   * Equals results.length on success.
   */
  totalSubmitted: number;

  /**
   * The parent case ID.
   */
  caseId: string;
}

/**
 * Return value of the `resolveDamageReport` mutation.
 */
export interface ResolveDamageReportResult {
  /**
   * Convex document ID of the resolved damage_reports row.
   * The row itself is NOT modified (it is immutable evidence); this ID is
   * included so the SCAN app / dashboard can navigate to the original report.
   */
  damageReportId: string;

  /**
   * The parent case ID.
   */
  caseId: string;

  /**
   * Epoch ms when the resolution was recorded.
   */
  resolvedAt: number;

  /**
   * Convex document ID of the `note_added` event appended to the immutable
   * audit trail.  This event IS the resolution record — it is what the T5
   * panel renders as the "Damage Resolved" milestone.
   */
  eventId: string;
}

// ─── generateDamagePhotoUploadUrl ────────────────────────────────────────────

/**
 * Generate a short-lived Convex file-storage upload URL for a single damage
 * photo — Phase 1 of the SCAN app damage reporting workflow.
 *
 * This mutation is step 1 of the two-phase SCAN app photo submission pattern:
 *
 *   Phase 1 — Upload (this mutation)
 *   ─────────────────────────────────
 *   1. SCAN app calls generateDamagePhotoUploadUrl() → one-time signed URL.
 *   2. App uploads the photo binary via fetch POST to that URL.
 *   3. Convex storage returns `{ storageId: string }` in the response.
 *      This storageId is the "file reference" used in Phase 2.
 *
 *   Phase 2 — Persist (submitDamageReport)
 *   ──────────────────────────────────────
 *   4. App calls submitDamageReport({ caseId, photoStorageId: storageId, ... }).
 *   5. submitDamageReport writes to damage_reports, manifestItems, events, cases.
 *   6. Convex re-evaluates subscribed queries within ~100–300 ms.
 *
 * Security:
 *   Upload URLs are single-use and expire after 1 hour.  They grant write-only
 *   access to Convex storage — the client cannot read or list objects via the URL.
 *
 * @returns A short-lived pre-signed upload URL as a plain string.
 *
 * @throws "[AUTH_REQUIRED]" for unauthenticated requests.
 *
 * Client usage:
 *   const generateUrl = useMutation(api.mutations.damage.generateDamagePhotoUploadUrl);
 *   const uploadUrl = await generateUrl();
 *
 *   const response = await fetch(uploadUrl, {
 *     method:  "POST",
 *     headers: { "Content-Type": photoFile.type },
 *     body:    photoFile,
 *   });
 *   const { storageId } = await response.json();
 *   // storageId is the file reference — pass to submitDamageReport as photoStorageId
 */
export const generateDamagePhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    await requireAuth(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// ─── generateMultipleUploadUrls ───────────────────────────────────────────────

/**
 * Generate multiple Convex file-storage upload URLs in a single round-trip.
 *
 * When the SCAN app's damage reporting flow allows the technician to photograph
 * multiple damage angles before submitting (e.g., front view + close-up), this
 * mutation obtains all upload URLs in one call — reducing round-trip latency
 * compared to calling generateDamagePhotoUploadUrl N separate times.
 *
 * Each URL is independent and single-use.  The app can upload photos in parallel
 * via Promise.all, then call bulkSubmitDamageReports with all resulting storageIds.
 *
 * @param count  Number of upload URLs to generate.  Capped at 10 per call to
 *               prevent abuse.  A typical inspection photo set is 1–5 images.
 *
 * @returns Array of `{ uploadUrl, index }` objects in the requested order.
 *          `index` is a 0-based position hint for correlating each URL with the
 *          corresponding photo in the caller's internal state.
 *
 * @throws "[AUTH_REQUIRED]" for unauthenticated requests.
 *
 * Client usage:
 *   const generateUrls = useMutation(api.mutations.damage.generateMultipleUploadUrls);
 *
 *   const urls = await generateUrls({ count: 3 });
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
 *   // storageIds[0..2] — pass to bulkSubmitDamageReports
 */
export const generateMultipleUploadUrls = mutation({
  args: {
    /**
     * Number of upload URLs to generate.
     * Capped at 10 per call — use multiple calls for larger batches.
     */
    count: v.number(),
  },
  handler: async (ctx, args): Promise<Array<{ uploadUrl: string; index: number }>> => {
    await requireAuth(ctx);

    // Clamp to [1, 10] to enforce the reasonable per-call limit.
    const effectiveCount = Math.min(Math.max(1, Math.floor(args.count)), 10);

    const results: Array<{ uploadUrl: string; index: number }> = [];
    for (let i = 0; i < effectiveCount; i++) {
      const url = await ctx.storage.generateUploadUrl();
      results.push({ uploadUrl: url, index: i });
    }
    return results;
  },
});

// ─── submitDamageReport ───────────────────────────────────────────────────────

/**
 * Submit a single annotated damage photo report from the SCAN mobile app —
 * the primary damage report write mutation.
 *
 * This is the canonical, atomic damage report operation.  A single call writes
 * to up to four tables:
 *
 *   1. damage_reports  INSERT — primary annotated photo evidence row.
 *      Contains the file reference (photoStorageId), annotation pins, severity,
 *      optional manifest item link, and reporter attribution.
 *
 *   2. manifestItems   PATCH  — (when templateItemId provided) sets item status
 *      to "damaged" and appends the photoStorageId to the item's file references
 *      array.  Deduplicates to prevent duplicate file references.
 *
 *   3. events          INSERT — immutable "damage_reported" audit event for the
 *      T5 audit chain.  The event data payload mirrors all key damage report fields
 *      so the T5 panel can render the damage milestone without joining damage_reports.
 *
 *   4. cases           PATCH  — touches updatedAt so the M1 by_updated sort index
 *      and "N min ago" freshness label reflect recent damage activity.
 *
 * All writes happen in a single Convex serializable transaction.
 *
 * File reference (photoStorageId)
 * ────────────────────────────────
 * `photoStorageId` is the Convex file storage ID obtained by uploading a photo
 * to the URL from generateDamagePhotoUploadUrl().  It is stored in three places:
 *
 *   damage_reports.photoStorageId        — authoritative photo evidence record
 *   manifestItems.photoStorageIds[]       — per-item denormalized photo cache
 *   events.data.photoStorageId            — audit trail reference
 *
 * To resolve a file reference to a temporary display URL:
 *   ctx.storage.getUrl(photoStorageId)   (server-side, inside a query handler)
 *
 * Manifest item linking (optional)
 * ──────────────────────────────────
 * When `templateItemId` is provided, the mutation:
 *   • Finds the matching manifest item for this case via the by_case index
 *   • Sets its status to "damaged" (no-op if already "damaged")
 *   • Appends photoStorageId to its photoStorageIds array (deduplicated)
 *   • Stores the resolved manifestItemId in the damage_reports row
 *
 * When `templateItemId` is omitted, the photo is stored as a standalone
 * case-level photo not linked to a specific packing list item.  This supports
 * workflows where the technician photographs general case damage independently
 * of the item checklist (e.g., exterior case damage before opening the case).
 *
 * @param caseId         Convex ID of the case being documented.
 * @param photoStorageId File reference from the Convex storage upload step.
 * @param annotations    Optional annotation pins placed on the photo.
 * @param severity       Technician-assessed severity: "minor"|"moderate"|"severe".
 * @param reportedAt     Epoch ms when the photo was captured/submitted.
 * @param reportedById   Kinde user ID of the reporting technician.
 * @param reportedByName Display name of the reporting technician.
 * @param templateItemId Optional stable item ID to link this photo to a manifest item.
 * @param notes          Optional free-text notes entered alongside the photo.
 *
 * @returns DamageReportResult
 *
 * @throws "[AUTH_REQUIRED]" for unauthenticated requests.
 * @throws "[CASE_NOT_FOUND]" when caseId does not exist.
 * @throws "[ITEM_NOT_FOUND]" when templateItemId is provided but not found on the case.
 *
 * Client usage:
 *   const submit = useMutation(api.mutations.damage.submitDamageReport);
 *   const result = await submit({
 *     caseId:          resolvedCase._id,
 *     photoStorageId:  storageId,           // file reference from upload step
 *     annotations:     [
 *       { x: 0.4, y: 0.6, label: "crack",  color: "#e53e3e" },
 *       { x: 0.2, y: 0.3, label: "dent",   color: "#dd6b20" },
 *     ],
 *     severity:        "moderate",
 *     reportedAt:      Date.now(),
 *     reportedById:    kindeUser.id,
 *     reportedByName:  "Jane Pilot",
 *     templateItemId:  "item-drone-body",
 *     notes:           "Impact crack on port side housing",
 *   });
 */
export const submitDamageReport = mutation({
  args: {
    /**
     * Convex ID of the case being photographed.
     * The case must already exist — verified before any writes occur.
     */
    caseId: v.id("cases"),

    /**
     * Convex file storage ID for the uploaded damage photo.
     *
     * This is the primary file reference for this damage report.
     * Obtain it by:
     *   1. Calling generateDamagePhotoUploadUrl() to get a signed upload URL.
     *   2. POSTing the photo binary to that URL.
     *   3. Extracting `storageId` from the JSON response.
     *
     * Stored in:
     *   damage_reports.photoStorageId    — authoritative evidence
     *   manifestItems.photoStorageIds[]  — per-item cache (when item linked)
     *   events.data.photoStorageId       — audit trail reference
     */
    photoStorageId: v.string(),

    /**
     * Optional annotation pins placed on the photo by the technician in the
     * SCAN app markup tool.  Each pin specifies a relative position (0–1) and
     * a label string.  Stored verbatim in damage_reports.annotations.
     *
     * Example:
     *   [
     *     { x: 0.4, y: 0.6, label: "crack",      color: "#e53e3e" },
     *     { x: 0.2, y: 0.3, label: "impact dent", color: "#dd6b20" },
     *   ]
     */
    annotations: v.optional(v.array(annotationValidator)),

    /**
     * Damage severity assessed by the field technician.
     *
     * "minor"    — cosmetic only; does not affect equipment function
     * "moderate" — functional impact; review recommended before next deployment
     * "severe"   — equipment is unusable; requires immediate repair/replacement
     *
     * Drives badge colour in the T4 dashboard panel and SCAN app review screen.
     */
    severity: damageSeverityValidator,

    /**
     * Epoch ms when the photo was captured or submitted (client-side clock).
     *
     * Written to:
     *   damage_reports.reportedAt   — by_case_reported_at index field
     *   events.timestamp            — immutable audit trail timestamp
     *   cases.updatedAt             — M1 sort index freshness
     */
    reportedAt: v.number(),

    /**
     * Kinde user ID of the reporting technician.
     *
     * Written to:
     *   damage_reports.reportedById — reporter attribution
     *   events.userId               — audit event initiator
     */
    reportedById: v.string(),

    /**
     * Display name of the reporting technician.
     *
     * Written to:
     *   damage_reports.reportedByName — UI attribution (no user join needed)
     *   events.userName               — audit event attribution
     */
    reportedByName: v.string(),

    /**
     * Optional stable item identifier from the packing template.
     *
     * When provided, this mutation:
     *   1. Loads all manifest items for the case via the by_case index
     *   2. Finds the item whose templateItemId matches this value
     *   3. Sets its status to "damaged" (idempotent if already "damaged")
     *   4. Appends photoStorageId to its photoStorageIds array (deduplicated)
     *   5. Stores the resolved manifestItemId in the damage_reports row
     *
     * Omit for case-level (non-item-specific) damage photos.
     *
     * Must match a value in caseTemplates.items[].id for this case's template.
     */
    templateItemId: v.optional(v.string()),

    /**
     * Optional free-text notes entered by the technician alongside the photo.
     *
     * Written to damage_reports.notes.
     * When the manifest item already has notes, the new notes are appended
     * (separated by a newline) rather than overwriting — preserving context
     * from both the checklist workflow and the damage photo workflow.
     */
    notes: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<DamageReportResult> => {
    await requireAuth(ctx);
    const now = args.reportedAt;

    // ── Step 1: Verify the case exists ────────────────────────────────────────
    //
    // Performing this lookup before any writes ensures we fail fast without
    // leaving partial rows (e.g., a damage_reports row for a missing case).
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `[CASE_NOT_FOUND] submitDamageReport: Case "${args.caseId}" not found. ` +
        `Verify the caseId from the QR scan before calling submitDamageReport.`
      );
    }

    // ── Step 2: Resolve manifest item (when templateItemId provided) ──────────
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
        const availableIds = allItems.map((i) => i.templateItemId).join(", ");
        throw new Error(
          `[ITEM_NOT_FOUND] submitDamageReport: Manifest item with templateItemId ` +
          `"${args.templateItemId}" not found on case "${caseDoc.label}". ` +
          `Has a template been applied to this case? ` +
          `Available templateItemIds: [${availableIds}]`
        );
      }

      resolvedManifestItemIdStr = targetItem._id.toString();
      resolvedManifestItemDbId  = targetItem._id;

      // Append the photo file reference to the manifest item's photoStorageIds.
      // Deduplicate to prevent the same photo appearing twice if the mutation
      // is accidentally called with the same storageId.
      const existingPhotoIds = targetItem.photoStorageIds ?? [];
      const updatedPhotoIds = existingPhotoIds.includes(args.photoStorageId)
        ? existingPhotoIds
        : [...existingPhotoIds, args.photoStorageId];

      // Patch the manifest item:
      //   status:          "damaged" — drives M3 hasDamage filter + checklist progress
      //   photoStorageIds: [...]     — updated file references array
      //   checkedAt/By:              — attribution (only set on first damage report)
      await ctx.db.patch(targetItem._id, {
        status:          "damaged",
        photoStorageIds: updatedPhotoIds,
        // Preserve the original checker attribution if already set by the
        // checklist workflow — so we don't overwrite an earlier technician's claim.
        ...(targetItem.checkedAt === undefined
          ? {
              checkedAt:     now,
              checkedById:   args.reportedById,
              checkedByName: args.reportedByName,
            }
          : {}),
        // Merge notes: append new notes if item already has different notes.
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

    // ── Step 3: INSERT damage_reports row ─────────────────────────────────────
    //
    // This is the primary write that triggers getDamagePhotoReports and
    // getDamageReportsByCase subscriptions on the dashboard T4/T5 panels.
    //
    // The photoStorageId stored here is the authoritative file reference.
    // Clients resolve it to a temporary download URL via ctx.storage.getUrl().
    const damageReportId = await ctx.db.insert("damage_reports", {
      caseId:         args.caseId,
      photoStorageId: args.photoStorageId,  // ← primary file reference
      annotations:    args.annotations,
      severity:       args.severity,
      reportedAt:     now,
      manifestItemId: resolvedManifestItemDbId,  // null for case-level photos
      templateItemId: args.templateItemId,
      reportedById:   args.reportedById,
      reportedByName: args.reportedByName,
      notes:          args.notes,
    });

    // ── Step 4: INSERT immutable damage_reported audit event ──────────────────
    //
    // The events table is append-only — this row becomes the T5 audit chain
    // record for this damage submission.  getDamageReportsByCase uses
    // event.data.templateItemId to correlate damage events back to manifest
    // items without a secondary join to damage_reports.
    //
    // This INSERT invalidates:
    //   • getDamageReportEvents(caseId)      — by_case_timestamp index
    //   • getCaseAuditEvents(caseId)         — by_case index
    const eventId = await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "damage_reported",
      userId:    args.reportedById,
      userName:  args.reportedByName,
      timestamp: now,
      data: {
        // templateItemId is the correlation key — getDamageReportsByCase uses
        // this to join damage events back to their manifest item.
        templateItemId:  args.templateItemId,
        manifestItemId:  resolvedManifestItemIdStr,
        damageReportId:  damageReportId.toString(),
        // File reference included in the event payload for full audit fidelity
        photoStorageId:  args.photoStorageId,
        annotationCount: (args.annotations ?? []).length,
        severity:        args.severity,
        notes:           args.notes,
        source:          "scan_damage_report",
      },
    });

    // ── Step 5: Touch cases.updatedAt ─────────────────────────────────────────
    //
    // Ensures the M1 by_updated sort index reflects recent damage activity.
    // The INVENTORY dashboard's "Last updated N min ago" freshness label reads
    // cases.updatedAt directly from the cases row.
    await ctx.db.patch(args.caseId, { updatedAt: now });

    // ── Return typed result for SCAN app confirmation screen ──────────────────
    return {
      damageReportId: damageReportId.toString(),
      caseId:         args.caseId,
      manifestItemId: resolvedManifestItemIdStr,
      eventId:        eventId.toString(),
      photoStorageId: args.photoStorageId,  // ← confirm file reference stored
    };
  },
});

// ─── Bulk photo entry validator ───────────────────────────────────────────────

/**
 * Validator for a single photo entry in the `bulkSubmitDamageReports` input.
 *
 * Each entry represents one annotated photo submission.  The reporter
 * attribution and timestamp are shared across all photos in the bulk batch.
 */
const bulkPhotoEntryValidator = v.object({
  /**
   * Convex file storage ID (file reference) for this photo.
   * Obtained by uploading to one of the URLs from generateMultipleUploadUrls().
   */
  photoStorageId:  v.string(),

  /**
   * Optional annotation pins placed on this specific photo.
   * Each photo in the bulk set has its own independent annotation set.
   */
  annotations:     v.optional(v.array(annotationValidator)),

  /**
   * Damage severity assessed for this specific photo.
   * Each photo may document a different aspect of damage at its own severity.
   */
  severity:        damageSeverityValidator,

  /**
   * Optional stable template item identifier.
   * Multiple photos in the batch may link to the SAME item (multiple angles)
   * or to DIFFERENT items.
   */
  templateItemId:  v.optional(v.string()),

  /** Optional free-text notes specific to this photo. */
  notes:           v.optional(v.string()),
});

// ─── bulkSubmitDamageReports ──────────────────────────────────────────────────

/**
 * Submit multiple annotated damage photos for a case in a single atomic
 * Convex transaction — used for multi-angle or multi-item damage sessions.
 *
 * Use this when the SCAN app has collected several photos before submission
 * (e.g., two angles of a cracked battery housing + a dented case exterior).
 *
 * Atomicity guarantee:
 *   All photos are committed or none are — if any photo fails validation
 *   (e.g., invalid templateItemId), the ENTIRE batch is rejected before
 *   any rows are written.
 *
 * Pre-validation:
 *   All templateItemIds in the batch are validated against the manifest before
 *   any inserts begin.  This ensures a partial batch cannot be written.
 *
 * Batch manifest item patching:
 *   manifest items are patched ONCE per item after all damage_reports rows are
 *   inserted — avoiding multiple redundant patches to the same item when
 *   several photos reference it.
 *
 * @param caseId         Convex ID of the case for all photos in this batch.
 * @param photos         Array of 1–10 annotated photo submissions.
 * @param reportedAt     Shared epoch ms timestamp for all photos in the batch.
 * @param reportedById   Kinde user ID of the reporting technician.
 * @param reportedByName Display name of the reporting technician.
 *
 * @returns BulkDamageReportResult
 *
 * @throws "[AUTH_REQUIRED]" for unauthenticated requests.
 * @throws "[INVALID_INPUT]" when the photos array is empty.
 * @throws "[CASE_NOT_FOUND]" when caseId does not exist.
 * @throws "[ITEM_NOT_FOUND]" when any photo references an invalid templateItemId.
 *
 * Client usage:
 *   const bulkSubmit = useMutation(api.mutations.damage.bulkSubmitDamageReports);
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
 *         notes:          "Minor cosmetic dent on exterior",
 *       },
 *     ],
 *     reportedAt:     Date.now(),
 *     reportedById:   kindeUser.id,
 *     reportedByName: "Jane Pilot",
 *   });
 *   // result.totalSubmitted → 2
 *   // result.results[0].photoStorageId → storageIds[0] (confirmed file reference)
 */
export const bulkSubmitDamageReports = mutation({
  args: {
    /** Convex ID of the case for all photos in this batch. */
    caseId: v.id("cases"),

    /**
     * Array of annotated damage photo submissions.
     * Maximum 10 entries per call.  Each entry must include its own
     * photoStorageId (file reference) from the upload step.
     */
    photos: v.array(bulkPhotoEntryValidator),

    /**
     * Shared epoch ms timestamp for all photos in this batch.
     * Using a single timestamp ensures all photos appear as a coherent
     * inspection session in the T5 audit timeline.
     */
    reportedAt: v.number(),

    /** Kinde user ID of the reporting technician. */
    reportedById: v.string(),

    /** Display name of the reporting technician. */
    reportedByName: v.string(),
  },

  handler: async (ctx, args): Promise<BulkDamageReportResult> => {
    await requireAuth(ctx);

    // ── Input guard ───────────────────────────────────────────────────────────
    if (args.photos.length === 0) {
      throw new Error(
        "[INVALID_INPUT] bulkSubmitDamageReports: photos array must not be empty."
      );
    }

    // Enforce the per-call cap defensively.
    const effectivePhotos = args.photos.slice(0, 10);
    const now = args.reportedAt;

    // ── Step 1: Verify case exists ────────────────────────────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `[CASE_NOT_FOUND] bulkSubmitDamageReports: Case "${args.caseId}" not found.`
      );
    }

    // ── Step 2: Load all manifest items once (shared across all photos) ───────
    //
    // Loading once and building a Map avoids N separate by_case_item index reads.
    const allItems = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    const itemByTemplateId = new Map(
      allItems.map((item) => [item.templateItemId, item])
    );

    // ── Step 3: Pre-validate all templateItemIds upfront ─────────────────────
    //
    // Validate ALL photos before any writes so the batch is all-or-nothing.
    for (const photo of effectivePhotos) {
      if (
        photo.templateItemId !== undefined &&
        !itemByTemplateId.has(photo.templateItemId)
      ) {
        const availableIds = allItems.map((i) => i.templateItemId).join(", ");
        throw new Error(
          `[ITEM_NOT_FOUND] bulkSubmitDamageReports: Manifest item "${photo.templateItemId}" ` +
          `not found on case "${caseDoc.label}". ` +
          `Available templateItemIds: [${availableIds}]`
        );
      }
    }

    // Track new photo file references to append per item (batch-patch after inserts).
    const photoIdsToAddByItem = new Map<string, string[]>();

    // ── Step 4: INSERT damage_reports + events rows for each photo ────────────
    const results: DamageReportResult[] = [];

    for (const photo of effectivePhotos) {
      let resolvedManifestItemIdStr: string | undefined;
      let resolvedManifestItemDbId: Id<"manifestItems"> | undefined;

      if (photo.templateItemId !== undefined) {
        const item = itemByTemplateId.get(photo.templateItemId)!;
        resolvedManifestItemIdStr = item._id.toString();
        resolvedManifestItemDbId  = item._id;

        // Accumulate file references to append to this manifest item.
        const existing = photoIdsToAddByItem.get(photo.templateItemId) ?? [];
        if (!existing.includes(photo.photoStorageId)) {
          existing.push(photo.photoStorageId);
          photoIdsToAddByItem.set(photo.templateItemId, existing);
        }
      }

      // Insert the damage_reports row for this photo.
      const damageReportId = await ctx.db.insert("damage_reports", {
        caseId:         args.caseId,
        photoStorageId: photo.photoStorageId,  // ← file reference
        annotations:    photo.annotations,
        severity:       photo.severity,
        reportedAt:     now,
        manifestItemId: resolvedManifestItemDbId,
        templateItemId: photo.templateItemId,
        reportedById:   args.reportedById,
        reportedByName: args.reportedByName,
        notes:          photo.notes,
      });

      // Append the damage_reported audit event for this photo.
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
          photoStorageId:  photo.photoStorageId,  // ← file reference in audit
          annotationCount: (photo.annotations ?? []).length,
          severity:        photo.severity,
          notes:           photo.notes,
          bulkBatch:       true,  // flag for audit timeline display grouping
          source:          "scan_damage_report_bulk",
        },
      });

      results.push({
        damageReportId: damageReportId.toString(),
        caseId:         args.caseId,
        manifestItemId: resolvedManifestItemIdStr,
        eventId:        eventId.toString(),
        photoStorageId: photo.photoStorageId,
      });
    }

    // ── Step 5: Batch-patch manifest items (one patch per item) ──────────────
    //
    // Apply all accumulated photo file references in a single patch per item,
    // after all damage_reports rows have been inserted.  This avoids N separate
    // patches to the same item when multiple photos reference it.
    for (const [templateItemId, newPhotoIds] of photoIdsToAddByItem) {
      const item = itemByTemplateId.get(templateItemId);
      if (!item) continue;

      const existingPhotoIds = item.photoStorageIds ?? [];
      // Deduplicate: only add file references not already on the item.
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

    // ── Step 6: Touch cases.updatedAt ─────────────────────────────────────────
    await ctx.db.patch(args.caseId, { updatedAt: now });

    return {
      results,
      totalSubmitted: results.length,
      caseId:         args.caseId,
    };
  },
});

// ─── resolveDamageReport ──────────────────────────────────────────────────────

/**
 * Record that a previously reported damage item has been repaired or resolved.
 *
 * This is an admin / operations-team workflow.  After a damaged item has been
 * repaired, refurbished, or replaced, the ops team uses this mutation to log
 * the resolution in the immutable audit trail.
 *
 * Design note — immutability:
 *   This mutation does NOT modify the original `damage_reports` row (which is
 *   immutable evidence of the damage at the time of field inspection) nor does
 *   it change the manifest item status from "damaged" (which should remain
 *   until the case is returned and re-inspected via the checklist workflow).
 *
 *   Instead, a "note_added" event is appended to the immutable events table.
 *   The T5 audit chain displays both the original "damage_reported" event and
 *   the subsequent resolution event — giving auditors and ops teams a complete
 *   picture of the damage lifecycle.
 *
 * Tables written:
 *   events  INSERT — "note_added" resolution event with full resolution details
 *   cases   PATCH  — updatedAt touch
 *
 * @param caseId          Convex ID of the parent case.
 * @param damageReportId  Convex ID of the damage_reports row being resolved.
 * @param resolvedById    Kinde user ID of the resolver.
 * @param resolvedByName  Display name of the resolver.
 * @param resolvedAt      Epoch ms when the resolution was recorded.
 * @param resolutionNotes Required description of how the damage was resolved.
 *
 * @returns ResolveDamageReportResult
 *
 * @throws "[AUTH_REQUIRED]" for unauthenticated requests.
 * @throws "[REPORT_NOT_FOUND]" when the damage report does not exist.
 * @throws "[CASE_MISMATCH]" when the damage report belongs to a different case.
 *
 * Client usage:
 *   const resolve = useMutation(api.mutations.damage.resolveDamageReport);
 *   await resolve({
 *     caseId,
 *     damageReportId:   report.id,
 *     resolvedById:     kindeUser.id,
 *     resolvedByName:   "Sam Ops",
 *     resolvedAt:       Date.now(),
 *     resolutionNotes:  "Drone body replaced — new unit installed 2026-04-29",
 *   });
 */
export const resolveDamageReport = mutation({
  args: {
    /** Convex ID of the parent case. */
    caseId: v.id("cases"),

    /**
     * Convex ID of the `damage_reports` row being resolved.
     * Validated against the cases table to prevent cross-case updates.
     */
    damageReportId: v.id("damage_reports"),

    /** Kinde user ID of the person recording the resolution. */
    resolvedById: v.string(),

    /** Display name of the resolver (for T5 audit attribution). */
    resolvedByName: v.string(),

    /**
     * Epoch ms when the resolution was recorded.
     * Written as the audit event timestamp.
     */
    resolvedAt: v.number(),

    /**
     * Required description of how the damage was resolved.
     *
     * This is the primary human-readable record ops teams and auditors read to
     * understand the resolution action.  Examples:
     *   "Drone body replaced — new unit installed 2026-04-29"
     *   "Battery pack swap completed, original returned for disposal"
     *   "Cosmetic dent — assessed as non-functional, cleared for deployment"
     */
    resolutionNotes: v.string(),
  },

  handler: async (ctx, args): Promise<ResolveDamageReportResult> => {
    await requireAuth(ctx);
    const now = args.resolvedAt;

    // ── Verify the damage report exists ───────────────────────────────────────
    const reportDoc = await ctx.db.get(args.damageReportId);
    if (!reportDoc) {
      throw new Error(
        `[REPORT_NOT_FOUND] resolveDamageReport: Damage report "${args.damageReportId}" not found. ` +
        `Verify the damageReportId from the T4 panel before calling resolveDamageReport.`
      );
    }

    // ── Verify the report belongs to the given case ───────────────────────────
    //
    // Cross-case resolution attempts indicate a programming error or a
    // malicious request — reject immediately with a clear error.
    if (reportDoc.caseId.toString() !== args.caseId.toString()) {
      throw new Error(
        `[CASE_MISMATCH] resolveDamageReport: Damage report "${args.damageReportId}" ` +
        `belongs to case "${reportDoc.caseId}", not "${args.caseId}".`
      );
    }

    // ── INSERT resolution audit event (note_added) ────────────────────────────
    //
    // The damage_reports row itself is NOT modified — it is immutable evidence.
    // The resolution is recorded as a "note_added" event so the T5 panel can
    // display the full damage lifecycle: reported → resolved.
    //
    // The event data includes the original file reference (photoStorageId) so
    // the T5 panel can display the damage photo alongside the resolution note.
    const eventId = await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "note_added",
      userId:    args.resolvedById,
      userName:  args.resolvedByName,
      timestamp: now,
      data: {
        note:                args.resolutionNotes,
        subject:             "damage_resolution",
        // Link back to the original damage report for T5 correlation.
        damageReportId:      args.damageReportId.toString(),
        // Include the original file reference so T5 can show the photo.
        photoStorageId:      reportDoc.photoStorageId,
        templateItemId:      reportDoc.templateItemId,
        severity:            reportDoc.severity,
        originalReportedAt:  reportDoc.reportedAt,
        originalReportedById: reportDoc.reportedById,
        source:              "damage_resolution",
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
