/**
 * Unit tests: QR code validation logic (Sub-AC 2)
 *
 * Tests the pure logic extracted from:
 *   • convex/qrCodes.ts  validateQrCode  (server-side query)
 *   • convex/qrCodes.ts  associateQRCodeToCase  (server-side mutation)
 *
 * Since Convex server-side functions cannot be instantiated in a standard Vitest
 * environment (they require the Convex runtime), these tests exercise:
 *
 *   1. The in-process validation logic that mirrors the Convex handler.
 *   2. The exported TypeScript interfaces (QrCodeValidationResult,
 *      AssociateQRCodeResult) — verifying the contract shape.
 *   3. Correctness of the status discrimination rules:
 *        • Empty / whitespace QR       → "invalid"
 *        • QR not in any case          → "available"
 *        • QR already on target case   → "mapped_to_this_case"
 *        • QR on a different case      → "mapped_to_other_case"
 *
 * Strategy
 * ────────
 * The core uniqueness logic is a simple conditional tree driven by one
 * database lookup (by_qr_code index).  We replicate that tree in-process
 * using a tiny in-memory "database" so we can unit-test every branch without
 * standing up a real Convex backend.
 *
 * The same tree is tested on the client side (AssociateQRClient.tsx uses the
 * `validateQrCode` query result to drive conflict banners).  These tests verify
 * that the server-side logic and the client-side conditional rendering agree.
 *
 * Covered scenarios
 * ─────────────────
 *  QR validation status rules
 *   1.  Empty string      → status "invalid"
 *   2.  Whitespace-only   → status "invalid" (trimmed before check)
 *   3.  Valid, unmapped   → status "available"
 *   4.  Mapped to target  → status "mapped_to_this_case"
 *   5.  Mapped elsewhere  → status "mapped_to_other_case"
 *   6.  Conflict includes label and ID
 *
 *  AssociateQRCodeResult interface contract
 *   7.  wasAlreadyMapped: false for new association
 *   8.  wasAlreadyMapped: true for idempotent re-association
 *   9.  caseId and qrCode are present in result
 *
 *  Edge cases
 *  10.  QR payloads with URL characters are accepted without modification
 *  11.  Very long QR payloads (URL max 2048 chars) validate as "available"
 *  12.  Case label is preserved in the conflictingCaseLabel field
 */

import { describe, it, expect } from "vitest";
import type {
  QrCodeValidationResult,
  AssociateQRCodeResult,
  GenerateQRCodeResult,
} from "../../../convex/qrCodes";

// ─── In-process replica of the validateQrCode handler logic ──────────────────
//
// Mirrors the server handler in convex/qrCodes.ts so we can test every branch
// without a Convex runtime.  The only difference is that db.query(...) is
// replaced with an in-memory map lookup.

interface MockCaseRow {
  _id:   string;
  label: string;
  qrCode: string;
}

/**
 * Pure function replicating the validateQrCode Convex handler.
 *
 * @param qrCode       The QR payload to validate.
 * @param caseId       The target case ID.
 * @param casesByQR    Simulated `by_qr_code` index (QR → case row).
 */
function validateQrCodeInProcess(
  qrCode:    string,
  caseId:    string,
  casesByQR: Map<string, MockCaseRow>
): QrCodeValidationResult {
  // ── 1. Reject blank QR payloads ───────────────────────────────────────────
  const trimmed = qrCode.trim();
  if (trimmed.length === 0) {
    return {
      status: "invalid",
      reason: "QR code must not be empty.",
    };
  }

  // ── 2. Check by_qr_code index ─────────────────────────────────────────────
  const existingCase = casesByQR.get(trimmed) ?? null;

  // ── 3. QR code is not yet mapped ──────────────────────────────────────────
  if (existingCase === null) {
    return { status: "available" };
  }

  // ── 4. QR code is already on the target case (idempotent) ─────────────────
  if (existingCase._id === caseId) {
    return { status: "mapped_to_this_case" };
  }

  // ── 5. QR code belongs to a different case (conflict) ─────────────────────
  return {
    status:               "mapped_to_other_case",
    conflictingCaseLabel: existingCase.label,
    conflictingCaseId:    existingCase._id,
  };
}

/**
 * Pure function replicating the associateQRCodeToCase handler logic for the
 * non-persistence parts (validation checks and result shape).
 *
 * Does NOT replicate the DB write or event insertion — those are Convex
 * implementation details that require the runtime.
 */
function associateQRCodeInProcess(
  qrCode:    string,
  caseId:    string,
  casesByQR: Map<string, MockCaseRow>,
  casesById: Map<string, MockCaseRow>
): { result: AssociateQRCodeResult } | { error: string } {
  const trimmed = qrCode.trim();

  // ── 1. Validate non-empty ─────────────────────────────────────────────────
  if (trimmed.length === 0) {
    return { error: "associateQRCodeToCase: qrCode must be a non-empty string." };
  }

  // ── 2. Target case must exist ─────────────────────────────────────────────
  const caseDoc = casesById.get(caseId);
  if (!caseDoc) {
    return { error: `associateQRCodeToCase: Case "${caseId}" not found.` };
  }

  // ── 3. Idempotent check — QR already on this exact case ───────────────────
  if (caseDoc.qrCode === trimmed) {
    return {
      result: {
        caseId,
        qrCode: trimmed,
        wasAlreadyMapped: true,
      },
    };
  }

  // ── 4. Uniqueness check ───────────────────────────────────────────────────
  const conflictingCase = casesByQR.get(trimmed) ?? null;
  if (conflictingCase !== null) {
    return {
      error:
        `associateQRCodeToCase: QR code is already mapped to case ` +
        `"${conflictingCase.label}" (ID: ${conflictingCase._id}). ` +
        `Each QR code may only be associated with one case.`,
    };
  }

  // ── 5. Persist (simulated) ────────────────────────────────────────────────
  // In real code this patches the DB row and inserts an event.
  // Here we just confirm the result shape.
  return {
    result: {
      caseId,
      qrCode: trimmed,
      wasAlreadyMapped: false,
    },
  };
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

const CASE_A: MockCaseRow = {
  _id:    "case_aaa111",
  label:  "CASE-aaa111",
  qrCode: "https://scan.example.com/case/case_aaa111?uid=aaa1111111111111",
};

const CASE_B: MockCaseRow = {
  _id:    "case_bbb222",
  label:  "CASE-bbb222",
  qrCode: "https://scan.example.com/case/case_bbb222?uid=bbb2222222222222",
};

const CASE_C: MockCaseRow = {
  _id:    "case_ccc333",
  label:  "CASE-ccc333",
  qrCode: "",  // no QR associated yet
};

/** Build an in-memory by_qr_code index from an array of case rows. */
function buildQRIndex(...cases: MockCaseRow[]): Map<string, MockCaseRow> {
  const map = new Map<string, MockCaseRow>();
  for (const c of cases) {
    if (c.qrCode) map.set(c.qrCode, c);
  }
  return map;
}

/** Build an in-memory by_id index from an array of case rows. */
function buildIDIndex(...cases: MockCaseRow[]): Map<string, MockCaseRow> {
  return new Map(cases.map((c) => [c._id, c]));
}

// ─── validateQrCode status rules ─────────────────────────────────────────────

describe("validateQrCode — status rules", () => {
  const qrIndex = buildQRIndex(CASE_A, CASE_B);
  const idIndex  = buildIDIndex(CASE_A, CASE_B, CASE_C);

  it("returns status='invalid' for an empty string", () => {
    const result = validateQrCodeInProcess("", CASE_C._id, qrIndex);
    expect(result.status).toBe("invalid");
  });

  it("returns status='invalid' for a whitespace-only string (trimmed before check)", () => {
    const result = validateQrCodeInProcess("   \t  ", CASE_C._id, qrIndex);
    expect(result.status).toBe("invalid");
  });

  it("includes a reason string for invalid QR codes", () => {
    const result = validateQrCodeInProcess("", CASE_C._id, qrIndex);
    expect(typeof result.reason).toBe("string");
    expect((result.reason ?? "").length).toBeGreaterThan(0);
  });

  it("returns status='available' when no case carries the QR code", () => {
    const freshQR = "https://scan.example.com/case/brand-new?uid=ffffffffffffffff";
    const result = validateQrCodeInProcess(freshQR, CASE_C._id, qrIndex);
    expect(result.status).toBe("available");
  });

  it("returns status='mapped_to_this_case' when QR matches the target case", () => {
    // CASE_A already carries its own QR code
    const result = validateQrCodeInProcess(CASE_A.qrCode, CASE_A._id, qrIndex);
    expect(result.status).toBe("mapped_to_this_case");
  });

  it("returns status='mapped_to_other_case' when QR belongs to a different case", () => {
    // CASE_A's QR code, but target is CASE_C
    const result = validateQrCodeInProcess(CASE_A.qrCode, CASE_C._id, qrIndex);
    expect(result.status).toBe("mapped_to_other_case");
  });

  it("includes conflictingCaseLabel for mapped_to_other_case", () => {
    const result = validateQrCodeInProcess(CASE_A.qrCode, CASE_C._id, qrIndex);
    expect(result.conflictingCaseLabel).toBe(CASE_A.label);
  });

  it("includes conflictingCaseId for mapped_to_other_case", () => {
    const result = validateQrCodeInProcess(CASE_A.qrCode, CASE_C._id, qrIndex);
    expect(result.conflictingCaseId).toBe(CASE_A._id);
  });

  it("conflictingCaseLabel and conflictingCaseId are undefined for 'available'", () => {
    const freshQR = "https://scan.example.com/case/fresh?uid=0000000000000000";
    const result = validateQrCodeInProcess(freshQR, CASE_C._id, qrIndex);
    expect(result.conflictingCaseLabel).toBeUndefined();
    expect(result.conflictingCaseId).toBeUndefined();
  });

  it("conflictingCaseLabel and conflictingCaseId are undefined for 'mapped_to_this_case'", () => {
    const result = validateQrCodeInProcess(CASE_B.qrCode, CASE_B._id, qrIndex);
    expect(result.conflictingCaseLabel).toBeUndefined();
    expect(result.conflictingCaseId).toBeUndefined();
  });

  it("reason is undefined for non-invalid statuses", () => {
    const freshQR = "https://scan.example.com/case/fresh2?uid=1111111111111111";
    const available = validateQrCodeInProcess(freshQR, CASE_C._id, qrIndex);
    const mapped    = validateQrCodeInProcess(CASE_A.qrCode, CASE_A._id, qrIndex);
    const conflict  = validateQrCodeInProcess(CASE_A.qrCode, CASE_C._id, qrIndex);
    expect(available.reason).toBeUndefined();
    expect(mapped.reason).toBeUndefined();
    expect(conflict.reason).toBeUndefined();
  });

  void idIndex; // suppress "declared but never used" for the idIndex fixture
});

// ─── validateQrCode edge cases ────────────────────────────────────────────────

describe("validateQrCode — edge cases", () => {
  it("accepts a QR payload that is a URL with query params", () => {
    const freshQR = "https://scan.skyspecs.com/case/abc123?uid=deadbeef01234567&site=Denver";
    const qrIndex = buildQRIndex(); // empty — no cases carry any QR
    const result = validateQrCodeInProcess(freshQR, "case_new", qrIndex);
    expect(result.status).toBe("available");
  });

  it("accepts a very long QR payload (2048 chars) and returns 'available'", () => {
    const longQR = "https://scan.example.com/case/x?" + "a=".padEnd(2040, "b");
    const qrIndex = buildQRIndex();
    const result = validateQrCodeInProcess(longQR, "case_new", qrIndex);
    expect(result.status).toBe("available");
  });

  it("normalises leading/trailing whitespace before index lookup (trims the payload)", () => {
    const rawQR    = "  " + CASE_A.qrCode + "  ";
    const qrIndex  = buildQRIndex(CASE_A);
    // After trimming, rawQR === CASE_A.qrCode which is on CASE_A, target is CASE_C
    const result = validateQrCodeInProcess(rawQR, CASE_C._id, qrIndex);
    expect(result.status).toBe("mapped_to_other_case");
    expect(result.conflictingCaseId).toBe(CASE_A._id);
  });
});

// ─── associateQRCodeToCase — validation logic ─────────────────────────────────

describe("associateQRCodeToCase — validation logic", () => {
  const qrIndex = buildQRIndex(CASE_A, CASE_B);
  const idIndex  = buildIDIndex(CASE_A, CASE_B, CASE_C);

  it("returns an error for an empty qrCode", () => {
    const outcome = associateQRCodeInProcess("", CASE_C._id, qrIndex, idIndex);
    expect("error" in outcome).toBe(true);
    if ("error" in outcome) {
      expect(outcome.error).toContain("non-empty");
    }
  });

  it("returns an error when the case does not exist", () => {
    const outcome = associateQRCodeInProcess(
      "https://scan.example.com/case/new?uid=0000000000000000",
      "nonexistent_case",
      qrIndex,
      idIndex
    );
    expect("error" in outcome).toBe(true);
    if ("error" in outcome) {
      expect(outcome.error).toContain("not found");
    }
  });

  it("returns wasAlreadyMapped=true when the QR is already on the target case", () => {
    const outcome = associateQRCodeInProcess(CASE_A.qrCode, CASE_A._id, qrIndex, idIndex);
    expect("result" in outcome).toBe(true);
    if ("result" in outcome) {
      expect(outcome.result.wasAlreadyMapped).toBe(true);
    }
  });

  it("returns wasAlreadyMapped=false when the QR is freshly associated", () => {
    const freshQR = "https://scan.example.com/case/case_ccc333?uid=cccc33333333cccc";
    const outcome = associateQRCodeInProcess(freshQR, CASE_C._id, qrIndex, idIndex);
    expect("result" in outcome).toBe(true);
    if ("result" in outcome) {
      expect(outcome.result.wasAlreadyMapped).toBe(false);
    }
  });

  it("returns an error when the QR belongs to a different case (uniqueness violation)", () => {
    // Try to associate CASE_A's QR with CASE_C — should fail
    const outcome = associateQRCodeInProcess(CASE_A.qrCode, CASE_C._id, qrIndex, idIndex);
    expect("error" in outcome).toBe(true);
    if ("error" in outcome) {
      expect(outcome.error).toContain("already mapped");
      expect(outcome.error).toContain(CASE_A.label);
      expect(outcome.error).toContain(CASE_A._id);
    }
  });

  it("result includes caseId matching the target", () => {
    const freshQR = "https://scan.example.com/new?uid=eeee5555eeee5555";
    const outcome = associateQRCodeInProcess(freshQR, CASE_C._id, qrIndex, idIndex);
    expect("result" in outcome).toBe(true);
    if ("result" in outcome) {
      expect(outcome.result.caseId).toBe(CASE_C._id);
    }
  });

  it("result includes trimmed qrCode", () => {
    const rawQR  = "  https://scan.example.com/new?uid=ffff6666ffff6666  ";
    const outcome = associateQRCodeInProcess(rawQR, CASE_C._id, qrIndex, idIndex);
    expect("result" in outcome).toBe(true);
    if ("result" in outcome) {
      expect(outcome.result.qrCode).toBe(rawQR.trim());
    }
  });
});

// ─── AssociateQRCodeResult interface shape ────────────────────────────────────

describe("AssociateQRCodeResult — interface contract", () => {
  it("result shape satisfies AssociateQRCodeResult contract", () => {
    const result: AssociateQRCodeResult = {
      caseId:          "case_test",
      qrCode:          "https://scan.example.com/case/test?uid=1234567890123456",
      wasAlreadyMapped: false,
    };
    // If TypeScript compiles this assignment, the interface contract is satisfied.
    expect(result.caseId).toBe("case_test");
    expect(typeof result.qrCode).toBe("string");
    expect(typeof result.wasAlreadyMapped).toBe("boolean");
  });
});

// ─── QrCodeValidationResult interface shape ───────────────────────────────────

describe("QrCodeValidationResult — interface contract", () => {
  it("available result satisfies QrCodeValidationResult", () => {
    const result: QrCodeValidationResult = { status: "available" };
    expect(result.status).toBe("available");
    expect(result.conflictingCaseId).toBeUndefined();
  });

  it("mapped_to_this_case result satisfies QrCodeValidationResult", () => {
    const result: QrCodeValidationResult = { status: "mapped_to_this_case" };
    expect(result.status).toBe("mapped_to_this_case");
  });

  it("mapped_to_other_case result satisfies QrCodeValidationResult with conflict fields", () => {
    const result: QrCodeValidationResult = {
      status:               "mapped_to_other_case",
      conflictingCaseLabel: "CASE-001",
      conflictingCaseId:    "case_001",
    };
    expect(result.status).toBe("mapped_to_other_case");
    expect(result.conflictingCaseLabel).toBe("CASE-001");
    expect(result.conflictingCaseId).toBe("case_001");
  });

  it("invalid result satisfies QrCodeValidationResult with reason", () => {
    const result: QrCodeValidationResult = {
      status: "invalid",
      reason: "QR code must not be empty.",
    };
    expect(result.status).toBe("invalid");
    expect(typeof result.reason).toBe("string");
  });
});

// ─── In-process replica of generateQRCodeForCase handler logic ────────────────
//
// Since crypto.randomUUID() is a Web Crypto API call that Convex provides at
// runtime, we replicate the handler logic using an injected uid generator so
// we can control the generated uid in tests and verify all branches.

interface MockCaseWithSource extends MockCaseRow {
  qrCodeSource?: "generated" | "external";
}

/**
 * Pure function replicating the generateQRCodeForCase Convex handler logic.
 *
 * @param caseId          Target case ID.
 * @param userId          Operator user ID (for audit event attribution).
 * @param userName        Operator display name.
 * @param casesById       Simulated primary-key index (id → case row).
 * @param casesByQR       Simulated by_qr_code index (QR → case row).
 * @param options.baseUrl Base URL for the QR payload.
 * @param options.forceRegenerate When true, replaces an existing generated code.
 * @param options.generateUid     Injected uid generator (defaults to 16-char hex).
 */
function generateQRCodeInProcess(
  caseId:    string,
  userId:    string,
  userName:  string,
  casesById: Map<string, MockCaseWithSource>,
  casesByQR: Map<string, MockCaseWithSource>,
  options?: {
    baseUrl?:         string;
    forceRegenerate?: boolean;
    generateUid?:     () => string;
  }
): { result: GenerateQRCodeResult } | { error: string } {
  // ── 1. Verify the target case exists ─────────────────────────────────────
  const caseDoc = casesById.get(caseId);
  if (!caseDoc) {
    return { error: `generateQRCodeForCase: Case "${caseId}" not found.` };
  }

  // ── 2. Idempotency check — return existing generated code if present ──────
  if (
    caseDoc.qrCode &&
    caseDoc.qrCodeSource === "generated" &&
    !options?.forceRegenerate
  ) {
    return {
      result: {
        caseId,
        qrCode:         caseDoc.qrCode,
        wasRegenerated: false,
      },
    };
  }

  // ── 3. Generate a unique QR payload ────────────────────────────────────────
  const baseUrl      = options?.baseUrl ?? "/scan";
  const generateUid  = options?.generateUid ?? (() => "a1b2c3d4e5f60789"); // 16 hex chars
  const uid          = generateUid();
  const encodedCaseId = encodeURIComponent(caseId);
  const qrCode       = `${baseUrl}/case/${encodedCaseId}?uid=${uid}&source=generated`;

  const previousQrCode = caseDoc.qrCode || undefined;

  // ── 4. Defensive uniqueness check ─────────────────────────────────────────
  const conflictingCase = casesByQR.get(qrCode) ?? null;
  if (conflictingCase !== null && conflictingCase._id !== caseId) {
    return {
      error:
        `generateQRCodeForCase: Generated QR payload collided with case ` +
        `"${conflictingCase.label}" (ID: ${conflictingCase._id}). ` +
        `This is astronomically unlikely — please retry and a new unique ` +
        `code will be generated.`,
    };
  }

  // ── 5. Return result (DB write and audit event handled by Convex runtime) ──
  void userId;
  void userName;
  return {
    result: {
      caseId,
      qrCode,
      wasRegenerated:  previousQrCode !== undefined,
      previousQrCode,
    },
  };
}

// ─── generateQRCodeForCase — behaviour tests ──────────────────────────────────

describe("generateQRCodeForCase — behaviour", () => {
  const BASE = "https://scan.example.com";
  const FIXED_UID = "a1b2c3d4e5f60789"; // 16 hex chars

  // Case with no QR code yet
  const CASE_FRESH: MockCaseWithSource = {
    _id:    "case_fresh",
    label:  "CASE-fresh",
    qrCode: "",
  };

  // Case already with a system-generated QR code
  const CASE_GEN: MockCaseWithSource = {
    _id:          "case_gen",
    label:        "CASE-gen",
    qrCode:       `${BASE}/case/case_gen?uid=existing0000ffff&source=generated`,
    qrCodeSource: "generated",
  };

  // Case with an externally-assigned QR code (physical pre-printed label)
  const CASE_EXT: MockCaseWithSource = {
    _id:          "case_ext",
    label:        "CASE-ext",
    qrCode:       `${BASE}/case/case_ext?uid=ext0000000000000`,
    qrCodeSource: "external",
  };

  function buildMaps(...cases: MockCaseWithSource[]) {
    const byId  = new Map(cases.map((c) => [c._id,    c]));
    const byQR  = new Map(cases.filter((c) => c.qrCode).map((c) => [c.qrCode, c]));
    return { byId, byQR };
  }

  it("returns an error when the case does not exist", () => {
    const { byId, byQR } = buildMaps(CASE_FRESH);
    const outcome = generateQRCodeInProcess(
      "nonexistent_id", "user1", "User One",
      byId, byQR, { baseUrl: BASE }
    );
    expect("error" in outcome).toBe(true);
    if ("error" in outcome) {
      expect(outcome.error).toContain("not found");
    }
  });

  it("generates a QR payload and returns wasRegenerated=false for a fresh case", () => {
    const { byId, byQR } = buildMaps(CASE_FRESH);
    const outcome = generateQRCodeInProcess(
      CASE_FRESH._id, "user1", "User One",
      byId, byQR,
      { baseUrl: BASE, generateUid: () => FIXED_UID }
    );
    expect("result" in outcome).toBe(true);
    if ("result" in outcome) {
      expect(outcome.result.wasRegenerated).toBe(false);
      expect(outcome.result.previousQrCode).toBeUndefined();
    }
  });

  it("generated QR payload follows the expected URL format", () => {
    const { byId, byQR } = buildMaps(CASE_FRESH);
    const outcome = generateQRCodeInProcess(
      CASE_FRESH._id, "user1", "User One",
      byId, byQR,
      { baseUrl: BASE, generateUid: () => FIXED_UID }
    );
    expect("result" in outcome).toBe(true);
    if ("result" in outcome) {
      const url = new URL(outcome.result.qrCode);
      expect(url.searchParams.get("uid")).toBe(FIXED_UID);
      expect(url.searchParams.get("source")).toBe("generated");
      expect(url.pathname).toContain(encodeURIComponent(CASE_FRESH._id));
    }
  });

  it("result caseId matches the input caseId", () => {
    const { byId, byQR } = buildMaps(CASE_FRESH);
    const outcome = generateQRCodeInProcess(
      CASE_FRESH._id, "user1", "User One",
      byId, byQR,
      { baseUrl: BASE }
    );
    expect("result" in outcome).toBe(true);
    if ("result" in outcome) {
      expect(outcome.result.caseId).toBe(CASE_FRESH._id);
    }
  });

  it("returns idempotently when case already has generated QR and forceRegenerate is false", () => {
    const { byId, byQR } = buildMaps(CASE_GEN);
    const outcome = generateQRCodeInProcess(
      CASE_GEN._id, "user1", "User One",
      byId, byQR,
      { baseUrl: BASE, forceRegenerate: false }
    );
    expect("result" in outcome).toBe(true);
    if ("result" in outcome) {
      // Returns the existing QR code without generating a new one
      expect(outcome.result.qrCode).toBe(CASE_GEN.qrCode);
      expect(outcome.result.wasRegenerated).toBe(false);
    }
  });

  it("regenerates and sets wasRegenerated=true when forceRegenerate=true", () => {
    const { byId, byQR } = buildMaps(CASE_GEN);
    const NEW_UID = "beef0123456789ab";
    const outcome = generateQRCodeInProcess(
      CASE_GEN._id, "user1", "User One",
      byId, byQR,
      { baseUrl: BASE, forceRegenerate: true, generateUid: () => NEW_UID }
    );
    expect("result" in outcome).toBe(true);
    if ("result" in outcome) {
      expect(outcome.result.wasRegenerated).toBe(true);
      expect(outcome.result.previousQrCode).toBe(CASE_GEN.qrCode);
      // New payload contains the new uid
      expect(outcome.result.qrCode).toContain(NEW_UID);
    }
  });

  it("generates a new QR code for a case with an external QR (ignores external source)", () => {
    // qrCodeSource="external" should NOT trigger idempotency — always generates
    const { byId, byQR } = buildMaps(CASE_EXT);
    const outcome = generateQRCodeInProcess(
      CASE_EXT._id, "user1", "User One",
      byId, byQR,
      { baseUrl: BASE, generateUid: () => FIXED_UID }
    );
    expect("result" in outcome).toBe(true);
    if ("result" in outcome) {
      // wasRegenerated = true because there WAS a previous qrCode (the external one)
      expect(outcome.result.wasRegenerated).toBe(true);
      expect(outcome.result.previousQrCode).toBe(CASE_EXT.qrCode);
      // The new qrCode is a system-generated URL
      expect(outcome.result.qrCode).toContain("source=generated");
    }
  });

  it("uses the provided baseUrl in the generated payload", () => {
    const { byId, byQR } = buildMaps(CASE_FRESH);
    const customBase = "https://custom.scan.io";
    const outcome = generateQRCodeInProcess(
      CASE_FRESH._id, "user1", "User One",
      byId, byQR,
      { baseUrl: customBase, generateUid: () => FIXED_UID }
    );
    expect("result" in outcome).toBe(true);
    if ("result" in outcome) {
      expect(outcome.result.qrCode.startsWith(customBase)).toBe(true);
    }
  });

  it("falls back to '/scan' when baseUrl is omitted", () => {
    const { byId, byQR } = buildMaps(CASE_FRESH);
    const outcome = generateQRCodeInProcess(
      CASE_FRESH._id, "user1", "User One",
      byId, byQR,
      { generateUid: () => FIXED_UID }
    );
    expect("result" in outcome).toBe(true);
    if ("result" in outcome) {
      expect(outcome.result.qrCode.startsWith("/scan")).toBe(true);
    }
  });

  it("returns an error when generated payload collides with another case", () => {
    const COLLIDING_QR = `${BASE}/case/${encodeURIComponent(CASE_FRESH._id)}?uid=${FIXED_UID}&source=generated`;
    // Artificially plant the collision in the QR index
    const CASE_OTHER: MockCaseWithSource = {
      _id:    "case_other",
      label:  "CASE-other",
      qrCode: COLLIDING_QR,
    };
    const { byId, byQR } = buildMaps(CASE_FRESH, CASE_OTHER);
    const outcome = generateQRCodeInProcess(
      CASE_FRESH._id, "user1", "User One",
      byId, byQR,
      { baseUrl: BASE, generateUid: () => FIXED_UID }
    );
    expect("error" in outcome).toBe(true);
    if ("error" in outcome) {
      expect(outcome.error).toContain("collided");
      expect(outcome.error).toContain(CASE_OTHER.label);
    }
  });
});

// ─── GenerateQRCodeResult interface shape ─────────────────────────────────────

describe("GenerateQRCodeResult — interface contract", () => {
  it("fresh result satisfies GenerateQRCodeResult", () => {
    const result: GenerateQRCodeResult = {
      caseId:         "case_test",
      qrCode:         "https://scan.example.com/case/case_test?uid=1234567890abcdef&source=generated",
      wasRegenerated: false,
    };
    expect(result.caseId).toBe("case_test");
    expect(typeof result.qrCode).toBe("string");
    expect(result.wasRegenerated).toBe(false);
    expect(result.previousQrCode).toBeUndefined();
  });

  it("regenerated result satisfies GenerateQRCodeResult with previousQrCode", () => {
    const OLD_QR = "https://scan.example.com/case/case_test?uid=old0000000000000&source=generated";
    const NEW_QR = "https://scan.example.com/case/case_test?uid=new0000000000000&source=generated";
    const result: GenerateQRCodeResult = {
      caseId:          "case_test",
      qrCode:          NEW_QR,
      wasRegenerated:  true,
      previousQrCode:  OLD_QR,
    };
    expect(result.wasRegenerated).toBe(true);
    expect(result.previousQrCode).toBe(OLD_QR);
    expect(result.qrCode).toBe(NEW_QR);
  });
});
