/**
 * convex/lib/geo-bin.ts
 *
 * Geographic grid-cell binning utilities for server-side use within Convex
 * query functions.
 *
 * This is the server-side counterpart to `src/lib/geo-bin.ts`.  Convex
 * query/mutation functions cannot import from the Next.js `src/` tree, so
 * this module provides identical exports so that `convex/densityBins.ts`
 * (and any future Convex modules) can perform density binning without
 * duplicating the algorithm inline.
 *
 * Algorithm: Web Mercator tile-based binning
 * ──────────────────────────────────────────
 * Two coordinates map to the same bin when they occupy the same Web Mercator
 * tile at the given zoom level.  This aligns bin boundaries exactly with
 * Mapbox GL JS tile boundaries, which means:
 *
 *   1. Bin granularity increases naturally as the user zooms in.
 *   2. Cluster transitions are smooth — a zoom step always halves cell size.
 *   3. Bin center coordinates are deterministic and reproducible.
 *   4. No external library dependency; all math is pure IEEE 754 arithmetic.
 *
 * Tile coordinate formulas (Web Mercator / EPSG:3857):
 *
 *   tileX = floor((lng + 180) / 360 × 2^z)
 *   tileY = floor((1 − ln(tan(φ) + sec(φ)) / π) / 2 × 2^z)
 *     where φ = lat in radians
 *
 * Inverse (tile center to geographic coordinates):
 *
 *   lng_center = (tileX + 0.5) / 2^z × 360 − 180
 *   lat_center = atan(sinh(π × (1 − 2 × (tileY + 0.5) / 2^z))) × (180/π)
 *
 * @module convex/lib/geo-bin
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Input coordinate shape for `binCaseLocations`.
 *
 * Only `lat` and `lng` are required.  The optional `caseId` field is accepted
 * but not used by the binning logic — it is included to allow callers to pass
 * case pin objects directly without spreading/mapping.
 */
export interface CaseCoordinate {
  /** WGS-84 latitude in decimal degrees (−90 to +90). */
  lat: number;
  /** WGS-84 longitude in decimal degrees (−180 to +180). */
  lng: number;
  /** Optional case identifier — accepted but not used by the algorithm. */
  caseId?: string;
}

/**
 * A single geographic bin — the output unit of `binCaseLocations`.
 *
 * `lat` and `lng` are the geographic center of the bin cell (tile center in
 * Web Mercator coordinates, or degree-rounded center in grid mode).
 * `count` is the number of input coordinates that fall within this cell.
 *
 * The optional `tileX` / `tileY` fields are the raw integer tile coordinates
 * at the requested zoom level; they are useful for debugging and for driving
 * CSS cluster markers whose size scales with count.
 */
export interface GridBin {
  /** WGS-84 latitude of the bin center. */
  lat: number;
  /** WGS-84 longitude of the bin center. */
  lng: number;
  /** Count of cases whose coordinates fall within this bin. */
  count: number;
  /**
   * Web Mercator tile X index at the requested zoom level.
   * Included for debugging and downstream use; undefined in grid mode.
   */
  tileX?: number;
  /**
   * Web Mercator tile Y index at the requested zoom level.
   * Included for debugging and downstream use; undefined in grid mode.
   */
  tileY?: number;
}

// ─── Internal tile math ───────────────────────────────────────────────────────

/** Maximum supported zoom level (matches Mapbox GL JS upper bound). */
const MAX_ZOOM = 22;

/**
 * Convert a WGS-84 lat/lng pair to the integer Web Mercator tile coordinates
 * at the given zoom level.
 *
 * Latitude is clamped to the Mercator-valid range [−85.051129°, +85.051129°]
 * before conversion so that the ln(tan + sec) formula never produces ±Infinity.
 * Tile indices are clamped to [0, 2^zoom − 1] to handle the boundary cases
 * lng=180 and lat=−85.051129.
 *
 * @param lat   WGS-84 latitude in decimal degrees
 * @param lng   WGS-84 longitude in decimal degrees
 * @param zoom  Integer zoom level (0–22)
 * @returns     { tileX, tileY } integer tile indices
 *
 * @internal
 */
function latLngToTile(
  lat: number,
  lng: number,
  zoom: number,
): { tileX: number; tileY: number } {
  const tilesPerAxis = Math.pow(2, zoom);

  // Clamp longitude to [-180, 180]
  const clampedLng = Math.max(-180, Math.min(180, lng));

  // Clamp latitude to Mercator-valid range
  const clampedLat = Math.max(-85.051129, Math.min(85.051129, lat));
  const latRad = (clampedLat * Math.PI) / 180;

  // Standard slippy-map tile formula
  const tileX = Math.floor(((clampedLng + 180) / 360) * tilesPerAxis);
  const tileY = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      tilesPerAxis,
  );

  return {
    tileX: Math.max(0, Math.min(tilesPerAxis - 1, tileX)),
    tileY: Math.max(0, Math.min(tilesPerAxis - 1, tileY)),
  };
}

/**
 * Convert integer Web Mercator tile coordinates to the geographic center of
 * that tile (WGS-84 lat/lng).
 *
 * Uses `tileX + 0.5` and `tileY + 0.5` as the fractional tile position of
 * the center point, which is the standard convention for slippy-map tiles.
 *
 * @param tileX  Integer tile X index
 * @param tileY  Integer tile Y index
 * @param zoom   Integer zoom level (0–22)
 * @returns      { lat, lng } center coordinates in decimal degrees
 *
 * @internal
 */
function tileCenterToLatLng(
  tileX: number,
  tileY: number,
  zoom: number,
): { lat: number; lng: number } {
  const tilesPerAxis = Math.pow(2, zoom);

  const lng = ((tileX + 0.5) / tilesPerAxis) * 360 - 180;
  const n = Math.PI * (1 - (2 * (tileY + 0.5)) / tilesPerAxis);
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;

  return { lat, lng };
}

// ─── Primary export: Web Mercator tile binning ────────────────────────────────

/**
 * Bin an array of case location coordinates into geographic grid cells at the
 * specified map zoom level, using the Web Mercator (slippy-map) tile scheme.
 *
 * This is a **pure function** — it has no side effects, does not mutate its
 * inputs, and returns the same result for the same arguments every time.
 *
 * Coordinates that are missing, NaN, or ±Infinity are silently skipped.
 * Latitude values outside [−85.051129°, +85.051129°] are clamped to the
 * Mercator-valid range before binning (they still contribute to the count).
 *
 * Zoom level is floored to the nearest integer and clamped to [0, 22].
 * Non-integer zoom values (e.g. 8.7) are treated as floor(zoom) = 8.
 *
 * The output array is unordered — callers should sort by count descending if
 * they want to render the densest clusters first.
 *
 * @example
 * const bins = binCaseLocations(
 *   [
 *     { lat: 47.6, lng: -122.3, caseId: "c001" },
 *     { lat: 47.7, lng: -122.4, caseId: "c002" },
 *     { lat: 34.0, lng: -118.3, caseId: "c003" },
 *   ],
 *   8,
 * );
 * // Returns 2 bins: one for Seattle (count 2), one for LA (count 1)
 *
 * @param coordinates  Array of case coordinate objects (lat/lng required).
 * @param zoom         Mapbox GL JS zoom level (0–22; non-integers are floored).
 * @returns            Array of GridBin objects — one per occupied tile cell.
 */
export function binCaseLocations(
  coordinates: CaseCoordinate[],
  zoom: number,
): GridBin[] {
  // Normalise zoom to integer in [0, MAX_ZOOM]
  const z = Math.max(0, Math.min(MAX_ZOOM, Math.floor(zoom)));

  // Accumulate counts by tile key "tileX:tileY"
  const tileMap = new Map<
    string,
    { tileX: number; tileY: number; count: number }
  >();

  for (const coord of coordinates) {
    // Skip coordinates with non-finite values
    if (!Number.isFinite(coord.lat) || !Number.isFinite(coord.lng)) {
      continue;
    }

    const { tileX, tileY } = latLngToTile(coord.lat, coord.lng, z);
    const key = `${tileX}:${tileY}`;

    const existing = tileMap.get(key);
    if (existing !== undefined) {
      existing.count++;
    } else {
      tileMap.set(key, { tileX, tileY, count: 1 });
    }
  }

  // Convert tile map to GridBin array
  const result: GridBin[] = [];
  for (const { tileX, tileY, count } of tileMap.values()) {
    const { lat, lng } = tileCenterToLatLng(tileX, tileY, z);
    result.push({ lat, lng, count, tileX, tileY });
  }

  return result;
}

// ─── Secondary export: simple lat/lng degree-grid binning ─────────────────────

/**
 * Compute the degree-based grid cell size (in decimal degrees) for both
 * latitude and longitude at the given zoom level.
 *
 * The cell size is calibrated so that at zoom 0 a single cell covers
 * the entire map, matching the Web Mercator tile scheme's progression:
 *
 *   cellDegLng = 360 / 2^zoom
 *   cellDegLat = 180 / 2^zoom
 *
 * @example
 * gridCellSize(0)  // → { lng: 360, lat: 180 }
 * gridCellSize(5)  // → { lng: ~11.25, lat: ~5.625 }
 *
 * @param zoom  Integer zoom level (0–22; non-integers are floored).
 * @returns     Cell size in decimal degrees for lng and lat axes.
 */
export function gridCellSize(zoom: number): { lng: number; lat: number } {
  const z = Math.max(0, Math.min(MAX_ZOOM, Math.floor(zoom)));
  const cells = Math.pow(2, z);
  return {
    lng: 360 / cells,
    lat: 180 / cells,
  };
}

/**
 * Bin an array of case location coordinates into a simple rectilinear
 * lat/lng degree grid at the specified zoom level.
 *
 * Unlike `binCaseLocations` (which uses Web Mercator tile boundaries),
 * this function snaps coordinates to a uniform degree-grid.  The cell
 * size at each zoom level matches `gridCellSize(zoom)`.
 *
 * Bin centers are the midpoints of each degree-grid cell.
 *
 * Coordinates that are missing, NaN, or ±Infinity are silently skipped.
 *
 * @param coordinates  Array of coordinate objects (lat/lng required).
 * @param zoom         Zoom level (0–22; non-integers are floored).
 * @returns            Array of GridBin objects; tileX/tileY are undefined.
 */
export function binByGrid(
  coordinates: CaseCoordinate[],
  zoom: number,
): GridBin[] {
  const { lng: cellLng, lat: cellLat } = gridCellSize(zoom);

  // Half cell sizes used to compute cell centers
  const halfLng = cellLng / 2;
  const halfLat = cellLat / 2;

  const gridMap = new Map<string, { cellLng: number; cellLat: number; count: number }>();

  for (const coord of coordinates) {
    if (!Number.isFinite(coord.lat) || !Number.isFinite(coord.lng)) {
      continue;
    }

    // Snap to cell origin (south-west corner of the cell)
    const originLng = Math.floor(coord.lng / cellLng) * cellLng;
    const originLat = Math.floor(coord.lat / cellLat) * cellLat;
    const key = `${originLng}:${originLat}`;

    const existing = gridMap.get(key);
    if (existing !== undefined) {
      existing.count++;
    } else {
      gridMap.set(key, { cellLng: originLng, cellLat: originLat, count: 1 });
    }
  }

  const result: GridBin[] = [];
  for (const { cellLng: originLng, cellLat: originLat, count } of gridMap.values()) {
    result.push({
      lat: originLat + halfLat,
      lng: originLng + halfLng,
      count,
      // tileX / tileY are not computed in grid mode
    });
  }

  return result;
}
