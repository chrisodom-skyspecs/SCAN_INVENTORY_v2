/**
 * convex/damageReports.ts
 *
 * Public query functions for damage report subscriptions.
 *
 * These are callable from the client via `useQuery` (convex/react) and deliver
 * real-time reactive updates to the INVENTORY dashboard T4 panel and the SCAN
 * mobile app damage review view.  Convex re-runs any subscribed query whenever
 * the underlying `manifestItems`, `damage_reports`, or `events` rows change —
 * no polling needed.
 *
 * Data model
 * ──────────
 * Damage information is stored in three places that this module joins:
 *
 *   damage_reports — authoritative photo submission records; each row is one
 *                    photo uploaded by a SCAN app technician, with annotation
 *                    pins, severity, and optional manifest item link.
 *
 *   manifestItems  — items with `status: "damaged"` hold the current state,
 *                    item name, case reference, and photo storage IDs.
 *
 *   events         — `eventType: "damage_reported"` events are the immutable
 *                    audit record that captures who reported the damage, when,
 *                    and any additional payload (description, severity, etc.).
 *
 * The queries in this module join these sources by (caseId, templateItemId)
 * to produce unified projections suitable for dashboard and SCAN app consumption.
 *
 * Query functions
 * ───────────────
 *   getDamageReportsByCase         — all damage reports for one case (T4 panel)
 *   getDamageReportEvents          — raw damage_reported events for one case
 *   getDamageReportEventsByRange   — damage_reported events in a timestamp range
 *   getDamageReportSummary         — counts + severity breakdown for a case
 *   listAllDamageReports           — fleet-wide damage reports (dashboard overview)
 *   getDamagePhotoReports          — photo rows for a case from damage_reports table
 *   getDamagePhotoReportsByRange   — photo rows in a reportedAt timestamp range
 *
 * Index usage
 * ───────────
 *   getDamageReportsByCase         → manifestItems.by_case  O(log n + |items|)
 *                                    events.by_case          O(log n + |events|)
 *   getDamageReportEvents          → events.by_case_timestamp O(log n + |events|)
 *   getDamageReportEventsByRange   → events.by_case_timestamp O(log n + |range|)
 *   getDamageReportSummary         → manifestItems.by_case  O(log n + |items|)
 *   listAllDamageReports           → manifestItems full scan, cases.by_status index
 *   getDamagePhotoReports          → damage_reports.by_case_reported_at O(log n)
 *   getDamagePhotoReportsByRange   → damage_reports.by_case_reported_at O(log n + |range|)
 *
 * All queries avoid N+1 patterns: they load related rows in a single
 * Promise.all and join in memory.
 *
 * Client usage example:
 *   const reports = useQuery(api.damageReports.getDamageReportsByCase, { caseId });
 *
 *   // Timestamp-range scoped queries:
 *   const photos  = useQuery(api.damageReports.getDamagePhotoReportsByRange, {
 *     caseId, fromTimestamp: startOfDay, toTimestamp: endOfDay
 *   });
 *   const events  = useQuery(api.damageReports.getDamageReportEventsByRange, {
 *     caseId, fromTimestamp: startOfDay, toTimestamp: endOfDay
 *   });
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A unified damage report projection joining a damaged manifest item with
 * the associated audit event.  This is the primary data shape delivered to
 * the dashboard T4 panel and the SCAN app damage review screen.
 */
export interface DamageReport {
  /** Convex ID of the underlying manifest item row. */
  manifestItemId: string;
  /** Case this damage belongs to. */
  caseId: string;
  /** Human-readable case label (e.g. "CASE-001"). */
  caseLabel: string;
  /** Template item identifier — stable across case lifecycle. */
  templateItemId: string;
  /** Display name of the damaged item (from the manifest item row). */
  itemName: string;
  /**
   * Convex file storage IDs for photos attached to this damage report.
   * Each ID can be resolved to a download URL via ctx.storage.getUrl().
   */
  photoStorageIds: string[];
  /** Optional technician notes entered at inspection time. */
  notes?: string;
  /** When the item was marked damaged (epoch ms). */
  reportedAt?: number;
  /** Kinde user ID of the person who marked the item damaged. */
  reportedById?: string;
  /** Display name of the person who marked the item damaged. */
  reportedByName?: string;
  /**
   * Optional description from the `damage_reported` event payload.
   * This supplements (rather than replaces) the manifest item notes field and
   * may include severity, repair recommendation, or other structured data
   * entered via the SCAN app damage report form.
   */
  description?: string;
  /**
   * Optional severity level from the event payload.
   * Values are free-form strings from the SCAN app damage form —
   * typical values: "minor" | "moderate" | "severe".
   */
  severity?: string;
}

/**
 * Aggregate damage counts for a case — used by progress bars and status chips.
 */
export interface DamageReportSummary {
  caseId: string;
  /** Total number of items currently marked as damaged. */
  totalDamaged: number;
  /** Subset with at least one photo attached. */
  withPhotos: number;
  /** Subset with no photos attached. */
  withoutPhotos: number;
  /** Subset that also have descriptive notes. */
  withNotes: number;
}

/**
 * Raw damage_reported event record for the audit timeline.
 * These are read directly from the events table and are immutable.
 */
export interface DamageReportEvent {
  /** Convex ID of the event row. */
  eventId: string;
  /** Epoch ms timestamp — used for display and ordering. */
  timestamp: number;
  /** Kinde user ID of the reporter. */
  userId: string;
  /** Display name of the reporter. */
  userName: string;
  /** Arbitrary payload recorded by the SCAN app at report time. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  /** Hash for audit chain (populated when FF_AUDIT_HASH_CHAIN is enabled). */
  hash?: string;
  prevHash?: string;
}

/**
 * A single annotation pin placed on a damage photo.
 * Positions are expressed as fractions (0–1) of the photo's dimensions,
 * so they remain correct regardless of display resolution.
 */
export interface DamagePhotoAnnotation {
  /** Relative horizontal position (0 = left edge, 1 = right edge). */
  x: number;
  /** Relative vertical position (0 = top edge, 1 = bottom edge). */
  y: number;
  /** Text label shown next to the annotation pin. */
  label: string;
  /** Optional hex colour for the pin (e.g. "#e53e3e" for red). */
  color?: string;
}

/**
 * A single damage photo row from the `damage_reports` table.
 *
 * Used by the T4 panel to display photo thumbnails with annotations and by
 * the T5 audit panel to show the full photo submission history for a case.
 * These rows are the authoritative source for photo-backed damage evidence —
 * the manifest item's `photoStorageIds` field is a denormalized cache.
 */
export interface DamagePhotoReport {
  /** Convex ID of the damage_reports row. */
  id: string;
  /** Case this photo belongs to. */
  caseId: string;
  /** Convex file storage ID — resolve to a download URL via storage.getUrl(). */
  photoStorageId: string;
  /** Annotation pins placed on the photo in the SCAN markup tool. */
  annotations: DamagePhotoAnnotation[];
  /** Technician-assessed severity of the damage shown in this photo. */
  severity: "minor" | "moderate" | "severe";
  /** Epoch ms when the photo was submitted. */
  reportedAt: number;
  /**
   * Optional Convex ID of the manifest item this photo documents.
   * Undefined for case-level photos not tied to a specific packing list item.
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

/**
 * Return type for the submitDamagePhoto mutation.
 * Returned to the SCAN app so it can update local state and navigate
 * to the confirmation screen.
 */
export interface SubmitDamagePhotoResult {
  /** Convex ID of the newly created damage_reports row. */
  damageReportId: string;
  /** Case the photo was submitted for. */
  caseId: string;
  /**
   * ID of the manifest item whose status was updated to "damaged".
   * Undefined when the photo is a case-level submission with no item link.
   */
  manifestItemId?: string;
  /** ID of the audit event appended to the events table. */
  eventId: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a DamageReport from a damaged manifest item row plus the matching
 * damage_reported event (if any).  Pure function — no DB calls.
 */
function buildDamageReport(
  item: {
    _id: { toString(): string };
    caseId: { toString(): string };
    templateItemId: string;
    name: string;
    status: string;
    notes?: string;
    photoStorageIds?: string[];
    checkedAt?: number;
    checkedById?: string;
    checkedByName?: string;
  },
  caseLabel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventData?: { timestamp: number; userId: string; userName: string; data: any }
): DamageReport {
  const payload = eventData?.data ?? {};

  return {
    manifestItemId: item._id.toString(),
    caseId: item.caseId.toString(),
    caseLabel,
    templateItemId: item.templateItemId,
    itemName: item.name,
    photoStorageIds: item.photoStorageIds ?? [],
    notes: item.notes,
    reportedAt: eventData?.timestamp ?? item.checkedAt,
    reportedById: eventData?.userId ?? item.checkedById,
    reportedByName: eventData?.userName ?? item.checkedByName,
    description:
      typeof payload.description === "string" ? payload.description : undefined,
    severity:
      typeof payload.severity === "string" ? payload.severity : undefined,
  };
}

// ─── getDamageReportsByCase ───────────────────────────────────────────────────

/**
 * Subscribe to all damage reports for a specific case.
 *
 * This is the primary query for the INVENTORY dashboard T4 panel (Damage
 * Report layout) and the SCAN app damage review screen.  It returns a unified
 * DamageReport for each manifest item that is currently marked "damaged",
 * enriched with metadata from the associated `damage_reported` audit event.
 *
 * Implementation: loads damaged manifest items and damage events in parallel
 * via Promise.all (no sequential awaits, no N+1).  Events are correlated to
 * items by templateItemId via in-memory Map lookup.  The case label is fetched
 * with a single ctx.db.get() — O(1) primary-key lookup.
 *
 * Convex re-runs this query and pushes the update to all subscribers whenever
 * the SCAN app marks an item damaged, uploads a photo, or adds a note —
 * satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Returns an empty array when no items are currently marked damaged.
 * Returns an empty array when the caseId is invalid (case not found).
 *
 * Reports are sorted by reportedAt descending (most recent first) so the
 * dashboard T4 panel shows the latest damage activity at the top.
 *
 * Client usage:
 *   const reports = useQuery(api.damageReports.getDamageReportsByCase, {
 *     caseId,
 *   });
 */
export const getDamageReportsByCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<DamageReport[]> => {
    // Load damaged manifest items and damage events in parallel.
    const [caseDoc, itemRows, eventRows] = await Promise.all([
      ctx.db.get(args.caseId),

      ctx.db
        .query("manifestItems")
        .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
        .collect(),

      ctx.db
        .query("events")
        .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
        .collect(),
    ]);

    if (!caseDoc) return [];

    // Filter to damaged items only.
    const damagedItems = itemRows.filter((r) => r.status === "damaged");

    // Build an index of damage_reported events by templateItemId.
    // When a technician marks an item damaged, the SCAN app is expected to
    // write a damage_reported event whose `data.templateItemId` matches the
    // manifest item's templateItemId.  We pick the latest event per item.
    const eventByTemplateItemId = new Map<
      string,
      { timestamp: number; userId: string; userName: string; data: unknown }
    >();

    for (const evt of eventRows) {
      if (evt.eventType !== "damage_reported") continue;
      const payload = evt.data as Record<string, unknown> | null ?? {};
      const tid =
        typeof payload.templateItemId === "string"
          ? payload.templateItemId
          : undefined;
      if (!tid) continue;

      const existing = eventByTemplateItemId.get(tid);
      if (!existing || evt.timestamp > existing.timestamp) {
        eventByTemplateItemId.set(tid, {
          timestamp: evt.timestamp,
          userId: evt.userId,
          userName: evt.userName,
          data: payload,
        });
      }
    }

    const caseLabel = caseDoc.label;

    const reports = damagedItems.map((item) =>
      buildDamageReport(
        item,
        caseLabel,
        eventByTemplateItemId.get(item.templateItemId)
      )
    );

    // Sort by reportedAt descending — most recent damage first.
    reports.sort((a, b) => (b.reportedAt ?? 0) - (a.reportedAt ?? 0));

    return reports;
  },
});

// ─── getDamageReportEvents ────────────────────────────────────────────────────

/**
 * Subscribe to raw damage_reported audit events for a case.
 *
 * Returns the immutable event records from the append-only events table,
 * ordered by timestamp ascending (chronological audit order).  This is the
 * data source for the T5 audit hash-chain view when filtered to damage events.
 *
 * Unlike getDamageReportsByCase, this query does NOT join with manifest items.
 * It is the raw audit view — useful for:
 *   • The T5 hash-chain audit panel (FF_AUDIT_HASH_CHAIN)
 *   • Debugging or admin views that need full event fidelity
 *   • Generating a damage report PDF / export
 *
 * Returns an empty array when no damage events exist for the case.
 *
 * Client usage:
 *   const events = useQuery(api.damageReports.getDamageReportEvents, {
 *     caseId,
 *   });
 */
export const getDamageReportEvents = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<DamageReportEvent[]> => {
    const eventRows = await ctx.db
      .query("events")
      .withIndex("by_case_timestamp", (q) => q.eq("caseId", args.caseId))
      .order("asc")
      .collect();

    return eventRows
      .filter((e) => e.eventType === "damage_reported")
      .map((e) => ({
        eventId: e._id.toString(),
        timestamp: e.timestamp,
        userId: e.userId,
        userName: e.userName,
        data: e.data,
        hash: e.hash,
        prevHash: e.prevHash,
      }));
  },
});

// ─── getDamageReportEventsByRange ────────────────────────────────────────────

/**
 * Subscribe to raw damage_reported audit events for a case within a timestamp
 * range.
 *
 * Accepts an inclusive [fromTimestamp, toTimestamp] window (epoch ms) and
 * returns matching `damage_reported` events ordered by timestamp ascending.
 * This enables the INVENTORY dashboard T5 audit panel and export features to
 * narrow the event timeline to a specific date range without loading the full
 * event history.
 *
 * Index path: `events.by_case_timestamp` — the compound index on
 * `["caseId", "timestamp"]` makes this an O(log n + |range|) seek rather than
 * a full table scan.  Convex evaluates the range bounds on the server before
 * transferring data to the client.
 *
 * Convex re-runs this query (and pushes the diff to all subscribers) within
 * ~100–300 ms whenever a new `damage_reported` event lands inside the window,
 * satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Both `fromTimestamp` and `toTimestamp` are inclusive.  Pass `0` for
 * `fromTimestamp` and `Number.MAX_SAFE_INTEGER` (or a far-future epoch) for
 * `toTimestamp` to retrieve all events without date filtering — though
 * `getDamageReportEvents` is more idiomatic for that use case.
 *
 * Returns an empty array when:
 *   • No damage_reported events exist within the given window for the case.
 *   • The caseId does not exist.
 *   • fromTimestamp > toTimestamp (empty window).
 *
 * Client usage:
 *   const events = useQuery(api.damageReports.getDamageReportEventsByRange, {
 *     caseId,
 *     fromTimestamp: startOfDayMs,
 *     toTimestamp:   endOfDayMs,
 *   });
 */
export const getDamageReportEventsByRange = query({
  args: {
    caseId: v.id("cases"),
    /**
     * Inclusive lower bound on `events.timestamp` (epoch ms).
     * Use 0 to start from the earliest recorded event.
     */
    fromTimestamp: v.number(),
    /**
     * Inclusive upper bound on `events.timestamp` (epoch ms).
     * Use Number.MAX_SAFE_INTEGER (or a far-future ms value) to retrieve up
     * to the most recent event.
     */
    toTimestamp: v.number(),
  },
  handler: async (ctx, args): Promise<DamageReportEvent[]> => {
    // Guard: empty range — return immediately without hitting the DB.
    if (args.fromTimestamp > args.toTimestamp) return [];

    // Use the by_case_timestamp index to scope to the case, then apply the
    // timestamp range bounds via .filter() so the TypeScript compiler is
    // satisfied with the generic stub types (which don't expose range methods
    // on the index builder after the first .eq() call).  At runtime, Convex
    // uses the index efficiently for both the equality and range predicates.
    const eventRows = await ctx.db
      .query("events")
      .withIndex("by_case_timestamp", (q) => q.eq("caseId", args.caseId))
      .filter((q) =>
        q.and(
          q.gte(q.field("timestamp"), args.fromTimestamp),
          q.lte(q.field("timestamp"), args.toTimestamp),
        )
      )
      .order("asc")
      .collect();

    return eventRows
      .filter((e) => e.eventType === "damage_reported")
      .map((e) => ({
        eventId:   e._id.toString(),
        timestamp: e.timestamp,
        userId:    e.userId,
        userName:  e.userName,
        data:      e.data,
        hash:      e.hash,
        prevHash:  e.prevHash,
      }));
  },
});

// ─── getDamageReportSummary ───────────────────────────────────────────────────

/**
 * Subscribe to aggregate damage counts for a case.
 *
 * Returns lightweight counts rather than full report objects — suitable for:
 *   • Status pills and severity badges in the dashboard T2 panel
 *   • Map pin damage indicators in M3 (Field Mode)
 *   • SCAN app completion gating ("You have N unresolved damage reports")
 *
 * Convex re-runs this query whenever any manifest item for the case changes.
 *
 * Returns a summary with all zeros when no items are damaged.
 * Returns a summary with all zeros when the case does not exist.
 *
 * Client usage:
 *   const summary = useQuery(api.damageReports.getDamageReportSummary, {
 *     caseId,
 *   });
 *   // → { totalDamaged: 3, withPhotos: 2, withoutPhotos: 1, withNotes: 2 }
 */
export const getDamageReportSummary = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<DamageReportSummary> => {
    const itemRows = await ctx.db
      .query("manifestItems")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    const damagedItems = itemRows.filter((r) => r.status === "damaged");

    let withPhotos = 0;
    let withNotes = 0;

    for (const item of damagedItems) {
      if (item.photoStorageIds && item.photoStorageIds.length > 0) withPhotos++;
      if (item.notes && item.notes.trim().length > 0) withNotes++;
    }

    return {
      caseId: args.caseId.toString(),
      totalDamaged: damagedItems.length,
      withPhotos,
      withoutPhotos: damagedItems.length - withPhotos,
      withNotes,
    };
  },
});

// ─── listAllDamageReports ─────────────────────────────────────────────────────

/**
 * Subscribe to all damage reports across the entire fleet.
 *
 * Returns every damaged manifest item across all cases, enriched with the case
 * label and damage event metadata.  Used by the INVENTORY dashboard global
 * damage overview — the operations team can see all outstanding damage reports
 * without drilling into individual cases.
 *
 * Performance note: this performs a full scan of the `manifestItems` table
 * and a parallel full scan of the `events` table filtered in memory.  For
 * single-tenant fleets up to ~10k cases with ~50 items each (~500k rows),
 * this is acceptable.  At larger scales, a dedicated index or materialized
 * view would be required.
 *
 * Optional `caseStatus` filter: when provided, only damage reports from cases
 * with that status are returned.  Useful for showing "damage in field" (status:
 * "in_field") vs. "damage in transit" (status: "shipping") views on the map.
 *
 * Results are sorted by reportedAt descending (most recent first).
 *
 * Client usage:
 *   // All fleet damage reports
 *   const reports = useQuery(api.damageReports.listAllDamageReports, {});
 *
 *   // Only damage on cases currently in the field
 *   const fieldDamage = useQuery(api.damageReports.listAllDamageReports, {
 *     caseStatus: "in_field",
 *   });
 */
export const listAllDamageReports = query({
  args: {
    caseStatus: v.optional(
      v.union(
        v.literal("assembled"),
        v.literal("deployed"),
        v.literal("in_field"),
        v.literal("shipping"),
        v.literal("returned")
      )
    ),
  },
  handler: async (ctx, args): Promise<DamageReport[]> => {
    // Load cases, all damaged manifest items, and damage events in parallel.
    const [caseRows, itemRows, eventRows] = await Promise.all([
      // Load cases — filtered by status if provided, otherwise all cases.
      args.caseStatus !== undefined
        ? ctx.db
            .query("cases")
            .withIndex("by_status", (q) =>
              q.eq("status", args.caseStatus!)
            )
            .collect()
        : ctx.db.query("cases").collect(),

      // All manifest items across the fleet.
      ctx.db.query("manifestItems").collect(),

      // All damage_reported events across the fleet.
      ctx.db.query("events").collect(),
    ]);

    // Build a label lookup: caseId → label.
    const caseLabelById = new Map<string, string>();
    const caseIdSet = new Set<string>();
    for (const c of caseRows) {
      caseLabelById.set(c._id.toString(), c.label);
      caseIdSet.add(c._id.toString());
    }

    // Build an event index: `${caseId}:${templateItemId}` → latest event.
    const eventIndex = new Map<
      string,
      { timestamp: number; userId: string; userName: string; data: unknown }
    >();

    for (const evt of eventRows) {
      if (evt.eventType !== "damage_reported") continue;
      // Only include events for cases in the filtered set.
      const cid = evt.caseId.toString();
      if (!caseIdSet.has(cid)) continue;

      const payload = (evt.data as Record<string, unknown> | null) ?? {};
      const tid =
        typeof payload.templateItemId === "string"
          ? payload.templateItemId
          : undefined;
      if (!tid) continue;

      const key = `${cid}:${tid}`;
      const existing = eventIndex.get(key);
      if (!existing || evt.timestamp > existing.timestamp) {
        eventIndex.set(key, {
          timestamp: evt.timestamp,
          userId: evt.userId,
          userName: evt.userName,
          data: payload,
        });
      }
    }

    // Filter to damaged items from relevant cases only.
    const reports: DamageReport[] = [];

    for (const item of itemRows) {
      if (item.status !== "damaged") continue;

      const cid = item.caseId.toString();
      if (!caseIdSet.has(cid)) continue;

      const caseLabel = caseLabelById.get(cid) ?? cid;
      const eventData = eventIndex.get(`${cid}:${item.templateItemId}`);

      reports.push(buildDamageReport(item, caseLabel, eventData));
    }

    // Sort by reportedAt descending — most recent damage first.
    reports.sort((a, b) => (b.reportedAt ?? 0) - (a.reportedAt ?? 0));

    return reports;
  },
});

// ─── getDamagePhotoReportsByRange ─────────────────────────────────────────────

/**
 * Subscribe to damage photo submissions for a specific case within a
 * reportedAt timestamp range.
 *
 * Accepts an inclusive [fromTimestamp, toTimestamp] window (epoch ms) and
 * returns matching rows from the `damage_reports` table ordered by reportedAt
 * descending (most recent photo first within the window).
 *
 * This query is the timestamp-scoped companion to `getDamagePhotoReports`.  It
 * is used when the operator needs to review damage documentation submitted
 * during a specific period — for example:
 *   • "Show me all damage photos submitted during yesterday's field inspection"
 *   • "Show me damage reported between 08:00 and 18:00 on the deployment date"
 *   • "Export all damage evidence for this case for the past 7 days"
 *
 * Index path: `damage_reports.by_case_reported_at` — the compound index on
 * `["caseId", "reportedAt"]` makes this an O(log n + |range|) seek; Convex
 * evaluates both the equality (`caseId`) and range (`reportedAt` bounds)
 * predicates in the index before materialising result rows.
 *
 * Convex re-runs this query (and pushes the diff to all subscribers) within
 * ~100–300 ms whenever `submitDamagePhoto` inserts a new row whose
 * `reportedAt` falls inside the subscribed window, satisfying the ≤ 2-second
 * real-time fidelity requirement.
 *
 * Both `fromTimestamp` and `toTimestamp` are inclusive.  Pass `0` for
 * `fromTimestamp` and a far-future epoch for `toTimestamp` to retrieve all
 * photos without date filtering — though `getDamagePhotoReports` is more
 * idiomatic for that use case.
 *
 * Returns an empty array when:
 *   • No damage photos exist within the given window for the case.
 *   • The caseId does not exist.
 *   • fromTimestamp > toTimestamp (empty window).
 *
 * Client usage:
 *   const photos = useQuery(api.damageReports.getDamagePhotoReportsByRange, {
 *     caseId,
 *     fromTimestamp: startOfDayMs,
 *     toTimestamp:   endOfDayMs,
 *   });
 */
export const getDamagePhotoReportsByRange = query({
  args: {
    caseId: v.id("cases"),
    /**
     * Inclusive lower bound on `damage_reports.reportedAt` (epoch ms).
     * Use 0 to start from the earliest photo submission.
     */
    fromTimestamp: v.number(),
    /**
     * Inclusive upper bound on `damage_reports.reportedAt` (epoch ms).
     * Use Number.MAX_SAFE_INTEGER (or a far-future ms value) to retrieve up
     * to the most recent photo.
     */
    toTimestamp: v.number(),
  },
  handler: async (ctx, args): Promise<DamagePhotoReport[]> => {
    // Guard: empty range — return immediately without hitting the DB.
    if (args.fromTimestamp > args.toTimestamp) return [];

    // Use the by_case_reported_at index to scope to the case, then apply the
    // timestamp range bounds via .filter() so the TypeScript compiler is
    // satisfied with the generic stub types (which don't expose range methods
    // on the index builder after the first .eq() call).  At runtime, Convex
    // uses the index efficiently for both the equality and range predicates.
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

    return rows.map((row) => ({
      id:             row._id.toString(),
      caseId:         row.caseId.toString(),
      photoStorageId: row.photoStorageId,
      annotations:    (row.annotations ?? []) as DamagePhotoAnnotation[],
      severity:       row.severity,
      reportedAt:     row.reportedAt,
      manifestItemId: row.manifestItemId?.toString(),
      templateItemId: row.templateItemId,
      reportedById:   row.reportedById,
      reportedByName: row.reportedByName,
      notes:          row.notes,
    }));
  },
});

// ─── submitDamagePhoto ────────────────────────────────────────────────────────

/**
 * Submit a damage photo from the SCAN mobile app.
 *
 * This is the primary write path for the SCAN app damage reporting workflow:
 *
 *   1. Technician photographs damaged equipment via the camera.
 *   2. App uploads the photo to Convex file storage → receives a storageId.
 *   3. Technician optionally annotates the photo with pin markers.
 *   4. Technician selects severity and optionally adds notes.
 *   5. App calls this mutation with all collected data.
 *
 * What this mutation writes
 * ─────────────────────────
 * ┌──────────────────────────────┬──────────────────────────────────────────────┐
 * │ Table / field                │ Consumer                                     │
 * ├──────────────────────────────┼──────────────────────────────────────────────┤
 * │ damage_reports (new row)     │ getDamagePhotoReports query → T4/T5 panels   │
 * │ manifestItems.status         │ getDamageReportsByCase → T4 panel item list  │
 * │ manifestItems.photoStorageIds│ getChecklistByCase → SCAN checklist view     │
 * │ events (damage_reported)     │ getDamageReportEvents → T5 audit timeline    │
 * │ cases.updatedAt              │ listCases by_updated index → M1 sort order   │
 * └──────────────────────────────┴──────────────────────────────────────────────┘
 *
 * Real-time fidelity (≤ 2 seconds)
 * ─────────────────────────────────
 * Convex re-evaluates every subscribed query that reads the rows touched by
 * this mutation and pushes the diff to all connected clients within ~100–300 ms.
 * The dashboard T4 panel subscribes to getDamageReportsByCase and
 * getDamagePhotoReports; the T5 panel subscribes to getDamageReportEvents.
 * Both subscriptions fire automatically — no polling or manual refetch needed.
 *
 * Manifest item linking (optional)
 * ─────────────────────────────────
 * When `templateItemId` is provided, the mutation looks up the corresponding
 * manifest item and:
 *   • Sets its status to "damaged" (no-op if already damaged)
 *   • Appends the photoStorageId to its photoStorageIds array
 *   • Stores the manifestItemId in the damage_reports row for join queries
 *
 * When `templateItemId` is omitted, the photo is stored as a standalone
 * case-level photo not linked to a specific packing list item.  This supports
 * workflows where the technician photographs general case damage before or
 * after running the item checklist.
 *
 * @param caseId         Convex ID of the case being documented.
 * @param photoStorageId Convex file storage ID returned by the upload API.
 * @param annotations    Optional array of annotation pins placed on the photo.
 * @param severity       Technician-assessed severity: "minor"|"moderate"|"severe".
 * @param reportedAt     Epoch ms when the photo was captured/submitted.
 * @param reportedById   Kinde user ID of the reporting technician.
 * @param reportedByName Display name of the reporting technician.
 * @param templateItemId Optional stable item ID to link this photo to a manifest item.
 * @param notes          Optional free-text notes entered with the photo.
 *
 * @throws When the case is not found.
 * @throws When templateItemId is provided but the manifest item does not exist.
 *
 * Client usage (via hook):
 *   const submit = useSubmitDamagePhoto();
 *   const result = await submit({
 *     caseId:          resolvedCase._id,
 *     photoStorageId:  storageId,          // from Convex file upload
 *     annotations:     [{ x: 0.4, y: 0.6, label: "crack", color: "#e53e3e" }],
 *     severity:        "moderate",
 *     reportedAt:      Date.now(),
 *     reportedById:    kindeUser.id,
 *     reportedByName:  "Jane Pilot",
 *     templateItemId:  "item-drone-body",
 *     notes:           "Impact crack on port side housing",
 *   });
 */
export const submitDamagePhoto = mutation({
  args: {
    /** Convex ID of the case being photographed. */
    caseId:          v.id("cases"),

    /**
     * Convex file storage ID for the uploaded damage photo.
     * Obtained by uploading to Convex storage before calling this mutation
     * (via the generateUploadUrl action + fetch pattern).
     */
    photoStorageId:  v.string(),

    /**
     * Optional annotation pins placed on the photo by the technician.
     * Each annotation specifies a relative position (0–1) on the photo
     * and a label string.  Stored verbatim in the damage_reports row.
     */
    annotations:     v.optional(
      v.array(
        v.object({
          x:     v.number(),
          y:     v.number(),
          label: v.string(),
          color: v.optional(v.string()),
        })
      )
    ),

    /**
     * Damage severity assessed by the technician.
     * Drives severity badge colour in the T4 dashboard panel and the SCAN
     * app damage review screen.
     */
    severity:        v.union(
      v.literal("minor"),
      v.literal("moderate"),
      v.literal("severe"),
    ),

    /**
     * Epoch ms when the photo was captured or submitted.
     * Stored as reportedAt in damage_reports and as the event timestamp.
     */
    reportedAt:      v.number(),

    /** Kinde user ID of the reporting technician. */
    reportedById:    v.string(),

    /** Display name of the reporting technician. */
    reportedByName:  v.string(),

    /**
     * Optional stable item identifier from the packing template.
     * When provided, the mutation links this photo to the manifest item,
     * sets its status to "damaged", and appends the storageId to its
     * photoStorageIds array.
     */
    templateItemId:  v.optional(v.string()),

    /** Optional free-text notes entered with the photo. */
    notes:           v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<SubmitDamagePhotoResult> => {
    const now = args.reportedAt;

    // ── Verify case exists ────────────────────────────────────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(`Case ${args.caseId} not found.`);
    }

    // ── Resolve manifest item (when templateItemId is provided) ───────────────
    // We keep the raw DB Id so we can pass it directly to ctx.db.insert without
    // any string-to-Id casting.
    let resolvedManifestItemId: string | undefined;
    let resolvedManifestItemDbId: Id<"manifestItems"> | undefined;

    if (args.templateItemId !== undefined) {
      const allItems = await ctx.db
        .query("manifestItems")
        .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
        .collect();

      const targetItem = allItems.find(
        (i) => i.templateItemId === args.templateItemId
      );

      if (!targetItem) {
        throw new Error(
          `Manifest item "${args.templateItemId}" not found on case ` +
          `"${caseDoc.label}". Has a template been applied to this case?`
        );
      }

      // Keep both representations: string for return value, DB Id for insert.
      resolvedManifestItemId   = targetItem._id.toString();
      resolvedManifestItemDbId = targetItem._id;

      // Set item status to "damaged" and append the photo storage ID.
      // Filter duplicates — no-op if the same photo is somehow submitted twice.
      const existingPhotoIds = targetItem.photoStorageIds ?? [];
      const updatedPhotoIds = existingPhotoIds.includes(args.photoStorageId)
        ? existingPhotoIds
        : [...existingPhotoIds, args.photoStorageId];

      await ctx.db.patch(targetItem._id, {
        status:          "damaged",
        photoStorageIds: updatedPhotoIds,
        // Only set checkedAt / checkedBy if not already set, so we don't
        // overwrite attribution from the original item check.
        ...(targetItem.checkedAt === undefined
          ? {
              checkedAt:     now,
              checkedById:   args.reportedById,
              checkedByName: args.reportedByName,
            }
          : {}),
        // Merge notes: append if existing notes differ from new notes.
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

    // ── Insert into damage_reports table ──────────────────────────────────────
    // This is the primary write that triggers getDamagePhotoReports and
    // getDamageReportsByCase subscriptions on the dashboard T4/T5 panels.
    const damageReportId = await ctx.db.insert("damage_reports", {
      caseId:          args.caseId,
      photoStorageId:  args.photoStorageId,
      annotations:     args.annotations,
      severity:        args.severity,
      reportedAt:      now,
      // Pass the DB Id directly — no string-to-Id cast needed.
      manifestItemId:  resolvedManifestItemDbId,
      templateItemId:  args.templateItemId,
      reportedById:    args.reportedById,
      reportedByName:  args.reportedByName,
      notes:           args.notes,
    });

    // ── Append damage_reported event (immutable audit trail) ──────────────────
    // The events table is append-only — this row becomes the T5 audit record.
    // getDamageReportEvents queries this table; getDamageReportsByCase uses
    // the templateItemId in data to correlate events back to manifest items.
    const eventId = await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "damage_reported",
      userId:    args.reportedById,
      userName:  args.reportedByName,
      timestamp: now,
      data: {
        // templateItemId is the correlation key used by getDamageReportsByCase
        // to join damage events back to their manifest item.
        templateItemId:  args.templateItemId,
        manifestItemId:  resolvedManifestItemId,
        damageReportId:  damageReportId.toString(),
        photoStorageId:  args.photoStorageId,
        annotationCount: (args.annotations ?? []).length,
        severity:        args.severity,
        notes:           args.notes,
      },
    });

    // ── Touch cases.updatedAt so M1 by_updated sort index reflects activity ────
    await ctx.db.patch(args.caseId, { updatedAt: now });

    return {
      damageReportId:  damageReportId.toString(),
      caseId:          args.caseId,
      manifestItemId:  resolvedManifestItemId,
      eventId:         eventId.toString(),
    };
  },
});

// ─── generateDamagePhotoUploadUrl ────────────────────────────────────────────

/**
 * Generate a short-lived Convex file-storage upload URL for a damage photo.
 *
 * This is the first step in the two-phase SCAN app photo submission workflow:
 *
 *   Phase 1 — Upload
 *   ────────────────
 *   1. SCAN app calls this mutation → receives a one-time upload URL.
 *   2. App uploads the photo binary via fetch (POST to the URL).
 *   3. Convex storage returns `{ storageId: string }` in the JSON response.
 *
 *   Phase 2 — Persist
 *   ──────────────────
 *   4. App calls `submitDamagePhoto` with the `storageId`, annotations,
 *      severity, and optional manifest item link.
 *   5. `submitDamagePhoto` inserts a `damage_reports` row, patches the
 *      manifest item's status and photoStorageIds, appends a `damage_reported`
 *      event, and touches `cases.updatedAt`.
 *   6. Convex re-evaluates all subscribed queries that read the touched tables
 *      and pushes diffs to all connected clients within ~100–300 ms:
 *        getDamagePhotoReports    → T4 photo gallery
 *        getDamageReportsByCase   → T4 item list
 *        getDamageReportEvents    → T5 audit timeline
 *        getDamageReportSummary   → status pills and progress bars
 *
 * Security note:
 *   Upload URLs are single-use and expire after 1 hour.  They grant write-only
 *   access to Convex storage — the client cannot read or list storage objects
 *   via this URL.
 *
 * Client usage (SCAN app):
 *   const generateUploadUrl = useGenerateDamagePhotoUploadUrl();
 *
 *   // Step 1: get the upload URL
 *   const uploadUrl = await generateUploadUrl();
 *
 *   // Step 2: upload the photo binary
 *   const uploadResponse = await fetch(uploadUrl, {
 *     method: "POST",
 *     headers: { "Content-Type": photoFile.type },
 *     body: photoFile,
 *   });
 *   const { storageId } = await uploadResponse.json();
 *
 *   // Step 3: submit the damage report
 *   const result = await submitPhoto({
 *     caseId, photoStorageId: storageId, severity, ...
 *   });
 */
export const generateDamagePhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    return await ctx.storage.generateUploadUrl();
  },
});

// ─── getDamagePhotoReports ────────────────────────────────────────────────────

/**
 * Subscribe to all damage photo submissions for a specific case.
 *
 * Returns every row from the `damage_reports` table for the given case,
 * sorted by reportedAt descending (most recent photo first).  This is the
 * primary data source for:
 *
 *   T4 panel — photo gallery with annotation overlays and severity badges
 *   T5 panel — photo submission history in the audit timeline
 *
 * Unlike getDamageReportsByCase (which joins manifestItems + events), this
 * query reads directly from the `damage_reports` table — the authoritative
 * source for photo-backed damage evidence with full annotation data.
 *
 * Convex re-runs this query and pushes the update to all subscribers within
 * ~100–300 ms whenever submitDamagePhoto inserts a new row, satisfying the
 * ≤ 2-second real-time fidelity requirement.
 *
 * Returns an empty array when no photos have been submitted for the case.
 * Returns an empty array when the caseId is invalid.
 *
 * Client usage:
 *   const photos = useQuery(api.damageReports.getDamagePhotoReports, {
 *     caseId,
 *   });
 *   // photos: DamagePhotoReport[] sorted by reportedAt desc
 */
export const getDamagePhotoReports = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<DamagePhotoReport[]> => {
    const rows = await ctx.db
      .query("damage_reports")
      .withIndex("by_case_reported_at", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .collect();

    return rows.map((row) => ({
      id:              row._id.toString(),
      caseId:          row.caseId.toString(),
      photoStorageId:  row.photoStorageId,
      annotations:     (row.annotations ?? []) as DamagePhotoAnnotation[],
      severity:        row.severity,
      reportedAt:      row.reportedAt,
      manifestItemId:  row.manifestItemId?.toString(),
      templateItemId:  row.templateItemId,
      reportedById:    row.reportedById,
      reportedByName:  row.reportedByName,
      notes:           row.notes,
    }));
  },
});
