import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireCurrentUser, requireAuthIdentity } from "./lib/auth";

const conditionComponent = v.union(
  v.literal("airframe"),
  v.literal("prop"),
  v.literal("battery"),
  v.literal("camera"),
  v.literal("controller"),
  v.literal("case"),
  v.literal("other"),
);

const conditionSeverity = v.union(
  v.literal("info"),
  v.literal("minor"),
  v.literal("major"),
  v.literal("ground"),
);

export const forCase = query({
  args: {
    caseId: v.id("cases"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuthIdentity(ctx);

    const rows = await ctx.db
      .query("conditionNotes")
      .withIndex("by_case_reported_at", (q) => q.eq("caseId", args.caseId))
      .order("desc")
      .take(args.limit ?? 50);

    return rows;
  },
});

export const forUnit = query({
  args: {
    unitId: v.id("units"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuthIdentity(ctx);

    const rows = await ctx.db
      .query("conditionNotes")
      .withIndex("by_unit_reported_at", (q) => q.eq("unitId", args.unitId))
      .order("desc")
      .take(args.limit ?? 50);

    return rows;
  },
});

export const create = mutation({
  args: {
    caseId: v.id("cases"),
    unitId: v.optional(v.id("units")),
    manifestItemId: v.optional(v.id("manifestItems")),
    component: conditionComponent,
    severity: conditionSeverity,
    summary: v.string(),
    photoStorageIds: v.optional(v.array(v.string())),
    clientId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    conditionNoteId: Id<"conditionNotes">;
    eventId: Id<"events"> | undefined;
    statusChanged: boolean;
    duplicate: boolean;
  }> => {
    const user = await requireCurrentUser(ctx);

    if (args.clientId) {
      const existing = await ctx.db
        .query("conditionNotes")
        .withIndex("by_client_id", (q) => q.eq("clientId", args.clientId))
        .first();
      if (existing) {
        return {
          conditionNoteId: existing._id,
          eventId: existing.eventId,
          statusChanged: false,
          duplicate: true,
        };
      }
    }

    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(`conditionNotes.create: Case "${args.caseId}" not found.`);
    }

    if (args.unitId) {
      const unit = await ctx.db.get(args.unitId);
      if (!unit) {
        throw new Error(`conditionNotes.create: Unit "${args.unitId}" not found.`);
      }
    }

    if (args.manifestItemId) {
      const item = await ctx.db.get(args.manifestItemId);
      if (!item || item.caseId !== args.caseId) {
        throw new Error("conditionNotes.create: Manifest item does not belong to this case.");
      }
    }

    const now = Date.now();
    const noteId = await ctx.db.insert("conditionNotes", {
      caseId: args.caseId,
      unitId: args.unitId ?? caseDoc.unitId,
      manifestItemId: args.manifestItemId,
      component: args.component,
      severity: args.severity,
      summary: args.summary.trim(),
      photoStorageIds: args.photoStorageIds,
      reportedById: user.kindeId,
      reportedByName: user.name,
      reportedAt: now,
      clientId: args.clientId,
    });

    const eventId = await ctx.db.insert("events", {
      caseId: args.caseId,
      eventType: "condition_note",
      userId: user.kindeId,
      userName: user.name,
      timestamp: now,
      clientId: args.clientId,
      data: {
        conditionNoteId: noteId,
        unitId: args.unitId ?? caseDoc.unitId,
        manifestItemId: args.manifestItemId,
        component: args.component,
        severity: args.severity,
        summary: args.summary.trim(),
        photoCount: args.photoStorageIds?.length ?? 0,
      },
    });

    await ctx.db.patch(noteId, { eventId });

    const shouldFlag = args.severity !== "info" && caseDoc.status !== "flagged";
    if (shouldFlag) {
      await ctx.db.patch(args.caseId, {
        status: "flagged",
        updatedAt: now,
      });
    }

    return {
      conditionNoteId: noteId,
      eventId,
      statusChanged: shouldFlag,
      duplicate: false,
    };
  },
});
