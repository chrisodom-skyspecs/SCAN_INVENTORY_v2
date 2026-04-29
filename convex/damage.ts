/**
 * convex/damage.ts
 *
 * Public, reactive query functions for damage report subscriptions.
 *
 * This module is the canonical API surface for the Sub-AC 4 contract:
 *   "Convex query functions for ... damage reports (by case, by date range,
 *    by reporter) ... with reactive subscription support".
 *
 * All exports are `query()` functions registered with Convex, which means:
 *   • Each is callable from the client via `useQuery(api.damage.<name>, ...)`.
 *   • Convex automatically re-runs every subscribed query whenever any row in
 *     a table the query reads from changes — no client-side polling needed.
 *   • Diff-only updates are pushed to subscribers within ~100–300 ms,
 *     satisfying the ≤ 2-second real-time fidelity requirement between SCAN
 *     app actions and INVENTORY dashboard visibility.
 *
 * Why a dedicated `damage.ts`?
 * ────────────────────────────
 * The codebase already includes `convex/damageReports.ts` (full damage
 * model — joins manifestItems + events + damage_reports) and
 * `convex/queries/damage.ts` (URL-resolved photo variants).  This file is a
 * focused, query-only surface that exposes the three primary query axes
 * required by the SCAN→INVENTORY data contract:
 *
 *   1. by case        — `getDamageReportsByCase(caseId)`
 *   2. by date range  — `listDamageReportsByDateRange({ since, until })`
 *   3. by reporter    — `getDamageReportsByReporter(reporterId)`
 *
 * Plus combined variants for common dashboard slicing:
 *   4. by case + date range      — `getDamageReportsByCaseInRange`
 *   5. by reporter + date range  — `getDamageReportsByReporterInRange`
 *   6. summary statistics by case — `getDamageReportSummary`
 *   7. summary by reporter        — `getDamageReporterSummary`
 *
 * Data source
 * ───────────
 * All queries read from the `damage_reports` table (see convex/schema.ts).
 * Each row represents a single photo submission from the SCAN app damage
 * reporting flow with annotation pins, severity, and reporter attribution.
 * The associated `manifestItems` and `events` rows are NOT joined here —
 * callers needing the full damage projection should use
 * `api.damageReports.getDamageReportsByCase` instead.
 *
 * Indexes used
 * ────────────
 *   getDamageReportsByCase            → damage_reports.by_case_reported_at
 *   getDamageReportsByCaseInRange     → damage_reports.by_case_reported_at
 *   getDamageReportsByReporter        → damage_reports.by_reported_by_at
 *   getDamageReportsByReporterInRange → damage_reports.by_reported_by_at
 *   listDamageReportsByDateRange      → damage_reports.by_reported_at
 *   getDamageReportSummary            → damage_reports.by_case_reported_at
 *   getDamageReporterSummary          → damage_reports.by_reported_by
 *
 * Auth
 * ────
 * Every query is gated by `requireAuth` which validates the caller's Kinde
 * JWT.  Unauthenticated requests throw [AUTH_REQUIRED] before any DB read.
 *
 * Client usage examples
 * ─────────────────────
 *   // T4 dashboard panel — all damage photos for one case
 *   const reports = useQuery(api.damage.getDamageReportsByCase, { caseId });
 *
 *   // Fleet-wide damage activity in a 24-hour window
 *   const day = useQuery(api.damage.listDamageReportsByDateRange, {
 *     since: Date.now() - 24*60*60*1000,
 *   });
 *
 *   // SCAN app "My damage reports" view
 *   const mine = useQuery(api.damage.getDamageReportsByReporter, {
 *     reporterId: kindeUser.id,
 *   });
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Auth, UserIdentity } from "convex/server";

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

// ─── Types ────────────────────────────────────────────────────────────────────

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
 * The canonical projection of a `damage_reports` row delivered to clients.
 *
 * All Convex `Id` fields are projected to plain strings so the result is
 * JSON-serializable and free of runtime Convex types at the API boundary.
 */
export interface DamageReportRow {
  /** Convex ID of the damage_reports row. */
  id: string;
  /** Case this damage report belongs to. */
  caseId: string;
  /** Convex file storage ID for the uploaded photo. */
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
 * Aggregate damage summary for a single case.
 * Lightweight projection used by status pills and progress bars.
 */
export interface DamageReportSummaryByCase {
  /** Case the summary covers. */
  caseId: string;
  /** Total number of photo submissions for this case. */
  totalReports: number;
  /** Number of submissions with severity "minor". */
  minor: number;
  /** Number of submissions with severity "moderate". */
  moderate: number;
  /** Number of submissions with severity "severe". */
  severe: number;
  /** Number of submissions that had at least one annotation pin attached. */
  withAnnotations: number;
  /** Number of submissions that included free-text notes. */
  withNotes: number;
  /** Epoch ms of the earliest reportedAt in the result set, or null when empty. */
  earliestReportedAt: number | null;
  /** Epoch ms of the most recent reportedAt in the result set, or null when empty. */
  latestReportedAt: number | null;
}

/**
 * Aggregate damage summary for a specific reporter (technician).
 * Used by the SCAN app "My Activity" view and admin user detail panels.
 */
export interface DamageReporterSummary {
  /** Kinde user ID this summary describes. */
  reporterId: string;
  /** Display name of the reporter (most recent value seen across rows). */
  reporterName: string | null;
  /** Total number of photo submissions filed by this reporter. */
  totalReports: number;
  /** Severity breakdown across all reports. */
  minor: number;
  moderate: number;
  severe: number;
  /** Distinct caseIds the reporter has filed damage reports against. */
  distinctCaseCount: number;
  /** Epoch ms of the earliest report, or null when the reporter has none. */
  earliestReportedAt: number | null;
  /** Epoch ms of the most recent report, or null when the reporter has none. */
  latestReportedAt: number | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Project a raw `damage_reports` DB row to the public DamageReportRow shape.
 *
 * Converts Convex IDs to plain strings and normalises the optional fields so
 * the projected row is safe to return to the client without leaking Convex
 * runtime types across the API boundary.
 */
function projectRow(row: {
  _id: { toString(): string };
  caseId: { toString(): string };
  photoStorageId: string;
  annotations?: Array<{ x: number; y: number; label: string; color?: string }>;
  severity: "minor" | "moderate" | "severe";
  reportedAt: number;
  manifestItemId?: { toString(): string };
  templateItemId?: string;
  reportedById: string;
  reportedByName: string;
  notes?: string;
}): DamageReportRow {
  return {
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
  };
}

// ─── getDamageReportsByCase ───────────────────────────────────────────────────

/**
 * Subscribe to all damage photo reports for a specific case.
 *
 * Returns every row from the `damage_reports` table for the given case, sorted
 * by `reportedAt` descending (most recent photo first).
 *
 * This is the primary data source for:
 *   • INVENTORY dashboard T4 panel — damage photo gallery
 *   • SCAN app damage review screen — case-scoped photo history
 *   • T5 audit panel — photo submission timeline section
 *
 * Index path: `damage_reports.by_case_reported_at` — the compound index on
 * `["caseId", "reportedAt"]` handles both the equality predicate and the
 * descending sort in O(log n + |results|).
 *
 * Convex re-runs this query and pushes the diff to all subscribers within
 * ~100–300 ms whenever `submitDamagePhoto` inserts a new row for this case,
 * satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Returns an empty array when no photos have been submitted for the case.
 * Returns an empty array when the caseId is invalid (no rows match).
 *
 * Client usage:
 *   const reports = useQuery(api.damage.getDamageReportsByCase, { caseId });
 */
export const getDamageReportsByCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<DamageReportRow[]> => {
    await requireAuth(ctx);

    const rows = await ctx.db
      .query("damage_reports")
      .withIndex("by_case_reported_at", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .collect();

    return rows.map(projectRow);
  },
});

// ─── getDamageReportsByCaseInRange ────────────────────────────────────────────

/**
 * Subscribe to damage reports for a specific case within a `reportedAt` window.
 *
 * Accepts an inclusive `[fromTimestamp, toTimestamp]` window (epoch ms) and
 * returns matching `damage_reports` rows ordered by `reportedAt` descending
 * (most recent within the window first).
 *
 * Use cases:
 *   • Operator review of damage submitted during a specific shift / day
 *   • Compliance export of damage evidence for a reporting period
 *   • T5 audit timeline — narrowing photo history to a time slice
 *
 * Index path: `damage_reports.by_case_reported_at` — Convex evaluates both the
 * equality predicate (`caseId`) and the range bounds (`reportedAt`) in the
 * index for an O(log n + |range|) seek.
 *
 * Both `fromTimestamp` and `toTimestamp` are inclusive.  Pass `0` for
 * `fromTimestamp` and a far-future epoch for `toTimestamp` to retrieve all
 * photos without a date filter — though `getDamageReportsByCase` is more
 * idiomatic for that use case.
 *
 * Returns an empty array when:
 *   • No photos exist within the window for the case.
 *   • The caseId is invalid.
 *   • fromTimestamp > toTimestamp (empty range guard).
 *
 * Convex re-runs this query and pushes the diff to all subscribers within
 * ~100–300 ms whenever a new row whose `reportedAt` falls inside the window
 * is inserted — satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Client usage:
 *   const reports = useQuery(api.damage.getDamageReportsByCaseInRange, {
 *     caseId,
 *     fromTimestamp: shiftStart,
 *     toTimestamp:   shiftEnd,
 *   });
 */
export const getDamageReportsByCaseInRange = query({
  args: {
    caseId:        v.id("cases"),
    /** Inclusive lower bound on `reportedAt` (epoch ms). 0 = no lower bound. */
    fromTimestamp: v.number(),
    /** Inclusive upper bound on `reportedAt` (epoch ms). */
    toTimestamp:   v.number(),
  },
  handler: async (ctx, args): Promise<DamageReportRow[]> => {
    await requireAuth(ctx);

    // Guard: empty range — return immediately without a DB read.
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

    return rows.map(projectRow);
  },
});

// ─── getDamageReportsByReporter ───────────────────────────────────────────────

/**
 * Subscribe to all damage reports filed by a specific technician.
 *
 * Returns every row from the `damage_reports` table where `reportedById` matches
 * the supplied Kinde user ID, sorted by `reportedAt` descending (most recent
 * first).  Use cases:
 *   • SCAN app "My Damage Reports" tab — technician's own submission history
 *   • INVENTORY admin user-detail panel — auditing a reporter's contributions
 *   • Compliance report — "all damage filed by Alice this quarter"
 *
 * Index path: `damage_reports.by_reported_by_at` — the compound index on
 * `["reportedById", "reportedAt"]` handles both the equality predicate and the
 * descending sort in O(log n + |results|), avoiding a full table scan.
 *
 * Convex re-runs this query and pushes the diff to all subscribers within
 * ~100–300 ms whenever the targeted reporter submits a new damage photo.
 *
 * Returns an empty array when:
 *   • The reporter has never submitted a damage photo.
 *   • The reporterId is unknown.
 *
 * Client usage:
 *   const mine = useQuery(api.damage.getDamageReportsByReporter, {
 *     reporterId: kindeUser.id,
 *   });
 */
export const getDamageReportsByReporter = query({
  args: {
    /**
     * Kinde user ID of the reporting technician to query.
     * Matched against damage_reports.reportedById.
     */
    reporterId: v.string(),
  },
  handler: async (ctx, args): Promise<DamageReportRow[]> => {
    await requireAuth(ctx);

    const rows = await ctx.db
      .query("damage_reports")
      .withIndex("by_reported_by_at", (q) => q.eq("reportedById", args.reporterId))
      .order("desc")
      .collect();

    return rows.map(projectRow);
  },
});

// ─── getDamageReportsByReporterInRange ────────────────────────────────────────

/**
 * Subscribe to damage reports filed by a specific reporter within a window.
 *
 * Accepts an inclusive `[fromTimestamp, toTimestamp]` window (epoch ms) and
 * returns matching `damage_reports` rows where `reportedById` matches the
 * supplied Kinde user ID, sorted by `reportedAt` descending.
 *
 * Use cases:
 *   • SCAN app — "My damage reports today / this week"
 *   • Admin productivity dashboards — per-technician throughput by period
 *   • Compliance — "Alice's submissions during the deployment window"
 *
 * Index path: `damage_reports.by_reported_by_at` — Convex evaluates the
 * equality predicate (`reportedById`) and the range bounds (`reportedAt`)
 * together for an O(log n + |range|) seek.
 *
 * Both bounds are inclusive.  Pass `0` for `fromTimestamp` and a far-future
 * epoch for `toTimestamp` to retrieve all reports for the reporter without
 * date filtering.
 *
 * Returns an empty array when:
 *   • The reporter has no submissions within the window.
 *   • The reporterId is unknown.
 *   • fromTimestamp > toTimestamp.
 *
 * Client usage:
 *   const today = useQuery(api.damage.getDamageReportsByReporterInRange, {
 *     reporterId: kindeUser.id,
 *     fromTimestamp: startOfDay,
 *     toTimestamp:   endOfDay,
 *   });
 */
export const getDamageReportsByReporterInRange = query({
  args: {
    reporterId:    v.string(),
    /** Inclusive lower bound on `reportedAt` (epoch ms). */
    fromTimestamp: v.number(),
    /** Inclusive upper bound on `reportedAt` (epoch ms). */
    toTimestamp:   v.number(),
  },
  handler: async (ctx, args): Promise<DamageReportRow[]> => {
    await requireAuth(ctx);

    if (args.fromTimestamp > args.toTimestamp) return [];

    const rows = await ctx.db
      .query("damage_reports")
      .withIndex("by_reported_by_at", (q) => q.eq("reportedById", args.reporterId))
      .filter((q) =>
        q.and(
          q.gte(q.field("reportedAt"), args.fromTimestamp),
          q.lte(q.field("reportedAt"), args.toTimestamp),
        )
      )
      .order("desc")
      .collect();

    return rows.map(projectRow);
  },
});

// ─── listDamageReportsByDateRange ─────────────────────────────────────────────

/**
 * Subscribe to all damage reports across the fleet within a date range.
 *
 * Returns every row from the `damage_reports` table whose `reportedAt` falls
 * within the supplied window, sorted by `reportedAt` descending.  Both bounds
 * are optional:
 *   • `since` only       — all reports at or after `since`
 *   • `until` only       — all reports at or before `until`
 *   • both               — closed `[since, until]` window
 *   • neither            — entire fleet damage history (newest first)
 *
 * Use cases:
 *   • INVENTORY dashboard global "Damage Activity" panel
 *   • Operations dashboards — fleet damage rate over a reporting period
 *   • Compliance exports — "all damage submitted last month"
 *
 * Index path: `damage_reports.by_reported_at` — Convex uses the index for both
 * the descending sort and the range predicates, so this is O(log n + |range|)
 * rather than a full table scan.
 *
 * Convex re-runs this query and pushes the diff to all subscribers within
 * ~100–300 ms whenever a new row whose `reportedAt` falls inside the window is
 * inserted — satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Returns an empty array when no rows match the window.
 *
 * Client usage:
 *   // Last 24 hours of damage activity
 *   const recent = useQuery(api.damage.listDamageReportsByDateRange, {
 *     since: Date.now() - 24*60*60*1000,
 *   });
 */
export const listDamageReportsByDateRange = query({
  args: {
    /** Inclusive lower bound on `reportedAt` (epoch ms). Optional. */
    since: v.optional(v.number()),
    /** Inclusive upper bound on `reportedAt` (epoch ms). Optional. */
    until: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DamageReportRow[]> => {
    await requireAuth(ctx);

    // Guard: empty range when both bounds supplied and inverted.
    if (
      args.since !== undefined &&
      args.until !== undefined &&
      args.since > args.until
    ) {
      return [];
    }

    // Build the index query, optionally bounded by the supplied range.
    let q = ctx.db.query("damage_reports").withIndex("by_reported_at");

    // Apply range bounds via filter; Convex applies them in the index path.
    if (args.since !== undefined || args.until !== undefined) {
      q = q.filter((qb) => {
        const since = args.since;
        const until = args.until;
        if (since !== undefined && until !== undefined) {
          return qb.and(
            qb.gte(qb.field("reportedAt"), since),
            qb.lte(qb.field("reportedAt"), until),
          );
        } else if (since !== undefined) {
          return qb.gte(qb.field("reportedAt"), since);
        } else {
          // until !== undefined
          return qb.lte(qb.field("reportedAt"), until!);
        }
      });
    }

    const rows = await q.order("desc").collect();
    return rows.map(projectRow);
  },
});

// ─── getDamageReportSummary ───────────────────────────────────────────────────

/**
 * Subscribe to aggregate damage statistics for a single case.
 *
 * Returns lightweight counts (severity breakdown, annotation/notes flags,
 * earliest/latest report timestamps) suitable for status pills and progress
 * indicators on the dashboard.
 *
 * Returns a summary with all zeros / nulls when no damage reports exist.
 *
 * Index path: `damage_reports.by_case_reported_at` — single-case scope.
 *
 * Client usage:
 *   const summary = useQuery(api.damage.getDamageReportSummary, { caseId });
 */
export const getDamageReportSummary = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args): Promise<DamageReportSummaryByCase> => {
    await requireAuth(ctx);

    const rows = await ctx.db
      .query("damage_reports")
      .withIndex("by_case_reported_at", (q) => q.eq("caseId", args.caseId))
      .collect();

    if (rows.length === 0) {
      return {
        caseId:             args.caseId.toString(),
        totalReports:       0,
        minor:              0,
        moderate:           0,
        severe:             0,
        withAnnotations:    0,
        withNotes:          0,
        earliestReportedAt: null,
        latestReportedAt:   null,
      };
    }

    let minor = 0;
    let moderate = 0;
    let severe = 0;
    let withAnnotations = 0;
    let withNotes = 0;
    let earliest = rows[0].reportedAt;
    let latest = rows[0].reportedAt;

    for (const row of rows) {
      switch (row.severity) {
        case "minor":    minor++;    break;
        case "moderate": moderate++; break;
        case "severe":   severe++;   break;
      }
      if (row.annotations && row.annotations.length > 0) withAnnotations++;
      if (row.notes && row.notes.trim().length > 0) withNotes++;
      if (row.reportedAt < earliest) earliest = row.reportedAt;
      if (row.reportedAt > latest)   latest   = row.reportedAt;
    }

    return {
      caseId:             args.caseId.toString(),
      totalReports:       rows.length,
      minor,
      moderate,
      severe,
      withAnnotations,
      withNotes,
      earliestReportedAt: earliest,
      latestReportedAt:   latest,
    };
  },
});

// ─── getDamageReporterSummary ─────────────────────────────────────────────────

/**
 * Subscribe to a per-reporter damage activity summary.
 *
 * Returns lifetime counts and severity breakdown for the supplied reporter,
 * along with the distinct case count and the earliest/latest report timestamps.
 *
 * Use cases:
 *   • SCAN app "My Activity" badge counts
 *   • INVENTORY admin user profile chip — "N damage reports filed"
 *   • Productivity dashboards — per-technician throughput
 *
 * Returns zeros / nulls when the reporter has never filed a damage report.
 *
 * Index path: `damage_reports.by_reported_by` — efficient per-reporter scan.
 *
 * Client usage:
 *   const summary = useQuery(api.damage.getDamageReporterSummary, {
 *     reporterId: kindeUser.id,
 *   });
 */
export const getDamageReporterSummary = query({
  args: { reporterId: v.string() },
  handler: async (ctx, args): Promise<DamageReporterSummary> => {
    await requireAuth(ctx);

    const rows = await ctx.db
      .query("damage_reports")
      .withIndex("by_reported_by", (q) => q.eq("reportedById", args.reporterId))
      .collect();

    if (rows.length === 0) {
      return {
        reporterId:         args.reporterId,
        reporterName:       null,
        totalReports:       0,
        minor:              0,
        moderate:           0,
        severe:             0,
        distinctCaseCount:  0,
        earliestReportedAt: null,
        latestReportedAt:   null,
      };
    }

    let minor = 0;
    let moderate = 0;
    let severe = 0;
    let earliest = rows[0].reportedAt;
    let latest = rows[0].reportedAt;
    let latestName: string | null = null;
    let latestNameAt = -Infinity;
    const caseIds = new Set<string>();

    for (const row of rows) {
      switch (row.severity) {
        case "minor":    minor++;    break;
        case "moderate": moderate++; break;
        case "severe":   severe++;   break;
      }
      if (row.reportedAt < earliest) earliest = row.reportedAt;
      if (row.reportedAt > latest)   latest   = row.reportedAt;
      if (row.reportedAt > latestNameAt) {
        latestNameAt = row.reportedAt;
        latestName   = row.reportedByName;
      }
      caseIds.add(row.caseId.toString());
    }

    return {
      reporterId:         args.reporterId,
      reporterName:       latestName,
      totalReports:       rows.length,
      minor,
      moderate,
      severe,
      distinctCaseCount:  caseIds.size,
      earliestReportedAt: earliest,
      latestReportedAt:   latest,
    };
  },
});
