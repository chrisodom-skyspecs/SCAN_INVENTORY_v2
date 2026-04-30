/**
 * lib/telemetry/catalog.ts
 *
 * Runtime-queryable catalog of every telemetry event emitted by the INVENTORY
 * dashboard and SCAN mobile-first web app — the canonical companion to the
 * type-level discriminated union in `src/types/telemetry.types.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why a runtime catalog?
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The TypeScript types in `telemetry.types.ts` give compile-time enforcement
 * of event shapes, but they evaporate at runtime.  Several consumers need
 * structured knowledge about events at runtime:
 *
 *   • Documentation generators that render an "Event Reference" page from
 *     the canonical schema rather than re-typing it in markdown.
 *   • Server-side validators (Convex mutations / API routes) that defensively
 *     verify required fields are present before persisting events.
 *   • Analytics / funnel queries that need to enumerate every event in a
 *     domain (e.g. spec §23 "scan domain") at runtime.
 *   • Admin / observability UIs that show event-name autocomplete or render
 *     per-event property descriptions in DevTools panels.
 *
 * This catalog is the single source of truth shared by all of them.  Every
 * event defined in `telemetry.types.ts` has a corresponding entry here, and
 * the catalog is exhaustively typed so the TypeScript compiler will refuse to
 * build if a new event type is added without a catalog entry.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Spec §23 mapping
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Each catalog entry includes a `domain` field that classifies the event
 * into one of the six spec §23 domain-workflow categories:
 *
 *   scan         — QR code scanning funnel (camera → decode → context choice)
 *   inspection   — Item-by-item checklist inspection workflow
 *   damage       — Damage photo capture and annotation workflow
 *   shipping     — FedEx tracking number entry and shipment submission
 *   handoff      — In-person custody transfer between users
 *   navigation   — Cross-cutting route / view changes (INVENTORY + SCAN)
 *   ops          — Operations actions on the INVENTORY dashboard
 *                  (layer toggles, filters, exports, search) — not a §23 domain
 *                  proper, but kept distinct from `navigation` so dashboard
 *                  ops events do not pollute mobile funnel queries.
 *   error        — Error events, classified separately from any workflow
 *   performance  — Performance / timing events, classified separately
 *
 * The scan / inspection / damage / shipping / handoff / navigation values are
 * also exported by `DOMAIN_EVENT_NAMES` in telemetry.types.ts; this catalog
 * covers the same ground in a flat, runtime-iterable form and additionally
 * captures the `error`, `performance`, and `ops` classifications.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Usage
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @example
 * // Look up a single event's schema:
 * import { TELEMETRY_EVENT_CATALOG } from "@/lib/telemetry/catalog";
 *
 * const entry = TELEMETRY_EVENT_CATALOG["scan:action:qr_scanned"];
 * console.log(entry.requiredFields);
 * // → ["app", "eventCategory", "eventName", "sessionId", "timestamp",
 * //    "success", "scanDurationMs", "method"]
 *
 * @example
 * // Iterate every event in a spec §23 domain:
 * import { getEventsByDomain } from "@/lib/telemetry/catalog";
 *
 * const damageEvents = getEventsByDomain("damage");
 * for (const e of damageEvents) {
 *   console.log(`${e.eventName}: ${e.description}`);
 * }
 *
 * @example
 * // Validate an event payload at runtime (Convex mutation guard):
 * import { validateTelemetryEvent } from "@/lib/telemetry/catalog";
 *
 * const result = validateTelemetryEvent(rawEvent);
 * if (!result.valid) {
 *   throw new Error(`[INVALID_EVENT] ${result.errors.join(", ")}`);
 * }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Maintenance contract
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When a new event is added to `telemetry.types.ts`:
 *   1. Add a constant to `TelemetryEventName`.
 *   2. Add an interface extending `TelemetryEventBase` (or its category base).
 *   3. Add the interface to the appropriate category union.
 *   4. **Add a catalog entry here** — the `satisfies Record<…>` assertion at
 *      the bottom of this file will fail at compile time if you forget.
 *   5. Update the relevant `DOMAIN_EVENT_NAMES[domain]` array if applicable.
 */

import {
  TelemetryEventName,
  type DeviceContext,
  type TelemetryApp,
  type TelemetryEvent,
  type TelemetryEventByName,
  type TelemetryEventCategory,
  type TelemetryEventNameValue,
} from "@/types/telemetry.types";

// ─── Spec §23 domain classification (extended) ───────────────────────────────

/**
 * Domain classifier for catalog entries.
 *
 * Combines the six spec §23 workflow domains with three additional buckets
 * (`ops`, `error`, `performance`) so every event in the catalog has a single
 * canonical home.  See module-level JSDoc for the full mapping.
 */
export type TelemetryCatalogDomain =
  | "scan"
  | "inspection"
  | "damage"
  | "shipping"
  | "handoff"
  | "navigation"
  | "ops"
  | "error"
  | "performance";

// ─── Catalog entry shape ─────────────────────────────────────────────────────

/**
 * The base set of fields every telemetry event includes (auto-filled by the
 * TelemetryClient when the caller omits them).  Every event in the catalog
 * lists these as required.
 *
 * `userId` and `caseId` are deliberately not in this list — they are
 * conditionally required per event and listed in `requiredFields` only on
 * events where the spec mandates their presence.
 */
export const TELEMETRY_EVENT_BASE_FIELDS = [
  "eventCategory",
  "eventName",
  "app",
  "timestamp",
  "sessionId",
] as const;

/**
 * Metadata describing a single telemetry event at runtime.
 *
 * Generic over the event-name literal so `eventCategory` and `app` narrow
 * exactly to the values declared in `telemetry.types.ts`.
 *
 * `requiredFields` / `optionalFields` are stored as plain `readonly string[]`
 * in the catalog so all entries unify into a single `Record<…, TelemetryCatalogEntry>`
 * type without per-event-name variance issues.  The `entry()` helper at
 * registration time enforces, via its generic constraint, that every listed
 * field is a real key of the matching event interface — so the catalog still
 * cannot reference fields that don't exist on the event type.
 */
export interface TelemetryCatalogEntry<
  N extends TelemetryEventNameValue = TelemetryEventNameValue,
> {
  /** Stable event-name literal (e.g. "scan:action:qr_scanned"). */
  readonly eventName: N;

  /** Technical category — matches the discriminated-union key in TelemetryEvent. */
  readonly eventCategory: TelemetryEventCategory;

  /**
   * App surface that emits this event.
   *
   * "inventory" — fired only on the INVENTORY dashboard.
   * "scan"      — fired only on the SCAN mobile app.
   * "any"       — fired on either surface (e.g. shared error / performance events).
   */
  readonly app: TelemetryApp | "any";

  /** Spec §23 (or extended) domain classification. */
  readonly domain: TelemetryCatalogDomain;

  /** Short human-readable description for documentation generators. */
  readonly description: string;

  /**
   * Names of every field that MUST be present on the event payload at the time
   * it is delivered to the transport.  Includes the auto-filled base fields
   * (eventCategory, eventName, app, timestamp, sessionId) plus any
   * event-specific fields whose presence the spec mandates.
   *
   * Optional fields (e.g. `qrPayload` on a failed QR scan) are not listed here
   * — see `optionalFields` for those.
   */
  readonly requiredFields: readonly string[];

  /**
   * Names of fields that MAY be present on the event payload but are not
   * required.  These are typically context-conditional (e.g. `caseId` on
   * navigation events that don't have a case in focus, or `userId` on
   * pre-authentication errors).
   */
  readonly optionalFields: readonly string[];
}

// ─── Helper for building entries ─────────────────────────────────────────────

/**
 * Build a catalog entry from minimal input.  Auto-prepends the base fields
 * to `requiredFields` and dedupes them so callers don't have to list
 * `eventCategory`, `eventName`, etc. for every event.
 *
 * Marked `as const` so the resulting tuple types remain narrow.
 */
function entry<N extends TelemetryEventNameValue>(spec: {
  readonly eventName: N;
  readonly eventCategory: TelemetryEventByName<N>["eventCategory"];
  readonly app: TelemetryApp | "any";
  readonly domain: TelemetryCatalogDomain;
  readonly description: string;
  readonly requiredFields?: readonly (
    | keyof TelemetryEventByName<N>
    | "userId"
    | "caseId"
    | "device"
  )[];
  readonly optionalFields?: readonly (
    | keyof TelemetryEventByName<N>
    | "userId"
    | "caseId"
    | "device"
  )[];
}): TelemetryCatalogEntry<N> {
  // Always include base fields; dedupe by Set then back to array.
  // The narrow generic on requiredFields/optionalFields enforces (at the call
  // site, where N is known) that each listed field actually exists on the
  // matching event interface.  Once stored on the catalog entry the arrays
  // widen to readonly string[] so the entries unify across event names.
  const required: readonly string[] = Array.from(
    new Set<string>([
      ...TELEMETRY_EVENT_BASE_FIELDS,
      ...((spec.requiredFields ?? []) as readonly string[]),
    ]),
  );

  const optional: readonly string[] = (spec.optionalFields ?? []) as readonly string[];

  return {
    eventName: spec.eventName,
    eventCategory: spec.eventCategory,
    app: spec.app,
    domain: spec.domain,
    description: spec.description,
    requiredFields: required,
    optionalFields: optional,
  };
}

// ─── The catalog ─────────────────────────────────────────────────────────────

/**
 * The complete typed event catalog.
 *
 * Indexed by event-name string literal so callers can do:
 *
 *     TELEMETRY_EVENT_CATALOG[event.eventName]
 *
 * to get the entry without a runtime lookup.
 *
 * The `satisfies Record<TelemetryEventNameValue, TelemetryCatalogEntry>` at the
 * end forces the TypeScript compiler to verify that every event-name value
 * has a corresponding entry — adding a new event in `telemetry.types.ts`
 * without registering it here will produce a compile error.
 */
export const TELEMETRY_EVENT_CATALOG = {
  // ── INVENTORY navigation ────────────────────────────────────────────────────

  [TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED]: entry({
    eventName: TelemetryEventName.INV_NAV_MAP_VIEW_CHANGED,
    eventCategory: "navigation",
    app: "inventory",
    domain: "navigation",
    description: "User switched the active map mode (M1–M5).",
    requiredFields: ["mapView", "previousMapView"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.INV_NAV_CASE_SELECTED]: entry({
    eventName: TelemetryEventName.INV_NAV_CASE_SELECTED,
    eventCategory: "navigation",
    app: "inventory",
    domain: "navigation",
    description: "User selected a case pin on the map or from a list.",
    requiredFields: ["caseId", "mapView", "selectionSource"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.INV_NAV_CASE_DESELECTED]: entry({
    eventName: TelemetryEventName.INV_NAV_CASE_DESELECTED,
    eventCategory: "navigation",
    app: "inventory",
    domain: "navigation",
    description: "User dismissed / closed the case detail panel.",
    requiredFields: ["previousCaseId"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.INV_NAV_DETAIL_TAB_CHANGED]: entry({
    eventName: TelemetryEventName.INV_NAV_DETAIL_TAB_CHANGED,
    eventCategory: "navigation",
    app: "inventory",
    domain: "navigation",
    description: "User switched the active detail panel tab (T1–T5).",
    requiredFields: ["tab", "previousTab", "caseId"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.INV_NAV_PAGE_LOADED]: entry({
    eventName: TelemetryEventName.INV_NAV_PAGE_LOADED,
    eventCategory: "navigation",
    app: "inventory",
    domain: "navigation",
    description: "INVENTORY dashboard initial page load completed.",
    requiredFields: ["loadDurationMs", "hydratedFromUrl"],
    optionalFields: ["userId"],
  }),

  // ── INVENTORY user actions (ops domain) ────────────────────────────────────

  [TelemetryEventName.INV_ACTION_LAYER_TOGGLED]: entry({
    eventName: TelemetryEventName.INV_ACTION_LAYER_TOGGLED,
    eventCategory: "user_action",
    app: "inventory",
    domain: "ops",
    description: "User toggled a map layer on or off.",
    requiredFields: ["layerId", "enabled", "activeLayers"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.INV_ACTION_FILTER_ORG_CHANGED]: entry({
    eventName: TelemetryEventName.INV_ACTION_FILTER_ORG_CHANGED,
    eventCategory: "user_action",
    app: "inventory",
    domain: "ops",
    description: "User changed the organisation filter.",
    requiredFields: ["orgId", "previousOrgId"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.INV_ACTION_FILTER_KIT_CHANGED]: entry({
    eventName: TelemetryEventName.INV_ACTION_FILTER_KIT_CHANGED,
    eventCategory: "user_action",
    app: "inventory",
    domain: "ops",
    description: "User changed the kit / case template filter.",
    requiredFields: ["kitId", "previousKitId"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.INV_ACTION_SEARCH_SUBMITTED]: entry({
    eventName: TelemetryEventName.INV_ACTION_SEARCH_SUBMITTED,
    eventCategory: "user_action",
    app: "inventory",
    domain: "ops",
    description:
      "User submitted the global case search (Enter key or form submit).",
    requiredFields: ["queryLength", "submitMethod"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.INV_ACTION_MISSION_REPLAY_SCRUBBED]: entry({
    eventName: TelemetryEventName.INV_ACTION_MISSION_REPLAY_SCRUBBED,
    eventCategory: "user_action",
    app: "inventory",
    domain: "ops",
    description: "User dragged the M5 mission-replay scrubber.",
    requiredFields: ["replayTimestamp", "missionId"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.INV_ACTION_EXPORT_INITIATED]: entry({
    eventName: TelemetryEventName.INV_ACTION_EXPORT_INITIATED,
    eventCategory: "user_action",
    app: "inventory",
    domain: "ops",
    description: "User initiated an export (label PDF, manifest CSV, …).",
    requiredFields: ["exportType", "caseId"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.INV_ACTION_CASE_CREATE_OPENED]: entry({
    eventName: TelemetryEventName.INV_ACTION_CASE_CREATE_OPENED,
    eventCategory: "user_action",
    app: "inventory",
    domain: "ops",
    description: "User opened the case-creation modal / flow.",
    requiredFields: ["source"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.INV_ACTION_TEMPLATE_APPLIED]: entry({
    eventName: TelemetryEventName.INV_ACTION_TEMPLATE_APPLIED,
    eventCategory: "user_action",
    app: "inventory",
    domain: "ops",
    description: "User applied a case template from the admin UI.",
    requiredFields: ["caseId", "templateId", "templateItemCount"],
    optionalFields: ["userId"],
  }),

  // ── SCAN navigation ────────────────────────────────────────────────────────

  [TelemetryEventName.SCAN_NAV_PAGE_CHANGED]: entry({
    eventName: TelemetryEventName.SCAN_NAV_PAGE_CHANGED,
    eventCategory: "navigation",
    app: "scan",
    domain: "navigation",
    description: "User navigated between SCAN app pages / routes.",
    requiredFields: ["toPath", "fromPath"],
    optionalFields: ["userId", "caseId"],
  }),

  [TelemetryEventName.SCAN_NAV_CASE_OPENED]: entry({
    eventName: TelemetryEventName.SCAN_NAV_CASE_OPENED,
    eventCategory: "navigation",
    app: "scan",
    domain: "scan",
    description: "Case detail was opened after a successful QR scan.",
    requiredFields: ["caseId", "caseStatus"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_NAV_SCANNER_OPENED]: entry({
    eventName: TelemetryEventName.SCAN_NAV_SCANNER_OPENED,
    eventCategory: "navigation",
    app: "scan",
    domain: "scan",
    description:
      "QR scanner camera view opened — precedes SCAN_ACTION_QR_SCANNED in the funnel.",
    requiredFields: ["entryPoint", "cameraPermissionGranted"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_NAV_INSPECTION_STARTED]: entry({
    eventName: TelemetryEventName.SCAN_NAV_INSPECTION_STARTED,
    eventCategory: "navigation",
    app: "scan",
    domain: "inspection",
    description: "User entered the inspection checklist flow.",
    requiredFields: ["caseId", "totalItems"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_NAV_DAMAGE_REPORT_OPENED]: entry({
    eventName: TelemetryEventName.SCAN_NAV_DAMAGE_REPORT_OPENED,
    eventCategory: "navigation",
    app: "scan",
    domain: "damage",
    description: "User opened the damage report / photo annotation flow.",
    requiredFields: ["caseId", "manifestItemId"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_NAV_SHIP_FLOW_OPENED]: entry({
    eventName: TelemetryEventName.SCAN_NAV_SHIP_FLOW_OPENED,
    eventCategory: "navigation",
    app: "scan",
    domain: "shipping",
    description: "User opened the FedEx tracking entry flow.",
    requiredFields: ["caseId"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_NAV_CUSTODY_FLOW_OPENED]: entry({
    eventName: TelemetryEventName.SCAN_NAV_CUSTODY_FLOW_OPENED,
    eventCategory: "navigation",
    app: "scan",
    domain: "handoff",
    description: "User opened the in-person custody handoff flow.",
    requiredFields: ["caseId"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_NAV_PAGE_LOADED]: entry({
    eventName: TelemetryEventName.SCAN_NAV_PAGE_LOADED,
    eventCategory: "navigation",
    app: "scan",
    domain: "navigation",
    description: "SCAN app initial page load completed.",
    requiredFields: ["loadDurationMs"],
    optionalFields: ["userId", "caseId"],
  }),

  // ── SCAN user actions ──────────────────────────────────────────────────────

  [TelemetryEventName.SCAN_ACTION_QR_SCANNED]: entry({
    eventName: TelemetryEventName.SCAN_ACTION_QR_SCANNED,
    eventCategory: "user_action",
    app: "scan",
    domain: "scan",
    description: "QR code scan completed (success or failure recorded in payload).",
    requiredFields: ["success", "scanDurationMs", "method"],
    optionalFields: ["qrPayload", "userId", "caseId"],
  }),

  [TelemetryEventName.SCAN_ACTION_CONTEXT_SELECTED]: entry({
    eventName: TelemetryEventName.SCAN_ACTION_CONTEXT_SELECTED,
    eventCategory: "user_action",
    app: "scan",
    domain: "scan",
    description:
      "User selected a workflow choice (inspect | history | issue | ship | handoff) on the post-scan context screen.",
    requiredFields: ["caseId", "contextChoice", "decisionTimeMs", "caseStatus"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_ACTION_ITEM_CHECKED]: entry({
    eventName: TelemetryEventName.SCAN_ACTION_ITEM_CHECKED,
    eventCategory: "user_action",
    app: "scan",
    domain: "inspection",
    description: "User changed the check state of a manifest item.",
    requiredFields: [
      "caseId",
      "manifestItemId",
      "templateItemId",
      "newStatus",
      "previousStatus",
      "itemIndex",
      "totalItems",
    ],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_ACTION_DAMAGE_REPORTED]: entry({
    eventName: TelemetryEventName.SCAN_ACTION_DAMAGE_REPORTED,
    eventCategory: "user_action",
    app: "scan",
    domain: "damage",
    description: "Damage photo + annotations submitted to Convex.",
    requiredFields: [
      "caseId",
      "manifestItemId",
      "severity",
      "annotationCount",
      "hasNotes",
      "photoSizeBytes",
    ],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_ACTION_TRACKING_ENTERED]: entry({
    eventName: TelemetryEventName.SCAN_ACTION_TRACKING_ENTERED,
    eventCategory: "user_action",
    app: "scan",
    domain: "shipping",
    description: "User typed or pasted a FedEx tracking number.",
    requiredFields: ["caseId", "valid", "trackingNumberLength"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_ACTION_SHIPMENT_SUBMITTED]: entry({
    eventName: TelemetryEventName.SCAN_ACTION_SHIPMENT_SUBMITTED,
    eventCategory: "user_action",
    app: "scan",
    domain: "shipping",
    description: "Shipment form submitted; tracking number recorded on the case.",
    requiredFields: ["caseId", "success", "carrier"],
    optionalFields: ["trackingNumber", "initiatingUserId", "userId"],
  }),

  [TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED]: entry({
    eventName: TelemetryEventName.SCAN_ACTION_CUSTODY_INITIATED,
    eventCategory: "user_action",
    app: "scan",
    domain: "handoff",
    description: "Custody handoff initiated by the current holder.",
    requiredFields: ["caseId", "recipientUserId", "handoffType", "fromUserId"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED]: entry({
    eventName: TelemetryEventName.SCAN_ACTION_CUSTODY_COMPLETED,
    eventCategory: "user_action",
    app: "scan",
    domain: "handoff",
    description: "Custody handoff confirmed/completed by both parties.",
    requiredFields: [
      "caseId",
      "fromUserId",
      "fromUserName",
      "toUserId",
      "toUserName",
      "handoffType",
      "hasSignature",
      "handoffDurationMs",
      "handoffAt",
    ],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_ACTION_INSPECTION_COMPLETED]: entry({
    eventName: TelemetryEventName.SCAN_ACTION_INSPECTION_COMPLETED,
    eventCategory: "user_action",
    app: "scan",
    domain: "inspection",
    description: "User marked an inspection as complete.",
    requiredFields: [
      "caseId",
      "inspectionId",
      "totalItems",
      "okItems",
      "damagedItems",
      "missingItems",
      "durationMs",
    ],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_ACTION_INSPECTION_ABANDONED]: entry({
    eventName: TelemetryEventName.SCAN_ACTION_INSPECTION_ABANDONED,
    eventCategory: "user_action",
    app: "scan",
    domain: "inspection",
    description: "User exited the inspection checklist before completing all items.",
    requiredFields: [
      "caseId",
      "inspectionId",
      "totalItems",
      "checkedItems",
      "okItems",
      "damagedItems",
      "missingItems",
      "durationMs",
      "exitReason",
    ],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_ACTION_NOTE_ADDED]: entry({
    eventName: TelemetryEventName.SCAN_ACTION_NOTE_ADDED,
    eventCategory: "user_action",
    app: "scan",
    domain: "inspection",
    description: "User added a free-text note to a case or manifest item.",
    requiredFields: ["caseId", "noteLength", "attachedTo"],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_ACTION_ANNOTATION_ADDED]: entry({
    eventName: TelemetryEventName.SCAN_ACTION_ANNOTATION_ADDED,
    eventCategory: "user_action",
    app: "scan",
    domain: "damage",
    description:
      "User placed an annotation pin on a damage photo in the SCAN markup tool.",
    requiredFields: [
      "caseId",
      "annotationType",
      "photoId",
      "reportId",
      "annotationLabel",
      "annotationIndex",
    ],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.SCAN_ACTION_ANNOTATION_REMOVED]: entry({
    eventName: TelemetryEventName.SCAN_ACTION_ANNOTATION_REMOVED,
    eventCategory: "user_action",
    app: "scan",
    domain: "damage",
    description:
      "User removed an annotation pin from a damage photo in the SCAN markup tool.",
    requiredFields: [
      "caseId",
      "annotationType",
      "photoId",
      "reportId",
      "annotationLabel",
      "annotationIndex",
    ],
    optionalFields: ["userId"],
  }),

  // ── Errors (shared) ─────────────────────────────────────────────────────────

  [TelemetryEventName.ERROR_QR_SCAN_FAILED]: entry({
    eventName: TelemetryEventName.ERROR_QR_SCAN_FAILED,
    eventCategory: "error",
    app: "scan",
    domain: "error",
    description: "QR code scanner produced no decodable result.",
    requiredFields: ["errorCode", "errorMessage", "recoverable", "attemptDurationMs"],
    optionalFields: ["userId", "caseId"],
  }),

  [TelemetryEventName.ERROR_CAMERA_DENIED]: entry({
    eventName: TelemetryEventName.ERROR_CAMERA_DENIED,
    eventCategory: "error",
    app: "scan",
    domain: "error",
    description: "Browser denied camera permission for QR scanning or photo capture.",
    requiredFields: ["errorCode", "errorMessage", "recoverable", "permissionName"],
    optionalFields: ["userId", "caseId"],
  }),

  [TelemetryEventName.ERROR_PHOTO_UPLOAD_FAILED]: entry({
    eventName: TelemetryEventName.ERROR_PHOTO_UPLOAD_FAILED,
    eventCategory: "error",
    app: "scan",
    domain: "error",
    description: "Photo upload to Convex file storage failed.",
    requiredFields: [
      "errorCode",
      "errorMessage",
      "recoverable",
      "caseId",
      "fileSizeBytes",
      "httpStatus",
    ],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.ERROR_CONVEX_QUERY_FAILED]: entry({
    eventName: TelemetryEventName.ERROR_CONVEX_QUERY_FAILED,
    eventCategory: "error",
    app: "any",
    domain: "error",
    description: "A Convex query or mutation returned an error or timed out.",
    requiredFields: [
      "errorCode",
      "errorMessage",
      "recoverable",
      "functionName",
      "operationType",
    ],
    optionalFields: ["userId", "caseId"],
  }),

  [TelemetryEventName.ERROR_FEDEX_VALIDATION_FAILED]: entry({
    eventName: TelemetryEventName.ERROR_FEDEX_VALIDATION_FAILED,
    eventCategory: "error",
    app: "scan",
    domain: "error",
    description: "FedEx tracking number did not pass validation.",
    requiredFields: [
      "errorCode",
      "errorMessage",
      "recoverable",
      "caseId",
      "trackingNumberLength",
      "validationRule",
    ],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.ERROR_NETWORK_REQUEST_FAILED]: entry({
    eventName: TelemetryEventName.ERROR_NETWORK_REQUEST_FAILED,
    eventCategory: "error",
    app: "any",
    domain: "error",
    description: "Generic network request failure (non-Convex).",
    requiredFields: [
      "errorCode",
      "errorMessage",
      "recoverable",
      "urlPath",
      "httpStatus",
      "isTimeout",
    ],
    optionalFields: ["userId", "caseId"],
  }),

  [TelemetryEventName.ERROR_FEATURE_FLAG_LOAD_FAILED]: entry({
    eventName: TelemetryEventName.ERROR_FEATURE_FLAG_LOAD_FAILED,
    eventCategory: "error",
    app: "any",
    domain: "error",
    description: "Feature flag values could not be loaded from Convex.",
    requiredFields: ["errorCode", "errorMessage", "recoverable", "flagKey"],
    optionalFields: ["userId", "caseId"],
  }),

  [TelemetryEventName.ERROR_UNHANDLED_EXCEPTION]: entry({
    eventName: TelemetryEventName.ERROR_UNHANDLED_EXCEPTION,
    eventCategory: "error",
    app: "any",
    domain: "error",
    description:
      "An unexpected JavaScript exception was caught by an error boundary.",
    requiredFields: [
      "errorCode",
      "errorMessage",
      "recoverable",
      "stackTrace",
      "errorBoundary",
    ],
    optionalFields: ["userId", "caseId"],
  }),

  // ── Performance (shared) ───────────────────────────────────────────────────

  [TelemetryEventName.PERF_MAP_RENDER]: entry({
    eventName: TelemetryEventName.PERF_MAP_RENDER,
    eventCategory: "performance",
    app: "inventory",
    domain: "performance",
    description: "Time from map component mount to first tiles rendered.",
    requiredFields: [
      "durationMs",
      "withinTarget",
      "mapView",
      "featureCount",
      "renderStrategy",
    ],
    optionalFields: ["userId", "caseId"],
  }),

  [TelemetryEventName.PERF_QUERY_RESPONSE]: entry({
    eventName: TelemetryEventName.PERF_QUERY_RESPONSE,
    eventCategory: "performance",
    app: "any",
    domain: "performance",
    description: "Round-trip duration for a Convex query response.",
    requiredFields: [
      "durationMs",
      "withinTarget",
      "functionName",
      "resultCount",
      "fromCache",
    ],
    optionalFields: ["userId", "caseId"],
  }),

  [TelemetryEventName.PERF_NAVIGATION_TIMING]: entry({
    eventName: TelemetryEventName.PERF_NAVIGATION_TIMING,
    eventCategory: "performance",
    app: "any",
    domain: "performance",
    description: "Web Vitals navigation timing measurement (TTFB, LCP, …).",
    requiredFields: ["durationMs", "withinTarget", "metric", "routePath"],
    optionalFields: ["userId", "caseId"],
  }),

  [TelemetryEventName.PERF_REALTIME_LATENCY]: entry({
    eventName: TelemetryEventName.PERF_REALTIME_LATENCY,
    eventCategory: "performance",
    app: "any",
    domain: "performance",
    description:
      "End-to-end latency from a SCAN mutation to the INVENTORY subscription update (target ≤ 2 000 ms).",
    requiredFields: [
      "durationMs",
      "withinTarget",
      "triggerMutation",
      "mutationSubmittedAt",
      "subscriptionUpdatedAt",
      "withinFidelityTarget",
    ],
    optionalFields: ["userId", "caseId"],
  }),

  [TelemetryEventName.PERF_PHOTO_UPLOAD]: entry({
    eventName: TelemetryEventName.PERF_PHOTO_UPLOAD,
    eventCategory: "performance",
    app: "scan",
    domain: "performance",
    description: "Duration of a photo upload to Convex file storage.",
    requiredFields: [
      "durationMs",
      "withinTarget",
      "caseId",
      "fileSizeBytes",
      "throughputKbps",
    ],
    optionalFields: ["userId"],
  }),

  [TelemetryEventName.PERF_MAP_ENDPOINT]: entry({
    eventName: TelemetryEventName.PERF_MAP_ENDPOINT,
    eventCategory: "performance",
    app: "inventory",
    domain: "performance",
    description: "Map endpoint response time (target < 200 ms p50).",
    requiredFields: ["durationMs", "withinTarget", "mapView", "caseCount"],
    optionalFields: ["userId", "caseId"],
  }),
} as const satisfies Record<TelemetryEventNameValue, TelemetryCatalogEntry>;

// The exhaustiveness check above guarantees every TelemetryEventName has an
// entry — adding a new event without registering it is a compile error.

/** Exhaustive list of catalog entries (iteration-friendly). */
export const TELEMETRY_EVENT_CATALOG_ENTRIES: readonly TelemetryCatalogEntry[] =
  Object.values(TELEMETRY_EVENT_CATALOG);

// ─── Lookup helpers ──────────────────────────────────────────────────────────

/**
 * Fetch the catalog entry for a specific event name.
 *
 * Returns `undefined` for an unknown event name (e.g. when the caller passed
 * an arbitrary `string` from a runtime payload).  When the input is typed as
 * `TelemetryEventNameValue` the return type narrows to the exact entry.
 */
export function getCatalogEntry<N extends TelemetryEventNameValue>(
  eventName: N,
): TelemetryCatalogEntry<N>;
export function getCatalogEntry(
  eventName: string,
): TelemetryCatalogEntry | undefined;
export function getCatalogEntry(
  eventName: string,
): TelemetryCatalogEntry | undefined {
  return (TELEMETRY_EVENT_CATALOG as Record<string, TelemetryCatalogEntry>)[
    eventName
  ];
}

/** Return every catalog entry that matches the given category. */
export function getEventsByCategory(
  category: TelemetryEventCategory,
): TelemetryCatalogEntry[] {
  return TELEMETRY_EVENT_CATALOG_ENTRIES.filter(
    (e) => e.eventCategory === category,
  );
}

/** Return every catalog entry that matches the given app surface. */
export function getEventsByApp(
  app: TelemetryApp | "any",
): TelemetryCatalogEntry[] {
  return TELEMETRY_EVENT_CATALOG_ENTRIES.filter(
    (e) => e.app === app || e.app === "any",
  );
}

/** Return every catalog entry that matches the given spec §23 / extended domain. */
export function getEventsByDomain(
  domain: TelemetryCatalogDomain,
): TelemetryCatalogEntry[] {
  return TELEMETRY_EVENT_CATALOG_ENTRIES.filter((e) => e.domain === domain);
}

/** Return every distinct event name registered in the catalog. */
export function getAllEventNames(): readonly TelemetryEventNameValue[] {
  return TELEMETRY_EVENT_CATALOG_ENTRIES.map((e) => e.eventName);
}

// ─── Runtime validation ──────────────────────────────────────────────────────

/** Result of validating a runtime event payload against the catalog. */
export interface TelemetryValidationResult {
  /** True when every required field is present (and the event name is known). */
  valid: boolean;
  /** The matching catalog entry, when the event name was recognised. */
  entry?: TelemetryCatalogEntry;
  /** Names of required fields that were missing from the payload. */
  missingFields: string[];
  /** Human-readable validation error messages (empty when `valid` is true). */
  errors: string[];
}

/**
 * Validate a runtime event payload (e.g. `JSON.parse(req.body)`) against the
 * catalog.  This is a shallow structural check — it verifies that:
 *
 *   1. The `eventName` is a registered catalog entry.
 *   2. The `eventCategory` and `app` match the catalog entry.
 *   3. Every required field (per the catalog) is present and non-undefined.
 *
 * It does NOT validate field *types* (e.g. that `caseId` is a string) — the
 * Convex mutation v.any() schema accepts those as `unknown` and downstream
 * consumers can perform stricter checks if needed.
 *
 * Returns a result object instead of throwing so callers can decide whether
 * to drop the event silently, log a warning, or reject with an error.
 *
 * @example
 * const result = validateTelemetryEvent(rawEvent);
 * if (!result.valid) {
 *   console.warn(`[telemetry] dropping invalid event: ${result.errors.join("; ")}`);
 *   return;
 * }
 */
export function validateTelemetryEvent(
  payload: unknown,
): TelemetryValidationResult {
  const errors: string[] = [];
  const missingFields: string[] = [];

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      valid: false,
      missingFields: [...TELEMETRY_EVENT_BASE_FIELDS],
      errors: ["Payload is not a non-null object."],
    };
  }

  const obj = payload as Record<string, unknown>;
  const eventName = typeof obj.eventName === "string" ? obj.eventName : null;

  if (!eventName) {
    return {
      valid: false,
      missingFields: ["eventName"],
      errors: ["Required field `eventName` is missing or not a string."],
    };
  }

  const catalogEntry = getCatalogEntry(eventName);
  if (!catalogEntry) {
    return {
      valid: false,
      missingFields: [],
      errors: [`Unknown eventName: "${eventName}".`],
    };
  }

  // Verify discriminator fields match the catalog.
  if (obj.eventCategory !== catalogEntry.eventCategory) {
    errors.push(
      `eventCategory "${String(obj.eventCategory)}" does not match catalog ("${catalogEntry.eventCategory}") for eventName "${eventName}".`,
    );
  }

  if (
    catalogEntry.app !== "any" &&
    obj.app !== catalogEntry.app
  ) {
    errors.push(
      `app "${String(obj.app)}" does not match catalog ("${catalogEntry.app}") for eventName "${eventName}".`,
    );
  }

  // Verify every required field is present.
  for (const field of catalogEntry.requiredFields) {
    if (obj[field as string] === undefined) {
      missingFields.push(field as string);
    }
  }

  if (missingFields.length > 0) {
    errors.push(
      `Missing required field(s): ${missingFields.join(", ")} for eventName "${eventName}".`,
    );
  }

  return {
    valid: errors.length === 0,
    entry: catalogEntry,
    missingFields,
    errors,
  };
}

// ─── Type re-exports for convenience ─────────────────────────────────────────

export type { TelemetryEvent, TelemetryEventByName, DeviceContext };
export { TelemetryEventName };
