/**
 * heatmap-data.test.ts
 *
 * Unit tests for the heat map GeoJSON conversion and color ramp utilities.
 *
 * These tests verify the pure functions in heat-layer-colors.ts and the
 * GeoJSON conversion functions in use-heatmap-density.ts.  No Convex
 * subscription is involved — these are pure computation tests.
 */

import { describe, it, expect } from "vitest";
import {
  buildHeatColorExpression,
  buildHeatWeightExpression,
  buildHeatGeoJSON,
  HEAT_COLOR_RAMP,
  HEAT_SWATCH_COLORS,
  type HeatCasePin,
} from "@/lib/heat-layer-colors";

// ─── Color ramp tests ─────────────────────────────────────────────────────────

describe("HEAT_COLOR_RAMP", () => {
  it("contains 9 stops (0 through 8)", () => {
    expect(HEAT_COLOR_RAMP).toHaveLength(9);
  });

  it("first stop is density 0 (transparent)", () => {
    const [density, color] = HEAT_COLOR_RAMP[0];
    expect(density).toBe(0);
    expect(color).toMatch(/hsla\(0,\s*0%,\s*0%,\s*0\)/);
  });

  it("last stop is density 1 (peak red)", () => {
    const [density, color] = HEAT_COLOR_RAMP[8];
    expect(density).toBe(1.0);
    expect(color).toMatch(/hsla\(/);
    // Check it's in the red hue range (hue 0)
    expect(color).toMatch(/hsla\(0,/);
  });

  it("density values are monotonically increasing 0→1", () => {
    const densities = HEAT_COLOR_RAMP.map(([d]) => d);
    for (let i = 1; i < densities.length; i++) {
      expect(densities[i]).toBeGreaterThan(densities[i - 1]);
    }
  });

  it("contains no hex literals (all HSLA strings)", () => {
    for (const [, color] of HEAT_COLOR_RAMP) {
      // Must start with 'hsl' and must not contain '#'
      expect(color).toMatch(/^hsla?\(/);
      expect(color).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });
});

// ─── Swatch colors ────────────────────────────────────────────────────────────

describe("HEAT_SWATCH_COLORS", () => {
  it("contains 8 swatch colors (stops 1–8, skip transparent stop 0)", () => {
    expect(HEAT_SWATCH_COLORS).toHaveLength(8);
  });

  it("all swatch colors are HSL strings with no hex literals", () => {
    for (const color of HEAT_SWATCH_COLORS) {
      expect(color).toMatch(/^hsl\(/);
      expect(color).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });
});

// ─── buildHeatColorExpression ─────────────────────────────────────────────────

describe("buildHeatColorExpression()", () => {
  it("returns an array starting with ['interpolate', ['linear'], ['heatmap-density']]", () => {
    const expr = buildHeatColorExpression();
    expect(Array.isArray(expr)).toBe(true);
    expect(expr[0]).toBe("interpolate");
    expect(expr[1]).toEqual(["linear"]);
    expect(expr[2]).toEqual(["heatmap-density"]);
  });

  it("has 3 + 2*9 = 21 elements (base + 9 density-color pairs)", () => {
    // 3 base elements + 9 stops × 2 values per stop = 21
    const expr = buildHeatColorExpression();
    expect(expr).toHaveLength(3 + HEAT_COLOR_RAMP.length * 2);
  });

  it("interleaves density and color values correctly", () => {
    const expr = buildHeatColorExpression();
    // Stop at index 0: density at expr[3], color at expr[4]
    expect(expr[3]).toBe(HEAT_COLOR_RAMP[0][0]); // density 0
    expect(expr[4]).toBe(HEAT_COLOR_RAMP[0][1]); // transparent
    // Stop at index 8: density at expr[3+16=19], color at expr[20]
    expect(expr[3 + (HEAT_COLOR_RAMP.length - 1) * 2]).toBe(1.0);
  });
});

// ─── buildHeatWeightExpression ─────────────────────────────────────────────────

describe("buildHeatWeightExpression()", () => {
  it("returns an interpolate expression with ['get', 'weight']", () => {
    const expr = buildHeatWeightExpression(3);
    expect(expr[0]).toBe("interpolate");
    expect(expr[2]).toEqual(["get", "weight"]);
  });

  it("maps weight=0 → 0, weight=1 → ~0.33, weight=maxWeight → 1", () => {
    const expr = buildHeatWeightExpression(3);
    // Stops: [0, 0, 1, 0.33, 3, 1]
    expect(expr[3]).toBe(0);   // weight stop
    expect(expr[4]).toBe(0);   // → value 0
    expect(expr[5]).toBe(1);   // weight stop
    expect(expr[6]).toBe(0.33); // → value 0.33
    expect(expr[7]).toBe(3);   // weight stop = maxWeight
    expect(expr[8]).toBe(1);   // → value 1
  });

  it("uses the provided maxWeight as the upper bound", () => {
    const expr = buildHeatWeightExpression(10);
    // Last stop should be maxWeight=10
    expect(expr[7]).toBe(10);
    expect(expr[8]).toBe(1);
  });

  it("defaults maxWeight to 3", () => {
    const exprDefault = buildHeatWeightExpression();
    const exprExplicit = buildHeatWeightExpression(3);
    expect(exprDefault).toEqual(exprExplicit);
  });
});

// ─── buildHeatGeoJSON ─────────────────────────────────────────────────────────

describe("buildHeatGeoJSON()", () => {
  const makePin = (overrides: Partial<HeatCasePin>): HeatCasePin => ({
    caseId: "test",
    status: "deployed",
    lat:    40.7,
    lng:    -74.0,
    ...overrides,
  });

  it("returns a FeatureCollection", () => {
    const result = buildHeatGeoJSON([makePin({})]);
    expect(result.type).toBe("FeatureCollection");
    expect(Array.isArray(result.features)).toBe(true);
  });

  it("excludes pins without lat (undefined)", () => {
    const result = buildHeatGeoJSON([
      makePin({ lat: undefined }),
      makePin({ caseId: "has-coords", lat: 40.7, lng: -74.0 }),
    ]);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.caseId).toBe("has-coords");
  });

  it("excludes pins without lng (undefined)", () => {
    const result = buildHeatGeoJSON([
      makePin({ lng: undefined }),
      makePin({ caseId: "valid", lat: 51.5, lng: -0.1 }),
    ]);
    expect(result.features).toHaveLength(1);
  });

  it("assigns weight=3 to flagged cases", () => {
    const result = buildHeatGeoJSON([makePin({ status: "flagged", caseId: "flagged-case" })]);
    expect(result.features[0].properties.weight).toBe(3);
  });

  it("assigns weight=1 to non-flagged cases", () => {
    const statuses = ["deployed", "transit_out", "hangar", "assembled", "received", "archived"];
    for (const status of statuses) {
      const result = buildHeatGeoJSON([makePin({ status })]);
      expect(result.features[0].properties.weight).toBe(1);
    }
  });

  it("maps coordinates as [lng, lat] (GeoJSON convention)", () => {
    const lat = 51.507;
    const lng = -0.127;
    const result = buildHeatGeoJSON([makePin({ lat, lng })]);
    expect(result.features[0].geometry.coordinates).toEqual([lng, lat]);
  });

  it("includes caseId as a GeoJSON property", () => {
    const result = buildHeatGeoJSON([makePin({ caseId: "CASE-0042" })]);
    expect(result.features[0].properties.caseId).toBe("CASE-0042");
  });

  it("handles empty array", () => {
    const result = buildHeatGeoJSON([]);
    expect(result.features).toHaveLength(0);
    expect(result.type).toBe("FeatureCollection");
  });

  it("handles mixed valid and invalid pins", () => {
    const pins: HeatCasePin[] = [
      { caseId: "a", status: "deployed", lat: 40.7, lng: -74.0 },
      { caseId: "b", status: "flagged",  lat: undefined, lng: -74.0 },
      { caseId: "c", status: "hangar",   lat: 34.0, lng: undefined },
      { caseId: "d", status: "flagged",  lat: 51.5, lng: -0.1 },
    ];

    const result = buildHeatGeoJSON(pins);
    // Only 'a' and 'd' have both lat and lng
    expect(result.features).toHaveLength(2);
    expect(result.features.map((f) => f.properties.caseId)).toEqual(["a", "d"]);
  });

  it("returns correct feature structure for each pin", () => {
    const result = buildHeatGeoJSON([makePin({ caseId: "TEST", lat: 52.0, lng: 4.5, status: "deployed" })]);
    const feature = result.features[0];
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("Point");
    expect(feature.properties).toEqual({ weight: 1, caseId: "TEST" });
    expect(feature.geometry.coordinates).toEqual([4.5, 52.0]);
  });
});
