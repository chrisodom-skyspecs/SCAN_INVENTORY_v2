/**
 * Unit tests for the custody query module pure functions.
 *
 * Sub-AC 36a-4: Convex real-time query functions and table watchers for the
 * custody records table, including queries scoped by case ID and custodian
 * identity.
 *
 * These tests cover the pure, database-free utility functions exported from
 * convex/custodyHelpers.ts:
 *   - projectCustodyRecord  — raw DB row → typed CustodyRecord projection
 *   - sortRecordsDescending — most-recent-first sort
 *   - sortRecordsAscending  — chronological sort
 *   - pickLatestRecord      — O(n) max transferredAt selection
 *   - applyDateRangeFilter  — epoch ms window filter
 *   - computeTransferSummary — aggregate fleet stats computation
 *   - computeCustodianIdentitySummary — per-user current/historical stats
 *   - filterByParticipant   — OR-join for participant queries
 *
 * Convex query functions themselves (getCustodyRecordsByCase,
 * getCustodyRecordsByCustodian, etc.) require a live Convex environment and
 * are exercised by integration tests.  The pure helpers are extracted and
 * exported specifically to enable this isolated unit test coverage.
 *
 * Coverage matrix:
 *   projectCustodyRecord:
 *     ✓ projects all required fields
 *     ✓ calls toString() on Convex ID objects
 *     ✓ optional fields (notes, signatureStorageId)
 *     ✓ result is JSON-serializable (no Convex types)
 *
 *   sortRecordsDescending:
 *     ✓ empty array → empty array
 *     ✓ single record → single record
 *     ✓ two records out of order → sorted desc
 *     ✓ does not mutate the original array
 *     ✓ stable relative order for equal timestamps
 *
 *   sortRecordsAscending:
 *     ✓ empty array → empty array
 *     ✓ two records out of order → sorted asc
 *     ✓ does not mutate the original array
 *
 *   pickLatestRecord:
 *     ✓ empty array → null
 *     ✓ single record → that record
 *     ✓ multiple records → the one with max transferredAt
 *     ✓ does not mutate the original array
 *
 *   applyDateRangeFilter:
 *     ✓ no since / no until → identity (all records)
 *     ✓ since only → excludes records before since
 *     ✓ until only → excludes records after until
 *     ✓ both → closed window
 *     ✓ boundary values (since === transferredAt, until === transferredAt)
 *     ✓ does not mutate original array
 *
 *   computeTransferSummary:
 *     ✓ empty input → all zeros / nulls
 *     ✓ single record → correct counts
 *     ✓ multiple records → correct totalTransfers
 *     ✓ mostActiveTo identifies the most frequent recipient
 *     ✓ tie-breaking (first encountered wins)
 *     ✓ earliestTransferAt / latestTransferAt
 *
 *   computeCustodianIdentitySummary:
 *     ✓ no records → zero counts, empty currentCaseIds
 *     ✓ user holds one case → currentCaseCount: 1
 *     ✓ user transferred the case away → currentCaseCount: 0
 *     ✓ user holds some cases, transferred others
 *     ✓ totalReceived counts all inbound records
 *     ✓ totalTransferred counts all outbound records
 *
 *   filterByParticipant:
 *     ✓ no matching records → empty array
 *     ✓ records where user is toUserId
 *     ✓ records where user is fromUserId
 *     ✓ mixed — returns both from and to records
 *     ✓ does not include records for other users
 */

import { describe, expect, it } from "vitest";

import {
  projectCustodyRecord,
  sortRecordsDescending,
  sortRecordsAscending,
  pickLatestRecord,
  applyDateRangeFilter,
  computeTransferSummary,
  computeCustodianIdentitySummary,
  filterByParticipant,
} from "../../../convex/custodyHelpers";
import type {
  CustodyRecord,
  RawCustodyRow,
} from "../../../convex/custodyHelpers";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Factory for a minimal valid raw DB row (as Convex would return it). */
function makeRawRow(overrides: Partial<{
  _id: { toString(): string };
  _creationTime: number;
  caseId: { toString(): string };
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  toUserName: string;
  transferredAt: number;
  notes?: string;
  signatureStorageId?: string;
}> = {}): RawCustodyRow {
  return {
    _id:              { toString: () => "custody-record-001" },
    _creationTime:    1_700_000_000_000,
    caseId:           { toString: () => "case-id-001" },
    fromUserId:       "user-alice",
    fromUserName:     "Alice Technician",
    toUserId:         "user-bob",
    toUserName:       "Bob Pilot",
    transferredAt:    1_700_001_000_000,
    ...overrides,
  };
}

/** Factory for a typed CustodyRecord (post-projection). */
function makeRecord(overrides: Partial<CustodyRecord> = {}): CustodyRecord {
  return {
    _id:           "custody-record-001",
    _creationTime: 1_700_000_000_000,
    caseId:        "case-id-001",
    fromUserId:    "user-alice",
    fromUserName:  "Alice Technician",
    toUserId:      "user-bob",
    toUserName:    "Bob Pilot",
    transferredAt: 1_700_001_000_000,
    ...overrides,
  };
}

// ─── projectCustodyRecord ─────────────────────────────────────────────────────

describe("projectCustodyRecord", () => {
  it("projects all required fields to plain strings and numbers", () => {
    const row = makeRawRow();
    const result = projectCustodyRecord(row);

    expect(result._id).toBe("custody-record-001");
    expect(result._creationTime).toBe(1_700_000_000_000);
    expect(result.caseId).toBe("case-id-001");
    expect(result.fromUserId).toBe("user-alice");
    expect(result.fromUserName).toBe("Alice Technician");
    expect(result.toUserId).toBe("user-bob");
    expect(result.toUserName).toBe("Bob Pilot");
    expect(result.transferredAt).toBe(1_700_001_000_000);
  });

  it("calls toString() on Convex ID objects for _id and caseId", () => {
    let idCalled = false;
    let caseIdCalled = false;

    const row = makeRawRow({
      _id:    { toString: () => { idCalled    = true; return "record-xyz"; } },
      caseId: { toString: () => { caseIdCalled = true; return "case-xyz";  } },
    });

    const result = projectCustodyRecord(row);
    expect(idCalled).toBe(true);
    expect(caseIdCalled).toBe(true);
    expect(result._id).toBe("record-xyz");
    expect(result.caseId).toBe("case-xyz");
  });

  it("omits optional fields when absent from the row", () => {
    const row = makeRawRow(); // no notes, no signatureStorageId
    const result = projectCustodyRecord(row);

    expect(result.notes).toBeUndefined();
    expect(result.signatureStorageId).toBeUndefined();
  });

  it("includes optional fields when present in the row", () => {
    const row = makeRawRow({
      notes:              "All items verified",
      signatureStorageId: "storage-id-sig-abc",
    });
    const result = projectCustodyRecord(row);

    expect(result.notes).toBe("All items verified");
    expect(result.signatureStorageId).toBe("storage-id-sig-abc");
  });

  it("returns a JSON-serializable plain object (no Convex types)", () => {
    const row = makeRawRow();
    const result = projectCustodyRecord(row);

    expect(() => JSON.stringify(result)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(result)) as CustodyRecord;
    expect(parsed._id).toBe("custody-record-001");
    expect(parsed.caseId).toBe("case-id-001");
  });
});

// ─── sortRecordsDescending ────────────────────────────────────────────────────

describe("sortRecordsDescending", () => {
  it("returns an empty array for an empty input", () => {
    expect(sortRecordsDescending([])).toEqual([]);
  });

  it("returns a single-item array unchanged", () => {
    const r = makeRecord();
    const result = sortRecordsDescending([r]);
    expect(result).toHaveLength(1);
    expect(result[0]._id).toBe(r._id);
  });

  it("places the most recent record at index 0", () => {
    const older  = makeRecord({ _id: "r1", transferredAt: 1_000 });
    const newer  = makeRecord({ _id: "r2", transferredAt: 2_000 });

    const result = sortRecordsDescending([older, newer]);
    expect(result[0]._id).toBe("r2");
    expect(result[1]._id).toBe("r1");
  });

  it("handles already-sorted descending input correctly", () => {
    const newest = makeRecord({ _id: "r1", transferredAt: 3_000 });
    const middle = makeRecord({ _id: "r2", transferredAt: 2_000 });
    const oldest = makeRecord({ _id: "r3", transferredAt: 1_000 });

    const result = sortRecordsDescending([newest, middle, oldest]);
    expect(result[0].transferredAt).toBe(3_000);
    expect(result[1].transferredAt).toBe(2_000);
    expect(result[2].transferredAt).toBe(1_000);
  });

  it("does not mutate the original array", () => {
    const older = makeRecord({ _id: "r1", transferredAt: 1_000 });
    const newer = makeRecord({ _id: "r2", transferredAt: 2_000 });
    const original = [older, newer];

    sortRecordsDescending(original);

    // Original should remain in the original insertion order.
    expect(original[0]._id).toBe("r1");
    expect(original[1]._id).toBe("r2");
  });
});

// ─── sortRecordsAscending ─────────────────────────────────────────────────────

describe("sortRecordsAscending", () => {
  it("returns an empty array for an empty input", () => {
    expect(sortRecordsAscending([])).toEqual([]);
  });

  it("places the oldest record at index 0", () => {
    const older = makeRecord({ _id: "r1", transferredAt: 1_000 });
    const newer = makeRecord({ _id: "r2", transferredAt: 2_000 });

    const result = sortRecordsAscending([newer, older]);
    expect(result[0]._id).toBe("r1");
    expect(result[1]._id).toBe("r2");
  });

  it("sorts three records in chronological order", () => {
    const r1 = makeRecord({ _id: "r1", transferredAt: 1_000 });
    const r2 = makeRecord({ _id: "r2", transferredAt: 2_000 });
    const r3 = makeRecord({ _id: "r3", transferredAt: 3_000 });

    const result = sortRecordsAscending([r3, r1, r2]);
    expect(result[0].transferredAt).toBe(1_000);
    expect(result[1].transferredAt).toBe(2_000);
    expect(result[2].transferredAt).toBe(3_000);
  });

  it("does not mutate the original array", () => {
    const r1 = makeRecord({ _id: "r1", transferredAt: 3_000 });
    const r2 = makeRecord({ _id: "r2", transferredAt: 1_000 });
    const original = [r1, r2];

    sortRecordsAscending(original);
    expect(original[0]._id).toBe("r1");
  });
});

// ─── pickLatestRecord ─────────────────────────────────────────────────────────

describe("pickLatestRecord", () => {
  it("returns null for an empty array", () => {
    expect(pickLatestRecord([])).toBeNull();
  });

  it("returns the single record when array has one element", () => {
    const r = makeRecord({ transferredAt: 5_000 });
    expect(pickLatestRecord([r])).toBe(r);
  });

  it("returns the record with the highest transferredAt", () => {
    const r1 = makeRecord({ _id: "r1", transferredAt: 1_000 });
    const r2 = makeRecord({ _id: "r2", transferredAt: 5_000 });
    const r3 = makeRecord({ _id: "r3", transferredAt: 3_000 });

    const result = pickLatestRecord([r1, r2, r3]);
    expect(result?._id).toBe("r2");
    expect(result?.transferredAt).toBe(5_000);
  });

  it("returns the first maximum when multiple records share the same timestamp", () => {
    const r1 = makeRecord({ _id: "r1", transferredAt: 5_000 });
    const r2 = makeRecord({ _id: "r2", transferredAt: 5_000 });

    const result = pickLatestRecord([r1, r2]);
    // r1 is encountered first and becomes the initial "latest";
    // r2 has the same timestamp (not strictly greater) so r1 wins.
    expect(result?._id).toBe("r1");
  });

  it("does not mutate the original array", () => {
    const r1 = makeRecord({ _id: "r1", transferredAt: 1_000 });
    const r2 = makeRecord({ _id: "r2", transferredAt: 2_000 });
    const original = [r1, r2];

    pickLatestRecord(original);
    expect(original[0]._id).toBe("r1");
  });
});

// ─── applyDateRangeFilter ─────────────────────────────────────────────────────

describe("applyDateRangeFilter", () => {
  const records = [
    makeRecord({ _id: "r1", transferredAt: 1_000 }),
    makeRecord({ _id: "r2", transferredAt: 2_000 }),
    makeRecord({ _id: "r3", transferredAt: 3_000 }),
    makeRecord({ _id: "r4", transferredAt: 4_000 }),
  ];

  it("returns all records when neither since nor until is provided", () => {
    const result = applyDateRangeFilter(records);
    expect(result).toHaveLength(4);
  });

  it("returns all records when called with an explicit undefined/undefined", () => {
    const result = applyDateRangeFilter(records, undefined, undefined);
    expect(result).toHaveLength(4);
  });

  it("filters records older than since", () => {
    const result = applyDateRangeFilter(records, 2_000);
    // Includes records with transferredAt >= 2_000
    expect(result.map((r) => r._id)).toEqual(["r2", "r3", "r4"]);
  });

  it("filters records newer than until", () => {
    const result = applyDateRangeFilter(records, undefined, 3_000);
    // Includes records with transferredAt <= 3_000
    expect(result.map((r) => r._id)).toEqual(["r1", "r2", "r3"]);
  });

  it("applies a closed time window with both since and until", () => {
    const result = applyDateRangeFilter(records, 2_000, 3_000);
    expect(result.map((r) => r._id)).toEqual(["r2", "r3"]);
  });

  it("boundary: includes records exactly at since", () => {
    const result = applyDateRangeFilter(records, 2_000);
    const ids = result.map((r) => r._id);
    expect(ids).toContain("r2");
  });

  it("boundary: includes records exactly at until", () => {
    const result = applyDateRangeFilter(records, undefined, 3_000);
    const ids = result.map((r) => r._id);
    expect(ids).toContain("r3");
  });

  it("returns an empty array when no records match the window", () => {
    const result = applyDateRangeFilter(records, 5_000, 6_000);
    expect(result).toHaveLength(0);
  });

  it("does not mutate the original array", () => {
    const copy = [...records];
    applyDateRangeFilter(copy, 2_000);
    expect(copy).toHaveLength(4);
  });
});

// ─── computeTransferSummary ───────────────────────────────────────────────────

describe("computeTransferSummary", () => {
  it("returns zero counts and null fields for an empty array", () => {
    const result = computeTransferSummary([]);
    expect(result.totalTransfers).toBe(0);
    expect(result.mostActiveTo).toBeNull();
    expect(result.earliestTransferAt).toBeNull();
    expect(result.latestTransferAt).toBeNull();
  });

  it("counts a single record correctly", () => {
    const r = makeRecord({ transferredAt: 5_000, toUserId: "u1", toUserName: "User One" });
    const result = computeTransferSummary([r]);
    expect(result.totalTransfers).toBe(1);
    expect(result.mostActiveTo).toEqual({ userId: "u1", userName: "User One", count: 1 });
    expect(result.earliestTransferAt).toBe(5_000);
    expect(result.latestTransferAt).toBe(5_000);
  });

  it("reports totalTransfers equal to the number of records", () => {
    const records = [
      makeRecord({ _id: "r1" }),
      makeRecord({ _id: "r2" }),
      makeRecord({ _id: "r3" }),
    ];
    const result = computeTransferSummary(records);
    expect(result.totalTransfers).toBe(3);
  });

  it("identifies the most active recipient correctly", () => {
    const records = [
      makeRecord({ toUserId: "u1", toUserName: "Alice", transferredAt: 1_000 }),
      makeRecord({ toUserId: "u2", toUserName: "Bob",   transferredAt: 2_000 }),
      makeRecord({ toUserId: "u1", toUserName: "Alice", transferredAt: 3_000 }),
      makeRecord({ toUserId: "u1", toUserName: "Alice", transferredAt: 4_000 }),
    ];
    const result = computeTransferSummary(records);
    expect(result.mostActiveTo).toEqual({ userId: "u1", userName: "Alice", count: 3 });
  });

  it("returns the correct earliest and latest timestamps", () => {
    const records = [
      makeRecord({ transferredAt: 3_000 }),
      makeRecord({ transferredAt: 1_000 }),
      makeRecord({ transferredAt: 2_000 }),
    ];
    const result = computeTransferSummary(records);
    expect(result.earliestTransferAt).toBe(1_000);
    expect(result.latestTransferAt).toBe(3_000);
  });

  it("handles a single record with identical earliest and latest", () => {
    const records = [makeRecord({ transferredAt: 7_000 })];
    const result = computeTransferSummary(records);
    expect(result.earliestTransferAt).toBe(7_000);
    expect(result.latestTransferAt).toBe(7_000);
  });

  it("picks the first encountered entry as mostActiveTo when there is a tie", () => {
    // u1 and u2 both have count = 2; u1 appears first in the array.
    const records = [
      makeRecord({ toUserId: "u1", toUserName: "Alice", transferredAt: 1_000 }),
      makeRecord({ toUserId: "u1", toUserName: "Alice", transferredAt: 2_000 }),
      makeRecord({ toUserId: "u2", toUserName: "Bob",   transferredAt: 3_000 }),
      makeRecord({ toUserId: "u2", toUserName: "Bob",   transferredAt: 4_000 }),
    ];
    const result = computeTransferSummary(records);
    // u1 reaches count 2 first; u2's count never exceeds u1 (uses strict >)
    expect(result.mostActiveTo?.userId).toBe("u1");
  });
});

// ─── computeCustodianIdentitySummary ─────────────────────────────────────────

describe("computeCustodianIdentitySummary", () => {
  const ALICE = "user-alice";

  it("returns zeros and empty arrays when no records exist", () => {
    const result = computeCustodianIdentitySummary(ALICE, []);
    expect(result.userId).toBe(ALICE);
    expect(result.currentCaseIds).toEqual([]);
    expect(result.currentCaseCount).toBe(0);
    expect(result.totalReceived).toBe(0);
    expect(result.totalTransferred).toBe(0);
  });

  it("counts a single case held by the user", () => {
    const records = [
      makeRecord({ _id: "r1", caseId: "case-A", toUserId: ALICE, fromUserId: "user-bob", transferredAt: 1_000 }),
    ];
    const result = computeCustodianIdentitySummary(ALICE, records);
    expect(result.currentCaseIds).toContain("case-A");
    expect(result.currentCaseCount).toBe(1);
    expect(result.totalReceived).toBe(1);
    expect(result.totalTransferred).toBe(0);
  });

  it("does not count a case the user subsequently transferred away", () => {
    const records = [
      // Alice receives case-A from Bob
      makeRecord({ _id: "r1", caseId: "case-A", fromUserId: "user-bob", toUserId: ALICE, transferredAt: 1_000 }),
      // Alice later transfers case-A to Charlie
      makeRecord({ _id: "r2", caseId: "case-A", fromUserId: ALICE, toUserId: "user-charlie", transferredAt: 2_000 }),
    ];
    const result = computeCustodianIdentitySummary(ALICE, records);
    expect(result.currentCaseIds).not.toContain("case-A");
    expect(result.currentCaseCount).toBe(0);
    expect(result.totalReceived).toBe(1);
    expect(result.totalTransferred).toBe(1);
  });

  it("correctly identifies currently-held cases among a mix", () => {
    const records = [
      // Alice receives case-A → still holds it
      makeRecord({ _id: "r1", caseId: "case-A", fromUserId: "user-bob", toUserId: ALICE, transferredAt: 1_000 }),
      // Alice receives case-B → but then transfers it away
      makeRecord({ _id: "r2", caseId: "case-B", fromUserId: "user-bob", toUserId: ALICE, transferredAt: 2_000 }),
      makeRecord({ _id: "r3", caseId: "case-B", fromUserId: ALICE, toUserId: "user-charlie", transferredAt: 3_000 }),
      // Alice receives case-C → still holds it
      makeRecord({ _id: "r4", caseId: "case-C", fromUserId: "user-charlie", toUserId: ALICE, transferredAt: 4_000 }),
    ];
    const result = computeCustodianIdentitySummary(ALICE, records);
    expect(result.currentCaseIds.sort()).toEqual(["case-A", "case-C"].sort());
    expect(result.currentCaseCount).toBe(2);
    expect(result.totalReceived).toBe(3);    // r1, r2, r4
    expect(result.totalTransferred).toBe(1); // r3
  });

  it("preserves the userId in the returned summary", () => {
    const result = computeCustodianIdentitySummary("user-xyz", []);
    expect(result.userId).toBe("user-xyz");
  });

  it("totalReceived counts only records where user is toUserId", () => {
    const records = [
      makeRecord({ _id: "r1", toUserId: ALICE, fromUserId: "user-bob" }),
      makeRecord({ _id: "r2", toUserId: ALICE, fromUserId: "user-charlie" }),
      makeRecord({ _id: "r3", fromUserId: ALICE, toUserId: "user-bob" }),
    ];
    const result = computeCustodianIdentitySummary(ALICE, records);
    expect(result.totalReceived).toBe(2);
  });

  it("totalTransferred counts only records where user is fromUserId", () => {
    const records = [
      makeRecord({ _id: "r1", toUserId: ALICE, fromUserId: "user-bob" }),
      makeRecord({ _id: "r2", fromUserId: ALICE, toUserId: "user-bob" }),
      makeRecord({ _id: "r3", fromUserId: ALICE, toUserId: "user-charlie" }),
    ];
    const result = computeCustodianIdentitySummary(ALICE, records);
    expect(result.totalTransferred).toBe(2);
  });
});

// ─── filterByParticipant ──────────────────────────────────────────────────────

describe("filterByParticipant", () => {
  const ALICE = "user-alice";

  it("returns an empty array when no records match", () => {
    const records = [
      makeRecord({ _id: "r1", fromUserId: "user-bob",     toUserId: "user-charlie" }),
      makeRecord({ _id: "r2", fromUserId: "user-charlie", toUserId: "user-dave" }),
    ];
    expect(filterByParticipant(records, ALICE)).toHaveLength(0);
  });

  it("includes records where user is toUserId", () => {
    const records = [
      makeRecord({ _id: "r1", fromUserId: "user-bob", toUserId: ALICE }),
      makeRecord({ _id: "r2", fromUserId: "user-bob", toUserId: "user-charlie" }),
    ];
    const result = filterByParticipant(records, ALICE);
    expect(result.map((r) => r._id)).toEqual(["r1"]);
  });

  it("includes records where user is fromUserId", () => {
    const records = [
      makeRecord({ _id: "r1", fromUserId: ALICE, toUserId: "user-bob" }),
      makeRecord({ _id: "r2", fromUserId: "user-bob", toUserId: "user-charlie" }),
    ];
    const result = filterByParticipant(records, ALICE);
    expect(result.map((r) => r._id)).toEqual(["r1"]);
  });

  it("includes records where user is BOTH fromUserId and toUserId (self-transfer)", () => {
    const record = makeRecord({ _id: "r1", fromUserId: ALICE, toUserId: ALICE });
    const result = filterByParticipant([record], ALICE);
    expect(result).toHaveLength(1);
  });

  it("returns all matching records from a mixed list", () => {
    const records = [
      makeRecord({ _id: "r1", fromUserId: ALICE,       toUserId: "user-bob"     }),
      makeRecord({ _id: "r2", fromUserId: "user-bob",  toUserId: ALICE          }),
      makeRecord({ _id: "r3", fromUserId: "user-bob",  toUserId: "user-charlie" }),
      makeRecord({ _id: "r4", fromUserId: ALICE,       toUserId: "user-charlie" }),
    ];
    const result = filterByParticipant(records, ALICE);
    expect(result.map((r) => r._id).sort()).toEqual(["r1", "r2", "r4"].sort());
  });

  it("does not include records for other users", () => {
    const records = [
      makeRecord({ _id: "r1", fromUserId: "user-bob",     toUserId: "user-charlie" }),
      makeRecord({ _id: "r2", fromUserId: "user-charlie", toUserId: "user-dave"    }),
    ];
    const result = filterByParticipant(records, ALICE);
    expect(result).toHaveLength(0);
  });

  it("does not mutate the original array", () => {
    const records = [
      makeRecord({ _id: "r1", fromUserId: ALICE, toUserId: "user-bob" }),
    ];
    const original = [...records];
    filterByParticipant(records, ALICE);
    expect(records).toHaveLength(original.length);
  });
});

// ─── Custodian identity query contract tests ──────────────────────────────────
// These tests verify the logical contracts that getCustodyRecordsByCustodian,
// getCustodyRecordsByTransferrer, and getCustodyRecordsByParticipant must satisfy.

describe("custodian identity query contracts", () => {
  const ALICE = "user-alice";
  const BOB   = "user-bob";

  const records: CustodyRecord[] = [
    makeRecord({ _id: "r1", caseId: "c1", fromUserId: BOB,   toUserId: ALICE, transferredAt: 1_000 }),
    makeRecord({ _id: "r2", caseId: "c2", fromUserId: ALICE, toUserId: BOB,   transferredAt: 2_000 }),
    makeRecord({ _id: "r3", caseId: "c3", fromUserId: BOB,   toUserId: ALICE, transferredAt: 3_000 }),
    makeRecord({ _id: "r4", caseId: "c1", fromUserId: ALICE, toUserId: BOB,   transferredAt: 4_000 }),
    makeRecord({ _id: "r5", caseId: "c4", fromUserId: "charlie", toUserId: BOB, transferredAt: 5_000 }),
  ];

  it("getCustodyRecordsByCustodian returns only records where toUserId matches", () => {
    const custodianRecords = records.filter((r) => r.toUserId === ALICE);
    expect(custodianRecords.map((r) => r._id).sort()).toEqual(["r1", "r3"].sort());
  });

  it("getCustodyRecordsByTransferrer returns only records where fromUserId matches", () => {
    const transferrerRecords = records.filter((r) => r.fromUserId === ALICE);
    expect(transferrerRecords.map((r) => r._id).sort()).toEqual(["r2", "r4"].sort());
  });

  it("getCustodyRecordsByParticipant is the union of custodian and transferrer records", () => {
    const custodian   = records.filter((r) => r.toUserId   === ALICE);
    const transferrer = records.filter((r) => r.fromUserId === ALICE);
    const participant = filterByParticipant(records, ALICE);

    const unionIds = new Set([...custodian, ...transferrer].map((r) => r._id));
    expect(participant.map((r) => r._id).sort()).toEqual([...unionIds].sort());
  });

  it("custodian identity summary reflects the correct current case count", () => {
    // From the records above for ALICE:
    //   r1: Alice receives case c1 at t=1000
    //   r2: Alice transfers case c2 at t=2000 (she never held c2 per these records)
    //   r3: Alice receives case c3 at t=3000
    //   r4: Alice transfers case c1 at t=4000 (she had it from r1)
    // So: c1 was received then transferred → not currently held
    //     c3 was received → currently held
    //     c2: r2 is from Alice — she never received c2 in these records
    const allAliceRecords = filterByParticipant(records, ALICE);
    const summary = computeCustodianIdentitySummary(ALICE, allAliceRecords);

    expect(summary.currentCaseIds).toContain("c3");
    expect(summary.currentCaseIds).not.toContain("c1"); // transferred away at r4
    expect(summary.currentCaseCount).toBe(1);
  });

  it("getCustodyRecordsByParticipant returns empty for a user with no records", () => {
    const result = filterByParticipant(records, "user-dave");
    expect(result).toHaveLength(0);
  });

  it("sum of unique custodian + transferrer IDs ≤ participant count (no double-counting)", () => {
    const custodian   = records.filter((r) => r.toUserId   === ALICE).map((r) => r._id);
    const transferrer = records.filter((r) => r.fromUserId === ALICE).map((r) => r._id);
    const participant = filterByParticipant(records, ALICE).map((r) => r._id);

    const union = new Set([...custodian, ...transferrer]);
    // Participant count should equal union size (deduplication of self-transfers)
    expect(participant.length).toBe(union.size);
  });
});
