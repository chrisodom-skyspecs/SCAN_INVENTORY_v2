/**
 * convex/shipping.ts
 *
 * Convex actions and mutations for the shipping / FedEx tracking workflow.
 *
 * This module provides:
 *
 *   trackShipment   — public action: call the FedEx Track API for a given
 *                     tracking number and return normalised tracking data.
 *                     Callable from the SCAN mobile app and INVENTORY
 *                     dashboard without writing to the database.
 *
 *   refreshShipmentTracking — internal action: re-poll FedEx for an existing
 *                     shipment record and persist the updated status + events
 *                     back to the `shipments` table.  Intended for background
 *                     refresh workflows.
 *
 *   createShipment  — mutation: create a new shipment record for a case and
 *                     record the "shipped" event in the audit timeline.
 *
 *   updateShipmentStatus — internal mutation: update an existing shipment's
 *                     status and estimated delivery from tracking poll results.
 *
 * Architecture notes:
 *   • Actions (trackShipment, refreshShipmentTracking) use `fetch` to call
 *     the FedEx API.  This is only valid inside Convex actions — queries and
 *     mutations cannot make outbound HTTP requests.
 *   • The FedEx client logic lives in convex/fedexClient.ts; this file only
 *     contains Convex function definitions.
 *   • Environment variables (FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET, etc.) must
 *     be configured in the Convex dashboard under Settings → Environment Variables.
 *
 * Client usage (SCAN app / dashboard):
 *   const result = await convexClient.action(api.shipping.trackShipment, {
 *     trackingNumber: "794644823741",
 *   });
 *   // result.status        → "in_transit"
 *   // result.estimatedDelivery → "2025-06-03T20:00:00Z"
 *   // result.events        → [{ timestamp, eventType, description, location }]
 */

import { action, internalAction, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Auth, UserIdentity } from "convex/server";
import {
  fetchTrackingData,
  toConvexShipmentStatus,
  FedExClientError,
  type FedExTrackingResult,
  type FedExTrackingEvent,
} from "./fedexClient";

// ─── Shared value validators ──────────────────────────────────────────────────

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

// ─── Shared value validators ──────────────────────────────────────────────────

/** Mirrors the shipmentStatus union from schema.ts — used in mutation args. */
const shipmentStatusValidator = v.union(
  v.literal("label_created"),
  v.literal("picked_up"),
  v.literal("in_transit"),
  v.literal("out_for_delivery"),
  v.literal("delivered"),
  v.literal("exception")
);

// ─── Return type (exported for client-side TypeScript) ────────────────────────

/**
 * Normalised FedEx tracking result as returned by the `trackShipment` action.
 * Matches `FedExTrackingResult` from convex/fedexClient.ts; re-exported here
 * so client components can import a single type from the API layer.
 */
export type { FedExTrackingResult, FedExTrackingEvent } from "./fedexClient";
export type { FedExShipmentStatus } from "./fedexClient";

// ─── trackShipment — public action ───────────────────────────────────────────

/**
 * Public Convex action: look up a FedEx tracking number and return normalised
 * shipment status data.
 *
 * This is a read-only action — it does NOT write anything to the database.
 * Use it for real-time tracking lookups from the SCAN app's shipping screen
 * or the INVENTORY dashboard's M4 logistics panel.
 *
 * To persist tracking data, use `createShipment` (new shipment) or
 * `refreshShipmentTracking` (update existing).
 *
 * @param trackingNumber  FedEx tracking number entered by the user.
 *                        Whitespace is stripped before calling the API.
 *
 * @returns Normalised tracking data on success.
 * @throws  Convex serialisable error string on failure (FedExClientError
 *          details are included in the message so the client can surface them).
 *
 * Client usage:
 *   const result = await convex.action(api.shipping.trackShipment, {
 *     trackingNumber: "794644823741",
 *   });
 */
export const trackShipment = action({
  args: {
    trackingNumber: v.string(),
  },

  handler: async (ctx, args): Promise<FedExTrackingResult> => {
    await requireAuth(ctx);
    const tn = args.trackingNumber.trim();
    if (!tn) {
      throw new Error("trackingNumber must be a non-empty string.");
    }

    try {
      return await fetchTrackingData(tn);
    } catch (err) {
      if (err instanceof FedExClientError) {
        // Surface the machine-readable code in the error message so the
        // client can distinguish "not found" from "rate limited" etc.
        throw new Error(`[${err.code}] ${err.message}`);
      }
      throw err;
    }
  },
});

// ─── createShipment — mutation ────────────────────────────────────────────────

/**
 * Mutation: record a new shipment for a case.
 *
 * Creates a row in the `shipments` table and appends a "shipped" event to the
 * case's immutable event timeline.  Also transitions the case status to
 * "shipping" if it is currently "assembled", "deployed", or "in_field".
 *
 * Call this from the SCAN app after the user enters a FedEx tracking number
 * and confirms the shipment.
 *
 * Client usage:
 *   const shipmentId = await convex.mutation(api.shipping.createShipment, {
 *     caseId:         "j57abc123",
 *     trackingNumber: "794644823741",
 *     userId:         "user_01abc",
 *     userName:       "Jane Pilot",
 *     originName:     "Site Alpha",
 *     destinationName: "SkySpecs HQ",
 *   });
 */
export const createShipment = mutation({
  args: {
    caseId:          v.id("cases"),
    trackingNumber:  v.string(),
    userId:          v.string(),
    userName:        v.string(),
    // Optional route information
    originLat:       v.optional(v.number()),
    originLng:       v.optional(v.number()),
    originName:      v.optional(v.string()),
    destinationLat:  v.optional(v.number()),
    destinationLng:  v.optional(v.number()),
    destinationName: v.optional(v.string()),
    notes:           v.optional(v.string()),
  },

  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const now = Date.now();
    const tn  = args.trackingNumber.trim();

    if (!tn) {
      throw new Error("trackingNumber must be a non-empty string.");
    }

    // Verify the case exists
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(`Case ${args.caseId} not found.`);
    }

    // Create the shipment record
    const shipmentId = await ctx.db.insert("shipments", {
      caseId:          args.caseId,
      trackingNumber:  tn,
      carrier:         "FedEx",
      status:          "label_created",  // initial status before first poll
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

    // Advance case status to transit_out/transit_in based on direction:
    //   outbound (assembled/hangar/received → site) → transit_out
    //   inbound  (deployed/flagged → base)          → transit_in
    const outboundStatuses = ["hangar", "assembled", "received"];
    const inboundStatuses  = ["deployed", "flagged"];
    const shippableStatuses = [...outboundStatuses, ...inboundStatuses];
    if (shippableStatuses.includes(caseDoc.status)) {
      const transitStatus = outboundStatuses.includes(caseDoc.status)
        ? "transit_out"
        : "transit_in";
      await ctx.db.patch(args.caseId, {
        status:    transitStatus,
        updatedAt: now,
      });

      // Record the status change event
      await ctx.db.insert("events", {
        caseId:    args.caseId,
        eventType: "status_change",
        userId:    args.userId,
        userName:  args.userName,
        timestamp: now,
        data: {
          from:   caseDoc.status,
          to:     transitStatus,
          reason: `Shipped via FedEx — tracking number ${tn}`,
        },
      });
    }

    // Record the "shipped" event in the audit timeline
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "shipped",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        shipmentId:      shipmentId,
        trackingNumber:  tn,
        carrier:         "FedEx",
        originName:      args.originName,
        destinationName: args.destinationName,
        notes:           args.notes,
      },
    });

    return shipmentId;
  },
});

// ─── refreshShipmentTracking — internal action ────────────────────────────────

/**
 * Internal action: re-poll FedEx for an existing shipment and persist the
 * updated status + latest event data.
 *
 * Designed for use in background refresh workflows.  Calls `fetchTrackingData`
 * and then delegates to `updateShipmentStatus` (internal mutation) to write
 * the new data to the database.
 *
 * Not callable from the client — internal only.
 *
 * Usage from another Convex function:
 *   await ctx.scheduler.runAfter(0, internal.shipping.refreshShipmentTracking, {
 *     shipmentId: "j57xyz",
 *   });
 */
export const refreshShipmentTracking = internalAction({
  args: {
    shipmentId: v.id("shipments"),
  },

  handler: async (ctx, args): Promise<void> => {
    // Load the shipment to get the tracking number
    const shipment = await ctx.runQuery(internal.shipping.getShipmentById, {
      shipmentId: args.shipmentId,
    });

    if (!shipment) {
      console.warn(
        `[refreshShipmentTracking] Shipment ${args.shipmentId} not found — skipping.`
      );
      return;
    }

    // Already delivered or exception — nothing to refresh
    if (shipment.status === "delivered") {
      return;
    }

    let trackingResult: FedExTrackingResult;
    try {
      trackingResult = await fetchTrackingData(shipment.trackingNumber);
    } catch (err) {
      const code =
        err instanceof FedExClientError ? err.code : "UNKNOWN_ERROR";
      console.error(
        `[refreshShipmentTracking] FedEx poll failed for ${shipment.trackingNumber}: [${code}]`,
        err instanceof Error ? err.message : err
      );
      // Non-fatal — don't throw; the next scheduled refresh will retry.
      return;
    }

    // Persist the updated status and carrier fields to both shipments and cases.
    // trackingResult.events[0] is the most recent FedEx scan event (events are
    // returned newest-first by the FedEx Track API).
    await ctx.runMutation(internal.shipping.updateShipmentStatus, {
      shipmentId:        args.shipmentId,
      status:            toConvexShipmentStatus(trackingResult.status),
      estimatedDelivery: trackingResult.estimatedDelivery,
      lastEvent:         trackingResult.events[0] ?? null,
    });
  },
});

// ─── getShipmentById — internal query ────────────────────────────────────────

import { internalQuery } from "./_generated/server";

/**
 * Internal query: fetch a single shipment document by ID.
 * Used by `refreshShipmentTracking` to load the tracking number before
 * calling the FedEx API.
 */
export const getShipmentById = internalQuery({
  args: { shipmentId: v.id("shipments") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.shipmentId);
  },
});

// ─── updateShipmentStatus — internal mutation ─────────────────────────────────

/**
 * Internal mutation: update a shipment's tracking status and estimated
 * delivery date based on the latest FedEx poll result.
 *
 * Also updates `currentLat` / `currentLng` if the latest event includes
 * geocodable location data (future: geocoding integration point).
 *
 * Marks the case as "returned" if the shipment status transitions to
 * "delivered" (i.e., the equipment arrived back at the warehouse).
 *
 * This is `internal` — only callable from other Convex functions, not the
 * client.
 */
export const updateShipmentStatus = internalMutation({
  args: {
    shipmentId:        v.id("shipments"),
    status:            shipmentStatusValidator,
    estimatedDelivery: v.optional(v.string()),
    /**
     * Most recent FedEx scan event from the tracking poll response.
     * When provided (not null), written to:
     *   - shipments.lastEvent        — persists the event on the shipment row
     *   - cases.lastCarrierEvent     — denormalizes for single-read access
     *
     * Pass null when the FedEx response contains no scan events (e.g., fresh
     * label with no FedEx activity yet) — this preserves any previously
     * stored event rather than overwriting with undefined.
     */
    lastEvent: v.union(
      v.null(),
      v.object({
        timestamp:   v.string(),
        eventType:   v.string(),
        description: v.string(),
        location: v.object({
          city:    v.optional(v.string()),
          state:   v.optional(v.string()),
          country: v.optional(v.string()),
        }),
      })
    ),
  },

  handler: async (ctx, args) => {
    const now      = Date.now();
    const shipment = await ctx.db.get(args.shipmentId);

    if (!shipment) {
      console.warn(
        `[updateShipmentStatus] Shipment ${args.shipmentId} not found — skipping.`
      );
      return;
    }

    // ── Patch the shipments row ───────────────────────────────────────────────
    // Only update fields that have actually changed (avoids unnecessary writes
    // that would trigger reactive re-evaluation for subscribers).
    const shipmentPatch: Record<string, unknown> = {
      updatedAt: now,
    };

    if (args.status !== shipment.status) {
      shipmentPatch["status"] = args.status;
    }

    if (
      args.estimatedDelivery !== undefined &&
      args.estimatedDelivery !== shipment.estimatedDelivery
    ) {
      shipmentPatch["estimatedDelivery"] = args.estimatedDelivery;
    }

    if (args.status === "delivered" && !shipment.deliveredAt) {
      shipmentPatch["deliveredAt"] = now;
    }

    // Persist lastEvent to the shipments row when provided.
    // null means "no events in this poll response" — skip to preserve existing.
    if (args.lastEvent !== null) {
      shipmentPatch["lastEvent"] = args.lastEvent;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(args.shipmentId, shipmentPatch as any);

    // ── Denormalize carrier tracking fields to the case document ─────────────
    //
    // Writing carrierStatus, estimatedDelivery, and lastCarrierEvent to the
    // cases table enables:
    //
    //   1. Single O(1) ctx.db.get(caseId) read to get all carrier tracking
    //      state — no secondary join to shipments required.
    //
    //   2. All queries subscribed to the cases table (listForMap, getCaseStatus,
    //      getCaseCarrierStatus) re-evaluate automatically within ~100–300 ms,
    //      satisfying the ≤ 2-second real-time fidelity requirement for:
    //        - M4 logistics map pins showing carrier status
    //        - T3 "In Transit" banner showing carrier ETA
    //        - T4 Shipping panel carrier status badge
    //
    //   3. listForMap (M1–M4 map modes) can include carrier status in map pin
    //      data without a per-case shipments table join.
    //
    // The case carrier fields are always updated (even if unchanged) to keep
    // cases.updatedAt current — which triggers by_updated index re-evaluation
    // for all real-time list queries.
    const casePatch: Record<string, unknown> = {
      carrierStatus: args.status,
      updatedAt:     now,
    };

    if (args.estimatedDelivery !== undefined) {
      casePatch["estimatedDelivery"] = args.estimatedDelivery;
    }

    if (args.lastEvent !== null) {
      casePatch["lastCarrierEvent"] = args.lastEvent;
    }

    // If delivered, transition the case to the appropriate arrival status:
    //   transit_out → deployed (arrived at field site)
    //   transit_in  → received (arrived back at base)
    // Clear carrier tracking fields when the case reaches a non-transit status
    // (the fields are no longer meaningful after delivery).
    if (args.status === "delivered" && shipment.status !== "delivered") {
      const caseDoc = await ctx.db.get(shipment.caseId);
      const arrivalStatus =
        caseDoc?.status === "transit_out" ? "deployed" : "received";
      if (caseDoc && (caseDoc.status === "transit_out" || caseDoc.status === "transit_in")) {
        await ctx.db.patch(shipment.caseId, {
          ...casePatch,
          status:    arrivalStatus,
        } as Parameters<typeof ctx.db.patch<"cases">>[1]);

        await ctx.db.insert("events", {
          caseId:    shipment.caseId,
          eventType: "delivered",
          userId:    "system",
          userName:  "FedEx",
          timestamp: now,
          data: {
            shipmentId:     args.shipmentId,
            trackingNumber: shipment.trackingNumber,
            carrier:        "FedEx",
          },
        });
        // Case patch already applied above with status — return early.
        return;
      }
    }

    // Non-delivery update: write carrier tracking fields to the case document
    // without changing the case lifecycle status.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(shipment.caseId, casePatch as any);
  },
});

// ─── listShipmentsByCase — public query ───────────────────────────────────────

import { query } from "./_generated/server";

/**
 * Public query: subscribe to all shipments for a given case.
 *
 * Returns shipments ordered by `createdAt` descending (most recent first).
 * The INVENTORY dashboard and SCAN app use this to display shipping history
 * in the T4 (Shipping) and T5 (Audit) case detail panels.
 *
 * Client usage:
 *   const shipments = useQuery(api.shipping.listShipmentsByCase, { caseId });
 */
export const listShipmentsByCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    return await ctx.db
      .query("shipments")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .collect();
  },
});

/**
 * Public query: look up a shipment by its FedEx tracking number.
 *
 * Returns null if no shipment with that tracking number exists.
 *
 * Client usage:
 *   const shipment = useQuery(api.shipping.getShipmentByTrackingNumber, {
 *     trackingNumber: "794644823741",
 *   });
 */
export const getShipmentByTrackingNumber = query({
  args: { trackingNumber: v.string() },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    return await ctx.db
      .query("shipments")
      .withIndex("by_tracking", (q) =>
        q.eq("trackingNumber", args.trackingNumber.trim())
      )
      .first();
  },
});

// ─── listShipmentsByStatus — public query ────────────────────────────────────

/**
 * Public query: subscribe to all shipments with a specific tracking status.
 *
 * Uses the `by_status` index for O(log n + |results|) performance.
 * Results are ordered by `updatedAt` descending (most recently updated first)
 * so the M4 logistics map mode can surface recently-changed shipments.
 *
 * This is a key real-time watcher for the M4 (Logistics) map mode:
 *   • Pass status="in_transit" to watch all cases currently in transit.
 *   • Pass status="out_for_delivery" to highlight imminent deliveries.
 *   • Convex re-evaluates within ~100–300 ms of any updateShipmentStatus call.
 *
 * Client usage:
 *   const inTransit = useQuery(api.shipping.listShipmentsByStatus, {
 *     status: "in_transit",
 *   });
 *
 * @param status  The ShipmentStatus to filter by.
 * @param limit   Optional max number of records (defaults to 200, max 500).
 */
export const listShipmentsByStatus = query({
  args: {
    status: shipmentStatusValidator,
    limit:  v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const limit = Math.min(args.limit ?? 200, 500);

    return await ctx.db
      .query("shipments")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("desc")
      .take(limit);
  },
});

// ─── listActiveShipments — public query ──────────────────────────────────────

/**
 * Public query: subscribe to all shipments that are currently in progress
 * (i.e., status is NOT "delivered" and NOT "exception").
 *
 * "Active" statuses are: label_created, picked_up, in_transit, out_for_delivery.
 *
 * This query performs four separate index reads (one per active status) and
 * merges the results in memory.  This is intentional: Convex queries cannot
 * use OR conditions on indexed fields, so each status bucket is read
 * independently.  With a typical fleet of <500 shipments, the four reads are
 * fast (< 5 ms each) and the result set fits comfortably in memory.
 *
 * The combined result is sorted by `shippedAt` descending so the M4 logistics
 * map mode renders the most recently shipped cases first.
 *
 * Convex re-evaluates this query and pushes updates to all subscribers within
 * ~100–300 ms whenever:
 *   • shipCase creates a new shipment row (label_created)
 *   • updateShipmentStatus changes a shipment's status
 *
 * Returns an empty array when all shipments are in terminal states.
 *
 * Client usage:
 *   const activeShipments = useQuery(api.shipping.listActiveShipments, {});
 */
export const listActiveShipments = query({
  args: {
    /** Optional per-status limit (applied before merge; total ≤ 4 × limit). */
    limitPerStatus: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const perLimit = Math.min(args.limitPerStatus ?? 200, 500);

    // Read each active-status bucket via the by_status index (O(log n) each).
    // The union is safe in memory since active shipments are a small fraction
    // of the total fleet (<< 500 typical).
    const [labelCreated, pickedUp, inTransit, outForDelivery] = await Promise.all([
      ctx.db
        .query("shipments")
        .withIndex("by_status", (q) => q.eq("status", "label_created"))
        .order("desc")
        .take(perLimit),
      ctx.db
        .query("shipments")
        .withIndex("by_status", (q) => q.eq("status", "picked_up"))
        .order("desc")
        .take(perLimit),
      ctx.db
        .query("shipments")
        .withIndex("by_status", (q) => q.eq("status", "in_transit"))
        .order("desc")
        .take(perLimit),
      ctx.db
        .query("shipments")
        .withIndex("by_status", (q) => q.eq("status", "out_for_delivery"))
        .order("desc")
        .take(perLimit),
    ]);

    // Merge all active shipments and sort by shippedAt descending.
    // Most recently shipped appears first — matches M4 logistics panel order.
    const all = [...labelCreated, ...pickedUp, ...inTransit, ...outForDelivery];
    all.sort((a, b) => {
      const aTime = a.shippedAt ?? a.createdAt;
      const bTime = b.shippedAt ?? b.createdAt;
      return bTime - aTime;
    });

    return all;
  },
});

// ─── getShipmentSummaryForCase — public query ─────────────────────────────────

/**
 * Public query: subscribe to aggregate shipment statistics for a case.
 *
 * Returns a summary of all shipment records for the case including:
 *   • totalShipments — total count of all-time shipment records
 *   • activeCount    — currently active (non-terminal) shipments
 *   • deliveredCount — successfully delivered shipments
 *   • exceptionCount — shipments with FedEx exceptions
 *   • latestShipment — the most recently created shipment record (full row)
 *   • latestShippedAt / latestDeliveredAt — epoch ms timestamps
 *
 * Convex re-evaluates this query within ~100–300 ms whenever any shipment row
 * for this case is created or updated.
 *
 * Returns a zero-count summary (not null) when no shipments exist.
 *
 * Client usage (T4 panel header):
 *   const summary = useQuery(api.shipping.getShipmentSummaryForCase, { caseId });
 *   // summary.totalShipments → total shipment count for display
 *   // summary.latestShipment → full row for the tracking header
 */
export const getShipmentSummaryForCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const shipments = await ctx.db
      .query("shipments")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();

    // Aggregate stats in-memory (same logic as computeShipmentSummary helper).
    const caseIdStr = args.caseId.toString();
    let activeCount     = 0;
    let deliveredCount  = 0;
    let exceptionCount  = 0;
    let latestShippedAt: number | null   = null;
    let latestDeliveredAt: number | null = null;
    let latestRow: (typeof shipments)[number] | null = null;

    for (const s of shipments) {
      if (s.status === "delivered") {
        deliveredCount++;
        if (s.deliveredAt !== undefined) {
          if (latestDeliveredAt === null || s.deliveredAt > latestDeliveredAt) {
            latestDeliveredAt = s.deliveredAt;
          }
        }
      } else if (s.status === "exception") {
        exceptionCount++;
      } else {
        activeCount++;
      }

      if (s.shippedAt !== undefined) {
        if (latestShippedAt === null || s.shippedAt > latestShippedAt) {
          latestShippedAt = s.shippedAt;
        }
      }

      // Track latest by createdAt
      if (latestRow === null || s.createdAt > latestRow.createdAt) {
        latestRow = s;
      }
    }

    const latestShipment = latestRow
      ? {
          _id:              latestRow._id.toString(),
          _creationTime:    latestRow._creationTime,
          caseId:           latestRow.caseId.toString(),
          trackingNumber:   latestRow.trackingNumber,
          carrier:          latestRow.carrier,
          status:           latestRow.status,
          originLat:        latestRow.originLat,
          originLng:        latestRow.originLng,
          originName:       latestRow.originName,
          destinationLat:   latestRow.destinationLat,
          destinationLng:   latestRow.destinationLng,
          destinationName:  latestRow.destinationName,
          currentLat:       latestRow.currentLat,
          currentLng:       latestRow.currentLng,
          estimatedDelivery: latestRow.estimatedDelivery,
          shippedAt:        latestRow.shippedAt,
          deliveredAt:      latestRow.deliveredAt,
          createdAt:        latestRow.createdAt,
          updatedAt:        latestRow.updatedAt,
        }
      : null;

    return {
      caseId:           caseIdStr,
      totalShipments:   shipments.length,
      activeCount,
      deliveredCount,
      exceptionCount,
      latestShipment,
      latestShippedAt,
      latestDeliveredAt,
    };
  },
});

// ─── getLatestShipmentByCaseId — internal query ───────────────────────────────

/**
 * Internal query: fetch the most recent shipment for a case.
 *
 * Returns the shipment with the highest `createdAt` timestamp (most recently
 * created) for the given case.  Used by `getCaseTrackingStatus` to resolve
 * the active tracking number without exposing internal database access to
 * the client.
 *
 * Returns null if no shipments exist for the case.
 */
export const getLatestShipmentByCaseId = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("shipments")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .first();
  },
});

// ─── getCaseTrackingStatus — public action ────────────────────────────────────

/**
 * Public Convex action: look up live FedEx tracking status for a given case.
 *
 * This action:
 *   1. Fetches the most recent shipment record for the case via an internal
 *      query (database read).
 *   2. Returns null immediately when the case has no shipment or no tracking
 *      number has been entered yet.
 *   3. Calls the FedEx Track API and returns normalised tracking data.
 *
 * Unlike `trackShipment` (which requires the caller to already know the
 * tracking number), this action accepts only a `caseId` and resolves the
 * tracking number from the database automatically.
 *
 * Use this from the SCAN app's shipping screen or the INVENTORY dashboard's
 * T4 (Shipping) panel to fetch a live tracking refresh for a case.
 * For reactive subscriptions to the persisted (cached) status, subscribe to
 * `listShipmentsByCase` instead.
 *
 * @param caseId  Convex document ID of the case to look up.
 *
 * @returns Normalised FedEx tracking result, or null when no tracking number
 *          is recorded for the case.
 *
 * @throws  Serialisable error string on FedEx API failure (prefixed with the
 *          machine-readable error code, e.g. "[NOT_FOUND] …").
 *
 * Client usage:
 *   const tracking = await convex.action(api.shipping.getCaseTrackingStatus, {
 *     caseId: "j57abc123",
 *   });
 *   if (tracking === null) {
 *     // No shipment or tracking number recorded for this case yet
 *   } else {
 *     // tracking.status           → "in_transit" | "delivered" | …
 *     // tracking.estimatedDelivery → "2025-06-03T20:00:00Z"
 *     // tracking.events           → [{ timestamp, eventType, description, location }]
 *   }
 */
export const getCaseTrackingStatus = action({
  args: {
    caseId: v.id("cases"),
  },

  handler: async (ctx, args): Promise<FedExTrackingResult | null> => {
    await requireAuth(ctx);
    // Step 1: Load the most recent shipment for this case via an internal query.
    // Using an internal query keeps the DB access pattern isolated and allows
    // the action to remain focused on the HTTP call logic.
    const shipment = await ctx.runQuery(
      internal.shipping.getLatestShipmentByCaseId,
      { caseId: args.caseId }
    );

    // Step 2: Return null when no shipment record or no tracking number is
    // present.  This covers both "no FedEx label created yet" and the
    // (unlikely) edge case of a shipment row with an empty tracking number.
    if (!shipment) return null;

    const tn = shipment.trackingNumber?.trim() ?? "";
    if (!tn) return null;

    // Step 3: Call the FedEx Track API via the shared client helper.
    try {
      return await fetchTrackingData(tn);
    } catch (err) {
      if (err instanceof FedExClientError) {
        // Surface the machine-readable code so the client can distinguish
        // "not found" from "rate limited", configuration errors, etc.
        throw new Error(`[${err.code}] ${err.message}`);
      }
      throw err;
    }
  },
});

// ─── shipCase — SCAN app FedEx ship action mutation ───────────────────────────

/**
 * Return type for the `shipCase` mutation.
 * Exported so client hooks can expose a typed result to SCAN app components.
 */
export interface ShipCaseResult {
  /** The case that was shipped. */
  caseId: string;
  /** The new shipments record created by this mutation. */
  shipmentId: string;
  /** FedEx tracking number entered by the technician. */
  trackingNumber: string;
  /** Carrier name — always "FedEx" currently. */
  carrier: string;
  /** Epoch ms when the shipment was recorded. */
  shippedAt: number;
  /** Status before this mutation ran. */
  previousStatus: string;
}

/**
 * SCAN app mutation: record that a case has been shipped via FedEx.
 *
 * This is the primary ship action called by the SCAN mobile app when a field
 * technician or pilot enters a FedEx tracking number and confirms the shipment.
 *
 * What this mutation writes and why it matters for the dashboard:
 * ┌──────────────────────────┬──────────────────────────────────────────────────┐
 * │ Field written            │ Dashboard query effect                           │
 * ├──────────────────────────┼──────────────────────────────────────────────────┤
 * │ cases.status             │ M1 status pill; M4 in-transit filter             │
 * │                          │ (by_status index → cases WHERE status="shipping")│
 * │ cases.trackingNumber     │ T3 layout: tracking badge + deep-link to FedEx   │
 * │                          │ M4 pin tooltip; `listCases` real-time update     │
 * │ cases.carrier            │ T3 layout: carrier label ("FedEx")               │
 * │ cases.shippedAt          │ T3 layout: "Shipped N days ago" relative time    │
 * │ cases.destinationName    │ T3 layout: destination chip on case detail panel │
 * │ cases.destinationLat/Lng │ M4 pin destination position; T3 route preview   │
 * │ cases.updatedAt          │ M1 by_updated sort; "updated N min ago" label    │
 * └──────────────────────────┴──────────────────────────────────────────────────┘
 *
 * Denormalization rationale:
 *   Writing tracking fields to the cases table (in addition to creating a full
 *   shipments record) enables two performance-critical patterns:
 *
 *   1. The M4 in-transit map mode can query `cases` with the `by_status` index
 *      (status = "shipping") and get tracking info in a SINGLE table read —
 *      no join with the shipments table required for map pin rendering.
 *
 *   2. The T3 layout query (`getCaseShippingLayout`) resolves shipping summary
 *      from a single O(1) `ctx.db.get(caseId)` call, satisfying the <200 ms
 *      p50 endpoint contract for the dashboard case detail panel.
 *
 * Real-time fidelity:
 *   Writing to the cases table triggers Convex to re-evaluate ALL subscribed
 *   queries that read cases rows — including `listCases`, `getCaseStatus`,
 *   `getCaseById`, and `getCaseShippingLayout` — and push diffs to connected
 *   dashboard clients within ~100–300 ms. This satisfies the ≤ 2-second
 *   real-time fidelity requirement.
 *
 * Status transition guard:
 *   Only cases in "assembled", "deployed", "in_field", or "returned" can be
 *   shipped. Attempting to ship a case already in "shipping" status throws.
 *
 * @param caseId          Convex document ID of the case being shipped.
 * @param trackingNumber  FedEx tracking number entered by the technician.
 * @param userId          Kinde user ID of the submitting technician.
 * @param userName        Display name — written to the audit event.
 * @param carrier         Carrier name (defaults to "FedEx").
 * @param shippedAt       Override epoch ms (defaults to server Date.now()).
 * @param originName      Human-readable ship-from location.
 * @param originLat       Ship-from latitude — used for M4 route line origin.
 * @param originLng       Ship-from longitude — used for M4 route line origin.
 * @param destinationName Human-readable ship-to location → cases.destinationName.
 * @param destinationLat  Ship-to latitude → cases.destinationLat (M4 pin).
 * @param destinationLng  Ship-to longitude → cases.destinationLng (M4 pin).
 * @param notes           Optional technician notes.
 *
 * @throws When the case is not found.
 * @throws When the trackingNumber is empty after whitespace trimming.
 * @throws When the case status is already "shipping" or otherwise not shippable.
 *
 * Client usage (via useShipCase hook):
 *   const shipCase = useShipCase();
 *   const result = await shipCase({
 *     caseId:           resolvedCase._id,
 *     trackingNumber:   "794644823741",
 *     userId:           kindeUser.id,
 *     userName:         "Jane Pilot",
 *     originName:       "Site Alpha",
 *     destinationName:  "SkySpecs HQ — Ann Arbor",
 *   });
 *   // result.shipmentId       → Convex shipments row ID
 *   // result.trackingNumber   → "794644823741" (trimmed)
 *   // result.shippedAt        → epoch ms
 */
export const shipCase = mutation({
  args: {
    /** Convex document ID of the case being shipped. */
    caseId: v.id("cases"),

    /**
     * FedEx tracking number entered by the SCAN app user.
     * Whitespace is stripped before storing. Written to:
     *   cases.trackingNumber  — M4 map pin tooltip + T3 layout badge
     *   shipments.trackingNumber — full tracking history record
     */
    trackingNumber: v.string(),

    /**
     * Kinde user ID of the technician or pilot recording the shipment.
     * Written to the audit events table for attribution.
     */
    userId: v.string(),

    /**
     * Display name of the user.
     * Written to the audit events table (events.userName) and the
     * shipped event payload for the T5 audit timeline.
     */
    userName: v.string(),

    /**
     * Carrier name — defaults to "FedEx" when omitted.
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

    /** Human-readable ship-from location (e.g. "Site Alpha — Turbine Row 3"). */
    originName: v.optional(v.string()),

    /** Ship-from latitude — stored in shipments.originLat for M4 route lines. */
    originLat: v.optional(v.number()),

    /** Ship-from longitude — stored in shipments.originLng for M4 route lines. */
    originLng: v.optional(v.number()),

    /**
     * Human-readable ship-to location (e.g. "SkySpecs HQ — Ann Arbor").
     * Written to cases.destinationName — the field T3 layout reads for
     * the destination chip on the case detail panel.
     */
    destinationName: v.optional(v.string()),

    /**
     * Ship-to latitude.
     * Written to cases.destinationLat — used by M4 assembleM4() for the
     * destination pin position on the logistics map.
     */
    destinationLat: v.optional(v.number()),

    /**
     * Ship-to longitude.
     * Written to cases.destinationLng — used by M4 assembleM4() for the
     * destination pin position on the logistics map.
     */
    destinationLng: v.optional(v.number()),

    /** Optional free-text notes from the technician about this shipment. */
    notes: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<ShipCaseResult> => {
    // Reject unauthenticated requests at the function level.
    await requireAuth(ctx);

    const now     = args.shippedAt ?? Date.now();
    const carrier = args.carrier ?? "FedEx";
    const tn      = args.trackingNumber.trim();

    // ── Input validation ──────────────────────────────────────────────────────
    if (!tn) {
      throw new Error("trackingNumber must be a non-empty string.");
    }

    // ── Load and validate the case ────────────────────────────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(`Case ${args.caseId} not found.`);
    }

    const previousStatus = caseDoc.status;

    // ── Status transition guard ───────────────────────────────────────────────
    // A case can only be shipped from these statuses.
    // "transit_out" / "transit_in" → already in transit; disallowed to prevent
    // duplicate shipment records.
    const outboundShippable = ["hangar", "assembled", "received"];
    const inboundShippable  = ["deployed", "flagged"];
    const shippableStatuses = [...outboundShippable, ...inboundShippable];
    if (!shippableStatuses.includes(previousStatus)) {
      throw new Error(
        `Cannot ship case "${caseDoc.label}": status is "${previousStatus}". ` +
        `Expected one of: ${shippableStatuses.join(", ")}.`
      );
    }
    // Determine transit direction based on current status
    const transitStatus = outboundShippable.includes(previousStatus)
      ? "transit_out"
      : "transit_in";

    // ── Write denormalized tracking fields to the cases table ─────────────────
    //
    // This is the core write that "triggers" the dashboard M4 in-transit map
    // mode and T3 layout queries:
    //
    //   cases.status          → by_status index: listCases({ status: "shipping" })
    //                           M4 assembler filters by shipment status but also
    //                           uses cases table for label lookup — status change
    //                           here causes both queries to re-evaluate immediately.
    //
    //   cases.trackingNumber  → T3 getCaseShippingLayout reads this field from
    //                           ctx.db.get(caseId) — O(1), no shipments join.
    //                           M4 assembleM4 M4ShipmentPin.trackingNumber comes
    //                           from shipments table, but cases.trackingNumber
    //                           lets listCases consumers render tracking badges.
    //
    //   cases.carrier         → T3 carrier chip, M4 tooltip.
    //
    //   cases.shippedAt       → T3 "Shipped N days ago" relative timestamp.
    //
    //   cases.destinationName → T3 destination chip (no shipments join needed).
    //
    //   cases.destinationLat  → M4 assembleM4 withinBounds check uses
    //   cases.destinationLng    s.currentLat ?? s.destinationLat — now these
    //                           are also available directly on the case for
    //                           any query that reads only cases table.
    //
    //   cases.updatedAt       → by_updated index: causes listCases order to
    //                           surface this case as "recently updated", satisfying
    //                           the M1 Fleet Overview real-time update requirement.
    await ctx.db.patch(args.caseId, {
      status:          transitStatus,
      trackingNumber:  tn,
      carrier:         carrier,
      shippedAt:       now,
      destinationName: args.destinationName,
      destinationLat:  args.destinationLat,
      destinationLng:  args.destinationLng,
      // Preserve the origin as the last-known position of the case.
      // This gives M1/M2/M3 map modes the correct starting pin position
      // before the shipment's currentLat/currentLng is populated by a
      // tracking refresh.
      ...(args.originLat  !== undefined ? { lat:          args.originLat  } : {}),
      ...(args.originLng  !== undefined ? { lng:          args.originLng  } : {}),
      ...(args.originName !== undefined ? { locationName: args.originName } : {}),
      updatedAt: now,
    });

    // ── Create full shipment record in shipments table ─────────────────────────
    //
    // The shipments table holds the complete tracking history including:
    //   • Route geometry (origin + destination coordinates for M4 route lines)
    //   • currentLat / currentLng (updated by refreshShipmentTracking action)
    //   • estimatedDelivery (ISO date string from FedEx API)
    //   • Full tracking event timeline (from refreshShipmentTracking)
    //
    // This is the source of truth for M4 LogisticsMode map pins (via assembleM4)
    // and for the T3/T4 layout's detailed tracking timeline.
    const shipmentId = await ctx.db.insert("shipments", {
      caseId:          args.caseId,
      trackingNumber:  tn,
      carrier:         carrier,
      status:          "label_created",  // updated by refreshShipmentTracking
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

    // ── Record shipped event (audit trail + T5 timeline) ──────────────────────
    //
    // This event is the primary data source for the T5 audit panel's
    // "Shipped" milestone entry.  The event payload includes all fields
    // needed to render the T5 shipped card without additional DB queries.
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "shipped",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        shipmentId:      shipmentId.toString(),
        trackingNumber:  tn,
        carrier:         carrier,
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
      caseId:         args.caseId,
      shipmentId:     shipmentId.toString(),
      trackingNumber: tn,
      carrier,
      shippedAt:      now,
      previousStatus,
    };
  },
});

// ─── getCaseShippingLayout — T3 layout query ──────────────────────────────────

/**
 * TypeScript shape of the data returned by `getCaseShippingLayout`.
 * Represents the complete shipping view needed to render the T3 case detail
 * layout panel on the INVENTORY dashboard.
 */
export interface CaseShippingLayout {
  /** Convex document ID of the case. */
  caseId: string;
  /** Display label (e.g. "CASE-001"). */
  caseLabel: string;
  /** Current case lifecycle status. */
  status: string;

  // ── Denormalized tracking fields (from cases table — O(1) read) ─────────────
  /** FedEx tracking number (null when case has never been shipped). */
  trackingNumber: string | undefined;
  /** Carrier name — "FedEx" (null when not yet shipped). */
  carrier: string | undefined;
  /** Epoch ms when the shipment was recorded. */
  shippedAt: number | undefined;
  /** Human-readable destination. */
  destinationName: string | undefined;
  /** Destination latitude for M4 map pin. */
  destinationLat: number | undefined;
  /** Destination longitude for M4 map pin. */
  destinationLng: number | undefined;

  // ── Last known position (from cases table) ───────────────────────────────────
  /** Last known latitude of the case. */
  lat: number | undefined;
  /** Last known longitude of the case. */
  lng: number | undefined;
  /** Human-readable last known location name. */
  locationName: string | undefined;

  // ── Latest full shipment record (from shipments table) ────────────────────────
  /**
   * Most recently created shipment row for this case.
   * Contains route geometry, tracking events, and real-time position data.
   * null when the case has no shipment records (never shipped or pre-shipment).
   */
  latestShipment: {
    _id: string;
    _creationTime: number;
    caseId: string;
    trackingNumber: string;
    carrier: string;
    status: string;
    originLat?: number;
    originLng?: number;
    originName?: string;
    destinationLat?: number;
    destinationLng?: number;
    destinationName?: string;
    currentLat?: number;
    currentLng?: number;
    estimatedDelivery?: string;
    shippedAt?: number;
    deliveredAt?: number;
    createdAt: number;
    updatedAt: number;
  } | null;

  /** epoch ms when the case row was last modified. */
  updatedAt: number;
}

/**
 * T3 layout query: subscribe to the shipping detail view for a case.
 *
 * This is the primary data source for the T3 (Shipping/Transit) case detail
 * layout panel on the INVENTORY dashboard.  It provides:
 *
 *   • Denormalized tracking summary from the cases table — readable in a
 *     single O(1) `ctx.db.get(caseId)` call, no join required.
 *     Fields: trackingNumber, carrier, shippedAt, destinationName,
 *             destinationLat, destinationLng
 *
 *   • Full latest shipment record from the shipments table — provides the
 *     complete tracking state including origin/destination coordinates for
 *     the T3 route line, currentLat/currentLng for the live position pin,
 *     estimatedDelivery for the ETA chip, and the shipment status badge.
 *
 * Real-time subscription:
 *   Convex re-evaluates this query and pushes an update to all connected
 *   dashboard clients within ~100–300 ms whenever:
 *     • The SCAN app calls `shipCase` (cases table write + shipments insert)
 *     • `updateShipmentStatus` runs after a FedEx tracking refresh
 *       (shipments table write)
 *   Both of these reads are within a single reactive subscription — satisfying
 *   the ≤ 2-second real-time fidelity requirement.
 *
 * Returns null when the caseId does not exist in the database.
 *
 * Client usage (INVENTORY dashboard T3 panel):
 *   const shippingData = useQuery(api.shipping.getCaseShippingLayout, { caseId });
 *   if (!shippingData) return <CaseNotFound />;
 *   if (!shippingData.trackingNumber) return <NotYetShippedPlaceholder />;
 *   return <T3ShippingLayout data={shippingData} />;
 */
export const getCaseShippingLayout = query({
  args: { caseId: v.id("cases") },

  handler: async (ctx, args): Promise<CaseShippingLayout | null> => {
    await requireAuth(ctx);
    // ── Step 1: Load the case document (O(1) primary-key lookup) ──────────────
    // The denormalized tracking fields (trackingNumber, carrier, shippedAt,
    // destinationName, destinationLat, destinationLng) are read directly from
    // the case document — no shipments table join needed for the T3 summary.
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) return null;

    // ── Step 2: Load the latest shipment record for full tracking data ─────────
    // The shipments table holds the complete tracking state that the case-level
    // summary fields don't capture: origin coordinates for route rendering,
    // currentLat/currentLng for live position, estimatedDelivery, and the
    // shipment status badge (label_created → in_transit → delivered).
    //
    // Using order("desc") on the by_case index gives us the most recently
    // created shipment — O(log n + 1) where n is shipments for this case.
    const latestShipment = await ctx.db
      .query("shipments")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .first();

    // ── Step 3: Assemble and return the T3 layout shape ───────────────────────
    return {
      caseId:          caseDoc._id.toString(),
      caseLabel:       caseDoc.label,
      status:          caseDoc.status,

      // Denormalized tracking summary (from cases table — O(1) read above)
      // These are the exact fields the `shipCase` mutation writes to the
      // cases table, ensuring this query re-evaluates reactively within
      // ~100–300 ms of any shipCase call.
      trackingNumber:  caseDoc.trackingNumber,
      carrier:         caseDoc.carrier,
      shippedAt:       caseDoc.shippedAt,
      destinationName: caseDoc.destinationName,
      destinationLat:  caseDoc.destinationLat,
      destinationLng:  caseDoc.destinationLng,

      // Last known position (updated by shipCase when originLat/Lng provided)
      lat:             caseDoc.lat,
      lng:             caseDoc.lng,
      locationName:    caseDoc.locationName,

      // Full shipment record for T3 detail panel
      latestShipment: latestShipment
        ? {
            _id:              latestShipment._id.toString(),
            _creationTime:    latestShipment._creationTime,
            caseId:           latestShipment.caseId.toString(),
            trackingNumber:   latestShipment.trackingNumber,
            carrier:          latestShipment.carrier,
            status:           latestShipment.status,
            originLat:        latestShipment.originLat,
            originLng:        latestShipment.originLng,
            originName:       latestShipment.originName,
            destinationLat:   latestShipment.destinationLat,
            destinationLng:   latestShipment.destinationLng,
            destinationName:  latestShipment.destinationName,
            currentLat:       latestShipment.currentLat,
            currentLng:       latestShipment.currentLng,
            estimatedDelivery: latestShipment.estimatedDelivery,
            shippedAt:        latestShipment.shippedAt,
            deliveredAt:      latestShipment.deliveredAt,
            createdAt:        latestShipment.createdAt,
            updatedAt:        latestShipment.updatedAt,
          }
        : null,

      updatedAt: caseDoc.updatedAt,
    };
  },
});

// ─── getCaseCarrierStatus — public query ──────────────────────────────────────

import type { CaseCarrierStatus } from "./shippingHelpers";
export type { CaseCarrierStatus } from "./shippingHelpers";

/**
 * Subscribe to the FedEx carrier tracking summary denormalized on a case record.
 *
 * This is the lightweight, single-table alternative to `getCaseShippingLayout`.
 * It returns ONLY the three carrier tracking fields (carrierStatus,
 * estimatedDelivery, lastCarrierEvent) plus identifying fields — all read from
 * a single O(1) `ctx.db.get(caseId)` call, with no join to the `shipments` table.
 *
 * Use this query when:
 *   - You need ONLY the carrier status badge (not the full shipping layout)
 *   - Building map pin tooltips that show carrier status alongside case status
 *   - Rendering the SCAN app shipping screen's "Current Status" row
 *   - Building the T3 "In Transit" context banner
 *
 * Use `getCaseShippingLayout` instead when you also need the full shipment
 * record (origin/destination coordinates, shipment history, etc.).
 *
 * Data flow:
 *   SCAN app calls `shipCase`
 *     → creates shipments row + writes trackingNumber/carrier/shippedAt to case
 *     → `getCaseCarrierStatus` re-evaluates: returns trackingNumber/carrier,
 *        carrierStatus still undefined (no FedEx poll yet)
 *
 *   `refreshShipmentTracking` runs (background or on-demand)
 *     → calls FedEx Track API
 *     → calls `updateShipmentStatus`
 *         → writes carrierStatus/estimatedDelivery/lastCarrierEvent to case
 *     → `getCaseCarrierStatus` re-evaluates: all 3 carrier fields now populated
 *
 * Real-time fidelity:
 *   Convex re-evaluates this query and pushes updates to all connected clients
 *   within ~100–300 ms whenever `updateShipmentStatus` (or `shipCase`) writes to
 *   the cases table, satisfying the ≤ 2-second real-time fidelity requirement.
 *
 * Return values:
 *   `undefined`         — query is loading (initial fetch or reconnect)
 *   `null`              — case not found (deleted or invalid ID)
 *   `CaseCarrierStatus` — carrier tracking summary for the case
 *
 * Client usage (INVENTORY dashboard T3/T4, M4 map pin tooltip, SCAN app):
 *   const tracking = useQuery(api.shipping.getCaseCarrierStatus, { caseId });
 *   if (tracking === undefined) return <Skeleton />;
 *   if (tracking === null)      return <CaseNotFound />;
 *   if (!tracking.trackingNumber) return <NotYetShippedView />;
 *   return (
 *     <>
 *       <CarrierStatusBadge status={tracking.carrierStatus} />
 *       <EstimatedDeliveryChip eta={tracking.estimatedDelivery} />
 *       {tracking.lastCarrierEvent && (
 *         <LastEventRow event={tracking.lastCarrierEvent} />
 *       )}
 *     </>
 *   );
 */
export const getCaseCarrierStatus = query({
  args: { caseId: v.id("cases") },

  handler: async (ctx, args): Promise<CaseCarrierStatus | null> => {
    await requireAuth(ctx);

    // Single O(1) primary-key lookup — reads only the cases table.
    // All three carrier tracking fields are denormalized here by
    // `updateShipmentStatus`, so no shipments join is needed.
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) return null;

    return {
      caseId:            caseDoc._id.toString(),
      caseLabel:         caseDoc.label,
      caseStatus:        caseDoc.status,

      // Tracking identifier (written by shipCase)
      trackingNumber:    caseDoc.trackingNumber,
      carrier:           caseDoc.carrier,

      // Carrier tracking state (written by updateShipmentStatus after FedEx poll)
      carrierStatus:     caseDoc.carrierStatus,
      estimatedDelivery: caseDoc.estimatedDelivery,
      lastCarrierEvent:  caseDoc.lastCarrierEvent as CaseCarrierStatus["lastCarrierEvent"],

      // Timestamps
      shippedAt:         caseDoc.shippedAt,
      updatedAt:         caseDoc.updatedAt,
    };
  },
});

// ─── updateShippingStatus — public mutation ───────────────────────────────────

/**
 * Return type for the `updateShippingStatus` mutation.
 */
export interface UpdateShippingStatusResult {
  /** Convex document ID of the updated shipments row. */
  shipmentId: string;
  /** The parent case ID. */
  caseId: string;
  /** FedEx tracking number (as stored, whitespace-trimmed). */
  trackingNumber: string;
  /** Carrier name — "FedEx". */
  carrier: string;
  /** Previous shipment status before this update. */
  previousStatus: string;
  /** New shipment status after this update. */
  newStatus: string;
  /**
   * Whether the case lifecycle status was also updated.
   * True when the shipment transitioned to "delivered" and the case was
   * advanced to "deployed" (transit_out) or "received" (transit_in).
   */
  caseStatusUpdated: boolean;
  /** New case lifecycle status if it was updated; undefined otherwise. */
  newCaseStatus: string | undefined;
  /** Epoch ms of this update. */
  updatedAt: number;
}

/**
 * Public mutation: update the FedEx shipping status for a case.
 *
 * Writes a shipping status document — `(caseId, trackingNumber, carrier,
 * status, updatedAt)` — to the `shipments` table and denormalizes the
 * carrier tracking fields to the `cases` table for real-time visibility.
 *
 * This is the primary status-update path for persisting FedEx tracking poll
 * results from the SCAN app and INVENTORY dashboard.  It is distinct from
 * `shipCase`/`recordFedExShipment` (which create the initial shipment record)
 * and from the `internalMutation` `updateShipmentStatus` (which is only
 * callable server-side after a background tracking refresh).
 *
 * ## What this mutation writes and why
 *
 * ### `shipments` table (primary write)
 * The shipments table is the canonical record of FedEx tracking history.
 * This mutation writes the five core shipping status document fields:
 *
 * | Field          | Source                    | Purpose                               |
 * |----------------|---------------------------|---------------------------------------|
 * | caseId         | arg (verified vs. DB)     | Parent case ownership                 |
 * | trackingNumber | arg (trimmed, verified)   | FedEx tracking reference — primary ID |
 * | carrier        | arg (e.g. "FedEx")        | Carrier identification                |
 * | status         | arg (shipmentStatus enum) | Current FedEx tracking state          |
 * | updatedAt      | arg / Date.now()          | Timestamp of this status refresh      |
 *
 * Plus optional enrichment fields when provided:
 * - `estimatedDelivery` — ISO 8601 ETA from FedEx API
 * - `lastEvent`         — Most recent FedEx scan event
 * - `deliveredAt`       — Set when status transitions to "delivered"
 *
 * ### `cases` table (denormalization write)
 * The cases table denormalizes three carrier tracking fields for O(1) reads
 * in map modes and case detail layouts without joining to `shipments`:
 *   - `carrierStatus`     ← new status value
 *   - `estimatedDelivery` ← ISO ETA from FedEx (if provided)
 *   - `lastCarrierEvent`  ← most recent FedEx scan event (if provided)
 *   - `updatedAt`         ← always bumped to trigger reactive re-evaluation
 *
 * Writing to `cases.updatedAt` ensures that all Convex subscriptions reading
 * the cases table (listCases, getCaseStatus, getCaseShippingLayout, M4 map,
 * T3/T4 detail panels) re-evaluate within ~100–300 ms, satisfying the ≤
 * 2-second real-time fidelity requirement.
 *
 * ## Lookup strategy
 * The mutation identifies the shipment row using:
 *   1. `by_tracking` index lookup with `trackingNumber` — O(log n + 1)
 *   2. Cross-reference with `caseId` to prevent cross-case writes
 *
 * This means the caller only needs to know the `caseId` and `trackingNumber`
 * (both available in the SCAN app after calling `shipCase`), not the internal
 * Convex `shipmentId`.
 *
 * ## Delivered transition
 * When `status` is `"delivered"` and the shipment was not previously delivered:
 *   - The case lifecycle status advances:
 *     - `transit_out` → `deployed`  (arrived at field site)
 *     - `transit_in`  → `received`  (arrived back at base)
 *   - A `"delivered"` event is appended to the immutable audit trail.
 *   - `cases.updatedAt` is bumped to trigger map/detail panel re-evaluation.
 *
 * ## Auth
 * Requires a valid Kinde JWT.  Throws `[AUTH_REQUIRED]` for unauthenticated
 * requests.
 *
 * ## Error cases
 * - `[TRACKING_NOT_FOUND]`   — No shipment with this tracking number exists.
 * - `[CASE_MISMATCH]`        — Shipment exists but belongs to a different case.
 * - `[INVALID_TRACKING]`     — trackingNumber is empty after whitespace trimming.
 *
 * @param caseId          Convex document ID of the case whose shipment to update.
 * @param trackingNumber  FedEx tracking number — used to locate the shipment row.
 * @param carrier         Carrier name (e.g. "FedEx").
 * @param status          New FedEx shipment tracking status.
 * @param updatedAt       Epoch ms of this tracking refresh (defaults to now).
 * @param estimatedDelivery  ISO 8601 estimated delivery date string from FedEx.
 * @param lastEvent       Most recent FedEx scan event from the tracking poll.
 *
 * @returns UpdateShippingStatusResult on success.
 *
 * Client usage (SCAN app shipping screen, after calling `trackShipment` action):
 *   const updateStatus = useMutation(api.shipping.updateShippingStatus);
 *
 *   const result = await updateStatus({
 *     caseId:          resolvedCase._id,
 *     trackingNumber:  "794644823741",
 *     carrier:         "FedEx",
 *     status:          "in_transit",
 *     estimatedDelivery: "2025-06-03T20:00:00Z",
 *     lastEvent: {
 *       timestamp:   "2025-06-01T14:30:00Z",
 *       eventType:   "IT",
 *       description: "Package in transit to destination facility",
 *       location: { city: "Chicago", state: "IL", country: "US" },
 *     },
 *   });
 *   // result.newStatus         → "in_transit"
 *   // result.caseStatusUpdated → false
 *   // result.updatedAt         → epoch ms
 */
export const updateShippingStatus = mutation({
  args: {
    /**
     * Convex document ID of the case whose FedEx shipment status is being updated.
     *
     * Used to:
     *   1. Cross-reference the shipment located by `trackingNumber` to prevent
     *      cross-case writes (guards against tracking number collision edge cases).
     *   2. Update the denormalized `cases` carrier tracking fields so all queries
     *      subscribed to this case re-evaluate within ~100–300 ms.
     */
    caseId: v.id("cases"),

    /**
     * FedEx tracking number used to locate the shipment row.
     *
     * This is the primary FedEx tracking data reference — the same number the
     * SCAN app operator entered when calling `shipCase`.  Whitespace is stripped
     * before the `by_tracking` index lookup.
     *
     * Written to:
     *   - `shipments.trackingNumber` — updated in-place (handles carrier re-labels)
     *   - Convex `by_tracking` index — used for efficient O(log n) lookup
     */
    trackingNumber: v.string(),

    /**
     * Carrier name.  Currently always "FedEx".
     *
     * Written to `shipments.carrier` and used to populate the carrier chip in
     * the T3 layout and M4 pin tooltip.  Included in the shipping status document
     * spec so the schema can support multiple carriers in future without a migration.
     */
    carrier: v.string(),

    /**
     * New FedEx shipment tracking status.
     *
     * The primary field that drives:
     *   - `shipments.status`          — FedEx tracking state persisted
     *   - `cases.carrierStatus`       — denormalized for O(1) map pin reads
     *   - M4 logistics map status badge on shipment pins
     *   - T3 layout "In Transit" banner and tracking status chip
     *   - Case lifecycle transition (when "delivered")
     */
    status: shipmentStatusValidator,

    /**
     * Epoch ms of this tracking data refresh.
     *
     * Written to `shipments.updatedAt` and `cases.updatedAt`.  Bumping
     * `cases.updatedAt` is critical — it causes Convex to re-evaluate ALL
     * subscribed queries reading the cases table and push diffs to connected
     * dashboard clients within ~100–300 ms.
     *
     * Defaults to `Date.now()` when omitted.
     */
    updatedAt: v.optional(v.number()),

    /**
     * ISO 8601 estimated delivery date/time string from the FedEx Track API.
     * Example: "2025-06-03T20:00:00Z"
     *
     * Written to:
     *   - `shipments.estimatedDelivery` — canonical tracking record
     *   - `cases.estimatedDelivery`     — denormalized for T3/T4 ETA chip
     *
     * Only updated when this value changes from the stored value to avoid
     * unnecessary reactive re-evaluations on downstream queries.
     */
    estimatedDelivery: v.optional(v.string()),

    /**
     * Most recent FedEx scan event from the tracking poll response.
     *
     * Pass `null` when the FedEx response contains no scan events (fresh label
     * with no FedEx activity yet) — this preserves any previously stored event
     * rather than overwriting with `undefined`.
     *
     * When not-null, written to:
     *   - `shipments.lastEvent`        — persists the event on the shipment row
     *   - `cases.lastCarrierEvent`     — denormalizes for map pin tooltip access
     */
    lastEvent: v.optional(
      v.union(
        v.null(),
        v.object({
          /** ISO 8601 timestamp of the scan event (as returned by FedEx). */
          timestamp:   v.string(),
          /** Short FedEx event type code (e.g. "PU", "IT", "OD", "DL"). */
          eventType:   v.string(),
          /** Human-readable description of the scan event. */
          description: v.string(),
          /** Location where the scan event occurred. */
          location: v.object({
            city:    v.optional(v.string()),
            state:   v.optional(v.string()),
            country: v.optional(v.string()),
          }),
        })
      )
    ),
  },

  handler: async (ctx, args): Promise<UpdateShippingStatusResult> => {
    await requireAuth(ctx);

    const now = args.updatedAt ?? Date.now();
    const tn  = args.trackingNumber.trim();

    // ── Input validation ──────────────────────────────────────────────────────
    if (!tn) {
      throw new Error(
        "[INVALID_TRACKING] trackingNumber must be a non-empty string. " +
        "Provide the FedEx tracking number from the shipment label."
      );
    }

    // ── Locate shipment by tracking number ────────────────────────────────────
    //
    // Using the `by_tracking` index gives an O(log n) lookup instead of a
    // full table scan.  `.first()` returns the first matching row — tracking
    // numbers should be unique across active shipments.
    const shipment = await ctx.db
      .query("shipments")
      .withIndex("by_tracking", (q) => q.eq("trackingNumber", tn))
      .first();

    if (!shipment) {
      throw new Error(
        `[TRACKING_NOT_FOUND] No shipment found with tracking number "${tn}". ` +
        `Ensure the case was shipped via shipCase/recordFedExShipment before ` +
        `calling updateShippingStatus.`
      );
    }

    // ── Cross-reference: verify this shipment belongs to the given case ───────
    //
    // Guards against the (unlikely but possible) edge case where two cases share
    // a tracking number (e.g., a FedEx label is re-used or entered incorrectly).
    // This validation ensures the write is scoped to the intended case only.
    if (shipment.caseId.toString() !== args.caseId.toString()) {
      throw new Error(
        `[CASE_MISMATCH] Shipment "${shipment._id}" with tracking number "${tn}" ` +
        `belongs to case "${shipment.caseId}", not "${args.caseId}". ` +
        `Verify the caseId and trackingNumber before calling updateShippingStatus.`
      );
    }

    const previousStatus = shipment.status;

    // ── Build shipment patch ───────────────────────────────────────────────────
    //
    // Write all five required shipping status document fields:
    //   caseId          — unchanged (the shipment row already has it)
    //   trackingNumber  — updated in case the FedEx carrier re-labels the package
    //   carrier         — updated in case the carrier changes (forwarding)
    //   status          — the primary field being updated
    //   updatedAt       — timestamp of this tracking refresh (always written)
    //
    // Only write fields that have actually changed or are always required to
    // minimize unnecessary reactive re-evaluations on downstream queries.
    const shipmentPatch: Record<string, unknown> = {
      // Required shipping status document fields:
      trackingNumber: tn,           // re-write normalized (trimmed) tracking number
      carrier:        args.carrier, // write carrier (may change for forwarded packages)
      status:         args.status,  // new FedEx tracking status
      updatedAt:      now,          // timestamp of this status document write
    };

    // Optional enrichment fields — only update when provided and changed.
    if (
      args.estimatedDelivery !== undefined &&
      args.estimatedDelivery !== shipment.estimatedDelivery
    ) {
      shipmentPatch["estimatedDelivery"] = args.estimatedDelivery;
    }

    // Record deliveredAt on the first transition to "delivered".
    // Preserves the original delivery timestamp on subsequent no-op refreshes.
    if (args.status === "delivered" && !shipment.deliveredAt) {
      shipmentPatch["deliveredAt"] = now;
    }

    // Persist lastEvent to the shipment row when provided and non-null.
    // null means "no events in this poll response" — skip to preserve existing
    // event data rather than overwriting with undefined.
    if (args.lastEvent !== undefined && args.lastEvent !== null) {
      shipmentPatch["lastEvent"] = args.lastEvent;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(shipment._id, shipmentPatch as any);

    // ── Denormalize carrier tracking fields to the cases table ────────────────
    //
    // Writing these three fields to the cases document enables:
    //
    //   1. O(1) reads: a single ctx.db.get(caseId) returns all carrier tracking
    //      state — no secondary join to `shipments` required by T3/T4 panels or
    //      M4 logistics map assembler.
    //
    //   2. Reactive re-evaluation: ALL Convex subscriptions reading the cases
    //      table (listCases, getCaseStatus, getCaseShippingLayout, getCaseCarrierStatus,
    //      M4 assembleM4, T3 layout, T4 panel) automatically re-evaluate within
    //      ~100–300 ms of this write.  This satisfies the ≤ 2-second real-time
    //      fidelity requirement between SCAN app FedEx poll and dashboard visibility.
    //
    //   3. The cases.updatedAt bump is the key trigger: Convex watches the
    //      by_updated index, and any change to updatedAt causes all subscribed
    //      list queries to re-evaluate and push diffs to connected clients.
    const casePatch: Record<string, unknown> = {
      carrierStatus: args.status,  // denormalize: cases.carrierStatus ← new status
      updatedAt:     now,          // bump to trigger reactive re-evaluation
    };

    if (args.estimatedDelivery !== undefined) {
      casePatch["estimatedDelivery"] = args.estimatedDelivery;
    }

    if (args.lastEvent !== undefined && args.lastEvent !== null) {
      casePatch["lastCarrierEvent"] = args.lastEvent;
    }

    // ── Handle "delivered" case lifecycle transition ───────────────────────────
    //
    // When FedEx confirms delivery, advance the case lifecycle status:
    //   transit_out → deployed  (arrived at the field site)
    //   transit_in  → received  (arrived back at base)
    //
    // Only transitions when:
    //   • The new status is "delivered"
    //   • The previous shipment status was NOT already "delivered"
    //     (prevents duplicate transitions on repeated delivered poll responses)
    //   • The case is currently in a transit status (transit_out or transit_in)
    let caseStatusUpdated = false;
    let newCaseStatus: string | undefined;

    if (args.status === "delivered" && previousStatus !== "delivered") {
      const caseDoc = await ctx.db.get(args.caseId);

      if (caseDoc && (caseDoc.status === "transit_out" || caseDoc.status === "transit_in")) {
        const arrivalStatus = caseDoc.status === "transit_out" ? "deployed" : "received";

        // Write the case lifecycle transition along with the denormalized carrier fields.
        await ctx.db.patch(args.caseId, {
          ...casePatch,
          status: arrivalStatus,
        } as Parameters<typeof ctx.db.patch<"cases">>[1]);

        caseStatusUpdated = true;
        newCaseStatus = arrivalStatus;

        // Append "delivered" event to the immutable audit trail.
        // The T5 audit panel reads this event for the "Delivered" milestone card.
        await ctx.db.insert("events", {
          caseId:    args.caseId,
          eventType: "delivered",
          userId:    "system",
          userName:  "FedEx",
          timestamp: now,
          data: {
            shipmentId:          shipment._id.toString(),
            trackingNumber:      tn,
            carrier:             args.carrier,
            estimatedDelivery:   args.estimatedDelivery,
            actualDeliveredAt:   now,
            caseTransitionedTo:  arrivalStatus,
            destinationName:     shipment.destinationName,
          },
        });

        // Return early — case patch already applied above with status transition.
        return {
          shipmentId:        shipment._id.toString(),
          caseId:            args.caseId,
          trackingNumber:    tn,
          carrier:           args.carrier,
          previousStatus,
          newStatus:         args.status,
          caseStatusUpdated,
          newCaseStatus,
          updatedAt:         now,
        };
      }
    }

    // ── Non-delivery update: write carrier fields without case status change ───
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(args.caseId, casePatch as any);

    return {
      shipmentId:        shipment._id.toString(),
      caseId:            args.caseId,
      trackingNumber:    tn,
      carrier:           args.carrier,
      previousStatus,
      newStatus:         args.status,
      caseStatusUpdated,
      newCaseStatus,
      updatedAt:         now,
    };
  },
});
