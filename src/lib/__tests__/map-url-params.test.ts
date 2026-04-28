/**
 * Unit tests for map URL parameter utilities.
 *
 * Run with: npx vitest run  (or jest if configured)
 */

import { describe, it, expect } from "vitest";
import {
  parseView,
  serializeView,
  parseId,
  serializeId,
  parseWindow,
  serializeWindow,
  parsePanelOpen,
  serializePanelOpen,
  parseLayers,
  serializeLayers,
  parseAt,
  serializeAt,
  decodeMapUrlState,
  encodeMapUrlState,
  mergeMapUrlState,
  diffMapUrlState,
  validateMapUrlState,
  isValidMapUrlState,
  PARAM,
} from "../map-url-params";
import { MAP_URL_STATE_DEFAULTS, type MapUrlState } from "@/types/map";

// ─── parseView ────────────────────────────────────────────────────────────────

describe("parseView", () => {
  it("returns default for null", () => {
    expect(parseView(null)).toBe("M1");
  });

  it("returns default for undefined", () => {
    expect(parseView(undefined)).toBe("M1");
  });

  it("returns default for empty string", () => {
    expect(parseView("")).toBe("M1");
  });

  it("parses valid uppercase views", () => {
    expect(parseView("M1")).toBe("M1");
    expect(parseView("M2")).toBe("M2");
    expect(parseView("M3")).toBe("M3");
    expect(parseView("M4")).toBe("M4");
    expect(parseView("M5")).toBe("M5");
  });

  it("normalises lowercase to uppercase", () => {
    expect(parseView("m1")).toBe("M1");
    expect(parseView("m5")).toBe("M5");
  });

  it("returns default for invalid values", () => {
    expect(parseView("M6")).toBe("M1");
    expect(parseView("X1")).toBe("M1");
    expect(parseView("  ")).toBe("M1");
  });
});

// ─── serializeView ────────────────────────────────────────────────────────────

describe("serializeView", () => {
  it("returns undefined for default view", () => {
    expect(serializeView("M1")).toBeUndefined();
  });

  it("returns the value for non-default views", () => {
    expect(serializeView("M2")).toBe("M2");
    expect(serializeView("M5")).toBe("M5");
  });
});

// ─── parseId ─────────────────────────────────────────────────────────────────

describe("parseId", () => {
  it("returns null for null", () => {
    expect(parseId(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseId("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseId("   ")).toBeNull();
  });

  it("returns the trimmed ID for valid strings", () => {
    expect(parseId("abc123")).toBe("abc123");
    expect(parseId("  jx7abc000  ")).toBe("jx7abc000");
  });
});

// ─── serializeId ─────────────────────────────────────────────────────────────

describe("serializeId", () => {
  it("returns undefined for null", () => {
    expect(serializeId(null)).toBeUndefined();
  });

  it("returns the string for non-null IDs", () => {
    expect(serializeId("abc123")).toBe("abc123");
  });
});

// ─── parseWindow ─────────────────────────────────────────────────────────────

describe("parseWindow", () => {
  it("returns default for null", () => {
    expect(parseWindow(null)).toBe("T1");
  });

  it("parses valid window values", () => {
    expect(parseWindow("T1")).toBe("T1");
    expect(parseWindow("T2")).toBe("T2");
    expect(parseWindow("T3")).toBe("T3");
    expect(parseWindow("T4")).toBe("T4");
    expect(parseWindow("T5")).toBe("T5");
  });

  it("normalises lowercase", () => {
    expect(parseWindow("t3")).toBe("T3");
  });

  it("returns default for invalid values", () => {
    expect(parseWindow("T6")).toBe("T1");
    expect(parseWindow("S1")).toBe("T1");
  });
});

// ─── serializeWindow ─────────────────────────────────────────────────────────

describe("serializeWindow", () => {
  it("returns undefined for default window", () => {
    expect(serializeWindow("T1")).toBeUndefined();
  });

  it("returns value for non-default windows", () => {
    expect(serializeWindow("T2")).toBe("T2");
    expect(serializeWindow("T5")).toBe("T5");
  });
});

// ─── parsePanelOpen ───────────────────────────────────────────────────────────

describe("parsePanelOpen", () => {
  it("returns false (default) for null", () => {
    expect(parsePanelOpen(null)).toBe(false);
  });

  it("returns false (default) for undefined", () => {
    expect(parsePanelOpen(undefined)).toBe(false);
  });

  it("returns false (default) for empty string", () => {
    expect(parsePanelOpen("")).toBe(false);
  });

  it("returns true for '1'", () => {
    expect(parsePanelOpen("1")).toBe(true);
  });

  it("returns true for 'true'", () => {
    expect(parsePanelOpen("true")).toBe(true);
  });

  it("is case-insensitive for 'true'", () => {
    expect(parsePanelOpen("TRUE")).toBe(true);
    expect(parsePanelOpen("True")).toBe(true);
  });

  it("returns false for '0'", () => {
    expect(parsePanelOpen("0")).toBe(false);
  });

  it("returns false for 'false'", () => {
    expect(parsePanelOpen("false")).toBe(false);
  });

  it("returns false for arbitrary strings", () => {
    expect(parsePanelOpen("yes")).toBe(false);
    expect(parsePanelOpen("open")).toBe(false);
  });
});

// ─── serializePanelOpen ───────────────────────────────────────────────────────

describe("serializePanelOpen", () => {
  it("returns undefined for false (default — omit from URL)", () => {
    expect(serializePanelOpen(false)).toBeUndefined();
  });

  it("returns '1' for true", () => {
    expect(serializePanelOpen(true)).toBe("1");
  });
});

// ─── parseLayers ─────────────────────────────────────────────────────────────

describe("parseLayers", () => {
  it("returns defaults for null", () => {
    expect(parseLayers(null)).toEqual(MAP_URL_STATE_DEFAULTS.layers);
  });

  it("returns defaults for empty string", () => {
    expect(parseLayers("")).toEqual(MAP_URL_STATE_DEFAULTS.layers);
  });

  it("parses a valid comma-separated list", () => {
    expect(parseLayers("cases,transit")).toEqual(["cases", "transit"]);
  });

  it("ignores unknown layer IDs", () => {
    expect(parseLayers("cases,unknown,transit")).toEqual(["cases", "transit"]);
  });

  it("de-duplicates layer IDs", () => {
    expect(parseLayers("cases,cases,transit")).toEqual(["cases", "transit"]);
  });

  it("handles extra spaces around tokens", () => {
    expect(parseLayers(" cases , transit ")).toEqual(["cases", "transit"]);
  });

  it("returns defaults when all tokens are invalid", () => {
    expect(parseLayers("bad,worse")).toEqual(MAP_URL_STATE_DEFAULTS.layers);
  });

  it("parses single layer", () => {
    expect(parseLayers("satellite")).toEqual(["satellite"]);
  });
});

// ─── serializeLayers ─────────────────────────────────────────────────────────

describe("serializeLayers", () => {
  it("returns undefined when layers equal defaults (order-insensitive)", () => {
    expect(
      serializeLayers([...MAP_URL_STATE_DEFAULTS.layers])
    ).toBeUndefined();
    // Different order should also return undefined
    expect(
      serializeLayers([...MAP_URL_STATE_DEFAULTS.layers].reverse())
    ).toBeUndefined();
  });

  it("returns comma-separated string for non-default layers", () => {
    const result = serializeLayers(["satellite", "terrain"]);
    expect(result).toBe("satellite,terrain");
  });

  it("preserves caller-specified order in the serialised string", () => {
    expect(serializeLayers(["transit", "cases"])).toBe("transit,cases");
  });
});

// ─── parseAt ─────────────────────────────────────────────────────────────────

describe("parseAt", () => {
  it("returns null for null", () => {
    expect(parseAt(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAt("")).toBeNull();
  });

  it("parses a valid ISO-8601 UTC timestamp", () => {
    const result = parseAt("2025-06-01T14:30:00.000Z");
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe("2025-06-01T14:30:00.000Z");
  });

  it("parses a valid ISO-8601 timestamp with timezone offset", () => {
    const result = parseAt("2025-06-01T14:30:00+05:30");
    expect(result).toBeInstanceOf(Date);
    expect(result).not.toBeNull();
  });

  it("returns null for non-ISO strings", () => {
    expect(parseAt("not-a-date")).toBeNull();
    expect(parseAt("2025-06-01")).toBeNull(); // date-only, not full ISO-8601
    expect(parseAt("June 1, 2025")).toBeNull();
  });

  it("returns null for malformed ISO strings that produce invalid Date", () => {
    // Note: some strings pass the regex but fail Date parsing
    expect(parseAt("2025-99-99T99:99:99.000Z")).toBeNull();
  });
});

// ─── serializeAt ─────────────────────────────────────────────────────────────

describe("serializeAt", () => {
  it("returns undefined for null", () => {
    expect(serializeAt(null)).toBeUndefined();
  });

  it("returns ISO string for a Date", () => {
    const d = new Date("2025-06-01T14:30:00.000Z");
    expect(serializeAt(d)).toBe("2025-06-01T14:30:00.000Z");
  });
});

// ─── decodeMapUrlState ────────────────────────────────────────────────────────

describe("decodeMapUrlState", () => {
  function makeParams(entries: Record<string, string>) {
    return {
      get(key: string): string | null {
        return entries[key] ?? null;
      },
    };
  }

  it("returns defaults for empty params", () => {
    const state = decodeMapUrlState(makeParams({}));
    expect(state).toEqual(MAP_URL_STATE_DEFAULTS);
  });

  it("decodes a full valid state", () => {
    const state = decodeMapUrlState(
      makeParams({
        [PARAM.VIEW]: "M3",
        [PARAM.CASE]: "abc123",
        [PARAM.WINDOW]: "T2",
        [PARAM.PANEL]: "1",
        [PARAM.LAYERS]: "satellite,terrain",
        [PARAM.ORG]: "org999",
        [PARAM.KIT]: "kit456",
        [PARAM.AT]: "2025-06-01T12:00:00.000Z",
      })
    );

    expect(state.view).toBe("M3");
    expect(state.case).toBe("abc123");
    expect(state.window).toBe("T2");
    expect(state.panelOpen).toBe(true);
    expect(state.layers).toEqual(["satellite", "terrain"]);
    expect(state.org).toBe("org999");
    expect(state.kit).toBe("kit456");
    expect(state.at?.toISOString()).toBe("2025-06-01T12:00:00.000Z");
  });

  it("decodes panelOpen=true when panel=1", () => {
    const state = decodeMapUrlState(makeParams({ [PARAM.PANEL]: "1" }));
    expect(state.panelOpen).toBe(true);
  });

  it("decodes panelOpen=false when panel is absent", () => {
    const state = decodeMapUrlState(makeParams({}));
    expect(state.panelOpen).toBe(false);
  });

  it("falls back to defaults for invalid param values", () => {
    const state = decodeMapUrlState(
      makeParams({
        [PARAM.VIEW]: "BOGUS",
        [PARAM.WINDOW]: "Z9",
        [PARAM.AT]: "not-a-date",
      })
    );

    expect(state.view).toBe("M1");
    expect(state.window).toBe("T1");
    expect(state.at).toBeNull();
  });
});

// ─── encodeMapUrlState ────────────────────────────────────────────────────────

describe("encodeMapUrlState", () => {
  it("produces an empty URLSearchParams for default state", () => {
    const params = encodeMapUrlState(MAP_URL_STATE_DEFAULTS);
    expect(params.toString()).toBe("");
  });

  it("encodes only non-default values", () => {
    const params = encodeMapUrlState({ view: "M2" });
    expect(params.get(PARAM.VIEW)).toBe("M2");
    expect(params.get(PARAM.CASE)).toBeNull();
    expect(params.get(PARAM.WINDOW)).toBeNull();
  });

  it("encodes all fields when they differ from defaults", () => {
    const state: Partial<MapUrlState> = {
      view: "M3",
      case: "caseXYZ",
      window: "T4",
      panelOpen: true,
      layers: ["heat"],
      org: "orgABC",
      kit: "kitDEF",
      at: new Date("2025-07-01T09:00:00.000Z"),
    };

    const params = encodeMapUrlState(state);
    expect(params.get(PARAM.VIEW)).toBe("M3");
    expect(params.get(PARAM.CASE)).toBe("caseXYZ");
    expect(params.get(PARAM.WINDOW)).toBe("T4");
    expect(params.get(PARAM.PANEL)).toBe("1");
    expect(params.get(PARAM.LAYERS)).toBe("heat");
    expect(params.get(PARAM.ORG)).toBe("orgABC");
    expect(params.get(PARAM.KIT)).toBe("kitDEF");
    expect(params.get(PARAM.AT)).toBe("2025-07-01T09:00:00.000Z");
  });

  it("omits panel param when panelOpen is false (default)", () => {
    const params = encodeMapUrlState({ panelOpen: false });
    expect(params.get(PARAM.PANEL)).toBeNull();
  });

  it("includes panel=1 when panelOpen is true", () => {
    const params = encodeMapUrlState({ panelOpen: true });
    expect(params.get(PARAM.PANEL)).toBe("1");
  });
});

// ─── mergeMapUrlState ─────────────────────────────────────────────────────────

describe("mergeMapUrlState", () => {
  it("merges a patch into existing state", () => {
    const current: MapUrlState = {
      ...MAP_URL_STATE_DEFAULTS,
      view: "M2",
      case: "case1",
    };

    const params = mergeMapUrlState(current, { view: "M3" });
    expect(params.get(PARAM.VIEW)).toBe("M3");
    expect(params.get(PARAM.CASE)).toBe("case1");
  });

  it("setting case to null removes it from params", () => {
    const current: MapUrlState = {
      ...MAP_URL_STATE_DEFAULTS,
      case: "case1",
    };

    const params = mergeMapUrlState(current, { case: null });
    expect(params.get(PARAM.CASE)).toBeNull();
  });

  it("setting panelOpen to true adds panel=1 to params", () => {
    const params = mergeMapUrlState(MAP_URL_STATE_DEFAULTS, { panelOpen: true });
    expect(params.get(PARAM.PANEL)).toBe("1");
  });

  it("setting panelOpen to false (default) omits panel from params", () => {
    const current: MapUrlState = { ...MAP_URL_STATE_DEFAULTS, panelOpen: true };
    const params = mergeMapUrlState(current, { panelOpen: false });
    expect(params.get(PARAM.PANEL)).toBeNull();
  });
});

// ─── diffMapUrlState ─────────────────────────────────────────────────────────

describe("diffMapUrlState", () => {
  it("returns empty object when states are identical", () => {
    const diff = diffMapUrlState(
      MAP_URL_STATE_DEFAULTS,
      MAP_URL_STATE_DEFAULTS
    );
    expect(diff).toEqual({});
  });

  it("returns only changed fields", () => {
    const next: MapUrlState = { ...MAP_URL_STATE_DEFAULTS, view: "M4" };
    const diff = diffMapUrlState(MAP_URL_STATE_DEFAULTS, next);
    expect(diff).toEqual({ view: "M4" });
  });

  it("detects panelOpen changes", () => {
    const next: MapUrlState = { ...MAP_URL_STATE_DEFAULTS, panelOpen: true };
    const diff = diffMapUrlState(MAP_URL_STATE_DEFAULTS, next);
    expect(diff.panelOpen).toBe(true);
  });

  it("detects layer changes regardless of order", () => {
    const prev: MapUrlState = {
      ...MAP_URL_STATE_DEFAULTS,
      layers: ["cases", "labels"],
    };
    const next: MapUrlState = {
      ...MAP_URL_STATE_DEFAULTS,
      layers: ["satellite"],
    };
    const diff = diffMapUrlState(prev, next);
    expect(diff.layers).toEqual(["satellite"]);
  });

  it("detects at timestamp changes", () => {
    const d = new Date("2025-01-01T00:00:00.000Z");
    const next: MapUrlState = { ...MAP_URL_STATE_DEFAULTS, at: d };
    const diff = diffMapUrlState(MAP_URL_STATE_DEFAULTS, next);
    expect(diff.at).toEqual(d);
  });
});

// ─── validateMapUrlState / isValidMapUrlState ─────────────────────────────────

describe("validateMapUrlState", () => {
  it("returns empty array for a fully valid state", () => {
    expect(validateMapUrlState(MAP_URL_STATE_DEFAULTS)).toEqual([]);
  });

  it("reports invalid view", () => {
    const state = { ...MAP_URL_STATE_DEFAULTS, view: "X1" as never };
    const errors = validateMapUrlState(state);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/view/i);
  });

  it("reports invalid window", () => {
    const state = { ...MAP_URL_STATE_DEFAULTS, window: "T9" as never };
    const errors = validateMapUrlState(state);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/window/i);
  });

  it("reports invalid layer IDs", () => {
    const state = {
      ...MAP_URL_STATE_DEFAULTS,
      layers: ["cases", "bogus-layer"] as never,
    };
    const errors = validateMapUrlState(state);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/layer/i);
  });

  it("reports invalid panelOpen (non-boolean)", () => {
    const state = { ...MAP_URL_STATE_DEFAULTS, panelOpen: "yes" as never };
    const errors = validateMapUrlState(state);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.toLowerCase().includes("panelopen"))).toBe(true);
  });

  it("does not report errors for valid panelOpen values", () => {
    expect(validateMapUrlState({ ...MAP_URL_STATE_DEFAULTS, panelOpen: true })).toEqual([]);
    expect(validateMapUrlState({ ...MAP_URL_STATE_DEFAULTS, panelOpen: false })).toEqual([]);
  });
});

describe("isValidMapUrlState", () => {
  it("returns true for valid state", () => {
    expect(isValidMapUrlState(MAP_URL_STATE_DEFAULTS)).toBe(true);
  });

  it("returns false for invalid state", () => {
    const state = { ...MAP_URL_STATE_DEFAULTS, view: "BAD" as never };
    expect(isValidMapUrlState(state)).toBe(false);
  });
});

// ─── Round-trip fidelity ──────────────────────────────────────────────────────

describe("round-trip encode → decode", () => {
  it("preserves all non-default fields through a round trip", () => {
    const original: MapUrlState = {
      view: "M4",
      case: "caseABC",
      window: "T3",
      panelOpen: true,
      layers: ["heat", "labels"],
      org: "org111",
      kit: "kit222",
      at: new Date("2025-08-15T10:00:00.000Z"),
    };

    const params = encodeMapUrlState(original);
    const decoded = decodeMapUrlState(params);

    expect(decoded.view).toBe(original.view);
    expect(decoded.case).toBe(original.case);
    expect(decoded.window).toBe(original.window);
    expect(decoded.panelOpen).toBe(original.panelOpen);
    expect(decoded.layers).toEqual(original.layers);
    expect(decoded.org).toBe(original.org);
    expect(decoded.kit).toBe(original.kit);
    expect(decoded.at?.toISOString()).toBe(original.at?.toISOString());
  });

  it("preserves defaults through a round trip", () => {
    const params = encodeMapUrlState(MAP_URL_STATE_DEFAULTS);
    const decoded = decodeMapUrlState(params);
    expect(decoded).toEqual(MAP_URL_STATE_DEFAULTS);
  });
});
