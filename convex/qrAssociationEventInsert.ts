/**
 * convex/qrAssociationEventInsert.ts
 *
 * Boundary helper that converts a pure `QrAssociationAuditRecord` (built by
 * `qrAssociationAuditHelpers`) into the exact shape required by
 * `ctx.db.insert("qr_association_events", ...)`.
 *
 * Why a separate file?
 * ────────────────────
 * The pure helper module `qrAssociationAuditHelpers.ts` is Convex-runtime-
 * free so it can be unit-tested with Vitest and imported by Next.js client
 * bundles.  It carries `caseId` and `counterpartCaseId` as plain `string`
 * values because referencing Convex's `Id<"cases">` would require importing
 * `_generated/dataModel`, which pulls in the Convex runtime.
 *
 * The schema's `qr_association_events` table requires `caseId` and
 * `counterpartCaseId` to be branded `Id<"cases">` values for foreign-key
 * type-safety.  Convex `Id` values serialise to strings, so the conversion
 * is type-only with no runtime translation — but the cast must still
 * happen somewhere on the boundary between the pure helper output and the
 * Convex insert call.
 *
 * Centralising the cast here means:
 *   • Every QR audit insert path uses the same conversion (no scattered
 *     `as any` or `as Id<"cases">` casts).
 *   • Future schema-shape changes (e.g., adding new ID-typed fields) only
 *     require editing this file.
 */

import type { Id } from "./_generated/dataModel";
import type { QrAssociationAuditRecord } from "./qrAssociationAuditHelpers";

/**
 * Strongly-typed payload accepted by `ctx.db.insert("qr_association_events", ...)`.
 *
 * Mirrors the shape from convex/schema.ts but uses `Id<"cases">` for the
 * two case-reference fields and keeps the rest of the audit record fields
 * verbatim from `QrAssociationAuditRecord`.
 */
export type QrAssociationEventInsert = Omit<
  QrAssociationAuditRecord,
  "caseId" | "counterpartCaseId"
> & {
  caseId:             Id<"cases">;
  counterpartCaseId?: Id<"cases">;
};

/**
 * Build the insert payload for the `qr_association_events` table from a
 * pure audit record returned by one of the `buildXAuditRecord` helpers.
 *
 * @param record  The audit record returned by a helper.  `caseId` and
 *                `counterpartCaseId` will be branded as `Id<"cases">` on
 *                the way out.
 * @param caseId  The Convex `Id<"cases">` for the affected case (the
 *                caller's mutation already has this typed correctly).
 *                When provided it OVERRIDES `record.caseId` so the
 *                boundary cast is explicit.  Required so callers cannot
 *                accidentally insert an audit row with the helper's
 *                stringified ID.
 * @param counterpartCaseId
 *                Optional `Id<"cases">` for the counterpart case (the
 *                source/target case in a paired reassign).  When provided
 *                it OVERRIDES `record.counterpartCaseId`.  Pass `undefined`
 *                for actions without a counterpart (create / invalidate).
 */
export function toQrAssociationEventInsert(
  record:             QrAssociationAuditRecord,
  caseId:             Id<"cases">,
  counterpartCaseId?: Id<"cases">,
): QrAssociationEventInsert {
  // Strip the string-typed ID fields from the helper record then re-attach
  // the typed Id<"cases"> values supplied by the caller.  The remainder of
  // the record (action, role, actor, timestamp, reason, qr fields,
  // correlationId, counterpartCaseLabel) carries through unchanged.
  const {
    caseId:             _stripCaseId,
    counterpartCaseId:  _stripCounterpart,
    ...rest
  } = record;
  void _stripCaseId;
  void _stripCounterpart;

  const insert: QrAssociationEventInsert = {
    ...rest,
    caseId,
  };
  if (counterpartCaseId !== undefined) {
    insert.counterpartCaseId = counterpartCaseId;
  }
  return insert;
}
