import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { getAuthIdentity, getCurrentUser, requireCurrentUser } from "./lib/auth";

function checklistSummary(caseId: Id<"cases">, rows: Doc<"manifestItems">[]) {
  const summary = {
    caseId,
    total: rows.length,
    ok: 0,
    damaged: 0,
    missing: 0,
    unchecked: 0,
    progressPct: 0,
    isComplete: false,
  };

  for (const row of rows) {
    summary[row.status] += 1;
  }

  const reviewed = summary.ok + summary.damaged + summary.missing;
  summary.progressPct = summary.total === 0 ? 0 : Math.round((reviewed / summary.total) * 100);
  summary.isComplete = summary.total > 0 && summary.unchecked === 0;
  return summary;
}

async function latestEvent(ctx: { db: any }, caseId: Id<"cases">) {
  return await ctx.db
    .query("events")
    .withIndex("by_case_timestamp", (q: any) => q.eq("caseId", caseId))
    .order("desc")
    .first();
}

async function latestCustody(ctx: { db: any }, caseId: Id<"cases">) {
  return await ctx.db
    .query("custodyRecords")
    .withIndex("by_case_transferred_at", (q: any) => q.eq("caseId", caseId))
    .order("desc")
    .first();
}

async function summarizeCase(ctx: { db: any }, caseDoc: Doc<"cases">) {
  const [event, custody, manifestItems, conditionNotes, shipments, outboundShipment] =
    await Promise.all([
      latestEvent(ctx, caseDoc._id),
      latestCustody(ctx, caseDoc._id),
      ctx.db.query("manifestItems").withIndex("by_case", (q: any) => q.eq("caseId", caseDoc._id)).collect(),
      ctx.db
        .query("conditionNotes")
        .withIndex("by_case_reported_at", (q: any) => q.eq("caseId", caseDoc._id))
        .order("desc")
        .take(3),
      ctx.db.query("shipments").withIndex("by_case", (q: any) => q.eq("caseId", caseDoc._id)).collect(),
      caseDoc.currentOutboundShipmentId
        ? ctx.db.get(caseDoc.currentOutboundShipmentId)
        : Promise.resolve(null),
    ]);

  shipments.sort((a: Doc<"shipments">, b: Doc<"shipments">) => b.updatedAt - a.updatedAt);

  return {
    case: caseDoc,
    latestEvent: event,
    latestCustody: custody,
    checklist: checklistSummary(caseDoc._id, manifestItems),
    conditionNotes,
    latestShipment: shipments[0] ?? null,
    outboundShipment,
  };
}

export const todayForUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await getAuthIdentity(ctx);
    if (!identity) {
      return {
        user: null,
        stats: { inHand: 0, todaysStops: 0, flags: 0 },
        sections: [
          { key: "in_custody", label: "In your custody", cases: [] },
          { key: "todays_plan", label: "Today's plan", items: [] },
        ],
      };
    }

    const userDoc = await getCurrentUser(ctx);
    const user = userDoc ?? {
      _id: identity.subject,
      kindeId: identity.subject,
      name: identity.name ?? identity.email ?? "Technician",
      email: identity.email,
    };
    const holderId = userDoc?.kindeId ?? identity.subject;

    const [heldCases, flaggedCases] = await Promise.all([
      ctx.db
        .query("cases")
        .withIndex("by_assignee", (q) => q.eq("assigneeId", holderId))
        .collect(),
      ctx.db
        .query("cases")
        .withIndex("by_status", (q) => q.eq("status", "flagged"))
        .take(25),
    ]);

    const heldSummaries = await Promise.all(heldCases.map((caseDoc) => summarizeCase(ctx, caseDoc)));
    const planItems = heldSummaries.flatMap((summary) => {
      const items = [];
      if (summary.checklist.unchecked > 0) {
        items.push({
          type: "manifest_verify" as const,
          caseId: summary.case._id,
          label: `Verify ${summary.case.label} manifest`,
          detail: `${summary.checklist.total - summary.checklist.unchecked} of ${summary.checklist.total} verified`,
        });
      }
      if (summary.case.status === "transit_out") {
        items.push({
          type: "confirm_arrival" as const,
          caseId: summary.case._id,
          label: `Confirm arrival for ${summary.case.label}`,
          detail: summary.case.destinationName ?? summary.case.locationName ?? "Destination pending",
        });
      }
      return items;
    });

    return {
      user,
      stats: {
        inHand: heldCases.length,
        todaysStops: planItems.length,
        flags: flaggedCases.length,
      },
      sections: [
        { key: "in_custody", label: "In your custody", cases: heldSummaries },
        { key: "todays_plan", label: "Today's plan", items: planItems },
      ],
    };
  },
});

export const caseMobileSummary = query({
  args: {
    caseId: v.id("cases"),
    recentEventLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);

    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) return null;

    const [summary, recentEvents] = await Promise.all([
      summarizeCase(ctx, caseDoc),
      ctx.db
        .query("events")
        .withIndex("by_case_timestamp", (q) => q.eq("caseId", args.caseId))
        .order("desc")
        .take(args.recentEventLimit ?? 8),
    ]);

    return {
      ...summary,
      recentEvents,
    };
  },
});

export const unitProfile = query({
  args: {
    unitId: v.id("units"),
    eventLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);

    const unit = await ctx.db.get(args.unitId);
    if (!unit) return null;

    const [cases, quirks, conditionNotes] = await Promise.all([
      ctx.db.query("cases").withIndex("by_unit", (q) => q.eq("unitId", args.unitId)).collect(),
      ctx.db.query("unitQuirks").withIndex("by_unit", (q) => q.eq("unitId", args.unitId)).collect(),
      ctx.db
        .query("conditionNotes")
        .withIndex("by_unit_reported_at", (q) => q.eq("unitId", args.unitId))
        .order("desc")
        .take(25),
    ]);

    const caseEvents = await Promise.all(
      cases.map((caseDoc) =>
        ctx.db
          .query("events")
          .withIndex("by_case_timestamp", (q) => q.eq("caseId", caseDoc._id))
          .order("desc")
          .take(args.eventLimit ?? 20),
      ),
    );

    const events = caseEvents.flat().sort((a, b) => b.timestamp - a.timestamp);
    const timelineCounts = {
      all: events.length,
      flags: conditionNotes.length,
      custody: events.filter((event) => event.eventType === "custody_handoff").length,
      maintenance: events.filter((event) =>
        ["qc_sign_off", "inspection_completed", "damage_reported", "condition_note"].includes(event.eventType),
      ).length,
      notes: events.filter((event) => event.eventType === "note_added").length,
      calibration: events.filter((event) => event.eventType === "qc_sign_off").length,
    };

    return {
      unit,
      containingCases: cases,
      currentCase: cases.find((caseDoc) => !["archived", "received"].includes(caseDoc.status)) ?? cases[0] ?? null,
      quirks: quirks.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt),
      conditionNotes,
      recentEvents: events.slice(0, args.eventLimit ?? 20),
      timelineCounts,
    };
  },
});
