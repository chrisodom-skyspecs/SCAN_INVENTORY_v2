/**
 * convex/scan.ts
 *
 * Public mutation functions for the SCAN mobile app.
 *
 * Exports
 * ───────
 *   scanCheckIn          — QR code decoded → update case status, position,
 *                          assignee; create inspection if entering in_field
 *   updateChecklistItem  — Technician marks a manifest item ok/damaged/missing;
 *                          syncs inspection aggregate counters for M3 map data
 *   startInspection      — Explicitly open an inspection for an in_field case
 *                          (called when no scanCheckIn transition created one)
 *   completeInspection   — Mark an inspection completed once all items reviewed
 *
 * Field-shape contract for M1–M5 map query compatibility
 * ──────────────────────────────────────────────────────
 * The map queries in convex/maps.ts filter and sort on specific case fields.
 * Every mutation here must write the correct field names so the queries
 * immediately reflect the change via Convex's reactive subscription engine:
 *
 *   cases.status       → M1 status filter (assembleM1 filters.status[])
 *                        M3 field filter (assembleM3 status in_field|deployed)
 *                        M5 heatmap weight (statusWeights map)
 *                        M2 status filter (assembleM2 filters.status[])
 *
 *   cases.assigneeId   → M1 assigneeId filter (assembleM1 filters.assigneeId)
 *                        M3 assigneeId filter (assembleM3 filters.assigneeId)
 *
 *   cases.missionId    → M1 missionId filter (assembleM1 filters.missionId)
 *                        M2 mission grouping  (casesByMission map)
 *                        M3 missionId filter  (assembleM3 filters.missionId)
 *
 *   cases.lat / .lng   → M1/M2/M3/M5 withinBounds() check
 *                        M4 current/destination position for withinBounds
 *
 *   cases.updatedAt    → M1 sort order (by_updated index used in listCases)
 *
 *   inspections.totalItems   → M3 pin inspectionProgress calculation
 *   inspections.checkedItems → M3 pin inspectionProgress + summary counts
 *   inspections.damagedItems → M3 pin summary + totalDamaged counter
 *   inspections.missingItems → M3 pin summary + totalMissing counter
 *
 * Real-time fidelity
 * ──────────────────
 * Convex re-evaluates every subscribed query that reads a row touched by a
 * mutation and pushes the diff to all connected clients within ~100–300 ms.
 * Writing to cases and inspections means M1–M5 map pins update automatically
 * — no polling, no manual refetch, satisfying the ≤ 2-second requirement.
 *
 * Client usage
 * ────────────
 * Use the companion hooks in src/hooks/use-scan-mutations.ts:
 *   const checkIn         = useScanCheckIn();
 *   const updateItem      = useUpdateChecklistItem();
 *   const startInsp       = useStartInspection();
 *   const completeInsp    = useCompleteInspection();
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";

// ─── Shared value validators ──────────────────────────────────────────────────

/**
 * Case lifecycle status validator.
 * Mirrors caseStatus in convex/schema.ts — defined here so mutation args can
 * reference it without importing the schema directly.
 */
const caseStatusValidator = v.union(
  v.literal("assembled"),
  v.literal("deployed"),
  v.literal("in_field"),
  v.literal("shipping"),
  v.literal("returned"),
);

/**
 * Manifest item inspection state validator.
 * Mirrors manifestItemStatus in convex/schema.ts.
 */
const manifestItemStatusValidator = v.union(
  v.literal("unchecked"),
  v.literal("ok"),
  v.literal("damaged"),
  v.literal("missing"),
);

// ─── Status transition guard ──────────────────────────────────────────────────

/**
 * Valid outbound transitions per source status.
 *
 * Enforces the lifecycle constraint: "Case status transitions follow valid
 * paths" (data integrity evaluation principle).  The SCAN app will only offer
 * the allowed target statuses in the UI, but we also guard server-side.
 *
 * Allowed transitions:
 *   assembled  → deployed | in_field | shipping
 *   deployed   → in_field | shipping | returned | assembled  (repack)
 *   in_field   → deployed | shipping | returned
 *   shipping   → returned
 *   returned   → assembled | deployed
 *
 * A "no-op" transition (same status) is always allowed — it just records a
 * check-in event without changing the status value.
 */
const VALID_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  assembled: new Set(["deployed", "in_field", "shipping"]),
  deployed:  new Set(["in_field", "shipping", "returned", "assembled"]),
  in_field:  new Set(["deployed", "shipping", "returned"]),
  shipping:  new Set(["returned"]),
  returned:  new Set(["assembled", "deployed"]),
};

// ─── Return types ─────────────────────────────────────────────────────────────

/**
 * Return value of scanCheckIn.
 * Exported so the client-side hook can expose a typed result.
 */
export interface ScanCheckInResult {
  /** The case that was checked in. */
  caseId: string;
  /** Status before this mutation ran. */
  previousStatus: string;
  /** Status written by this mutation. */
  newStatus: string;
  /**
   * ID of the inspection record created when transitioning to "in_field".
   * Undefined when no new inspection was created (status unchanged, or
   * transitioning to a non-inspection status).
   */
  inspectionId: string | undefined;
}

/**
 * Return value of updateChecklistItem.
 */
export interface UpdateChecklistItemResult {
  /** The manifest item that was updated. */
  itemId: string;
  /** Status before this update. */
  previousStatus: string;
  /** Status written by this update. */
  newStatus: string;
  /**
   * Recomputed inspection aggregate counters after this update.
   * These values are also written to the inspections table so M3
   * map pins reflect the change immediately.
   */
  inspectionCounters: {
    totalItems:   number;
    checkedItems: number;
    damagedItems: number;
    missingItems: number;
  };
}

/**
 * Return value of startInspection and completeInspection.
 */
export interface InspectionResult {
  inspectionId: string;
  caseId: string;
  status: string;
}

// ─── scanCheckIn ─────────────────────────────────────────────────────────────

/**
 * QR scan check-in — the primary mutation triggered by the SCAN mobile app.
 *
 * Workflow: technician scans a QR code → camera decodes the payload →
 * app resolves the case via getCaseByQrCode query → calls this mutation.
 *
 * What this mutation writes (and why it matters for M1–M5):
 * ┌──────────────────┬───────────────────────────────────────────────────────┐
 * │ Field written    │ Map mode effect                                       │
 * ├──────────────────┼───────────────────────────────────────────────────────┤
 * │ cases.status     │ M1 status pill colour; M2/M3 status filter;           │
 * │                  │ M5 heatmap weight (in_field=1.0, deployed=0.7, …)     │
 * │ cases.assigneeId │ M1/M3 assigneeId filter (show "my cases" view)        │
 * │ cases.lat / .lng │ All modes: withinBounds() viewport clipping           │
 * │ cases.updatedAt  │ M1 sort order; "updated N min ago" display            │
 * └──────────────────┴───────────────────────────────────────────────────────┘
 *
 * Inspection creation (M3 data source):
 *   When the case transitions to "in_field" and was NOT already in_field,
 *   this mutation creates a new inspection record with the initial item counts.
 *   The inspection row is what M3 reads for checkedItems / damagedItems /
 *   missingItems / inspectionProgress on map pins.
 *
 * Audit trail:
 *   Always appends a status_change event (when status differs) and an
 *   inspection_started event (when inspection is created) to the immutable
 *   events table.
 *
 * @param caseId        Convex document ID of the case being scanned.
 * @param status        Target lifecycle status set by this check-in.
 * @param timestamp     Epoch ms — written to cases.updatedAt and events.timestamp.
 * @param technicianId  Kinde user ID → written to cases.assigneeId.
 * @param technicianName Display name → written to cases.assigneeName.
 * @param lat           Optional GPS latitude → written to cases.lat.
 * @param lng           Optional GPS longitude → written to cases.lng.
 * @param locationName  Human-readable location → written to cases.locationName.
 * @param notes         Optional free-text notes → written to cases.notes.
 *
 * @throws When the case is not found.
 * @throws When the requested status transition is not in VALID_TRANSITIONS.
 *
 * Client usage (via hook):
 *   const checkIn = useScanCheckIn();
 *   await checkIn({
 *     caseId:        resolvedCase._id,
 *     status:        "in_field",
 *     timestamp:     Date.now(),
 *     technicianId:  kindeUser.id,
 *     technicianName: kindeUser.given_name + " " + kindeUser.family_name,
 *     lat:           position.coords.latitude,
 *     lng:           position.coords.longitude,
 *   });
 */
export const scanCheckIn = mutation({
  args: {
    /** Convex ID of the case to check in. */
    caseId:         v.id("cases"),

    /**
     * Target case lifecycle status.
     * Written to cases.status — the field M1–M5 queries filter/sort on.
     */
    status:         caseStatusValidator,

    /**
     * Epoch ms timestamp of the scan action.
     * Written to cases.updatedAt (M1 sort index) and events.timestamp.
     */
    timestamp:      v.number(),

    /**
     * Kinde user ID of the scanning technician.
     * Written to cases.assigneeId — the field M1/M3 assigneeId filter uses.
     */
    technicianId:   v.string(),

    /**
     * Display name of the technician.
     * Written to cases.assigneeName for map pin tooltips and dashboard display.
     */
    technicianName: v.string(),

    /**
     * GPS latitude of the scan location.
     * Written to cases.lat — used by all map modes' withinBounds() check.
     */
    lat:            v.optional(v.number()),

    /**
     * GPS longitude of the scan location.
     * Written to cases.lng — used by all map modes' withinBounds() check.
     */
    lng:            v.optional(v.number()),

    /**
     * Human-readable location name (e.g. "Site Alpha — Turbine Row 3").
     * Written to cases.locationName for map pin tooltips.
     */
    locationName:   v.optional(v.string()),

    /** Optional technician notes appended to the case. */
    notes:          v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<ScanCheckInResult> => {
    const now = args.timestamp;

    // ── Verify case exists ────────────────────────────────────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(`Case ${args.caseId} not found.`);
    }

    const fromStatus = caseDoc.status;
    const toStatus   = args.status;

    // ── Guard status transition ───────────────────────────────────────────────
    if (fromStatus !== toStatus) {
      const allowed = VALID_TRANSITIONS[fromStatus];
      if (allowed && !allowed.has(toStatus)) {
        throw new Error(
          `Invalid status transition: ${fromStatus} → ${toStatus}. ` +
          `Allowed transitions from "${fromStatus}": ${[...allowed].join(", ")}.`
        );
      }
    }

    // ── Build case patch ──────────────────────────────────────────────────────
    // These are the exact fields read by M1–M5 assemblers and the listCases
    // query used by the dashboard. Writing them atomically in one ctx.db.patch
    // ensures the reactive subscriptions get a single consistent update.
    //
    //   cases.status      → M1 status pill, M2/M3 status filter, M5 weight
    //   cases.assigneeId  → M1/M3 assigneeId filter
    //   cases.lat / .lng  → All modes withinBounds()
    //   cases.updatedAt   → by_updated index, listCases order, "N min ago" UI
    const casePatch: Record<string, unknown> = {
      status:       toStatus,
      assigneeId:   args.technicianId,
      assigneeName: args.technicianName,
      updatedAt:    now,
    };

    // Conditionally overwrite position fields — only update if provided.
    // This preserves the last known position when the device has no GPS fix.
    if (args.lat          !== undefined) casePatch.lat          = args.lat;
    if (args.lng          !== undefined) casePatch.lng          = args.lng;
    if (args.locationName !== undefined) casePatch.locationName = args.locationName;
    if (args.notes        !== undefined) casePatch.notes        = args.notes;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(args.caseId, casePatch as any);

    // ── Record status_change event (immutable audit) ──────────────────────────
    // The events table is append-only — no deletes or updates.
    if (fromStatus !== toStatus) {
      await ctx.db.insert("events", {
        caseId:    args.caseId,
        eventType: "status_change",
        userId:    args.technicianId,
        userName:  args.technicianName,
        timestamp: now,
        data: {
          from:     fromStatus,
          to:       toStatus,
          lat:      args.lat,
          lng:      args.lng,
          location: args.locationName,
          notes:    args.notes,
        },
      });
    }

    // ── Create inspection when entering in_field ──────────────────────────────
    // M3 (Field Mode) reads from the inspections table for:
    //   • inspectionProgress (checkedItems / totalItems)
    //   • damagedItems / missingItems counters on map pins
    //   • byInspectionStatus aggregate for summary
    //
    // We only create a NEW inspection on the in_field entry transition.
    // Subsequent check-ins while already in_field update the case but do not
    // reset the in-progress inspection.
    let inspectionId: string | undefined;

    if (toStatus === "in_field" && fromStatus !== "in_field") {
      // Count existing manifest items for accurate initial inspection totals.
      // Using the by_case index — O(log n + |items|), same as getChecklistByCase.
      const manifestItems = await ctx.db
        .query("manifestItems")
        .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
        .collect();

      const totalItems    = manifestItems.length;
      // Items that have been reviewed in a previous inspection pass (if any)
      const checkedItems  = manifestItems.filter(
        (i) => i.status !== "unchecked"
      ).length;
      const damagedItems  = manifestItems.filter(
        (i) => i.status === "damaged"
      ).length;
      const missingItems  = manifestItems.filter(
        (i) => i.status === "missing"
      ).length;

      const newId = await ctx.db.insert("inspections", {
        caseId:        args.caseId,
        inspectorId:   args.technicianId,
        inspectorName: args.technicianName,
        status:        "in_progress",
        startedAt:     now,
        // Aggregate counters — the exact fields M3 assembleM3() reads
        totalItems,
        checkedItems,
        damagedItems,
        missingItems,
        notes:         args.notes,
      });

      inspectionId = newId.toString();

      // Audit event for the inspection start
      await ctx.db.insert("events", {
        caseId:    args.caseId,
        eventType: "inspection_started",
        userId:    args.technicianId,
        userName:  args.technicianName,
        timestamp: now,
        data: {
          inspectionId,
          totalItems,
          checkedItems,
          damagedItems,
          missingItems,
        },
      });
    }

    return {
      caseId:         args.caseId,
      previousStatus: fromStatus,
      newStatus:      toStatus,
      inspectionId,
    };
  },
});

// ─── updateChecklistItem ──────────────────────────────────────────────────────

/**
 * Update a single manifest item's inspection state.
 *
 * Called by the SCAN app when a technician works through the packing list
 * and marks each item as ok, damaged, missing, or reverts to unchecked.
 *
 * What this mutation writes (and why it matters for M3):
 * ┌──────────────────────────────┬───────────────────────────────────────────┐
 * │ Field written                │ M3 map effect                             │
 * ├──────────────────────────────┼───────────────────────────────────────────┤
 * │ manifestItems.status         │ M3 hasDamage filter, checklist UI state   │
 * │ manifestItems.checkedAt      │ "last checked" timestamp in SCAN UI       │
 * │ manifestItems.checkedById    │ Technician attribution                    │
 * │ inspections.checkedItems     │ M3 inspectionProgress = checked/total     │
 * │ inspections.damagedItems     │ M3 pin damage indicator + summary         │
 * │ inspections.missingItems     │ M3 pin missing indicator + summary        │
 * │ inspections.totalItems       │ M3 inspectionProgress denominator         │
 * └──────────────────────────────┴───────────────────────────────────────────┘
 *
 * Inspection counter sync strategy:
 *   After patching the manifest item row, this mutation re-counts all items
 *   in memory (using the already-loaded allItems array with the new status
 *   applied) and writes the updated counters to the latest inspection record.
 *   This avoids a second DB round-trip and keeps M3 counters accurate.
 *
 * Audit trail:
 *   • "damage_reported" event when status = "damaged"
 *   • "item_checked" event for ok / missing / unchecked
 *   • "photo_added" event when photoStorageIds are provided
 *
 * @param caseId           Convex document ID of the parent case.
 * @param templateItemId   Stable item identifier within the packing template.
 * @param status           New inspection state for this item.
 * @param timestamp        Epoch ms — written to checkedAt and event timestamp.
 * @param technicianId     Kinde user ID → written to checkedById.
 * @param technicianName   Display name → written to checkedByName.
 * @param notes            Optional free-text notes on this item.
 * @param photoStorageIds  Convex file storage IDs for damage photos.
 * @param damageDescription Structured damage description (damage events only).
 * @param damageSeverity    Severity level: "minor" | "moderate" | "severe".
 *
 * @throws When the manifest item is not found on the case.
 *
 * Client usage (via hook):
 *   const updateItem = useUpdateChecklistItem();
 *   await updateItem({
 *     caseId:        caseDoc._id,
 *     templateItemId: "item-battery-pack",
 *     status:        "damaged",
 *     timestamp:     Date.now(),
 *     technicianId:  kindeUser.id,
 *     technicianName: "Jane Pilot",
 *     notes:         "Cracked housing on B-side",
 *     damageDescription: "Impact crack visible on battery housing",
 *     damageSeverity: "moderate",
 *   });
 */
export const updateChecklistItem = mutation({
  args: {
    /** Convex ID of the case whose checklist is being updated. */
    caseId:           v.id("cases"),

    /**
     * Stable item identifier within the packing template.
     * Matches manifestItems.templateItemId and caseTemplates.items[].id.
     */
    templateItemId:   v.string(),

    /**
     * New inspection state for this item.
     * Written to manifestItems.status — the field that drives M3 hasDamage
     * filter and the checklist progress bar in the SCAN app.
     */
    status:           manifestItemStatusValidator,

    /**
     * Epoch ms when the technician made this update.
     * Written to manifestItems.checkedAt and events.timestamp.
     */
    timestamp:        v.number(),

    /**
     * Kinde user ID of the technician.
     * Written to manifestItems.checkedById for attribution.
     */
    technicianId:     v.string(),

    /**
     * Display name of the technician.
     * Written to manifestItems.checkedByName.
     */
    technicianName:   v.string(),

    /** Optional technician notes on this specific item. */
    notes:            v.optional(v.string()),

    /**
     * Optional Convex file storage IDs for photos of this item.
     * When provided alongside status = "damaged", triggers a photo_added
     * audit event in addition to the damage_reported event.
     */
    photoStorageIds:  v.optional(v.array(v.string())),

    /**
     * Structured damage description (only meaningful when status = "damaged").
     * Written into the damage_reported event payload so the T4 dashboard panel
     * can display detailed damage info without a separate DB join.
     */
    damageDescription: v.optional(v.string()),

    /**
     * Damage severity level (only meaningful when status = "damaged").
     * Typical values: "minor" | "moderate" | "severe"
     * Free-form string — the SCAN app UI enforces the enum client-side.
     */
    damageSeverity:   v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<UpdateChecklistItemResult> => {
    const now = args.timestamp;

    // ── Load all manifest items for this case (by_case index) ─────────────────
    // We load all items in one query for two reasons:
    //   1. Find the target item without a full-table scan (index on caseId).
    //   2. Recount aggregate counters in-memory — no second DB query needed.
    const allItems = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    const item = allItems.find(
      (i) => i.templateItemId === args.templateItemId
    );

    if (!item) {
      throw new Error(
        `Manifest item "${args.templateItemId}" not found on case ${args.caseId}. ` +
        `Has a template been applied to this case?`
      );
    }

    const previousStatus = item.status;
    const newStatus      = args.status;

    // ── Patch the manifest item ───────────────────────────────────────────────
    // Only write provided optional fields to avoid overwriting previous values
    // (e.g., keep existing photos if no new photos are submitted).
    const itemPatch: Record<string, unknown> = {
      status:        newStatus,
      checkedAt:     now,
      checkedById:   args.technicianId,
      checkedByName: args.technicianName,
    };

    if (args.notes           !== undefined) itemPatch.notes           = args.notes;
    if (args.photoStorageIds !== undefined) itemPatch.photoStorageIds = args.photoStorageIds;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(item._id, itemPatch as any);

    // ── Recompute aggregate inspection counters ───────────────────────────────
    // Apply the new status in-memory to avoid a second DB read.
    // This is accurate because allItems was loaded at the same logical timestamp
    // as the patch (mutations run in a single serializable transaction).
    //
    // These counter values are written to inspections table below — M3 reads
    // them directly for map pin progress bars and summary stats.
    let checkedItems = 0;
    let damagedItems = 0;
    let missingItems = 0;

    for (const i of allItems) {
      // For the item we just patched, use the new status; for all others, use
      // the status from the pre-patch load (unchanged in this transaction).
      const effectiveStatus =
        i.templateItemId === args.templateItemId ? newStatus : i.status;

      if (effectiveStatus !== "unchecked") checkedItems++;
      if (effectiveStatus === "damaged")   damagedItems++;
      if (effectiveStatus === "missing")   missingItems++;
    }

    const totalItems = allItems.length;

    // ── Sync the active inspection's aggregate counters ───────────────────────
    // Find the latest inspection for this case (same strategy as maps.ts M3).
    // The fields written here (totalItems, checkedItems, damagedItems,
    // missingItems) are the EXACT fields read by assembleM3() to build
    // M3CasePin objects — this write is what makes the M3 map pin update live.
    const inspectionRows = await ctx.db
      .query("inspections")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    let latestInspection: (typeof inspectionRows)[number] | null = null;
    for (const ins of inspectionRows) {
      if (
        !latestInspection ||
        ins._creationTime > latestInspection._creationTime
      ) {
        latestInspection = ins;
      }
    }

    if (latestInspection) {
      // Patch only the counter fields — status and inspector fields stay intact.
      await ctx.db.patch(latestInspection._id, {
        totalItems,
        checkedItems,
        damagedItems,
        missingItems,
      });
    }

    // ── Record audit events (immutable append-only) ───────────────────────────

    // Primary event: damage_reported for damaged items; item_checked otherwise.
    const eventType =
      newStatus === "damaged" ? "damage_reported" : "item_checked";

    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: eventType,
      userId:    args.technicianId,
      userName:  args.technicianName,
      timestamp: now,
      data: {
        // templateItemId in the event payload is how getDamageReportsByCase
        // correlates damage events back to their manifest item (see damageReports.ts).
        templateItemId:    args.templateItemId,
        itemName:          item.name,
        previousStatus,
        newStatus,
        notes:             args.notes,
        photoStorageIds:   args.photoStorageIds,
        // Damage-specific fields — only populated for damage_reported events.
        description:       args.damageDescription,
        severity:          args.damageSeverity,
      },
    });

    // Secondary event: photo_added when photos are attached in this update.
    // Logged separately so the T5 audit chain can show photo upload activity
    // independently from the item status change.
    if (args.photoStorageIds && args.photoStorageIds.length > 0) {
      await ctx.db.insert("events", {
        caseId:    args.caseId,
        eventType: "photo_added",
        userId:    args.technicianId,
        userName:  args.technicianName,
        timestamp: now,
        data: {
          templateItemId:  args.templateItemId,
          itemName:        item.name,
          photoStorageIds: args.photoStorageIds,
          photoCount:      args.photoStorageIds.length,
        },
      });
    }

    return {
      itemId:         item._id.toString(),
      previousStatus,
      newStatus,
      inspectionCounters: {
        totalItems,
        checkedItems,
        damagedItems,
        missingItems,
      },
    };
  },
});

// ─── startInspection ─────────────────────────────────────────────────────────

/**
 * Explicitly start a new inspection for a case.
 *
 * Used when a case is already "in_field" (e.g., carried over from a previous
 * session) and no inspection record exists — or when a fresh inspection pass
 * is needed to re-inspect items.
 *
 * Creates an inspection row with "in_progress" status and the current item
 * counts, then appends an inspection_started event to the audit trail.
 *
 * In most SCAN app flows, inspection creation is handled by scanCheckIn when
 * the case transitions to "in_field".  Use this mutation when:
 *   • The case is already in_field and you need a new inspection pass.
 *   • The initial inspection was auto-created by scanCheckIn but the technician
 *     wants to start a fresh pass (the old one is kept in history).
 *
 * @throws When the case is not found or is not in an inspectable status
 *         ("deployed" or "in_field").
 *
 * Client usage:
 *   const startInsp = useStartInspection();
 *   const { inspectionId } = await startInsp({
 *     caseId:        caseDoc._id,
 *     timestamp:     Date.now(),
 *     technicianId:  kindeUser.id,
 *     technicianName: "Jane Pilot",
 *   });
 */
export const startInspection = mutation({
  args: {
    caseId:         v.id("cases"),
    timestamp:      v.number(),
    technicianId:   v.string(),
    technicianName: v.string(),
    notes:          v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<InspectionResult> => {
    const now = args.timestamp;

    // ── Verify case exists and is in an inspectable state ─────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(`Case ${args.caseId} not found.`);
    }

    const inspectableStatuses = ["deployed", "in_field"];
    if (!inspectableStatuses.includes(caseDoc.status)) {
      throw new Error(
        `Cannot start inspection: case "${caseDoc.label}" is in status ` +
        `"${caseDoc.status}". Expected one of: ${inspectableStatuses.join(", ")}.`
      );
    }

    // ── Count manifest items for initial inspection totals ────────────────────
    const manifestItems = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    const totalItems   = manifestItems.length;
    const checkedItems = manifestItems.filter((i) => i.status !== "unchecked").length;
    const damagedItems = manifestItems.filter((i) => i.status === "damaged").length;
    const missingItems = manifestItems.filter((i) => i.status === "missing").length;

    // ── Create inspection record ──────────────────────────────────────────────
    const inspectionId = await ctx.db.insert("inspections", {
      caseId:        args.caseId,
      inspectorId:   args.technicianId,
      inspectorName: args.technicianName,
      status:        "in_progress",
      startedAt:     now,
      totalItems,
      checkedItems,
      damagedItems,
      missingItems,
      notes:         args.notes,
    });

    // ── Audit event ───────────────────────────────────────────────────────────
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "inspection_started",
      userId:    args.technicianId,
      userName:  args.technicianName,
      timestamp: now,
      data: {
        inspectionId: inspectionId.toString(),
        totalItems,
        checkedItems,
        damagedItems,
        missingItems,
        notes:        args.notes,
      },
    });

    return {
      inspectionId: inspectionId.toString(),
      caseId:       args.caseId,
      status:       "in_progress",
    };
  },
});

// ─── completeInspection ───────────────────────────────────────────────────────

/**
 * Mark a case inspection as completed.
 *
 * Called by the SCAN app when the technician has reviewed all manifest items
 * (i.e., ChecklistSummary.isComplete === true) and taps "Complete Inspection".
 *
 * Transitions the inspection record from "in_progress" (or "flagged") to
 * "completed" and records completedAt.  If any items are damaged or missing,
 * the status becomes "flagged" instead — this surfaces in M3's
 * byInspectionStatus summary for the dashboard team to review.
 *
 * Also updates cases.updatedAt so the M1 by_updated index reflects the
 * inspection completion as recent activity.
 *
 * @param inspectionId  Convex document ID of the inspection to complete.
 * @param caseId        Parent case ID (for the audit event and cases.updatedAt).
 * @param timestamp     Epoch ms — written to inspections.completedAt.
 * @param technicianId  Kinde user ID of the technician completing the inspection.
 * @param technicianName Display name of the technician.
 * @param notes         Optional completion notes.
 *
 * @throws When the inspection is not found.
 * @throws When the inspection is already completed.
 *
 * Client usage:
 *   const completeInsp = useCompleteInspection();
 *   await completeInsp({
 *     inspectionId:  inspectionDoc._id,
 *     caseId:        caseDoc._id,
 *     timestamp:     Date.now(),
 *     technicianId:  kindeUser.id,
 *     technicianName: "Jane Pilot",
 *   });
 */
export const completeInspection = mutation({
  args: {
    inspectionId:   v.id("inspections"),
    caseId:         v.id("cases"),
    timestamp:      v.number(),
    technicianId:   v.string(),
    technicianName: v.string(),
    notes:          v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<InspectionResult> => {
    const now = args.timestamp;

    // ── Verify inspection exists ──────────────────────────────────────────────
    const inspection = await ctx.db.get(args.inspectionId);
    if (!inspection) {
      throw new Error(`Inspection ${args.inspectionId} not found.`);
    }

    if (inspection.status === "completed") {
      throw new Error(
        `Inspection ${args.inspectionId} is already completed.`
      );
    }

    // ── Determine final status ────────────────────────────────────────────────
    // If items are damaged or missing, flag the inspection for dashboard review.
    // Otherwise, mark it completed cleanly.
    const finalStatus: "completed" | "flagged" =
      inspection.damagedItems > 0 || inspection.missingItems > 0
        ? "flagged"
        : "completed";

    // ── Patch inspection record ───────────────────────────────────────────────
    const inspPatch: Record<string, unknown> = {
      status:      finalStatus,
      completedAt: now,
    };
    if (args.notes !== undefined) inspPatch.notes = args.notes;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(args.inspectionId, inspPatch as any);

    // ── Update cases.updatedAt so M1 sort index reflects this activity ─────────
    await ctx.db.patch(args.caseId, { updatedAt: now });

    // ── Audit event ───────────────────────────────────────────────────────────
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "inspection_completed",
      userId:    args.technicianId,
      userName:  args.technicianName,
      timestamp: now,
      data: {
        inspectionId:  args.inspectionId,
        finalStatus,
        totalItems:    inspection.totalItems,
        checkedItems:  inspection.checkedItems,
        damagedItems:  inspection.damagedItems,
        missingItems:  inspection.missingItems,
        notes:         args.notes,
      },
    });

    return {
      inspectionId: args.inspectionId,
      caseId:       args.caseId,
      status:       finalStatus,
    };
  },
});
