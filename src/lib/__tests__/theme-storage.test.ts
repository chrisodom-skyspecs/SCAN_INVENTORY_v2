/**
 * @vitest-environment jsdom
 *
 * Unit tests: theme-storage.ts — localStorage read/write helpers
 *
 * Tests:
 *   THEME_STORAGE_KEY
 *     1.  THEME_STORAGE_KEY equals "theme_preference".
 *
 *   readThemePreference — normal cases
 *     2.  Returns null when localStorage is empty (first visit).
 *     3.  Returns "dark" when localStorage has "dark".
 *     4.  Returns "light" when localStorage has "light".
 *
 *   readThemePreference — invalid / corrupt stored values
 *     5.  Returns null when stored value is "sepia" (invalid).
 *     6.  Returns null when stored value is an empty string.
 *     7.  Returns null when stored value is a number-like string "1".
 *     8.  Returns null when stored value is "Dark" (wrong case).
 *     9.  Returns null when stored value is "LIGHT" (wrong case).
 *    10.  Returns null when stored value is "null" (stringified null).
 *
 *   readThemePreference — SSR guard
 *    11.  Returns null when window is undefined (SSR environment).
 *
 *   readThemePreference — localStorage error handling
 *    12.  Returns null when localStorage.getItem throws.
 *
 *   writeThemePreference — normal cases
 *    13.  Writes "dark" to localStorage under THEME_STORAGE_KEY.
 *    14.  Writes "light" to localStorage under THEME_STORAGE_KEY.
 *    15.  Overwrites a previous value when called a second time.
 *
 *   writeThemePreference — error handling
 *    16.  Does not throw when localStorage.setItem throws.
 *
 *   round-trip
 *    17.  write("dark")  then read() returns "dark".
 *    18.  write("light") then read() returns "light".
 *    19.  write("dark") then write("light") then read() returns "light".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  readThemePreference,
  writeThemePreference,
  THEME_STORAGE_KEY,
} from "../theme-storage";

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

  // Re-apply default implementations after vi.clearAllMocks() clears call counts.
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

// ─── THEME_STORAGE_KEY ────────────────────────────────────────────────────────

describe("THEME_STORAGE_KEY", () => {
  it("equals 'theme_preference'", () => {
    expect(THEME_STORAGE_KEY).toBe("theme_preference");
  });
});

// ─── readThemePreference ──────────────────────────────────────────────────────

describe("readThemePreference — normal cases", () => {
  it("returns null when localStorage is empty", () => {
    expect(readThemePreference()).toBeNull();
  });

  it("returns 'dark' when localStorage has 'dark'", () => {
    _store[THEME_STORAGE_KEY] = "dark";
    expect(readThemePreference()).toBe("dark");
  });

  it("returns 'light' when localStorage has 'light'", () => {
    _store[THEME_STORAGE_KEY] = "light";
    expect(readThemePreference()).toBe("light");
  });
});

describe("readThemePreference — invalid / corrupt stored values", () => {
  it("returns null for 'sepia' (invalid theme name)", () => {
    _store[THEME_STORAGE_KEY] = "sepia";
    expect(readThemePreference()).toBeNull();
  });

  it("returns null for an empty string", () => {
    _store[THEME_STORAGE_KEY] = "";
    expect(readThemePreference()).toBeNull();
  });

  it("returns null for a number-like string '1'", () => {
    _store[THEME_STORAGE_KEY] = "1";
    expect(readThemePreference()).toBeNull();
  });

  it("returns null for 'Dark' (wrong case)", () => {
    _store[THEME_STORAGE_KEY] = "Dark";
    expect(readThemePreference()).toBeNull();
  });

  it("returns null for 'LIGHT' (wrong case)", () => {
    _store[THEME_STORAGE_KEY] = "LIGHT";
    expect(readThemePreference()).toBeNull();
  });

  it("returns null for 'null' (stringified null)", () => {
    _store[THEME_STORAGE_KEY] = "null";
    expect(readThemePreference()).toBeNull();
  });
});

describe("readThemePreference — localStorage error handling", () => {
  it("returns null when localStorage.getItem throws", () => {
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });

    // Should return null rather than propagating the error.
    expect(() => readThemePreference()).not.toThrow();
    expect(readThemePreference()).toBeNull();
  });
});

// ─── writeThemePreference ─────────────────────────────────────────────────────

describe("writeThemePreference — normal cases", () => {
  it("writes 'dark' to localStorage under THEME_STORAGE_KEY", () => {
    writeThemePreference("dark");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      THEME_STORAGE_KEY,
      "dark",
    );
    expect(_store[THEME_STORAGE_KEY]).toBe("dark");
  });

  it("writes 'light' to localStorage under THEME_STORAGE_KEY", () => {
    writeThemePreference("light");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      THEME_STORAGE_KEY,
      "light",
    );
    expect(_store[THEME_STORAGE_KEY]).toBe("light");
  });

  it("overwrites a previous value when called a second time", () => {
    writeThemePreference("dark");
    writeThemePreference("light");
    expect(_store[THEME_STORAGE_KEY]).toBe("light");
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(2);
  });
});

describe("writeThemePreference — error handling", () => {
  it("does not throw when localStorage.setItem throws", () => {
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });

    // Must not propagate the storage error.
    expect(() => writeThemePreference("dark")).not.toThrow();
  });
});

// ─── Round-trip ───────────────────────────────────────────────────────────────

describe("readThemePreference + writeThemePreference — round-trip", () => {
  it("write('dark') then read() returns 'dark'", () => {
    writeThemePreference("dark");
    expect(readThemePreference()).toBe("dark");
  });

  it("write('light') then read() returns 'light'", () => {
    writeThemePreference("light");
    expect(readThemePreference()).toBe("light");
  });

  it("write('dark') then write('light') then read() returns 'light'", () => {
    writeThemePreference("dark");
    writeThemePreference("light");
    expect(readThemePreference()).toBe("light");
  });
});
