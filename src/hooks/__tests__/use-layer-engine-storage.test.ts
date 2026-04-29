/**
 * Tests for useLayerEngineStorage — localStorage persistence for map layer state.
 *
 * Sub-AC 4: persists toggle preferences across sessions.
 *
 * Covers:
 *   1. readFromStorage — happy path: parses valid JSON
 *   2. readFromStorage — returns undefined for missing key
 *   3. readFromStorage — returns undefined for invalid JSON
 *   4. readFromStorage — filters out unknown layer IDs
 *   5. readFromStorage — filters out non-boolean values
 *   6. writeToStorage  — serialises only SemanticLayerId keys
 *   7. writeToStorage  — can be read back by readFromStorage
 *   8. clearFromStorage — removes the key
 *   9. buildStorageKey  — appends version suffix
 *  10. mergeWithDefaults — returns empty patch when stored is undefined
 *  11. mergeWithDefaults — only returns keys that have stored values
 *  12. LayerEngine + storage: toggle persisted and re-read correctly
 *  13. Quota / parse error safety — silently falls back
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  buildStorageKey,
  readFromStorage,
  writeToStorage,
  clearFromStorage,
  mergeWithDefaults,
} from "../use-layer-engine-storage";
import { LayerEngine } from "@/lib/layer-engine";
import { DEFAULT_LAYER_ENGINE_STATE, SEMANTIC_LAYER_IDS } from "@/types/layer-engine";
import type { LayerEngineState } from "@/types/layer-engine";

// ─── Setup ────────────────────────────────────────────────────────────────────

const TEST_BASE_KEY = "test-layer-visibility";
const TEST_STORAGE_KEY = buildStorageKey(TEST_BASE_KEY); // "test-layer-visibility:v1"

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ─── 1. readFromStorage — happy path ──────────────────────────────────────────

describe("readFromStorage — happy path", () => {
  it("reads a valid JSON blob and returns a partial state", () => {
    const stored: Partial<LayerEngineState> = {
      deployed: false,
      heat: true,
      history: true,
    };
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify(stored));

    const result = readFromStorage(TEST_STORAGE_KEY);

    expect(result).toEqual({ deployed: false, heat: true, history: true });
  });

  it("reads a full state object correctly", () => {
    const full: LayerEngineState = {
      deployed: true,
      transit: false,
      flagged: true,
      hangar: false,
      heat: true,
      history: false,
      turbines: true,
    };
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify(full));

    const result = readFromStorage(TEST_STORAGE_KEY);

    expect(result).toEqual(full);
  });
});

// ─── 2. readFromStorage — missing key ─────────────────────────────────────────

describe("readFromStorage — missing key", () => {
  it("returns undefined when the key does not exist in localStorage", () => {
    const result = readFromStorage("non-existent-key");
    expect(result).toBeUndefined();
  });

  it("returns undefined after clearFromStorage", () => {
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify({ deployed: false }));
    clearFromStorage(TEST_STORAGE_KEY);
    const result = readFromStorage(TEST_STORAGE_KEY);
    expect(result).toBeUndefined();
  });
});

// ─── 3. readFromStorage — invalid JSON ────────────────────────────────────────

describe("readFromStorage — invalid JSON", () => {
  it("returns undefined for malformed JSON", () => {
    localStorage.setItem(TEST_STORAGE_KEY, "not-json{{{");
    const result = readFromStorage(TEST_STORAGE_KEY);
    expect(result).toBeUndefined();
  });

  it("returns undefined for a JSON string (not an object)", () => {
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify("hello"));
    const result = readFromStorage(TEST_STORAGE_KEY);
    expect(result).toBeUndefined();
  });

  it("returns undefined for a JSON array", () => {
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify(["deployed", "heat"]));
    const result = readFromStorage(TEST_STORAGE_KEY);
    expect(result).toBeUndefined();
  });

  it("returns undefined for JSON null", () => {
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify(null));
    const result = readFromStorage(TEST_STORAGE_KEY);
    expect(result).toBeUndefined();
  });
});

// ─── 4. readFromStorage — filters unknown layer IDs ──────────────────────────

describe("readFromStorage — filters unknown layer IDs", () => {
  it("strips keys that are not valid SemanticLayerIds", () => {
    const payload = {
      deployed: true,
      unknownLayer: true,   // not a SemanticLayerId
      anotherBogus: false,  // not a SemanticLayerId
      heat: false,
    };
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify(payload));

    const result = readFromStorage(TEST_STORAGE_KEY);

    // Only valid layer IDs survive
    expect(result).toEqual({ deployed: true, heat: false });
    expect(result).not.toHaveProperty("unknownLayer");
    expect(result).not.toHaveProperty("anotherBogus");
  });

  it("returns undefined when all stored keys are unknown", () => {
    const payload = { notALayer: true, alsoNot: false };
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify(payload));
    const result = readFromStorage(TEST_STORAGE_KEY);
    expect(result).toBeUndefined();
  });
});

// ─── 5. readFromStorage — filters non-boolean values ─────────────────────────

describe("readFromStorage — filters non-boolean values", () => {
  it("strips keys with string values", () => {
    const payload = { deployed: "true", transit: true };
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify(payload));
    const result = readFromStorage(TEST_STORAGE_KEY);
    expect(result).toEqual({ transit: true }); // deployed stripped (string, not bool)
  });

  it("strips keys with numeric values", () => {
    const payload = { flagged: 1, hangar: false };
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify(payload));
    const result = readFromStorage(TEST_STORAGE_KEY);
    expect(result).toEqual({ hangar: false }); // flagged stripped (number)
  });

  it("strips keys with null values", () => {
    const payload = { turbines: null, heat: true };
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify(payload));
    const result = readFromStorage(TEST_STORAGE_KEY);
    expect(result).toEqual({ heat: true });
  });
});

// ─── 6. writeToStorage — serialises correctly ─────────────────────────────────

describe("writeToStorage", () => {
  it("writes a JSON object to localStorage under the given key", () => {
    const state: LayerEngineState = {
      deployed: true,
      transit: false,
      flagged: true,
      hangar: false,
      heat: true,
      history: false,
      turbines: true,
    };
    writeToStorage(TEST_STORAGE_KEY, state);

    const raw = localStorage.getItem(TEST_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toEqual(state);
  });

  it("only writes the 7 SemanticLayerId keys", () => {
    const state: LayerEngineState = { ...DEFAULT_LAYER_ENGINE_STATE };
    writeToStorage(TEST_STORAGE_KEY, state);

    const raw = localStorage.getItem(TEST_STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    const keys = Object.keys(parsed);

    expect(keys.sort()).toEqual([...SEMANTIC_LAYER_IDS].sort());
  });
});

// ─── 7. writeToStorage + readFromStorage round-trip ──────────────────────────

describe("writeToStorage + readFromStorage round-trip", () => {
  it("values written are correctly recovered", () => {
    const state: LayerEngineState = {
      deployed: false,
      transit: false,
      flagged: true,
      hangar: true,
      heat: true,
      history: true,
      turbines: false,
    };
    writeToStorage(TEST_STORAGE_KEY, state);
    const recovered = readFromStorage(TEST_STORAGE_KEY);

    // All 7 keys are present and correct
    for (const id of SEMANTIC_LAYER_IDS) {
      expect(recovered?.[id]).toBe(state[id]);
    }
  });

  it("default state round-trips correctly", () => {
    writeToStorage(TEST_STORAGE_KEY, DEFAULT_LAYER_ENGINE_STATE);
    const recovered = readFromStorage(TEST_STORAGE_KEY);
    expect(recovered).toEqual(DEFAULT_LAYER_ENGINE_STATE);
  });
});

// ─── 8. clearFromStorage ─────────────────────────────────────────────────────

describe("clearFromStorage", () => {
  it("removes the key from localStorage", () => {
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify({ deployed: false }));
    expect(localStorage.getItem(TEST_STORAGE_KEY)).not.toBeNull();

    clearFromStorage(TEST_STORAGE_KEY);
    expect(localStorage.getItem(TEST_STORAGE_KEY)).toBeNull();
  });

  it("is a no-op when the key does not exist", () => {
    // Should not throw
    expect(() => clearFromStorage("non-existent-key")).not.toThrow();
  });
});

// ─── 9. buildStorageKey — appends version suffix ──────────────────────────────

describe("buildStorageKey", () => {
  it("appends the version suffix to the base key", () => {
    const key = buildStorageKey("inv-layer-visibility");
    expect(key).toBe("inv-layer-visibility:v1");
  });

  it("works with any arbitrary base key", () => {
    const key = buildStorageKey("my-custom-key");
    expect(key).toMatch(/^my-custom-key:v\d+$/);
  });
});

// ─── 10. mergeWithDefaults — undefined stored ─────────────────────────────────

describe("mergeWithDefaults — undefined stored", () => {
  it("returns an empty patch object when stored is undefined", () => {
    const result = mergeWithDefaults(undefined);
    expect(result).toEqual({});
  });
});

// ─── 11. mergeWithDefaults — only returns stored keys ────────────────────────

describe("mergeWithDefaults — only returns stored keys", () => {
  it("returns a patch with only the keys that have stored values", () => {
    const stored: Partial<LayerEngineState> = {
      deployed: false,
      heat: true,
    };
    const result = mergeWithDefaults(stored);

    expect(result).toEqual({ deployed: false, heat: true });
    // No other keys
    expect(Object.keys(result).length).toBe(2);
  });

  it("returns a patch for all 7 keys when all are stored", () => {
    const stored: LayerEngineState = {
      deployed: false,
      transit: false,
      flagged: false,
      hangar: false,
      heat: true,
      history: true,
      turbines: false,
    };
    const result = mergeWithDefaults(stored);
    expect(result).toEqual(stored);
    expect(Object.keys(result).length).toBe(7);
  });
});

// ─── 12. LayerEngine + storage integration ───────────────────────────────────

describe("LayerEngine + storage integration", () => {
  it("toggle is persisted and correctly recovered on next engine load", () => {
    // Session 1: create an engine, toggle a layer, persist the state.
    const engine1 = new LayerEngine();
    engine1.subscribe((state) => writeToStorage(TEST_STORAGE_KEY, state));

    // Initial: deployed = true (default)
    expect(engine1.isVisible("deployed")).toBe(true);

    // Toggle deployed OFF
    engine1.toggle("deployed");
    expect(engine1.isVisible("deployed")).toBe(false);

    // The subscriber should have written to storage.
    const stored = readFromStorage(TEST_STORAGE_KEY);
    expect(stored?.deployed).toBe(false);

    // Session 2: create a new engine with the stored state.
    const storedPartial = mergeWithDefaults(stored);
    const engine2 = new LayerEngine(storedPartial);

    // deployed should be OFF (as persisted)
    expect(engine2.isVisible("deployed")).toBe(false);
    // Other layers should remain at their defaults
    expect(engine2.isVisible("transit")).toBe(DEFAULT_LAYER_ENGINE_STATE.transit);
    expect(engine2.isVisible("flagged")).toBe(DEFAULT_LAYER_ENGINE_STATE.flagged);
    expect(engine2.isVisible("heat")).toBe(DEFAULT_LAYER_ENGINE_STATE.heat);
  });

  it("all 7 layers persist through a writeToStorage + readFromStorage cycle", () => {
    const engine1 = new LayerEngine();

    // Turn all layers on
    engine1.activateAll();
    writeToStorage(TEST_STORAGE_KEY, engine1.getState());

    // Recover
    const stored = readFromStorage(TEST_STORAGE_KEY);
    const engine2 = new LayerEngine(mergeWithDefaults(stored));

    for (const id of SEMANTIC_LAYER_IDS) {
      expect(engine2.isVisible(id)).toBe(true);
    }
  });

  it("reset + persist correctly restores default state in a new engine", () => {
    const engine1 = new LayerEngine();
    engine1.activateAll(); // turn everything on
    engine1.reset();       // reset to defaults

    writeToStorage(TEST_STORAGE_KEY, engine1.getState());

    const stored = readFromStorage(TEST_STORAGE_KEY);
    const engine2 = new LayerEngine(mergeWithDefaults(stored));

    // After reset, defaults should apply — heat and history are OFF
    expect(engine2.isVisible("heat")).toBe(false);
    expect(engine2.isVisible("history")).toBe(false);
    expect(engine2.isVisible("deployed")).toBe(true);
  });
});

// ─── 13. Quota / parse error safety ──────────────────────────────────────────

describe("storage error safety", () => {
  it("readFromStorage returns undefined when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    expect(() => readFromStorage(TEST_STORAGE_KEY)).not.toThrow();
    expect(readFromStorage(TEST_STORAGE_KEY)).toBeUndefined();
  });

  it("writeToStorage is a no-op when localStorage.setItem throws (quota exceeded)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() =>
      writeToStorage(TEST_STORAGE_KEY, DEFAULT_LAYER_ENGINE_STATE)
    ).not.toThrow();
  });

  it("clearFromStorage is a no-op when localStorage.removeItem throws", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    expect(() => clearFromStorage(TEST_STORAGE_KEY)).not.toThrow();
  });
});
