/**
 * @vitest-environment jsdom
 *
 * Unit tests: layout-storage.ts — localStorage read/write helpers for
 * layout preferences (map mode M1–M5, case layout T1–T5) keyed by userId.
 *
 * Tests:
 *
 *   Constants
 *     1.  MAP_MODE_STORAGE_KEY_PREFIX equals "inv_map_mode:".
 *     2.  CASE_LAYOUT_STORAGE_KEY_PREFIX equals "inv_case_layout:".
 *     3.  MAP_MODE_VALUES contains exactly ["M1","M2","M3","M4","M5"].
 *     4.  CASE_LAYOUT_VALUES contains exactly ["T1","T2","T3","T4","T5"].
 *
 *   Key builders
 *     5.  mapModeStorageKey("user_abc") → "inv_map_mode:user_abc".
 *     6.  caseLayoutStorageKey("user_abc") → "inv_case_layout:user_abc".
 *     7.  Key builders incorporate the full userId (including special chars).
 *
 *   Validators
 *     8.  isMapMode returns true for each of M1–M5.
 *     9.  isMapMode returns false for invalid strings ("M6", "", "m1").
 *    10.  isCaseLayout returns true for each of T1–T5.
 *    11.  isCaseLayout returns false for invalid strings ("T6", "", "t1").
 *
 *   readMapMode — normal cases
 *    12.  Returns null when localStorage is empty (no stored value).
 *    13.  Returns "M1" when localStorage["inv_map_mode:uid"] = "M1".
 *    14.  Returns "M5" when localStorage["inv_map_mode:uid"] = "M5".
 *    15.  Each of M1–M5 is returned correctly from localStorage.
 *
 *   readMapMode — invalid / corrupt stored values
 *    16.  Returns null when stored value is "M6" (out of range).
 *    17.  Returns null when stored value is "m1" (wrong case).
 *    18.  Returns null when stored value is "" (empty string).
 *    19.  Returns null when stored value is "null" (stringified null).
 *    20.  Returns null when stored value is "1" (number-like string).
 *
 *   readMapMode — userId edge cases
 *    21.  Returns null when userId is "" (empty string).
 *    22.  Returns null when userId is "   " (whitespace-only).
 *    23.  Different userIds return independent values.
 *    24.  Does NOT read another user's preference when userId differs.
 *
 *   readMapMode — SSR guard
 *    25.  Returns null when window is undefined (SSR environment).
 *
 *   readMapMode — localStorage error handling
 *    26.  Returns null when localStorage.getItem throws.
 *
 *   writeMapMode — normal cases
 *    27.  Writes "M1" to the correct scoped key.
 *    28.  Writes "M5" to the correct scoped key.
 *    29.  Overwrites a previous map mode when called a second time.
 *    30.  Uses the userId-scoped key (not a flat key).
 *
 *   writeMapMode — userId edge cases
 *    31.  No-op when userId is "" (does not call localStorage.setItem).
 *    32.  No-op when userId is "   " (whitespace-only).
 *    33.  Different userIds write to independent keys.
 *
 *   writeMapMode — error handling
 *    34.  Does not throw when localStorage.setItem throws.
 *
 *   readCaseLayout — normal cases
 *    35.  Returns null when localStorage is empty (no stored value).
 *    36.  Returns "T1" when localStorage["inv_case_layout:uid"] = "T1".
 *    37.  Returns "T5" when localStorage["inv_case_layout:uid"] = "T5".
 *    38.  Each of T1–T5 is returned correctly from localStorage.
 *
 *   readCaseLayout — invalid / corrupt stored values
 *    39.  Returns null when stored value is "T6" (out of range).
 *    40.  Returns null when stored value is "t1" (wrong case).
 *    41.  Returns null when stored value is "" (empty string).
 *    42.  Returns null when stored value is "null" (stringified null).
 *
 *   readCaseLayout — userId edge cases
 *    43.  Returns null when userId is "" (empty string).
 *    44.  Returns null when userId is "   " (whitespace-only).
 *    45.  Different userIds return independent case layout values.
 *
 *   readCaseLayout — SSR guard
 *    46.  Returns null when window is undefined (SSR environment).
 *
 *   readCaseLayout — localStorage error handling
 *    47.  Returns null when localStorage.getItem throws.
 *
 *   writeCaseLayout — normal cases
 *    48.  Writes "T1" to the correct scoped key.
 *    49.  Writes "T5" to the correct scoped key.
 *    50.  Overwrites a previous case layout when called a second time.
 *    51.  Uses the userId-scoped key (not a flat key).
 *
 *   writeCaseLayout — userId edge cases
 *    52.  No-op when userId is "" (does not call localStorage.setItem).
 *    53.  No-op when userId is "   " (whitespace-only).
 *    54.  Different userIds write to independent keys.
 *
 *   writeCaseLayout — error handling
 *    55.  Does not throw when localStorage.setItem throws.
 *
 *   Round-trip — map mode
 *    56.  writeMapMode then readMapMode returns the same value.
 *    57.  writeMapMode("M1") then writeMapMode("M5") then readMapMode returns "M5".
 *    58.  Round-trip for each of M1–M5.
 *
 *   Round-trip — case layout
 *    59.  writeCaseLayout then readCaseLayout returns the same value.
 *    60.  writeCaseLayout("T1") then writeCaseLayout("T5") then readCaseLayout returns "T5".
 *    61.  Round-trip for each of T1–T5.
 *
 *   Cross-preference isolation
 *    62.  writeMapMode does NOT affect readCaseLayout for the same user.
 *    63.  writeCaseLayout does NOT affect readMapMode for the same user.
 *
 *   Multi-user isolation
 *    64.  Writes for user A do not affect reads for user B (map mode).
 *    65.  Writes for user A do not affect reads for user B (case layout).
 *    66.  Both users can hold different map modes simultaneously.
 *    67.  Both users can hold different case layouts simultaneously.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  MAP_MODE_STORAGE_KEY_PREFIX,
  CASE_LAYOUT_STORAGE_KEY_PREFIX,
  MAP_MODE_VALUES,
  CASE_LAYOUT_VALUES,
  mapModeStorageKey,
  caseLayoutStorageKey,
  isMapMode,
  isCaseLayout,
  readMapMode,
  writeMapMode,
  readCaseLayout,
  writeCaseLayout,
  type MapMode,
  type CaseLayout,
} from "../layout-storage";

// ─── localStorage mock ────────────────────────────────────────────────────────

let _store: Record<string, string> = {};

const localStorageMock = {
  getItem: vi.fn((key: string): string | null => _store[key] ?? null),
  setItem: vi.fn((key: string, value: string): void => {
    _store[key] = value;
  }),
  removeItem: vi.fn((key: string): void => {
    delete _store[key];
  }),
  clear: vi.fn((): void => {
    _store = {};
  }),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _store = {};
  vi.clearAllMocks();
  // Re-apply default implementations after vi.clearAllMocks() clears them.
  localStorageMock.getItem.mockImplementation(
    (key: string): string | null => _store[key] ?? null,
  );
  localStorageMock.setItem.mockImplementation(
    (key: string, value: string): void => {
      _store[key] = value;
    },
  );
});

afterEach(() => {
  _store = {};
});

// ─── Shared test user IDs ─────────────────────────────────────────────────────

const USER_A = "user_alice_123";
const USER_B = "user_bob_456";

// ─── Constants ────────────────────────────────────────────────────────────────

describe("MAP_MODE_STORAGE_KEY_PREFIX", () => {
  it("equals 'inv_map_mode:'", () => {
    expect(MAP_MODE_STORAGE_KEY_PREFIX).toBe("inv_map_mode:");
  });
});

describe("CASE_LAYOUT_STORAGE_KEY_PREFIX", () => {
  it("equals 'inv_case_layout:'", () => {
    expect(CASE_LAYOUT_STORAGE_KEY_PREFIX).toBe("inv_case_layout:");
  });
});

describe("MAP_MODE_VALUES", () => {
  it("contains exactly ['M1','M2','M3','M4','M5']", () => {
    expect([...MAP_MODE_VALUES]).toEqual(["M1", "M2", "M3", "M4", "M5"]);
  });

  it("has exactly 5 entries", () => {
    expect(MAP_MODE_VALUES).toHaveLength(5);
  });
});

describe("CASE_LAYOUT_VALUES", () => {
  it("contains exactly ['T1','T2','T3','T4','T5']", () => {
    expect([...CASE_LAYOUT_VALUES]).toEqual(["T1", "T2", "T3", "T4", "T5"]);
  });

  it("has exactly 5 entries", () => {
    expect(CASE_LAYOUT_VALUES).toHaveLength(5);
  });
});

// ─── Key builders ─────────────────────────────────────────────────────────────

describe("mapModeStorageKey", () => {
  it("returns 'inv_map_mode:user_abc' for userId 'user_abc'", () => {
    expect(mapModeStorageKey("user_abc")).toBe("inv_map_mode:user_abc");
  });

  it("incorporates the full userId string", () => {
    expect(mapModeStorageKey("some-user@org.example.com")).toBe(
      "inv_map_mode:some-user@org.example.com",
    );
  });

  it("produces distinct keys for different userIds", () => {
    const keyA = mapModeStorageKey(USER_A);
    const keyB = mapModeStorageKey(USER_B);
    expect(keyA).not.toBe(keyB);
  });
});

describe("caseLayoutStorageKey", () => {
  it("returns 'inv_case_layout:user_abc' for userId 'user_abc'", () => {
    expect(caseLayoutStorageKey("user_abc")).toBe("inv_case_layout:user_abc");
  });

  it("incorporates the full userId string", () => {
    expect(caseLayoutStorageKey("some-user@org.example.com")).toBe(
      "inv_case_layout:some-user@org.example.com",
    );
  });

  it("produces distinct keys for different userIds", () => {
    const keyA = caseLayoutStorageKey(USER_A);
    const keyB = caseLayoutStorageKey(USER_B);
    expect(keyA).not.toBe(keyB);
  });
});

// ─── Validators ───────────────────────────────────────────────────────────────

describe("isMapMode", () => {
  it("returns true for 'M1'", () => expect(isMapMode("M1")).toBe(true));
  it("returns true for 'M2'", () => expect(isMapMode("M2")).toBe(true));
  it("returns true for 'M3'", () => expect(isMapMode("M3")).toBe(true));
  it("returns true for 'M4'", () => expect(isMapMode("M4")).toBe(true));
  it("returns true for 'M5'", () => expect(isMapMode("M5")).toBe(true));

  it("returns false for 'M6' (out of range)", () => {
    expect(isMapMode("M6")).toBe(false);
  });

  it("returns false for '' (empty string)", () => {
    expect(isMapMode("")).toBe(false);
  });

  it("returns false for 'm1' (lowercase)", () => {
    expect(isMapMode("m1")).toBe(false);
  });

  it("returns false for 'M0' (below range)", () => {
    expect(isMapMode("M0")).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isMapMode(1)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isMapMode(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isMapMode(undefined)).toBe(false);
  });
});

describe("isCaseLayout", () => {
  it("returns true for 'T1'", () => expect(isCaseLayout("T1")).toBe(true));
  it("returns true for 'T2'", () => expect(isCaseLayout("T2")).toBe(true));
  it("returns true for 'T3'", () => expect(isCaseLayout("T3")).toBe(true));
  it("returns true for 'T4'", () => expect(isCaseLayout("T4")).toBe(true));
  it("returns true for 'T5'", () => expect(isCaseLayout("T5")).toBe(true));

  it("returns false for 'T6' (out of range)", () => {
    expect(isCaseLayout("T6")).toBe(false);
  });

  it("returns false for '' (empty string)", () => {
    expect(isCaseLayout("")).toBe(false);
  });

  it("returns false for 't1' (lowercase)", () => {
    expect(isCaseLayout("t1")).toBe(false);
  });

  it("returns false for 'T0' (below range)", () => {
    expect(isCaseLayout("T0")).toBe(false);
  });

  it("returns false for a number", () => {
    expect(isCaseLayout(1)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isCaseLayout(null)).toBe(false);
  });
});

// ─── readMapMode — normal cases ───────────────────────────────────────────────

describe("readMapMode — normal cases", () => {
  it("returns null when localStorage is empty", () => {
    expect(readMapMode(USER_A)).toBeNull();
  });

  it("returns 'M1' when localStorage has 'M1'", () => {
    _store[mapModeStorageKey(USER_A)] = "M1";
    expect(readMapMode(USER_A)).toBe("M1");
  });

  it("returns 'M5' when localStorage has 'M5'", () => {
    _store[mapModeStorageKey(USER_A)] = "M5";
    expect(readMapMode(USER_A)).toBe("M5");
  });

  it("correctly returns each of M1–M5", () => {
    const modes: MapMode[] = ["M1", "M2", "M3", "M4", "M5"];
    for (const mode of modes) {
      _store[mapModeStorageKey(USER_A)] = mode;
      expect(readMapMode(USER_A)).toBe(mode);
    }
  });
});

// ─── readMapMode — invalid / corrupt stored values ────────────────────────────

describe("readMapMode — invalid / corrupt stored values", () => {
  it("returns null when stored value is 'M6' (out of range)", () => {
    _store[mapModeStorageKey(USER_A)] = "M6";
    expect(readMapMode(USER_A)).toBeNull();
  });

  it("returns null when stored value is 'm1' (wrong case)", () => {
    _store[mapModeStorageKey(USER_A)] = "m1";
    expect(readMapMode(USER_A)).toBeNull();
  });

  it("returns null when stored value is '' (empty string)", () => {
    _store[mapModeStorageKey(USER_A)] = "";
    expect(readMapMode(USER_A)).toBeNull();
  });

  it("returns null when stored value is 'null' (stringified null)", () => {
    _store[mapModeStorageKey(USER_A)] = "null";
    expect(readMapMode(USER_A)).toBeNull();
  });

  it("returns null when stored value is '1' (number-like string)", () => {
    _store[mapModeStorageKey(USER_A)] = "1";
    expect(readMapMode(USER_A)).toBeNull();
  });

  it("returns null when stored value is 'M 1' (with space)", () => {
    _store[mapModeStorageKey(USER_A)] = "M 1";
    expect(readMapMode(USER_A)).toBeNull();
  });
});

// ─── readMapMode — userId edge cases ─────────────────────────────────────────

describe("readMapMode — userId edge cases", () => {
  it("returns null when userId is '' (empty string)", () => {
    expect(readMapMode("")).toBeNull();
  });

  it("returns null when userId is '   ' (whitespace-only)", () => {
    expect(readMapMode("   ")).toBeNull();
  });

  it("different userIds return independent values", () => {
    _store[mapModeStorageKey(USER_A)] = "M2";
    _store[mapModeStorageKey(USER_B)] = "M4";
    expect(readMapMode(USER_A)).toBe("M2");
    expect(readMapMode(USER_B)).toBe("M4");
  });

  it("does NOT read another user's preference when userId differs", () => {
    _store[mapModeStorageKey(USER_A)] = "M3";
    // USER_B has no stored value
    expect(readMapMode(USER_B)).toBeNull();
  });
});

// ─── readMapMode — SSR guard ──────────────────────────────────────────────────

describe("readMapMode — SSR guard", () => {
  it("returns null when window is undefined (SSR environment)", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error — simulating SSR by removing window
    delete globalThis.window;
    try {
      expect(readMapMode(USER_A)).toBeNull();
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

// ─── readMapMode — localStorage error handling ────────────────────────────────

describe("readMapMode — localStorage error handling", () => {
  it("returns null (no throw) when localStorage.getItem throws", () => {
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => readMapMode(USER_A)).not.toThrow();
    expect(readMapMode(USER_A)).toBeNull();
  });
});

// ─── writeMapMode — normal cases ──────────────────────────────────────────────

describe("writeMapMode — normal cases", () => {
  it("writes 'M1' to the correct scoped key", () => {
    writeMapMode(USER_A, "M1");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      mapModeStorageKey(USER_A),
      "M1",
    );
    expect(_store[mapModeStorageKey(USER_A)]).toBe("M1");
  });

  it("writes 'M5' to the correct scoped key", () => {
    writeMapMode(USER_A, "M5");
    expect(_store[mapModeStorageKey(USER_A)]).toBe("M5");
  });

  it("overwrites a previous map mode when called a second time", () => {
    writeMapMode(USER_A, "M1");
    writeMapMode(USER_A, "M5");
    expect(_store[mapModeStorageKey(USER_A)]).toBe("M5");
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(2);
  });

  it("uses the userId-scoped key (prefix + userId)", () => {
    writeMapMode(USER_A, "M3");
    const calledKey = (localStorageMock.setItem.mock.calls[0] as [string, string])[0];
    expect(calledKey).toBe(`inv_map_mode:${USER_A}`);
  });
});

// ─── writeMapMode — userId edge cases ────────────────────────────────────────

describe("writeMapMode — userId edge cases", () => {
  it("is a no-op when userId is '' (does not call setItem)", () => {
    writeMapMode("", "M1");
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("is a no-op when userId is '   ' (whitespace-only)", () => {
    writeMapMode("   ", "M1");
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("different userIds write to independent keys", () => {
    writeMapMode(USER_A, "M2");
    writeMapMode(USER_B, "M4");
    expect(_store[mapModeStorageKey(USER_A)]).toBe("M2");
    expect(_store[mapModeStorageKey(USER_B)]).toBe("M4");
  });
});

// ─── writeMapMode — error handling ───────────────────────────────────────────

describe("writeMapMode — error handling", () => {
  it("does not throw when localStorage.setItem throws", () => {
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => writeMapMode(USER_A, "M1")).not.toThrow();
  });
});

// ─── readCaseLayout — normal cases ───────────────────────────────────────────

describe("readCaseLayout — normal cases", () => {
  it("returns null when localStorage is empty", () => {
    expect(readCaseLayout(USER_A)).toBeNull();
  });

  it("returns 'T1' when localStorage has 'T1'", () => {
    _store[caseLayoutStorageKey(USER_A)] = "T1";
    expect(readCaseLayout(USER_A)).toBe("T1");
  });

  it("returns 'T5' when localStorage has 'T5'", () => {
    _store[caseLayoutStorageKey(USER_A)] = "T5";
    expect(readCaseLayout(USER_A)).toBe("T5");
  });

  it("correctly returns each of T1–T5", () => {
    const layouts: CaseLayout[] = ["T1", "T2", "T3", "T4", "T5"];
    for (const layout of layouts) {
      _store[caseLayoutStorageKey(USER_A)] = layout;
      expect(readCaseLayout(USER_A)).toBe(layout);
    }
  });
});

// ─── readCaseLayout — invalid / corrupt stored values ────────────────────────

describe("readCaseLayout — invalid / corrupt stored values", () => {
  it("returns null when stored value is 'T6' (out of range)", () => {
    _store[caseLayoutStorageKey(USER_A)] = "T6";
    expect(readCaseLayout(USER_A)).toBeNull();
  });

  it("returns null when stored value is 't1' (wrong case)", () => {
    _store[caseLayoutStorageKey(USER_A)] = "t1";
    expect(readCaseLayout(USER_A)).toBeNull();
  });

  it("returns null when stored value is '' (empty string)", () => {
    _store[caseLayoutStorageKey(USER_A)] = "";
    expect(readCaseLayout(USER_A)).toBeNull();
  });

  it("returns null when stored value is 'null' (stringified null)", () => {
    _store[caseLayoutStorageKey(USER_A)] = "null";
    expect(readCaseLayout(USER_A)).toBeNull();
  });

  it("returns null when stored value is 'T 1' (with space)", () => {
    _store[caseLayoutStorageKey(USER_A)] = "T 1";
    expect(readCaseLayout(USER_A)).toBeNull();
  });
});

// ─── readCaseLayout — userId edge cases ──────────────────────────────────────

describe("readCaseLayout — userId edge cases", () => {
  it("returns null when userId is '' (empty string)", () => {
    expect(readCaseLayout("")).toBeNull();
  });

  it("returns null when userId is '   ' (whitespace-only)", () => {
    expect(readCaseLayout("   ")).toBeNull();
  });

  it("different userIds return independent case layout values", () => {
    _store[caseLayoutStorageKey(USER_A)] = "T2";
    _store[caseLayoutStorageKey(USER_B)] = "T4";
    expect(readCaseLayout(USER_A)).toBe("T2");
    expect(readCaseLayout(USER_B)).toBe("T4");
  });

  it("does NOT read another user's preference when userId differs", () => {
    _store[caseLayoutStorageKey(USER_A)] = "T3";
    expect(readCaseLayout(USER_B)).toBeNull();
  });
});

// ─── readCaseLayout — SSR guard ──────────────────────────────────────────────

describe("readCaseLayout — SSR guard", () => {
  it("returns null when window is undefined (SSR environment)", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error — simulating SSR by removing window
    delete globalThis.window;
    try {
      expect(readCaseLayout(USER_A)).toBeNull();
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

// ─── readCaseLayout — localStorage error handling ─────────────────────────────

describe("readCaseLayout — localStorage error handling", () => {
  it("returns null (no throw) when localStorage.getItem throws", () => {
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => readCaseLayout(USER_A)).not.toThrow();
    expect(readCaseLayout(USER_A)).toBeNull();
  });
});

// ─── writeCaseLayout — normal cases ──────────────────────────────────────────

describe("writeCaseLayout — normal cases", () => {
  it("writes 'T1' to the correct scoped key", () => {
    writeCaseLayout(USER_A, "T1");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      caseLayoutStorageKey(USER_A),
      "T1",
    );
    expect(_store[caseLayoutStorageKey(USER_A)]).toBe("T1");
  });

  it("writes 'T5' to the correct scoped key", () => {
    writeCaseLayout(USER_A, "T5");
    expect(_store[caseLayoutStorageKey(USER_A)]).toBe("T5");
  });

  it("overwrites a previous case layout when called a second time", () => {
    writeCaseLayout(USER_A, "T1");
    writeCaseLayout(USER_A, "T5");
    expect(_store[caseLayoutStorageKey(USER_A)]).toBe("T5");
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(2);
  });

  it("uses the userId-scoped key (prefix + userId)", () => {
    writeCaseLayout(USER_A, "T3");
    const calledKey = (localStorageMock.setItem.mock.calls[0] as [string, string])[0];
    expect(calledKey).toBe(`inv_case_layout:${USER_A}`);
  });
});

// ─── writeCaseLayout — userId edge cases ─────────────────────────────────────

describe("writeCaseLayout — userId edge cases", () => {
  it("is a no-op when userId is '' (does not call setItem)", () => {
    writeCaseLayout("", "T1");
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("is a no-op when userId is '   ' (whitespace-only)", () => {
    writeCaseLayout("   ", "T1");
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("different userIds write to independent keys", () => {
    writeCaseLayout(USER_A, "T2");
    writeCaseLayout(USER_B, "T4");
    expect(_store[caseLayoutStorageKey(USER_A)]).toBe("T2");
    expect(_store[caseLayoutStorageKey(USER_B)]).toBe("T4");
  });
});

// ─── writeCaseLayout — error handling ────────────────────────────────────────

describe("writeCaseLayout — error handling", () => {
  it("does not throw when localStorage.setItem throws", () => {
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(() => writeCaseLayout(USER_A, "T1")).not.toThrow();
  });
});

// ─── Round-trip — map mode ────────────────────────────────────────────────────

describe("writeMapMode + readMapMode — round-trip", () => {
  it("writeMapMode then readMapMode returns the same value", () => {
    writeMapMode(USER_A, "M3");
    expect(readMapMode(USER_A)).toBe("M3");
  });

  it("write 'M1' then write 'M5' then read returns 'M5'", () => {
    writeMapMode(USER_A, "M1");
    writeMapMode(USER_A, "M5");
    expect(readMapMode(USER_A)).toBe("M5");
  });

  it("round-trips correctly for each of M1–M5", () => {
    const modes: MapMode[] = ["M1", "M2", "M3", "M4", "M5"];
    for (const mode of modes) {
      writeMapMode(USER_A, mode);
      expect(readMapMode(USER_A)).toBe(mode);
    }
  });
});

// ─── Round-trip — case layout ─────────────────────────────────────────────────

describe("writeCaseLayout + readCaseLayout — round-trip", () => {
  it("writeCaseLayout then readCaseLayout returns the same value", () => {
    writeCaseLayout(USER_A, "T3");
    expect(readCaseLayout(USER_A)).toBe("T3");
  });

  it("write 'T1' then write 'T5' then read returns 'T5'", () => {
    writeCaseLayout(USER_A, "T1");
    writeCaseLayout(USER_A, "T5");
    expect(readCaseLayout(USER_A)).toBe("T5");
  });

  it("round-trips correctly for each of T1–T5", () => {
    const layouts: CaseLayout[] = ["T1", "T2", "T3", "T4", "T5"];
    for (const layout of layouts) {
      writeCaseLayout(USER_A, layout);
      expect(readCaseLayout(USER_A)).toBe(layout);
    }
  });
});

// ─── Cross-preference isolation ───────────────────────────────────────────────

describe("cross-preference isolation", () => {
  it("writeMapMode does NOT affect readCaseLayout for the same user", () => {
    writeCaseLayout(USER_A, "T2");
    writeMapMode(USER_A, "M4");
    // Case layout should still be T2, unaffected by the map mode write.
    expect(readCaseLayout(USER_A)).toBe("T2");
  });

  it("writeCaseLayout does NOT affect readMapMode for the same user", () => {
    writeMapMode(USER_A, "M3");
    writeCaseLayout(USER_A, "T5");
    // Map mode should still be M3, unaffected by the case layout write.
    expect(readMapMode(USER_A)).toBe("M3");
  });

  it("map mode and case layout keys differ for the same user", () => {
    const mapKey = mapModeStorageKey(USER_A);
    const layoutKey = caseLayoutStorageKey(USER_A);
    expect(mapKey).not.toBe(layoutKey);
  });
});

// ─── Multi-user isolation ─────────────────────────────────────────────────────

describe("multi-user isolation", () => {
  it("writes for user A do not affect reads for user B (map mode)", () => {
    writeMapMode(USER_A, "M2");
    expect(readMapMode(USER_B)).toBeNull();
  });

  it("writes for user A do not affect reads for user B (case layout)", () => {
    writeCaseLayout(USER_A, "T3");
    expect(readCaseLayout(USER_B)).toBeNull();
  });

  it("both users can hold different map modes simultaneously", () => {
    writeMapMode(USER_A, "M1");
    writeMapMode(USER_B, "M5");
    expect(readMapMode(USER_A)).toBe("M1");
    expect(readMapMode(USER_B)).toBe("M5");
  });

  it("both users can hold different case layouts simultaneously", () => {
    writeCaseLayout(USER_A, "T1");
    writeCaseLayout(USER_B, "T4");
    expect(readCaseLayout(USER_A)).toBe("T1");
    expect(readCaseLayout(USER_B)).toBe("T4");
  });
});
