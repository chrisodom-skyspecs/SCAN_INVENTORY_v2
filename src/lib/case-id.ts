/**
 * src/lib/case-id.ts
 *
 * Unique case ID generation for the SkySpecs INVENTORY / SCAN system.
 *
 * ─── Why a dedicated module ──────────────────────────────────────────────────
 * Cases flow through the entire SkySpecs lifecycle (hangar → assembled →
 * transit_out → deployed → flagged → transit_in → received → archived) and
 * are referenced by:
 *
 *   • Convex `cases.label` — the human-readable canonical handle.
 *   • Printed QR labels (see `src/lib/qr-code.ts`).
 *   • Audit timeline events / hash-chain (T5).
 *   • FedEx shipping references / external integrations.
 *
 * Sequential labels (e.g. `CASE-001`, `CASE-002` …) are used in the seed
 * dataset, but they are NOT collision-resistant once the system goes
 * multi-region or admins start importing cases concurrently from multiple
 * sources.  Two operators creating a case at the same wall-clock instant
 * could clobber each other's label.
 *
 * This module returns a label that is:
 *
 *   1. **Time-ordered** — the leading characters are derived from the
 *      creation timestamp so labels sort chronologically (helps the
 *      audit ledger and DB indexes stay roughly sequential).
 *   2. **Collision-resistant** — 80 bits of entropy after the timestamp,
 *      drawn from a CSPRNG (`crypto.randomBytes` on Node, `crypto.getRandomValues`
 *      in the browser).  Probability of collision at one billion IDs is
 *      ~5 × 10⁻¹⁰ per ULID spec.
 *   3. **Lexicographically safe** — Crockford Base-32 alphabet:
 *      `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no I, L, O, U → eliminates
 *      handwriting / OCR ambiguity on physical case labels).
 *   4. **Self-describing** — every label starts with a `CASE-` prefix so
 *      operators can recognise it on a printout, in a Slack message, or in
 *      a barcode reader.
 *
 * ─── Format ──────────────────────────────────────────────────────────────────
 *
 *   CASE-01HZX7Q9R2KMTBYEXAMPLEABC
 *   ╰──╯ ╰────────╯╰──────────────╯
 *    │    │         │
 *    │    │         └─ 16 chars (80 bits) randomness
 *    │    └─ 10 chars (48 bits) timestamp (Crockford-Base32 ms-since-epoch)
 *    └─ static "CASE-" prefix
 *
 *   Total length: 5 (prefix) + 26 (ULID) = 31 characters.
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 *   import { generateCaseId } from "@/lib/case-id";
 *
 *   const label = generateCaseId();
 *   //  → "CASE-01HZX7Q9R2KMTBYEXAMPLEABC"
 *
 *   const explicit = generateCaseId({ timestamp: Date.now(), prefix: "CASE-" });
 *
 *   // Validation
 *   isValidCaseId("CASE-01HZX7Q9R2KMTBYEXAMPLEABC")  → true
 *   isValidCaseId("CASE-001")                         → false   (legacy seed)
 *   isValidCaseId("foo")                              → false
 *
 *   // Parse parts
 *   const parts = parseCaseId("CASE-01HZX7Q9R2KMTBYEXAMPLEABC");
 *   //  parts.prefix     → "CASE-"
 *   //  parts.timeChars  → "01HZX7Q9R2"
 *   //  parts.randChars  → "KMTBYEXAMPLEABC"  (16 chars)
 *   //  parts.timestamp  → 1714377600000 (epoch ms)
 *
 * The implementation is self-contained — no external dependencies — and runs
 * on both Node.js (Convex actions / API routes) and the browser (SCAN app).
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Options accepted by `generateCaseId`.  All fields are optional;
 * default behaviour is suitable for production case creation.
 */
export interface GenerateCaseIdOptions {
  /**
   * Override the prefix. Defaults to `"CASE-"`.
   *
   * Useful for tests that need to assert against a stable prefix or for
   * environments where multiple equipment categories share the same ULID
   * generator (e.g. `"DRONE-"`, `"BATTERY-"`).
   */
  prefix?: string;

  /**
   * Override the timestamp in epoch milliseconds. Defaults to `Date.now()`.
   *
   * Useful for deterministic tests and for back-filling labels for cases
   * imported from a legacy system (preserves chronological ordering).
   */
  timestamp?: number;

  /**
   * Override the randomness source.
   *
   * Production callers should leave this unset — the module automatically
   * picks `crypto.getRandomValues` (browser / Edge / Convex) or
   * `crypto.randomBytes` (Node.js).
   *
   * Tests pass a deterministic byte producer to assert specific outputs.
   *
   * Must fill the supplied `Uint8Array` with random bytes.
   */
  randomBytes?: (length: number) => Uint8Array;
}

/**
 * Structured breakdown of a parsed case ID.  Returned by `parseCaseId`.
 */
export interface ParsedCaseId {
  /** Static prefix segment (e.g. `"CASE-"`). */
  prefix: string;
  /** First 10 Crockford-Base32 chars — encoded creation timestamp. */
  timeChars: string;
  /** Remaining 16 Crockford-Base32 chars — randomness. */
  randChars: string;
  /** Decoded creation timestamp (epoch milliseconds). */
  timestamp: number;
}

// ─── Internal constants ──────────────────────────────────────────────────────

/**
 * Crockford's Base-32 alphabet.
 * Excludes the visually-ambiguous letters I, L, O, U.  Used for both the
 * timestamp and randomness segments.
 */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length; // 32

/** Number of Crockford-Base32 chars used to encode the 48-bit timestamp. */
const TIME_LEN = 10;

/** Number of Crockford-Base32 chars used to encode the 80-bit randomness. */
const RAND_LEN = 16;

/** Total ULID length — must equal 26 per the spec. */
const ULID_LEN = TIME_LEN + RAND_LEN; // 26

/** Default static prefix for SkySpecs equipment cases. */
const DEFAULT_PREFIX = "CASE-";

/**
 * Maximum representable timestamp in 48 bits — Date.UTC(10889, 7, 2).
 * Validation guard so we never silently truncate a corrupted timestamp.
 */
const MAX_TIME = 281_474_976_710_655; // 2^48 - 1

// ─── Randomness source resolution ─────────────────────────────────────────────

/**
 * Cross-environment randomness producer.
 *
 *   • Browser / Edge / Convex runtime → `crypto.getRandomValues`
 *   • Node.js                           → `crypto.randomBytes`
 *
 * Tests can override via `GenerateCaseIdOptions.randomBytes`.
 */
function defaultRandomBytes(length: number): Uint8Array {
  // Web Crypto path (browser, Edge, modern Node, Convex actions).
  if (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { crypto?: Crypto }).crypto !== "undefined" &&
    typeof (globalThis as { crypto: Crypto }).crypto.getRandomValues ===
      "function"
  ) {
    const buf = new Uint8Array(length);
    (globalThis as { crypto: Crypto }).crypto.getRandomValues(buf);
    return buf;
  }

  // Pure Node.js fallback (older runtimes without globalThis.crypto).
  // We require synchronously rather than at module top so that the bundler
  // (Webpack / Turbopack) doesn't try to drag node:crypto into client bundles
  // when Web Crypto is already available.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require("node:crypto") as typeof import("node:crypto");
  return new Uint8Array(nodeCrypto.randomBytes(length));
}

// ─── Encoding helpers ────────────────────────────────────────────────────────

/**
 * Encode a non-negative integer timestamp (epoch milliseconds) as a fixed-width
 * Crockford-Base32 string of exactly `TIME_LEN` characters.
 *
 * Implementation note: JavaScript bit-ops are 32-bit only, but our timestamp
 * is up to 48 bits.  We therefore use plain arithmetic (`/ 32`, `% 32`) to
 * peel off Base-32 digits from least- to most-significant.
 */
function encodeTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`encodeTime: timestamp must be a non-negative finite number (got ${ms})`);
  }
  if (!Number.isInteger(ms)) {
    throw new Error(`encodeTime: timestamp must be an integer (got ${ms})`);
  }
  if (ms > MAX_TIME) {
    throw new Error(`encodeTime: timestamp exceeds 48-bit ULID limit (${MAX_TIME})`);
  }

  let remaining = ms;
  const out = new Array<string>(TIME_LEN);
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = remaining % ENCODING_LEN;
    out[i] = ENCODING[mod];
    remaining = (remaining - mod) / ENCODING_LEN;
  }
  return out.join("");
}

/**
 * Encode a `Uint8Array` of randomness bytes as a fixed-width Crockford-Base32
 * string of exactly `RAND_LEN` characters.  Uses 5-bit windowing so each
 * output character corresponds to one Base-32 digit.
 *
 * Requires at least 10 bytes (= 80 bits = 16 chars × 5 bits).
 */
function encodeRandom(bytes: Uint8Array): string {
  // 80 bits / 8 = 10 bytes minimum.  Extra bytes are ignored — only the
  // first 10 are read.
  if (bytes.length < 10) {
    throw new Error(`encodeRandom: need at least 10 bytes of entropy (got ${bytes.length})`);
  }

  const out = new Array<string>(RAND_LEN);
  let bits = 0;
  let value = 0;
  let written = 0;

  for (let i = 0; i < 10 && written < RAND_LEN; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5 && written < RAND_LEN) {
      bits -= 5;
      const idx = (value >> bits) & 0x1f;
      out[written++] = ENCODING[idx];
    }
  }

  // Defensive: if the loop above somehow under-fills (it shouldn't with 10
  // bytes), pad with the alphabet's zero element so callers always get a
  // fixed-width result.
  while (written < RAND_LEN) {
    out[written++] = ENCODING[0];
  }

  return out.join("");
}

/**
 * Decode a Crockford-Base32 timestamp segment back to epoch milliseconds.
 *
 * Used by `parseCaseId`. Inverse of `encodeTime`.
 */
function decodeTime(timeChars: string): number {
  if (timeChars.length !== TIME_LEN) {
    throw new Error(`decodeTime: expected ${TIME_LEN} chars (got ${timeChars.length})`);
  }
  let value = 0;
  for (let i = 0; i < timeChars.length; i++) {
    const idx = ENCODING.indexOf(timeChars[i]);
    if (idx === -1) {
      throw new Error(`decodeTime: invalid Crockford-Base32 char "${timeChars[i]}"`);
    }
    value = value * ENCODING_LEN + idx;
  }
  return value;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a fresh, collision-resistant case ID label.
 *
 * Default format:
 *   `CASE-{10-char timestamp}{16-char randomness}`
 *
 * Example:
 *   `CASE-01HZX7Q9R2KMTBYEXAMPLEABC`
 *
 * Properties:
 *   • Time-ordered — labels sort lexicographically by creation time.
 *   • Collision-resistant — 80 bits of CSPRNG entropy after the timestamp.
 *   • URL-safe and label-safe — Crockford-Base32 alphabet.
 *   • Deterministic when `timestamp` and `randomBytes` are supplied (tests).
 *
 * @throws {Error} when `timestamp` is negative, non-integer, or exceeds 2^48-1.
 * @throws {Error} when `randomBytes` returns fewer than 10 bytes.
 * @throws {Error} when `prefix` contains characters that would defeat label
 *   parsing (currently: must match `/^[A-Z0-9]*-?$/` after upper-casing).
 */
export function generateCaseId(options: GenerateCaseIdOptions = {}): string {
  const {
    prefix = DEFAULT_PREFIX,
    timestamp = Date.now(),
    randomBytes = defaultRandomBytes,
  } = options;

  // Defensive prefix validation — keeps `parseCaseId` deterministic and
  // protects against accidentally embedding a hyphen-laden prefix that would
  // shift the time / randomness segment offsets.
  if (typeof prefix !== "string") {
    throw new Error("generateCaseId: prefix must be a string");
  }
  if (!/^[A-Z0-9]*-?$/.test(prefix)) {
    throw new Error(
      `generateCaseId: prefix must be uppercase ASCII letters/digits ` +
        `optionally followed by a single hyphen (got "${prefix}")`,
    );
  }

  const timeChars = encodeTime(timestamp);
  const randChars = encodeRandom(randomBytes(10));

  return `${prefix}${timeChars}${randChars}`;
}

/**
 * Generate the ULID portion of a case ID without the `CASE-` prefix.
 *
 * Useful when the prefix is applied elsewhere (for example, when storing
 * the bare ULID inside a column that already implies the entity type).
 */
export function generateCaseUlid(
  options: Omit<GenerateCaseIdOptions, "prefix"> = {},
): string {
  return generateCaseId({ ...options, prefix: "" });
}

/**
 * Regular expression matching the canonical case ID format produced by
 * `generateCaseId` with the default `CASE-` prefix.
 *
 *   • Anchored — does not match substrings.
 *   • 26 Crockford-Base32 chars after the prefix.
 */
export const CASE_ID_REGEX = /^CASE-[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Type-guard that returns `true` when `value` is a syntactically-valid case
 * ID produced by `generateCaseId` (default prefix).
 *
 * Does NOT verify that the case actually exists in Convex — that requires a
 * database lookup.  Use this for client-side input validation only.
 */
export function isValidCaseId(value: unknown): value is string {
  return typeof value === "string" && CASE_ID_REGEX.test(value);
}

/**
 * Parse a case ID label into its structured components.
 *
 * @throws {Error} if `value` does not match the canonical `CASE-…` format.
 */
export function parseCaseId(value: string): ParsedCaseId {
  if (typeof value !== "string" || !CASE_ID_REGEX.test(value)) {
    throw new Error(
      `parseCaseId: input does not match the canonical CASE-{ULID} format (got "${value}")`,
    );
  }

  const prefix = DEFAULT_PREFIX;
  const ulid = value.slice(prefix.length);
  const timeChars = ulid.slice(0, TIME_LEN);
  const randChars = ulid.slice(TIME_LEN, TIME_LEN + RAND_LEN);

  return {
    prefix,
    timeChars,
    randChars,
    timestamp: decodeTime(timeChars),
  };
}

/**
 * Internal accessors exported for unit tests only.  Do not consume from
 * application code — these are not part of the public contract and may
 * change without notice.
 */
export const __internal = {
  ENCODING,
  ENCODING_LEN,
  TIME_LEN,
  RAND_LEN,
  ULID_LEN,
  DEFAULT_PREFIX,
  MAX_TIME,
  encodeTime,
  encodeRandom,
  decodeTime,
  defaultRandomBytes,
};
