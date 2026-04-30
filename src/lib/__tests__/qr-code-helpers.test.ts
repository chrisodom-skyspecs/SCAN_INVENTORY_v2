/**
 * Unit tests: convex/qrCodeHelpers (Sub-AC 1)
 *
 * The `qrCodeHelpers` module is the centralized source of truth for the
 * "one QR code → one case" uniqueness invariant.  Every Convex mutation that
 * writes `cases.qrCode` (associateQRCodeToCase, generateQRCodeForCase,
 * setQrCode, updateQrCode, generateQrCode) routes through it.
 *
 * These tests exercise every branch of the discriminated outcome union:
 *
 *   • normalizeQrPayload        — trim + empty rejection
 *   • detectQrCodeConflict      — invalid / available / mapped_to_this_case / conflict
 *   • formatQrCodeConflictMessage — stable wording for client error toasts
 *   • assertQrCodeAvailable     — convenience wrapper that throws on conflict
 *
 * The helper takes a `QrCodeConflictDeps` shape so tests can inject an
 * in-memory `Map<string, QrCodeCaseRow>` instead of standing up a Convex
 * runtime.  This is the same pattern used by `qr-code-validation.test.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeQrPayload,
  detectQrCodeConflict,
  formatQrCodeConflictMessage,
  assertQrCodeAvailable,
  type QrCodeCaseRow,
  type QrCodeConflictDeps,
  type QrCodeConflictOutcome,
} from "../../../convex/qrCodeHelpers";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CASE_A: QrCodeCaseRow = {
  _id:    "case_aaa111",
  label:  "CASE-001",
  qrCode: "https://scan.example.com/case/case_aaa111?uid=aaaa1111aaaa1111",
};

const CASE_B: QrCodeCaseRow = {
  _id:    "case_bbb222",
  label:  "CASE-002",
  qrCode: "https://scan.example.com/case/case_bbb222?uid=bbbb2222bbbb2222",
};

const CASE_FRESH: QrCodeCaseRow = {
  _id:    "case_ccc333",
  label:  "CASE-003",
  qrCode: "",
};

/**
 * Build a `QrCodeConflictDeps` that simulates the `by_qr_code` Convex index
 * with an in-memory Map.
 */
function buildDeps(...rows: QrCodeCaseRow[]): QrCodeConflictDeps {
  const byQR = new Map<string, QrCodeCaseRow>();
  for (const row of rows) {
    if (row.qrCode) byQR.set(row.qrCode, row);
  }
  return {
    findCaseByQrCode: async (qr) => byQR.get(qr) ?? null,
  };
}

// ─── normalizeQrPayload ──────────────────────────────────────────────────────

describe("normalizeQrPayload", () => {
  it("returns the original string when there is no surrounding whitespace", () => {
    expect(normalizeQrPayload("abc123")).toBe("abc123");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeQrPayload("   abc123   ")).toBe("abc123");
  });

  it("returns null for an empty string", () => {
    expect(normalizeQrPayload("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(normalizeQrPayload("   \t\n  ")).toBeNull();
  });

  it("preserves internal whitespace inside the payload", () => {
    expect(normalizeQrPayload("  foo bar  ")).toBe("foo bar");
  });
});

// ─── detectQrCodeConflict ────────────────────────────────────────────────────

describe("detectQrCodeConflict — discriminated outcomes", () => {
  it("returns kind='invalid' for an empty QR payload", async () => {
    const outcome = await detectQrCodeConflict("", CASE_FRESH._id, buildDeps());
    expect(outcome.kind).toBe("invalid");
    if (outcome.kind === "invalid") {
      expect(outcome.reason).toMatch(/empty/i);
    }
  });

  it("returns kind='invalid' for a whitespace-only payload (post-trim)", async () => {
    const outcome = await detectQrCodeConflict("   \t  ", CASE_FRESH._id, buildDeps());
    expect(outcome.kind).toBe("invalid");
  });

  it("returns kind='available' when no case carries the QR code", async () => {
    const fresh = "https://scan.example.com/case/new?uid=ffffffffffffffff";
    const outcome = await detectQrCodeConflict(fresh, CASE_FRESH._id, buildDeps(CASE_A, CASE_B));
    expect(outcome.kind).toBe("available");
  });

  it("returns kind='mapped_to_this_case' when QR is already on the target case", async () => {
    const outcome = await detectQrCodeConflict(CASE_A.qrCode, CASE_A._id, buildDeps(CASE_A));
    expect(outcome.kind).toBe("mapped_to_this_case");
  });

  it("returns kind='conflict' when QR is on a different case", async () => {
    const outcome = await detectQrCodeConflict(CASE_A.qrCode, CASE_FRESH._id, buildDeps(CASE_A));
    expect(outcome.kind).toBe("conflict");
    if (outcome.kind === "conflict") {
      expect(outcome.conflictingCaseId).toBe(CASE_A._id);
      expect(outcome.conflictingCaseLabel).toBe(CASE_A.label);
    }
  });

  it("trims leading/trailing whitespace before the index lookup", async () => {
    const padded = "  " + CASE_B.qrCode + "  ";
    const outcome = await detectQrCodeConflict(padded, CASE_FRESH._id, buildDeps(CASE_A, CASE_B));
    expect(outcome.kind).toBe("conflict");
    if (outcome.kind === "conflict") {
      expect(outcome.conflictingCaseId).toBe(CASE_B._id);
    }
  });

  it("invokes findCaseByQrCode with the trimmed payload", async () => {
    const calls: string[] = [];
    const deps: QrCodeConflictDeps = {
      findCaseByQrCode: async (qr) => {
        calls.push(qr);
        return null;
      },
    };
    await detectQrCodeConflict("  test-qr  ", CASE_FRESH._id, deps);
    expect(calls).toEqual(["test-qr"]);
  });
});

// ─── formatQrCodeConflictMessage ─────────────────────────────────────────────

describe("formatQrCodeConflictMessage", () => {
  it("includes the mutation name as a prefix", () => {
    const outcome: Extract<QrCodeConflictOutcome, { kind: "conflict" }> = {
      kind:                 "conflict",
      conflictingCaseId:    "case_xyz",
      conflictingCaseLabel: "CASE-XYZ",
    };
    const msg = formatQrCodeConflictMessage("setQrCode", outcome);
    expect(msg.startsWith("setQrCode:")).toBe(true);
  });

  it("includes both the conflicting case label AND ID", () => {
    const outcome: Extract<QrCodeConflictOutcome, { kind: "conflict" }> = {
      kind:                 "conflict",
      conflictingCaseId:    "case_xyz",
      conflictingCaseLabel: "CASE-XYZ",
    };
    const msg = formatQrCodeConflictMessage("setQrCode", outcome);
    expect(msg).toContain("CASE-XYZ");
    expect(msg).toContain("case_xyz");
  });

  it("contains stable wording client toasts can match", () => {
    const outcome: Extract<QrCodeConflictOutcome, { kind: "conflict" }> = {
      kind:                 "conflict",
      conflictingCaseId:    "id1",
      conflictingCaseLabel: "label1",
    };
    const msg = formatQrCodeConflictMessage("anyMut", outcome);
    expect(msg).toMatch(/already mapped to case/);
    expect(msg).toMatch(/only be associated with one case/);
  });
});

// ─── assertQrCodeAvailable ───────────────────────────────────────────────────

describe("assertQrCodeAvailable", () => {
  it("returns true when the QR is fresh (caller should patch DB)", async () => {
    const fresh = "https://scan.example.com/case/new?uid=0000000000000000";
    const result = await assertQrCodeAvailable(
      "myMutation", fresh, CASE_FRESH._id, buildDeps(CASE_A),
    );
    expect(result).toBe(true);
  });

  it("returns false when the QR is already on the target case (caller should skip patch)", async () => {
    const result = await assertQrCodeAvailable(
      "myMutation", CASE_A.qrCode, CASE_A._id, buildDeps(CASE_A),
    );
    expect(result).toBe(false);
  });

  it("throws with mutation name + 'non-empty' when the payload is empty", async () => {
    await expect(
      assertQrCodeAvailable("myMutation", "", CASE_FRESH._id, buildDeps())
    ).rejects.toThrow(/myMutation/);
    await expect(
      assertQrCodeAvailable("myMutation", "   ", CASE_FRESH._id, buildDeps())
    ).rejects.toThrow(/non-empty/);
  });

  it("throws with mutation name + 'already mapped' when the QR is on a different case", async () => {
    await expect(
      assertQrCodeAvailable(
        "myMutation",
        CASE_A.qrCode,
        CASE_FRESH._id,
        buildDeps(CASE_A),
      )
    ).rejects.toThrow(/myMutation/);
    await expect(
      assertQrCodeAvailable(
        "myMutation",
        CASE_A.qrCode,
        CASE_FRESH._id,
        buildDeps(CASE_A),
      )
    ).rejects.toThrow(/already mapped/);
  });

  it("error message includes the conflicting case label and ID", async () => {
    try {
      await assertQrCodeAvailable(
        "myMutation",
        CASE_A.qrCode,
        CASE_FRESH._id,
        buildDeps(CASE_A),
      );
      throw new Error("expected to throw");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain(CASE_A.label);
      expect(msg).toContain(CASE_A._id);
    }
  });
});

// ─── Type-level contract tests ────────────────────────────────────────────────

describe("QrCodeConflictOutcome — discriminated union", () => {
  it("kind='invalid' carries a reason string", () => {
    const outcome: QrCodeConflictOutcome = { kind: "invalid", reason: "x" };
    expect(outcome.kind).toBe("invalid");
    if (outcome.kind === "invalid") {
      expect(typeof outcome.reason).toBe("string");
    }
  });

  it("kind='available' has no extra fields", () => {
    const outcome: QrCodeConflictOutcome = { kind: "available" };
    expect(outcome.kind).toBe("available");
  });

  it("kind='mapped_to_this_case' has no extra fields", () => {
    const outcome: QrCodeConflictOutcome = { kind: "mapped_to_this_case" };
    expect(outcome.kind).toBe("mapped_to_this_case");
  });

  it("kind='conflict' carries conflictingCaseId and conflictingCaseLabel", () => {
    const outcome: QrCodeConflictOutcome = {
      kind:                 "conflict",
      conflictingCaseId:    "id",
      conflictingCaseLabel: "label",
    };
    expect(outcome.kind).toBe("conflict");
    if (outcome.kind === "conflict") {
      expect(outcome.conflictingCaseId).toBe("id");
      expect(outcome.conflictingCaseLabel).toBe("label");
    }
  });
});
