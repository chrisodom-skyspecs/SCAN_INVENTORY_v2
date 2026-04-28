/**
 * convex/schema.ts
 *
 * SkySpecs INVENTORY + SCAN database schema.
 * All tables are defined here with appropriate indexes for efficient queries.
 */

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ─── Shared value types ──────────────────────────────────────────────────────

/** Valid case lifecycle statuses */
const caseStatus = v.union(
  v.literal("assembled"),   // fully packed, ready to deploy
  v.literal("deployed"),    // at site, not yet inspected
  v.literal("in_field"),    // actively being used / inspected in field
  v.literal("shipping"),    // in transit via carrier
  v.literal("returned"),    // back at warehouse
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
    status: caseStatus,
    templateId: v.optional(v.id("caseTemplates")),
    missionId: v.optional(v.id("missions")),

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

    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_mission", ["missionId"])
    .index("by_qr_code", ["qrCode"])
    .index("by_updated", ["updatedAt"]),

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
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"]),

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
    .index("by_status", ["status"]),

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
    shippedAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_case", ["caseId"])
    .index("by_tracking", ["trackingNumber"])
    .index("by_status", ["status"]),

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

    // Hash chain fields (populated when FF_AUDIT_HASH_CHAIN is enabled)
    hash: v.optional(v.string()),
    prevHash: v.optional(v.string()),
  })
    .index("by_case", ["caseId"])
    .index("by_case_timestamp", ["caseId", "timestamp"]),

  /**
   * custodyRecords — explicit handoff events between users.
   * Created during SCAN app custody transfer workflow.
   *
   * Indexes
   * ───────
   *   by_case      — primary per-case lookup; used by getCustodyRecordsByCase,
   *                  getLatestCustodyRecord, getCustodyChain
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
  })
    .index("by_case",      ["caseId"])
    .index("by_to_user",   ["toUserId"])
    .index("by_from_user", ["fromUserId"]),

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
   * Fields
   * ──────
   *   caseId          — parent case (mandatory)
   *   photoStorageId  — Convex file storage ID for the uploaded photo
   *   annotations     — optional array of pin-style annotations placed on the
   *                     photo by the technician in the SCAN app markup tool
   *   severity        — damage severity assessed by the technician
   *   reportedAt      — epoch ms when the photo was submitted
   *   manifestItemId  — optional link to the manifest item being reported
   *   templateItemId  — stable template item ID (for event correlation)
   *   reportedById    — Kinde user ID of the reporting technician
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
    .index("by_case_reported_at", ["caseId", "reportedAt"]),

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
});
