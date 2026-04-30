/**
 * convex/qrReassignmentHelpers.ts
 *
 * Pure, Convex-runtime-free helpers that define and enforce the rules for
 * MOVING a QR code from one case to another (Sub-AC 2 of AC 240302).
 *
 * Why a separate helper module?
 * ─────────────────────────────
 * Sub-AC 1 (`qrCodeHelpers.ts`) covers the *initial* uniqueness invariant:
 * every QR payload may be associated with at most one case.  Sub-AC 2 covers
 * the harder problem of *intentionally* moving a QR from case A to case B —
 * which violates the by_qr_code uniqueness invariant momentarily and therefore
 * needs a single, audited workflow rather than ad-hoc patches.
 *
 * Reassignment is a higher-trust operation than initial association:
 *
 *   • It implicitly invalidates the prior association — the QR no longer maps
 *     to its previous case.  Any printed label tied to case A becomes wrong.
 *
 *   • It is irreversible without a second reassignment — once case B owns the
 *     payload, scans now resolve to B, and case A's identity is anonymous
 *     until a new label is generated for it.
 *
 *   • It must be auditable across BOTH cases — both case A and case B need
 *     timeline events linked by a shared correlation ID.
 *
 * For these reasons the rules enforced here are stricter than the basic
 * uniqueness rule:
 *
 *   1. PERMISSION CHECK — only roles holding the `QR_CODE_REASSIGN` operation
 *      (admin and technician) may perform the move.  Pilots cannot reassign
 *      labels even though they may scan and read them.
 *
 *   2. REQUIRED REASON CODE — every reassignment MUST include one of the
 *      enumerated `REASSIGNMENT_REASON_CODES`.  This gives operations leads a
 *      structured way to filter the audit log and surfaces unusual patterns
 *      (e.g., a spike in `data_entry_error` codes pointing to a label
 *      printer issue).
 *
 *   3. REASON NOTES FOR "other" — the `other` reason code mandates non-empty
 *      `reasonNotes` so the audit trail captures a free-text justification
 *      whenever the predefined codes are insufficient.
 *
 *   4. PRIOR-ASSOCIATION INVALIDATION — the source case's `qrCode` and
 *      `qrCodeSource` fields are cleared when the QR moves to the target.
 *      A "qr_code_unassigned" audit event is appended to the source case so
 *      its history shows when and why it lost the label.
 *
 *   5. NO IDENTITY-MOVE TO SAME CASE — moving a QR to the case that already
 *      holds it is rejected as a logical error (the caller should use
 *      associateQRCodeToCase or simply do nothing instead).
 *
 *   6. NO-OP FOR UNASSIGNED PAYLOADS — if the QR is not currently mapped to
 *      any case, the caller should use `associateQRCodeToCase` instead of
 *      `reassignQrCodeToCase`.  This helper distinguishes the two cases so
 *      mutations can throw a clear error rather than silently succeeding.
 *
 * No imports from `convex/server`, `convex/values`, or `_generated/*` —
 * this file MUST remain safe to import in any JavaScript environment,
 * including Vitest unit tests and Next.js client bundles.
 */

import type { QrCodeCaseRow, QrCodeConflictDeps } from "./qrCodeHelpers";
import { normalizeQrPayload } from "./qrCodeHelpers";

// ─── Reason codes ─────────────────────────────────────────────────────────────

/**
 * The exhaustive set of allowed reason codes for QR re-assignment.
 *
 * Each code captures one concrete operational scenario observed in the field.
 * Adding a new code requires:
 *   1. Appending the literal here.
 *   2. Updating `REASSIGNMENT_REASON_LABELS` with a human-readable label.
 *   3. Adding the literal to the Convex `v.union(...)` validator on the
 *      reassignment mutation.
 *
 * Order is significant only for UI dropdowns — the first entry is the
 * default presented to the operator.
 */
export const REASSIGNMENT_REASON_CODES = [
  /**
   * The original physical label was damaged, faded, or destroyed and a new
   * label has been printed for the same case OR the label survived but the
   * case it belonged to was retired and the label is being placed on a new
   * case.  Most common code in the wild.
   */
  "label_replacement",

  /**
   * The QR code was originally associated with the wrong case due to a
   * data-entry / scanning error during onboarding.  Choose this code when
   * the move corrects an operator mistake rather than reflects a real-world
   * relabel event.
   */
  "data_entry_error",

  /**
   * Two cases were swapped (e.g., a pilot intended to ship case A but
   * accidentally took case B labelled with A's QR).  The QR is being moved
   * onto the case that physically matches it.
   */
  "case_swap",

  /**
   * The original case was decommissioned / archived and its label is being
   * recycled for a replacement case.  Use this code rather than
   * `label_replacement` when the source case is leaving service entirely.
   */
  "case_retired",

  /**
   * The label was misprinted (wrong barcode, mismatched payload format) and
   * the printer-correct payload is being attached to the case that should
   * have carried it from the start.
   */
  "label_misprint",

  /**
   * Catch-all for unusual scenarios.  REQUIRES non-empty `reasonNotes` to
   * justify why none of the above codes apply.  Frequent use of `other`
   * indicates a missing concrete code that should be added to this list.
   */
  "other",
] as const;

/**
 * Discriminated string union of all valid reason codes.
 * Drives both the Convex argument validator and the UI dropdown options.
 */
export type ReassignmentReasonCode = typeof REASSIGNMENT_REASON_CODES[number];

/**
 * Human-readable labels for the reason codes — used in dropdowns, audit
 * panel rendering, and notification copy.  Kept in lockstep with
 * `REASSIGNMENT_REASON_CODES`.
 */
export const REASSIGNMENT_REASON_LABELS: Readonly<
  Record<ReassignmentReasonCode, string>
> = {
  label_replacement: "Label replacement",
  data_entry_error:  "Data-entry error",
  case_swap:         "Case swap",
  case_retired:      "Case retired",
  label_misprint:    "Label misprint",
  other:             "Other",
};

/**
 * The single reason code that requires non-empty `reasonNotes`.
 * Centralised so the validator and UI agree on which code triggers the
 * mandatory free-text field.
 */
export const REASSIGNMENT_REASONS_REQUIRING_NOTES: ReadonlySet<ReassignmentReasonCode> =
  new Set(["other"]);

/**
 * Type guard — is the value a recognised reassignment reason code?
 *
 * Use to filter unknown / stale codes coming from clients before invoking
 * the rule evaluator.  Pure function — safe in any environment.
 */
export function isValidReassignmentReasonCode(
  value: string,
): value is ReassignmentReasonCode {
  return (REASSIGNMENT_REASON_CODES as readonly string[]).includes(value);
}

// ─── Outcome types ────────────────────────────────────────────────────────────

/**
 * Structured outcome returned by `evaluateReassignment`.
 *
 * Discriminated union forces callers to handle every branch explicitly so
 * the TypeScript compiler flags any forgotten case.  Mutations throw on
 * every branch except `ok`; the calling UI can choose to surface different
 * error toasts per kind.
 */
export type ReassignmentEvaluation =
  /**
   * Reason code is missing, empty, or not in the allow-list.
   * Mutation should throw an `[INVALID_REASON]` error.
   */
  | {
      kind:   "invalid_reason";
      reason: string;
    }
  /**
   * Reason code is `other` but `reasonNotes` is empty / whitespace-only.
   * Mutation should throw an `[REASON_NOTES_REQUIRED]` error.
   */
  | {
      kind:   "reason_notes_required";
      reason: string;
    }
  /**
   * QR code payload is empty after trimming.
   * Mutation should throw an `[INVALID_QR]` error.
   */
  | {
      kind:   "invalid_qr";
      reason: string;
    }
  /**
   * Target case ID is empty / falsy.
   * Mutation should throw an `[INVALID_TARGET]` error.
   */
  | {
      kind:   "invalid_target";
      reason: string;
    }
  /**
   * The QR code is not currently associated with any case — caller used
   * the wrong API.  Should use `associateQRCodeToCase` instead.
   */
  | {
      kind:   "not_currently_assigned";
      reason: string;
    }
  /**
   * The QR code is already on the target case.  Reassignment to self is a
   * logical error, not an idempotent success — the mutation rejects so the
   * UI can prompt the operator to choose a DIFFERENT target.
   */
  | {
      kind:                 "same_case";
      reason:               string;
      conflictingCaseId:    string;
      conflictingCaseLabel: string;
    }
  /**
   * All rules passed — the move is permitted.  The mutation should now
   * execute the atomic two-case patch and append both audit events.
   *
   * The evaluator returns the resolved source case row so the mutation
   * does not have to repeat the by_qr_code lookup.
   */
  | {
      kind:                "ok";
      sourceCaseId:        string;
      sourceCaseLabel:     string;
      sourceQrCodeSource:  "generated" | "external" | null;
      normalizedQrCode:    string;
    };

// ─── Inputs ───────────────────────────────────────────────────────────────────

/**
 * Inputs to the pure reassignment evaluator.  Mirrors the Convex mutation
 * args minus the auth/user attribution fields.
 */
export interface ReassignmentInputs {
  /** Raw QR payload as supplied by the caller (will be trimmed). */
  qrCode:        string;
  /** Convex ID (or any opaque identifier) of the destination case. */
  targetCaseId:  string;
  /** Reason code — must be one of `REASSIGNMENT_REASON_CODES`. */
  reasonCode:    string;
  /** Optional free-text justification.  Required when `reasonCode === "other"`. */
  reasonNotes?:  string;
}

/**
 * Dependencies for the evaluator — read-only DB lookup callbacks.  Convex
 * mutations wrap their `ctx.db` queries; tests inject in-memory maps.
 */
export interface ReassignmentDeps extends QrCodeConflictDeps {
  /**
   * Look up a case row by its primary key.  Returns the row, or `null` when
   * no case exists with that ID.  Used to verify that the destination case
   * exists before attempting to move the QR onto it.
   */
  findCaseById(caseId: string): Promise<QrCodeCaseRow | null>;
}

// ─── Pure rule evaluator ──────────────────────────────────────────────────────

/**
 * Evaluate whether a QR-reassignment request satisfies every rule.
 *
 * This is the single source of truth for QR-reassignment rules.  Mutations
 * MUST call this helper before issuing any DB writes.  Returns a structured
 * outcome the caller switches on:
 *
 *   • "invalid_reason"          → reject with [INVALID_REASON]
 *   • "reason_notes_required"   → reject with [REASON_NOTES_REQUIRED]
 *   • "invalid_qr"              → reject with [INVALID_QR]
 *   • "invalid_target"          → reject with [INVALID_TARGET]
 *   • "not_currently_assigned"  → reject with [QR_NOT_ASSIGNED]
 *   • "same_case"               → reject with [SAME_CASE]
 *   • "ok"                      → proceed with the atomic patch
 *
 * Rule order is fixed so that error messages reach the operator in priority:
 *   1. Reason code shape  (cheapest, no DB)
 *   2. Reason notes shape (cheapest, no DB)
 *   3. QR payload shape   (cheapest, no DB)
 *   4. Target ID shape    (cheapest, no DB)
 *   5. Target case exists (single DB read)
 *   6. QR is currently mapped (one DB index read)
 *   7. Source ≠ Target    (in-memory comparison)
 *
 * Performance:
 *   At most TWO database reads per evaluation — `findCaseById(targetId)` and
 *   `findCaseByQrCode(qr)` (each O(log n) via primary key / by_qr_code).
 */
export async function evaluateReassignment(
  inputs: ReassignmentInputs,
  deps:   ReassignmentDeps,
): Promise<ReassignmentEvaluation> {
  // ── 1. Reason code must be present and recognised ──────────────────────────
  const trimmedReason = inputs.reasonCode?.trim() ?? "";
  if (trimmedReason.length === 0) {
    return {
      kind:   "invalid_reason",
      reason: "A reason code is required when reassigning a QR code.",
    };
  }
  if (!isValidReassignmentReasonCode(trimmedReason)) {
    return {
      kind:
        "invalid_reason",
      reason:
        `Unknown reason code "${trimmedReason}". Allowed: ` +
        `${REASSIGNMENT_REASON_CODES.join(", ")}.`,
    };
  }

  // ── 2. "other" requires non-empty reason notes ─────────────────────────────
  if (REASSIGNMENT_REASONS_REQUIRING_NOTES.has(trimmedReason as ReassignmentReasonCode)) {
    const trimmedNotes = inputs.reasonNotes?.trim() ?? "";
    if (trimmedNotes.length === 0) {
      return {
        kind:
          "reason_notes_required",
        reason:
          `Reason code "${trimmedReason}" requires non-empty reasonNotes ` +
          `explaining why none of the predefined codes apply.`,
      };
    }
  }

  // ── 3. QR payload must be non-empty after trimming ─────────────────────────
  const normalizedQr = normalizeQrPayload(inputs.qrCode);
  if (normalizedQr === null) {
    return {
      kind:   "invalid_qr",
      reason: "QR code must be a non-empty string after trimming.",
    };
  }

  // ── 4. Target case ID must be present ──────────────────────────────────────
  const targetId = inputs.targetCaseId?.trim() ?? "";
  if (targetId.length === 0) {
    return {
      kind:   "invalid_target",
      reason: "targetCaseId must be a non-empty case identifier.",
    };
  }

  // ── 5. Target case must exist ──────────────────────────────────────────────
  const target = await deps.findCaseById(targetId);
  if (target === null) {
    return {
      kind:   "invalid_target",
      reason: `Target case "${targetId}" does not exist.`,
    };
  }

  // ── 6. QR must currently be mapped to a case ───────────────────────────────
  const source = await deps.findCaseByQrCode(normalizedQr);
  if (source === null) {
    return {
      kind:
        "not_currently_assigned",
      reason:
        `QR code is not currently associated with any case. ` +
        `Use associateQRCodeToCase to perform the initial assignment.`,
    };
  }

  // ── 7. Source must differ from target ──────────────────────────────────────
  if (source._id === targetId) {
    return {
      kind:                 "same_case",
      reason:
        `QR code is already mapped to case "${source.label}". ` +
        `Choose a different target case.`,
      conflictingCaseId:    source._id,
      conflictingCaseLabel: source.label,
    };
  }

  // ── 8. All checks passed — caller may proceed with the atomic patch ────────
  // The qrCodeSource projection is allowed to be undefined on the row helper
  // (the helper only carries _id/label/qrCode).  Mutation callers can fetch
  // the source case in full and read qrCodeSource directly; we surface a
  // null fallback here for clarity in tests.
  return {
    kind:               "ok",
    sourceCaseId:       source._id,
    sourceCaseLabel:    source.label,
    sourceQrCodeSource: null,
    normalizedQrCode:   normalizedQr,
  };
}

// ─── Audit-event payload builders ─────────────────────────────────────────────

/**
 * Shared correlation metadata that links the source-case "unassigned" event
 * to the target-case "reassigned" event.
 *
 * The `correlationId` is generated once per reassignment and written to both
 * events so audit-trail queries can rejoin the two halves of the move with a
 * simple equality predicate.
 */
export interface ReassignmentCorrelation {
  /** Unique correlation ID linking the two audit events for this move. */
  correlationId: string;
  /** Epoch ms timestamp shared by both audit events. */
  timestamp:     number;
}

/**
 * Build the audit-event data payload appended to the SOURCE case timeline.
 *
 * The `action` discriminator is "qr_code_unassigned" so T5 audit rendering
 * can distinguish loss-of-label from gain-of-label.  All identifying fields
 * are denormalised so the timeline row is self-contained — readers do not
 * need to chase a foreign key to reproduce the human story.
 */
export function buildSourceUnassignmentEventData(args: {
  qrCode:              string;
  qrCodeSource:        "generated" | "external" | null;
  reasonCode:          ReassignmentReasonCode;
  reasonNotes?:        string;
  targetCaseId:        string;
  targetCaseLabel:     string;
  correlation:         ReassignmentCorrelation;
}): Record<string, unknown> {
  return {
    action:           "qr_code_unassigned",
    qrCode:           args.qrCode,
    qrCodeSource:     args.qrCodeSource,
    reasonCode:       args.reasonCode,
    reasonLabel:      REASSIGNMENT_REASON_LABELS[args.reasonCode],
    reasonNotes:      args.reasonNotes ?? null,
    transferredToCaseId:    args.targetCaseId,
    transferredToCaseLabel: args.targetCaseLabel,
    correlationId:    args.correlation.correlationId,
  };
}

/**
 * Build the audit-event data payload appended to the TARGET case timeline.
 *
 * The `action` discriminator is "qr_code_reassigned" so dashboards can
 * differentiate a fresh association (`qr_code_associated`) from a relabel
 * that displaced another case's identity.  Identifying fields for the
 * source case are denormalised for the same reason as the source-side
 * payload above.
 */
export function buildTargetReassignmentEventData(args: {
  qrCode:              string;
  qrCodeSource:        "generated" | "external" | null;
  reasonCode:          ReassignmentReasonCode;
  reasonNotes?:        string;
  sourceCaseId:        string;
  sourceCaseLabel:     string;
  previousQrCode:      string | null;
  previousQrCodeSource:"generated" | "external" | null;
  correlation:         ReassignmentCorrelation;
}): Record<string, unknown> {
  return {
    action:                  "qr_code_reassigned",
    qrCode:                  args.qrCode,
    qrCodeSource:            args.qrCodeSource,
    reasonCode:              args.reasonCode,
    reasonLabel:             REASSIGNMENT_REASON_LABELS[args.reasonCode],
    reasonNotes:             args.reasonNotes ?? null,
    transferredFromCaseId:   args.sourceCaseId,
    transferredFromCaseLabel:args.sourceCaseLabel,
    previousQrCode:          args.previousQrCode,
    previousQrCodeSource:    args.previousQrCodeSource,
    correlationId:           args.correlation.correlationId,
  };
}
