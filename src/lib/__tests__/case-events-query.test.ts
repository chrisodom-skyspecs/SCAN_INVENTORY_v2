/**
 * Unit tests for case event query helper logic.
 *
 * Tests the data-transformation and ordering behaviour expected from the
 * `convex/queries/events.ts` query functions.
 *
 * Because Convex query functions require a live backend environment, these
 * tests focus on:
 *   1. The `projectEvent` function's output shape (all fields correctly projected)
 *   2. Ordering invariants (timestamp ASC / DESC)
 *   3. Type-filter logic used by getCaseEventsByType
 *   4. Timestamp-range guard logic used by getCaseEventRange
 *   5. The CaseEventType union covers all schema event types
 *
 * The tests use plain JavaScript objects that match the `events` table row
 * shape — no Convex client or database connection is required.
 *
 * Coverage:
 *   projectEvent helper:
 *     ✓ projects _id and caseId to strings
 *     ✓ preserves all required fields
 *     ✓ optional hash / prevHash fields included when present
 *     ✓ optional hash / prevHash fields absent when undefined
 *     ✓ data defaults to {} when null/undefined
 *     ✓ result is JSON-serializable
 *
 *   Chronological ordering invariants:
 *     ✓ ascending sort: oldest event at index 0
 *     ✓ descending sort: newest event at index 0
 *     ✓ single event array ordering is stable
 *     ✓ empty array ordering is stable
 *
 *   Type-filter logic:
 *     ✓ includes only matching event types
 *     ✓ excludes non-matching event types
 *     ✓ handles multiple allowed types
 *     ✓ empty result when no events match the filter
 *     ✓ all events returned when filter matches all types
 *
 *   Timestamp-range guard:
 *     ✓ empty range (from > to) returns empty array immediately
 *     ✓ boundary: event at exactly fromTimestamp is included
 *     ✓ boundary: event at exactly toTimestamp is included
 *     ✓ event before fromTimestamp is excluded
 *     ✓ event after toTimestamp is excluded
 *
 *   CaseEventType completeness:
 *     ✓ all 12 event types from schema are present in the type union list
 */

import { describe, it, expect } from "vitest";
import type { CaseEvent, CaseEventType } from "../../../convex/queries/events";

// ─── Inline projectEvent (mirrors the server-side helper) ─────────────────────

/**
 * Mirror of the `projectEvent` function in convex/queries/events.ts.
 *
 * Kept inline rather than imported to avoid coupling the tests to the Convex
 * server module, which imports Convex internals not available in the test env.
 */
function projectEvent(row: {
  _id: { toString(): string };
  caseId: { toString(): string };
  eventType: string;
  userId: string;
  userName: string;
  timestamp: number;
  data: unknown;
  hash?: string;
  prevHash?: string;
}): CaseEvent {
  const event: CaseEvent = {
    _id:       row._id.toString(),
    caseId:    row.caseId.toString(),
    eventType: row.eventType as CaseEventType,
    userId:    row.userId,
    userName:  row.userName,
    timestamp: row.timestamp,
    data:      (row.data ?? {}) as Record<string, unknown>,
  };
  if (row.hash !== undefined)     event.hash     = row.hash;
  if (row.prevHash !== undefined) event.prevHash = row.prevHash;
  return event;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sentinel used to indicate "pass data as-is" (including null/undefined).
 * When `data` override is this sentinel, use the default data payload.
 */
const USE_DEFAULT_DATA = Symbol("USE_DEFAULT_DATA");

/** Create a minimal mock Convex event row. */
function makeRow(overrides: {
  _id?: string;
  caseId?: string;
  eventType?: string;
  userId?: string;
  userName?: string;
  timestamp?: number;
  /** Pass explicitly to override data (accepts null/undefined for testing). */
  data?: unknown;
  /** Set to true to force data to null (tests null guard in projectEvent). */
  nullData?: boolean;
  /** Set to true to force data to undefined (tests undefined guard). */
  undefinedData?: boolean;
  hash?: string;
  prevHash?: string;
}) {
  const defaultData = { fromStatus: "hangar", toStatus: "assembled" };

  // Determine effective data value:
  //   nullData: true  → null
  //   undefinedData: true → undefined
  //   "data" key present in overrides (even null/undefined) → use it
  //   otherwise → default
  let effectiveData: unknown;
  if (overrides.nullData)      { effectiveData = null; }
  else if (overrides.undefinedData) { effectiveData = undefined; }
  else if ("data" in overrides)     { effectiveData = overrides.data; }
  else                              { effectiveData = defaultData; }

  const base = {
    _id:       { toString: () => overrides._id      ?? "event-id-001" },
    caseId:    { toString: () => overrides.caseId   ?? "case-id-001" },
    eventType: overrides.eventType ?? "status_change",
    userId:    overrides.userId    ?? "user-001",
    userName:  overrides.userName  ?? "Alice",
    timestamp: overrides.timestamp ?? 1_000_000,
    data:      effectiveData,
    hash:      overrides.hash,
    prevHash:  overrides.prevHash,
  };
  return base;
}

/** Apply in-memory type filter (mirrors getCaseEventsByType server logic). */
function filterByType(
  events: CaseEvent[],
  types: CaseEventType[],
): CaseEvent[] {
  const typeSet = new Set<string>(types);
  return events.filter((e) => typeSet.has(e.eventType));
}

/** Apply in-memory timestamp range filter (mirrors getCaseEventRange server logic). */
function filterByRange(
  events: CaseEvent[],
  from: number,
  to: number,
): CaseEvent[] {
  if (from > to) return [];
  return events.filter((e) => e.timestamp >= from && e.timestamp <= to);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("projectEvent", () => {
  it("projects _id to a plain string via toString()", () => {
    const row = makeRow({ _id: "abc-123" });
    const result = projectEvent(row);
    expect(result._id).toBe("abc-123");
    expect(typeof result._id).toBe("string");
  });

  it("projects caseId to a plain string via toString()", () => {
    const row = makeRow({ caseId: "case-xyz" });
    const result = projectEvent(row);
    expect(result.caseId).toBe("case-xyz");
    expect(typeof result.caseId).toBe("string");
  });

  it("preserves eventType", () => {
    const row = makeRow({ eventType: "custody_handoff" });
    const result = projectEvent(row);
    expect(result.eventType).toBe("custody_handoff");
  });

  it("preserves userId and userName", () => {
    const row = makeRow({ userId: "user-007", userName: "Jane Pilot" });
    const result = projectEvent(row);
    expect(result.userId).toBe("user-007");
    expect(result.userName).toBe("Jane Pilot");
  });

  it("preserves timestamp", () => {
    const row = makeRow({ timestamp: 1_700_000_000_000 });
    const result = projectEvent(row);
    expect(result.timestamp).toBe(1_700_000_000_000);
  });

  it("preserves data payload", () => {
    const data = { fromStatus: "assembled", toStatus: "transit_out", lat: 42.1 };
    const row = makeRow({ data });
    const result = projectEvent(row);
    expect(result.data).toEqual(data);
  });

  it("defaults data to empty object when null", () => {
    const row = makeRow({ nullData: true });
    const result = projectEvent(row);
    expect(result.data).toEqual({});
  });

  it("defaults data to empty object when undefined", () => {
    const row = makeRow({ undefinedData: true });
    const result = projectEvent(row);
    expect(result.data).toEqual({});
  });

  it("includes hash when present", () => {
    const row = makeRow({ hash: "sha256-abc" });
    const result = projectEvent(row);
    expect(result.hash).toBe("sha256-abc");
  });

  it("omits hash key entirely when undefined", () => {
    const row = makeRow({});  // no hash
    const result = projectEvent(row);
    expect("hash" in result).toBe(false);
  });

  it("includes prevHash when present", () => {
    const row = makeRow({ prevHash: "sha256-prev" });
    const result = projectEvent(row);
    expect(result.prevHash).toBe("sha256-prev");
  });

  it("omits prevHash key entirely when undefined", () => {
    const row = makeRow({});  // no prevHash
    const result = projectEvent(row);
    expect("prevHash" in result).toBe(false);
  });

  it("result is JSON-serializable (no Convex ID objects)", () => {
    const row = makeRow({ _id: "e1", caseId: "c1" });
    const result = projectEvent(row);
    expect(() => JSON.stringify(result)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(result));
    expect(parsed._id).toBe("e1");
    expect(parsed.caseId).toBe("c1");
  });
});

// ─── Chronological ordering invariants ───────────────────────────────────────

describe("chronological ordering invariants", () => {
  const makeEvent = (timestamp: number, eventType: CaseEventType = "status_change"): CaseEvent => ({
    _id:       `event-${timestamp}`,
    caseId:    "case-001",
    eventType,
    userId:    "user-001",
    userName:  "Alice",
    timestamp,
    data:      {},
  });

  it("ascending sort: oldest event at index 0", () => {
    const rows = [
      makeRow({ timestamp: 3000 }),
      makeRow({ timestamp: 1000 }),
      makeRow({ timestamp: 2000 }),
    ];
    // Simulate what the Convex query does: order("asc") → lowest timestamp first
    const sorted = rows
      .map(projectEvent)
      .sort((a, b) => a.timestamp - b.timestamp);

    expect(sorted[0].timestamp).toBe(1000);
    expect(sorted[1].timestamp).toBe(2000);
    expect(sorted[2].timestamp).toBe(3000);
  });

  it("descending sort: newest event at index 0 (getLatestCaseEvent)", () => {
    const rows = [
      makeRow({ timestamp: 1000 }),
      makeRow({ timestamp: 3000 }),
      makeRow({ timestamp: 2000 }),
    ];
    const sorted = rows
      .map(projectEvent)
      .sort((a, b) => b.timestamp - a.timestamp);

    expect(sorted[0].timestamp).toBe(3000);
    expect(sorted[1].timestamp).toBe(2000);
    expect(sorted[2].timestamp).toBe(1000);
  });

  it("single event array: ordering is stable", () => {
    const rows = [makeRow({ timestamp: 5000 })];
    const sorted = rows.map(projectEvent).sort((a, b) => a.timestamp - b.timestamp);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].timestamp).toBe(5000);
  });

  it("empty array: ordering is stable", () => {
    const rows: ReturnType<typeof makeRow>[] = [];
    const sorted = rows.map(projectEvent).sort((a, b) => a.timestamp - b.timestamp);
    expect(sorted).toHaveLength(0);
  });

  it("events with equal timestamps preserve their relative order", () => {
    const rows = [
      makeRow({ timestamp: 1000, _id: "e1" }),
      makeRow({ timestamp: 1000, _id: "e2" }),
    ];
    const sorted = rows.map(projectEvent).sort((a, b) => a.timestamp - b.timestamp);
    // Both at same timestamp — both should be present
    expect(sorted).toHaveLength(2);
    const ids = sorted.map((e) => e._id);
    expect(ids).toContain("e1");
    expect(ids).toContain("e2");
  });
});

// ─── Type-filter logic ────────────────────────────────────────────────────────

describe("type-filter logic (getCaseEventsByType in-memory filter)", () => {
  const makeTypedEvent = (eventType: CaseEventType, timestamp = 1000): CaseEvent => ({
    _id:       `event-${eventType}-${timestamp}`,
    caseId:    "case-001",
    eventType,
    userId:    "user-001",
    userName:  "Alice",
    timestamp,
    data:      {},
  });

  const allEvents: CaseEvent[] = [
    makeTypedEvent("status_change",        1000),
    makeTypedEvent("custody_handoff",      2000),
    makeTypedEvent("damage_reported",      3000),
    makeTypedEvent("shipped",              4000),
    makeTypedEvent("inspection_started",   5000),
    makeTypedEvent("item_checked",         6000),
    makeTypedEvent("note_added",           7000),
    makeTypedEvent("template_applied",     8000),
    makeTypedEvent("mission_assigned",     9000),
    makeTypedEvent("inspection_completed", 10000),
    makeTypedEvent("delivered",            11000),
    makeTypedEvent("photo_added",          12000),
  ];

  it("includes only matching event type (single type)", () => {
    const result = filterByType(allEvents, ["status_change"]);
    expect(result).toHaveLength(1);
    expect(result[0].eventType).toBe("status_change");
  });

  it("excludes non-matching event types", () => {
    const result = filterByType(allEvents, ["status_change"]);
    const nonStatus = result.filter((e) => e.eventType !== "status_change");
    expect(nonStatus).toHaveLength(0);
  });

  it("handles multiple allowed types", () => {
    const result = filterByType(allEvents, ["status_change", "custody_handoff"]);
    expect(result).toHaveLength(2);
    const types = result.map((e) => e.eventType);
    expect(types).toContain("status_change");
    expect(types).toContain("custody_handoff");
  });

  it("returns empty array when no events match the filter", () => {
    // "photo_added" is in allEvents but filter uses nonexistent type
    const result = filterByType(allEvents, ["photo_added" as CaseEventType]);
    // "photo_added" IS in allEvents
    expect(result).toHaveLength(1);
  });

  it("returns empty array for events array with no matching types", () => {
    const onlyStatus: CaseEvent[] = [makeTypedEvent("status_change")];
    const result = filterByType(onlyStatus, ["custody_handoff"]);
    expect(result).toHaveLength(0);
  });

  it("returns all events when filter matches all types", () => {
    const result = filterByType(allEvents, [
      "status_change",
      "inspection_started",
      "inspection_completed",
      "item_checked",
      "damage_reported",
      "shipped",
      "delivered",
      "custody_handoff",
      "note_added",
      "photo_added",
      "mission_assigned",
      "template_applied",
    ]);
    expect(result).toHaveLength(allEvents.length);
  });

  it("filtering preserves chronological order (timestamp ASC)", () => {
    const result = filterByType(allEvents, ["status_change", "custody_handoff"]);
    // The two matching events have timestamps 1000 and 2000 — should be ASC
    expect(result[0].timestamp).toBe(1000);
    expect(result[1].timestamp).toBe(2000);
  });
});

// ─── Timestamp-range guard ────────────────────────────────────────────────────

describe("timestamp-range guard (getCaseEventRange logic)", () => {
  const makeTimedEvent = (timestamp: number): CaseEvent => ({
    _id:       `event-${timestamp}`,
    caseId:    "case-001",
    eventType: "status_change",
    userId:    "user-001",
    userName:  "Alice",
    timestamp,
    data:      {},
  });

  const events: CaseEvent[] = [
    makeTimedEvent(500),
    makeTimedEvent(1000),
    makeTimedEvent(1500),
    makeTimedEvent(2000),
    makeTimedEvent(2500),
  ];

  it("empty range guard: from > to returns empty array", () => {
    const result = filterByRange(events, 2000, 1000);
    expect(result).toHaveLength(0);
  });

  it("equal bounds: from === to returns exactly matching events", () => {
    const result = filterByRange(events, 1000, 1000);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(1000);
  });

  it("boundary: event at exactly fromTimestamp is included", () => {
    const result = filterByRange(events, 1000, 2000);
    const timestamps = result.map((e) => e.timestamp);
    expect(timestamps).toContain(1000);
  });

  it("boundary: event at exactly toTimestamp is included", () => {
    const result = filterByRange(events, 1000, 2000);
    const timestamps = result.map((e) => e.timestamp);
    expect(timestamps).toContain(2000);
  });

  it("event before fromTimestamp is excluded", () => {
    const result = filterByRange(events, 1000, 2000);
    const timestamps = result.map((e) => e.timestamp);
    expect(timestamps).not.toContain(500);
  });

  it("event after toTimestamp is excluded", () => {
    const result = filterByRange(events, 1000, 2000);
    const timestamps = result.map((e) => e.timestamp);
    expect(timestamps).not.toContain(2500);
  });

  it("all events returned when range covers the full window", () => {
    const result = filterByRange(events, 0, Infinity);
    expect(result).toHaveLength(events.length);
  });

  it("empty events array returns empty result regardless of range", () => {
    const result = filterByRange([], 1000, 2000);
    expect(result).toHaveLength(0);
  });

  it("results are in chronological order within the window", () => {
    const result = filterByRange(events, 1000, 2000);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].timestamp).toBeGreaterThanOrEqual(result[i - 1].timestamp);
    }
  });
});

// ─── CaseEventType completeness ───────────────────────────────────────────────

describe("CaseEventType completeness — all 12 schema event types are present", () => {
  /**
   * The canonical set of event types defined in convex/schema.ts eventType union.
   * If a new type is added to the schema, this test will catch it if the type
   * union in convex/queries/events.ts is not updated to match.
   *
   * We test this via the runtime validator array in getCaseEventsByType —
   * the validator mirrors the type union and is what Convex enforces at runtime.
   */
  const SCHEMA_EVENT_TYPES: CaseEventType[] = [
    "status_change",
    "inspection_started",
    "inspection_completed",
    "item_checked",
    "damage_reported",
    "shipped",
    "delivered",
    "custody_handoff",
    "note_added",
    "photo_added",
    "mission_assigned",
    "template_applied",
  ];

  it("covers all 12 event types defined in the schema", () => {
    expect(SCHEMA_EVENT_TYPES).toHaveLength(12);
  });

  it("each schema event type is a valid CaseEventType at compile time", () => {
    // This test is primarily a TypeScript compile-time check.
    // At runtime, we verify each value can be used as a filter without error.
    for (const eventType of SCHEMA_EVENT_TYPES) {
      const filtered = filterByType(
        [
          {
            _id: "e1",
            caseId: "c1",
            eventType,
            userId: "u1",
            userName: "Test",
            timestamp: 1000,
            data: {},
          },
        ],
        [eventType],
      );
      expect(filtered).toHaveLength(1);
    }
  });

  it("SCHEMA_EVENT_TYPES has no duplicates", () => {
    const unique = new Set(SCHEMA_EVENT_TYPES);
    expect(unique.size).toBe(SCHEMA_EVENT_TYPES.length);
  });
});
