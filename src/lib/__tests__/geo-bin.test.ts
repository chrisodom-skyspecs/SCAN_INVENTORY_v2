/**
 * geo-bin.test.ts
 *
 * Unit tests for the geographic grid-cell binning utilities:
 *   - binCaseLocations  (Web Mercator tile-based binning)
 *   - binByGrid         (simple lat/lng degree-grid binning)
 *   - gridCellSize      (cell size helper)
 *
 * All tests are pure — no Convex, no DOM, no network, no side effects.
 *
 * Coverage plan:
 *   1.  binCaseLocations — empty input → empty output
 *   2.  binCaseLocations — single coordinate → single bin with count 1
 *   3.  binCaseLocations — two identical coordinates → single bin with count 2
 *   4.  binCaseLocations — two coordinates in different tiles → two bins
 *   5.  binCaseLocations — two coordinates in same tile → one bin with count 2
 *   6.  binCaseLocations — zoom 0 → single cell for the whole world
 *   7.  binCaseLocations — zoom 22 → each coordinate gets its own bin
 *   8.  binCaseLocations — non-integer zoom is floored
 *   9.  binCaseLocations — coordinates with NaN/±Infinity are skipped
 *  10.  binCaseLocations — latitude clamped to Mercator range
 *  11.  binCaseLocations — bin center lat/lng are finite numbers
 *  12.  binCaseLocations — tileX/tileY are present and non-negative integers
 *  13.  binCaseLocations — count values are positive integers
 *  14.  binCaseLocations — total count across bins equals valid input count
 *  15.  binCaseLocations — does not mutate input array
 *  16.  binCaseLocations — accepts caseId field without affecting output
 *  17.  gridCellSize — zoom 0 → { lng: 360, lat: 180 }
 *  18.  gridCellSize — zoom 1 → { lng: 180, lat: 90 }
 *  19.  gridCellSize — zoom 5 → expected sizes
 *  20.  gridCellSize — non-integer zoom is floored
 *  21.  gridCellSize — zoom clamped to [0, 22]
 *  22.  binByGrid — empty input → empty output
 *  23.  binByGrid — single coordinate → single bin with count 1
 *  24.  binByGrid — two coordinates in same cell → count 2
 *  25.  binByGrid — two coordinates in different cells → two bins
 *  26.  binByGrid — bin centers are cell midpoints (offset by half-cell)
 *  27.  binByGrid — tileX/tileY are undefined (not computed in grid mode)
 *  28.  binByGrid — NaN/Infinity coordinates are skipped
 *  29.  binByGrid — total count equals valid input length
 *  30.  binCaseLocations — seattle/LA separation at zoom 5
 *  31.  binCaseLocations — deterministic: same call twice returns same bins
 */

import { describe, it, expect } from "vitest";
import {
  binCaseLocations,
  binByGrid,
  gridCellSize,
  type CaseCoordinate,
  type GridBin,
} from "@/lib/geo-bin";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sum the count fields across all bins. */
function totalCount(bins: GridBin[]): number {
  return bins.reduce((sum, b) => sum + b.count, 0);
}

/** Build a simple coordinate (no caseId). */
function coord(lat: number, lng: number): CaseCoordinate {
  return { lat, lng };
}

// ─── binCaseLocations ─────────────────────────────────────────────────────────

describe("binCaseLocations()", () => {
  // 1. Empty input
  it("returns an empty array for empty input", () => {
    expect(binCaseLocations([], 8)).toEqual([]);
  });

  // 2. Single coordinate
  it("returns a single bin with count 1 for a single coordinate", () => {
    const bins = binCaseLocations([coord(47.6, -122.3)], 8);
    expect(bins).toHaveLength(1);
    expect(bins[0].count).toBe(1);
  });

  // 3. Two identical coordinates → single bin, count 2
  it("merges identical coordinates into a single bin with count 2", () => {
    const bins = binCaseLocations(
      [coord(47.6, -122.3), coord(47.6, -122.3)],
      8,
    );
    expect(bins).toHaveLength(1);
    expect(bins[0].count).toBe(2);
  });

  // 4. Two coordinates far apart → two bins
  it("produces separate bins for coordinates that are far apart", () => {
    // Seattle vs. Los Angeles — definitely different tiles at any reasonable zoom
    const bins = binCaseLocations(
      [coord(47.6, -122.3), coord(34.0, -118.2)],
      5,
    );
    expect(bins).toHaveLength(2);
  });

  // 5. Two coordinates very close together at low zoom → same bin
  it("bins two nearby coordinates into the same cell at low zoom", () => {
    // Two points ~0.1° apart; at zoom 3 cell size is ~45° so they share a tile
    const bins = binCaseLocations(
      [coord(47.600, -122.300), coord(47.605, -122.305)],
      3,
    );
    expect(bins).toHaveLength(1);
    expect(bins[0].count).toBe(2);
  });

  // 6. Zoom 0 → entire world is one cell
  it("produces a single bin at zoom 0 regardless of coordinate spread", () => {
    const bins = binCaseLocations(
      [coord(47.6, -122.3), coord(34.0, -118.2), coord(-33.9, 151.2)],
      0,
    );
    expect(bins).toHaveLength(1);
    expect(bins[0].count).toBe(3);
  });

  // 7. Zoom 22 → each point gets its own bin (points far enough apart)
  it("produces one bin per coordinate for well-separated points at high zoom", () => {
    const bins = binCaseLocations(
      [coord(47.6, -122.3), coord(34.0, -118.2), coord(-33.9, 151.2)],
      22,
    );
    // Each coordinate should be in its own tile at zoom 22
    expect(bins).toHaveLength(3);
    expect(bins.every((b) => b.count === 1)).toBe(true);
  });

  // 8. Non-integer zoom is floored
  it("treats fractional zoom values the same as floor(zoom)", () => {
    const coords: CaseCoordinate[] = [coord(47.6, -122.3), coord(34.0, -118.2)];
    const binsFloor = binCaseLocations(coords, 5);
    const binsFrac = binCaseLocations(coords, 5.9);
    // Same tile at floor(5) === floor(5.9) === 5
    expect(binsFloor.length).toBe(binsFrac.length);
  });

  // 9. NaN / ±Infinity coordinates are skipped
  it("silently skips coordinates with non-finite values", () => {
    const bins = binCaseLocations(
      [
        { lat: NaN, lng: -122.3 },
        { lat: 47.6, lng: Infinity },
        { lat: 47.6, lng: -122.3 },        // valid
        { lat: -Infinity, lng: -118.2 },
      ],
      8,
    );
    // Only the one valid coordinate contributes
    expect(bins).toHaveLength(1);
    expect(bins[0].count).toBe(1);
  });

  // 10. Latitude clamped to Mercator range (still contributes to count)
  it("clamps extreme latitudes to the Mercator range and still counts them", () => {
    const bins = binCaseLocations(
      [coord(90, 0), coord(86, 0)], // Both beyond 85.051129° — land in same polar tile
      4,
    );
    // The two extreme-latitude points should be merged
    expect(bins).toHaveLength(1);
    expect(bins[0].count).toBe(2);
  });

  // 11. Bin center lat/lng are finite numbers
  it("produces finite lat/lng coordinates for every bin center", () => {
    const bins = binCaseLocations(
      [coord(47.6, -122.3), coord(34.0, -118.2), coord(51.5, -0.1)],
      8,
    );
    for (const bin of bins) {
      expect(Number.isFinite(bin.lat)).toBe(true);
      expect(Number.isFinite(bin.lng)).toBe(true);
    }
  });

  // 12. tileX/tileY are non-negative integers
  it("includes non-negative integer tileX and tileY on every bin", () => {
    const bins = binCaseLocations(
      [coord(47.6, -122.3), coord(34.0, -118.2)],
      8,
    );
    for (const bin of bins) {
      expect(typeof bin.tileX).toBe("number");
      expect(typeof bin.tileY).toBe("number");
      expect(Number.isInteger(bin.tileX!)).toBe(true);
      expect(Number.isInteger(bin.tileY!)).toBe(true);
      expect(bin.tileX!).toBeGreaterThanOrEqual(0);
      expect(bin.tileY!).toBeGreaterThanOrEqual(0);
    }
  });

  // 13. Count values are positive integers
  it("count values are positive integers", () => {
    const bins = binCaseLocations(
      [coord(47.6, -122.3), coord(47.6, -122.3), coord(34.0, -118.2)],
      8,
    );
    for (const bin of bins) {
      expect(Number.isInteger(bin.count)).toBe(true);
      expect(bin.count).toBeGreaterThan(0);
    }
  });

  // 14. Total count across bins equals valid input length
  it("preserves total count — sum of bin counts equals valid input length", () => {
    const coords: CaseCoordinate[] = [
      coord(47.6, -122.3),
      coord(47.6, -122.3),  // duplicate
      coord(34.0, -118.2),
      { lat: NaN, lng: 0 }, // invalid — skipped
    ];
    const bins = binCaseLocations(coords, 8);
    expect(totalCount(bins)).toBe(3); // 3 valid coords
  });

  // 15. Does not mutate input array
  it("does not mutate the input coordinates array", () => {
    const coords: CaseCoordinate[] = [coord(47.6, -122.3)];
    const original = JSON.stringify(coords);
    binCaseLocations(coords, 8);
    expect(JSON.stringify(coords)).toBe(original);
  });

  // 16. Accepts caseId field without affecting output
  it("accepts the optional caseId field without affecting bin results", () => {
    const withId = binCaseLocations(
      [{ lat: 47.6, lng: -122.3, caseId: "CASE-001" }],
      8,
    );
    const withoutId = binCaseLocations([coord(47.6, -122.3)], 8);
    expect(withId).toHaveLength(withoutId.length);
    expect(withId[0].count).toBe(withoutId[0].count);
  });

  // 30. Seattle / LA separation at zoom 5
  it("places Seattle and LA in different bins at zoom 5", () => {
    const bins = binCaseLocations(
      [
        coord(47.6, -122.3),  // Seattle
        coord(34.0, -118.2),  // Los Angeles
      ],
      5,
    );
    expect(bins).toHaveLength(2);
    expect(totalCount(bins)).toBe(2);
  });

  // 31. Deterministic: same call twice returns same bins
  it("is deterministic — repeated calls with the same input return the same bins", () => {
    const coords: CaseCoordinate[] = [
      coord(47.6, -122.3),
      coord(34.0, -118.2),
      coord(51.5, -0.1),
    ];
    const bins1 = binCaseLocations(coords, 8);
    const bins2 = binCaseLocations(coords, 8);

    // Sort both by tileX then tileY for stable comparison
    const sort = (bins: GridBin[]) =>
      [...bins].sort((a, b) => a.tileX! - b.tileX! || a.tileY! - b.tileY!);

    expect(sort(bins1)).toEqual(sort(bins2));
  });

  // Tile index bounds — tileX and tileY must be within [0, 2^zoom - 1]
  it("produces tileX/tileY within valid bounds [0, 2^zoom - 1]", () => {
    const zoom = 6;
    const maxTile = Math.pow(2, zoom) - 1;
    const bins = binCaseLocations(
      [coord(0, 0), coord(85, 170), coord(-85, -170)],
      zoom,
    );
    for (const bin of bins) {
      expect(bin.tileX!).toBeGreaterThanOrEqual(0);
      expect(bin.tileX!).toBeLessThanOrEqual(maxTile);
      expect(bin.tileY!).toBeGreaterThanOrEqual(0);
      expect(bin.tileY!).toBeLessThanOrEqual(maxTile);
    }
  });
});

// ─── gridCellSize ─────────────────────────────────────────────────────────────

describe("gridCellSize()", () => {
  // 17. zoom 0 → full world
  it("returns 360×180 degrees at zoom 0", () => {
    const size = gridCellSize(0);
    expect(size.lng).toBe(360);
    expect(size.lat).toBe(180);
  });

  // 18. zoom 1 → halves
  it("returns 180×90 degrees at zoom 1", () => {
    const size = gridCellSize(1);
    expect(size.lng).toBe(180);
    expect(size.lat).toBe(90);
  });

  // 19. zoom 5 → expected sizes
  it("returns correct cell sizes at zoom 5 (lng=11.25, lat=5.625)", () => {
    const size = gridCellSize(5);
    expect(size.lng).toBeCloseTo(11.25, 5);
    expect(size.lat).toBeCloseTo(5.625, 5);
  });

  // 20. Non-integer zoom is floored
  it("floors non-integer zoom before computing cell size", () => {
    expect(gridCellSize(5.9)).toEqual(gridCellSize(5));
    expect(gridCellSize(3.1)).toEqual(gridCellSize(3));
  });

  // 21. Zoom clamped to [0, 22]
  it("clamps zoom below 0 to 0", () => {
    expect(gridCellSize(-1)).toEqual(gridCellSize(0));
  });

  it("clamps zoom above 22 to 22", () => {
    expect(gridCellSize(99)).toEqual(gridCellSize(22));
  });

  it("cell size at zoom z equals half the size at zoom z-1", () => {
    for (let z = 1; z <= 10; z++) {
      const prev = gridCellSize(z - 1);
      const curr = gridCellSize(z);
      expect(curr.lng).toBeCloseTo(prev.lng / 2, 10);
      expect(curr.lat).toBeCloseTo(prev.lat / 2, 10);
    }
  });
});

// ─── binByGrid ────────────────────────────────────────────────────────────────

describe("binByGrid()", () => {
  // 22. Empty input
  it("returns an empty array for empty input", () => {
    expect(binByGrid([], 5)).toEqual([]);
  });

  // 23. Single coordinate
  it("returns a single bin with count 1 for a single coordinate", () => {
    const bins = binByGrid([coord(47.6, -122.3)], 5);
    expect(bins).toHaveLength(1);
    expect(bins[0].count).toBe(1);
  });

  // 24. Two coordinates in same cell
  it("merges two coordinates in the same cell into count 2", () => {
    // At zoom 5, cell lng size ~11.25° — two points 0.1° apart share a cell
    const bins = binByGrid(
      [coord(47.6, -122.3), coord(47.7, -122.4)],
      5,
    );
    expect(bins).toHaveLength(1);
    expect(bins[0].count).toBe(2);
  });

  // 25. Two coordinates in different cells
  it("produces two separate bins for Seattle and LA at zoom 5", () => {
    const bins = binByGrid(
      [coord(47.6, -122.3), coord(34.0, -118.2)],
      5,
    );
    expect(bins).toHaveLength(2);
  });

  // 26. Bin centers are cell midpoints
  it("places bin centers at the midpoint of the degree cell", () => {
    const zoom = 0;
    const { lng: cellLng, lat: cellLat } = gridCellSize(zoom);
    const bins = binByGrid([coord(0, 0)], zoom);
    expect(bins).toHaveLength(1);
    // Origin cell (lat 0): floor(0/180)*180 = 0 → center = 0 + 90 = 90
    // Wait, at zoom 0 lat cell = 180, so floor(0/180)*180 = 0, center = 0+90 = 90
    // lng cell = 360: floor(0/360)*360 = 0, center = 0+180 = 180
    // Let's compute the expected center
    const originLng = Math.floor(0 / cellLng) * cellLng;
    const originLat = Math.floor(0 / cellLat) * cellLat;
    expect(bins[0].lng).toBeCloseTo(originLng + cellLng / 2, 5);
    expect(bins[0].lat).toBeCloseTo(originLat + cellLat / 2, 5);
  });

  // 27. tileX/tileY are undefined in grid mode
  it("does not include tileX or tileY on bins in grid mode", () => {
    const bins = binByGrid([coord(47.6, -122.3)], 5);
    expect(bins[0].tileX).toBeUndefined();
    expect(bins[0].tileY).toBeUndefined();
  });

  // 28. NaN/Infinity skipped
  it("skips non-finite coordinates", () => {
    const bins = binByGrid(
      [
        { lat: NaN, lng: 0 },
        { lat: 0, lng: Infinity },
        coord(47.6, -122.3),  // valid
      ],
      5,
    );
    expect(totalCount(bins)).toBe(1);
  });

  // 29. Total count equals valid input length
  it("preserves total count across all bins", () => {
    const coords: CaseCoordinate[] = [
      coord(47.6, -122.3),
      coord(47.6, -122.3),
      coord(34.0, -118.2),
    ];
    const bins = binByGrid(coords, 5);
    expect(totalCount(bins)).toBe(3);
  });

  it("produces finite lat/lng values for every bin center", () => {
    const bins = binByGrid(
      [coord(47.6, -122.3), coord(34.0, -118.2)],
      5,
    );
    for (const bin of bins) {
      expect(Number.isFinite(bin.lat)).toBe(true);
      expect(Number.isFinite(bin.lng)).toBe(true);
    }
  });

  it("is deterministic for repeated calls", () => {
    const coords = [coord(47.6, -122.3), coord(34.0, -118.2)];
    const sort = (bins: GridBin[]) =>
      [...bins].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
    expect(sort(binByGrid(coords, 8))).toEqual(sort(binByGrid(coords, 8)));
  });
});

// ─── Integration: binCaseLocations ↔ gridCellSize consistency ─────────────────

describe("binCaseLocations and gridCellSize consistency", () => {
  it("zoom step doubles the number of distinct bins for spread-out coordinates", () => {
    // Spread of 4 points in well-separated cardinal directions
    const coords: CaseCoordinate[] = [
      coord(60, 10),
      coord(60, -170),
      coord(-60, 10),
      coord(-60, -170),
    ];

    const bins5 = binCaseLocations(coords, 5);
    const bins6 = binCaseLocations(coords, 6);

    // At higher zoom, bins are smaller so we should get at least as many bins
    expect(bins6.length).toBeGreaterThanOrEqual(bins5.length);
  });

  it("every bin has a count >= 1", () => {
    const coords = Array.from({ length: 10 }, (_, i) =>
      coord(40 + i * 0.5, -100 + i * 0.5),
    );
    const bins = binCaseLocations(coords, 8);
    for (const bin of bins) {
      expect(bin.count).toBeGreaterThanOrEqual(1);
    }
  });
});
