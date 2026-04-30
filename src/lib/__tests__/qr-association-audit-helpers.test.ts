/**
 * Unit tests: convex/qrAssociationAuditHelpers (Sub-AC 3 of AC 240303)
 *
 * The `qrAssociationAuditHelpers` module is the single source of truth for
 * the shape and validation rules of the dedicated `qr_association_events`
 * audit table.  Every Convex mutation that writes `cases.qrCode` routes
 * through one of the four record builders defined in the module:
 *
 *   • buildCreateAuditRecord            — initial associations + overwrites
 *   • buildReassignSourceAuditRecord    — source-side row of a reassign pair
 *   • buildReassignTargetAuditRecord    — target-side row of a reassign pair
 *   • buildInvalidateAuditRecord        — QR removed without a target
 *
 * The helpers are pure (Convex-runtime-free) and accept plain inputs, so
 * tests exercise every branch — actor / timestamp validation, reason-code
 * allow-list, mandatory `reasonNotes` for "other", and field-level shape
 * — without standing up a Convex backend.  This mirrors the test pattern
 * used by `qr-code-helpers.test.ts` and `qr-reassignment-helpers.test.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  CREATE_REASON_CODES,
  CREATE_REASON_LABELS,
  INVALIDATION_REASON_CODES,
  INVALIDATION_REASON_LABELS,
  QR_ASSOCIATION_ACTIONS,
  REASONS_REQUIRING_NOTES,
  buildCreateAuditRecord,
  buildInvalidateAuditRecord,
  buildReassignSourceAuditRecord,
  buildReassignTargetAuditRecord,
  isValidCreateReasonCode,
  isValidInvalidationReasonCode,
  isValidQrAssociationAction,
  type CreateReasonCode,
  type InvalidationReasonCode,
} from "../../../convex/qrAssociationAuditHelpers";
import {
  REASSIGNMENT_REASON_CODES,
  REASSIGNMENT_REASON_LABELS,
  type ReassignmentReasonCode,
} from "../../../convex/qrReassignmentHelpers";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ACTOR_ID   = "kp_alice_42";
const ACTOR_NAME = "Alice Technician";
const TS         = 1_700_000_000_000; // arbitrary stable epoch ms

const CASE_A = "case_aaa111";
const CASE_B = "case_bbb222";
const CORR   = "corr_5b9f-4d2e-9a31";

const SAMPLE_QR =
  "https://scan.example.com/case/case_aaa111?uid=aaaa1111aaaa1111";
const SAMPLE_QR_B =
  "https://scan.example.com/case/case_bbb222?uid=bbbb2222bbbb2222";

// ─── Action + reason-code constants ──────────────────────────────────────────

describe("QR_ASSOCIATION_ACTIONS", () => {
  it("contains exactly create / reassign / invalidate in stable order", () => {
    expect(QR_ASSOCIATION_ACTIONS).toEqual([
      "create",
      "reassign",
      "invalidate",
    ]);
  });

  it("isValidQrAssociationAction accepts every literal", () => {
    for (const action of QR_ASSOCIATION_ACTIONS) {
      expect(isValidQrAssociationAction(action)).toBe(true);
    }
  });

  it("isValidQrAssociationAction rejects unknown strings", () => {
    expect(isValidQrAssociationAction("update")).toBe(false);
    expect(isValidQrAssociationAction("")).toBe(false);
    expect(isValidQrAssociationAction("CREATE")).toBe(false);
  });
});

describe("CREATE_REASON_CODES", () => {
  it("includes initial_association as the default first entry", () => {
    expect(CREATE_REASON_CODES[0]).toBe("initial_association");
  });

  it("provides a label for every reason code", () => {
    for (const code of CREATE_REASON_CODES) {
      expect(CREATE_REASON_LABELS[code]).toMatch(/\S/);
    }
  });

  it("isValidCreateReasonCode accepts every literal", () => {
    for (const code of CREATE_REASON_CODES) {
      expect(isValidCreateReasonCode(code)).toBe(true);
    }
  });

  it("isValidCreateReasonCode rejects unknown reason codes", () => {
    expect(isValidCreateReasonCode("relabel")).toBe(false);
    expect(isValidCreateReasonCode("")).toBe(false);
  });
});

describe("INVALIDATION_REASON_CODES", () => {
  it("provides a label for every invalidation code", () => {
    for (const code of INVALIDATION_REASON_CODES) {
      expect(INVALIDATION_REASON_LABELS[code]).toMatch(/\S/);
    }
  });

  it("isValidInvalidationReasonCode accepts every literal", () => {
    for (const code of INVALIDATION_REASON_CODES) {
      expect(isValidInvalidationReasonCode(code)).toBe(true);
    }
  });

  it("isValidInvalidationReasonCode rejects unknown values", () => {
    expect(isValidInvalidationReasonCode("not_a_real_code")).toBe(false);
    expect(isValidInvalidationReasonCode("")).toBe(false);
  });
});

describe("REASONS_REQUIRING_NOTES", () => {
  it('includes "other" so create/reassign/invalidate all enforce notes', () => {
    expect(REASONS_REQUIRING_NOTES.has("other")).toBe(true);
  });
});

// ─── buildCreateAuditRecord ──────────────────────────────────────────────────

describe("buildCreateAuditRecord", () => {
  function makeBaseInputs() {
    return {
      caseId:       CASE_A,
      qrCode:       SAMPLE_QR,
      qrCodeSource: "generated" as const,
      actorId:      ACTOR_ID,
      actorName:    ACTOR_NAME,
      timestamp:    TS,
    };
  }

  it("builds a typed record for an initial association", () => {
    const record = buildCreateAuditRecord(makeBaseInputs());

    expect(record).toMatchObject({
      caseId:       CASE_A,
      action:       "create",
      actorId:      ACTOR_ID,
      actorName:    ACTOR_NAME,
      timestamp:    TS,
      reasonCode:   "initial_association",
      reasonLabel:  CREATE_REASON_LABELS.initial_association,
      qrCode:       SAMPLE_QR,
      qrCodeSource: "generated",
    });
    // No role on create-action records.
    expect(record.role).toBeUndefined();
    // No correlation / counterpart on create-action records.
    expect(record.correlationId).toBeUndefined();
    expect(record.counterpartCaseId).toBeUndefined();
  });

  it("trims qrCode before storing it", () => {
    const record = buildCreateAuditRecord({
      ...makeBaseInputs(),
      qrCode: `   ${SAMPLE_QR}   `,
    });
    expect(record.qrCode).toBe(SAMPLE_QR);
  });

  it("records previousQrCode + source when overwriting", () => {
    const record = buildCreateAuditRecord({
      ...makeBaseInputs(),
      reasonCode:           "label_replacement",
      previousQrCode:       SAMPLE_QR_B,
      previousQrCodeSource: "external",
    });

    expect(record.reasonCode).toBe("label_replacement");
    expect(record.reasonLabel).toBe(CREATE_REASON_LABELS.label_replacement);
    expect(record.previousQrCode).toBe(SAMPLE_QR_B);
    expect(record.previousQrCodeSource).toBe("external");
  });

  it("omits previousQrCode when caller passes null/empty", () => {
    const recordNull = buildCreateAuditRecord({
      ...makeBaseInputs(),
      previousQrCode:       null,
      previousQrCodeSource: null,
    });
    expect(recordNull.previousQrCode).toBeUndefined();
    expect(recordNull.previousQrCodeSource).toBeUndefined();

    const recordWhitespace = buildCreateAuditRecord({
      ...makeBaseInputs(),
      previousQrCode: "   ",
    });
    expect(recordWhitespace.previousQrCode).toBeUndefined();
  });

  it("trims and stores reasonNotes for non-other reason codes when provided", () => {
    const record = buildCreateAuditRecord({
      ...makeBaseInputs(),
      reasonCode:  "label_correction",
      reasonNotes: "  fixed a typo in the encoded label  ",
    });
    expect(record.reasonNotes).toBe("fixed a typo in the encoded label");
  });

  it("omits reasonNotes when caller does not provide them", () => {
    const record = buildCreateAuditRecord(makeBaseInputs());
    expect(record.reasonNotes).toBeUndefined();
  });

  it('throws [QR_AUDIT_REASON_NOTES_REQUIRED] when reasonCode === "other" but notes are blank', () => {
    expect(() =>
      buildCreateAuditRecord({
        ...makeBaseInputs(),
        reasonCode: "other",
      }),
    ).toThrow(/QR_AUDIT_REASON_NOTES_REQUIRED/);

    expect(() =>
      buildCreateAuditRecord({
        ...makeBaseInputs(),
        reasonCode:  "other",
        reasonNotes: "    ",
      }),
    ).toThrow(/QR_AUDIT_REASON_NOTES_REQUIRED/);
  });

  it('accepts reasonCode === "other" when notes are present', () => {
    const record = buildCreateAuditRecord({
      ...makeBaseInputs(),
      reasonCode:  "other",
      reasonNotes: "label printer firmware bug encoded an extra prefix",
    });
    expect(record.reasonCode).toBe("other");
    expect(record.reasonNotes).toBe(
      "label printer firmware bug encoded an extra prefix",
    );
  });

  it("throws [QR_AUDIT_INVALID_REASON] for unknown reasonCode", () => {
    expect(() =>
      buildCreateAuditRecord({
        ...makeBaseInputs(),
        // @ts-expect-error — testing runtime validation of bad input
        reasonCode: "made_up_code",
      }),
    ).toThrow(/QR_AUDIT_INVALID_REASON/);
  });

  it("throws [QR_AUDIT_INVALID] for empty actorId / actorName / qrCode", () => {
    expect(() =>
      buildCreateAuditRecord({ ...makeBaseInputs(), actorId: "" }),
    ).toThrow(/QR_AUDIT_INVALID/);
    expect(() =>
      buildCreateAuditRecord({ ...makeBaseInputs(), actorName: "   " }),
    ).toThrow(/QR_AUDIT_INVALID/);
    expect(() =>
      buildCreateAuditRecord({ ...makeBaseInputs(), qrCode: "" }),
    ).toThrow(/QR_AUDIT_INVALID/);
  });

  it("throws [QR_AUDIT_INVALID] for non-positive timestamp", () => {
    expect(() =>
      buildCreateAuditRecord({ ...makeBaseInputs(), timestamp: 0 }),
    ).toThrow(/QR_AUDIT_INVALID/);
    expect(() =>
      buildCreateAuditRecord({ ...makeBaseInputs(), timestamp: -1 }),
    ).toThrow(/QR_AUDIT_INVALID/);
    expect(() =>
      buildCreateAuditRecord({
        ...makeBaseInputs(),
        timestamp: Number.NaN,
      }),
    ).toThrow(/QR_AUDIT_INVALID/);
  });
});

// ─── buildReassignSourceAuditRecord ──────────────────────────────────────────

describe("buildReassignSourceAuditRecord", () => {
  function makeBaseInputs() {
    return {
      sourceCaseId:    CASE_A,
      qrCode:          SAMPLE_QR,
      qrCodeSource:    "external" as const,
      reasonCode:      "label_replacement" as ReassignmentReasonCode,
      targetCaseId:    CASE_B,
      targetCaseLabel: "CASE-002",
      correlationId:   CORR,
      actorId:         ACTOR_ID,
      actorName:       ACTOR_NAME,
      timestamp:       TS,
    };
  }

  it("builds a typed source-side record carrying full counterpart context", () => {
    const record = buildReassignSourceAuditRecord(makeBaseInputs());

    expect(record).toMatchObject({
      caseId:               CASE_A,
      action:               "reassign",
      role:                 "source",
      actorId:              ACTOR_ID,
      actorName:            ACTOR_NAME,
      timestamp:            TS,
      reasonCode:           "label_replacement",
      reasonLabel:          REASSIGNMENT_REASON_LABELS.label_replacement,
      qrCode:               SAMPLE_QR,
      qrCodeSource:         "external",
      correlationId:        CORR,
      counterpartCaseId:    CASE_B,
      counterpartCaseLabel: "CASE-002",
    });

    // Source-side rows mirror qrCode into previousQrCode so audit consumers
    // can surface "QR X left this case" without parsing the role field.
    expect(record.previousQrCode).toBe(SAMPLE_QR);
    expect(record.previousQrCodeSource).toBe("external");
  });

  it('throws [QR_AUDIT_INVALID_REASON] for unknown reassignment codes', () => {
    expect(() =>
      buildReassignSourceAuditRecord({
        ...makeBaseInputs(),
        // @ts-expect-error — testing runtime validation of bad input
        reasonCode: "fake_reason",
      }),
    ).toThrow(/QR_AUDIT_INVALID_REASON/);
  });

  it('rejects "other" reasonCode without notes', () => {
    expect(() =>
      buildReassignSourceAuditRecord({
        ...makeBaseInputs(),
        reasonCode: "other",
      }),
    ).toThrow(/QR_AUDIT_REASON_NOTES_REQUIRED/);
  });

  it('accepts "other" reasonCode when notes are provided', () => {
    const record = buildReassignSourceAuditRecord({
      ...makeBaseInputs(),
      reasonCode:  "other",
      reasonNotes: "label was applied to the wrong shipment by the contractor",
    });
    expect(record.reasonCode).toBe("other");
    expect(record.reasonNotes).toBe(
      "label was applied to the wrong shipment by the contractor",
    );
  });

  it("throws when sourceCaseId === targetCaseId", () => {
    expect(() =>
      buildReassignSourceAuditRecord({
        ...makeBaseInputs(),
        targetCaseId: CASE_A, // same as sourceCaseId
      }),
    ).toThrow(/QR_AUDIT_INVALID/);
  });

  it("throws when correlationId is empty", () => {
    expect(() =>
      buildReassignSourceAuditRecord({
        ...makeBaseInputs(),
        correlationId: "   ",
      }),
    ).toThrow(/QR_AUDIT_INVALID/);
  });

  it("validates every reassignment reason code is recognised", () => {
    for (const reasonCode of REASSIGNMENT_REASON_CODES) {
      const record = buildReassignSourceAuditRecord({
        ...makeBaseInputs(),
        reasonCode,
        reasonNotes: reasonCode === "other" ? "n/a" : undefined,
      });
      expect(record.reasonCode).toBe(reasonCode);
      expect(record.reasonLabel).toBe(REASSIGNMENT_REASON_LABELS[reasonCode]);
    }
  });
});

// ─── buildReassignTargetAuditRecord ──────────────────────────────────────────

describe("buildReassignTargetAuditRecord", () => {
  function makeBaseInputs() {
    return {
      targetCaseId:         CASE_B,
      qrCode:               SAMPLE_QR,
      qrCodeSource:         "external" as const,
      reasonCode:           "case_swap" as ReassignmentReasonCode,
      sourceCaseId:         CASE_A,
      sourceCaseLabel:      "CASE-001",
      previousQrCode:       null,
      previousQrCodeSource: null,
      correlationId:        CORR,
      actorId:              ACTOR_ID,
      actorName:            ACTOR_NAME,
      timestamp:            TS,
    };
  }

  it("builds a typed target-side record without prior QR when target was empty", () => {
    const record = buildReassignTargetAuditRecord(makeBaseInputs());

    expect(record).toMatchObject({
      caseId:               CASE_B,
      action:               "reassign",
      role:                 "target",
      actorId:              ACTOR_ID,
      actorName:            ACTOR_NAME,
      timestamp:            TS,
      reasonCode:           "case_swap",
      reasonLabel:          REASSIGNMENT_REASON_LABELS.case_swap,
      qrCode:               SAMPLE_QR,
      qrCodeSource:         "external",
      correlationId:        CORR,
      counterpartCaseId:    CASE_A,
      counterpartCaseLabel: "CASE-001",
    });
    // No prior QR on the empty target → previous fields omitted.
    expect(record.previousQrCode).toBeUndefined();
    expect(record.previousQrCodeSource).toBeUndefined();
  });

  it("records previousQrCode + source when target had a displaced QR", () => {
    const record = buildReassignTargetAuditRecord({
      ...makeBaseInputs(),
      previousQrCode:       SAMPLE_QR_B,
      previousQrCodeSource: "generated",
    });
    expect(record.previousQrCode).toBe(SAMPLE_QR_B);
    expect(record.previousQrCodeSource).toBe("generated");
  });

  it("throws when targetCaseId === sourceCaseId", () => {
    expect(() =>
      buildReassignTargetAuditRecord({
        ...makeBaseInputs(),
        sourceCaseId: CASE_B,
      }),
    ).toThrow(/QR_AUDIT_INVALID/);
  });

  it('rejects unknown reasonCode and missing "other" notes', () => {
    expect(() =>
      buildReassignTargetAuditRecord({
        ...makeBaseInputs(),
        // @ts-expect-error — testing runtime validation
        reasonCode: "totally_made_up",
      }),
    ).toThrow(/QR_AUDIT_INVALID_REASON/);

    expect(() =>
      buildReassignTargetAuditRecord({
        ...makeBaseInputs(),
        reasonCode: "other",
      }),
    ).toThrow(/QR_AUDIT_REASON_NOTES_REQUIRED/);
  });
});

// ─── buildInvalidateAuditRecord ──────────────────────────────────────────────

describe("buildInvalidateAuditRecord", () => {
  function makeBaseInputs() {
    return {
      caseId:               CASE_A,
      previousQrCode:       SAMPLE_QR,
      previousQrCodeSource: "generated" as const,
      reasonCode:           "label_destroyed" as InvalidationReasonCode,
      actorId:              ACTOR_ID,
      actorName:            ACTOR_NAME,
      timestamp:            TS,
    };
  }

  it("builds a typed record with empty qrCode (sentinel) and previousQr captured", () => {
    const record = buildInvalidateAuditRecord(makeBaseInputs());

    expect(record).toMatchObject({
      caseId:         CASE_A,
      action:         "invalidate",
      actorId:        ACTOR_ID,
      actorName:      ACTOR_NAME,
      timestamp:      TS,
      reasonCode:     "label_destroyed",
      reasonLabel:    INVALIDATION_REASON_LABELS.label_destroyed,
      previousQrCode: SAMPLE_QR,
      previousQrCodeSource: "generated",
    });
    expect(record.qrCode).toBe("");
    expect(record.qrCodeSource).toBeUndefined();
    // Invalidation rows have no role / correlation / counterpart fields.
    expect(record.role).toBeUndefined();
    expect(record.correlationId).toBeUndefined();
    expect(record.counterpartCaseId).toBeUndefined();
  });

  it("throws when previousQrCode is empty (we cannot audit a no-op invalidation)", () => {
    expect(() =>
      buildInvalidateAuditRecord({
        ...makeBaseInputs(),
        previousQrCode: "",
      }),
    ).toThrow(/QR_AUDIT_INVALID/);

    expect(() =>
      buildInvalidateAuditRecord({
        ...makeBaseInputs(),
        previousQrCode: "    ",
      }),
    ).toThrow(/QR_AUDIT_INVALID/);
  });

  it('rejects unknown reasonCode and missing "other" notes', () => {
    expect(() =>
      buildInvalidateAuditRecord({
        ...makeBaseInputs(),
        // @ts-expect-error — testing runtime validation
        reasonCode: "label_lost",
      }),
    ).toThrow(/QR_AUDIT_INVALID_REASON/);

    expect(() =>
      buildInvalidateAuditRecord({
        ...makeBaseInputs(),
        reasonCode: "other",
      }),
    ).toThrow(/QR_AUDIT_REASON_NOTES_REQUIRED/);
  });

  it('accepts every invalidation reason code', () => {
    for (const code of INVALIDATION_REASON_CODES) {
      const record = buildInvalidateAuditRecord({
        ...makeBaseInputs(),
        reasonCode:  code,
        reasonNotes: code === "other" ? "n/a" : undefined,
      });
      expect(record.reasonCode).toBe(code);
      expect(record.reasonLabel).toBe(INVALIDATION_REASON_LABELS[code]);
    }
  });

  it("captures previousQrCodeSource when the previous source is known", () => {
    const externalRecord = buildInvalidateAuditRecord({
      ...makeBaseInputs(),
      previousQrCodeSource: "external",
    });
    expect(externalRecord.previousQrCodeSource).toBe("external");

    const unknownRecord = buildInvalidateAuditRecord({
      ...makeBaseInputs(),
      previousQrCodeSource: null,
    });
    expect(unknownRecord.previousQrCodeSource).toBeUndefined();
  });
});

// ─── Cross-builder invariants ────────────────────────────────────────────────

describe("Cross-builder invariants", () => {
  it("source + target rows of a paired reassign share correlationId and timestamp", () => {
    const baseTs = Date.now();
    const correlationId = "corr_paired_1";

    const source = buildReassignSourceAuditRecord({
      sourceCaseId:    CASE_A,
      qrCode:          SAMPLE_QR,
      qrCodeSource:    "generated",
      reasonCode:      "label_replacement",
      targetCaseId:    CASE_B,
      targetCaseLabel: "CASE-002",
      correlationId,
      actorId:         ACTOR_ID,
      actorName:       ACTOR_NAME,
      timestamp:       baseTs,
    });
    const target = buildReassignTargetAuditRecord({
      targetCaseId:         CASE_B,
      qrCode:               SAMPLE_QR,
      qrCodeSource:         "generated",
      reasonCode:           "label_replacement",
      sourceCaseId:         CASE_A,
      sourceCaseLabel:      "CASE-001",
      previousQrCode:       null,
      previousQrCodeSource: null,
      correlationId,
      actorId:              ACTOR_ID,
      actorName:            ACTOR_NAME,
      timestamp:            baseTs,
    });

    expect(source.correlationId).toBe(target.correlationId);
    expect(source.timestamp).toBe(target.timestamp);
    expect(source.action).toBe(target.action);
    expect(source.role).toBe("source");
    expect(target.role).toBe("target");
    // Counterparts point to each other.
    expect(source.counterpartCaseId).toBe(target.caseId);
    expect(target.counterpartCaseId).toBe(source.caseId);
    // Same QR moved → same payload + source on both rows.
    expect(source.qrCode).toBe(target.qrCode);
    expect(source.qrCodeSource).toBe(target.qrCodeSource);
  });
});
