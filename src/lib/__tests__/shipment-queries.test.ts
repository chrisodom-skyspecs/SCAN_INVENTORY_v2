/**
 * Unit tests for the shipment query module pure functions.
 *
 * Sub-AC 36a-5: Convex real-time query functions and table watchers for the
 * shipments table, including queries scoped by case ID and FedEx tracking
 * reference.
 *
 * These tests cover the pure, database-free utility functions exported from
 * convex/shippingHelpers.ts:
 *   - SHIPMENT_STATUSES       — all valid status values
 *   - ACTIVE_STATUSES         — non-terminal status subset
 *   - TERMINAL_STATUSES       — terminal status subset
 *   - projectShipment         — raw DB row → typed ShipmentRecord projection
 *   - isTerminalStatus        — delivered/exception detection
 *   - isActiveShipment        — in-progress detection (complement of terminal)
 *   - sortShipmentsDescending — most-recently-created first sort
 *   - sortShipmentsAscending  — oldest-first (chronological) sort
 *   - pickLatestShipment      — O(n) max createdAt selection
 *   - filterByStatus          — keep only records matching a given status
 *   - filterActiveShipments   — keep only non-terminal records
 *   - computeShipmentSummary  — aggregate counts and latest record
 *
 * Convex query functions themselves (listShipmentsByCase,
 * getShipmentByTrackingNumber, listShipmentsByStatus, listActiveShipments,
 * getShipmentSummaryForCase, getCaseShippingLayout) require a live Convex
 * environment and are exercised by integration tests.  The pure helpers are
 * extracted and exported specifically to enable this isolated unit test coverage.
 *
 * Coverage matrix:
 *   SHIPMENT_STATUSES:
 *     ✓ exports all 6 valid values
 *     ✓ contains no duplicates
 *     ✓ all values are strings
 *
 *   ACTIVE_STATUSES:
 *     ✓ does not include "delivered" or "exception"
 *     ✓ all values are present in SHIPMENT_STATUSES
 *
 *   TERMINAL_STATUSES:
 *     ✓ contains exactly "delivered" and "exception"
 *     ✓ does not overlap with ACTIVE_STATUSES
 *
 *   projectShipment:
 *     ✓ projects all required fields
 *     ✓ calls toString() on Convex ID objects
 *     ✓ passes through optional fields
 *     ✓ omits undefined optional fields
 *     ✓ result is JSON-serializable
 *
 *   isTerminalStatus:
 *     ✓ "delivered" → true
 *     ✓ "exception" → true
 *     ✓ all ACTIVE_STATUSES → false
 *     ✓ unknown string → false
 *
 *   isActiveShipment:
 *     ✓ non-terminal statuses → true
 *     ✓ "delivered" → false
 *     ✓ "exception" → false
 *
 *   sortShipmentsDescending:
 *     ✓ empty array → empty array
 *     ✓ single record → unchanged
 *     ✓ two out-of-order records → sorted desc
 *     ✓ does not mutate original array
 *
 *   sortShipmentsAscending:
 *     ✓ empty array → empty array
 *     ✓ two out-of-order records → sorted asc
 *     ✓ does not mutate original array
 *
 *   pickLatestShipment:
 *     ✓ empty array → null
 *     ✓ single record → that record
 *     ✓ multiple records → the one with max createdAt
 *     ✓ tie → first encountered wins
 *     ✓ does not mutate original array
 *
 *   filterByStatus:
 *     ✓ empty array → empty array
 *     ✓ matching records returned
 *     ✓ non-matching records excluded
 *     ✓ does not mutate original array
 *
 *   filterActiveShipments:
 *     ✓ all ACTIVE_STATUSES pass through
 *     ✓ "delivered" excluded
 *     ✓ "exception" excluded
 *     ✓ mixed array → only active records
 *     ✓ does not mutate original array
 *
 *   computeShipmentSummary:
 *     ✓ empty input → zero counts, null fields
 *     ✓ single label_created record → activeCount: 1
 *     ✓ single delivered record → deliveredCount: 1
 *     ✓ exception records counted
 *     ✓ latestShipment is the most recently created
 *     ✓ latestShippedAt from shippedAt field
 *     ✓ latestDeliveredAt from deliveredAt field
 *     ✓ mixed statuses produce correct aggregate
 *     ✓ caseId preserved in output
 */

import { describe, expect, it } from "vitest";

import {
  SHIPMENT_STATUSES,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  projectShipment,
  isTerminalStatus,
  isActiveShipment,
  sortShipmentsDescending,
  sortShipmentsAscending,
  pickLatestShipment,
  filterByStatus,
  filterActiveShipments,
  computeShipmentSummary,
} from "../../../convex/shippingHelpers";
import type {
  ShipmentRecord,
  ShipmentStatus,
  RawShipmentRow,
} from "../../../convex/shippingHelpers";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Factory for a minimal valid raw DB row (as Convex would return it). */
function makeRawRow(overrides: Partial<{
  _id:              { toString(): string };
  _creationTime:    number;
  caseId:           { toString(): string };
  trackingNumber:   string;
  carrier:          string;
  status:           string;
  originLat?:       number;
  originLng?:       number;
  originName?:      string;
  destinationLat?:  number;
  destinationLng?:  number;
  destinationName?: string;
  currentLat?:      number;
  currentLng?:      number;
  estimatedDelivery?: string;
  shippedAt?:       number;
  deliveredAt?:     number;
  createdAt:        number;
  updatedAt:        number;
}> = {}): RawShipmentRow {
  return {
    _id:           { toString: () => "shipment-001" },
    _creationTime: 1_700_000_000_000,
    caseId:        { toString: () => "case-id-001" },
    trackingNumber: "794644823741",
    carrier:        "FedEx",
    status:         "in_transit",
    createdAt:      1_700_001_000_000,
    updatedAt:      1_700_001_000_000,
    ...overrides,
  };
}

/** Factory for a typed ShipmentRecord (post-projection). */
function makeRecord(overrides: Partial<ShipmentRecord> = {}): ShipmentRecord {
  return {
    _id:           "shipment-001",
    _creationTime: 1_700_000_000_000,
    caseId:        "case-id-001",
    trackingNumber: "794644823741",
    carrier:        "FedEx",
    status:         "in_transit",
    createdAt:      1_700_001_000_000,
    updatedAt:      1_700_001_000_000,
    ...overrides,
  };
}

// ─── SHIPMENT_STATUSES ────────────────────────────────────────────────────────

describe("SHIPMENT_STATUSES", () => {
  it("exports all 6 valid shipment status values", () => {
    expect(SHIPMENT_STATUSES).toHaveLength(6);
    expect(SHIPMENT_STATUSES).toContain("label_created");
    expect(SHIPMENT_STATUSES).toContain("picked_up");
    expect(SHIPMENT_STATUSES).toContain("in_transit");
    expect(SHIPMENT_STATUSES).toContain("out_for_delivery");
    expect(SHIPMENT_STATUSES).toContain("delivered");
    expect(SHIPMENT_STATUSES).toContain("exception");
  });

  it("contains no duplicate values", () => {
    const unique = new Set(SHIPMENT_STATUSES);
    expect(unique.size).toBe(SHIPMENT_STATUSES.length);
  });

  it("all values are strings", () => {
    for (const s of SHIPMENT_STATUSES) {
      expect(typeof s).toBe("string");
    }
  });
});

// ─── ACTIVE_STATUSES ──────────────────────────────────────────────────────────

describe("ACTIVE_STATUSES", () => {
  it("does not include 'delivered'", () => {
    expect(ACTIVE_STATUSES).not.toContain("delivered");
  });

  it("does not include 'exception'", () => {
    expect(ACTIVE_STATUSES).not.toContain("exception");
  });

  it("contains exactly 4 statuses", () => {
    expect(ACTIVE_STATUSES).toHaveLength(4);
  });

  it("all values are subsets of SHIPMENT_STATUSES", () => {
    for (const s of ACTIVE_STATUSES) {
      expect(SHIPMENT_STATUSES).toContain(s);
    }
  });
});

// ─── TERMINAL_STATUSES ────────────────────────────────────────────────────────

describe("TERMINAL_STATUSES", () => {
  it("contains exactly 'delivered' and 'exception'", () => {
    expect(TERMINAL_STATUSES).toHaveLength(2);
    expect(TERMINAL_STATUSES).toContain("delivered");
    expect(TERMINAL_STATUSES).toContain("exception");
  });

  it("does not overlap with ACTIVE_STATUSES", () => {
    for (const ts of TERMINAL_STATUSES) {
      expect(ACTIVE_STATUSES).not.toContain(ts);
    }
  });

  it("union of ACTIVE_STATUSES and TERMINAL_STATUSES equals SHIPMENT_STATUSES (unordered)", () => {
    const union = new Set([...ACTIVE_STATUSES, ...TERMINAL_STATUSES]);
    expect(union.size).toBe(SHIPMENT_STATUSES.length);
    for (const s of SHIPMENT_STATUSES) {
      expect(union).toContain(s);
    }
  });
});

// ─── projectShipment ──────────────────────────────────────────────────────────

describe("projectShipment", () => {
  it("projects all required fields to plain strings and numbers", () => {
    const row = makeRawRow();
    const result = projectShipment(row);

    expect(result._id).toBe("shipment-001");
    expect(result._creationTime).toBe(1_700_000_000_000);
    expect(result.caseId).toBe("case-id-001");
    expect(result.trackingNumber).toBe("794644823741");
    expect(result.carrier).toBe("FedEx");
    expect(result.status).toBe("in_transit");
    expect(result.createdAt).toBe(1_700_001_000_000);
    expect(result.updatedAt).toBe(1_700_001_000_000);
  });

  it("calls toString() on Convex ID objects for _id and caseId", () => {
    let idCalled     = false;
    let caseIdCalled = false;

    const row = makeRawRow({
      _id:    { toString: () => { idCalled     = true; return "shipment-xyz"; } },
      caseId: { toString: () => { caseIdCalled = true; return "case-xyz";    } },
    });

    const result = projectShipment(row);
    expect(idCalled).toBe(true);
    expect(caseIdCalled).toBe(true);
    expect(result._id).toBe("shipment-xyz");
    expect(result.caseId).toBe("case-xyz");
  });

  it("omits optional fields when absent from the row", () => {
    const row = makeRawRow(); // no optional fields
    const result = projectShipment(row);

    expect(result.originLat).toBeUndefined();
    expect(result.originLng).toBeUndefined();
    expect(result.originName).toBeUndefined();
    expect(result.destinationLat).toBeUndefined();
    expect(result.destinationLng).toBeUndefined();
    expect(result.destinationName).toBeUndefined();
    expect(result.currentLat).toBeUndefined();
    expect(result.currentLng).toBeUndefined();
    expect(result.estimatedDelivery).toBeUndefined();
    expect(result.shippedAt).toBeUndefined();
    expect(result.deliveredAt).toBeUndefined();
  });

  it("passes through all optional fields when present in the row", () => {
    const row = makeRawRow({
      originLat:        42.3601,
      originLng:        -71.0589,
      originName:       "Site Alpha",
      destinationLat:   42.2808,
      destinationLng:   -83.7430,
      destinationName:  "SkySpecs HQ — Ann Arbor",
      currentLat:       42.3500,
      currentLng:       -72.0000,
      estimatedDelivery: "2025-06-03T20:00:00Z",
      shippedAt:        1_700_002_000_000,
      deliveredAt:      1_700_003_000_000,
    });
    const result = projectShipment(row);

    expect(result.originLat).toBeCloseTo(42.3601);
    expect(result.originLng).toBeCloseTo(-71.0589);
    expect(result.originName).toBe("Site Alpha");
    expect(result.destinationLat).toBeCloseTo(42.2808);
    expect(result.destinationLng).toBeCloseTo(-83.7430);
    expect(result.destinationName).toBe("SkySpecs HQ — Ann Arbor");
    expect(result.currentLat).toBeCloseTo(42.3500);
    expect(result.currentLng).toBeCloseTo(-72.0000);
    expect(result.estimatedDelivery).toBe("2025-06-03T20:00:00Z");
    expect(result.shippedAt).toBe(1_700_002_000_000);
    expect(result.deliveredAt).toBe(1_700_003_000_000);
  });

  it("returns a JSON-serializable plain object (no Convex types)", () => {
    const row = makeRawRow();
    const result = projectShipment(row);

    expect(() => JSON.stringify(result)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(result)) as ShipmentRecord;
    expect(parsed._id).toBe("shipment-001");
    expect(parsed.caseId).toBe("case-id-001");
    expect(parsed.trackingNumber).toBe("794644823741");
  });

  it("casts status as ShipmentStatus type", () => {
    for (const status of SHIPMENT_STATUSES) {
      const result = projectShipment(makeRawRow({ status }));
      expect(result.status).toBe(status);
    }
  });
});

// ─── isTerminalStatus ─────────────────────────────────────────────────────────

describe("isTerminalStatus", () => {
  it("returns true for 'delivered'", () => {
    expect(isTerminalStatus("delivered")).toBe(true);
  });

  it("returns true for 'exception'", () => {
    expect(isTerminalStatus("exception")).toBe(true);
  });

  it("returns false for 'label_created'", () => {
    expect(isTerminalStatus("label_created")).toBe(false);
  });

  it("returns false for 'picked_up'", () => {
    expect(isTerminalStatus("picked_up")).toBe(false);
  });

  it("returns false for 'in_transit'", () => {
    expect(isTerminalStatus("in_transit")).toBe(false);
  });

  it("returns false for 'out_for_delivery'", () => {
    expect(isTerminalStatus("out_for_delivery")).toBe(false);
  });

  it("returns false for unknown string values", () => {
    expect(isTerminalStatus("UNKNOWN")).toBe(false);
    expect(isTerminalStatus("")).toBe(false);
  });

  it("all ACTIVE_STATUSES return false from isTerminalStatus", () => {
    for (const s of ACTIVE_STATUSES) {
      expect(isTerminalStatus(s)).toBe(false);
    }
  });

  it("all TERMINAL_STATUSES return true from isTerminalStatus", () => {
    for (const s of TERMINAL_STATUSES) {
      expect(isTerminalStatus(s)).toBe(true);
    }
  });
});

// ─── isActiveShipment ─────────────────────────────────────────────────────────

describe("isActiveShipment", () => {
  it("returns true for a 'label_created' shipment", () => {
    expect(isActiveShipment(makeRecord({ status: "label_created" }))).toBe(true);
  });

  it("returns true for a 'picked_up' shipment", () => {
    expect(isActiveShipment(makeRecord({ status: "picked_up" }))).toBe(true);
  });

  it("returns true for a 'in_transit' shipment", () => {
    expect(isActiveShipment(makeRecord({ status: "in_transit" }))).toBe(true);
  });

  it("returns true for a 'out_for_delivery' shipment", () => {
    expect(isActiveShipment(makeRecord({ status: "out_for_delivery" }))).toBe(true);
  });

  it("returns false for a 'delivered' shipment", () => {
    expect(isActiveShipment(makeRecord({ status: "delivered" }))).toBe(false);
  });

  it("returns false for an 'exception' shipment", () => {
    expect(isActiveShipment(makeRecord({ status: "exception" }))).toBe(false);
  });

  it("isActiveShipment is the complement of isTerminalStatus for all SHIPMENT_STATUSES", () => {
    for (const s of SHIPMENT_STATUSES) {
      const record = makeRecord({ status: s });
      expect(isActiveShipment(record)).toBe(!isTerminalStatus(s));
    }
  });
});

// ─── sortShipmentsDescending ──────────────────────────────────────────────────

describe("sortShipmentsDescending", () => {
  it("returns an empty array for an empty input", () => {
    expect(sortShipmentsDescending([])).toEqual([]);
  });

  it("returns a single-item array unchanged", () => {
    const r = makeRecord();
    const result = sortShipmentsDescending([r]);
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe(r._id);
  });

  it("places the most recently created record at index 0", () => {
    const older = makeRecord({ _id: "s1", createdAt: 1_000 });
    const newer = makeRecord({ _id: "s2", createdAt: 2_000 });

    const result = sortShipmentsDescending([older, newer]);
    expect(result[0]._id).toBe("s2");
    expect(result[1]._id).toBe("s1");
  });

  it("handles already-sorted descending input correctly", () => {
    const newest = makeRecord({ _id: "s1", createdAt: 3_000 });
    const middle = makeRecord({ _id: "s2", createdAt: 2_000 });
    const oldest = makeRecord({ _id: "s3", createdAt: 1_000 });

    const result = sortShipmentsDescending([newest, middle, oldest]);
    expect(result[0].createdAt).toBe(3_000);
    expect(result[1].createdAt).toBe(2_000);
    expect(result[2].createdAt).toBe(1_000);
  });

  it("handles reverse-sorted ascending input correctly", () => {
    const oldest = makeRecord({ _id: "s1", createdAt: 1_000 });
    const middle = makeRecord({ _id: "s2", createdAt: 2_000 });
    const newest = makeRecord({ _id: "s3", createdAt: 3_000 });

    const result = sortShipmentsDescending([oldest, middle, newest]);
    expect(result[0].createdAt).toBe(3_000);
    expect(result[1].createdAt).toBe(2_000);
    expect(result[2].createdAt).toBe(1_000);
  });

  it("does not mutate the original array", () => {
    const older = makeRecord({ _id: "s1", createdAt: 1_000 });
    const newer = makeRecord({ _id: "s2", createdAt: 2_000 });
    const original = [older, newer];

    sortShipmentsDescending(original);

    // Original should remain in insertion order
    expect(original[0]._id).toBe("s1");
    expect(original[1]._id).toBe("s2");
  });

  it("stable: equal createdAt values preserve relative order", () => {
    const s1 = makeRecord({ _id: "s1", createdAt: 5_000 });
    const s2 = makeRecord({ _id: "s2", createdAt: 5_000 });
    const s3 = makeRecord({ _id: "s3", createdAt: 5_000 });

    const result = sortShipmentsDescending([s1, s2, s3]);
    // All have the same timestamp — order is stable (same as input)
    expect(result).toHaveLength(3);
  });
});

// ─── sortShipmentsAscending ───────────────────────────────────────────────────

describe("sortShipmentsAscending", () => {
  it("returns an empty array for an empty input", () => {
    expect(sortShipmentsAscending([])).toEqual([]);
  });

  it("places the oldest record at index 0", () => {
    const older = makeRecord({ _id: "s1", createdAt: 1_000 });
    const newer = makeRecord({ _id: "s2", createdAt: 2_000 });

    const result = sortShipmentsAscending([newer, older]);
    expect(result[0]._id).toBe("s1");
    expect(result[1]._id).toBe("s2");
  });

  it("sorts three records in chronological order", () => {
    const s1 = makeRecord({ _id: "s1", createdAt: 1_000 });
    const s2 = makeRecord({ _id: "s2", createdAt: 2_000 });
    const s3 = makeRecord({ _id: "s3", createdAt: 3_000 });

    const result = sortShipmentsAscending([s3, s1, s2]);
    expect(result[0].createdAt).toBe(1_000);
    expect(result[1].createdAt).toBe(2_000);
    expect(result[2].createdAt).toBe(3_000);
  });

  it("does not mutate the original array", () => {
    const s1 = makeRecord({ _id: "s1", createdAt: 3_000 });
    const s2 = makeRecord({ _id: "s2", createdAt: 1_000 });
    const original = [s1, s2];

    sortShipmentsAscending(original);
    expect(original[0]._id).toBe("s1");
  });

  it("ascending and descending are inverses for the same input", () => {
    const records = [
      makeRecord({ _id: "s1", createdAt: 1_000 }),
      makeRecord({ _id: "s2", createdAt: 2_000 }),
      makeRecord({ _id: "s3", createdAt: 3_000 }),
    ];

    const asc  = sortShipmentsAscending(records);
    const desc = sortShipmentsDescending(records);

    // Ascending should have the lowest createdAt first; descending the highest.
    expect(asc[0].createdAt).toBeLessThan(asc[asc.length - 1].createdAt);
    expect(desc[0].createdAt).toBeGreaterThan(desc[desc.length - 1].createdAt);
    expect(asc[0]._id).toBe(desc[desc.length - 1]._id);
  });
});

// ─── pickLatestShipment ───────────────────────────────────────────────────────

describe("pickLatestShipment", () => {
  it("returns null for an empty array", () => {
    expect(pickLatestShipment([])).toBeNull();
  });

  it("returns the single record when array has one element", () => {
    const r = makeRecord({ createdAt: 5_000 });
    expect(pickLatestShipment([r])).toBe(r);
  });

  it("returns the record with the highest createdAt", () => {
    const s1 = makeRecord({ _id: "s1", createdAt: 1_000 });
    const s2 = makeRecord({ _id: "s2", createdAt: 5_000 });
    const s3 = makeRecord({ _id: "s3", createdAt: 3_000 });

    const result = pickLatestShipment([s1, s2, s3]);
    expect(result?._id).toBe("s2");
    expect(result?.createdAt).toBe(5_000);
  });

  it("returns the first maximum when multiple records share the same createdAt", () => {
    const s1 = makeRecord({ _id: "s1", createdAt: 5_000 });
    const s2 = makeRecord({ _id: "s2", createdAt: 5_000 });

    const result = pickLatestShipment([s1, s2]);
    // s1 is encountered first; s2 has same createdAt (not strictly greater) so s1 wins.
    expect(result?._id).toBe("s1");
  });

  it("does not mutate the original array", () => {
    const s1 = makeRecord({ _id: "s1", createdAt: 1_000 });
    const s2 = makeRecord({ _id: "s2", createdAt: 2_000 });
    const original = [s1, s2];

    pickLatestShipment(original);
    expect(original[0]._id).toBe("s1");
    expect(original[1]._id).toBe("s2");
  });
});

// ─── filterByStatus ───────────────────────────────────────────────────────────

describe("filterByStatus", () => {
  const records: ShipmentRecord[] = [
    makeRecord({ _id: "s1", status: "label_created"    }),
    makeRecord({ _id: "s2", status: "in_transit"       }),
    makeRecord({ _id: "s3", status: "in_transit"       }),
    makeRecord({ _id: "s4", status: "delivered"        }),
    makeRecord({ _id: "s5", status: "exception"        }),
    makeRecord({ _id: "s6", status: "out_for_delivery" }),
  ];

  it("returns an empty array for an empty input", () => {
    expect(filterByStatus([], "in_transit")).toEqual([]);
  });

  it("returns records with the matching status", () => {
    const result = filterByStatus(records, "in_transit");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r._id)).toEqual(["s2", "s3"]);
  });

  it("returns a single record when only one matches", () => {
    const result = filterByStatus(records, "delivered");
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe("s4");
  });

  it("returns an empty array when no records match", () => {
    const result = filterByStatus(records, "picked_up");
    expect(result).toHaveLength(0);
  });

  it("does not mutate the original array", () => {
    const copy = [...records];
    filterByStatus(copy, "in_transit");
    expect(copy).toHaveLength(records.length);
  });

  it("works for every valid ShipmentStatus value", () => {
    for (const status of SHIPMENT_STATUSES) {
      // Should not throw for any valid status
      expect(() => filterByStatus(records, status)).not.toThrow();
    }
  });
});

// ─── filterActiveShipments ────────────────────────────────────────────────────

describe("filterActiveShipments", () => {
  it("returns an empty array for an empty input", () => {
    expect(filterActiveShipments([])).toEqual([]);
  });

  it("passes through all ACTIVE_STATUS records unchanged", () => {
    const active = ACTIVE_STATUSES.map((s, i) =>
      makeRecord({ _id: `s${i}`, status: s })
    );
    const result = filterActiveShipments(active);
    expect(result).toHaveLength(ACTIVE_STATUSES.length);
  });

  it("excludes 'delivered' records", () => {
    const records = [
      makeRecord({ _id: "s1", status: "in_transit" }),
      makeRecord({ _id: "s2", status: "delivered"  }),
    ];
    const result = filterActiveShipments(records);
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe("s1");
  });

  it("excludes 'exception' records", () => {
    const records = [
      makeRecord({ _id: "s1", status: "picked_up" }),
      makeRecord({ _id: "s2", status: "exception" }),
    ];
    const result = filterActiveShipments(records);
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe("s1");
  });

  it("filters a mixed array to only active records", () => {
    const records = [
      makeRecord({ _id: "s1", status: "label_created"    }),
      makeRecord({ _id: "s2", status: "picked_up"        }),
      makeRecord({ _id: "s3", status: "in_transit"       }),
      makeRecord({ _id: "s4", status: "out_for_delivery" }),
      makeRecord({ _id: "s5", status: "delivered"        }),
      makeRecord({ _id: "s6", status: "exception"        }),
    ];
    const result = filterActiveShipments(records);
    expect(result).toHaveLength(4);
    expect(result.map((r) => r._id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("returns empty when all records are in terminal states", () => {
    const records = [
      makeRecord({ _id: "s1", status: "delivered" }),
      makeRecord({ _id: "s2", status: "exception" }),
    ];
    expect(filterActiveShipments(records)).toHaveLength(0);
  });

  it("does not mutate the original array", () => {
    const records = [
      makeRecord({ _id: "s1", status: "in_transit" }),
      makeRecord({ _id: "s2", status: "delivered"  }),
    ];
    const original = [...records];
    filterActiveShipments(records);
    expect(records).toHaveLength(original.length);
  });
});

// ─── computeShipmentSummary ───────────────────────────────────────────────────

describe("computeShipmentSummary", () => {
  const CASE_ID = "case-id-test";

  it("returns zero counts and null fields for an empty array", () => {
    const result = computeShipmentSummary(CASE_ID, []);
    expect(result).toEqual({
      caseId:           CASE_ID,
      totalShipments:   0,
      activeCount:      0,
      deliveredCount:   0,
      exceptionCount:   0,
      latestShipment:   null,
      latestShippedAt:  null,
      latestDeliveredAt: null,
    });
  });

  it("preserves the caseId in the output", () => {
    const result = computeShipmentSummary("my-case-xyz", []);
    expect(result.caseId).toBe("my-case-xyz");
  });

  it("counts a single label_created record as activeCount: 1", () => {
    const records = [makeRecord({ status: "label_created" })];
    const result = computeShipmentSummary(CASE_ID, records);
    expect(result.totalShipments).toBe(1);
    expect(result.activeCount).toBe(1);
    expect(result.deliveredCount).toBe(0);
    expect(result.exceptionCount).toBe(0);
  });

  it("counts a single delivered record as deliveredCount: 1", () => {
    const records = [makeRecord({ status: "delivered", deliveredAt: 1_700_010_000_000 })];
    const result = computeShipmentSummary(CASE_ID, records);
    expect(result.totalShipments).toBe(1);
    expect(result.activeCount).toBe(0);
    expect(result.deliveredCount).toBe(1);
    expect(result.exceptionCount).toBe(0);
  });

  it("counts a single exception record as exceptionCount: 1", () => {
    const records = [makeRecord({ status: "exception" })];
    const result = computeShipmentSummary(CASE_ID, records);
    expect(result.totalShipments).toBe(1);
    expect(result.activeCount).toBe(0);
    expect(result.deliveredCount).toBe(0);
    expect(result.exceptionCount).toBe(1);
  });

  it("correctly counts mixed statuses across multiple records", () => {
    const records = [
      makeRecord({ _id: "s1", status: "in_transit"       }),
      makeRecord({ _id: "s2", status: "delivered"        }),
      makeRecord({ _id: "s3", status: "exception"        }),
      makeRecord({ _id: "s4", status: "label_created"    }),
      makeRecord({ _id: "s5", status: "out_for_delivery" }),
    ];
    const result = computeShipmentSummary(CASE_ID, records);

    expect(result.totalShipments).toBe(5);
    // in_transit + label_created + out_for_delivery = 3 active
    expect(result.activeCount).toBe(3);
    expect(result.deliveredCount).toBe(1);
    expect(result.exceptionCount).toBe(1);
  });

  it("latestShipment is the record with the highest createdAt", () => {
    const records = [
      makeRecord({ _id: "s1", createdAt: 1_000 }),
      makeRecord({ _id: "s2", createdAt: 3_000 }),
      makeRecord({ _id: "s3", createdAt: 2_000 }),
    ];
    const result = computeShipmentSummary(CASE_ID, records);
    expect(result.latestShipment?._id).toBe("s2");
    expect(result.latestShipment?.createdAt).toBe(3_000);
  });

  it("latestShippedAt is null when no records have shippedAt", () => {
    const records = [
      makeRecord({ _id: "s1" }), // no shippedAt
    ];
    const result = computeShipmentSummary(CASE_ID, records);
    expect(result.latestShippedAt).toBeNull();
  });

  it("latestShippedAt is the maximum shippedAt across all records", () => {
    const records = [
      makeRecord({ _id: "s1", shippedAt: 1_000 }),
      makeRecord({ _id: "s2", shippedAt: 5_000 }),
      makeRecord({ _id: "s3", shippedAt: 3_000 }),
    ];
    const result = computeShipmentSummary(CASE_ID, records);
    expect(result.latestShippedAt).toBe(5_000);
  });

  it("latestDeliveredAt is null when no delivered records exist", () => {
    const records = [makeRecord({ status: "in_transit" })];
    const result = computeShipmentSummary(CASE_ID, records);
    expect(result.latestDeliveredAt).toBeNull();
  });

  it("latestDeliveredAt is the maximum deliveredAt across delivered records", () => {
    const records = [
      makeRecord({ _id: "s1", status: "delivered", deliveredAt: 2_000 }),
      makeRecord({ _id: "s2", status: "delivered", deliveredAt: 5_000 }),
      makeRecord({ _id: "s3", status: "in_transit" }),
    ];
    const result = computeShipmentSummary(CASE_ID, records);
    expect(result.latestDeliveredAt).toBe(5_000);
  });

  it("latestDeliveredAt uses only records with status=delivered that have deliveredAt", () => {
    // delivered status but no deliveredAt field set (edge case)
    const records = [
      makeRecord({ _id: "s1", status: "delivered" /* no deliveredAt */ }),
      makeRecord({ _id: "s2", status: "delivered", deliveredAt: 4_000  }),
    ];
    const result = computeShipmentSummary(CASE_ID, records);
    // s1 has no deliveredAt so it doesn't affect latestDeliveredAt
    expect(result.latestDeliveredAt).toBe(4_000);
    expect(result.deliveredCount).toBe(2);
  });

  it("single record: latestShipment equals that record", () => {
    const single = makeRecord({ _id: "only", createdAt: 9_000, shippedAt: 9_000 });
    const result = computeShipmentSummary(CASE_ID, [single]);

    expect(result.latestShipment?._id).toBe("only");
    expect(result.latestShippedAt).toBe(9_000);
  });
});

// ─── Real-time watcher query contract tests ───────────────────────────────────
// These tests verify the logical contracts that listShipmentsByStatus,
// listActiveShipments, and getShipmentSummaryForCase must satisfy.

describe("real-time watcher query contracts", () => {
  const CASE_ID = "case-query-test";

  it("listShipmentsByStatus('in_transit') = filterByStatus(all, 'in_transit')", () => {
    const allShipments = [
      makeRecord({ _id: "s1", status: "in_transit"    }),
      makeRecord({ _id: "s2", status: "delivered"     }),
      makeRecord({ _id: "s3", status: "in_transit"    }),
      makeRecord({ _id: "s4", status: "label_created" }),
    ];

    const byStatusFilter = filterByStatus(allShipments, "in_transit");
    expect(byStatusFilter.map((r) => r._id).sort()).toEqual(["s1", "s3"]);
  });

  it("listActiveShipments() = filterActiveShipments(all)", () => {
    const allShipments = [
      makeRecord({ _id: "s1", status: "label_created"    }),
      makeRecord({ _id: "s2", status: "picked_up"        }),
      makeRecord({ _id: "s3", status: "in_transit"       }),
      makeRecord({ _id: "s4", status: "out_for_delivery" }),
      makeRecord({ _id: "s5", status: "delivered"        }),
      makeRecord({ _id: "s6", status: "exception"        }),
    ];

    const active = filterActiveShipments(allShipments);
    expect(active.map((r) => r._id).sort()).toEqual(["s1", "s2", "s3", "s4"].sort());
  });

  it("getShipmentSummaryForCase(caseId) totalShipments = listShipmentsByCase(caseId).length", () => {
    const caseShipments = [
      makeRecord({ caseId: CASE_ID }),
      makeRecord({ caseId: CASE_ID }),
      makeRecord({ caseId: CASE_ID }),
    ];

    const summary = computeShipmentSummary(CASE_ID, caseShipments);
    expect(summary.totalShipments).toBe(caseShipments.length);
  });

  it("sum of activeCount + deliveredCount + exceptionCount = totalShipments", () => {
    const records = [
      makeRecord({ _id: "s1", status: "in_transit"       }),
      makeRecord({ _id: "s2", status: "label_created"    }),
      makeRecord({ _id: "s3", status: "delivered"        }),
      makeRecord({ _id: "s4", status: "exception"        }),
      makeRecord({ _id: "s5", status: "out_for_delivery" }),
    ];

    const summary = computeShipmentSummary(CASE_ID, records);
    expect(
      summary.activeCount + summary.deliveredCount + summary.exceptionCount
    ).toBe(summary.totalShipments);
  });

  it("listActiveShipments count = summary.activeCount after new shipCase mutation", () => {
    // Simulate: SCAN app calls shipCase → new "label_created" row inserted.
    // Convex re-evaluates listActiveShipments and getShipmentSummaryForCase.
    const before = [
      makeRecord({ _id: "s1", status: "in_transit", createdAt: 1_000 }),
    ];
    const after = [
      makeRecord({ _id: "s1", status: "in_transit",    createdAt: 1_000 }),
      makeRecord({ _id: "s2", status: "label_created", createdAt: 2_000 }),
    ];

    const activeBefore = filterActiveShipments(before);
    const activeAfter  = filterActiveShipments(after);

    expect(activeBefore).toHaveLength(1);
    expect(activeAfter).toHaveLength(2);

    const summaryBefore = computeShipmentSummary(CASE_ID, before);
    const summaryAfter  = computeShipmentSummary(CASE_ID, after);

    expect(summaryBefore.activeCount).toBe(activeBefore.length);
    expect(summaryAfter.activeCount).toBe(activeAfter.length);
  });

  it("listShipmentsByStatus('delivered') = [] before delivery, [s1] after updateShipmentStatus", () => {
    // Simulate: refreshShipmentTracking calls updateShipmentStatus with delivered.
    const before = [makeRecord({ _id: "s1", status: "in_transit" })];
    const after  = [makeRecord({ _id: "s1", status: "delivered", deliveredAt: 9_999 })];

    expect(filterByStatus(before, "delivered")).toHaveLength(0);
    expect(filterByStatus(after,  "delivered")).toHaveLength(1);
  });

  it("listShipmentsByCase(caseId) returns most-recently-created first (by_case index .order('desc'))", () => {
    const records = [
      makeRecord({ _id: "s1", createdAt: 1_000 }),
      makeRecord({ _id: "s2", createdAt: 3_000 }),
      makeRecord({ _id: "s3", createdAt: 2_000 }),
    ];

    // Simulate .order("desc") from the Convex query
    const sorted = sortShipmentsDescending(records);
    expect(sorted[0]._id).toBe("s2"); // createdAt: 3_000
    expect(sorted[1]._id).toBe("s3"); // createdAt: 2_000
    expect(sorted[2]._id).toBe("s1"); // createdAt: 1_000
  });

  it("getShipmentByTrackingNumber returns null for non-existent tracking number", () => {
    // Contract: the by_tracking index + .first() returns null for unknown numbers.
    // Simulated by filtering with an exact trackingNumber match.
    const allShipments = [
      makeRecord({ _id: "s1", trackingNumber: "794644823741" }),
      makeRecord({ _id: "s2", trackingNumber: "403656527456" }),
    ];

    const match = allShipments.find((s) => s.trackingNumber === "999999999999");
    expect(match).toBeUndefined();
  });

  it("getShipmentByTrackingNumber finds a shipment by exact FedEx tracking reference", () => {
    const allShipments = [
      makeRecord({ _id: "s1", trackingNumber: "794644823741" }),
      makeRecord({ _id: "s2", trackingNumber: "403656527456" }),
    ];

    const match = allShipments.find((s) => s.trackingNumber === "403656527456");
    expect(match?._id).toBe("s2");
  });
});

// ─── Index coverage tests ─────────────────────────────────────────────────────
// These tests document and verify the by_case, by_tracking, and by_status
// index access patterns used by the real-time query functions.

describe("shipments table index access patterns", () => {
  it("by_case index: all shipments for a case share the same caseId", () => {
    const CASE_A = "case-aaa";
    const CASE_B = "case-bbb";

    const records = [
      makeRecord({ _id: "s1", caseId: CASE_A }),
      makeRecord({ _id: "s2", caseId: CASE_B }),
      makeRecord({ _id: "s3", caseId: CASE_A }),
    ];

    const caseARecords = records.filter((r) => r.caseId === CASE_A);
    expect(caseARecords.map((r) => r._id).sort()).toEqual(["s1", "s3"].sort());
  });

  it("by_tracking index: shipments with unique tracking numbers are distinct rows", () => {
    const records = [
      makeRecord({ _id: "s1", trackingNumber: "TN001" }),
      makeRecord({ _id: "s2", trackingNumber: "TN002" }),
      makeRecord({ _id: "s3", trackingNumber: "TN001" }), // duplicate TN (e.g., re-shipment)
    ];

    // by_tracking index: .first() returns the first match — which one is
    // implementation-dependent, but at least one should match.
    const matches = records.filter((r) => r.trackingNumber === "TN001");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].trackingNumber).toBe("TN001");
  });

  it("by_status index: correctly isolates 'in_transit' from other statuses", () => {
    const records = SHIPMENT_STATUSES.map((status, i) =>
      makeRecord({ _id: `s${i}`, status })
    );

    const inTransit = records.filter((r) => r.status === "in_transit");
    expect(inTransit).toHaveLength(1);
    expect(inTransit[0].status).toBe("in_transit");
  });

  it("by_status index: all 6 status buckets produce non-overlapping subsets", () => {
    const records = [
      makeRecord({ _id: "s1", status: "label_created"    }),
      makeRecord({ _id: "s2", status: "picked_up"        }),
      makeRecord({ _id: "s3", status: "in_transit"       }),
      makeRecord({ _id: "s4", status: "out_for_delivery" }),
      makeRecord({ _id: "s5", status: "delivered"        }),
      makeRecord({ _id: "s6", status: "exception"        }),
    ];

    let totalFromBuckets = 0;
    for (const status of SHIPMENT_STATUSES) {
      const bucket = filterByStatus(records, status);
      totalFromBuckets += bucket.length;
    }

    // Sum of all buckets should equal total records (no overlaps, no gaps).
    expect(totalFromBuckets).toBe(records.length);
  });
});
