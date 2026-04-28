/**
 * Deep-link validation and fallback tests.
 *
 * These tests specifically cover the sanitization edge-cases that plain
 * `decodeMapUrlState` does not test: control characters, over-length IDs,
 * XSS-like inputs, mixed valid/invalid params, and the warning surface of
 * `sanitizeMapDeepLink`.
 *
 * Acceptance criterion: every invalid/missing URL param must fall back to
 * its per-param default and must NOT throw.
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeMapDeepLink,
  MAX_ID_LENGTH,
  parseId,
  PARAM,
} from "../map-url-params";
import { MAP_URL_STATE_DEFAULTS } from "@/types/map";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeParams(entries: Record<string, string>): {
  get(key: string): string | null;
} {
  return {
    get(key: string): string | null {
      return entries[key] ?? null;
    },
  };
}

// ─── sanitizeMapDeepLink — clean URL ─────────────────────────────────────────

describe("sanitizeMapDeepLink — clean URL", () => {
  it("returns defaults with no warnings for empty params", () => {
    const { state, warnings } = sanitizeMapDeepLink(makeParams({}));
    expect(state).toEqual(MAP_URL_STATE_DEFAULTS);
    expect(warnings).toHaveLength(0);
  });

  it("returns no warnings for a fully valid URL", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({
        [PARAM.VIEW]: "M3",
        [PARAM.CASE]: "case-abc",
        [PARAM.WINDOW]: "T2",
        [PARAM.LAYERS]: "satellite,terrain",
        [PARAM.ORG]: "org-99",
        [PARAM.KIT]: "kit-42",
        [PARAM.AT]: "2025-06-01T12:00:00.000Z",
      })
    );

    expect(state.view).toBe("M3");
    expect(state.case).toBe("case-abc");
    expect(state.window).toBe("T2");
    expect(state.layers).toEqual(["satellite", "terrain"]);
    expect(state.org).toBe("org-99");
    expect(state.kit).toBe("kit-42");
    expect(state.at?.toISOString()).toBe("2025-06-01T12:00:00.000Z");
    expect(warnings).toHaveLength(0);
  });
});

// ─── sanitizeMapDeepLink — view fallback ──────────────────────────────────────

describe("sanitizeMapDeepLink — view param", () => {
  it("defaults and warns for invalid view", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.VIEW]: "BOGUS" })
    );
    expect(state.view).toBe("M1");
    expect(warnings.some((w) => w.includes('"view"'))).toBe(true);
  });

  it("defaults and warns for numerically out-of-range view", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.VIEW]: "M9" })
    );
    expect(state.view).toBe("M1");
    expect(warnings.some((w) => w.includes('"view"'))).toBe(true);
  });

  it("normalises lowercase view without warning (case-normalisation, not an error)", () => {
    // "m2" normalises to "M2" — this is valid, not a sanitization warning
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.VIEW]: "m2" })
    );
    expect(state.view).toBe("M2");
    // No warning because "M2" is valid after normalisation
    expect(warnings.filter((w) => w.includes('"view"'))).toHaveLength(0);
  });

  it("accepts all valid uppercase views without warnings", () => {
    for (const v of ["M1", "M2", "M3", "M4", "M5"] as const) {
      const { warnings } = sanitizeMapDeepLink(
        makeParams({ [PARAM.VIEW]: v })
      );
      expect(warnings.filter((w) => w.includes('"view"'))).toHaveLength(0);
    }
  });
});

// ─── sanitizeMapDeepLink — window fallback ────────────────────────────────────

describe("sanitizeMapDeepLink — window param", () => {
  it("defaults and warns for invalid window", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.WINDOW]: "Z9" })
    );
    expect(state.window).toBe("T1");
    expect(warnings.some((w) => w.includes('"window"'))).toBe(true);
  });

  it("accepts all valid window values without warnings", () => {
    for (const w of ["T1", "T2", "T3", "T4", "T5"] as const) {
      const { warnings } = sanitizeMapDeepLink(
        makeParams({ [PARAM.WINDOW]: w })
      );
      expect(warnings.filter((msg) => msg.includes('"window"'))).toHaveLength(
        0
      );
    }
  });
});

// ─── sanitizeMapDeepLink — layers fallback ────────────────────────────────────

describe("sanitizeMapDeepLink — layers param", () => {
  it("warns and drops unknown layer IDs", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.LAYERS]: "cases,unknown-layer,transit" })
    );
    expect(state.layers).toEqual(["cases", "transit"]);
    expect(
      warnings.some((w) => w.includes('"layers"') && w.includes("unknown"))
    ).toBe(true);
  });

  it("warns and removes duplicate layer IDs", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.LAYERS]: "cases,transit,cases" })
    );
    expect(state.layers).toEqual(["cases", "transit"]);
    expect(
      warnings.some((w) => w.includes('"layers"') && w.includes("duplicate"))
    ).toBe(true);
  });

  it("defaults and warns when all layer IDs are unknown", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.LAYERS]: "bad1,bad2" })
    );
    expect(state.layers).toEqual(MAP_URL_STATE_DEFAULTS.layers);
    expect(warnings.some((w) => w.includes('"layers"'))).toBe(true);
  });

  it("produces no warnings for valid layers", () => {
    const { warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.LAYERS]: "cases,transit" })
    );
    expect(warnings.filter((w) => w.includes('"layers"'))).toHaveLength(0);
  });

  it("produces no warnings when layers param is absent", () => {
    const { state, warnings } = sanitizeMapDeepLink(makeParams({}));
    expect(state.layers).toEqual(MAP_URL_STATE_DEFAULTS.layers);
    expect(warnings).toHaveLength(0);
  });
});

// ─── sanitizeMapDeepLink — at fallback ────────────────────────────────────────

describe("sanitizeMapDeepLink — at param", () => {
  it("nullifies and warns for a non-ISO timestamp", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.AT]: "not-a-date" })
    );
    expect(state.at).toBeNull();
    expect(warnings.some((w) => w.includes('"at"'))).toBe(true);
  });

  it("nullifies and warns for a partial date (date-only, no time)", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.AT]: "2025-06-01" })
    );
    expect(state.at).toBeNull();
    expect(warnings.some((w) => w.includes('"at"'))).toBe(true);
  });

  it("produces no warnings for a valid ISO timestamp", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.AT]: "2025-06-01T14:30:00.000Z" })
    );
    expect(state.at).toBeInstanceOf(Date);
    expect(warnings.filter((w) => w.includes('"at"'))).toHaveLength(0);
  });

  it("produces no warnings when at param is absent", () => {
    const { warnings } = sanitizeMapDeepLink(makeParams({}));
    expect(warnings).toHaveLength(0);
  });
});

// ─── parseId — control character stripping ────────────────────────────────────

describe("parseId — control character sanitization", () => {
  it("strips NUL bytes", () => {
    expect(parseId("abc\x00def")).toBe("abcdef");
  });

  it("strips tab characters", () => {
    expect(parseId("abc\tdef")).toBe("abcdef");
  });

  it("strips carriage return and newline", () => {
    expect(parseId("abc\r\ndef")).toBe("abcdef");
  });

  it("strips DEL character (0x7F)", () => {
    expect(parseId("abc\x7fdef")).toBe("abcdef");
  });

  it("strips all control chars and trims, returning null when only controls remain", () => {
    expect(parseId("\x00\x01\x02")).toBeNull();
  });

  it("strips control chars and then applies trim", () => {
    // Leading space + control char mix
    expect(parseId("  \x00abc  ")).toBe("abc");
  });

  it("returns null for a string that is whitespace + NUL only", () => {
    expect(parseId("  \x00  ")).toBeNull();
  });
});

// ─── parseId — length clamping ────────────────────────────────────────────────

describe("parseId — length clamping", () => {
  it("passes through IDs at exactly MAX_ID_LENGTH", () => {
    const id = "a".repeat(MAX_ID_LENGTH);
    expect(parseId(id)).toBe(id);
    expect(parseId(id)?.length).toBe(MAX_ID_LENGTH);
  });

  it("truncates IDs longer than MAX_ID_LENGTH", () => {
    const overlong = "b".repeat(MAX_ID_LENGTH + 50);
    const result = parseId(overlong);
    expect(result?.length).toBe(MAX_ID_LENGTH);
    expect(result).toBe("b".repeat(MAX_ID_LENGTH));
  });

  it("handles IDs that are MAX_ID_LENGTH after trimming whitespace", () => {
    const id = "  " + "c".repeat(MAX_ID_LENGTH) + "  ";
    const result = parseId(id);
    expect(result).toBe("c".repeat(MAX_ID_LENGTH));
  });

  it("truncates after stripping whitespace", () => {
    // Trim first, then clamp: '  ' + 200 'x' chars = 200 'x' after trim → clamp to MAX
    const id = "  " + "x".repeat(MAX_ID_LENGTH + 10);
    const result = parseId(id);
    expect(result?.length).toBe(MAX_ID_LENGTH);
  });
});

// ─── sanitizeMapDeepLink — ID param sanitization ─────────────────────────────

describe("sanitizeMapDeepLink — case / org / kit ID sanitization", () => {
  it("warns when case contains control characters", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.CASE]: "case-\x00abc" })
    );
    expect(state.case).toBe("case-abc");
    expect(warnings.some((w) => w.includes('"case"'))).toBe(true);
  });

  it("warns when org contains control characters", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.ORG]: "\x01org-99\x02" })
    );
    expect(state.org).toBe("org-99");
    expect(warnings.some((w) => w.includes('"org"'))).toBe(true);
  });

  it("warns when kit is over MAX_ID_LENGTH", () => {
    const longKit = "k".repeat(MAX_ID_LENGTH + 20);
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.KIT]: longKit })
    );
    expect(state.kit?.length).toBe(MAX_ID_LENGTH);
    expect(warnings.some((w) => w.includes('"kit"'))).toBe(true);
  });

  it("resolves case to null and warns when value is whitespace-only after stripping controls", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.CASE]: "  \x00  " })
    );
    expect(state.case).toBeNull();
    expect(warnings.some((w) => w.includes('"case"'))).toBe(true);
  });

  it("accepts normal alphanumeric IDs without warnings", () => {
    const { warnings } = sanitizeMapDeepLink(
      makeParams({
        [PARAM.CASE]: "jx7abc000123",
        [PARAM.ORG]: "org-production-42",
        [PARAM.KIT]: "kit_drone_v2",
      })
    );
    expect(
      warnings.filter(
        (w) =>
          w.includes('"case"') ||
          w.includes('"org"') ||
          w.includes('"kit"')
      )
    ).toHaveLength(0);
  });
});

// ─── sanitizeMapDeepLink — XSS / injection attempts ─────────────────────────

describe("sanitizeMapDeepLink — XSS and injection resistance", () => {
  it("ID fields: angle-bracket content passes through as opaque string (not interpreted)", () => {
    // <script> tags in IDs are not HTML-escaped here — that is the renderer's job.
    // The sanitizer only strips control characters and clamps length.
    // A raw "<script>alert(1)</script>" is a valid-looking string with no
    // control chars, so it passes through as-is.
    const xssAttempt = "<script>alert(1)</script>";
    const result = parseId(xssAttempt);
    // Should be returned as-is (sanitization ≠ HTML escaping)
    expect(result).toBe(xssAttempt);
  });

  it("view: XSS string not a valid view → falls back to M1", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.VIEW]: "<script>alert(1)</script>" })
    );
    expect(state.view).toBe("M1");
    expect(warnings.some((w) => w.includes('"view"'))).toBe(true);
  });

  it("at: XSS string not a valid ISO timestamp → null", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.AT]: "'; DROP TABLE cases; --" })
    );
    expect(state.at).toBeNull();
    expect(warnings.some((w) => w.includes('"at"'))).toBe(true);
  });

  it("layers: XSS layer ID is unknown → dropped", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.LAYERS]: "cases,<img onerror=alert(1)>" })
    );
    expect(state.layers).toEqual(["cases"]);
    expect(
      warnings.some((w) => w.includes('"layers"') && w.includes("unknown"))
    ).toBe(true);
  });

  it("ID fields: NUL-byte injection is stripped", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({ [PARAM.CASE]: "valid\x00injected" })
    );
    expect(state.case).toBe("validinjected");
    expect(warnings.some((w) => w.includes('"case"'))).toBe(true);
  });
});

// ─── sanitizeMapDeepLink — all params invalid simultaneously ─────────────────

describe("sanitizeMapDeepLink — all params invalid at once", () => {
  it("returns full defaults and warns for every param", () => {
    const { state, warnings } = sanitizeMapDeepLink(
      makeParams({
        [PARAM.VIEW]: "INVALID",
        [PARAM.CASE]: "\x00\x01",
        [PARAM.WINDOW]: "Z9",
        [PARAM.LAYERS]: "bogus1,bogus2",
        [PARAM.ORG]: "\x00",
        [PARAM.KIT]: "\t\n",
        [PARAM.AT]: "not-a-timestamp",
      })
    );

    expect(state.view).toBe(MAP_URL_STATE_DEFAULTS.view);
    expect(state.case).toBeNull();
    expect(state.window).toBe(MAP_URL_STATE_DEFAULTS.window);
    expect(state.layers).toEqual(MAP_URL_STATE_DEFAULTS.layers);
    expect(state.org).toBeNull();
    expect(state.kit).toBeNull();
    expect(state.at).toBeNull();

    // Should have warned about view, case, window, layers, org, kit, at
    expect(warnings.some((w) => w.includes('"view"'))).toBe(true);
    expect(warnings.some((w) => w.includes('"window"'))).toBe(true);
    expect(warnings.some((w) => w.includes('"layers"'))).toBe(true);
    expect(warnings.some((w) => w.includes('"at"'))).toBe(true);
    // case/org/kit with only control chars resolve to null (warned)
    expect(warnings.some((w) => w.includes('"case"'))).toBe(true);
    expect(warnings.some((w) => w.includes('"org"'))).toBe(true);
    expect(warnings.some((w) => w.includes('"kit"'))).toBe(true);
  });
});

// ─── sanitizeMapDeepLink — round-trip integrity ───────────────────────────────

describe("sanitizeMapDeepLink — round-trip with valid state", () => {
  it("state from sanitizeMapDeepLink passes isValidMapUrlState", async () => {
    // Import here to avoid circular reference issues in the test file
    const { isValidMapUrlState } = await import("../map-url-params");

    const { state } = sanitizeMapDeepLink(
      makeParams({
        [PARAM.VIEW]: "M4",
        [PARAM.CASE]: "case-xyz",
        [PARAM.WINDOW]: "T3",
        [PARAM.LAYERS]: "heat,labels",
        [PARAM.ORG]: "org-test",
        [PARAM.KIT]: "kit-test",
        [PARAM.AT]: "2025-08-15T10:00:00.000Z",
      })
    );

    expect(isValidMapUrlState(state)).toBe(true);
  });

  it("state from sanitizeMapDeepLink with all-invalid input still passes isValidMapUrlState", async () => {
    const { isValidMapUrlState } = await import("../map-url-params");

    const { state } = sanitizeMapDeepLink(
      makeParams({
        [PARAM.VIEW]: "GARBAGE",
        [PARAM.WINDOW]: "X7",
        [PARAM.LAYERS]: "not-a-layer",
        [PARAM.AT]: "bad-date",
      })
    );

    expect(isValidMapUrlState(state)).toBe(true);
  });
});
