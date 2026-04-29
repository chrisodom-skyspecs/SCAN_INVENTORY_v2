/**
 * convex/mutations/custody.ts
 *
 * Canonical mutation functions for SCAN app custody handoff write operations.
 *
 * This module provides the authoritative, atomic write operations for the SCAN
 * mobile app's custody transfer workflow — the point where a field technician,
 * pilot, or logistics coordinator physically hands a case to another person and
 * both parties confirm the transfer using the SCAN app.
 *
 * Mutations exported
 * ──────────────────
 *   generateSignatureUploadUrl  — Pre-signed Convex storage URL for capturing
 *                                 a handoff signature via the SCAN app signature pad.
 *
 *   handoffCustody              — Primary custody handoff write: atomically creates
 *                                 a custodyRecords row, updates the case's assignee
 *                                 fields, appends an immutable custody_handoff audit
 *                                 event, and creates an in-app notification for the
 *                                 incoming custodian.
 *
 * Tables written per handoffCustody call
 * ───────────────────────────────────────
 *   custodyRecords  INSERT — chain-of-custody record with fromUser/toUser/transferredAt
 *   cases           PATCH  — assigneeId, assigneeName, updatedAt (+ optional lat/lng)
 *   events          INSERT — "custody_handoff" audit event (immutable)
 *   notifications   INSERT — in-app notification for the incoming custodian
 *
 * Reactive query invalidation
 * ───────────────────────────
 * Convex re-evaluates all subscribed queries reading the written tables and
 * pushes diffs to connected clients within ~100–300 ms.  A full handoffCustody
 * write invalidates:
 *
 *   From custodyRecords INSERT:
 *     getCustodyRecordsByCase       → T5 custody chain audit panel
 *     getLatestCustodyRecord        → T2 "Currently held by" display
 *     getCustodyChain               → T5 chronological chain
 *     getCustodyRecordsByCustodian  → SCAN "My Cases" assignment view
 *     getCustodyRecordsByTransferrer → SCAN "My Activity" / transfer history
 *     getCustodyRecordsByParticipant → SCAN full user activity history
 *     getCustodianIdentitySummary   → SCAN user dashboard case count badge
 *     listAllCustodyTransfers       → dashboard fleet-wide custody overview
 *     getCustodyTransferSummary     → dashboard aggregate statistics
 *
 *   From cases PATCH (assigneeId / assigneeName / updatedAt):
 *     getCaseById, listCases, getCasesInBounds   → M1–M5 map pins update
 *     getCaseStatusCounts                         → status summary counts
 *     getCaseAssignmentLayout                     → T2 layout panel
 *     → M2 assignment map shows new custodian immediately
 *
 *   From events INSERT:
 *     getCaseAuditEvents(caseId)    → T5 audit timeline
 *     getCaseAssignmentLayout       → T2 layout "recent events" section
 *
 *   From notifications INSERT:
 *     getNotificationsForUser(toUserId)  → SCAN notification inbox
 *     getUnreadCount(toUserId)           → SCAN unread badge count
 *
 * All subscribed clients receive the live update within 2 seconds of the
 * mutation completing — satisfying the real_time_fidelity acceptance criterion.
 *
 * Chain-of-custody data model
 * ───────────────────────────
 * Each custody handoff is a directed edge in the case's ownership chain:
 *
 *   fromUserId → toUserId at transferredAt
 *
 * The chain is reconstructed by loading all custodyRecords for a case
 * (getCustodyChain) and iterating by transferredAt ascending.  The current
 * custodian is the toUserId of the most recent record.
 *
 * Cases also cache the current custodian in cases.assigneeId / assigneeName
 * for fast map pin rendering without joining custodyRecords.
 *
 * Signature capture (optional)
 * ─────────────────────────────
 * The SCAN app can optionally capture a digital signature from the incoming
 * custodian to confirm physical receipt of the case.  The signature is captured
 * as an image via the SCAN app signature pad component and uploaded to Convex
 * file storage using the URL from generateSignatureUploadUrl().  The resulting
 * storageId is passed to handoffCustody as `signatureStorageId`.
 *
 * Authentication
 * ──────────────
 * All mutations require a verified Kinde JWT.  Unauthenticated callers receive
 * [AUTH_REQUIRED].
 *
 * Client usage
 * ────────────
 * Prefer calling through typed hook wrappers in src/hooks/use-scan-mutations.ts:
 *
 *   const handoff = useMutation(api.mutations.custody.handoffCustody);
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
 *     signatureStorageId: storageId,  // from SCAN app signature pad upload
 *   });
 *   // result.custodyRecordId → new custodyRecords document ID
 *   // result.eventId         → new events document ID (custody_handoff)
 */

import { mutation } from "../_generated/server";
import type { Auth, UserIdentity } from "convex/server";
import { v } from "convex/values";

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Asserts that the calling client has a verified Kinde JWT.
 *
 * Throws with "[AUTH_REQUIRED]" prefix when:
 *   • No JWT was provided (unauthenticated request)
 *   • JWT signature failed Convex JWKS verification
 *   • JWT has expired
 *
 * Returns the UserIdentity so callers can access the subject claim (kindeId)
 * without a second getUserIdentity() call.
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

// ─── Return types ─────────────────────────────────────────────────────────────

/**
 * Return value of the `handoffCustody` mutation.
 *
 * Exported so client-side hooks (use-scan-mutations.ts) can surface a typed
 * result to SCAN app components — e.g., to show the new custody record ID on
 * the post-handoff confirmation screen and to navigate to the case detail.
 */
export interface HandoffCustodyResult {
  /**
   * Convex document ID of the newly created `custodyRecords` row.
   *
   * Used by:
   *   • SCAN app post-handoff confirmation screen (display the record ID)
   *   • T5 audit panel (link to the custody chain entry)
   *   • getCustodyRecordsByCase query (returned in the custody chain array)
   */
  custodyRecordId: string;

  /**
   * Convex document ID of the case that was transferred.
   *
   * Stable identifier for follow-up operations:
   *   • Navigate to case detail view after handoff confirmation
   *   • Subscribe to subsequent case state updates
   */
  caseId: string;

  /**
   * Kinde user ID of the outgoing custody holder.
   * Written to custodyRecords.fromUserId and the audit event payload.
   */
  fromUserId: string;

  /**
   * Kinde user ID of the incoming custody holder.
   *
   * Written to:
   *   • custodyRecords.toUserId  — chain-of-custody "receiver" field
   *   • cases.assigneeId         — triggers M2 assignment map re-evaluation
   *
   * This is also the userId of the notification recipient.
   */
  toUserId: string;

  /**
   * Epoch ms when the handoff was recorded (= args.handoffAt).
   * Written to custodyRecords.transferredAt and events.timestamp.
   */
  handoffAt: number;

  /**
   * Convex document ID of the "custody_handoff" event appended to the
   * immutable audit events table.
   *
   * Used by:
   *   • T5 audit panel — renders the "Custody Transferred" milestone
   *   • getCaseAuditEvents query — included in the case's full event list
   */
  eventId: string;
}

// ─── generateSignatureUploadUrl ───────────────────────────────────────────────

/**
 * Generate a short-lived Convex file-storage upload URL for a handoff
 * signature image from the SCAN app signature pad.
 *
 * This mutation is step 1 of the optional signature capture workflow:
 *
 *   Step 1 — URL (this mutation)
 *   ─────────────────────────────
 *   1. SCAN app calls generateSignatureUploadUrl() → receives a one-time URL.
 *   2. App renders the signature pad; incoming custodian signs digitally.
 *   3. App uploads the signature PNG to the URL via fetch POST.
 *   4. Convex storage returns `{ storageId: string }` in the response.
 *
 *   Step 2 — Handoff (handoffCustody)
 *   ────────────────────────────────────
 *   5. App calls handoffCustody({ ..., signatureStorageId: storageId }).
 *   6. The storageId is stored in custodyRecords.signatureStorageId.
 *   7. The T5 audit panel resolves it to a display URL via ctx.storage.getUrl().
 *
 * Security:
 *   Upload URLs are single-use and expire after 1 hour.  They grant write-only
 *   access — the client cannot read or list storage objects via the URL.
 *
 * @returns A short-lived pre-signed upload URL as a plain string.
 *
 * @throws "[AUTH_REQUIRED]" for unauthenticated requests.
 *
 * Client usage:
 *   const generateUrl = useMutation(api.mutations.custody.generateSignatureUploadUrl);
 *   const uploadUrl = await generateUrl();
 *
 *   const response = await fetch(uploadUrl, {
 *     method:  "POST",
 *     headers: { "Content-Type": "image/png" },
 *     body:    signatureBlob,
 *   });
 *   const { storageId } = await response.json();
 *   // storageId → pass to handoffCustody as signatureStorageId
 */
export const generateSignatureUploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    await requireAuth(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// ─── handoffCustody ───────────────────────────────────────────────────────────

/**
 * Record a custody handoff between two Kinde users for a specific case —
 * the primary SCAN app mutation for the custody transfer workflow.
 *
 * This is the canonical, atomic custody transfer operation.  A single call
 * writes to four tables in one Convex serializable transaction, ensuring that
 * the handoff is either fully committed or fully rolled back.
 *
 * What this mutation writes
 * ─────────────────────────
 * ┌──────────────────────────────────────┬─────────────────────────────────────────┐
 * │ Write                                │ Consumer / effect                       │
 * ├──────────────────────────────────────┼─────────────────────────────────────────┤
 * │ custodyRecords  INSERT               │ getCustodyRecordsByCase → T5 chain panel │
 * │   caseId                             │ getCustodyRecordsByCustodian (by_to_user)│
 * │   fromUserId / fromUserName          │ getCustodyRecordsByTransferrer           │
 * │   toUserId / toUserName              │ getCustodianIdentitySummary              │
 * │   transferredAt                      │ listAllCustodyTransfers                  │
 * │   notes                              │                                          │
 * │   signatureStorageId                 │                                          │
 * ├──────────────────────────────────────┼─────────────────────────────────────────┤
 * │ cases           PATCH                │ M1–M5 map pins, T2 "held by" display    │
 * │   assigneeId    = toUserId           │ M2 assignment map filter                │
 * │   assigneeName  = toUserName         │ M2 pin tooltips, T2 panel               │
 * │   updatedAt     = handoffAt          │ M1 by_updated sort index                │
 * │   lat / lng / locationName (opt.)    │ All modes withinBounds() check          │
 * ├──────────────────────────────────────┼─────────────────────────────────────────┤
 * │ events          INSERT               │ T5 audit timeline                       │
 * │   eventType = "custody_handoff"      │ getCaseAuditEvents                      │
 * │   data = full handoff payload        │ getCaseAssignmentLayout                 │
 * ├──────────────────────────────────────┼─────────────────────────────────────────┤
 * │ notifications   INSERT               │ SCAN notification inbox                 │
 * │   userId = toUserId                  │ getNotificationsForUser                 │
 * │   type = "custody_handoff"           │ getUnreadCount (by_user_read index)     │
 * └──────────────────────────────────────┴─────────────────────────────────────────┘
 *
 * M2 assignment map update mechanism
 * ────────────────────────────────────
 * The M2 assembler reads cases.assigneeId and cases.assigneeName for map pin
 * tooltips and assignment grouping.  Patching these fields invalidates
 * getCaseAssignmentLayout and getM2MissionMode, causing the M2 map to reflect
 * the ownership change within the Convex reactive window — no polling required.
 *
 * Notification policy
 * ────────────────────
 * Per project constraints: in-app notifications ONLY — no push notifications,
 * no email.  The incoming custodian (toUserId) receives a single in-app
 * notification with the case label, the name of the person who transferred it,
 * the transfer location (if provided), and any technician notes.
 *
 * @param caseId             Convex ID of the case being transferred.
 * @param fromUserId         Kinde user ID of the outgoing custody holder.
 * @param fromUserName       Display name of the outgoing holder.
 * @param toUserId           Kinde user ID of the incoming custody holder.
 * @param toUserName         Display name of the incoming holder.
 * @param handoffAt          Epoch ms when the handoff occurred (client clock).
 * @param lat                Optional GPS latitude of the handoff location.
 * @param lng                Optional GPS longitude of the handoff location.
 * @param locationName       Optional human-readable location label.
 * @param notes              Optional free-text notes from the technician.
 * @param signatureStorageId Optional Convex storage ID for a captured signature.
 *
 * @returns HandoffCustodyResult
 *
 * @throws "[AUTH_REQUIRED]" for unauthenticated requests.
 * @throws "[CASE_NOT_FOUND]" when caseId does not exist.
 * @throws "[SELF_HANDOFF]" when fromUserId equals toUserId.
 *
 * Client usage (via useHandoffCustody hook in use-scan-mutations.ts):
 *   const handoff = useMutation(api.mutations.custody.handoffCustody);
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
 *       signatureStorageId: storageId,  // from signature pad upload
 *     });
 *     // result.custodyRecordId → navigate to custody confirmation screen
 *     // result.eventId         → T5 audit event ID
 *   } catch (err) {
 *     // "[CASE_NOT_FOUND]" — invalid or deleted caseId
 *     // "[AUTH_REQUIRED]"  — unauthenticated request
 *   }
 */
export const handoffCustody = mutation({
  args: {
    /**
     * Convex ID of the case being transferred between users.
     *
     * The mutation verifies the case exists before writing any rows.
     * Failing fast before any writes ensures no partial data is written for
     * a missing case.
     *
     * After the write, cases.assigneeId and cases.assigneeName are updated
     * to the new custodian — this is the mechanism that triggers M2
     * (Assignment Map Mode) real-time re-evaluation.
     */
    caseId: v.id("cases"),

    /**
     * Kinde user ID of the person relinquishing custody.
     *
     * Written to:
     *   custodyRecords.fromUserId — chain-of-custody "from" link
     *   events.userId             — audit event initiator
     *   events.data.fromUserId    — audit payload mirror for T5 reconstruction
     */
    fromUserId: v.string(),

    /**
     * Display name of the outgoing custody holder.
     *
     * Written to:
     *   custodyRecords.fromUserName — displayed in T5 custody chain panel
     *   events.userName             — audit event attribution
     *   events.data.fromUserName    — audit payload mirror
     *
     * Denormalized so custody record rows are self-contained without requiring
     * a join to the users table.
     */
    fromUserName: v.string(),

    /**
     * Kinde user ID of the person receiving custody.
     *
     * Written to:
     *   custodyRecords.toUserId — chain-of-custody "to" link
     *   cases.assigneeId        — triggers M2 assignment map re-evaluation;
     *                             M1/M3 assigneeId filter re-evaluation
     *   events.data.toUserId    — audit payload mirror
     *
     * After this write, getCustodyRecordsByCustodian(toUserId) returns this
     * record in its result set — the SCAN app's "My Cases" view updates live.
     */
    toUserId: v.string(),

    /**
     * Display name of the incoming custody holder.
     *
     * Written to:
     *   custodyRecords.toUserName — displayed in T5 and T2 panels
     *   cases.assigneeName        — M2 pin tooltip; T2 "Currently held by" chip
     *   events.data.toUserName    — audit payload mirror
     */
    toUserName: v.string(),

    /**
     * Epoch ms when the handoff occurred (client-side clock).
     *
     * Written to:
     *   custodyRecords.transferredAt — primary ordering field for custody chain
     *   events.timestamp             — immutable audit trail timestamp
     *   cases.updatedAt              — M1 by_updated sort index freshness
     *
     * Client-side timestamps are used (not server-side) so the audit record
     * reflects when the physical handoff occurred, not when the network request
     * arrived (which may be delayed by poor field connectivity).
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
     * Written to cases.locationName when provided — shown in map pin tooltips
     * and the T2 panel location chip.  Also appended to the in-app notification
     * message to give the incoming custodian context about where the handoff occurred.
     */
    locationName: v.optional(v.string()),

    /**
     * Optional free-text notes entered by the field technician at handoff time.
     *
     * Written to:
     *   custodyRecords.notes  — displayed in T5 and T2 custody history panels
     *   notifications.message — appended to recipient's in-app notification
     *   events.data.notes     — audit payload mirror
     */
    notes: v.optional(v.string()),

    /**
     * Optional Convex file storage ID for a digital signature captured via
     * the SCAN app signature pad component.
     *
     * Written to custodyRecords.signatureStorageId.
     * Resolve to a display URL client-side via the Convex useStorageURL hook
     * or server-side via ctx.storage.getUrl(signatureStorageId).
     *
     * Obtain the storageId by:
     *   1. Calling generateSignatureUploadUrl() to get a signed upload URL.
     *   2. Uploading the PNG blob via fetch POST.
     *   3. Extracting storageId from the JSON response.
     */
    signatureStorageId: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<HandoffCustodyResult> => {
    // Reject unauthenticated requests before performing any reads or writes.
    await requireAuth(ctx);

    const now = args.handoffAt;

    // ── Input guard: self-handoff ─────────────────────────────────────────────
    //
    // A technician transferring a case to themselves is almost always a
    // programming error.  Guard against it to prevent custody chain confusion.
    // Self-handoffs would create a loop in the chain-of-custody graph.
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
    // leaving orphaned rows (e.g., a custodyRecords row for a missing case).
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `[CASE_NOT_FOUND] handoffCustody: Case "${args.caseId}" not found. ` +
        `Verify the caseId originates from a valid QR code scan or case lookup.`
      );
    }

    // ── Step 2: INSERT custody record ─────────────────────────────────────────
    //
    // This is the primary chain-of-custody write.  The new row contains all
    // fields that define a single custody handoff:
    //   caseId             — which physical case was transferred
    //   fromUserId         — outgoing holder's Kinde ID (chain link "from")
    //   fromUserName       — outgoing holder's display name (for UI display)
    //   toUserId           — incoming holder's Kinde ID (chain link "to")
    //   toUserName         — incoming holder's display name (for UI display)
    //   transferredAt      — epoch ms timestamp (indexed for chain ordering)
    //   notes              — optional technician notes
    //   signatureStorageId — optional signature image storage ID
    //
    // Inserting this row invalidates every subscribed query on custodyRecords:
    //   getCustodyRecordsByCase, getLatestCustodyRecord, getCustodyChain,
    //   getCustodyRecordsByCustodian (by_to_user), getCustodyRecordsByTransferrer
    //   (by_from_user), getCustodyRecordsByParticipant, getCustodianIdentitySummary,
    //   listAllCustodyTransfers, getCustodyTransferSummary.
    const custodyRecordId = await ctx.db.insert("custodyRecords", {
      caseId:             args.caseId,
      fromUserId:         args.fromUserId,
      fromUserName:       args.fromUserName,
      toUserId:           args.toUserId,
      toUserName:         args.toUserName,
      transferredAt:      now,
      notes:              args.notes,
      signatureStorageId: args.signatureStorageId,
    });

    // ── Step 3: PATCH case with new custodian (case ownership state update) ───
    //
    // Writing assigneeId / assigneeName is the mechanism that triggers M2
    // (Assignment Map Mode) and M1/M3 assigneeId filter re-evaluation:
    //
    //   cases.assigneeId   — M2 assembleM2 groups pins by assignee;
    //                        M1/M3 "show my cases" filter uses assigneeId
    //   cases.assigneeName — M2 pin tooltips; T2 "Currently held by: [name]" chip
    //   cases.updatedAt    — M1 by_updated sort index; "N min ago" freshness UX
    //
    // Location fields are conditionally written — only when the SCAN app provided
    // a GPS fix.  This preserves the last known position when the handoff scan
    // occurs in areas with no GPS signal.
    //
    // This PATCH invalidates all queries that read the cases table:
    //   getCaseById, listCases, getCasesInBounds, getCaseStatusCounts,
    //   getM2MissionMode (M2 assignment map), getCaseAssignmentLayout (T2 panel).
    const casePatch: Record<string, unknown> = {
      assigneeId:   args.toUserId,
      assigneeName: args.toUserName,
      updatedAt:    now,
    };

    // Only write location fields when the SCAN app provided a GPS fix.
    if (args.lat          !== undefined) casePatch.lat          = args.lat;
    if (args.lng          !== undefined) casePatch.lng          = args.lng;
    if (args.locationName !== undefined) casePatch.locationName = args.locationName;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(args.caseId, casePatch as any);

    // ── Step 4: INSERT immutable custody_handoff audit event ──────────────────
    //
    // The events table is append-only — custody_handoff events are NEVER updated
    // or deleted, providing a tamper-evident record for the T5 audit panel and
    // compliance chain-of-custody reports.
    //
    // The data payload mirrors all custodyRecords fields so the T5 audit panel
    // can reconstruct the handoff details without joining custodyRecords.  This
    // is the "event sourcing" pattern used throughout the events table: each event
    // row is self-contained and human-readable independently of other tables.
    //
    // This INSERT invalidates:
    //   getCaseAuditEvents(caseId)      → T5 audit timeline
    //   getCaseAssignmentLayout          → T2 layout "recent events" section
    const eventId = await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "custody_handoff",
      userId:    args.fromUserId,  // initiator = the person handing it over
      userName:  args.fromUserName,
      timestamp: now,
      data: {
        // Link back to the canonical chain-of-custody record.
        custodyRecordId: custodyRecordId.toString(),

        // Full handoff payload mirrored here for T5 panel reconstruction.
        fromUserId:   args.fromUserId,
        fromUserName: args.fromUserName,
        toUserId:     args.toUserId,
        toUserName:   args.toUserName,
        handoffAt:    now,

        // Location context at handoff time.
        lat:          args.lat,
        lng:          args.lng,
        locationName: args.locationName,

        // Evidence and notes.
        notes:              args.notes,
        signatureStorageId: args.signatureStorageId,
        hasSignature:       args.signatureStorageId !== undefined,
        source:             "scan_custody_handoff",
      },
    });

    // ── Step 5: INSERT in-app notification for incoming custodian ─────────────
    //
    // Per project constraints: in-app notifications ONLY — no push, no email.
    //
    // The recipient (toUserId) receives a notification in their SCAN app /
    // dashboard notification inbox alerting them that they now have custody
    // of this case.
    //
    // The notification message includes:
    //   • The case label (e.g. "CASE-007")
    //   • Who transferred it (fromUserName)
    //   • Where the transfer occurred (locationName, when provided)
    //   • Any technician notes (when provided)
    //
    // This INSERT invalidates:
    //   getNotificationsForUser(toUserId)  → SCAN notification inbox
    //   getUnreadCount(toUserId)           → unread badge count
    await ctx.db.insert("notifications", {
      userId:    args.toUserId,
      type:      "custody_handoff",
      title:     `Custody transferred: ${caseDoc.label}`,
      message:
        `${args.fromUserName} transferred custody of case "${caseDoc.label}" to you` +
        (args.locationName ? ` at ${args.locationName}` : "") +
        (args.notes        ? `. Note: ${args.notes}`  : "."),
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
