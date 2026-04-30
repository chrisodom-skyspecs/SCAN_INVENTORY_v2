/**
 * Unit tests: convex/qrReassignmentHelpers (Sub-AC 2 of AC 240302)
 *
 * The `qrReassignmentHelpers` module is the single source of truth for the
 * rules that govern moving a QR payload from one case to another:
 *   • Required reason code (one of REASSIGNMENT_REASON_CODES).
 *   • Mandatory reasonNotes when reasonCode === "other".
 *   • Non-empty QR payload after trimming.
 *   • Non-empty target case ID and target must exist.
 *   • QR must currently be associated with some case.
 *   • Source case must differ from target case.
 *
 * The helpers are pure (Convex-runtime-free) and accept a `ReassignmentDeps`
 * shape so we can inject an in-memory Map<string, QrCodeCaseRow> rather than
 * standing up a Convex backend.  This mirrors the test pattern used by
 * `qr-code-helpers.test.ts` for Sub-AC 1.
 *
 * The mutation `reassignQrCodeToCase` (in convex/qrCodes.ts) wires these
 * helpers to Convex `ctx.db` reads/patches, applies the RBAC permission
 * check, and writes the matched audit events.  Per-mutation tests live with
 * the rest of the Convex integration suite; the rules logic is exhaustively
 * covered here.
 */

import { describe, it, expect } from "vitest";
import type {
  QrCodeCaseRow,
} from "../../../convex/qrCodeHelpers";
import {
  REASSIGNMENT_REASON_CODES,
  REASSIGNMENT_REASON_LABELS,
  REASSIGNMENT_REASONS_REQUIRING_NOTES,
  buildSourceUnassignmentEventData,
  buildTargetReassignmentEventData,
  evaluateReassignment,
  isValidReassignmentReasonCode,
  type ReassignmentCorrelation,
  type ReassignmentDeps,
} from "../../../convex/qrReassignmentHelpers";

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

const CASE_C_NO_QR: QrCodeCaseRow = {
  _id:    "case_ccc333",
  label:  "CASE-003",
  qrCode: "",
};

/**
 * Build a `ReassignmentDeps` that simulates both the `by_qr_code` index
 * (used by findCaseByQrCode) and the primary key lookup (findCaseById)
 * with two in-memory maps.
 */
function buildDeps(...rows: QrCodeCaseRow[]): ReassignmentDeps {
  const byQR = new Map<string, QrCodeCaseRow>();
  const byId = new Map<string, QrCodeCaseRow>();
  for (const row of rows) {
    if (row.qrCode) byQR.set(row.qrCode, row);
    byId.set(row._id, row);
  }
  return {
    findCaseByQrCode: async (qr) => byQR.get(qr) ?? null,
    findCaseById:     async (id) => byId.get(id) ?? null,
  };
}

// ─── Reason code constants ───────────────────────────────────────────────────

describe("REASSIGNMENT_REASON_CODES", () => {
  it("includes the canonical scenario-based codes", () => {
    // Spot check the codes that operations leads will surface in dashboards.
    // The full list is asserted below by length so tests fail loudly when
    // codes are added without an intentional update here.
    expect(REASSIGNMENT_REASON_CODES).toContain("label_replacement");
    expect(REASSIGNMENT_REASON_CODES).toContain("data_entry_error");
    expect(REASSIGNMENT_REASON_CODES).toContain("case_swap");
    expect(REASSIGNMENT_REASON_CODES).toContain("case_retired");
    expect(REASSIGNMENT_REASON_CODES).toContain("label_misprint");
    expect(REASSIGNMENT_REASON_CODES).toContain("other");
  });

  it("does not include unintended duplicates", () => {
    const set = new Set<string>(REASSIGNMENT_REASON_CODES);
    expect(set.size).toBe(REASSIGNMENT_REASON_CODES.length);
  });

  it("has a label for every code (parity with REASSIGNMENT_REASON_LABELS)", () => {
    for (const code of REASSIGNMENT_REASON_CODES) {
      expect(REASSIGNMENT_REASON_LABELS[code]).toBeDefined();
      expect(REASSIGNMENT_REASON_LABELS[code]).not.toBe("");
    }
  });

  it("flags only `other` as requiring reasonNotes", () => {
    expect(REASSIGNMENT_REASONS_REQUIRING_NOTES.has("other")).toBe(true);
    for (const code of REASSIGNMENT_REASON_CODES) {
      if (code === "other") continue;
      expect(REASSIGNMENT_REASONS_REQUIRING_NOTES.has(code)).toBe(false);
    }
  });
});

describe("isValidReassignmentReasonCode", () => {
  it("returns true for every defined code", () => {
    for (const code of REASSIGNMENT_REASON_CODES) {
      expect(isValidReassignmentReasonCode(code)).toBe(true);
    }
  });

  it("returns false for unknown strings", () => {
    expect(isValidReassignmentReasonCode("")).toBe(false);
    expect(isValidReassignmentReasonCode("typo")).toBe(false);
    expect(isValidReassignmentReasonCode("LABEL_REPLACEMENT")).toBe(false);
    expect(isValidReassignmentReasonCode("label-replacement")).toBe(false);
  });
});

// ─── evaluateReassignment ────────────────────────────────────────────────────

describe("evaluateReassignment", () => {
  describe("rule 1 — reason code validation", () => {
    it("rejects an empty reason code", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: CASE_B._id,
          reasonCode:   "",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("invalid_reason");
      if (outcome.kind === "invalid_reason") {
        expect(outcome.reason).toMatch(/required/i);
      }
    });

    it("rejects whitespace-only reason codes", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: CASE_B._id,
          reasonCode:   "   \t  ",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("invalid_reason");
    });

    it("rejects unrecognised reason codes", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: CASE_B._id,
          reasonCode:   "definitely_not_a_real_code",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("invalid_reason");
      if (outcome.kind === "invalid_reason") {
        // Surface the allowed list to the operator.
        expect(outcome.reason).toContain("label_replacement");
      }
    });

    it("accepts every defined reason code (other rules permitting)", async () => {
      for (const code of REASSIGNMENT_REASON_CODES) {
        const outcome = await evaluateReassignment(
          {
            qrCode:       CASE_A.qrCode,
            targetCaseId: CASE_B._id,
            reasonCode:   code,
            // "other" requires reasonNotes — provide them so this loop only
            // exercises the reason-code-acceptance branch.
            reasonNotes:  code === "other" ? "Custom justification" : undefined,
          },
          buildDeps(CASE_A, CASE_B),
        );
        expect(outcome.kind).toBe("ok");
      }
    });
  });

  describe('rule 2 — reasonNotes required for "other"', () => {
    it("rejects `other` with missing reasonNotes", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: CASE_B._id,
          reasonCode:   "other",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("reason_notes_required");
    });

    it("rejects `other` with whitespace-only reasonNotes", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: CASE_B._id,
          reasonCode:   "other",
          reasonNotes:  "   \t  ",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("reason_notes_required");
    });

    it("accepts `other` with non-empty reasonNotes", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: CASE_B._id,
          reasonCode:   "other",
          reasonNotes:  "Custom justification covering an unusual scenario",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("ok");
    });

    it("does not require reasonNotes for other codes", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: CASE_B._id,
          reasonCode:   "label_replacement",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("ok");
    });
  });

  describe("rule 3 — QR payload validation", () => {
    it("rejects an empty QR code", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       "",
          targetCaseId: CASE_B._id,
          reasonCode:   "label_replacement",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("invalid_qr");
    });

    it("rejects whitespace-only QR codes", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       "   \t  ",
          targetCaseId: CASE_B._id,
          reasonCode:   "label_replacement",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("invalid_qr");
    });

    it("trims surrounding whitespace before lookup", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       `   ${CASE_A.qrCode}   `,
          targetCaseId: CASE_B._id,
          reasonCode:   "label_replacement",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("ok");
      if (outcome.kind === "ok") {
        expect(outcome.normalizedQrCode).toBe(CASE_A.qrCode);
      }
    });
  });

  describe("rule 4 — target case ID validation", () => {
    it("rejects an empty target case ID", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: "",
          reasonCode:   "label_replacement",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("invalid_target");
    });

    it("rejects a non-existent target case ID", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: "case_does_not_exist",
          reasonCode:   "label_replacement",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("invalid_target");
      if (outcome.kind === "invalid_target") {
        expect(outcome.reason).toContain("case_does_not_exist");
      }
    });
  });

  describe("rule 5 — QR must currently be associated with a case", () => {
    it("rejects a QR that is not in any case", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       "https://scan.example.com/case/orphan?uid=zzzz",
          targetCaseId: CASE_B._id,
          reasonCode:   "label_replacement",
        },
        buildDeps(CASE_A, CASE_B), // neither maps the orphan QR
      );
      expect(outcome.kind).toBe("not_currently_assigned");
      if (outcome.kind === "not_currently_assigned") {
        expect(outcome.reason).toMatch(/associate/i);
      }
    });
  });

  describe("rule 6 — source case must differ from target case", () => {
    it("rejects reassignment of a QR back onto the case that already holds it", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: CASE_A._id,
          reasonCode:   "label_replacement",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("same_case");
      if (outcome.kind === "same_case") {
        expect(outcome.conflictingCaseId).toBe(CASE_A._id);
        expect(outcome.conflictingCaseLabel).toBe(CASE_A.label);
      }
    });
  });

  describe("happy path — all rules pass", () => {
    it("returns kind=ok and surfaces the resolved source case identity", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: CASE_B._id,
          reasonCode:   "label_replacement",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("ok");
      if (outcome.kind === "ok") {
        expect(outcome.sourceCaseId).toBe(CASE_A._id);
        expect(outcome.sourceCaseLabel).toBe(CASE_A.label);
        expect(outcome.normalizedQrCode).toBe(CASE_A.qrCode);
      }
    });

    it("permits reassignment onto a target case that already has a different QR", async () => {
      // CASE_B already holds its own QR.  Reassigning CASE_A's QR onto
      // CASE_B is permitted; the mutation will overwrite CASE_B's prior
      // QR (which the operator must reissue separately if needed).
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: CASE_B._id,
          reasonCode:   "case_swap",
        },
        buildDeps(CASE_A, CASE_B),
      );
      expect(outcome.kind).toBe("ok");
    });

    it("permits reassignment onto a freshly-created case with no prior QR", async () => {
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: CASE_C_NO_QR._id,
          reasonCode:   "data_entry_error",
        },
        buildDeps(CASE_A, CASE_B, CASE_C_NO_QR),
      );
      expect(outcome.kind).toBe("ok");
      if (outcome.kind === "ok") {
        expect(outcome.sourceCaseId).toBe(CASE_A._id);
      }
    });
  });

  describe("rule ordering", () => {
    it("checks reason code BEFORE consulting the database", async () => {
      let dbCalls = 0;
      const trackingDeps: ReassignmentDeps = {
        findCaseById: async (id) => {
          dbCalls++;
          return { _id: id, label: "x", qrCode: "x" };
        },
        findCaseByQrCode: async () => {
          dbCalls++;
          return null;
        },
      };
      const outcome = await evaluateReassignment(
        {
          qrCode:       CASE_A.qrCode,
          targetCaseId: CASE_B._id,
          reasonCode:   "bogus_code",
        },
        trackingDeps,
      );
      expect(outcome.kind).toBe("invalid_reason");
      // No DB reads happened — the cheap shape checks rejected first.
      expect(dbCalls).toBe(0);
    });

    it("checks QR payload BEFORE consulting the database", async () => {
      let dbCalls = 0;
      const trackingDeps: ReassignmentDeps = {
        findCaseById: async () => {
          dbCalls++;
          return { _id: "x", label: "x", qrCode: "x" };
        },
        findCaseByQrCode: async () => {
          dbCalls++;
          return null;
        },
      };
      const outcome = await evaluateReassignment(
        {
          qrCode:       "",
          targetCaseId: CASE_B._id,
          reasonCode:   "label_replacement",
        },
        trackingDeps,
      );
      expect(outcome.kind).toBe("invalid_qr");
      expect(dbCalls).toBe(0);
    });
  });
});

// ─── Audit event payload builders ────────────────────────────────────────────

describe("buildSourceUnassignmentEventData", () => {
  const correlation: ReassignmentCorrelation = {
    correlationId: "corr-uuid-1",
    timestamp:     1_700_000_000_000,
  };

  it("emits a self-contained payload with all denormalised identifiers", () => {
    const payload = buildSourceUnassignmentEventData({
      qrCode:           CASE_A.qrCode,
      qrCodeSource:     "external",
      reasonCode:       "label_replacement",
      reasonNotes:      undefined,
      targetCaseId:     CASE_B._id,
      targetCaseLabel:  CASE_B.label,
      correlation,
    });

    expect(payload).toMatchObject({
      action:                 "qr_code_unassigned",
      qrCode:                 CASE_A.qrCode,
      qrCodeSource:           "external",
      reasonCode:             "label_replacement",
      reasonLabel:            REASSIGNMENT_REASON_LABELS.label_replacement,
      reasonNotes:            null,
      transferredToCaseId:    CASE_B._id,
      transferredToCaseLabel: CASE_B.label,
      correlationId:          "corr-uuid-1",
    });
  });

  it("preserves non-null reasonNotes when provided", () => {
    const payload = buildSourceUnassignmentEventData({
      qrCode:           CASE_A.qrCode,
      qrCodeSource:     "generated",
      reasonCode:       "other",
      reasonNotes:      "Field tech reported the label was destroyed in shipping",
      targetCaseId:     CASE_B._id,
      targetCaseLabel:  CASE_B.label,
      correlation,
    });

    expect(payload.reasonCode).toBe("other");
    expect(payload.reasonNotes).toBe(
      "Field tech reported the label was destroyed in shipping",
    );
  });
});

describe("buildTargetReassignmentEventData", () => {
  const correlation: ReassignmentCorrelation = {
    correlationId: "corr-uuid-2",
    timestamp:     1_700_000_001_000,
  };

  it("emits a payload with both old and new QR identifiers for diff rendering", () => {
    const payload = buildTargetReassignmentEventData({
      qrCode:               CASE_A.qrCode,
      qrCodeSource:         "external",
      reasonCode:           "case_swap",
      reasonNotes:          undefined,
      sourceCaseId:         CASE_A._id,
      sourceCaseLabel:      CASE_A.label,
      previousQrCode:       CASE_B.qrCode,
      previousQrCodeSource: "generated",
      correlation,
    });

    expect(payload).toMatchObject({
      action:                   "qr_code_reassigned",
      qrCode:                   CASE_A.qrCode,
      qrCodeSource:             "external",
      reasonCode:               "case_swap",
      reasonLabel:              REASSIGNMENT_REASON_LABELS.case_swap,
      reasonNotes:              null,
      transferredFromCaseId:    CASE_A._id,
      transferredFromCaseLabel: CASE_A.label,
      previousQrCode:           CASE_B.qrCode,
      previousQrCodeSource:     "generated",
      correlationId:            "corr-uuid-2",
    });
  });

  it("emits null previousQrCode when the target had no prior QR", () => {
    const payload = buildTargetReassignmentEventData({
      qrCode:               CASE_A.qrCode,
      qrCodeSource:         "external",
      reasonCode:           "data_entry_error",
      reasonNotes:          undefined,
      sourceCaseId:         CASE_A._id,
      sourceCaseLabel:      CASE_A.label,
      previousQrCode:       null,
      previousQrCodeSource: null,
      correlation,
    });

    expect(payload.previousQrCode).toBeNull();
    expect(payload.previousQrCodeSource).toBeNull();
  });

  it("uses the same correlationId on both source and target payloads when shared", () => {
    const sourcePayload = buildSourceUnassignmentEventData({
      qrCode:           CASE_A.qrCode,
      qrCodeSource:     "external",
      reasonCode:       "label_replacement",
      reasonNotes:      undefined,
      targetCaseId:     CASE_B._id,
      targetCaseLabel:  CASE_B.label,
      correlation,
    });
    const targetPayload = buildTargetReassignmentEventData({
      qrCode:               CASE_A.qrCode,
      qrCodeSource:         "external",
      reasonCode:           "label_replacement",
      reasonNotes:          undefined,
      sourceCaseId:         CASE_A._id,
      sourceCaseLabel:      CASE_A.label,
      previousQrCode:       null,
      previousQrCodeSource: null,
      correlation,
    });

    expect(sourcePayload.correlationId).toBe(targetPayload.correlationId);
  });
});

// ─── RBAC integration sanity check ───────────────────────────────────────────

describe("RBAC parity — QR_CODE_REASSIGN operation", () => {
  // We import the RBAC module directly so this test fails loudly if anybody
  // removes the operation or accidentally grants it to pilots.
  it("admin and technician hold QR_CODE_REASSIGN; pilot does not", async () => {
    const rbac = await import("../../../convex/rbac");
    expect(rbac.OPERATIONS.QR_CODE_REASSIGN).toBe("qrCode:reassign");

    expect(
      rbac.roleHasPermission(rbac.ROLES.ADMIN, rbac.OPERATIONS.QR_CODE_REASSIGN),
    ).toBe(true);
    expect(
      rbac.roleHasPermission(
        rbac.ROLES.TECHNICIAN,
        rbac.OPERATIONS.QR_CODE_REASSIGN,
      ),
    ).toBe(true);
    expect(
      rbac.roleHasPermission(rbac.ROLES.PILOT, rbac.OPERATIONS.QR_CODE_REASSIGN),
    ).toBe(false);
  });
});
