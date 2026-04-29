/**
 * convex/mutations/checklist.ts
 *
 * Canonical mutation functions for SCAN app checklist write operations.
 *
 * This module provides the authoritative, atomic write operations for the SCAN
 * mobile app's packing list inspection workflow.  Each mutation writes to ALL
 * relevant tables in a single Convex transaction, ensuring consistency and
 * triggering the correct reactive query invalidations.
 *
 * Mutations exported
 * ──────────────────
 *   updateChecklistItem  — Full atomic checklist item update: patches the current
 *                          state in `manifestItems`, appends an immutable history
 *                          row to `checklist_updates`, syncs inspection aggregate
 *                          counters in `inspections`, and appends audit events to
 *                          `events`.
 *
 *   markItemOk           — Convenience wrapper: marks a single manifest item as
 *                          "ok" with minimal args.
 *
 *   markItemDamaged      — Convenience wrapper: marks a manifest item as "damaged"
 *                          with required damage-specific fields.
 *
 *   markItemMissing      — Convenience wrapper: marks a manifest item as "missing".
 *
 *   resetChecklistItem   — Reverts a manifest item to "unchecked" state.
 *                          Used by the SCAN app undo / re-inspect flow.
 *
 * Tables written per updateChecklistItem call
 * ───────────────────────────────────────────
 *   manifestItems        PATCH  — status, checkedAt, checkedById, notes, photos
 *   checklist_updates    INSERT — append-only immutable history row
 *   inspections          PATCH  — totalItems, checkedItems, damagedItems, missingItems
 *   events               INSERT — item_checked or damage_reported audit event
 *                         INSERT — photo_added event (when photos are provided)
 *
 * Reactive query invalidation
 * ───────────────────────────
 * Convex re-evaluates all subscribed queries reading the written tables and
 * pushes diffs to connected clients within ~100–300 ms.  A full
 * updateChecklistItem write invalidates:
 *
 *   From manifestItems PATCH:
 *     getChecklistByCase           → SCAN app checklist view, T2/T3 panels
 *     getChecklistItem             → per-item subscription in SCAN detail view
 *     getChecklistSummary          → T2/T3 progress bar and isComplete flag
 *     getChecklistItemsByStatus    → status-filtered dashboard views (T3/T4)
 *     getUncheckedItems            → SCAN remaining-items list
 *     getChecklistWithInspection   → SCAN combined inspection view
 *
 *   From checklist_updates INSERT:
 *     getChecklistUpdatesByCase    → T5 audit timeline / SCAN inspection review
 *     getChecklistUpdatesByCaseTime → time-windowed update history
 *     getChecklistUpdatesByItem    → per-item state history in T4/SCAN detail
 *     getChecklistUpdatesByUser    → SCAN "My Activity" technician history
 *     getItemUpdatesByStatus       → T4 damage panel live feed ("damaged" filter)
 *
 *   From inspections PATCH:
 *     getChecklistWithInspection   → SCAN inspection view counters
 *     M3 assembleM3                → map pin inspectionProgress / damagedItems
 *
 *   From events INSERT:
 *     getCaseAuditEvents           → T5 audit timeline
 *
 * All subscribed clients receive the live update within 2 seconds of the
 * mutation completing — satisfying the real_time_fidelity acceptance criterion.
 *
 * Checklist item status values
 * ────────────────────────────
 *   "unchecked"  — Default state after template apply; item not yet reviewed
 *   "ok"         — Item confirmed present and undamaged
 *   "damaged"    — Item present but has documented damage; requires damage fields
 *   "missing"    — Item could not be located during inspection
 *
 * Authentication
 * ──────────────
 * All mutations require a verified Kinde JWT.  Unauthenticated callers receive
 * [AUTH_REQUIRED].
 *
 * Client usage
 * ────────────
 * Prefer calling through typed hook wrappers in src/hooks/use-scan-mutations.ts:
 *
 *   const updateItem = useMutation(api.mutations.checklist.updateChecklistItem);
 *   const result = await updateItem({
 *     caseId:           caseDoc._id,
 *     templateItemId:   "item-battery-pack",
 *     newStatus:        "damaged",
 *     timestamp:        Date.now(),
 *     technicianId:     kindeUser.id,
 *     technicianName:   "Jane Pilot",
 *     notes:            "Cracked housing on B-side",
 *     photoStorageIds:  ["storage_abc123"],
 *     damageDescription: "Impact crack visible on battery housing",
 *     damageSeverity:   "moderate",
 *   });
 */

import { mutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { Auth, UserIdentity, GenericMutationCtx } from "convex/server";
import type { DataModel } from "../_generated/dataModel";
import { v } from "convex/values";

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Asserts that the calling client has a verified Kinde JWT.
 *
 * Throws with "[AUTH_REQUIRED]" prefix for unauthenticated requests.
 * Returns the UserIdentity so callers can access the subject claim.
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
 * Manifest item inspection state validator.
 * Mirrors the `manifestItemStatus` union in convex/schema.ts.
 */
const manifestItemStatusValidator = v.union(
  v.literal("unchecked"),
  v.literal("ok"),
  v.literal("damaged"),
  v.literal("missing"),
);

// ─── Return types ─────────────────────────────────────────────────────────────

/**
 * Inspection aggregate counters returned as part of UpdateChecklistItemResult.
 *
 * These are the exact counter values read by M3 assembleM3() to build
 * inspectionProgress on map pins.  Returning them in the mutation result lets
 * the SCAN app optimistically update its progress bar without a separate query.
 */
export interface InspectionCounters {
  /** Total number of manifest items in this case (template items count). */
  totalItems: number;
  /** Items that have been reviewed (status != "unchecked"). */
  checkedItems: number;
  /** Items with status = "damaged". */
  damagedItems: number;
  /** Items with status = "missing". */
  missingItems: number;
}

/**
 * Return value of all checklist mutation functions.
 *
 * Exported so client-side hooks can expose typed results.
 */
export interface UpdateChecklistItemResult {
  /**
   * Convex document ID of the manifest item that was updated.
   */
  itemId: string;

  /**
   * Convex document ID of the new `checklist_updates` history row.
   * Stored by the SCAN app for linking photos or follow-up queries.
   */
  updateId: string;

  /**
   * Convex document ID of the parent case.
   */
  caseId: string;

  /**
   * Item inspection state before this mutation ran.
   */
  previousStatus: string;

  /**
   * Item inspection state written by this mutation.
   */
  newStatus: string;

  /**
   * Recomputed inspection aggregate counters after this update.
   * Also written to the inspections table so M3 map pins reflect the change.
   */
  inspectionCounters: InspectionCounters;
}

// ─── Shared internal helpers ──────────────────────────────────────────────────

/**
 * Compute aggregate inspection counters from the full manifest items array.
 *
 * Applies the new status in-memory for the item that was just patched to get
 * post-patch counter values without a second DB read.
 *
 * @param allItems       All manifest items for the case (pre-patch snapshot)
 * @param templateItemId The item that was patched
 * @param newStatus      The new status applied to that item
 */
function computeCounters(
  allItems: Array<{ templateItemId: string; status: string }>,
  templateItemId: string,
  newStatus: string,
): InspectionCounters {
  let checkedItems = 0;
  let damagedItems = 0;
  let missingItems = 0;

  for (const i of allItems) {
    // Use new status for the patched item; pre-patch status for all others.
    const effectiveStatus =
      i.templateItemId === templateItemId ? newStatus : i.status;

    if (effectiveStatus !== "unchecked") checkedItems++;
    if (effectiveStatus === "damaged")   damagedItems++;
    if (effectiveStatus === "missing")   missingItems++;
  }

  return {
    totalItems: allItems.length,
    checkedItems,
    damagedItems,
    missingItems,
  };
}

/**
 * Resolve the active inspection ID for a case and sync its aggregate counters.
 *
 * Strategy:
 *   • When `hintInspectionId` is provided: O(1) direct get.
 *   • Otherwise: O(log n + |inspections|) index scan, pick latest by _creationTime.
 *
 * Patches the resolved inspection record with the provided counters.
 *
 * @returns The resolved inspection ID, or `undefined` when no inspection exists.
 */
async function syncInspectionCounters(
  ctx: GenericMutationCtx<DataModel>,
  caseId: Id<"cases">,
  hintInspectionId: Id<"inspections"> | undefined,
  counters: InspectionCounters,
): Promise<Id<"inspections"> | undefined> {
  let inspectionId: Id<"inspections"> | undefined;

  if (hintInspectionId !== undefined) {
    // O(1) direct get — caller already knows the active inspection ID.
    const ins = await ctx.db.get(hintInspectionId);
    if (ins) {
      inspectionId = ins._id;
    }
  } else {
    // Load all inspections for the case and pick the one most recently created.
    // Same strategy as maps.ts M3 assembler and convex/scan.ts.
    const rows = await ctx.db
      .query("inspections")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect();

    let latest: (typeof rows)[number] | null = null;
    for (const ins of rows) {
      if (!latest || ins._creationTime > latest._creationTime) {
        latest = ins;
      }
    }

    if (latest) {
      inspectionId = latest._id;
    }
  }

  // Sync the counter fields that M3 assembleM3() reads for map pin data.
  if (inspectionId !== undefined) {
    await ctx.db.patch(inspectionId, {
      totalItems:   counters.totalItems,
      checkedItems: counters.checkedItems,
      damagedItems: counters.damagedItems,
      missingItems: counters.missingItems,
    });
  }

  return inspectionId;
}

// ─── updateChecklistItem ──────────────────────────────────────────────────────

/**
 * Atomic checklist item update — the primary SCAN app mutation for inspection
 * progress.
 *
 * This is the canonical, atomic operation for recording that a field technician
 * has reviewed a packing list item.  A single call writes to up to five tables:
 *
 *   1. manifestItems     PATCH  — current state of this specific item
 *   2. checklist_updates INSERT — immutable history row for this state change
 *   3. inspections       PATCH  — aggregate counter sync (totalItems, checkedItems,
 *                                 damagedItems, missingItems) for M3 map data
 *   4. events            INSERT — item_checked or damage_reported audit event
 *   5. events            INSERT — photo_added event (when photos are provided)
 *
 * All writes happen in a single Convex serializable transaction.
 *
 * @param caseId            Convex document ID of the parent case.
 * @param templateItemId    Stable item identifier within the packing template.
 * @param newStatus         New inspection state for this item.
 * @param timestamp         Epoch ms of the update (client-side clock).
 * @param technicianId      Kinde user ID of the technician.
 * @param technicianName    Display name of the technician.
 * @param notes             Optional technician notes on this item.
 * @param photoStorageIds   Convex file storage IDs for damage photos.
 * @param damageDescription Structured damage description (for "damaged" updates).
 * @param damageSeverity    Severity: "minor" | "moderate" | "severe".
 * @param inspectionId      Optional active inspection ID this update belongs to.
 *
 * @returns UpdateChecklistItemResult
 *
 * @throws "[AUTH_REQUIRED]" for unauthenticated requests.
 * @throws "Manifest item '<templateItemId>' not found on case <caseId>."
 *
 * Client usage:
 *   const updateItem = useMutation(api.mutations.checklist.updateChecklistItem);
 *   const result = await updateItem({ caseId, templateItemId, newStatus, ... });
 */
export const updateChecklistItem = mutation({
  args: {
    /**
     * Convex ID of the case whose checklist is being updated.
     */
    caseId: v.id("cases"),

    /**
     * Stable item identifier within the packing template.
     *
     * Matches manifestItems.templateItemId and caseTemplates.items[].id.
     * This identifier is stable across template re-applications; the Convex
     * document ID of the manifestItems row is NOT stable.
     */
    templateItemId: v.string(),

    /**
     * New inspection state for this manifest item.
     *
     * Written to manifestItems.status — the field that drives:
     *   • M3 hasDamage filter on map pins
     *   • SCAN app checklist progress bar
     *   • T3 dashboard inspection detail panel
     *   • getChecklistItemsByStatus compound index queries
     *   • getUncheckedItems SCAN remaining-work list
     */
    newStatus: manifestItemStatusValidator,

    /**
     * Epoch ms when the technician marked this item (client-side clock).
     *
     * Written to manifestItems.checkedAt, checklist_updates.updatedAt,
     * and events.timestamp.
     */
    timestamp: v.number(),

    /**
     * Kinde user ID of the technician marking this item.
     *
     * Written to manifestItems.checkedById, checklist_updates.updatedBy,
     * and events.userId.
     */
    technicianId: v.string(),

    /**
     * Display name of the technician.
     *
     * Written to manifestItems.checkedByName, checklist_updates.updatedByName,
     * and events.userName.
     */
    technicianName: v.string(),

    /**
     * Optional technician notes about this item's condition.
     *
     * Written to manifestItems.notes and checklist_updates.notes.
     */
    notes: v.optional(v.string()),

    /**
     * Convex file storage IDs for photos of this item.
     *
     * Written to manifestItems.photoStorageIds and checklist_updates.photoStorageIds.
     * When non-empty, a secondary "photo_added" audit event is also appended.
     */
    photoStorageIds: v.optional(v.array(v.string())),

    /**
     * Structured damage description (only meaningful when newStatus = "damaged").
     *
     * Written to checklist_updates.damageDescription and events.data.description.
     */
    damageDescription: v.optional(v.string()),

    /**
     * Damage severity level (only meaningful when newStatus = "damaged").
     *
     * Written to checklist_updates.damageSeverity and events.data.severity.
     */
    damageSeverity: v.optional(
      v.union(v.literal("minor"), v.literal("moderate"), v.literal("severe"))
    ),

    /**
     * Optional Convex ID of the active inspection this update belongs to.
     *
     * When provided, used for O(1) inspection counter sync (direct get).
     * When omitted, falls back to finding the latest inspection via by_case index.
     */
    inspectionId: v.optional(v.id("inspections")),
  },

  handler: async (ctx, args): Promise<UpdateChecklistItemResult> => {
    // ── Auth guard ────────────────────────────────────────────────────────────
    await requireAuth(ctx);

    const now = args.timestamp;

    // ── Step 1: Load all manifest items for this case ─────────────────────────
    //
    // Load ALL items in one query to:
    //   a) Find the target item without a secondary lookup
    //   b) Recompute aggregate counters in-memory without a second DB read
    //
    // The by_case index makes this O(log n + |items for case|).
    const allItems = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    const item = allItems.find((i) => i.templateItemId === args.templateItemId);

    if (!item) {
      throw new Error(
        `updateChecklistItem: Manifest item "${args.templateItemId}" not found ` +
          `on case "${args.caseId}". ` +
          `Has a template been applied to this case? ` +
          `Verify the templateItemId matches a value in caseTemplates.items[].id.`
      );
    }

    const previousStatus = item.status;
    const newStatus      = args.newStatus;

    // ── Step 2: PATCH the manifest item (current state) ───────────────────────
    //
    // manifestItems holds the CURRENT state of each packing list item.
    // This PATCH invalidates all getChecklist* queries for this case.
    const itemPatch: Record<string, unknown> = {
      status:        newStatus,
      checkedAt:     now,
      checkedById:   args.technicianId,
      checkedByName: args.technicianName,
    };

    // Only write optional fields when provided to avoid clobbering existing data.
    if (args.notes           !== undefined) itemPatch.notes           = args.notes;
    if (args.photoStorageIds !== undefined) itemPatch.photoStorageIds = args.photoStorageIds;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(item._id, itemPatch as any);

    // ── Step 3: Recompute aggregate inspection counters in-memory ─────────────
    //
    // Apply the new status in-memory (post-patch simulation) for counter accuracy.
    const counters = computeCounters(allItems, args.templateItemId, newStatus);

    // ── Step 4: Sync the active inspection's aggregate counters ───────────────
    //
    // M3 assembleM3() reads these counter fields directly to build map pin data.
    // The syncInspectionCounters helper resolves the inspection ID and patches it.
    const resolvedInspectionId = await syncInspectionCounters(
      ctx,
      args.caseId,
      args.inspectionId,
      counters,
    );

    // ── Step 5: INSERT immutable checklist_updates history row ────────────────
    //
    // The checklist_updates table is append-only.  Each row captures a single
    // state change: from → to, by whom, when, with what evidence.
    //
    // This INSERT invalidates:
    //   getChecklistUpdatesByCase, getChecklistUpdatesByCaseTime,
    //   getChecklistUpdatesByItem, getChecklistUpdatesByUser,
    //   getItemUpdatesByStatus (critical for T4 damage panel live feed)
    const updateId = await ctx.db.insert("checklist_updates", {
      caseId:            args.caseId,
      manifestItemId:    item._id,
      templateItemId:    args.templateItemId,
      itemName:          item.name,
      previousStatus:    previousStatus,
      newStatus:         newStatus,
      updatedBy:         args.technicianId,
      updatedByName:     args.technicianName,
      updatedAt:         now,
      notes:             args.notes,
      photoStorageIds:   args.photoStorageIds,
      damageDescription: args.damageDescription,
      damageSeverity:    args.damageSeverity,
      inspectionId:      resolvedInspectionId,
    });

    // ── Step 6: INSERT primary audit event ────────────────────────────────────
    //
    // "damage_reported" for damaged items; "item_checked" for all other states.
    // The events table is append-only — rows are never updated or deleted.
    const primaryEventType =
      newStatus === "damaged" ? "damage_reported" : "item_checked";

    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: primaryEventType,
      userId:    args.technicianId,
      userName:  args.technicianName,
      timestamp: now,
      data: {
        templateItemId:    args.templateItemId,
        itemName:          item.name,
        manifestItemId:    item._id.toString(),
        checklistUpdateId: updateId.toString(),
        previousStatus,
        newStatus,
        notes:             args.notes,
        photoStorageIds:   args.photoStorageIds,
        description:       args.damageDescription,
        severity:          args.damageSeverity,
        source:            "scan_checklist",
      },
    });

    // ── Step 7: INSERT secondary photo_added event (conditional) ─────────────
    //
    // Logged separately so the T5 audit chain can surface photo upload activity
    // independently from the item status change event.
    if (args.photoStorageIds && args.photoStorageIds.length > 0) {
      await ctx.db.insert("events", {
        caseId:    args.caseId,
        eventType: "photo_added",
        userId:    args.technicianId,
        userName:  args.technicianName,
        timestamp: now,
        data: {
          templateItemId:    args.templateItemId,
          itemName:          item.name,
          manifestItemId:    item._id.toString(),
          checklistUpdateId: updateId.toString(),
          photoStorageIds:   args.photoStorageIds,
          photoCount:        args.photoStorageIds.length,
          newStatus,
          source:            "scan_checklist",
        },
      });
    }

    // ── Return typed result ───────────────────────────────────────────────────
    return {
      itemId:   item._id.toString(),
      updateId: updateId.toString(),
      caseId:   args.caseId,
      previousStatus,
      newStatus,
      inspectionCounters: counters,
    };
  },
});

// ─── markItemOk ──────────────────────────────────────────────────────────────

/**
 * Mark a manifest item as "ok" — confirmed present and undamaged.
 *
 * Convenience wrapper around `updateChecklistItem` with `newStatus` fixed to
 * `"ok"`.  The SCAN app uses this for the most common action: confirming an
 * item is present and in good condition.
 *
 * Writes to: manifestItems (PATCH), checklist_updates (INSERT),
 *            inspections (PATCH), events (INSERT).
 *
 * @param caseId           Convex document ID of the parent case.
 * @param templateItemId   Stable item identifier within the packing template.
 * @param timestamp        Epoch ms of the update.
 * @param technicianId     Kinde user ID of the technician.
 * @param technicianName   Display name of the technician.
 * @param notes            Optional technician notes.
 * @param inspectionId     Optional active inspection ID.
 *
 * @returns UpdateChecklistItemResult (same shape as updateChecklistItem).
 *
 * Client usage:
 *   const markOk = useMutation(api.mutations.checklist.markItemOk);
 *   await markOk({
 *     caseId,
 *     templateItemId: "item-battery-pack",
 *     timestamp:      Date.now(),
 *     technicianId:   kindeUser.id,
 *     technicianName: "Jane Pilot",
 *   });
 */
export const markItemOk = mutation({
  args: {
    caseId:         v.id("cases"),
    templateItemId: v.string(),
    timestamp:      v.number(),
    technicianId:   v.string(),
    technicianName: v.string(),
    notes:          v.optional(v.string()),
    inspectionId:   v.optional(v.id("inspections")),
  },

  handler: async (ctx, args): Promise<UpdateChecklistItemResult> => {
    await requireAuth(ctx);

    const now        = args.timestamp;
    const newStatus  = "ok" as const;

    const allItems = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    const item = allItems.find((i) => i.templateItemId === args.templateItemId);
    if (!item) {
      throw new Error(
        `markItemOk: Manifest item "${args.templateItemId}" not found on case "${args.caseId}".`
      );
    }

    const previousStatus = item.status;

    // Patch current state
    const patch: Record<string, unknown> = {
      status: newStatus, checkedAt: now,
      checkedById: args.technicianId, checkedByName: args.technicianName,
    };
    if (args.notes !== undefined) patch.notes = args.notes;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(item._id, patch as any);

    const counters = computeCounters(allItems, args.templateItemId, newStatus);
    const resolvedInspectionId = await syncInspectionCounters(
      ctx, args.caseId, args.inspectionId, counters,
    );

    const updateId = await ctx.db.insert("checklist_updates", {
      caseId:         args.caseId,  manifestItemId: item._id,
      templateItemId: args.templateItemId, itemName: item.name,
      previousStatus, newStatus,
      updatedBy:      args.technicianId,  updatedByName: args.technicianName,
      updatedAt:      now, notes: args.notes,
      inspectionId:   resolvedInspectionId,
    });

    await ctx.db.insert("events", {
      caseId: args.caseId, eventType: "item_checked",
      userId: args.technicianId, userName: args.technicianName, timestamp: now,
      data: {
        templateItemId: args.templateItemId, itemName: item.name,
        previousStatus, newStatus, notes: args.notes, source: "scan_checklist",
      },
    });

    return {
      itemId: item._id.toString(), updateId: updateId.toString(),
      caseId: args.caseId, previousStatus, newStatus, inspectionCounters: counters,
    };
  },
});

// ─── markItemDamaged ─────────────────────────────────────────────────────────

/**
 * Mark a manifest item as "damaged" with required damage evidence fields.
 *
 * Convenience wrapper around `updateChecklistItem` with `newStatus` fixed to
 * `"damaged"`.  `damageDescription` and `damageSeverity` are required (unlike
 * the generic `updateChecklistItem` where they are optional) to ensure damage
 * reports have complete evidence metadata.
 *
 * Writes to: manifestItems (PATCH), checklist_updates (INSERT),
 *            inspections (PATCH), events (INSERT x1 or x2 with photos).
 *
 * @param caseId            Convex document ID of the parent case.
 * @param templateItemId    Stable item identifier within the packing template.
 * @param timestamp         Epoch ms of the update.
 * @param technicianId      Kinde user ID of the technician.
 * @param technicianName    Display name of the technician.
 * @param damageDescription Required description of the damage observed.
 * @param damageSeverity    Required severity: "minor" | "moderate" | "severe".
 * @param notes             Optional additional technician notes.
 * @param photoStorageIds   Optional Convex file storage IDs for damage photos.
 * @param inspectionId      Optional active inspection ID.
 *
 * @returns UpdateChecklistItemResult
 *
 * Client usage:
 *   const markDamaged = useMutation(api.mutations.checklist.markItemDamaged);
 *   await markDamaged({
 *     caseId,
 *     templateItemId:    "item-battery-pack",
 *     timestamp:         Date.now(),
 *     technicianId:      kindeUser.id,
 *     technicianName:    "Jane Pilot",
 *     damageDescription: "Impact crack on housing near connector port",
 *     damageSeverity:    "moderate",
 *     photoStorageIds:   ["storage_abc123"],
 *   });
 */
export const markItemDamaged = mutation({
  args: {
    caseId:            v.id("cases"),
    templateItemId:    v.string(),
    timestamp:         v.number(),
    technicianId:      v.string(),
    technicianName:    v.string(),
    /** Required plain-text description of the damage observed. */
    damageDescription: v.string(),
    /** Required severity classification. */
    damageSeverity:    v.union(
      v.literal("minor"), v.literal("moderate"), v.literal("severe"),
    ),
    notes:             v.optional(v.string()),
    photoStorageIds:   v.optional(v.array(v.string())),
    inspectionId:      v.optional(v.id("inspections")),
  },

  handler: async (ctx, args): Promise<UpdateChecklistItemResult> => {
    await requireAuth(ctx);

    const now       = args.timestamp;
    const newStatus = "damaged" as const;

    const allItems = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    const item = allItems.find((i) => i.templateItemId === args.templateItemId);
    if (!item) {
      throw new Error(
        `markItemDamaged: Manifest item "${args.templateItemId}" not found on case "${args.caseId}".`
      );
    }

    const previousStatus = item.status;

    // Patch current state
    const patch: Record<string, unknown> = {
      status: newStatus, checkedAt: now,
      checkedById: args.technicianId, checkedByName: args.technicianName,
    };
    if (args.notes           !== undefined) patch.notes           = args.notes;
    if (args.photoStorageIds !== undefined) patch.photoStorageIds = args.photoStorageIds;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(item._id, patch as any);

    const counters = computeCounters(allItems, args.templateItemId, newStatus);
    const resolvedInspectionId = await syncInspectionCounters(
      ctx, args.caseId, args.inspectionId, counters,
    );

    const updateId = await ctx.db.insert("checklist_updates", {
      caseId:            args.caseId,  manifestItemId: item._id,
      templateItemId:    args.templateItemId, itemName: item.name,
      previousStatus,    newStatus,
      updatedBy:         args.technicianId,  updatedByName: args.technicianName,
      updatedAt:         now, notes: args.notes,
      photoStorageIds:   args.photoStorageIds,
      damageDescription: args.damageDescription,
      damageSeverity:    args.damageSeverity,
      inspectionId:      resolvedInspectionId,
    });

    // Primary "damage_reported" audit event
    await ctx.db.insert("events", {
      caseId: args.caseId, eventType: "damage_reported",
      userId: args.technicianId, userName: args.technicianName, timestamp: now,
      data: {
        templateItemId:    args.templateItemId,
        itemName:          item.name,
        manifestItemId:    item._id.toString(),
        checklistUpdateId: updateId.toString(),
        previousStatus,
        newStatus,
        notes:             args.notes,
        description:       args.damageDescription,
        severity:          args.damageSeverity,
        photoStorageIds:   args.photoStorageIds,
        source:            "scan_checklist",
      },
    });

    // Secondary "photo_added" event when photos are attached
    if (args.photoStorageIds && args.photoStorageIds.length > 0) {
      await ctx.db.insert("events", {
        caseId: args.caseId, eventType: "photo_added",
        userId: args.technicianId, userName: args.technicianName, timestamp: now,
        data: {
          templateItemId:    args.templateItemId,
          itemName:          item.name,
          manifestItemId:    item._id.toString(),
          checklistUpdateId: updateId.toString(),
          photoStorageIds:   args.photoStorageIds,
          photoCount:        args.photoStorageIds.length,
          newStatus,
          source:            "scan_checklist",
        },
      });
    }

    return {
      itemId: item._id.toString(), updateId: updateId.toString(),
      caseId: args.caseId, previousStatus, newStatus, inspectionCounters: counters,
    };
  },
});

// ─── markItemMissing ─────────────────────────────────────────────────────────

/**
 * Mark a manifest item as "missing" — not found during inspection.
 *
 * Convenience wrapper around `updateChecklistItem` with `newStatus` fixed to
 * `"missing"`.  Records that the technician searched for the item and could not
 * locate it in the case.
 *
 * Writes to: manifestItems (PATCH), checklist_updates (INSERT),
 *            inspections (PATCH), events (INSERT).
 *
 * @param caseId           Convex document ID of the parent case.
 * @param templateItemId   Stable item identifier within the packing template.
 * @param timestamp        Epoch ms of the update.
 * @param technicianId     Kinde user ID of the technician.
 * @param technicianName   Display name of the technician.
 * @param notes            Optional notes (e.g., "last seen at Site B").
 * @param inspectionId     Optional active inspection ID.
 *
 * @returns UpdateChecklistItemResult
 *
 * Client usage:
 *   const markMissing = useMutation(api.mutations.checklist.markItemMissing);
 *   await markMissing({
 *     caseId,
 *     templateItemId: "item-battery-pack",
 *     timestamp:      Date.now(),
 *     technicianId:   kindeUser.id,
 *     technicianName: "Jane Pilot",
 *     notes:          "Last seen at turbine T-42 — may have been left at site",
 *   });
 */
export const markItemMissing = mutation({
  args: {
    caseId:         v.id("cases"),
    templateItemId: v.string(),
    timestamp:      v.number(),
    technicianId:   v.string(),
    technicianName: v.string(),
    notes:          v.optional(v.string()),
    inspectionId:   v.optional(v.id("inspections")),
  },

  handler: async (ctx, args): Promise<UpdateChecklistItemResult> => {
    await requireAuth(ctx);

    const now       = args.timestamp;
    const newStatus = "missing" as const;

    const allItems = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    const item = allItems.find((i) => i.templateItemId === args.templateItemId);
    if (!item) {
      throw new Error(
        `markItemMissing: Manifest item "${args.templateItemId}" not found on case "${args.caseId}".`
      );
    }

    const previousStatus = item.status;

    const patch: Record<string, unknown> = {
      status: newStatus, checkedAt: now,
      checkedById: args.technicianId, checkedByName: args.technicianName,
    };
    if (args.notes !== undefined) patch.notes = args.notes;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(item._id, patch as any);

    const counters = computeCounters(allItems, args.templateItemId, newStatus);
    const resolvedInspectionId = await syncInspectionCounters(
      ctx, args.caseId, args.inspectionId, counters,
    );

    const updateId = await ctx.db.insert("checklist_updates", {
      caseId:         args.caseId,  manifestItemId: item._id,
      templateItemId: args.templateItemId, itemName: item.name,
      previousStatus, newStatus,
      updatedBy:      args.technicianId,  updatedByName: args.technicianName,
      updatedAt:      now, notes: args.notes,
      inspectionId:   resolvedInspectionId,
    });

    await ctx.db.insert("events", {
      caseId: args.caseId, eventType: "item_checked",
      userId: args.technicianId, userName: args.technicianName, timestamp: now,
      data: {
        templateItemId: args.templateItemId, itemName: item.name,
        previousStatus, newStatus, notes: args.notes, source: "scan_checklist",
      },
    });

    return {
      itemId: item._id.toString(), updateId: updateId.toString(),
      caseId: args.caseId, previousStatus, newStatus, inspectionCounters: counters,
    };
  },
});

// ─── resetChecklistItem ───────────────────────────────────────────────────────

/**
 * Reset a manifest item to "unchecked" state — undo a previous check-in.
 *
 * Used by the SCAN app undo / re-inspect flow when a technician wants to
 * re-review an item they previously marked as ok, damaged, or missing.
 *
 * Resetting to "unchecked" still appends a history row to `checklist_updates`
 * (preserving the undo action in the audit trail) and updates inspection counters.
 *
 * Note: The existing notes and photos on the manifest item are preserved.
 * The technician can update or clear them on the next check-in.  The check-in
 * metadata (checkedAt, checkedById, checkedByName) is cleared.
 *
 * Writes to: manifestItems (PATCH), checklist_updates (INSERT),
 *            inspections (PATCH), events (INSERT).
 *
 * @param caseId           Convex document ID of the parent case.
 * @param templateItemId   Stable item identifier within the packing template.
 * @param timestamp        Epoch ms of the reset action.
 * @param technicianId     Kinde user ID of the technician performing the reset.
 * @param technicianName   Display name of the technician.
 * @param notes            Optional notes explaining why the item was reset.
 * @param inspectionId     Optional active inspection ID.
 *
 * @returns UpdateChecklistItemResult with newStatus = "unchecked".
 *
 * Client usage:
 *   const resetItem = useMutation(api.mutations.checklist.resetChecklistItem);
 *   await resetItem({
 *     caseId,
 *     templateItemId: "item-battery-pack",
 *     timestamp:      Date.now(),
 *     technicianId:   kindeUser.id,
 *     technicianName: "Jane Pilot",
 *     notes:          "Re-checking after case was repacked at turbine site",
 *   });
 */
export const resetChecklistItem = mutation({
  args: {
    caseId:         v.id("cases"),
    templateItemId: v.string(),
    timestamp:      v.number(),
    technicianId:   v.string(),
    technicianName: v.string(),
    notes:          v.optional(v.string()),
    inspectionId:   v.optional(v.id("inspections")),
  },

  handler: async (ctx, args): Promise<UpdateChecklistItemResult> => {
    await requireAuth(ctx);

    const now       = args.timestamp;
    const newStatus = "unchecked" as const;

    const allItems = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    const item = allItems.find((i) => i.templateItemId === args.templateItemId);
    if (!item) {
      throw new Error(
        `resetChecklistItem: Manifest item "${args.templateItemId}" not found on case "${args.caseId}".`
      );
    }

    const previousStatus = item.status;

    // Patch: reset to unchecked, clear check-in metadata.
    // Preserve existing notes/photos — the technician will update them on re-check.
    await ctx.db.patch(item._id, {
      status:        newStatus,
      // Clear the check-in timestamp and attribution.
      // Convex interprets undefined in patch as "remove this field".
      checkedAt:     undefined,
      checkedById:   undefined,
      checkedByName: undefined,
    });

    const counters = computeCounters(allItems, args.templateItemId, newStatus);
    const resolvedInspectionId = await syncInspectionCounters(
      ctx, args.caseId, args.inspectionId, counters,
    );

    // Append a history row even for resets — the audit trail records the undo action.
    const updateId = await ctx.db.insert("checklist_updates", {
      caseId:         args.caseId,  manifestItemId: item._id,
      templateItemId: args.templateItemId, itemName: item.name,
      previousStatus, newStatus,
      updatedBy:      args.technicianId,  updatedByName: args.technicianName,
      updatedAt:      now, notes: args.notes,
      inspectionId:   resolvedInspectionId,
    });

    // "item_checked" event with action = "reset_to_unchecked" for audit clarity.
    await ctx.db.insert("events", {
      caseId: args.caseId, eventType: "item_checked",
      userId: args.technicianId, userName: args.technicianName, timestamp: now,
      data: {
        templateItemId: args.templateItemId, itemName: item.name,
        previousStatus, newStatus, notes: args.notes,
        action: "reset_to_unchecked", source: "scan_checklist",
      },
    });

    return {
      itemId: item._id.toString(), updateId: updateId.toString(),
      caseId: args.caseId, previousStatus, newStatus, inspectionCounters: counters,
    };
  },
});

// ─── submitInspection (Sub-AC 350102/2) ───────────────────────────────────────
//
// The canonical "inspect action" mutation: writes an entire batch of item
// checklist results to the shared inspection tables in a single atomic Convex
// transaction.  This is the multi-item counterpart to updateChecklistItem and is
// the mutation invoked by the SCAN mobile app's "Submit Inspection" / batch
// review flow when a technician has reviewed multiple items at once and taps
// the "Submit" CTA on the checklist screen.
//
// Why a batch mutation
// ────────────────────
// Calling updateChecklistItem N times sequentially issues N round-trips, N
// separate Convex transactions, and N separate inspection-counter syncs.  A
// single submitInspection call:
//   • Atomically applies all item updates inside one Convex transaction —
//     either every item is written or none are (all-or-nothing semantics).
//   • Recomputes the inspection aggregate counters ONCE after applying all
//     updates in-memory.
//   • Patches the active inspections row ONCE with the final counters and
//     optionally with the inspection's lifecycle status.
//   • Emits exactly one inspection_progress audit event capturing the batch
//     context, plus per-item item_checked / damage_reported / photo_added
//     events for the immutable audit trail.
//
// Tables written
// ──────────────
//   manifestItems        PATCH  ×N — current state of every item in the batch
//   checklist_updates    INSERT ×N — append-only history rows (one per item)
//   inspections          PATCH  ×1 — totalItems, checkedItems, damagedItems,
//                                    missingItems, optional status update
//   events               INSERT ×1 — inspection_progress batch event
//                        INSERT ×N — item_checked / damage_reported per item
//                        INSERT ×K — photo_added per item that has photos
//   cases                PATCH  ×1 — updatedAt touch (M1 by_updated index)
//
// Reactive query invalidation
// ───────────────────────────
// Convex re-evaluates all subscribed queries reading the written tables and
// pushes diffs to connected clients within ~100–300 ms.  A single
// submitInspection call invalidates the same query set as N individual
// updateChecklistItem calls but with a single coalesced server-side push.
//
// Pre-validation (all-or-nothing)
// ───────────────────────────────
// All templateItemIds in the batch are validated against the case's manifest
// BEFORE any patches or inserts begin.  If any single item is invalid the
// entire batch is rejected with no partial writes.
//
// Inspection lifecycle
// ────────────────────
// `markInspectionComplete: true` transitions the inspections row in the same
// transaction:
//   • completed — when no items in the batch (or already-stored state) are
//                 damaged or missing.
//   • flagged   — when any item is damaged or missing (M3 byInspectionStatus
//                 surfaces this for dashboard review).
// The inspections.completedAt field is populated when this flag is set.

/**
 * One item result entry inside a submitInspection batch.
 *
 * Each entry mirrors the per-item arguments accepted by updateChecklistItem,
 * minus the shared technician / timestamp / case fields which are passed once
 * at the batch level.
 */
export interface InspectItemResult {
  /** Stable template item identifier (matches caseTemplates.items[].id). */
  templateItemId: string;
  /** New inspection state for this item. */
  newStatus: "unchecked" | "ok" | "damaged" | "missing";
  /** Optional technician notes for this specific item. */
  notes?: string;
  /** Optional Convex storage IDs for photos attached to this item. */
  photoStorageIds?: string[];
  /** Damage description (only meaningful when newStatus === "damaged"). */
  damageDescription?: string;
  /** Damage severity (only meaningful when newStatus === "damaged"). */
  damageSeverity?: "minor" | "moderate" | "severe";
}

/** Per-item result returned by submitInspection. */
export interface SubmittedInspectionItemResult {
  /** Convex document ID of the manifest item that was patched. */
  itemId: string;
  /** Convex document ID of the checklist_updates history row. */
  updateId: string;
  /** Stable template item identifier echoed from input. */
  templateItemId: string;
  /** Item state before this submission. */
  previousStatus: string;
  /** Item state after this submission. */
  newStatus: string;
}

/**
 * Aggregate result returned by submitInspection.
 */
export interface SubmitInspectionResult {
  /** Convex document ID of the parent case. */
  caseId: string;
  /**
   * Resolved Convex document ID of the active inspection that received the
   * counter sync, or undefined when the case has no inspection record yet.
   */
  inspectionId: string | undefined;
  /**
   * Final inspection lifecycle status after the batch was applied.
   * One of "in_progress" | "completed" | "flagged" — matches inspections.status.
   * undefined when no inspection was patched.
   */
  inspectionStatus: string | undefined;
  /** Per-item summary for every entry in the input batch (in input order). */
  items: SubmittedInspectionItemResult[];
  /** Recomputed aggregate counters after all batch items were applied. */
  inspectionCounters: InspectionCounters;
  /** Number of items written by this batch (== args.items.length). */
  itemsWritten: number;
}

/**
 * submitInspection — atomic multi-item "inspect action" mutation.
 *
 * Records the result of a SCAN app inspection pass: a batch of one-or-more
 * manifest item state changes plus an optional transition of the active
 * inspection record to "completed" or "flagged".
 *
 * All writes happen in one Convex serializable transaction.  All-or-nothing
 * semantics are enforced — pre-validation rejects the entire batch if any
 * templateItemId in `items` is not present on the case's manifest.
 *
 * @param caseId               Convex ID of the case being inspected.
 * @param items                Non-empty array of per-item results (≤ 200 entries).
 * @param timestamp            Epoch ms — applied to every item update + event.
 * @param technicianId         Kinde user ID of the inspecting technician.
 * @param technicianName       Display name of the technician.
 * @param inspectionId         Optional active inspection ID for O(1) sync.
 * @param markInspectionComplete When true, transition the inspection record to
 *                               "completed" (or "flagged" if any items are
 *                               damaged/missing) and stamp completedAt.
 * @param batchNotes           Optional notes describing the batch context
 *                               (e.g. "Pre-shipment inspection at hangar 3").
 *
 * @returns SubmitInspectionResult — full per-item summary plus aggregate counters.
 *
 * @throws "[AUTH_REQUIRED]"               Unauthenticated request.
 * @throws "submitInspection: Empty batch."  When args.items.length === 0.
 * @throws "submitInspection: Batch too large." When args.items.length > 200.
 * @throws "submitInspection: Manifest item '<id>' not found on case <caseId>."
 *
 * Client usage:
 *   const submit = useMutation(api.mutations.checklist.submitInspection);
 *   const result = await submit({
 *     caseId,
 *     items: [
 *       { templateItemId: "item-batt-1",  newStatus: "ok" },
 *       { templateItemId: "item-batt-2",  newStatus: "damaged",
 *         damageDescription: "Cracked housing", damageSeverity: "moderate",
 *         photoStorageIds: ["storage_xyz"] },
 *       { templateItemId: "item-cable-1", newStatus: "missing",
 *         notes: "Last seen at turbine T-42" },
 *     ],
 *     timestamp:      Date.now(),
 *     technicianId:   kindeUser.id,
 *     technicianName: "Jane Pilot",
 *     markInspectionComplete: true,
 *   });
 */
export const submitInspection = mutation({
  args: {
    /** Convex ID of the case being inspected. */
    caseId: v.id("cases"),

    /**
     * Non-empty array of per-item inspection results.
     *
     * Every templateItemId must match an existing manifestItems row for this
     * case; the entire batch is rejected at validation time if any entry is
     * unresolvable.  Capped at 200 entries per call — cases with larger
     * manifests should split into multiple submitInspection calls.
     */
    items: v.array(
      v.object({
        templateItemId:    v.string(),
        newStatus:         manifestItemStatusValidator,
        notes:             v.optional(v.string()),
        photoStorageIds:   v.optional(v.array(v.string())),
        damageDescription: v.optional(v.string()),
        damageSeverity:    v.optional(
          v.union(
            v.literal("minor"),
            v.literal("moderate"),
            v.literal("severe"),
          ),
        ),
      }),
    ),

    /**
     * Epoch ms when the technician submitted the batch.
     * Applied uniformly to every manifestItem.checkedAt, every
     * checklist_updates.updatedAt, every event.timestamp, and to
     * inspections.completedAt when markInspectionComplete is true.
     */
    timestamp: v.number(),

    /** Kinde user ID of the technician who performed the inspection. */
    technicianId: v.string(),

    /** Display name of the technician. */
    technicianName: v.string(),

    /**
     * Optional Convex ID of the active inspection this batch belongs to.
     * When provided, used for O(1) inspection counter sync (direct get).
     * When omitted, falls back to finding the latest inspection via by_case index.
     */
    inspectionId: v.optional(v.id("inspections")),

    /**
     * When true, transition the inspection record's status field at the end of
     * the transaction:
     *   • damagedItems > 0 || missingItems > 0  → "flagged"
     *   • otherwise                             → "completed"
     * inspections.completedAt is also stamped with `timestamp`.
     *
     * When false (or omitted), the inspection's lifecycle status is left
     * unchanged — only the aggregate counter fields are synced.
     */
    markInspectionComplete: v.optional(v.boolean()),

    /**
     * Optional batch-level notes attached to the inspection_progress audit event.
     * Useful for capturing context that applies to the entire submission, e.g.
     * "Pre-shipment inspection at hangar 3 before transit_out".
     */
    batchNotes: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<SubmitInspectionResult> => {
    // ── Auth guard ────────────────────────────────────────────────────────────
    await requireAuth(ctx);

    // ── Argument validation ───────────────────────────────────────────────────
    if (args.items.length === 0) {
      throw new Error(
        "submitInspection: Empty batch. " +
          "Provide at least one item result, or call updateChecklistItem for single-item updates.",
      );
    }
    if (args.items.length > 200) {
      throw new Error(
        `submitInspection: Batch too large (${args.items.length} items). ` +
          "Maximum supported batch size is 200. Split into multiple calls for larger manifests.",
      );
    }
    // Reject duplicate templateItemIds in a single batch — accidental double
    // entries would cause inconsistent in-memory counter recomputation.
    const seen = new Set<string>();
    for (const entry of args.items) {
      if (seen.has(entry.templateItemId)) {
        throw new Error(
          `submitInspection: Duplicate templateItemId "${entry.templateItemId}" in batch. ` +
            "Each item may only appear once per submission.",
        );
      }
      seen.add(entry.templateItemId);
    }

    const now = args.timestamp;

    // ── Step 1: Load all manifest items for the case ──────────────────────────
    //
    // Single by_case index seek loads every manifest row for this case in
    // O(log n + |items|) — used both for pre-validation and for in-memory
    // counter recomputation after the batch is applied.
    const allItems = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    // Build a fast lookup by templateItemId so each batch entry resolves in O(1).
    const itemsByTemplateId = new Map(
      allItems.map((row) => [row.templateItemId, row]),
    );

    // ── Step 2: Pre-validate ALL batch entries before any writes ──────────────
    //
    // All-or-nothing semantics: if any single templateItemId is unresolvable on
    // the case's manifest, throw before any patch / insert occurs.  Convex
    // automatically rolls back any partial mutation state on a thrown error,
    // but pre-validation gives the caller a clearer error message AND avoids
    // unnecessary work in the common "valid batch" path.
    for (const entry of args.items) {
      if (!itemsByTemplateId.has(entry.templateItemId)) {
        throw new Error(
          `submitInspection: Manifest item "${entry.templateItemId}" not found ` +
            `on case "${args.caseId}". ` +
            `Has a template been applied? Verify the templateItemId matches a value ` +
            `in caseTemplates.items[].id for this case.`,
        );
      }
    }

    // ── Step 3: Apply per-item PATCH + history INSERT for every entry ─────────
    //
    // Track previousStatus/newStatus mappings for in-memory counter recompute
    // and for the per-item return value.
    const perItemResults: SubmittedInspectionItemResult[] = [];
    // Map of templateItemId → newStatus, used by the in-memory counter
    // recomputation pass below.  Allows reusing computeCounters semantics with
    // O(|allItems|) work and no second DB read.
    const newStatusByTemplateId = new Map<string, string>();
    // Track the Convex IDs of every inserted checklist_updates row so we can
    // backfill inspectionId in Step 6 if it wasn't known at insert time.
    const insertedUpdateIds: Id<"checklist_updates">[] = [];

    for (const entry of args.items) {
      const item = itemsByTemplateId.get(entry.templateItemId)!;
      const previousStatus = item.status;
      const newStatus      = entry.newStatus;

      // 3a — PATCH manifestItems: current state of this item
      const itemPatch: Record<string, unknown> = {
        status:        newStatus,
        checkedAt:     now,
        checkedById:   args.technicianId,
        checkedByName: args.technicianName,
      };
      if (entry.notes           !== undefined) itemPatch.notes           = entry.notes;
      if (entry.photoStorageIds !== undefined) itemPatch.photoStorageIds = entry.photoStorageIds;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ctx.db.patch(item._id, itemPatch as any);

      // Record for counter recompute
      newStatusByTemplateId.set(entry.templateItemId, newStatus);

      // 3b — INSERT checklist_updates (immutable history row)
      const updateId = await ctx.db.insert("checklist_updates", {
        caseId:            args.caseId,
        manifestItemId:    item._id,
        templateItemId:    entry.templateItemId,
        itemName:          item.name,
        previousStatus:    previousStatus,
        newStatus:         newStatus,
        updatedBy:         args.technicianId,
        updatedByName:     args.technicianName,
        updatedAt:         now,
        notes:             entry.notes,
        photoStorageIds:   entry.photoStorageIds,
        damageDescription: entry.damageDescription,
        damageSeverity:    entry.damageSeverity,
        // inspectionId is patched in Step 6 once the active inspection is resolved
        inspectionId:      args.inspectionId,
      });
      insertedUpdateIds.push(updateId);

      perItemResults.push({
        itemId:         item._id.toString(),
        updateId:       updateId.toString(),
        templateItemId: entry.templateItemId,
        previousStatus,
        newStatus,
      });
    }

    // ── Step 4: Recompute aggregate inspection counters once ──────────────────
    //
    // After all manifestItems patches in Step 3, the in-memory `allItems`
    // snapshot still reflects the PRE-patch status field.  We compute final
    // counters by overlaying the new statuses from `newStatusByTemplateId`.
    let checkedItems = 0;
    let damagedItems = 0;
    let missingItems = 0;
    for (const i of allItems) {
      const effectiveStatus =
        newStatusByTemplateId.get(i.templateItemId) ?? i.status;
      if (effectiveStatus !== "unchecked") checkedItems++;
      if (effectiveStatus === "damaged")   damagedItems++;
      if (effectiveStatus === "missing")   missingItems++;
    }
    const counters: InspectionCounters = {
      totalItems: allItems.length,
      checkedItems,
      damagedItems,
      missingItems,
    };

    // ── Step 5: Resolve and patch the active inspection record ────────────────
    //
    // syncInspectionCounters writes totalItems / checkedItems / damagedItems /
    // missingItems on the resolved inspection row — the same fields the M3
    // assembleM3() map assembler reads to build inspectionProgress on map pins.
    const resolvedInspectionId = await syncInspectionCounters(
      ctx,
      args.caseId,
      args.inspectionId,
      counters,
    );

    // Determine the inspection's lifecycle status field.  Returned to the
    // caller for accurate optimistic UI; patched when markInspectionComplete is set.
    let finalInspectionStatus: string | undefined;
    if (resolvedInspectionId !== undefined) {
      const insRow = await ctx.db.get(resolvedInspectionId);
      finalInspectionStatus = insRow?.status;

      if (args.markInspectionComplete) {
        const targetStatus: "completed" | "flagged" =
          counters.damagedItems > 0 || counters.missingItems > 0
            ? "flagged"
            : "completed";
        await ctx.db.patch(resolvedInspectionId, {
          status:      targetStatus,
          completedAt: now,
        });
        finalInspectionStatus = targetStatus;
      }
    }

    // ── Step 6: Backfill inspectionId on every checklist_updates row ──────────
    //
    // When the caller did NOT pass an inspectionId hint, Step 3b above wrote
    // each row with inspectionId === undefined.  Now that we've resolved the
    // active inspection, patch each history row so per-item history queries
    // (getChecklistUpdatesByItem, getItemUpdatesByStatus) can correlate updates
    // with their inspection pass.
    if (resolvedInspectionId !== undefined && args.inspectionId === undefined) {
      for (const updateId of insertedUpdateIds) {
        await ctx.db.patch(updateId, { inspectionId: resolvedInspectionId });
      }
    }

    // ── Step 7: INSERT batch-level audit event ────────────────────────────────
    //
    // A single rolled-up event captures the batch context — useful for the T5
    // audit timeline to display a single "Inspection: N items reviewed" entry
    // alongside the per-item rows.  Use "inspection_completed" when the batch
    // transitioned the inspection, "item_checked" otherwise.  The data payload
    // carries the full batch info either way.
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: args.markInspectionComplete
        ? "inspection_completed"
        : "item_checked",
      userId:    args.technicianId,
      userName:  args.technicianName,
      timestamp: now,
      data: {
        batch:               true,
        source:              "scan_inspection_batch",
        inspectionId:        resolvedInspectionId,
        itemsWritten:        perItemResults.length,
        finalStatus:         finalInspectionStatus,
        counters,
        notes:               args.batchNotes,
        // Per-item summary so a single audit row reveals the full submission.
        items: perItemResults.map((r) => ({
          templateItemId:    r.templateItemId,
          previousStatus:    r.previousStatus,
          newStatus:         r.newStatus,
          checklistUpdateId: r.updateId,
          manifestItemId:    r.itemId,
        })),
      },
    });

    // ── Step 8: INSERT per-item audit events ──────────────────────────────────
    //
    // The T5 audit chain still expects per-item events for fine-grained replay
    // and per-item filtering.  Damaged items get damage_reported; everything
    // else gets item_checked.  Photos add a secondary photo_added event.
    for (let idx = 0; idx < args.items.length; idx++) {
      const entry  = args.items[idx];
      const result = perItemResults[idx];
      const item   = itemsByTemplateId.get(entry.templateItemId)!;

      const primaryEventType =
        entry.newStatus === "damaged" ? "damage_reported" : "item_checked";

      await ctx.db.insert("events", {
        caseId:    args.caseId,
        eventType: primaryEventType,
        userId:    args.technicianId,
        userName:  args.technicianName,
        timestamp: now,
        data: {
          templateItemId:    entry.templateItemId,
          itemName:          item.name,
          manifestItemId:    item._id.toString(),
          checklistUpdateId: result.updateId,
          previousStatus:    result.previousStatus,
          newStatus:         result.newStatus,
          notes:             entry.notes,
          photoStorageIds:   entry.photoStorageIds,
          description:       entry.damageDescription,
          severity:          entry.damageSeverity,
          source:            "scan_inspection_batch",
          batch:             true,
          inspectionId:      resolvedInspectionId,
        },
      });

      if (entry.photoStorageIds && entry.photoStorageIds.length > 0) {
        await ctx.db.insert("events", {
          caseId:    args.caseId,
          eventType: "photo_added",
          userId:    args.technicianId,
          userName:  args.technicianName,
          timestamp: now,
          data: {
            templateItemId:    entry.templateItemId,
            itemName:          item.name,
            manifestItemId:    item._id.toString(),
            checklistUpdateId: result.updateId,
            photoStorageIds:   entry.photoStorageIds,
            photoCount:        entry.photoStorageIds.length,
            newStatus:         entry.newStatus,
            source:            "scan_inspection_batch",
            batch:             true,
            inspectionId:      resolvedInspectionId,
          },
        });
      }
    }

    // ── Step 9: Touch cases.updatedAt so M1 by_updated reflects activity ──────
    //
    // Even when the case status itself is unchanged, an inspection submission
    // is meaningful "recent activity" for the M1 sort order and the dashboard's
    // "Updated N min ago" freshness display.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(args.caseId, { updatedAt: now } as any);

    // ── Return typed result ───────────────────────────────────────────────────
    return {
      caseId:           args.caseId,
      inspectionId:     resolvedInspectionId?.toString(),
      inspectionStatus: finalInspectionStatus,
      items:            perItemResults,
      inspectionCounters: counters,
      itemsWritten:     perItemResults.length,
    };
  },
});
