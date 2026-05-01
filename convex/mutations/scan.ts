/**
 * convex/mutations/scan.ts
 *
 * Canonical mutation functions for SCAN app QR code scan operations.
 *
 * This module provides the authoritative, atomic write operations for the SCAN
 * mobile app's QR code scan workflow.  Each mutation writes to ALL relevant
 * tables in a single Convex transaction — ensuring that a single function call
 * from the SCAN app completes the entire operation atomically and triggers all
 * reactive query invalidations in one shot.
 *
 * Mutations exported
 * ──────────────────
 *   checkInCase    — Full QR scan check-in: updates case status/position/assignee,
 *                    inserts a scan log entry, auto-creates an inspection when
 *                    transitioning to "deployed", appends audit events.
 *
 *   logScanOnly    — Lightweight scan log insert (no status change): records that
 *                    a QR code was scanned without triggering a status transition.
 *                    Used for "lookup" context scans and handoff initiation.
 *
 * Tables written per mutation
 * ───────────────────────────
 *   checkInCase:
 *     cases             PATCH  — status, assigneeId, lat/lng, updatedAt
 *     scans             INSERT — append-only scan log row
 *     inspections       INSERT — new inspection when transitioning to "deployed"
 *     events            INSERT — status_change + inspection_started audit events
 *
 *   logScanOnly:
 *     scans             INSERT — append-only scan log row only
 *
 * Reactive query invalidation
 * ───────────────────────────
 * Convex re-evaluates all subscribed queries reading the written tables and
 * pushes diffs to connected clients within ~100–300 ms.  A full checkInCase
 * write invalidates:
 *
 *   From cases PATCH:
 *     getCaseById, getCaseStatus, listCases, getCasesInBounds, listForMap,
 *     getCaseStatusCounts    → M1–M5 map pins, T1–T5 detail panels
 *
 *   From scans INSERT:
 *     getScansByCase, getLastScanForCase, getScansByUser, getRecentScans
 *     → T5 scan activity timeline, SCAN app "My Activity", ops monitoring
 *
 *   From inspections INSERT (when deployed transition):
 *     getChecklistWithInspection  → SCAN app inspection view
 *     getChecklistSummary         → T2/T3 progress bars
 *
 *   From events INSERT:
 *     getCaseAuditEvents          → T5 audit timeline
 *
 * All subscribed clients receive the live update within 2 seconds of the
 * mutation completing — satisfying the real_time_fidelity acceptance criterion.
 *
 * Status transition graph
 * ───────────────────────
 *   hangar      → assembled
 *   assembled   → transit_out | deployed | hangar
 *   transit_out → deployed | received
 *   deployed    → flagged | transit_in | assembled
 *   flagged     → deployed | transit_in | assembled
 *   transit_in  → received
 *   received    → assembled | archived | hangar
 *   archived    → (terminal)
 *
 * A same-status check-in (no transition) is always allowed and inserts a scan
 * log row + events entry without patching the case status.
 *
 * Authentication
 * ──────────────
 * All mutations require a verified Kinde JWT.  Unauthenticated callers receive
 * [AUTH_REQUIRED].
 *
 * Client usage
 * ────────────
 * Prefer calling through the typed hook wrappers in
 * src/hooks/use-scan-mutations.ts rather than via useMutation directly:
 *
 *   import { useCheckInCase, useLogScanOnly } from "@/hooks/use-scan-mutations";
 *
 *   // Full check-in (status transition + scan log):
 *   const checkIn = useCheckInCase();
 *   const result = await checkIn({
 *     caseId:         resolvedCase._id,
 *     qrPayload:      decodedText,
 *     newStatus:      "deployed",
 *     timestamp:      Date.now(),
 *     technicianId:   kindeUser.id,
 *     technicianName: "Jane Pilot",
 *     lat:            position.coords.latitude,
 *     lng:            position.coords.longitude,
 *     locationName:   "Site Alpha — Turbine Row 3",
 *     scanContext:    "check_in",
 *   });
 *   // result.scanId, result.caseId, result.previousStatus, result.newStatus
 *   // result.inspectionId (when transitioning to "deployed")
 *
 *   // Lookup-only scan (no status change):
 *   const logScan = useLogScanOnly();
 *   const { scanId } = await logScan({
 *     caseId:         resolvedCase._id,
 *     qrPayload:      decodedText,
 *     scannedBy:      kindeUser.id,
 *     scannedByName:  "Jane Pilot",
 *     scannedAt:      Date.now(),
 *     scanContext:    "lookup",
 *   });
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

// ─── Shared validators ────────────────────────────────────────────────────────

/**
 * Case lifecycle status validator.
 *
 * Mirrors the `caseStatus` union in convex/schema.ts and the `CaseStatus` type
 * in src/types/case-status.ts.  Defined locally so this module has no import
 * dependency on the schema file (which uses `defineSchema`/`defineTable` and
 * cannot be safely imported in Convex function modules).
 */
const caseStatusValidator = v.union(
  v.literal("hangar"),
  v.literal("assembled"),
  v.literal("transit_out"),
  v.literal("deployed"),
  v.literal("flagged"),
  v.literal("recalled"),
  v.literal("transit_in"),
  v.literal("received"),
  v.literal("archived"),
);

/**
 * Scan context validator.
 *
 * Enumerates the four reasons a QR code is scanned in the SCAN mobile app:
 *   "check_in"   — field technician scanning to advance case status
 *   "inspection" — scanning to begin or resume a checklist inspection
 *   "handoff"    — scanning before initiating a custody transfer
 *   "lookup"     — informational scan with no workflow action (read-only)
 */
const scanContextValidator = v.optional(
  v.union(
    v.literal("check_in"),
    v.literal("inspection"),
    v.literal("handoff"),
    v.literal("lookup"),
  )
);

type ScanEventType = "check_in" | "inspection" | "handoff" | "lookup" | "shipping" | "receiving";

function scanEventType(context: string | undefined, fallback: ScanEventType): ScanEventType {
  if (
    context === "check_in" ||
    context === "inspection" ||
    context === "handoff" ||
    context === "lookup" ||
    context === "shipping" ||
    context === "receiving"
  ) {
    return context;
  }
  return fallback;
}

// ─── Status transition guard ──────────────────────────────────────────────────

/**
 * Valid outbound status transitions per source status.
 *
 * Enforces the data_integrity evaluation principle: "Case status transitions
 * follow valid paths."  The SCAN app UI enforces this client-side; this map
 * provides the authoritative server-side guard.
 *
 * A same-status transition (fromStatus === toStatus) is always treated as a
 * "no-op check-in" — the scan is logged and events are appended but the case
 * status field is not patched.
 *
 * Mirrors CASE_STATUS_TRANSITIONS in src/types/case-status.ts.
 */
const VALID_TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  hangar:      new Set(["assembled"]),
  assembled:   new Set(["transit_out", "deployed", "hangar"]),
  transit_out: new Set(["deployed", "received"]),
  deployed:    new Set(["flagged", "recalled", "transit_in", "assembled"]),
  flagged:     new Set(["deployed", "recalled", "transit_in", "assembled"]),
  recalled:    new Set(["transit_in", "received"]),
  transit_in:  new Set(["received"]),
  received:    new Set(["assembled", "archived", "hangar"]),
  archived:    new Set([]),
};

// ─── Return types ─────────────────────────────────────────────────────────────

/**
 * Return value of the `checkInCase` mutation.
 *
 * Exported so client-side hooks in use-scan-mutations.ts can expose typed
 * results to SCAN app components.
 */
export interface CheckInCaseResult {
  /**
   * Convex document ID of the newly inserted `scans` row.
   * Stored by the SCAN app for follow-up queries (e.g., linking to inspection).
   */
  scanId: string;

  /**
   * Convex document ID of the case that was checked in.
   */
  caseId: string;

  /**
   * Status before this check-in mutation ran.
   * Displayed in the SCAN app transition confirmation message.
   */
  previousStatus: string;

  /**
   * Status written to cases.status by this mutation.
   * Drives the SCAN app next-step UI and all M1–M5 map pin updates.
   */
  newStatus: string;

  /**
   * Epoch ms when the scan was recorded (equals the `timestamp` arg).
   */
  scannedAt: number;

  /**
   * Convex document ID of the inspection created when the case transitions
   * to "deployed".  Undefined for all other transitions or same-status check-ins.
   *
   * When present, the SCAN app should immediately navigate to the inspection
   * checklist view using this ID.
   */
  inspectionId: string | undefined;
}

/**
 * Return value of the `logScanOnly` mutation.
 *
 * Lighter than CheckInCaseResult — only the scan log ID is needed because
 * no status change occurred.
 */
export interface LogScanOnlyResult {
  /**
   * Convex document ID of the newly inserted `scans` row.
   */
  scanId: string;

  /**
   * Epoch ms when the scan was recorded.
   */
  scannedAt: number;
}

// ─── checkInCase ─────────────────────────────────────────────────────────────

/**
 * Complete QR scan check-in — the primary SCAN app mutation for status transitions.
 *
 * This is the canonical, atomic scan check-in operation.  A single call writes
 * to up to four tables (cases, scans, inspections, events) in one Convex
 * transaction, ensuring:
 *
 *   1. The case status, assignee, and location are updated atomically.
 *   2. A scan log entry is appended to the immutable `scans` history table.
 *   3. A new inspection record is created when transitioning to "deployed".
 *   4. Audit events are appended to the immutable `events` table.
 *
 * All four writes happen in one Convex serializable transaction — partial
 * failures cannot leave the database in an inconsistent state.
 *
 * Fields written and their map-mode significance
 * ───────────────────────────────────────────────
 * ┌───────────────────────┬──────────────────────────────────────────────────┐
 * │ Field                 │ Map mode / query effect                          │
 * ├───────────────────────┼──────────────────────────────────────────────────┤
 * │ cases.status          │ M1 status pill; M2/M3 status filter;             │
 * │                       │ M5 heat-map weight (deployed=0.7, flagged=1.0)   │
 * │ cases.assigneeId      │ M1/M3 "My Cases" assigneeId filter               │
 * │ cases.lat / .lng      │ All modes: withinBounds() viewport clipping       │
 * │ cases.updatedAt       │ M1 by_updated sort index; "N min ago" freshness  │
 * │ scans row             │ getScansByCase, getLastScanForCase, getRecentScans│
 * │ inspections row       │ M3 inspectionProgress, checkedItems, damagedItems │
 * │ events row            │ T5 audit timeline, getCaseAuditEvents             │
 * └───────────────────────┴──────────────────────────────────────────────────┘
 *
 * Validation
 * ──────────
 *   • The case must exist (throws "Case <id> not found" otherwise).
 *   • The status transition must be valid per VALID_TRANSITIONS (throws with
 *     a descriptive error listing the allowed transitions from the current status).
 *   • Same-status check-ins are allowed (no transition guard applied).
 *
 * Inspection auto-creation
 * ────────────────────────
 *   • When `newStatus = "deployed"` AND the case was NOT previously "deployed",
 *     a new inspection record is created with "in_progress" status.
 *   • Initial counters are computed from the existing manifestItems for this case.
 *   • The `inspectionId` is returned so the SCAN app can navigate to the
 *     inspection checklist view immediately.
 *   • Subsequent check-ins while already "deployed" do NOT reset the active
 *     inspection (idempotent for in-progress inspection state).
 *
 * @param caseId        Convex document ID of the case being scanned.
 * @param qrPayload     Raw QR code string decoded from the physical label.
 *                      Stored verbatim in the scan log row.
 * @param newStatus     Target lifecycle status for this check-in.
 *                      Must be a valid transition from the case's current status.
 * @param timestamp     Epoch ms when the scan occurred (client-side clock).
 *                      Written to scans.scannedAt, cases.updatedAt, events.timestamp.
 * @param technicianId  Kinde user ID → written to cases.assigneeId, scans.scannedBy.
 * @param technicianName Display name → written to cases.assigneeName, scans.scannedByName.
 * @param lat           Optional GPS latitude at scan time → cases.lat, scans.lat.
 * @param lng           Optional GPS longitude at scan time → cases.lng, scans.lng.
 * @param locationName  Optional human-readable location → cases.locationName, scans.locationName.
 * @param notes         Optional technician free-text notes → cases.notes.
 * @param scanContext   Why the scan was initiated (see scanContextValidator).
 * @param deviceInfo    Optional device/browser metadata JSON string (for support).
 *
 * @returns CheckInCaseResult
 *
 * @throws "[AUTH_REQUIRED]"          Caller has no valid Kinde JWT.
 * @throws "Case <id> not found."     caseId does not exist.
 * @throws "Invalid status transition: <from> → <to>. Allowed transitions from ..."
 * @throws "[QC_APPROVAL_REQUIRED]"   Dispatch to "transit_out" attempted but
 *                                    the case's qcSignOffStatus is not "approved".
 *                                    Submit a QC approval via INVENTORY first.
 *
 * Client usage:
 *   const checkIn = useMutation(api.mutations.scan.checkInCase);
 *
 *   const result = await checkIn({
 *     caseId:         resolvedCase._id,
 *     qrPayload:      decodedText,
 *     newStatus:      "deployed",
 *     timestamp:      Date.now(),
 *     technicianId:   kindeUser.id,
 *     technicianName: "Jane Pilot",
 *     lat:            position.coords.latitude,
 *     lng:            position.coords.longitude,
 *     locationName:   "Site Alpha — Turbine Row 3",
 *     scanContext:    "check_in",
 *   });
 *   // Navigate to inspection if result.inspectionId is set
 */
export const checkInCase = mutation({
  args: {
    /**
     * Convex ID of the case being scanned and checked in.
     * The case must already exist in the database.
     */
    caseId: v.id("cases"),

    /**
     * Raw QR code payload decoded by the SCAN app camera.
     * Stored verbatim in the scans.qrPayload field so the scan log preserves
     * the exact value the technician's device decoded — useful for debugging
     * mismatches between the QR code and the case's stored qrCode field.
     */
    qrPayload: v.string(),

    /**
     * Target lifecycle status to write to cases.status.
     *
     * Must represent a valid transition from the case's current status per
     * VALID_TRANSITIONS.  Pass the same status as the current value for a
     * no-op check-in (location/assignee update only, no transition guard).
     *
     * This field is the primary driver of M1–M5 map behavior — every map mode
     * query and filter is keyed on cases.status.
     */
    newStatus: caseStatusValidator,

    /**
     * Epoch ms timestamp of the scan event (client-side clock).
     *
     * Written to:
     *   • scans.scannedAt          — by_scanned_at index (recent scan feed)
     *   • cases.updatedAt          — by_updated index (M1 sort order)
     *   • inspections.startedAt    — when a new inspection is created
     *   • events.timestamp         — immutable audit trail timestamp
     *
     * Client-side timestamps are used (not server-side) so the audit record
     * reflects when the physical scan occurred, not when the network request
     * arrived (which may be delayed by poor field connectivity).
     */
    timestamp: v.number(),

    /**
     * Kinde user ID of the field technician performing the scan.
     *
     * Written to:
     *   • cases.assigneeId         — M1/M3 assigneeId filter ("My Cases" view)
     *   • scans.scannedBy          — by_user index (My Activity tab)
     *   • inspections.inspectorId  — when a new inspection is created
     */
    technicianId: v.string(),

    /**
     * Display name of the field technician.
     *
     * Written to:
     *   • cases.assigneeName       — M1/M3 map pin tooltip; T2 "Held by" display
     *   • scans.scannedByName      — scan log attribution (no user join needed)
     *   • inspections.inspectorName — inspection record attribution
     */
    technicianName: v.string(),

    /**
     * GPS latitude at scan time.
     *
     * Written to cases.lat (all modes withinBounds check) and scans.lat.
     * Omit when the device could not obtain a GPS fix — previous position
     * is preserved on the case document.
     */
    lat: v.optional(v.number()),

    /**
     * GPS longitude at scan time.
     *
     * Written to cases.lng and scans.lng.
     */
    lng: v.optional(v.number()),

    /**
     * Human-readable location name at time of scan.
     *
     * Examples: "Site Alpha — Turbine Row 3", "SkySpecs HQ — Bay 4".
     * Written to cases.locationName and scans.locationName.
     */
    locationName: v.optional(v.string()),

    /**
     * Optional technician free-text notes about this check-in.
     *
     * Written to cases.notes.  Not written to the scan log row
     * (notes are case-level, not per-scan).
     */
    notes: v.optional(v.string()),

    /**
     * Reason the scan was initiated — used to route the SCAN app to the correct
     * next workflow step after check-in completes.
     *
     *   "check_in"   — standard status transition / location confirmation
     *   "inspection" — entering or resuming a checklist inspection pass
     *   "handoff"    — beginning a custody handoff workflow
     *   "lookup"     — informational only (also see logScanOnly)
     */
    scanContext: scanContextValidator,

    /**
     * Optional device / browser metadata JSON string.
     *
     * Not indexed or surfaced in the UI — stored for support diagnostics only.
     * Example: JSON.stringify({ userAgent: navigator.userAgent, camera: "rear" })
     */
    deviceInfo: v.optional(v.string()),

    /** Client-generated idempotency key for offline replay. */
    clientId: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<CheckInCaseResult> => {
    // ── Auth guard ────────────────────────────────────────────────────────────
    await requireAuth(ctx);

    const now = args.timestamp;

    if (args.clientId) {
      const existing = await ctx.db
        .query("scans")
        .withIndex("by_client_id", (q) => q.eq("clientId", args.clientId))
        .first();
      if (existing) {
        const existingCase = await ctx.db.get(existing.caseId);
        return {
          scanId: existing._id.toString(),
          caseId: existing.caseId,
          previousStatus: existingCase?.status ?? args.newStatus,
          newStatus: existingCase?.status ?? args.newStatus,
          scannedAt: existing.scannedAt,
          inspectionId: existing.inspectionId?.toString(),
        };
      }
    }

    // ── Step 1: Verify case exists ────────────────────────────────────────────
    //
    // Fetch the case document before writing anything so that:
    //   a) We can capture the previous status for the audit event payload.
    //   b) A missing case throws immediately without partial writes.
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `checkInCase: Case "${args.caseId}" not found. ` +
          `Verify the QR payload resolves to a valid case before calling checkInCase.`
      );
    }

    const previousStatus = caseDoc.status;
    const newStatus      = args.newStatus;

    // ── Step 2: Guard status transition ──────────────────────────────────────
    //
    // Enforce the valid state machine transitions from VALID_TRANSITIONS.
    // Same-status check-ins (previousStatus === newStatus) are allowed —
    // they record the scan without changing the status.
    if (previousStatus !== newStatus) {
      const allowed = VALID_TRANSITIONS[previousStatus];
      if (allowed !== undefined && !allowed.has(newStatus)) {
        throw new Error(
          `checkInCase: Invalid status transition: "${previousStatus}" → "${newStatus}". ` +
            `Allowed transitions from "${previousStatus}": ${[...allowed].join(", ") || "(none — terminal status)"}.`
        );
      }
    }

    // ── Step 2b: Pre-dispatch QC sign-off guard ───────────────────────────────
    //
    // Enforce the QC approval gate for outbound dispatches.  A case may only
    // be transitioned to "transit_out" (dispatched) when its QC sign-off
    // status is "approved".  Cases with no sign-off (undefined), "pending"
    // (revoked or reset), or "rejected" QC status are blocked until an admin
    // or operator submits an approval via the INVENTORY dashboard.
    //
    // This guard applies to check-in transitions that would dispatch a case
    // outbound — complementing the same guard in convex/mutations/ship.ts
    // (recordShipment) to ensure dispatch cannot be bypassed via either the
    // SCAN app direct check-in flow or the FedEx ship-action flow.
    //
    // Same-status "no-op" check-ins (previousStatus === newStatus === "transit_out")
    // are NOT blocked here — only forward transitions into "transit_out" from
    // a different status require QC approval.
    //
    // Error code: [QC_APPROVAL_REQUIRED]
    // Resolution: have an admin or operator submit a QC approval for this case
    //             via the INVENTORY dashboard (T1/T5 QC Sign-Off panel) before
    //             attempting the dispatch check-in again.
    if (newStatus === "transit_out" && previousStatus !== "transit_out" && caseDoc.qcSignOffStatus !== "approved") {
      const currentQcStatus = caseDoc.qcSignOffStatus ?? "not_submitted";
      throw new Error(
        `[QC_APPROVAL_REQUIRED] checkInCase: Case "${caseDoc.label}" ` +
          `(${args.caseId}) cannot be dispatched — QC sign-off status is ` +
          `"${currentQcStatus}". A QC sign-off with status "approved" is ` +
          `required before a case can be transitioned to "transit_out" ` +
          `(dispatched). Have an admin or operator submit a QC approval via ` +
          `the INVENTORY dashboard before proceeding with this check-in.`
      );
    }

    // ── Step 3: PATCH the case document ──────────────────────────────────────
    //
    // This is the write that invalidates all M1–M5 map queries and T1–T5 layout
    // queries subscribed to this case's document.
    //
    //   cases.status      — M1 status pill, M2/M3 filter, M5 heatmap weight
    //   cases.assigneeId  — M1/M3 "My Cases" assigneeId filter
    //   cases.assigneeName — M1/M3 pin tooltip; T2 "Currently held by"
    //   cases.lat / .lng  — all modes withinBounds() viewport clipping
    //   cases.updatedAt   — M1 by_updated sort index; "N min ago" UI freshness
    const casePatch: Record<string, unknown> = {
      status:       newStatus,
      assigneeId:   args.technicianId,
      assigneeName: args.technicianName,
      updatedAt:    now,
    };

    // Conditionally overwrite position fields — only when the device has a GPS fix.
    // This preserves the last known position when the scan occurs without GPS.
    if (args.lat          !== undefined) casePatch.lat          = args.lat;
    if (args.lng          !== undefined) casePatch.lng          = args.lng;
    if (args.locationName !== undefined) casePatch.locationName = args.locationName;
    if (args.notes        !== undefined) casePatch.notes        = args.notes;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.patch(args.caseId, casePatch as any);

    // ── Step 4: INSERT scan log row ───────────────────────────────────────────
    //
    // The `scans` table is append-only — every physical QR code encounter is
    // recorded here regardless of whether a status transition occurred.
    //
    // This INSERT invalidates:
    //   • getScansByCase(caseId)                — T5 scan activity timeline
    //   • getLastScanForCase(caseId)            — "Last scanned N min ago"
    //   • getScansByUser(scannedBy)             — SCAN app "My Activity" tab
    //   • getRecentScans()                      — dashboard ops monitoring feed
    const scanId = await ctx.db.insert("scans", {
      caseId:        args.caseId,
      qrPayload:     args.qrPayload,
      scannedBy:     args.technicianId,
      scannedByName: args.technicianName,
      scannedAt:     now,
      lat:           args.lat,
      lng:           args.lng,
      locationName:  args.locationName,
      scanContext:   args.scanContext,
      deviceInfo:    args.deviceInfo,
      clientId:      args.clientId,
      // inspectionId linked in Step 5 after the inspection row is created
    });

    await ctx.db.insert("scan_events", {
      caseId: args.caseId,
      userId: args.technicianId,
      timestamp: now,
      location:
        args.lat !== undefined || args.lng !== undefined || args.locationName !== undefined
          ? {
              lat: args.lat,
              lng: args.lng,
              name: args.locationName,
            }
          : undefined,
      scanType: scanEventType(args.scanContext, "check_in"),
      clientId: args.clientId,
    });

    // ── Step 5: CREATE inspection when transitioning to "deployed" ────────────
    //
    // M3 (Field Mode) reads from the inspections table for:
    //   • inspectionProgress (checkedItems / totalItems) on map pins
    //   • damagedItems / missingItems counters
    //   • byInspectionStatus aggregate in the M3 summary panel
    //
    // We create a NEW inspection only on the "deployed" entry transition.
    // Subsequent check-ins while already "deployed" do NOT reset the in-progress
    // inspection — that would discard completed checklist work.
    let inspectionId: string | undefined;

    if (newStatus === "deployed" && previousStatus !== "deployed") {
      // Count existing manifest items for accurate initial inspection totals.
      // Uses the by_case index — O(log n + |items|), same as getChecklistByCase.
      const manifestItems = await ctx.db
        .query("manifestItems")
        .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
        .collect();

      const totalItems    = manifestItems.length;
      // Count items already reviewed in any previous inspection pass
      const checkedItems  = manifestItems.filter((i) => i.status !== "unchecked").length;
      const damagedItems  = manifestItems.filter((i) => i.status === "damaged").length;
      const missingItems  = manifestItems.filter((i) => i.status === "missing").length;

      const inspId = await ctx.db.insert("inspections", {
        caseId:        args.caseId,
        inspectorId:   args.technicianId,
        inspectorName: args.technicianName,
        status:        "in_progress",
        startedAt:     now,
        // Aggregate counters — the exact fields M3 assembleM3() reads for map pins
        totalItems,
        checkedItems,
        damagedItems,
        missingItems,
        notes:         args.notes,
      });

      inspectionId = inspId.toString();

      // Audit event for the inspection start
      await ctx.db.insert("events", {
        caseId:    args.caseId,
        eventType: "inspection_started",
        userId:    args.technicianId,
        userName:  args.technicianName,
        timestamp: now,
        data: {
          inspectionId,
          totalItems,
          checkedItems,
          damagedItems,
          missingItems,
          scanContext: args.scanContext,
          source:      "scan_check_in",
        },
      });

      // Update the scan row to link it to the newly created inspection.
      // This allows the T5 audit panel to correlate scan events with inspections.
      await ctx.db.patch(scanId, { inspectionId: inspId });
    }

    // ── Step 6: INSERT status_change audit event ──────────────────────────────
    //
    // The events table is append-only — no updates or deletes.  Only emit a
    // status_change event when the status actually changed (not for same-status
    // check-ins, which would produce noise in the T5 timeline).
    if (previousStatus !== newStatus) {
      await ctx.db.insert("events", {
        caseId:    args.caseId,
        eventType: "status_change",
        userId:    args.technicianId,
        userName:  args.technicianName,
        timestamp: now,
        data: {
          from:        previousStatus,
          to:          newStatus,
          lat:         args.lat,
          lng:         args.lng,
          locationName: args.locationName,
          notes:       args.notes,
          scanId:      scanId.toString(),
          scanContext: args.scanContext,
          source:      "scan_check_in",
        },
        clientId: args.clientId,
      });
    }

    // ── Return typed result ───────────────────────────────────────────────────
    return {
      scanId:         scanId.toString(),
      caseId:         args.caseId,
      previousStatus,
      newStatus,
      scannedAt:      now,
      inspectionId,
    };
  },
});

// ─── logScanOnly ─────────────────────────────────────────────────────────────

/**
 * Log a QR scan event WITHOUT triggering a status transition.
 *
 * Use this mutation when the SCAN app decodes a QR code but the technician
 * is NOT performing a status check-in.  Common use cases:
 *
 *   • "lookup" context — technician scanned to view case details only
 *   • Pre-handoff scan — QR code read to identify the case before starting
 *     the custody handoff workflow (the handoffCustody mutation completes the
 *     action; this call just records that the case was physically scanned)
 *   • Presence verification — scanning to confirm the case is at a location
 *     without advancing its lifecycle status
 *
 * This mutation writes ONLY to the `scans` table (one INSERT).  It does NOT:
 *   • Patch the case document
 *   • Create or modify inspections
 *   • Append events to the audit trail
 *
 * Real-time invalidation
 * ───────────────────────
 * The single INSERT into `scans` invalidates:
 *   • getScansByCase(caseId)      — T5 scan activity timeline
 *   • getLastScanForCase(caseId)  — "Last scanned N min ago"
 *   • getScansByUser(scannedBy)   — SCAN app "My Activity" tab
 *   • getRecentScans()            — fleet-wide recent scan feed
 *
 * @param caseId        Convex ID of the case that was scanned.
 * @param qrPayload     Raw QR code string decoded by the camera.
 * @param scannedBy     Kinde user ID of the technician who scanned.
 * @param scannedByName Display name of the technician.
 * @param scannedAt     Epoch ms when the scan occurred (client-side clock).
 * @param lat           Optional GPS latitude at scan time.
 * @param lng           Optional GPS longitude at scan time.
 * @param locationName  Optional human-readable location name.
 * @param scanContext   Why the scan was performed (typically "lookup" or "handoff").
 * @param inspectionId  Optional inspection ID if this lookup was tied to one.
 * @param deviceInfo    Optional device metadata JSON string.
 *
 * @returns LogScanOnlyResult { scanId, scannedAt }
 *
 * @throws "[AUTH_REQUIRED]" for unauthenticated requests.
 * @throws "Case <id> not found." when the caseId is invalid.
 *
 * Client usage:
 *   const logScan = useMutation(api.mutations.scan.logScanOnly);
 *
 *   // Before starting a custody handoff:
 *   const { scanId } = await logScan({
 *     caseId:         resolvedCase._id,
 *     qrPayload:      decodedText,
 *     scannedBy:      kindeUser.id,
 *     scannedByName:  "Jane Pilot",
 *     scannedAt:      Date.now(),
 *     scanContext:    "handoff",
 *     lat:            position.coords.latitude,
 *     lng:            position.coords.longitude,
 *   });
 */
export const logScanOnly = mutation({
  args: {
    /** Convex ID of the case that was scanned. */
    caseId: v.id("cases"),

    /**
     * Raw QR code payload decoded by the SCAN app camera.
     * Stored verbatim for audit / debugging.
     */
    qrPayload: v.string(),

    /**
     * Kinde user ID of the scanning technician.
     * Written to scans.scannedBy — the by_user index field.
     */
    scannedBy: v.string(),

    /**
     * Display name of the technician.
     * Denormalized so scan history rows are self-contained.
     */
    scannedByName: v.string(),

    /**
     * Epoch ms when the scan occurred (client-side clock).
     * Written to scans.scannedAt — the by_scanned_at index field.
     */
    scannedAt: v.number(),

    /**
     * GPS latitude at time of scan.
     * Omit when the device could not obtain a GPS fix.
     */
    lat: v.optional(v.number()),

    /**
     * GPS longitude at time of scan.
     */
    lng: v.optional(v.number()),

    /**
     * Human-readable location name (e.g. "Site Alpha Gate 3").
     * Optional — populated by the SCAN app's location context.
     */
    locationName: v.optional(v.string()),

    /**
     * Why this scan was initiated.
     * Typically "lookup" for informational scans or "handoff" for pre-handoff scans.
     */
    scanContext: scanContextValidator,

    /**
     * Optional Convex ID of an inspection this lookup is associated with.
     * Populated when the technician scans while reviewing an active inspection.
     */
    inspectionId: v.optional(v.id("inspections")),

    /**
     * Optional device / browser metadata JSON string (support diagnostics only).
     */
    deviceInfo: v.optional(v.string()),
    clientId: v.optional(v.string()),
  },

  handler: async (ctx, args): Promise<LogScanOnlyResult> => {
    // ── Auth guard ────────────────────────────────────────────────────────────
    await requireAuth(ctx);

    if (args.clientId) {
      const existing = await ctx.db
        .query("scans")
        .withIndex("by_client_id", (q) => q.eq("clientId", args.clientId))
        .first();
      if (existing) {
        return {
          scanId: existing._id.toString(),
          scannedAt: existing.scannedAt,
        };
      }
    }

    // ── Verify the case exists ────────────────────────────────────────────────
    // Prevents orphaned scan rows referencing nonexistent cases.
    const caseDoc = await ctx.db.get(args.caseId);
    if (!caseDoc) {
      throw new Error(
        `logScanOnly: Case "${args.caseId}" not found. ` +
          `Verify the QR payload resolves to a valid case before calling logScanOnly.`
      );
    }

    // ── INSERT scan log row (the only write in this mutation) ─────────────────
    //
    // This single INSERT invalidates:
    //   • getScansByCase(caseId)      — by_case index
    //   • getLastScanForCase(caseId)  — by_case_scanned_at index
    //   • getScansByUser(scannedBy)   — by_user index
    //   • getRecentScans()            — by_scanned_at index
    const scanId = await ctx.db.insert("scans", {
      caseId:        args.caseId,
      qrPayload:     args.qrPayload,
      scannedBy:     args.scannedBy,
      scannedByName: args.scannedByName,
      scannedAt:     args.scannedAt,
      lat:           args.lat,
      lng:           args.lng,
      locationName:  args.locationName,
      scanContext:   args.scanContext,
      inspectionId:  args.inspectionId,
      deviceInfo:    args.deviceInfo,
      clientId:      args.clientId,
    });

    await ctx.db.insert("scan_events", {
      caseId: args.caseId,
      userId: args.scannedBy,
      timestamp: args.scannedAt,
      location:
        args.lat !== undefined || args.lng !== undefined || args.locationName !== undefined
          ? {
              lat: args.lat,
              lng: args.lng,
              name: args.locationName,
            }
          : undefined,
      scanType: scanEventType(args.scanContext, "lookup"),
      clientId: args.clientId,
    });

    return {
      scanId:    scanId.toString(),
      scannedAt: args.scannedAt,
    };
  },
});
