/**
 * convex/scanActions.ts
 *
 * Convex mutations and companion reactive queries for the two immutable history
 * tables written by the SCAN mobile app:
 *
 *   scans              — append-only log of every QR code scan event
 *   checklist_updates  — append-only log of every manifest item state change
 *
 * Mutations
 * ─────────
 *   recordScanEvent        — insert a row into `scans` when a QR code is decoded
 *   recordChecklistUpdate  — insert a row into `checklist_updates` when a
 *                            technician marks a manifest item ok/damaged/missing
 *
 * Reactive queries invalidated by each mutation
 * ──────────────────────────────────────────────
 * Convex re-evaluates every subscribed query that reads a table touched by a
 * mutation and pushes the diff to connected clients within ~100–300 ms.  The
 * queries below are the canonical reactive subscriptions for these two tables;
 * any client subscribed to them will receive live updates within 2 seconds of
 * a mutation.
 *
 *   recordScanEvent invalidates:
 *     getScansByCase          — by_case index on scans
 *     getLastScanForCase      — by_case_scanned_at index on scans
 *     getScansByUser          — by_user index on scans
 *     getRecentScans          — by_scanned_at index on scans (fleet-wide feed)
 *
 *   recordChecklistUpdate invalidates:
 *     getChecklistUpdatesByCase     — by_case index on checklist_updates
 *     getChecklistUpdatesByCaseTime — by_case_updated_at index on checklist_updates
 *     getChecklistUpdatesByItem     — by_manifest_item index on checklist_updates
 *     getChecklistUpdatesByUser     — by_user index on checklist_updates
 *     getItemUpdatesByStatus        — by_case_new_status index on checklist_updates
 *
 * Relationship to convex/scan.ts
 * ──────────────────────────────
 * convex/scan.ts handles the business-logic mutations (status transitions,
 * inspection creation, aggregate counter sync).  This file handles the
 * immutable history writes.  In a typical SCAN app workflow:
 *
 *   1. Camera decodes QR code → call recordScanEvent  (this file)
 *   2. User confirms status transition → call scanCheckIn  (scan.ts)
 *   3. User marks checklist item → call updateChecklistItem  (scan.ts)
 *                                   AND recordChecklistUpdate  (this file)
 *
 * Write strategy
 * ──────────────
 * Both mutations insert new rows rather than patching existing ones — the
 * tables are append-only by design.  This is what ensures the reactive
 * subscriptions receive an invalidation signal: Convex detects the insert
 * as a table mutation and re-runs all queries with matching index ranges.
 *
 * Specifically:
 *   recordScanEvent       inserts into `scans`            →  invalidates by_case,
 *                                                            by_case_scanned_at,
 *                                                            by_user, by_scanned_at
 *   recordChecklistUpdate inserts into `checklist_updates` → invalidates by_case,
 *                                                            by_case_updated_at,
 *                                                            by_manifest_item,
 *                                                            by_user,
 *                                                            by_case_new_status
 *
 * Client usage
 * ────────────
 * Use the companion hooks in src/hooks/use-scan-mutations.ts or call directly:
 *
 *   import { useMutation, useQuery } from "convex/react";
 *   import { api } from "@/convex/_generated/api";
 *
 *   // Mutations
 *   const recordScan    = useMutation(api.scanActions.recordScanEvent);
 *   const recordUpdate  = useMutation(api.scanActions.recordChecklistUpdate);
 *
 *   // Reactive queries
 *   const scanHistory   = useQuery(api.scanActions.getScansByCase, { caseId });
 *   const lastScan      = useQuery(api.scanActions.getLastScanForCase, { caseId });
 *   const updateHistory = useQuery(api.scanActions.getChecklistUpdatesByCase, { caseId });
 *   const itemHistory   = useQuery(api.scanActions.getChecklistUpdatesByItem, {
 *     manifestItemId,
 *   });
 */

import { mutation, query } from "./_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Asserts that the calling client has a verified Kinde JWT.
 * Throws [AUTH_REQUIRED] for unauthenticated requests.
 * Returns UserIdentity so callers can access the subject (kindeId).
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

// ─── Shared value validators ──────────────────────────────────────────────────

/**
 * Manifest item inspection state validator.
 * Mirrors manifestItemStatus in convex/schema.ts.
 */
const manifestItemStatusValidator = v.union(
  v.literal("unchecked"),
  v.literal("ok"),
  v.literal("damaged"),
  v.literal("missing")
);

// ─── Return types ─────────────────────────────────────────────────────────────

/**
 * Result returned by recordScanEvent.
 * Exported so client-side hooks can expose a typed result.
 */
export interface RecordScanEventResult {
  /** Convex document ID of the newly created scan row. */
  scanId: string;
  /** The case that was scanned. */
  caseId: string;
  /** Epoch ms when the scan was recorded. */
  scannedAt: number;
}

/**
 * Result returned by recordChecklistUpdate.
 * Exported so client-side hooks can expose a typed result.
 */
export interface RecordChecklistUpdateResult {
  /** Convex document ID of the newly created checklist_updates row. */
  updateId: string;
  /** The case whose checklist was updated. */
  caseId: string;
  /** Epoch ms when the update was recorded. */
  updatedAt: number;
  /** Item status before this update. */
  previousStatus: string;
  /** Item status after this update. */
  newStatus: string;
}

/**
 * A single scan event as returned by scan history queries.
 */
export interface ScanEventRow {
  _id: string;
  _creationTime: number;
  caseId: string;
  qrPayload: string;
  scannedBy: string;
  scannedByName: string;
  scannedAt: number;
  lat?: number;
  lng?: number;
  locationName?: string;
  scanContext?: string;
  inspectionId?: string;
  deviceInfo?: string;
}

/**
 * A single checklist update row as returned by update history queries.
 */
export interface ChecklistUpdateRow {
  _id: string;
  _creationTime: number;
  caseId: string;
  manifestItemId: string;
  templateItemId: string;
  itemName: string;
  previousStatus: string;
  newStatus: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: number;
  notes?: string;
  photoStorageIds?: string[];
  damageDescription?: string;
  damageSeverity?: string;
  inspectionId?: string;
}

// ─── recordScanEvent ──────────────────────────────────────────────────────────

/**
 * Record a QR scan event in the immutable `scans` history table.
 *
 * This mutation is the dedicated write for the `scans` table — the append-only
 * log that captures EVERY scan action performed in the SCAN mobile app,
 * regardless of whether a status transition occurred.
 *
 * Relationship to scanCheckIn (convex/scan.ts):
 * ─────────────────────────────────────────────
 * scanCheckIn handles business logic: status transitions, inspection creation,
 * and case field updates.  recordScanEvent handles the raw scan log write.
 * Both should be called when a QR code is scanned:
 *   1. recordScanEvent — insert into `scans` (this mutation)
 *   2. scanCheckIn     — update case status, create inspection, write events
 *
 * For informational-only scans ("lookup" context, no status change), ONLY
 * recordScanEvent is needed — there is nothing for scanCheckIn to do.
 *
 * Writes and reactive query invalidation:
 * ────────────────────────────────────────
 *   INSERT into `scans` → Convex invalidates any query with an active
 *   subscription on the `scans` table for the matching index range:
 *
 *   Index               Queries invalidated
 *   ───────────────     ───────────────────────────────────────────────────
 *   by_case             getScansByCase(caseId) — case scan history
 *   by_case_scanned_at  getLastScanForCase(caseId) — "last seen N min ago"
 *   by_user             getScansByUser(userId) — My Activity tab
 *   by_scanned_at       getRecentScans() — fleet-wide recent scan feed
 *
 * @param caseId        Convex document ID of the case that was scanned.
 * @param qrPayload     Raw QR code string decoded by the camera.
 * @param scannedBy     Kinde user ID of the scanning technician.
 * @param scannedByName Display name of the technician.
 * @param scannedAt     Epoch ms when the scan occurred (client-side clock).
 * @param lat           Optional GPS latitude at scan time.
 * @param lng           Optional GPS longitude at scan time.
 * @param locationName  Optional human-readable location name.
 * @param scanContext   Why the scan was initiated: "check_in" | "inspection" |
 *                      "handoff" | "lookup".
 * @param inspectionId  Optional Convex ID of an inspection created or resumed
 *                      by this scan (when scanContext = "inspection").
 * @param deviceInfo    Optional device/browser metadata JSON string for support.
 *
 * @returns RecordScanEventResult { scanId, caseId, scannedAt }
 *
 * @throws When the case is not found.
 *
 * Client usage:
 *   const recordScan = useMutation(api.scanActions.recordScanEvent);
 *
 *   // After QR decode (and before or alongside scanCheckIn):
 *   const { scanId } = await recordScan({
 *     caseId:        resolvedCase._id,
 *     qrPayload:     decodedText,
 *     scannedBy:     kindeUser.id,
 *     scannedByName: "Jane Pilot",
 *     scannedAt:     Date.now(),
 *     lat:           position?.coords.latitude,
 *     lng:           position?.coords.longitude,
 *     locationName:  "Site Alpha — Turbine Row 3",
 *     scanContext:   "check_in",
 *   });
 */
export const recordScanEvent = mutation({
  args: {
    /** Convex ID of the case that was scanned. */
    caseId: v.id("cases"),

    /**
     * Raw QR code payload decoded by the SCAN app camera.
     * Preserved verbatim — used to verify the QR value that led to the case
     * lookup (useful for diagnosing mismatches).
     */
    qrPayload: v.string(),

    /**
     * Kinde user ID of the scanning technician.
     * Written to scans.scannedBy — the field the by_user index covers.
     */
    scannedBy: v.string(),

    /**
     * Display name of the technician.
     * Denormalized so scan history rows are self-contained without user lookups.
     */
    scannedByName: v.string(),

    /**
     * Epoch ms when the scan occurred (client-side timestamp).
     * Written to scans.scannedAt — the field the by_scanned_at and
     * by_case_scanned_at indexes cover.
     */
    scannedAt: v.number(),

    /**
     * GPS latitude at time of scan.
     * Omit when the device could not obtain a GPS fix.
     */
    lat: v.optional(v.number()),

    /**
     * GPS longitude at time of scan.
     * Omit when the device could not obtain a GPS fix.
     */
    lng: v.optional(v.number()),

    /**
     * Human-readable location name (e.g. "Site Alpha — Turbine Row 3").
     * Optional — populated by the SCAN app's reverse-geocode lookup or
     * manually entered location context.
     */
    locationName: v.optional(v.string()),

    /**
     * Why this scan was initiated.
     *   "check_in"   — QR scanned to check in / advance status
     *   "inspection" — QR scanned to begin or resume a checklist inspection
     *   "handoff"    — QR scanned to start a custody handoff
     *   "lookup"     — QR scanned for informational purposes only
     */
    scanContext: v.optional(v.string()),

    /**
     * Optional Convex ID of the inspection this scan is associated with.
     * Populated when scanContext = "inspection" or when scanCheckIn created
     * a new inspection for the case.
     */
    inspectionId: v.optional(v.id("inspections")),

    /**
     * Optional device / browser metadata JSON string.
     * Used for support diagnostics only; not indexed.
     */
    deviceInfo: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<RecordScanEventResult> => {
    await requireAuth(ctx);

    // Verify the case exists before inserting the scan log entry.
    // This prevents orphaned scan rows referencing nonexistent cases.
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `recordScanEvent: Case "${args.caseId}" not found. ` +
          `Ensure the QR payload resolves to a valid case before calling recordScanEvent.`
      );
    }

    // ── INSERT into `scans` ───────────────────────────────────────────────────
    //
    // This is the write that invalidates the reactive queries.  Convex detects
    // the insert and re-evaluates all subscribed queries reading the scans table
    // for any of the following index ranges:
    //
    //   by_case             → getScansByCase({ caseId: args.caseId })
    //   by_case_scanned_at  → getLastScanForCase({ caseId: args.caseId })
    //   by_user             → getScansByUser({ userId: args.scannedBy })
    //   by_scanned_at       → getRecentScans({ ... })
    //
    // All subscribed dashboard sessions and SCAN app views receive the updated
    // results within ~100–300 ms, satisfying the ≤ 2-second real-time fidelity
    // requirement.
    const scanId = await ctx.db.insert("scans", {
      caseId:        args.caseId,
      qrPayload:     args.qrPayload,
      scannedBy:     args.scannedBy,
      scannedByName: args.scannedByName,
      scannedAt:     args.scannedAt,
      lat:           args.lat,
      lng:           args.lng,
      locationName:  args.locationName,
      scanContext:   args.scanContext,
      inspectionId:  args.inspectionId,
      deviceInfo:    args.deviceInfo,
    });

    return {
      scanId:    scanId.toString(),
      caseId:    args.caseId,
      scannedAt: args.scannedAt,
    };
  },
});

// ─── recordChecklistUpdate ────────────────────────────────────────────────────

/**
 * Record a manifest item state change in the immutable `checklist_updates`
 * history table.
 *
 * This mutation is the dedicated write for the `checklist_updates` table — the
 * append-only log that captures every checklist item status change made during
 * field inspection.
 *
 * Relationship to updateChecklistItem (convex/scan.ts):
 * ──────────────────────────────────────────────────────
 * updateChecklistItem handles business logic: patching manifestItems.status,
 * recomputing inspection aggregate counters, and writing events.
 * recordChecklistUpdate handles the typed, queryable history log write.
 * Both should be called when a manifest item status changes:
 *   1. updateChecklistItem   — patch manifestItems, sync inspection counters
 *   2. recordChecklistUpdate — insert history row into checklist_updates (this mutation)
 *
 * Writes and reactive query invalidation:
 * ────────────────────────────────────────
 *   INSERT into `checklist_updates` → Convex invalidates subscriptions:
 *
 *   Index                Queries invalidated
 *   ──────────────────   ────────────────────────────────────────────────────
 *   by_case              getChecklistUpdatesByCase(caseId) — full case history
 *   by_case_updated_at   getChecklistUpdatesByCaseTime(caseId, since) — time window
 *   by_manifest_item     getChecklistUpdatesByItem(manifestItemId) — per-item trail
 *   by_user              getChecklistUpdatesByUser(userId) — My Activity
 *   by_case_new_status   getItemUpdatesByStatus(caseId, "damaged") — damage feed
 *
 * @param caseId           Convex document ID of the parent case.
 * @param manifestItemId   Convex document ID of the manifest item that was updated.
 * @param templateItemId   Stable template item identifier (from caseTemplates.items[].id).
 * @param itemName         Display name of the item at time of update.
 * @param previousStatus   Item state BEFORE this update.
 * @param newStatus        Item state AFTER this update.
 * @param updatedBy        Kinde user ID of the technician making the change.
 * @param updatedByName    Display name of the technician.
 * @param updatedAt        Epoch ms when the update was submitted.
 * @param notes            Optional technician notes entered alongside the status change.
 * @param photoStorageIds  Convex file storage IDs for photos attached to this update.
 * @param damageDescription Structured damage description (only for "damaged" updates).
 * @param damageSeverity   Severity level: "minor" | "moderate" | "severe".
 * @param inspectionId     Optional Convex ID of the active inspection this update belongs to.
 *
 * @returns RecordChecklistUpdateResult { updateId, caseId, updatedAt, previousStatus, newStatus }
 *
 * @throws When the manifest item is not found on the case.
 *
 * Client usage:
 *   const recordUpdate = useMutation(api.scanActions.recordChecklistUpdate);
 *
 *   // After calling updateChecklistItem:
 *   await recordUpdate({
 *     caseId:         caseDoc._id,
 *     manifestItemId: item._id,
 *     templateItemId: "item-battery-pack",
 *     itemName:       "Battery Pack",
 *     previousStatus: "unchecked",
 *     newStatus:      "damaged",
 *     updatedBy:      kindeUser.id,
 *     updatedByName:  "Jane Pilot",
 *     updatedAt:      Date.now(),
 *     notes:          "Cracked housing on B-side",
 *     photoStorageIds:    ["storage_abc123"],
 *     damageDescription:  "Impact crack visible on battery housing",
 *     damageSeverity:     "moderate",
 *   });
 */
export const recordChecklistUpdate = mutation({
  args: {
    /** Convex ID of the parent case. */
    caseId: v.id("cases"),

    /**
     * Convex ID of the manifest item that was updated.
     * Used to build the by_manifest_item index entry so per-item history
     * queries (getChecklistUpdatesByItem) can subscribe reactively.
     */
    manifestItemId: v.id("manifestItems"),

    /**
     * Stable template item identifier (from caseTemplates.items[].id).
     * Preserved so the history row can correlate with the template
     * even if the manifestItems row is replaced (e.g., template re-applied).
     */
    templateItemId: v.string(),

    /**
     * Display name of the checklist item at the time of the update.
     * Denormalized so the history row is self-contained.
     */
    itemName: v.string(),

    /**
     * Item inspection state BEFORE this update.
     * Enables diff views and "undo" UX in the T5 audit panel.
     */
    previousStatus: manifestItemStatusValidator,

    /**
     * Item inspection state AFTER this update.
     * Written to checklist_updates.newStatus — the field covered by the
     * by_case_new_status compound index.  This is the key field that enables
     * reactive queries like "subscribe to all newly-damaged items for CASE-007".
     */
    newStatus: manifestItemStatusValidator,

    /**
     * Kinde user ID of the technician making the update.
     * Written to checklist_updates.updatedBy — the field the by_user index covers.
     */
    updatedBy: v.string(),

    /**
     * Display name of the technician.
     * Denormalized for attribution display without user table joins.
     */
    updatedByName: v.string(),

    /**
     * Epoch ms when the update was submitted by the SCAN app.
     * Written to checklist_updates.updatedAt — the field the by_case_updated_at
     * compound index covers (enables time-range queries on update history).
     */
    updatedAt: v.number(),

    /**
     * Optional technician notes entered alongside the status change.
     * Same value written to manifestItems.notes by updateChecklistItem.
     */
    notes: v.optional(v.string()),

    /**
     * Convex file storage IDs for photos attached to this update.
     * Populated when the technician attached damage photos in the SCAN app.
     */
    photoStorageIds: v.optional(v.array(v.string())),

    /**
     * Structured damage description — only meaningful when newStatus = "damaged".
     * Free-text entered by the technician in the SCAN damage report form.
     */
    damageDescription: v.optional(v.string()),

    /**
     * Damage severity level — only meaningful when newStatus = "damaged".
     * Typical values: "minor" | "moderate" | "severe"
     * Free-form string; the SCAN app UI enforces the enum client-side.
     */
    damageSeverity: v.optional(v.string()),

    /**
     * Optional Convex ID of the active inspection this update was made under.
     * Enables queries like "all checklist updates for inspection X".
     */
    inspectionId: v.optional(v.id("inspections")),
  },

  handler: async (ctx, args): Promise<RecordChecklistUpdateResult> => {
    await requireAuth(ctx);

    // Verify the manifest item exists before inserting the history row.
    // This prevents orphaned history rows referencing nonexistent items.
    const itemDoc = await ctx.db.get(args.manifestItemId);
    if (!itemDoc) {
      throw new Error(
        `recordChecklistUpdate: Manifest item "${args.manifestItemId}" not found. ` +
          `Ensure updateChecklistItem has been called before recordChecklistUpdate, ` +
          `or that the templateItemId is applied to this case.`
      );
    }

    // Verify the item belongs to the specified case.
    if (itemDoc.caseId.toString() !== args.caseId.toString()) {
      throw new Error(
        `recordChecklistUpdate: Manifest item "${args.manifestItemId}" does not ` +
          `belong to case "${args.caseId}". ` +
          `Expected caseId "${args.caseId}", found "${itemDoc.caseId}".`
      );
    }

    // ── INSERT into `checklist_updates` ───────────────────────────────────────
    //
    // This is the write that invalidates the reactive queries.  Convex detects
    // the insert and re-evaluates all subscribed queries reading the
    // checklist_updates table for any of the following index ranges:
    //
    //   by_case              → getChecklistUpdatesByCase({ caseId: args.caseId })
    //   by_case_updated_at   → getChecklistUpdatesByCaseTime({ caseId, sinceTimestamp })
    //   by_manifest_item     → getChecklistUpdatesByItem({ manifestItemId: args.manifestItemId })
    //   by_user              → getChecklistUpdatesByUser({ userId: args.updatedBy })
    //   by_case_new_status   → getItemUpdatesByStatus({ caseId: args.caseId, newStatus: args.newStatus })
    //
    // The by_case_new_status index is particularly important for the T4 dashboard
    // damage panel: the query getItemUpdatesByStatus(caseId, "damaged") receives
    // a live push every time a technician marks a new item as damaged in the SCAN
    // app — satisfying the ≤ 2-second real-time fidelity requirement.
    const updateId = await ctx.db.insert("checklist_updates", {
      caseId:            args.caseId,
      manifestItemId:    args.manifestItemId,
      templateItemId:    args.templateItemId,
      itemName:          args.itemName,
      previousStatus:    args.previousStatus,
      newStatus:         args.newStatus,
      updatedBy:         args.updatedBy,
      updatedByName:     args.updatedByName,
      updatedAt:         args.updatedAt,
      notes:             args.notes,
      photoStorageIds:   args.photoStorageIds,
      damageDescription: args.damageDescription,
      damageSeverity:    args.damageSeverity,
      inspectionId:      args.inspectionId,
    });

    return {
      updateId:       updateId.toString(),
      caseId:         args.caseId,
      updatedAt:      args.updatedAt,
      previousStatus: args.previousStatus,
      newStatus:      args.newStatus,
    };
  },
});

// ─── Reactive queries: scans table ───────────────────────────────────────────
//
// These queries are invalidated whenever recordScanEvent inserts a new row into
// the `scans` table.  All are public queries callable via useQuery.

/**
 * Subscribe to the full scan history for a case.
 *
 * Returns all scan events for the given case, ordered by scannedAt descending
 * (most recent first).  Uses the by_case index for an O(log n + |scans|) lookup.
 *
 * Invalidated by: recordScanEvent({ caseId }) — any new scan for this case
 * pushes a live update to all subscribers within ~100–300 ms.
 *
 * Use cases:
 *   • T5 audit panel "Scan Activity" timeline
 *   • SCAN app "Case History" view
 *   • Dashboard T2 "Last Seen" info
 *
 * Client usage:
 *   const scans = useQuery(api.scanActions.getScansByCase, { caseId });
 */
export const getScansByCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<ScanEventRow[]> => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("scans")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    // Sort descending (most recent first) for timeline display.
    rows.sort((a, b) => b.scannedAt - a.scannedAt);

    return rows.map((r) => ({
      _id:           r._id.toString(),
      _creationTime: r._creationTime,
      caseId:        r.caseId.toString(),
      qrPayload:     r.qrPayload,
      scannedBy:     r.scannedBy,
      scannedByName: r.scannedByName,
      scannedAt:     r.scannedAt,
      lat:           r.lat,
      lng:           r.lng,
      locationName:  r.locationName,
      scanContext:   r.scanContext,
      inspectionId:  r.inspectionId?.toString(),
      deviceInfo:    r.deviceInfo,
    }));
  },
});

/**
 * Subscribe to the most recent scan event for a case.
 *
 * Returns the single most recent scan row, or null if the case has never been
 * scanned.  Uses the by_case_scanned_at compound index with descending ordering
 * for an O(log n + 1) lookup.
 *
 * Invalidated by: recordScanEvent({ caseId }) — a new scan for this case
 * may become the "last scan" and pushes a live update.
 *
 * Use cases:
 *   • Dashboard T1 / T2 "Last scanned N minutes ago" display
 *   • SCAN app header "Last seen at [location]"
 *   • Map pin tooltip "Last scan: Jane Pilot — Site Alpha"
 *
 * Returns null when the case has never been scanned (not undefined) — callers
 * can render an "Never scanned" state without null-guarding undefined.
 *
 * Client usage:
 *   const lastScan = useQuery(api.scanActions.getLastScanForCase, { caseId });
 *   if (lastScan === null) return <span>Never scanned</span>;
 */
export const getLastScanForCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<ScanEventRow | null> => {
    await requireAuth(ctx);
    // Use by_case_scanned_at with descending order to get the most recent scan
    // in a single index seek — O(log n + 1).
    const row = await ctx.db
      .query("scans")
      .withIndex("by_case_scanned_at", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .first();

    if (!row) return null;

    return {
      _id:           row._id.toString(),
      _creationTime: row._creationTime,
      caseId:        row.caseId.toString(),
      qrPayload:     row.qrPayload,
      scannedBy:     row.scannedBy,
      scannedByName: row.scannedByName,
      scannedAt:     row.scannedAt,
      lat:           row.lat,
      lng:           row.lng,
      locationName:  row.locationName,
      scanContext:   row.scanContext,
      inspectionId:  row.inspectionId?.toString(),
      deviceInfo:    row.deviceInfo,
    };
  },
});

/**
 * Subscribe to all scan events performed by a specific user.
 *
 * Returns all scans for the given Kinde user ID, ordered by scannedAt
 * descending.  Uses the by_user index for an O(log n + |user_scans|) lookup.
 *
 * Invalidated by: recordScanEvent({ scannedBy: userId }) — any new scan by
 * this user pushes a live update to all subscribers.
 *
 * Use cases:
 *   • SCAN app "My Activity" tab — technician's personal scan history
 *   • Admin audit: "show all scans performed by this technician"
 *   • getCustodianIdentitySummary diagnostics
 *
 * Returns an empty array when the user has no scan history.
 *
 * Client usage:
 *   const myScans = useQuery(api.scanActions.getScansByUser, {
 *     userId: kindeUser.id,
 *   });
 */
export const getScansByUser = query({
  args: {
    /** Kinde user ID of the technician whose scan history to retrieve. */
    userId: v.string(),
    /**
     * Optional limit on the number of results returned.
     * Defaults to 50 when not specified.  Cap at 200 for performance.
     */
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ScanEventRow[]> => {
    await requireAuth(ctx);
    const effectiveLimit = Math.min(args.limit ?? 50, 200);

    const rows = await ctx.db
      .query("scans")
      .withIndex("by_user", (q) => q.eq("scannedBy", args.userId))
      .order("desc")
      .take(effectiveLimit);

    return rows.map((r) => ({
      _id:           r._id.toString(),
      _creationTime: r._creationTime,
      caseId:        r.caseId.toString(),
      qrPayload:     r.qrPayload,
      scannedBy:     r.scannedBy,
      scannedByName: r.scannedByName,
      scannedAt:     r.scannedAt,
      lat:           r.lat,
      lng:           r.lng,
      locationName:  r.locationName,
      scanContext:   r.scanContext,
      inspectionId:  r.inspectionId?.toString(),
      deviceInfo:    r.deviceInfo,
    }));
  },
});

/**
 * Subscribe to the most recent scan events across the entire fleet.
 *
 * Returns the N most recent scan events from all cases and all users, ordered
 * by scannedAt descending.  Uses the by_scanned_at index for efficient
 * descending time-ordered access.
 *
 * Invalidated by: recordScanEvent — ANY new scan pushes a live update.
 *
 * Use cases:
 *   • Dashboard overview "Recent Activity" feed
 *   • Operations monitoring: "no scans in the last N hours" alert trigger
 *   • Telemetry aggregation: scan rate per time window
 *
 * Returns an empty array when no scans have been recorded.
 *
 * Client usage:
 *   const recentScans = useQuery(api.scanActions.getRecentScans, { limit: 20 });
 */
export const getRecentScans = query({
  args: {
    /**
     * Maximum number of scan events to return.
     * Defaults to 20 when not specified.  Cap at 100 for performance.
     */
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ScanEventRow[]> => {
    await requireAuth(ctx);
    const effectiveLimit = Math.min(args.limit ?? 20, 100);

    const rows = await ctx.db
      .query("scans")
      .withIndex("by_scanned_at")
      .order("desc")
      .take(effectiveLimit);

    return rows.map((r) => ({
      _id:           r._id.toString(),
      _creationTime: r._creationTime,
      caseId:        r.caseId.toString(),
      qrPayload:     r.qrPayload,
      scannedBy:     r.scannedBy,
      scannedByName: r.scannedByName,
      scannedAt:     r.scannedAt,
      lat:           r.lat,
      lng:           r.lng,
      locationName:  r.locationName,
      scanContext:   r.scanContext,
      inspectionId:  r.inspectionId?.toString(),
      deviceInfo:    r.deviceInfo,
    }));
  },
});

// ─── Reactive queries: checklist_updates table ────────────────────────────────
//
// These queries are invalidated whenever recordChecklistUpdate inserts a new
// row into the `checklist_updates` table.  All are public queries callable via
// useQuery.

/**
 * Subscribe to the full checklist update history for a case.
 *
 * Returns all checklist update rows for the given case, ordered by updatedAt
 * descending (most recent first).  Uses the by_case index for an
 * O(log n + |updates|) lookup.
 *
 * Invalidated by: recordChecklistUpdate({ caseId }) — any new update for this
 * case pushes a live update to all subscribers within ~100–300 ms.
 *
 * Use cases:
 *   • T5 audit panel "Checklist History" timeline
 *   • SCAN app inspection review screen
 *   • Compliance report: "all checklist changes for CASE-007"
 *
 * Client usage:
 *   const history = useQuery(api.scanActions.getChecklistUpdatesByCase, { caseId });
 */
export const getChecklistUpdatesByCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<ChecklistUpdateRow[]> => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("checklist_updates")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    // Sort descending (most recent first) for timeline display.
    rows.sort((a, b) => b.updatedAt - a.updatedAt);

    return rows.map((r) => ({
      _id:               r._id.toString(),
      _creationTime:     r._creationTime,
      caseId:            r.caseId.toString(),
      manifestItemId:    r.manifestItemId.toString(),
      templateItemId:    r.templateItemId,
      itemName:          r.itemName,
      previousStatus:    r.previousStatus,
      newStatus:         r.newStatus,
      updatedBy:         r.updatedBy,
      updatedByName:     r.updatedByName,
      updatedAt:         r.updatedAt,
      notes:             r.notes,
      photoStorageIds:   r.photoStorageIds,
      damageDescription: r.damageDescription,
      damageSeverity:    r.damageSeverity,
      inspectionId:      r.inspectionId?.toString(),
    }));
  },
});

/**
 * Subscribe to checklist updates for a case within a time window.
 *
 * Returns update rows with updatedAt >= sinceTimestamp, ordered descending.
 * Uses the by_case_updated_at compound index for an O(log n + |results|) range
 * query — efficient for large cases with many historical updates.
 *
 * Invalidated by: recordChecklistUpdate({ caseId }) — any new update for this
 * case within the time window pushes a live update.
 *
 * Use cases:
 *   • "Show changes made in the last 24 hours" view
 *   • Compliance reports filtered by date range
 *   • Real-time "what changed since I last looked" feed
 *
 * Client usage:
 *   const recentUpdates = useQuery(
 *     api.scanActions.getChecklistUpdatesByCaseTime,
 *     {
 *       caseId,
 *       sinceTimestamp: Date.now() - 24 * 60 * 60 * 1000, // last 24 hours
 *     }
 *   );
 */
export const getChecklistUpdatesByCaseTime = query({
  args: {
    caseId:         v.id("cases"),
    /** Epoch ms lower bound — only updates with updatedAt >= this value. */
    sinceTimestamp: v.number(),
  },
  handler: async (ctx, args): Promise<ChecklistUpdateRow[]> => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("checklist_updates")
      .withIndex("by_case_updated_at", (q) =>
        q.eq("caseId", args.caseId).gte("updatedAt", args.sinceTimestamp)
      )
      .order("desc")
      .collect();

    return rows.map((r) => ({
      _id:               r._id.toString(),
      _creationTime:     r._creationTime,
      caseId:            r.caseId.toString(),
      manifestItemId:    r.manifestItemId.toString(),
      templateItemId:    r.templateItemId,
      itemName:          r.itemName,
      previousStatus:    r.previousStatus,
      newStatus:         r.newStatus,
      updatedBy:         r.updatedBy,
      updatedByName:     r.updatedByName,
      updatedAt:         r.updatedAt,
      notes:             r.notes,
      photoStorageIds:   r.photoStorageIds,
      damageDescription: r.damageDescription,
      damageSeverity:    r.damageSeverity,
      inspectionId:      r.inspectionId?.toString(),
    }));
  },
});

/**
 * Subscribe to the full update history for a single manifest item.
 *
 * Returns all checklist_updates rows for the given manifest item, ordered
 * descending.  Uses the by_manifest_item index for an O(log n + |results|)
 * lookup — direct per-item history without loading the full case history.
 *
 * Invalidated by: recordChecklistUpdate({ manifestItemId }) — any new update
 * to this specific item pushes a live update.
 *
 * Use cases:
 *   • SCAN app item detail view: "show every state change for this battery pack"
 *   • T4 dashboard damage panel: per-item audit trail alongside photos
 *   • Investigating repeated status changes on a single item
 *
 * Client usage:
 *   const itemHistory = useQuery(api.scanActions.getChecklistUpdatesByItem, {
 *     manifestItemId: item._id,
 *   });
 */
export const getChecklistUpdatesByItem = query({
  args: {
    /** Convex ID of the manifest item whose update history to retrieve. */
    manifestItemId: v.id("manifestItems"),
  },
  handler: async (ctx, args): Promise<ChecklistUpdateRow[]> => {
    await requireAuth(ctx);
    const rows = await ctx.db
      .query("checklist_updates")
      .withIndex("by_manifest_item", (q) =>
        q.eq("manifestItemId", args.manifestItemId)
      )
      .collect();

    // Sort descending (most recent first) for timeline display.
    rows.sort((a, b) => b.updatedAt - a.updatedAt);

    return rows.map((r) => ({
      _id:               r._id.toString(),
      _creationTime:     r._creationTime,
      caseId:            r.caseId.toString(),
      manifestItemId:    r.manifestItemId.toString(),
      templateItemId:    r.templateItemId,
      itemName:          r.itemName,
      previousStatus:    r.previousStatus,
      newStatus:         r.newStatus,
      updatedBy:         r.updatedBy,
      updatedByName:     r.updatedByName,
      updatedAt:         r.updatedAt,
      notes:             r.notes,
      photoStorageIds:   r.photoStorageIds,
      damageDescription: r.damageDescription,
      damageSeverity:    r.damageSeverity,
      inspectionId:      r.inspectionId?.toString(),
    }));
  },
});

/**
 * Subscribe to all checklist updates made by a specific technician.
 *
 * Returns all checklist_updates rows for the given Kinde user ID, ordered
 * descending by updatedAt.  Uses the by_user index for an
 * O(log n + |user_updates|) lookup.
 *
 * Invalidated by: recordChecklistUpdate({ updatedBy: userId }) — any new
 * update by this technician pushes a live update.
 *
 * Use cases:
 *   • SCAN app "My Activity" tab — technician's checklist update history
 *   • Admin audit: "show all checklist changes made by this user"
 *   • Technician contribution reports
 *
 * Returns an empty array when the user has made no checklist updates.
 *
 * Client usage:
 *   const myUpdates = useQuery(api.scanActions.getChecklistUpdatesByUser, {
 *     userId: kindeUser.id,
 *   });
 */
export const getChecklistUpdatesByUser = query({
  args: {
    /** Kinde user ID of the technician whose checklist update history to retrieve. */
    userId: v.string(),
    /**
     * Optional limit on the number of results returned.
     * Defaults to 50 when not specified.  Cap at 200 for performance.
     */
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ChecklistUpdateRow[]> => {
    await requireAuth(ctx);
    const effectiveLimit = Math.min(args.limit ?? 50, 200);

    const rows = await ctx.db
      .query("checklist_updates")
      .withIndex("by_user", (q) => q.eq("updatedBy", args.userId))
      .order("desc")
      .take(effectiveLimit);

    return rows.map((r) => ({
      _id:               r._id.toString(),
      _creationTime:     r._creationTime,
      caseId:            r.caseId.toString(),
      manifestItemId:    r.manifestItemId.toString(),
      templateItemId:    r.templateItemId,
      itemName:          r.itemName,
      previousStatus:    r.previousStatus,
      newStatus:         r.newStatus,
      updatedBy:         r.updatedBy,
      updatedByName:     r.updatedByName,
      updatedAt:         r.updatedAt,
      notes:             r.notes,
      photoStorageIds:   r.photoStorageIds,
      damageDescription: r.damageDescription,
      damageSeverity:    r.damageSeverity,
      inspectionId:      r.inspectionId?.toString(),
    }));
  },
});

/**
 * Subscribe to checklist update rows for a case filtered by new status.
 *
 * This is the T4 damage panel's primary real-time subscription.  Subscribing
 * with newStatus = "damaged" means the dashboard receives a live push every
 * time a technician marks a new item as damaged in the SCAN app — within the
 * ≤ 2-second fidelity window.
 *
 * Uses the by_case_new_status compound index for an O(log n + |results|)
 * lookup — avoiding a full case history scan when only one status bucket
 * is needed.
 *
 * Invalidated by: recordChecklistUpdate({ caseId, newStatus }) — any new
 * update matching both caseId and newStatus pushes a live update.
 *
 * Valid newStatus values:
 *   "unchecked" — items reverted to not-yet-reviewed (rare — undo flow)
 *   "ok"        — items confirmed present and undamaged
 *   "damaged"   — items present but with documented damage
 *   "missing"   — items not found during inspection
 *
 * Use cases:
 *   • T4 dashboard damage panel: live feed of damaged items as field inspection
 *     progresses — each new "damaged" update appears immediately
 *   • Dashboard summary: count of items in each status bucket
 *   • SCAN app review screen: group updates by outcome
 *
 * Returns an empty array when no updates match — never null.
 *
 * Client usage:
 *   // T4 panel: live stream of damage events for a case
 *   const damageUpdates = useQuery(api.scanActions.getItemUpdatesByStatus, {
 *     caseId,
 *     newStatus: "damaged",
 *   });
 *
 *   // SCAN app: all items confirmed OK in this inspection
 *   const okUpdates = useQuery(api.scanActions.getItemUpdatesByStatus, {
 *     caseId,
 *     newStatus: "ok",
 *   });
 */
export const getItemUpdatesByStatus = query({
  args: {
    /** Convex ID of the case to query. */
    caseId: v.id("cases"),
    /**
     * Item status to filter by.
     * Matches checklist_updates.newStatus — the second field in the
     * by_case_new_status compound index.
     */
    newStatus: manifestItemStatusValidator,
  },
  handler: async (ctx, args): Promise<ChecklistUpdateRow[]> => {
    await requireAuth(ctx);
    // Use the by_case_new_status compound index — O(log n + |results|).
    // This avoids loading all updates for the case and filtering in memory
    // when the caller only needs updates in one specific status bucket.
    const rows = await ctx.db
      .query("checklist_updates")
      .withIndex("by_case_new_status", (q) =>
        q.eq("caseId", args.caseId).eq("newStatus", args.newStatus)
      )
      .order("desc")
      .collect();

    return rows.map((r) => ({
      _id:               r._id.toString(),
      _creationTime:     r._creationTime,
      caseId:            r.caseId.toString(),
      manifestItemId:    r.manifestItemId.toString(),
      templateItemId:    r.templateItemId,
      itemName:          r.itemName,
      previousStatus:    r.previousStatus,
      newStatus:         r.newStatus,
      updatedBy:         r.updatedBy,
      updatedByName:     r.updatedByName,
      updatedAt:         r.updatedAt,
      notes:             r.notes,
      photoStorageIds:   r.photoStorageIds,
      damageDescription: r.damageDescription,
      damageSeverity:    r.damageSeverity,
      inspectionId:      r.inspectionId?.toString(),
    }));
  },
});
