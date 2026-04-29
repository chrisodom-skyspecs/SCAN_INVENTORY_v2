/**
 * Unit tests for the unique case ID generation utility.
 *
 * Run with: npx vitest run src/lib/__tests__/case-id.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  generateCaseId,
  generateCaseUlid,
  isValidCaseId,
  parseCaseId,
  CASE_ID_REGEX,
  __internal,
} from "../case-id";

const { ENCODING, TIME_LEN, RAND_LEN, ULID_LEN, MAX_TIME } = __internal;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Deterministic random producer for tests.  Returns the byte sequence
 * `[seed, seed+1, seed+2, …]` modulo 256 for the requested length.
 */
function deterministicBytes(seed: number) {
  return (length: number): Uint8Array => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = (seed + i) & 0xff;
    }
    return out;
  };
}

// ─── generateCaseId ───────────────────────────────────────────────────────────

describe("generateCaseId", () => {
  it("produces a label matching the canonical regex", () => {
    const id = generateCaseId();
    expect(id).toMatch(CASE_ID_REGEX);
  });

  it("produces a label of exactly 31 characters (5 prefix + 26 ULID)", () => {
    const id = generateCaseId();
    expect(id).toHaveLength(5 + ULID_LEN);
  });

  it("starts with the CASE- prefix by default", () => {
    expect(generateCaseId().startsWith("CASE-")).toBe(true);
  });

  it("uses only Crockford-Base32 characters in the ULID portion", () => {
    const id = generateCaseId();
    const ulid = id.slice("CASE-".length);
    for (const ch of ulid) {
      expect(ENCODING).toContain(ch);
    }
  });

  it("is deterministic when both timestamp and randomBytes are supplied", () => {
    const opts = {
      timestamp: 1_700_000_000_000,
      randomBytes: deterministicBytes(0xab),
    };
    expect(generateCaseId(opts)).toBe(generateCaseId(opts));
  });

  it("produces different IDs across consecutive calls (time + entropy)", () => {
    const a = generateCaseId();
    const b = generateCaseId();
    expect(a).not.toBe(b);
  });

  it("produces unique IDs across a large batch (collision smoke test)", () => {
    const seen = new Set<string>();
    const N = 5_000;
    for (let i = 0; i < N; i++) {
      seen.add(generateCaseId());
    }
    expect(seen.size).toBe(N);
  });

  it("allows the prefix to be overridden", () => {
    const id = generateCaseId({ prefix: "DRONE-" });
    expect(id.startsWith("DRONE-")).toBe(true);
    expect(id.slice("DRONE-".length)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("supports an empty prefix via generateCaseUlid", () => {
    const ulid = generateCaseUlid();
    expect(ulid).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("encodes the timestamp segment lexicographically (sort = chronological)", () => {
    const earlier = generateCaseId({
      timestamp: 1_700_000_000_000,
      randomBytes: deterministicBytes(0),
    });
    const later = generateCaseId({
      timestamp: 1_700_000_000_001,
      randomBytes: deterministicBytes(0),
    });
    expect(earlier < later).toBe(true);
  });

  it("rejects negative timestamps", () => {
    expect(() => generateCaseId({ timestamp: -1 })).toThrow();
  });

  it("rejects non-integer timestamps", () => {
    expect(() => generateCaseId({ timestamp: 1.5 })).toThrow();
  });

  it("rejects timestamps that exceed the 48-bit ULID limit", () => {
    expect(() => generateCaseId({ timestamp: MAX_TIME + 1 })).toThrow();
  });

  it("accepts the maximum 48-bit timestamp", () => {
    const id = generateCaseId({
      timestamp: MAX_TIME,
      randomBytes: deterministicBytes(0xff),
    });
    expect(id).toMatch(CASE_ID_REGEX);
  });

  it("rejects randomBytes producers that return fewer than 10 bytes", () => {
    expect(() =>
      generateCaseId({
        randomBytes: () => new Uint8Array(5),
      }),
    ).toThrow();
  });

  it("rejects malformed prefixes (lowercase / disallowed punctuation)", () => {
    expect(() => generateCaseId({ prefix: "case-" })).toThrow();
    expect(() => generateCaseId({ prefix: "CASE_" })).toThrow();
    expect(() => generateCaseId({ prefix: "CASE--" })).toThrow();
  });

  it("uses Date.now() by default (label timestamp ≈ wall clock)", () => {
    const before = Date.now();
    const id = generateCaseId();
    const after = Date.now();
    const ts = parseCaseId(id).timestamp;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ─── isValidCaseId ────────────────────────────────────────────────────────────

describe("isValidCaseId", () => {
  it("accepts a freshly generated case ID", () => {
    expect(isValidCaseId(generateCaseId())).toBe(true);
  });

  it("rejects legacy sequential labels", () => {
    expect(isValidCaseId("CASE-001")).toBe(false);
    expect(isValidCaseId("CASE-042")).toBe(false);
  });

  it("rejects strings without the prefix", () => {
    expect(isValidCaseId("01HZX7Q9R2KMTBYEXAMPLEABC")).toBe(false);
  });

  it("rejects strings with the wrong ULID length", () => {
    expect(isValidCaseId("CASE-01HZX7Q9R2")).toBe(false);
    expect(isValidCaseId("CASE-01HZX7Q9R2KMTBYEXAMPLEABCDE")).toBe(false);
  });

  it("rejects strings containing disallowed Crockford characters (I/L/O/U)", () => {
    expect(isValidCaseId("CASE-01HZX7Q9R2KMTBYEXAMPLEABI")).toBe(false);
    expect(isValidCaseId("CASE-01HZX7Q9R2KMTBYEXAMPLEABL")).toBe(false);
    expect(isValidCaseId("CASE-01HZX7Q9R2KMTBYEXAMPLEABO")).toBe(false);
    expect(isValidCaseId("CASE-01HZX7Q9R2KMTBYEXAMPLEABU")).toBe(false);
  });

  it("rejects lowercase ULID letters", () => {
    expect(isValidCaseId("case-01hzx7q9r2kmtbyexampleabc")).toBe(false);
  });

  it("rejects non-string inputs without throwing", () => {
    expect(isValidCaseId(undefined)).toBe(false);
    expect(isValidCaseId(null)).toBe(false);
    expect(isValidCaseId(42)).toBe(false);
    expect(isValidCaseId({})).toBe(false);
  });
});

// ─── parseCaseId ──────────────────────────────────────────────────────────────

describe("parseCaseId", () => {
  it("round-trips the timestamp through generate → parse", () => {
    const ts = 1_714_000_000_000;
    const id = generateCaseId({
      timestamp: ts,
      randomBytes: deterministicBytes(0x12),
    });
    const parts = parseCaseId(id);
    expect(parts.timestamp).toBe(ts);
  });

  it("returns the canonical prefix and correct segment widths", () => {
    const id = generateCaseId();
    const parts = parseCaseId(id);
    expect(parts.prefix).toBe("CASE-");
    expect(parts.timeChars).toHaveLength(TIME_LEN);
    expect(parts.randChars).toHaveLength(RAND_LEN);
  });

  it("throws for invalid case IDs", () => {
    expect(() => parseCaseId("CASE-001")).toThrow();
    expect(() => parseCaseId("not-a-case-id")).toThrow();
    expect(() => parseCaseId("")).toThrow();
  });
});

// ─── encodeTime / decodeTime round-trip ──────────────────────────────────────

describe("__internal.encodeTime / decodeTime", () => {
  it("round-trips zero", () => {
    expect(__internal.decodeTime(__internal.encodeTime(0))).toBe(0);
  });

  it("round-trips a typical wall-clock timestamp", () => {
    const ts = 1_700_000_000_000;
    expect(__internal.decodeTime(__internal.encodeTime(ts))).toBe(ts);
  });

  it("round-trips the maximum 48-bit value", () => {
    expect(__internal.decodeTime(__internal.encodeTime(MAX_TIME))).toBe(MAX_TIME);
  });

  it("encoded timestamps preserve lexicographic ordering", () => {
    const samples = [0, 1, 1_000, 1_700_000_000_000, MAX_TIME - 1, MAX_TIME];
    const encoded = samples.map(__internal.encodeTime);
    const sorted = [...encoded].sort();
    expect(encoded).toEqual(sorted);
  });
});
