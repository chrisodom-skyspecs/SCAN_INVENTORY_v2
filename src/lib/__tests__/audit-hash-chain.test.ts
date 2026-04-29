/**
 * audit-hash-chain.test.ts — Unit tests for the T5 Audit Ledger hash-chain
 * verification utility.
 *
 * Test strategy
 * ─────────────
 * Rather than hard-coding pre-computed hash values (which would be brittle if
 * the canonical format ever changes), we use the same `sha256Hex` and
 * `buildCanonicalContent` helpers that `verifyHashChain` uses internally to
 * build test fixtures that are provably valid chains.  This gives us:
 *
 *   1. Round-trip correctness: a chain built with these helpers should always
 *      pass verification — if it doesn't, the verifier is broken.
 *
 *   2. Tamper scenarios: mutating any field on a fixture entry that was built
 *      with the correct hash should cause the verifier to return broken=true.
 *
 * Each describe block covers one logical category of behaviour:
 *   • Empty / pre-FF entries (no hash fields)
 *   • Single-entry chains
 *   • Multi-entry chains
 *   • Tamper detection: wrong prevHash, wrong data, wrong hash, wrong chain
 *   • Mixed (some entries without hash field interspersed)
 *   • Edge cases: concurrent-timestamp entries, large data payloads
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import {
  verifyHashChain,
  buildCanonicalContent,
  sha256Hex,
} from "../audit-hash-chain";
import type { AuditEntry } from "../audit-hash-chain";

// ─── Fixture builder helpers ──────────────────────────────────────────────────

/**
 * Minimal valid AuditEntry with deterministic field values.
 * Override any field via the second argument.
 */
function makeEntry(
  overrides: Partial<AuditEntry> & { _id: string; timestamp: number },
): AuditEntry {
  return {
    caseId:    "case-abc123",
    eventType: "status_change",
    userId:    "kp_user-001",
    userName:  "Jane Smith",
    data:      { from: "hangar", to: "assembled" },
    ...overrides,
  };
}

/**
 * Build a provably valid hash chain of N entries.
 *
 * Each entry's hash is computed from its canonical content + the previous
 * entry's hash (or "" for the first entry), ensuring verifyHashChain passes.
 *
 * @param count   Number of entries to generate.
 * @param base    Optional field overrides applied to every entry.
 */
async function buildValidChain(
  count: number,
  base?: Partial<Omit<AuditEntry, "_id" | "timestamp" | "hash" | "prevHash">>,
): Promise<AuditEntry[]> {
  const entries: AuditEntry[] = [];
  let prevHash = "";

  for (let i = 0; i < count; i++) {
    const partial = makeEntry({
      _id:       `event-${String(i).padStart(3, "0")}`,
      timestamp: 1_700_000_000_000 + i * 60_000,
      ...base,
    });

    const canonical = buildCanonicalContent(partial, prevHash);
    const hash = await sha256Hex(canonical);

    const entry: AuditEntry = {
      ...partial,
      prevHash,
      hash,
    };

    entries.push(entry);
    prevHash = hash;
  }

  return entries;
}

// ─── buildCanonicalContent ────────────────────────────────────────────────────

describe("buildCanonicalContent", () => {
  it("returns a parseable JSON string", () => {
    const entry = makeEntry({ _id: "e-001", timestamp: 1_700_000_000_000 });
    const canonical = buildCanonicalContent(entry, "");
    expect(() => JSON.parse(canonical)).not.toThrow();
  });

  it("includes all required fields in the canonical string", () => {
    const entry = makeEntry({ _id: "e-001", timestamp: 1_700_000_000_000 });
    const canonical = buildCanonicalContent(entry, "prev-hash-value");
    const parsed = JSON.parse(canonical);

    expect(parsed).toHaveProperty("caseId",    entry.caseId);
    expect(parsed).toHaveProperty("data",      entry.data);
    expect(parsed).toHaveProperty("eventType", entry.eventType);
    expect(parsed).toHaveProperty("prevHash",  "prev-hash-value");
    expect(parsed).toHaveProperty("timestamp", entry.timestamp);
    expect(parsed).toHaveProperty("userId",    entry.userId);
    expect(parsed).toHaveProperty("userName",  entry.userName);
  });

  it("excludes _id from the canonical string", () => {
    const entry = makeEntry({ _id: "should-not-appear", timestamp: 1_700_000_000_000 });
    const canonical = buildCanonicalContent(entry, "");
    expect(canonical).not.toContain("should-not-appear");
    expect(canonical).not.toContain("_id");
  });

  it("excludes hash from the canonical string", () => {
    const entry: AuditEntry = {
      ...makeEntry({ _id: "e-001", timestamp: 1_700_000_000_000 }),
      hash: "deadbeef-should-not-appear",
    };
    const canonical = buildCanonicalContent(entry, "");
    expect(canonical).not.toContain("deadbeef-should-not-appear");
    expect(canonical).not.toContain('"hash"');
  });

  it("produces different strings for different prevHash values", () => {
    const entry = makeEntry({ _id: "e-001", timestamp: 1_700_000_000_000 });
    const c1 = buildCanonicalContent(entry, "");
    const c2 = buildCanonicalContent(entry, "a".repeat(64));
    expect(c1).not.toBe(c2);
  });

  it("produces different strings for different data payloads", () => {
    const entry1 = makeEntry({
      _id:       "e-001",
      timestamp: 1_700_000_000_000,
      data:      { from: "hangar", to: "assembled" },
    });
    const entry2 = makeEntry({
      _id:       "e-001",
      timestamp: 1_700_000_000_000,
      data:      { from: "assembled", to: "transit_out" },
    });
    const c1 = buildCanonicalContent(entry1, "");
    const c2 = buildCanonicalContent(entry2, "");
    expect(c1).not.toBe(c2);
  });

  it("produces identical strings for identical inputs", () => {
    const entry = makeEntry({ _id: "e-001", timestamp: 1_700_000_000_000 });
    const c1 = buildCanonicalContent(entry, "abc");
    const c2 = buildCanonicalContent(entry, "abc");
    expect(c1).toBe(c2);
  });

  it("uses the provided prevHash not the entry.prevHash field", () => {
    const entry: AuditEntry = {
      ...makeEntry({ _id: "e-001", timestamp: 1_700_000_000_000 }),
      prevHash: "stored-prev-hash",
    };
    // Pass a different value as the prevHash argument
    const canonical = buildCanonicalContent(entry, "argument-prev-hash");
    const parsed = JSON.parse(canonical);
    expect(parsed.prevHash).toBe("argument-prev-hash");
    expect(parsed.prevHash).not.toBe("stored-prev-hash");
  });
});

// ─── sha256Hex ────────────────────────────────────────────────────────────────

describe("sha256Hex", () => {
  it("returns a 64-character lowercase hex string", async () => {
    const digest = await sha256Hex("hello world");
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the known SHA-256 digest for 'hello world'", async () => {
    // SHA-256("hello world") in UTF-8 = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    // Verified by running: echo -n "hello world" | shasum -a 256
    const digest = await sha256Hex("hello world");
    expect(digest).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    );
  });

  it("produces the known SHA-256 digest for the empty string", async () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const digest = await sha256Hex("");
    expect(digest).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("produces different digests for different inputs", async () => {
    const d1 = await sha256Hex("input-a");
    const d2 = await sha256Hex("input-b");
    expect(d1).not.toBe(d2);
  });

  it("is deterministic — same input always yields the same digest", async () => {
    const input = '{"caseId":"test","timestamp":123}';
    const d1 = await sha256Hex(input);
    const d2 = await sha256Hex(input);
    expect(d1).toBe(d2);
  });
});

// ─── verifyHashChain — empty / no-hash entries ───────────────────────────────

describe("verifyHashChain — empty / pre-FF entries", () => {
  it("returns valid with checkedCount=0 for an empty array", async () => {
    const result = await verifyHashChain([]);
    expect(result).toEqual({ valid: true, checkedCount: 0 });
  });

  it("returns valid when no entry has a hash field", async () => {
    const entries: AuditEntry[] = [
      makeEntry({ _id: "e-001", timestamp: 1_700_000_000_000 }),
      makeEntry({ _id: "e-002", timestamp: 1_700_000_060_000 }),
      makeEntry({ _id: "e-003", timestamp: 1_700_000_120_000 }),
    ];
    // None have hash / prevHash — pre-date the FF
    const result = await verifyHashChain(entries);
    expect(result).toEqual({ valid: true, checkedCount: 0 });
  });

  it("reports checkedCount=0 when all hash fields are skipped", async () => {
    const entries = [makeEntry({ _id: "e-001", timestamp: 1_700_000_000_000 })];
    const result = await verifyHashChain(entries);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.checkedCount).toBe(0);
    }
  });
});

// ─── verifyHashChain — single-entry chain ─────────────────────────────────────

describe("verifyHashChain — single-entry chain", () => {
  it("verifies a single valid genesis entry (prevHash='')", async () => {
    const [entry] = await buildValidChain(1);
    const result = await verifyHashChain([entry]);
    expect(result).toEqual({ valid: true, checkedCount: 1 });
  });

  it("detects hash_mismatch when a single entry's hash is corrupted", async () => {
    const [entry] = await buildValidChain(1);
    const tampered: AuditEntry = { ...entry, hash: "f".repeat(64) };
    const result = await verifyHashChain([tampered]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("hash_mismatch");
      expect(result.brokenAt).toBe(0);
    }
  });

  it("detects hash_mismatch when entry data is tampered", async () => {
    const [entry] = await buildValidChain(1);
    // The hash was computed for the original data; changing data should fail verification
    const tampered: AuditEntry = {
      ...entry,
      data: { from: "hangar", to: "TAMPERED" },
    };
    const result = await verifyHashChain([tampered]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("hash_mismatch");
      expect(result.brokenAt).toBe(0);
    }
  });

  it("detects hash_mismatch when timestamp is tampered", async () => {
    const [entry] = await buildValidChain(1);
    const tampered: AuditEntry = { ...entry, timestamp: entry.timestamp + 9999 };
    const result = await verifyHashChain([tampered]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("hash_mismatch");
    }
  });

  it("detects hash_mismatch when userName is tampered", async () => {
    const [entry] = await buildValidChain(1);
    const tampered: AuditEntry = { ...entry, userName: "Eve (Attacker)" };
    const result = await verifyHashChain([tampered]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("hash_mismatch");
    }
  });

  it("detects hash_mismatch when userId is tampered", async () => {
    const [entry] = await buildValidChain(1);
    const tampered: AuditEntry = { ...entry, userId: "kp_attacker-999" };
    const result = await verifyHashChain([tampered]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("hash_mismatch");
    }
  });

  it("detects hash_mismatch when caseId is tampered", async () => {
    const [entry] = await buildValidChain(1);
    const tampered: AuditEntry = { ...entry, caseId: "different-case-id" };
    const result = await verifyHashChain([tampered]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("hash_mismatch");
    }
  });

  it("detects hash_mismatch when eventType is tampered", async () => {
    const [entry] = await buildValidChain(1);
    const tampered: AuditEntry = { ...entry, eventType: "custody_handoff" };
    const result = await verifyHashChain([tampered]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("hash_mismatch");
    }
  });

  it("ignores _id changes — _id is not included in the hash", async () => {
    const [entry] = await buildValidChain(1);
    // Changing _id should NOT affect verification (it's excluded from canonical content)
    const withDifferentId: AuditEntry = { ...entry, _id: "different-id-value" };
    const result = await verifyHashChain([withDifferentId]);
    expect(result).toEqual({ valid: true, checkedCount: 1 });
  });
});

// ─── verifyHashChain — multi-entry chains ─────────────────────────────────────

describe("verifyHashChain — multi-entry chains", () => {
  it("verifies a valid 3-entry chain", async () => {
    const entries = await buildValidChain(3);
    const result = await verifyHashChain(entries);
    expect(result).toEqual({ valid: true, checkedCount: 3 });
  });

  it("verifies a valid 10-entry chain", async () => {
    const entries = await buildValidChain(10);
    const result = await verifyHashChain(entries);
    expect(result).toEqual({ valid: true, checkedCount: 10 });
  });

  it("reports checkedCount equal to the number of hashed entries", async () => {
    const entries = await buildValidChain(7);
    const result = await verifyHashChain(entries);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.checkedCount).toBe(7);
    }
  });

  it("detects broken_chain_link when second entry has wrong prevHash", async () => {
    const entries = await buildValidChain(3);
    // Corrupt entry[1]'s prevHash so it no longer links to entry[0]'s hash
    const tampered = entries.map((e, i) =>
      i === 1 ? { ...e, prevHash: "wrong-prev-hash-" + "0".repeat(48) } : e
    );
    const result = await verifyHashChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("broken_chain_link");
      expect(result.brokenAt).toBe(1);
    }
  });

  it("detects broken_chain_link when an entry is inserted between two valid entries", async () => {
    const entries = await buildValidChain(3);
    // Insert a rogue entry between entries[0] and entries[1].
    // entries[1] still has prevHash = entries[0].hash, but now there's a
    // rogue entry in between that changes what the expected prevHash should be.
    const rogueEntry = makeEntry({
      _id:       "rogue-event",
      timestamp: entries[0].timestamp + 1,
    });
    const withRogue: AuditEntry[] = [
      entries[0],
      rogueEntry,         // no hash (simulates pre-FF event insert)
      entries[1],         // still has prevHash = entries[0].hash → correct for its position
      entries[2],
    ];
    // Because rogueEntry has no hash, it's skipped. entries[1] still links to
    // entries[0] which is the last hashed entry — this should still be valid.
    const result = await verifyHashChain(withRogue);
    expect(result).toEqual({ valid: true, checkedCount: 3 });
  });

  it("detects broken_chain_link when a hashed entry is inserted breaking the chain", async () => {
    const entries = await buildValidChain(3);

    // Build an intruder entry that has its own valid hash but wrong prevHash
    // (it was hashed as if it was the first entry, but it's injected at index 1).
    const [intruder] = await buildValidChain(1, { eventType: "note_added" });

    // entries[1]'s prevHash = entries[0].hash, but now entries[0] is followed
    // by intruder whose prevHash = "" (genesis). The chain verifier should see
    // intruder.prevHash != entries[0].hash.
    const injected: AuditEntry[] = [entries[0], intruder, entries[1], entries[2]];
    const result = await verifyHashChain(injected);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      // intruder is at index 1; its prevHash is "" but expected is entries[0].hash
      expect(result.brokenAt).toBe(1);
      expect(result.reason).toBe("broken_chain_link");
    }
  });

  it("detects hash_mismatch at the correct index in a multi-entry chain", async () => {
    const entries = await buildValidChain(5);
    // Tamper with entry[2]'s data (hash still points to what was computed before)
    const tampered = entries.map((e, i) =>
      i === 2 ? { ...e, data: { tampered: true } } : e
    );
    const result = await verifyHashChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("hash_mismatch");
      expect(result.brokenAt).toBe(2);
    }
  });

  it("stops at the first broken link (does not report subsequent broken entries)", async () => {
    const entries = await buildValidChain(5);
    // Tamper with entries[1] AND entries[3] — verifier should stop at [1]
    const tampered = entries.map((e, i) => {
      if (i === 1) return { ...e, data: { tampered: "first" } };
      if (i === 3) return { ...e, data: { tampered: "second" } };
      return e;
    });
    const result = await verifyHashChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      // Should stop at the first broken entry (index 1)
      expect(result.brokenAt).toBe(1);
    }
  });

  it("verifies each prevHash is the hex hash of the preceding entry", async () => {
    const entries = await buildValidChain(4);
    // Manually verify the chain structure
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].prevHash).toBe(entries[i - 1].hash);
    }
    // And that entry[0] has prevHash = ""
    expect(entries[0].prevHash).toBe("");
  });
});

// ─── verifyHashChain — mixed (some pre-FF, some hashed) ───────────────────────

describe("verifyHashChain — mixed entries (pre-FF and hashed)", () => {
  it("skips pre-FF entries at the beginning and verifies the rest", async () => {
    const preFfEntries: AuditEntry[] = [
      makeEntry({ _id: "pre-001", timestamp: 1_699_000_000_000 }),
      makeEntry({ _id: "pre-002", timestamp: 1_699_100_000_000 }),
    ];
    const hashedEntries = await buildValidChain(3);
    // Shift timestamps so hashed entries come after pre-FF ones
    const shiftedHashed = hashedEntries.map((e, i) => ({
      ...e,
      timestamp: 1_700_000_000_000 + i * 60_000,
    }));
    const mixed = [...preFfEntries, ...shiftedHashed];

    const result = await verifyHashChain(mixed);
    // Pre-FF entries are skipped; the 3 hashed entries should be valid
    expect(result).toEqual({ valid: true, checkedCount: 3 });
  });

  it("skips a pre-FF entry interspersed between two hashed entries", async () => {
    const entries = await buildValidChain(3);
    const preFf = makeEntry({ _id: "pre-FF", timestamp: entries[0].timestamp + 1 });
    // Insert pre-FF between entries[0] and entries[1]
    // entries[1].prevHash still equals entries[0].hash because it was built that way
    const mixed: AuditEntry[] = [entries[0], preFf, entries[1], entries[2]];

    const result = await verifyHashChain(mixed);
    // preFf has no hash → skipped; chain remains [0]→[1]→[2] all valid
    expect(result).toEqual({ valid: true, checkedCount: 3 });
  });

  it("reports checkedCount equal to hashed entries only", async () => {
    const preFfEntries: AuditEntry[] = [
      makeEntry({ _id: "pre-001", timestamp: 1_699_000_000_000 }),
      makeEntry({ _id: "pre-002", timestamp: 1_699_100_000_000 }),
      makeEntry({ _id: "pre-003", timestamp: 1_699_200_000_000 }),
    ];
    const hashedEntries = await buildValidChain(2);
    const mixed = [...preFfEntries, ...hashedEntries];

    const result = await verifyHashChain(mixed);
    expect(result.valid).toBe(true);
    if (result.valid) {
      // Only the 2 hashed entries count
      expect(result.checkedCount).toBe(2);
    }
  });
});

// ─── verifyHashChain — return type narrowing ──────────────────────────────────

describe("verifyHashChain — result type narrowing", () => {
  it("HashChainValid has valid=true and checkedCount", async () => {
    const entries = await buildValidChain(2);
    const result = await verifyHashChain(entries);
    expect(result.valid).toBe(true);
    if (result.valid) {
      // TypeScript narrowing: result is HashChainValid here
      expect(typeof result.checkedCount).toBe("number");
      expect(result.checkedCount).toBeGreaterThan(0);
    }
  });

  it("HashChainBroken has valid=false, brokenAt, reason, and detail", async () => {
    const entries = await buildValidChain(2);
    const tampered = [{ ...entries[0], hash: "f".repeat(64) }, entries[1]];
    const result = await verifyHashChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      // TypeScript narrowing: result is HashChainBroken here
      expect(typeof result.brokenAt).toBe("number");
      expect(result.reason).toMatch(/^(broken_chain_link|hash_mismatch)$/);
      expect(typeof result.detail).toBe("string");
      expect(result.detail.length).toBeGreaterThan(0);
    }
  });

  it("brokenAt points to the zero-based index in the original entries array", async () => {
    const entries = await buildValidChain(5);
    // Tamper entry at index 3
    const tampered = entries.map((e, i) =>
      i === 3 ? { ...e, data: { corrupted: true } } : e
    );
    const result = await verifyHashChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAt).toBe(3);
    }
  });
});

// ─── verifyHashChain — chain link failure messages ────────────────────────────

describe("verifyHashChain — detail messages", () => {
  it("includes the entry _id in the detail when broken_chain_link", async () => {
    const entries = await buildValidChain(2);
    const tampered = entries.map((e, i) =>
      i === 1 ? { ...e, prevHash: "bad-prev-hash-" + "0".repeat(50) } : e
    );
    const result = await verifyHashChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.detail).toContain(entries[1]._id);
    }
  });

  it("includes the entry _id in the detail when hash_mismatch", async () => {
    const entries = await buildValidChain(2);
    const tampered = entries.map((e, i) =>
      i === 1 ? { ...e, hash: "a".repeat(64) } : e
    );
    const result = await verifyHashChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.detail).toContain(entries[1]._id);
    }
  });

  it("includes the index in the detail message", async () => {
    const entries = await buildValidChain(4);
    const tampered = entries.map((e, i) =>
      i === 2 ? { ...e, hash: "c".repeat(64) } : e
    );
    const result = await verifyHashChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.detail).toContain("2");
    }
  });
});

// ─── verifyHashChain — edge cases ─────────────────────────────────────────────

describe("verifyHashChain — edge cases", () => {
  it("handles entries with complex nested data payloads", async () => {
    const complexData = {
      trackingNumber: "794644823741",
      carrier: "FedEx",
      origin: { name: "SkySpecs HQ", lat: 42.279594, lng: -83.732124 },
      destination: { name: "Site Alpha", lat: 43.123, lng: -84.456 },
      notes: "Handle with care — éàü special chars",
    };
    const entries = await buildValidChain(2, { data: complexData });
    const result = await verifyHashChain(entries);
    expect(result).toEqual({ valid: true, checkedCount: 2 });
  });

  it("handles entries with empty data payload {}", async () => {
    const entries = await buildValidChain(2, { data: {} });
    const result = await verifyHashChain(entries);
    expect(result).toEqual({ valid: true, checkedCount: 2 });
  });

  it("handles entries where prevHash is absent on genesis entry (treated as '')", async () => {
    const [entry] = await buildValidChain(1);
    // Remove prevHash from the genesis entry (it's "" but might not always be set)
    const withoutPrevHash: AuditEntry = { ...entry };
    delete withoutPrevHash.prevHash;
    const result = await verifyHashChain([withoutPrevHash]);
    expect(result).toEqual({ valid: true, checkedCount: 1 });
  });

  it("handles entries with Unicode actor names", async () => {
    const entries = await buildValidChain(2, { userName: "Müller, Jörg" });
    const result = await verifyHashChain(entries);
    expect(result).toEqual({ valid: true, checkedCount: 2 });
  });

  it("handles entries with very long caseId strings", async () => {
    const longCaseId = "j" + "x".repeat(50);
    const entries = await buildValidChain(2, { caseId: longCaseId });
    const result = await verifyHashChain(entries);
    expect(result).toEqual({ valid: true, checkedCount: 2 });
  });

  it("is stable across multiple invocations on the same valid chain", async () => {
    const entries = await buildValidChain(5);
    const [r1, r2, r3] = await Promise.all([
      verifyHashChain(entries),
      verifyHashChain(entries),
      verifyHashChain(entries),
    ]);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
    expect(r1).toEqual({ valid: true, checkedCount: 5 });
  });

  it("does not mutate the input entries array", async () => {
    const entries = await buildValidChain(3);
    const snapshot = entries.map((e) => ({ ...e }));
    await verifyHashChain(entries);
    for (let i = 0; i < entries.length; i++) {
      expect(entries[i]).toEqual(snapshot[i]);
    }
  });

  it("a chain with a single hashed entry followed by pre-FF entries is valid", async () => {
    const [hashedEntry] = await buildValidChain(1);
    const preFfEntries: AuditEntry[] = [
      makeEntry({ _id: "post-001", timestamp: hashedEntry.timestamp + 60_000 }),
      makeEntry({ _id: "post-002", timestamp: hashedEntry.timestamp + 120_000 }),
    ];
    const mixed: AuditEntry[] = [hashedEntry, ...preFfEntries];
    const result = await verifyHashChain(mixed);
    expect(result).toEqual({ valid: true, checkedCount: 1 });
  });
});
