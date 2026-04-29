/**
 * audit-hash-chain.ts — Client-side SHA-256 hash-chain verification utility
 * for the T5 Audit Ledger (FF_AUDIT_HASH_CHAIN).
 *
 * Exports
 * ───────
 *   verifyHashChain         — main verification entry point
 *   buildCanonicalContent   — canonical JSON string for a given entry + prevHash
 *   sha256Hex               — SHA-256 digest as a 64-char lowercase hex string
 *   AuditEntry              — minimum event shape required for verification
 *   HashChainVerificationResult / HashChainValid / HashChainBroken — return types
 *
 * Algorithm
 * ─────────
 * 1. Walk entries in chronological order (caller is responsible for ordering by
 *    timestamp ASC — matches the ascending order used by getCaseEvents).
 * 2. Skip entries that have no `hash` field (written before FF_AUDIT_HASH_CHAIN
 *    was enabled).
 * 3. For each entry that carries a `hash` field:
 *    a. Determine the expected prevHash:
 *         • First chained entry: expected prevHash is "" (empty string).
 *         • Subsequent entries: expected prevHash is the previous chained
 *           entry's `hash` value.
 *    b. Check that the stored `entry.prevHash` equals the expected prevHash.
 *       Mismatch → { valid: false, reason: "broken_chain_link" }.
 *    c. Recompute SHA-256 of buildCanonicalContent(entry, expectedPrevHash).
 *    d. Compare the recomputed digest to `entry.hash`.
 *       Mismatch → { valid: false, reason: "hash_mismatch" }.
 * 4. All entries passed → { valid: true, checkedCount }.
 *
 * Canonical content format
 * ────────────────────────
 * The canonical string is the JSON serialization of a fixed-key-order object:
 *
 *   {
 *     "caseId":    string,   // case document ID
 *     "data":      object,   // event-specific payload
 *     "eventType": string,   // event type discriminant
 *     "prevHash":  string,   // predecessor's hash ("" for genesis)
 *     "timestamp": number,   // epoch ms
 *     "userId":    string,   // Kinde user ID
 *     "userName":  string    // display name
 *   }
 *
 * Keys are listed in alphabetical order so the serialized string is deterministic.
 * The `_id` field is excluded (assigned by Convex post-insert).
 * The `hash` field is excluded (cannot be part of its own input).
 *
 * Crypto primitive
 * ────────────────
 * SHA-256 via the Web Crypto API (crypto.subtle.digest).  Available in:
 *   • All modern browsers (Chrome 37+, Firefox 34+, Safari 11+, Edge 79+)
 *   • Node.js 19+ via globalThis.crypto
 *   • The Convex V8 runtime
 *   • Deno and edge runtimes
 *
 * Performance
 * ───────────
 * Verification runs sequentially (one await per entry) to enable early exit at
 * the first broken link.  For typical case sizes (< 500 events), the full
 * verification completes in < 50 ms.  Large chains (1 000+ events) may take
 * ~100–200 ms — acceptable for an on-demand audit check, not for hot render paths.
 *
 * Usage
 * ─────
 *   import { verifyHashChain } from "@/lib/audit-hash-chain";
 *
 *   const result = await verifyHashChain(events); // events ordered timestamp ASC
 *   if (result.valid) {
 *     console.log(`Chain intact — ${result.checkedCount} entries verified.`);
 *   } else {
 *     console.warn(`Chain broken at index ${result.brokenAt}: ${result.reason}`);
 *   }
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Minimum shape of an audit ledger entry required for hash-chain verification.
 *
 * Compatible with `CaseEvent` from `convex/queries/events.ts`, but intentionally
 * not imported to keep this module dependency-free and independently testable.
 */
export interface AuditEntry {
  /** Convex document ID — excluded from the hash input (assigned post-insert). */
  _id: string;
  /** Case document ID — included in the canonical hash input. */
  caseId: string;
  /** Event type discriminant — included in the canonical hash input. */
  eventType: string;
  /** Kinde user ID of the actor — included in the canonical hash input. */
  userId: string;
  /** Display name of the actor — included in the canonical hash input. */
  userName: string;
  /** Epoch ms when the event occurred — included in the canonical hash input. */
  timestamp: number;
  /** Event-specific payload — included in the canonical hash input. */
  data: Record<string, unknown>;
  /**
   * SHA-256 digest of this entry's canonical content (hex-encoded, 64 chars).
   * Absent for entries written before FF_AUDIT_HASH_CHAIN was enabled — those
   * entries are skipped by verifyHashChain.
   */
  hash?: string;
  /**
   * Hash of the preceding entry in the chain (hex-encoded, 64 chars).
   * Empty string ("") for the genesis (first chained) entry.
   * Absent for entries written before FF_AUDIT_HASH_CHAIN was enabled.
   */
  prevHash?: string;
}

/** Returned when every checked entry passes verification. */
export interface HashChainValid {
  valid: true;
  /** Number of entries that carried a hash field and were successfully verified. */
  checkedCount: number;
}

/**
 * Returned when a broken link is detected.
 *
 * `brokenAt` is the zero-based index into the original `entries` array — the
 * position of the first entry that failed verification.  The caller can use
 * this index to highlight the offending row in the AuditLedgerTable.
 */
export interface HashChainBroken {
  valid: false;
  /**
   * Zero-based index into the `entries` array of the first failed entry.
   * May be used to highlight the offending row in the T5 Audit Ledger table.
   */
  brokenAt: number;
  /**
   * Machine-readable failure code.
   *
   * "broken_chain_link" — The entry's stored `prevHash` does not equal the
   *   previous chained entry's `hash`.  This indicates the chain was tampered
   *   with by inserting, removing, or reordering an event.
   *
   * "hash_mismatch" — The entry's stored `hash` does not match the SHA-256
   *   recomputed from the entry's canonical content.  This indicates the event
   *   content (data, actor, timestamp, etc.) was modified after recording.
   */
  reason: "broken_chain_link" | "hash_mismatch";
  /**
   * Human-readable description for logging or developer tooling.
   * Not intended for end-user display (use `reason` for UI labels).
   */
  detail: string;
}

/** Union return type of verifyHashChain. */
export type HashChainVerificationResult = HashChainValid | HashChainBroken;

// ─── Canonical content builder ────────────────────────────────────────────────

/**
 * Build the canonical UTF-8 string representation of an audit entry for hashing.
 *
 * This is the single source of truth for what gets hashed — both the client-side
 * verification (this function) and any server-side hash generation must produce
 * the identical string for the same event + prevHash combination.
 *
 * The canonical string is produced by `JSON.stringify` of a fixed-key-order object.
 * Keys are listed alphabetically to ensure determinism regardless of insertion
 * order in the upstream event object:
 *
 *   { caseId, data, eventType, prevHash, timestamp, userId, userName }
 *
 * Excluded fields:
 *   `_id`  — assigned by Convex after insert; not available at hash-write time.
 *   `hash` — the output of the computation; cannot be part of its own input.
 *
 * Important: The `data` field is included as-is via JSON.stringify.  JSON.stringify
 * preserves insertion-order key ordering for plain objects in all modern JS
 * engines (V8, SpiderMonkey, JavaScriptCore).  Because `data` is written to and
 * read from Convex in the same key order, the serialization is round-trip stable.
 *
 * @param entry     The audit entry to produce a canonical string for.
 * @param prevHash  Hash of the preceding chained entry ("" for the genesis entry).
 * @returns         Deterministic JSON string ready for SHA-256 hashing.
 */
export function buildCanonicalContent(entry: AuditEntry, prevHash: string): string {
  // Explicit alphabetical key order for determinism.
  // JSON.stringify preserves insertion order in all modern JS engines.
  return JSON.stringify({
    caseId:    entry.caseId,
    data:      entry.data,
    eventType: entry.eventType,
    prevHash:  prevHash,
    timestamp: entry.timestamp,
    userId:    entry.userId,
    userName:  entry.userName,
  });
}

// ─── SHA-256 helper ───────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 digest of a UTF-8 string using the Web Crypto API.
 *
 * Returns the digest as a lowercase hex string (exactly 64 characters),
 * matching the format stored in the `events.hash` and `events.prevHash`
 * database fields.
 *
 * Relies on `crypto.subtle.digest` which is:
 *   - Available in all modern browsers (Chrome 37+, Firefox 34+, Safari 11+)
 *   - Available in Node.js 19+ via `globalThis.crypto` (no import required)
 *   - Available in the Convex V8 runtime and all edge runtimes
 *   - FIPS-compliant and hardware-accelerated where available
 *
 * @param input  UTF-8 string to hash.
 * @returns      Promise resolving to a 64-character lowercase hex digest.
 */
export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Main verification function ───────────────────────────────────────────────

/**
 * Verify the SHA-256 hash-chain integrity of an ordered array of T5 audit
 * ledger entries.
 *
 * The function is:
 *   • **Pure** in spirit — no side effects, no DB calls, no global state mutations.
 *   • **Async** because SHA-256 computation via the Web Crypto API is async.
 *   • **Sequential** — awaits one hash at a time to enable early exit at the
 *     first broken link without computing hashes for subsequent entries.
 *
 * Entry ordering requirement
 * ──────────────────────────
 * `entries` must be ordered **chronologically** (timestamp ascending, oldest
 * first).  This matches the output of `getCaseEvents` from
 * `convex/queries/events.ts` and `useCaseEvents` from
 * `src/hooks/use-case-events.ts`.
 *
 * If the caller supplies entries in descending order (newest-first, as returned
 * by `getCaseEventsPaginated`), the verification will likely report a broken
 * chain because the prevHash linkage runs in ascending order.  Always sort
 * ascending before calling this function.
 *
 * Pre-FF entries
 * ──────────────
 * Entries without a `hash` field were written before FF_AUDIT_HASH_CHAIN was
 * enabled.  They are silently skipped — the chain verification only covers
 * entries that participated in the hash chain at write time.  A case where all
 * events pre-date the FF will return `{ valid: true, checkedCount: 0 }`.
 *
 * Mixed entries (some hashed, some not)
 * ──────────────────────────────────────
 * In a mixed array the chain anchor is the first entry that carries a `hash`
 * field; that entry's expected prevHash is `""` (empty string).  Subsequent
 * hashed entries must link back to the immediately preceding hashed entry.
 * Un-hashed entries in between are invisible to the verifier — the chain spans
 * the hashed entries only.
 *
 * @param entries  T5 audit ledger entries ordered by timestamp ascending.
 * @returns        Promise resolving to HashChainValid or HashChainBroken.
 *
 * @example
 *   // Inside T5Audit (client component, after useCaseEvents resolves):
 *   const events = useCaseEvents(caseId);  // ASC order
 *   const result = await verifyHashChain(events ?? []);
 *   if (!result.valid) {
 *     setChainStatus({ broken: true, brokenAt: result.brokenAt });
 *   }
 */
export async function verifyHashChain(
  entries: AuditEntry[],
): Promise<HashChainVerificationResult> {
  // ── Trivially valid: no entries to verify ─────────────────────────────────
  if (entries.length === 0) {
    return { valid: true, checkedCount: 0 };
  }

  // `prevHashedEntry` tracks the most recent entry that carried a hash field.
  // When null, the next hashed entry is the genesis entry and its expected
  // prevHash is "" (empty string).
  let prevHashedEntry: AuditEntry | null = null;
  let checkedCount = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // ── Skip entries that pre-date the hash chain feature ─────────────────
    // An entry without a `hash` field was written before FF_AUDIT_HASH_CHAIN
    // was enabled and is not part of the verified chain.
    if (!entry.hash) {
      continue;
    }

    // ── Step a: Determine expected prevHash ───────────────────────────────
    // Genesis entry (first in the chain): expected prevHash is "".
    // Subsequent entries: expected prevHash is the previous hashed entry's hash.
    const expectedPrevHash: string =
      prevHashedEntry === null ? "" : (prevHashedEntry.hash as string);

    // ── Step b: Verify chain linkage ──────────────────────────────────────
    // The stored prevHash must match the expected prevHash.
    // Treat an absent prevHash as "" (equivalent to the genesis entry form).
    const storedPrevHash = entry.prevHash ?? "";

    if (storedPrevHash !== expectedPrevHash) {
      return {
        valid: false,
        brokenAt: i,
        reason: "broken_chain_link",
        detail:
          `Entry at index ${i} (id: ${entry._id}): ` +
          `stored prevHash "${storedPrevHash.slice(0, 16)}${storedPrevHash.length > 16 ? "…" : ""}" ` +
          `does not match expected "${expectedPrevHash.slice(0, 16)}${expectedPrevHash.length > 16 ? "…" : ""}".`,
      };
    }

    // ── Step c: Recompute SHA-256 of canonical content ────────────────────
    // buildCanonicalContent produces the same string the server used when
    // writing the hash at event-insert time.
    const canonical = buildCanonicalContent(entry, expectedPrevHash);
    const recomputed = await sha256Hex(canonical);

    // ── Step d: Verify hash content integrity ─────────────────────────────
    // The recomputed hash must equal the stored hash.  A mismatch means the
    // event content (data, actor, timestamp, etc.) was modified after recording.
    if (recomputed !== entry.hash) {
      return {
        valid: false,
        brokenAt: i,
        reason: "hash_mismatch",
        detail:
          `Entry at index ${i} (id: ${entry._id}): ` +
          `stored hash "${entry.hash.slice(0, 16)}…" ` +
          `does not match recomputed hash "${recomputed.slice(0, 16)}…".`,
      };
    }

    // ── Entry verified ─────────────────────────────────────────────────────
    prevHashedEntry = entry;
    checkedCount++;
  }

  return { valid: true, checkedCount };
}
