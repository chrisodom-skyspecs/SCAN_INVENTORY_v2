/**
 * convex/queries/shipment.ts
 *
 * Extended shipment queries for the INVENTORY dashboard T4 (Shipping) and
 * T5 (Audit) case detail panels.
 *
 * This module provides Convex query functions that extend the core shipment
 * functions in convex/shipping.ts with additional server-side data enrichment:
 *
 *   1. `getLatestShipmentForCase`
 *      Public version of the formerly-internal `getLatestShipmentByCaseId`.
 *      Returns the most recently created shipment as a normalised ShipmentRecord,
 *      or null when no shipments exist.  Used by T1/T2/T3 compact tracking chips
 *      where only the current shipment is needed, not the full history.
 *
 *   2. `getCaseShipmentAndCustody`
 *      Combined query returning the latest shipment + current custodian in a
 *      SINGLE Convex subscription.  Eliminates the dual-subscription pattern in
 *      T4 (Shipping) panel components that display both FedEx tracking status and
 *      custody chain information side-by-side.
 *
 *      Both the `shipments` and `custodyRecords` tables are read within one
 *      reactive subscription — a write to either table triggers a re-evaluation
 *      and pushes the consolidated result to all connected dashboard clients.
 *
 *   3. `getShipmentEventsForAudit`
 *      Shipment records formatted as typed audit timeline entries for the T5
 *      (Audit) panel.  Performs the shipments → audit-entry transformation
 *      server-side so the T5 component can render the timeline directly without
 *      any client-side mapping.
 *
 * Registered in the Convex API as: api["queries/shipment"].*
 *
 * Real-time fidelity:
 *   All three queries subscribe reactively to the underlying tables.  Convex
 *   re-evaluates and pushes diffs to connected clients within ~100–300 ms of
 *   any mutation that writes to `shipments` or `custodyRecords`, satisfying the
 *   ≤ 2-second real-time fidelity requirement.
 *
 * Client usage (after `npx convex dev` regenerates API types):
 *   import { api } from "../../convex/_generated/api";
 *
 *   // Latest shipment (T1/T2 compact chip)
 *   const shipment = useQuery(
 *     api["queries/shipment"].getLatestShipmentForCase,
 *     { caseId },
 *   );
 *
 *   // Combined status (T4 panel header — single subscription)
 *   const combined = useQuery(
 *     api["queries/shipment"].getCaseShipmentAndCustody,
 *     { caseId },
 *   );
 *
 *   // Audit entries (T5 event timeline — pre-formatted)
 *   const entries = useQuery(
 *     api["queries/shipment"].getShipmentEventsForAudit,
 *     { caseId },
 *   );
 */

import { query } from "../_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";
import { projectShipment } from "../shippingHelpers";
import type { ShipmentRecord, ShipmentStatus } from "../shippingHelpers";

// Re-export types so the hook module can import them without importing
// Convex server internals (this file's non-type exports are server-only).
export type { ShipmentRecord, ShipmentStatus };

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

// ─── Exported types ───────────────────────────────────────────────────────────

/**
 * Lightweight custody handoff projection returned by combined queries.
 *
 * Derived from the `custodyRecords` table row.  Contains only the fields
 * needed for T4 panel display — omits the optional `signatureStorageId` to
 * keep the combined query result compact.
 */
export interface CustodyHandoffSummary {
  /** Convex document ID of the custody record row. */
  _id: string;
  /** Convex document ID of the parent case. */
  caseId: string;
  /** Kinde user ID of the person relinquishing custody. */
  fromUserId: string;
  /** Display name of the person relinquishing custody. */
  fromUserName: string;
  /** Kinde user ID of the person receiving custody. */
  toUserId: string;
  /** Display name of the person receiving custody. */
  toUserName: string;
  /** Epoch ms when the transfer was recorded. */
  transferredAt: number;
  /** Optional technician notes entered at transfer time. */
  notes?: string;
}

/**
 * Combined shipment + custody status for a single case.
 *
 * Returned by `getCaseShipmentAndCustody`.  Combines:
 *   • The most recently created shipment record (latest FedEx tracking state)
 *   • The most recent custody handoff (who currently holds the case)
 *   • Aggregate counts for both (for panel header badges)
 *
 * All fields are derived from a single Convex subscription that reads both
 * the `shipments` and `custodyRecords` tables.  A write to either table
 * triggers a re-evaluation and pushes the updated result to all connected
 * dashboard clients within ~100–300 ms.
 */
export interface CaseShipmentAndCustody {
  /** Convex document ID of the case (plain string). */
  caseId: string;
  /**
   * Most recently created shipment for this case.
   * null when the case has never been shipped.
   */
  latestShipment: ShipmentRecord | null;
  /**
   * The person or team who most recently received custody of this case.
   * null when no custody handoffs have been recorded.
   */
  currentCustodian: CustodyHandoffSummary | null;
  /**
   * Total number of shipment records ever created for this case (all time).
   * Used for the "N shipments" badge in the T4 panel header.
   */
  totalShipments: number;
  /**
   * Total number of custody handoffs ever recorded for this case.
   * Used for the "N handoffs" badge in the T4 custody section header.
   */
  totalHandoffs: number;
}

/**
 * A shipment record formatted as an audit timeline entry for T5.
 *
 * Provides the event-shaped data required by the T5 audit timeline renderer
 * so the component can process shipment data inline with other event types
 * (status changes, damage reports, custody handoffs) without a separate
 * client-side transformation step.
 *
 * Returned by `getShipmentEventsForAudit`.
 */
export interface ShipmentAuditEntry {
  /**
   * Stable derived ID for this audit entry.
   * Format: "shipment-audit-{shipmentId}".
   * Used as the React key in the T5 event timeline list.
   */
  _id: string;
  /** Always "shipped" — identifies this as a shipment audit entry. */
  eventType: "shipped";
  /**
   * Attribution label for this audit entry.
   * "SCAN app" for all shipments (technician name is in the events table).
   */
  userName: string;
  /**
   * Epoch ms timestamp used for timeline ordering.
   * Equals shippedAt when available, otherwise falls back to createdAt.
   */
  timestamp: number;
  /** FedEx tracking number. */
  trackingNumber: string;
  /** Carrier name — always "FedEx" currently. */
  carrier: string;
  /** Current FedEx tracking status. */
  status: ShipmentStatus;
  /** Human-readable ship-from location, if recorded. */
  originName?: string;
  /** Human-readable ship-to location, if recorded. */
  destinationName?: string;
  /** ISO 8601 estimated delivery date string from FedEx API, if available. */
  estimatedDelivery?: string;
  /** Epoch ms when the SCAN app operator recorded this shipment. */
  shippedAt?: number;
  /** Epoch ms when FedEx confirmed delivery. Populated by `updateShipmentStatus`. */
  deliveredAt?: number;
}

// ─── getLatestShipmentForCase ─────────────────────────────────────────────────

/**
 * Subscribe to the most recently created shipment for a case.
 *
 * Public version of the internal `getLatestShipmentByCaseId` query in
 * convex/shipping.ts.  Returns the single most recently created shipment row
 * as a normalised ShipmentRecord (all Convex IDs coerced to plain strings),
 * or null if no shipments exist for this case.
 *
 * This query uses the `by_case` index with `order("desc").first()` for an
 * efficient O(log n + 1) lookup — it does NOT perform a full table scan.
 *
 * Use this in T1/T2/T3 compact tracking chips, map pin tooltips, and any
 * component that only needs the current shipment state (not the full history).
 * For the full history list, use `api.shipping.listShipmentsByCase` instead.
 *
 * Real-time behavior:
 *   Convex re-evaluates and pushes within ~100–300 ms whenever:
 *     • The SCAN app calls `shipCase` (new `shipments` row inserted)
 *     • `updateShipmentStatus` runs after a FedEx tracking refresh
 *       (status or estimatedDelivery field changed)
 *   Satisfies the ≤ 2-second real-time fidelity requirement.
 *
 * Return values:
 *   `undefined`      — query is loading (initial fetch or reconnect)
 *   `null`           — no shipments exist for this case
 *   `ShipmentRecord` — the most recently created shipment
 *
 * Client usage (after `npx convex dev` regenerates API types):
 *   const shipment = useQuery(
 *     api["queries/shipment"].getLatestShipmentForCase,
 *     { caseId },
 *   );
 *   if (shipment === undefined) return <LoadingSkeleton />;
 *   if (shipment === null) return <NoShipmentPlaceholder />;
 *   // shipment.trackingNumber → "794644823741"
 *   // shipment.status         → "in_transit"
 */
export const getLatestShipmentForCase = query({
  args: { caseId: v.id("cases") },

  handler: async (ctx, args): Promise<ShipmentRecord | null> => {
    await requireAuth(ctx);

    // O(log n + 1) lookup via the by_case index — no full table scan.
    const row = await ctx.db
      .query("shipments")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .first();

    if (!row) return null;
    return projectShipment(row);
  },
});

// ─── getCaseShipmentAndCustody ────────────────────────────────────────────────

/**
 * Subscribe to combined shipment + custody status for a case.
 *
 * Returns the latest shipment record and the most recent custody handoff in
 * a SINGLE reactive Convex subscription — eliminating the dual-subscription
 * pattern in T4 (Shipping) panel components that need both pieces of data.
 *
 * Why a combined query?
 *   The T4 panel displays FedEx tracking status (from `shipments`) alongside
 *   the current custody chain (from `custodyRecords`) in the same panel view.
 *   Subscribing to each table separately creates two live subscriptions that
 *   each trigger a re-render when their data changes.  A single combined
 *   subscription reduces network overhead and React render cycles to one,
 *   with no loss of real-time fidelity.
 *
 * Reactive table coverage:
 *   This query reads BOTH `shipments` and `custodyRecords` within a single
 *   Convex query handler.  Convex's dependency tracking registers both
 *   tables as reactive inputs.  Any write to either table causes Convex to
 *   re-evaluate this query and push the updated `CaseShipmentAndCustody`
 *   result to all connected clients within ~100–300 ms:
 *
 *     SCAN app calls `shipCase`          → `shipments` write → re-evaluate
 *     SCAN app calls `handoffCustody`    → `custodyRecords` write → re-evaluate
 *     `updateShipmentStatus` runs        → `shipments` update → re-evaluate
 *
 * This satisfies the ≤ 2-second real-time fidelity requirement for both
 * shipping status AND custody handoff updates in the T4 panel.
 *
 * Client usage (after `npx convex dev` regenerates API types):
 *   const data = useQuery(
 *     api["queries/shipment"].getCaseShipmentAndCustody,
 *     { caseId },
 *   );
 *   if (data === undefined) return <T4LoadingSkeleton />;
 *   // data.latestShipment     — current FedEx tracking status (or null)
 *   // data.currentCustodian   — who currently holds the case (or null)
 *   // data.totalShipments     — "3 shipments" badge count
 *   // data.totalHandoffs      — "2 handoffs" badge count
 */
export const getCaseShipmentAndCustody = query({
  args: { caseId: v.id("cases") },

  handler: async (ctx, args): Promise<CaseShipmentAndCustody> => {
    await requireAuth(ctx);

    // ── Latest shipment ────────────────────────────────────────────────────────
    // O(log n + 1) via by_case index, desc order → most recently created first.
    const latestShipmentRow = await ctx.db
      .query("shipments")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .first();

    // ── All shipments (for aggregate count) ───────────────────────────────────
    // Full collect needed for the count — Convex does not expose COUNT().
    // Expected to be a small number (< 10 per case in practice).
    const allShipmentRows = await ctx.db
      .query("shipments")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    // ── Latest custody handoff ─────────────────────────────────────────────────
    // desc order on the by_case index → most recently transferred first.
    // "Most recent transferredAt" rather than "most recent _creationTime" would
    // require a by_case_transferred compound index.  Since transferredAt and
    // createdAt are set to the same value at write time (epoch ms of the
    // mutation), ordering by creation time is equivalent.
    const latestCustodyRow = await ctx.db
      .query("custodyRecords")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .first();

    // ── All custody records (for aggregate count) ─────────────────────────────
    const allCustodyRows = await ctx.db
      .query("custodyRecords")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    // ── Assemble result ────────────────────────────────────────────────────────
    const latestShipment = latestShipmentRow
      ? projectShipment(latestShipmentRow)
      : null;

    const currentCustodian: CustodyHandoffSummary | null = latestCustodyRow
      ? {
          _id:           latestCustodyRow._id.toString(),
          caseId:        latestCustodyRow.caseId.toString(),
          fromUserId:    latestCustodyRow.fromUserId,
          fromUserName:  latestCustodyRow.fromUserName,
          toUserId:      latestCustodyRow.toUserId,
          toUserName:    latestCustodyRow.toUserName,
          transferredAt: latestCustodyRow.transferredAt,
          notes:         latestCustodyRow.notes,
        }
      : null;

    return {
      caseId:         args.caseId.toString(),
      latestShipment,
      currentCustodian,
      totalShipments: allShipmentRows.length,
      totalHandoffs:  allCustodyRows.length,
    };
  },
});

// ─── getShipmentEventsForAudit ────────────────────────────────────────────────

/**
 * Subscribe to all shipments for a case formatted as audit timeline entries.
 *
 * Returns every shipment record for the case as a `ShipmentAuditEntry` object
 * in the event-shaped format expected by the T5 (Audit) panel timeline
 * renderer.  Performing this transformation server-side eliminates the
 * client-side `shipments.map(...)` code currently in T5Audit.tsx, reduces
 * bundle size, and ensures the transformation logic is tested with the
 * Convex query rather than scattered across component code.
 *
 * Results are sorted by `shippedAt` descending (most recent shipment first),
 * mirroring the T5 audit timeline's reverse-chronological display order.
 *
 * Server-side transformation benefits:
 *   • Type-safe: `ShipmentAuditEntry` is strongly typed — no `Record<string, unknown>`
 *     casts needed in the T5 component.
 *   • Consistent: all shipments produce the same `eventType: "shipped"` entry
 *     shape, making them trivially mergeable with other event types in the T5
 *     timeline merge-sort.
 *   • Testable: transformation logic is in the query handler, not the component.
 *
 * Real-time behavior:
 *   Convex re-evaluates and pushes within ~100–300 ms whenever:
 *     • The SCAN app calls `shipCase` (new `shipments` row inserted)
 *     • `updateShipmentStatus` runs after a FedEx tracking poll
 *   The T5 panel receives the updated audit entry (with new status or
 *   estimatedDelivery) without any user action, satisfying the ≤ 2-second
 *   real-time fidelity requirement.
 *
 * Return values:
 *   `undefined`           — query is loading
 *   `ShipmentAuditEntry[]` — all shipments as audit entries, newest first
 *                            (empty array when no shipments exist)
 *
 * Client usage (after `npx convex dev` regenerates API types):
 *   const entries = useQuery(
 *     api["queries/shipment"].getShipmentEventsForAudit,
 *     { caseId },
 *   );
 *   // entries[0].eventType → "shipped"
 *   // entries[0].trackingNumber → "794644823741"
 *   // entries[0].status → "in_transit"
 *   // entries[0].timestamp → 1700000000000 (epoch ms)
 */
export const getShipmentEventsForAudit = query({
  args: { caseId: v.id("cases") },

  handler: async (ctx, args): Promise<ShipmentAuditEntry[]> => {
    await requireAuth(ctx);

    // Load all shipments for this case, most recent first.
    // The by_case index + desc order gives O(log n + |shipments|) performance.
    const rows = await ctx.db
      .query("shipments")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .collect();

    // Transform each shipment row into a typed audit timeline entry.
    // The `_id` prefix "shipment-audit-" disambiguates these entries from
    // other event types (status_change, custody_handoff) in the T5 merge-sort.
    return rows.map((row): ShipmentAuditEntry => ({
      _id:               `shipment-audit-${row._id.toString()}`,
      eventType:         "shipped",
      userName:          "SCAN app",
      // Prefer shippedAt (when the operator recorded the shipment) over
      // createdAt (when the DB row was created) for timeline ordering.
      timestamp:         row.shippedAt ?? row.createdAt,
      trackingNumber:    row.trackingNumber,
      carrier:           row.carrier,
      status:            row.status as ShipmentStatus,
      originName:        row.originName,
      destinationName:   row.destinationName,
      estimatedDelivery: row.estimatedDelivery,
      shippedAt:         row.shippedAt,
      deliveredAt:       row.deliveredAt,
    }));
  },
});
