/**
 * convex/mutations/ship.ts
 *
 * Canonical mutation functions for SCAN app FedEx ship action write operations.
 *
 * This module provides the authoritative, atomic write operation invoked when
 * a field technician or pilot enters a FedEx tracking number on the SCAN
 * mobile app's "Ship Case" screen and confirms the shipment.  A single call
 * writes to ALL relevant tables in one Convex serializable transaction —
 * ensuring partial failures cannot leave the database in an inconsistent
 * state and that all reactive subscribers receive the live update within
 * the ≤ 2-second real-time fidelity window.
 *
 * Mutations exported
 * ──────────────────
 *   recordShipment    — Primary SCAN app FedEx ship action.  Atomically writes
 *                       the case shipping status, creates the canonical shipment
 *                       record, and appends both `status_change` and `shipped`
 *                       events to the immutable audit trail.
 *
 * Tables written per recordShipment call
 * ───────────────────────────────────────
 *   cases       PATCH  — status (transit_out|transit_in), trackingNumber,
 *                        carrier, shippedAt, destinationName, destinationLat,
 *                        destinationLng, lat/lng/locationName (optional),
 *                        updatedAt
 *   shipments   INSERT — full shipment record (caseId, trackingNumber, carrier,
 *                        status="label_created", origin/destination geometry,
 *                        shippedAt, createdAt, updatedAt)
 *   events      INSERT — "status_change" event (from previous lifecycle status
 *                        to transit_out|transit_in)
 *   events      INSERT — "shipped" event (immutable FedEx ship audit milestone
 *                        with full payload for T5 audit panel reconstruction)
 *
 * Reactive query invalidation
 * ───────────────────────────
 * Convex re-evaluates all subscribed queries reading the written tables and
 * pushes diffs to connected clients within ~100–300 ms.  A successful
 * recordShipment write invalidates:
 *
 *   From cases PATCH:
 *     getCaseById, getCaseStatus, listCases, getCasesInBounds, listForMap,
 *     getCaseStatusCounts             → M1–M5 map pins, T1–T5 detail panels
 *     getCaseShippingLayout           → T3 shipping/transit layout panel
 *     getCaseCarrierStatus            → T3/T4 carrier status badge
 *
 *   From shipments INSERT:
 *     listShipmentsByCase             → T3/T4 detail panels shipment history
 *     listActiveShipments             → M4 logistics map mode pins
 *     listShipmentsByStatus           → M4 status-filtered logistics view
 *     getShipmentByTrackingNumber     → tracking lookup screens
 *
 *   From events INSERT (status_change + shipped):
 *     getCaseAuditEvents              → T5 audit timeline
 *     getCaseShippingLayout           → T3 layout "recent events" section
 *
 * All subscribed clients receive the live update within 2 seconds of the
 * mutation completing — satisfying the real_time_fidelity acceptance principle.
 *
 * Status transition rules
 * ───────────────────────
 * A case can only be shipped when its current status permits it.  The
 * canonical lifecycle states this mutation accepts and the resulting transit
 * direction it writes to cases.status are:
 *
 *   Outbound shipments (case → field site)        → status = "transit_out"
 *     hangar      → transit_out
 *     assembled   → transit_out
 *     received    → transit_out
 *
 *   Inbound shipments (case → base / warehouse)   → status = "transit_in"
 *     deployed    → transit_in
 *     flagged     → transit_in
 *
 * Cases already in "transit_out", "transit_in", or "archived" cannot be shipped
 * again without first transitioning back to a shippable status (a deliberate
 * guard to prevent duplicate shipment records and to keep the audit chain
 * consistent with the case status timeline).
 *
 * Denormalization rationale
 * ─────────────────────────
 * Several FedEx tracking fields (trackingNumber, carrier, shippedAt,
 * destinationName, destinationLat, destinationLng) are written to BOTH the
 * `cases` row AND a fresh `shipments` row.  This denormalization is intentional:
 *
 *   1. Single-read T3 layout: getCaseShippingLayout resolves the shipping
 *      summary from a single O(1) `ctx.db.get(caseId)` call without joining
 *      the shipments table — satisfying the < 200 ms p50 endpoint contract.
 *
 *   2. M4 in-transit map: listForMap can return tracking metadata for every
 *      pin without a per-case shipments join.  Above 200 cases in transit,
 *      this avoids N+1 reads in the map endpoint hot path.
 *
 *   3. Real-time fidelity: writing to cases.* triggers Convex to re-evaluate
 *      ALL subscribed queries that read the cases table — including listCases,
 *      getCaseById, and getCaseShippingLayout — and push diffs to connected
 *      dashboard clients within ~100–300 ms.  The shipments table write
 *      independently invalidates listShipmentsByCase and the M4 logistics map.
 *
 * The canonical full shipment record (with route geometry, currentLat/Lng,
 * estimatedDelivery, and FedEx event timeline) continues to live in the
 * `shipments` table.  The cases row stores only the lightweight summary used
 * by map pin tooltips and the T3 layout header.
 *
 * Authentication
 * ──────────────
 * All mutations require a verified Kinde JWT.  Unauthenticated callers receive
 * an error message prefixed with "[AUTH_REQUIRED]".
 *
 * Error codes
 * ───────────
 *   [AUTH_REQUIRED]            Caller has no valid Kinde JWT.
 *   [CASE_NOT_FOUND]           args.caseId does not exist.
 *   [TRACKING_NUMBER_REQUIRED] args.trackingNumber empty or whitespace-only.
 *   [INVALID_SHIP_STATUS]      Case status is not in the shippable set.
 *   [QC_APPROVAL_REQUIRED]     Case is being dispatched (transit_out) but
 *                              cases.qcSignOffStatus is not "approved".
 *                              Requires an admin/operator QC sign-off first.
 *
 * Client usage
 * ────────────
 * Prefer calling through the typed hook wrappers in
 * src/hooks/use-scan-mutations.ts rather than via useMutation directly:
 *
 *   import { api } from "@/convex/_generated/api";
 *   const recordShipment = useMutation(api.mutations.ship.recordShipment);
 *
 *   const result = await recordShipment({
 *     caseId:           resolvedCase._id,
 *     trackingNumber:   "794644823741",
 *     userId:           kindeUser.id,
 *     userName:         "Jane Pilot",
 *     originName:       "Site Alpha — Turbine Row 3",
 *     originLat:        position.coords.latitude,
 *     originLng:        position.coords.longitude,
 *     destinationName:  "SkySpecs HQ — Ann Arbor",
 *     destinationLat:   42.2808,
 *     destinationLng:   -83.7430,
 *   });
 *   // result.shipmentId      → Convex shipments document ID
 *   // result.trackingNumber  → "794644823741" (trimmed)
 *   // result.previousStatus  → e.g. "deployed"
 *   // result.newStatus       → "transit_in"
 *   // result.shippedAt       → epoch ms
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

// ─── Status transition guard ──────────────────────────────────────────────────

/**
 * Statuses from which an OUTBOUND shipment can be initiated.
 * The case is travelling AWAY from base / warehouse toward a field site.
 * Transitions cases.status to "transit_out".
 */
const OUTBOUND_SHIPPABLE_STATUSES = ["hangar", "assembled", "received"] as const;

/**
 * Statuses from which an INBOUND shipment can be initiated.
 * The case is travelling BACK toward base / warehouse from a field site.
 * Transitions cases.status to "transit_in".
 */
const INBOUND_SHIPPABLE_STATUSES = ["deployed", "flagged"] as const;

/**
 * Combined set of all statuses from which a case can be shipped.
 * Used in the status transition guard to throw [INVALID_SHIP_STATUS] when
 * the SCAN app attempts to ship a case that is already in transit, archived,
 * etc.
 */
const SHIPPABLE_STATUSES = new Set<string>([
  ...OUTBOUND_SHIPPABLE_STATUSES,
  ...INBOUND_SHIPPABLE_STATUSES,
]);

// ─── Return type ──────────────────────────────────────────────────────────────

/**
 * Return value of the `recordShipment` mutation.
 *
 * Exported so client-side hooks (e.g., useRecordShipment in
 * src/hooks/use-scan-mutations.ts) and SCAN app screens can surface a typed
 * result on the post-shipment confirmation view.
 */
export interface RecordShipmentResult {
  /**
   * Convex document ID of the case that was shipped.
   *
   * Stable identifier for follow-up operations:
   *   • Navigate to the case detail / tracking screen after confirmation.
   *   • Subscribe to subsequent shipment status updates.
   */
  caseId: string;

  /**
   * Convex document ID of the newly inserted `shipments` row.
   *
   * Used by:
   *   • SCAN app post-shipment confirmation screen (display the record ID).
   *   • Background `refreshShipmentTracking` action (poll FedEx for updates).
   *   • T4 audit panel (link to the shipping milestone entry).
   */
  shipmentId: string;

  /**
   * FedEx tracking number recorded for this shipment (whitespace-trimmed).
   *
   * Returned to the client so the SCAN app can render the tracking number
   * confirmation chip without re-reading the case document.
   */
  trackingNumber: string;

  /**
   * Carrier name — always "FedEx" currently (the only supported carrier).
   *
   * Returned for symmetry with shipments.carrier so the SCAN app can use
   * the same field name when displaying the carrier badge.
   */
  carrier: string;

  /**
   * Status of the case BEFORE this mutation ran.
   *
   * Displayed in the SCAN app post-shipment confirmation message
   * ("Shipped from {previousStatus} status") and used by the T5 audit panel
   * to render the status-change milestone entry.
   */
  previousStatus: string;

  /**
   * Status written to cases.status by this mutation.
   *
   * Always either "transit_out" or "transit_in" depending on the previous
   * status and shipment direction.  Drives the SCAN app next-step UI and
   * all M1–M5 map pin status updates.
   */
  newStatus: "transit_out" | "transit_in";

  /**
   * Epoch ms when the shipment was recorded.
   *
   * Equals args.shippedAt when provided, otherwise the server clock at the
   * moment of mutation execution.  Written to:
   *   • cases.shippedAt
   *   • cases.updatedAt
   *   • shipments.shippedAt
   *   • shipments.createdAt
   *   • shipments.updatedAt
   *   • events.timestamp (both status_change and shipped events)
   */
  shippedAt: number;

  /**
   * Convex document ID of the "status_change" event appended to the immutable
   * events table (cases.status: previousStatus → newStatus).
   *
   * Used by the T5 audit panel to render the status-change milestone entry
   * for this shipment.
   */
  statusChangeEventId: string;

  /**
   * Convex document ID of the "shipped" event appended to the immutable
   * events table.  This is the primary data source for the T5 audit
   * panel's "Shipped" milestone card.
   */
  shippedEventId: string;
}

// ─── recordShipment ──────────────────────────────────────────────────────────

/**
 * Record that a case has been shipped via FedEx — the canonical SCAN app
 * ship action mutation.
 *
 * This is the authoritative, atomic ship operation.  A single call writes to
 * up to four tables (cases, shipments, events × 2) in one Convex serializable
 * transaction, ensuring:
 *
 *   1. The case status, tracking number, carrier, and destination fields are
 *      updated atomically — the M1 status pill and M4 logistics map cannot see
 *      a partial state.
 *   2. A canonical shipment record is created in the shipments table with full
 *      route geometry for the M4 map line and the T3/T4 layout panels.
 *   3. A status_change event is appended to the immutable events table for
 *      the T5 audit chain (only when the case status actually changed).
 *   4. A shipped event is appended to the immutable events table with the
 *      full ship payload — sufficient for T5 audit panel reconstruction
 *      without joining the shipments table.
 *
 * All four writes happen in one Convex serializable transaction — partial
 * failures cannot leave the database in an inconsistent state.
 *
 * Fields written and their map-mode / layout significance
 * ───────────────────────────────────────────────────────
 * ┌──────────────────────────────┬─────────────────────────────────────────────────┐
 * │ Field written                │ Dashboard query / layout effect                 │
 * ├──────────────────────────────┼─────────────────────────────────────────────────┤
 * │ cases.status                 │ M1 status pill; M4 in-transit filter             │
 * │   (transit_out|transit_in)   │ (by_status index → cases WHERE status="transit_*")│
 * │ cases.trackingNumber         │ T3 tracking badge; M4 pin tooltip                │
 * │ cases.carrier                │ T3 carrier chip ("FedEx")                        │
 * │ cases.shippedAt              │ T3 "Shipped N days ago" relative timestamp       │
 * │ cases.destinationName        │ T3 destination chip on case detail panel        │
 * │ cases.destinationLat/Lng     │ M4 destination pin position; T3 route preview   │
 * │ cases.lat / .lng (optional)  │ M1/M2/M3 last-known position; pin movement       │
 * │ cases.locationName (opt.)    │ M1/M2/M3 pin tooltip "Last seen at …"            │
 * │ cases.updatedAt              │ M1 by_updated sort index; "N min ago" freshness  │
 * │ shipments row                │ M4 logistics pin; T3/T4 panels; full geometry    │
 * │ events status_change row     │ T5 audit timeline status-change milestone        │
 * │ events shipped row           │ T5 audit timeline "Shipped" milestone card       │
 * └──────────────────────────────┴─────────────────────────────────────────────────┘
 *
 * Validation
 * ──────────
 *   • The case must exist (throws "[CASE_NOT_FOUND]" otherwise).
 *   • trackingNumber must be a non-empty string after whitespace trimming
 *     (throws "[TRACKING_NUMBER_REQUIRED]" otherwise).
 *   • The case status must be in SHIPPABLE_STATUSES (throws
 *     "[INVALID_SHIP_STATUS]" with a descriptive list of allowed statuses
 *     otherwise).
 *
 * Idempotency note
 * ────────────────
 * This mutation is NOT idempotent.  Each call inserts a fresh shipments row
 * and two fresh events rows.  The SCAN app prevents duplicate submissions by
 * disabling the "Confirm Shipment" button while the mutation is in flight and
 * by showing the post-shipment confirmation screen on success — preventing
 * a second submission for the same case from the same device.
 *
 * Concurrent submissions from two different devices for the same case will
 * produce two shipment records; the case status field reflects the last write
 * (Convex serializable transactions guarantee a deterministic ordering).
 * The T5 audit chain preserves both shipment events for full traceability.
 *
 * @param caseId          Convex document ID of the case being shipped.
 * @param trackingNumber  FedEx tracking number entered by the technician.
 *                        Whitespace-trimmed before storing.
 * @param userId          Kinde user ID of the submitting technician.
 * @param userName        Display name written to the audit events table.
 * @param carrier         Carrier name (defaults to "FedEx" when omitted).
 * @param shippedAt       Override epoch ms (defaults to server Date.now()).
 *                        Pass a client-side timestamp when the SCAN app
 *                        recorded the physical scan time independently of
 *                        the network request arrival.
 * @param originName      Human-readable ship-from location.  Also written to
 *                        cases.locationName as the last-known case position.
 * @param originLat       Ship-from latitude — used for M4 route line origin.
 *                        Also written to cases.lat as the last-known position.
 * @param originLng       Ship-from longitude — used for M4 route line origin.
 *                        Also written to cases.lng as the last-known position.
 * @param destinationName Human-readable ship-to location → cases.destinationName.
 * @param destinationLat  Ship-to latitude → cases.destinationLat (M4 dest pin).
 * @param destinationLng  Ship-to longitude → cases.destinationLng (M4 dest pin).
 * @param notes           Optional technician notes — written to the shipped
 *                        event payload (events.data.notes) for T5 display.
 *
 * @returns RecordShipmentResult
 *
 * @throws "[AUTH_REQUIRED]"            Caller has no verified Kinde JWT.
 * @throws "[CASE_NOT_FOUND]"           args.caseId does not exist.
 * @throws "[TRACKING_NUMBER_REQUIRED]" trackingNumber empty after trim.
 * @throws "[INVALID_SHIP_STATUS]"      Case status not in SHIPPABLE_STATUSES.
 * @throws "[QC_APPROVAL_REQUIRED]"     Outbound dispatch attempted but the
 *                                      case's qcSignOffStatus is not "approved".
 *                                      Submit a QC approval via INVENTORY before
 *                                      retrying.
 *
 * Client usage:
 *   const recordShipment = useMutation(api.mutations.ship.recordShipment);
 *
 *   const result = await recordShipment({
 *     caseId:           resolvedCase._id,
 *     trackingNumber:   "794644823741",
 *     userId:           kindeUser.id,
 *     userName:         "Jane Pilot",
 *     originName:       "Site Alpha",
 *     destinationName:  "SkySpecs HQ — Ann Arbor",
 *   });
 *   // result.shipmentId, result.previousStatus, result.newStatus
 */
export const recordShipment = mutation({
  args: {
    /**
     * Convex document ID of the case being shipped.
     *
     * The mutation verifies the case exists and is in a shippable status
     * before writing any rows.  Failing fast prevents partial writes for
     * a missing or non-shippable case.
     *
     * After the write, cases.status, cases.trackingNumber, cases.carrier,
     * cases.shippedAt, cases.destinationName, and cases.destinationLat/Lng
     * are updated — triggering M1–M5 map pin re-evaluation and T3 layout
     * subscription updates.
     */
    caseId: v.id("cases"),

    /**
     * FedEx tracking number entered by the SCAN app technician.
     *
     * Whitespace is stripped before storing.  Must be non-empty after the
     * trim — empty values throw [TRACKING_NUMBER_REQUIRED].
     *
     * Written verbatim to:
     *   • cases.trackingNumber       — denormalized for M4 pin tooltips and
     *                                   T3 layout panel header
     *   • shipments.trackingNumber   — by_tracking index lookup key for the
     *                                   FedEx tracking refresh action
     *   • events.data.trackingNumber — audit payload mirror for T5 panel
     */
    trackingNumber: v.string(),

    /**
     * Kinde user ID of the technician or pilot recording the shipment.
     *
     * Written to:
     *   • events.userId — audit event initiator for both the status_change
     *                     and shipped events.  Drives the T5 panel's
     *                     "Recorded by [user]" attribution.
     */
    userId: v.string(),

    /**
     * Display name of the user.
     *
     * Written to:
     *   • events.userName — audit event attribution shown in the T5 audit
     *                       timeline and getCaseAuditEvents query results.
     *
     * Denormalized so events rows are self-contained and human-readable
     * without requiring a join to the users table.
     */
    userName: v.string(),

    /**
     * Carrier name — defaults to "FedEx" when omitted.
     *
     * Written to:
     *   • cases.carrier            — T3 carrier chip on case detail panel
     *   • shipments.carrier        — full shipment record carrier field
     *   • events.data.carrier      — audit payload mirror
     *
     * Currently only "FedEx" is supported.  This argument exists for forward
     * compatibility when additional carriers are integrated.
     */
    carrier: v.optional(v.string()),

    /**
     * Override epoch ms timestamp for shippedAt.
     *
     * Defaults to server-side Date.now() when omitted.  Pass a client-side
     * timestamp when the SCAN app needs to record the physical scan time
     * independently of network latency (e.g., when offline-recorded events
     * are synced after the fact).
     *
     * Written to:
     *   • cases.shippedAt        — denormalized "shipped at" timestamp for
     *                              T3 "Shipped N days ago" relative display
     *   • cases.updatedAt        — M1 by_updated sort index freshness
     *   • shipments.shippedAt    — full shipment record ship timestamp
     *   • shipments.createdAt    — record creation timestamp
     *   • shipments.updatedAt    — record last-updated timestamp
     *   • events.timestamp       — immutable audit trail timestamp for both
     *                              the status_change and shipped events
     */
    shippedAt: v.optional(v.number()),

    /**
     * Human-readable ship-from location (e.g. "Site Alpha — Turbine Row 3").
     *
     * Written to:
     *   • cases.locationName      — last-known case position for M1/M2/M3
     *                                 map pin tooltips ("Last seen at …")
     *   • shipments.originName    — full shipment record origin label
     *   • events.data.originName  — audit payload mirror
     *
     * Only written to cases.locationName when the field is provided —
     * preserves the prior last-known location otherwise.
     */
    originName: v.optional(v.string()),

    /**
     * Ship-from latitude.
     *
     * Written to:
     *   • cases.lat               — last-known case position; preserved
     *                                 across modes' withinBounds() check
     *   • shipments.originLat     — used by M4 assembleM4 for the route
     *                                 line origin and as the initial
     *                                 currentLat before tracking refresh
     *
     * Only written to cases.lat when provided — preserves prior position.
     */
    originLat: v.optional(v.number()),

    /**
     * Ship-from longitude.
     *
     * Written to cases.lng (when provided) and shipments.originLng.
     */
    originLng: v.optional(v.number()),

    /**
     * Human-readable ship-to location (e.g. "SkySpecs HQ — Ann Arbor").
     *
     * Written to:
     *   • cases.destinationName       — T3 destination chip on detail panel
     *   • shipments.destinationName   — full shipment record destination
     *   • events.data.destinationName — audit payload mirror
     */
    destinationName: v.optional(v.string()),

    /**
     * Ship-to latitude.
     *
     * Written to:
     *   • cases.destinationLat        — denormalized for M4 destination pin
     *                                    rendering without shipments join
     *   • shipments.destinationLat    — full shipment record destination
     */
    destinationLat: v.optional(v.number()),

    /**
     * Ship-to longitude.
     *
     * Written to cases.destinationLng and shipments.destinationLng.
     */
    destinationLng: v.optional(v.number()),

    /**
     * Optional free-text notes from the technician about this shipment.
     *
     * Written to events.data.notes (the shipped event payload).  Not written
     * to cases.notes (case-level notes are reserved for the field-tech notes
     * stream from check-in scans).
     *
     * Surfaced in the T5 audit panel's "Shipped" milestone card.
     */
    notes: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<RecordShipmentResult> => {
    // ── Auth guard ────────────────────────────────────────────────────────────
    // Reject unauthenticated requests before performing any reads or writes.
    // Throws "[AUTH_REQUIRED]" if the caller has no verified Kinde JWT.
    await requireAuth(ctx);

    const now     = args.shippedAt ?? Date.now();
    const carrier = args.carrier ?? "FedEx";
    const tn      = args.trackingNumber.trim();

    // ── Step 1: Input validation ──────────────────────────────────────────────
    //
    // Reject empty / whitespace-only tracking numbers up front.  This prevents
    // creating shipment rows with no useful tracking data (which would make
    // the FedEx refresh action throw on every poll attempt).
    if (!tn) {
      throw new Error(
        `[TRACKING_NUMBER_REQUIRED] recordShipment: trackingNumber must be a ` +
          `non-empty string. Received "${args.trackingNumber}".`
      );
    }

    // ── Step 2: Verify case exists ────────────────────────────────────────────
    //
    // Fetch the case document before writing anything so that:
    //   a) We can capture the previous status for the audit event payload and
    //      to determine the correct transit direction (out vs in).
    //   b) A missing case throws immediately without partial writes.
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `[CASE_NOT_FOUND] recordShipment: Case "${args.caseId}" not found. ` +
          `Verify the QR payload resolves to a valid case before calling recordShipment.`
      );
    }

    const previousStatus = caseDoc.status;

    // ── Step 3: Status transition guard ───────────────────────────────────────
    //
    // Enforce the shippable-status state machine.  A case in transit_out,
    // transit_in, or archived cannot be shipped again — it must first
    // transition back to a shippable status.  This prevents duplicate
    // shipment records and keeps the audit chain consistent.
    if (!SHIPPABLE_STATUSES.has(previousStatus)) {
      throw new Error(
        `[INVALID_SHIP_STATUS] recordShipment: Cannot ship case "${caseDoc.label}" ` +
          `(${args.caseId}) — current status is "${previousStatus}". ` +
          `Allowed shipping statuses: ${[...SHIPPABLE_STATUSES].join(", ")}.`
      );
    }

    // Determine the transit direction based on the previous status:
    //   outbound (hangar / assembled / received → site)  → transit_out
    //   inbound  (deployed / flagged → base)             → transit_in
    const newStatus: "transit_out" | "transit_in" =
      (OUTBOUND_SHIPPABLE_STATUSES as readonly string[]).includes(previousStatus)
        ? "transit_out"
        : "transit_in";

    // ── Step 3b: Pre-dispatch QC sign-off guard ───────────────────────────────
    //
    // Enforce the QC approval gate for outbound dispatches.  A case may only be
    // dispatched (transition to "transit_out") when its QC sign-off status is
    // "approved".  Cases with no sign-off (undefined / not yet submitted),
    // "pending" (revoked or reset), or "rejected" QC status are blocked from
    // dispatch until an operator or admin submits an approval.
    //
    // This guard prevents unreviewed or rejected cases from leaving the facility
    // without explicit QC clearance — satisfying the data_integrity principle
    // that case status transitions follow valid paths.
    //
    // Error code: [QC_APPROVAL_REQUIRED]
    // Resolution: have an admin or operator submit a QC approval for this case
    //             via the INVENTORY dashboard (T1/T5 QC Sign-Off panel) before
    //             attempting the shipment again.
    if (newStatus === "transit_out" && caseDoc.qcSignOffStatus !== "approved") {
      const currentQcStatus = caseDoc.qcSignOffStatus ?? "not_submitted";
      throw new Error(
        `[QC_APPROVAL_REQUIRED] recordShipment: Case "${caseDoc.label}" ` +
          `(${args.caseId}) cannot be dispatched — QC sign-off status is ` +
          `"${currentQcStatus}". A QC sign-off with status "approved" is ` +
          `required before a case can be dispatched (transitioned to ` +
          `"transit_out"). Have an admin or operator submit a QC approval via ` +
          `the INVENTORY dashboard before proceeding with this shipment.`
      );
    }

    // ── Step 4: PATCH the case document ───────────────────────────────────────
    //
    // This is the write that invalidates ALL M1–M5 map queries and T1–T5
    // layout queries subscribed to this case's document.  Writing
    // denormalized FedEx tracking fields here (in addition to the shipments
    // row created in Step 5) enables single-read access for:
    //
    //   • M4 in-transit map pins  — listForMap reads tracking from cases
    //                                without a per-pin shipments join.
    //   • T3 layout query         — getCaseShippingLayout resolves the
    //                                shipping summary from a single
    //                                ctx.db.get(caseId) call.
    //   • Real-time fidelity      — every cases-table subscriber re-evaluates
    //                                within ~100–300 ms of this PATCH.
    const casePatch: Record<string, unknown> = {
      status:          newStatus,
      trackingNumber:  tn,
      carrier:         carrier,
      shippedAt:       now,
      destinationName: args.destinationName,
      destinationLat:  args.destinationLat,
      destinationLng:  args.destinationLng,
      updatedAt:       now,
    };

    // Conditionally overwrite last-known position fields with the ship
    // origin — only when the SCAN app provided origin coordinates.  This
    // preserves the prior position when the technician submits a shipment
    // without a fresh GPS fix (e.g., scanning while indoors).
    if (args.originLat  !== undefined) casePatch.lat          = args.originLat;
    if (args.originLng  !== undefined) casePatch.lng          = args.originLng;
    if (args.originName !== undefined) casePatch.locationName = args.originName;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(args.caseId, casePatch as any);

    // ── Step 5: INSERT canonical shipment record ──────────────────────────────
    //
    // The `shipments` table holds the complete tracking history including:
    //   • Route geometry (origin + destination coordinates for M4 line)
    //   • currentLat / currentLng (populated by refreshShipmentTracking)
    //   • estimatedDelivery (ISO date string from the FedEx Track API)
    //   • Full FedEx event timeline (populated by refreshShipmentTracking)
    //
    // This is the source of truth for M4 LogisticsMode map pins (via
    // assembleM4) and for the T3/T4 layout panels' detailed tracking
    // timeline.  Initial status is "label_created" — the FedEx Track API
    // refresh action will update it to "picked_up", "in_transit",
    // "out_for_delivery", or "delivered" as the carrier reports events.
    const shipmentId = await ctx.db.insert("shipments", {
      caseId:          args.caseId,
      trackingNumber:  tn,
      carrier:         carrier,
      status:          "label_created",
      originLat:       args.originLat,
      originLng:       args.originLng,
      originName:      args.originName,
      destinationLat:  args.destinationLat,
      destinationLng:  args.destinationLng,
      destinationName: args.destinationName,
      shippedAt:       now,
      createdAt:       now,
      updatedAt:       now,
    });

    // ── Step 6: INSERT status_change audit event ──────────────────────────────
    //
    // Immutable status_change milestone for the T5 audit panel.  Includes
    // the from/to status pair and a human-readable reason for the
    // transition so the panel can render a self-contained card without
    // loading the shipments table.
    const statusChangeEventId = await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "status_change",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        from:           previousStatus,
        to:             newStatus,
        reason:         `Shipped via ${carrier} — tracking number ${tn}`,
        shipmentId:     shipmentId.toString(),
        trackingNumber: tn,
        carrier:        carrier,
        source:         "scan_ship_action",
      },
    });

    // ── Step 7: INSERT shipped audit event ────────────────────────────────────
    //
    // The events table is append-only — shipped events are NEVER updated or
    // deleted, providing a tamper-evident record for the T5 audit panel and
    // compliance shipping reports.
    //
    // The data payload mirrors all shipment fields so the T5 audit panel
    // can reconstruct the ship event without joining the shipments table.
    // This is the "event sourcing" pattern used throughout the events table:
    // each event row is self-contained and human-readable independently of
    // other tables.
    const shippedEventId = await ctx.db.insert("events", {
      caseId:    args.caseId,
      eventType: "shipped",
      userId:    args.userId,
      userName:  args.userName,
      timestamp: now,
      data: {
        // Link back to the canonical shipment record.
        shipmentId:      shipmentId.toString(),
        trackingNumber:  tn,
        carrier:         carrier,

        // Full ship payload mirrored here for T5 panel reconstruction
        // without joining the shipments table.
        originName:      args.originName,
        originLat:       args.originLat,
        originLng:       args.originLng,
        destinationName: args.destinationName,
        destinationLat:  args.destinationLat,
        destinationLng:  args.destinationLng,

        // Status transition context.
        previousStatus:  previousStatus,
        newStatus:       newStatus,

        // Optional technician notes.
        notes:           args.notes,

        // Source attribution for telemetry / debugging.
        source:          "scan_ship_action",
      },
    });

    // ── Return typed result for the SCAN app confirmation screen ──────────────
    return {
      caseId:              args.caseId,
      shipmentId:          shipmentId.toString(),
      trackingNumber:      tn,
      carrier:             carrier,
      previousStatus:      previousStatus,
      newStatus:           newStatus,
      shippedAt:           now,
      statusChangeEventId: statusChangeEventId.toString(),
      shippedEventId:      shippedEventId.toString(),
    };
  },
});
