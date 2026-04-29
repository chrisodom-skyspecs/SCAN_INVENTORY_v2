/**
 * src/lib/__tests__/case-status-filter.test.ts
 *
 * Unit tests for the case-status-filter utility (AC 90202 Sub-AC 2).
 *
 * Covers:
 *   1. LAYER_TOGGLE_STATUS_MAP — correct mapping of each toggle key to statuses
 *   2. Coverage — every CaseStatus is covered by exactly one toggle key
 *   3. getVisibleStatuses — all on, all off, single toggle, mixed
 *   4. filterCasesByLayerToggles — passthrough, empty, partial, generic T
 *   5. Fast paths — all-visible returns full array; all-hidden returns []
 *   6. getToggleKeyForStatus — lookup for all 8 statuses, unknown input
 *   7. isCaseVisibleUnderToggles — respects toggle state, unknown status
 *   8. Array immutability — original array not mutated
 *   9. Generic typing — works with extended types (MapCasePin, custom shapes)
 *  10. Edge cases — empty input, single-element, unknown status value
 */

import { describe, it, expect } from "vitest";
import {
  LAYER_TOGGLE_STATUS_MAP,
  getVisibleStatuses,
  filterCasesByLayerToggles,
  getToggleKeyForStatus,
  isCaseVisibleUnderToggles,
} from "../case-status-filter";
import { CASE_STATUSES } from "@/types/case-status";
import type { CaseStatus } from "@/types/case-status";
import type { LayerToggles } from "@/types/map";
import { DEFAULT_LAYER_TOGGLES, LAYER_TOGGLE_KEYS } from "@/types/map";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ALL_ON: LayerToggles = { deployed: true, transit: true, flagged: true, hangar: true };
const ALL_OFF: LayerToggles = { deployed: false, transit: false, flagged: false, hangar: false };

/** Build a minimal case-shaped object. */
function makeCase(status: CaseStatus, id?: string) {
  const caseId = id ?? status;
  return { id: caseId, status, label: `CASE-${caseId}` };
}

/** One case per status — full fleet fixture. */
const FULL_FLEET = CASE_STATUSES.map((s) => makeCase(s as CaseStatus));

// ─── 1. LAYER_TOGGLE_STATUS_MAP contents ─────────────────────────────────────

describe("LAYER_TOGGLE_STATUS_MAP", () => {
  it("deployed maps to ['deployed']", () => {
    expect(LAYER_TOGGLE_STATUS_MAP.deployed).toEqual(["deployed"]);
  });

  it("transit maps to ['transit_out', 'transit_in']", () => {
    expect(LAYER_TOGGLE_STATUS_MAP.transit).toContain("transit_out");
    expect(LAYER_TOGGLE_STATUS_MAP.transit).toContain("transit_in");
    expect(LAYER_TOGGLE_STATUS_MAP.transit).toHaveLength(2);
  });

  it("flagged maps to ['flagged']", () => {
    expect(LAYER_TOGGLE_STATUS_MAP.flagged).toEqual(["flagged"]);
  });

  it("hangar maps to ['hangar', 'assembled', 'received', 'archived']", () => {
    const hangar = LAYER_TOGGLE_STATUS_MAP.hangar;
    expect(hangar).toContain("hangar");
    expect(hangar).toContain("assembled");
    expect(hangar).toContain("received");
    expect(hangar).toContain("archived");
    expect(hangar).toHaveLength(4);
  });

  it("has exactly the four toggle keys", () => {
    const keys = Object.keys(LAYER_TOGGLE_STATUS_MAP);
    expect(keys).toHaveLength(4);
    for (const key of LAYER_TOGGLE_KEYS) {
      expect(keys).toContain(key);
    }
  });
});

// ─── 2. Coverage — every CaseStatus is covered exactly once ──────────────────

describe("LAYER_TOGGLE_STATUS_MAP — complete coverage", () => {
  it("covers all 8 CaseStatus values", () => {
    const allMappedStatuses = LAYER_TOGGLE_KEYS.flatMap(
      (key) => [...LAYER_TOGGLE_STATUS_MAP[key]]
    );
    expect(allMappedStatuses).toHaveLength(8);
    for (const status of CASE_STATUSES) {
      expect(allMappedStatuses).toContain(status);
    }
  });

  it("no CaseStatus appears in more than one toggle bucket", () => {
    const seen = new Map<string, string>();
    for (const key of LAYER_TOGGLE_KEYS) {
      for (const status of LAYER_TOGGLE_STATUS_MAP[key]) {
        expect(
          seen.has(status),
          `Status "${status}" appears in both "${seen.get(status)}" and "${key}" buckets`
        ).toBe(false);
        seen.set(status, key);
      }
    }
  });
});

// ─── 3. getVisibleStatuses ────────────────────────────────────────────────────

describe("getVisibleStatuses", () => {
  it("returns all 8 statuses when all toggles are on", () => {
    const visible = getVisibleStatuses(ALL_ON);
    expect(visible.size).toBe(8);
    for (const status of CASE_STATUSES) {
      expect(visible.has(status)).toBe(true);
    }
  });

  it("returns empty Set when all toggles are off", () => {
    const visible = getVisibleStatuses(ALL_OFF);
    expect(visible.size).toBe(0);
  });

  it("DEFAULT_LAYER_TOGGLES produces all 8 visible statuses", () => {
    // All four toggles are true by default
    const visible = getVisibleStatuses(DEFAULT_LAYER_TOGGLES);
    expect(visible.size).toBe(8);
  });

  it("only deployed toggle on → only 'deployed' status visible", () => {
    const visible = getVisibleStatuses({ ...ALL_OFF, deployed: true });
    expect(visible).toEqual(new Set(["deployed"]));
  });

  it("only transit toggle on → transit_out and transit_in visible", () => {
    const visible = getVisibleStatuses({ ...ALL_OFF, transit: true });
    expect(visible).toEqual(new Set(["transit_out", "transit_in"]));
  });

  it("only flagged toggle on → only 'flagged' status visible", () => {
    const visible = getVisibleStatuses({ ...ALL_OFF, flagged: true });
    expect(visible).toEqual(new Set(["flagged"]));
  });

  it("only hangar toggle on → hangar, assembled, received, archived visible", () => {
    const visible = getVisibleStatuses({ ...ALL_OFF, hangar: true });
    expect(visible).toEqual(new Set(["hangar", "assembled", "received", "archived"]));
  });

  it("deployed + transit toggles on → deployed, transit_out, transit_in", () => {
    const visible = getVisibleStatuses({ ...ALL_OFF, deployed: true, transit: true });
    expect(visible).toEqual(new Set(["deployed", "transit_out", "transit_in"]));
  });

  it("flagged + hangar toggles on → flagged + all hangar-bucket statuses", () => {
    const visible = getVisibleStatuses({ ...ALL_OFF, flagged: true, hangar: true });
    expect(visible).toEqual(
      new Set(["flagged", "hangar", "assembled", "received", "archived"])
    );
  });

  it("returns a Set (not an array)", () => {
    const result = getVisibleStatuses(ALL_ON);
    expect(result).toBeInstanceOf(Set);
  });

  it("each call returns a new Set instance", () => {
    const s1 = getVisibleStatuses(ALL_ON);
    const s2 = getVisibleStatuses(ALL_ON);
    expect(s1).not.toBe(s2);
  });
});

// ─── 4. filterCasesByLayerToggles — basic behaviour ──────────────────────────

describe("filterCasesByLayerToggles — all toggles on (passthrough)", () => {
  it("returns all cases when all toggles are active", () => {
    const result = filterCasesByLayerToggles(ALL_ON, FULL_FLEET);
    expect(result).toHaveLength(FULL_FLEET.length);
    expect(result.map((c) => c.status)).toEqual(expect.arrayContaining(CASE_STATUSES));
  });

  it("returns all cases when DEFAULT_LAYER_TOGGLES (all on)", () => {
    const result = filterCasesByLayerToggles(DEFAULT_LAYER_TOGGLES, FULL_FLEET);
    expect(result).toHaveLength(FULL_FLEET.length);
  });
});

describe("filterCasesByLayerToggles — all toggles off", () => {
  it("returns empty array when no toggles are active", () => {
    const result = filterCasesByLayerToggles(ALL_OFF, FULL_FLEET);
    expect(result).toEqual([]);
  });

  it("returns empty array when input is also empty", () => {
    const result = filterCasesByLayerToggles(ALL_OFF, []);
    expect(result).toEqual([]);
  });
});

describe("filterCasesByLayerToggles — deployed toggle only", () => {
  const toggles: LayerToggles = { ...ALL_OFF, deployed: true };

  it("returns only cases with status 'deployed'", () => {
    const result = filterCasesByLayerToggles(toggles, FULL_FLEET);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("deployed");
  });

  it("returns empty array when no cases are deployed", () => {
    const hangarCases = [makeCase("hangar"), makeCase("assembled")];
    const result = filterCasesByLayerToggles(toggles, hangarCases);
    expect(result).toEqual([]);
  });
});

describe("filterCasesByLayerToggles — transit toggle only", () => {
  const toggles: LayerToggles = { ...ALL_OFF, transit: true };

  it("returns transit_out and transit_in cases", () => {
    const result = filterCasesByLayerToggles(toggles, FULL_FLEET);
    expect(result).toHaveLength(2);
    const statuses = result.map((c) => c.status);
    expect(statuses).toContain("transit_out");
    expect(statuses).toContain("transit_in");
  });

  it("excludes deployed, flagged, and hangar cases", () => {
    const result = filterCasesByLayerToggles(toggles, FULL_FLEET);
    for (const c of result) {
      expect(["transit_out", "transit_in"]).toContain(c.status);
    }
  });
});

describe("filterCasesByLayerToggles — flagged toggle only", () => {
  const toggles: LayerToggles = { ...ALL_OFF, flagged: true };

  it("returns only cases with status 'flagged'", () => {
    const result = filterCasesByLayerToggles(toggles, FULL_FLEET);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("flagged");
  });
});

describe("filterCasesByLayerToggles — hangar toggle only", () => {
  const toggles: LayerToggles = { ...ALL_OFF, hangar: true };

  it("returns hangar, assembled, received, and archived cases", () => {
    const result = filterCasesByLayerToggles(toggles, FULL_FLEET);
    expect(result).toHaveLength(4);
    const statuses = result.map((c) => c.status);
    expect(statuses).toContain("hangar");
    expect(statuses).toContain("assembled");
    expect(statuses).toContain("received");
    expect(statuses).toContain("archived");
  });

  it("excludes deployed, transit_out, transit_in, and flagged", () => {
    const result = filterCasesByLayerToggles(toggles, FULL_FLEET);
    const excluded = ["deployed", "transit_out", "transit_in", "flagged"];
    for (const c of result) {
      expect(excluded).not.toContain(c.status);
    }
  });
});

describe("filterCasesByLayerToggles — mixed toggles", () => {
  it("deployed + flagged on → returns deployed and flagged cases", () => {
    const toggles: LayerToggles = { ...ALL_OFF, deployed: true, flagged: true };
    const result = filterCasesByLayerToggles(toggles, FULL_FLEET);
    expect(result).toHaveLength(2);
    const statuses = result.map((c) => c.status);
    expect(statuses).toContain("deployed");
    expect(statuses).toContain("flagged");
  });

  it("transit + hangar on → transit and hangar-bucket cases", () => {
    const toggles: LayerToggles = { ...ALL_OFF, transit: true, hangar: true };
    const result = filterCasesByLayerToggles(toggles, FULL_FLEET);
    // transit: transit_out, transit_in (2) + hangar: hangar, assembled, received, archived (4) = 6
    expect(result).toHaveLength(6);
  });

  it("all-but-one toggle on → excludes that one category's statuses", () => {
    const toggles: LayerToggles = { ...ALL_ON, transit: false };
    const result = filterCasesByLayerToggles(toggles, FULL_FLEET);
    // Excludes transit_out and transit_in → 8 - 2 = 6
    expect(result).toHaveLength(6);
    for (const c of result) {
      expect(c.status).not.toBe("transit_out");
      expect(c.status).not.toBe("transit_in");
    }
  });
});

// ─── 5. Fast-path behaviour ───────────────────────────────────────────────────

describe("filterCasesByLayerToggles — fast paths", () => {
  it("returns a new array (not the same reference) even in the all-visible fast path", () => {
    const result = filterCasesByLayerToggles(ALL_ON, FULL_FLEET);
    expect(result).not.toBe(FULL_FLEET);
  });

  it("returns [] (not the original array) in the all-hidden fast path", () => {
    const result = filterCasesByLayerToggles(ALL_OFF, FULL_FLEET);
    expect(result).toEqual([]);
    expect(result).not.toBe(FULL_FLEET);
  });

  it("all-visible result has the same contents as the input in the same order", () => {
    const cases = [makeCase("deployed"), makeCase("flagged"), makeCase("hangar")];
    const result = filterCasesByLayerToggles(ALL_ON, cases);
    expect(result.map((c) => c.status)).toEqual(["deployed", "flagged", "hangar"]);
  });
});

// ─── 6. Array immutability ────────────────────────────────────────────────────

describe("filterCasesByLayerToggles — input array immutability", () => {
  it("does not mutate the original cases array", () => {
    const cases = [makeCase("deployed"), makeCase("flagged"), makeCase("hangar")];
    const original = [...cases];
    filterCasesByLayerToggles({ ...ALL_OFF, deployed: true }, cases);
    expect(cases).toEqual(original);
  });

  it("does not mutate the original array even in the all-visible fast path", () => {
    const cases = CASE_STATUSES.map((s) => makeCase(s));
    const original = [...cases];
    filterCasesByLayerToggles(ALL_ON, cases);
    expect(cases).toEqual(original);
  });
});

// ─── 7. Generic typing ────────────────────────────────────────────────────────

describe("filterCasesByLayerToggles — generic T extends { status }", () => {
  it("works with extended case-pin objects (extra fields preserved)", () => {
    const casePins = [
      { caseId: "c1", status: "deployed" as CaseStatus, lat: 40.0, lng: -75.0, updatedAt: 1_000 },
      { caseId: "c2", status: "hangar"   as CaseStatus, lat: 41.0, lng: -76.0, updatedAt: 2_000 },
    ];
    const result = filterCasesByLayerToggles(
      { ...ALL_OFF, deployed: true },
      casePins
    );
    expect(result).toHaveLength(1);
    expect(result[0].caseId).toBe("c1");
    expect(result[0].lat).toBe(40.0); // extra fields preserved
  });

  it("works with string status (not narrowly typed as CaseStatus)", () => {
    const cases: Array<{ status: string; name: string }> = [
      { status: "deployed",    name: "A" },
      { status: "transit_out", name: "B" },
      { status: "hangar",      name: "C" },
    ];
    const result = filterCasesByLayerToggles(
      { ...ALL_OFF, transit: true },
      cases
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("B");
  });
});

// ─── 8. getToggleKeyForStatus ─────────────────────────────────────────────────

describe("getToggleKeyForStatus", () => {
  it("deployed → 'deployed'", () => {
    expect(getToggleKeyForStatus("deployed")).toBe("deployed");
  });

  it("transit_out → 'transit'", () => {
    expect(getToggleKeyForStatus("transit_out")).toBe("transit");
  });

  it("transit_in → 'transit'", () => {
    expect(getToggleKeyForStatus("transit_in")).toBe("transit");
  });

  it("flagged → 'flagged'", () => {
    expect(getToggleKeyForStatus("flagged")).toBe("flagged");
  });

  it("hangar → 'hangar'", () => {
    expect(getToggleKeyForStatus("hangar")).toBe("hangar");
  });

  it("assembled → 'hangar'", () => {
    expect(getToggleKeyForStatus("assembled")).toBe("hangar");
  });

  it("received → 'hangar'", () => {
    expect(getToggleKeyForStatus("received")).toBe("hangar");
  });

  it("archived → 'hangar'", () => {
    expect(getToggleKeyForStatus("archived")).toBe("hangar");
  });

  it("returns null for an unknown status string", () => {
    expect(getToggleKeyForStatus("unknown_status")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getToggleKeyForStatus("")).toBeNull();
  });

  it("covers all CASE_STATUSES (none returns null)", () => {
    for (const status of CASE_STATUSES) {
      expect(getToggleKeyForStatus(status)).not.toBeNull();
    }
  });
});

// ─── 9. isCaseVisibleUnderToggles ─────────────────────────────────────────────

describe("isCaseVisibleUnderToggles", () => {
  it("returns true for 'deployed' when deployed toggle is on", () => {
    expect(isCaseVisibleUnderToggles("deployed", ALL_ON)).toBe(true);
  });

  it("returns false for 'deployed' when deployed toggle is off", () => {
    expect(isCaseVisibleUnderToggles("deployed", { ...ALL_ON, deployed: false })).toBe(false);
  });

  it("returns true for 'transit_out' when transit toggle is on", () => {
    expect(isCaseVisibleUnderToggles("transit_out", ALL_ON)).toBe(true);
  });

  it("returns false for 'transit_out' when transit toggle is off", () => {
    expect(isCaseVisibleUnderToggles("transit_out", { ...ALL_ON, transit: false })).toBe(false);
  });

  it("returns true for 'transit_in' when transit toggle is on", () => {
    expect(isCaseVisibleUnderToggles("transit_in", ALL_ON)).toBe(true);
  });

  it("returns false for 'transit_in' when transit toggle is off", () => {
    expect(isCaseVisibleUnderToggles("transit_in", { ...ALL_ON, transit: false })).toBe(false);
  });

  it("returns true for 'flagged' when flagged toggle is on", () => {
    expect(isCaseVisibleUnderToggles("flagged", ALL_ON)).toBe(true);
  });

  it("returns false for 'flagged' when flagged toggle is off", () => {
    expect(isCaseVisibleUnderToggles("flagged", { ...ALL_ON, flagged: false })).toBe(false);
  });

  it("returns true for 'assembled' when hangar toggle is on", () => {
    expect(isCaseVisibleUnderToggles("assembled", ALL_ON)).toBe(true);
  });

  it("returns false for 'assembled' when hangar toggle is off", () => {
    expect(isCaseVisibleUnderToggles("assembled", { ...ALL_ON, hangar: false })).toBe(false);
  });

  it("returns false for unknown status regardless of toggle state", () => {
    expect(isCaseVisibleUnderToggles("ghost_status", ALL_ON)).toBe(false);
    expect(isCaseVisibleUnderToggles("ghost_status", ALL_OFF)).toBe(false);
  });

  it("ALL_OFF → all statuses are invisible", () => {
    for (const status of CASE_STATUSES) {
      expect(isCaseVisibleUnderToggles(status, ALL_OFF)).toBe(false);
    }
  });

  it("ALL_ON → all statuses are visible", () => {
    for (const status of CASE_STATUSES) {
      expect(isCaseVisibleUnderToggles(status, ALL_ON)).toBe(true);
    }
  });
});

// ─── 10. Edge cases ───────────────────────────────────────────────────────────

describe("filterCasesByLayerToggles — edge cases", () => {
  it("returns empty array for empty input regardless of toggles", () => {
    expect(filterCasesByLayerToggles(ALL_ON, [])).toEqual([]);
    expect(filterCasesByLayerToggles(ALL_OFF, [])).toEqual([]);
    expect(filterCasesByLayerToggles(DEFAULT_LAYER_TOGGLES, [])).toEqual([]);
  });

  it("returns single-element array when that case's status is visible", () => {
    const result = filterCasesByLayerToggles(
      { ...ALL_OFF, flagged: true },
      [makeCase("flagged")]
    );
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("flagged");
  });

  it("returns empty array when the single element's status is hidden", () => {
    const result = filterCasesByLayerToggles(
      { ...ALL_OFF, deployed: true },
      [makeCase("flagged")]
    );
    expect(result).toEqual([]);
  });

  it("multiple cases with the same status are all included when toggle is on", () => {
    const cases = [
      makeCase("deployed", "d1"),
      makeCase("deployed", "d2"),
      makeCase("deployed", "d3"),
    ];
    const result = filterCasesByLayerToggles({ ...ALL_OFF, deployed: true }, cases);
    expect(result).toHaveLength(3);
  });

  it("preserves the relative order of cases after filtering", () => {
    const cases = [
      makeCase("deployed", "first"),
      makeCase("flagged",  "second"),
      makeCase("deployed", "third"),
    ];
    const result = filterCasesByLayerToggles(
      { ...ALL_OFF, deployed: true },
      cases
    );
    expect(result.map((c) => c.id)).toEqual(["first", "third"]);
  });

  it("handles a large fleet (1000 cases) without error", () => {
    const allStatuses = CASE_STATUSES;
    const largeCases = Array.from({ length: 1000 }, (_, i) => ({
      status: allStatuses[i % allStatuses.length] as CaseStatus,
      id: `case-${i}`,
    }));
    const result = filterCasesByLayerToggles({ ...ALL_OFF, deployed: true }, largeCases);
    // ~125 cases per status (1000/8), deployed bucket has 1 status
    expect(result.length).toBeGreaterThan(0);
    for (const c of result) {
      expect(c.status).toBe("deployed");
    }
  });
});
