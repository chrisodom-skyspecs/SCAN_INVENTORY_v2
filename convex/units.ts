/**
 * Convex functions for long-lived aircraft/rover unit identities.
 */

import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";

const assetTypeValidator = v.union(v.literal("aircraft"), v.literal("rover"));

async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("[AUTH_REQUIRED] Unauthenticated.");
  }
  return identity;
}

function cleanOptional(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export type UnitRecord = Doc<"units">;

export const listUnits = query({
  args: {
    assetType: v.optional(assetTypeValidator),
    platform: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<UnitRecord[]> => {
    await requireAuth(ctx);

    if (args.assetType) {
      const rows = await ctx.db
        .query("units")
        .withIndex("by_asset_type", (q) => q.eq("assetType", args.assetType!))
        .collect();
      return args.platform
        ? rows.filter((row) => row.platform === args.platform)
        : rows;
    }

    if (args.platform) {
      return await ctx.db
        .query("units")
        .withIndex("by_platform", (q) => q.eq("platform", args.platform!))
        .collect();
    }

    return await ctx.db.query("units").collect();
  },
});

export const getUnitById = query({
  args: {
    unitId: v.id("units"),
  },
  handler: async (ctx, args): Promise<UnitRecord | null> => {
    await requireAuth(ctx);
    return await ctx.db.get(args.unitId);
  },
});

export const getUnitByUnitId = query({
  args: {
    unitId: v.string(),
  },
  handler: async (ctx, args): Promise<UnitRecord | null> => {
    await requireAuth(ctx);
    const normalized = args.unitId.trim();
    if (!normalized) return null;

    return await ctx.db
      .query("units")
      .withIndex("by_unit_id", (q) => q.eq("unitId", normalized))
      .unique();
  },
});

export const createUnit = mutation({
  args: {
    unitId: v.string(),
    assetType: assetTypeValidator,
    platform: v.string(),
    version: v.optional(v.string()),
    nickname: v.optional(v.string()),
    faaRegistration: v.optional(v.string()),
    pairedBeakon: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    homeBase: v.optional(v.string()),
    currentMissionId: v.optional(v.id("missions")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"units">> => {
    await requireAuth(ctx);

    const unitId = args.unitId.trim();
    if (!unitId) {
      throw new Error("createUnit: unitId is required.");
    }

    const existing = await ctx.db
      .query("units")
      .withIndex("by_unit_id", (q) => q.eq("unitId", unitId))
      .unique();
    if (existing) {
      throw new Error(`createUnit: Unit "${unitId}" already exists.`);
    }

    const now = Date.now();
    return await ctx.db.insert("units", {
      unitId,
      assetType: args.assetType,
      platform: args.platform.trim(),
      version: cleanOptional(args.version),
      nickname: cleanOptional(args.nickname),
      faaRegistration: cleanOptional(args.faaRegistration),
      pairedBeakon: cleanOptional(args.pairedBeakon),
      serialNumber: cleanOptional(args.serialNumber),
      homeBase: cleanOptional(args.homeBase),
      currentMissionId: args.currentMissionId,
      notes: cleanOptional(args.notes),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateUnit = mutation({
  args: {
    id: v.id("units"),
    unitId: v.optional(v.string()),
    assetType: v.optional(assetTypeValidator),
    platform: v.optional(v.string()),
    version: v.optional(v.string()),
    nickname: v.optional(v.string()),
    faaRegistration: v.optional(v.string()),
    pairedBeakon: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    homeBase: v.optional(v.string()),
    currentMissionId: v.optional(v.id("missions")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"units">> => {
    await requireAuth(ctx);

    const unit = await ctx.db.get(args.id);
    if (!unit) {
      throw new Error(`updateUnit: Unit "${args.id}" not found.`);
    }

    const patch: Partial<Doc<"units">> = {
      updatedAt: Date.now(),
    };

    if (args.unitId !== undefined) {
      const nextUnitId = args.unitId.trim();
      if (!nextUnitId) {
        throw new Error("updateUnit: unitId cannot be empty.");
      }
      if (nextUnitId !== unit.unitId) {
        const existing = await ctx.db
          .query("units")
          .withIndex("by_unit_id", (q) => q.eq("unitId", nextUnitId))
          .unique();
        if (existing) {
          throw new Error(`updateUnit: Unit "${nextUnitId}" already exists.`);
        }
      }
      patch.unitId = nextUnitId;
    }

    if (args.assetType !== undefined) patch.assetType = args.assetType;
    if (args.platform !== undefined) patch.platform = args.platform.trim();
    if (args.version !== undefined) patch.version = cleanOptional(args.version);
    if (args.nickname !== undefined) patch.nickname = cleanOptional(args.nickname);
    if (args.faaRegistration !== undefined) {
      patch.faaRegistration = cleanOptional(args.faaRegistration);
    }
    if (args.pairedBeakon !== undefined) {
      patch.pairedBeakon = cleanOptional(args.pairedBeakon);
    }
    if (args.serialNumber !== undefined) patch.serialNumber = cleanOptional(args.serialNumber);
    if (args.homeBase !== undefined) patch.homeBase = cleanOptional(args.homeBase);
    if (args.currentMissionId !== undefined) patch.currentMissionId = args.currentMissionId;
    if (args.notes !== undefined) patch.notes = cleanOptional(args.notes);

    await ctx.db.patch(args.id, patch);
    return args.id;
  },
});
