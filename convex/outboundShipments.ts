/**
 * Convex functions for hangar-created outbound shipment bundles.
 */

import { mutation, query } from "./_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

const outboundShipmentStatusValidator = v.union(
  v.literal("draft"),
  v.literal("assembled"),
  v.literal("released"),
  v.literal("in_transit"),
  v.literal("delivered"),
  v.literal("cancelled"),
);

async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("[AUTH_REQUIRED] Unauthenticated.");
  }
  return identity;
}

function displayNameForUnit(unit: Doc<"units">): string {
  const nickname = unit.nickname ? ` "${unit.nickname}"` : "";
  const registration = unit.faaRegistration ? ` (${unit.faaRegistration})` : "";
  return `${unit.unitId}${nickname}${registration}`;
}

function cleanOptional(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function identityName(identity: UserIdentity): string {
  return identity.name ?? identity.email ?? identity.subject;
}

async function getCaseDocs(
  ctx: { db: { get: (id: Id<"cases">) => Promise<Doc<"cases"> | null> } },
  caseIds: Id<"cases">[],
) {
  const docs = await Promise.all(caseIds.map((caseId) => ctx.db.get(caseId)));
  return docs.filter((doc): doc is Doc<"cases"> => doc !== null);
}

export type OutboundShipmentListItem = Doc<"outboundShipments"> & {
  unit: Doc<"units"> | null;
  cases: Doc<"cases">[];
};

export const listOutboundShipments = query({
  args: {
    status: v.optional(outboundShipmentStatusValidator),
  },
  handler: async (ctx, args): Promise<OutboundShipmentListItem[]> => {
    await requireAuth(ctx);

    const rows = args.status
      ? await ctx.db
          .query("outboundShipments")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .order("desc")
          .collect()
      : await ctx.db.query("outboundShipments").withIndex("by_updated").order("desc").collect();

    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        unit: await ctx.db.get(row.unitId),
        cases: await getCaseDocs(ctx, row.caseIds),
      })),
    );
  },
});

export const getOutboundShipmentById = query({
  args: {
    shipmentId: v.id("outboundShipments"),
  },
  handler: async (ctx, args): Promise<OutboundShipmentListItem | null> => {
    await requireAuth(ctx);

    const row = await ctx.db.get(args.shipmentId);
    if (!row) return null;

    return {
      ...row,
      unit: await ctx.db.get(row.unitId),
      cases: await getCaseDocs(ctx, row.caseIds),
    };
  },
});

export const getOutboundShipmentByCase = query({
  args: {
    caseId: v.id("cases"),
  },
  handler: async (ctx, args): Promise<OutboundShipmentListItem | null> => {
    await requireAuth(ctx);

    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc?.currentOutboundShipmentId) return null;

    const row = await ctx.db.get(caseDoc.currentOutboundShipmentId);
    if (!row) return null;

    return {
      ...row,
      unit: await ctx.db.get(row.unitId),
      cases: await getCaseDocs(ctx, row.caseIds),
    };
  },
});

export const createOutboundShipment = mutation({
  args: {
    unitId: v.id("units"),
    originName: v.string(),
    destinationMissionId: v.optional(v.id("missions")),
    destinationName: v.optional(v.string()),
    destinationLat: v.optional(v.number()),
    destinationLng: v.optional(v.number()),
    recipientUserId: v.optional(v.string()),
    recipientName: v.optional(v.string()),
    caseIds: v.optional(v.array(v.id("cases"))),
    routeReason: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"outboundShipments">> => {
    const identity = await requireAuth(ctx);
    const unit = await ctx.db.get(args.unitId);
    if (!unit) {
      throw new Error(`createOutboundShipment: Unit "${args.unitId}" not found.`);
    }

    const providedCaseIds = args.caseIds ?? [];
    let caseIds = providedCaseIds;

    if (caseIds.length === 0) {
      const unitCases = await ctx.db
        .query("cases")
        .withIndex("by_unit", (q) => q.eq("unitId", args.unitId))
        .collect();
      caseIds = unitCases
        .filter((caseDoc) => ["hangar", "assembled", "received"].includes(caseDoc.status))
        .map((caseDoc) => caseDoc._id);
    }

    const uniqueCaseIds = Array.from(new Set(caseIds.map((caseId) => caseId.toString())))
      .map((caseId) => caseId as Id<"cases">);

    for (const caseId of uniqueCaseIds) {
      const caseDoc = await ctx.db.get(caseId);
      if (!caseDoc) {
        throw new Error(`createOutboundShipment: Case "${caseId}" not found.`);
      }
      if (caseDoc.unitId && caseDoc.unitId !== args.unitId) {
        throw new Error(
          `createOutboundShipment: Case "${caseDoc.label}" belongs to another unit.`,
        );
      }
    }

    const now = Date.now();
    const shipmentId = await ctx.db.insert("outboundShipments", {
      unitId: args.unitId,
      displayName: displayNameForUnit(unit),
      status: "draft",
      originName: args.originName.trim(),
      destinationMissionId: args.destinationMissionId,
      destinationName: cleanOptional(args.destinationName),
      destinationLat: args.destinationLat,
      destinationLng: args.destinationLng,
      recipientUserId: cleanOptional(args.recipientUserId),
      recipientName: cleanOptional(args.recipientName),
      caseIds: uniqueCaseIds,
      routeReason: cleanOptional(args.routeReason),
      notes: cleanOptional(args.notes),
      createdBy: identity.subject,
      createdByName: identityName(identity),
      createdAt: now,
      updatedAt: now,
    });

    await Promise.all(
      uniqueCaseIds.map(async (caseId) => {
        const caseDoc = await ctx.db.get(caseId);
        if (!caseDoc) return;
        await ctx.db.patch(caseId, {
          unitId: args.unitId,
          currentOutboundShipmentId: shipmentId,
          updatedAt: now,
        });
        await ctx.db.insert("events", {
          caseId,
          eventType: "shipment_created",
          userId: identity.subject,
          userName: identityName(identity),
          timestamp: now,
          data: {
            outboundShipmentId: shipmentId,
            displayName: displayNameForUnit(unit),
            caseLabel: caseDoc.label,
          },
        });
      }),
    );

    return shipmentId;
  },
});

export const addCaseToShipment = mutation({
  args: {
    shipmentId: v.id("outboundShipments"),
    caseId: v.id("cases"),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireAuth(ctx);

    const shipment = await ctx.db.get(args.shipmentId);
    if (!shipment) throw new Error(`addCaseToShipment: Shipment "${args.shipmentId}" not found.`);
    if (shipment.status !== "draft" && shipment.status !== "assembled") {
      throw new Error("addCaseToShipment: Only draft or assembled shipments can be edited.");
    }

    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) throw new Error(`addCaseToShipment: Case "${args.caseId}" not found.`);
    if (caseDoc.unitId && caseDoc.unitId !== shipment.unitId) {
      throw new Error(`addCaseToShipment: Case "${caseDoc.label}" belongs to another unit.`);
    }

    const caseIds = shipment.caseIds.some((caseId) => caseId === args.caseId)
      ? shipment.caseIds
      : [...shipment.caseIds, args.caseId];

    const now = Date.now();
    await ctx.db.patch(args.shipmentId, { caseIds, updatedAt: now });
    await ctx.db.patch(args.caseId, {
      unitId: caseDoc.unitId ?? shipment.unitId,
      currentOutboundShipmentId: args.shipmentId,
      updatedAt: now,
    });
  },
});

export const removeCaseFromShipment = mutation({
  args: {
    shipmentId: v.id("outboundShipments"),
    caseId: v.id("cases"),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireAuth(ctx);

    const shipment = await ctx.db.get(args.shipmentId);
    if (!shipment) {
      throw new Error(`removeCaseFromShipment: Shipment "${args.shipmentId}" not found.`);
    }
    if (shipment.status !== "draft" && shipment.status !== "assembled") {
      throw new Error("removeCaseFromShipment: Only draft or assembled shipments can be edited.");
    }

    await ctx.db.patch(args.shipmentId, {
      caseIds: shipment.caseIds.filter((caseId) => caseId !== args.caseId),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(args.caseId, {
      currentOutboundShipmentId: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const releaseOutboundShipment = mutation({
  args: {
    shipmentId: v.id("outboundShipments"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const identity = await requireAuth(ctx);

    const shipment = await ctx.db.get(args.shipmentId);
    if (!shipment) {
      throw new Error(`releaseOutboundShipment: Shipment "${args.shipmentId}" not found.`);
    }
    if (shipment.status === "released" || shipment.status === "in_transit") {
      return;
    }
    if (shipment.status !== "draft" && shipment.status !== "assembled") {
      throw new Error("releaseOutboundShipment: Only draft or assembled shipments can be released.");
    }
    if (shipment.caseIds.length === 0) {
      throw new Error("releaseOutboundShipment: Add at least one case before release.");
    }

    const now = Date.now();
    const userName = identityName(identity);
    const releaseNotes = cleanOptional(args.notes);

    for (const caseId of shipment.caseIds) {
      const caseDoc = await ctx.db.get(caseId);
      if (!caseDoc) continue;
      const previousStatus = caseDoc.status;
      if (!["hangar", "assembled", "received"].includes(previousStatus)) {
        throw new Error(
          `releaseOutboundShipment: Case "${caseDoc.label}" is ${previousStatus} and cannot be released outbound.`,
        );
      }

      await ctx.db.patch(caseId, {
        status: "transit_out",
        missionId: shipment.destinationMissionId ?? caseDoc.missionId,
        unitId: shipment.unitId,
        currentOutboundShipmentId: args.shipmentId,
        destinationName: shipment.destinationName,
        destinationLat: shipment.destinationLat,
        destinationLng: shipment.destinationLng,
        updatedAt: now,
      });

      await ctx.db.insert("events", {
        caseId,
        eventType: "status_change",
        userId: identity.subject,
        userName,
        timestamp: now,
        data: {
          previousStatus,
          newStatus: "transit_out",
          source: "outbound_shipment_release",
          outboundShipmentId: args.shipmentId,
          routeReason: shipment.routeReason,
        },
      });

      await ctx.db.insert("events", {
        caseId,
        eventType: "shipment_released",
        userId: identity.subject,
        userName,
        timestamp: now,
        data: {
          outboundShipmentId: args.shipmentId,
          displayName: shipment.displayName,
          destinationName: shipment.destinationName,
          recipientName: shipment.recipientName,
          notes: releaseNotes,
        },
      });

      if (shipment.destinationMissionId) {
        await ctx.db.insert("events", {
          caseId,
          eventType: "mission_assigned",
          userId: identity.subject,
          userName,
          timestamp: now,
          data: {
            missionId: shipment.destinationMissionId,
            source: "outbound_shipment_release",
            outboundShipmentId: args.shipmentId,
          },
        });
      }
    }

    await ctx.db.patch(args.shipmentId, {
      status: "released",
      releasedAt: now,
      notes: releaseNotes ?? shipment.notes,
      updatedAt: now,
    });
  },
});
