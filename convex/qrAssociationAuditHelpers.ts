/**
 * convex/qrAssociationAuditHelpers.ts
 *
 * Pure, Convex-runtime-free helpers that define the shape and validation
 * rules for the dedicated `qr_association_events` audit table introduced by
 * AC 240303 sub-AC 3.
 *
 * Why a separate audit table?
 * ───────────────────────────
 * The generic `events` table records every QR action under
 * `eventType: "note_added"` with an action discriminator embedded in the
 * polymorphic `data: any` blob (e.g. `data.action === "qr_code_generated"`).
 * That shape is convenient for the T5 case-detail timeline but inconvenient
 * for compliance reporting and per-action analytics, which need:
 *
 *   • Strongly-typed access to actor / timestamp / reason fields without
 *     parsing event blobs.
 *   • Index-backed queries by qrCode, actorId, action, and correlationId.
 *   • A single canonical write-path so new mutations cannot accidentally
 *     omit the audit row.
 *
 * The helpers in this file are the single source of truth for those rules.
 * Every Convex mutation that writes `cases.qrCode` (generateQRCodeForCase,
 * associateQRCodeToCase, generateQrCode, setQrCode, updateQrCode,
 * reassignQrCodeToCase, invalidateQrCode) MUST construct its audit record
 * via `buildQrAssociationAuditRecord*` and insert it into the
 * `qr_association_events` table in the same mutation transaction as the
 * `cases` patch.
 *
 * No imports from `convex/server`, `convex/values`, or `_generated/*` —
 * this file MUST remain safe to import in any JavaScript environment,
 * including Vitest unit tests and Next.js client bundles.
 */

import {
  REASSIGNMENT_REASON_CODES,
  REASSIGNMENT_REASON_LABELS,
  type ReassignmentReasonCode,
} from "./qrReassignmentHelpers";

// ─── Action types ─────────────────────────────────────────────────────────────

/**
 * The exhaustive set of QR association actions captured by the audit log.
 *
 *   "create"     — A QR payload was associated with a case (initial
 *                  association via any of the create-paths).
 *   "reassign"   — A QR payload was moved from one case to another;
 *                  produces TWO audit rows linked by a correlationId.
 *   "invalidate" — A QR payload was removed from a case without a
 *                  replacement target.
 */
export const QR_ASSOCIATION_ACTIONS = [
  "create",
  "reassign",
  "invalidate",
] as const;

export type QrAssociationAction = (typeof QR_ASSOCIATION_ACTIONS)[number];

/**
 * Type guard for `QrAssociationAction`.  Used to validate caller-supplied
 * action strings before insert.
 */
export function isValidQrAssociationAction(
  value: string,
): value is QrAssociationAction {
  return (QR_ASSOCIATION_ACTIONS as readonly string[]).includes(value);
}

/**
 * Role discriminator for the two halves of a "reassign" pair.
 *
 *   "source" — appended to the case that LOST the QR.
 *   "target" — appended to the case that GAINED the QR.
 *
 * Undefined / null for "create" and "invalidate" actions (only one case
 * is involved so the role concept does not apply).
 */
export type QrAssociationRole = "source" | "target";

// ─── Reason codes ─────────────────────────────────────────────────────────────

/**
 * Reason codes for `action: "create"` audit rows.
 *
 *   "initial_association" — first time a QR is being attached to a case
 *                           (default when the caller does not specify).
 *   "label_replacement"   — a previously associated QR is being overwritten
 *                           with a freshly printed/scanned label for the
 *                           same case (no source/target move involved).
 *   "label_correction"    — fixing a data-entry error in the original
 *                           QR string without moving the label.
 *   "other"               — unusual scenarios.  REQUIRES non-empty
 *                           reasonNotes explaining why none of the
 *                           predefined codes apply.
 */
export const CREATE_REASON_CODES = [
  "initial_association",
  "label_replacement",
  "label_correction",
  "other",
] as const;

export type CreateReasonCode = (typeof CREATE_REASON_CODES)[number];

export const CREATE_REASON_LABELS: Readonly<Record<CreateReasonCode, string>> =
  {
    initial_association: "Initial association",
    label_replacement:   "Label replacement",
    label_correction:    "Label correction",
    other:               "Other",
  };

export function isValidCreateReasonCode(value: string): value is CreateReasonCode {
  return (CREATE_REASON_CODES as readonly string[]).includes(value);
}

/**
 * Reason codes for `action: "invalidate"` audit rows.
 *
 *   "label_destroyed"      — the physical QR label is damaged/destroyed
 *                            and the case's identity needs to be cleared
 *                            until a replacement label is generated.
 *   "case_decommissioned"  — the case is being retired from service so
 *                            the QR is being released for re-use elsewhere.
 *   "security_breach"      — a stolen or compromised label needs to be
 *                            invalidated immediately for security reasons.
 *   "other"                — unusual scenarios.  REQUIRES non-empty
 *                            reasonNotes.
 */
export const INVALIDATION_REASON_CODES = [
  "label_destroyed",
  "case_decommissioned",
  "security_breach",
  "other",
] as const;

export type InvalidationReasonCode =
  (typeof INVALIDATION_REASON_CODES)[number];

export const INVALIDATION_REASON_LABELS: Readonly<
  Record<InvalidationReasonCode, string>
> = {
  label_destroyed:     "Label destroyed",
  case_decommissioned: "Case decommissioned",
  security_breach:     "Security breach",
  other:               "Other",
};

export function isValidInvalidationReasonCode(
  value: string,
): value is InvalidationReasonCode {
  return (INVALIDATION_REASON_CODES as readonly string[]).includes(value);
}

/**
 * The set of reason codes (across every action type) that mandate non-empty
 * `reasonNotes`.  Today every action's `"other"` code is in this set.  If
 * a future scenario needs a non-"other" code that still requires notes,
 * extend this set rather than scattering the rule across mutations.
 */
export const REASONS_REQUIRING_NOTES: ReadonlySet<string> = new Set([
  "other",
]);

// ─── Inputs ───────────────────────────────────────────────────────────────────

/**
 * Common attribution + provenance fields shared by every audit-record builder.
 *
 *   actorId    — Kinde user ID of the operator (required, non-empty).
 *   actorName  — Display name of the operator (required, non-empty).
 *   timestamp  — Epoch ms; callers SHOULD pass a single shared `Date.now()`
 *                value for both halves of a reassign pair so the rows
 *                share an identical timestamp.
 */
export interface QrAuditCommonInputs {
  actorId:   string;
  actorName: string;
  timestamp: number;
}

/**
 * Inputs for a `create` audit row.
 *
 * Used by every initial-association path: generateQRCodeForCase,
 * associateQRCodeToCase, generateQrCode, setQrCode, updateQrCode.
 *
 * Pass `previousQrCode`/`previousQrCodeSource` when overwriting a prior QR
 * on the same case (e.g. updateQrCode flow); leave them undefined for the
 * truly-first association.
 */
export interface QrAuditCreateInputs extends QrAuditCommonInputs {
  caseId:         string;
  qrCode:         string;
  qrCodeSource:   "generated" | "external";
  reasonCode?:    CreateReasonCode;
  reasonNotes?:   string;
  /** Previous QR on this case before the create write (when overwriting). */
  previousQrCode?:       string | null;
  previousQrCodeSource?: "generated" | "external" | null;
}

/**
 * Inputs for the SOURCE-side row of a `reassign` action.
 *
 * Source-side context: the QR is leaving this case.  The row records the
 * QR being moved away (qrCode/qrCodeSource) and points to the target case
 * via counterpartCaseId/counterpartCaseLabel.
 *
 * Source rows always set `previousQrCode === qrCode` (the QR that left)
 * and `previousQrCodeSource === qrCodeSource` so the audit panel can
 * render "QR X left case A" without parsing the role field.
 */
export interface QrAuditReassignSourceInputs extends QrAuditCommonInputs {
  sourceCaseId:        string;
  qrCode:              string;
  qrCodeSource:        "generated" | "external";
  reasonCode:          ReassignmentReasonCode;
  reasonNotes?:        string;
  targetCaseId:        string;
  targetCaseLabel:     string;
  correlationId:       string;
}

/**
 * Inputs for the TARGET-side row of a `reassign` action.
 *
 * Target-side context: the QR has arrived on this case.  qrCode/qrCodeSource
 * record the new association; previousQrCode/previousQrCodeSource record
 * the target's prior QR (if any) which has been displaced; and
 * counterpartCaseId/counterpartCaseLabel point back to the source case.
 */
export interface QrAuditReassignTargetInputs extends QrAuditCommonInputs {
  targetCaseId:        string;
  qrCode:              string;
  qrCodeSource:        "generated" | "external";
  reasonCode:          ReassignmentReasonCode;
  reasonNotes?:        string;
  sourceCaseId:        string;
  sourceCaseLabel:     string;
  /** The target case's prior QR (if any) which has been displaced. */
  previousQrCode:       string | null;
  previousQrCodeSource: "generated" | "external" | null;
  correlationId:       string;
}

/**
 * Inputs for an `invalidate` audit row.
 *
 * Records the removal of a QR from a case without a replacement target.
 * Used by the `invalidateQrCode` mutation when an operator needs to clear
 * a case's QR (e.g., damaged label, decommissioned case).
 */
export interface QrAuditInvalidateInputs extends QrAuditCommonInputs {
  caseId:               string;
  /** The QR being invalidated.  Becomes the previousQrCode in the row. */
  previousQrCode:       string;
  previousQrCodeSource: "generated" | "external" | null;
  reasonCode:           InvalidationReasonCode;
  reasonNotes?:         string;
}

// ─── Output record shape ──────────────────────────────────────────────────────

/**
 * The shape of a single `qr_association_events` row, mirrored from the
 * Convex schema.  Builders return objects of this shape ready for
 * `ctx.db.insert("qr_association_events", record)`.
 *
 * `caseId` and `counterpartCaseId` are kept as `string` here because the
 * pure helper layer cannot reference `Id<"cases">` without importing
 * `_generated/dataModel`.  Convex callers cast the strings to `Id<"cases">`
 * at the boundary (Convex's Id values serialise to strings, so the cast is
 * type-only — there is no runtime conversion).
 */
export interface QrAssociationAuditRecord {
  caseId:               string;
  action:               QrAssociationAction;
  role?:                QrAssociationRole;
  actorId:              string;
  actorName:            string;
  timestamp:            number;
  reasonCode:           string;
  reasonLabel:          string;
  reasonNotes?:         string;
  qrCode:               string;
  qrCodeSource?:        "generated" | "external";
  previousQrCode?:      string;
  previousQrCodeSource?:"generated" | "external";
  correlationId?:       string;
  counterpartCaseId?:   string;
  counterpartCaseLabel?:string;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Internal helper — validates the shared attribution fields and throws a
 * descriptive error if any required field is missing.  Centralised so
 * every builder applies the same rules.
 */
function assertCommonInputsValid(args: QrAuditCommonInputs, builderName: string): void {
  if (!args.actorId || args.actorId.trim().length === 0) {
    throw new Error(
      `[QR_AUDIT_INVALID] ${builderName}: actorId must be a non-empty Kinde user ID.`,
    );
  }
  if (!args.actorName || args.actorName.trim().length === 0) {
    throw new Error(
      `[QR_AUDIT_INVALID] ${builderName}: actorName must be a non-empty display name.`,
    );
  }
  if (!Number.isFinite(args.timestamp) || args.timestamp <= 0) {
    throw new Error(
      `[QR_AUDIT_INVALID] ${builderName}: timestamp must be a positive epoch-ms value.`,
    );
  }
}

/**
 * Internal helper — normalises `reasonNotes` (trim + null when empty) and
 * enforces the "non-empty notes required for `other` reason codes" rule.
 *
 * Returns the normalised reason notes string or undefined when the caller
 * passed nothing.  Throws `[QR_AUDIT_REASON_NOTES_REQUIRED]` when the
 * reason code is in `REASONS_REQUIRING_NOTES` but the notes are empty.
 */
function normaliseReasonNotes(
  reasonCode:  string,
  rawNotes:    string | undefined,
  builderName: string,
): string | undefined {
  const trimmed = rawNotes?.trim();
  if (REASONS_REQUIRING_NOTES.has(reasonCode)) {
    if (!trimmed || trimmed.length === 0) {
      throw new Error(
        `[QR_AUDIT_REASON_NOTES_REQUIRED] ${builderName}: ` +
        `reasonCode "${reasonCode}" requires non-empty reasonNotes.`,
      );
    }
    return trimmed;
  }
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

// ─── Builders ─────────────────────────────────────────────────────────────────

/**
 * Build the audit record for an initial QR-to-case association.
 *
 * Defaults the reason code to `"initial_association"` when the caller
 * does not specify one.  When `previousQrCode` is provided (e.g. the
 * updateQrCode flow that overwrites a prior label on the same case), the
 * fields are recorded so the audit panel can render a before/after diff.
 *
 * @throws `[QR_AUDIT_INVALID]` when actor / timestamp / qrCode are bad.
 * @throws `[QR_AUDIT_INVALID_REASON]` when reasonCode is unrecognised.
 * @throws `[QR_AUDIT_REASON_NOTES_REQUIRED]` when `reasonCode === "other"`
 *         but `reasonNotes` is empty.
 */
export function buildCreateAuditRecord(
  args: QrAuditCreateInputs,
): QrAssociationAuditRecord {
  assertCommonInputsValid(args, "buildCreateAuditRecord");

  const trimmedQr = args.qrCode?.trim() ?? "";
  if (trimmedQr.length === 0) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildCreateAuditRecord: qrCode must be non-empty.",
    );
  }
  if (!args.caseId || args.caseId.trim().length === 0) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildCreateAuditRecord: caseId must be non-empty.",
    );
  }

  const reasonCode = args.reasonCode ?? "initial_association";
  if (!isValidCreateReasonCode(reasonCode)) {
    throw new Error(
      `[QR_AUDIT_INVALID_REASON] buildCreateAuditRecord: ` +
      `unknown reasonCode "${reasonCode}". Allowed: ${CREATE_REASON_CODES.join(", ")}.`,
    );
  }

  const reasonNotes = normaliseReasonNotes(
    reasonCode,
    args.reasonNotes,
    "buildCreateAuditRecord",
  );

  const previousQrCodeRaw = args.previousQrCode?.trim();
  const hasPrevious = previousQrCodeRaw && previousQrCodeRaw.length > 0;

  const record: QrAssociationAuditRecord = {
    caseId:       args.caseId,
    action:       "create",
    actorId:      args.actorId,
    actorName:    args.actorName,
    timestamp:    args.timestamp,
    reasonCode,
    reasonLabel:  CREATE_REASON_LABELS[reasonCode],
    qrCode:       trimmedQr,
    qrCodeSource: args.qrCodeSource,
  };
  if (reasonNotes !== undefined) record.reasonNotes = reasonNotes;
  if (hasPrevious) {
    record.previousQrCode = previousQrCodeRaw;
    if (args.previousQrCodeSource) {
      record.previousQrCodeSource = args.previousQrCodeSource;
    }
  }
  return record;
}

/**
 * Build the SOURCE-side audit record for a QR reassignment.
 *
 * The source-side row is appended to the case that LOST the QR.  qrCode
 * is the payload that left; previousQrCode mirrors qrCode so audit
 * consumers see "QR X was on this case before; QR is now empty after".
 *
 * @throws `[QR_AUDIT_INVALID]` when required fields are missing.
 * @throws `[QR_AUDIT_INVALID_REASON]` when reasonCode is not a valid
 *         REASSIGNMENT_REASON_CODES literal.
 * @throws `[QR_AUDIT_REASON_NOTES_REQUIRED]` when `reasonCode === "other"`
 *         but `reasonNotes` is empty.
 */
export function buildReassignSourceAuditRecord(
  args: QrAuditReassignSourceInputs,
): QrAssociationAuditRecord {
  assertCommonInputsValid(args, "buildReassignSourceAuditRecord");

  if (!args.sourceCaseId || args.sourceCaseId.trim().length === 0) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildReassignSourceAuditRecord: sourceCaseId must be non-empty.",
    );
  }
  if (!args.targetCaseId || args.targetCaseId.trim().length === 0) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildReassignSourceAuditRecord: targetCaseId must be non-empty.",
    );
  }
  if (args.sourceCaseId === args.targetCaseId) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildReassignSourceAuditRecord: sourceCaseId and targetCaseId must differ.",
    );
  }

  const trimmedQr = args.qrCode?.trim() ?? "";
  if (trimmedQr.length === 0) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildReassignSourceAuditRecord: qrCode must be non-empty.",
    );
  }
  if (!args.correlationId || args.correlationId.trim().length === 0) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildReassignSourceAuditRecord: correlationId must be non-empty.",
    );
  }
  if (!(REASSIGNMENT_REASON_CODES as readonly string[]).includes(args.reasonCode)) {
    throw new Error(
      `[QR_AUDIT_INVALID_REASON] buildReassignSourceAuditRecord: ` +
      `unknown reasonCode "${args.reasonCode}". Allowed: ` +
      `${REASSIGNMENT_REASON_CODES.join(", ")}.`,
    );
  }

  const reasonNotes = normaliseReasonNotes(
    args.reasonCode,
    args.reasonNotes,
    "buildReassignSourceAuditRecord",
  );

  const record: QrAssociationAuditRecord = {
    caseId:               args.sourceCaseId,
    action:               "reassign",
    role:                 "source",
    actorId:              args.actorId,
    actorName:            args.actorName,
    timestamp:            args.timestamp,
    reasonCode:           args.reasonCode,
    reasonLabel:          REASSIGNMENT_REASON_LABELS[args.reasonCode],
    qrCode:               trimmedQr,
    qrCodeSource:         args.qrCodeSource,
    previousQrCode:       trimmedQr,
    previousQrCodeSource: args.qrCodeSource,
    correlationId:        args.correlationId,
    counterpartCaseId:    args.targetCaseId,
    counterpartCaseLabel: args.targetCaseLabel,
  };
  if (reasonNotes !== undefined) record.reasonNotes = reasonNotes;
  return record;
}

/**
 * Build the TARGET-side audit record for a QR reassignment.
 *
 * The target-side row is appended to the case that GAINED the QR.
 * qrCode/qrCodeSource record the new association.  previousQrCode/
 * previousQrCodeSource record the target's prior QR (if any) which has
 * been displaced — useful for the audit panel to flag "displaced QR
 * needs to be re-issued".
 *
 * @throws `[QR_AUDIT_INVALID]` when required fields are missing.
 * @throws `[QR_AUDIT_INVALID_REASON]` when reasonCode is unrecognised.
 * @throws `[QR_AUDIT_REASON_NOTES_REQUIRED]` when `reasonCode === "other"`
 *         but `reasonNotes` is empty.
 */
export function buildReassignTargetAuditRecord(
  args: QrAuditReassignTargetInputs,
): QrAssociationAuditRecord {
  assertCommonInputsValid(args, "buildReassignTargetAuditRecord");

  if (!args.sourceCaseId || args.sourceCaseId.trim().length === 0) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildReassignTargetAuditRecord: sourceCaseId must be non-empty.",
    );
  }
  if (!args.targetCaseId || args.targetCaseId.trim().length === 0) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildReassignTargetAuditRecord: targetCaseId must be non-empty.",
    );
  }
  if (args.sourceCaseId === args.targetCaseId) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildReassignTargetAuditRecord: sourceCaseId and targetCaseId must differ.",
    );
  }

  const trimmedQr = args.qrCode?.trim() ?? "";
  if (trimmedQr.length === 0) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildReassignTargetAuditRecord: qrCode must be non-empty.",
    );
  }
  if (!args.correlationId || args.correlationId.trim().length === 0) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildReassignTargetAuditRecord: correlationId must be non-empty.",
    );
  }
  if (!(REASSIGNMENT_REASON_CODES as readonly string[]).includes(args.reasonCode)) {
    throw new Error(
      `[QR_AUDIT_INVALID_REASON] buildReassignTargetAuditRecord: ` +
      `unknown reasonCode "${args.reasonCode}". Allowed: ` +
      `${REASSIGNMENT_REASON_CODES.join(", ")}.`,
    );
  }

  const reasonNotes = normaliseReasonNotes(
    args.reasonCode,
    args.reasonNotes,
    "buildReassignTargetAuditRecord",
  );

  const record: QrAssociationAuditRecord = {
    caseId:               args.targetCaseId,
    action:               "reassign",
    role:                 "target",
    actorId:              args.actorId,
    actorName:            args.actorName,
    timestamp:            args.timestamp,
    reasonCode:           args.reasonCode,
    reasonLabel:          REASSIGNMENT_REASON_LABELS[args.reasonCode],
    qrCode:               trimmedQr,
    qrCodeSource:         args.qrCodeSource,
    correlationId:        args.correlationId,
    counterpartCaseId:    args.sourceCaseId,
    counterpartCaseLabel: args.sourceCaseLabel,
  };
  if (reasonNotes !== undefined) record.reasonNotes = reasonNotes;
  if (args.previousQrCode && args.previousQrCode.trim().length > 0) {
    record.previousQrCode = args.previousQrCode.trim();
    if (args.previousQrCodeSource) {
      record.previousQrCodeSource = args.previousQrCodeSource;
    }
  }
  return record;
}

/**
 * Build the audit record for a QR invalidation (removal without replacement).
 *
 * Records the QR being removed via `previousQrCode`/`previousQrCodeSource`
 * and leaves `qrCode` as the empty string (sentinel for "no QR currently
 * associated", consistent with the source-side patch in the reassign flow).
 *
 * @throws `[QR_AUDIT_INVALID]` when required fields are missing.
 * @throws `[QR_AUDIT_INVALID_REASON]` when reasonCode is not a valid
 *         INVALIDATION_REASON_CODES literal.
 * @throws `[QR_AUDIT_REASON_NOTES_REQUIRED]` when `reasonCode === "other"`
 *         but `reasonNotes` is empty.
 */
export function buildInvalidateAuditRecord(
  args: QrAuditInvalidateInputs,
): QrAssociationAuditRecord {
  assertCommonInputsValid(args, "buildInvalidateAuditRecord");

  if (!args.caseId || args.caseId.trim().length === 0) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildInvalidateAuditRecord: caseId must be non-empty.",
    );
  }

  const trimmedPrev = args.previousQrCode?.trim() ?? "";
  if (trimmedPrev.length === 0) {
    throw new Error(
      "[QR_AUDIT_INVALID] buildInvalidateAuditRecord: previousQrCode must be non-empty " +
      "(callers must capture the QR being invalidated for the audit trail).",
    );
  }
  if (!isValidInvalidationReasonCode(args.reasonCode)) {
    throw new Error(
      `[QR_AUDIT_INVALID_REASON] buildInvalidateAuditRecord: ` +
      `unknown reasonCode "${args.reasonCode}". Allowed: ` +
      `${INVALIDATION_REASON_CODES.join(", ")}.`,
    );
  }

  const reasonNotes = normaliseReasonNotes(
    args.reasonCode,
    args.reasonNotes,
    "buildInvalidateAuditRecord",
  );

  const record: QrAssociationAuditRecord = {
    caseId:         args.caseId,
    action:         "invalidate",
    actorId:        args.actorId,
    actorName:      args.actorName,
    timestamp:      args.timestamp,
    reasonCode:     args.reasonCode,
    reasonLabel:    INVALIDATION_REASON_LABELS[args.reasonCode],
    qrCode:         "",
    previousQrCode: trimmedPrev,
  };
  if (reasonNotes !== undefined) record.reasonNotes = reasonNotes;
  if (args.previousQrCodeSource) {
    record.previousQrCodeSource = args.previousQrCodeSource;
  }
  return record;
}
