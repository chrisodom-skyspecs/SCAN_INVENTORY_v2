/**
 * Unit tests for the map mode registry (map-mode-registry.ts).
 *
 * Covers:
 *   • MAP_MODE_REGISTRY — structure, completeness, field types
 *   • getMapModeDef    — returns correct def, throws for unknown IDs
 *   • findMapModeDef   — safe variant, returns undefined for unknown IDs
 *   • getMapModesByGroup — filters by group correctly
 *   • getMapModeIds    — returns all 5 IDs in order
 *   • getDefaultActiveModes — returns only defaultActive:true modes
 *   • getFeatureFlaggedModes — returns only feature-flag-gated modes
 *   • getAccessibleModes — respects active flag set
 *   • getDefaultMapMode — always returns M1
 *   • Feature flag M5 is properly gated by FF_MAP_MISSION
 *   • Core modes M1-M4 have no feature flag
 *   • Group membership: M1-M4 = "core", M5 = "mission"
 */

import { describe, it, expect } from "vitest";

import {
  MAP_MODE_REGISTRY,
  getMapModeDef,
  findMapModeDef,
  getMapModesByGroup,
  getMapModeIds,
  getDefaultActiveModes,
  getFeatureFlaggedModes,
  getAccessibleModes,
  getDefaultMapMode,
} from "../map-mode-registry";
import { MAP_VIEW_VALUES } from "@/types/map";
import type { MapView } from "@/types/map";

// ─── MAP_MODE_REGISTRY structure ──────────────────────────────────────────────

describe("MAP_MODE_REGISTRY", () => {
  it("contains exactly 5 entries (one per map mode)", () => {
    expect(MAP_MODE_REGISTRY).toHaveLength(5);
  });

  it("contains entries for all 5 MapView values (M1-M5)", () => {
    const registryIds = new Set(MAP_MODE_REGISTRY.map((d) => d.id));
    for (const view of MAP_VIEW_VALUES) {
      expect(registryIds.has(view)).toBe(true);
    }
  });

  it("each entry has the required fields", () => {
    for (const def of MAP_MODE_REGISTRY) {
      expect(MAP_VIEW_VALUES).toContain(def.id);
      expect(typeof def.label).toBe("string");
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.label.length).toBeLessThanOrEqual(20);
      expect(typeof def.description).toBe("string");
      expect(def.description.length).toBeGreaterThan(0);
      expect(["core", "mission"]).toContain(def.group);
      expect(typeof def.defaultActive).toBe("boolean");
      expect(typeof def.order).toBe("number");
    }
  });

  it("entries are sorted by order (ascending, 0-first)", () => {
    const orders = MAP_MODE_REGISTRY.map((d) => d.order);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]);
    }
  });

  it("each ID appears exactly once", () => {
    const ids = MAP_MODE_REGISTRY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("M1 has order 0 (first in the picker)", () => {
    const m1 = MAP_MODE_REGISTRY.find((d) => d.id === "M1");
    expect(m1?.order).toBe(0);
  });

  it("M5 has order 4 (last in the picker)", () => {
    const m5 = MAP_MODE_REGISTRY.find((d) => d.id === "M5");
    expect(m5?.order).toBe(4);
  });
});

// ─── defaultActive field ──────────────────────────────────────────────────────

describe("MAP_MODE_REGISTRY — defaultActive", () => {
  it("M1, M2, M3, M4 are defaultActive (accessible without flags)", () => {
    const coreIds: MapView[] = ["M1", "M2", "M3", "M4"];
    for (const id of coreIds) {
      const def = MAP_MODE_REGISTRY.find((d) => d.id === id);
      expect(def?.defaultActive).toBe(true);
    }
  });

  it("M5 is NOT defaultActive (requires FF_MAP_MISSION)", () => {
    const m5 = MAP_MODE_REGISTRY.find((d) => d.id === "M5");
    expect(m5?.defaultActive).toBe(false);
  });
});

// ─── group field ──────────────────────────────────────────────────────────────

describe("MAP_MODE_REGISTRY — group", () => {
  it("M1-M4 belong to the 'core' group", () => {
    const coreIds: MapView[] = ["M1", "M2", "M3", "M4"];
    for (const id of coreIds) {
      const def = MAP_MODE_REGISTRY.find((d) => d.id === id);
      expect(def?.group).toBe("core");
    }
  });

  it("M5 belongs to the 'mission' group", () => {
    const m5 = MAP_MODE_REGISTRY.find((d) => d.id === "M5");
    expect(m5?.group).toBe("mission");
  });
});

// ─── featureFlag field ────────────────────────────────────────────────────────

describe("MAP_MODE_REGISTRY — featureFlag", () => {
  it("M5 requires the FF_MAP_MISSION feature flag", () => {
    const m5 = MAP_MODE_REGISTRY.find((d) => d.id === "M5");
    expect(m5?.featureFlag).toBe("FF_MAP_MISSION");
  });

  it("M1-M4 do NOT have a featureFlag (always available)", () => {
    const coreIds: MapView[] = ["M1", "M2", "M3", "M4"];
    for (const id of coreIds) {
      const def = MAP_MODE_REGISTRY.find((d) => d.id === id);
      expect(def?.featureFlag).toBeUndefined();
    }
  });
});

// ─── getMapModeDef ────────────────────────────────────────────────────────────

describe("getMapModeDef", () => {
  it("returns the correct definition for each valid ID", () => {
    for (const view of MAP_VIEW_VALUES) {
      const def = getMapModeDef(view);
      expect(def.id).toBe(view);
    }
  });

  it("returns a definition with all required fields", () => {
    const def = getMapModeDef("M1");
    expect(def.id).toBe("M1");
    expect(typeof def.label).toBe("string");
    expect(typeof def.description).toBe("string");
    expect(typeof def.group).toBe("string");
    expect(typeof def.defaultActive).toBe("boolean");
    expect(typeof def.order).toBe("number");
  });

  it("throws for unknown IDs", () => {
    expect(() =>
      getMapModeDef("M6" as MapView)
    ).toThrow(/Unknown map mode ID/);
  });

  it("throws with a helpful error message listing valid IDs", () => {
    expect(() =>
      getMapModeDef("XX" as MapView)
    ).toThrow(/M1.*M2.*M3.*M4.*M5/);
  });
});

// ─── findMapModeDef ───────────────────────────────────────────────────────────

describe("findMapModeDef", () => {
  it("returns the definition for valid IDs", () => {
    expect(findMapModeDef("M1")).toBeDefined();
    expect(findMapModeDef("M1")?.id).toBe("M1");
    expect(findMapModeDef("M5")).toBeDefined();
    expect(findMapModeDef("M5")?.id).toBe("M5");
  });

  it("returns undefined for unknown strings", () => {
    expect(findMapModeDef("M6")).toBeUndefined();
    expect(findMapModeDef("unknown")).toBeUndefined();
    expect(findMapModeDef("")).toBeUndefined();
    expect(findMapModeDef("m1")).toBeUndefined(); // case-sensitive
  });

  it("does NOT throw for invalid input", () => {
    expect(() => findMapModeDef("invalid")).not.toThrow();
  });
});

// ─── getMapModesByGroup ───────────────────────────────────────────────────────

describe("getMapModesByGroup", () => {
  it("returns exactly 4 modes for group 'core'", () => {
    const coreModes = getMapModesByGroup("core");
    expect(coreModes).toHaveLength(4);
  });

  it("returns exactly 1 mode for group 'mission'", () => {
    const missionModes = getMapModesByGroup("mission");
    expect(missionModes).toHaveLength(1);
  });

  it("'core' group contains M1, M2, M3, M4", () => {
    const ids = getMapModesByGroup("core").map((d) => d.id);
    expect(ids).toContain("M1");
    expect(ids).toContain("M2");
    expect(ids).toContain("M3");
    expect(ids).toContain("M4");
    expect(ids).not.toContain("M5");
  });

  it("'mission' group contains only M5", () => {
    const ids = getMapModesByGroup("mission").map((d) => d.id);
    expect(ids).toContain("M5");
    expect(ids).not.toContain("M1");
  });

  it("all modes from both groups cover all 5 MapView values", () => {
    const coreIds = getMapModesByGroup("core").map((d) => d.id);
    const missionIds = getMapModesByGroup("mission").map((d) => d.id);
    const allIds = [...coreIds, ...missionIds];
    expect(new Set(allIds).size).toBe(5);
    for (const view of MAP_VIEW_VALUES) {
      expect(allIds).toContain(view);
    }
  });
});

// ─── getMapModeIds ────────────────────────────────────────────────────────────

describe("getMapModeIds", () => {
  it("returns all 5 IDs", () => {
    expect(getMapModeIds()).toHaveLength(5);
  });

  it("returns IDs in registry order (M1 first, M5 last)", () => {
    const ids = getMapModeIds();
    expect(ids[0]).toBe("M1");
    expect(ids[4]).toBe("M5");
  });

  it("covers all MAP_VIEW_VALUES", () => {
    const ids = getMapModeIds();
    for (const view of MAP_VIEW_VALUES) {
      expect(ids).toContain(view);
    }
  });
});

// ─── getDefaultActiveModes ────────────────────────────────────────────────────

describe("getDefaultActiveModes", () => {
  it("returns exactly 4 modes", () => {
    expect(getDefaultActiveModes()).toHaveLength(4);
  });

  it("contains M1, M2, M3, M4", () => {
    const ids = getDefaultActiveModes().map((d) => d.id);
    expect(ids).toContain("M1");
    expect(ids).toContain("M2");
    expect(ids).toContain("M3");
    expect(ids).toContain("M4");
  });

  it("does NOT contain M5", () => {
    const ids = getDefaultActiveModes().map((d) => d.id);
    expect(ids).not.toContain("M5");
  });

  it("all returned modes have defaultActive=true", () => {
    for (const def of getDefaultActiveModes()) {
      expect(def.defaultActive).toBe(true);
    }
  });
});

// ─── getFeatureFlaggedModes ───────────────────────────────────────────────────

describe("getFeatureFlaggedModes", () => {
  it("returns exactly 1 mode (M5)", () => {
    expect(getFeatureFlaggedModes()).toHaveLength(1);
  });

  it("returns M5 with the FF_MAP_MISSION flag", () => {
    const modes = getFeatureFlaggedModes();
    expect(modes[0].id).toBe("M5");
    expect(modes[0].featureFlag).toBe("FF_MAP_MISSION");
  });

  it("all returned modes have a featureFlag defined", () => {
    for (const def of getFeatureFlaggedModes()) {
      expect(def.featureFlag).toBeDefined();
    }
  });
});

// ─── getAccessibleModes ───────────────────────────────────────────────────────

describe("getAccessibleModes", () => {
  it("returns 4 modes when no flags are active", () => {
    const modes = getAccessibleModes(new Set());
    expect(modes).toHaveLength(4);
  });

  it("returns all 5 modes when FF_MAP_MISSION is active", () => {
    const modes = getAccessibleModes(new Set(["FF_MAP_MISSION"]));
    expect(modes).toHaveLength(5);
  });

  it("includes M5 when FF_MAP_MISSION is in the active flags", () => {
    const modes = getAccessibleModes(new Set(["FF_MAP_MISSION"]));
    expect(modes.map((d) => d.id)).toContain("M5");
  });

  it("excludes M5 when FF_MAP_MISSION is NOT in the active flags", () => {
    const modes = getAccessibleModes(new Set(["OTHER_FLAG"]));
    expect(modes.map((d) => d.id)).not.toContain("M5");
  });

  it("always includes core modes (M1-M4) regardless of flags", () => {
    const coreIds: MapView[] = ["M1", "M2", "M3", "M4"];
    // No flags
    const modesNoFlags = getAccessibleModes(new Set());
    for (const id of coreIds) {
      expect(modesNoFlags.map((d) => d.id)).toContain(id);
    }
    // With a random flag
    const modesWithFlag = getAccessibleModes(new Set(["SOME_OTHER_FLAG"]));
    for (const id of coreIds) {
      expect(modesWithFlag.map((d) => d.id)).toContain(id);
    }
  });

  it("returns only defaultActive modes when flags set is empty", () => {
    const accessible = getAccessibleModes(new Set());
    const defaultActive = getDefaultActiveModes();
    expect(accessible.map((d) => d.id).sort()).toEqual(
      defaultActive.map((d) => d.id).sort()
    );
  });
});

// ─── getDefaultMapMode ────────────────────────────────────────────────────────

describe("getDefaultMapMode", () => {
  it("returns the M1 definition", () => {
    expect(getDefaultMapMode().id).toBe("M1");
  });

  it("returns a mode with defaultActive=true", () => {
    expect(getDefaultMapMode().defaultActive).toBe(true);
  });

  it("returns a mode with group='core'", () => {
    expect(getDefaultMapMode().group).toBe("core");
  });

  it("returns the same object as MAP_MODE_REGISTRY[0]", () => {
    expect(getDefaultMapMode()).toBe(MAP_MODE_REGISTRY[0]);
  });
});
