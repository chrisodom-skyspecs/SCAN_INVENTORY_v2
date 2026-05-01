/**
 * convex/custodyHandoffs.ts
 *
 * Convex mutation for the SCAN app custody handoff action.
 *
 * This file is the canonical home for the `handoffCustody` mutation — the
 * primary write operation triggered when a field technician or pilot transfers
 * physical custody of a case to another person using the SCAN mobile app.
 *
 * The mutation records a complete chain-of-custody entry and writes to three
 * tables in a single atomic operation:
 *
 *   1. custodyRecords (INSERT)
 *      ─────────────────────
 *      Primary write. Creates a new chain-of-custody record containing all
 *      handoff fields: caseId, fromUserId, fromUserName, toUserId, toUserName,
 *      transferredAt, notes, signatureStorageId.
 *
 *      Reactive queries invalidated (Convex re-runs these within ~100–300 ms):
 *        • getCustodyRecordsByCase(caseId)        → by_case index
 *        • getLatestCustodyRecord(caseId)          → by_case index
 *        • getCustodyChain(caseId)                 → by_case index
 *        • getCustodyRecordsByCustodian(toUserId)  → by_to_user index
 *        • getCustodyRecordsByTransferrer(fromUserId) → by_from_user index
 *        • getCustodyRecordsByParticipant(userId)  → by_to_user + by_from_user
 *        • getCustodianIdentitySummary(userId)     → by_to_user + by_from_user
 *        • listAllCustodyTransfers                  → full table scan
 *        • getCustodyTransferSummary               → full table scan
 *
 *   2. cases (PATCH)
 *      ─────────────
 *      Updates the case's custodian identity fields so all dashboard map modes
 *      and layout queries reflect the ownership change in real time:
 *
 *        • assigneeId   → M2 (Assignment Mode) filter; M1/M3 assigneeId filter
 *        • assigneeName → M2 pin tooltip; T2 "Currently held by" field
 *        • updatedAt    → M1 by_updated sort index ("N min ago" freshness)
 *        • lat / lng    → optional: all modes' withinBounds() check (when provided)
 *        • locationName → optional: map pin location label (when provided)
 *
 *      Reactive queries invalidated (all queries reading the cases table):
 *        • getCaseById / listCases / getCasesInBounds   → M1–M5 map pins
 *        • getCaseStatusCounts                           → status summary counts
 *        • getM2MissionMode                             → M2 assignment map
 *        • getCaseAssignmentLayout                      → T2 layout query
 *
 *   3. events (INSERT)
 *      ────────────────
 *      Appends an immutable "custody_handoff" audit event with the full handoff
 *      payload.  The events table is append-only — rows are never updated or
 *      deleted — ensuring an unbroken audit trail for the T5 panel.
 *
 *      Reactive queries invalidated:
 *        • getCaseAuditEvents(caseId)           → by_case index on events
 *        • getCaseAssignmentLayout              → reads events table
 *
 *   4. notifications (INSERT)
 *      ────────────────────────
 *      Creates an in-app notification alerting the incoming custodian (toUserId)
 *      that they have received a case.  Per project constraints, notifications
 *      are in-app only — no push notifications or email.
 *
 *      Reactive queries invalidated:
 *        • getNotificationsForUser(toUserId)    → by_user index on notifications
 *        • getUnreadCount(toUserId)             → by_user_read compound index
 *
 * Real-time fidelity guarantee
 * ────────────────────────────
 * Convex re-evaluates all subscribed queries that read the written tables and
 * pushes diffs to connected clients within ~100–300 ms.  This satisfies the
 * ≤ 2-second real-time fidelity requirement between the SCAN app handoff action
 * and the INVENTORY dashboard visibility (M2 assignment map, T2 panel, T5 audit).
 *
 * Authentication
 * ──────────────
 * The mutation asserts a valid Kinde JWT before processing.  Unauthenticated
 * requests receive an [AUTH_REQUIRED] error.
 *
 * Client usage (use-scan-mutations.ts / useHandoffCustody hook):
 *   const handoff = useMutation(api.custodyHandoffs.handoffCustody);
 *
 *   const result = await handoff({
 *     caseId:       resolvedCase._id,
 *     fromUserId:   currentUser.id,
 *     fromUserName: currentUser.fullName,
 *     toUserId:     recipientUser.id,
 *     toUserName:   recipientUser.fullName,
 *     handoffAt:    Date.now(),
 *     lat:          position.coords.latitude,
 *     lng:          position.coords.longitude,
 *     locationName: "Site Alpha — Turbine Row 3",
 *     notes:        "All items verified, case intact",
 *   });
 *   // result.custodyRecordId → new custodyRecords row ID
 *   // result.eventId         → new events row ID (custody_handoff)
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Auth, UserIdentity } from "convex/server";

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Asserts that the calling client has a verified Kinde JWT.
 * Throws [AUTH_REQUIRED] for unauthenticated requests.
 * Returns UserIdentity so callers can access the subject claim (kindeId).
 */
async function requireAuth(ctx: { auth: Auth }): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error(
      "[AUTH_REQUIRED] Unauthenticated. Provide a valid Kinde access token. " +
        "Ensure the client is wrapped in ConvexProviderWithAuth and the user is signed in."
    );
  }
  return identity;
}

// ─── Result type ──────────────────────────────────────────────────────────────

/**
 * Return value of the handoffCustody mutation.
 *
 * Exported so client-side hooks (use-scan-mutations.ts) can surface a typed
 * result to SCAN app components — e.g., to show the new custody record ID on
 * the post-handoff confirmation screen.
 */
export interface HandoffCustodyResult {
  /**
   * Convex document ID of the newly created custodyRecords row.
   * Used by the SCAN app post-handoff confirmation screen and the T5 panel.
   */
  custodyRecordId: string;

  /**
   * Convex document ID of the case that was transferred.
   * Stable identifier for follow-up operations (e.g., navigate to case detail).
   */
  caseId: string;

  /**
   * Kinde user ID of the outgoing custody holder.
   * Written to custodyRecords.fromUserId and the audit event payload.
   */
  fromUserId: string;

  /**
   * Kinde user ID of the incoming custody holder.
   * Written to custodyRecords.toUserId AND cases.assigneeId.
   */
  toUserId: string;

  /**
   * Epoch ms when the handoff was recorded.
   * Written as custodyRecords.transferredAt and events.timestamp.
   */
  handoffAt: number;

  /**
   * Convex document ID of the "custody_handoff" event appended to the
   * immutable audit events table.  Used by T5 to render the audit milestone.
   */
  eventId: string;
}

// ─── handoffCustody — mutation ────────────────────────────────────────────────

/**
 * Record a custody handoff between two Kinde users for a specific case.
 *
 * This is the primary mutation triggered by the SCAN mobile app custody
 * transfer workflow.  After both parties confirm the handoff on the SCAN app,
 * this mutation is called to make the transfer permanent across four tables.
 *
 * Chain-of-custody fields written
 * ────────────────────────────────
 *   custodyRecords row:
 *     caseId             — the case being transferred
 *     fromUserId         — Kinde ID of the outgoing holder
 *     fromUserName       — display name of the outgoing holder
 *     toUserId           — Kinde ID of the incoming holder
 *     toUserName         — display name of the incoming holder
 *     transferredAt      — epoch ms of the handoff (= handoffAt arg)
 *     notes              — optional technician free-text
 *     signatureStorageId — optional Convex storage ID for signature image
 *
 *   cases patch (ownership state update):
 *     assigneeId         — set to toUserId    (M2 map filter)
 *     assigneeName       — set to toUserName  (M2 pin tooltip, T2 display)
 *     updatedAt          — set to handoffAt   (M1 by_updated sort index)
 *     lat                — set when provided  (all modes withinBounds())
 *     lng                — set when provided  (all modes withinBounds())
 *     locationName       — set when provided  (map pin location label)
 *
 *   events row (immutable audit):
 *     eventType          — "custody_handoff"
 *     caseId / userId / userName / timestamp
 *     data               — full handoff payload mirror for T5 reconstruction
 *
 *   notifications row (in-app only):
 *     userId             — toUserId (incoming custodian receives the alert)
 *     type               — "custody_handoff"
 *     title / message    — human-readable handoff summary
 *
 * Reactive query invalidation
 * ───────────────────────────
 * The four writes above collectively invalidate the following subscriptions
 * within ~100–300 ms, satisfying the ≤ 2-second real-time fidelity requirement:
 *
 *   From custodyRecords INSERT:
 *     getCustodyRecordsByCase, getLatestCustodyRecord, getCustodyChain,
 *     getCustodyRecordsByCustodian, getCustodyRecordsByTransferrer,
 *     getCustodyRecordsByParticipant, getCustodianIdentitySummary,
 *     listAllCustodyTransfers, getCustodyTransferSummary
 *
 *   From cases PATCH (assigneeId / assigneeName / updatedAt):
 *     getCaseById, listCases, getCasesInBounds, getCaseStatusCounts,
 *     getM2MissionMode, getCaseAssignmentLayout
 *     → INVENTORY dashboard M1–M5 map pins and T2/T5 panels all update live
 *
 *   From events INSERT:
 *     getCaseAuditEvents (T5 panel audit timeline), getCaseAssignmentLayout
 *
 *   From notifications INSERT:
 *     getNotificationsForUser, getUnreadCount
 *
 * M2 assignment map update mechanism
 * ─────────────────────────────────────
 * The M2 assembler reads cases.assigneeName for map pin tooltips and groups
 * cases by assignment.  Patching cases.assigneeId and cases.assigneeName
 * invalidates getM2MissionMode, causing the M2 map to reflect the ownership
 * change within the Convex reactive window — no polling required.
 *
 * @param caseId              Convex ID of the case being transferred.
 * @param fromUserId          Kinde user ID of the outgoing custody holder.
 * @param fromUserName        Display name of the outgoing holder.
 * @param toUserId            Kinde user ID of the incoming custody holder.
 * @param toUserName          Display name of the incoming holder.
 * @param handoffAt           Epoch ms when the handoff occurred.
 * @param lat                 Optional GPS latitude of the handoff location.
 * @param lng                 Optional GPS longitude of the handoff location.
 * @param locationName        Optional human-readable location label.
 * @param notes               Optional free-text notes from the technician.
 * @param signatureStorageId  Optional Convex storage ID for a signature image.
 *
 * @returns HandoffCustodyResult { custodyRecordId, caseId, fromUserId, toUserId,
 *                                  handoffAt, eventId }
 *
 * @throws When the case is not found: "Case <id> not found."
 * @throws When unauthenticated: "[AUTH_REQUIRED] ..."
 *
 * Client usage (via useHandoffCustody hook in use-scan-mutations.ts):
 *   const handoff = useHandoffCustody();
 *
 *   try {
 *     const result = await handoff({
 *       caseId:            resolvedCase._id,
 *       fromUserId:        currentUser.id,
 *       fromUserName:      currentUser.fullName,
 *       toUserId:          recipientUser.id,
 *       toUserName:        recipientUser.fullName,
 *       handoffAt:         Date.now(),
 *       lat:               position.coords.latitude,
 *       lng:               position.coords.longitude,
 *       locationName:      "Site Alpha — Turbine Row 3",
 *       notes:             "All items verified, case intact",
 *       signatureStorageId: storageId,  // from SCAN app signature pad upload
 *     });
 *     // result.custodyRecordId  → new custodyRecords document ID
 *     // result.eventId          → new events document ID (custody_handoff)
 *   } catch (err) {
 *     // "Case X not found." — invalid or deleted caseId
 *     // "[AUTH_REQUIRED]"  — unauthenticated request
 *   }
 */
export const handoffCustody = mutation({
  args: {
    /**
     * Convex ID of the case being transferred between users.
     *
     * The mutation verifies the case exists before writing any rows.
     * The case's assigneeId and assigneeName are updated to the new custodian
     * so M2 (Assignment Map Mode) map pins reflect the change immediately.
     */
    caseId: v.id("cases"),

    /**
     * Kinde user ID of the person relinquishing custody.
     *
     * Written to:
     *   • custodyRecords.fromUserId   — chain-of-custody "sender" field
     *   • events.userId               — audit event initiator
     *   • events.data.fromUserId      — audit payload mirror
     */
    fromUserId: v.string(),

    /**
     * Display name of the outgoing custody holder.
     *
     * Written to:
     *   • custodyRecords.fromUserName — for dashboard UI display
     *   • events.userName             — audit event attribution
     *   • events.data.fromUserName    — audit payload mirror
     */
    fromUserName: v.string(),

    /**
     * Kinde user ID of the person receiving custody.
     *
     * Written to:
     *   • custodyRecords.toUserId     — chain-of-custody "receiver" field
     *   • cases.assigneeId            — triggers M2 assignment map re-evaluation;
     *                                   M1/M3 assigneeId filter re-evaluation
     *   • events.data.toUserId        — audit payload mirror
     */
    toUserId: v.string(),

    /**
     * Display name of the incoming custody holder.
     *
     * Written to:
     *   • custodyRecords.toUserName   — for dashboard UI display
     *   • cases.assigneeName          — M2 pin tooltips; T2 "Currently held by"
     *   • events.data.toUserName      — audit payload mirror
     */
    toUserName: v.string(),

    /**
     * Epoch ms timestamp of the handoff (provided by the SCAN app at confirmation).
     *
     * Written to:
     *   • custodyRecords.transferredAt — indexed for audit chain ordering
     *   • events.timestamp             — immutable audit trail timestamp
     *   • cases.updatedAt              — M1 by_updated sort index freshness
     */
    handoffAt: v.number(),

    /**
     * Optional GPS latitude of the handoff location.
     *
     * Written to cases.lat when provided — used by all map modes' withinBounds()
     * check.  Only written when provided; preserves the last known position
     * otherwise.  Not written to custodyRecords (location is a case-level field).
     */
    lat: v.optional(v.number()),

    /**
     * Optional GPS longitude of the handoff location.
     *
     * Written to cases.lng when provided.
     */
    lng: v.optional(v.number()),

    /**
     * Optional human-readable location label (e.g., "Site Alpha Gate 3").
     *
     * Written to cases.locationName when provided — used for map pin tooltips
     * and the T2 panel location chip.
     */
    locationName: v.optional(v.string()),

    /**
     * Optional free-text notes entered by the field technician at handoff time.
     *
     * Written to:
     *   • custodyRecords.notes — displayed in T2 and T5 custody history panels
     *   • notifications.message (appended) — shown in the recipient's inbox
     */
    notes: v.optional(v.string()),

    /**
     * Optional Convex file storage ID for a signature captured in the SCAN app
     * signing pad workflow.
     *
     * Written to custodyRecords.signatureStorageId.
     * Resolve to a download URL client-side via the Convex useStorageURL hook or
     * server-side via ctx.storage.getUrl(signatureStorageId).
     */
    signatureStorageId: v.optional(v.string()),
    clientId: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<HandoffCustodyResult> => {
    // Reject unauthenticated requests before performing any reads or writes.
    await requireAuth(ctx);

    const now = args.handoffAt;

    if (args.clientId) {
      const existing = await ctx.db
        .query("custodyRecords")
        .withIndex("by_client_id", (q) => q.eq("clientId", args.clientId))
        .first();
      if (existing) {
        const existingEvent = await ctx.db
          .query("events")
          .withIndex("by_client_id", (q) => q.eq("clientId", args.clientId))
          .first();
        return {
          custodyRecordId: existing._id.toString(),
          caseId: existing.caseId,
          fromUserId: existing.fromUserId,
          toUserId: existing.toUserId,
          handoffAt: existing.transferredAt,
          eventId: existingEvent?._id.toString() ?? "",
        };
      }
    }

    // ── Input guard: self-handoff ─────────────────────────────────────────────
    //
    // A technician transferring a case to themselves is almost always a
    // programming error.  Guard against it to prevent custody chain confusion
    // and circular loops in the chain-of-custody graph.
    if (args.fromUserId === args.toUserId) {
      throw new Error(
        `[SELF_HANDOFF] handoffCustody: fromUserId and toUserId are both ` +
        `"${args.fromUserId}". A custody handoff requires two different users. ` +
        `If you intend to record an assignment without a physical handoff, ` +
        `use the cases.assigneeId field directly.`
      );
    }

    // ── Step 1: Verify the case exists ────────────────────────────────────────
    //
    // Performing this lookup before any writes ensures we fail fast without
    // leaving partial data (e.g., a custodyRecords row for a missing case).
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `[CASE_NOT_FOUND] Case ${args.caseId} not found. ` +
          `Verify the caseId originates from a valid QR code scan or case lookup.`
      );
    }

    // ── Step 2: INSERT custody record ─────────────────────────────────────────
    //
    // This is the primary chain-of-custody write.  The new row contains all
    // fields that define a single custody handoff:
    //   caseId        — which physical case was transferred
    //   fromUserId    — outgoing holder's Kinde ID (chain link "from")
    //   fromUserName  — outgoing holder's display name (for UI display)
    //   toUserId      — incoming holder's Kinde ID (chain link "to")
    //   toUserName    — incoming holder's display name (for UI display)
    //   transferredAt — epoch ms timestamp of the handoff (indexed for ordering)
    //   notes         — optional technician notes
    //   signatureStorageId — optional signature image storage ID
    //
    // Inserting this row invalidates every subscribed query on the custodyRecords
    // table — including all getCustodyRecordsByCase, getLatestCustodyRecord,
    // getCustodyChain, getCustodyRecordsByCustodian (by_to_user),
    // getCustodyRecordsByTransferrer (by_from_user), getCustodianIdentitySummary,
    // listAllCustodyTransfers, and getCustodyTransferSummary.
    //
    // Convex pushes the updated query results to all connected INVENTORY dashboard
    // sessions within ~100–300 ms, satisfying the ≤ 2-second real-time fidelity
    // requirement between the SCAN app handoff and dashboard visibility.
    const custodyRecordId = await ctx.db.insert("custodyRecords", {
      caseId:             args.caseId,
      fromUserId:         args.fromUserId,
      fromUserName:       args.fromUserName,
      toUserId:           args.toUserId,
      toUserName:         args.toUserName,
      transferredAt:      now,
      notes:              args.notes,
      signatureStorageId: args.signatureStorageId,
      clientId:           args.clientId,
    });

    await ctx.db.insert("custody_handoffs", {
      caseId: args.caseId,
      fromUserId: args.fromUserId,
      toUserId: args.toUserId,
      timestamp: now,
      signature: args.signatureStorageId,
      location:
        args.lat !== undefined || args.lng !== undefined || args.locationName !== undefined
          ? {
              lat: args.lat,
              lng: args.lng,
              name: args.locationName,
            }
          : undefined,
      clientId: args.clientId,
    });

    // ── Step 3: PATCH case with new custodian (case ownership state update) ───
    //
    // Writing assigneeId / assigneeName is the mechanism that triggers M2
    // (Assignment Map Mode) and M1/M3 assigneeId filter re-evaluation:
    //
    //   cases.assigneeId   — M2 assembleM2 groups pins by assignee;
    //                        M1/M3 "show my cases" filter uses assigneeId
    //   cases.assigneeName — M2 mission group case list; M1/M3 pin tooltips;
    //                        T2 "Currently held by: [name]" chip
    //   cases.updatedAt    — M1 by_updated sort index; "N min ago" freshness UX
    //
    // Location fields are written only when the SCAN app provided a GPS fix —
    // preserving the last known position for cases scanned offline or in areas
    // with no GPS signal.
    //
    // This PATCH invalidates all queries that read the cases table:
    //   getCaseById, listCases, getCasesInBounds, getCaseStatusCounts,
    //   getM2MissionMode, getCaseAssignmentLayout
    const casePatch: Record<string, unknown> = {
      assigneeId:   args.toUserId,
      assigneeName: args.toUserName,
      updatedAt:    now,
    };

    // Conditionally update location fields — only overwrite when provided.
    if (args.lat          !== undefined) casePatch.lat          = args.lat;
    if (args.lng          !== undefined) casePatch.lng          = args.lng;
    if (args.locationName !== undefined) casePatch.locationName = args.locationName;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(args.caseId, casePatch as any);

    // ── Step 4: INSERT immutable audit event ──────────────────────────────────
    //
    // The events table is append-only — custody_handoff events are never updated
    // or deleted, providing a tamper-evident record for the T5 audit panel and
    // compliance chain-of-custody reports.
    //
    // The data payload mirrors all custodyRecords fields so the T5 audit panel
    // can reconstruct the handoff details without joining custodyRecords.  This
    // is the denormalized "event sourcing" pattern used throughout the events
    // table: each event row is self-contained and human-readable independently.
    //
    // This INSERT invalidates:
    //   • getCaseAuditEvents(caseId)      — T5 audit timeline
    //   • getCaseAssignmentLayout          — T2 layout "recent events" section
    const eventId = await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "custody_handoff",
      userId:    args.fromUserId,
      userName:  args.fromUserName,
      timestamp: now,
      data: {
        // Link back to the canonical chain-of-custody record.
        custodyRecordId: custodyRecordId.toString(),

        // Full handoff payload mirrored here for T5 reconstruction.
        fromUserId:         args.fromUserId,
        fromUserName:       args.fromUserName,
        toUserId:           args.toUserId,
        toUserName:         args.toUserName,
        handoffAt:          now,

        // Location context at handoff time.
        lat:          args.lat,
        lng:          args.lng,
        locationName: args.locationName,

        // Technician notes and signature evidence.
        notes:              args.notes,
        signatureStorageId: args.signatureStorageId,
      },
      clientId: args.clientId,
    });

    // ── Step 5: INSERT in-app notification for incoming custodian ─────────────
    //
    // Per project constraints: in-app notifications only — no push, no email.
    //
    // The recipient (toUserId) sees a notification in their SCAN app / dashboard
    // notification inbox alerting them that they now have custody of this case.
    //
    // This INSERT invalidates:
    //   • getNotificationsForUser(toUserId)   — notification inbox feed
    //   • getUnreadCount(toUserId)            — unread badge count
    await ctx.db.insert("notifications", {
      userId:    args.toUserId,
      type:      "custody_handoff",
      title:     `Custody transferred: ${caseDoc.label}`,
      message:
        `${args.fromUserName} transferred custody of case "${caseDoc.label}" to you` +
        (args.locationName ? ` at ${args.locationName}` : "") +
        (args.notes ? `. Note: ${args.notes}` : "."),
      caseId:    args.caseId,
      read:      false,
      createdAt: now,
    });

    // ── Return typed result for the SCAN app confirmation screen ─────────────
    return {
      custodyRecordId: custodyRecordId.toString(),
      caseId:          args.caseId,
      fromUserId:      args.fromUserId,
      toUserId:        args.toUserId,
      handoffAt:       now,
      eventId:         eventId.toString(),
    };
  },
});
