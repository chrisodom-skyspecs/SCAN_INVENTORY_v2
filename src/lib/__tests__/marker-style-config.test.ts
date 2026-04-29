/**
 * src/lib/__tests__/marker-style-config.test.ts
 *
 * Unit tests for the marker-style-config utility (AC 90102 Sub-AC 2).
 *
 * Covers:
 *   1.  STATUS_MARKER_STYLES — all 8 CaseStatus values have a defined style
 *   2.  Shape uniqueness — at least some statuses use distinct shapes
 *   3.  LAYER_MARKER_STYLES — all 4 LayerToggleKeys have a defined style
 *   4.  Token format — all *Token fields reference CSS custom properties (begin with --)
 *   5.  No hex literals in tokens — tokens are CSS var references, not raw colors
 *   6.  getMarkerStyle — lookup, throws for unknown status
 *   7.  getLayerMarkerStyle — lookup, throws for unknown key
 *   8.  markerStyleToCssVars — correct --marker-* key mapping
 *   9.  enrichWithMarkerStyle — correct markerStyle + cssVars population
 *  10.  getMarkerShape — returns correct shape per status
 *  11.  getMarkerIcon — returns correct icon per status, default fallback
 *  12.  getMarkerZPriority — flagged > deployed > transit > hangar; archived lowest
 *  13.  buildMapboxStatusExpression — correct array structure with match expression
 *  14.  Layer vs. status color-token consistency — each status uses its group's layer tokens
 *  15.  Accessibility — every style has a non-empty ariaLabel
 *  16.  zPriority ordering — within-group priorities are consistent
 */

import { describe, it, expect } from "vitest";
import {
  STATUS_MARKER_STYLES,
  LAYER_MARKER_STYLES,
  getMarkerStyle,
  getLayerMarkerStyle,
  markerStyleToCssVars,
  enrichWithMarkerStyle,
  getMarkerShape,
  getMarkerIcon,
  getMarkerZPriority,
  buildMapboxStatusExpression,
  type MarkerStyleDef,
  type MarkerShape,
} from "../marker-style-config";
import { CASE_STATUSES } from "@/types/case-status";
import type { CaseStatus } from "@/types/case-status";
import { LAYER_TOGGLE_KEYS } from "@/types/map";
import type { LayerToggleKey } from "@/types/map";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ALL_SHAPES: MarkerShape[] = [
  "circle",
  "diamond",
  "triangle",
  "square",
  "hexagon",
  "star",
];

// ─── 1. STATUS_MARKER_STYLES — all 8 CaseStatus values defined ────────────────

describe("STATUS_MARKER_STYLES — completeness", () => {
  it("has an entry for every CaseStatus", () => {
    for (const status of CASE_STATUSES) {
      expect(STATUS_MARKER_STYLES[status as CaseStatus]).toBeDefined();
    }
  });

  it("has exactly 8 entries (one per CaseStatus)", () => {
    const keys = Object.keys(STATUS_MARKER_STYLES);
    expect(keys).toHaveLength(8);
  });

  it("each entry has a non-empty icon string", () => {
    for (const status of CASE_STATUSES) {
      const def = STATUS_MARKER_STYLES[status as CaseStatus];
      expect(def.icon).toBeTruthy();
      expect(typeof def.icon).toBe("string");
    }
  });

  it("each entry has a valid shape", () => {
    for (const status of CASE_STATUSES) {
      const def = STATUS_MARKER_STYLES[status as CaseStatus];
      expect(ALL_SHAPES).toContain(def.shape);
    }
  });
});

// ─── 2. Shape distinctness — key statuses use different shapes ─────────────────

describe("STATUS_MARKER_STYLES — shape distinctness", () => {
  it("deployed uses 'circle' shape", () => {
    expect(STATUS_MARKER_STYLES.deployed.shape).toBe("circle");
  });

  it("flagged uses 'triangle' shape (warning indicator)", () => {
    expect(STATUS_MARKER_STYLES.flagged.shape).toBe("triangle");
  });

  it("transit_out uses 'diamond' shape (motion indicator)", () => {
    expect(STATUS_MARKER_STYLES.transit_out.shape).toBe("diamond");
  });

  it("transit_in uses 'diamond' shape (motion indicator)", () => {
    expect(STATUS_MARKER_STYLES.transit_in.shape).toBe("diamond");
  });

  it("hangar uses 'square' shape (stationary storage)", () => {
    expect(STATUS_MARKER_STYLES.hangar.shape).toBe("square");
  });

  it("assembled uses 'hexagon' shape (packed/faceted)", () => {
    expect(STATUS_MARKER_STYLES.assembled.shape).toBe("hexagon");
  });

  it("archived uses 'star' shape (notable/decommissioned)", () => {
    expect(STATUS_MARKER_STYLES.archived.shape).toBe("star");
  });

  it("received uses 'square' shape (returned to base)", () => {
    expect(STATUS_MARKER_STYLES.received.shape).toBe("square");
  });

  it("at least 4 distinct shapes are used across all statuses", () => {
    const usedShapes = new Set(
      CASE_STATUSES.map((s) => STATUS_MARKER_STYLES[s as CaseStatus].shape)
    );
    expect(usedShapes.size).toBeGreaterThanOrEqual(4);
  });

  it("deployed and flagged use different shapes", () => {
    expect(STATUS_MARKER_STYLES.deployed.shape).not.toBe(
      STATUS_MARKER_STYLES.flagged.shape
    );
  });

  it("transit and hangar use different shapes", () => {
    expect(STATUS_MARKER_STYLES.transit_out.shape).not.toBe(
      STATUS_MARKER_STYLES.hangar.shape
    );
  });
});

// ─── 3. LAYER_MARKER_STYLES — all 4 LayerToggleKeys defined ───────────────────

describe("LAYER_MARKER_STYLES — completeness", () => {
  it("has an entry for every LayerToggleKey", () => {
    for (const key of LAYER_TOGGLE_KEYS) {
      expect(LAYER_MARKER_STYLES[key]).toBeDefined();
    }
  });

  it("has exactly 4 entries (one per LayerToggleKey)", () => {
    const keys = Object.keys(LAYER_MARKER_STYLES);
    expect(keys).toHaveLength(4);
  });

  it("each layer entry has a non-empty icon string", () => {
    for (const key of LAYER_TOGGLE_KEYS) {
      expect(LAYER_MARKER_STYLES[key].icon).toBeTruthy();
    }
  });

  it("each layer entry has a valid shape", () => {
    for (const key of LAYER_TOGGLE_KEYS) {
      expect(ALL_SHAPES).toContain(LAYER_MARKER_STYLES[key].shape);
    }
  });
});

// ─── 4. Token format — all *Token fields begin with "--" ──────────────────────

describe("STATUS_MARKER_STYLES — token format", () => {
  const TOKEN_FIELDS: (keyof MarkerStyleDef)[] = [
    "colorToken",
    "bgToken",
    "borderToken",
    "subtleToken",
  ];

  for (const status of CASE_STATUSES) {
    it(`${status}: all *Token fields are CSS custom properties (begin with --)`, () => {
      const def = STATUS_MARKER_STYLES[status as CaseStatus];
      for (const field of TOKEN_FIELDS) {
        const value = def[field] as string;
        expect(value.startsWith("--"), `${field} should start with "--", got: "${value}"`).toBe(true);
      }
    });
  }
});

describe("LAYER_MARKER_STYLES — token format", () => {
  const TOKEN_FIELDS: (keyof MarkerStyleDef)[] = [
    "colorToken",
    "bgToken",
    "borderToken",
    "subtleToken",
  ];

  for (const key of LAYER_TOGGLE_KEYS) {
    it(`${key}: all *Token fields are CSS custom properties (begin with --)`, () => {
      const def = LAYER_MARKER_STYLES[key];
      for (const field of TOKEN_FIELDS) {
        const value = def[field] as string;
        expect(value.startsWith("--"), `${field} should start with "--", got: "${value}"`).toBe(true);
      }
    });
  }
});

// ─── 5. No hex literals in token values ───────────────────────────────────────

describe("no hex color literals in token values", () => {
  it("STATUS_MARKER_STYLES has no hex literals in any token field", () => {
    const hexPattern = /#[0-9a-fA-F]{3,8}\b/;
    for (const status of CASE_STATUSES) {
      const def = STATUS_MARKER_STYLES[status as CaseStatus];
      expect(hexPattern.test(def.colorToken)).toBe(false);
      expect(hexPattern.test(def.bgToken)).toBe(false);
      expect(hexPattern.test(def.borderToken)).toBe(false);
      expect(hexPattern.test(def.subtleToken)).toBe(false);
    }
  });

  it("LAYER_MARKER_STYLES has no hex literals in any token field", () => {
    const hexPattern = /#[0-9a-fA-F]{3,8}\b/;
    for (const key of LAYER_TOGGLE_KEYS) {
      const def = LAYER_MARKER_STYLES[key];
      expect(hexPattern.test(def.colorToken)).toBe(false);
      expect(hexPattern.test(def.bgToken)).toBe(false);
      expect(hexPattern.test(def.borderToken)).toBe(false);
      expect(hexPattern.test(def.subtleToken)).toBe(false);
    }
  });
});

// ─── 6. getMarkerStyle ────────────────────────────────────────────────────────

describe("getMarkerStyle", () => {
  it("returns correct def for 'deployed'", () => {
    const def = getMarkerStyle("deployed");
    expect(def.bgToken).toBe("--layer-deployed-bg");
    expect(def.shape).toBe("circle");
    expect(def.icon).toBe("pin-deployed");
  });

  it("returns correct def for 'flagged'", () => {
    const def = getMarkerStyle("flagged");
    expect(def.bgToken).toBe("--layer-flagged-bg");
    expect(def.shape).toBe("triangle");
  });

  it("returns correct def for 'transit_out'", () => {
    const def = getMarkerStyle("transit_out");
    expect(def.shape).toBe("diamond");
    expect(def.icon).toBe("pin-transit-out");
  });

  it("returns correct def for 'transit_in'", () => {
    const def = getMarkerStyle("transit_in");
    expect(def.shape).toBe("diamond");
    expect(def.icon).toBe("pin-transit-in");
  });

  it("returns correct def for 'hangar'", () => {
    const def = getMarkerStyle("hangar");
    expect(def.shape).toBe("square");
    expect(def.bgToken).toBe("--layer-hangar-bg");
  });

  it("returns correct def for 'assembled'", () => {
    const def = getMarkerStyle("assembled");
    expect(def.shape).toBe("hexagon");
  });

  it("returns correct def for 'received'", () => {
    const def = getMarkerStyle("received");
    expect(def.shape).toBe("square");
  });

  it("returns correct def for 'archived'", () => {
    const def = getMarkerStyle("archived");
    expect(def.shape).toBe("star");
  });

  it("throws for an unknown status string", () => {
    expect(() => getMarkerStyle("unknown_status" as CaseStatus)).toThrow(
      /Unknown CaseStatus/
    );
  });

  it("covers all 8 CaseStatus values without throwing", () => {
    for (const status of CASE_STATUSES) {
      expect(() => getMarkerStyle(status as CaseStatus)).not.toThrow();
    }
  });
});

// ─── 7. getLayerMarkerStyle ───────────────────────────────────────────────────

describe("getLayerMarkerStyle", () => {
  it("returns correct def for 'deployed' layer", () => {
    const def = getLayerMarkerStyle("deployed");
    expect(def.bgToken).toBe("--layer-deployed-bg");
    expect(def.shape).toBe("circle");
  });

  it("returns correct def for 'transit' layer", () => {
    const def = getLayerMarkerStyle("transit");
    expect(def.bgToken).toBe("--layer-transit-bg");
    expect(def.shape).toBe("diamond");
  });

  it("returns correct def for 'flagged' layer", () => {
    const def = getLayerMarkerStyle("flagged");
    expect(def.bgToken).toBe("--layer-flagged-bg");
    expect(def.shape).toBe("triangle");
  });

  it("returns correct def for 'hangar' layer", () => {
    const def = getLayerMarkerStyle("hangar");
    expect(def.bgToken).toBe("--layer-hangar-bg");
    expect(def.shape).toBe("square");
  });

  it("covers all 4 LayerToggleKeys without throwing", () => {
    for (const key of LAYER_TOGGLE_KEYS) {
      expect(() => getLayerMarkerStyle(key)).not.toThrow();
    }
  });

  it("throws for an unknown layer key string", () => {
    expect(() =>
      getLayerMarkerStyle("unknown_layer" as LayerToggleKey)
    ).toThrow(/Unknown LayerToggleKey/);
  });
});

// ─── 8. markerStyleToCssVars ─────────────────────────────────────────────────

describe("markerStyleToCssVars", () => {
  it("returns object with --marker-color, --marker-bg, --marker-border, --marker-subtle", () => {
    const def = getMarkerStyle("deployed");
    const vars = markerStyleToCssVars(def);
    expect(vars).toHaveProperty("--marker-color");
    expect(vars).toHaveProperty("--marker-bg");
    expect(vars).toHaveProperty("--marker-border");
    expect(vars).toHaveProperty("--marker-subtle");
  });

  it("wraps each token in var()", () => {
    const def = getMarkerStyle("deployed");
    const vars = markerStyleToCssVars(def);
    expect(vars["--marker-bg"]).toBe("var(--layer-deployed-bg)");
    expect(vars["--marker-color"]).toBe("var(--layer-deployed-color)");
    expect(vars["--marker-border"]).toBe("var(--layer-deployed-border)");
    expect(vars["--marker-subtle"]).toBe("var(--layer-deployed-subtle)");
  });

  it("returns distinct --marker-bg values for different statuses", () => {
    const deployedVars = markerStyleToCssVars(getMarkerStyle("deployed"));
    const flaggedVars = markerStyleToCssVars(getMarkerStyle("flagged"));
    expect(deployedVars["--marker-bg"]).not.toBe(flaggedVars["--marker-bg"]);
  });

  it("returns an object with exactly 4 keys", () => {
    const vars = markerStyleToCssVars(getMarkerStyle("transit_out"));
    expect(Object.keys(vars)).toHaveLength(4);
  });
});

// ─── 9. enrichWithMarkerStyle ─────────────────────────────────────────────────

describe("enrichWithMarkerStyle", () => {
  it("returns status, layerKey, markerStyle, and cssVars", () => {
    const result = enrichWithMarkerStyle("deployed", "deployed");
    expect(result.status).toBe("deployed");
    expect(result.layerKey).toBe("deployed");
    expect(result.markerStyle).toBeDefined();
    expect(result.cssVars).toBeDefined();
  });

  it("markerStyle.bgToken matches expected token for 'deployed'", () => {
    const result = enrichWithMarkerStyle("deployed", "deployed");
    expect(result.markerStyle.bgToken).toBe("--layer-deployed-bg");
  });

  it("markerStyle.bgToken matches expected token for 'flagged'", () => {
    const result = enrichWithMarkerStyle("flagged", "flagged");
    expect(result.markerStyle.bgToken).toBe("--layer-flagged-bg");
  });

  it("cssVars has --marker-bg wrapped in var()", () => {
    const result = enrichWithMarkerStyle("transit_out", "transit");
    expect(result.cssVars["--marker-bg"]).toBe("var(--layer-transit-bg)");
  });

  it("handles null layerKey by falling back to hangar group", () => {
    const result = enrichWithMarkerStyle("archived", null);
    expect(result.layerKey).toBeNull();
    // archived has its own style defined, so should use that
    expect(result.markerStyle).toBeDefined();
    expect(result.status).toBe("archived");
  });

  it("covers all 8 CaseStatus values without throwing", () => {
    const pairings: Array<[CaseStatus, LayerToggleKey | null]> = [
      ["hangar",      "hangar"],
      ["assembled",   "hangar"],
      ["transit_out", "transit"],
      ["deployed",    "deployed"],
      ["flagged",     "flagged"],
      ["transit_in",  "transit"],
      ["received",    "hangar"],
      ["archived",    null],
    ];
    for (const [status, layerKey] of pairings) {
      expect(() => enrichWithMarkerStyle(status, layerKey)).not.toThrow();
    }
  });
});

// ─── 10. getMarkerShape ───────────────────────────────────────────────────────

describe("getMarkerShape", () => {
  it("returns 'circle' for 'deployed'", () => {
    expect(getMarkerShape("deployed")).toBe("circle");
  });

  it("returns 'triangle' for 'flagged'", () => {
    expect(getMarkerShape("flagged")).toBe("triangle");
  });

  it("returns 'diamond' for 'transit_out'", () => {
    expect(getMarkerShape("transit_out")).toBe("diamond");
  });

  it("returns 'diamond' for 'transit_in'", () => {
    expect(getMarkerShape("transit_in")).toBe("diamond");
  });

  it("returns 'square' for 'hangar'", () => {
    expect(getMarkerShape("hangar")).toBe("square");
  });

  it("returns 'hexagon' for 'assembled'", () => {
    expect(getMarkerShape("assembled")).toBe("hexagon");
  });

  it("returns 'star' for 'archived'", () => {
    expect(getMarkerShape("archived")).toBe("star");
  });

  it("returns 'square' for 'received'", () => {
    expect(getMarkerShape("received")).toBe("square");
  });

  it("returns 'circle' (default) for unknown status", () => {
    expect(getMarkerShape("ghost_status" as CaseStatus)).toBe("circle");
  });

  it("covers all 8 statuses without throwing", () => {
    for (const status of CASE_STATUSES) {
      expect(() => getMarkerShape(status as CaseStatus)).not.toThrow();
    }
  });
});

// ─── 11. getMarkerIcon ────────────────────────────────────────────────────────

describe("getMarkerIcon", () => {
  it("returns 'pin-deployed' for 'deployed'", () => {
    expect(getMarkerIcon("deployed")).toBe("pin-deployed");
  });

  it("returns 'pin-flagged' for 'flagged'", () => {
    expect(getMarkerIcon("flagged")).toBe("pin-flagged");
  });

  it("returns 'pin-transit-out' for 'transit_out'", () => {
    expect(getMarkerIcon("transit_out")).toBe("pin-transit-out");
  });

  it("returns 'pin-transit-in' for 'transit_in'", () => {
    expect(getMarkerIcon("transit_in")).toBe("pin-transit-in");
  });

  it("returns 'pin-hangar' for 'hangar'", () => {
    expect(getMarkerIcon("hangar")).toBe("pin-hangar");
  });

  it("returns 'pin-assembled' for 'assembled'", () => {
    expect(getMarkerIcon("assembled")).toBe("pin-assembled");
  });

  it("returns 'pin-received' for 'received'", () => {
    expect(getMarkerIcon("received")).toBe("pin-received");
  });

  it("returns 'pin-archived' for 'archived'", () => {
    expect(getMarkerIcon("archived")).toBe("pin-archived");
  });

  it("returns 'pin-default' for unknown status", () => {
    expect(getMarkerIcon("ghost_status" as CaseStatus)).toBe("pin-default");
  });
});

// ─── 12. getMarkerZPriority ───────────────────────────────────────────────────

describe("getMarkerZPriority", () => {
  it("flagged has the highest z-priority (100)", () => {
    expect(getMarkerZPriority("flagged")).toBe(100);
  });

  it("deployed has higher z-priority (80) than transit (60)", () => {
    expect(getMarkerZPriority("deployed")).toBeGreaterThan(
      getMarkerZPriority("transit_out")
    );
  });

  it("transit has higher z-priority than hangar", () => {
    expect(getMarkerZPriority("transit_out")).toBeGreaterThan(
      getMarkerZPriority("hangar")
    );
  });

  it("archived has the lowest z-priority (20)", () => {
    const priorities = CASE_STATUSES.map((s) =>
      getMarkerZPriority(s as CaseStatus)
    );
    const minPriority = Math.min(...priorities);
    expect(getMarkerZPriority("archived")).toBe(minPriority);
  });

  it("returns 40 (default) for unknown status", () => {
    expect(getMarkerZPriority("ghost_status" as CaseStatus)).toBe(40);
  });

  it("transit_out and transit_in have the same z-priority", () => {
    expect(getMarkerZPriority("transit_out")).toBe(
      getMarkerZPriority("transit_in")
    );
  });

  it("all z-priorities are positive integers", () => {
    for (const status of CASE_STATUSES) {
      const z = getMarkerZPriority(status as CaseStatus);
      expect(z).toBeGreaterThan(0);
      expect(Number.isInteger(z)).toBe(true);
    }
  });
});

// ─── 13. buildMapboxStatusExpression ─────────────────────────────────────────

describe("buildMapboxStatusExpression", () => {
  // Simple mock token resolver — just returns the token name for test inspection
  const mockResolver = (token: string) => `resolved:${token}`;

  it("starts with ['match', ['get', 'status']]", () => {
    const expr = buildMapboxStatusExpression("bgToken", mockResolver, "#000") as unknown[];
    expect(expr[0]).toBe("match");
    expect(expr[1]).toEqual(["get", "status"]);
  });

  it("has entries for all 8 CaseStatus values", () => {
    const expr = buildMapboxStatusExpression("bgToken", mockResolver, "#000") as unknown[];
    // Each status pair takes 2 slots [status, value], plus [match, ["get","status"], ...fallback]
    // Structure: ["match", ["get","status"], s1, v1, s2, v2, ..., s8, v8, fallback]
    // = 2 + (8 * 2) + 1 = 19 elements
    expect(expr).toHaveLength(19);
  });

  it("includes each CaseStatus as an even-indexed entry (after position 1)", () => {
    const expr = buildMapboxStatusExpression("bgToken", mockResolver, "#000") as unknown[];
    // Status values appear at indices 2, 4, 6, ..., 16
    const statusEntries = CASE_STATUSES.slice().sort();
    const exprStatuses: string[] = [];
    for (let i = 2; i < expr.length - 1; i += 2) {
      exprStatuses.push(expr[i] as string);
    }
    expect(exprStatuses.sort()).toEqual(statusEntries);
  });

  it("calls resolveToken with the bgToken for each status", () => {
    const called: string[] = [];
    const trackingResolver = (token: string) => {
      called.push(token);
      return `resolved:${token}`;
    };
    buildMapboxStatusExpression("bgToken", trackingResolver, "#000");
    // Should be called once per status (8 times)
    expect(called).toHaveLength(8);
    for (const status of CASE_STATUSES) {
      const expectedToken = STATUS_MARKER_STYLES[status as CaseStatus].bgToken;
      expect(called).toContain(expectedToken);
    }
  });

  it("appends the fallback as the last element", () => {
    const expr = buildMapboxStatusExpression("bgToken", mockResolver, "#FALLBACK") as unknown[];
    expect(expr[expr.length - 1]).toBe("#FALLBACK");
  });

  it("works with 'borderToken' property too", () => {
    const expr = buildMapboxStatusExpression("borderToken", mockResolver, "#000") as unknown[];
    expect(expr[0]).toBe("match");
    expect(expr).toHaveLength(19);
  });

  it("works with 'colorToken' property too", () => {
    const expr = buildMapboxStatusExpression("colorToken", mockResolver, "#000") as unknown[];
    expect(expr[0]).toBe("match");
    expect(expr).toHaveLength(19);
  });
});

// ─── 14. Layer-status color token consistency ─────────────────────────────────

describe("layer-status token consistency", () => {
  it("'deployed' status uses --layer-deployed-* tokens", () => {
    const def = STATUS_MARKER_STYLES.deployed;
    expect(def.bgToken).toContain("layer-deployed");
    expect(def.colorToken).toContain("layer-deployed");
    expect(def.borderToken).toContain("layer-deployed");
    expect(def.subtleToken).toContain("layer-deployed");
  });

  it("'transit_out' status uses --layer-transit-* tokens", () => {
    const def = STATUS_MARKER_STYLES.transit_out;
    expect(def.bgToken).toContain("layer-transit");
    expect(def.colorToken).toContain("layer-transit");
  });

  it("'transit_in' status uses --layer-transit-* tokens", () => {
    const def = STATUS_MARKER_STYLES.transit_in;
    expect(def.bgToken).toContain("layer-transit");
    expect(def.colorToken).toContain("layer-transit");
  });

  it("'flagged' status uses --layer-flagged-* tokens", () => {
    const def = STATUS_MARKER_STYLES.flagged;
    expect(def.bgToken).toContain("layer-flagged");
    expect(def.colorToken).toContain("layer-flagged");
  });

  it("'hangar', 'assembled', 'received' statuses use --layer-hangar-* tokens", () => {
    for (const status of ["hangar", "assembled", "received"] as CaseStatus[]) {
      const def = STATUS_MARKER_STYLES[status];
      expect(def.bgToken).toContain("layer-hangar");
    }
  });

  it("'archived' status uses --layer-history-* tokens", () => {
    const def = STATUS_MARKER_STYLES.archived;
    expect(def.bgToken).toContain("layer-history");
    expect(def.colorToken).toContain("layer-history");
  });

  it("layer group 'deployed' style uses --layer-deployed-* tokens", () => {
    const def = LAYER_MARKER_STYLES.deployed;
    expect(def.bgToken).toContain("layer-deployed");
  });

  it("layer group 'transit' style uses --layer-transit-* tokens", () => {
    const def = LAYER_MARKER_STYLES.transit;
    expect(def.bgToken).toContain("layer-transit");
  });

  it("layer group 'flagged' style uses --layer-flagged-* tokens", () => {
    const def = LAYER_MARKER_STYLES.flagged;
    expect(def.bgToken).toContain("layer-flagged");
  });

  it("layer group 'hangar' style uses --layer-hangar-* tokens", () => {
    const def = LAYER_MARKER_STYLES.hangar;
    expect(def.bgToken).toContain("layer-hangar");
  });
});

// ─── 15. Accessibility — non-empty ariaLabel ──────────────────────────────────

describe("ariaLabel — accessibility", () => {
  it("every status style has a non-empty ariaLabel", () => {
    for (const status of CASE_STATUSES) {
      const def = STATUS_MARKER_STYLES[status as CaseStatus];
      expect(def.ariaLabel, `${status} ariaLabel should not be empty`).toBeTruthy();
      expect(def.ariaLabel.length).toBeGreaterThan(0);
    }
  });

  it("every layer style has a non-empty ariaLabel", () => {
    for (const key of LAYER_TOGGLE_KEYS) {
      const def = LAYER_MARKER_STYLES[key];
      expect(def.ariaLabel, `${key} layer ariaLabel should not be empty`).toBeTruthy();
    }
  });

  it("deployed ariaLabel mentions 'deployed' or 'field'", () => {
    const label = STATUS_MARKER_STYLES.deployed.ariaLabel.toLowerCase();
    expect(label.includes("deployed") || label.includes("field")).toBe(true);
  });

  it("flagged ariaLabel mentions 'flagged' or 'issues'", () => {
    const label = STATUS_MARKER_STYLES.flagged.ariaLabel.toLowerCase();
    expect(label.includes("flagged") || label.includes("issue")).toBe(true);
  });

  it("archived ariaLabel mentions 'archived' or 'decommission'", () => {
    const label = STATUS_MARKER_STYLES.archived.ariaLabel.toLowerCase();
    expect(label.includes("archived") || label.includes("decommission")).toBe(true);
  });
});

// ─── 16. zPriority ordering ───────────────────────────────────────────────────

describe("zPriority ordering", () => {
  it("flagged (100) > deployed (80) > transit_out (60) > hangar (40)", () => {
    expect(getMarkerZPriority("flagged")).toBeGreaterThan(getMarkerZPriority("deployed"));
    expect(getMarkerZPriority("deployed")).toBeGreaterThan(getMarkerZPriority("transit_out"));
    expect(getMarkerZPriority("transit_out")).toBeGreaterThan(getMarkerZPriority("hangar"));
  });

  it("assembled has a slightly higher z-priority than hangar (both hangar group)", () => {
    expect(getMarkerZPriority("assembled")).toBeGreaterThanOrEqual(
      getMarkerZPriority("hangar")
    );
  });

  it("archived has lower z-priority than hangar", () => {
    expect(getMarkerZPriority("archived")).toBeLessThan(
      getMarkerZPriority("hangar")
    );
  });

  it("no two different statuses in different groups share the same z-priority (group uniqueness)", () => {
    const deployedZ = getMarkerZPriority("deployed");
    const transitZ  = getMarkerZPriority("transit_out");
    const flaggedZ  = getMarkerZPriority("flagged");
    const hangarZ   = getMarkerZPriority("hangar");

    const groupPriorities = [deployedZ, transitZ, flaggedZ, hangarZ];
    const uniquePriorities = new Set(groupPriorities);
    expect(uniquePriorities.size).toBe(groupPriorities.length);
  });
});
