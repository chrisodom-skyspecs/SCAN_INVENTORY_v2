/**
 * convex/schema.ts
 *
 * SkySpecs INVENTORY + SCAN database schema.
 * All tables are defined here with appropriate indexes for efficient queries.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ─── Shared value types ──────────────────────────────────────────────────────

/**
 * Organization type distinguishes internal SkySpecs staff groups from
 * external contractor / partner organizations.
 *
 * Single-tenant constraint: organizations represent logical groupings of
 * people within or outside SkySpecs — they are NOT separate database tenants.
 * All organizations share the same Convex database and case inventory.
 */
const orgType = v.union(
  v.literal("internal"),    // SkySpecs internal staff groups (ops, logistics, etc.)
  v.literal("contractor"),  // external contractors, pilots, or partner organizations
);

/**
 * Organization-scoped membership role.
 *
 * org_admin  — can manage the organization's membership list (add/remove members,
 *              change roles) and update organization details; inherits all member
 *              permissions within the org scope.
 *
 * member     — standard active member of the organization; can be assigned as
 *              a case custodian, mission team member, or inspection participant
 *              on behalf of the organization.
 */
const orgRole = v.union(
  v.literal("org_admin"),
  v.literal("member"),
);

/**
 * System-wide user role.
 *
 * Mirrors the ROLES constant in convex/rbac.ts and the UserRole type in
 * src/types/user.ts — all three must be kept in sync.
 *
 *   admin       — full system access
 *   operator    — operations team / back-office
 *   technician  — primary field operator
 *   pilot       — on-site pilot / secondary field role
 */
const userRole = v.union(
  v.literal("admin"),
  v.literal("operator"),
  v.literal("technician"),
  v.literal("pilot"),
);

/**
 * User account lifecycle status.
 *
 * Mirrors UserStatus in src/types/user.ts — both must be kept in sync.
 *
 *   active   — fully onboarded; can authenticate and perform role-permitted actions
 *   inactive — suspended or deactivated; login is blocked by auth middleware
 *   pending  — invited but has not yet completed first login / Kinde onboarding
 */
const userStatus = v.union(
  v.literal("active"),
  v.literal("inactive"),
  v.literal("pending"),
);

/**
 * Valid case lifecycle statuses.
 *
 * Full lifecycle:
 *   hangar → assembled → transit_out → deployed → (flagged) → transit_in → received → archived
 *
 * Mirrors CaseStatus in src/types/case-status.ts — both must be kept in sync.
 */
const caseStatus = v.union(
  v.literal("hangar"),       // stored in hangar; not yet assembled
  v.literal("assembled"),    // fully packed, ready to deploy
  v.literal("transit_out"),  // in transit to field site
  v.literal("deployed"),     // actively in use at a field site
  v.literal("flagged"),      // has outstanding issues requiring review
  v.literal("recalled"),     // recalled to hangar for maintenance / upgrade / incident review
  v.literal("transit_in"),   // in transit returning to base
  v.literal("received"),     // received back at base
  v.literal("archived"),     // decommissioned; no longer in active rotation
);

/** Manifest item inspection states */
const manifestItemStatus = v.union(
  v.literal("unchecked"),
  v.literal("ok"),
  v.literal("damaged"),
  v.literal("missing"),
);

/** Inspection lifecycle */
const inspectionStatus = v.union(
  v.literal("pending"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("flagged"),    // items require review
);

/** Shipment tracking status */
const shipmentStatus = v.union(
  v.literal("label_created"),
  v.literal("picked_up"),
  v.literal("in_transit"),
  v.literal("out_for_delivery"),
  v.literal("delivered"),
  v.literal("exception"),
);

/** Mission status */
const missionStatus = v.union(
  v.literal("planning"),
  v.literal("active"),
  v.literal("completed"),
  v.literal("cancelled"),
);

// ─── Event types for immutable audit trail ───────────────────────────────────

const eventType = v.union(
  v.literal("status_change"),
  v.literal("inspection_started"),
  v.literal("inspection_completed"),
  v.literal("item_checked"),
  v.literal("damage_reported"),
  v.literal("shipped"),
  v.literal("delivered"),
  v.literal("custody_handoff"),
  v.literal("note_added"),
  v.literal("photo_added"),
  v.literal("mission_assigned"),
  v.literal("template_applied"),
  v.literal("qc_sign_off"),   // QC quality-control sign-off (approve / reject / revoke)
  v.literal("case_recalled"),
  v.literal("condition_note"),
  v.literal("shipment_created"),
  v.literal("shipment_released"),
);

// ─── Schema ──────────────────────────────────────────────────────────────────

export default defineSchema({
  /**
   * cases — the central entity.
   * A physical equipment case tracked through its full lifecycle.
   */
  cases: defineTable({
    label: v.string(),            // display label e.g. "CASE-001"
    qrCode: v.string(),           // QR payload (scanned by SCAN app)
    qrCodeSource: v.optional(     // how the QR code was assigned
      v.union(
        v.literal("generated"),   // QR generated by the system
        v.literal("external"),    // QR code from an external label / pre-printed asset
      )
    ),
    status: caseStatus,
    templateId: v.optional(v.id("caseTemplates")),
    missionId: v.optional(v.id("missions")),
    unitId: v.optional(v.id("units")),

    // Geographic position of the case (last known)
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    locationName: v.optional(v.string()),

    // Custody / assignment
    assigneeId: v.optional(v.string()),    // Kinde user ID
    assigneeName: v.optional(v.string()),

    /**
     * Denormalized shipping tracking fields.
     *
     * Written by the `shipCase` mutation (convex/shipping.ts) when the SCAN
     * app operator ships a case via FedEx.  These fields are intentionally
     * denormalized onto the cases table so that:
     *
     *   1. The M3/M4 in-transit map mode can query `cases` by status="shipping"
     *      with `by_status` index and immediately obtain tracking info without
     *      a secondary join to the `shipments` table.
     *
     *   2. The T3 layout query (`getCaseShippingLayout`) can read the full
     *      shipping summary from a single O(1) `ctx.db.get(caseId)` call.
     *
     *   3. Convex re-evaluates all subscribed queries that read the cases table
     *      (including `listCases`, `getCaseStatus`, and `getCaseShippingLayout`)
     *      within ~100–300 ms of the mutation, satisfying the ≤ 2-second
     *      real-time fidelity requirement between SCAN app action and dashboard
     *      visibility.
     *
     * The canonical full shipment record (with route geometry, tracking events,
     * and `currentLat`/`currentLng`) continues to live in the `shipments` table.
     * These fields are a lightweight summary only.
     *
     * Cleared to `undefined` when the case transitions OUT of "shipping" status
     * (e.g., when marked "returned" after FedEx delivery).
     */
    trackingNumber:  v.optional(v.string()),  // e.g. "794644823741"
    carrier:         v.optional(v.string()),  // always "FedEx" currently
    shippedAt:       v.optional(v.number()),  // epoch ms when shipment created
    destinationName: v.optional(v.string()),  // e.g. "SkySpecs HQ — Ann Arbor"
    destinationLat:  v.optional(v.number()),  // destination coordinates (for M4 pins)
    destinationLng:  v.optional(v.number()),

    /**
     * Denormalized FedEx carrier tracking fields.
     *
     * Written by `updateShipmentStatus` (convex/shipping.ts) when a FedEx
     * tracking refresh returns updated carrier data.  These fields are
     * intentionally denormalized onto the cases table so that:
     *
     *   1. The M3/M4 map modes can show carrier status alongside case status
     *      without a secondary join to the `shipments` table.
     *
     *   2. The T3/T4 layout queries can read the full tracking summary from
     *      a single O(1) `ctx.db.get(caseId)` call.
     *
     *   3. All queries subscribed to the `cases` table (listForMap, getCaseStatus,
     *      getCaseCarrierStatus) automatically re-evaluate within ~100–300 ms
     *      of any tracking refresh, satisfying the ≤ 2-second real-time
     *      fidelity requirement.
     *
     * These fields are cleared to `undefined` when a case transitions to a
     * non-shipping status (e.g., "received" after FedEx delivery).
     *
     * The canonical full tracking data (with complete event timeline) continues
     * to live in the `shipments` table.  These fields are a lightweight summary.
     */

    /**
     * Normalized FedEx carrier tracking status.
     * Mirrors the `shipmentStatus` union from the `shipments` table but stored
     * as a plain string for schema flexibility.
     * Values: "label_created" | "picked_up" | "in_transit" | "out_for_delivery"
     *        | "delivered" | "exception"
     * Updated by `updateShipmentStatus` on each FedEx tracking poll.
     */
    carrierStatus:     v.optional(v.string()),

    /**
     * Estimated delivery date as an ISO 8601 date-time string.
     * Sourced from the FedEx Track API response on each refresh.
     * Example: "2025-06-03T20:00:00Z"
     * Updated by `updateShipmentStatus`; cleared when delivered.
     */
    estimatedDelivery: v.optional(v.string()),

    /**
     * Most recent FedEx scan / tracking event for this case.
     * Sourced from the first element of `events` in the FedEx Track API response.
     * Stored as a structured object for direct rendering in map pin tooltips
     * and T3/T4 layout panels without parsing raw event strings.
     *
     * Updated by `updateShipmentStatus` on each FedEx tracking poll.
     * Undefined when no tracking event has been recorded yet (label_created with
     * no FedEx scan activity).
     */
    lastCarrierEvent:  v.optional(v.object({
      /** ISO 8601 timestamp of the scan event (as returned by FedEx). */
      timestamp:   v.string(),
      /** Short FedEx event type code (e.g., "PU" = Picked Up, "OD" = Out for Delivery). */
      eventType:   v.string(),
      /** Human-readable description of the scan event. */
      description: v.string(),
      /** Location where the scan event occurred. */
      location: v.object({
        city:    v.optional(v.string()),
        state:   v.optional(v.string()),
        country: v.optional(v.string()),
      }),
    })),

    /**
     * Denormalized QC sign-off summary fields.
     *
     * Written by the `submitQcSignOff` mutation (convex/mutations/qcSignOff.ts)
     * when an operator or admin performs a quality-control sign-off on the case.
     * These fields are intentionally denormalized onto the cases table so that:
     *
     *   1. The T1 Summary layout can display QC status without a secondary join
     *      to the `qcSignOffs` history table.
     *   2. The M1 fleet overview map can filter/highlight cases by QC status
     *      in a single O(log n) index scan.
     *   3. All queries subscribed to the `cases` table automatically re-evaluate
     *      within ~100–300 ms of a sign-off mutation, satisfying the ≤ 2-second
     *      real-time fidelity requirement between SCAN app action and dashboard.
     *
     * The canonical full QC sign-off history (all sign-off actions over time)
     * continues to live in the `qcSignOffs` table.  These fields are a
     * lightweight summary of the LATEST sign-off state only.
     *
     * Cleared (set to undefined) if a sign-off is revoked (status → "pending").
     */

    /**
     * Current QC sign-off status for this case.
     *
     *   "pending"  — no sign-off has been submitted yet (or it was revoked).
     *   "approved" — QC reviewer approved the case; safe to deploy/ship.
     *   "rejected" — QC reviewer rejected the case; requires rework before deploy.
     *
     * When undefined, the case has not entered a QC workflow yet.
     * Once a sign-off is submitted the field is always one of the three literals.
     */
    qcSignOffStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    )),

    /**
     * Kinde user ID of the person who submitted the most recent QC sign-off.
     * Undefined when qcSignOffStatus is undefined or "pending".
     */
    qcSignedOffBy: v.optional(v.string()),

    /**
     * Display name of the person who submitted the most recent QC sign-off.
     * Denormalised for O(1) tooltip rendering without a users table join.
     * Undefined when qcSignOffStatus is undefined or "pending".
     */
    qcSignedOffByName: v.optional(v.string()),

    /**
     * Epoch ms when the most recent QC sign-off was submitted.
     * Undefined when qcSignOffStatus is undefined or "pending".
     */
    qcSignedOffAt: v.optional(v.number()),

    /**
     * Optional notes entered by the QC reviewer alongside the sign-off decision.
     * E.g., "All items inspected; minor cosmetic scratch on lid — approved."
     * or "Battery compartment seal cracked — rejected until repaired."
     */
    qcSignOffNotes: v.optional(v.string()),

    /**
     * Recall state summary.
     *
     * A recalled case remains assigned to its current holder until they scan or
     * acknowledge the recall. These fields let INVENTORY and SCAN surface the
     * reason without parsing the audit event payload.
     */
    recallReason: v.optional(v.string()),
    recallInitiatedAt: v.optional(v.number()),
    recallInitiatedBy: v.optional(v.string()),

    /**
     * Current outbound shipment bundle, when this case is part of a hangar-built
     * kit release. This denormalized reverse link makes SCAN and INVENTORY
     * verification cheap from the case detail screen.
     */
    currentOutboundShipmentId: v.optional(v.id("outboundShipments")),

    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_assignee", ["assigneeId"])
    .index("by_outbound_shipment", ["currentOutboundShipmentId"])
    .index("by_qc_sign_off_status", ["qcSignOffStatus"])
    .index("by_mission", ["missionId"])
    .index("by_qr_code", ["qrCode"])
    /**
     * by_label — efficient lookup by human-readable case label (e.g. "CASE-001").
     *
     * Used by `getCaseByQrIdentifier` as a fallback lookup strategy for
     * legacy/physical labels.  When a technician manually enters a case label
     * or scans a legacy barcode that encodes only the human-readable label
     * (not the full QR URL), this index allows an O(log n) point read instead
     * of a full table scan.
     *
     * Labels are stored verbatim (no normalisation in the DB); the query
     * function applies trim() before using this index.
     */
    .index("by_label", ["label"])
    .index("by_unit", ["unitId"])
    .index("by_updated", ["updatedAt"]),

  /**
   * units — long-lived asset identity for aircraft and rovers.
   *
   * A unit (for example FS-101 or SC-201) owns the durable operational identity
   * that can appear across many physical cases and outbound shipments.
   */
  units: defineTable({
    unitId: v.string(),
    assetType: v.union(v.literal("aircraft"), v.literal("rover")),
    platform: v.string(),
    version: v.optional(v.string()),
    nickname: v.optional(v.string()),
    faaRegistration: v.optional(v.string()),
    pairedBeakon: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    homeBase: v.optional(v.string()),
    currentMissionId: v.optional(v.id("missions")),

    // SCAN mobile profile facts. Optional so existing unit rows remain valid.
    firmware: v.optional(v.string()),
    flightHours: v.optional(v.number()),
    batteryCycles: v.optional(v.number()),
    bornAt: v.optional(v.number()),
    inServiceAt: v.optional(v.number()),
    lastCalibrationAt: v.optional(v.number()),
    lastQcAt: v.optional(v.number()),
    ownerName: v.optional(v.string()),

    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_unit_id", ["unitId"])
    .index("by_asset_type", ["assetType"])
    .index("by_platform", ["platform"]),

  /**
   * unitQuirks — serial-traveling operational notes for aircraft and rovers.
   *
   * These are not case notes. They follow the durable unit identity so the next
   * holder sees known behavior before flight, even after the unit moves between
   * cases or outbound shipment bundles.
   */
  unitQuirks: defineTable({
    unitId: v.id("units"),
    title: v.string(),
    detail: v.string(),
    severity: v.union(
      v.literal("info"),
      v.literal("watch"),
      v.literal("warning"),
      v.literal("critical"),
    ),
    occurrenceCount: v.optional(v.number()),
    meta: v.optional(v.string()),
    workOrder: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
    reportedById: v.optional(v.string()),
    reportedByName: v.optional(v.string()),
    firstSeenAt: v.optional(v.number()),
    lastSeenAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_unit", ["unitId"])
    .index("by_unit_severity", ["unitId", "severity"])
    .index("by_unit_pinned", ["unitId", "pinned"]),

  /**
   * missions — a field deployment grouping cases together.
   * Maps to M2 (Mission Mode) and M5 (Mission Control) on the dashboard.
   */
  missions: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    status: missionStatus,

    // Primary location of the mission site
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    locationName: v.optional(v.string()),

    // Date range
    startDate: v.optional(v.number()),  // epoch ms
    endDate: v.optional(v.number()),

    // Mission lead
    leadId: v.optional(v.string()),     // Kinde user ID
    leadName: v.optional(v.string()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_updated", ["updatedAt"]),

  /**
   * caseTemplates — predefined packing lists managed via admin UI.
   * Applied to a case to define its expected manifest items.
   */
  caseTemplates: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    isActive: v.boolean(),
    items: v.array(
      v.object({
        id: v.string(),             // stable item identifier within template
        name: v.string(),
        description: v.optional(v.string()),
        required: v.boolean(),
        category: v.optional(v.string()),
        sortOrder: v.optional(v.number()),

        // Kit template item spec fields
        /** Expected quantity of this item in the case (e.g., 2 batteries). */
        quantity: v.optional(v.number()),
        /** Unit of measure for the quantity (e.g., "each", "pair", "set"). */
        unit: v.optional(v.string()),
        /** Packing / handling notes shown to field technicians during inspection. */
        notes: v.optional(v.string()),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"])
    .index("by_updated", ["updatedAt"]),

  /**
   * manifestItems — per-case state for each template item.
   * Created when a template is applied; updated during inspection.
   */
  manifestItems: defineTable({
    caseId: v.id("cases"),
    templateItemId: v.string(),
    name: v.string(),
    status: manifestItemStatus,
    notes: v.optional(v.string()),
    photoStorageIds: v.optional(v.array(v.string())),  // Convex file storage IDs
    checkedAt: v.optional(v.number()),
    checkedById: v.optional(v.string()),   // Kinde user ID
    checkedByName: v.optional(v.string()),
  })
    .index("by_case", ["caseId"])
    .index("by_case_item", ["caseId", "templateItemId"])
    /**
     * by_case_status — compound index for completion-state queries.
     *
     * Enables O(log n) lookups when filtering manifest items by both
     * caseId and status (e.g., "show me all damaged items for CASE-007").
     * Used by:
     *   getChecklistItemsByStatus — real-time items filtered by completion state
     *   getUncheckedItems         — real-time list of items still to inspect
     *
     * Without this index, status-filtered queries would require a full
     * by_case scan + in-memory filter.  Cases with large packing lists
     * (100+ items) benefit from the O(log n + |results|) index path.
     */
    .index("by_case_status", ["caseId", "status"]),

  /**
   * inspections — a single inspection pass on a case.
   * Tracks aggregate progress; individual items are in manifestItems.
   */
  inspections: defineTable({
    caseId: v.id("cases"),
    inspectorId: v.string(),       // Kinde user ID
    inspectorName: v.string(),
    status: inspectionStatus,

    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    notes: v.optional(v.string()),

    // Aggregate counters (denormalized for fast map queries)
    totalItems: v.number(),
    checkedItems: v.number(),
    damagedItems: v.number(),
    missingItems: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_status", ["status"])
    /**
     * by_case_status — compound index for per-case active inspection lookups.
     *
     * Enables O(log n + |results|) lookup when filtering inspections by both
     * caseId and status (e.g., "show me all in_progress inspections for CASE-007").
     * Used by:
     *   getActiveInspection       — find the open inspection for a case O(log n + 1)
     *   getChecklistWithInspection — locate in_progress inspection before fallback
     *   mutations/scan.ts          — check if an active inspection already exists
     *                                before auto-creating a new one on deployed transition
     *
     * Without this index, status-filtered lookups on inspections would require
     * a full by_case scan + in-memory filter. Cases with many historical
     * inspection passes (e.g., repeated field deployments) benefit significantly
     * from the O(log n + |active|) index path where |active| is typically 0 or 1.
     */
    .index("by_case_status", ["caseId", "status"]),

  /**
   * shipments — FedEx tracking entries for cases in transit.
   * Maps to M4 (Logistics Mode) on the dashboard.
   */
  shipments: defineTable({
    caseId: v.id("cases"),
    trackingNumber: v.string(),
    carrier: v.string(),          // "FedEx" (only carrier currently)
    status: shipmentStatus,

    // Route geometry
    originLat: v.optional(v.number()),
    originLng: v.optional(v.number()),
    originName: v.optional(v.string()),

    destinationLat: v.optional(v.number()),
    destinationLng: v.optional(v.number()),
    destinationName: v.optional(v.string()),

    // Last known position (from tracking updates)
    currentLat: v.optional(v.number()),
    currentLng: v.optional(v.number()),

    estimatedDelivery: v.optional(v.string()),  // ISO date string

    /**
     * Most recent FedEx scan event for this shipment.
     *
     * Populated by `updateShipmentStatus` when a FedEx tracking poll returns
     * event data.  The `events[0]` element (most recent event) from the
     * FedExTrackingResult is written here so the last known carrier activity
     * is readily accessible without loading the full event history from FedEx.
     *
     * Used by:
     *   - T4 Shipping panel's "Last Event" row
     *   - M4 logistics map pin tooltips
     *   - T5 Audit timeline "Tracking Events" section
     *
     * Undefined when no FedEx scan events have occurred yet (e.g., a shipment
     * that has a label created but has not yet been picked up by FedEx).
     */
    lastEvent: v.optional(v.object({
      /** ISO 8601 timestamp of the scan event (as returned by FedEx). */
      timestamp:   v.string(),
      /** Short FedEx event type code (e.g., "PU" = Picked Up, "OD" = Out for Delivery). */
      eventType:   v.string(),
      /** Human-readable description of the scan event. */
      description: v.string(),
      /** Location where the scan event occurred. */
      location: v.object({
        city:    v.optional(v.string()),
        state:   v.optional(v.string()),
        country: v.optional(v.string()),
      }),
    })),

    shippedAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_tracking", ["trackingNumber"])
    .index("by_status", ["status"]),

  /**
   * outboundShipments — hangar-created bundle of cases moving with one unit.
   *
   * This is distinct from `shipments`, which remains the per-case carrier/FedEx
   * tracking table. One outbound shipment can contain multiple physical cases.
   */
  outboundShipments: defineTable({
    unitId: v.id("units"),
    displayName: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("assembled"),
      v.literal("released"),
      v.literal("in_transit"),
      v.literal("delivered"),
      v.literal("cancelled"),
    ),
    originName: v.string(),
    destinationMissionId: v.optional(v.id("missions")),
    destinationName: v.optional(v.string()),
    destinationLat: v.optional(v.number()),
    destinationLng: v.optional(v.number()),
    recipientUserId: v.optional(v.string()),
    recipientName: v.optional(v.string()),
    caseIds: v.array(v.id("cases")),
    routeReason: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdBy: v.string(),
    createdByName: v.string(),
    releasedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_unit", ["unitId"])
    .index("by_status", ["status"])
    .index("by_updated", ["updatedAt"]),

  /**
   * shipping_updates — append-only log of FedEx tracking events.
   *
   * Each row represents a single scan/status update received from FedEx for
   * a tracked shipment.  Whereas `shipments` stores only the most recent
   * `lastEvent`, this table stores the full ordered history so that
   *
   *   - T4 Shipping panel can render the full event timeline,
   *   - T5 Audit timeline can reference exact tracking-level events,
   *   - M4 Logistics map can replay shipment movement over time.
   *
   * Rows are written exclusively by the FedEx tracking poller (see
   * `convex/actions/trackShipment.ts`) and are never mutated after insert.
   * One shipment maps to many shipping_updates.
   *
   * Required fields (per AC 350004 / Sub-AC 4):
   *   caseId, fedexTrackingId, status, timestamp, location
   *
   * Required indexes (per AC 350004 / Sub-AC 4):
   *   - by_case             on caseId           — list updates for a case
   *   - by_fedex_tracking   on fedexTrackingId  — list updates for a tracking #
   */
  shipping_updates: defineTable({
    /** The case this shipment update pertains to. */
    caseId: v.id("cases"),

    /**
     * FedEx tracking number for the shipment this update belongs to.
     *
     * Stored as a string (rather than a v.id reference to `shipments`) so that
     * polled tracking updates can be ingested even before the shipment row is
     * fully resolved, and so that downstream consumers can correlate by the
     * carrier-issued identifier directly.
     */
    fedexTrackingId: v.string(),

    /**
     * Tracking status reported by FedEx for this update.
     *
     * Reuses the same union as `shipments.status` so dashboard and SCAN
     * consumers can render both with the shared `<StatusPill />` component.
     */
    status: shipmentStatus,

    /** Epoch milliseconds when the FedEx scan/event occurred. */
    timestamp: v.number(),

    /**
     * Location where the FedEx scan/event was recorded.
     *
     * Fields mirror the structure used in `shipments.lastEvent.location` so
     * tracking events can be displayed identically across both surfaces.
     * All sub-fields are optional because FedEx may report partial location
     * data (e.g., country only) for international handoffs.
     */
    location: v.object({
      city:    v.optional(v.string()),
      state:   v.optional(v.string()),
      country: v.optional(v.string()),
      lat:     v.optional(v.number()),
      lng:     v.optional(v.number()),
    }),

    /** Short FedEx event type code (e.g., "PU", "OD") — optional context. */
    eventType:   v.optional(v.string()),
    /** Human-readable description of the FedEx scan event — optional context. */
    description: v.optional(v.string()),
  })
    .index("by_case", ["caseId"])
    .index("by_fedex_tracking", ["fedexTrackingId"])
    .index("by_case_timestamp", ["caseId", "timestamp"]),

  /**
   * events — immutable append-only audit timeline.
   * Each action on a case is recorded here in order.
   * Supports optional hash chain for FF_AUDIT_HASH_CHAIN.
   */
  events: defineTable({
    caseId: v.id("cases"),
    eventType: eventType,
    userId: v.string(),            // Kinde user ID
    userName: v.string(),
    timestamp: v.number(),         // epoch ms — used for ordering
    data: v.any(),                 // event-specific payload (typed per eventType)
    clientId: v.optional(v.string()),

    // Hash chain fields (populated when FF_AUDIT_HASH_CHAIN is enabled)
    hash: v.optional(v.string()),
    prevHash: v.optional(v.string()),
  })
    .index("by_case", ["caseId"])
    .index("by_case_timestamp", ["caseId", "timestamp"])
    .index("by_client_id", ["clientId"]),

  /**
   * custodyRecords — implements the SCAN app `custody_handoffs` entity.
   *
   * This table records every custody handoff between two Kinde users for a
   * specific case.  It is the canonical implementation of the `custody_handoffs`
   * SCAN app entity specified in the data model.  The table name `custodyRecords`
   * is used throughout the codebase; the semantic concept is "custody handoff".
   *
   * Each row captures a single transfer of physical case custody — when a field
   * technician hands a case to a pilot, or a pilot returns it to a logistics
   * coordinator.  Created during the SCAN app custody transfer workflow
   * (convex/custody.ts `handoffCustody` mutation).
   *
   * Relationship to other SCAN entities
   * ─────────────────────────────────────
   *   • scans             — a "handoff" scan event (scanContext = "handoff") creates
   *                         a scans row AND a custodyRecords row in sequence
   *   • events            — handoffCustody also appends a "custody_handoff" event
   *                         to the immutable events table for T5 audit chain
   *   • cases             — cases.assigneeId / assigneeName updated to the new holder
   *
   * Indexes
   * ───────
   *   by_case      — primary per-case lookup; used by getCustodyRecordsByCase
   *                  and getCustodyRecordsByParticipant (dedup union).
   *
   *   by_to_user   — real-time watcher for incoming custodian queries:
   *                  getCustodyRecordsByCustodian(toUserId) and
   *                  useCurrentCustodianCases() on the SCAN app dashboard.
   *                  Allows a field technician to subscribe to all cases they
   *                  have received custody of without a full table scan.
   *
   *   by_from_user — real-time watcher for outgoing custodian queries:
   *                  getCustodyRecordsByTransferrer(fromUserId).
   *                  Used for audit trails showing all handoffs initiated by a
   *                  specific user.
   *
   *   by_case_transferred_at — time-ordered per-case index:
   *                  getLatestCustodyRecord — O(log n + 1) single-row lookup for
   *                  the most recent handoff (.order("desc").first()).
   *                  getCustodyChain — O(log n + |records|) chronological scan
   *                  without in-memory sort (.order("asc")).
   */
  custodyRecords: defineTable({
    caseId: v.id("cases"),
    fromUserId: v.string(),
    fromUserName: v.string(),
    toUserId: v.string(),
    toUserName: v.string(),
    transferredAt: v.number(),
    notes: v.optional(v.string()),
    signatureStorageId: v.optional(v.string()),  // optional signature image
    clientId: v.optional(v.string()),
  })
    .index("by_case",      ["caseId"])
    .index("by_to_user",   ["toUserId"])
    .index("by_from_user", ["fromUserId"])
    /**
     * by_case_transferred_at — time-ordered custody chain index.
     *
     * Enables O(log n + 1) lookup of the MOST RECENT custody record for a
     * specific case by combining the caseId equality predicate with
     * descending order on transferredAt.
     *
     * Primary use case:
     *   getLatestCustodyRecord — instead of loading ALL custody records for the
     *   case (by_case index) and picking the maximum transferredAt in memory,
     *   callers can use:
     *     ctx.db.query("custodyRecords")
     *       .withIndex("by_case_transferred_at", q => q.eq("caseId", id))
     *       .order("desc")
     *       .first()
     *   This is O(log n + 1) vs the current O(log n + |records|) + in-memory max.
     *
     * Also used by:
     *   getCustodyChain — chronological ascending scan for T5 audit panel
     *   Time-range custody queries ("all transfers between T1 and T2 for case X")
     *
     * Particularly important for cases that change hands frequently (e.g., a
     * shared sensor kit that rotates between many field technicians over the
     * course of a multi-week deployment).
     */
    .index("by_case_transferred_at", ["caseId", "transferredAt"])
    .index("by_client_id", ["clientId"]),

  /**
   * custody_handoffs — canonical custody handoff event log per AC 350003 sub-AC 3.
   *
   * Each row represents a single custody handoff between two Kinde users for a
   * specific case.  The table is intentionally append-only: rows are inserted on
   * every confirmed handoff and never updated or deleted, so the table forms a
   * tamper-evident chain of custody for compliance reporting and the T5 audit
   * panel.
   *
   * Field shape is dictated by the acceptance criterion:
   *   • caseId      — Convex ID of the case that changed hands (mandatory)
   *   • fromUserId  — Kinde `sub` claim of the outgoing custody holder
   *   • toUserId    — Kinde `sub` claim of the incoming custody holder
   *   • timestamp   — epoch ms when the handoff occurred (client-side clock)
   *   • signature   — optional Convex storage ID for a captured signature image
   *   • location    — optional GPS / venue location at handoff time
   *
   * Relationship to the legacy `custodyRecords` table
   * ─────────────────────────────────────────────────
   * The richer `custodyRecords` table (defined above) was introduced earlier to
   * capture additional fields used by the SCAN-app handoff workflows
   * (fromUserName, toUserName, transferredAt, notes, signatureStorageId).  The
   * `custody_handoffs` table defined here is the canonical AC-defined event log
   * with the exact field names from the spec.  New custody ingestion paths
   * should write to BOTH tables until a migration consolidates them; queries
   * that only need the AC fields can read from `custody_handoffs` directly.
   *
   * The denormalised display-name fields (fromUserName, toUserName) are kept on
   * `custodyRecords` only — the AC-defined `custody_handoffs` row stores Kinde
   * IDs and resolves names client-side via the `users` table when needed.
   *
   * Indexes
   * ───────
   *   by_case_timestamp — AC-required compound index (caseId + timestamp).
   *                       Enables O(log n + |range|) lookups such as:
   *                         • "all handoffs for CASE-007 in the last 30 days"
   *                         • "most recent handoff for CASE-007" (desc + first)
   *                         • "first handoff after T0 for CASE-007"
   *                       Backs the T5 audit timeline and the case detail T2
   *                       "Currently held by" lookup.
   *
   *   by_to_user        — AC-required index on the incoming custodian's Kinde ID.
   *                       Enables O(log n + |results|) lookups for queries like:
   *                         • "all cases currently held by Alice" (latest row per
   *                           case where toUserId = Alice and not superseded)
   *                         • "everything Alice ever received custody of" (audit)
   *                       Backs the SCAN app "My Cases" tab and per-technician
   *                       contribution reports without a full table scan.
   *
   *   by_case           — convenience index for unbounded per-case lookups.
   *   by_from_user      — convenience index for unbounded outgoing-user lookups
   *                       (audit reports of all handoffs initiated by a user).
   *   by_timestamp      — fleet-wide chronological handoff feed for telemetry
   *                       and "no handoffs in the last N hours" alerting.
   */
  custody_handoffs: defineTable({
    /** Convex ID of the case that changed hands. */
    caseId:     v.id("cases"),

    /**
     * Kinde `sub` claim of the outgoing custody holder.
     * Always required — anonymous handoffs are not permitted.
     */
    fromUserId: v.string(),

    /**
     * Kinde `sub` claim of the incoming custody holder.
     * Always required — handoffs must have a named recipient.
     */
    toUserId:   v.string(),

    /**
     * Epoch milliseconds when the handoff occurred (client clock).
     * Used as the secondary key in the time-ordered indexes below.
     */
    timestamp:  v.number(),

    /**
     * Optional Convex file storage ID for a signature image captured at handoff.
     *
     * The SCAN app signing-pad workflow uploads the rendered signature PNG to
     * Convex storage and writes the resulting storage ID here.  Resolve to a
     * download URL client-side via the Convex `useStorageURL` hook or
     * server-side via `ctx.storage.getUrl(signature)`.
     *
     * Undefined when no signature was captured (e.g., remote handoffs or when
     * the technician opted out of the signature pad).
     */
    signature:  v.optional(v.string()),

    /**
     * Optional location captured at handoff time.
     *
     *   • lat / lng    — WGS-84 GPS fix (omitted when the device cannot
     *                    obtain a fix or the user denied geolocation).
     *   • name         — human-readable venue label (e.g.
     *                    "Site Alpha — Turbine Row 3" or "SkySpecs HQ — Bay 4").
     *   • accuracy     — optional GPS horizontal accuracy in meters as
     *                    reported by the browser Geolocation API.
     */
    location:   v.optional(
      v.object({
        lat:      v.optional(v.number()),
        lng:      v.optional(v.number()),
        name:     v.optional(v.string()),
        accuracy: v.optional(v.number()),
      })
    ),
    clientId: v.optional(v.string()),
  })
    /**
     * by_case_timestamp — AC-required compound index (caseId + timestamp).
     *
     * Enables O(log n + |range|) range queries on a case's custody chain,
     * including:
     *   • "all handoffs for CASE-007 in the last 30 days"
     *   • "most recent handoff for CASE-007"  (.order("desc").first())
     *   • "first handoff after T0 for CASE-007"
     *
     * Without this index, time-windowed per-case queries would require a
     * full by_case scan + in-memory sort.
     */
    .index("by_case_timestamp", ["caseId", "timestamp"])
    /**
     * by_to_user — AC-required index on the incoming custodian's Kinde ID.
     *
     * Enables O(log n + |results|) lookups for the SCAN app "My Cases" view
     * and audit reports listing every case a technician has received custody
     * of.  Without this index, the same lookup would require a full table
     * scan + in-memory filter.
     */
    .index("by_to_user",        ["toUserId"])
    /** Convenience: unbounded per-case handoff history (no time constraint). */
    .index("by_case",           ["caseId"])
    /**
     * by_from_user — convenience index on the outgoing custodian's Kinde ID.
     * Used for audit trails listing every handoff a user initiated.
     */
    .index("by_from_user",      ["fromUserId"])
    .index("by_client_id",      ["clientId"])
    /**
     * by_timestamp — fleet-wide time-ordered handoff feed.
     * Used by the dashboard "Recent Activity" rails, telemetry aggregations,
     * and operations monitoring ("no handoffs in the last N hours" alerts).
     */
    .index("by_timestamp",      ["timestamp"]),

  /**
   * notifications — in-app notification inbox.
   * No push / email — in-app only per constraints.
   */
  notifications: defineTable({
    userId: v.string(),            // Kinde user ID of recipient
    type: v.string(),              // e.g. "damage_reported", "shipment_delivered"
    title: v.string(),
    message: v.string(),
    caseId: v.optional(v.id("cases")),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "read"]),

  /**
   * damage_reports — dedicated table for damage photo submissions.
   *
   * Each row represents a single photo submitted via the SCAN app damage
   * reporting flow.  A damage report is always anchored to a case and
   * optionally linked to a manifest item (when the photo is attached to a
   * specific checklist item) or can be a standalone case-level photo.
   *
   * The T4 dashboard panel subscribes to getDamageReportsByCase which joins
   * this table with manifestItems to produce the unified DamageReport view.
   * The T5 audit panel subscribes to getDamageReportEvents which reads the
   * events table for the immutable audit trail.
   *
   * Convex re-evaluates all subscribed queries that read this table whenever
   * submitDamagePhoto inserts a new row — satisfying the ≤ 2-second real-time
   * fidelity requirement between SCAN app submission and dashboard visibility.
   *
   * AC 350002 sub-AC 2 mapping
   * ──────────────────────────
   * The acceptance criterion specifies fields { caseId, itemId, photos,
   * annotations, severity, reporterId } and indexes on caseId and itemId.
   * This table satisfies that contract with the following name mappings —
   * the implementation names are retained because they are referenced
   * throughout the SCAN app, T3/T4/T5 panels, and audit pipelines:
   *
   *   AC field name      → schema field name                semantics
   *   ──────────────────   ───────────────────────────────   ───────────────
   *   caseId             → caseId                           identical
   *   itemId             → manifestItemId                   FK to manifestItems
   *   photos             → photoStorageId  (one per row)    row-per-photo design
   *   annotations        → annotations                      identical
   *   severity           → severity                         identical
   *   reporterId         → reportedById                     Kinde sub claim
   *
   *   AC index name      → schema index name                indexed columns
   *   ──────────────────   ───────────────────────────────   ───────────────
   *   index on caseId    → by_case                          [caseId]
   *   index on itemId    → by_item                          [manifestItemId]
   *
   * The "row-per-photo" design for `photos` is intentional: every photo is its
   * own document so each photo can carry its own annotations, severity, and
   * audit attribution without an awkward parallel-array shape.  Querying "all
   * photos for an item" is cheap because of the by_item index.
   *
   * Fields
   * ──────
   *   caseId          — parent case (mandatory; AC `caseId`)
   *   photoStorageId  — Convex file storage ID for the uploaded photo
   *                     (AC `photos` — one storage ID per row)
   *   annotations     — optional array of pin-style annotations placed on the
   *                     photo by the technician in the SCAN app markup tool
   *   severity        — damage severity assessed by the technician
   *   reportedAt      — epoch ms when the photo was submitted
   *   manifestItemId  — optional link to the manifest item being reported
   *                     (AC `itemId`; FK to manifestItems table)
   *   templateItemId  — stable template item ID (for event correlation)
   *   reportedById    — Kinde user ID of the reporting technician (AC `reporterId`)
   *   reportedByName  — display name for attribution
   *   notes           — optional free-text notes entered alongside the photo
   */
  damage_reports: defineTable({
    caseId:          v.id("cases"),
    photoStorageId:  v.string(),   // Convex file storage ID
    annotations:     v.optional(
      v.array(
        v.object({
          /** Relative horizontal position (0–1 fraction of photo width). */
          x:     v.number(),
          /** Relative vertical position (0–1 fraction of photo height). */
          y:     v.number(),
          /** Annotation label text shown in the SCAN markup tool. */
          label: v.string(),
          /** Optional hex colour string for the annotation pin. */
          color: v.optional(v.string()),
        })
      )
    ),
    severity:        v.union(
      v.literal("minor"),
      v.literal("moderate"),
      v.literal("severe"),
    ),
    reportedAt:      v.number(),   // epoch ms

    // Optional link to the specific manifest item this photo documents.
    // Null for case-level photos not tied to a specific packing list item.
    manifestItemId:  v.optional(v.id("manifestItems")),
    templateItemId:  v.optional(v.string()),

    // Reporter attribution
    reportedById:    v.string(),   // Kinde user ID
    reportedByName:  v.string(),

    // Optional free-text notes entered with the photo
    notes:           v.optional(v.string()),
  })
    .index("by_case",             ["caseId"])
    .index("by_case_reported_at", ["caseId", "reportedAt"])
    /**
     * by_item — AC 350002 sub-AC 2 required index on the linked manifest item.
     *
     * The acceptance criterion calls for an index on `itemId`.  In this schema
     * the AC `itemId` corresponds to the `manifestItemId` foreign key (see the
     * field-mapping table in the table-level docstring above).  This index
     * enables O(log n + |results|) lookups of all damage photos attached to a
     * specific manifest item — for example:
     *
     *   • T2 Manifest panel: render the per-item damage thumbnail strip
     *     ("show me every damage photo filed for the battery pack").
     *   • SCAN app item detail screen: show prior damage history when a
     *     technician opens an item with previously reported damage.
     *   • T5 audit panel: surface a per-item evidence trail without joining
     *     through events.data parsing.
     *
     * Without this index, "all damage photos for item X" would require a full
     * by_case scan + in-memory filter on manifestItemId.  Cases with large
     * packing lists (50–100 items) and repeat damage reports benefit
     * significantly from the indexed path.
     *
     * Note: rows where manifestItemId is undefined (case-level photos not tied
     * to a manifest item) are excluded from this index — Convex automatically
     * skips rows with undefined indexed columns, which matches the desired
     * "photos for THIS item" query semantics.
     */
    .index("by_item",             ["manifestItemId"])
    /**
     * by_reported_by — index on the reporting technician's Kinde user ID.
     *
     * Enables O(log n + |results|) lookups when filtering damage reports by
     * reporter (e.g., "show me all damage photos submitted by Alice").
     * Used by:
     *   getDamageReportsByReporter           — all reports for a reporter
     *   getDamageReportsByReporterInRange    — same, scoped to a time window
     *
     * Without this index, by-reporter queries would require a full table scan
     * + in-memory filter, which becomes expensive as fleet damage volume grows.
     */
    .index("by_reported_by",      ["reportedById"])
    /**
     * by_reported_by_at — compound index on (reportedById, reportedAt).
     *
     * Enables O(log n + |range|) seeks for queries like "all damage reports
     * filed by Alice in the last 7 days".  Convex evaluates both the equality
     * predicate (reportedById) and the range bound (reportedAt) in the index
     * before materialising rows.
     *
     * Used by getDamageReportsByReporterInRange.
     */
    .index("by_reported_by_at",   ["reportedById", "reportedAt"])
    /**
     * by_reported_at — fleet-wide time-ordered damage report feed.
     *
     * Used by listDamageReportsByDateRange to scope fleet-wide results to a
     * time window without a full table scan.
     */
    .index("by_reported_at",      ["reportedAt"]),

  /**
   * scans — immutable log of every QR code scan performed by the SCAN mobile app.
   *
   * Each row captures a single scan event: which case was scanned, by whom,
   * when, and where.  The `scans` table is intentionally append-only (no updates
   * or deletes) so it serves as a reliable audit trail of physical case encounters.
   *
   * Relationship to other tables
   * ────────────────────────────
   *   • cases        — the scanned case (by caseId)
   *   • events       — scanCheckIn also appends a status_change event; the scans
   *                    table provides the raw scan history independently of status
   *                    changes (e.g., "same-status" check-ins still create a scan row)
   *   • inspections  — a scan that transitions to "deployed" auto-creates an
   *                    inspection; the inspectionId can be linked via scanContext
   *
   * Why a dedicated scans table?
   * ────────────────────────────
   * The `events` table records business-significant events (status transitions,
   * damage reports, custody handoffs).  The `scans` table records every scan
   * action regardless of whether a status change occurred — enabling queries like:
   *   "When was this case last physically seen and by whom?"
   *   "How many times has Alice scanned cases this week?"
   *   "List all scans in the last 24 hours for cases in transit"
   *
   * The `scanContext` field distinguishes why the scan was initiated:
   *   "check_in"   — scanCheckIn flow (transition status / confirm location)
   *   "inspection" — entering the inspection checklist workflow
   *   "handoff"    — beginning a custody handoff workflow
   *   "lookup"     — informational only (no action taken)
   *
   * Indexes
   * ───────
   *   by_case             — all scans for a specific case, primary per-case lookup
   *   by_case_scanned_at  — time-ordered scan history for a case (T5 timeline)
   *   by_user             — all scans performed by a specific user (SCAN app "My Activity")
   *   by_scanned_at       — fleet-wide recent scan feed (dashboard overview, telemetry)
   *
   * Convex re-evaluates all subscribed queries that read this table whenever a
   * new scan is inserted — satisfying the ≤ 2-second real-time fidelity requirement.
   */
  scans: defineTable({
    /** Convex ID of the case that was scanned. */
    caseId:        v.id("cases"),

    /** Raw QR code payload decoded by the SCAN app camera. */
    qrPayload:     v.string(),

    /** Kinde user ID of the technician who performed the scan. */
    scannedBy:     v.string(),

    /** Display name of the scanning technician (for UI attribution). */
    scannedByName: v.string(),

    /** Epoch ms when the scan occurred (client-side timestamp). */
    scannedAt:     v.number(),

    /**
     * GPS latitude at the time of scan.
     * May be omitted when the device could not obtain a GPS fix.
     */
    lat:           v.optional(v.number()),

    /**
     * GPS longitude at the time of scan.
     * May be omitted when the device could not obtain a GPS fix.
     */
    lng:           v.optional(v.number()),

    /**
     * Human-readable location name at time of scan.
     * E.g. "Site Alpha — Turbine Row 3" or "SkySpecs HQ — Bay 4".
     */
    locationName:  v.optional(v.string()),

    /**
     * Why the scan was initiated.
     * Used to correlate scans with the workflow they triggered.
     *   "check_in"   — status transition / location update
     *   "inspection" — entering the inspection checklist workflow
     *   "handoff"    — beginning a custody handoff workflow
     *   "lookup"     — informational scan with no workflow action
     */
    scanContext:   v.optional(v.string()),

    /**
     * Optional link to the inspection created or continued by this scan.
     * Populated when scanContext = "inspection" or when a check-in
     * transition to "deployed" auto-creates an inspection.
     */
    inspectionId:  v.optional(v.id("inspections")),

    /**
     * Device / browser metadata for diagnostics and telemetry.
     * Free-form JSON string — e.g., user agent, camera type.
     * Not indexed; used for support investigations only.
     */
    deviceInfo:    v.optional(v.string()),

    /** Client-generated idempotency key for offline replay. */
    clientId:      v.optional(v.string()),
  })
    /**
     * by_case — primary per-case scan lookup.
     * Used by: getScansByCase, getLastScanForCase, SCAN app scan history view.
     */
    .index("by_case",            ["caseId"])
    /**
     * by_case_scanned_at — time-ordered scan history for a single case.
     * Enables O(log n + |results|) range queries when filtering by both
     * caseId and a time window (e.g., "all scans for CASE-007 in the last 7 days").
     * Used by: T5 audit timeline, compliance reports.
     */
    .index("by_case_scanned_at", ["caseId", "scannedAt"])
    /**
     * by_user — all scans performed by a specific technician.
     * Used by: SCAN app "My Activity" tab, getCustodianIdentitySummary diagnostics.
     * Allows a technician to see their full scan history without a full table scan.
     */
    .index("by_user",            ["scannedBy"])
    /**
     * by_scanned_at — fleet-wide time-ordered scan feed.
     * Used by: dashboard overview "Recent Activity", telemetry aggregations,
     * operations monitoring ("no scans in the last N hours" alerts).
     */
    .index("by_scanned_at",      ["scannedAt"])
    .index("by_client_id",       ["clientId"]),

  /**
   * scan_events — canonical scan-event audit log per AC 350001 sub-AC 1.
   *
   * Each row represents a single QR-code scan performed by the SCAN mobile app.
   * The table is intentionally append-only: rows are inserted on every scan and
   * never updated or deleted, so the table accumulates a complete audit trail
   * of physical case encounters across the SkySpecs fleet.
   *
   * Field shape is dictated by the acceptance criterion:
   *   • caseId    — Convex ID of the case that was scanned (mandatory)
   *   • userId    — Kinde `sub` claim of the technician who performed the scan
   *   • timestamp — epoch ms when the scan occurred (client-side clock)
   *   • location  — optional GPS / venue location at the time of scan
   *   • scanType  — categorical reason the scan was initiated
   *
   * Relationship to the legacy `scans` table
   * ────────────────────────────────────────
   * The richer `scans` table (defined above) was introduced earlier to capture
   * additional fields used by SCAN-app workflows (qrPayload, scannedByName,
   * deviceInfo, scanContext, inspectionId, locationName, etc.).  The
   * `scan_events` table defined here is the canonical AC-defined event log
   * with the exact field names from the spec.  New scan ingestion paths should
   * write to BOTH tables until a migration consolidates them; queries that
   * only need the AC fields can read from `scan_events` directly.
   *
   * Indexes
   * ───────
   *   by_case_timestamp — primary per-case time-ordered scan history.
   *                       Required by AC sub-AC 1.  Enables O(log n + |range|)
   *                       lookups such as "all scans for CASE-007 in the last 7
   *                       days" without a full table scan.  Backs the T5 audit
   *                       timeline and the dashboard "Recent Scans" feed.
   *
   *   by_user_timestamp — per-technician time-ordered scan history.
   *                       Required by AC sub-AC 1.  Enables O(log n + |range|)
   *                       lookups such as "all scans by Alice today" for the
   *                       SCAN app "My Activity" tab and per-technician
   *                       contribution reports.
   *
   *   by_case           — convenience index for unbounded per-case lookups.
   *   by_user           — convenience index for unbounded per-user lookups.
   *   by_timestamp      — fleet-wide chronological scan feed for telemetry and
   *                       "no scans in the last N hours" alerting.
   */
  scan_events: defineTable({
    /** Convex ID of the case that was scanned. */
    caseId:    v.id("cases"),

    /**
     * Kinde `sub` claim of the technician who performed the scan.
     * Always required — anonymous scans are not permitted.
     */
    userId:    v.string(),

    /**
     * Epoch milliseconds when the scan occurred (client clock).
     * Used as the secondary key in the time-ordered indexes below.
     */
    timestamp: v.number(),

    /**
     * Optional location captured at scan time.
     *
     *   • lat / lng    — WGS-84 GPS fix (omitted when the device cannot
     *                    obtain a fix or the user denied geolocation).
     *   • name         — human-readable venue label (e.g.
     *                    "Site Alpha — Turbine Row 3" or "SkySpecs HQ — Bay 4").
     *   • accuracy     — optional GPS horizontal accuracy in meters as
     *                    reported by the browser Geolocation API.
     */
    location:  v.optional(
      v.object({
        lat:      v.optional(v.number()),
        lng:      v.optional(v.number()),
        name:     v.optional(v.string()),
        accuracy: v.optional(v.number()),
      })
    ),

    /**
     * Categorical reason the scan was initiated.
     *
     *   "check_in"   — status transition / location update flow.
     *   "inspection" — entering the manifest inspection checklist workflow.
     *   "handoff"    — beginning a custody handoff workflow.
     *   "lookup"     — informational scan with no workflow action.
     *   "shipping"   — preparing a case for FedEx shipment.
     *   "receiving"  — receiving a case back at base.
     */
    scanType:  v.union(
      v.literal("check_in"),
      v.literal("inspection"),
      v.literal("handoff"),
      v.literal("lookup"),
      v.literal("shipping"),
      v.literal("receiving"),
    ),
    clientId: v.optional(v.string()),
  })
    /**
     * by_case_timestamp — AC-required compound index (caseId + timestamp).
     *
     * Enables O(log n + |range|) range queries on a case's scan history,
     * including:
     *   • "all scans for CASE-007 in the last 7 days"
     *   • "most recent scan for CASE-007"  (.order("desc").first())
     *   • "first scan after T0 for CASE-007"
     *
     * Without this index, time-windowed per-case queries would require a
     * full by_case scan + in-memory sort.
     */
    .index("by_case_timestamp", ["caseId", "timestamp"])
    /**
     * by_user_timestamp — AC-required compound index (userId + timestamp).
     *
     * Enables O(log n + |range|) range queries on a technician's scan
     * history, including:
     *   • "all scans by Alice in the last 24 hours"
     *   • "most recent scan by Alice"  (.order("desc").first())
     *   • "scans by Alice between T0 and T1" for shift / contribution reports
     *
     * Without this index, per-user time-windowed queries would require a
     * full by_user scan + in-memory sort.
     */
    .index("by_user_timestamp", ["userId", "timestamp"])
    /** Convenience: unbounded per-case lookups (no time constraint). */
    .index("by_case",           ["caseId"])
    /** Convenience: unbounded per-user lookups (no time constraint). */
    .index("by_user",           ["userId"])
    /**
     * by_timestamp — fleet-wide time-ordered scan feed.
     * Used by dashboard "Recent Activity" rails, telemetry aggregations,
     * and operations monitoring ("no scans in the last N hours" alerts).
     */
    .index("by_timestamp",      ["timestamp"])
    .index("by_client_id",      ["clientId"]),

  /**
   * conditionNotes — structured SCAN condition flags.
   *
   * A condition note is the mobile-first form shown when a technician flags a
   * case, manifest item, or durable unit. Each row also has one immutable
   * `events` row so INVENTORY audit timelines can verify who saw what, when.
   */
  conditionNotes: defineTable({
    caseId: v.id("cases"),
    unitId: v.optional(v.id("units")),
    manifestItemId: v.optional(v.id("manifestItems")),
    eventId: v.optional(v.id("events")),
    component: v.union(
      v.literal("airframe"),
      v.literal("prop"),
      v.literal("battery"),
      v.literal("camera"),
      v.literal("controller"),
      v.literal("case"),
      v.literal("other"),
    ),
    severity: v.union(
      v.literal("info"),
      v.literal("minor"),
      v.literal("major"),
      v.literal("ground"),
    ),
    summary: v.string(),
    photoStorageIds: v.optional(v.array(v.string())),
    reportedById: v.string(),
    reportedByName: v.string(),
    reportedAt: v.number(),
    clientId: v.optional(v.string()),
  })
    .index("by_case", ["caseId"])
    .index("by_case_reported_at", ["caseId", "reportedAt"])
    .index("by_unit", ["unitId"])
    .index("by_unit_reported_at", ["unitId", "reportedAt"])
    .index("by_case_severity", ["caseId", "severity"])
    .index("by_client_id", ["clientId"]),

  /**
   * checklist_updates — immutable log of each manifest item state change.
   *
   * Each row captures a single update to one checklist item: the item that
   * changed, its previous state, its new state, and who made the change.
   * The `checklist_updates` table is append-only — it accumulates the full
   * history of how a case's packing list was inspected over time.
   *
   * Relationship to other tables
   * ────────────────────────────
   *   • manifestItems    — the CURRENT state of each item lives here;
   *                        checklist_updates records the HISTORY of state changes
   *   • cases            — parent case (via caseId)
   *   • inspections      — the inspection pass under which the update occurred
   *   • damage_reports   — when newStatus = "damaged" and photos are attached,
   *                        a damage_reports row is also created by the SCAN app
   *   • events           — updateChecklistItem also appends item_checked /
   *                        damage_reported to events; checklist_updates provides
   *                        a typed, queryable view of the same history
   *
   * Why a dedicated checklist_updates table?
   * ─────────────────────────────────────────
   * The `manifestItems` table holds the CURRENT state of each item; querying it
   * shows where things stand NOW but not how they got there.  The `events` table
   * holds the history but in a polymorphic `data: any` blob that requires
   * application-level parsing.  The `checklist_updates` table provides:
   *   1. Strongly-typed query access to per-item state history
   *   2. Efficient compound indexes for "all updates to item X" or "all updates
   *      in status 'damaged' for case Y" without parsing event blobs
   *   3. A reactive subscription target — the SCAN app can subscribe to
   *      "updates for this item" and see real-time changes from other users
   *
   * Indexes
   * ───────
   *   by_case              — all checklist updates for a case (T5 audit panel)
   *   by_case_updated_at   — time-ordered update history for a case
   *   by_manifest_item     — all updates for a specific manifest item
   *   by_case_template     — updates for a specific item (by templateItemId) in a case;
   *                          used when the manifestItemId is not yet resolved
   *   by_user              — all updates made by a specific technician
   *   by_case_new_status   — all updates within a case filtered by new status;
   *                          e.g., "all items marked damaged for CASE-007"
   *
   * Convex re-evaluates all subscribed queries that read this table whenever a
   * new update is inserted — providing live checklist progress in both the SCAN
   * app and the INVENTORY dashboard within the ≤ 2-second fidelity window.
   */
  checklist_updates: defineTable({
    /** Convex ID of the parent case. */
    caseId:          v.id("cases"),

    /**
     * Convex ID of the manifest item that was updated.
     * Links this update to the current state row in `manifestItems`.
     */
    manifestItemId:  v.id("manifestItems"),

    /**
     * Stable template item identifier (from caseTemplates.items[].id).
     * Preserved here so the history row can correlate with the template
     * even if the manifestItems row is ever replaced (e.g., template re-applied).
     */
    templateItemId:  v.string(),

    /**
     * Display name of the checklist item at the time of the update.
     * Denormalized so the history row is self-contained and readable without
     * joining to manifestItems or caseTemplates.
     */
    itemName:        v.string(),

    /**
     * Item inspection state BEFORE this update.
     * Enables "undo" UX and diff views in the T5 audit panel.
     */
    previousStatus:  v.union(
      v.literal("unchecked"),
      v.literal("ok"),
      v.literal("damaged"),
      v.literal("missing"),
    ),

    /**
     * Item inspection state AFTER this update.
     * The new state written to manifestItems.status by the same mutation.
     */
    newStatus:       v.union(
      v.literal("unchecked"),
      v.literal("ok"),
      v.literal("damaged"),
      v.literal("missing"),
    ),

    /** Kinde user ID of the technician who made this update. */
    updatedBy:       v.string(),

    /** Display name of the technician (for UI attribution). */
    updatedByName:   v.string(),

    /** Epoch ms when the update was submitted by the SCAN app. */
    updatedAt:       v.number(),

    /**
     * Optional technician notes entered alongside the status change.
     * Copied from the mutation args; same value written to manifestItems.notes.
     */
    notes:           v.optional(v.string()),

    /**
     * Convex file storage IDs for photos attached to this update.
     * Populated when the technician attached damage photos in the SCAN app.
     * Same value written to manifestItems.photoStorageIds.
     */
    photoStorageIds: v.optional(v.array(v.string())),

    /**
     * Structured damage description (only meaningful when newStatus = "damaged").
     * Free-text entered by the technician in the SCAN damage report form.
     */
    damageDescription: v.optional(v.string()),

    /**
     * Damage severity level (only meaningful when newStatus = "damaged").
     * Values: "minor" | "moderate" | "severe"
     */
    damageSeverity:  v.optional(v.string()),

    /**
     * Optional link to the inspection pass under which this update was made.
     * Populated when an active inspection exists for the case at update time.
     * Enables queries like "all updates during inspection X".
     */
    inspectionId:    v.optional(v.id("inspections")),

    /** Client-generated idempotency key for offline replay. */
    clientId:        v.optional(v.string()),
  })
    /**
     * by_case — all checklist updates for a case.
     * Primary lookup for the T5 audit panel and SCAN app update history.
     * Used by: getChecklistUpdatesByCase, getChecklistUpdateHistory.
     */
    .index("by_case",           ["caseId"])
    /**
     * by_case_updated_at — time-ordered update history for a case.
     * Enables O(log n + |results|) range queries on time windows.
     * Used by: T5 timeline, "show updates in the last N hours", compliance reports.
     */
    .index("by_case_updated_at", ["caseId", "updatedAt"])
    /**
     * by_manifest_item — all updates for a specific manifest item.
     * Enables per-item history subscription: "show me every state change for
     * this battery pack item".  Used by the SCAN app item detail view and the
     * T4 dashboard damage panel's per-item audit trail.
     */
    .index("by_manifest_item",  ["manifestItemId"])
    /**
     * by_case_template — updates for a specific item (by templateItemId) in a case.
     * Compound index enables O(log n + |results|) lookup of all state changes
     * for one template item within one case — useful when the manifestItemId
     * is unknown (e.g., historical queries before manifestItems was populated).
     */
    .index("by_case_template",  ["caseId", "templateItemId"])
    /**
     * by_user — all checklist updates made by a specific technician.
     * Used by: SCAN app "My Activity" tab, technician contribution reports.
     * Allows O(log n + |results|) lookup without a full table scan.
     */
    .index("by_user",           ["updatedBy"])
    /**
     * by_case_new_status — all updates in a case filtered by new status.
     * Enables efficient reactive queries like "subscribe to all items marked
     * damaged for CASE-007 as they come in" — the T4 damage panel uses this.
     * Without this index, the query would require loading all updates for the
     * case and filtering in memory.
     */
    .index("by_case_new_status", ["caseId", "newStatus"])
    .index("by_client_id", ["clientId"]),

  /**
   * users — verified SkySpecs users, created on first Kinde login.
   *
   * Every record is backed by a valid Kinde JWT whose signature has been
   * verified against the Kinde JWKS endpoint.  The `kindeId` field is the
   * stable sub claim from the JWT and is the canonical user identifier used
   * throughout the database (assigneeId, inspectorId, userId in events, etc.).
   *
   * The record is upserted on every successful auth sync so that profile
   * changes in Kinde (name, email, role) are reflected here without requiring
   * a full re-registration.
   *
   * Fields
   * ──────
   *   kindeId    — Kinde `sub` claim (stable, never changes)
   *   email      — user email from the `email` JWT claim
   *   givenName  — first name from the `given_name` JWT claim
   *   familyName — last name from the `family_name` JWT claim
   *   name       — display name (given + family, or email fallback)
   *   picture    — avatar URL from the `picture` JWT claim
   *   orgCode    — Kinde organization code the user belongs to
   *   roles      — Kinde roles assigned to this user
   *   lastLoginAt — epoch ms of the most recent auth sync
   *   createdAt  — epoch ms when the record was first created
   *   updatedAt  — epoch ms when the record was last updated
   */
  users: defineTable({
    kindeId:     v.string(),              // Kinde `sub` claim
    email:       v.string(),
    givenName:   v.optional(v.string()),
    familyName:  v.optional(v.string()),
    name:        v.string(),              // display name
    picture:     v.optional(v.string()), // avatar URL
    orgCode:     v.optional(v.string()), // Kinde org code
    roles:       v.optional(v.array(v.string())),

    /**
     * role — resolved system-wide role for this user.
     *
     * Derived from the Kinde JWT `roles` claim by `upsertUser` on each login
     * sync (highest-privilege role wins: admin > operator > technician > pilot).
     * Optional so that legacy / pre-role-assignment records remain valid until
     * their next login sync.
     *
     * The raw `roles` array from Kinde is kept for audit purposes and multi-role
     * edge-cases; this field is the single "effective role" used by RBAC guards
     * and UI role-gate components.
     */
    role: v.optional(userRole),

    /**
     * status — user account lifecycle state.
     *
     * Defaults to "active" for all users created by `upsertUser` (i.e., users
     * who have completed at least one successful Kinde login).  Can be set to
     * "inactive" by an admin to suspend access without deleting the record.
     * "pending" is reserved for invited users who have not yet completed their
     * first Kinde login.
     */
    status: v.optional(userStatus),

    lastLoginAt: v.number(),              // epoch ms
    createdAt:   v.number(),
    updatedAt:   v.number(),

    /**
     * themePreference — persisted dark/light mode choice for this user.
     *
     * Written by `setMyThemePreference` (called from the ConvexThemeSync
     * component whenever the user toggles the theme).  Read by
     * `getMyThemePreference` on auth resolution to restore the user's
     * last-saved preference across sessions and devices.
     *
     * Intentionally NOT updated by `upsertUser` so that profile syncs on
     * login never accidentally reset a manually-chosen theme.
     *
     * When undefined (new users, or users who have never explicitly toggled),
     * the client falls back to the OS `prefers-color-scheme` media query.
     */
    themePreference: v.optional(
      v.union(v.literal("light"), v.literal("dark"))
    ),

    /**
     * invDensityPreference — persisted comfy/compact density choice for the
     * INVENTORY dashboard.
     *
     * Written by `setMyDensityPreference` (called from the ConvexDensitySync
     * component whenever the INVENTORY density changes).  Read by
     * `getMyDensityPreferences` on auth resolution to restore the user's
     * last-saved preference across sessions and devices.
     *
     * When undefined, the client falls back to localStorage or the default "comfy".
     */
    invDensityPreference: v.optional(
      v.union(v.literal("comfy"), v.literal("compact"))
    ),

    /**
     * scanDensityPreference — persisted comfy/compact density choice for the
     * SCAN mobile app.
     *
     * Same lifecycle as invDensityPreference but for the /scan/* routes.
     * Independent from invDensityPreference — the two apps have separate
     * density preferences.
     */
    scanDensityPreference: v.optional(
      v.union(v.literal("comfy"), v.literal("compact"))
    ),
  })
    .index("by_kinde_id", ["kindeId"])
    .index("by_email",    ["email"]),

  /**
   * userPreferences — per-user layout preference store.
   *
   * Persists the INVENTORY dashboard and SCAN app layout choices for each
   * authenticated user across sessions and devices.  Unlike the simple scalar
   * preference fields on the `users` table (themePreference, invDensityPreference,
   * scanDensityPreference), this table holds structured layout state that would
   * be awkward to flatten into scalar columns.
   *
   * One row per user.  The row is upserted (created on first save, patched on
   * subsequent saves) by the `setMyLayoutPreferences` mutation, which is called
   * whenever the user changes their active map mode or case layout.  The row is
   * read by `getMyLayoutPreferences` on auth resolution so the client can restore
   * the user's last-saved preferences across browser sessions and devices — a
   * richer guarantee than localStorage alone (which is device-local).
   *
   * Relationship to localStorage
   * ─────────────────────────────
   * The `layout-storage.ts` helpers (readMapMode / writeMapMode / readCaseLayout /
   * writeCaseLayout) provide fast, synchronous, SSR-safe access to the SAME
   * values via localStorage.  This Convex table acts as the cross-device source
   * of truth.  The recommended reconciliation strategy is:
   *   1. On page load: read from localStorage for immediate hydration.
   *   2. When the Convex query resolves: overwrite with the Convex value if it
   *      differs (Convex wins for cross-device sync).
   *   3. On user change: write to both localStorage AND Convex.
   *
   * layoutPreferences fields
   * ─────────────────────────
   *   activeMapMode     — which INVENTORY map view is active ("M1"–"M5").
   *                       M1 = Fleet Overview, M2 = Site Detail,
   *                       M3 = Transit Tracker, M4 = Heat Map,
   *                       M5 = Mission Control (behind FF_MAP_MISSION).
   *
   *   activeCaseLayout  — which case detail panel is active ("T1"–"T5").
   *                       T1 = Summary, T2 = Manifest, T3 = Inspection History,
   *                       T4 = Shipping & Custody, T5 = Audit Hash Chain
   *                       (T5 behind FF_AUDIT_HASH_CHAIN).
   *
   *   layerToggles      — which INVENTORY map overlay layers are currently
   *                       enabled.  Mirrors the LayerEngine's toggle state so
   *                       the user's preferred overlay configuration is restored
   *                       on next visit.  Each key is a SemanticLayerId.
   *
   *   sidebarCollapsed  — whether the INVENTORY side navigation panel is
   *                       collapsed.  Separate from density preference; this is
   *                       purely a layout visibility toggle.
   *
   *   lastViewedCaseId  — Convex ID of the case last open in the detail panel.
   *                       Allows deep-linking restoration: if the user closes and
   *                       reopens the dashboard, the last-viewed case is
   *                       re-selected automatically.
   *
   * Indexes
   * ───────
   *   by_user_id — primary per-user lookup (O(1) point read by Kinde user ID).
   *                The only index needed; one row per user means no range queries.
   */
  userPreferences: defineTable({
    /** Kinde `sub` claim — stable user identifier. Primary lookup key. */
    userId: v.string(),

    /**
     * Structured layout preference bag.
     *
     * All sub-fields are optional so the object can be partially populated
     * (e.g., only `activeMapMode` is stored on a fresh account, other fields
     * arrive as the user interacts with the dashboard).  Callers must apply
     * explicit fallback defaults when a field is absent.
     */
    layoutPreferences: v.object({
      /**
       * Active INVENTORY map mode.
       * "M1" Fleet Overview · "M2" Site Detail · "M3" Transit Tracker ·
       * "M4" Heat Map · "M5" Mission Control (FF_MAP_MISSION)
       */
      activeMapMode: v.optional(
        v.union(
          v.literal("M1"),
          v.literal("M2"),
          v.literal("M3"),
          v.literal("M4"),
          v.literal("M5"),
        )
      ),

      /**
       * Active case detail panel layout.
       * "T1" Summary · "T2" Manifest · "T3" Inspection History ·
       * "T4" Shipping & Custody · "T5" Audit Hash Chain (FF_AUDIT_HASH_CHAIN)
       */
      activeCaseLayout: v.optional(
        v.union(
          v.literal("T1"),
          v.literal("T2"),
          v.literal("T3"),
          v.literal("T4"),
          v.literal("T5"),
        )
      ),

      /**
       * Per-layer toggle state for the INVENTORY map overlay engine.
       * Keys correspond to SemanticLayerIds defined in the LayerEngine.
       * A `true` value means the layer is visible; `false` means hidden.
       * When a key is absent, the layer's default visibility applies.
       */
      layerToggles: v.optional(
        v.object({
          /** Cases currently deployed at field sites. */
          deployed:  v.optional(v.boolean()),
          /** Cases in transit (inbound or outbound). */
          transit:   v.optional(v.boolean()),
          /** Full fleet overview (all case pins). */
          fleet:     v.optional(v.boolean()),
          /** Damage / flagged case indicators. */
          damage:    v.optional(v.boolean()),
          /** Wind turbine / inspection site markers. */
          turbines:  v.optional(v.boolean()),
          /** Status density heat map overlay. */
          heatmap:   v.optional(v.boolean()),
          /** Mission zone polygons (M5 / FF_MAP_MISSION). */
          missions:  v.optional(v.boolean()),
        })
      ),

      /**
       * Whether the INVENTORY side navigation panel is collapsed.
       * Defaults to `false` (expanded) when absent.
       */
      sidebarCollapsed: v.optional(v.boolean()),

      /**
       * Convex document ID (as string) of the case most recently open in the
       * INVENTORY detail panel.  Stored as a plain string (not a typed v.id)
       * so that stale IDs (deleted cases) do not cause schema validation errors.
       * The consumer must call `ctx.db.get` and handle the `null` case.
       */
      lastViewedCaseId: v.optional(v.string()),
    }),

    /** Epoch ms when this row was last written. */
    updatedAt: v.number(),
  })
    /**
     * by_user_id — primary per-user point lookup.
     * Used by: getMyLayoutPreferences (query), setMyLayoutPreferences (mutation).
     * One row per user; no range queries needed.
     */
    .index("by_user_id", ["userId"]),

  /**
   * organizations — internal staff groups and contractor / partner organizations.
   *
   * SkySpecs operates with a single-tenant architecture where all organizations
   * share the same database.  An organization is a logical grouping of people
   * (not a data-isolation boundary).
   *
   * The two canonical types are:
   *   "internal"    — SkySpecs teams: operations, logistics, engineering, etc.
   *                   Examples: "Ops Team", "Field Logistics", "Engineering"
   *
   *   "contractor"  — External companies or independent contractors that perform
   *                   on-site inspections, case transport, or other field work
   *                   on behalf of SkySpecs.
   *                   Examples: "Apex Aerial Services", "Midwest Wind Contractors"
   *
   * Users belong to one or more organizations via the `orgMemberships` table.
   * The `orgType` field drives display classification in the M1 org filter
   * and the Organization Management admin UI (AC 22).
   *
   * Fields
   * ──────
   *   name          — display name of the organization (unique per orgType)
   *   orgType       — "internal" | "contractor"
   *   description   — optional longer description / notes
   *   isActive      — soft-delete flag; inactive orgs are hidden from selectors
   *                   but retained for historical membership / audit purposes
   *   contactName   — optional primary contact for contractor organizations
   *   contactEmail  — optional contact email for contractor organizations
   *   kindeOrgCode  — optional Kinde organization code for SSO-linked orgs
   *   createdAt     — epoch ms when the record was created
   *   updatedAt     — epoch ms when the record was last updated
   *
   * Indexes
   * ───────
   *   by_type       — list all organizations of a given type (admin org list)
   *   by_active     — filter to active organizations (field selectors, dropdowns)
   *   by_type_active — compound: active orgs by type (most common query pattern)
   *   by_name       — alphabetical sort / name-based lookup
   *   by_updated    — ordered iteration for admin UI and export
   */
  organizations: defineTable({
    /** Display name of the organization, e.g. "Apex Aerial Services". */
    name:          v.string(),

    /**
     * Logical type of organization.
     *   "internal"   — SkySpecs internal staff / teams
     *   "contractor" — external company or independent contractor
     */
    orgType:       orgType,

    /** Optional longer description or notes about the organization. */
    description:   v.optional(v.string()),

    /**
     * Whether this organization is active.
     * Inactive organizations are hidden from membership selectors and org
     * filter dropdowns but retained for historical audit trails.
     * Soft-delete: always use isActive = false instead of deleting.
     */
    isActive:      v.boolean(),

    /**
     * Primary point of contact for contractor organizations.
     * Used by the admin UI "Org Details" panel for operational outreach.
     * Not applicable for internal organizations (undefined).
     */
    contactName:   v.optional(v.string()),

    /**
     * Contact email for contractor organizations.
     * Used for notifications and escalation routing (in-app only).
     */
    contactEmail:  v.optional(v.string()),

    /**
     * Kinde organization code if this organization is linked to a Kinde SSO org.
     *
     * When set, users whose Kinde JWT carries this orgCode are automatically
     * considered members of this organization on first login sync (see
     * convex/auth.ts `upsertUser` flow).
     *
     * Can be left undefined for organizations managed manually through the
     * admin UI without Kinde SSO organization linkage.
     */
    kindeOrgCode:  v.optional(v.string()),

    /** Epoch ms when this record was created. */
    createdAt:     v.number(),
    /** Epoch ms when this record was last updated. */
    updatedAt:     v.number(),
  })
    /**
     * by_type — list all organizations of a given type.
     * Used by: admin org list (filter by internal / contractor), M1 org filter
     * dropdown to scope case pins by organization type.
     */
    .index("by_type",        ["orgType"])
    /**
     * by_active — filter to active organizations only.
     * Used by: field selectors (case assignee org picker), handoff recipient
     * org picker, user management org assignment dropdown.
     */
    .index("by_active",      ["isActive"])
    /**
     * by_type_active — most common query pattern: active orgs of a specific type.
     * Enables O(log n + |results|) lookups for "list all active contractor orgs"
     * without loading inactive orgs or filtering in memory.
     */
    .index("by_type_active", ["orgType", "isActive"])
    /**
     * by_name — alphabetical lookup / name-based search.
     * Used by: admin org search, de-duplicate-on-create guard.
     */
    .index("by_name",        ["name"])
    /**
     * by_updated — ordered iteration for admin UI and bulk export.
     * Returns most-recently-updated orgs first when no type filter is applied.
     */
    .index("by_updated",     ["updatedAt"]),

  /**
   * orgMemberships — user-to-organization membership records.
   *
   * Each row represents a single user's membership in a single organization.
   * A user can belong to multiple organizations (e.g., a field technician who
   * works for both "Ops Team" and a contractor org on a specific mission).
   *
   * The `role` field is the ORGANIZATION-SCOPED role (distinct from the
   * system-wide Kinde role stored in `users.roles`):
   *   org_admin — manages organization membership and details for this org only
   *   member    — standard member; can be assigned as case custodian / team member
   *
   * Membership lifecycle
   * ─────────────────────
   *   • Created by an admin when assigning a user to an organization.
   *   • `isActive = false` (soft removal) when a user leaves; the row is retained
   *     for historical audit (custody records, mission participation history).
   *   • `endedAt` is stamped when isActive transitions to false, enabling
   *     duration-based reports ("how long was Alice a member of Org X?").
   *
   * Relationship to system roles
   * ─────────────────────────────
   *   System roles (admin, technician, pilot) live on `users.roles` and are
   *   managed in the Kinde dashboard.  Organization roles (org_admin, member)
   *   are Convex-side and control who can manage each org's membership list.
   *   The two role systems are independent.
   *
   * Fields
   * ──────
   *   kindeId    — Kinde `sub` claim; FK to users.kindeId
   *   orgId      — FK to organizations._id
   *   role       — organization-scoped role (org_admin | member)
   *   isActive   — whether the membership is currently active
   *   startedAt  — epoch ms when membership became active
   *   endedAt    — epoch ms when membership ended (undefined = still active)
   *   notes      — optional context (e.g., "contractor for Mission Alpha 2026")
   *   addedById  — Kinde user ID of the admin who added this member
   *   createdAt  — epoch ms when the row was created
   *   updatedAt  — epoch ms when the row was last updated
   *
   * Indexes
   * ───────
   *   by_org           — all members (active + inactive) for an organization.
   *   by_user          — all organizations a user has ever belonged to.
   *   by_org_user      — unique membership lookup: O(1) check "is user X in org Y?".
   *   by_org_active    — active members of an organization (most common field query).
   *   by_user_active   — active organizations for a user (user profile / selector).
   *   by_org_role      — all org_admins or all members in an org (admin UI).
   *   by_updated       — ordered iteration for admin UI and bulk export.
   */
  orgMemberships: defineTable({
    /**
     * Kinde `sub` claim of the member user.
     * Foreign key to users.kindeId — must exist in the `users` table before
     * a membership row is created.
     */
    kindeId:   v.string(),

    /**
     * Convex document ID of the organization.
     * Foreign key to organizations._id.
     */
    orgId:     v.id("organizations"),

    /**
     * Organization-scoped role for this membership.
     *   org_admin — can manage this org's membership list
     *   member    — standard member
     */
    role:      orgRole,

    /**
     * Whether this membership is currently active.
     * Set to false (soft-remove) when a user leaves the organization.
     * Rows are never hard-deleted so membership history is preserved.
     */
    isActive:  v.boolean(),

    /**
     * Epoch ms when this membership became active.
     * Typically the createdAt of the row, but can be back-dated for imports.
     */
    startedAt: v.number(),

    /**
     * Epoch ms when this membership ended.
     * Undefined when the membership is still active.
     * Stamped when isActive transitions from true to false.
     */
    endedAt:   v.optional(v.number()),

    /**
     * Optional contextual notes for this membership.
     * Examples: "On-site for Mission Alpha 2026", "Primary FedEx contact for west region"
     */
    notes:     v.optional(v.string()),

    /**
     * Kinde user ID of the admin who created this membership row.
     * Used for audit trail: "who added Alice to Apex Aerial Services?"
     */
    addedById: v.optional(v.string()),

    /** Epoch ms when this row was created. */
    createdAt: v.number(),
    /** Epoch ms when this row was last updated. */
    updatedAt: v.number(),
  })
    /**
     * by_org — all members of an organization (active + historical).
     * Used by: admin org member list, membership export, audit reports.
     */
    .index("by_org",        ["orgId"])
    /**
     * by_user — all organizations a user has ever belonged to.
     * Used by: user profile "Organizations" section, custody assignment context.
     */
    .index("by_user",       ["kindeId"])
    /**
     * by_org_user — unique membership point lookup.
     * Enables O(log n) check "is user X currently a member of org Y?" and
     * prevents duplicate membership rows on add.
     * Used by: addOrgMember guard, membership status display.
     */
    .index("by_org_user",   ["orgId", "kindeId"])
    /**
     * by_org_active — active members of an organization.
     * The most common membership query: "who is currently in Org X?".
     * Filters in-index so inactive historical rows are excluded without
     * a full by_org scan + in-memory filter.
     */
    .index("by_org_active", ["orgId", "isActive"])
    /**
     * by_user_active — active organizations for a user.
     * Used by: user profile, field assignment dropdowns ("which orgs does Alice
     * belong to right now?"), org filter on the INVENTORY dashboard.
     */
    .index("by_user_active", ["kindeId", "isActive"])
    /**
     * by_org_role — list all org_admins or all members in an organization.
     * Used by: admin UI "Admins" sub-tab, notification routing to org admins.
     */
    .index("by_org_role",   ["orgId", "role"])
    /**
     * by_updated — ordered iteration for admin UI and bulk export.
     */
    .index("by_updated",    ["updatedAt"]),

  /**
   * turbines — wind turbine site markers for the INVENTORY map turbines overlay.
   *
   * Each row represents a single wind turbine (or turbine pad) that is a
   * potential or active deployment target for SkySpecs inspection cases.
   * Records are rendered as map markers on the turbines overlay layer (toggled
   * via the `turbines` SemanticLayerId in the LayerEngine).
   *
   * The `missionId` field links a turbine to a specific deployment mission,
   * enabling the M1 org filter to scope turbine markers alongside case pins.
   *
   * Fields
   * ──────
   *   name          — turbine/pad identifier (e.g. "T-042", "Row 3 North")
   *   lat           — WGS-84 latitude
   *   lng           — WGS-84 longitude
   *   missionId     — optional link to a missions document (for scoping)
   *   siteCode      — optional short site code (e.g. "SITE-A")
   *   status        — operational status of the turbine
   *   hubHeight     — tower hub height in meters (for tooltip metadata)
   *   rotorDiameter — rotor diameter in meters (for tooltip metadata)
   *   notes         — optional free-text notes
   *   createdAt     — epoch ms when the record was created
   *   updatedAt     — epoch ms when the record was last updated
   *
   * Indexes
   * ───────
   *   by_mission — scope turbine markers to a mission for the org filter
   *   by_status  — filter by operational status (active/inactive/decommissioned)
   *   by_updated — ordered iteration for admin UI and export
   */
  turbines: defineTable({
    /** Turbine/pad display identifier, e.g. "T-042" or "Row 3 North". */
    name:          v.string(),
    /** WGS-84 latitude of the turbine base. */
    lat:           v.number(),
    /** WGS-84 longitude of the turbine base. */
    lng:           v.number(),
    /** Optional link to a missions document (scope marker to one deployment). */
    missionId:     v.optional(v.id("missions")),
    /** Optional short site code for grouping turbines by wind farm / sub-site. */
    siteCode:      v.optional(v.string()),
    /** Operational status. */
    status:        v.union(
      v.literal("active"),           // turbine in active inspection rotation
      v.literal("inactive"),         // temporarily out of rotation
      v.literal("decommissioned"),   // permanently retired
    ),
    /** Hub height in meters (informational, shown in tooltip). */
    hubHeight:     v.optional(v.number()),
    /** Rotor diameter in meters (informational, shown in tooltip). */
    rotorDiameter: v.optional(v.number()),
    /** Optional operator notes. */
    notes:         v.optional(v.string()),
    /** Epoch ms when this record was created. */
    createdAt:     v.number(),
    /** Epoch ms when this record was last updated. */
    updatedAt:     v.number(),
  })
    .index("by_mission", ["missionId"])
    .index("by_status",  ["status"])
    .index("by_updated", ["updatedAt"]),

  /**
   * qcSignOffs — quality-control sign-off history for cases.
   *
   * Each row represents a single QC sign-off action performed on a case.
   * The table is append-only: every sign-off submission (approve / reject /
   * revoke) creates a new row so that the full audit trail of QC decisions
   * is preserved for compliance and the T5 audit chain.
   *
   * The LATEST sign-off state is also denormalized onto the `cases` table
   * (qcSignOffStatus, qcSignedOffBy, qcSignedOffByName, qcSignedOffAt,
   * qcSignOffNotes) for zero-join dashboard rendering.  The `qcSignOffs`
   * table provides the historical record.
   *
   * Status lifecycle
   * ────────────────
   *   pending  — initial state; no action taken yet, or the previous decision
   *              was revoked.  A "pending" row is written when a sign-off is
   *              explicitly reset/revoked by an admin.
   *   approved — QC reviewer verified the case is ready for deployment/shipping.
   *   rejected — QC reviewer identified issues requiring rework before deploy.
   *
   * Fields
   * ──────
   *   caseId        — parent case (mandatory)
   *   status        — QC decision: "pending" | "approved" | "rejected"
   *   signedOffBy   — Kinde user ID of the reviewer
   *   signedOffByName — display name (denormalized for rendering)
   *   signedOffAt   — epoch ms when the action was taken
   *   notes         — optional reviewer notes / rejection reason
   *   previousStatus — status before this sign-off (for audit diff views)
   *   inspectionId  — optional link to the inspection that triggered the QC review
   *
   * Indexes
   * ───────
   *   by_case            — all sign-off records for a case (T5 audit trail)
   *   by_case_signed_at  — time-ordered per-case sign-off history
   *   by_signer          — all sign-off actions by a specific reviewer
   *   by_status          — fleet-wide filter by QC decision status
   *   by_signed_at       — fleet-wide chronological QC activity feed
   */
  qcSignOffs: defineTable({
    /** Convex ID of the case this sign-off is for. */
    caseId: v.id("cases"),

    /**
     * QC decision recorded by this sign-off action.
     *   "pending"  — explicit reset / revocation of a prior decision
     *   "approved" — case is cleared for deployment / shipping
     *   "rejected" — case requires rework; block deployment / shipping
     */
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),

    /**
     * Kinde `sub` claim of the QC reviewer who performed this action.
     * Always required — anonymous sign-offs are not permitted.
     */
    signedOffBy: v.string(),

    /**
     * Display name of the reviewer (denormalised so the history row is
     * self-contained and readable without a users table join).
     */
    signedOffByName: v.string(),

    /**
     * Epoch ms when this sign-off action was performed (server clock).
     * Used as the secondary key in the time-ordered indexes below.
     */
    signedOffAt: v.number(),

    /**
     * Optional notes entered by the reviewer alongside the decision.
     * Required when status = "rejected" (validation enforced by mutation).
     * Optional for "approved" and "pending" (revocation) actions.
     *
     * Examples:
     *   "All 42 items verified OK; case is ready for transit."
     *   "Battery charger missing (item #12) — rejected until replaced."
     *   "Previous approval revoked; re-inspection required."
     */
    notes: v.optional(v.string()),

    /**
     * QC status of the case BEFORE this sign-off action.
     * Enables diff views in the T5 audit panel ("was approved, now rejected").
     * Undefined for the first sign-off on a case (no prior QC state).
     */
    previousStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    )),

    /**
     * Optional link to the inspection pass that triggered this QC review.
     * Populated when the sign-off is performed immediately after completing
     * a checklist inspection.  Enables the T5 audit panel to correlate QC
     * decisions with specific inspection events.
     */
    inspectionId: v.optional(v.id("inspections")),
  })
    /**
     * by_case — all sign-off records for a case.
     * Primary lookup for the T5 audit panel QC history section.
     * Used by: getQcSignOffHistory.
     */
    .index("by_case",           ["caseId"])
    /**
     * by_case_signed_at — time-ordered per-case sign-off history.
     * Enables O(log n + |results|) range queries on a case's QC timeline.
     * Used by: getQcSignOffHistory (ordered), T5 audit panel chronological view.
     */
    .index("by_case_signed_at", ["caseId", "signedOffAt"])
    /**
     * by_signer — all QC actions performed by a specific reviewer.
     * Used by: admin audit reports ("show all decisions by Alice").
     */
    .index("by_signer",         ["signedOffBy"])
    /**
     * by_status — fleet-wide filter by QC decision.
     * Used by: dashboard QC queue ("all cases pending approval"),
     * operations reports ("how many cases were rejected this week").
     */
    .index("by_status",         ["status"])
    /**
     * by_signed_at — fleet-wide chronological QC activity feed.
     * Used by: dashboard recent-activity rails, telemetry aggregations,
     * operations monitoring ("no QC sign-offs in the last 48 hours" alerts).
     */
    .index("by_signed_at",      ["signedOffAt"]),

  /**
   * featureFlags — runtime feature flag storage.
   * Supports: FF_AUDIT_HASH_CHAIN, FF_MAP_MISSION, FF_INV_REDESIGN
   */
  featureFlags: defineTable({
    key: v.string(),               // e.g. "FF_MAP_MISSION"
    enabled: v.boolean(),
    description: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"]),

  /**
   * fedexTokenCache — server-side OAuth token cache.
   *
   * FedEx access tokens are valid for ~3600 seconds (1 hour).  Storing the
   * active token here lets Convex actions share a single token across cold-start
   * invocations rather than re-authenticating on every action call.
   *
   * The `service` field ("fedex") is an extensibility hook in case a second
   * OAuth-protected carrier is added in future — the same table structure works.
   *
   * Row lifecycle:
   *   • Created on first successful FedEx OAuth exchange.
   *   • Patched (in-place update) on each subsequent refresh.
   *   • Read by `getCachedToken` (internal query) inside `getBearerToken`.
   *   • Tokens within EXPIRY_BUFFER_MS (60 s) of expiry are treated as expired
   *     so there is always adequate time to complete an API request.
   *
   * Security:
   *   • This table is only readable via internalQuery / internalMutation —
   *     no public Convex query exposes these tokens to clients.
   *   • Convex database storage is encrypted at rest.
   */
  fedexTokenCache: defineTable({
    /** Service identifier — always "fedex" for now. */
    service:     v.string(),
    /** OAuth 2.0 bearer token issued by FedEx. */
    accessToken: v.string(),
    /** Epoch ms when the token expires (as reported by FedEx, no safety margin). */
    expiresAt:   v.number(),
    /** Epoch ms when this row was first created. */
    createdAt:   v.number(),
    /** Epoch ms when this row was last updated (token refresh). */
    updatedAt:   v.number(),
  })
    .index("by_service", ["service"]),

  /**
   * telemetryEvents — persistent store for client telemetry events.
   *
   * Both the INVENTORY dashboard and SCAN mobile app emit typed telemetry
   * events via the TelemetryClient (src/lib/telemetry.lib.ts).  In production
   * mode, the client batches events and POSTs them to /api/telemetry (Next.js
   * route) which calls the `recordTelemetryBatch` mutation to persist them here.
   *
   * Schema design
   * ─────────────
   * The indexed scalar fields (app, eventCategory, eventName, sessionId,
   * timestamp) are extracted from the full event payload for efficient queries
   * without scanning the full `payload: v.any()` BSON blob.
   *
   * The full event payload (with all category-specific fields) is stored in
   * `payload` for debugging, audit, and analytics export.
   *
   * Indexes
   * ───────
   *   by_app           — filter dashboard analytics by app surface
   *   by_session       — correlate events in a single browser session
   *   by_category      — filter by navigation / user_action / error / performance
   *   by_event_name    — filter/count by specific event name (e.g. PERF_MAP_ENDPOINT)
   *   by_timestamp     — time-range queries for analytics
   *   by_recorded_at   — monitoring / ingestion rate queries
   *
   * Retention
   * ─────────
   * No retention policy is enforced in application code; a scheduled Convex
   * action or database export can be used for long-term archival.
   */
  telemetryEvents: defineTable({
    /** Which app surface fired the event — "inventory" | "scan". */
    app:           v.string(),
    /** High-level category — "navigation" | "user_action" | "error" | "performance". */
    eventCategory: v.string(),
    /** Specific event name, e.g. "perf:map_endpoint" or "scan:action:qr_scanned". */
    eventName:     v.string(),
    /** Ephemeral per-page-load session identifier (UUID v4). */
    sessionId:     v.string(),
    /** Kinde user ID of the authenticated user, if known. */
    userId:        v.optional(v.string()),
    /** Convex case record ID in focus at event time, if applicable. */
    caseId:        v.optional(v.string()),
    /** Epoch ms when the event occurred (client-side clock). */
    timestamp:     v.number(),
    /** Full event payload including all category-specific fields. */
    payload:       v.any(),
    /** Epoch ms when this row was inserted into the database (server clock). */
    recordedAt:    v.number(),
  })
    .index("by_app",        ["app"])
    .index("by_session",    ["sessionId"])
    .index("by_category",   ["eventCategory"])
    .index("by_event_name", ["eventName"])
    .index("by_timestamp",  ["timestamp"])
    .index("by_recorded_at", ["recordedAt"]),

  /**
   * qr_association_events — dedicated, append-only audit trail for every
   * QR-code association action recorded by AC 240303 sub-AC 3.
   *
   * The generic `events` table already captures every QR action under
   * `eventType: "note_added"` with a `data.action` discriminator, but that
   * shape requires application-level parsing of the polymorphic `data: any`
   * blob to filter / report on QR activity.  This dedicated table provides:
   *
   *   1. A typed, queryable view of every QR association action (create /
   *      reassign / invalidate) without parsing event blobs.
   *   2. Direct indexes on caseId, qrCode, actorId, correlationId, and
   *      action so the dashboard QR audit panel and compliance exports run
   *      in O(log n) per lookup.
   *   3. A single source of truth that operations leads can subscribe to
   *      for live "QR activity" feeds (e.g., recent reassignments, recent
   *      invalidations) without scanning the entire events table.
   *   4. A canonical shape for the AC-required fields:
   *        action / actorId / actorName / timestamp / reasonCode
   *      so audit consumers can rely on field names without per-event
   *      payload conventions.
   *
   * Append-only contract
   * ────────────────────
   * Rows are inserted by every QR write path (generateQRCodeForCase,
   * associateQRCodeToCase, generateQrCode, setQrCode, updateQrCode,
   * reassignQrCodeToCase, invalidateQrCode) and are never updated or
   * deleted.  This makes the table a tamper-evident chain of QR custody
   * usable for compliance reporting.
   *
   * Pairing reassign events
   * ───────────────────────
   * A QR reassignment writes TWO rows linked by a shared `correlationId`:
   *
   *   • role: "source"  — appended to the case that LOST the QR.
   *                       previousQrCode/Source describe the QR being moved
   *                       away; counterpartCaseId/Label point to the target.
   *
   *   • role: "target"  — appended to the case that GAINED the QR.
   *                       qrCode/Source describe the QR now associated with
   *                       this case; counterpartCaseId/Label point to the
   *                       source; previousQrCode/Source describe what the
   *                       target case had before (if any) so audit consumers
   *                       can render a full before/after diff.
   *
   * Indexes
   * ───────
   *   by_case               — primary per-case lookup; unbounded.  Backs the
   *                           T5 audit "QR History" rail.
   *   by_case_timestamp     — chronological per-case scan; backs time-range
   *                           queries ("QR events for CASE-007 last 30 days").
   *   by_qr_code            — full lifecycle of a single QR payload across
   *                           every case it has ever been associated with.
   *                           Supports compliance queries like "show every
   *                           movement of QR X".
   *   by_actor              — every QR action initiated by a user.  Supports
   *                           per-technician audit reporting and rate-limit
   *                           checks ("Alice issued 50 reassignments today").
   *   by_correlation        — fetch both halves of a paired reassign in a
   *                           single index lookup.
   *   by_action             — fleet-wide filter by action type ("show all
   *                           invalidations in the last week").
   *   by_action_timestamp   — fleet-wide chronological feed per action type.
   *   by_timestamp          — fleet-wide chronological QR audit feed.
   */
  qr_association_events: defineTable({
    /**
     * The case affected by this QR action.
     *
     * For "create" and "invalidate" events this is the only case involved.
     * For "reassign" events this is the case the row is appended to —
     * which is either the source case (role: "source") or the target case
     * (role: "target") of the move.
     */
    caseId: v.id("cases"),

    /**
     * What QR action this row records.
     *
     *   "create"     — A QR payload was associated with a case (initial
     *                  association via generateQRCodeForCase, associateQRCodeToCase,
     *                  generateQrCode, setQrCode, or updateQrCode).
     *
     *   "reassign"   — A QR payload was moved from one case to another
     *                  (reassignQrCodeToCase).  Two rows share a correlationId.
     *
     *   "invalidate" — A QR payload was removed from a case without a
     *                  replacement target (invalidateQrCode).
     */
    action: v.union(
      v.literal("create"),
      v.literal("reassign"),
      v.literal("invalidate"),
    ),

    /**
     * Role this row plays in the action — meaningful only for "reassign".
     *
     *   "source" — appended to the case that LOST the QR (the prior holder).
     *   "target" — appended to the case that GAINED the QR.
     *
     * Undefined for "create" and "invalidate" actions (only one case is
     * involved so the role concept does not apply).
     */
    role: v.optional(
      v.union(v.literal("source"), v.literal("target")),
    ),

    /** Kinde user ID of the operator who performed the QR action. */
    actorId:   v.string(),
    /** Display name of the operator (denormalised for audit panel). */
    actorName: v.string(),

    /**
     * Epoch ms when the action was performed.  Identical on both rows of
     * a reassign pair so audit consumers can confirm the move happened
     * atomically.
     */
    timestamp: v.number(),

    /**
     * Reason code describing why the action was performed.
     *
     *   • For "reassign" events this is one of REASSIGNMENT_REASON_CODES
     *     (label_replacement, data_entry_error, case_swap, case_retired,
     *     label_misprint, other) and is REQUIRED.
     *   • For "invalidate" events this is one of INVALIDATION_REASON_CODES
     *     (label_destroyed, case_decommissioned, security_breach, other)
     *     and is REQUIRED.
     *   • For "create" events this is one of CREATE_REASON_CODES
     *     (initial_association, label_replacement, label_correction, other)
     *     defaulting to "initial_association" when the caller does not
     *     specify a reason.
     */
    reasonCode: v.string(),

    /**
     * Human-readable label for the reason code (denormalised so audit
     * panels do not need to join against a labels table).
     */
    reasonLabel: v.string(),

    /**
     * Free-text justification.
     *
     * Required when reasonCode === "other" (validated by the audit-helper
     * before insert).  Optional otherwise.  Stored as a trimmed non-empty
     * string or `null` (not undefined) so audit queries can filter on the
     * presence of notes without nullish-coalescing gymnastics.
     */
    reasonNotes: v.optional(v.string()),

    /**
     * The QR payload now associated with the affected case after the
     * action.
     *
     *   • "create"     — the newly-associated QR payload.
     *   • "reassign"   — same value on both source and target rows; this
     *                    is the QR that moved.
     *   • "invalidate" — empty string (the QR is no longer associated).
     */
    qrCode: v.string(),

    /**
     * Source classification of `qrCode` — how the QR was produced.
     *
     *   "generated" — UUID-based, system-generated.
     *   "external"  — verbatim from a pre-printed physical label.
     *
     * Undefined when `qrCode` is the empty string (invalidate events).
     */
    qrCodeSource: v.optional(
      v.union(v.literal("generated"), v.literal("external")),
    ),

    /**
     * The QR payload previously stored on the affected case before this
     * action — populated for any action that displaced an existing QR.
     *
     *   • "create" via updateQrCode that overwrites an existing QR.
     *   • "reassign" target row that displaced the target's prior QR.
     *   • "invalidate" — the QR being removed.
     *
     * Undefined when there was no previous QR on this case.
     */
    previousQrCode: v.optional(v.string()),

    /** Source classification of the previous QR.  Undefined when no prior QR. */
    previousQrCodeSource: v.optional(
      v.union(v.literal("generated"), v.literal("external")),
    ),

    /**
     * Correlation ID linking the two halves of a "reassign" pair.
     *
     * Both rows of a paired reassign carry the same correlationId; audit
     * consumers can rejoin the pair with `by_correlation` index.
     *
     * Undefined for "create" and "invalidate" events (no pairing).
     */
    correlationId: v.optional(v.string()),

    /**
     * The OTHER case involved in a "reassign" action.
     *
     *   • On the source-side row, this is the TARGET case (where the QR
     *     went to).
     *   • On the target-side row, this is the SOURCE case (where the QR
     *     came from).
     *
     * Undefined for "create" and "invalidate" actions.
     */
    counterpartCaseId:    v.optional(v.id("cases")),
    /** Display label of the counterpart case (denormalised). */
    counterpartCaseLabel: v.optional(v.string()),
  })
    .index("by_case",             ["caseId"])
    .index("by_case_timestamp",   ["caseId", "timestamp"])
    .index("by_qr_code",          ["qrCode"])
    .index("by_actor",            ["actorId"])
    .index("by_correlation",      ["correlationId"])
    .index("by_action",           ["action"])
    .index("by_action_timestamp", ["action", "timestamp"])
    .index("by_timestamp",        ["timestamp"]),
});
