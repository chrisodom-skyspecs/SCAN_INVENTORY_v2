import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("unit shipments and recall backend wiring", () => {
  it("defines the durable unit and outbound shipment tables", () => {
    const schema = read("convex/schema.ts");

    expect(schema).toContain("units: defineTable");
    expect(schema).toContain("outboundShipments: defineTable");
    expect(schema).toContain("unitQuirks: defineTable");
    expect(schema).toContain("conditionNotes: defineTable");
    expect(schema).toContain('.index("by_assignee", ["assigneeId"])');
    expect(schema).toContain('v.literal("recalled")');
    expect(schema).toContain('v.literal("case_recalled")');
    expect(schema).toContain('v.literal("condition_note")');
    expect(schema).toContain('v.literal("shipment_created")');
    expect(schema).toContain('v.literal("shipment_released")');
  });

  it("exposes mutations for recall and outbound shipment release", () => {
    const cases = read("convex/cases.ts");
    const outboundShipments = read("convex/outboundShipments.ts");

    expect(cases).toContain("export const recallCase = mutation");
    expect(cases).toContain('eventType: "case_recalled"');
    expect(cases).toContain('type: "case_recalled"');
    expect(outboundShipments).toContain("export const createOutboundShipment = mutation");
    expect(outboundShipments).toContain("export const getOutboundShipmentByCase = query");
    expect(outboundShipments).toContain("export const releaseOutboundShipment = mutation");
    expect(outboundShipments).toContain('eventType: "shipment_released"');
    expect(outboundShipments).toContain("currentOutboundShipmentId");
  });

  it("dual-writes SCAN mobile scan and custody audit logs", () => {
    const scanMutations = read("convex/mutations/scan.ts");
    const custodyHandoffs = read("convex/custodyHandoffs.ts");

    expect(scanMutations).toContain('ctx.db.insert("scan_events"');
    expect(scanMutations).toContain("clientId");
    expect(custodyHandoffs).toContain('ctx.db.insert("custody_handoffs"');
    expect(custodyHandoffs).toContain("clientId");
  });

  it("exposes SCAN mobile read models and condition notes", () => {
    const scanMobile = read("convex/scanMobile.ts");
    const conditionNotes = read("convex/conditionNotes.ts");

    expect(scanMobile).toContain("export const todayForUser = query");
    expect(scanMobile).toContain("export const caseMobileSummary = query");
    expect(scanMobile).toContain("export const unitProfile = query");
    expect(conditionNotes).toContain("export const create = mutation");
    expect(conditionNotes).toContain('eventType: "condition_note"');
  });
});
