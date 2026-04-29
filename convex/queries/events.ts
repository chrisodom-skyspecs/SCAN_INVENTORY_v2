/**
 * convex/queries/events.ts
 *
 * Chronological case event queries for the INVENTORY dashboard T5 (Audit) panel
 * and the SCAN app case timeline view.
 *
 * The `events` table is an immutable, append-only audit log that captures every
 * significant action on a case in temporal order.  This module exposes public
 * Convex query functions for reading that log.
 *
 * Registered in the Convex API as: api["queries/events"].*
 *
 * Event types captured in the `events` table:
 *   status_change        — case moved to a new lifecycle stage
 *   inspection_started   — checklist workflow opened by a field technician
 *   inspection_completed — checklist workflow completed
 *   item_checked         — individual manifest item marked ok/damaged/missing
 *   damage_reported      — damage photo submitted via SCAN app
 *   shipped              — case handed to FedEx carrier
 *   delivered            — FedEx confirmed delivery at destination
 *   custody_handoff      — physical custody transferred between two persons
 *   note_added           — free-text note or QR code action recorded
 *   photo_added          — photo attached at case level (not item-specific)
 *   mission_assigned     — case linked to a deployment mission
 *   template_applied     — packing list template applied to a case
 *
 * Index strategy
 * ──────────────
 * The `events` table has a compound index:
 *   by_case_timestamp: ["caseId", "timestamp"]
 *
 * Querying with `withIndex("by_case_timestamp", q => q.eq("caseId", id)).order("asc")`
 * produces an O(log n + |events for case|) scan ordered chronologically — no
 * in-memory sort required.
 *
 * Real-time fidelity
 * ──────────────────
 * All queries in this module read the `events` table.  Convex tracks this as a
 * reactive dependency.  Any SCAN app mutation that appends a new event row
 * (scanCheckIn, handoffCustody, shipCase, submitDamagePhoto, etc.) triggers
 * re-evaluation of every active subscriber within ~100–300 ms, satisfying the
 * ≤ 2-second real-time fidelity requirement between SCAN app action and
 * dashboard visibility.
 *
 * Exported query functions:
 *   getCaseEvents         — all events for a case, chronological (timestamp ASC)
 *   getCaseEventsByType   — events filtered to specific type(s), chronological
 *   getLatestCaseEvent    — most recent event for a case
 *   getCaseEventRange     — events within a [fromTimestamp, toTimestamp] window
 *
 * Client usage (after `npx convex dev` regenerates API types):
 *
 *   // Full chronological event stream (T5 audit panel)
 *   const events = useQuery(
 *     api["queries/events"].getCaseEvents,
 *     { caseId },
 *   );
 *   if (events === undefined) return <TimelineSkeleton />;
 *   // events[0].timestamp — earliest event, events[N-1].timestamp — most recent
 *
 *   // Status changes only (case status history sub-section)
 *   const statusEvents = useQuery(
 *     api["queries/events"].getCaseEventsByType,
 *     { caseId, eventTypes: ["status_change"] },
 *   );
 *
 *   // Custody handoffs only (custody chain sub-section)
 *   const custodyEvents = useQuery(
 *     api["queries/events"].getCaseEventsByType,
 *     { caseId, eventTypes: ["custody_handoff"] },
 *   );
 *
 *   // Events within the last 24 hours (live operations view)
 *   const recentEvents = useQuery(
 *     api["queries/events"].getCaseEventRange,
 *     { caseId, fromTimestamp: Date.now() - 86_400_000, toTimestamp: Date.now() },
 *   );
 */

import { query } from "../_generated/server";
import type { Auth, UserIdentity, PaginationResult } from "convex/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

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
 * All valid event type discriminants.
 *
 * Mirrors the `eventType` union in convex/schema.ts.  Exported here so
 * client-side code can reference event type literals without importing
 * Convex server internals.
 */
export type CaseEventType =
  | "status_change"
  | "inspection_started"
  | "inspection_completed"
  | "item_checked"
  | "damage_reported"
  | "shipped"
  | "delivered"
  | "custody_handoff"
  | "note_added"
  | "photo_added"
  | "mission_assigned"
  | "template_applied";

/**
 * A single event record from the immutable audit trail.
 *
 * Each field is a normalised projection of the `events` table row:
 *   • All Convex IDs coerced to plain strings for safe JSON serialisation.
 *   • `data` is the event-specific payload — its shape depends on `eventType`.
 *     See the data shapes below for each event type.
 *   • `hash` / `prevHash` are only present when the FF_AUDIT_HASH_CHAIN feature
 *     flag was enabled at the time the event was written.
 *
 * Data shapes by eventType (informational, not enforced at query time):
 *
 *   status_change:
 *     { fromStatus: string, toStatus: string, lat?: number, lng?: number,
 *       locationName?: string }
 *
 *   custody_handoff:
 *     { fromUserId: string, fromUserName: string, toUserId: string,
 *       toUserName: string, transferredAt: number, notes?: string }
 *
 *   damage_reported:
 *     { manifestItemId?: string, templateItemId?: string, severity: string,
 *       photoStorageId: string, notes?: string }
 *
 *   shipped:
 *     { trackingNumber: string, carrier: string, originName?: string,
 *       destinationName?: string }
 *
 *   inspection_started / inspection_completed:
 *     { inspectionId: string, totalItems: number }
 *
 *   item_checked:
 *     { manifestItemId: string, templateItemId: string, itemName: string,
 *       previousStatus: string, newStatus: string, notes?: string }
 *
 *   note_added:
 *     { action?: string, note?: string } — free-form
 *
 *   mission_assigned:
 *     { missionId: string, missionName: string }
 *
 *   template_applied:
 *     { templateId: string, templateName: string, itemCount: number }
 */
export interface CaseEvent {
  /** Convex document ID of this event row (plain string). */
  _id: string;
  /** Convex document ID of the parent case (plain string). */
  caseId: string;
  /** What kind of event this is — use this to narrow the `data` payload type. */
  eventType: CaseEventType;
  /** Kinde user ID of the actor who triggered this event. */
  userId: string;
  /** Display name of the actor (denormalized from users table at write time). */
  userName: string;
  /**
   * Epoch ms when the event occurred.
   * This is the authoritative ordering field — events are always returned
   * in ascending timestamp order from this module.
   */
  timestamp: number;
  /**
   * Event-specific payload.
   *
   * The concrete shape depends on `eventType` — see the data shapes listed in
   * the CaseEvent JSDoc.  Typed as `Record<string, unknown>` to avoid forcing
   * callers to cast from `any`; narrow with a type guard on `eventType` first.
   */
  data: Record<string, unknown>;
  /**
   * SHA-256 hash of this event's content.
   * Only present when the FF_AUDIT_HASH_CHAIN feature flag was enabled at
   * write time.  Used by the T5 Audit panel to verify chain integrity.
   */
  hash?: string;
  /**
   * Hash of the previous event in the chain.
   * Only present when FF_AUDIT_HASH_CHAIN is enabled.
   * Null string (empty) for the first event in a chain.
   */
  prevHash?: string;
}

// ─── Validator for event type array arg ───────────────────────────────────────

/**
 * Convex value validator for the eventType union.
 * Used in getCaseEventsByType to validate the `eventTypes` filter array.
 */
const eventTypeValidator = v.union(
  v.literal("status_change"),
  v.literal("inspection_started"),
  v.literal("inspection_completed"),
  v.literal("item_checked"),
  v.literal("damage_reported"),
  v.literal("shipped"),
  v.literal("delivered"),
  v.literal("custody_handoff"),
  v.literal("note_added"),
  v.literal("photo_added"),
  v.literal("mission_assigned"),
  v.literal("template_applied"),
);

// ─── Shared row → CaseEvent projection ───────────────────────────────────────

/**
 * Project a raw `events` table row to a serialisable `CaseEvent` shape.
 *
 * Coerces Convex IDs to plain strings and ensures `data` is typed as
 * `Record<string, unknown>` rather than `any` so callers don't need explicit
 * casts.
 *
 * Extracted from query handlers so the transformation is testable in isolation.
 */
function projectEvent(row: {
  _id: { toString(): string };
  caseId: { toString(): string };
  eventType: string;
  userId: string;
  userName: string;
  timestamp: number;
  data: unknown;
  hash?: string;
  prevHash?: string;
}): CaseEvent {
  const event: CaseEvent = {
    _id:       row._id.toString(),
    caseId:    row.caseId.toString(),
    eventType: row.eventType as CaseEventType,
    userId:    row.userId,
    userName:  row.userName,
    timestamp: row.timestamp,
    data:      (row.data ?? {}) as Record<string, unknown>,
  };
  if (row.hash !== undefined)     event.hash     = row.hash;
  if (row.prevHash !== undefined) event.prevHash = row.prevHash;
  return event;
}

// ─── getCaseEvents ────────────────────────────────────────────────────────────

/**
 * Subscribe to all events for a case in chronological order (oldest first).
 *
 * Returns every row from the `events` table for the given `caseId`, ordered by
 * `timestamp` ascending — the earliest recorded event at index 0, the most
 * recent at index N-1.
 *
 * This is the primary query for:
 *   • INVENTORY dashboard T5 (Audit) panel — full event timeline
 *   • SCAN app case detail — "History" tab showing all past actions
 *   • Compliance reporting — complete immutable record in chronological order
 *
 * Index path: `events.by_case_timestamp` — compound index on ["caseId", "timestamp"].
 * Ordering by `asc` produces chronological output in O(log n + |events for case|)
 * without any client-side or server-side sort pass.
 *
 * Real-time fidelity:
 *   Convex re-evaluates and pushes the updated event list to all subscribers
 *   within ~100–300 ms whenever any SCAN app mutation inserts a new event row
 *   for this case.  The T5 panel receives new events (status transitions,
 *   damage photos, custody handoffs) without any user action.
 *
 * Return values:
 *   `undefined`    — query is loading (initial fetch or reconnect)
 *   `CaseEvent[]`  — chronological event list (empty array when no events exist)
 *
 * @param caseId  Convex case document ID.
 *
 * Client usage:
 *   const events = useQuery(
 *     api["queries/events"].getCaseEvents,
 *     { caseId },
 *   );
 *   if (events === undefined) return <TimelineSkeleton />;
 *   if (events.length === 0)  return <EmptyTimeline />;
 *   return <EventTimeline events={events} />;
 */
export const getCaseEvents = query({
  args: { caseId: v.id("cases") },

  handler: async (ctx, args): Promise<CaseEvent[]> => {
    await requireAuth(ctx);

    // O(log n + |events for case|) via compound index.
    // asc order = chronological (timestamp ascending = oldest first).
    const rows = await ctx.db
      .query("events")
      .withIndex("by_case_timestamp", (q) => q.eq("caseId", args.caseId))
      .order("asc")
      .collect();

    return rows.map(projectEvent);
  },
});

// ─── getCaseEventsByType ──────────────────────────────────────────────────────

/**
 * Subscribe to case events filtered to one or more specific event types,
 * in chronological order.
 *
 * Returns only the events whose `eventType` is included in the `eventTypes`
 * array, ordered by `timestamp` ascending.  Filtering is applied in-memory
 * after the index scan — Convex does not support server-side filtering of
 * non-indexed fields in the query DSL.
 *
 * Typical use cases:
 *   • Status history sub-section: `eventTypes: ["status_change"]`
 *   • Custody chain sub-section:  `eventTypes: ["custody_handoff"]`
 *   • Inspection log:             `eventTypes: ["inspection_started", "inspection_completed", "item_checked"]`
 *   • Damage events:              `eventTypes: ["damage_reported"]`
 *   • Shipment events:            `eventTypes: ["shipped", "delivered"]`
 *
 * Throws when `eventTypes` is an empty array — callers should use `getCaseEvents`
 * when no type filter is desired.
 *
 * Real-time fidelity:
 *   Same reactive behaviour as `getCaseEvents` — re-evaluated within ~100–300 ms
 *   of any new event insert for this case.  If the new event's type is not in
 *   the subscribed `eventTypes` list, the in-memory filter excludes it but Convex
 *   still re-evaluates the handler and pushes a no-op diff.
 *
 * @param caseId      Convex case document ID.
 * @param eventTypes  Non-empty array of event type strings to include.
 *
 * Client usage:
 *   // Status change history only
 *   const statusEvents = useQuery(
 *     api["queries/events"].getCaseEventsByType,
 *     { caseId, eventTypes: ["status_change"] },
 *   );
 *
 *   // Custody handoffs only
 *   const custodyEvents = useQuery(
 *     api["queries/events"].getCaseEventsByType,
 *     { caseId, eventTypes: ["custody_handoff"] },
 *   );
 */
export const getCaseEventsByType = query({
  args: {
    caseId:     v.id("cases"),
    /**
     * Non-empty array of event type strings to include in the result.
     * Only events whose `eventType` is in this array are returned.
     * Must contain at least one element — use `getCaseEvents` for all types.
     */
    eventTypes: v.array(eventTypeValidator),
  },

  handler: async (ctx, args): Promise<CaseEvent[]> => {
    await requireAuth(ctx);

    // Guard: empty filter array is a caller error.
    if (args.eventTypes.length === 0) {
      throw new Error(
        "getCaseEventsByType: eventTypes must be a non-empty array. " +
        "Use getCaseEvents to fetch all event types for a case."
      );
    }

    // Load all events for this case chronologically, then filter in-memory.
    // An in-memory filter is necessary because:
    //   1. The by_case_timestamp index only supports eq/range on indexed fields.
    //   2. eventType is not part of the compound index.
    //   3. A separate by_case_type index would require schema migration; the
    //      per-case event count is small enough that in-memory filtering is fast.
    const rows = await ctx.db
      .query("events")
      .withIndex("by_case_timestamp", (q) => q.eq("caseId", args.caseId))
      .order("asc")
      .collect();

    // Build a Set for O(1) type membership checks in the filter pass.
    const typeSet = new Set<string>(args.eventTypes);

    return rows
      .filter((row) => typeSet.has(row.eventType))
      .map(projectEvent);
  },
});

// ─── getLatestCaseEvent ───────────────────────────────────────────────────────

/**
 * Subscribe to the most recent event recorded for a case.
 *
 * Returns the single event with the highest `timestamp` value, or `null` when
 * no events have been recorded for the case.
 *
 * Use cases:
 *   • Case list row "Last activity" column — show when the case was last touched
 *   • Dashboard case pin tooltip — brief "last action" summary line
 *   • SCAN app case card — "Last updated N minutes ago by Jane"
 *   • Staleness detection — alert when a case has had no events in N hours
 *
 * Implementation:
 *   Uses `by_case_timestamp` index with `order("desc").first()` for an efficient
 *   O(log n + 1) lookup — retrieves only the single most recent row.
 *
 * Return values:
 *   `undefined`   — query is loading
 *   `null`        — no events recorded for this case (brand-new case)
 *   `CaseEvent`   — the most recently recorded event
 *
 * @param caseId  Convex case document ID.
 *
 * Client usage:
 *   const latest = useQuery(
 *     api["queries/events"].getLatestCaseEvent,
 *     { caseId },
 *   );
 *   if (latest === undefined) return <ActivitySkeleton />;
 *   if (latest === null)      return <span>No activity yet</span>;
 *   return <span>Last action: {latest.eventType} by {latest.userName}</span>;
 */
export const getLatestCaseEvent = query({
  args: { caseId: v.id("cases") },

  handler: async (ctx, args): Promise<CaseEvent | null> => {
    await requireAuth(ctx);

    // desc order on by_case_timestamp → highest timestamp first → .first() picks it.
    // O(log n + 1) — retrieves only the single most recent event row.
    const row = await ctx.db
      .query("events")
      .withIndex("by_case_timestamp", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .first();

    if (!row) return null;
    return projectEvent(row);
  },
});

// ─── getCaseEventsPaginated ───────────────────────────────────────────────────

/**
 * Paginated subscription to all events for a case, newest first (timestamp DESC).
 *
 * Returns a paginated result set of CaseEvent rows from the `events` table
 * for the given `caseId`.  The first page is fetched immediately; additional
 * pages are loaded on demand via `loadMore()` from `usePaginatedQuery`.
 *
 * This is the primary data source for the T5 Audit Ledger table component,
 * which renders events in the AuditLedgerTable presentational component.
 *
 * Index path: `events.by_case_timestamp` — compound index on ["caseId", "timestamp"].
 * Descending order places the most recent event at index 0 of the first page.
 *
 * Optional filter args (Sub-AC 4):
 *   fromTimestamp  — inclusive lower epoch-ms bound (filter by date range start)
 *   toTimestamp    — inclusive upper epoch-ms bound (filter by date range end)
 *   actorName      — exact match on userName (filter by actor)
 *   eventType      — exact match on eventType (filter by action)
 *   caseIdSearch   — substring match on caseId.toString() (filter by case ID)
 *
 * When filter args change, Convex's usePaginatedQuery automatically resets the
 * cursor to page 1 so the table always shows the correct filtered result from
 * the beginning — no stale-cursor issues.
 *
 * Real-time fidelity:
 *   Convex re-evaluates all active pages of this paginated query whenever a
 *   mutation appends a new event row for this case.  New events at the head
 *   (most recent) appear in the first page result within ~100–300 ms, satisfying
 *   the ≤ 2-second real-time fidelity requirement for the T5 Audit Ledger.
 *
 * Pagination state contract (from usePaginatedQuery):
 *   status === "LoadingFirstPage" — first page not yet received → show skeleton
 *   status === "CanLoadMore"      — more pages exist → show "Load more" button
 *   status === "Exhausted"        — all events loaded → hide "Load more"
 *   results.length === 0 && status !== "LoadingFirstPage" → show empty state
 *
 * @param caseId         Convex case document ID.
 * @param paginationOpts Convex-provided cursor + numItems pagination object.
 * @param fromTimestamp  Optional inclusive lower timestamp bound (epoch ms).
 * @param toTimestamp    Optional inclusive upper timestamp bound (epoch ms).
 * @param actorName      Optional exact match on actor display name.
 * @param eventType      Optional exact match on event type key.
 * @param caseIdSearch   Optional substring search on the case ID string.
 *
 * Client usage (via usePaginatedCaseEvents hook):
 *   const { results, status, loadMore } = usePaginatedCaseEvents(caseId, 20, filters);
 *   if (status === "LoadingFirstPage") return <Spinner />;
 *   if (results.length === 0)          return <EmptyAuditLedger />;
 *   const rows = results.map(eventToRow);
 *   return (
 *     <>
 *       <AuditLedgerTable rows={rows} ffEnabled={ffEnabled} />
 *       {status === "CanLoadMore" && (
 *         <button onClick={() => loadMore(20)}>Load more</button>
 *       )}
 *     </>
 *   );
 */
export const getCaseEventsPaginated = query({
  args: {
    caseId:         v.id("cases"),
    paginationOpts: paginationOptsValidator,
    // ── Sub-AC 4: optional filter args ──────────────────────────────────────
    /** Inclusive lower bound for timestamp filtering (epoch ms). */
    fromTimestamp:  v.optional(v.number()),
    /** Inclusive upper bound for timestamp filtering (epoch ms). */
    toTimestamp:    v.optional(v.number()),
    /** Exact match on the actor's display name (userName field). */
    actorName:      v.optional(v.string()),
    /** Exact match on the event type discriminant. */
    eventType:      v.optional(eventTypeValidator),
    /**
     * Substring search on the caseId string representation.
     * Since all events in this query share the same caseId, this effectively
     * acts as "is the search term a substring of this case's ID?".
     * Returns empty results when the search term does not appear in the caseId.
     */
    caseIdSearch:   v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<PaginationResult<CaseEvent>> => {
    await requireAuth(ctx);

    // ── Sub-AC 4: caseIdSearch early-exit optimisation ───────────────────────
    // All event rows for this query have caseId === args.caseId (guaranteed by
    // the index equality predicate).  A caseIdSearch that does NOT appear in
    // args.caseId.toString() means zero rows can match — return an empty
    // paginated result immediately to avoid a full index scan.
    if (
      args.caseIdSearch &&
      !args.caseId.toString().includes(args.caseIdSearch)
    ) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    // ── Build base index query (caseId equality) ─────────────────────────────
    // desc order on by_case_timestamp → newest event first (highest timestamp at
    // index 0). The AuditLedgerTable default sort is timestamp DESC — this
    // pre-sorts on the server via the index, no client-side sort required.
    //
    // Sub-AC 4: additional server-side filters are applied via chained .filter()
    // calls below.  Convex evaluates all .filter() expressions server-side after
    // the index scan.  Multiple chained .filter() calls are equivalent to AND.
    // Convex correctly handles .filter() + .paginate() — cursor positions within
    // the raw document stream; the filter excludes non-matching rows from each page.
    let baseQuery = ctx.db
      .query("events")
      .withIndex("by_case_timestamp", (q) => q.eq("caseId", args.caseId));

    // ── Sub-AC 4: apply server-side filters ──────────────────────────────────

    // Timestamp lower bound — events on or after dateFrom (start of day in local time).
    if (args.fromTimestamp !== undefined) {
      baseQuery = baseQuery.filter((q) =>
        q.gte(q.field("timestamp"), args.fromTimestamp as number)
      );
    }

    // Timestamp upper bound — events on or before dateTo (end of day in local time).
    if (args.toTimestamp !== undefined) {
      baseQuery = baseQuery.filter((q) =>
        q.lte(q.field("timestamp"), args.toTimestamp as number)
      );
    }

    // Actor name — exact match on the denormalized userName field.
    if (args.actorName) {
      baseQuery = baseQuery.filter((q) =>
        q.eq(q.field("userName"), args.actorName as string)
      );
    }

    // Event type — exact match on the eventType discriminant.
    if (args.eventType) {
      baseQuery = baseQuery.filter((q) =>
        q.eq(q.field("eventType"), args.eventType as string)
      );
    }

    // Paginate the filtered query (desc timestamp order — newest first).
    const result = await baseQuery
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map(projectEvent),
    };
  },
});

// ─── getCaseEventRange ────────────────────────────────────────────────────────

/**
 * Subscribe to case events within an inclusive timestamp window, chronologically.
 *
 * Returns all events for the given case whose `timestamp` falls within the
 * closed interval [fromTimestamp, toTimestamp], ordered by `timestamp` ascending.
 *
 * Use cases:
 *   • T5 audit panel date-range filter — "show events between date A and date B"
 *   • Shift activity report — all events during a work shift window
 *   • Compliance export — events within a reporting period
 *   • Operations monitoring — "any events in the last N minutes?" health check
 *
 * Index path:
 *   Uses `by_case_timestamp` with an equality predicate on `caseId` and a range
 *   predicate on `timestamp`.  Convex evaluates both predicates in the index,
 *   making this an O(log n + |events in range|) query without a full case-events
 *   scan.  The `gte`/`lte` bounds are applied directly to the index.
 *
 * Empty range guard:
 *   Returns an empty array immediately when `fromTimestamp > toTimestamp` to
 *   avoid a vacuous index query that could return unexpected results.
 *
 * @param caseId         Convex case document ID.
 * @param fromTimestamp  Inclusive lower bound (epoch ms).  Pass 0 for open start.
 * @param toTimestamp    Inclusive upper bound (epoch ms).
 *
 * Client usage:
 *   // Events in the last 24 hours
 *   const recentEvents = useQuery(
 *     api["queries/events"].getCaseEventRange,
 *     {
 *       caseId,
 *       fromTimestamp: Date.now() - 24 * 60 * 60 * 1000,
 *       toTimestamp:   Date.now(),
 *     },
 *   );
 *
 *   // Events within a specific shift window
 *   const shiftEvents = useQuery(
 *     api["queries/events"].getCaseEventRange,
 *     { caseId, fromTimestamp: shiftStart, toTimestamp: shiftEnd },
 *   );
 */
export const getCaseEventRange = query({
  args: {
    caseId:        v.id("cases"),
    /**
     * Inclusive lower timestamp bound (epoch ms).
     * Pass 0 to include all events from the beginning of the case's history.
     */
    fromTimestamp: v.number(),
    /**
     * Inclusive upper timestamp bound (epoch ms).
     * Pass Date.now() to include all events up to the current moment.
     */
    toTimestamp:   v.number(),
  },

  handler: async (ctx, args): Promise<CaseEvent[]> => {
    await requireAuth(ctx);

    // Guard: empty range — return immediately to avoid a vacuous index query.
    if (args.fromTimestamp > args.toTimestamp) return [];

    // Range query on the by_case_timestamp compound index:
    //   eq("caseId", ...) → equality predicate on the first indexed field
    //   gte("timestamp", ...) → lower bound on the second indexed field
    //   lte("timestamp", ...) → upper bound on the second indexed field
    // Convex evaluates all three predicates in the index — O(log n + |range|).
    const rows = await ctx.db
      .query("events")
      .withIndex("by_case_timestamp", (q) =>
        q
          .eq("caseId", args.caseId)
          .gte("timestamp", args.fromTimestamp)
          .lte("timestamp", args.toTimestamp)
      )
      .order("asc")
      .collect();

    return rows.map(projectEvent);
  },
});

// ─── getDistinctActors ────────────────────────────────────────────────────────

/**
 * Subscribe to the sorted list of distinct actor display-names for a case.
 *
 * Scans all event rows for the given `caseId` via the `by_case_timestamp`
 * compound index (equality predicate on `caseId` only), collects every unique
 * `userName` value, and returns them sorted alphabetically.
 *
 * This is the canonical data source for the Actor filter dropdown in the
 * T5 Audit Ledger filter panel (AuditLedgerFilterPanel).  Consuming it as a
 * real-time subscription means the dropdown option list expands automatically
 * whenever a new actor (field technician, pilot, system process) performs an
 * action on the case — without any manual refresh.
 *
 * Design decisions:
 *   • Deduplication is done server-side via a Set — the client receives a
 *     compact `string[]` rather than scanning duplicate rows.
 *   • Alphabetical sort is applied server-side so the dropdown is consistently
 *     ordered regardless of which actor acted most recently.
 *   • "System" is included in the result set when system-generated events exist
 *     (e.g. `status_change` events written by server-side mutations).  The
 *     filter panel can optionally filter it out if desired.
 *   • An empty array is returned — not null — when no events exist for the
 *     case, so the Actor dropdown shows "All actors" without a loading state.
 *
 * Index path: `events.by_case_timestamp` — O(log n + |events for case|) scan.
 * For typical case sizes (< 500 events) this is fast enough for a synchronous
 * Convex query.  If cases grow to thousands of events, a dedicated index on
 * userName or a counter table would be more efficient.
 *
 * Real-time fidelity:
 *   Convex re-evaluates this query and pushes the updated actor list to all
 *   subscribers within ~100–300 ms whenever any SCAN app mutation appends a
 *   new event row for this case.  The Actor dropdown option list updates live.
 *
 * Return values:
 *   `undefined`  — query is loading (initial fetch or reconnect)
 *   `string[]`   — sorted, deduplicated list of actor display-names
 *                  (empty array when no events recorded for the case)
 *
 * @param caseId  Convex case document ID.
 *
 * Client usage (via useDistinctCaseActors hook):
 *   const actors = useDistinctCaseActors(caseId);
 *   // actors === undefined → still loading → AuditLedgerFilterPanel shows
 *   //   "Loading…" in the Actor dropdown and disables it.
 *   // actors === []       → no events → only "All actors" option shown.
 *   // actors === ["Alice", "Bob", "System"] → full option list rendered.
 *
 * Direct Convex usage (where hook is unavailable):
 *   const actors = useQuery(
 *     api["queries/events"].getDistinctActors,
 *     { caseId },
 *   );
 */
export const getDistinctActors = query({
  args: { caseId: v.id("cases") },

  handler: async (ctx, args): Promise<string[]> => {
    await requireAuth(ctx);

    // Scan all event rows for this case via the compound index.
    // We only need the `userName` field but Convex loads full rows — this is
    // acceptable for typical case sizes (< 500 events per case).
    const rows = await ctx.db
      .query("events")
      .withIndex("by_case_timestamp", (q) => q.eq("caseId", args.caseId))
      .collect();

    // Collect unique actor names — O(|events|) pass.
    const names = new Set<string>();
    for (const row of rows) {
      if (row.userName) {
        names.add(row.userName);
      }
    }

    // Return sorted for consistent dropdown ordering.
    return Array.from(names).sort();
  },
});
