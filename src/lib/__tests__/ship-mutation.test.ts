/**
 * src/lib/__tests__/ship-mutation.test.ts
 *
 * Unit tests for the canonical SCAN app FedEx ship action mutation defined in
 * convex/mutations/ship.ts.  This file exercises the mutation handler logic
 * directly using a mocked Convex context, validating that:
 *
 *   1. The handler refuses unauthenticated requests with [AUTH_REQUIRED].
 *   2. Empty / whitespace-only tracking numbers are rejected with
 *      [TRACKING_NUMBER_REQUIRED].
 *   3. Missing cases are rejected with [CASE_NOT_FOUND].
 *   4. Cases in non-shippable statuses (transit_*, archived) are rejected
 *      with [INVALID_SHIP_STATUS].
 *   5. Valid outbound transitions (hangar / assembled / received) write
 *      cases.status = "transit_out".
 *   6. Valid inbound transitions (deployed / flagged) write
 *      cases.status = "transit_in".
 *   7. The handler atomically writes to all four tables: cases (PATCH),
 *      shipments (INSERT), events (INSERT × 2 for status_change + shipped).
 *   8. The shipped event payload mirrors all shipment fields for self-contained
 *      T5 audit panel reconstruction.
 *
 * These guarantees underpin the Sub-AC 4 acceptance criterion: "Implement
 * Convex mutation for ship action that records FedEx shipping events and
 * updates case shipping status in shared state tables."
 *
 * Mocking strategy
 * ────────────────
 * The mutation handler depends on three context interfaces:
 *   • ctx.auth.getUserIdentity()   — auth guard
 *   • ctx.db.get(id)               — case lookup
 *   • ctx.db.patch(id, fields)     — case PATCH
 *   • ctx.db.insert(table, fields) — shipments + events INSERT
 *
 * The handler is exported via the `mutation({ args, handler })` wrapper.  We
 * import the module's compiled handler function and invoke it directly with a
 * mock ctx — this exercises the same logic Convex's runtime would invoke
 * without requiring a live Convex deployment.
 *
 * Run: npx vitest run src/lib/__tests__/ship-mutation.test.ts
 */

import { describe, it, expect, vi } from "vitest";

// ─── Import the mutation under test ──────────────────────────────────────────
//
// The Convex `mutation()` wrapper exposes the underlying handler under the
// `_handler` symbol property when bundled in test mode.  The compiled module
// also exposes the handler via a closure that accepts `(ctx, args)`.  We import
// the source module (TypeScript) which Vitest transpiles via the project's
// vite config — the mutation factory's handler is registered on the function
// reference returned by the call.
//
// To exercise the handler without invoking Convex's runtime, we re-import the
// raw handler logic by re-implementing the wrapper's input contract: the
// handler is called with (ctx, args) and returns Promise<RecordShipmentResult>.
//
// We replicate this by mocking ../../../convex/_generated/server's `mutation`
// export to capture the handler when the module is imported, then invoke it
// directly.
vi.mock("../../../convex/_generated/server", () => {
  return {
    mutation: ({
      handler,
    }: {
      args: unknown;
      handler: (ctx: unknown, args: unknown) => unknown;
    }) => handler,
  };
});

// Importing AFTER the mock is registered yields the raw handler functions.
// The exported `recordShipment` is now the async (ctx, args) => result function.
import { recordShipment } from "../../../convex/mutations/ship";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const recordShipmentHandler = recordShipment as unknown as (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<{
  caseId: string;
  shipmentId: string;
  trackingNumber: string;
  carrier: string;
  previousStatus: string;
  newStatus: "transit_out" | "transit_in";
  shippedAt: number;
  statusChangeEventId: string;
  shippedEventId: string;
}>;

// ─── Mock context fixtures ───────────────────────────────────────────────────

const MOCK_IDENTITY = {
  subject: "kinde_user_abc123",
  tokenIdentifier: "kinde_user_abc123|https://skyspecs.kinde.com",
  issuer: "https://skyspecs.kinde.com",
  name: "Jane Pilot",
  email: "jane@skyspecs.com",
};

interface InsertCall {
  table: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any;
}

interface PatchCall {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields: any;
}

interface MockCtxOptions {
  authenticated?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  caseDoc?: any | null;
}

interface MockCtx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any;
  inserts: InsertCall[];
  patches: PatchCall[];
}

/**
 * Build a mock Convex context that captures every db.insert and db.patch call
 * for assertion.  Returns the ctx along with the captured call lists so each
 * test can verify exactly which writes the mutation performed.
 */
function makeCtx(opts: MockCtxOptions = {}): MockCtx {
  const { authenticated = true, caseDoc } = opts;
  const inserts: InsertCall[] = [];
  const patches: PatchCall[] = [];

  let nextId = 1;
  const generateId = (table: string) => `${table}_id_${nextId++}`;

  const ctx = {
    auth: {
      getUserIdentity: async () => (authenticated ? MOCK_IDENTITY : null),
    },
    db: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get: async (_id: string) => caseDoc ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      patch: async (id: string, fields: any) => {
        patches.push({ id, fields });
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insert: async (table: string, doc: any) => {
        const id = generateId(table);
        inserts.push({ table, doc: { ...doc, _id: id } });
        // The handler calls .toString() on the returned ID; mimic by returning
        // an object with a toString method so result IDs are stable strings.
        return {
          toString: () => id,
        };
      },
    },
  };

  return { ctx, inserts, patches };
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

const ASSEMBLED_CASE = {
  _id: "cases_id_1",
  label: "CASE-001",
  qrCode: "https://scan.skyspecs.com/case/cases_id_1",
  status: "assembled",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const DEPLOYED_CASE = {
  ...ASSEMBLED_CASE,
  _id: "cases_id_2",
  label: "CASE-002",
  status: "deployed",
};

const FLAGGED_CASE = {
  ...ASSEMBLED_CASE,
  _id: "cases_id_3",
  label: "CASE-003",
  status: "flagged",
};

const TRANSIT_OUT_CASE = {
  ...ASSEMBLED_CASE,
  _id: "cases_id_4",
  label: "CASE-004",
  status: "transit_out",
};

const ARCHIVED_CASE = {
  ...ASSEMBLED_CASE,
  _id: "cases_id_5",
  label: "CASE-005",
  status: "archived",
};

const HANGAR_CASE = {
  ...ASSEMBLED_CASE,
  _id: "cases_id_6",
  label: "CASE-006",
  status: "hangar",
};

const RECEIVED_CASE = {
  ...ASSEMBLED_CASE,
  _id: "cases_id_7",
  label: "CASE-007",
  status: "received",
};

const VALID_ARGS = {
  trackingNumber: "794644823741",
  userId: "kinde_user_abc123",
  userName: "Jane Pilot",
  shippedAt: 1_700_000_001_000,
  originName: "Site Alpha — Turbine Row 3",
  originLat: 42.3601,
  originLng: -71.0589,
  destinationName: "SkySpecs HQ — Ann Arbor",
  destinationLat: 42.2808,
  destinationLng: -83.7430,
  notes: "Returning damaged battery for diagnostics",
};

// ─── recordShipment — authentication ─────────────────────────────────────────

describe("recordShipment — authentication guard", () => {
  it("rejects unauthenticated requests with [AUTH_REQUIRED]", async () => {
    const { ctx } = makeCtx({ authenticated: false, caseDoc: ASSEMBLED_CASE });

    await expect(
      recordShipmentHandler(ctx, {
        caseId: ASSEMBLED_CASE._id,
        ...VALID_ARGS,
      }),
    ).rejects.toThrow(/\[AUTH_REQUIRED\]/);
  });

  it("does not perform any database writes when unauthenticated", async () => {
    const { ctx, inserts, patches } = makeCtx({
      authenticated: false,
      caseDoc: ASSEMBLED_CASE,
    });

    try {
      await recordShipmentHandler(ctx, {
        caseId: ASSEMBLED_CASE._id,
        ...VALID_ARGS,
      });
    } catch {
      // expected
    }

    expect(inserts).toHaveLength(0);
    expect(patches).toHaveLength(0);
  });
});

// ─── recordShipment — input validation ───────────────────────────────────────

describe("recordShipment — input validation", () => {
  it("rejects empty tracking numbers with [TRACKING_NUMBER_REQUIRED]", async () => {
    const { ctx } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    await expect(
      recordShipmentHandler(ctx, {
        caseId: ASSEMBLED_CASE._id,
        ...VALID_ARGS,
        trackingNumber: "",
      }),
    ).rejects.toThrow(/\[TRACKING_NUMBER_REQUIRED\]/);
  });

  it("rejects whitespace-only tracking numbers with [TRACKING_NUMBER_REQUIRED]", async () => {
    const { ctx } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    await expect(
      recordShipmentHandler(ctx, {
        caseId: ASSEMBLED_CASE._id,
        ...VALID_ARGS,
        trackingNumber: "   \t  ",
      }),
    ).rejects.toThrow(/\[TRACKING_NUMBER_REQUIRED\]/);
  });

  it("rejects missing cases with [CASE_NOT_FOUND]", async () => {
    const { ctx } = makeCtx({ caseDoc: null });

    await expect(
      recordShipmentHandler(ctx, {
        caseId: "cases_id_missing",
        ...VALID_ARGS,
      }),
    ).rejects.toThrow(/\[CASE_NOT_FOUND\]/);
  });

  it("trims whitespace from tracking numbers before persisting", async () => {
    const { ctx, inserts, patches } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    const result = await recordShipmentHandler(ctx, {
      caseId: ASSEMBLED_CASE._id,
      ...VALID_ARGS,
      trackingNumber: "  794644823741  ",
    });

    expect(result.trackingNumber).toBe("794644823741");

    const casePatch = patches[0];
    expect(casePatch.fields.trackingNumber).toBe("794644823741");

    const shipmentInsert = inserts.find((i) => i.table === "shipments");
    expect(shipmentInsert?.doc.trackingNumber).toBe("794644823741");
  });
});

// ─── recordShipment — status transition guard ────────────────────────────────

describe("recordShipment — status transition guard", () => {
  it("rejects cases already in transit_out with [INVALID_SHIP_STATUS]", async () => {
    const { ctx } = makeCtx({ caseDoc: TRANSIT_OUT_CASE });

    await expect(
      recordShipmentHandler(ctx, {
        caseId: TRANSIT_OUT_CASE._id,
        ...VALID_ARGS,
      }),
    ).rejects.toThrow(/\[INVALID_SHIP_STATUS\]/);
  });

  it("rejects archived cases with [INVALID_SHIP_STATUS]", async () => {
    const { ctx } = makeCtx({ caseDoc: ARCHIVED_CASE });

    await expect(
      recordShipmentHandler(ctx, {
        caseId: ARCHIVED_CASE._id,
        ...VALID_ARGS,
      }),
    ).rejects.toThrow(/\[INVALID_SHIP_STATUS\]/);
  });

  it("error message lists the previous status for diagnostic clarity", async () => {
    const { ctx } = makeCtx({ caseDoc: ARCHIVED_CASE });

    await expect(
      recordShipmentHandler(ctx, {
        caseId: ARCHIVED_CASE._id,
        ...VALID_ARGS,
      }),
    ).rejects.toThrow(/archived/);
  });
});

// ─── recordShipment — outbound shipment ─────────────────────────────────────

describe("recordShipment — outbound shipments (transit_out)", () => {
  it("transitions assembled → transit_out", async () => {
    const { ctx } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    const result = await recordShipmentHandler(ctx, {
      caseId: ASSEMBLED_CASE._id,
      ...VALID_ARGS,
    });

    expect(result.previousStatus).toBe("assembled");
    expect(result.newStatus).toBe("transit_out");
  });

  it("transitions hangar → transit_out", async () => {
    const { ctx } = makeCtx({ caseDoc: HANGAR_CASE });

    const result = await recordShipmentHandler(ctx, {
      caseId: HANGAR_CASE._id,
      ...VALID_ARGS,
    });

    expect(result.previousStatus).toBe("hangar");
    expect(result.newStatus).toBe("transit_out");
  });

  it("transitions received → transit_out", async () => {
    const { ctx } = makeCtx({ caseDoc: RECEIVED_CASE });

    const result = await recordShipmentHandler(ctx, {
      caseId: RECEIVED_CASE._id,
      ...VALID_ARGS,
    });

    expect(result.previousStatus).toBe("received");
    expect(result.newStatus).toBe("transit_out");
  });
});

// ─── recordShipment — inbound shipment ─────────────────────────────────────

describe("recordShipment — inbound shipments (transit_in)", () => {
  it("transitions deployed → transit_in", async () => {
    const { ctx } = makeCtx({ caseDoc: DEPLOYED_CASE });

    const result = await recordShipmentHandler(ctx, {
      caseId: DEPLOYED_CASE._id,
      ...VALID_ARGS,
    });

    expect(result.previousStatus).toBe("deployed");
    expect(result.newStatus).toBe("transit_in");
  });

  it("transitions flagged → transit_in", async () => {
    const { ctx } = makeCtx({ caseDoc: FLAGGED_CASE });

    const result = await recordShipmentHandler(ctx, {
      caseId: FLAGGED_CASE._id,
      ...VALID_ARGS,
    });

    expect(result.previousStatus).toBe("flagged");
    expect(result.newStatus).toBe("transit_in");
  });
});

// ─── recordShipment — atomic write contract ──────────────────────────────────

describe("recordShipment — atomic write contract (cases + shipments + events)", () => {
  it("writes to exactly four tables: cases (PATCH), shipments (INSERT), events × 2 (INSERT)", async () => {
    const { ctx, inserts, patches } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    await recordShipmentHandler(ctx, {
      caseId: ASSEMBLED_CASE._id,
      ...VALID_ARGS,
    });

    expect(patches).toHaveLength(1);
    expect(patches[0].id).toBe(ASSEMBLED_CASE._id);

    const insertedTables = inserts.map((i) => i.table).sort();
    expect(insertedTables).toEqual(["events", "events", "shipments"]);
  });

  it("PATCHes the case with denormalized tracking fields", async () => {
    const { ctx, patches } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    await recordShipmentHandler(ctx, {
      caseId: ASSEMBLED_CASE._id,
      ...VALID_ARGS,
    });

    const fields = patches[0].fields;
    expect(fields.status).toBe("transit_out");
    expect(fields.trackingNumber).toBe("794644823741");
    expect(fields.carrier).toBe("FedEx");
    expect(fields.shippedAt).toBe(VALID_ARGS.shippedAt);
    expect(fields.destinationName).toBe(VALID_ARGS.destinationName);
    expect(fields.destinationLat).toBe(VALID_ARGS.destinationLat);
    expect(fields.destinationLng).toBe(VALID_ARGS.destinationLng);
    expect(fields.updatedAt).toBe(VALID_ARGS.shippedAt);
  });

  it("writes the origin coordinates to cases.lat/lng/locationName as last-known position", async () => {
    const { ctx, patches } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    await recordShipmentHandler(ctx, {
      caseId: ASSEMBLED_CASE._id,
      ...VALID_ARGS,
    });

    const fields = patches[0].fields;
    expect(fields.lat).toBe(VALID_ARGS.originLat);
    expect(fields.lng).toBe(VALID_ARGS.originLng);
    expect(fields.locationName).toBe(VALID_ARGS.originName);
  });

  it("INSERTs a canonical shipments row with status=label_created", async () => {
    const { ctx, inserts } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    await recordShipmentHandler(ctx, {
      caseId: ASSEMBLED_CASE._id,
      ...VALID_ARGS,
    });

    const shipment = inserts.find((i) => i.table === "shipments");
    expect(shipment).toBeDefined();
    expect(shipment!.doc.caseId).toBe(ASSEMBLED_CASE._id);
    expect(shipment!.doc.trackingNumber).toBe("794644823741");
    expect(shipment!.doc.carrier).toBe("FedEx");
    expect(shipment!.doc.status).toBe("label_created");
    expect(shipment!.doc.originLat).toBe(VALID_ARGS.originLat);
    expect(shipment!.doc.originLng).toBe(VALID_ARGS.originLng);
    expect(shipment!.doc.destinationName).toBe(VALID_ARGS.destinationName);
    expect(shipment!.doc.shippedAt).toBe(VALID_ARGS.shippedAt);
    expect(shipment!.doc.createdAt).toBe(VALID_ARGS.shippedAt);
    expect(shipment!.doc.updatedAt).toBe(VALID_ARGS.shippedAt);
  });

  it("INSERTs a status_change event linking previous → new status", async () => {
    const { ctx, inserts } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    await recordShipmentHandler(ctx, {
      caseId: ASSEMBLED_CASE._id,
      ...VALID_ARGS,
    });

    const events = inserts.filter((i) => i.table === "events");
    const statusChange = events.find((e) => e.doc.eventType === "status_change");
    expect(statusChange).toBeDefined();
    expect(statusChange!.doc.caseId).toBe(ASSEMBLED_CASE._id);
    expect(statusChange!.doc.userId).toBe(VALID_ARGS.userId);
    expect(statusChange!.doc.userName).toBe(VALID_ARGS.userName);
    expect(statusChange!.doc.timestamp).toBe(VALID_ARGS.shippedAt);
    expect(statusChange!.doc.data.from).toBe("assembled");
    expect(statusChange!.doc.data.to).toBe("transit_out");
    expect(statusChange!.doc.data.trackingNumber).toBe("794644823741");
    expect(statusChange!.doc.data.carrier).toBe("FedEx");
  });

  it("INSERTs a shipped event with full ship payload for T5 audit", async () => {
    const { ctx, inserts } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    await recordShipmentHandler(ctx, {
      caseId: ASSEMBLED_CASE._id,
      ...VALID_ARGS,
    });

    const events = inserts.filter((i) => i.table === "events");
    const shipped = events.find((e) => e.doc.eventType === "shipped");
    expect(shipped).toBeDefined();

    const data = shipped!.doc.data;
    expect(data.trackingNumber).toBe("794644823741");
    expect(data.carrier).toBe("FedEx");
    expect(data.originName).toBe(VALID_ARGS.originName);
    expect(data.originLat).toBe(VALID_ARGS.originLat);
    expect(data.originLng).toBe(VALID_ARGS.originLng);
    expect(data.destinationName).toBe(VALID_ARGS.destinationName);
    expect(data.destinationLat).toBe(VALID_ARGS.destinationLat);
    expect(data.destinationLng).toBe(VALID_ARGS.destinationLng);
    expect(data.previousStatus).toBe("assembled");
    expect(data.newStatus).toBe("transit_out");
    expect(data.notes).toBe(VALID_ARGS.notes);
    expect(data.source).toBe("scan_ship_action");
    // The shipped event references the canonical shipments row by ID.
    expect(typeof data.shipmentId).toBe("string");
    expect(data.shipmentId.length).toBeGreaterThan(0);
  });

  it("links the status_change event to the canonical shipments row", async () => {
    const { ctx, inserts } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    await recordShipmentHandler(ctx, {
      caseId: ASSEMBLED_CASE._id,
      ...VALID_ARGS,
    });

    const shipment = inserts.find((i) => i.table === "shipments");
    const events = inserts.filter((i) => i.table === "events");
    const statusChange = events.find((e) => e.doc.eventType === "status_change");

    expect(statusChange!.doc.data.shipmentId).toBe(shipment!.doc._id);
  });
});

// ─── recordShipment — defaults & overrides ───────────────────────────────────

describe("recordShipment — defaults and overrides", () => {
  it("defaults carrier to 'FedEx' when omitted", async () => {
    const { ctx, inserts, patches } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    const result = await recordShipmentHandler(ctx, {
      caseId: ASSEMBLED_CASE._id,
      trackingNumber: "794644823741",
      userId: VALID_ARGS.userId,
      userName: VALID_ARGS.userName,
      shippedAt: VALID_ARGS.shippedAt,
    });

    expect(result.carrier).toBe("FedEx");
    expect(patches[0].fields.carrier).toBe("FedEx");
    expect(inserts.find((i) => i.table === "shipments")!.doc.carrier).toBe(
      "FedEx",
    );
  });

  it("respects an explicit carrier override", async () => {
    const { ctx } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    const result = await recordShipmentHandler(ctx, {
      caseId: ASSEMBLED_CASE._id,
      ...VALID_ARGS,
      carrier: "UPS",
    });

    expect(result.carrier).toBe("UPS");
  });

  it("preserves last-known position when origin coordinates are omitted", async () => {
    const { ctx, patches } = makeCtx({ caseDoc: ASSEMBLED_CASE });

    await recordShipmentHandler(ctx, {
      caseId: ASSEMBLED_CASE._id,
      trackingNumber: "794644823741",
      userId: VALID_ARGS.userId,
      userName: VALID_ARGS.userName,
      shippedAt: VALID_ARGS.shippedAt,
      destinationName: VALID_ARGS.destinationName,
    });

    const fields = patches[0].fields;
    // Origin lat/lng/locationName were not provided — these fields should not
    // be present in the patch (preserving prior values on the cases row).
    expect("lat" in fields).toBe(false);
    expect("lng" in fields).toBe(false);
    expect("locationName" in fields).toBe(false);
  });

  it("returns a typed RecordShipmentResult with all required fields", async () => {
    const { ctx } = makeCtx({ caseDoc: DEPLOYED_CASE });

    const result = await recordShipmentHandler(ctx, {
      caseId: DEPLOYED_CASE._id,
      ...VALID_ARGS,
    });

    expect(result).toMatchObject({
      caseId: DEPLOYED_CASE._id,
      trackingNumber: "794644823741",
      carrier: "FedEx",
      previousStatus: "deployed",
      newStatus: "transit_in",
      shippedAt: VALID_ARGS.shippedAt,
    });
    expect(typeof result.shipmentId).toBe("string");
    expect(typeof result.statusChangeEventId).toBe("string");
    expect(typeof result.shippedEventId).toBe("string");
  });
});
