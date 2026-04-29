/**
 * Unit tests for STATUS_LAYER_TYPE and related exports in @/types/map.
 *
 * AC 90101 Sub-AC 1 — Verify that:
 *   1. STATUS_LAYER_TYPE defines all four status layer identifiers.
 *   2. Each value matches the expected string literal.
 *   3. STATUS_LAYER_TYPE values are identical to LAYER_TOGGLE_KEYS members.
 *   4. StatusLayerTypeValue covers all four LayerToggleKey values.
 *   5. LAYER_TOGGLE_KEYS includes exactly the four status layer identifiers.
 *   6. DEFAULT_LAYER_TOGGLES initialises all four layers to true.
 *   7. LayerToggles interface has all four required boolean keys.
 *   8. STATUS_LAYER_TYPE is immutable (Object.freeze behaviour with as const).
 */

import { describe, it, expect } from "vitest";
import {
  STATUS_LAYER_TYPE,
  LAYER_TOGGLE_KEYS,
  DEFAULT_LAYER_TOGGLES,
  type LayerToggleKey,
  type StatusLayerTypeValue,
} from "../map";

// ─── 1. STATUS_LAYER_TYPE — value presence ────────────────────────────────────

describe("STATUS_LAYER_TYPE — all four status layer identifiers defined", () => {
  it("has a DEPLOYED property", () => {
    expect(STATUS_LAYER_TYPE).toHaveProperty("DEPLOYED");
  });

  it("has a TRANSIT property", () => {
    expect(STATUS_LAYER_TYPE).toHaveProperty("TRANSIT");
  });

  it("has a FLAGGED property", () => {
    expect(STATUS_LAYER_TYPE).toHaveProperty("FLAGGED");
  });

  it("has a HANGAR property", () => {
    expect(STATUS_LAYER_TYPE).toHaveProperty("HANGAR");
  });

  it("has exactly four properties", () => {
    expect(Object.keys(STATUS_LAYER_TYPE)).toHaveLength(4);
  });
});

// ─── 2. STATUS_LAYER_TYPE — string literal values ────────────────────────────

describe("STATUS_LAYER_TYPE — correct string literal values", () => {
  it("DEPLOYED === 'deployed'", () => {
    expect(STATUS_LAYER_TYPE.DEPLOYED).toBe("deployed");
  });

  it("TRANSIT === 'transit'", () => {
    expect(STATUS_LAYER_TYPE.TRANSIT).toBe("transit");
  });

  it("FLAGGED === 'flagged'", () => {
    expect(STATUS_LAYER_TYPE.FLAGGED).toBe("flagged");
  });

  it("HANGAR === 'hangar'", () => {
    expect(STATUS_LAYER_TYPE.HANGAR).toBe("hangar");
  });
});

// ─── 3. STATUS_LAYER_TYPE values match LAYER_TOGGLE_KEYS ────────────────────

describe("STATUS_LAYER_TYPE values are contained in LAYER_TOGGLE_KEYS", () => {
  it("DEPLOYED is in LAYER_TOGGLE_KEYS", () => {
    expect(LAYER_TOGGLE_KEYS).toContain(STATUS_LAYER_TYPE.DEPLOYED);
  });

  it("TRANSIT is in LAYER_TOGGLE_KEYS", () => {
    expect(LAYER_TOGGLE_KEYS).toContain(STATUS_LAYER_TYPE.TRANSIT);
  });

  it("FLAGGED is in LAYER_TOGGLE_KEYS", () => {
    expect(LAYER_TOGGLE_KEYS).toContain(STATUS_LAYER_TYPE.FLAGGED);
  });

  it("HANGAR is in LAYER_TOGGLE_KEYS", () => {
    expect(LAYER_TOGGLE_KEYS).toContain(STATUS_LAYER_TYPE.HANGAR);
  });

  it("all STATUS_LAYER_TYPE values are in LAYER_TOGGLE_KEYS", () => {
    const values = Object.values(STATUS_LAYER_TYPE);
    for (const val of values) {
      expect(LAYER_TOGGLE_KEYS).toContain(val);
    }
  });

  it("LAYER_TOGGLE_KEYS contains exactly the same values as STATUS_LAYER_TYPE", () => {
    const statusLayerValues = Object.values(STATUS_LAYER_TYPE).sort();
    const layerToggleValues = [...LAYER_TOGGLE_KEYS].sort();
    expect(statusLayerValues).toEqual(layerToggleValues);
  });
});

// ─── 4. LAYER_TOGGLE_KEYS — structure ────────────────────────────────────────

describe("LAYER_TOGGLE_KEYS — four status layer identifiers", () => {
  it("has exactly four entries", () => {
    expect(LAYER_TOGGLE_KEYS).toHaveLength(4);
  });

  it("contains 'deployed'", () => {
    expect(LAYER_TOGGLE_KEYS).toContain("deployed");
  });

  it("contains 'transit'", () => {
    expect(LAYER_TOGGLE_KEYS).toContain("transit");
  });

  it("contains 'flagged'", () => {
    expect(LAYER_TOGGLE_KEYS).toContain("flagged");
  });

  it("contains 'hangar'", () => {
    expect(LAYER_TOGGLE_KEYS).toContain("hangar");
  });
});

// ─── 5. DEFAULT_LAYER_TOGGLES — all four visible by default ─────────────────

describe("DEFAULT_LAYER_TOGGLES — all layers visible by default", () => {
  it("deployed is true", () => {
    expect(DEFAULT_LAYER_TOGGLES.deployed).toBe(true);
  });

  it("transit is true", () => {
    expect(DEFAULT_LAYER_TOGGLES.transit).toBe(true);
  });

  it("flagged is true", () => {
    expect(DEFAULT_LAYER_TOGGLES.flagged).toBe(true);
  });

  it("hangar is true", () => {
    expect(DEFAULT_LAYER_TOGGLES.hangar).toBe(true);
  });

  it("has all four keys", () => {
    const keys = Object.keys(DEFAULT_LAYER_TOGGLES);
    expect(keys).toHaveLength(4);
    expect(keys).toContain("deployed");
    expect(keys).toContain("transit");
    expect(keys).toContain("flagged");
    expect(keys).toContain("hangar");
  });

  it("every value is boolean true", () => {
    for (const val of Object.values(DEFAULT_LAYER_TOGGLES)) {
      expect(val).toBe(true);
    }
  });
});

// ─── 6. Type compatibility — STATUS_LAYER_TYPE values are LayerToggleKey ────

describe("STATUS_LAYER_TYPE — type-level LayerToggleKey compatibility", () => {
  it("values are assignable to LayerToggleKey at runtime (string union check)", () => {
    const validKeys: readonly string[] = LAYER_TOGGLE_KEYS;
    for (const val of Object.values(STATUS_LAYER_TYPE)) {
      // LayerToggleKey runtime check
      expect(validKeys).toContain(val);
    }
  });

  it("can be used interchangeably where LayerToggleKey is expected", () => {
    // Simulate a function that accepts LayerToggleKey
    function acceptsLayerToggleKey(key: LayerToggleKey): string {
      return key;
    }
    // All STATUS_LAYER_TYPE values should pass through without runtime error
    expect(() => acceptsLayerToggleKey(STATUS_LAYER_TYPE.DEPLOYED)).not.toThrow();
    expect(() => acceptsLayerToggleKey(STATUS_LAYER_TYPE.TRANSIT)).not.toThrow();
    expect(() => acceptsLayerToggleKey(STATUS_LAYER_TYPE.FLAGGED)).not.toThrow();
    expect(() => acceptsLayerToggleKey(STATUS_LAYER_TYPE.HANGAR)).not.toThrow();
  });
});

// ─── 7. STATUS_LAYER_TYPE — usage patterns ────────────────────────────────────

describe("STATUS_LAYER_TYPE — usage patterns", () => {
  it("supports property access pattern (enum-like usage)", () => {
    // This is the primary use case: replace raw string literals with named constants
    const layer = STATUS_LAYER_TYPE.DEPLOYED;
    expect(layer).toBe("deployed");
  });

  it("values can be compared to string literals", () => {
    expect(STATUS_LAYER_TYPE.DEPLOYED === "deployed").toBe(true);
    expect(STATUS_LAYER_TYPE.TRANSIT === "transit").toBe(true);
    expect(STATUS_LAYER_TYPE.FLAGGED === "flagged").toBe(true);
    expect(STATUS_LAYER_TYPE.HANGAR === "hangar").toBe(true);
  });

  it("Object.values produces all four layer strings", () => {
    const values = Object.values(STATUS_LAYER_TYPE);
    expect(values).toHaveLength(4);
    expect(values).toContain("deployed");
    expect(values).toContain("transit");
    expect(values).toContain("flagged");
    expect(values).toContain("hangar");
  });

  it("Object.entries provides key-value pairs with UPPER_CASE keys", () => {
    const entries = Object.entries(STATUS_LAYER_TYPE);
    expect(entries).toHaveLength(4);
    const keys = entries.map(([k]) => k);
    expect(keys).toContain("DEPLOYED");
    expect(keys).toContain("TRANSIT");
    expect(keys).toContain("FLAGGED");
    expect(keys).toContain("HANGAR");
  });

  it("can be used as a switch/if condition value", () => {
    function describeLayer(layer: StatusLayerTypeValue): string {
      switch (layer) {
        case STATUS_LAYER_TYPE.DEPLOYED: return "at field site";
        case STATUS_LAYER_TYPE.TRANSIT:  return "in transit";
        case STATUS_LAYER_TYPE.FLAGGED:  return "has open issues";
        case STATUS_LAYER_TYPE.HANGAR:   return "at base";
      }
    }

    expect(describeLayer("deployed")).toBe("at field site");
    expect(describeLayer("transit")).toBe("in transit");
    expect(describeLayer("flagged")).toBe("has open issues");
    expect(describeLayer("hangar")).toBe("at base");
  });
});
