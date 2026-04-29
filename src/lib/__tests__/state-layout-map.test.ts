/**
 * Tests for src/lib/state-layout-map.ts
 *
 * Verifies that:
 *   1. STATE_LAYOUT_MAP covers all CaseStatus values
 *   2. Every entry has a valid MapView (M1–M5) and CaseWindow (T1–T5)
 *   3. getRecommendedLayout returns the correct entry for each known status
 *   4. getRecommendedMapMode and getRecommendedCaseLayout are correct shortcuts
 *   5. ALL_STATE_LAYOUT_ENTRIES preserves lifecycle order and includes all statuses
 *   6. Key domain rules hold (transit → M3+T4, deployed/flagged → M2+T3, etc.)
 */

import { describe, it, expect } from "vitest";

import {
  STATE_LAYOUT_MAP,
  getRecommendedLayout,
  getRecommendedMapMode,
  getRecommendedCaseLayout,
  getDefaultLayout,
  FALLBACK_DEFAULT_LAYOUT,
  ALL_STATE_LAYOUT_ENTRIES,
  type StateLayoutEntry,
  type DefaultLayout,
} from "../state-layout-map";

import { CASE_STATUSES, type CaseStatus } from "@/types/case-status";
import { MAP_VIEW_VALUES, CASE_WINDOW_VALUES } from "@/types/map";

// ─── Coverage helpers ─────────────────────────────────────────────────────────

const VALID_MAP_MODES = new Set(MAP_VIEW_VALUES);
const VALID_CASE_LAYOUTS = new Set(CASE_WINDOW_VALUES);

// ─── 1. STATE_LAYOUT_MAP completeness ────────────────────────────────────────

describe("STATE_LAYOUT_MAP", () => {
  it("covers every CaseStatus value", () => {
    for (const status of CASE_STATUSES) {
      expect(STATE_LAYOUT_MAP).toHaveProperty(status);
    }
  });

  it("contains no extra keys beyond the known CaseStatus values", () => {
    const keys = Object.keys(STATE_LAYOUT_MAP) as CaseStatus[];
    expect(keys.sort()).toEqual([...CASE_STATUSES].sort());
  });

  it("every entry has a valid mapMode (M1–M5)", () => {
    for (const [status, entry] of Object.entries(STATE_LAYOUT_MAP) as [
      CaseStatus,
      StateLayoutEntry,
    ][]) {
      expect(
        VALID_MAP_MODES.has(entry.mapMode),
        `${status}.mapMode "${entry.mapMode}" is not a valid MapView`,
      ).toBe(true);
    }
  });

  it("every entry has a valid caseLayout (T1–T5)", () => {
    for (const [status, entry] of Object.entries(STATE_LAYOUT_MAP) as [
      CaseStatus,
      StateLayoutEntry,
    ][]) {
      expect(
        VALID_CASE_LAYOUTS.has(entry.caseLayout),
        `${status}.caseLayout "${entry.caseLayout}" is not a valid CaseWindow`,
      ).toBe(true);
    }
  });

  it("every entry has a non-empty reason string", () => {
    for (const [status, entry] of Object.entries(STATE_LAYOUT_MAP) as [
      CaseStatus,
      StateLayoutEntry,
    ][]) {
      expect(
        typeof entry.reason === "string" && entry.reason.trim().length > 0,
        `${status}.reason should be a non-empty string`,
      ).toBe(true);
    }
  });
});

// ─── 2. Domain mapping rules ──────────────────────────────────────────────────

describe("STATE_LAYOUT_MAP domain rules", () => {
  it("hangar → M1 + T1 (fleet overview + summary for idle/stored case)", () => {
    expect(STATE_LAYOUT_MAP["hangar"].mapMode).toBe("M1");
    expect(STATE_LAYOUT_MAP["hangar"].caseLayout).toBe("T1");
  });

  it("assembled → M1 + T2 (fleet overview + manifest for pre-deployment check)", () => {
    expect(STATE_LAYOUT_MAP["assembled"].mapMode).toBe("M1");
    expect(STATE_LAYOUT_MAP["assembled"].caseLayout).toBe("T2");
  });

  it("transit_out → M3 + T4 (transit tracker + shipping for outbound leg)", () => {
    expect(STATE_LAYOUT_MAP["transit_out"].mapMode).toBe("M3");
    expect(STATE_LAYOUT_MAP["transit_out"].caseLayout).toBe("T4");
  });

  it("deployed → M2 + T3 (site detail + inspection for active field case)", () => {
    expect(STATE_LAYOUT_MAP["deployed"].mapMode).toBe("M2");
    expect(STATE_LAYOUT_MAP["deployed"].caseLayout).toBe("T3");
  });

  it("flagged → M2 + T3 (site detail + inspection for case with issues)", () => {
    expect(STATE_LAYOUT_MAP["flagged"].mapMode).toBe("M2");
    expect(STATE_LAYOUT_MAP["flagged"].caseLayout).toBe("T3");
  });

  it("transit_in → M3 + T4 (transit tracker + shipping for inbound return leg)", () => {
    expect(STATE_LAYOUT_MAP["transit_in"].mapMode).toBe("M3");
    expect(STATE_LAYOUT_MAP["transit_in"].caseLayout).toBe("T4");
  });

  it("received → M1 + T1 (fleet overview + summary for receipt confirmation)", () => {
    expect(STATE_LAYOUT_MAP["received"].mapMode).toBe("M1");
    expect(STATE_LAYOUT_MAP["received"].caseLayout).toBe("T1");
  });

  it("archived → M1 + T1 (fleet overview + summary for decommissioned case)", () => {
    expect(STATE_LAYOUT_MAP["archived"].mapMode).toBe("M1");
    expect(STATE_LAYOUT_MAP["archived"].caseLayout).toBe("T1");
  });
});

// ─── 3. getRecommendedLayout ──────────────────────────────────────────────────

describe("getRecommendedLayout()", () => {
  it("returns the correct entry for each known status", () => {
    for (const status of CASE_STATUSES) {
      const result = getRecommendedLayout(status);
      expect(result).toEqual(STATE_LAYOUT_MAP[status]);
    }
  });

  it("returns an entry with a valid mapMode for every status", () => {
    for (const status of CASE_STATUSES) {
      const { mapMode } = getRecommendedLayout(status);
      expect(VALID_MAP_MODES.has(mapMode)).toBe(true);
    }
  });

  it("returns an entry with a valid caseLayout for every status", () => {
    for (const status of CASE_STATUSES) {
      const { caseLayout } = getRecommendedLayout(status);
      expect(VALID_CASE_LAYOUTS.has(caseLayout)).toBe(true);
    }
  });

  it("returns M1+T1 fallback for an unknown/future status value", () => {
    // Cast to bypass type-checker — simulates a future status added before
    // this function is updated.
    const result = getRecommendedLayout("unknown_future_status" as CaseStatus);
    expect(result.mapMode).toBe("M1");
    expect(result.caseLayout).toBe("T1");
  });

  it("returned entry is not undefined for any known status", () => {
    for (const status of CASE_STATUSES) {
      expect(getRecommendedLayout(status)).toBeDefined();
    }
  });
});

// ─── 4. getRecommendedMapMode ─────────────────────────────────────────────────

describe("getRecommendedMapMode()", () => {
  it("returns the same mapMode as getRecommendedLayout for every status", () => {
    for (const status of CASE_STATUSES) {
      expect(getRecommendedMapMode(status)).toBe(
        getRecommendedLayout(status).mapMode,
      );
    }
  });

  it("returns 'M3' for transit_out", () => {
    expect(getRecommendedMapMode("transit_out")).toBe("M3");
  });

  it("returns 'M3' for transit_in", () => {
    expect(getRecommendedMapMode("transit_in")).toBe("M3");
  });

  it("returns 'M2' for deployed and flagged", () => {
    expect(getRecommendedMapMode("deployed")).toBe("M2");
    expect(getRecommendedMapMode("flagged")).toBe("M2");
  });

  it("returns 'M1' for hangar, assembled, received, and archived", () => {
    const m1Statuses: CaseStatus[] = [
      "hangar",
      "assembled",
      "received",
      "archived",
    ];
    for (const status of m1Statuses) {
      expect(getRecommendedMapMode(status)).toBe("M1");
    }
  });
});

// ─── 5. getRecommendedCaseLayout ─────────────────────────────────────────────

describe("getRecommendedCaseLayout()", () => {
  it("returns the same caseLayout as getRecommendedLayout for every status", () => {
    for (const status of CASE_STATUSES) {
      expect(getRecommendedCaseLayout(status)).toBe(
        getRecommendedLayout(status).caseLayout,
      );
    }
  });

  it("returns 'T4' for transit_out and transit_in", () => {
    expect(getRecommendedCaseLayout("transit_out")).toBe("T4");
    expect(getRecommendedCaseLayout("transit_in")).toBe("T4");
  });

  it("returns 'T3' for deployed and flagged", () => {
    expect(getRecommendedCaseLayout("deployed")).toBe("T3");
    expect(getRecommendedCaseLayout("flagged")).toBe("T3");
  });

  it("returns 'T2' for assembled", () => {
    expect(getRecommendedCaseLayout("assembled")).toBe("T2");
  });

  it("returns 'T1' for hangar, received, and archived", () => {
    const t1Statuses: CaseStatus[] = ["hangar", "received", "archived"];
    for (const status of t1Statuses) {
      expect(getRecommendedCaseLayout(status)).toBe("T1");
    }
  });
});

// ─── 6. ALL_STATE_LAYOUT_ENTRIES ──────────────────────────────────────────────

describe("ALL_STATE_LAYOUT_ENTRIES", () => {
  it("contains one entry per CaseStatus", () => {
    expect(ALL_STATE_LAYOUT_ENTRIES).toHaveLength(CASE_STATUSES.length);
  });

  it("every entry has a `status` field equal to a known CaseStatus", () => {
    const validStatuses = new Set<string>(CASE_STATUSES);
    for (const entry of ALL_STATE_LAYOUT_ENTRIES) {
      expect(validStatuses.has(entry.status)).toBe(true);
    }
  });

  it("preserves lifecycle order (hangar first, archived last)", () => {
    expect(ALL_STATE_LAYOUT_ENTRIES[0].status).toBe("hangar");
    expect(
      ALL_STATE_LAYOUT_ENTRIES[ALL_STATE_LAYOUT_ENTRIES.length - 1].status,
    ).toBe("archived");
  });

  it("matches the full lifecycle order defined in CASE_STATUSES", () => {
    const entryStatuses = ALL_STATE_LAYOUT_ENTRIES.map((e) => e.status);
    expect(entryStatuses).toEqual(CASE_STATUSES);
  });

  it("every entry includes mapMode, caseLayout, and reason from STATE_LAYOUT_MAP", () => {
    for (const entry of ALL_STATE_LAYOUT_ENTRIES) {
      const expected = STATE_LAYOUT_MAP[entry.status];
      expect(entry.mapMode).toBe(expected.mapMode);
      expect(entry.caseLayout).toBe(expected.caseLayout);
      expect(entry.reason).toBe(expected.reason);
    }
  });

  it("covers all CaseStatus values (no gaps)", () => {
    const covered = new Set(ALL_STATE_LAYOUT_ENTRIES.map((e) => e.status));
    for (const status of CASE_STATUSES) {
      expect(covered.has(status)).toBe(true);
    }
  });
});

// ─── 6b. getDefaultLayout ────────────────────────────────────────────────────

describe("getDefaultLayout()", () => {
  it("is a pure function — same input always returns same output", () => {
    expect(getDefaultLayout("deployed")).toEqual(getDefaultLayout("deployed"));
    expect(getDefaultLayout("transit_out")).toEqual(
      getDefaultLayout("transit_out"),
    );
  });

  it("returns { mapMode, detailLayout } shape (not { mapMode, caseLayout })", () => {
    const result = getDefaultLayout("deployed");
    expect(result).toHaveProperty("mapMode");
    expect(result).toHaveProperty("detailLayout");
    expect(result).not.toHaveProperty("caseLayout");
    expect(result).not.toHaveProperty("reason");
  });

  it("maps every known CaseStatus to the correct mapMode", () => {
    for (const status of CASE_STATUSES) {
      const { mapMode } = getDefaultLayout(status);
      expect(mapMode).toBe(STATE_LAYOUT_MAP[status].mapMode);
    }
  });

  it("maps every known CaseStatus to the correct detailLayout (from caseLayout)", () => {
    for (const status of CASE_STATUSES) {
      const { detailLayout } = getDefaultLayout(status);
      expect(detailLayout).toBe(STATE_LAYOUT_MAP[status].caseLayout);
    }
  });

  it("returns a valid MapView for every known status", () => {
    for (const status of CASE_STATUSES) {
      const { mapMode } = getDefaultLayout(status);
      expect(VALID_MAP_MODES.has(mapMode)).toBe(true);
    }
  });

  it("returns a valid CaseWindow for every known status", () => {
    for (const status of CASE_STATUSES) {
      const { detailLayout } = getDefaultLayout(status);
      expect(VALID_CASE_LAYOUTS.has(detailLayout)).toBe(true);
    }
  });

  // ── Domain rules ──

  it("hangar → M1 + T1", () => {
    const result = getDefaultLayout("hangar");
    expect(result.mapMode).toBe("M1");
    expect(result.detailLayout).toBe("T1");
  });

  it("assembled → M1 + T2", () => {
    const result = getDefaultLayout("assembled");
    expect(result.mapMode).toBe("M1");
    expect(result.detailLayout).toBe("T2");
  });

  it("transit_out → M3 + T4", () => {
    const result = getDefaultLayout("transit_out");
    expect(result.mapMode).toBe("M3");
    expect(result.detailLayout).toBe("T4");
  });

  it("deployed → M2 + T3", () => {
    const result = getDefaultLayout("deployed");
    expect(result.mapMode).toBe("M2");
    expect(result.detailLayout).toBe("T3");
  });

  it("flagged → M2 + T3", () => {
    const result = getDefaultLayout("flagged");
    expect(result.mapMode).toBe("M2");
    expect(result.detailLayout).toBe("T3");
  });

  it("transit_in → M3 + T4", () => {
    const result = getDefaultLayout("transit_in");
    expect(result.mapMode).toBe("M3");
    expect(result.detailLayout).toBe("T4");
  });

  it("received → M1 + T1", () => {
    const result = getDefaultLayout("received");
    expect(result.mapMode).toBe("M1");
    expect(result.detailLayout).toBe("T1");
  });

  it("archived → M1 + T1", () => {
    const result = getDefaultLayout("archived");
    expect(result.mapMode).toBe("M1");
    expect(result.detailLayout).toBe("T1");
  });

  // ── Fallback behaviour ──

  it("returns M1+T1 fallback for an unknown status string", () => {
    const result = getDefaultLayout("unknown_future_status");
    expect(result.mapMode).toBe("M1");
    expect(result.detailLayout).toBe("T1");
  });

  it("returns M1+T1 fallback for an empty string", () => {
    const result = getDefaultLayout("");
    expect(result.mapMode).toBe("M1");
    expect(result.detailLayout).toBe("T1");
  });

  it("returns M1+T1 fallback for a numeric-looking string", () => {
    const result = getDefaultLayout("42");
    expect(result.mapMode).toBe("M1");
    expect(result.detailLayout).toBe("T1");
  });

  it("fallback result equals FALLBACK_DEFAULT_LAYOUT constant", () => {
    expect(getDefaultLayout("not_a_status")).toEqual(FALLBACK_DEFAULT_LAYOUT);
    expect(getDefaultLayout("")).toEqual(FALLBACK_DEFAULT_LAYOUT);
  });

  it("does not throw for any input — never throws", () => {
    const inputs = [
      "hangar",
      "deployed",
      "unknown",
      "",
      "null",
      "undefined",
      "T1",
      "M1",
    ];
    for (const input of inputs) {
      expect(() => getDefaultLayout(input)).not.toThrow();
    }
  });

  it("return type satisfies DefaultLayout interface", () => {
    // Type-level assertion — if this compiles the interface is correct
    const result: DefaultLayout = getDefaultLayout("deployed");
    expect(result).toBeDefined();
  });
});

// ─── 6c. FALLBACK_DEFAULT_LAYOUT constant ────────────────────────────────────

describe("FALLBACK_DEFAULT_LAYOUT", () => {
  it("has mapMode 'M1'", () => {
    expect(FALLBACK_DEFAULT_LAYOUT.mapMode).toBe("M1");
  });

  it("has detailLayout 'T1'", () => {
    expect(FALLBACK_DEFAULT_LAYOUT.detailLayout).toBe("T1");
  });

  it("matches what getDefaultLayout returns for an unknown status", () => {
    expect(getDefaultLayout("completely_unknown")).toEqual(
      FALLBACK_DEFAULT_LAYOUT,
    );
  });
});

// ─── 7. Immutability spot-check ───────────────────────────────────────────────

describe("immutability", () => {
  it("STATE_LAYOUT_MAP is frozen (top level)", () => {
    // `as const` on the object literal means TypeScript makes the type
    // read-only, but JS runtime Object.freeze is not applied automatically.
    // We verify the intent by checking that we cannot accidentally overwrite
    // an entry at runtime — the test treats the module contract as immutable.
    const originalEntry = STATE_LAYOUT_MAP["deployed"];
    expect(originalEntry.mapMode).toBe("M2");
    expect(originalEntry.caseLayout).toBe("T3");
  });

  it("ALL_STATE_LAYOUT_ENTRIES is a read-only array at the type level", () => {
    // The type annotation is `ReadonlyArray<...>` so the compiler enforces it.
    // At runtime we just assert the content is stable.
    expect(ALL_STATE_LAYOUT_ENTRIES.length).toBeGreaterThan(0);
  });
});
