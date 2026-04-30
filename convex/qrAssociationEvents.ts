/**
 * convex/qrAssociationEvents.ts
 *
 * Public query and mutation surface for the dedicated QR association audit
 * trail introduced by AC 240303 sub-AC 3.
 *
 * The `qr_association_events` table (defined in convex/schema.ts) is the
 * canonical record of every QR association action — create, reassign,
 * invalidate — with a typed shape that compliance reporting and the
 * dashboard QR-audit panel can query directly without parsing polymorphic
 * `events.data` blobs.
 *
 * Exports
 * ───────
 *   getQrAssociationEventsByCase     — query: chronological per-case audit feed.
 *   getQrAssociationEventsByQrCode   — query: full lifecycle of a single QR
 *                                              payload across every case.
 *   getQrAssociationEventsByActor    — query: every QR action initiated by a
 *                                              specific user.
 *   getQrAssociationEventsByCorrelation
 *                                    — query: fetch both halves of a paired
 *                                              reassign in one lookup.
 *   listRecentQrAssociationEvents    — query: fleet-wide chronological feed
 *                                              with optional action filter.
 *   invalidateQrCode                 — mutation: clear a QR from a case with
 *                                              an audit-recorded reason.
 *
 * Append-only contract
 * ────────────────────
 * The table is written exclusively by helpers that build records via the pure
 * `qrAssociationAuditHelpers` module.  Rows are never updated or deleted from
 * application code.  This module exposes ONE write-path — `invalidateQrCode`
 * — covering the only QR action that does not already have a Convex mutation
 * elsewhere; the create / reassign actions are written by the existing
 * mutations (generateQrCode, setQrCode, updateQrCode, generateQRCodeForCase,
 * associateQRCodeToCase, reassignQrCodeToCase) which were updated by sub-AC
 * 3 to also append audit rows.
 */

import { mutation, query } from "./_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";
import {
  buildInvalidateAuditRecord,
  isValidQrAssociationAction,
  INVALIDATION_REASON_CODES,
  type QrAssociationAction,
} from "./qrAssociationAuditHelpers";
import { toQrAssociationEventInsert } from "./qrAssociationEventInsert";
import {
  OPERATIONS,
  assertKindeIdProvided,
  assertPermission,
} from "./rbac";

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token.",
    );
  }
  return identity;
}

// ─── Action validator ─────────────────────────────────────────────────────────

/**
 * Convex argument validator for `QrAssociationAction`.  Mirrors the literals
 * declared by `QR_ASSOCIATION_ACTIONS` in `qrAssociationAuditHelpers`.
 */
const qrAssociationActionValidator = v.union(
  v.literal("create"),
  v.literal("reassign"),
  v.literal("invalidate"),
);

/**
 * Convex argument validator for the invalidation reason code.  Mirrors
 * `INVALIDATION_REASON_CODES` from `qrAssociationAuditHelpers`.  Adding a
 * new reason code requires editing BOTH the helper list and this v.union.
 * Tests assert the parity.
 */
const invalidationReasonCodeValidator = v.union(
  v.literal("label_destroyed"),
  v.literal("case_decommissioned"),
  v.literal("security_breach"),
  v.literal("other"),
);

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Return every QR association event for a specific case in chronological
 * order (oldest first).  Backs the T5 case-detail "QR History" rail and the
 * compliance audit panel.
 *
 * Performance: backed by the `by_case_timestamp` compound index — O(log n + k).
 *
 * Real-time fidelity: any insert into `qr_association_events` for the case
 * triggers reactive re-evaluation, pushing updated history to subscribed
 * clients within ~100–300 ms.
 */
export const getQrAssociationEventsByCase = query({
  args: {
    caseId: v.id("cases"),
    /**
     * Optional inclusive lower bound on `timestamp`.  When provided, only
     * events with `timestamp >= since` are returned (e.g. last 30 days).
     */
    since: v.optional(v.number()),
    /**
     * Maximum rows to return.  Defaults to 200 (the same rail size used by
     * the T5 audit timeline).  Convex caps queries at 4096 documents.
     */
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const limit = args.limit ?? 200;

    let q = ctx.db
      .query("qr_association_events")
      .withIndex("by_case_timestamp", (idx) =>
        args.since !== undefined
          ? idx.eq("caseId", args.caseId).gte("timestamp", args.since)
          : idx.eq("caseId", args.caseId),
      );

    const rows = await q.order("asc").take(limit);
    return rows;
  },
});

/**
 * Return the full lifecycle of a single QR payload across every case it has
 * ever been associated with — useful for compliance queries like "show every
 * movement of QR X" and for surfacing fraudulent label re-use.
 *
 * Performance: backed by the `by_qr_code` index — O(log n + k).
 */
export const getQrAssociationEventsByQrCode = query({
  args: {
    qrCode: v.string(),
    limit:  v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const limit = args.limit ?? 200;
    const trimmed = args.qrCode.trim();
    if (trimmed.length === 0) return [];
    return await ctx.db
      .query("qr_association_events")
      .withIndex("by_qr_code", (idx) => idx.eq("qrCode", trimmed))
      .order("desc")
      .take(limit);
  },
});

/**
 * Return every QR association action initiated by a specific user.  Backs
 * per-technician audit reports ("show every reassign Alice issued this
 * month") and rate-limit checks.
 *
 * Performance: backed by the `by_actor` index — O(log n + k).
 */
export const getQrAssociationEventsByActor = query({
  args: {
    actorId: v.string(),
    limit:   v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const limit = args.limit ?? 200;
    return await ctx.db
      .query("qr_association_events")
      .withIndex("by_actor", (idx) => idx.eq("actorId", args.actorId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Fetch BOTH halves of a paired reassignment in a single index lookup.  The
 * audit panel uses this to render a "QR moved from CASE-A to CASE-B" diff
 * with both events visible side-by-side.
 *
 * Performance: backed by the `by_correlation` index — O(log n + k).  Returns
 * 0 rows when the correlationId is unknown, 1 row when the correlationId
 * matches a non-paired event (defence-in-depth), or 2 rows for a normal
 * paired reassignment.
 */
export const getQrAssociationEventsByCorrelation = query({
  args: { correlationId: v.string() },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const trimmed = args.correlationId.trim();
    if (trimmed.length === 0) return [];
    return await ctx.db
      .query("qr_association_events")
      .withIndex("by_correlation", (idx) => idx.eq("correlationId", trimmed))
      .collect();
  },
});

/**
 * Fleet-wide chronological audit feed with optional action filter.  Backs
 * the dashboard "Recent QR Activity" rail and operations monitoring (e.g.
 * "spike in invalidations in the last hour").
 *
 * Performance:
 *   • Without `action` — backed by `by_timestamp` (O(log n + k)).
 *   • With `action`    — backed by `by_action_timestamp` (O(log n + k)).
 */
export const listRecentQrAssociationEvents = query({
  args: {
    action: v.optional(qrAssociationActionValidator),
    /**
     * Optional inclusive lower bound on `timestamp`.  When provided, only
     * events with `timestamp >= since` are returned.
     */
    since:  v.optional(v.number()),
    limit:  v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const limit = args.limit ?? 100;

    if (args.action !== undefined) {
      // Defence-in-depth: validate even though Convex's union does the work.
      if (!isValidQrAssociationAction(args.action)) {
        throw new Error(
          `[INVALID_ACTION] Unknown QR action "${args.action}".`,
        );
      }
      const action = args.action as QrAssociationAction;
      return await ctx.db
        .query("qr_association_events")
        .withIndex("by_action_timestamp", (idx) =>
          args.since !== undefined
            ? idx.eq("action", action).gte("timestamp", args.since)
            : idx.eq("action", action),
        )
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("qr_association_events")
      .withIndex("by_timestamp", (idx) =>
        args.since !== undefined ? idx.gte("timestamp", args.since) : idx,
      )
      .order("desc")
      .take(limit);
  },
});

// ─── invalidateQrCode mutation ───────────────────────────────────────────────

/**
 * Result returned by `invalidateQrCode`.
 *
 * Surfaces the full before-and-after view so the SCAN app and dashboard
 * can render confirmation toasts naming the QR being invalidated and the
 * audit row that was created.
 */
export interface InvalidateQrCodeResult {
  caseId:               string;
  caseLabel:            string;
  /** The QR payload that was invalidated.  Empty after the operation. */
  invalidatedQrCode:    string;
  invalidatedQrCodeSource: "generated" | "external" | null;
  reasonCode:           string;
  reasonNotes:          string | null;
  /** Convex ID of the audit row inserted into `qr_association_events`. */
  auditEventId:         string;
  /** Epoch ms timestamp shared by the case patch and the audit row. */
  timestamp:            number;
}

/**
 * Clear a QR payload from a case with an audited reason — the third QR
 * association action covered by sub-AC 3 (alongside create and reassign).
 *
 * Why a dedicated mutation?
 * ─────────────────────────
 * The reassignment flow (`reassignQrCodeToCase`) covers the case where a
 * QR is moving from one case to another, but it does NOT cover the case
 * where an operator simply needs to remove a QR from a case without a
 * destination — for example:
 *
 *   • The physical label is destroyed and the case will be relabeled later.
 *   • The case is being decommissioned and the QR should be retired.
 *   • A security incident requires the label to be invalidated immediately
 *     (e.g., the case was stolen and the QR is in unknown hands).
 *
 * Behaviour
 * ─────────
 *   1. Permission check — caller must hold `QR_CODE_INVALIDATE` (admin or
 *      technician).  Pilots cannot invalidate labels.
 *   2. Reason validation — must be one of `INVALIDATION_REASON_CODES`.
 *      `reasonNotes` is mandatory when `reasonCode === "other"`.
 *   3. Read the case; reject if it does not have a QR currently associated
 *      (no-op invalidations are rejected so callers get a clear error).
 *   4. Atomic patch:
 *        cases.qrCode       → ""        (schema sentinel for "no QR")
 *        cases.qrCodeSource → undefined
 *        cases.updatedAt    → now
 *   5. Append an audit row to `qr_association_events` (action: "invalidate",
 *      previousQrCode = the payload that was just removed).
 *   6. Append a parallel "qr_code_invalidated" event to the generic `events`
 *      table so the T5 timeline continues to surface the action alongside
 *      other case events.
 *
 * Real-time fidelity
 * ──────────────────
 * Patching `cases.qrCode` triggers reactive re-evaluation of every Convex
 * query subscribed to the affected case row within ~100–300 ms, satisfying
 * the ≤ 2-second real-time fidelity requirement.
 */
export const invalidateQrCode = mutation({
  args: {
    /** Convex document ID of the case whose QR is being invalidated. */
    caseId:      v.id("cases"),
    /** One of `INVALIDATION_REASON_CODES`. */
    reasonCode:  invalidationReasonCodeValidator,
    /** Free-text justification.  REQUIRED when `reasonCode === "other"`. */
    reasonNotes: v.optional(v.string()),
    /** Kinde user ID of the operator (used for permission + audit). */
    userId:      v.string(),
    /** Display name of the operator (audit attribution). */
    userName:    v.string(),
  },

  handler: async (ctx, args): Promise<InvalidateQrCodeResult> => {
    // ── 1. Authentication + authorization ───────────────────────────────────
    await requireAuth(ctx);
    assertKindeIdProvided(args.userId);
    await assertPermission(ctx.db, args.userId, OPERATIONS.QR_CODE_INVALIDATE);

    if (!args.userName || args.userName.trim().length === 0) {
      throw new Error("[INVALID_USERNAME] userName must be a non-empty display name.");
    }

    // ── 2. Verify the target case exists ────────────────────────────────────
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `[INVALID_TARGET] invalidateQrCode: Case "${args.caseId}" not found.`,
      );
    }

    // ── 3. Reject when no QR is currently associated ────────────────────────
    const previousQrCode = caseDoc.qrCode?.trim() ?? "";
    if (previousQrCode.length === 0) {
      throw new Error(
        `[QR_NOT_ASSIGNED] invalidateQrCode: Case "${caseDoc.label}" has no ` +
        `QR code to invalidate.`,
      );
    }
    const previousQrCodeSource: "generated" | "external" | null =
      (caseDoc.qrCodeSource as "generated" | "external" | undefined) ?? null;

    // ── 4. Build the audit record (validates reason code + notes) ────────────
    const timestamp = Date.now();
    const auditRecord = buildInvalidateAuditRecord({
      caseId:               String(args.caseId),
      previousQrCode,
      previousQrCodeSource,
      reasonCode:           args.reasonCode,
      reasonNotes:          args.reasonNotes,
      actorId:              args.userId,
      actorName:            args.userName,
      timestamp,
    });

    // ── 5. Atomic case patch — clear the QR ─────────────────────────────────
    await ctx.db.patch(args.caseId, {
      qrCode:       "",
      qrCodeSource: undefined,
      updatedAt:    timestamp,
    });

    // ── 6. Insert the dedicated audit row ───────────────────────────────────
    // Convex Id values serialise to strings, so the cast back to Id<"cases">
    // at the boundary is type-only (no runtime conversion).
    const auditEventId = await ctx.db.insert(
      "qr_association_events",
      toQrAssociationEventInsert(auditRecord, args.caseId),
    );

    // ── 7. Mirror the action onto the generic events timeline ───────────────
    // The T5 case-detail timeline reads from `events`; appending here keeps
    // the user-facing timeline complete without needing to dual-source.
    await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "note_added",
      userId:    args.userId,
      userName:  args.userName,
      timestamp,
      data: {
        action:               "qr_code_invalidated",
        previousQrCode,
        previousQrCodeSource,
        reasonCode:           args.reasonCode,
        reasonLabel:          auditRecord.reasonLabel,
        reasonNotes:          auditRecord.reasonNotes ?? null,
        caseLabel:            caseDoc.label,
        qrAssociationEventId: String(auditEventId),
      },
    });

    return {
      caseId:                  String(args.caseId),
      caseLabel:               caseDoc.label,
      invalidatedQrCode:       previousQrCode,
      invalidatedQrCodeSource: previousQrCodeSource,
      reasonCode:              args.reasonCode,
      reasonNotes:             auditRecord.reasonNotes ?? null,
      auditEventId:            String(auditEventId),
      timestamp,
    };
  },
});

// ─── Re-exports for client integrations ──────────────────────────────────────

/**
 * Re-export the invalidation reason constants so client-side dropdowns
 * can import them directly from the same module that hosts the mutation:
 *
 *   import {
 *     INVALIDATION_REASON_CODES,
 *     INVALIDATION_REASON_LABELS,
 *     type InvalidationReasonCode,
 *   } from "convex/qrAssociationEvents";
 */
export {
  INVALIDATION_REASON_CODES,
  INVALIDATION_REASON_LABELS,
  type InvalidationReasonCode,
} from "./qrAssociationAuditHelpers";
